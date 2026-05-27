import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import sharp from "sharp";
import { buildAnimationPrompt } from "@ai-game-workbench/core";
import {
  buildImageGenerationPayload,
  buildVideoGenerationPayload,
  OpenRouterClient
} from "../apps/server/src/providers/openRouter";
import { buildExtractFramesArgs } from "../apps/server/src/processing/ffmpeg";
import {
  applyColorKeyToBuffer,
  buildSpriteSheetFromBuffers,
  resizeNearestBuffer
} from "../apps/server/src/processing/imageProcessing";

const rootDir = resolve(import.meta.dirname, "..");
const testDir = join(rootDir, "test_api_and_image");
const outputDir = join(rootDir, "storage", `e2e-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const keyColor = "#00ff00";
const fps = 12;
const targetSize = 256;

async function main() {
  const keyContext = await loadInferenceApiKey();
  try {
    const referenceImagePath = await findReferenceImage();
    const referenceImageDataUrl = await fileToDataUrl(referenceImagePath);

    await mkdir(outputDir, { recursive: true });
    console.log(`Output: ${outputDir}`);

    const client = new OpenRouterClient({ apiKey: keyContext.apiKey });
    const firstFrameDataUrl = await generateFirstFrame(client, referenceImageDataUrl);
    const firstFramePath = join(outputDir, "first_frame_front_pixel.png");
    await writeFile(firstFramePath, decodeDataUrl(firstFrameDataUrl));
    console.log(`First frame: ${firstFramePath}`);

    const videoUrl = await generateRunningVideo(client, firstFrameDataUrl);
    const videoPath = join(outputDir, "running_front_video.mp4");
    await downloadToFile(videoUrl, videoPath);
    console.log(`Video: ${videoPath}`);

    const rawFramesDir = join(outputDir, "frames", "raw");
    const transparentFramesDir = join(outputDir, "frames", "transparent");
    const resizedFramesDir = join(outputDir, "frames", "resized");
    const exportsDir = join(outputDir, "exports");
    await mkdir(rawFramesDir, { recursive: true });
    await mkdir(transparentFramesDir, { recursive: true });
    await mkdir(resizedFramesDir, { recursive: true });
    await mkdir(exportsDir, { recursive: true });

    const rawPattern = join(rawFramesDir, "frame_%03d.png");
    await runFfmpeg(buildExtractFramesArgs({ inputPath: videoPath, outputPattern: rawPattern, fps }));

    const rawFrameNames = (await readdir(rawFramesDir))
      .filter((name) => name.endsWith(".png"))
      .sort();
    if (rawFrameNames.length === 0) {
      throw new Error("No frames were extracted from the generated video");
    }

    const resizedBuffers: Buffer[] = [];
    for (const frameName of rawFrameNames) {
      const rawPath = join(rawFramesDir, frameName);
      const transparentPath = join(transparentFramesDir, frameName);
      const resizedPath = join(resizedFramesDir, frameName);
      const raw = await readFile(rawPath);
      const transparent = await applyColorKeyToBuffer(raw, keyColor, 72);
      const resized = await resizeNearestBuffer(transparent, targetSize);
      await writeFile(transparentPath, transparent);
      await writeFile(resizedPath, resized);
      resizedBuffers.push(resized);
    }

    const spriteSheet = await buildSpriteSheetFromBuffers(resizedBuffers, {
      frameWidth: targetSize,
      frameHeight: targetSize
    });
    const sheetPath = join(exportsDir, "test_character_run_front_sheet.png");
    await writeFile(sheetPath, spriteSheet);

    const gifPath = join(exportsDir, "test_character_run_front_preview.gif");
    await runFfmpeg([
      "-y",
      "-framerate",
      String(fps),
      "-i",
      join(resizedFramesDir, "frame_%03d.png"),
      "-loop",
      "0",
      gifPath
    ]);

    const sheetMeta = await sharp(sheetPath).metadata();
    console.log(`Frames: ${rawFrameNames.length}`);
    console.log(`Sprite sheet: ${sheetPath} (${sheetMeta.width}x${sheetMeta.height})`);
    console.log(`Preview GIF: ${gifPath}`);
  } finally {
    await keyContext.cleanup?.();
  }
}

interface KeyContext {
  apiKey: string;
  cleanup?: () => Promise<void>;
}

async function loadInferenceApiKey(): Promise<KeyContext> {
  const envKey = process.env.OPENROUTER_API_KEY?.trim();
  const keyPath = join(testDir, "Openrouter_api.txt");
  const key = envKey || (await readFile(keyPath, "utf8")).trim();
  if (!key) {
    throw new Error("OpenRouter API key is empty");
  }
  return provisionInferenceKeyIfNeeded(key);
}

async function provisionInferenceKeyIfNeeded(key: string): Promise<KeyContext> {
  const authResponse = await fetch("https://openrouter.ai/api/v1/auth/key", {
    headers: { Authorization: `Bearer ${key}` }
  });
  if (!authResponse.ok) {
    throw new Error(`OpenRouter key validation failed: ${authResponse.status}`);
  }
  const auth = (await authResponse.json()) as any;
  if (!auth?.data?.is_provisioning_key) {
    return { apiKey: key };
  }

  console.log("Provisioning key detected; creating temporary limited inference key...");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const createResponse = await fetch("https://openrouter.ai/api/v1/keys", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: `ai-game-workbench-e2e-${Date.now()}`,
      limit: 3,
      expires_at: expiresAt,
      include_byok_in_limit: false
    })
  });
  const created = (await createResponse.json()) as any;
  if (!createResponse.ok || !created?.key || !created?.data?.hash) {
    throw new Error(`Failed to create temporary OpenRouter inference key: ${JSON.stringify(created).slice(0, 500)}`);
  }

  return {
    apiKey: created.key,
    cleanup: async () => {
      const deleteResponse = await fetch(
        `https://openrouter.ai/api/v1/keys/${encodeURIComponent(created.data.hash)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${key}` }
        }
      );
      if (deleteResponse.ok) {
        console.log("Temporary OpenRouter inference key deleted.");
      } else {
        console.warn(`Failed to delete temporary OpenRouter inference key: ${deleteResponse.status}`);
      }
    }
  };
}

