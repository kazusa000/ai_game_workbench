import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import type { FastifyInstance } from "fastify";
import { findPixelSpriteAction, PIXEL_SPRITE_ACTIONS } from "@ai-game-workbench/core";
import {
  buildSpriteSheetGenerationPayload,
  OpenRouterClient,
  OpenRouterError
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
import { resolvePublicServerBaseUrl } from "./assets";
import { resolveGenerationProviderModel } from "../providerSettings";
import type { ProviderRequestAuth } from "../providerSettings";
import { readModule02ActionReferenceBuffer } from "../module02ActionReferences";
import { readModule02WorkflowConfig } from "./workflowConfig";
import {
  createPixelCharacterFolder,
  deletePixelCharacterFolder,
  ensurePixelCharacterFolder,
  listPixelCharacterFolders,
  removePixelCharacterFilesByStem,
  resolvePixelCharacterPath,
  toPixelCharacterUrl
} from "../pixelCharacterStorage";
import {
  sliceSpriteSheetBuffer,
  type SlicedSpriteFrame
} from "../processing/imageProcessing";

type Module02RouteConfig = Pick<AppConfig, "storageDir" | "presetsDir" | "openRouterApiKey" | "openAiCompatibleBaseUrl" | "openAiCompatibleApiKey" | "publicAssetBaseUrl" | "port" | "module01CharacterExportDir" | "localCodexImageGenerator">;
type PixelAssetKind = "character-reference" | "base-template" | "walk-template";
type PixelSliceKind = "idle" | "walk";

interface PixelCharacterAssetFile {
  fileName: string;
  url: string;
}

interface PixelFrameRecord {
  row: number;
  index: number;
  url: string;
}

interface SpriteSheetGenerationRequest {
  actionId?: string;
  model?: string;
  constraintPrompt?: string;
  customPrompt?: string;
  keyColor?: string;
  characterReferenceDataUrl?: string;
  characterReferenceStoredName?: string;
  characterReferenceUrl?: string;
  pixelCharacterId?: string;
  seed?: number;
}

export function registerModule02Routes(app: FastifyInstance, config: Module02RouteConfig): void {
  app.get("/api/module02/characters", async () => ({
    characters: await listPixelCharacterFolders(config.storageDir)
  }));

  app.post("/api/module02/characters", async (request, reply) => {
    const input = request.body as { name?: string };
    try {
      const character = await createPixelCharacterFolder(config.storageDir, input.name ?? "");
      return reply.code(201).send(character);
    } catch (error: unknown) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "像素角色文件夹创建失败。" });
    }
  });

  app.delete("/api/module02/characters/:characterId", async (request, reply) => {
    const { characterId } = request.params as { characterId?: string };
    try {
      const character = await deletePixelCharacterFolder(config.storageDir, characterId ?? "");
      return { deleted: true, character };
    } catch (error: unknown) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "像素角色文件夹删除失败。" });
    }
  });

  app.get("/api/module02/characters/:characterId/assets", async (request, reply) => {
    const { characterId } = request.params as { characterId?: string };
    try {
      const id = characterId ?? "";
      await ensurePixelCharacterFolder(config.storageDir, id);
      return {
        characterId: id,
        assets: await buildPixelCharacterAssets(config.storageDir, id)
      };
    } catch (error: unknown) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "像素角色文件加载失败。" });
    }
  });

  app.post("/api/module02/characters/:characterId/assets/:kind", async (request, reply) => {
    const { characterId, kind } = request.params as { characterId?: string; kind?: string };
    const target = resolvePixelAssetTarget(kind);
    if (!target) {
      return reply.code(400).send({ error: "像素角色资源类型必须是 character-reference、base-template 或 walk-template。" });
    }
    const publicRoot = resolvePublicServerBaseUrl(request.headers["x-public-asset-base-url"], config);
    if ("error" in publicRoot) {
      return reply.code(400).send({ error: publicRoot.error });
    }
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: "file is required" });
    }
    if (!file.mimetype.startsWith("image/")) {
      return reply.code(400).send({ error: "only image files are supported" });
    }
    try {
      const id = characterId ?? "";
      await ensurePixelCharacterFolder(config.storageDir, id);
      await removePixelCharacterFilesByStem(config.storageDir, id, target.directory, target.stem);
      const storedName = `${target.stem}${getImageExtension(file.filename, file.mimetype)}`;
      const directory = resolvePixelCharacterPath(config.storageDir, id, ...target.directory);
      const localPath = resolvePixelCharacterPath(config.storageDir, id, ...target.directory, storedName);
      await mkdir(directory, { recursive: true });
      await writeFile(localPath, await file.toBuffer());
      const localUrl = toPixelCharacterUrl(id, ...target.directory, storedName);
      return {
        fileName: file.filename,
        storedName,
        localPath,
        localUrl,
        publicUrl: `${publicRoot.publicBase}${localUrl}`
      };
    } catch (error: unknown) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "像素角色资源保存失败。" });
    }
  });

  app.get("/api/module02/generation/sprite-sheet/actions", async () => ({
    actions: await getPixelSpriteActions(config.presetsDir)
  }));

  app.post("/api/module02/generation/sprite-sheet/payload", async (request, reply) => {
    const result = await buildSpriteSheetRoutePayload(request.body as SpriteSheetGenerationRequest, config);
    if ("error" in result) {
      return reply.code(400).send({ error: result.error });
    }
    return result.payload;
  });

  app.post("/api/module02/generation/sprite-sheet", async (request, reply) => {
    const requestBody = request.body as SpriteSheetGenerationRequest;
    const resolvedModel = await resolveGenerationProviderModel(config, requestBody.model, "image", readProviderRequestAuth(request.headers));
    if ("error" in resolvedModel) {
      return reply.code(resolvedModel.statusCode).send({ error: resolvedModel.error });
    }
    const publicRoot = resolvePublicServerBaseUrl(request.headers["x-public-asset-base-url"], config);
    if ("error" in publicRoot) {
      return reply.code(400).send({ error: publicRoot.error });
    }
    const payloadResult = await buildSpriteSheetRoutePayload({
      ...requestBody,
      model: resolvedModel.model.upstreamModel
    }, config);
    if ("error" in payloadResult) {
      return reply.code(400).send({ error: payloadResult.error });
    }
    if (resolvedModel.provider.kind === "local-codex" || isLocalCodexImageModel(resolvedModel.model.upstreamModel)) {
      try {
        const localResult = await runLocalCodexSpriteSheetGeneration({
          model: resolvedModel.model.upstreamModel,
          prompt: payloadResult.finalPrompt,
          imageDataUrls: payloadResult.imageDataUrls
        }, config);
        return await storeGeneratedSpriteSheet(
          localCodexResultToProviderResponse(localResult),
          config,
          publicRoot.publicBase,
          undefined,
          {
            actionId: payloadResult.action.id,
            actionName: payloadResult.action.name,
            finalPrompt: payloadResult.finalPrompt,
            pixelCharacterId: readPixelCharacterId(request.body) ?? readPixelCharacterId(request.headers)
          }
        );
      } catch (error: unknown) {
        return sendGenerationError(error, reply);
      }
    }
    const apiKey = resolvedModel.apiKey ?? "";
    try {
      const providerResponse = resolvedModel.provider.kind === "openai-images" || resolvedModel.provider.kind === "apimart"
        ? await new OpenAiImagesClient({ apiKey, baseUrl: resolvedModel.baseUrl ?? "" })
          .createImage(buildOpenAiImagesGenerationPayload({
            model: resolvedModel.model.upstreamModel,
            prompt: payloadResult.finalPrompt,
            targetSize: resolvedModel.model.defaultImageSize ?? 1024,
            imageDataUrls: payloadResult.imageDataUrls,
            seed: requestBody.seed
          }))
        : await new OpenRouterClient({ apiKey, baseUrl: resolvedModel.baseUrl })
          .createImage(payloadResult.payload);
      return await storeGeneratedSpriteSheet(providerResponse, config, publicRoot.publicBase, apiKey, {
        actionId: payloadResult.action.id,
        actionName: payloadResult.action.name,
        finalPrompt: payloadResult.finalPrompt,
        pixelCharacterId: readPixelCharacterId(request.body) ?? readPixelCharacterId(request.headers)
      });
    } catch (error: unknown) {
      return sendGenerationError(error, reply);
    }
  });

  app.post("/api/module02/processing/sprite-sheet", async (request, reply) => {
    const input = request.body as {
      storedName?: string;
      sourceUrl?: string;
      pixelCharacterId?: string;
      sliceKind?: PixelSliceKind;
      rows?: number;
      columns?: number;
      keyColor?: string;
      tolerance?: number;
      centerFrames?: boolean;
      centerMode?: "frame" | "row";
      outputFrameWidth?: number;
      outputFrameHeight?: number;
      normalizeSubjectScale?: boolean;
      targetSubjectHeight?: number;
      directionLayout?: "grid" | "contact-2x2";
    };
    const rows = clampGridCount(input.rows, 1, 32, 1);
    const columns = clampGridCount(input.columns, 1, 64, 1);
    const keyColor = input.keyColor ?? "#00ff00";
    const tolerance = clampTolerance(input.tolerance);
    const outputFrameWidth = clampOutputFrameDimension(input.outputFrameWidth);
    const outputFrameHeight = clampOutputFrameDimension(input.outputFrameHeight);
    const normalizeSubjectScale = input.normalizeSubjectScale === true;
    const targetSubjectHeight = clampTargetSubjectHeight(input.targetSubjectHeight, outputFrameHeight)
      ?? (normalizeSubjectScale && outputFrameHeight ? Math.round(outputFrameHeight * 0.75) : undefined);
    const sourceResult = resolveSpriteSheetSourcePath(config.storageDir, input);
    if ("error" in sourceResult) {
      return reply.code(400).send({ error: sourceResult.error });
    }
    if (!existsSync(sourceResult.sourcePath)) {
      return reply.code(404).send({ error: `缺少 sprite sheet 源文件：${sourceResult.displayPath}` });
    }

    const pixelCharacterId = input.pixelCharacterId?.trim();
    const sliceKind = input.sliceKind === "idle" ? "idle" : "walk";
    const jobId = pixelCharacterId ? `module02-character-${pixelCharacterId}-${sliceKind}` : `module02-sprite-sheet-${randomUUID()}`;
    const outputRoot = pixelCharacterId
      ? resolvePixelCharacterPath(config.storageDir, pixelCharacterId, "slices", sliceKind, "frames")
      : join(config.storageDir, "jobs", jobId, "frames");
    if (pixelCharacterId) {
      await ensurePixelCharacterFolder(config.storageDir, pixelCharacterId);
    }
    await resetOutputDirectory(outputRoot);

    let slicedFrames: SlicedSpriteFrame[];
    try {
      slicedFrames = await sliceSpriteSheetBuffer(await readFile(sourceResult.sourcePath), {
        rows,
        columns,
        keyColor,
        tolerance,
        centerFrames: input.centerFrames === true,
        centerMode: input.centerMode === "row" ? "row" : "frame",
        outputFrameWidth,
        outputFrameHeight,
        normalizeSubjectScale,
        targetSubjectHeight,
        directionLayout: input.directionLayout === "contact-2x2" ? "contact-2x2" : "grid"
      });
    } catch (error: unknown) {
      return reply.code(500).send({ error: getErrorMessage(error) });
    }
    const frames = [];
    for (const frame of slicedFrames) {
      const rowDirName = `row_${String(frame.row).padStart(3, "0")}`;
      const frameName = `frame_${String(frame.index).padStart(3, "0")}.png`;
      const rowDir = join(outputRoot, rowDirName);
      await mkdir(rowDir, { recursive: true });
      await writeFile(join(rowDir, frameName), frame.buffer);
      frames.push({
        row: frame.row,
        index: frame.index,
        width: frame.width,
        height: frame.height,
        url: pixelCharacterId
          ? toPixelCharacterUrl(pixelCharacterId, "slices", sliceKind, "frames", rowDirName, frameName)
          : `/jobs/${jobId}/frames/${rowDirName}/${frameName}`
      });
    }

    return {
      jobId,
      rows,
      columns,
      frameCount: frames.length,
      frames
    };
  });
}

