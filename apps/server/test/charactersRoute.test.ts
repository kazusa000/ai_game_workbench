import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeStorageDir() {
  const dir = mkdtempSync(join(tmpdir(), "ai-game-workbench-characters-"));
  tempDirs.push(dir);
  return dir;
}

describe("character assets route", () => {
  it("deletes the whole character folder", async () => {
    const storageDir = makeStorageDir();
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      storageDir
    });
    const characterRoot = join(storageDir, "characters", "hero");
    await mkdir(join(characterRoot, "base-character", "loop-export"), { recursive: true });
    await writeFile(join(characterRoot, "base-character", "loop-export", "sprite-sheet.png"), "sprite");

    await app.ready();
    const response = await app.inject({
      method: "DELETE",
      url: "/api/characters/hero"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      deleted: true,
      character: { id: "hero", name: "hero" }
    });
    expect(existsSync(characterRoot)).toBe(false);

    await app.close();
  });

  it("returns existing fixed character files for preview hydration", async () => {
    const storageDir = makeStorageDir();
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      storageDir
    });
    const characterRoot = join(storageDir, "characters", "hero");
    await mkdir(join(characterRoot, "base-template"), { recursive: true });
    await mkdir(join(characterRoot, "base-character", "direction-templates"), { recursive: true });
    await mkdir(join(characterRoot, "base-character", "walk-video"), { recursive: true });
    await mkdir(join(characterRoot, "base-character", "loop-export", "transparent", "down"), { recursive: true });
    await mkdir(join(characterRoot, "base-character", "loop-export", "idle", "transparent"), { recursive: true });
    await mkdir(join(characterRoot, "base-character", "loop-export", "exports"), { recursive: true });
    await mkdir(join(characterRoot, "advanced-character", "run"), { recursive: true });
    await mkdir(join(characterRoot, "advanced-character", "attack-1", "midframe"), { recursive: true });
    await mkdir(join(characterRoot, "advanced-character", "attack-1", "reference"), { recursive: true });
    await writeFile(join(characterRoot, "base-template", "character-reference.webp"), "reference");
    await writeFile(join(characterRoot, "base-template", "output.png"), "output");
    await writeFile(join(characterRoot, "base-character", "direction-templates", "base-template.png"), "direction-base");
    await writeFile(join(characterRoot, "base-character", "direction-templates", "idle-4dir.jpg"), "idle");
    await writeFile(join(characterRoot, "base-character", "direction-templates", "walk-4dir.webp"), "walk");
    await writeFile(join(characterRoot, "base-character", "walk-video", "input-4dir.png"), "video-input");
    await writeFile(join(characterRoot, "base-character", "walk-video", "source.mp4"), "video");
    await writeFile(join(characterRoot, "base-character", "loop-export", "transparent", "down", "frame_002.png"), "frame");
    await writeFile(join(characterRoot, "base-character", "loop-export", "idle", "transparent", "down.png"), "idle-down");
    await writeFile(join(characterRoot, "base-character", "loop-export", "exports", "sprite-sheet.png"), "sprite");
    await writeFile(join(characterRoot, "base-character", "loop-export", "exports", "idle-4dir-sprite-sheet.png"), "idle-sheet");
    await writeFile(join(characterRoot, "advanced-character", "run", "keyframe-4dir.jpg"), "run-keyframe");
    await writeFile(join(characterRoot, "advanced-character", "attack-1", "midframe", "middle-4dir.png"), "middle");
    await writeFile(join(characterRoot, "advanced-character", "attack-1", "reference", "reference.png"), "old-reference");

    await app.ready();
    const response = await app.inject({
      method: "GET",
      url: "/api/characters/hero/assets"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      characterId: "hero",
      assets: {
        baseTemplate: {
          characterReference: {
            fileName: "character-reference.webp",
            url: "/characters/hero/base-template/character-reference.webp"
          },
          output: {
            url: "/characters/hero/base-template/output.png"
          }
        },
        baseCharacter: {
          directionBaseTemplate: {
            url: "/characters/hero/base-character/direction-templates/base-template.png"
          },
          idleDirectionTemplate: {
            url: "/characters/hero/base-character/direction-templates/idle-4dir.jpg"
          },
          walkDirectionTemplate: {
            url: "/characters/hero/base-character/direction-templates/walk-4dir.webp"
          },
          walkVideoInput: {
            url: "/characters/hero/base-character/walk-video/input-4dir.png"
          },
          walkVideoSource: {
            url: "/characters/hero/base-character/walk-video/source.mp4"
          },
          loopExport: {
            spriteSheetUrl: "/characters/hero/base-character/loop-export/exports/sprite-sheet.png",
            idle: {
              spriteSheetUrl: "/characters/hero/base-character/loop-export/exports/idle-4dir-sprite-sheet.png"
            }
          }
        }
      }
    });
    expect(response.json().assets.advancedCharacter.attack1.middleFrame).toEqual({
      fileName: "middle-4dir.png",
      url: "/characters/hero/advanced-character/attack-1/midframe/middle-4dir.png"
    });
    expect(response.json().assets.advancedCharacter.run.keyframe).toEqual({
      fileName: "keyframe-4dir.jpg",
      url: "/characters/hero/advanced-character/run/keyframe-4dir.jpg"
    });
    expect(response.json().assets.advancedCharacter.attack1.reference).toBeUndefined();
    expect(response.json().assets.baseCharacter.loopExport.directions[0].transparentFrames).toEqual([
      {
        index: 2,
        url: "/characters/hero/base-character/loop-export/transparent/down/frame_002.png"
      }
    ]);

    await app.close();
  });
});
