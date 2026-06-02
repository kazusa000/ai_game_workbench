import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import {
  type BuildImageGenerationPayloadInput,
  buildImageGenerationPayload,
  buildVideoGenerationPayload,
  OpenRouterError,
  OpenRouterClient
} from "../providers/openRouter";
import {
  buildOpenAiImagesGenerationPayload,
  OpenAiImagesClient,
  OpenAiImagesError
} from "../providers/openAiImages";
import {
  generateLocalCodexImage,
  isLocalCodexImageModel,
  type LocalCodexImageGenerationInput,
  type LocalCodexImageGenerationResult
} from "../providers/localCodex";
import type { AppConfig } from "../config";
import { resolvePublicAssetBaseUrl, resolvePublicServerBaseUrl } from "./assets";
import {
  ensureCharacterFolder,
  removeCharacterFilesByStem,
  resolveCharacterPath,
  toCharacterUrl
} from "../characterStorage";
import {
  getModule01ReferenceImageUrl,
  readModule01ReferenceImageBuffer,
  resolveModule01ReferenceImagePath
} from "../referenceImages";
import {
  resolveGenerationProviderModel,
  resolveOpenRouterVideoProvider
} from "../providerSettings";

const BUILT_IN_STYLE_REFERENCE_CONTENT_TYPE = "image/png";

const DIRECTION_REFERENCES = {
  idle: {
    path: getModule01ReferenceImageUrl("idle")
  },
  walk: {
    path: getModule01ReferenceImageUrl("walk")
  },
  run: {
    path: getModule01ReferenceImageUrl("run")
  }
} as const;
type DirectionTemplateKind = keyof typeof DIRECTION_REFERENCES;
type AdvancedActionKind = "run" | "attack-1" | "jump";

interface DirectionTemplateGenerationInput {
  templateKind?: string;
  model: string;
  prompt: string;
  targetSize: number;
  keyColor: string;
  characterTemplateImageDataUrl?: string;
  seed?: number;
}

interface AdvancedActionMidframeGenerationInput {
  actionKind?: string;
  model: string;
  prompt: string;
  targetSize: number;
  keyColor: string;
  startFrameImageDataUrl?: string;
  seed?: number;
}

