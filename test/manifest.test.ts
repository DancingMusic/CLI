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
      artifact: { url: "https://example.com/archive.tgz" },
      capabilities: ["search", "lyrics"],
    })).toMatchObject({
      repository: "https://github.com/DancingMusic/MusicConnect-Archive",
      capabilities: ["lyrics", "search"],
    });
  });
});
