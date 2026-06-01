import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import {
  alignIdleFourDirectionSheetToWalkBuffers,
  applyColorKeyToBuffer,
  applySampledBackgroundKeyToBuffer,
  buildFourDirectionContactSheetFromBuffers,
  buildFourDirectionSpriteSheetFromBuffers,
  buildSpriteSheetFromBuffers,
  centerFrameSequenceBuffers,
  createCharacterFrameProfileFromBuffer,
  createFrameSignatureBuffer,
  findBestLoopSegment,
  normalizeFourDirectionFrameSequencesToProfile,
  removeDetachedAlphaArtifacts,
  resizeNearestBuffer,
  splitFourDirectionFrameBuffer
} from "../processing/imageProcessing";
import type { CharacterFrameProfile, FourDirectionKey, LoopSegment } from "../processing/imageProcessing";
import {
  extractFramesWithFfmpeg,
  probeVideoDurationSeconds,
  runFfmpeg
} from "../processing/ffmpeg";
import type { AppConfig } from "../config";
import {
  ensureCharacterFolder,
  resetCharacterDirectory,
  resolveCharacterPath,
  toCharacterUrl
} from "../characterStorage";

type ProcessingRouteConfig = Pick<AppConfig, "storageDir" | "ffmpegPath">;
type AdvancedActionKind = "run" | "attack-1" | "jump";
type AdvancedActionMode = "loop" | "oneshot";
type PreparedTransparentFrame = {
  frame: { index: number; url: string; path: string };
  fileName: string;
  loopPath: string;
  transparentPath: string;
  centered: Buffer;
  transparent: Buffer;
};

