import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { createApp } from "../src/app";
import { resolveDefaultFfmpegPath } from "../src/config";
import { runFfmpeg } from "../src/processing/ffmpeg";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeStorageDir() {
  const dir = mkdtempSync(join(tmpdir(), "ai-game-workbench-processing-"));
  tempDirs.push(dir);
  return dir;
}

describe("processing route", () => {
  it("requires a selected character for four-direction processing", async () => {
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      storageDir: makeStorageDir()
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/processing/four-direction",
      payload: {
        jobId: "local-video-123",
        frameCount: 120,
        keyColor: "#00ff00",
        tolerance: 8
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("角色");

    await app.close();
  });

  it("looks for the source video in the selected character folder", async () => {
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      storageDir: makeStorageDir()
    });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { name: "hero" }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/processing/four-direction",
      payload: {
        jobId: "local-video-123",
        characterId: "hero",
        frameCount: 120,
        keyColor: "#00ff00",
        tolerance: 8
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toContain("storage/characters/hero/base-character/walk-video/source.mp4");

    await app.close();
  });

  it("keeps idle export out of four-direction walk processing", async () => {
    const storageDir = makeStorageDir();
    const ffmpegPath = resolveDefaultFfmpegPath();
    const app = createApp({
      ffmpegPath,
      port: 8787,
      storageDir
    });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { name: "hero" }
    });

    const videoDir = join(storageDir, "characters", "hero", "base-character", "walk-video");
    mkdirSync(videoDir, { recursive: true });
    await createTestFourDirectionVideo(ffmpegPath, join(videoDir, "source.mp4"));

    const response = await app.inject({
      method: "POST",
      url: "/api/processing/four-direction",
      payload: {
        jobId: "walk-video",
        characterId: "hero",
        frameCount: 4,
        keyColor: "#00ff00",
        tolerance: 8,
        minLoopFrames: 2,
        maxLoopFrames: 4,
        exportFrameSize: 64,
        fps: 12
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty("idle");
    expect(existsSync(join(storageDir, "characters", "hero", "base-character", "loop-export", "exports", "sprite-sheet.png"))).toBe(true);
    expect(existsSync(join(storageDir, "characters", "hero", "base-character", "loop-export", "exports", "idle-4dir-sprite-sheet.png"))).toBe(false);

    await app.close();
  });

  it("normalizes walk directions to the first walk frame profile", async () => {
    const storageDir = makeStorageDir();
    const ffmpegPath = resolveDefaultFfmpegPath();
    const app = createApp({
      ffmpegPath,
      port: 8787,
      storageDir
    });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { name: "hero" }
    });

    const videoDir = join(storageDir, "characters", "hero", "base-character", "walk-video");
    mkdirSync(videoDir, { recursive: true });
    await createTestUnevenFourDirectionVideo(ffmpegPath, join(videoDir, "source.mp4"));

    const response = await app.inject({
      method: "POST",
      url: "/api/processing/four-direction",
      payload: {
        jobId: "walk-profile-video",
        characterId: "hero",
        frameCount: 4,
        keyColor: "#00ff00",
        tolerance: 8,
        minLoopFrames: 2,
        maxLoopFrames: 4,
        exportFrameSize: 256,
        fps: 12
      }
    });

    expect(response.statusCode).toBe(200);
    const heights = await Promise.all(["down", "up", "left", "right"].map(async (direction) => {
      const transparentDir = join(storageDir, "characters", "hero", "base-character", "loop-export", "transparent", direction);
      const firstFile = readdirSync(transparentDir)
        .filter((fileName) => fileName.endsWith(".png"))
        .sort()[0];
      expect(firstFile).toBeDefined();
      return (await getAlphaBox(readFileSync(join(transparentDir, firstFile ?? ""))))?.height ?? 0;
    }));
    const referenceHeight = heights[0] ?? 0;
    expect(referenceHeight).toBeGreaterThan(50);
    for (const height of heights) {
      expect(Math.abs(height - referenceHeight)).toBeLessThanOrEqual(2);
    }

    await app.close();
  });

  it("requires walk loop export before idle four-direction processing", async () => {
    const storageDir = makeStorageDir();
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      storageDir
    });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { name: "hero" }
    });

    const templateDir = join(storageDir, "characters", "hero", "base-character", "direction-templates");
    mkdirSync(templateDir, { recursive: true });
    writeFileSync(join(templateDir, "idle-4dir.png"), await createTestIdleSheet());

    const response = await app.inject({
      method: "POST",
      url: "/api/processing/idle-four-direction",
      payload: {
        characterId: "hero",
        keyColor: "#00ff00",
        tolerance: 8
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toContain("loop-export");

    await app.close();
  });

  it("processes idle four-direction sheet using the walk loop export alignment", async () => {
    const storageDir = makeStorageDir();
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      storageDir
    });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { name: "hero" }
    });

    const templateDir = join(storageDir, "characters", "hero", "base-character", "direction-templates");
    mkdirSync(templateDir, { recursive: true });
    writeFileSync(join(templateDir, "idle-4dir.png"), await createTestIdleSheet());
    await writeWalkTransparentReferences(storageDir, "hero");

    const response = await app.inject({
      method: "POST",
      url: "/api/processing/idle-four-direction",
      payload: {
        characterId: "hero",
        keyColor: "#00ff00",
        tolerance: 8
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      frames: expect.arrayContaining([
        expect.objectContaining({
          key: "down",
          url: "/characters/hero/base-character/loop-export/idle/transparent/down.png"
        })
      ]),
      spriteSheetUrl: "/characters/hero/base-character/loop-export/exports/idle-4dir-sprite-sheet.png"
    });
    expect(existsSync(join(storageDir, "characters", "hero", "base-character", "loop-export", "idle", "transparent", "down.png"))).toBe(true);
    expect(existsSync(join(storageDir, "characters", "hero", "base-character", "loop-export", "exports", "idle-4dir-sprite-sheet.png"))).toBe(true);

    await app.close();
  });

  it("normalizes idle directions to the first walk frame profile instead of each direction box", async () => {
    const storageDir = makeStorageDir();
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      storageDir
    });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { name: "hero" }
    });

    const templateDir = join(storageDir, "characters", "hero", "base-character", "direction-templates");
    mkdirSync(templateDir, { recursive: true });
    writeFileSync(join(templateDir, "idle-4dir.png"), await createTestIdleSheet());
    await writeUnevenWalkTransparentReferences(storageDir, "hero");

    const response = await app.inject({
      method: "POST",
      url: "/api/processing/idle-four-direction",
      payload: {
        characterId: "hero",
        keyColor: "#00ff00",
        tolerance: 8
      }
    });

    expect(response.statusCode).toBe(200);
    const idleDir = join(storageDir, "characters", "hero", "base-character", "loop-export", "idle", "transparent");
    await expect(getAlphaBox(readFileSync(join(idleDir, "down.png")))).resolves.toMatchObject({ height: 160 });
    await expect(getAlphaBox(readFileSync(join(idleDir, "up.png")))).resolves.toMatchObject({ height: 160 });
    await expect(getAlphaBox(readFileSync(join(idleDir, "left.png")))).resolves.toMatchObject({ height: 160 });
    await expect(getAlphaBox(readFileSync(join(idleDir, "right.png")))).resolves.toMatchObject({ height: 160 });

    await app.close();
  });

  it("looks for advanced action source videos in the selected character advanced folder", async () => {
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      storageDir: makeStorageDir()
    });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { name: "hero" }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/processing/advanced-action",
      payload: {
        jobId: "video_job_run",
        characterId: "hero",
        actionKind: "run",
        mode: "loop",
        frameCount: 120,
        keyColor: "#00ff00",
        tolerance: 8
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toContain("storage/characters/hero/advanced-character/run/video/source.mp4");

    await app.close();
  });

  it("requires the generated idle four-direction template for advanced action start frames", async () => {
    const storageDir = makeStorageDir();
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      storageDir
    });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { name: "hero" }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/processing/advanced-action/start-frame",
      payload: {
        characterId: "hero",
        actionKind: "attack-1",
        keyColor: "#00ff00"
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toContain("base-character/direction-templates/idle-4dir.png");

    await app.close();
  });

  it("prepares advanced action start frames directly from the green-screen idle 2x2 template", async () => {
    const storageDir = makeStorageDir();
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      storageDir
    });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { name: "hero" }
    });

    const templateDir = join(storageDir, "characters", "hero", "base-character", "direction-templates");
    mkdirSync(templateDir, { recursive: true });
    writeFileSync(join(templateDir, "idle-4dir.png"), await createTestIdleSheet());

    const response = await app.inject({
      method: "POST",
      url: "/api/processing/advanced-action/start-frame",
      payload: {
        characterId: "hero",
        actionKind: "attack-1",
        keyColor: "#00ff00",
        scale: 0.57
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().localUrl).toBe("/characters/hero/advanced-character/attack-1/video/input-4dir.png");

    const output = readFileSync(join(storageDir, "characters", "hero", "advanced-character", "attack-1", "video", "input-4dir.png"));
    const metadata = await sharp(output).metadata();
    expect(metadata.width).toBe(128);
    expect(metadata.height).toBe(128);

    const raw = await sharp(output).ensureAlpha().raw().toBuffer();
    let transparentPixels = 0;
    let greenPixels = 0;
    for (let index = 0; index < raw.length; index += 4) {
      if (raw[index + 3] !== 255) {
        transparentPixels += 1;
      }
      if (raw[index] === 0 && raw[index + 1] === 255 && raw[index + 2] === 0) {
        greenPixels += 1;
      }
    }
    expect(transparentPixels).toBe(0);
    expect(greenPixels).toBeGreaterThan(0);

    await app.close();
  });

  it("preserves source pixels when scaling advanced action start frame subjects", async () => {
    const storageDir = makeStorageDir();
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      storageDir
    });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { name: "hero" }
    });

    const templateDir = join(storageDir, "characters", "hero", "base-character", "direction-templates");
    mkdirSync(templateDir, { recursive: true });
    writeFileSync(join(templateDir, "idle-4dir.png"), await createTestIdleSheet({
      background: { r: 6, g: 249, b: 6, alpha: 1 },
      detachedArtifact: { left: 50, top: 58, width: 2, height: 2, color: { r: 255, g: 0, b: 255, alpha: 1 } },
      downAccent: { left: 32, top: 14, width: 14, height: 34, color: { r: 0, g: 0, b: 255, alpha: 1 } }
    }));

    const response = await app.inject({
      method: "POST",
      url: "/api/processing/advanced-action/start-frame",
      payload: {
        characterId: "hero",
        actionKind: "attack-1",
        keyColor: "#00ff00",
        scale: 0.5
      }
    });

    expect(response.statusCode).toBe(200);

    const output = readFileSync(join(storageDir, "characters", "hero", "advanced-character", "attack-1", "video", "input-4dir.png"));
    const raw = await sharp(output).ensureAlpha().raw().toBuffer();
    let sourceBackgroundPixels = 0;
    let exactKeyPixels = 0;
    let detachedArtifactPixels = 0;
    let unexpectedIntermediatePixels = 0;
    const allowedColors = new Set([
      "6,249,6",
      "255,0,0",
      "0,0,255",
      "255,255,0",
      "0,0,0"
    ]);
    for (let index = 0; index < raw.length; index += 4) {
      const red = raw[index] ?? 0;
      const green = raw[index + 1] ?? 0;
      const blue = raw[index + 2] ?? 0;
      if (red === 6 && green === 249 && blue === 6) {
        sourceBackgroundPixels += 1;
      }
      if (red === 0 && green === 255 && blue === 0) {
        exactKeyPixels += 1;
      }
      if (red === 255 && green === 0 && blue === 255) {
        detachedArtifactPixels += 1;
      }
      if (!allowedColors.has(`${red},${green},${blue}`)) {
        unexpectedIntermediatePixels += 1;
      }
    }
    expect(sourceBackgroundPixels).toBeGreaterThan(0);
    expect(exactKeyPixels).toBe(0);
    expect(detachedArtifactPixels).toBe(0);
    expect(unexpectedIntermediatePixels).toBe(0);

    const background = { r: 6, g: 249, b: 6 };
    expect(findNonGreenBox(raw, 128, 128, { left: 0, top: 0, width: 64, height: 64 }, background)).toMatchObject({ centerX: 32, centerY: 32 });
    expect(findNonGreenBox(raw, 128, 128, { left: 64, top: 0, width: 64, height: 64 }, background)).toMatchObject({ centerX: 96, centerY: 32 });
    expect(findNonGreenBox(raw, 128, 128, { left: 0, top: 64, width: 64, height: 64 }, background)).toMatchObject({ centerX: 32, centerY: 96 });
    expect(findNonGreenBox(raw, 128, 128, { left: 64, top: 64, width: 64, height: 64 }, background)).toMatchObject({ centerX: 96, centerY: 96 });

    await app.close();
  });

  it("does not build a combined sprite sheet for one-shot advanced actions", async () => {
    const storageDir = makeStorageDir();
    const ffmpegPath = resolveDefaultFfmpegPath();
    const app = createApp({
      ffmpegPath,
      port: 8787,
      storageDir
    });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { name: "hero" }
    });

    const videoDir = join(storageDir, "characters", "hero", "advanced-character", "jump", "video");
    mkdirSync(videoDir, { recursive: true });
    await createTestFourDirectionVideo(ffmpegPath, join(videoDir, "source.mp4"));

    const response = await app.inject({
      method: "POST",
      url: "/api/processing/advanced-action",
      payload: {
        jobId: "jump_video_job",
        characterId: "hero",
        actionKind: "jump",
        mode: "oneshot",
        frameCount: 2,
        keyColor: "#00ff00",
        tolerance: 8,
        minLoopFrames: 2,
        maxLoopFrames: 2,
        exportFrameSize: 256,
        fps: 12
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().spriteSheetUrl).toBeUndefined();
    expect(existsSync(join(storageDir, "characters", "hero", "advanced-character", "jump", "export", "exports", "sprite-sheet.png"))).toBe(false);
    expect(response.json().transparentZipUrl).toContain("transparent-frames.zip");

    await app.close();
  });

  it("compresses one-shot advanced actions without trimming to the first action", async () => {
    const storageDir = makeStorageDir();
    const ffmpegPath = resolveDefaultFfmpegPath();
    const app = createApp({
      ffmpegPath,
      port: 8787,
      storageDir
    });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { name: "hero" }
    });
    await writeTestIdleTransparentReferences(storageDir, "hero");

    const videoDir = join(storageDir, "characters", "hero", "advanced-character", "jump", "video");
    mkdirSync(videoDir, { recursive: true });
    await createTestFourDirectionJumpVideo(ffmpegPath, join(videoDir, "source.mp4"));

    const response = await app.inject({
      method: "POST",
      url: "/api/processing/advanced-action",
      payload: {
        jobId: "jump_video_job",
        characterId: "hero",
        actionKind: "jump",
        mode: "oneshot",
        frameCount: 20,
        keyColor: "#00ff00",
        tolerance: 8,
        minLoopFrames: 2,
        maxLoopFrames: 12,
        exportFrameSize: 256,
        fps: 12
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().frameCount).toBeLessThan(20);
    for (const direction of response.json().directions) {
      const selectedFrameNumbers = direction.transparentFrames.map((frame: { index: number }) => frame.index);
      expect(selectedFrameNumbers[0]).toBe(1);
      expect(selectedFrameNumbers).toContain(7);
      expect(selectedFrameNumbers).toContain(17);
      expect(selectedFrameNumbers.at(-1)).toBe(20);
    }

    const transparentDir = join(storageDir, "characters", "hero", "advanced-character", "jump", "export", "transparent", "down");
    const transparentFiles = readdirSync(transparentDir)
      .filter((fileName) => fileName.endsWith(".png"))
      .sort();
    const boxes = await Promise.all(transparentFiles
      .map((fileName) => getAlphaBox(readFileSync(join(transparentDir, fileName)))));
    const maxHeight = Math.max(...boxes.map((box) => box?.height ?? 0));
    const metadata = await sharp(join(transparentDir, transparentFiles[0] ?? "")).metadata();
    expect(metadata.width).toBe(256);
    expect(metadata.height).toBe(256);
    expect(maxHeight).toBeGreaterThan(20);
    expect(maxHeight).toBeLessThanOrEqual(metadata.height ?? 0);

    await app.close();
  });

  it("compresses attack one-shot actions with shared frame numbers instead of selecting endpoints", async () => {
    const storageDir = makeStorageDir();
    const ffmpegPath = resolveDefaultFfmpegPath();
    const app = createApp({
      ffmpegPath,
      port: 8787,
      storageDir
    });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { name: "hero" }
    });
    await writeTestIdleTransparentReferences(storageDir, "hero");

    const videoDir = join(storageDir, "characters", "hero", "advanced-character", "attack-1", "video");
    mkdirSync(videoDir, { recursive: true });
    await createTestFourDirectionAttackSettlesVideo(ffmpegPath, join(videoDir, "source.mp4"));

    const response = await app.inject({
      method: "POST",
      url: "/api/processing/advanced-action",
      payload: {
        jobId: "attack_video_job",
        characterId: "hero",
        actionKind: "attack-1",
        mode: "oneshot",
        frameCount: 20,
        keyColor: "#00ff00",
        tolerance: 8,
        minLoopFrames: 2,
        maxLoopFrames: 12,
        exportFrameSize: 256,
        fps: 12
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().frameCount).toBeLessThan(20);
    const selectedByDirection = response.json().directions.map((direction: { transparentFrames: { index: number }[] }) =>
      direction.transparentFrames.map((frame) => frame.index)
    );
    expect(new Set(selectedByDirection.map((frames: number[]) => frames.join(","))).size).toBe(1);
    for (const direction of response.json().directions) {
      const selectedFrameNumbers = direction.transparentFrames.map((frame: { index: number }) => frame.index);
      expect(selectedFrameNumbers[0]).toBe(1);
      expect(selectedFrameNumbers).toContain(3);
      expect(selectedFrameNumbers).toContain(7);
      expect(selectedFrameNumbers).toContain(10);
      expect(selectedFrameNumbers).toContain(17);
      expect(selectedFrameNumbers.at(-1)).toBe(20);
    }

    const transparentDir = join(storageDir, "characters", "hero", "advanced-character", "attack-1", "export", "transparent", "down");
    const transparentFiles = readdirSync(transparentDir)
      .filter((fileName) => fileName.endsWith(".png"))
      .sort();
    const boxes = await Promise.all(transparentFiles
      .map((fileName) => getAlphaBox(readFileSync(join(transparentDir, fileName)))));
    const maxHeight = Math.max(...boxes.map((box) => box?.height ?? 0));
    const firstHeight = boxes[0]?.height ?? 0;
    const metadata = await sharp(join(transparentDir, transparentFiles[0] ?? "")).metadata();
    expect(metadata.width).toBe(256);
    expect(metadata.height).toBe(256);
    expect(firstHeight).toBeGreaterThanOrEqual(145);
    expect(firstHeight).toBeLessThanOrEqual(175);
    expect(maxHeight).toBeGreaterThanOrEqual(150);

    await app.close();
  });

  it("keeps jump idle normalization inside the frame canvas when action frames grow", async () => {
    const storageDir = makeStorageDir();
    const ffmpegPath = resolveDefaultFfmpegPath();
    const app = createApp({
      ffmpegPath,
      port: 8787,
      storageDir
    });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { name: "hero" }
    });
    await writeTallIdleTransparentReferences(storageDir, "hero");

    const videoDir = join(storageDir, "characters", "hero", "advanced-character", "jump", "video");
    mkdirSync(videoDir, { recursive: true });
    await createTestFourDirectionGrowingActionVideo(ffmpegPath, join(videoDir, "source.mp4"));

    const response = await app.inject({
      method: "POST",
      url: "/api/processing/advanced-action",
      payload: {
        jobId: "jump_video_growth_job",
        characterId: "hero",
        actionKind: "jump",
        mode: "oneshot",
        frameCount: 6,
        keyColor: "#00ff00",
        tolerance: 8,
        minLoopFrames: 2,
        maxLoopFrames: 12,
        exportFrameSize: 256,
        fps: 12
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().directions).toHaveLength(4);
    for (const direction of response.json().directions) {
      expect(direction.transparentFrames.length).toBeGreaterThan(0);
    }
    expect(existsSync(join(storageDir, "characters", "hero", "advanced-character", "jump", "export", "exports", "transparent-frames.zip"))).toBe(true);

    await app.close();
  });

  it("normalizes loop advanced actions to the first walk frame profile", async () => {
    const storageDir = makeStorageDir();
    const ffmpegPath = resolveDefaultFfmpegPath();
    const app = createApp({
      ffmpegPath,
      port: 8787,
      storageDir
    });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { name: "hero" }
    });
    await writeWalkTransparentReferences(storageDir, "hero");

    const videoDir = join(storageDir, "characters", "hero", "advanced-character", "run", "video");
    mkdirSync(videoDir, { recursive: true });
    await createTestFourDirectionGrowingActionVideo(ffmpegPath, join(videoDir, "source.mp4"));

    const response = await app.inject({
      method: "POST",
      url: "/api/processing/advanced-action",
      payload: {
        jobId: "run_video_profile_job",
        characterId: "hero",
        actionKind: "run",
        mode: "loop",
        frameCount: 6,
        keyColor: "#00ff00",
        tolerance: 8,
        minLoopFrames: 2,
        maxLoopFrames: 6,
        exportFrameSize: 256,
        fps: 12
      }
    });

    expect(response.statusCode).toBe(200);
    for (const direction of ["down", "up", "left", "right"]) {
      const transparentDir = join(storageDir, "characters", "hero", "advanced-character", "run", "export", "transparent", direction);
      const firstFile = readdirSync(transparentDir)
        .filter((fileName) => fileName.endsWith(".png"))
        .sort()[0];
      expect(firstFile).toBeDefined();
      const box = await getAlphaBox(readFileSync(join(transparentDir, firstFile ?? "")));
      expect(box?.height).toBeGreaterThanOrEqual(150);
      expect(box?.height).toBeLessThanOrEqual(170);
    }

    await app.close();
  });

  it("exports one-shot actions at the requested square frame size", async () => {
    const storageDir = makeStorageDir();
    const ffmpegPath = resolveDefaultFfmpegPath();
    const app = createApp({
      ffmpegPath,
      port: 8787,
      storageDir
    });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { name: "hero" }
    });
    await writeTallIdleTransparentReferences(storageDir, "hero");

    const videoDir = join(storageDir, "characters", "hero", "advanced-character", "attack-1", "video");
    mkdirSync(videoDir, { recursive: true });
    await createTestFourDirectionGrowingActionVideo(ffmpegPath, join(videoDir, "source.mp4"));

    const response = await app.inject({
      method: "POST",
      url: "/api/processing/advanced-action",
      payload: {
        jobId: "attack_video_auto_size_job",
        characterId: "hero",
        actionKind: "attack-1",
        mode: "oneshot",
        frameCount: 6,
        keyColor: "#00ff00",
        tolerance: 8,
        minLoopFrames: 2,
        maxLoopFrames: 12,
        exportFrameSize: 512,
        fps: 12
      }
    });

    expect(response.statusCode).toBe(200);
    const outputFramePath = join(
      storageDir,
      "characters",
      "hero",
      "advanced-character",
      "attack-1",
      "export",
      "transparent",
      "down",
      "frame_004.png"
    );
    const metadata = await sharp(outputFramePath).metadata();
    expect(metadata.width).toBe(512);
    expect(metadata.height).toBe(512);
    const alphaBox = await getAlphaBox(readFileSync(outputFramePath));
    const firstFrameBox = await getAlphaBox(readFileSync(join(
      storageDir,
      "characters",
      "hero",
      "advanced-character",
      "attack-1",
      "export",
      "transparent",
      "down",
      "frame_001.png"
    )));
    expect(firstFrameBox?.height).toBeGreaterThanOrEqual(440);
    expect(firstFrameBox?.height).toBeLessThanOrEqual(480);
    expect(alphaBox?.height).toBeLessThanOrEqual(metadata.height ?? 0);

    await app.close();
  });

  it("rejects frame processing when the saved source video is missing", async () => {
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      storageDir: makeStorageDir()
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/processing/frames",
      payload: {
        jobId: "missing_job",
        frameCount: 12,
        keyColor: "#00ff00",
        tolerance: 8
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toContain("source.mp4");

    await app.close();
  });
});

