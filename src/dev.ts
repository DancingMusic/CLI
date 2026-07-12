import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import type { Duplex } from "node:stream";
import chokidar, { type FSWatcher } from "chokidar";
import { validateManifest } from "./manifest.js";
import type { ImplementationManifest } from "./types.js";

export interface DevBridgeOptions {
  cwd?: string;
  artifact?: string;
  port?: number;
  watch?: boolean;
  build?: boolean;
}

export interface DevEvent {
  protocolVersion: 1;
  type: "implementation:update";
  sequence: number;
  kind: ImplementationManifest["kind"];
  id: string;
  version: string;
  bundleUrl: string;
}

export interface DevBridge {
  host: "127.0.0.1";
  port: number;
  url: string;
  close(): Promise<void>;
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

async function safeArtifact(projectRoot: string, artifactInput: string): Promise<string> {
  if (artifactInput.includes("\0")) throw new Error("artifact path contains a null byte");
  const lexical = resolve(projectRoot, artifactInput);
  if (!isInside(projectRoot, lexical)) throw new Error("artifact path must stay inside the project root");
  const canonical = await realpath(lexical).catch(() => undefined);
  if (!canonical) throw new Error(`artifact does not exist: ${artifactInput}`);
  if (!isInside(projectRoot, canonical)) throw new Error("artifact symlink must stay inside the project root");
  if (!(await stat(canonical)).isFile()) throw new Error("artifact must be a regular file");
  return canonical;
}

function websocketFrame(payload: string): Buffer {
  const body = Buffer.from(payload);
  if (body.length < 126) return Buffer.concat([Buffer.from([0x81, body.length]), body]);
  if (body.length <= 0xffff) {
    const head = Buffer.alloc(4);
    head[0] = 0x81;
    head[1] = 126;
    head.writeUInt16BE(body.length, 2);
    return Buffer.concat([head, body]);
  }
  const head = Buffer.alloc(10);
  head[0] = 0x81;
  head[1] = 127;
  head.writeBigUInt64BE(BigInt(body.length), 2);
  return Buffer.concat([head, body]);
}

function packageManager(cwd: string): { command: string; args: string[] } {
  if (existsSync(resolve(cwd, "pnpm-lock.yaml"))) return { command: "pnpm", args: ["run", "build"] };
  if (existsSync(resolve(cwd, "yarn.lock"))) return { command: "yarn", args: ["build"] };
  return { command: "npm", args: ["run", "build"] };
}

async function runBuild(cwd: string): Promise<void> {
  const packageJson = JSON.parse(await readFile(resolve(cwd, "package.json"), "utf8")) as { scripts?: { build?: string } };
  if (!packageJson.scripts?.build) throw new Error("package.json does not declare scripts.build");
  const runner = packageManager(cwd);
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(runner.command, runner.args, { cwd, stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`build failed (${signal ?? `exit ${code ?? "unknown"}`})`));
    });
  });
}

function jsonResponse(response: import("node:http").ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, no-cache, must-revalidate",
    pragma: "no-cache",
    expires: "0",
    "access-control-allow-origin": "*",
    "x-content-type-options": "nosniff",
  });
  response.end(`${JSON.stringify(value)}\n`);
}

