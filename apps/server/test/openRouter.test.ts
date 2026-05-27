import { describe, expect, it } from "vitest";
import {
  buildImageGenerationPayload,
  buildVideoGenerationPayload
} from "../src/providers/openRouter";

describe("buildImageGenerationPayload", () => {
  it("builds an OpenRouter image generation payload with Chinese prompt instructions", () => {
    const payload = buildImageGenerationPayload({
      model: "google/gemini-3.1-flash-image-preview",
      prompt: "蓝色铠甲女主角",
      targetSize: 768,
      keyColor: "#00ff00",
      direction: "front",
      referenceImageDataUrl: "data:image/webp;base64,abc123",
      seed: 123
    });

    expect(payload.model).toBe("google/gemini-3.1-flash-image-preview");
    expect(payload.modalities).toEqual(["image", "text"]);
    expect(payload.image_config).toEqual({
      aspect_ratio: "1:1",
      image_size: "1K"
    });
    expect(payload.messages[0]?.content).toEqual([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("蓝色铠甲女主角")
      }),
      expect.objectContaining({
        type: "image_url",
        imageUrl: {
          url: "data:image/webp;base64,abc123"
        }
      })
    ]);
    expect(payload.messages[0]?.content[0]?.text).toContain("768x768");
    expect(payload.messages[0]?.content[0]?.text).toContain("正面");
    expect(payload.messages[0]?.content[0]?.text).toContain("纯色 #00ff00 背景");
    expect(payload.seed).toBe(123);
  });

  it("uses image-only output modalities for Seedream image generation", () => {
    const payload = buildImageGenerationPayload({
      model: "bytedance-seed/seedream-4.5",
      prompt: "正面像素角色",
      targetSize: 512,
      keyColor: "#00ff00",
      direction: "front"
    });

    expect(payload.modalities).toEqual(["image"]);
    expect(payload).not.toHaveProperty("image_config");
  });
});

describe("buildVideoGenerationPayload", () => {
  it("builds an OpenRouter image-to-video payload with a first-frame image", () => {
    const payload = buildVideoGenerationPayload({
      model: "bytedance/seedance-2.0-fast",
      prompt: "walk forward in a short loop",
      firstFrameUrl: "https://example.com/first-frame.png",
      durationSeconds: 4
    });

    expect(payload).toEqual({
      model: "bytedance/seedance-2.0-fast",
      prompt: "walk forward in a short loop",
      duration: 4,
      resolution: "720p",
      aspect_ratio: "1:1",
      generate_audio: false,
      frame_images: [
        {
          type: "image_url",
          image_url: {
            url: "https://example.com/first-frame.png"
          },
          frame_type: "first_frame"
        }
      ]
    });
  });

  it("uses the shortest supported duration and fixed square 720p video defaults", () => {
    const payload = buildVideoGenerationPayload({
      model: "kwaivgi/kling-v3.0-std",
      prompt: "正面奔跑循环",
      firstFrameUrl: "https://example.com/first-frame.png"
    });

    expect(payload).toMatchObject({
      duration: 3,
      resolution: "720p",
      aspect_ratio: "1:1",
      generate_audio: false
    });
    expect(payload).not.toHaveProperty("size");
    expect(payload).not.toHaveProperty("seed");
  });
});