async function createTestIdleSheet(options: {
  background?: { r: number; g: number; b: number; alpha: number };
  detachedArtifact?: { left: number; top: number; width: number; height: number; color: { r: number; g: number; b: number; alpha: number } };
  downAccent?: { left: number; top: number; width: number; height: number; color: { r: number; g: number; b: number; alpha: number } };
} = {}): Promise<Buffer> {
  const cellSize = 64;
  const background = options.background ?? { r: 0, g: 255, b: 0, alpha: 1 };
  const blocks = [
    { left: 18, top: 14, width: 28, height: 34, color: { r: 255, g: 0, b: 0, alpha: 1 } },
    { left: 82, top: 14, width: 28, height: 34, color: { r: 0, g: 0, b: 255, alpha: 1 } },
    { left: 18, top: 78, width: 28, height: 34, color: { r: 255, g: 255, b: 0, alpha: 1 } },
    { left: 82, top: 78, width: 28, height: 34, color: { r: 0, g: 0, b: 0, alpha: 1 } }
  ];
  if (options.detachedArtifact) {
    blocks.push(options.detachedArtifact);
  }
  if (options.downAccent) {
    blocks.push(options.downAccent);
  }
  const characterBlocks = await Promise.all(blocks.map(async (block) => ({
    input: await sharp({
      create: {
        width: block.width,
        height: block.height,
        channels: 4,
        background: block.color
      }
    }).png().toBuffer(),
    left: block.left,
    top: block.top
  })));

  return sharp({
    create: {
      width: cellSize * 2,
      height: cellSize * 2,
      channels: 4,
      background
    }
  })
    .composite(characterBlocks)
    .png()
    .toBuffer();
}