async function buildPixelCharacterAssets(storageDir: string, characterId: string) {
  return {
    baseTemplate: {
      characterReference: await findPixelCharacterAssetByStem(storageDir, characterId, ["base-template"], "character-reference"),
      output: await findPixelCharacterAssetByStem(storageDir, characterId, ["base-template"], "output")
    },
    walkTemplate: {
      output: await findPixelCharacterAssetByStem(storageDir, characterId, ["walk-template"], "output")
    },
    slices: {
      idle: {
        frames: await listPixelFrameRecords(storageDir, characterId, "idle")
      },
      walk: {
        frames: await listPixelFrameRecords(storageDir, characterId, "walk")
      }
    }
  };
}

async function findPixelCharacterAssetByStem(
  storageDir: string,
  characterId: string,
  directorySegments: readonly string[],
  stem: string
): Promise<PixelCharacterAssetFile | undefined> {
  const directory = resolvePixelCharacterPath(storageDir, characterId, ...directorySegments);
  if (!existsSync(directory)) {
    return undefined;
  }
  const entries = await readdir(directory, { withFileTypes: true });
  const match = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(`${stem}.`))
    .map((entry) => entry.name)
    .sort()[0];
  return match ? {
    fileName: match,
    url: toPixelCharacterUrl(characterId, ...directorySegments, match)
  } : undefined;
}

