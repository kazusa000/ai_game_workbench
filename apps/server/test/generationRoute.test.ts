import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";

const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeStorageDir() {
  const dir = mkdtempSync(join(tmpdir(), "ai-game-workbench-generation-"));
  tempDirs.push(dir);
  return dir;
}

const TEST_OPENROUTER_API_KEY = "sk-or-v1-web-key";
const TEST_COMPATIBLE_API_KEY = "sk-compatible-web-key";

describe("generation route", () => {
  it("stores a generated base template in the selected character folder", async () => {
    const storageDir = makeStorageDir();
    const fetchMock = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              images: [
                {
                  image_url: {
                    url: "data:image/png;base64,AQIDBA=="
                  }
                }
              ]
            }
          }
        ]
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      openRouterApiKey: TEST_OPENROUTER_API_KEY,
      storageDir
    });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { name: "hero" }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/generation/first-frame",
      headers: {
        "x-openrouter-api-key": "sk-or-v1-web-key",
        "x-public-asset-base-url": "https://assets.example.com",
        "x-character-id": "hero"
      },
      payload: {
        model: "google/gemini-3.1-flash-image-preview",
        prompt: "高清2D角色首帧",
        targetSize: 1024,
        keyColor: "#00ff00"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      fileName: "output.png",
      imageUrl: "/characters/hero/base-template/output.png",
      publicUrl: "https://assets.example.com/characters/hero/base-template/output.png"
    });
    expect([...readFileSync(join(storageDir, "characters", "hero", "base-template", "output.png"))]).toEqual([1, 2, 3, 4]);

    await app.close();
  });

  it("stores a generated attack middle frame in the selected character folder", async () => {
    const storageDir = makeStorageDir();
    const fetchMock = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              images: [
                {
                  image_url: {
                    url: "data:image/png;base64,AQIDBA=="
                  }
                }
              ]
            }
          }
        ]
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      openRouterApiKey: TEST_OPENROUTER_API_KEY,
      storageDir
    });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { name: "hero" }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/generation/advanced-action-midframe",
      headers: {
        "x-openrouter-api-key": "sk-or-v1-web-key",
        "x-public-asset-base-url": "https://assets.example.com",
        "x-character-id": "hero"
      },
      payload: {
        actionKind: "attack-1",
        model: "google/gemini-3.1-flash-image-preview",
        prompt: "生成攻击动作中间帧",
        targetSize: 1024,
        keyColor: "#00ff00",
        startFrameImageDataUrl: "data:image/png;base64,CAkKCw=="
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      fileName: "middle-4dir.png",
      imageUrl: "/characters/hero/advanced-character/attack-1/midframe/middle-4dir.png",
      publicUrl: "https://assets.example.com/characters/hero/advanced-character/attack-1/midframe/middle-4dir.png"
    });
    expect([...readFileSync(join(storageDir, "characters", "hero", "advanced-character", "attack-1", "midframe", "middle-4dir.png"))]).toEqual([1, 2, 3, 4]);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.messages[0].content).toEqual([
      { type: "text", text: "生成攻击动作中间帧" },
      { type: "image_url", image_url: { url: "data:image/png;base64,CAkKCw==" } }
    ]);

    await app.close();
  });

  it("stores a generated first-frame image as a public asset for the next video step", async () => {
    const storageDir = makeStorageDir();
    const fetchMock = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              images: [
                {
                  image_url: {
                    url: "data:image/png;base64,AQIDBA=="
                  }
                }
              ]
            }
          }
        ]
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      openRouterApiKey: TEST_OPENROUTER_API_KEY,
      storageDir
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/generation/first-frame",
      headers: {
        "x-openrouter-api-key": "sk-or-v1-web-key",
        "x-public-asset-base-url": "https://assets.example.com"
      },
      payload: {
        model: "google/gemini-3.1-flash-image-preview",
        prompt: "高清2D角色首帧",
        targetSize: 256,
        keyColor: "#00ff00"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      fileName: "generated-first-frame.png",
      imageUrl: expect.stringMatching(/^\/assets\/.+\.png$/),
      localUrl: expect.stringMatching(/^\/assets\/.+\.png$/),
      publicUrl: expect.stringMatching(/^https:\/\/assets\.example\.com\/assets\/.+\.png$/)
    });
    expect(existsSync(response.json().localPath)).toBe(true);
    expect([...readFileSync(response.json().localPath)]).toEqual([1, 2, 3, 4]);
    const providerPayload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(providerPayload.messages[0].content).toEqual([
      expect.objectContaining({
        type: "text",
        text: "高清2D角色首帧"
      }),
      expect.objectContaining({
        type: "image_url",
        image_url: {
          url: expect.stringMatching(/^data:image\/png;base64,/)
        }
      })
    ]);

    await app.close();
  });

  it("stores a local Codex generated base template without requiring an OpenRouter key", async () => {
    const storageDir = makeStorageDir();
    const localCodexImageGenerator = vi.fn(async (input) => {
      expect(input.model).toBe("local/gpt-image-2");
      expect(input.prompt).toBe("使用网页端自定义提示词");
      expect(input.targetSize).toBe(1024);
      expect(input.keyColor).toBe("#00ff00");
      expect(input.imagePaths).toHaveLength(2);
      expect(readFileSync(input.imagePaths[1])).toEqual(Buffer.from([1, 2, 3, 4]));
      return {
        buffer: Buffer.from([9, 8, 7, 6]),
        extension: "png" as const,
        providerResponse: {
          provider: "local-codex",
          model: "local/gpt-image-2"
        }
      };
    });
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      openRouterApiKey: TEST_OPENROUTER_API_KEY,
      storageDir,
      localCodexImageGenerator
    });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { name: "hero" }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/generation/first-frame",
      headers: {
        "x-public-asset-base-url": "https://assets.example.com",
        "x-character-id": "hero"
      },
      payload: {
        model: "local/gpt-image-2",
        prompt: "使用网页端自定义提示词",
        targetSize: 1024,
        keyColor: "#00ff00",
        referenceImageDataUrl: "data:image/png;base64,AQIDBA=="
      }
    });

    expect(response.statusCode).toBe(200);
    expect(localCodexImageGenerator).toHaveBeenCalledOnce();
    expect(response.json()).toMatchObject({
      fileName: "output.png",
      imageUrl: "/characters/hero/base-template/output.png",
      publicUrl: "https://assets.example.com/characters/hero/base-template/output.png"
    });
    expect([...readFileSync(join(storageDir, "characters", "hero", "base-template", "output.png"))]).toEqual([9, 8, 7, 6]);

    await app.close();
  });

  it("routes APIMart image generation through the OpenAI images endpoint using the configured compatible key", async () => {
    const storageDir = makeStorageDir();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.apimart.ai/v1/images/generations");
      expect(init?.headers).toMatchObject({
        Authorization: `Bearer ${TEST_COMPATIBLE_API_KEY}`,
        "Content-Type": "application/json"
      });
      const body = JSON.parse(String(init?.body ?? "{}"));
      expect(body).toMatchObject({
        model: "gpt-image-2",
        prompt: "APIMart first-frame prompt",
        n: 1,
        size: "1:1",
        resolution: "1k"
      });
      expect(body.image_urls).toHaveLength(2);
      expect(body.image_urls[0]).toEqual(expect.stringMatching(/^data:image\/png;base64,/));
      expect(body.image_urls[1]).toBe("data:image/png;base64,AQIDBA==");
      return Response.json({
        data: [
          {
            url: "data:image/png;base64,CQgHBg=="
          }
        ]
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      openAiCompatibleBaseUrl: "https://api.apimart.ai/v1",
      openAiCompatibleApiKey: TEST_COMPATIBLE_API_KEY,
      storageDir
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/generation/first-frame",
      headers: {
        "x-public-asset-base-url": "https://assets.example.com"
      },
      payload: {
        model: "apimart/gpt-image-2",
        prompt: "APIMart first-frame prompt",
        targetSize: 1024,
        keyColor: "#00ff00",
        referenceImageDataUrl: "data:image/png;base64,AQIDBA=="
      }
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect([...readFileSync(response.json().localPath)]).toEqual([9, 8, 7, 6]);

    await app.close();
  });

  it("sends both the character template and direction reference to APIMart direction generation", async () => {
    const storageDir = makeStorageDir();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.apimart.ai/v1/images/generations");
      const body = JSON.parse(String(init?.body ?? "{}"));
      expect(body).toMatchObject({
        model: "gpt-image-2",
        prompt: "APIMart walk direction prompt",
        n: 1,
        size: "1:1",
        resolution: "1k"
      });
      expect(body.image_urls).toHaveLength(2);
      expect(body.image_urls[0]).toBe("data:image/png;base64,VEVNUExBVEU=");
      expect(body.image_urls[1]).toEqual(expect.stringMatching(/^data:image\/png;base64,/));
      return Response.json({
        data: [
          {
            url: "data:image/png;base64,CQgHBg=="
          }
        ]
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      openAiCompatibleBaseUrl: "https://api.apimart.ai/v1",
      openAiCompatibleApiKey: TEST_COMPATIBLE_API_KEY,
      storageDir
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/generation/direction-template",
      headers: {
        "x-public-asset-base-url": "https://assets.example.com"
      },
      payload: {
        templateKind: "walk",
        model: "apimart/gpt-image-2",
        prompt: "APIMart walk direction prompt",
        targetSize: 1024,
        keyColor: "#00ff00",
        characterTemplateImageDataUrl: "data:image/png;base64,VEVNUExBVEU="
      }
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();

    await app.close();
  });

  it("rejects APIMart image generation when the compatible API key is missing", async () => {
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      storageDir: makeStorageDir()
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/generation/first-frame",
      payload: {
        model: "apimart/gpt-image-2",
        prompt: "APIMart first-frame prompt",
        targetSize: 1024,
        keyColor: "#00ff00"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("API key is not configured");

    await app.close();
  });

  it("uses the selected provider API key from request headers for APIMart images", async () => {
    const storageDir = makeStorageDir();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer sk-apimart-user-key"
      });
      return Response.json({
        data: [
          {
            url: "data:image/png;base64,CQgHBg=="
          }
        ]
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      storageDir
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/generation/first-frame",
      headers: {
        "x-ai-provider-id": "apimart",
        "x-ai-provider-api-key": "sk-apimart-user-key",
        "x-public-asset-base-url": "https://assets.example.com"
      },
      payload: {
        model: "apimart/gpt-image-2",
        prompt: "APIMart first-frame prompt",
        targetSize: 1024,
        keyColor: "#00ff00"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();

    await app.close();
  });

  it("rejects cross-provider model calls when the user selected another provider", async () => {
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      storageDir: makeStorageDir()
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/generation/first-frame",
      headers: {
        "x-ai-provider-id": "apimart",
        "x-ai-provider-api-key": "sk-apimart-user-key"
      },
      payload: {
        model: "google/gemini-3.1-flash-image-preview",
        prompt: "OpenRouter image prompt",
        targetSize: 1024,
        keyColor: "#00ff00"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("Selected provider does not match");

    await app.close();
  });

  it("serves the built-in cel anime style reference image for frontend preview", async () => {
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      openRouterApiKey: TEST_OPENROUTER_API_KEY,
      storageDir: makeStorageDir()
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/style-references/cel-anime-south-facing.png"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.rawPayload.length).toBeGreaterThan(1000);

    await app.close();
  });

  it("serves built-in four-direction idle and walk reference images", async () => {
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      openRouterApiKey: TEST_OPENROUTER_API_KEY,
      storageDir: makeStorageDir()
    });
    await app.ready();

    const idleResponse = await app.inject({
      method: "GET",
      url: "/direction-references/idle-4dir.png"
    });
    const walkResponse = await app.inject({
      method: "GET",
      url: "/direction-references/walk-4dir.png"
    });

    expect(idleResponse.statusCode).toBe(200);
    expect(walkResponse.statusCode).toBe(200);
    expect(idleResponse.headers["content-type"]).toContain("image/png");
    expect(walkResponse.headers["content-type"]).toContain("image/png");
    expect(idleResponse.rawPayload.length).toBeGreaterThan(1000);
    expect(walkResponse.rawPayload.length).toBeGreaterThan(1000);

    await app.close();
  });

  it("serves the built-in four-direction run reference image", async () => {
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      openRouterApiKey: TEST_OPENROUTER_API_KEY,
      storageDir: makeStorageDir()
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/direction-references/run-4dir.png"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.rawPayload.length).toBeGreaterThan(1000);

    await app.close();
  });

  it("stores a generated run four-direction image in the selected character advanced folder", async () => {
    const storageDir = makeStorageDir();
    const fetchMock = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              images: [
                {
                  image_url: {
                    url: "data:image/png;base64,AQIDBA=="
                  }
                }
              ]
            }
          }
        ]
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      openRouterApiKey: TEST_OPENROUTER_API_KEY,
      storageDir
    });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { name: "hero" }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/generation/direction-template",
      headers: {
        "x-openrouter-api-key": "sk-or-v1-web-key",
        "x-public-asset-base-url": "https://assets.example.com",
        "x-character-id": "hero"
      },
      payload: {
        templateKind: "run",
        model: "google/gemini-3.1-flash-image-preview",
        prompt: "生成跑步四方向图",
        targetSize: 1024,
        keyColor: "#00ff00",
        characterTemplateImageDataUrl: "data:image/png;base64,character-template"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      fileName: "run-4dir.png",
      imageUrl: "/characters/hero/advanced-character/run/keyframe-4dir.png",
      publicUrl: "https://assets.example.com/characters/hero/advanced-character/run/keyframe-4dir.png"
    });
    expect(existsSync(join(storageDir, "characters", "hero", "advanced-character", "run", "keyframe-4dir.png"))).toBe(true);

    await app.close();
  });

  it("builds four-direction generation payload with character template first and fixed reference second", async () => {
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      openRouterApiKey: TEST_OPENROUTER_API_KEY,
      storageDir: makeStorageDir()
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/generation/direction-template/payload",
      payload: {
        templateKind: "idle",
        model: "google/gemini-3.1-flash-image-preview",
        prompt: "生成待机四方向图",
        targetSize: 1024,
        keyColor: "#00ff00",
        characterTemplateImageDataUrl: "data:image/png;base64,character-template"
      }
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.messages[0].content[0]).toMatchObject({
      type: "text",
      text: "生成待机四方向图"
    });
    expect(payload.messages[0].content[1]).toMatchObject({
      type: "image_url",
      image_url: {
        url: "data:image/png;base64,character-template"
      }
    });
    expect(payload.messages[0].content[2]).toMatchObject({
      type: "image_url",
      image_url: {
        url: expect.stringMatching(/^data:image\/png;base64,/)
      }
    });

    await app.close();
  });

  it("accepts large character template data URLs for four-direction generation", async () => {
    const storageDir = makeStorageDir();
    const fetchMock = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              images: [
                {
                  image_url: {
                    url: "data:image/png;base64,AQIDBA=="
                  }
                }
              ]
            }
          }
        ]
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      openRouterApiKey: TEST_OPENROUTER_API_KEY,
      storageDir
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/generation/direction-template",
      headers: {
        "x-openrouter-api-key": "sk-or-v1-web-key",
        "x-public-asset-base-url": "https://assets.example.com"
      },
      payload: {
        templateKind: "walk",
        model: "google/gemini-3.1-flash-image-preview",
        prompt: "生成步行四方向图",
        targetSize: 1024,
        keyColor: "#00ff00",
        characterTemplateImageDataUrl: `data:image/png;base64,${"A".repeat(2 * 1024 * 1024)}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();

    await app.close();
  });

  it("removes a stale idle sheet when regenerating the walk four-direction sheet", async () => {
    const storageDir = makeStorageDir();
    const fetchMock = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              images: [
                {
                  image_url: {
                    url: "data:image/png;base64,AQIDBA=="
                  }
                }
              ]
            }
          }
        ]
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      openRouterApiKey: TEST_OPENROUTER_API_KEY,
      storageDir
    });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { name: "hero" }
    });
    const templateDir = join(storageDir, "characters", "hero", "base-character", "direction-templates");
    mkdirSync(templateDir, { recursive: true });
    writeFileSync(join(templateDir, "idle-4dir.png"), "old-idle");

    const response = await app.inject({
      method: "POST",
      url: "/api/generation/direction-template",
      headers: {
        "x-openrouter-api-key": "sk-or-v1-web-key",
        "x-public-asset-base-url": "https://assets.example.com",
        "x-character-id": "hero"
      },
      payload: {
        templateKind: "walk",
        model: "google/gemini-3.1-flash-image-preview",
        prompt: "生成步行四方向图",
        targetSize: 1024,
        keyColor: "#00ff00",
        characterTemplateImageDataUrl: "data:image/png;base64,character-template"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(existsSync(join(templateDir, "walk-4dir.png"))).toBe(true);
    expect(existsSync(join(templateDir, "idle-4dir.png"))).toBe(false);

    await app.close();
  });

  it("passes the fixed direction reference image to local Codex direction generation", async () => {
    const storageDir = makeStorageDir();
    const localCodexImageGenerator = vi.fn(async (input) => {
      expect(input.model).toBe("local/gpt-image-2");
      expect(input.prompt).toBe("生成本地四方向步行图");
      expect(input.imagePaths).toHaveLength(2);
      expect(readFileSync(input.imagePaths[0])).toEqual(Buffer.from([1, 2, 3, 4]));
      expect(readFileSync(input.imagePaths[1]).length).toBeGreaterThan(1000);
      return {
        buffer: Buffer.from([7, 7, 7, 7]),
        extension: "png" as const,
        providerResponse: {
          provider: "local-codex",
          model: "local/gpt-image-2"
        }
      };
    });
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      openRouterApiKey: TEST_OPENROUTER_API_KEY,
      storageDir,
      localCodexImageGenerator
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/generation/direction-template",
      headers: {
        "x-public-asset-base-url": "https://assets.example.com"
      },
      payload: {
        templateKind: "walk",
        model: "local/gpt-image-2",
        prompt: "生成本地四方向步行图",
        targetSize: 1024,
        keyColor: "#00ff00",
        characterTemplateImageDataUrl: "data:image/png;base64,AQIDBA=="
      }
    });

    expect(response.statusCode).toBe(200);
    expect(localCodexImageGenerator).toHaveBeenCalledOnce();
    expect([...readFileSync(response.json().localPath)]).toEqual([7, 7, 7, 7]);

    await app.close();
  });

  it("downloads generated direction images from OpenRouter content URLs with authorization", async () => {
    const storageDir = makeStorageDir();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://openrouter.ai/api/v1/chat/completions") {
        return Response.json({
          choices: [
            {
              message: {
                images: [
                  {
                    image_url: {
                      url: "https://openrouter.ai/api/v1/generation/image-content"
                    }
                  }
                ]
              }
            }
          ]
        });
      }
      if (url === "https://openrouter.ai/api/v1/generation/image-content") {
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer sk-or-v1-web-key"
        });
        return new Response(new Uint8Array([9, 8, 7, 6]), {
          status: 200,
          headers: {
            "content-type": "image/png"
          }
        });
      }
      return Response.json({ error: "unexpected fetch" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      openRouterApiKey: TEST_OPENROUTER_API_KEY,
      storageDir
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/generation/direction-template",
      headers: {
        "x-openrouter-api-key": "sk-or-v1-web-key",
        "x-public-asset-base-url": "https://assets.example.com"
      },
      payload: {
        templateKind: "idle",
        model: "google/gemini-3.1-flash-image-preview",
        prompt: "生成待机四方向图",
        targetSize: 1024,
        keyColor: "#00ff00",
        characterTemplateImageDataUrl: "data:image/png;base64,character-template"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(existsSync(response.json().localPath)).toBe(true);
    expect([...readFileSync(response.json().localPath)]).toEqual([9, 8, 7, 6]);

    await app.close();
  });

  it("uses the configured OpenRouter key instead of a web request header key", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://example.com/hero.png") {
        return new Response(new Uint8Array([1]), {
          headers: {
            "content-type": "image/png"
          }
        });
      }
      return Response.json({ id: "video_job_header_key" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      openRouterApiKey: TEST_OPENROUTER_API_KEY,
      storageDir: makeStorageDir()
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/generation/video",
      headers: {
        "x-openrouter-api-key": "sk-or-v1-header-ignored"
      },
      payload: {
        model: "bytedance/seedance-2.0",
        prompt: "正面奔跑循环",
        firstFrameUrl: "https://example.com/hero.png",
        durationSeconds: 4
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: "video_job_header_key" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        Authorization: "Bearer sk-or-v1-web-key"
      })
    });

    await app.close();
  });

  it("rejects local first-frame URLs before sending them to OpenRouter", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: "should_not_be_called" }));
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      openRouterApiKey: TEST_OPENROUTER_API_KEY,
      storageDir: makeStorageDir()
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/generation/video",
      headers: {
        "x-openrouter-api-key": "sk-or-v1-web-key"
      },
      payload: {
        model: "bytedance/seedance-2.0",
        prompt: "正面奔跑循环",
        firstFrameUrl: "http://127.0.0.1:8787/assets/hero.png",
        durationSeconds: 4
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("公网 HTTPS");
    expect(fetchMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("rejects public first-frame URLs that return an ngrok warning page instead of an image", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("ERR_NGROK_6024", {
        status: 200,
        headers: {
          "content-type": "text/plain"
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      openRouterApiKey: TEST_OPENROUTER_API_KEY,
      storageDir: makeStorageDir()
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/generation/video",
      headers: {
        "x-openrouter-api-key": "sk-or-v1-web-key"
      },
      payload: {
        model: "bytedance/seedance-2.0",
        prompt: "四方向走路循环",
        firstFrameUrl: "https://darn-skittle-unwoven.ngrok-free.dev/characters/hero/walk-4dir.png",
        durationSeconds: 4
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("公网图片 URL 返回的不是图片");
    expect(response.json().error).toContain("ERR_NGROK_6024");
    expect(fetchMock).toHaveBeenCalledOnce();

    await app.close();
  });

  it("returns OpenRouter provider errors instead of Fastify internal errors", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://example.com/hero.png") {
        return new Response(new Uint8Array([1]), {
          headers: {
            "content-type": "image/png"
          }
        });
      }
      return Response.json({ error: { message: "provider rejected first frame" } }, { status: 400 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      openRouterApiKey: TEST_OPENROUTER_API_KEY,
      storageDir: makeStorageDir()
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/generation/video",
      headers: {
        "x-openrouter-api-key": "sk-or-v1-web-key"
      },
      payload: {
        model: "bytedance/seedance-2.0",
        prompt: "正面奔跑循环",
        firstFrameUrl: "https://example.com/hero.png",
        durationSeconds: 4
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: expect.stringContaining("provider rejected first frame"),
      providerStatus: 400
    });

    await app.close();
  });

  it("submits videos with the selected model shortest duration and fixed defaults", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://example.com/hero.png") {
        return new Response(new Uint8Array([1]), {
          headers: {
            "content-type": "image/png"
          }
        });
      }
      return Response.json({ id: "video_job_seedance" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      openRouterApiKey: TEST_OPENROUTER_API_KEY,
      storageDir: makeStorageDir()
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/generation/video",
      headers: {
        "x-openrouter-api-key": "sk-or-v1-web-key"
      },
      payload: {
        model: "bytedance/seedance-2.0",
        prompt: "正面奔跑循环",
        firstFrameUrl: "https://example.com/hero.png"
      }
    });

    expect(response.statusCode).toBe(200);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(requestBody).toMatchObject({
      model: "bytedance/seedance-2.0",
      duration: 4,
      resolution: "720p",
      aspect_ratio: "1:1",
      generate_audio: false
    });
    expect(requestBody).not.toHaveProperty("size");

    await app.close();
  });

  it("polls a completed OpenRouter video job and stores source.mp4 under storage jobs", async () => {
    const storageDir = makeStorageDir();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/videos/video_job_done")) {
        return Response.json({
          id: "video_job_done",
          status: "completed",
          data: {
            url: "https://provider.example.com/video.mp4"
          }
        });
      }
      if (url === "https://provider.example.com/video.mp4") {
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: {
            "content-type": "video/mp4"
          }
        });
      }
      return Response.json({ error: "unexpected fetch" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      openRouterApiKey: TEST_OPENROUTER_API_KEY,
      storageDir
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/api/generation/video/video_job_done",
      headers: {
        "x-openrouter-api-key": "sk-or-v1-web-key"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      jobId: "video_job_done",
      status: "completed",
      localVideoUrl: "/jobs/video_job_done/source.mp4"
    });
    const savedPath = join(storageDir, "jobs", "video_job_done", "source.mp4");
    expect(existsSync(savedPath)).toBe(true);
    expect([...readFileSync(savedPath)]).toEqual([1, 2, 3, 4]);

    await app.close();
  });

  it("polls a completed OpenRouter video job and stores advanced action videos in the selected character folder", async () => {
    const storageDir = makeStorageDir();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/videos/video_job_run")) {
        return Response.json({
          id: "video_job_run",
          status: "completed",
          data: {
            url: "https://provider.example.com/run.mp4"
          }
        });
      }
      if (url === "https://provider.example.com/run.mp4") {
        return new Response(new Uint8Array([4, 3, 2, 1]), {
          status: 200,
          headers: {
            "content-type": "video/mp4"
          }
        });
      }
      return Response.json({ error: "unexpected fetch" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      openRouterApiKey: TEST_OPENROUTER_API_KEY,
      storageDir
    });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { name: "hero" }
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/generation/video/video_job_run?characterId=hero&actionKind=run",
      headers: {
        "x-openrouter-api-key": "sk-or-v1-web-key"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      jobId: "video_job_run",
      status: "completed",
      localVideoUrl: "/characters/hero/advanced-character/run/video/source.mp4"
    });
    const savedPath = join(storageDir, "characters", "hero", "advanced-character", "run", "video", "source.mp4");
    expect(existsSync(savedPath)).toBe(true);
    expect([...readFileSync(savedPath)]).toEqual([4, 3, 2, 1]);

    await app.close();
  });

  it("downloads completed OpenRouter video content from unsigned_urls with authorization", async () => {
    const storageDir = makeStorageDir();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://openrouter.ai/api/v1/videos/video_job_unsigned/content?index=0") {
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer sk-or-v1-web-key"
        });
        return new Response(new Uint8Array([5, 6, 7, 8]), {
          status: 200,
          headers: {
            "content-type": "video/mp4"
          }
        });
      }
      if (url.includes("/videos/video_job_unsigned")) {
        return Response.json({
          id: "video_job_unsigned",
          status: "completed",
          unsigned_urls: [
            "https://openrouter.ai/api/v1/videos/video_job_unsigned/content?index=0"
          ]
        });
      }
      return Response.json({ error: "unexpected fetch" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      openRouterApiKey: TEST_OPENROUTER_API_KEY,
      storageDir
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/api/generation/video/video_job_unsigned",
      headers: {
        "x-openrouter-api-key": "sk-or-v1-web-key"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      jobId: "video_job_unsigned",
      status: "completed",
      videoUrl: "https://openrouter.ai/api/v1/videos/video_job_unsigned/content?index=0",
      localVideoUrl: "/jobs/video_job_unsigned/source.mp4"
    });
    expect([...readFileSync(join(storageDir, "jobs", "video_job_unsigned", "source.mp4"))]).toEqual([5, 6, 7, 8]);

    await app.close();
  });
});