export function registerProcessingRoutes(app: FastifyInstance, config: ProcessingRouteConfig): void {
  app.get("/api/processing/capabilities", async () => ({
    colorKey: true,
    resizeNearest: true,
    spriteSheet: true,
    formats: ["png", "gif"]
  }));

  app.decorate("spriteProcessing", {
    applyColorKeyToBuffer,
    resizeNearestBuffer,
    buildSpriteSheetFromBuffers
  });

  app.post("/api/processing/frames", async (request, reply) => {
    const input = request.body as {
      jobId?: string;
      frameCount?: number;
      keyColor?: string;
      tolerance?: number;
    };
    const jobId = input.jobId?.trim();
    if (!jobId || !/^[a-zA-Z0-9_-]+$/.test(jobId)) {
      return reply.code(400).send({ error: "有效的视频任务 ID 是必填项。" });
    }
    const frameCount = clampFrameCount(input.frameCount);
    const keyColor = input.keyColor ?? "#00ff00";
    const tolerance = clampTolerance(input.tolerance);
    const jobDir = join(config.storageDir, "jobs", jobId);
    const sourcePath = join(jobDir, "source.mp4");
    if (!existsSync(sourcePath)) {
      return reply.code(404).send({ error: `缺少视频源文件：storage/jobs/${jobId}/source.mp4` });
    }

    const rawDir = join(jobDir, "frames", "raw");
    const transparentDir = join(jobDir, "frames", "transparent");
    await rm(rawDir, { recursive: true, force: true });
    await rm(transparentDir, { recursive: true, force: true });
    await mkdir(rawDir, { recursive: true });
    await mkdir(transparentDir, { recursive: true });

    const durationSeconds = await probeVideoDurationSeconds(config.ffmpegPath, sourcePath);
    await extractFramesWithFfmpeg(config.ffmpegPath, {
      inputPath: sourcePath,
      outputPattern: join(rawDir, "frame_%03d.png"),
      frameCount,
      durationSeconds
    });

    const rawFrames = (await readdir(rawDir))
      .filter((fileName) => fileName.toLowerCase().endsWith(".png"))
      .sort()
      .slice(0, frameCount);
    const frames = [];
    for (const [index, fileName] of rawFrames.entries()) {
      const frameNumber = index + 1;
      const outputName = `frame_${String(frameNumber).padStart(3, "0")}.png`;
      const keyed = await applyColorKeyToBuffer(await readFile(join(rawDir, fileName)), keyColor, tolerance);
      await writeFile(join(transparentDir, outputName), keyed);
      frames.push({
        index: frameNumber,
        url: `/jobs/${jobId}/frames/transparent/${outputName}`
      });
    }

    return {
      jobId,
      frameCount: frames.length,
      frames
    };
  });

  app.post("/api/processing/four-direction", async (request, reply) => {
    const input = request.body as {
      jobId?: string;
      frameCount?: number;
      keyColor?: string;
      tolerance?: number;
      minLoopFrames?: number;
      maxLoopFrames?: number;
      exportFrameSize?: number;
      fps?: number;
      characterId?: string;
    };
    const jobId = input.jobId?.trim();
    if (!jobId || !/^[a-zA-Z0-9_-]+$/.test(jobId)) {
      return reply.code(400).send({ error: "有效的视频任务 ID 是必填项。" });
    }
    const characterId = input.characterId?.trim();
    if (!characterId) {
      return reply.code(400).send({ error: "请先创建或选择角色文件夹。" });
    }
    try {
      await ensureCharacterFolder(config.storageDir, characterId);
    } catch (error: unknown) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "请先创建或选择角色文件夹。" });
    }
    const frameCount = clampFrameCount(input.frameCount, 120);
    const keyColor = input.keyColor ?? "#00ff00";
    const tolerance = clampTolerance(input.tolerance);
    const minLoopFrames = clampLoopFrameCount(input.minLoopFrames, 12);
    const maxLoopFrames = Math.max(minLoopFrames, clampLoopFrameCount(input.maxLoopFrames, 60));
    const fps = clampFps(input.fps);
    const sourcePath = resolveCharacterPath(config.storageDir, characterId, "base-character", "walk-video", "source.mp4");
    if (!existsSync(sourcePath)) {
      return reply.code(404).send({ error: `缺少视频源文件：storage/characters/${characterId}/base-character/walk-video/source.mp4` });
    }

    const baseDir = await resetCharacterDirectory(config.storageDir, characterId, "base-character", "loop-export");
    const rawDir = join(baseDir, "raw");
    const centeredDir = join(baseDir, "centered");
    const loopDir = join(baseDir, "loop");
    const transparentDir = join(baseDir, "transparent");
    const exportDir = join(baseDir, "exports");
    await rm(baseDir, { recursive: true, force: true });
    await mkdir(rawDir, { recursive: true });
    await mkdir(centeredDir, { recursive: true });
    await mkdir(loopDir, { recursive: true });
    await mkdir(transparentDir, { recursive: true });
    await mkdir(exportDir, { recursive: true });

    const durationSeconds = await probeVideoDurationSeconds(config.ffmpegPath, sourcePath);
    await extractFramesWithFfmpeg(config.ffmpegPath, {
      inputPath: sourcePath,
      outputPattern: join(rawDir, "frame_%03d.png"),
      frameCount,
      durationSeconds
    });

    const rawFileNames = (await readdir(rawDir))
      .filter((fileName) => fileName.toLowerCase().endsWith(".png"))
      .sort()
      .slice(0, frameCount);
    const rawFrames = rawFileNames.map((fileName, index) => ({
      index: index + 1,
      url: toCharacterUrl(characterId, "base-character", "loop-export", "raw", fileName)
    }));

    const directionKeys: readonly FourDirectionKey[] = ["down", "up", "left", "right"];
    const directionLabels = {
      down: "下方向",
      up: "上方向",
      left: "左方向",
      right: "右方向"
    } satisfies Record<FourDirectionKey, string>;
    const centeredFrames: Record<FourDirectionKey, { index: number; url: string; path: string }[]> = {
      down: [],
      up: [],
      left: [],
      right: []
    };
    const splitFrames: Record<FourDirectionKey, { index: number; buffer: Buffer }[]> = {
      down: [],
      up: [],
      left: [],
      right: []
    };

    for (const [index, fileName] of rawFileNames.entries()) {
      const frameNumber = index + 1;
      const sourceBuffer = await readFile(join(rawDir, fileName));
      const split = await splitFourDirectionFrameBuffer(sourceBuffer, {
        bleedMargin: await inferFourDirectionBleedMargin(sourceBuffer),
        keyColor,
        tolerance
      });
      for (const direction of directionKeys) {
        splitFrames[direction].push({
          index: frameNumber,
          buffer: split[direction]
        });
      }
    }

    for (const direction of directionKeys) {
      const directionDir = join(centeredDir, direction);
      await mkdir(directionDir, { recursive: true });
      const centeredBuffers = await centerFrameSequenceBuffers(
        splitFrames[direction].map((frame) => frame.buffer),
        keyColor,
        tolerance
      );
      for (const [index, centered] of centeredBuffers.entries()) {
        const frameNumber = splitFrames[direction][index]?.index ?? index + 1;
        const outputName = `frame_${String(frameNumber).padStart(3, "0")}.png`;
        const outputPath = join(directionDir, outputName);
        await writeFile(outputPath, centered);
        centeredFrames[direction].push({
          index: frameNumber,
          path: outputPath,
          url: toCharacterUrl(characterId, "base-character", "loop-export", "centered", direction, outputName)
        });
      }
    }

    const directions: {
      key: FourDirectionKey;
      label: string;
      centeredFrames: { index: number; url: string }[];
      loopFrames: { index: number; url: string }[];
      transparentFrames: { index: number; url: string }[];
      loop: LoopSegment;
    }[] = [];
    const transparentBuffersByDirection = createEmptyDirectionBuffers();
    const transparentZipEntries: Record<string, Buffer> = {};
    const preparedFramesByDirection: Record<FourDirectionKey, PreparedTransparentFrame[]> = {
      down: [],
      up: [],
      left: [],
      right: []
    };
    const exportSize = clampExportFrameSize(input.exportFrameSize);
    for (const direction of directionKeys) {
      const signatures = [];
      for (const frame of centeredFrames[direction]) {
        const sampled = await applySampledBackgroundKeyToBuffer(await readFile(frame.path), { tolerance });
        signatures.push(await createFrameSignatureBuffer(sampled));
      }
      const loop = findBestLoopSegment(signatures, { minLoopFrames, maxLoopFrames });
      const loopFrames = centeredFrames[direction].slice(
        Math.max(0, loop.startFrame - 1),
        Math.max(0, loop.endFrame)
      );
      const loopRecords = [];
      const transparentRecords = [];
      await mkdir(join(loopDir, direction), { recursive: true });
      await mkdir(join(transparentDir, direction), { recursive: true });
      for (const frame of loopFrames) {
        const fileName = `frame_${String(frame.index).padStart(3, "0")}.png`;
        const loopPath = join(loopDir, direction, fileName);
        const transparentPath = join(transparentDir, direction, fileName);
        const centered = await readFile(frame.path);
        const keyed = await applySampledBackgroundKeyToBuffer(centered, { tolerance });
        const transparent = exportSize ? await resizeNearestBuffer(keyed, exportSize) : keyed;
        preparedFramesByDirection[direction].push({ frame, fileName, loopPath, transparentPath, centered, transparent });
        loopRecords.push({
          index: frame.index,
          url: toCharacterUrl(characterId, "base-character", "loop-export", "loop", direction, fileName)
        });
        transparentRecords.push({
          index: frame.index,
          url: toCharacterUrl(characterId, "base-character", "loop-export", "transparent", direction, fileName)
        });
      }
      directions.push({
        key: direction,
        label: directionLabels[direction],
        centeredFrames: centeredFrames[direction].map(({ index, url }) => ({ index, url })),
        loopFrames: loopRecords,
        transparentFrames: transparentRecords,
        loop
      });
    }

    const preparedBuffersByDirection = {
      down: preparedFramesByDirection.down.map((frame) => frame.transparent),
      up: preparedFramesByDirection.up.map((frame) => frame.transparent),
      left: preparedFramesByDirection.left.map((frame) => frame.transparent),
      right: preparedFramesByDirection.right.map((frame) => frame.transparent)
    };
    const profileSource = preparedFramesByDirection.down[0]?.transparent
      ?? firstAvailableDirectionBuffer(preparedBuffersByDirection, directionKeys);
    const profile = profileSource ? await createCharacterFrameProfileFromBuffer(profileSource) : null;
    const normalizedTransparentBuffers = await normalizeFourDirectionFrameSequencesToProfile(preparedBuffersByDirection, profile);
    for (const direction of directionKeys) {
      for (const [index, prepared] of preparedFramesByDirection[direction].entries()) {
        const transparent = normalizedTransparentBuffers[direction][index] ?? prepared.transparent;
        await writeFile(prepared.loopPath, prepared.centered);
        await writeFile(prepared.transparentPath, transparent);
        transparentBuffersByDirection[direction].push(transparent);
        transparentZipEntries[`${direction}/${prepared.fileName}`] = transparent;
      }
    }

    const spriteSize = await inferFrameSize(transparentBuffersByDirection.down[0]);
    const spriteSheet = await buildFourDirectionSpriteSheetFromBuffers(transparentBuffersByDirection, {
      frameWidth: spriteSize.width,
      frameHeight: spriteSize.height
    });
    const spriteSheetPath = join(exportDir, "sprite-sheet.png");
    await writeFile(spriteSheetPath, spriteSheet);

    const zipPath = join(exportDir, "transparent-frames.zip");
    await writeZipFile(zipPath, transparentZipEntries);

    const gifPreviewUrl = await tryBuildPreviewGif(config.ffmpegPath, {
      exportDir,
      fps,
      jobId,
      characterId,
      directionKeys,
      transparentBuffersByDirection,
      frameWidth: spriteSize.width,
      frameHeight: spriteSize.height
    });

    return {
      jobId,
      frameCount: rawFrames.length,
      rawFrames,
      directions,
      spriteSheetUrl: toCharacterUrl(characterId, "base-character", "loop-export", "exports", "sprite-sheet.png"),
      transparentZipUrl: toCharacterUrl(characterId, "base-character", "loop-export", "exports", "transparent-frames.zip"),
      gifPreviewUrl
    };
  });

  app.post("/api/processing/idle-four-direction", async (request, reply) => {
    const input = request.body as {
      characterId?: string;
      keyColor?: string;
      tolerance?: number;
    };
    const characterId = input.characterId?.trim();
    if (!characterId) {
      return reply.code(400).send({ error: "请先创建或选择角色文件夹。" });
    }
    try {
      await ensureCharacterFolder(config.storageDir, characterId);
    } catch (error: unknown) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "请先创建或选择角色文件夹。" });
    }

    const keyColor = input.keyColor ?? "#00ff00";
    const tolerance = clampTolerance(input.tolerance);
    const baseDir = resolveCharacterPath(config.storageDir, characterId, "base-character", "loop-export");
    const directionKeys: readonly FourDirectionKey[] = ["down", "up", "left", "right"];
    const directionLabels = {
      down: "下方向",
      up: "上方向",
      left: "左方向",
      right: "右方向"
    } satisfies Record<FourDirectionKey, string>;

    const idleTemplatePath = resolveCharacterPath(config.storageDir, characterId, "base-character", "direction-templates", "idle-4dir.png");
    if (!existsSync(idleTemplatePath)) {
      return reply.code(404).send({ error: `缺少待机四方向图：storage/characters/${characterId}/base-character/direction-templates/idle-4dir.png` });
    }

    const transparentBuffersByDirection = await readWalkTransparentBuffers(baseDir, directionKeys);
    if (!transparentBuffersByDirection) {
      return reply.code(404).send({ error: `缺少步行循环处理结果：storage/characters/${characterId}/base-character/loop-export/transparent` });
    }
    const walkReference = transparentBuffersByDirection.down[0];
    if (!walkReference) {
      return reply.code(404).send({ error: `缂哄皯姝ヨ寰幆澶勭悊缁撴灉锛歴torage/characters/${characterId}/base-character/loop-export/transparent/down` });
    }
    const spriteSize = await inferFrameSize(walkReference);
    const profile = await createCharacterFrameProfileFromBuffer(walkReference);
    const idleResult = await buildIdleDirectionExport({
      baseDir,
      characterId,
      config,
      directionKeys,
      directionLabels,
      keyColor,
      tolerance,
      spriteSize,
      profile,
      transparentBuffersByDirection
    });

    return idleResult;
  });

  app.post("/api/processing/advanced-action/start-frame", async (request, reply) => {
    const input = request.body as {
      characterId?: string;
      actionKind?: string;
      keyColor?: string;
      scale?: number;
      tolerance?: number;
    };
    const characterId = input.characterId?.trim();
    if (!characterId) {
      return reply.code(400).send({ error: "请先创建或选择角色文件夹。" });
    }
    const actionKind = normalizeAdvancedActionKind(input.actionKind);
    if (!actionKind || actionKind === "run") {
      return reply.code(400).send({ error: "actionKind must be attack-1 or jump" });
    }
    const keyColor = input.keyColor ?? "#00ff00";
    const tolerance = clampTolerance(input.tolerance);
    const scale = clampActionScale(input.scale, actionKind === "attack-1" ? 0.74 : 0.78);
    try {
      await ensureCharacterFolder(config.storageDir, characterId);
    } catch (error: unknown) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "请先创建或选择角色文件夹。" });
    }
    const directionKeys: readonly FourDirectionKey[] = ["down", "up", "left", "right"];
    const idleTemplatePath = resolveCharacterPath(config.storageDir, characterId, "base-character", "direction-templates", "idle-4dir.png");
    if (!existsSync(idleTemplatePath)) {
      return reply.code(404).send({ error: `missing idle template: storage/characters/${characterId}/base-character/direction-templates/idle-4dir.png` });
    }
    const idleBuffers = await splitFourDirectionFrameBuffer(await readFile(idleTemplatePath));
    const firstMetadata = await sharp(idleBuffers.down).metadata();
    if (!firstMetadata.width || !firstMetadata.height) {
      return reply.code(400).send({ error: "idle frame dimensions are invalid" });
    }
    const frameWidth = firstMetadata.width;
    const frameHeight = firstMetadata.height;
    const background = parseHexColorForSharp(keyColor);
    const composites = [];
    for (const [index, direction] of directionKeys.entries()) {
      const subject = await buildScaledAdvancedStartSubject(idleBuffers[direction], {
        frameWidth,
        frameHeight,
        scale,
        tolerance
      });
      const metadata = await sharp(subject).metadata();
      const subjectWidth = metadata.width ?? Math.round(frameWidth * scale);
      const subjectHeight = metadata.height ?? Math.round(frameHeight * scale);
      const cellLeft = (index % 2) * frameWidth;
      const cellTop = Math.floor(index / 2) * frameHeight;
      composites.push({
        input: subject,
        left: clampInteger(Math.round(cellLeft + (frameWidth - subjectWidth) / 2), cellLeft, cellLeft + Math.max(0, frameWidth - subjectWidth)),
        top: clampInteger(Math.round(cellTop + (frameHeight - subjectHeight) / 2), cellTop, cellTop + Math.max(0, frameHeight - subjectHeight))
      });
    }
    const baseDir = await resetCharacterDirectory(config.storageDir, characterId, "advanced-character", actionKind, "video");
    await mkdir(baseDir, { recursive: true });
    const localPath = join(baseDir, "input-4dir.png");
    const buffer = await sharp({
      create: {
        width: frameWidth * 2,
        height: frameHeight * 2,
        channels: 4,
        background: { ...background, alpha: 1 }
      }
    }).composite(composites).png().toBuffer();
    await writeFile(localPath, buffer);
    const localUrl = toCharacterUrl(characterId, "advanced-character", actionKind, "video", "input-4dir.png");
    return {
      fileName: "input-4dir.png",
      localPath,
      localUrl
    };
  });

  app.post("/api/processing/advanced-action", async (request, reply) => {
    const input = request.body as {
      jobId?: string;
      actionKind?: string;
      mode?: string;
      frameCount?: number;
      keyColor?: string;
      tolerance?: number;
      minLoopFrames?: number;
      maxLoopFrames?: number;
      exportFrameSize?: number;
      fps?: number;
      characterId?: string;
    };
    const jobId = input.jobId?.trim();
    if (!jobId || !/^[a-zA-Z0-9_-]+$/.test(jobId)) {
      return reply.code(400).send({ error: "有效的视频任务 ID 是必填项。" });
    }
    const characterId = input.characterId?.trim();
    if (!characterId) {
      return reply.code(400).send({ error: "请先创建或选择角色文件夹。" });
    }
    const actionKind = normalizeAdvancedActionKind(input.actionKind);
    if (!actionKind) {
      return reply.code(400).send({ error: "actionKind must be run, attack-1, or jump" });
    }
    const mode = input.mode === "oneshot" ? "oneshot" : "loop";
    try {
      await ensureCharacterFolder(config.storageDir, characterId);
    } catch (error: unknown) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "请先创建或选择角色文件夹。" });
    }
    const frameCount = clampFrameCount(input.frameCount, 120);
    const keyColor = input.keyColor ?? "#00ff00";
    const tolerance = clampTolerance(input.tolerance);
    const minLoopFrames = clampLoopFrameCount(input.minLoopFrames, 12);
    const maxLoopFrames = Math.max(minLoopFrames, clampLoopFrameCount(input.maxLoopFrames, 60));
    const fps = clampFps(input.fps);
    const sourcePath = resolveCharacterPath(config.storageDir, characterId, "advanced-character", actionKind, "video", "source.mp4");
    if (!existsSync(sourcePath)) {
      return reply.code(404).send({ error: `缂哄皯瑙嗛婧愭枃浠讹細storage/characters/${characterId}/advanced-character/${actionKind}/video/source.mp4` });
    }

    const result = await processAdvancedFourDirectionVideo({
      config,
      characterId,
      jobId,
      actionKind,
      mode,
      sourcePath,
      frameCount,
      keyColor,
      tolerance,
      minLoopFrames,
      maxLoopFrames,
      fps,
      exportFrameSize: input.exportFrameSize
    });
    return result;
  });
}

