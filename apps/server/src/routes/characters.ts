import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config";
import {
  createCharacterFolder,
  deleteCharacterFolder,
  ensureCharacterFolder,
  findCharacterFileByStem,
  listCharacterFolders,
  resolveCharacterPath,
  toCharacterUrl
} from "../characterStorage";

type CharacterRouteConfig = Pick<AppConfig, "storageDir">;
type FourDirectionKey = "down" | "up" | "left" | "right";

interface CharacterAssetFile {
  fileName: string;
  url: string;
}

interface ProcessedFrameRecord {
  index: number;
  url: string;
}

export function registerCharacterRoutes(app: FastifyInstance, config: CharacterRouteConfig): void {
  app.get("/api/characters", async () => ({
    characters: await listCharacterFolders(config.storageDir)
  }));

  app.get("/api/characters/:characterId/assets", async (request, reply) => {
    const { characterId } = request.params as { characterId?: string };
    try {
      const id = characterId ?? "";
      await ensureCharacterFolder(config.storageDir, id);
      return {
        characterId: id,
        assets: await buildCharacterAssets(config.storageDir, id)
      };
    } catch (error: unknown) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "角色文件加载失败。" });
    }
  });

  app.post("/api/characters", async (request, reply) => {
    const input = request.body as { name?: string };
    try {
      const character = await createCharacterFolder(config.storageDir, input.name ?? "");
      return reply.code(201).send(character);
    } catch (error: unknown) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "角色文件夹创建失败。" });
    }
  });

  app.delete("/api/characters/:characterId", async (request, reply) => {
    const { characterId } = request.params as { characterId?: string };
    try {
      const character = await deleteCharacterFolder(config.storageDir, characterId ?? "");
      return { deleted: true, character };
    } catch (error: unknown) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "角色文件夹删除失败。" });
    }
  });
}

async function buildCharacterAssets(storageDir: string, characterId: string) {
  return {
    baseTemplate: {
      characterReference: await findCharacterAssetByStem(storageDir, characterId, ["base-template"], "character-reference"),
      output: findCharacterAsset(storageDir, characterId, ["base-template"], "output.png")
    },
    baseCharacter: {
      directionBaseTemplate: await findCharacterAssetByStem(storageDir, characterId, ["base-character", "direction-templates"], "base-template"),
      idleDirectionTemplate: await findCharacterAssetByStem(storageDir, characterId, ["base-character", "direction-templates"], "idle-4dir"),
      walkDirectionTemplate: await findCharacterAssetByStem(storageDir, characterId, ["base-character", "direction-templates"], "walk-4dir"),
      walkVideoInput: await findCharacterAssetByStem(storageDir, characterId, ["base-character", "walk-video"], "input-4dir"),
      walkVideoSource: findCharacterAsset(storageDir, characterId, ["base-character", "walk-video"], "source.mp4"),
      loopExport: await buildLoopExportAsset(storageDir, characterId)
    },
    advancedCharacter: {
      run: await buildAdvancedActionAssets(storageDir, characterId, "run"),
      attack1: await buildAdvancedActionAssets(storageDir, characterId, "attack-1"),
      jump: await buildAdvancedActionAssets(storageDir, characterId, "jump")
    }
  };
}

function findCharacterAsset(
  storageDir: string,
  characterId: string,
  directorySegments: readonly string[],
  fileName: string
): CharacterAssetFile | undefined {
  const localPath = resolveCharacterPath(storageDir, characterId, ...directorySegments, fileName);
  if (!existsSync(localPath)) {
    return undefined;
  }
  return {
    fileName,
    url: toCharacterUrl(characterId, ...directorySegments, fileName)
  };
}

async function findCharacterAssetByStem(
  storageDir: string,
  characterId: string,
  directorySegments: readonly string[],
  stem: string
): Promise<CharacterAssetFile | undefined> {
  const match = await findCharacterFileByStem(storageDir, characterId, directorySegments, stem);
  return match ? {
    fileName: match.fileName,
    url: toCharacterUrl(characterId, ...directorySegments, match.fileName)
  } : undefined;
}

