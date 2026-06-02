export interface BuildImageGenerationPayloadInput {
  model: string;
  prompt: string;
  targetSize: number;
  keyColor: string;
  imageDataUrls?: readonly string[];
  styleReferenceImageDataUrl?: string;
  referenceImageDataUrl?: string;
  seed?: number;
}

export interface BuildVideoGenerationPayloadInput {
  model: string;
  prompt: string;
  firstFrameUrl: string;
  lastFrameUrl?: string;
  referenceOnly?: boolean;
  inputReferenceUrls?: readonly string[];
  durationSeconds?: number;
  resolution?: "480p" | "720p" | "1080p" | string;
}

export interface BuildSpriteSheetGenerationPayloadInput {
  model: string;
  prompt: string;
  referenceImageDataUrls?: readonly string[];
  seed?: number;
}

export interface OpenRouterClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class OpenRouterError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;

  constructor(statusCode: number, responseBody: string, message: string) {
    super(message);
    this.name = "OpenRouterError";
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

export function buildImageGenerationPayload(input: BuildImageGenerationPayloadInput) {
  const text = input.prompt;
  const imageInputs = (input.imageDataUrls ?? [input.styleReferenceImageDataUrl, input.referenceImageDataUrl])
    .filter((url): url is string => typeof url === "string" && url.trim().length > 0);
  const content = imageInputs.length > 0
    ? [
        { type: "text" as const, text },
        ...imageInputs.map((url) => ({
          type: "image_url" as const,
          image_url: {
            url
          }
        }))
      ]
    : text;

  return {
    model: input.model,
    messages: [
      {
        role: "user" as const,
        content
      }
    ],
    modalities: getImageGenerationModalities(input.model),
    ...buildImageConfig(input.model, input.targetSize),
    stream: false,
    ...(input.seed === undefined ? {} : { seed: input.seed })
  };
}

export function buildSpriteSheetGenerationPayload(input: BuildSpriteSheetGenerationPayloadInput) {
  const content = [
    { type: "text" as const, text: input.prompt },
    ...(input.referenceImageDataUrls ?? []).map((url) => ({
      type: "image_url" as const,
      image_url: { url }
    }))
  ];

  return {
    model: input.model,
    messages: [
      {
        role: "user" as const,
        content
      }
    ],
    modalities: getImageGenerationModalities(input.model),
    stream: false,
    ...(input.seed === undefined ? {} : { seed: input.seed })
  };
}

function getImageGenerationModalities(model: string) {
  return isImageOnlyModel(model) ? (["image"] as const) : (["image", "text"] as const);
}

function buildImageConfig(model: string, targetSize: number) {
  if (!supportsImageConfig(model)) {
    return {};
  }
  return {
    image_config: {
      aspect_ratio: "1:1" as const,
      image_size: getOpenRouterImageSize(model, targetSize)
    }
  };
}

function supportsImageConfig(model: string): boolean {
  return model === "openai/gpt-5.4-image-2" || model.startsWith("google/gemini-");
}

function getOpenRouterImageSize(model: string, targetSize: number) {
  if (model.includes("gemini-2.5-flash-image")) {
    return "1K" as const;
  }
  if (targetSize <= 512 && model === "google/gemini-3.1-flash-image-preview") {
    return "0.5K" as const;
  }
  if (targetSize <= 1024) {
    return "1K" as const;
  }
  if (targetSize <= 2048) {
    return "2K" as const;
  }
  return "4K" as const;
}

function isImageOnlyModel(model: string): boolean {
  return [
    "bytedance-seed/",
    "black-forest-labs/",
    "recraft/",
    "sourceful/",
    "x-ai/grok-imagine-image"
  ].some((prefix) => model.startsWith(prefix));
}

export function buildVideoGenerationPayload(input: BuildVideoGenerationPayloadInput) {
  const lastFrameUrl = input.lastFrameUrl?.trim();
  const frameImages = input.referenceOnly ? [] : [
    {
      type: "image_url" as const,
      image_url: {
        url: input.firstFrameUrl
      },
      frame_type: "first_frame" as const
    },
    ...(lastFrameUrl ? [{
      type: "image_url" as const,
      image_url: {
        url: lastFrameUrl
      },
      frame_type: "last_frame" as const
    }] : [])
  ];
  const inputReferences = input.inputReferenceUrls
    ?.map((url) => url.trim())
    .filter((url) => url.length > 0)
    .map((url) => ({
      type: "image_url" as const,
      image_url: {
        url
      }
    }));

  return {
    model: input.model,
    prompt: input.prompt,
    duration: input.durationSeconds ?? getShortestVideoDurationSeconds(input.model),
    resolution: input.resolution ?? ("720p" as const),
    aspect_ratio: "1:1" as const,
    generate_audio: false,
    ...(frameImages.length > 0 ? { frame_images: frameImages } : {}),
    ...(inputReferences && inputReferences.length > 0 ? { input_references: inputReferences } : {})
  };
}

export function getShortestVideoDurationSeconds(model: string): number {
  const durations: Record<string, number> = {
    "bytedance/seedance-2.0": 4,
    "bytedance/seedance-2.0-fast": 4,
    "bytedance/seedance-1-5-pro": 4,
    "x-ai/grok-imagine-video": 1,
    "kwaivgi/kling-v3.0-std": 3,
    "kwaivgi/kling-v3.0-pro": 3,
    "kwaivgi/kling-video-o1": 5
  };
  return durations[model] ?? 4;
}

export class OpenRouterClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenRouterClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async createImage(
    payload: ReturnType<typeof buildImageGenerationPayload> | ReturnType<typeof buildSpriteSheetGenerationPayload>
  ): Promise<unknown> {
    return this.postJson("/chat/completions", payload);
  }

  async createVideo(payload: ReturnType<typeof buildVideoGenerationPayload>): Promise<unknown> {
    return this.postJson("/videos", payload);
  }

  async getVideoJob(jobId: string): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}/videos/${encodeURIComponent(jobId)}`, {
      headers: this.headers()
    });
    return parseJsonResponse(response);
  }

  private async postJson(path: string, body: unknown): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body)
    });
    return parseJsonResponse(response);
  }

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json"
    };
  }
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const body = await response.text();
  const parsed = parseJsonBody(body);
  if (!response.ok) {
    throw new OpenRouterError(response.status, body, extractOpenRouterErrorMessage(response.status, parsed, body));
  }
  return parsed;
}

function parseJsonBody(body: string): unknown {
  if (body.length === 0) {
    return null;
  }
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function extractOpenRouterErrorMessage(statusCode: number, parsed: unknown, rawBody: string): string {
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    if (typeof record.error === "string") {
      return `OpenRouter 请求失败（${statusCode}）：${record.error}`;
    }
    if (record.error && typeof record.error === "object") {
      const errorRecord = record.error as Record<string, unknown>;
      if (typeof errorRecord.message === "string") {
        return `OpenRouter 请求失败（${statusCode}）：${errorRecord.message}`;
      }
    }
    if (typeof record.message === "string") {
      return `OpenRouter 请求失败（${statusCode}）：${record.message}`;
    }
  }
  return `OpenRouter 请求失败（${statusCode}）：${rawBody || "空响应"}`;
}
