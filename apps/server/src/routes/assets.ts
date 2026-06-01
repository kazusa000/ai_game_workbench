import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import type { AppConfig } from "../config";
import {
  ensureCharacterFolder,
  removeCharacterFilesByStem,
  resolveCharacterPath,
  toCharacterUrl
} from "../characterStorage";
import {
  getModule01ReferenceImageFileName,
  getModule01ReferenceImageUrl,
  isModule01ReferenceImageKind,
  resolveModule01ReferenceImageOverridePath
} from "../referenceImages";

type AssetRouteConfig = Pick<AppConfig, "storageDir" | "module01CharacterExportDir" | "publicAssetBaseUrl" | "port">;

export function registerAssetRoutes(app: FastifyInstance, config: AssetRouteConfig): void {
  const assetDir = join(config.storageDir, "assets");
  const jobsDir = join(config.storageDir, "jobs");
  const charactersDir = join(config.storageDir, "characters");
  const characterExportDir = config.module01CharacterExportDir;
  mkdirSync(assetDir, { recursive: true });
  mkdirSync(jobsDir, { recursive: true });
  mkdirSync(charactersDir, { recursive: true });
  mkdirSync(characterExportDir, { recursive: true });

  void app.register(multipart, {
    limits: {
      fileSize: 200 * 1024 * 1024,
      files: 1
    }
  });
  void app.register(fastifyStatic, {
    root: assetDir,
    prefix: "/assets/"
  });
  void app.register(fastifyStatic, {
    root: jobsDir,
    prefix: "/jobs/",
    decorateReply: false
  });
  void app.register(fastifyStatic, {
    root: charactersDir,
    prefix: "/characters/",
    decorateReply: false
  });
  void app.register(fastifyStatic, {
    root: characterExportDir,
    prefix: "/exports/character-2d/",
    decorateReply: false
  });

  app.post("/api/module01/reference-images/:kind", async (request, reply) => {
    const { kind } = request.params as { kind?: string };
    if (!isModule01ReferenceImageKind(kind)) {
      return reply.code(400).send({ error: "reference image kind must be style, walk, idle, or run" });
    }
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: "file is required" });
    }
    if (!file.mimetype.startsWith("image/")) {
      return reply.code(400).send({ error: "only image files are supported" });
    }

    const localPath = resolveModule01ReferenceImageOverridePath(config.storageDir, kind);
    const buffer = await sharp(await file.toBuffer()).png().toBuffer();
    await mkdir(dirname(localPath), { recursive: true });
    await writeFile(localPath, buffer);
    return {
      kind,
      fileName: file.filename,
      storedName: getModule01ReferenceImageFileName(kind),
      localPath,
      url: getModule01ReferenceImageUrl(kind)
    };
  });

  app.post("/api/assets/first-frame", async (request, reply) => {
    const publicBaseResult = resolvePublicAssetBaseUrl(request.headers["x-public-asset-base-url"], config);
    if ("error" in publicBaseResult) {
      return reply.code(400).send({ error: publicBaseResult.error });
    }
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: "file is required" });
    }
    if (!file.mimetype.startsWith("image/")) {
      return reply.code(400).send({ error: "only image files are supported" });
    }

    const extension = getImageExtension(file.filename, file.mimetype);
    const characterId = readCharacterHeaderValue(request.headers["x-character-id"]);
    const targetKind = readHeaderValue(request.headers["x-character-asset-kind"]);
    const actionKind = normalizeAdvancedActionKind(readHeaderValue(request.headers["x-character-action-kind"]));
    if (characterId) {
      try {
        const target = resolveCharacterAssetTarget(targetKind, actionKind);
        await ensureCharacterFolder(config.storageDir, characterId);
        await removeCharacterFilesByStem(config.storageDir, characterId, target.directory, target.stem);
        const storedName = `${target.stem}${extension}`;
        const localPath = resolveCharacterPath(config.storageDir, characterId, ...target.directory, storedName);
        await mkdir(resolveCharacterPath(config.storageDir, characterId, ...target.directory), { recursive: true });
        await writeFile(localPath, await file.toBuffer());
        const localUrl = toCharacterUrl(characterId, ...target.directory, storedName);
        const publicRoot = resolvePublicServerBaseUrl(request.headers["x-public-asset-base-url"], config);
        if ("error" in publicRoot) {
          return reply.code(400).send({ error: publicRoot.error });
        }
        return {
          fileName: file.filename,
          storedName,
          localPath,
          localUrl,
          publicUrl: `${publicRoot.publicBase}${localUrl}`
        };
      } catch (error: unknown) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : "角色资源保存失败。" });
      }
    }

    const storedName = `${randomUUID()}${extension}`;
    const localPath = join(assetDir, storedName);
    await mkdir(assetDir, { recursive: true });
    await writeFile(localPath, await file.toBuffer());

    return {
      fileName: file.filename,
      storedName,
      localPath,
      localUrl: `/assets/${storedName}`,
      publicUrl: `${publicBaseResult.publicBase.replace(/\/$/, "")}/${storedName}`
    };
  });

  app.post("/api/assets/frame-video", async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: "file is required" });
    }
    if (!file.mimetype.startsWith("video/")) {
      return reply.code(400).send({ error: "only video files are supported" });
    }

    const characterId = readCharacterHeaderValue(request.headers["x-character-id"]);
    const actionKind = normalizeAdvancedActionKind(readHeaderValue(request.headers["x-character-action-kind"]));
    const jobId = `local-video-${randomUUID()}`;
    let targetDir: string;
    let localPath: string;
    let localVideoUrl: string;
    try {
      if (characterId) {
        await ensureCharacterFolder(config.storageDir, characterId);
        if (actionKind) {
          targetDir = resolveCharacterPath(config.storageDir, characterId, "advanced-character", actionKind, "video");
          localPath = resolveCharacterPath(config.storageDir, characterId, "advanced-character", actionKind, "video", "source.mp4");
          localVideoUrl = toCharacterUrl(characterId, "advanced-character", actionKind, "video", "source.mp4");
        } else {
          targetDir = resolveCharacterPath(config.storageDir, characterId, "base-character", "walk-video");
          localPath = resolveCharacterPath(config.storageDir, characterId, "base-character", "walk-video", "source.mp4");
          localVideoUrl = toCharacterUrl(characterId, "base-character", "walk-video", "source.mp4");
        }
      } else {
        targetDir = join(jobsDir, jobId);
        localPath = join(targetDir, "source.mp4");
        localVideoUrl = `/jobs/${jobId}/source.mp4`;
      }
    } catch (error: unknown) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "请先创建或选择角色文件夹。" });
    }
    await mkdir(targetDir, { recursive: true });
    await writeFile(localPath, await file.toBuffer());

    return {
      fileName: file.filename,
      jobId,
      localPath,
      localVideoUrl
    };
  });
}

