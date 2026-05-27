import type { FastifyInstance } from "fastify";
import {
  applyColorKeyToBuffer,
  buildSpriteSheetFromBuffers,
  resizeNearestBuffer
} from "../processing/imageProcessing";

export function registerProcessingRoutes(app: FastifyInstance): void {
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
}