export function registerGenerationRoutes(app: FastifyInstance, config: AppConfig): void {
  app.post("/api/generation/first-frame/payload", async (request) => {
    return buildImageGenerationPayload(
      await withBuiltInStyleReference(request.body as Parameters<typeof buildImageGenerationPayload>[0], config)
    );
  });

  app.get(getModule01ReferenceImageUrl("style"), async (_request, reply) => {
    const buffer = await readBuiltInStyleReferenceBuffer(config);
    return reply.header("Content-Type", BUILT_IN_STYLE_REFERENCE_CONTENT_TYPE).send(buffer);
  });

  for (const [kind, reference] of Object.entries(DIRECTION_REFERENCES) as [DirectionTemplateKind, typeof DIRECTION_REFERENCES[DirectionTemplateKind]][]) {
    app.get(reference.path, async (_request, reply) => {
      const buffer = await readBuiltInDirectionReferenceBuffer(kind, config);
      return reply.header("Content-Type", BUILT_IN_STYLE_REFERENCE_CONTENT_TYPE).send(buffer);
    });
  }

  app.post("/api/generation/direction-template/payload", async (request, reply) => {
    const input = await buildDirectionTemplatePayloadInput(request.body as DirectionTemplateGenerationInput, config);
    if ("error" in input) {
      return reply.code(400).send({ error: input.error });
    }
    return buildImageGenerationPayload(input);
  });

  app.post("/api/generation/video/payload", async (request) => {
    return buildVideoGenerationPayload(request.body as Parameters<typeof buildVideoGenerationPayload>[0]);
  });

  app.post("/api/generation/first-frame", async (request, reply) => {
    const requestBody = request.body as Parameters<typeof buildImageGenerationPayload>[0];
    const publicBaseResult = resolvePublicAssetBaseUrl(request.headers["x-public-asset-base-url"], config);
    if ("error" in publicBaseResult) {
      return reply.code(400).send({ error: publicBaseResult.error });
    }
    const resolvedModel = await resolveGenerationProviderModel(config, requestBody.model, "image");
    if ("error" in resolvedModel) {
      return reply.code(resolvedModel.statusCode).send({ error: resolvedModel.error });
    }
    const resolvedRequestBody = {
      ...requestBody,
      model: resolvedModel.model.upstreamModel
    };
    if (resolvedModel.provider.kind === "local-codex" || isLocalCodexImageModel(resolvedRequestBody.model)) {
      try {
        const localResult = await runLocalCodexFirstFrameGeneration(resolvedRequestBody, config);
        return await storeGeneratedFirstFrame(
          localCodexResultToProviderResponse(localResult),
          config,
          publicBaseResult.publicBase,
          {
            characterId: readCharacterId(request.body) ?? readCharacterId(request.headers),
            characterTarget: "base-template-output",
            publicServerBase: resolvePublicServerBaseUrl(request.headers["x-public-asset-base-url"], config)
          }
        );
      } catch (error: unknown) {
        return sendGenerationError(error, reply);
      }
    }
    const apiKey = resolvedModel.apiKey ?? "";
    try {
      const input = await withBuiltInStyleReference(resolvedRequestBody, config);
      const providerResponse = resolvedModel.provider.kind === "openai-images"
        ? await new OpenAiImagesClient({ apiKey, baseUrl: resolvedModel.baseUrl ?? "" })
          .createImage(buildOpenAiImagesGenerationPayload(input))
        : await new OpenRouterClient({ apiKey, baseUrl: resolvedModel.baseUrl })
          .createImage(buildImageGenerationPayload(input));
      return await storeGeneratedFirstFrame(providerResponse, config, publicBaseResult.publicBase, {
        apiKey,
        characterId: readCharacterId(request.body) ?? readCharacterId(request.headers),
        characterTarget: "base-template-output",
        publicServerBase: resolvePublicServerBaseUrl(request.headers["x-public-asset-base-url"], config)
      });
    } catch (error: unknown) {
      return sendGenerationError(error, reply);
    }
  });

  app.post("/api/generation/direction-template", async (request, reply) => {
    const requestBody = request.body as DirectionTemplateGenerationInput;
    const publicBaseResult = resolvePublicAssetBaseUrl(request.headers["x-public-asset-base-url"], config);
    if ("error" in publicBaseResult) {
      return reply.code(400).send({ error: publicBaseResult.error });
    }
    const resolvedModel = await resolveGenerationProviderModel(config, requestBody.model, "image");
    if ("error" in resolvedModel) {
      return reply.code(resolvedModel.statusCode).send({ error: resolvedModel.error });
    }
    const resolvedRequestBody = {
      ...requestBody,
      model: resolvedModel.model.upstreamModel
    };
    const input = await buildDirectionTemplatePayloadInput(resolvedRequestBody, config);
    if ("error" in input) {
      return reply.code(400).send({ error: input.error });
    }
    if (resolvedModel.provider.kind === "local-codex" || isLocalCodexImageModel(resolvedRequestBody.model)) {
      try {
        const templateKind = requestBody.templateKind as DirectionTemplateKind;
        const characterId = readCharacterId(request.body) ?? readCharacterId(request.headers);
        const localResult = await runLocalCodexDirectionTemplateGeneration(resolvedRequestBody, config);
        const result = await storeGeneratedFirstFrame(
          localCodexResultToProviderResponse(localResult),
          config,
          publicBaseResult.publicBase,
          {
            fileName: `generated-${templateKind}-4dir.png`,
            characterId,
            characterTarget: getDirectionTemplateCharacterTarget(templateKind),
            publicServerBase: resolvePublicServerBaseUrl(request.headers["x-public-asset-base-url"], config)
          }
        );
        if (templateKind === "walk" && characterId && !("error" in result)) {
          await removeCharacterFilesByStem(config.storageDir, characterId, ["base-character", "direction-templates"], "idle-4dir");
        }
        return result;
      } catch (error: unknown) {
        return sendGenerationError(error, reply);
      }
    }
    const apiKey = resolvedModel.apiKey ?? "";
    try {
      const templateKind = requestBody.templateKind as DirectionTemplateKind;
      const characterId = readCharacterId(request.body) ?? readCharacterId(request.headers);
      const providerResponse = resolvedModel.provider.kind === "openai-images"
        ? await new OpenAiImagesClient({ apiKey, baseUrl: resolvedModel.baseUrl ?? "" })
          .createImage(buildOpenAiImagesGenerationPayload(input))
        : await new OpenRouterClient({ apiKey, baseUrl: resolvedModel.baseUrl })
          .createImage(buildImageGenerationPayload(input));
      const result = await storeGeneratedFirstFrame(
        providerResponse,
        config,
        publicBaseResult.publicBase,
        {
          apiKey,
          fileName: `generated-${templateKind}-4dir.png`,
          characterId,
          characterTarget: getDirectionTemplateCharacterTarget(templateKind),
          publicServerBase: resolvePublicServerBaseUrl(request.headers["x-public-asset-base-url"], config)
        }
      );
      if (templateKind === "walk" && characterId && !("error" in result)) {
        await removeCharacterFilesByStem(config.storageDir, characterId, ["base-character", "direction-templates"], "idle-4dir");
      }
      return result;
    } catch (error: unknown) {
      return sendGenerationError(error, reply);
    }
  });

  app.post("/api/generation/advanced-action-midframe", async (request, reply) => {
    const requestBody = request.body as AdvancedActionMidframeGenerationInput;
    const publicBaseResult = resolvePublicAssetBaseUrl(request.headers["x-public-asset-base-url"], config);
    if ("error" in publicBaseResult) {
      return reply.code(400).send({ error: publicBaseResult.error });
    }
    const input = buildAdvancedActionMidframePayloadInput(requestBody);
    if ("error" in input) {
      return reply.code(400).send({ error: input.error });
    }
    const characterId = readCharacterId(request.body) ?? readCharacterId(request.headers);
    if (!characterId) {
      return reply.code(400).send({ error: "characterId is required" });
    }
    const resolvedModel = await resolveGenerationProviderModel(config, requestBody.model, "image");
    if ("error" in resolvedModel) {
      return reply.code(resolvedModel.statusCode).send({ error: resolvedModel.error });
    }
    const resolvedRequestBody = {
      ...requestBody,
      model: resolvedModel.model.upstreamModel
    };
    if (resolvedModel.provider.kind === "local-codex" || isLocalCodexImageModel(resolvedRequestBody.model)) {
      try {
        const localResult = await runLocalCodexAdvancedActionMidframeGeneration(resolvedRequestBody, config);
        return await storeGeneratedFirstFrame(
          localCodexResultToProviderResponse(localResult),
          config,
          publicBaseResult.publicBase,
          {
            fileName: "middle-4dir.png",
            characterId,
            characterTarget: "attack-middle-4dir",
            publicServerBase: resolvePublicServerBaseUrl(request.headers["x-public-asset-base-url"], config)
          }
        );
      } catch (error: unknown) {
        return sendGenerationError(error, reply);
      }
    }
    const apiKey = resolvedModel.apiKey ?? "";
    try {
      const providerResponse = resolvedModel.provider.kind === "openai-images"
        ? await new OpenAiImagesClient({ apiKey, baseUrl: resolvedModel.baseUrl ?? "" })
          .createImage(buildOpenAiImagesGenerationPayload({
            ...input,
            model: resolvedRequestBody.model
          }))
        : await new OpenRouterClient({ apiKey, baseUrl: resolvedModel.baseUrl })
          .createImage(buildImageGenerationPayload({
            ...input,
            model: resolvedRequestBody.model
          }));
      return await storeGeneratedFirstFrame(
        providerResponse,
        config,
        publicBaseResult.publicBase,
        {
          apiKey,
          fileName: "middle-4dir.png",
          characterId,
          characterTarget: "attack-middle-4dir",
          publicServerBase: resolvePublicServerBaseUrl(request.headers["x-public-asset-base-url"], config)
        }
      );
    } catch (error: unknown) {
      return sendGenerationError(error, reply);
    }
  });

  app.post("/api/generation/video", async (request, reply) => {
    const input = request.body as Parameters<typeof buildVideoGenerationPayload>[0];
    const resolvedModel = await resolveGenerationProviderModel(config, input.model, "video");
    if ("error" in resolvedModel) {
      return reply.code(resolvedModel.statusCode).send({ error: resolvedModel.error });
    }
    if (resolvedModel.provider.kind !== "openrouter") {
      return reply.code(400).send({ error: "Only OpenRouter video models are supported" });
    }
    const apiKey = resolvedModel.apiKey ?? "";
    const urlError = validatePublicHttpsImageUrl(input.firstFrameUrl);
    if (urlError) {
      return reply.code(400).send({ error: urlError });
    }
    const imageAccessError = await validatePublicImageUrlContent(input.firstFrameUrl);
    if (imageAccessError) {
      return reply.code(400).send({ error: imageAccessError });
    }
    const imageUrls = [
      ...(input.lastFrameUrl ? [input.lastFrameUrl] : []),
      ...(input.inputReferenceUrls ?? [])
    ].map((url) => url.trim()).filter((url) => url.length > 0);
    for (const imageUrl of imageUrls) {
      const referenceUrlError = validatePublicHttpsImageUrl(imageUrl);
      if (referenceUrlError) {
        return reply.code(400).send({ error: `参考图 URL 不可用：${referenceUrlError}` });
      }
      const referenceAccessError = await validatePublicImageUrlContent(imageUrl);
      if (referenceAccessError) {
        return reply.code(400).send({ error: `参考图无法访问：${referenceAccessError}` });
      }
    }
    const client = new OpenRouterClient({ apiKey, baseUrl: resolvedModel.baseUrl });
    try {
      return await client.createVideo(buildVideoGenerationPayload({
        ...input,
        model: resolvedModel.model.upstreamModel
      }));
    } catch (error: unknown) {
      return sendGenerationError(error, reply);
    }
  });

  app.get("/api/generation/video/:jobId", async (request, reply) => {
    const provider = await resolveOpenRouterVideoProvider(config);
    if ("error" in provider) {
      return reply.code(provider.statusCode).send({ error: provider.error });
    }
    const { jobId } = request.params as { jobId: string };
    const jobIdError = validateJobId(jobId);
    if (jobIdError) {
      return reply.code(400).send({ error: jobIdError });
    }
    const client = new OpenRouterClient({ apiKey: provider.apiKey, baseUrl: provider.baseUrl });
    try {
      const providerResponse = await client.getVideoJob(jobId);
      return await storeVideoJobStatus(jobId, providerResponse, config, provider.apiKey, {
        characterId: readCharacterId(request.query) ?? readCharacterId(request.headers),
        actionKind: readActionKind(request.query) ?? readActionKind(request.headers)
      });
    } catch (error: unknown) {
      return sendGenerationError(error, reply);
    }
  });
}