async function createTestFourDirectionVideo(ffmpegPath: string, outputPath: string): Promise<void> {
  const imagePath = join(mkdtempSync(join(tmpdir(), "ai-game-workbench-video-frame-")), "frame.png");
  tempDirs.push(imagePath.replace(/\\frame\.png$/, ""));
  writeFileSync(imagePath, await createTestIdleSheet());
  await runFfmpeg(ffmpegPath, [
    "-loop", "1",
    "-t", "0.25",
    "-i", imagePath,
    "-vf", "format=yuv420p",
    "-movflags", "+faststart",
    outputPath
  ]);
}

async function createTestUnevenFourDirectionVideo(ffmpegPath: string, outputPath: string): Promise<void> {
  const frameDir = mkdtempSync(join(tmpdir(), "ai-game-workbench-uneven-walk-video-"));
  tempDirs.push(frameDir);
  for (let frameIndex = 1; frameIndex <= 4; frameIndex += 1) {
    writeFileSync(
      join(frameDir, `frame_${String(frameIndex).padStart(3, "0")}.png`),
      await createTestUnevenFourDirectionSheetFrame()
    );
  }
  await runFfmpeg(ffmpegPath, [
    "-y",
    "-framerate", "12",
    "-i", join(frameDir, "frame_%03d.png"),
    "-vf", "format=yuv420p",
    "-movflags", "+faststart",
    outputPath
  ]);
}