function clampFrameCount(value: unknown, fallback = 12): number {
  const count = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(1, Math.min(120, count));
}

function clampTolerance(value: unknown): number {
  const tolerance = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 255;
  return Math.max(0, Math.min(255, tolerance));
}

function clampLoopFrameCount(value: unknown, fallback: number): number {
  const count = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(2, Math.min(120, count));
}

function clampFps(value: unknown): number {
  const fps = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 30;
  return Math.max(1, Math.min(300, fps));
}

function clampExportFrameSize(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(64, Math.min(1024, Math.round(value)));
}

function clampActionScale(value: unknown, fallback: number): number {
  const scale = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(0.45, Math.min(0.95, scale));
}

function normalizeAdvancedActionKind(value: unknown): AdvancedActionKind | undefined {
  return value === "run" || value === "attack-1" || value === "jump" ? value : undefined;
}

async function buildScaledAdvancedStartSubject(
  input: Buffer,
  options: {
    frameWidth: number;
    frameHeight: number;
    scale: number;
    tolerance: number;
  }
): Promise<Buffer> {
  const keyed = await removeDetachedAlphaArtifacts(
    await applySampledBackgroundKeyToBuffer(input, { tolerance: options.tolerance })
  );
  const image = sharp(keyed).ensureAlpha();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("advanced action subject dimensions are invalid");
  }
  const raw = await image.raw().toBuffer();
  const box = findAlphaBox(raw, metadata.width, metadata.height);
  if (!box) {
    return sharp({
      create: {
        width: Math.max(1, Math.round(options.frameWidth * options.scale)),
        height: Math.max(1, Math.round(options.frameHeight * options.scale)),
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    }).png().toBuffer();
  }

  const subjectWidth = box.right - box.left + 1;
  const subjectHeight = box.bottom - box.top + 1;
  const maxWidth = Math.max(1, Math.round(options.frameWidth * options.scale));
  const maxHeight = Math.max(1, Math.round(options.frameHeight * options.scale));
  return sharp(keyed)
    .extract({
      left: box.left,
      top: box.top,
      width: subjectWidth,
      height: subjectHeight
    })
    .resize(maxWidth, maxHeight, {
      fit: "inside",
      kernel: "lanczos3",
      withoutEnlargement: false
    })
    .png()
    .toBuffer();
}

