export type ProviderKind = "openrouter" | "openrouter-compatible-chat" | "openai-images" | "local-codex";

export type GenerationCapability = "image" | "video";

export interface ProviderSettings {
  id: string;
  label: string;
  kind: ProviderKind;
  enabled: boolean;
  baseUrl?: string;
}

export interface ImageGenerationSizeOption {
  size: number;
  label: string;
}

export interface ProviderModelPreset {
  id: string;
  providerId: string;
  upstreamModel: string;
  label: string;
  capability: GenerationCapability;
  enabled: boolean;
  imageSizeOptions?: readonly ImageGenerationSizeOption[];
  defaultImageSize?: number;
  durationOptions?: readonly number[];
  defaultDurationSeconds?: number;
  resolutionOptions?: readonly string[];
  defaultResolution?: string;
}

export interface ProviderModelDefaults {
  imageModelId: string;
  videoModelId: string;
}

export interface ProviderModelCatalog {
  providers: ProviderSettings[];
  models: ProviderModelPreset[];
  imageModels: ProviderModelPreset[];
  videoModels: ProviderModelPreset[];
  defaults: ProviderModelDefaults;
}

export const OPENROUTER_PROVIDER_ID = "openrouter";
export const OPENROUTER_COMPATIBLE_PROVIDER_ID = "openrouter-compatible";
export const LOCAL_CODEX_PROVIDER_ID = "local-codex";
export const LOCAL_CODEX_IMAGE_MODEL = "local/gpt-image-2";

export const DEFAULT_PROVIDER_SETTINGS: readonly ProviderSettings[] = [
  {
    id: OPENROUTER_PROVIDER_ID,
    label: "OpenRouter",
    kind: "openrouter",
    enabled: true,
    baseUrl: "https://openrouter.ai/api/v1"
  },
  {
    id: OPENROUTER_COMPATIBLE_PROVIDER_ID,
    label: "APIMart images endpoint",
    kind: "openai-images",
    enabled: true,
    baseUrl: "https://api.apimart.ai/v1"
  },
  {
    id: LOCAL_CODEX_PROVIDER_ID,
    label: "Local Codex image",
    kind: "local-codex",
    enabled: true
  }
];

export const DEFAULT_PROVIDER_MODEL_PRESETS: readonly ProviderModelPreset[] = [
  {
    id: "openai/gpt-5.4-image-2",
    providerId: OPENROUTER_PROVIDER_ID,
    upstreamModel: "openai/gpt-5.4-image-2",
    label: "GPT Image 2",
    capability: "image",
    enabled: true,
    imageSizeOptions: [
      { size: 1024, label: "1024 x 1024 (1K)" },
      { size: 2048, label: "2048 x 2048 (2K)" },
      { size: 2880, label: "2880 x 2880" }
    ],
    defaultImageSize: 1024
  },
  {
    id: LOCAL_CODEX_IMAGE_MODEL,
    providerId: LOCAL_CODEX_PROVIDER_ID,
    upstreamModel: LOCAL_CODEX_IMAGE_MODEL,
    label: "Local GPT image2",
    capability: "image",
    enabled: true,
    imageSizeOptions: [
      { size: 1024, label: "1024 x 1024" },
      { size: 2048, label: "2048 x 2048" },
      { size: 2880, label: "2880 x 2880" }
    ],
    defaultImageSize: 1024
  },
  {
    id: "google/gemini-3.1-flash-image-preview",
    providerId: OPENROUTER_PROVIDER_ID,
    upstreamModel: "google/gemini-3.1-flash-image-preview",
    label: "Nano Banana 2",
    capability: "image",
    enabled: true,
    imageSizeOptions: [
      { size: 512, label: "512 x 512 (0.5K)" },
      { size: 1024, label: "1024 x 1024 (1K)" },
      { size: 2048, label: "2048 x 2048 (2K)" },
      { size: 4096, label: "4096 x 4096 (4K)" }
    ],
    defaultImageSize: 1024
  },
  {
    id: "bytedance-seed/seedream-4.5",
    providerId: OPENROUTER_PROVIDER_ID,
    upstreamModel: "bytedance-seed/seedream-4.5",
    label: "Seedream 4.5",
    capability: "image",
    enabled: true,
    imageSizeOptions: [
      { size: 1024, label: "1024 x 1024" }
    ],
    defaultImageSize: 1024
  },
  {
    id: "apimart/gpt-image-2",
    providerId: OPENROUTER_COMPATIBLE_PROVIDER_ID,
    upstreamModel: "gpt-image-2",
    label: "APIMart GPT-Image-2",
    capability: "image",
    enabled: true,
    imageSizeOptions: [
      { size: 1024, label: "1024 x 1024 (1K)" },
      { size: 2048, label: "2048 x 2048 (2K)" },
      { size: 2880, label: "2880 x 2880 (4K)" }
    ],
    defaultImageSize: 1024
  },
  {
    id: "x-ai/grok-imagine-video",
    providerId: OPENROUTER_PROVIDER_ID,
    upstreamModel: "x-ai/grok-imagine-video",
    label: "Grok Imagine Video",
    capability: "video",
    enabled: true,
    durationOptions: rangeInclusive(1, 15),
    defaultDurationSeconds: 1,
    resolutionOptions: ["480p", "720p"],
    defaultResolution: "480p"
  },
  {
    id: "bytedance/seedance-2.0",
    providerId: OPENROUTER_PROVIDER_ID,
    upstreamModel: "bytedance/seedance-2.0",
    label: "Seedance 2.0",
    capability: "video",
    enabled: true,
    durationOptions: rangeInclusive(4, 15),
    defaultDurationSeconds: 4,
    resolutionOptions: ["480p", "720p", "1080p"],
    defaultResolution: "720p"
  },
  {
    id: "bytedance/seedance-2.0-fast",
    providerId: OPENROUTER_PROVIDER_ID,
    upstreamModel: "bytedance/seedance-2.0-fast",
    label: "Seedance 2.0 Fast",
    capability: "video",
    enabled: true,
    durationOptions: rangeInclusive(4, 15),
    defaultDurationSeconds: 4,
    resolutionOptions: ["480p", "720p", "1080p"],
    defaultResolution: "720p"
  },
  {
    id: "kwaivgi/kling-v3.0-std",
    providerId: OPENROUTER_PROVIDER_ID,
    upstreamModel: "kwaivgi/kling-v3.0-std",
    label: "Kling v3.0 Standard",
    capability: "video",
    enabled: true,
    durationOptions: rangeInclusive(3, 15),
    defaultDurationSeconds: 3,
    resolutionOptions: ["720p"],
    defaultResolution: "720p"
  },
  {
    id: "kwaivgi/kling-v3.0-pro",
    providerId: OPENROUTER_PROVIDER_ID,
    upstreamModel: "kwaivgi/kling-v3.0-pro",
    label: "Kling v3.0 Pro",
    capability: "video",
    enabled: true,
    durationOptions: rangeInclusive(3, 15),
    defaultDurationSeconds: 3,
    resolutionOptions: ["720p"],
    defaultResolution: "720p"
  }
];

export const DEFAULT_PROVIDER_MODEL_DEFAULTS = {
  imageModelId: "apimart/gpt-image-2",
  videoModelId: "bytedance/seedance-2.0"
} satisfies ProviderModelDefaults;

function rangeInclusive(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_item, index) => start + index);
}
