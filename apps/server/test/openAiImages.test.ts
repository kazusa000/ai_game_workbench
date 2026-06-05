import { describe, expect, it, vi } from "vitest";
import {
  buildOpenAiImagesGenerationPayload,
  OpenAiImagesClient
} from "../src/providers/openAiImages";

describe("OpenAI images compatible provider client", () => {
  it("submits APIMart image jobs and polls task results from data arrays", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://api.apimart.ai/v1/images/generations") {
        return Response.json({
          code: 200,
          data: [
            {
              status: "submitted",
              task_id: "task_123"
            }
          ]
        });
      }
      if (url === "https://api.apimart.ai/v1/tasks/task_123") {
        return Response.json({
          code: 200,
          data: {
            id: "task_123",
            status: "completed",
            result: {
              images: [
                {
                  url: ["https://upload.apimart.ai/f/image/task_123.png"]
                }
              ]
            }
          }
        });
      }
      return Response.json({ error: "unexpected URL" }, { status: 500 });
    });
    const client = new OpenAiImagesClient({
      apiKey: "test-compatible-key",
      baseUrl: "https://api.apimart.ai/v1/",
      fetchImpl: fetchMock,
      pollIntervalMs: 0,
      maxPollAttempts: 2
    });

    const response = await client.createImage(buildOpenAiImagesGenerationPayload({
      model: "gpt-image-2",
      prompt: "test prompt",
      targetSize: 1024
    }));

    expect(response).toMatchObject({
      taskId: "task_123",
      imageUrl: "https://upload.apimart.ai/f/image/task_123.png"
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer test-compatible-key",
        "Content-Type": "application/json"
      })
    });
  });
});
