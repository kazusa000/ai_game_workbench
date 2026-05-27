import type { FastifyInstance } from "fastify";
import {
  buildImageGenerationPayload,
  buildVideoGenerationPayload,
  OpenRouterClient
} from "../providers/openRouter";
import type { AppConfig } from "../config";

export function registerGenerationRoutes(app: FastifyInstance, config: AppConfig): void {
  app.post("/api/generation/first-frame/payload", async (request) => {
    return buildImageGenerationPayload(request.body as Parameters<typeof buildImageGenerationPayload>[0]);
  });

  app.post("/api/generation/video/payload", async (request) => {
    return buildVideoGenerationPayload(request.body as Parameters<typeof buildVideoGenerationPayload>[0]);
  });

  app.post("/api/generation/first-frame", async (request, reply) => {
    if (!config.openRouterApiKey) {
      return reply.code(400).send({ error: "OPENROUTER_API_KEY is not configured" });
    }
    const client = new OpenRouterClient({ apiKey: config.openRouterApiKey });
    return client.createImage(
      buildImageGenerationPayload(request.body as Parameters<typeof buildImageGenerationPayload>[0])
    );
  });

  app.post("/api/generation/video", async (request, reply) => {
    if (!config.openRouterApiKey) {
      return reply.code(400).send({ error: "OPENROUTER_API_KEY is not configured" });
    }
    const client = new OpenRouterClient({ apiKey: config.openRouterApiKey });
    return client.createVideo(
      buildVideoGenerationPayload(request.body as Parameters<typeof buildVideoGenerationPayload>[0])
    );
  });
}
