export interface BuildOpenAiImagesGenerationPayloadInput {
  model: string;
  prompt: string;
  targetSize: number;
  imageDataUrls?: readonly string[];
  styleReferenceImageDataUrl?: string;
  referenceImageDataUrl?: string;
  seed?: number;
}

export interface OpenAiImagesClientOptions {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}

export class OpenAiImagesError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;

  constructor(statusCode: number, responseBody: string, message: string) {
    super(message);
    this.name = "OpenAiImagesError";
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

export function buildOpenAiImagesGenerationPayload(input: BuildOpenAiImagesGenerationPayloadInput) {
  const imageUrls = (input.imageDataUrls ?? [input.styleReferenceImageDataUrl, input.referenceImageDataUrl])
    .filter((url): url is string => typeof url === "string" && url.trim().length > 0);
  return {
    model: input.model,
    prompt: input.prompt,
    n: 1,
    size: "1:1",
    resolution: getOpenAiImageResolution(input.targetSize),
    ...(imageUrls.length > 0 ? { image_urls: imageUrls } : {}),
    ...(input.seed === undefined ? {} : { seed: input.seed })
  };
}

export class OpenAiImagesClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;

  constructor(options: OpenAiImagesClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.pollIntervalMs = options.pollIntervalMs ?? 3000;
    this.maxPollAttempts = options.maxPollAttempts ?? 80;
  }

  async createImage(payload: ReturnType<typeof buildOpenAiImagesGenerationPayload>): Promise<unknown> {
    const submitResponse = await this.postJson("/images/generations", payload);
    const immediateImageUrl = extractImageUrl(submitResponse);
    if (immediateImageUrl) {
      return { ...asRecord(submitResponse), imageUrl: immediateImageUrl };
    }
    const taskId = extractTaskId(submitResponse);
    if (!taskId) {
      return submitResponse;
    }
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      if (attempt > 0) {
        await sleep(this.pollIntervalMs);
      }
      const statusResponse = await this.getJson(`/tasks/${encodeURIComponent(taskId)}`);
      const status = extractStatus(statusResponse);
      const imageUrl = extractImageUrl(statusResponse);
      if (status === "completed" && imageUrl) {
        return {
          ...asRecord(statusResponse),
          taskId,
          imageUrl,
          providerSubmitResponse: submitResponse
        };
      }
      if (status === "failed") {
        throw new OpenAiImagesError(400, JSON.stringify(statusResponse), extractErrorMessage(statusResponse) ?? "Image generation task failed");
      }
    }
    throw new OpenAiImagesError(408, JSON.stringify({ taskId }), `Image generation task timed out: ${taskId}`);
  }

  private async postJson(path: string, body: unknown): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body)
    });
    return parseJsonResponse(response);
  }

  private async getJson(path: string): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: this.headers()
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

function getOpenAiImageResolution(targetSize: number): "1k" | "2k" | "4k" {
  if (targetSize <= 1024) {
    return "1k";
  }
  if (targetSize <= 2048) {
    return "2k";
  }
  return "4k";
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const body = await response.text();
  const parsed = parseJsonBody(body);
  if (!response.ok) {
    throw new OpenAiImagesError(response.status, body, extractErrorMessage(parsed) ?? `Image API request failed (${response.status})`);
  }
  return parsed;
}

function parseJsonBody(body: string): unknown {
  if (!body) {
    return null;
  }
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function extractTaskId(value: unknown): string | undefined {
  const direct = findStringValue(value, ["task_id", "taskId", "id"]);
  if (direct?.startsWith("task_")) {
    return direct;
  }
  return findStringValue(value, ["task_id", "taskId"]);
}

function extractStatus(value: unknown): string {
  return findStringValue(value, ["status", "state"])?.toLowerCase() ?? "pending";
}

function extractImageUrl(value: unknown): string | undefined {
  const direct = findStringValue(value, ["imageUrl", "image_url", "url", "b64_json"]);
  if (direct) {
    return direct;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["data", "result", "images", "image"]) {
    const nested = record[key];
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const found = extractImageUrl(item);
        if (found) {
          return found;
        }
      }
    } else {
      const found = extractImageUrl(nested);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

function extractErrorMessage(value: unknown): string | undefined {
  const direct = findStringValue(value, ["message", "error"]);
  if (direct) {
    return direct;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return extractErrorMessage(record.error);
  }
  return undefined;
}

function findStringValue(value: unknown, keys: readonly string[]): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringValue(item, keys);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const item = record[key];
    if (typeof item === "string" && item.trim().length > 0) {
      return item.trim();
    }
    if (Array.isArray(item)) {
      const found = item.find((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
      if (found) {
        return found.trim();
      }
    }
  }
  for (const key of ["data", "result", "error"]) {
    const found = findStringValue(record[key], keys);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { providerResponse: value };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