async function createTestUnevenFourDirectionSheetFrame(): Promise<Buffer> {
  const cellSize = 64;
  const blocks = [
    { left: 26, top: 12, width: 12, height: 40, color: { r: 255, g: 0, b: 0, alpha: 1 } },
    { left: 90, top: 22, width: 12, height: 20, color: { r: 0, g: 0, b: 255, alpha: 1 } },
    { left: 26, top: 81, width: 12, height: 30, color: { r: 255, g: 255, b: 0, alpha: 1 } },
    { left: 90, top: 84, width: 12, height: 24, color: { r: 0, g: 0, b: 0, alpha: 1 } }
  ];

  return sharp({
    create: {
      width: cellSize * 2,
      height: cellSize * 2,
      channels: 4,
      background: { r: 0, g: 255, b: 0, alpha: 1 }
    }
  })
    .composite(await Promise.all(blocks.map(async (block) => ({
      input: await sharp({
        create: {
          width: block.width,
          height: block.height,
          channels: 4,
          background: block.color
        }
      }).png().toBuffer(),
      left: block.left,
      top: block.top
    }))))
    .png()
    .toBuffer();
}

async function createTestFourDirectionActionVideo(ffmpegPath: string, outputPath: string): Promise<void> {
  const frameDir = mkdtempSync(join(tmpdir(), "ai-game-workbench-action-video-"));
  tempDirs.push(frameDir);
  for (let frameIndex = 1; frameIndex <= 20; frameIndex += 1) {
    const primaryOffset = frameIndex >= 4 && frameIndex <= 8
      ? -12 + Math.abs(6 - ((frameIndex - 1) % 10)) * 2
      : 0;
    const repeatedLeftOffset = frameIndex >= 11 && frameIndex <= 15
      ? -12 + Math.abs(6 - ((frameIndex - 1) % 10)) * 2
      : 0;
    writeFileSync(
      join(frameDir, `frame_${String(frameIndex).padStart(3, "0")}.png`),
      await createTestActionSheetFrame({
        down: primaryOffset,
        up: primaryOffset,
        left: primaryOffset || repeatedLeftOffset,
        right: primaryOffset
      })
    );
  }
  await runFfmpeg(ffmpegPath, [
    "-y",
    "-framerate", "20",
    "-i", join(frameDir, "frame_%03d.png"),
    "-vf", "format=yuv420p",
    "-movflags", "+faststart",
    outputPath
  ]);
}

