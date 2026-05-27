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
  durationSeconds: number;
}

export interface OpenRouterClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export function buildImageGenerationPayload(input: BuildImageGenerationPayloadInput) {
  const text = [
    "Generate a square pixel-art first frame for a 2D game sprite animation.",
    `Character: ${input.prompt}`,
    `Canvas: ${input.targetSize}x${input.targetSize}`,
    `View direction: ${CHARACTER_DIRECTION_LABELS[input.direction]}`,
    "single full-body character, centered, clean silhouette",
    `solid ${input.keyColor} background`,
    "no shadow, no ground, no particles, no text, no UI",
    "If a reference image is provided, preserve the character identity, outfit colors, and major silhouette while converting it into square pixel art."
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
    modalities: ["image", "text"] as const,
    image_config: {
      aspect_ratio: "1:1" as const,
      image_size: "1K" as const
    },
    stream: false,
    ...(input.seed === undefined ? {} : { seed: input.seed })
  };
}

export function buildVideoGenerationPayload(input: BuildVideoGenerationPayloadInput) {
  return {
    model: input.model,
    prompt: input.prompt,
    duration: input.durationSeconds,
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
  const parsed = body.length > 0 ? JSON.parse(body) : null;
  if (!response.ok) {
    throw new Error(`OpenRouter request failed with ${response.status}: ${body}`);
  }
  return parsed;
}
