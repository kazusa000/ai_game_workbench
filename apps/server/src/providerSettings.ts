import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DEFAULT_PROVIDER_MODEL_DEFAULTS,
  DEFAULT_PROVIDER_MODEL_PRESETS,
  DEFAULT_PROVIDER_SETTINGS,
  OPENROUTER_COMPATIBLE_PROVIDER_ID,
  OPENROUTER_PROVIDER_ID,
  type GenerationCapability,
  type ImageGenerationSizeOption,
  type ProviderKind,
  type ProviderModelCatalog,
  type ProviderModelDefaults,
  type ProviderModelPreset,
  type ProviderSettings
} from "@ai-game-workbench/core";
import type { AppConfig } from "./config";

const PROVIDER_SETTINGS_PATH = ["config", "provider-settings.json"] as const;
const PROVIDER_SECRETS_PATH = ["config", "provider-secrets.json"] as const;

export interface ProviderSettingsDocument {
  providers: ProviderSettings[];
  models: ProviderModelPreset[];
  defaults: ProviderModelDefaults;
}

export interface ProviderSecretStatus {
  configured: boolean;
  suffix?: string;
}

export interface ProviderAdminSettingsResponse {
  settings: ProviderSettingsDocument;
  secrets: Record<string, ProviderSecretStatus>;
}

export interface ProviderSecretPatch {
  apiKey?: string;
  clear?: boolean;
}

export interface ProviderSettingsUpdateInput {
  providers?: unknown;
  models?: unknown;
  defaults?: unknown;
  secrets?: Record<string, ProviderSecretPatch>;
}

export interface ResolvedProviderModel {
  provider: ProviderSettings;
  model: ProviderModelPreset;
  apiKey?: string;
  baseUrl?: string;
}

interface ProviderSecretsDocument {
  apiKeys: Record<string, string>;
}

export async function readProviderSettingsDocument(config: Pick<AppConfig,
  "storageDir" | "openAiCompatibleBaseUrl"
>): Promise<ProviderSettingsDocument> {
  const stored = await readStoredProviderSettings(config.storageDir);
  return normalizeProviderSettingsDocument(stored, config);
}

