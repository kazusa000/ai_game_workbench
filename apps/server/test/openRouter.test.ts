import { describe, expect, it } from "vitest";
import {
  buildImageGenerationPayload,
  buildVideoGenerationPayload
} from "../src/providers/openRouter";

describe("buildImageGenerationPayload", () => {
  it("builds an OpenRouter image generation payload for square pixel-art first frames", () => {
    const payload = buildImageGenerationPayload({
      model: "google/gemini-3.1-flash-image-preview",
      prompt: "blue armored heroine",
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
        text: expect.stringContaining("blue armored heroine")
      }),
      expect.objectContaining({
        type: "image_url",
        imageUrl: {
          url: "data:image/webp;base64,abc123"
        }
      })
    ]);
    expect(payload.messages[0]?.content[0]?.text).toContain("768x768");
    expect(payload.messages[0]?.content[0]?.text).toContain("front-facing");
    expect(payload.messages[0]?.content[0]?.text).toContain("solid #00ff00 background");
    expect(payload.seed).toBe(123);
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
});
