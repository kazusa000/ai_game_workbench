import { describe, expect, it } from "vitest";
import {
  buildImageGenerationPayload,
  buildVideoGenerationPayload
} from "../src/providers/openRouter";

describe("buildImageGenerationPayload", () => {
  it("uses the final first-frame prompt without backend style or direction text", () => {
    const prompt = [
      "高清日系二次元动画风，干净线稿，赛璐璐上色。",
      "单个全身角色居中，纯色抠图背景。",
      "自定义需求：蓝色铠甲女主角",
      "画布：768x768",
      "背景色：#00ff00"
    ].join("\n\n");
    const payload = buildImageGenerationPayload({
      model: "google/gemini-3.1-flash-image-preview",
      prompt,
      targetSize: 768,
      keyColor: "#00ff00",
      styleReferenceImageDataUrl: "data:image/png;base64,style123",
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
        text: prompt
      }),
      expect.objectContaining({
        type: "image_url",
        image_url: {
          url: "data:image/png;base64,style123"
        }
      }),
      expect.objectContaining({
        type: "image_url",
        image_url: {
          url: "data:image/webp;base64,abc123"
        }
      })
    ]);
    expect(payload.messages[0]?.content[0]?.text).not.toContain("朝向");
    expect(payload.messages[0]?.content[0]?.text).not.toContain("像素风");
    expect(payload.seed).toBe(123);
  });

  it("uses image-only output modalities for Seedream image generation", () => {
    const payload = buildImageGenerationPayload({
      model: "bytedance-seed/seedream-4.5",
      prompt: "正面像素角色",
      targetSize: 512,
      keyColor: "#00ff00"
    });

    expect(payload.modalities).toEqual(["image"]);
    expect(payload).not.toHaveProperty("image_config");
  });

  it("uses the selected square size for GPT Image 2", () => {
    const payload = buildImageGenerationPayload({
      model: "openai/gpt-5.4-image-2",
      prompt: "正面像素角色",
      targetSize: 2048,
      keyColor: "#00ff00",
      referenceImageDataUrl: "data:image/png;base64,abc123"
    });

    expect(payload.model).toBe("openai/gpt-5.4-image-2");
    expect(payload.modalities).toEqual(["image", "text"]);
    expect(payload.image_config).toEqual({
      aspect_ratio: "1:1",
      image_size: "2K"
    });
    expect(payload.messages[0]?.content).toEqual([
      expect.objectContaining({ type: "text" }),
      expect.objectContaining({
        type: "image_url",
        image_url: {
          url: "data:image/png;base64,abc123"
        }
      })
    ]);
    expect(payload.messages[0]?.content[0]?.text).toBe("正面像素角色");
  });

  it("uses the selected 4K square size for Nano Banana 2", () => {
    const payload = buildImageGenerationPayload({
      model: "google/gemini-3.1-flash-image-preview",
      prompt: "正面像素角色",
      targetSize: 4096,
      keyColor: "#00ff00"
    });

    expect(payload.image_config).toEqual({
      aspect_ratio: "1:1",
      image_size: "4K"
    });
    expect(payload.messages[0]?.content).toBe("正面像素角色");
  });

  it("keeps explicit multi-image inputs in the supplied order", () => {
    const payload = buildImageGenerationPayload({
      model: "openai/gpt-5.4-image-2",
      prompt: "四方向待机精灵图",
      targetSize: 1024,
      keyColor: "#00ff00",
      imageDataUrls: [
        "data:image/png;base64,character-template",
        "data:image/png;base64,idle-reference"
      ]
    });

    expect(payload.messages[0]?.content).toEqual([
      expect.objectContaining({
        type: "text",
        text: "四方向待机精灵图"
      }),
      expect.objectContaining({
        type: "image_url",
        image_url: {
          url: "data:image/png;base64,character-template"
        }
      }),
      expect.objectContaining({
        type: "image_url",
        image_url: {
          url: "data:image/png;base64,idle-reference"
        }
      })
    ]);
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

  it("passes selected Grok video duration and resolution", () => {
    const payload = buildVideoGenerationPayload({
      model: "x-ai/grok-imagine-video",
      prompt: "2D角色向下行走循环",
      firstFrameUrl: "https://example.com/first-frame.png",
      durationSeconds: 2,
      resolution: "480p"
    });

    expect(payload).toMatchObject({
      model: "x-ai/grok-imagine-video",
      duration: 2,
      resolution: "480p",
      aspect_ratio: "1:1",
      generate_audio: false
    });
  });

  it("passes optional input reference images for video generation", () => {
    const payload = buildVideoGenerationPayload({
      model: "bytedance/seedance-2.0",
      prompt: "2D character attack action",
      firstFrameUrl: "https://example.com/attack-start.png",
      lastFrameUrl: "https://example.com/attack-end.png",
      inputReferenceUrls: [
        "https://example.com/weapon-reference.png",
        "   "
      ]
    });

    expect(payload.frame_images).toEqual([
      {
        type: "image_url",
        image_url: {
          url: "https://example.com/attack-start.png"
        },
        frame_type: "first_frame"
      },
      {
        type: "image_url",
        image_url: {
          url: "https://example.com/attack-end.png"
        },
        frame_type: "last_frame"
      }
    ]);
    expect(payload.input_references).toEqual([
      {
        type: "image_url",
        image_url: {
          url: "https://example.com/weapon-reference.png"
        }
      }
    ]);
  });

  it("can submit reference-only video payloads without frame images", () => {
    const payload = buildVideoGenerationPayload({
      model: "bytedance/seedance-2.0",
      prompt: "Use the first reference as start/end and the second as attack middle pose",
      firstFrameUrl: "https://example.com/attack-start.png",
      referenceOnly: true,
      inputReferenceUrls: [
        "https://example.com/attack-start.png",
        "https://example.com/attack-middle.png"
      ]
    });

    expect(payload).not.toHaveProperty("frame_images");
    expect(payload.input_references).toEqual([
      {
        type: "image_url",
        image_url: {
          url: "https://example.com/attack-start.png"
        }
      },
      {
        type: "image_url",
        image_url: {
          url: "https://example.com/attack-middle.png"
        }
      }
    ]);
  });
});