export function resolvePublicAssetBaseUrl(
  headerValue: string | string[] | undefined,
  config: AssetRouteConfig
): { publicBase: string; error?: undefined } | { publicBase?: undefined; error: string } {
  const requestValue = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const requestBase = requestValue?.trim();
  if (requestBase) {
    const normalized = normalizePublicAssetBaseUrl(requestBase);
    if (!normalized) {
      return { error: "公网资源地址必须是有效 HTTPS URL。" };
    }
    if (!normalized.startsWith("https://")) {
      return { error: "公网资源地址必须使用 HTTPS，才能被 OpenRouter 视频模型访问。" };
    }
    return { publicBase: normalized };
  }

  if (config.publicAssetBaseUrl) {
    return { publicBase: normalizePublicAssetBaseUrl(config.publicAssetBaseUrl) ?? config.publicAssetBaseUrl.replace(/\/$/, "") };
  }
  return { publicBase: `http://127.0.0.1:${config.port}/assets` };
}

export function resolvePublicServerBaseUrl(
  headerValue: string | string[] | undefined,
  config: AssetRouteConfig
): { publicBase: string; error?: undefined } | { publicBase?: undefined; error: string } {
  const requestValue = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const requestBase = requestValue?.trim() || config.publicAssetBaseUrl?.trim();
  if (!requestBase) {
    return { publicBase: `http://127.0.0.1:${config.port}` };
  }
  try {
    const url = new URL(requestBase);
    if (url.protocol !== "https:" && !url.hostname.match(/^(127\.0\.0\.1|localhost)$/)) {
      return { error: "公网资源地址必须使用 HTTPS，才能被 OpenRouter 视频模型访问。" };
    }
    url.search = "";
    url.hash = "";
    if (url.pathname === "/assets" || url.pathname === "/characters") {
      url.pathname = "/";
    }
    return { publicBase: url.toString().replace(/\/$/, "") };
  } catch {
    return { error: "公网资源地址必须是有效 HTTPS URL。" };
  }
}

function normalizePublicAssetBaseUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.pathname === "" || url.pathname === "/") {
      url.pathname = "/assets";
    }
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function readHeaderValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || undefined;
}

function readCharacterHeaderValue(value: string | string[] | undefined): string | undefined {
  const raw = readHeaderValue(value);
  if (!raw) {
    return undefined;
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function resolveCharacterAssetTarget(kind: string | undefined, actionKind: AdvancedActionKind | undefined): { directory: string[]; stem: string } {
  if (actionKind && kind === "advanced-video-input") {
    return { directory: ["advanced-character", actionKind, "video"], stem: "input-4dir" };
  }
  if (kind === "direction-base-template") {
    return { directory: ["base-character", "direction-templates"], stem: "base-template" };
  }
  if (kind === "walk-video-input") {
    return { directory: ["base-character", "walk-video"], stem: "input-4dir" };
  }
  return { directory: ["base-template"], stem: "character-reference" };
}

type AdvancedActionKind = "run" | "attack-1" | "jump";

function normalizeAdvancedActionKind(value: string | undefined): AdvancedActionKind | undefined {
  return value === "run" || value === "attack-1" || value === "jump" ? value : undefined;
}

function getImageExtension(filename: string, mimeType: string): string {
  const extension = extname(filename).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(extension)) {
    return extension;
  }
  if (mimeType === "image/jpeg") {
    return ".jpg";
  }
  if (mimeType === "image/webp") {
    return ".webp";
  }
  return ".png";
}