export async function writeProviderSettingsDocument(
  storageDir: string,
  input: ProviderSettingsUpdateInput
): Promise<ProviderSettingsDocument> {
  const normalized = normalizeProviderSettingsDocument(input, {});
  const path = resolveProviderSettingsPath(storageDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export async function updateProviderSecrets(
  storageDir: string,
  patches: Record<string, ProviderSecretPatch> | undefined
): Promise<void> {
  if (!patches) {
    return;
  }
  const secrets = await readStoredProviderSecrets(storageDir);
  for (const [providerId, patch] of Object.entries(patches)) {
    if (!patch || typeof patch !== "object") {
      continue;
    }
    if (patch.clear === true || patch.apiKey === "") {
      delete secrets.apiKeys[providerId];
      continue;
    }
    const apiKey = patch.apiKey?.trim();
    if (apiKey) {
      secrets.apiKeys[providerId] = apiKey;
    }
  }
  const path = resolveProviderSecretsPath(storageDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(secrets, null, 2)}\n`, "utf8");
}

export async function readProviderAdminSettings(
  config: Pick<AppConfig,
    "storageDir" | "openRouterApiKey" | "openAiCompatibleBaseUrl" | "openAiCompatibleApiKey"
  >
): Promise<ProviderAdminSettingsResponse> {
  const settings = await readProviderSettingsDocument(config);
  return {
    settings,
    secrets: await buildProviderSecretStatuses(settings.providers, config)
  };
}

export async function readPublicProviderModelCatalog(
  config: Pick<AppConfig, "storageDir" | "openAiCompatibleBaseUrl">
): Promise<ProviderModelCatalog> {
  const settings = await readProviderSettingsDocument(config);
  const providers = settings.providers.filter((provider) => provider.enabled);
  const providerIds = new Set(providers.map((provider) => provider.id));
  const models = settings.models.filter((model) => model.enabled && providerIds.has(model.providerId));
  const imageModels = models.filter((model) => model.capability === "image");
  const videoModels = models.filter((model) => model.capability === "video");
  return {
    providers,
    models,
    imageModels,
    videoModels,
    defaults: {
      imageModelId: chooseDefaultModelId(settings.defaults.imageModelId, imageModels),
      videoModelId: chooseDefaultModelId(settings.defaults.videoModelId, videoModels)
    }
  };
}

export async function resolveGenerationProviderModel(
  config: Pick<AppConfig,
    "storageDir" | "openRouterApiKey" | "openAiCompatibleBaseUrl" | "openAiCompatibleApiKey"
  >,
  modelId: string | undefined,
  capability: GenerationCapability
): Promise<ResolvedProviderModel | { statusCode: number; error: string }> {
  const settings = await readProviderSettingsDocument(config);
  const id = modelId?.trim();
  if (!id) {
    return { statusCode: 400, error: "model is required" };
  }
  const model = settings.models.find((item) => item.id === id);
  if (!model) {
    return { statusCode: 400, error: `Unknown provider model: ${id}` };
  }
  if (!model.enabled) {
    return { statusCode: 400, error: `Provider model is disabled: ${id}` };
  }
  if (model.capability !== capability) {
    return { statusCode: 400, error: `Provider model ${id} does not support ${capability}` };
  }
  const provider = settings.providers.find((item) => item.id === model.providerId);
  if (!provider) {
    return { statusCode: 400, error: `Provider is not configured: ${model.providerId}` };
  }
  if (!provider.enabled) {
    return { statusCode: 400, error: `Provider is disabled: ${provider.label}` };
  }
  if (provider.kind === "local-codex") {
    return { provider, model };
  }
  const apiKey = await resolveProviderApiKey(provider.id, provider.kind, config);
  if (!apiKey) {
    return { statusCode: 400, error: `API key is not configured for ${provider.label}` };
  }
  const baseUrl = resolveProviderBaseUrl(provider, config);
  if (!baseUrl) {
    return { statusCode: 400, error: `Base URL is not configured for ${provider.label}` };
  }
  if (capability === "video" && provider.kind !== "openrouter") {
    return { statusCode: 400, error: `Provider ${provider.label} does not support video generation` };
  }
  return {
    provider,
    model,
    apiKey,
    baseUrl
  };
}

export async function resolveOpenRouterVideoProvider(
  config: Pick<AppConfig, "storageDir" | "openRouterApiKey" | "openAiCompatibleBaseUrl">
): Promise<{ provider: ProviderSettings; apiKey: string; baseUrl: string } | { statusCode: number; error: string }> {
  const settings = await readProviderSettingsDocument(config);
  const provider = settings.providers.find((item) => item.id === OPENROUTER_PROVIDER_ID);
  if (!provider || !provider.enabled) {
    return { statusCode: 400, error: "OpenRouter provider is disabled" };
  }
  const apiKey = await resolveProviderApiKey(provider.id, provider.kind, config);
  if (!apiKey) {
    return { statusCode: 400, error: "API key is not configured for OpenRouter" };
  }
  return {
    provider,
    apiKey,
    baseUrl: resolveProviderBaseUrl(provider, config) || "https://openrouter.ai/api/v1"
  };
}

export function sanitizeProviderSettingsInput(input: unknown): ProviderSettingsUpdateInput | { error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "provider settings payload must be an object" };
  }
  const record = input as ProviderSettingsUpdateInput;
  return {
    providers: record.providers,
    models: record.models,
    defaults: record.defaults,
    secrets: isPlainObject(record.secrets) ? record.secrets as Record<string, ProviderSecretPatch> : undefined
  };
}

async function buildProviderSecretStatuses(
  providers: readonly ProviderSettings[],
  config: Pick<AppConfig, "storageDir" | "openRouterApiKey" | "openAiCompatibleApiKey">
): Promise<Record<string, ProviderSecretStatus>> {
  const result: Record<string, ProviderSecretStatus> = {};
  for (const provider of providers) {
    const apiKey = await resolveProviderApiKey(provider.id, provider.kind, config);
    result[provider.id] = apiKey
      ? { configured: true, suffix: apiKey.slice(-4) }
      : { configured: false };
  }
  return result;
}

async function resolveProviderApiKey(
  providerId: string,
  kind: ProviderKind,
  config: Pick<AppConfig, "storageDir" | "openRouterApiKey" | "openAiCompatibleApiKey">
): Promise<string | undefined> {
  const secrets = await readStoredProviderSecrets(config.storageDir);
  const saved = secrets.apiKeys[providerId]?.trim();
  if (saved) {
    return saved;
  }
  if (kind === "openrouter") {
    return config.openRouterApiKey?.trim() || undefined;
  }
  if (kind === "openrouter-compatible-chat" || kind === "openai-images") {
    return config.openAiCompatibleApiKey?.trim() || undefined;
  }
  return undefined;
}

function resolveProviderBaseUrl(
  provider: ProviderSettings,
  config: Pick<AppConfig, "openAiCompatibleBaseUrl">
): string | undefined {
  if (provider.kind === "openrouter-compatible-chat" || provider.kind === "openai-images") {
    return provider.baseUrl?.trim() || config.openAiCompatibleBaseUrl?.trim() || undefined;
  }
  return provider.baseUrl?.trim() || undefined;
}

async function readStoredProviderSettings(storageDir: string): Promise<unknown> {
  const path = resolveProviderSettingsPath(storageDir);
  if (!existsSync(path)) {
    return undefined;
  }
  return parseJsonText(await readFile(path, "utf8")) as unknown;
}

async function readStoredProviderSecrets(storageDir: string): Promise<ProviderSecretsDocument> {
  const path = resolveProviderSecretsPath(storageDir);
  if (!existsSync(path)) {
    return { apiKeys: {} };
  }
  const parsed = parseJsonText(await readFile(path, "utf8")) as unknown;
  if (!isPlainObject(parsed) || !isPlainObject(parsed.apiKeys)) {
    return { apiKeys: {} };
  }
  const apiKeys: Record<string, string> = {};
  for (const [providerId, value] of Object.entries(parsed.apiKeys)) {
    if (typeof value === "string" && value.trim()) {
      apiKeys[providerId] = value.trim();
    }
  }
  return { apiKeys };
}

function normalizeProviderSettingsDocument(
  input: unknown,
  config: Pick<AppConfig, "openAiCompatibleBaseUrl">
): ProviderSettingsDocument {
  const providers = mergeProviders(isPlainObject(input) ? input.providers : undefined, config);
  const models = mergeModels(isPlainObject(input) ? input.models : undefined, providers);
  const defaults = normalizeDefaults(isPlainObject(input) ? input.defaults : undefined, models);
  return { providers, models, defaults };
}

function mergeProviders(input: unknown, config: Pick<AppConfig, "openAiCompatibleBaseUrl">): ProviderSettings[] {
  const byId = new Map(DEFAULT_PROVIDER_SETTINGS.map((provider) => [provider.id, { ...provider }]));
  if (Array.isArray(input)) {
    for (const value of input) {
      const provider = normalizeProvider(value);
      if (!provider) {
        continue;
      }
      const current = byId.get(provider.id);
      byId.set(provider.id, current ? { ...current, ...provider } : provider);
    }
  }
  const compatible = byId.get(OPENROUTER_COMPATIBLE_PROVIDER_ID);
  if (compatible && !compatible.baseUrl?.trim() && config.openAiCompatibleBaseUrl?.trim()) {
    compatible.baseUrl = config.openAiCompatibleBaseUrl.trim();
  }
  return [...byId.values()];
}

function mergeModels(input: unknown, providers: readonly ProviderSettings[]): ProviderModelPreset[] {
  const providerIds = new Set(providers.map((provider) => provider.id));
  const byId = new Map(DEFAULT_PROVIDER_MODEL_PRESETS.map((model) => [model.id, cloneModel(model)]));
  if (Array.isArray(input)) {
    for (const value of input) {
      const model = normalizeModel(value, providerIds);
      if (!model) {
        continue;
      }
      const current = byId.get(model.id);
      byId.set(model.id, current ? { ...current, ...model } : model);
    }
  }
  return [...byId.values()];
}

function normalizeDefaults(input: unknown, models: readonly ProviderModelPreset[]): ProviderModelDefaults {
  const imageModels = models.filter((model) => model.enabled && model.capability === "image");
  const videoModels = models.filter((model) => model.enabled && model.capability === "video");
  const record = isPlainObject(input) ? input : {};
  return {
    imageModelId: chooseDefaultModelId(
      typeof record.imageModelId === "string" ? record.imageModelId : DEFAULT_PROVIDER_MODEL_DEFAULTS.imageModelId,
      imageModels
    ),
    videoModelId: chooseDefaultModelId(
      typeof record.videoModelId === "string" ? record.videoModelId : DEFAULT_PROVIDER_MODEL_DEFAULTS.videoModelId,
      videoModels
    )
  };
}

function normalizeProvider(value: unknown): ProviderSettings | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const id = readRequiredId(value.id);
  const kind = readProviderKind(value.kind);
  if (!id || !kind) {
    return undefined;
  }
  return {
    id,
    label: typeof value.label === "string" && value.label.trim() ? value.label.trim() : id,
    kind,
    enabled: value.enabled !== false,
    baseUrl: typeof value.baseUrl === "string" ? value.baseUrl.trim() : undefined
  };
}

function normalizeModel(value: unknown, providerIds: ReadonlySet<string>): ProviderModelPreset | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const id = readRequiredId(value.id);
  const providerId = readRequiredId(value.providerId);
  const capability = value.capability === "video" ? "video" : value.capability === "image" ? "image" : undefined;
  if (!id || !providerId || !providerIds.has(providerId) || !capability) {
    return undefined;
  }
  const upstreamModel = typeof value.upstreamModel === "string" && value.upstreamModel.trim()
    ? value.upstreamModel.trim()
    : id;
  return {
    id,
    providerId,
    upstreamModel,
    label: typeof value.label === "string" && value.label.trim() ? value.label.trim() : id,
    capability,
    enabled: value.enabled !== false,
    imageSizeOptions: normalizeImageSizeOptions(value.imageSizeOptions),
    defaultImageSize: readNumber(value.defaultImageSize),
    durationOptions: normalizeNumberArray(value.durationOptions),
    defaultDurationSeconds: readNumber(value.defaultDurationSeconds),
    resolutionOptions: normalizeStringArray(value.resolutionOptions),
    defaultResolution: typeof value.defaultResolution === "string" && value.defaultResolution.trim()
      ? value.defaultResolution.trim()
      : undefined
  };
}

function chooseDefaultModelId(defaultId: string, models: readonly ProviderModelPreset[]): string {
  return models.some((model) => model.id === defaultId)
    ? defaultId
    : models[0]?.id ?? defaultId;
}

function cloneModel(model: ProviderModelPreset): ProviderModelPreset {
  return {
    ...model,
    imageSizeOptions: model.imageSizeOptions ? [...model.imageSizeOptions] : undefined,
    durationOptions: model.durationOptions ? [...model.durationOptions] : undefined,
    resolutionOptions: model.resolutionOptions ? [...model.resolutionOptions] : undefined
  };
}

function normalizeImageSizeOptions(value: unknown): ImageGenerationSizeOption[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const options = value
    .filter(isPlainObject)
    .map((item) => ({
      size: readNumber(item.size) ?? 0,
      label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : String(item.size ?? "")
    }))
    .filter((item) => item.size > 0);
  return options.length > 0 ? options : undefined;
}

function normalizeNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = value
    .map((item) => readNumber(item))
    .filter((item): item is number => typeof item === "number" && item > 0);
  return values.length > 0 ? values : undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
  return values.length > 0 ? values : undefined;
}

function readRequiredId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(trimmed) ? trimmed : undefined;
}

function readProviderKind(value: unknown): ProviderKind | undefined {
  return value === "openrouter" || value === "openrouter-compatible-chat" || value === "openai-images" || value === "local-codex"
    ? value
    : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonText(text: string): unknown {
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

function resolveProviderSettingsPath(storageDir: string): string {
  return join(storageDir, ...PROVIDER_SETTINGS_PATH);
}

function resolveProviderSecretsPath(storageDir: string): string {
  return join(storageDir, ...PROVIDER_SECRETS_PATH);
}
