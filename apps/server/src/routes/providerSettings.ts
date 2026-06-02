import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config";
import {
  readProviderAdminSettings,
  readPublicProviderModelCatalog,
  sanitizeProviderSettingsInput,
  updateProviderSecrets,
  writeProviderSettingsDocument
} from "../providerSettings";

type ProviderSettingsRouteConfig = Pick<AppConfig,
  "storageDir" | "openRouterApiKey" | "openAiCompatibleBaseUrl" | "openAiCompatibleApiKey" | "adminSettingsToken"
>;

export function registerProviderSettingsRoutes(app: FastifyInstance, config: ProviderSettingsRouteConfig): void {
  app.get("/api/provider-models", async () => readPublicProviderModelCatalog(config));

  app.get("/api/admin/provider-settings", async (request, reply) => {
    const auth = requireAdminSettingsToken(request, reply, config);
    if (auth) {
      return auth;
    }
    return readProviderAdminSettings(config);
  });

  app.put("/api/admin/provider-settings", async (request, reply) => {
    const auth = requireAdminSettingsToken(request, reply, config);
    if (auth) {
      return auth;
    }
    const input = sanitizeProviderSettingsInput(request.body);
    if ("error" in input) {
      return reply.code(400).send({ error: input.error });
    }
    await updateProviderSecrets(config.storageDir, input.secrets);
    const settings = await writeProviderSettingsDocument(config.storageDir, input);
    const admin = await readProviderAdminSettings(config);
    return {
      settings,
      secrets: admin.secrets
    };
  });
}

function requireAdminSettingsToken(
  request: FastifyRequest,
  reply: FastifyReply,
  config: Pick<AppConfig, "adminSettingsToken">
) {
  const configuredToken = config.adminSettingsToken?.trim();
  if (!configuredToken) {
    return reply.code(503).send({ error: "ADMIN_SETTINGS_TOKEN is not configured" });
  }
  const headerValue = request.headers["x-admin-settings-token"];
  const token = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (token !== configuredToken) {
    return reply.code(401).send({ error: "Invalid admin settings token" });
  }
  return undefined;
}