async function withBuiltInStyleReference(
  input: Parameters<typeof buildImageGenerationPayload>[0],
  config: Pick<AppConfig, "storageDir">
): Promise<Parameters<typeof buildImageGenerationPayload>[0]> {
  if (input.styleReferenceImageDataUrl) {
    return input;
  }
  return {
    ...input,
    styleReferenceImageDataUrl: await readBuiltInStyleReferenceDataUrl(config)
  };
}

async function readBuiltInStyleReferenceDataUrl(config: Pick<AppConfig, "storageDir">): Promise<string> {
  const buffer = await readBuiltInStyleReferenceBuffer(config);
  return `data:${BUILT_IN_STYLE_REFERENCE_CONTENT_TYPE};base64,${buffer.toString("base64")}`;
}

async function readBuiltInStyleReferenceBuffer(config: Pick<AppConfig, "storageDir">): Promise<Buffer> {
  return readModule01ReferenceImageBuffer(config.storageDir, "style");
}

async function buildDirectionTemplatePayloadInput(
  input: DirectionTemplateGenerationInput,
  config: Pick<AppConfig, "storageDir">
): Promise<BuildImageGenerationPayloadInput | { error: string }> {
  if (!isDirectionTemplateKind(input.templateKind)) {
    return { error: "templateKind must be idle, walk, or run" };
  }
  if (!input.characterTemplateImageDataUrl) {
    return { error: "characterTemplateImageDataUrl is required" };
  }
  return {
    model: input.model,
    prompt: input.prompt,
    targetSize: input.targetSize,
    keyColor: input.keyColor,
    seed: input.seed,
    imageDataUrls: [
      input.characterTemplateImageDataUrl,
      await readBuiltInDirectionReferenceDataUrl(input.templateKind, config)
    ]
  };
}

