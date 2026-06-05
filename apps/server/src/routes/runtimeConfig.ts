import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config";
import { readPublicTunnelConfig, resolveRuntimePublicAssetBaseUrl } from "../publicTunnel";

type RuntimeConfigRouteConfig = Pick<AppConfig, "storageDir" | "publicAssetBaseUrl">;

export function registerRuntimeConfigRoutes(app: FastifyInstance, config: RuntimeConfigRouteConfig): void {
  app.get("/api/runtime-config", async () => {
    const tunnel = readPublicTunnelConfig(config.storageDir);
    return {
      publicAssetBaseUrl: resolveRuntimePublicAssetBaseUrl(config) ?? null,
      publicTunnelProvider: tunnel?.provider ?? null,
      publicTunnelUrl: tunnel?.url ?? null
    };
  });
}