async function listPixelFrameRecords(
  storageDir: string,
  characterId: string,
  sliceKind: PixelSliceKind
): Promise<PixelFrameRecord[]> {
  const root = resolvePixelCharacterPath(storageDir, characterId, "slices", sliceKind, "frames");
  if (!existsSync(root)) {
    return [];
  }
  const rowEntries = await readdir(root, { withFileTypes: true });
  const rows = rowEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const frames: PixelFrameRecord[] = [];
  for (const rowDirName of rows) {
    const rowDir = resolvePixelCharacterPath(storageDir, characterId, "slices", sliceKind, "frames", rowDirName);
    const fileEntries = await readdir(rowDir, { withFileTypes: true });
    frames.push(...fileEntries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"))
      .map((entry) => ({
        row: parseFrameIndex(rowDirName),
        index: parseFrameIndex(entry.name),
        url: toPixelCharacterUrl(characterId, "slices", sliceKind, "frames", rowDirName, entry.name)
      })));
  }
  return frames.sort((first, second) => first.row - second.row || first.index - second.index);
}

async function buildSpriteSheetRoutePayload(
  input: SpriteSheetGenerationRequest,
  config: Pick<AppConfig, "storageDir" | "presetsDir">
) {
  const actionId = input.actionId?.trim() || "idle";
  const action = await findPixelSpriteActionFromPresets(actionId, config.presetsDir);
  if (!action) {
    return { error: `Unknown pixel sprite action: ${actionId}` };
  }
  const model = input.model?.trim() || "google/gemini-3.1-flash-image-preview";
  const characterReferenceResult = await resolveCharacterReferenceImage(input, config);
  if ("error" in characterReferenceResult) {
    return { error: characterReferenceResult.error };
  }
  const keyColor = typeof input.keyColor === "string" && input.keyColor.trim()
    ? input.keyColor.trim()
    : "#00ff00";
  const finalPrompt = buildSpriteSheetPrompt({
    constraintPrompt: resolveConstraintPrompt(input.constraintPrompt, action.constraintPrompt),
    customPrompt: input.customPrompt ?? "",
    keyColor
  });
  const actionReferenceImageResult = await readActionReferenceImage(config.presetsDir, action.referenceImage);
  if ("error" in actionReferenceImageResult) {
    return { error: actionReferenceImageResult.error };
  }
  return {
    action,
    finalPrompt,
    imageDataUrls: [
      actionReferenceImageResult.dataUrl,
      characterReferenceResult.dataUrl
    ],
    payload: buildSpriteSheetGenerationPayload({
      model,
      prompt: finalPrompt,
      referenceImageDataUrls: [
        actionReferenceImageResult.dataUrl,
        characterReferenceResult.dataUrl
      ],
      seed: input.seed
    })
  };
}

