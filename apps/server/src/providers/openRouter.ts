import {
  CHARACTER_DIRECTION_LABELS,
  type CharacterDirection
} from "@ai-game-workbench/core";

export interface BuildImageGenerationPayloadInput {
  model: string;
  prompt: string;
  targetSize: number;
  keyColor: string;
  direction: CharacterDirection;
  referenceImageDataUrl?: string;
  seed?: number;
}

export interface BuildVideoGenerationPayloadInput {
  model: string;
  prompt: string;
  firstFrameUrl: string;
  durationSeconds?: number;
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
  const text = [
    "生成一张用于2D游戏精灵动画的正方形像素风首帧。",
    `角色：${input.prompt}`,
    `画布：${input.targetSize}x${input.targetSize}`,
    `朝向：${CHARACTER_DIRECTION_LABELS[input.direction]}`,
    "单个全身角色，居中，轮廓清晰",
    `纯色 ${input.keyColor} 背景`,
    "无阴影、无地面、无粒子、无文字、无UI",
    "如果提供参考图，保留角色身份、服装颜色和主要轮廓，并转换为正方形像素风。"
  ].join(" ");
  const content = input.referenceImageDataUrl
    ? [
        { type: "text" as const, text },
        {
          type: "image_url" as const,
          imageUrl: {
            url: input.referenceImageDataUrl
          }
        }
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
    ...buildImageConfig(input.model),
    stream: false,
    ...(input.seed === undefined ? {} : { seed: input.seed })
  };
}

function getImageGenerationModalities(model: string) {
  return isImageOnlyModel(model) ? (["image"] as const) : (["image", "text"] as const);
}

function buildImageConfig(model: string) {
  if (isImageOnlyModel(model)) {
    return {};
  }
  return {
    image_config: {
      aspect_ratio: "1:1" as const,
      image_size: "1K" as const
    }
  };
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
  return {
    model: input.model,
    prompt: input.prompt,
    duration: input.durationSeconds ?? getShortestVideoDurationSeconds(input.model),
    resolution: "720p" as const,
    aspect_ratio: "1:1" as const,
    generate_audio: false,
    frame_images: [
      {
        type: "image_url" as const,
        image_url: {
          url: input.firstFrameUrl
        },
        frame_type: "first_frame" as const
      }
    ]
  };
}

export function getShortestVideoDurationSeconds(model: string): number {
  const durations: Record<string, number> = {
    "bytedance/seedance-2.0": 4,
    "bytedance/seedance-2.0-fast": 4,
    "bytedance/seedance-1-5-pro": 4,
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
    this.baseUrl = options.baseUrl ?? "https://openrouter.ai/api/v1";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async createImage(payload: ReturnType<typeof buildImageGenerationPayload>): Promise<unknown> {
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