function findAlphaBox(
  raw: Buffer,
  width: number,
  height: number
): { left: number; top: number; right: number; bottom: number } | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = raw[((y * width) + x) * 4 + 3] ?? 0;
      if (alpha === 0) {
        continue;
      }
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right >= left && bottom >= top ? { left, top, right, bottom } : null;
}

function parseHexColorForSharp(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return { r: 0, g: 255, b: 0 };
  }
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function inferFrameSize(buffer: Buffer | undefined): Promise<{ width: number; height: number }> {
  if (!buffer) {
    throw new Error("Cannot infer frame size without transparent frames");
  }
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Cannot infer frame size from image without dimensions");
  }
  return { width: metadata.width, height: metadata.height };
}

async function inferFourDirectionBleedMargin(buffer: Buffer): Promise<number> {
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) {
    return 0;
  }
  const halfSize = Math.min(Math.floor(metadata.width / 2), Math.floor(metadata.height / 2));
  return Math.max(24, Math.min(96, Math.round(halfSize * 0.14)));
}

async function processAdvancedFourDirectionVideo(input: {
  config: ProcessingRouteConfig;
  characterId: string;
  jobId: string;
  actionKind: AdvancedActionKind;
  mode: AdvancedActionMode;
  sourcePath: string;
  frameCount: number;
  keyColor: string;
  tolerance: number;
  minLoopFrames: number;
  maxLoopFrames: number;
  fps: number;
  exportFrameSize?: number;
}) {
  const baseDir = await resetCharacterDirectory(input.config.storageDir, input.characterId, "advanced-character", input.actionKind, "export");
  const rawDir = join(baseDir, "raw");
  const centeredDir = join(baseDir, "centered");
  const loopDir = join(baseDir, input.mode === "loop" ? "loop" : "action");
  const transparentDir = join(baseDir, "transparent");
  const exportDir = join(baseDir, "exports");
  await rm(baseDir, { recursive: true, force: true });
  await mkdir(rawDir, { recursive: true });
  await mkdir(centeredDir, { recursive: true });
  await mkdir(loopDir, { recursive: true });
  await mkdir(transparentDir, { recursive: true });
  await mkdir(exportDir, { recursive: true });

  const durationSeconds = await probeVideoDurationSeconds(input.config.ffmpegPath, input.sourcePath);
  await extractFramesWithFfmpeg(input.config.ffmpegPath, {
    inputPath: input.sourcePath,
    outputPattern: join(rawDir, "frame_%03d.png"),
    frameCount: input.frameCount,
    durationSeconds
  });

  const rawFileNames = (await readdir(rawDir))
    .filter((fileName) => fileName.toLowerCase().endsWith(".png"))
    .sort()
    .slice(0, input.frameCount);
  const rawFrames = rawFileNames.map((fileName, index) => ({
    index: index + 1,
    url: toCharacterUrl(input.characterId, "advanced-character", input.actionKind, "export", "raw", fileName)
  }));

  const directionKeys: readonly FourDirectionKey[] = ["down", "up", "left", "right"];
  const directionLabels = {
    down: "下方向",
    up: "上方向",
    left: "左方向",
    right: "右方向"
  } satisfies Record<FourDirectionKey, string>;
  const centeredFrames: Record<FourDirectionKey, { index: number; url: string; path: string }[]> = {
    down: [],
    up: [],
    left: [],
    right: []
  };
  const splitFrames: Record<FourDirectionKey, { index: number; buffer: Buffer }[]> = {
    down: [],
    up: [],
    left: [],
    right: []
  };

  for (const [index, fileName] of rawFileNames.entries()) {
    const frameNumber = index + 1;
    const sourceBuffer = await readFile(join(rawDir, fileName));
    const split = await splitFourDirectionFrameBuffer(sourceBuffer, {
      bleedMargin: await inferFourDirectionBleedMargin(sourceBuffer),
      keyColor: input.keyColor,
      tolerance: input.tolerance
    });
    for (const direction of directionKeys) {
      splitFrames[direction].push({
        index: frameNumber,
        buffer: split[direction]
      });
    }
  }

  for (const direction of directionKeys) {
    const directionDir = join(centeredDir, direction);
    await mkdir(directionDir, { recursive: true });
    const centeredBuffers = await centerFrameSequenceBuffers(
      splitFrames[direction].map((frame) => frame.buffer),
      input.keyColor,
      input.tolerance
    );
    for (const [index, centered] of centeredBuffers.entries()) {
      const frameNumber = splitFrames[direction][index]?.index ?? index + 1;
      const outputName = `frame_${String(frameNumber).padStart(3, "0")}.png`;
      const outputPath = join(directionDir, outputName);
      await writeFile(outputPath, centered);
      centeredFrames[direction].push({
        index: frameNumber,
        path: outputPath,
        url: toCharacterUrl(input.characterId, "advanced-character", input.actionKind, "export", "centered", direction, outputName)
      });
    }
  }

  const directions: {
    key: FourDirectionKey;
    label: string;
    centeredFrames: { index: number; url: string }[];
    loopFrames: { index: number; url: string }[];
    transparentFrames: { index: number; url: string }[];
    loop: LoopSegment;
  }[] = [];
  const transparentBuffersByDirection: Record<FourDirectionKey, Buffer[]> = {
    down: [],
    up: [],
    left: [],
    right: []
  };
  const transparentZipEntries: Record<string, Buffer> = {};
  let selectedFrameCount = 0;
  const oneShotSelection = input.mode === "oneshot"
    ? await selectCompressedOneShotFrameIndices(centeredFrames, directionKeys, input.tolerance)
    : null;
  const walkProfile = await readWalkCharacterFrameProfile(input.config.storageDir, input.characterId, directionKeys);

  for (const direction of directionKeys) {
    const selected = input.mode === "loop"
      ? await selectLoopFrames(centeredFrames[direction], input.minLoopFrames, input.maxLoopFrames, input.tolerance)
      : selectFramesByIndices(centeredFrames[direction], oneShotSelection);
    const selectedFrames = selected.frames;
    selectedFrameCount = Math.max(selectedFrameCount, selectedFrames.length);
    const loopRecords = [];
    const transparentRecords = [];
    const preparedFrames: PreparedTransparentFrame[] = [];
    await mkdir(join(loopDir, direction), { recursive: true });
    await mkdir(join(transparentDir, direction), { recursive: true });
    for (const frame of selectedFrames) {
      const fileName = `frame_${String(frame.index).padStart(3, "0")}.png`;
      const loopPath = join(loopDir, direction, fileName);
      const transparentPath = join(transparentDir, direction, fileName);
      const centered = await readFile(frame.path);
      const keyed = await applySampledBackgroundKeyToBuffer(centered, { tolerance: input.tolerance });
      const exportSize = clampExportFrameSize(input.exportFrameSize);
      const transparent = exportSize ? await resizeNearestBuffer(keyed, exportSize) : keyed;
      preparedFrames.push({ frame, fileName, loopPath, transparentPath, centered, transparent });
    }
    const preparedTransparentBuffers = preparedFrames.map((frame) => frame.transparent);
    const outputTransparentFrames = walkProfile
      ? (await normalizeFourDirectionFrameSequencesToProfile({
        down: direction === "down" ? preparedTransparentBuffers : [],
        up: direction === "up" ? preparedTransparentBuffers : [],
        left: direction === "left" ? preparedTransparentBuffers : [],
        right: direction === "right" ? preparedTransparentBuffers : []
      }, walkProfile))[direction]
      : input.mode === "oneshot"
        ? await normalizeOneShotBuffersToIdleReference(
          preparedTransparentBuffers,
          resolveCharacterPath(input.config.storageDir, input.characterId, "base-character", "loop-export", "idle", "transparent", `${direction}.png`)
        )
        : preparedTransparentBuffers;
    for (const [index, prepared] of preparedFrames.entries()) {
      const transparent = outputTransparentFrames[index] ?? prepared.transparent;
      await writeFile(prepared.loopPath, prepared.centered);
      await writeFile(prepared.transparentPath, transparent);
      transparentBuffersByDirection[direction].push(transparent);
      transparentZipEntries[`${direction}/${prepared.fileName}`] = transparent;
      loopRecords.push({
        index: prepared.frame.index,
        url: toCharacterUrl(input.characterId, "advanced-character", input.actionKind, "export", input.mode === "loop" ? "loop" : "action", direction, prepared.fileName)
      });
      transparentRecords.push({
        index: prepared.frame.index,
        url: toCharacterUrl(input.characterId, "advanced-character", input.actionKind, "export", "transparent", direction, prepared.fileName)
      });
    }
    directions.push({
      key: direction,
      label: directionLabels[direction],
      centeredFrames: centeredFrames[direction].map(({ index, url }) => ({ index, url })),
      loopFrames: loopRecords,
      transparentFrames: transparentRecords,
      loop: selected.segment
    });
  }

  const spriteSize = await inferFrameSize(transparentBuffersByDirection.down[0]);
  let spriteSheetUrl: string | undefined;
  if (input.mode === "loop") {
    const spriteSheet = await buildFourDirectionSpriteSheetFromBuffers(transparentBuffersByDirection, {
      frameWidth: spriteSize.width,
      frameHeight: spriteSize.height
    });
    const spriteSheetPath = join(exportDir, "sprite-sheet.png");
    await writeFile(spriteSheetPath, spriteSheet);
    spriteSheetUrl = toCharacterUrl(input.characterId, "advanced-character", input.actionKind, "export", "exports", "sprite-sheet.png");
  }

  const zipPath = join(exportDir, "transparent-frames.zip");
  await writeZipFile(zipPath, transparentZipEntries);

  const gifPreviewUrl = await tryBuildPreviewGif(input.config.ffmpegPath, {
    exportDir,
    fps: input.fps,
    jobId: input.jobId,
    characterId: input.characterId,
    directionKeys,
    transparentBuffersByDirection,
    frameWidth: spriteSize.width,
    frameHeight: spriteSize.height,
    outputUrlSegments: ["advanced-character", input.actionKind, "export", "exports"]
  });

  return {
    jobId: input.jobId,
    actionKind: input.actionKind,
    mode: input.mode,
    frameCount: input.mode === "oneshot" ? selectedFrameCount : rawFrames.length,
    rawFrames,
    directions,
    spriteSheetUrl,
    transparentZipUrl: toCharacterUrl(input.characterId, "advanced-character", input.actionKind, "export", "exports", "transparent-frames.zip"),
    gifPreviewUrl
  };
}