async function resolveCharacterReferenceImage(
  input: Pick<SpriteSheetGenerationRequest, "characterReferenceDataUrl" | "characterReferenceStoredName" | "characterReferenceUrl" | "pixelCharacterId">,
  config: Pick<AppConfig, "storageDir">
): Promise<{ dataUrl: string } | { error: string }> {
  if (input.characterReferenceDataUrl?.startsWith("data:image/")) {
    return { dataUrl: input.characterReferenceDataUrl };
  }
  const urlResult = await resolveCharacterReferenceUrlImage(input, config);
  if (urlResult) {
    return urlResult;
  }
  const storedName = input.characterReferenceStoredName?.trim();
  if (!storedName) {
    return { error: "请上传角色参考图。" };
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(storedName)) {
    return { error: "角色参考图文件名无效。" };
  }
  const assetPath = join(config.storageDir, "assets", storedName);
  if (!existsSync(assetPath)) {
    return { error: `角色参考图文件不存在：${storedName}` };
  }
  return {
    dataUrl: `data:${contentTypeFromFileName(storedName)};base64,${(await readFile(assetPath)).toString("base64")}`
  };
}

async function resolveCharacterReferenceUrlImage(
  input: Pick<SpriteSheetGenerationRequest, "characterReferenceUrl" | "pixelCharacterId">,
  config: Pick<AppConfig, "storageDir">
): Promise<{ dataUrl: string } | { error: string } | undefined> {
  const pathname = extractUrlPathname(input.characterReferenceUrl);
  if (!pathname) {
    return undefined;
  }
  const source = resolveModule02CharacterUrl(config.storageDir, pathname);
  if ("error" in source) {
    return { error: source.error };
  }
  const requestedCharacterId = input.pixelCharacterId?.trim();
  if (requestedCharacterId && requestedCharacterId !== source.characterId) {
    return { error: "角色参考图 URL 与当前像素角色不一致。" };
  }
  if (!existsSync(source.sourcePath)) {
    return { error: `角色参考图文件不存在：${input.characterReferenceUrl}` };
  }
  return {
    dataUrl: `data:${contentTypeFromFileName(source.fileName)};base64,${(await readFile(source.sourcePath)).toString("base64")}`
  };
}