export async function startDevBridge(options: DevBridgeOptions = {}): Promise<DevBridge> {
  const projectRoot = await realpath(resolve(options.cwd ?? process.cwd()));
  const validation = await validateManifest(projectRoot);
  if (!validation.valid || !validation.manifest) throw new Error(validation.errors.join("\n"));
  const manifest = validation.manifest;
  const artifactInput = options.artifact ?? "dist/index.js";
  if (options.build) await runBuild(projectRoot);
  await safeArtifact(projectRoot, artifactInput);

  const clients = new Set<Duplex>();
  let watcher: FSWatcher | undefined;
  let sequence = 0;
  let revision = 1;
  let actualPort = 0;
  const artifactUrl = () => `http://127.0.0.1:${actualPort}/artifact`;
  const event = (): DevEvent => ({
    protocolVersion: 1,
    type: "implementation:update",
    sequence: ++sequence,
    kind: manifest.kind,
    id: manifest.id,
    version: manifest.version,
    bundleUrl: artifactUrl(),
  });
  const broadcast = (value: DevEvent) => {
    const frame = websocketFrame(JSON.stringify(value));
    for (const socket of clients) {
      if (socket.destroyed || !socket.writable) clients.delete(socket);
      else socket.write(frame);
    }
  };

  const server: Server = createServer(async (request, response) => {
    response.setHeader("access-control-allow-origin", "*");
    if (request.method !== "GET") return jsonResponse(response, 405, { error: "method_not_allowed" });
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/health") return jsonResponse(response, 200, { ok: true, protocolVersion: 1, kind: manifest.kind, id: manifest.id, revision });
    if (pathname === "/manifest") return jsonResponse(response, 200, manifest);
    if (pathname !== "/artifact") return jsonResponse(response, 404, { error: "not_found" });
    try {
      const artifact = await safeArtifact(projectRoot, artifactInput);
      const body = await readFile(artifact);
      response.writeHead(200, {
        "content-type": artifact.endsWith(".json") ? "application/json; charset=utf-8" : "text/javascript; charset=utf-8",
        "content-length": body.length,
        "cache-control": "no-store, no-cache, must-revalidate",
        pragma: "no-cache",
        expires: "0",
        "access-control-allow-origin": "*",
        "x-content-type-options": "nosniff",
      });
      response.end(body);
    } catch (error) {
      jsonResponse(response, 404, { error: "artifact_unavailable", message: error instanceof Error ? error.message : String(error) });
    }
  });

  server.on("upgrade", (request, socket) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const key = request.headers["sec-websocket-key"];
    if (pathname !== "/events" || request.headers.upgrade?.toLowerCase() !== "websocket" || typeof key !== "string") {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      return;
    }
    const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    clients.add(socket);
    socket.write(websocketFrame(JSON.stringify(event())));
    const remove = () => clients.delete(socket);
    socket.on("close", remove);
    socket.on("error", remove);
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 17373, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Dev Bridge failed to obtain a TCP address");
  actualPort = address.port;

  if (options.watch) {
    let timer: NodeJS.Timeout | undefined;
    let building = false;
    let queued = false;
    const rebuild = async () => {
      if (building) { queued = true; return; }
      building = true;
      try {
        if (options.build) {
          await runBuild(projectRoot);
          await safeArtifact(projectRoot, artifactInput);
          revision += 1;
        } else revision += 1;
        broadcast(event());
      } catch (error) {
        console.error(`Dev Bridge rebuild failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        building = false;
        if (queued) { queued = false; void rebuild(); }
      }
    };
    const artifactLexical = resolve(projectRoot, artifactInput);
    const generatedRoot = dirname(artifactLexical);
    watcher = chokidar.watch(projectRoot, {
      ignoreInitial: true,
      ignored: (path) => {
        const normalized = relative(projectRoot, path).split(sep).join("/");
        if (/(^|\/)(\.git|node_modules)(\/|$)/.test(normalized)) return true;
        return Boolean(options.build && (path === generatedRoot || isInside(generatedRoot, path)));
      },
    });
    await new Promise<void>((resolvePromise, reject) => {
      watcher!.once("ready", resolvePromise);
      watcher!.once("error", reject);
    });
    watcher.on("all", (_event, filename) => {
      if (!filename) return;
      clearTimeout(timer);
      timer = setTimeout(() => void rebuild(), 100);
    });
  }

  return {
    host: "127.0.0.1",
    port: actualPort,
    url: `http://127.0.0.1:${actualPort}`,
    close: async () => {
      await watcher?.close();
      for (const socket of clients) socket.destroy();
      await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
    },
  };
}