async function selectLoopFrames(
  frames: { index: number; url: string; path: string }[],
  minLoopFrames: number,
  maxLoopFrames: number,
  tolerance: number
): Promise<{ frames: { index: number; url: string; path: string }[]; segment: LoopSegment }> {
  const signatures: Buffer[] = [];
  for (const frame of frames) {
    const sampled = await applySampledBackgroundKeyToBuffer(await readFile(frame.path), { tolerance });
    signatures.push(await createFrameSignatureBuffer(sampled));
  }
  const segment = findBestLoopSegment(signatures, { minLoopFrames, maxLoopFrames });
  return {
    frames: frames.slice(Math.max(0, segment.startFrame - 1), Math.max(0, segment.endFrame)),
    segment
  };
}

async function selectCompressedOneShotFrameIndices(
  centeredFrames: Record<FourDirectionKey, { index: number; url: string; path: string }[]>,
  directionKeys: readonly FourDirectionKey[],
  tolerance: number
): Promise<{ indices: number[]; segment: LoopSegment }> {
  const referenceDirection = directionKeys[0];
  const referenceFrames = referenceDirection ? centeredFrames[referenceDirection] : [];
  const frameCount = Math.min(
    referenceFrames.length,
    ...directionKeys.map((direction) => centeredFrames[direction].length)
  );
  if (frameCount <= 0) {
    return {
      indices: [],
      segment: { startFrame: 0, endFrame: 0, frameCount: 0, score: 0 }
    };
  }
  if (frameCount <= 2) {
    const indices = referenceFrames.slice(0, frameCount).map((frame) => frame.index);
    return {
      indices,
      segment: {
        startFrame: indices[0] ?? 0,
        endFrame: indices.at(-1) ?? indices[0] ?? 0,
        frameCount: indices.length,
        score: 1
      }
    };
  }

  const signaturesByDirection: Record<FourDirectionKey, Buffer[]> = {
    down: [],
    up: [],
    left: [],
    right: []
  };
  for (const direction of directionKeys) {
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const frame = centeredFrames[direction][frameIndex];
      if (!frame) {
        continue;
      }
      const sampled = await applySampledBackgroundKeyToBuffer(await readFile(frame.path), { tolerance });
      signaturesByDirection[direction].push(await createFrameSignatureBuffer(sampled, { size: 96 }));
    }
  }

  const deltas = Array.from({ length: frameCount }, (_, frameIndex) => {
    if (frameIndex === 0) {
      return 0;
    }
    return Math.max(...directionKeys.map((direction) => {
      const current = signaturesByDirection[direction][frameIndex];
      const previous = signaturesByDirection[direction][frameIndex - 1];
      return current && previous ? calculateBufferDifference(current, previous) : 0;
    }));
  });
  const selectedPositions = selectCompressedFramePositions(deltas);
  const indices = selectedPositions
    .map((position) => referenceFrames[position]?.index)
    .filter((index): index is number => typeof index === "number");
  return {
    indices,
    segment: {
      startFrame: indices[0] ?? 0,
      endFrame: indices.at(-1) ?? indices[0] ?? 0,
      frameCount: indices.length,
      score: Number((indices.length / frameCount).toFixed(4))
    }
  };
}