async function readActionReferenceImage(presetsDir: string, referenceImage: string): Promise<{ dataUrl: string } | { error: string }> {
  try {
    const buffer = await readModule02ActionReferenceBuffer(presetsDir, referenceImage);
    return {
      dataUrl: `data:${contentTypeFromFileName(referenceImage)};base64,${buffer.toString("base64")}`
    };
  } catch {
    return { error: `动作参考图缺失：${referenceImage}` };
  }
}

async function getPixelSpriteActions(presetsDir: string): Promise<typeof PIXEL_SPRITE_ACTIONS> {
  const workflow = await readModule02WorkflowConfig(presetsDir) ?? {};
  const basePrompt = readString(workflow, "basePrompt");
  const walkPrompt = readString(workflow, "walkPrompt");
  return PIXEL_SPRITE_ACTIONS.map((action) => {
    if (action.id === "idle" && basePrompt) {
      return { ...action, name: "基准模板/待机", constraintPrompt: basePrompt };
    }
    if (action.id === "walk" && walkPrompt) {
      return { ...action, name: "步行", constraintPrompt: walkPrompt };
    }
    return action;
  }) as typeof PIXEL_SPRITE_ACTIONS;
}

async function findPixelSpriteActionFromPresets(actionId: string, presetsDir: string) {
  return (await getPixelSpriteActions(presetsDir)).find((action) => action.id === actionId)
    ?? findPixelSpriteAction(actionId);
}

