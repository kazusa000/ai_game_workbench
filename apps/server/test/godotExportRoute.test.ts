import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { createApp } from "../src/app";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeStorageDir() {
  const dir = mkdtempSync(join(tmpdir(), "ai-game-workbench-godot-export-"));
  tempDirs.push(dir);
  return dir;
}

function makeExportDir() {
  const dir = mkdtempSync(join(tmpdir(), "ai-game-workbench-character-export-"));
  tempDirs.push(dir);
  return dir;
}

describe("Godot export route", () => {
  it("exports current character animation frames at the selected runtime size", async () => {
    const storageDir = makeStorageDir();
    const module01CharacterExportDir = makeExportDir();
    await writeCharacterFrames(storageDir, "hero");
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      storageDir,
      module01CharacterExportDir
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/export/godot",
      payload: {
        characterId: "hero",
        exportSize: 512
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      characterId: "hero",
      exportSize: 512,
      exportRootUrl: "/exports/character-2d/hero/size-512",
      exportRootPath: join(module01CharacterExportDir, "hero", "size-512"),
      manifestUrl: "/exports/character-2d/hero/size-512/animations.json",
      importScriptUrl: "/exports/character-2d/hero/size-512/import_to_godot.gd",
      zipUrl: "/exports/character-2d/hero/size-512/godot-export.zip",
      exportedActions: expect.arrayContaining(["idle", "walk", "attack1"])
    });

    const exportRoot = join(module01CharacterExportDir, "hero", "size-512");
    expect(existsSync(join(exportRoot, "frames", "walk", "down", "000.png"))).toBe(true);
    expect(existsSync(join(exportRoot, "frames", "idle", "down", "000.png"))).toBe(true);
    expect(existsSync(join(exportRoot, "frames", "attack1", "down", "000.png"))).toBe(true);
    expect(existsSync(join(exportRoot, "godot-export.zip"))).toBe(true);
    expect(existsSync(join(storageDir, "characters", "hero", "godot-export"))).toBe(false);
    expect(await sharp(join(exportRoot, "frames", "walk", "down", "000.png")).metadata()).toMatchObject({
      width: 512,
      height: 512
    });
    const manifestResponse = await app.inject({
      method: "GET",
      url: "/exports/character-2d/hero/size-512/animations.json"
    });
    expect(manifestResponse.statusCode).toBe(200);
    const manifest = JSON.parse(readFileSync(join(exportRoot, "animations.json"), "utf8"));
    expect(manifest).toMatchObject({
      characterId: "hero",
      frameSize: 512,
      directions: ["down", "up", "left", "right"]
    });
    expect(manifest.animations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "walk_down",
        action: "walk",
        direction: "down",
        fps: 30,
        loop: true,
        frames: ["frames/walk/down/000.png", "frames/walk/down/001.png"]
      }),
      expect.objectContaining({
        name: "attack1_down",
        action: "attack1",
        direction: "down",
        fps: 30,
        loop: false
      })
    ]));

    await app.close();
  });

  it("rejects unsupported Godot export sizes", async () => {
    const storageDir = makeStorageDir();
    const module01CharacterExportDir = makeExportDir();
    mkdirSync(join(storageDir, "characters", "hero"), { recursive: true });
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      storageDir,
      module01CharacterExportDir
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/export/godot",
      payload: {
        characterId: "hero",
        exportSize: 300
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("256");

    await app.close();
  });
});

async function writeCharacterFrames(storageDir: string, characterId: string): Promise<void> {
  const directionKeys = ["down", "up", "left", "right"] as const;
  for (const direction of directionKeys) {
    const walkDir = join(storageDir, "characters", characterId, "base-character", "loop-export", "transparent", direction);
    mkdirSync(walkDir, { recursive: true });
    writeFileSync(join(walkDir, "frame_001.png"), await makeFrame("#aa2222"));
    writeFileSync(join(walkDir, "frame_002.png"), await makeFrame("#22aa22"));

    const attackDir = join(storageDir, "characters", characterId, "advanced-character", "attack-1", "export", "transparent", direction);
    mkdirSync(attackDir, { recursive: true });
    writeFileSync(join(attackDir, "frame_001.png"), await makeFrame("#2222aa"));
  }
  const idleDir = join(storageDir, "characters", characterId, "base-character", "loop-export", "idle", "transparent");
  mkdirSync(idleDir, { recursive: true });
  for (const direction of directionKeys) {
    writeFileSync(join(idleDir, `${direction}.png`), await makeFrame("#aaaa22"));
  }
}

async function makeFrame(color: string): Promise<Buffer> {
  return sharp({
    create: {
      width: 64,
      height: 64,
      channels: 4,
      background: color
    }
  }).png().toBuffer();
}