function selectFramesByIndices(
  frames: { index: number; url: string; path: string }[],
  selection: { indices: number[]; segment: LoopSegment } | null
): { frames: { index: number; url: string; path: string }[]; segment: LoopSegment } {
  if (!selection) {
    const segment = { startFrame: frames[0]?.index ?? 0, endFrame: frames.at(-1)?.index ?? 0, frameCount: frames.length, score: 1 };
    return { frames, segment };
  }
  const selectedIndexSet = new Set(selection.indices);
  const selectedFrames = frames.filter((frame) => selectedIndexSet.has(frame.index));
  return {
    frames: selectedFrames,
    segment: {
      ...selection.segment,
      frameCount: selectedFrames.length
    }
  };
}

function selectCompressedFramePositions(deltas: readonly number[]): number[] {
  if (deltas.length <= 2) {
    return deltas.map((_, index) => index);
  }
  const sortedDeltas = deltas.slice(1).filter(Number.isFinite).sort((a, b) => a - b);
  const peak = sortedDeltas.at(-1) ?? 0;
  if (peak <= 0) {
    return [0, deltas.length - 1];
  }
  const baseline = percentile(sortedDeltas, 0.2);
  const threshold = Math.max(0.003, baseline + ((peak - baseline) * 0.08));
  const selected = new Set<number>();
  let runStart = 0;
  for (let edgeIndex = 1; edgeIndex < deltas.length; edgeIndex += 1) {
    if ((deltas[edgeIndex] ?? 0) <= threshold) {
      continue;
    }
    const runEnd = edgeIndex - 1;
    selected.add(runStart);
    selected.add(runEnd);
    runStart = edgeIndex;
  }
  selected.add(runStart);
  selected.add(deltas.length - 1);
  return [...selected].sort((a, b) => a - b);
}