async function createTestFourDirectionAttackSettlesVideo(ffmpegPath: string, outputPath: string): Promise<void> {
  const frameDir = mkdtempSync(join(tmpdir(), "ai-game-workbench-attack-settle-video-"));
  tempDirs.push(frameDir);
  const reaches = [
    0, 0, 0,
    5, 10, 15, 20,
    20, 20, 20,
    0, 0, 0,
    5, 10, 15, 20,
    20, 20, 20
  ];
  for (let frameIndex = 1; frameIndex <= reaches.length; frameIndex += 1) {
    const reach = reaches[frameIndex - 1] ?? 0;
    writeFileSync(
      join(frameDir, `frame_${String(frameIndex).padStart(3, "0")}.png`),
      await createTestAttackSettlesSheetFrame(reach)
    );
  }
  await runFfmpeg(ffmpegPath, [
    "-y",
    "-framerate", "20",
    "-i", join(frameDir, "frame_%03d.png"),
    "-vf", "format=yuv420p",
    "-movflags", "+faststart",
    outputPath
  ]);
}

async function createTestFourDirectionGrowingActionVideo(ffmpegPath: string, outputPath: string): Promise<void> {
  const frameDir = mkdtempSync(join(tmpdir(), "ai-game-workbench-growing-action-video-"));
  tempDirs.push(frameDir);
  const heights = [10, 10, 30, 55, 55, 55];
  for (let frameIndex = 1; frameIndex <= heights.length; frameIndex += 1) {
    writeFileSync(
      join(frameDir, `frame_${String(frameIndex).padStart(3, "0")}.png`),
      await createTestGrowingActionSheetFrame(heights[frameIndex - 1] ?? 10)
    );
  }
  await runFfmpeg(ffmpegPath, [
    "-y",
    "-framerate", "12",
    "-i", join(frameDir, "frame_%03d.png"),
    "-vf", "format=yuv420p",
    "-movflags", "+faststart",
    outputPath
  ]);
}

