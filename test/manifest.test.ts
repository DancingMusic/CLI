import { describe, expect, it } from "vitest";
import { buildStoreRecord } from "../src/manifest.js";

describe("buildStoreRecord", () => {
  it("normalizes repository and capabilities", () => {
    expect(buildStoreRecord({
      schemaVersion: 1,
      kind: "connector",
      id: "archive",
      name: "Archive",
      summary: "Internet Archive connector",
      version: "1.0.0",
      publisher: { name: "DancingMusic", url: "https://github.com/DancingMusic" },
      repository: "https://github.com/DancingMusic/MusicConnect-Archive/",
      license: { name: "MIT", url: "https://example.com/license" },
      protocol: { package: "@dancingmusic/music-connect", range: "^1.0.0" },
      artifact: {
        url: "https://example.com/releases/v1.0.0/archive.tgz",
        integrity: `sha256-${"A".repeat(43)}=`,
        mirrors: [{ region: "china", url: "https://gitee.com/example/archive/releases/v1.0.0/archive.tgz" }],
      },
      releaseNotesUrl: "https://example.com/releases/v1.0.0",
      publishedAt: "2026-07-12T00:00:00.000Z",
      capabilities: ["search", "lyrics"],
      connector: { familyId: "archive", variant: "anonymous", authRequirement: "none", platforms: ["web", "desktop"] },
    })).toMatchObject({
      repository: "https://github.com/DancingMusic/MusicConnect-Archive",
      capabilities: ["lyrics", "search"],
      familyId: "archive",
      variant: "anonymous",
      artifact: {
        mirrors: [{ region: "china", url: "https://gitee.com/example/archive/releases/v1.0.0/archive.tgz" }],
      },
      releaseNotesUrl: "https://example.com/releases/v1.0.0",
    });
  });

  it("rejects connector Store submissions without artifact integrity", () => {
    expect(() => buildStoreRecord({
      schemaVersion: 1,
      kind: "connector",
      id: "example",
      name: "Example",
      summary: "Example connector",
      version: "1.0.0",
      publisher: { name: "Example", url: "https://example.com" },
      repository: "https://github.com/example/MusicConnect-Example",
      license: { name: "MIT", url: "https://example.com/license" },
      protocol: { package: "@dancingmusic/music-connect", range: ">=0.2.0" },
      artifact: { url: "https://example.com/releases/v1.0.0/index.js" },
      capabilities: ["search"],
      connector: { familyId: "example", variant: "anonymous", authRequirement: "none", platforms: ["web"] },
    })).toThrow("require integrity");
  });
});