function percentile(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * ratio)))] ?? 0;
}

function calculateBufferDifference(first: Buffer, second: Buffer): number {
  const length = Math.min(first.length, second.length);
  if (length === 0) {
    return 255;
  }
  let total = 0;
  for (let index = 0; index < length; index += 1) {
    total += Math.abs((first[index] ?? 0) - (second[index] ?? 0));
  }
  return total / length;
}

async function normalizeOneShotBuffersToIdleReference(
  buffers: readonly Buffer[],
  referencePath: string
): Promise<Buffer[]> {
  if (buffers.length === 0 || !existsSync(referencePath)) {
    return [...buffers];
  }
  const reference = await getAlphaBoxFromBuffer(await readFile(referencePath));
  const frames = await Promise.all(buffers.map((buffer) => getAlphaBoxFromBuffer(buffer)));
  const baseline = frames[0];
  if (!reference || !baseline) {
    return [...buffers];
  }

  const referenceBox = scaleBoxToCanvas(reference.box, {
    sourceWidth: reference.width,
    sourceHeight: reference.height,
    targetWidth: baseline.width,
    targetHeight: baseline.height
  });
  const referenceWidth = getBoxWidth(referenceBox);
  const referenceHeight = getBoxHeight(referenceBox);
  const baselineHeight = getBoxHeight(baseline.box);
  if (referenceWidth <= 0 || baselineHeight <= 0) {
    return [...buffers];
  }

  const scale = Math.max(0.5, Math.min(8, referenceHeight / baselineHeight));
  const baselineCenter = getBoxCenter(baseline.box);
  const referenceCenter = getBoxCenter(referenceBox);

  return Promise.all(buffers.map(async (buffer) => {
    const frame = await getAlphaBoxFromBuffer(buffer);
    if (!frame) {
      return buffer;
    }
    const width = getBoxWidth(frame.box);
    const height = getBoxHeight(frame.box);
    const scaledWidth = Math.max(1, Math.round(width * scale));
    const scaledHeight = Math.max(1, Math.round(height * scale));
    const canvasFitScale = Math.min(1, frame.width / scaledWidth, frame.height / scaledHeight);
    const outputWidth = Math.max(1, Math.min(frame.width, Math.round(scaledWidth * canvasFitScale)));
    const outputHeight = Math.max(1, Math.min(frame.height, Math.round(scaledHeight * canvasFitScale)));
    const center = getBoxCenter(frame.box);
    const outputCenterX = referenceCenter.x + ((center.x - baselineCenter.x) * scale);
    const outputCenterY = referenceCenter.y + ((center.y - baselineCenter.y) * scale);
    const left = clampInteger(Math.round(outputCenterX - (outputWidth / 2)), 0, Math.max(0, frame.width - outputWidth));
    const top = clampInteger(Math.round(outputCenterY - (outputHeight / 2)), 0, Math.max(0, frame.height - outputHeight));
    const subject = await sharp(buffer)
      .extract({
        left: frame.box.left,
        top: frame.box.top,
        width,
        height
      })
      .resize(outputWidth, outputHeight, {
        fit: "fill",
        kernel: "lanczos3"
      })
      .png()
      .toBuffer();

    return sharp({
      create: {
        width: frame.width,
        height: frame.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .composite([{ input: subject, left, top }])
      .png()
      .toBuffer();
  }));
}

async function getAlphaBoxFromBuffer(
  buffer: Buffer
): Promise<{ width: number; height: number; box: { left: number; top: number; right: number; bottom: number } } | null> {
  const image = sharp(buffer).ensureAlpha();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    return null;
  }
  const raw = await image.raw().toBuffer();
  const box = findAlphaBox(raw, metadata.width, metadata.height);
  return box ? { width: metadata.width, height: metadata.height, box } : null;
}

function scaleBoxToCanvas(
  box: { left: number; top: number; right: number; bottom: number },
  input: { sourceWidth: number; sourceHeight: number; targetWidth: number; targetHeight: number }
): { left: number; top: number; right: number; bottom: number } {
  const xScale = input.targetWidth / input.sourceWidth;
  const yScale = input.targetHeight / input.sourceHeight;
  return {
    left: Math.round(box.left * xScale),
    top: Math.round(box.top * yScale),
    right: Math.round(box.right * xScale),
    bottom: Math.round(box.bottom * yScale)
  };
}

function getBoxWidth(box: { left: number; right: number }): number {
  return box.right - box.left + 1;
}

function getBoxHeight(box: { top: number; bottom: number }): number {
  return box.bottom - box.top + 1;
}

function getBoxCenter(box: { left: number; top: number; right: number; bottom: number }): { x: number; y: number } {
  return {
    x: (box.left + box.right) / 2,
    y: (box.top + box.bottom) / 2
  };
}

async function tryBuildPreviewGif(
  ffmpegPath: string,
  input: {
    exportDir: string;
    fps: number;
    jobId: string;
    characterId: string;
    directionKeys: readonly FourDirectionKey[];
    transparentBuffersByDirection: Record<FourDirectionKey, Buffer[]>;
    frameWidth: number;
    frameHeight: number;
    outputUrlSegments?: readonly string[];
  }
): Promise<string | undefined> {
  const gifFramesDir = join(input.exportDir, "gif-frames");
  try {
    await mkdir(gifFramesDir, { recursive: true });
    const maxFrames = Math.max(...input.directionKeys.map((direction) => input.transparentBuffersByDirection[direction].length));
    const maxPreviewSide = 1024;
    const previewScale = Math.min(1, maxPreviewSide / Math.max(input.frameWidth * 2, input.frameHeight * 2));
    const previewFrameWidth = Math.max(1, Math.round(input.frameWidth * previewScale));
    const previewFrameHeight = Math.max(1, Math.round(input.frameHeight * previewScale));
    for (let frameIndex = 0; frameIndex < maxFrames; frameIndex += 1) {
      const composites = (await Promise.all(input.directionKeys.map(async (direction, directionIndex) => {
        const frames = input.transparentBuffersByDirection[direction];
        const frame = frames[frameIndex % Math.max(1, frames.length)];
        const previewInput = frame && previewScale < 1
          ? await sharp(frame)
            .resize(previewFrameWidth, previewFrameHeight, {
              fit: "fill",
              kernel: "nearest"
            })
            .png()
            .toBuffer()
          : frame;
        return frame ? {
          input: previewInput,
          left: directionIndex % 2 * previewFrameWidth,
          top: Math.floor(directionIndex / 2) * previewFrameHeight
        } : null;
      }))).filter((item): item is { input: Buffer; left: number; top: number } => Boolean(item));
      const previewFrame = await sharp({
        create: {
          width: previewFrameWidth * 2,
          height: previewFrameHeight * 2,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
      }).composite(composites).png().toBuffer();
      await writeFile(join(gifFramesDir, `preview_${String(frameIndex + 1).padStart(3, "0")}.png`), previewFrame);
    }
    await runFfmpeg(ffmpegPath, [
      "-y",
      "-framerate",
      String(input.fps),
      "-i",
      join(gifFramesDir, "preview_%03d.png"),
      "-loop",
      "0",
      join(input.exportDir, "preview.gif")
    ]);
    await rm(gifFramesDir, { recursive: true, force: true });
    return toCharacterUrl(input.characterId, ...(input.outputUrlSegments ?? ["base-character", "loop-export", "exports"]), "preview.gif");
  } catch {
    await rm(gifFramesDir, { recursive: true, force: true });
    return undefined;
  }
}

function createEmptyDirectionBuffers(): Record<FourDirectionKey, Buffer[]> {
  return {
    down: [],
    up: [],
    left: [],
    right: []
  };
}

function firstAvailableDirectionBuffer(
  buffersByDirection: Record<FourDirectionKey, readonly Buffer[]>,
  directionKeys: readonly FourDirectionKey[]
): Buffer | null {
  for (const direction of directionKeys) {
    const buffer = buffersByDirection[direction][0];
    if (buffer) {
      return buffer;
    }
  }
  return null;
}

async function readWalkCharacterFrameProfile(
  storageDir: string,
  characterId: string,
  directionKeys: readonly FourDirectionKey[]
): Promise<CharacterFrameProfile | null> {
  const walkBuffers = await readWalkTransparentBuffers(
    resolveCharacterPath(storageDir, characterId, "base-character", "loop-export"),
    directionKeys
  );
  const reference = walkBuffers?.down[0] ?? (walkBuffers ? firstAvailableDirectionBuffer(walkBuffers, directionKeys) : null);
  return reference ? createCharacterFrameProfileFromBuffer(reference) : null;
}

async function readWalkTransparentBuffers(
  baseDir: string,
  directionKeys: readonly FourDirectionKey[]
): Promise<Record<FourDirectionKey, Buffer[]> | null> {
  const transparentBuffersByDirection = createEmptyDirectionBuffers();
  for (const direction of directionKeys) {
    const directionDir = join(baseDir, "transparent", direction);
    if (!existsSync(directionDir)) {
      return null;
    }
    const frameNames = (await readdir(directionDir))
      .filter((fileName) => fileName.toLowerCase().endsWith(".png"))
      .sort();
    if (frameNames.length === 0) {
      return null;
    }
    for (const fileName of frameNames) {
      transparentBuffersByDirection[direction].push(await readFile(join(directionDir, fileName)));
    }
  }
  return transparentBuffersByDirection;
}

async function buildIdleDirectionExport(input: {
  baseDir: string;
  characterId: string;
  config: ProcessingRouteConfig;
  directionKeys: readonly FourDirectionKey[];
  directionLabels: Record<FourDirectionKey, string>;
  keyColor: string;
  tolerance: number;
  spriteSize: { width: number; height: number };
  profile: CharacterFrameProfile | null;
  transparentBuffersByDirection: Record<FourDirectionKey, Buffer[]>;
}): Promise<{
  frames: { key: FourDirectionKey; label: string; index: number; url: string }[];
  spriteSheetUrl: string;
}> {
  const idleTemplatePath = resolveCharacterPath(input.config.storageDir, input.characterId, "base-character", "direction-templates", "idle-4dir.png");
  if (!existsSync(idleTemplatePath)) {
    throw new Error(`缺少待机四方向图：storage/characters/${input.characterId}/base-character/direction-templates/idle-4dir.png`);
  }

  const idleDir = join(input.baseDir, "idle");
  const idleTransparentDir = join(idleDir, "transparent");
  const exportDir = join(input.baseDir, "exports");
  await mkdir(idleTransparentDir, { recursive: true });
  await mkdir(exportDir, { recursive: true });
  const idleBuffers = await alignIdleFourDirectionSheetToWalkBuffers(
    await readFile(idleTemplatePath),
    input.transparentBuffersByDirection,
    {
      keyColor: input.keyColor,
      tolerance: input.tolerance,
      frameWidth: input.spriteSize.width,
      frameHeight: input.spriteSize.height,
      profile: input.profile
    }
  );
  const frames = [];
  for (const direction of input.directionKeys) {
    const fileName = `${direction}.png`;
    const outputPath = join(idleTransparentDir, fileName);
    await writeFile(outputPath, idleBuffers[direction]);
    frames.push({
      key: direction,
      label: input.directionLabels[direction],
      index: 1,
      url: toCharacterUrl(input.characterId, "base-character", "loop-export", "idle", "transparent", fileName)
    });
  }

  const idleSpriteSheet = await buildFourDirectionContactSheetFromBuffers(idleBuffers, {
    frameWidth: input.spriteSize.width,
    frameHeight: input.spriteSize.height
  });
  await writeFile(join(exportDir, "idle-4dir-sprite-sheet.png"), idleSpriteSheet);

  return {
    frames,
    spriteSheetUrl: toCharacterUrl(input.characterId, "base-character", "loop-export", "exports", "idle-4dir-sprite-sheet.png")
  };
}

async function writeZipFile(path: string, files: Record<string, Buffer>): Promise<void> {
  const entries = Object.entries(files);
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const [name, data] of entries) {
    const nameBuffer = Buffer.from(name.replace(/\\/g, "/"), "utf8");
    const crc = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + data.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  await writeFile(path, Buffer.concat([...localParts, ...centralParts, end]));
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