async function createTestGrowingActionSheetFrame(subjectHeight: number): Promise<Buffer> {
  const cellSize = 64;
  const blocks = [
    { left: 26, top: Math.round((cellSize - subjectHeight) / 2), color: { r: 255, g: 0, b: 0, alpha: 1 } },
    { left: 90, top: Math.round((cellSize - subjectHeight) / 2), color: { r: 0, g: 0, b: 255, alpha: 1 } },
    { left: 26, top: cellSize + Math.round((cellSize - subjectHeight) / 2), color: { r: 255, g: 255, b: 0, alpha: 1 } },
    { left: 90, top: cellSize + Math.round((cellSize - subjectHeight) / 2), color: { r: 0, g: 0, b: 0, alpha: 1 } }
  ];
  return sharp({
    create: {
      width: cellSize * 2,
      height: cellSize * 2,
      channels: 4,
      background: { r: 0, g: 255, b: 0, alpha: 1 }
    }
  })
    .composite(await Promise.all(blocks.map(async (block) => ({
      input: await sharp({
        create: {
          width: 12,
          height: subjectHeight,
          channels: 4,
          background: block.color
        }
      }).png().toBuffer(),
      left: block.left,
      top: block.top
    }))))
    .png()
    .toBuffer();
}

async function createTestAttackSettlesSheetFrame(reach: number): Promise<Buffer> {
  const cellSize = 64;
  const blocks = [
    { left: 27, top: 24, width: 10, height: 24, color: { r: 255, g: 0, b: 0, alpha: 1 } },
    { left: 91, top: 24, width: 10, height: 24, color: { r: 0, g: 0, b: 255, alpha: 1 } },
    { left: 27, top: 88, width: 10, height: 24, color: { r: 255, g: 255, b: 0, alpha: 1 } },
    { left: 91, top: 88, width: 10, height: 24, color: { r: 0, g: 0, b: 0, alpha: 1 } }
  ];
  const weapons = [
    { left: 37, top: 32, width: reach, height: 4, color: { r: 255, g: 0, b: 0, alpha: 1 } },
    { left: 101, top: 32, width: reach, height: 4, color: { r: 0, g: 0, b: 255, alpha: 1 } },
    { left: Math.max(0, 27 - reach), top: 96, width: reach, height: 4, color: { r: 255, g: 255, b: 0, alpha: 1 } },
    { left: 101, top: 96, width: reach, height: 4, color: { r: 0, g: 0, b: 0, alpha: 1 } }
  ].filter((block) => block.width > 0);
  return sharp({
    create: {
      width: cellSize * 2,
      height: cellSize * 2,
      channels: 4,
      background: { r: 0, g: 255, b: 0, alpha: 1 }
    }
  })
    .composite(await Promise.all([...blocks, ...weapons].map(async (block) => ({
      input: await sharp({
        create: {
          width: block.width,
          height: block.height,
          channels: 4,
          background: block.color
        }
      }).png().toBuffer(),
      left: block.left,
      top: block.top
    }))))
    .png()
    .toBuffer();
}

