import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import {
  buildImageGenerationPayload,
  buildVideoGenerationPayload,
  OpenRouterError,
  OpenRouterClient
} from "../providers/openRouter";
import type { AppConfig } from "../config";
import { resolvePublicAssetBaseUrl } from "./assets";

export function registerGenerationRoutes(app: FastifyInstance, config: AppConfig): void {
  app.post("/api/generation/first-frame/payload", async (request) => {
    return buildImageGenerationPayload(request.body as Parameters<typeof buildImageGenerationPayload>[0]);
  });

  app.post("/api/generation/video/payload", async (request) => {
    return buildVideoGenerationPayload(request.body as Parameters<typeof buildVideoGenerationPayload>[0]);
  });

  app.post("/api/generation/first-frame", async (request, reply) => {
    const apiKey = resolveOpenRouterApiKey(request, config);
    if (!apiKey) {
      return reply.code(400).send({ error: "OPENROUTER_API_KEY is not configured" });
    }
    const publicBaseResult = resolvePublicAssetBaseUrl(request.headers["x-public-asset-base-url"], config);
    if ("error" in publicBaseResult) {
      return reply.code(400).send({ error: publicBaseResult.error });
    }
    const client = new OpenRouterClient({ apiKey });
    try {
      const providerResponse = await client.createImage(
        buildImageGenerationPayload(request.body as Parameters<typeof buildImageGenerationPayload>[0])
      );
      return await storeGeneratedFirstFrame(providerResponse, config, publicBaseResult.publicBase);
    } catch (error: unknown) {
      return sendGenerationError(error, reply);
    }
  });

  app.post("/api/generation/video", async (request, reply) => {
    const apiKey = resolveOpenRouterApiKey(request, config);
    if (!apiKey) {
      return reply.code(400).send({ error: "OPENROUTER_API_KEY is not configured" });
    }
    const input = request.body as Parameters<typeof buildVideoGenerationPayload>[0];
    const urlError = validatePublicHttpsImageUrl(input.firstFrameUrl);
    if (urlError) {
      return reply.code(400).send({ error: urlError });
    }
    const client = new OpenRouterClient({ apiKey });
    try {
      return await client.createVideo(buildVideoGenerationPayload(input));
    } catch (error: unknown) {
      return sendGenerationError(error, reply);
    }
  });

  app.get("/api/generation/video/:jobId", async (request, reply) => {
    const apiKey = resolveOpenRouterApiKey(request, config);
    if (!apiKey) {
      return reply.code(400).send({ error: "OPENROUTER_API_KEY is not configured" });
    }
    const { jobId } = request.params as { jobId: string };
    const jobIdError = validateJobId(jobId);
    if (jobIdError) {
      return reply.code(400).send({ error: jobIdError });
    }
    const client = new OpenRouterClient({ apiKey });
    try {
      const providerResponse = await client.getVideoJob(jobId);
      return await storeVideoJobStatus(jobId, providerResponse, config, apiKey);
    } catch (error: unknown) {
      return sendGenerationError(error, reply);
    }
  });
}

async function storeGeneratedFirstFrame(
  providerResponse: unknown,
  config: Pick<AppConfig, "storageDir">,
  publicBase: string
) {
  const imageSource = extractImageSource(providerResponse);
  if (!imageSource) {
    return {
      error: "OpenRouter 没有返回可用的图片结果。",
      providerResponse
    };
  }
  const image = await resolveImageBuffer(imageSource);
  const storedName = `${randomUUID()}.${image.extension}`;
  const assetDir = join(config.storageDir, "assets");
  const localPath = join(assetDir, storedName);
  await mkdir(assetDir, { recursive: true });
  await writeFile(localPath, image.buffer);

  return {
    fileName: "generated-first-frame.png",
    storedName,
    localPath,
    imageUrl: `/assets/${storedName}`,
    localUrl: `/assets/${storedName}`,
    publicUrl: `${publicBase.replace(/\/$/, "")}/${storedName}`,
    providerResponse
  };
}

async function storeVideoJobStatus(
  jobId: string,
  providerResponse: unknown,
  config: Pick<AppConfig, "storageDir">,
  apiKey: string
) {
  const jobDir = join(config.storageDir, "jobs", jobId);
  await mkdir(jobDir, { recursive: true });
  const status = normalizeVideoStatus(providerResponse);
  const videoUrl = extractVideoUrl(providerResponse);
  let localVideoUrl: string | undefined;
  if (status === "completed" && videoUrl) {
    const localPath = join(jobDir, "source.mp4");
    if (!existsSync(localPath)) {
      await downloadToFile(videoUrl, localPath, apiKey);
    }
    localVideoUrl = `/jobs/${jobId}/source.mp4`;
  }

  const body = {
    jobId,
    status,
    videoUrl,
    localVideoUrl,
    providerResponse
  };
  await writeFile(join(jobDir, "status.json"), JSON.stringify(body, null, 2), "utf8");
  return body;
}

function resolveOpenRouterApiKey(
  request: { headers: Record<string, string | string[] | undefined> },
  config: AppConfig
): string | undefined {
  const headerValue = request.headers["x-openrouter-api-key"];
  const requestKey = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const trimmedRequestKey = requestKey?.trim();
  if (trimmedRequestKey) {
    return trimmedRequestKey;
  }
  const configKey = config.openRouterApiKey?.trim();
  return configKey || undefined;
}

function validatePublicHttpsImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "OpenRouter 视频首帧需要公网 HTTPS 图片 URL。";
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "OpenRouter 视频首帧需要公网 HTTPS 图片 URL；当前首帧地址不是有效 URL。";
  }
  if (url.protocol !== "https:") {
    return "OpenRouter 视频首帧需要公网 HTTPS 图片 URL；当前地址不是 HTTPS，127.0.0.1 或本机 HTTP 只能用于网页预览。";
  }
  if (isLocalOrPrivateHost(url.hostname)) {
    return "OpenRouter 视频首帧需要公网 HTTPS 图片 URL；当前地址是本机或内网地址，OpenRouter 云端无法访问。";
  }
  return undefined;
}

function validateJobId(jobId: string): string | undefined {
  if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) {
    return "视频任务 ID 只能包含字母、数字、下划线和短横线。";
  }
  return undefined;
}

function normalizeVideoStatus(response: unknown): string {
  const status = findStringValue(response, ["status", "state"])?.toLowerCase();
  if (!status) {
    return "pending";
  }
  if (["completed", "complete", "succeeded", "success", "done"].includes(status)) {
    return "completed";
  }
  if (["failed", "failure", "error", "cancelled", "canceled"].includes(status)) {
    return "failed";
  }
  return status;
}

function extractImageSource(response: unknown): string | undefined {
  const direct = findStringValue(response, ["imageUrl", "image_url", "url", "b64_json"]);
  if (direct) {
    return direct;
  }
  if (!response || typeof response !== "object") {
    return undefined;
  }
  const record = response as Record<string, unknown>;
  for (const key of ["message", "image", "image_url", "result"]) {
    const nested = record[key];
    const source = extractImageSource(nested);
    if (source) {
      return source;
    }
  }
  const choices = record.choices;
  if (Array.isArray(choices)) {
    for (const choice of choices) {
      const source = extractImageSource(choice);
      if (source) {
        return source;
      }
    }
  }
  const images = record.images;
  if (Array.isArray(images)) {
    for (const image of images) {
      const source = extractImageSource(image);
      if (source) {
        return source;
      }
    }
  }
  const data = record.data;
  if (Array.isArray(data)) {
    for (const item of data) {
      const source = extractImageSource(item);
      if (source) {
        return source;
      }
    }
  }
  return undefined;
}

function extractVideoUrl(response: unknown): string | undefined {
  const direct = findStringValue(response, ["videoUrl", "video_url", "url"]);
  if (direct) {
    return direct;
  }
  if (!response || typeof response !== "object") {
    return undefined;
  }
  const record = response as Record<string, unknown>;
  const data = record.data;
  if (data) {
    const nested = extractVideoUrl(data);
    if (nested) {
      return nested;
    }
  }
  const assets = record.assets;
  if (assets && typeof assets === "object") {
    const assetRecord = assets as Record<string, unknown>;
    const video = assetRecord.video ?? assetRecord.mp4;
    if (typeof video === "string") {
      return video;
    }
  }
  const output = record.output;
  if (Array.isArray(output)) {
    return output.find((item): item is string => typeof item === "string" && item.startsWith("http"));
  }
  const unsignedUrls = record.unsigned_urls;
  if (Array.isArray(unsignedUrls)) {
    return unsignedUrls.find((item): item is string => typeof item === "string" && item.startsWith("http"));
  }
  return undefined;
}

function findStringValue(value: unknown, keys: readonly string[]): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const item = record[key];
    if (typeof item === "string" && item.trim().length > 0) {
      return item;
    }
  }
  for (const key of ["message", "image_url", "image", "data", "result"]) {
    const nested = record[key];
    const found = findStringValue(nested, keys);
    if (found) {
      return found;
    }
  }
  return undefined;
}

async function resolveImageBuffer(source: string): Promise<{ buffer: Buffer; extension: "png" | "jpg" | "webp" }> {
  if (source.startsWith("data:")) {
    return parseDataUrlImage(source);
  }
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(source) && source.length > 64) {
    return {
      buffer: Buffer.from(source, "base64"),
      extension: "png"
    };
  }
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`下载生成图片失败：${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    extension: extensionFromContentType(contentType)
  };
}

function parseDataUrlImage(source: string): { buffer: Buffer; extension: "png" | "jpg" | "webp" } {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(source);
  if (!match) {
    throw new Error("OpenRouter 返回的图片 data URL 无法解析。");
  }
  return {
    buffer: Buffer.from(match[2] ?? "", "base64"),
    extension: extensionFromContentType(match[1] ?? "image/png")
  };
}

function extensionFromContentType(contentType: string): "png" | "jpg" | "webp" {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) {
    return "jpg";
  }
  if (contentType.includes("webp")) {
    return "webp";
  }
  return "png";
}

async function downloadToFile(url: string, localPath: string, apiKey: string): Promise<void> {
  const response = await fetch(url, {
    headers: buildVideoDownloadHeaders(url, apiKey)
  });
  if (!response.ok) {
    throw new Error(`下载视频失败：${response.status}`);
  }
  await writeFile(localPath, Buffer.from(await response.arrayBuffer()));
}

function buildVideoDownloadHeaders(url: string, apiKey: string): HeadersInit | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "openrouter.ai" || parsed.hostname.endsWith(".openrouter.ai")) {
      return {
        Authorization: `Bearer ${apiKey}`
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "::1" || host.startsWith("127.")) {
    return true;
  }
  if (host.startsWith("10.") || host.startsWith("192.168.")) {
    return true;
  }
  const parts = host.split(".").map((part) => Number(part));
  const [first, second] = parts;
  return parts.length === 4 && first === 172 && second !== undefined && second >= 16 && second <= 31;
}

function sendGenerationError(error: unknown, reply: { code: (statusCode: number) => { send: (body: unknown) => unknown } }) {
  if (error instanceof OpenRouterError) {
    return reply.code(error.statusCode).send({
      error: error.message,
      providerStatus: error.statusCode
    });
  }
  throw error;
}
