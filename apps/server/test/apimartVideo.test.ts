import { describe, expect, it, vi } from "vitest";
import {
  ApimartVideoClient,
  buildApimartVideoGenerationPayload
} from "../src/providers/apimartVideo";

describe("APIMart video provider client", () => {
  it("submits Seedance video jobs and reads completed task video URLs", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://api.apimart.ai/v1/videos/generations") {
        expect(init).toMatchObject({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer sk-apimart-test",
            "Content-Type": "application/json"
          })
        });
        expect(JSON.parse(String(init?.body ?? "{}"))).toMatchObject({
          model: "doubao-seedance-2.0",
          prompt: "walk forward",
          resolution: "720p",
          size: "adaptive",
          duration: 5,
          image_with_roles: [
            { url: "https://assets.example.com/walk.png", role: "first_frame" }
          ]
        });
        expect(JSON.parse(String(init?.body ?? "{}"))).not.toHaveProperty("image_urls");
        return Response.json({
          code: 200,
          data: [{ status: "submitted", task_id: "task_video_123" }]
        });
      }
      if (url === "https://api.apimart.ai/v1/tasks/task_video_123?language=zh") {
        return Response.json({
          code: 200,
          data: {
            id: "task_video_123",
            status: "completed",
            result: {
              videos: [
                {
                  url: ["https://upload.apimart.ai/f/video/task_video_123.mp4"]
                }
              ]
            }
          }
        });
      }
      return Response.json({ error: "unexpected URL" }, { status: 500 });
    });
    const client = new ApimartVideoClient({
      apiKey: "sk-apimart-test",
      baseUrl: "https://api.apimart.ai/v1/",
      fetchImpl: fetchMock
    });

    const submit = await client.createVideo(buildApimartVideoGenerationPayload({
      model: "doubao-seedance-2.0",
      prompt: "walk forward",
      firstFrameUrl: "https://assets.example.com/walk.png",
      durationSeconds: 5,
      resolution: "720p"
    }));
    const status = await client.getVideoJob("task_video_123");

    expect(submit).toMatchObject({
      id: "task_video_123",
      jobId: "task_video_123",
      status: "submitted"
    });
    expect(status).toMatchObject({
      jobId: "task_video_123",
      status: "completed",
      videoUrl: "https://upload.apimart.ai/f/video/task_video_123.mp4"
    });
  });

  it("keeps reference-only APIMart videos on image_urls", () => {
    expect(buildApimartVideoGenerationPayload({
      model: "doubao-seedance-2.0",
      prompt: "attack through the middle frame",
      firstFrameUrl: "https://assets.example.com/attack-start.png",
      referenceOnly: true,
      inputReferenceUrls: [
        "https://assets.example.com/attack-start.png",
        "https://assets.example.com/attack-middle.png"
      ]
    })).toMatchObject({
      image_urls: [
        "https://assets.example.com/attack-start.png",
        "https://assets.example.com/attack-middle.png"
      ]
    });
  });

  it("locks Seedance 1.0 Pro Quality to square fixed-camera first and last frame", () => {
    expect(buildApimartVideoGenerationPayload({
      model: "doubao-seedance-1-0-pro-quality",
      prompt: "fixed camera walk cycle",
      firstFrameUrl: "https://assets.example.com/walk.png",
      durationSeconds: 12,
      resolution: "1080p"
    })).toMatchObject({
      model: "doubao-seedance-1-0-pro-quality",
      duration: 12,
      resolution: "1080p",
      aspect_ratio: "1:1",
      camerafixed: true,
      image_with_roles: [
        { url: "https://assets.example.com/walk.png", role: "first_frame" },
        { url: "https://assets.example.com/walk.png", role: "last_frame" }
      ]
    });
  });
});
