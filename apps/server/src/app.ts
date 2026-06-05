import cors from "@fastify/cors";
import Fastify from "fastify";
import { createProjectStore } from "./storage/projectStore";
import { registerProjectRoutes } from "./routes/projects";
import { registerAssetRoutes } from "./routes/assets";
import { registerGenerationRoutes } from "./routes/generation";
import { registerProcessingRoutes } from "./routes/processing";
import { registerCharacterRoutes } from "./routes/characters";
import { registerWorkflowConfigRoutes } from "./routes/workflowConfig";
import { registerGodotExportRoutes } from "./routes/godotExport";
import { registerModule02Routes } from "./routes/module02";
import { registerOneClickCharacterRoutes, type OneClickCharacterJobRunner } from "./routes/oneClickCharacterJobs";
import { registerProviderSettingsRoutes } from "./routes/providerSettings";
import { registerRuntimeConfigRoutes } from "./routes/runtimeConfig";
import { resolveDefaultFfmpegPath, resolveDefaultModule01CharacterExportDir, resolveDefaultPresetsDir, type AppConfig } from "./config";

export type CreateAppOptions = Pick<AppConfig, "storageDir"> & Partial<AppConfig> & {
  oneClickCharacterJobRunner?: OneClickCharacterJobRunner;
};

const GENERATION_BODY_LIMIT_BYTES = 64 * 1024 * 1024;

export function createApp(options: CreateAppOptions) {
  const app = Fastify({
    logger: false,
    bodyLimit: GENERATION_BODY_LIMIT_BYTES
  });
  const projectStore = createProjectStore({ storageDir: options.storageDir });
  const ffmpegPath = options.ffmpegPath ?? resolveDefaultFfmpegPath();
  const module01CharacterExportDir = options.module01CharacterExportDir ?? resolveDefaultModule01CharacterExportDir();
  const presetsDir = options.presetsDir ?? resolveDefaultPresetsDir();

  void app.register(cors, {
    origin: true,
    methods: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"]
  });

  app.get("/api/health", async () => ({ ok: true, storageDir: options.storageDir }));
  registerRuntimeConfigRoutes(app, {
    storageDir: options.storageDir,
    publicAssetBaseUrl: options.publicAssetBaseUrl
  });
  registerProviderSettingsRoutes(app, {
    storageDir: options.storageDir,
    openRouterApiKey: options.openRouterApiKey,
    openAiCompatibleBaseUrl: options.openAiCompatibleBaseUrl,
    openAiCompatibleApiKey: options.openAiCompatibleApiKey,
    adminSettingsToken: options.adminSettingsToken
  });
  registerWorkflowConfigRoutes(app, {
    presetsDir
  });
  registerCharacterRoutes(app, {
    storageDir: options.storageDir
  });
  registerProjectRoutes(app, projectStore);
  registerAssetRoutes(app, {
    port: options.port ?? 8787,
    presetsDir,
    storageDir: options.storageDir,
    module01CharacterExportDir,
    publicAssetBaseUrl: options.publicAssetBaseUrl
  });
  registerGenerationRoutes(app, {
    ffmpegPath,
    port: options.port ?? 8787,
    presetsDir,
    storageDir: options.storageDir,
    module01CharacterExportDir,
    openRouterApiKey: options.openRouterApiKey,
    openAiCompatibleBaseUrl: options.openAiCompatibleBaseUrl,
    openAiCompatibleApiKey: options.openAiCompatibleApiKey,
    publicAssetBaseUrl: options.publicAssetBaseUrl,
    localCodexImageGenerator: options.localCodexImageGenerator
  });
  registerModule02Routes(app, {
    port: options.port ?? 8787,
    presetsDir,
    storageDir: options.storageDir,
    module01CharacterExportDir,
    openRouterApiKey: options.openRouterApiKey,
    openAiCompatibleBaseUrl: options.openAiCompatibleBaseUrl,
    openAiCompatibleApiKey: options.openAiCompatibleApiKey,
    localCodexImageGenerator: options.localCodexImageGenerator,
    publicAssetBaseUrl: options.publicAssetBaseUrl
  });
  registerProcessingRoutes(app, {
    ffmpegPath,
    storageDir: options.storageDir
  });
  registerGodotExportRoutes(app, {
    storageDir: options.storageDir,
    module01CharacterExportDir
  });
  registerOneClickCharacterRoutes(app, {
    ffmpegPath,
    storageDir: options.storageDir,
    presetsDir,
    openRouterApiKey: options.openRouterApiKey,
    openAiCompatibleBaseUrl: options.openAiCompatibleBaseUrl,
    openAiCompatibleApiKey: options.openAiCompatibleApiKey,
    publicAssetBaseUrl: options.publicAssetBaseUrl,
    oneClickCharacterJobRunner: options.oneClickCharacterJobRunner
  });

  return app;
}