function readString(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

async function runLocalCodexSpriteSheetGeneration(
  input: {
    model: string;
    prompt: string;
    imageDataUrls: readonly string[];
  },
  config: Module02RouteConfig
): Promise<LocalCodexImageGenerationResult> {
  const tempDir = await mkdtemp(join(tmpdir(), "ai-game-workbench-module02-local-codex-input-"));
  try {
    const imagePaths = [];
    for (const [index, dataUrl] of input.imageDataUrls.entries()) {
      const image = parseDataUrlImage(dataUrl);
      const filePath = join(tempDir, `input-${index}.${image.extension}`);
      await writeFile(filePath, image.buffer);
      imagePaths.push(filePath);
    }
    const generator = config.localCodexImageGenerator ?? generateLocalCodexImage;
    const generationInput: LocalCodexImageGenerationInput = {
      model: input.model,
      prompt: input.prompt,
      targetSize: 1024,
      keyColor: "#00ff00",
      imagePaths,
      workingDirectory: process.cwd()
    };
    return await generator(generationInput);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function localCodexResultToProviderResponse(result: LocalCodexImageGenerationResult): Record<string, unknown> {
  return {
    ...result.providerResponse,
    imageUrl: `data:image/${result.extension};base64,${result.buffer.toString("base64")}`
  };
}

async function storeGeneratedSpriteSheet(
  providerResponse: unknown,
  config: Pick<AppConfig, "storageDir">,
  publicRoot: string,
  apiKey: string | undefined,
  options: {
    actionId: string;
    actionName: string;
    finalPrompt: string;
    pixelCharacterId?: string;
  }
) {
  const imageSource = extractImageSource(providerResponse);
  if (!imageSource) {
    return {
      error: "OpenRouter 没有返回可用的 sprite sheet 图片结果。",
      providerResponse
    };
  }
  const image = await resolveImageBuffer(imageSource, apiKey);
  if (!options.pixelCharacterId) {
    const storedName = `${randomUUID()}.${image.extension}`;
    const assetDir = join(config.storageDir, "assets");
    const localPath = join(assetDir, storedName);
    await mkdir(assetDir, { recursive: true });
    await writeFile(localPath, image.buffer);
    return {
      fileName: "generated-sprite-sheet.png",
      storedName,
      localPath,
      spriteSheetUrl: `/assets/${storedName}`,
      localUrl: `/assets/${storedName}`,
      publicUrl: `${publicRoot}/assets/${storedName}`,
      action: { id: options.actionId, name: options.actionName },
      finalPrompt: options.finalPrompt,
      providerResponse
    };
  }

  const directory = options.actionId === "walk" ? ["walk-template"] : ["base-template"];
  await ensurePixelCharacterFolder(config.storageDir, options.pixelCharacterId);
  await removePixelCharacterFilesByStem(config.storageDir, options.pixelCharacterId, directory, "output");
  const storedName = `output.${image.extension}`;
  const outputDir = resolvePixelCharacterPath(config.storageDir, options.pixelCharacterId, ...directory);
  const localPath = resolvePixelCharacterPath(config.storageDir, options.pixelCharacterId, ...directory, storedName);
  await mkdir(outputDir, { recursive: true });
  await writeFile(localPath, image.buffer);
  const localUrl = toPixelCharacterUrl(options.pixelCharacterId, ...directory, storedName);
  return {
    fileName: storedName,
    storedName,
    localPath,
    spriteSheetUrl: localUrl,
    localUrl,
    publicUrl: `${publicRoot}${localUrl}`,
    action: { id: options.actionId, name: options.actionName },
    finalPrompt: options.finalPrompt,
    providerResponse
  };
}

function resolveSpriteSheetSourcePath(
  storageDir: string,
  input: { storedName?: string; sourceUrl?: string }
): { sourcePath: string; displayPath: string } | { error: string } {
  const sourceUrl = input.sourceUrl?.trim();
  if (sourceUrl) {
    const pathname = extractUrlPathname(sourceUrl);
    if (!pathname) {
      return { error: "sprite sheet 源地址无效。" };
    }
    if (pathname.startsWith("/module02/characters/")) {
      const source = resolveModule02CharacterUrl(storageDir, pathname);
      if ("error" in source) {
        return { error: source.error };
      }
      return {
        sourcePath: source.sourcePath,
        displayPath: `storage/characters_pixel/${source.characterId}/${source.assetSegments.join("/")}`
      };
    }
    if (pathname.startsWith("/assets/")) {
      const storedName = decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) ?? "");
      if (!storedName || storedName !== basename(storedName)) {
        return { error: "有效的 sprite sheet 文件名是必填项。" };
      }
      return {
        sourcePath: join(storageDir, "assets", storedName),
        displayPath: `storage/assets/${storedName}`
      };
    }
    return { error: "sprite sheet 源地址必须来自 /assets 或 /module02/characters。" };
  }

  const storedName = input.storedName?.trim();
  if (!storedName || storedName !== basename(storedName)) {
    return { error: "有效的 sprite sheet 文件名是必填项。" };
  }
  return {
    sourcePath: join(storageDir, "assets", storedName),
    displayPath: `storage/assets/${storedName}`
  };
}

function resolveModule02CharacterUrl(
  storageDir: string,
  pathname: string
): { characterId: string; assetSegments: string[]; fileName: string; sourcePath: string } | { error: string } {
  const segments = decodeUrlSegments(pathname);
  if (segments[0] !== "module02" || segments[1] !== "characters" || !segments[2] || segments.length < 4) {
    return { error: "模块 02 角色资源 URL 必须来自 /module02/characters。" };
  }
  const characterId = segments[2];
  const assetSegments = segments.slice(3);
  const fileName = assetSegments.at(-1) ?? "";
  return {
    characterId,
    assetSegments,
    fileName,
    sourcePath: resolvePixelCharacterPath(storageDir, characterId, ...assetSegments)
  };
}

async function resetOutputDirectory(outputRoot: string): Promise<void> {
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
}

function resolvePixelAssetTarget(kind: string | undefined): { directory: string[]; stem: string } | undefined {
  if (kind === "character-reference") {
    return { directory: ["base-template"], stem: "character-reference" };
  }
  if (kind === "base-template") {
    return { directory: ["base-template"], stem: "output" };
  }
  if (kind === "walk-template") {
    return { directory: ["walk-template"], stem: "output" };
  }
  return undefined;
}

function buildSpriteSheetPrompt(input: {
  constraintPrompt: string;
  customPrompt: string;
  keyColor: string;
}): string {
  return [
    input.constraintPrompt,
    input.customPrompt,
    `背景色：${input.keyColor}`
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
}

function resolveConstraintPrompt(inputPrompt: unknown, fallbackPrompt: string): string {
  return typeof inputPrompt === "string" ? inputPrompt : fallbackPrompt;
}

function readPixelCharacterId(input: unknown): string | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const bodyValue = (input as { pixelCharacterId?: unknown }).pixelCharacterId;
  if (typeof bodyValue === "string" && bodyValue.trim()) {
    return bodyValue.trim();
  }
  return undefined;
}

function readProviderRequestAuth(headers: Record<string, unknown>): ProviderRequestAuth {
  return {
    providerId: readHeaderString(headers, "x-ai-provider-id"),
    apiKey: readHeaderString(headers, "x-ai-provider-api-key")
  };
}

function readHeaderString(headers: Record<string, unknown>, name: string): string | undefined {
  const value = headers[name];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) {
    return value[0].trim();
  }
  return undefined;
}

