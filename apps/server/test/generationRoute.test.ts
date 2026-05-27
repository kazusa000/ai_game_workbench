import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

describe("generation route", () => {
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
        model: "bytedance-seed/seedream-4.5",
        prompt: "正面像素角色",
        targetSize: 256,
        keyColor: "#00ff00",
        direction: "front"
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

    await app.close();
  });

  it("uses an OpenRouter key supplied by the web request header", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: "video_job_header_key" }));
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
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

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: "video_job_header_key" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
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

  it("returns OpenRouter provider errors instead of Fastify internal errors", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ error: { message: "provider rejected first frame" } }, { status: 400 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
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
    const fetchMock = vi.fn(async () => Response.json({ id: "video_job_kling" }));
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
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
        model: "kwaivgi/kling-v3.0-std",
        prompt: "正面奔跑循环",
        firstFrameUrl: "https://example.com/hero.png"
      }
    });

    expect(response.statusCode).toBe(200);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({
      model: "kwaivgi/kling-v3.0-std",
      duration: 3,
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