function buildAdvancedActionMidframePayloadInput(
  input: AdvancedActionMidframeGenerationInput
): BuildImageGenerationPayloadInput | { error: string } {
  if (input.actionKind !== "attack-1") {
    return { error: "actionKind must be attack-1" };
  }
  if (!input.startFrameImageDataUrl) {
    return { error: "startFrameImageDataUrl is required" };
  }
  return {
    model: input.model,
    prompt: input.prompt,
    targetSize: input.targetSize,
    keyColor: input.keyColor,
    seed: input.seed,
    imageDataUrls: [
      input.startFrameImageDataUrl
    ]
  };
}

async function runLocalCodexFirstFrameGeneration(
  input: BuildImageGenerationPayloadInput,
  config: AppConfig
): Promise<LocalCodexImageGenerationResult> {
  const imageSources = input.imageDataUrls
    ? input.imageDataUrls.map((dataUrl) => ({ dataUrl }))
    : [
        input.styleReferenceImageDataUrl
          ? { dataUrl: input.styleReferenceImageDataUrl }
          : { filePath: resolveModule01ReferenceImagePath(config.storageDir, "style") },
        input.referenceImageDataUrl ? { dataUrl: input.referenceImageDataUrl } : undefined
      ];
  return withLocalCodexImageSources(
    imageSources,
    async (imagePaths) => runLocalCodexImageGeneration({
      model: input.model,
      prompt: input.prompt,
      targetSize: input.targetSize,
      keyColor: input.keyColor,
      imagePaths,
      workingDirectory: process.cwd()
    }, config)
  );
}