async function findReferenceImage(): Promise<string> {
  const files = await readdir(testDir);
  const image = files.find((file) => [".png", ".jpg", ".jpeg", ".webp"].includes(extname(file).toLowerCase()));
  if (!image) {
    throw new Error(`No reference image found in ${testDir}`);
  }
  return join(testDir, image);
}

async function fileToDataUrl(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();
  const mime =
    ext === ".webp" ? "image/webp" :
    ext === ".png" ? "image/png" :
    ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
    "application/octet-stream";
  const data = await readFile(filePath);
  return `data:${mime};base64,${data.toString("base64")}`;
}

async function generateFirstFrame(client: OpenRouterClient, referenceImageDataUrl: string): Promise<string> {
  console.log("Generating front-facing square pixel-art first frame...");
  const baseInput = {
      model: process.env.OPENROUTER_IMAGE_MODEL ?? "google/gemini-2.5-flash-image",
      prompt: "adult anime heroine character with short white hair, pink eyes, black outfit with white sleeves and flower accessories",
      targetSize,
      keyColor,
      direction: "front",
      seed: 270527
  } as const;
  let response: unknown;
  try {
    response = await client.createImage(
      buildImageGenerationPayload({
        ...baseInput,
        referenceImageDataUrl
      })
    );
  } catch (error) {
    if (!String(error).includes("403")) {
      throw error;
    }
    console.log("Reference-image generation was rejected; retrying first-frame generation from text prompt only...");
    response = await client.createImage(buildImageGenerationPayload(baseInput));
  }
  const imageUrl = extractImageUrl(response);
  if (!imageUrl) {
    throw new Error(`Image generation response did not include an image URL: ${JSON.stringify(response).slice(0, 500)}`);
  }
  if (imageUrl.startsWith("data:")) {
    return imageUrl;
  }
  const downloaded = await fetch(imageUrl);
  if (!downloaded.ok) {
    throw new Error(`Failed to download generated first frame: ${downloaded.status}`);
  }
  const contentType = downloaded.headers.get("content-type") ?? "image/png";
  const bytes = Buffer.from(await downloaded.arrayBuffer());
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

async function generateRunningVideo(client: OpenRouterClient, firstFrameDataUrl: string): Promise<string> {
  console.log("Generating front-facing running video...");
  const prompt = buildAnimationPrompt({
    actionTemplate: "run",
    actionPrompt: "front-facing character runs in place with a readable loop, legs and arms moving clearly",
    keyColor
  });
  const response = await client.createVideo(
    buildVideoGenerationPayload({
      model: process.env.OPENROUTER_VIDEO_MODEL ?? "bytedance/seedance-2.0-fast",
      prompt,
      firstFrameUrl: firstFrameDataUrl,
      durationSeconds: 4
    })
  );
  const jobId = extractJobId(response);
  if (!jobId) {
    const directUrl = extractVideoUrl(response);
    if (directUrl) {
      return directUrl;
    }
    throw new Error(`Video generation response did not include a job ID: ${JSON.stringify(response).slice(0, 500)}`);
  }

  for (let attempt = 1; attempt <= 120; attempt++) {
    await sleep(10_000);
    const job = await client.getVideoJob(jobId);
    const status = extractStatus(job);
    console.log(`Video job ${jobId}: ${status ?? "unknown"} (${attempt}/120)`);
    if (status === "failed") {
      throw new Error(`Video job failed: ${JSON.stringify(job).slice(0, 1000)}`);
    }
    const videoUrl = extractVideoUrl(job);
    if (videoUrl) {
      return videoUrl;
    }
  }

  throw new Error("Video job timed out before returning a downloadable URL");
}

function extractImageUrl(response: unknown): string | undefined {
  const anyResponse = response as any;
  return (
    anyResponse?.choices?.[0]?.message?.images?.[0]?.image_url?.url ??
    anyResponse?.choices?.[0]?.message?.images?.[0]?.imageUrl?.url ??
    anyResponse?.choices?.[0]?.message?.image_url?.url ??
    anyResponse?.choices?.[0]?.message?.imageUrl?.url ??
    anyResponse?.data?.[0]?.url
  );
}

function extractJobId(response: unknown): string | undefined {
  const anyResponse = response as any;
  return anyResponse?.id ?? anyResponse?.job_id ?? anyResponse?.data?.id ?? anyResponse?.data?.job_id;
}

function extractStatus(response: unknown): string | undefined {
  const anyResponse = response as any;
  return anyResponse?.status ?? anyResponse?.data?.status;
}

function extractVideoUrl(response: unknown): string | undefined {
  const anyResponse = response as any;
  return (
    anyResponse?.output?.url ??
    anyResponse?.output?.[0]?.url ??
    anyResponse?.video_url ??
    anyResponse?.url ??
    anyResponse?.data?.output?.url ??
    anyResponse?.data?.output?.[0]?.url ??
    anyResponse?.data?.video_url ??
    anyResponse?.data?.url ??
    anyResponse?.assets?.video ??
    anyResponse?.data?.assets?.video
  );
}

async function downloadToFile(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  await writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
}

function decodeDataUrl(dataUrl: string): Buffer {
  const base64 = dataUrl.split(",", 2)[1];
  if (!base64) {
    throw new Error("Invalid data URL");
  }
  return Buffer.from(base64, "base64");
}

async function runFfmpeg(args: readonly string[]): Promise<void> {
  const ffmpegPath = ffmpegStatic;
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static did not provide a binary path");
  }
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(ffmpegPath, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`ffmpeg exited with ${code}: ${stderr}`));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
