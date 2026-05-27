import cors from "@fastify/cors";
import Fastify from "fastify";
import { createProjectStore } from "./storage/projectStore";
import { registerProjectRoutes } from "./routes/projects";
import { registerGenerationRoutes } from "./routes/generation";
import { registerProcessingRoutes } from "./routes/processing";
import type { AppConfig } from "./config";

export type CreateAppOptions = Pick<AppConfig, "storageDir"> & Partial<AppConfig>;

export function createApp(options: CreateAppOptions) {
  const app = Fastify({ logger: false });
  const projectStore = createProjectStore({ storageDir: options.storageDir });

  void app.register(cors, { origin: true });

  app.get("/api/health", async () => ({ ok: true }));
  registerProjectRoutes(app, projectStore);
  registerGenerationRoutes(app, {
    ffmpegPath: options.ffmpegPath ?? "ffmpeg",
    port: options.port ?? 8787,
    storageDir: options.storageDir,
    openRouterApiKey: options.openRouterApiKey,
    publicAssetBaseUrl: options.publicAssetBaseUrl
  });
  registerProcessingRoutes(app);

  return app;
}