async function runLocalCodexDirectionTemplateGeneration(
  input: DirectionTemplateGenerationInput,
  config: AppConfig
): Promise<LocalCodexImageGenerationResult> {
  if (!isDirectionTemplateKind(input.templateKind)) {
    throw new Error("templateKind must be idle, walk, or run");
  }
  if (!input.characterTemplateImageDataUrl) {
    throw new Error("characterTemplateImageDataUrl is required");
  }
  return withLocalCodexImageSources(
    [
      { dataUrl: input.characterTemplateImageDataUrl },
      { filePath: resolveModule01ReferenceImagePath(config.storageDir, input.templateKind) }
    ],
    async (imagePaths) => runLocalCodexImageGeneration({
      model: input.model,
      prompt: input.prompt,
      targetSize: input.targetSize,
      keyColor: input.keyColor,
      imagePaths,
      workingDirectory: process.cwd()
    }, config)
  );
}

async function runLocalCodexAdvancedActionMidframeGeneration(
  input: AdvancedActionMidframeGenerationInput,
  config: AppConfig
): Promise<LocalCodexImageGenerationResult> {
  if (input.actionKind !== "attack-1") {
    throw new Error("actionKind must be attack-1");
  }
  if (!input.startFrameImageDataUrl) {
    throw new Error("startFrameImageDataUrl is required");
  }
  return withLocalCodexImageSources(
    [
      { dataUrl: input.startFrameImageDataUrl }
    ],
    async (imagePaths) => runLocalCodexImageGeneration({
      model: input.model,
      prompt: input.prompt,
      targetSize: input.targetSize,
      keyColor: input.keyColor,
      imagePaths,
      workingDirectory: process.cwd()
    }, config)
  );
}