async function buildLoopExportAsset(storageDir: string, characterId: string) {
  const rawFrames = await listFrameRecords(storageDir, characterId, ["base-character", "loop-export", "raw"]);
  const directionKeys: readonly FourDirectionKey[] = ["down", "up", "left", "right"];
  const directionLabels = {
    down: "下方向",
    up: "上方向",
    left: "左方向",
    right: "右方向"
  } satisfies Record<FourDirectionKey, string>;
  const directions = await Promise.all(directionKeys.map(async (direction) => {
    const centeredFrames = await listFrameRecords(storageDir, characterId, ["base-character", "loop-export", "centered", direction]);
    const loopFrames = await listFrameRecords(storageDir, characterId, ["base-character", "loop-export", "loop", direction]);
    const transparentFrames = await listFrameRecords(storageDir, characterId, ["base-character", "loop-export", "transparent", direction]);
    const loopSource = loopFrames.length > 0 ? loopFrames : transparentFrames;
    return {
      key: direction,
      label: directionLabels[direction],
      centeredFrames,
      loopFrames,
      transparentFrames,
      loop: inferLoopSegment(loopSource)
    };
  }));
  const spriteSheet = findCharacterAsset(storageDir, characterId, ["base-character", "loop-export", "exports"], "sprite-sheet.png");
  const transparentZip = findCharacterAsset(storageDir, characterId, ["base-character", "loop-export", "exports"], "transparent-frames.zip");
  const gifPreview = findCharacterAsset(storageDir, characterId, ["base-character", "loop-export", "exports"], "preview.gif");
  const idleSpriteSheet = findCharacterAsset(storageDir, characterId, ["base-character", "loop-export", "exports"], "idle-4dir-sprite-sheet.png");
  const idleFrames = directionKeys
    .map((direction) => {
      const asset = findCharacterAsset(storageDir, characterId, ["base-character", "loop-export", "idle", "transparent"], `${direction}.png`);
      return asset ? {
        key: direction,
        label: directionLabels[direction],
        index: 1,
        url: asset.url
      } : undefined;
    })
    .filter((frame): frame is { key: FourDirectionKey; label: string; index: number; url: string } => Boolean(frame));
  const hasLoopExport = rawFrames.length > 0
    || directions.some((direction) => direction.centeredFrames.length > 0 || direction.loopFrames.length > 0 || direction.transparentFrames.length > 0)
    || spriteSheet
    || transparentZip
    || gifPreview
    || idleSpriteSheet
    || idleFrames.length > 0;
  if (!hasLoopExport) {
    return undefined;
  }

  return {
    jobId: "existing-video",
    frameCount: rawFrames.length || Math.max(...directions.map((direction) => direction.transparentFrames.length), 0),
    rawFrames,
    directions,
    spriteSheetUrl: spriteSheet?.url,
    transparentZipUrl: transparentZip?.url,
    gifPreviewUrl: gifPreview?.url,
    idle: idleSpriteSheet || idleFrames.length > 0 ? {
      frames: idleFrames,
      spriteSheetUrl: idleSpriteSheet?.url
    } : undefined
  };
}

async function buildAdvancedActionAssets(storageDir: string, characterId: string, actionKind: "run" | "attack-1" | "jump") {
  const keyframe = actionKind === "run"
    ? await findCharacterAssetByStem(storageDir, characterId, ["advanced-character", actionKind], "keyframe-4dir")
    : undefined;
  const videoInput = await findCharacterAssetByStem(storageDir, characterId, ["advanced-character", actionKind, "video"], "input-4dir");
  const videoSource = findCharacterAsset(storageDir, characterId, ["advanced-character", actionKind, "video"], "source.mp4");
  const middleFrame = actionKind === "attack-1"
    ? await findCharacterAssetByStem(storageDir, characterId, ["advanced-character", actionKind, "midframe"], "middle-4dir")
    : undefined;
  const exportResult = await buildAdvancedActionExportAsset(storageDir, characterId, actionKind);
  if (!keyframe && !videoInput && !videoSource && !middleFrame && !exportResult) {
    return undefined;
  }
  return {
    keyframe,
    videoInput,
    videoSource,
    middleFrame,
    export: exportResult
  };
}