function extractUrlPathname(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("/")) {
    return trimmed;
  }
  try {
    return new URL(trimmed).pathname;
  } catch {
    return undefined;
  }
}

function decodeUrlSegments(pathname: string): string[] {
  const segments = pathname.split("/").filter(Boolean);
  try {
    return segments.map((segment) => decodeURIComponent(segment));
  } catch {
    return segments;
  }
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
    const source = extractImageSource(record[key]);
    if (source) {
      return source;
    }
  }
  for (const key of ["choices", "images", "data"]) {
    const values = record[key];
    if (!Array.isArray(values)) {
      continue;
    }
    for (const value of values) {
      const source = extractImageSource(value);
      if (source) {
        return source;
      }
    }
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
    const found = findStringValue(record[key], keys);
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
    headers: buildImageDownloadHeaders(source, apiKey)
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

function buildImageDownloadHeaders(url: string, apiKey?: string): HeadersInit | undefined {
  try {
    const parsed = new URL(url);
    if (apiKey && (parsed.hostname === "openrouter.ai" || parsed.hostname.endsWith(".openrouter.ai"))) {
      return {
        Authorization: `Bearer ${apiKey}`
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function parseFrameIndex(value: string): number {
  const match = /(\d+)/.exec(value);
  return match ? Number.parseInt(match[1] ?? "0", 10) : 1;
}

function clampTolerance(value: unknown): number {
  const tolerance = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 8;
  return Math.max(0, Math.min(255, tolerance));
}

function clampGridCount(value: unknown, min: number, max: number, fallback: number): number {
  const count = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(min, Math.min(max, count));
}

function clampOutputFrameDimension(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const dimension = Math.round(value);
  if (dimension <= 0) {
    return undefined;
  }
  return Math.max(64, Math.min(1024, dimension));
}

function clampTargetSubjectHeight(value: unknown, outputFrameHeight: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const height = Math.round(value);
  if (height <= 0) {
    return undefined;
  }
  return Math.max(1, Math.min(outputFrameHeight ?? 1024, height));
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

function extensionFromContentType(contentType: string): "png" | "jpg" | "webp" {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) {
    return "jpg";
  }
  if (contentType.includes("webp")) {
    return "webp";
  }
  return "png";
}

function contentTypeFromFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  return "image/png";
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
  if (error instanceof Error) {
    return reply.code(500).send({
      error: error.message
    });
  }
  throw error;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