async function runLocalCodexImageGeneration(
  input: LocalCodexImageGenerationInput,
  config: AppConfig
): Promise<LocalCodexImageGenerationResult> {
  const generator = config.localCodexImageGenerator ?? generateLocalCodexImage;
  return generator(input);
}

type LocalCodexImageSource = { dataUrl: string } | { filePath: string } | undefined;

async function withLocalCodexImageSources<T>(
  sources: readonly LocalCodexImageSource[],
  callback: (imagePaths: string[]) => Promise<T>
): Promise<T> {
  const tempDir = await mkdtemp(join(tmpdir(), "ai-game-workbench-local-codex-input-"));
  try {
    const imagePaths: string[] = [];
    for (const source of sources) {
      if (!source) {
        continue;
      }
      if ("filePath" in source) {
        imagePaths.push(source.filePath);
      } else if (source.dataUrl.trim()) {
        imagePaths.push(await writeDataUrlImageToTempFile(source.dataUrl, tempDir, imagePaths.length));
      }
    }
    return await callback(imagePaths);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeDataUrlImageToTempFile(dataUrl: string, tempDir: string, index: number): Promise<string> {
  const image = parseDataUrlImage(dataUrl);
  const filePath = join(tempDir, `input-${index}.${image.extension}`);
  await writeFile(filePath, image.buffer);
  return filePath;
}

function localCodexResultToProviderResponse(result: LocalCodexImageGenerationResult): Record<string, unknown> {
  return {
    ...result.providerResponse,
    imageUrl: `data:image/${result.extension};base64,${result.buffer.toString("base64")}`
  };
}

function isDirectionTemplateKind(kind: string | undefined): kind is DirectionTemplateKind {
  return kind === "idle" || kind === "walk" || kind === "run";
}

function getDirectionTemplateCharacterTarget(kind: DirectionTemplateKind): CharacterImageTarget {
  if (kind === "idle") {
    return "idle-4dir";
  }
  if (kind === "run") {
    return "run-4dir";
  }
  return "walk-4dir";
}

async function readBuiltInDirectionReferenceDataUrl(
  kind: DirectionTemplateKind,
  config: Pick<AppConfig, "storageDir">
): Promise<string> {
  const buffer = await readBuiltInDirectionReferenceBuffer(kind, config);
  return `data:${BUILT_IN_STYLE_REFERENCE_CONTENT_TYPE};base64,${buffer.toString("base64")}`;
}

async function readBuiltInDirectionReferenceBuffer(
  kind: DirectionTemplateKind,
  config: Pick<AppConfig, "storageDir">
): Promise<Buffer> {
  return readModule01ReferenceImageBuffer(config.storageDir, kind);
}

async function storeGeneratedFirstFrame(
  providerResponse: unknown,
  config: Pick<AppConfig, "storageDir">,
  publicBase: string,
  options: {
    fileName?: string;
    apiKey?: string;
    characterId?: string;
    characterTarget?: CharacterImageTarget;
    publicServerBase?: { publicBase: string; error?: undefined } | { publicBase?: undefined; error: string };
  } = {}
) {
  const imageSource = extractImageSource(providerResponse);
  if (!imageSource) {
    return {
      error: "OpenRouter 没有返回可用的图片结果。",
      providerResponse
    };
  }
  const image = await resolveImageBuffer(imageSource, options.apiKey);
  if (options.characterId) {
    if (options.publicServerBase && "error" in options.publicServerBase) {
      return { error: options.publicServerBase.error };
    }
    const target = resolveCharacterImageTarget(options.characterTarget);
    await ensureCharacterFolder(config.storageDir, options.characterId);
    await removeCharacterFilesByStem(config.storageDir, options.characterId, target.directory, target.stem);
    const storedName = `${target.stem}.${image.extension}`;
    const directory = resolveCharacterPath(config.storageDir, options.characterId, ...target.directory);
    const localPath = resolveCharacterPath(config.storageDir, options.characterId, ...target.directory, storedName);
    await mkdir(directory, { recursive: true });
    await writeFile(localPath, image.buffer);
    const localUrl = toCharacterUrl(options.characterId, ...target.directory, storedName);
    return {
      fileName: target.fileName,
      storedName,
      localPath,
      imageUrl: localUrl,
      localUrl,
      publicUrl: `${options.publicServerBase?.publicBase ?? publicBase.replace(/\/assets$/, "")}${localUrl}`,
      providerResponse
    };
  }
  const storedName = `${randomUUID()}.${image.extension}`;
  const assetDir = join(config.storageDir, "assets");
  const localPath = join(assetDir, storedName);
  await mkdir(assetDir, { recursive: true });
  await writeFile(localPath, image.buffer);

  return {
    fileName: options.fileName ?? "generated-first-frame.png",
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
  apiKey: string,
  options: {
    characterId?: string;
    actionKind?: AdvancedActionKind;
  } | string | undefined
) {
  const resolvedOptions = typeof options === "string" ? { characterId: options } : options ?? {};
  const { characterId, actionKind } = resolvedOptions;
  const videoDirectory = actionKind
    ? ["advanced-character", actionKind, "video"]
    : ["base-character", "walk-video"];
  const jobDir = characterId
    ? resolveCharacterPath(config.storageDir, characterId, ...videoDirectory)
    : join(config.storageDir, "jobs", jobId);
  await mkdir(jobDir, { recursive: true });
  const status = normalizeVideoStatus(providerResponse);
  const videoUrl = extractVideoUrl(providerResponse);
  let localVideoUrl: string | undefined;
  if (status === "completed" && videoUrl) {
    const localPath = join(jobDir, "source.mp4");
    if (!existsSync(localPath) || characterId) {
      await downloadToFile(videoUrl, localPath, apiKey);
    }
    localVideoUrl = characterId
      ? toCharacterUrl(characterId, ...videoDirectory, "source.mp4")
      : `/jobs/${jobId}/source.mp4`;
  }

  const body = {
    jobId,
    status,
    videoUrl,
    localVideoUrl,
    providerResponse
  };
  return body;
}

type CharacterImageTarget = "base-template-output" | "idle-4dir" | "walk-4dir" | "run-4dir" | "attack-middle-4dir";

function resolveCharacterImageTarget(target: CharacterImageTarget | undefined): {
  directory: string[];
  stem: string;
  fileName: string;
} {
  if (target === "idle-4dir") {
    return { directory: ["base-character", "direction-templates"], stem: "idle-4dir", fileName: "idle-4dir.png" };
  }
  if (target === "walk-4dir") {
    return { directory: ["base-character", "direction-templates"], stem: "walk-4dir", fileName: "walk-4dir.png" };
  }
  if (target === "run-4dir") {
    return { directory: ["advanced-character", "run"], stem: "keyframe-4dir", fileName: "run-4dir.png" };
  }
  if (target === "attack-middle-4dir") {
    return { directory: ["advanced-character", "attack-1", "midframe"], stem: "middle-4dir", fileName: "middle-4dir.png" };
  }
  return { directory: ["base-template"], stem: "output", fileName: "output.png" };
}

function readCharacterId(input: unknown): string | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const value = (input as { characterId?: unknown }).characterId;
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  const headerValue = (input as { "x-character-id"?: unknown })["x-character-id"];
  if (typeof headerValue === "string" && headerValue.trim()) {
    return decodeCharacterHeaderValue(headerValue.trim());
  }
  if (Array.isArray(headerValue) && typeof headerValue[0] === "string" && headerValue[0].trim()) {
    return decodeCharacterHeaderValue(headerValue[0].trim());
  }
  return undefined;
}

function readActionKind(input: unknown): AdvancedActionKind | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const value = (input as { actionKind?: unknown }).actionKind;
  if (typeof value === "string" && isAdvancedActionKind(value.trim())) {
    return value.trim() as AdvancedActionKind;
  }
  const headerValue = (input as { "x-character-action-kind"?: unknown })["x-character-action-kind"];
  if (typeof headerValue === "string" && isAdvancedActionKind(headerValue.trim())) {
    return headerValue.trim() as AdvancedActionKind;
  }
  if (Array.isArray(headerValue) && typeof headerValue[0] === "string" && isAdvancedActionKind(headerValue[0].trim())) {
    return headerValue[0].trim() as AdvancedActionKind;
  }
  return undefined;
}

function isAdvancedActionKind(value: string): value is AdvancedActionKind {
  return value === "run" || value === "attack-1" || value === "jump";
}

function decodeCharacterHeaderValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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

async function validatePublicImageUrlContent(value: string): Promise<string | undefined> {
  let response: Response;
  try {
    response = await fetch(value, { method: "GET" });
  } catch (error: unknown) {
    return `公网图片 URL 无法访问，视频模型也无法读取首帧：${error instanceof Error ? error.message : String(error)}`;
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!response.ok) {
    const preview = await readResponsePreview(response);
    return [
      `公网图片 URL 无法访问，HTTP ${response.status}。`,
      preview ? `返回内容：${preview}` : ""
    ].filter(Boolean).join(" ");
  }

  if (!contentType.startsWith("image/")) {
    const preview = await readResponsePreview(response);
    return [
      `公网图片 URL 返回的不是图片（Content-Type: ${contentType || "未知"}）。`,
      preview ? `返回内容：${preview}` : "",
      preview.includes("ERR_NGROK_6024") ? "检测到 ngrok 免费警告页，请换成可被模型直接读取的图片直链。" : ""
    ].filter(Boolean).join(" ");
  }

  await response.body?.cancel();
  return undefined;
}

async function readResponsePreview(response: Response): Promise<string> {
  try {
    return (await response.text()).replace(/\s+/g, " ").trim().slice(0, 220);
  } catch {
    return "";
  }
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

async function resolveImageBuffer(source: string, apiKey?: string): Promise<{ buffer: Buffer; extension: "png" | "jpg" | "webp" }> {
  if (source.startsWith("data:")) {
    return parseDataUrlImage(source);
  }
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(source) && source.length > 64) {
    return {
      buffer: Buffer.from(source, "base64"),
      extension: "png"
    };
  }
  const response = await fetch(source, {
    headers: buildProviderDownloadHeaders(source, apiKey)
  });
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
    headers: buildProviderDownloadHeaders(url, apiKey)
  });
  if (!response.ok) {
    throw new Error(`下载视频失败：${response.status}`);
  }
  await writeFile(localPath, Buffer.from(await response.arrayBuffer()));
}

function buildProviderDownloadHeaders(url: string, apiKey?: string): HeadersInit | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "openrouter.ai" || parsed.hostname.endsWith(".openrouter.ai")) {
      return apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
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
  if (error instanceof OpenAiImagesError) {
    return reply.code(error.statusCode).send({
      error: error.message,
      providerStatus: error.statusCode
    });
  }
  return reply.code(500).send({
    error: error instanceof Error ? error.message : String(error)
  });
}