async function buildAdvancedActionExportAsset(storageDir: string, characterId: string, actionKind: "run" | "attack-1" | "jump") {
  const root = ["advanced-character", actionKind, "export"] as const;
  const rawFrames = await listFrameRecords(storageDir, characterId, [...root, "raw"]);
  const directionKeys: readonly FourDirectionKey[] = ["down", "up", "left", "right"];
  const directionLabels = {
    down: "下方向",
    up: "上方向",
    left: "左方向",
    right: "右方向"
  } satisfies Record<FourDirectionKey, string>;
  const directions = await Promise.all(directionKeys.map(async (direction) => {
    const centeredFrames = await listFrameRecords(storageDir, characterId, [...root, "centered", direction]);
    const loopFrames = await listFrameRecords(storageDir, characterId, [...root, "loop", direction]);
    const actionFrames = await listFrameRecords(storageDir, characterId, [...root, "action", direction]);
    const transparentFrames = await listFrameRecords(storageDir, characterId, [...root, "transparent", direction]);
    const loopSource = loopFrames.length > 0 ? loopFrames : actionFrames.length > 0 ? actionFrames : transparentFrames;
    return {
      key: direction,
      label: directionLabels[direction],
      centeredFrames,
      loopFrames: loopFrames.length > 0 ? loopFrames : actionFrames,
      transparentFrames,
      loop: inferLoopSegment(loopSource)
    };
  }));
  const spriteSheet = findCharacterAsset(storageDir, characterId, [...root, "exports"], "sprite-sheet.png");
  const transparentZip = findCharacterAsset(storageDir, characterId, [...root, "exports"], "transparent-frames.zip");
  const gifPreview = findCharacterAsset(storageDir, characterId, [...root, "exports"], "preview.gif");
  const hasExport = rawFrames.length > 0
    || directions.some((direction) => direction.centeredFrames.length > 0 || direction.loopFrames.length > 0 || direction.transparentFrames.length > 0)
    || spriteSheet
    || transparentZip
    || gifPreview;
  if (!hasExport) {
    return undefined;
  }
  return {
    jobId: "existing-video",
    frameCount: rawFrames.length || Math.max(...directions.map((direction) => direction.transparentFrames.length), 0),
    rawFrames,
    directions,
    spriteSheetUrl: spriteSheet?.url,
    transparentZipUrl: transparentZip?.url,
    gifPreviewUrl: gifPreview?.url
  };
}

async function listFrameRecords(
  storageDir: string,
  characterId: string,
  directorySegments: readonly string[]
): Promise<ProcessedFrameRecord[]> {
  const directory = resolveCharacterPath(storageDir, characterId, ...directorySegments);
  if (!existsSync(directory)) {
    return [];
  }
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"))
    .map((entry) => ({
      fileName: entry.name,
      index: parseFrameIndex(entry.name)
    }))
    .sort((first, second) => first.index - second.index || first.fileName.localeCompare(second.fileName))
    .map((entry) => ({
      index: entry.index,
      url: toCharacterUrl(characterId, ...directorySegments, entry.fileName)
    }));
}

function parseFrameIndex(fileName: string): number {
  const match = /(\d+)/.exec(fileName);
  return match ? Number.parseInt(match[1] ?? "0", 10) : 1;
}

function inferLoopSegment(frames: readonly ProcessedFrameRecord[]) {
  const startFrame = frames[0]?.index ?? 0;
  const endFrame = frames.at(-1)?.index ?? 0;
  return {
    startFrame,
    endFrame,
    frameCount: frames.length,
    score: frames.length > 0 ? 1 : 0
  };
}