async function createTestFourDirectionJumpVideo(ffmpegPath: string, outputPath: string): Promise<void> {
  const frameDir = mkdtempSync(join(tmpdir(), "ai-game-workbench-jump-video-"));
  tempDirs.push(frameDir);
  const jumpStates = [
    "idle", "idle", "idle",
    "crouch", "crouch", "crouch",
    "air", "air", "air",
    "land", "land",
    "idle", "idle", "idle",
    "crouch", "crouch", "air", "air", "land", "idle"
  ] as const;
  for (let frameIndex = 1; frameIndex <= jumpStates.length; frameIndex += 1) {
    writeFileSync(
      join(frameDir, `frame_${String(frameIndex).padStart(3, "0")}.png`),
      await createTestJumpSheetFrame(jumpStates[frameIndex - 1] ?? "idle")
    );
  }
  await runFfmpeg(ffmpegPath, [
    "-y",
    "-framerate", "20",
    "-i", join(frameDir, "frame_%03d.png"),
    "-vf", "format=yuv420p",
    "-movflags", "+faststart",
    outputPath
  ]);
}

async function createTestActionSheetFrame(actionOffsetY: Record<"down" | "up" | "left" | "right", number>): Promise<Buffer> {
  const cellSize = 64;
  const blocks = [
    { left: 27, top: 24 + actionOffsetY.down, width: 10, height: 24, color: { r: 255, g: 0, b: 0, alpha: 1 } },
    { left: 91, top: 24 + actionOffsetY.up, width: 10, height: 24, color: { r: 0, g: 0, b: 255, alpha: 1 } },
    { left: 27, top: 88 + actionOffsetY.left, width: 10, height: 24, color: { r: 255, g: 255, b: 0, alpha: 1 } },
    { left: 91, top: 88 + actionOffsetY.right, width: 10, height: 24, color: { r: 0, g: 0, b: 0, alpha: 1 } }
  ];
  return sharp({
    create: {
      width: cellSize * 2,
      height: cellSize * 2,
      channels: 4,
      background: { r: 0, g: 255, b: 0, alpha: 1 }
    }
  })
    .composite(await Promise.all(blocks.map(async (block) => ({
      input: await sharp({
        create: {
          width: block.width,
          height: block.height,
          channels: 4,
          background: block.color
        }
      }).png().toBuffer(),
      left: block.left,
      top: block.top
    }))))
    .png()
    .toBuffer();
}

