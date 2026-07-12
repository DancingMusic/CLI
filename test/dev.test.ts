import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { startDevBridge } from "../src/dev.js";

const roots: string[] = [];

async function fixture(kind: "plugin" | "connector" = "plugin") {
  const root = await mkdtemp(join(tmpdir(), "dancingmusic-cli-dev-"));
  roots.push(root);
  await mkdir(join(root, "dist"));
  await writeFile(join(root, "dist/index.js"), "export default {};\n");
  await writeFile(join(root, "dancingmusic.json"), JSON.stringify({
    schemaVersion: 1,
    kind,
    id: `example-${kind}`,
    name: `Example ${kind}`,
    summary: "A local development fixture.",
    version: "1.2.3",
    publisher: { name: "Example", url: "https://github.com/example" },
    repository: `https://github.com/example/${kind === "plugin" ? "DancePlugin" : "MusicConnect"}-Example`,
    license: { name: "MIT", url: "https://example.com/license", ...(kind === "plugin" ? { commercialUse: true } : {}) },
    protocol: { package: kind === "plugin" ? "@dancingmusic/plugin-sdk" : "@dancingmusic/music-connect", range: "^1.0.0" },
    artifact: { url: "https://example.com/releases/v1.2.3/index.js" },
    capabilities: [],
    ...(kind === "connector" ? {
      connector: { familyId: "example", variant: "anonymous", authRequirement: "none", platforms: ["web", "desktop"] },
    } : {}),
  }));
  return root;
}

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("Dev Bridge", () => {
  it.each(["plugin", "connector"] as const)("serves a cache-free %s artifact on loopback", async (kind) => {
    const bridge = await startDevBridge({ cwd: await fixture(kind), port: 0 });
    try {
      expect(bridge.host).toBe("127.0.0.1");
      const response = await fetch(`${bridge.url}/artifact`);
      expect(await response.text()).toBe("export default {};\n");
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect((await fetch(`${bridge.url}/../../dancingmusic.json`)).status).toBe(404);
    } finally {
      await bridge.close();
    }
  });

  it("sends the standard update message on WebSocket connection", async () => {
    const bridge = await startDevBridge({ cwd: await fixture(), port: 0 });
    try {
      const message = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const socket = connect(bridge.port, "127.0.0.1");
        let upgraded = false;
        let buffer = Buffer.alloc(0);
        socket.once("error", reject);
        socket.on("data", (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);
          if (!upgraded) {
            const marker = buffer.indexOf("\r\n\r\n");
            if (marker < 0) return;
            upgraded = true;
            buffer = buffer.subarray(marker + 4);
          }
          if (buffer.length < 2) return;
          const length = buffer[1] & 0x7f;
          const offset = length === 126 ? 4 : 2;
          if (buffer.length < offset) return;
          const size = length === 126 ? buffer.readUInt16BE(2) : length;
          if (buffer.length < offset + size) return;
          socket.destroy();
          resolve(JSON.parse(buffer.subarray(offset, offset + size).toString()));
        });
        socket.write([
          "GET /events HTTP/1.1",
          `Host: 127.0.0.1:${bridge.port}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          "Sec-WebSocket-Version: 13",
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
          "\r\n",
        ].join("\r\n"));
      });
      expect(message).toEqual({
        protocolVersion: 1,
        type: "implementation:update",
        kind: "plugin",
        id: "example-plugin",
        version: "1.2.3",
        bundleUrl: `${bridge.url}/artifact`,
        sequence: 1,
      });
    } finally {
      await bridge.close();
    }
  });

  it("pushes a monotonic update when a watched artifact changes", async () => {
    const root = await fixture("connector");
    const bridge = await startDevBridge({ cwd: root, port: 0, watch: true });
    try {
      const messages = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        const socket = connect(bridge.port, "127.0.0.1");
        let buffer = Buffer.alloc(0);
        let upgraded = false;
        const values: Array<Record<string, unknown>> = [];
        const timeout = setTimeout(() => { socket.destroy(); reject(new Error("timed out waiting for reload")); }, 5000);
        socket.once("error", reject);
        socket.on("data", (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);
          if (!upgraded) {
            const marker = buffer.indexOf("\r\n\r\n");
            if (marker < 0) return;
            upgraded = true;
            buffer = buffer.subarray(marker + 4);
          }
          while (buffer.length >= 2) {
            const length = buffer[1] & 0x7f;
            const offset = length === 126 ? 4 : 2;
            if (buffer.length < offset) return;
            const size = length === 126 ? buffer.readUInt16BE(2) : length;
            if (buffer.length < offset + size) return;
            values.push(JSON.parse(buffer.subarray(offset, offset + size).toString()));
            buffer = buffer.subarray(offset + size);
            if (values.length === 1) void writeFile(join(root, "dist/index.js"), "export default { changed: true };\n");
            if (values.length === 2) {
              clearTimeout(timeout);
              socket.destroy();
              resolve(values);
            }
          }
        });
        socket.write([
          "GET /events HTTP/1.1", `Host: 127.0.0.1:${bridge.port}`, "Upgrade: websocket",
          "Connection: Upgrade", "Sec-WebSocket-Version: 13",
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==", "\r\n",
        ].join("\r\n"));
      });
      expect(messages.map((message) => message.sequence)).toEqual([1, 2]);
      expect(messages[1]).toMatchObject({ type: "implementation:update", kind: "connector", version: "1.2.3" });
    } finally {
      await bridge.close();
    }
  });

  it("rejects traversal and symlinks escaping the project", async () => {
    const root = await fixture();
    await expect(startDevBridge({ cwd: root, artifact: "../outside.js", port: 0 })).rejects.toThrow("inside the project root");
    const outside = join(tmpdir(), `dancingmusic-outside-${Date.now()}.js`);
    await writeFile(outside, "secret");
    roots.push(outside);
    await symlink(outside, join(root, "dist/escape.js"));
    await expect(startDevBridge({ cwd: root, artifact: "dist/escape.js", port: 0 })).rejects.toThrow("symlink");
  });
});