async function createTestJumpSheetFrame(state: "idle" | "crouch" | "air" | "land"): Promise<Buffer> {
  const cellSize = 64;
  const body = {
    idle: { topOffset: 0, height: 24 },
    crouch: { topOffset: 6, height: 18 },
    air: { topOffset: -12, height: 24 },
    land: { topOffset: 6, height: 18 }
  }[state];
  const blocks = [
    { left: 27, top: 24 + body.topOffset, width: 10, height: body.height, color: { r: 255, g: 0, b: 0, alpha: 1 } },
    { left: 91, top: 24 + body.topOffset, width: 10, height: body.height, color: { r: 0, g: 0, b: 255, alpha: 1 } },
    { left: 27, top: 88 + body.topOffset, width: 10, height: body.height, color: { r: 255, g: 255, b: 0, alpha: 1 } },
    { left: 91, top: 88 + body.topOffset, width: 10, height: body.height, color: { r: 0, g: 0, b: 0, alpha: 1 } }
  ];
  return sharp({
    create: {
      width: cellSize * 2,
      height: cellSize * 2,
      channels: 4,
      background: { r: 0, g: 255, b: 0, alpha: 1 }
    }
  })
    .composite(await Promise.all(blocks.map(async (block) => ({
      input: await sharp({
        create: {
          width: block.width,
          height: block.height,
          channels: 4,
          background: block.color
        }
      }).png().toBuffer(),
      left: block.left,
      top: block.top
    }))))
    .png()
    .toBuffer();
}

async function writeTestIdleTransparentReferences(storageDir: string, characterId: string): Promise<void> {
  const directionDir = join(storageDir, "characters", characterId, "base-character", "loop-export", "idle", "transparent");
  mkdirSync(directionDir, { recursive: true });
  for (const direction of ["down", "up", "left", "right"]) {
    writeFileSync(join(directionDir, `${direction}.png`), await createTransparentReferenceFrame());
  }
}

async function writeTallIdleTransparentReferences(storageDir: string, characterId: string): Promise<void> {
  const directionDir = join(storageDir, "characters", characterId, "base-character", "loop-export", "idle", "transparent");
  mkdirSync(directionDir, { recursive: true });
  for (const direction of ["down", "up", "left", "right"]) {
    writeFileSync(join(directionDir, `${direction}.png`), await createTransparentReferenceFrame({ subjectHeight: 230 }));
  }
}

async function writeWalkTransparentReferences(storageDir: string, characterId: string): Promise<void> {
  const directions = ["down", "up", "left", "right"];
  for (const direction of directions) {
    const directionDir = join(storageDir, "characters", characterId, "base-character", "loop-export", "transparent", direction);
    mkdirSync(directionDir, { recursive: true });
    writeFileSync(join(directionDir, "frame_001.png"), await createTransparentReferenceFrame());
  }
}

async function writeUnevenWalkTransparentReferences(storageDir: string, characterId: string): Promise<void> {
  const heights = {
    down: 160,
    up: 80,
    left: 120,
    right: 100
  };
  for (const [direction, subjectHeight] of Object.entries(heights)) {
    const directionDir = join(storageDir, "characters", characterId, "base-character", "loop-export", "transparent", direction);
    mkdirSync(directionDir, { recursive: true });
    writeFileSync(join(directionDir, "frame_001.png"), await createTransparentReferenceFrame({ subjectHeight }));
  }
}

async function createTransparentReferenceFrame(options: { subjectHeight?: number } = {}): Promise<Buffer> {
  const subjectHeight = options.subjectHeight ?? 160;
  const subject = await sharp({
    create: {
      width: 80,
      height: subjectHeight,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 }
    }
  }).png().toBuffer();
  return sharp({
    create: {
      width: 256,
      height: 256,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: subject, left: 88, top: Math.round((256 - subjectHeight) / 2) }])
    .png()
    .toBuffer();
}

async function getAlphaBox(buffer: Buffer): Promise<{ width: number; height: number } | null> {
  const image = sharp(buffer).ensureAlpha();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    return null;
  }
  const raw = await image.raw().toBuffer();
  let left = metadata.width;
  let top = metadata.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < metadata.height; y += 1) {
    for (let x = 0; x < metadata.width; x += 1) {
      const alpha = raw[((y * metadata.width) + x) * 4 + 3] ?? 0;
      if (alpha === 0) {
        continue;
      }
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right >= left && bottom >= top
    ? { width: right - left + 1, height: bottom - top + 1 }
    : null;
}

function findNonGreenBox(
  raw: Buffer,
  width: number,
  _height: number,
  region: { left: number; top: number; width: number; height: number },
  background: { r: number; g: number; b: number } = { r: 0, g: 255, b: 0 }
): { centerX: number; centerY: number } {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = -1;
  let bottom = -1;
  for (let y = region.top; y < region.top + region.height; y += 1) {
    for (let x = region.left; x < region.left + region.width; x += 1) {
      const offset = ((y * width) + x) * 4;
      const red = raw[offset] ?? 0;
      const green = raw[offset + 1] ?? 0;
      const blue = raw[offset + 2] ?? 0;
      if (red === background.r && green === background.g && blue === background.b) {
        continue;
      }
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return {
    centerX: Math.round((left + right) / 2),
    centerY: Math.round((top + bottom) / 2)
  };
}
