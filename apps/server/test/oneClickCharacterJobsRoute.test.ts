import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeStorageDir() {
  const dir = mkdtempSync(join(tmpdir(), "ai-game-workbench-one-click-"));
  tempDirs.push(dir);
  return dir;
}

function makePresetsDir() {
  const dir = mkdtempSync(join(tmpdir(), "ai-game-workbench-presets-"));
  tempDirs.push(dir);
  return dir;
}

function makeStartPayload(overrides: Record<string, unknown> = {}) {
  return {
    characterName: "hero",
    overwrite: false,
    publicAssetBaseUrl: "https://assets.example.com",
    referenceImageDataUrl: "data:image/png;base64,AQIDBA==",
    firstFrame: {
      model: "google/gemini-3.1-flash-image-preview",
      prompt: "base template prompt",
      targetSize: 1024,
      keyColor: "#00ff00",
      style: "cel-anime"
    },
    actions: {
      run: false,
      attack1: false,
      jump: false
    },
    ...overrides
  };
}

describe("one-click character jobs route", () => {
  it("requires overwrite confirmation before replacing an existing character folder", async () => {
    const storageDir = makeStorageDir();
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      storageDir,
      oneClickCharacterJobRunner: async () => undefined
    });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { name: "hero" }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/module01/one-click-character-jobs",
      payload: makeStartPayload()
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "CHARACTER_EXISTS",
      characterId: "hero"
    });

    await app.close();
  });

  it("starts a backend job with percentage progress and step state", async () => {
    const storageDir = makeStorageDir();
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      storageDir,
      oneClickCharacterJobRunner: async (_job, context) => {
        context.updateStep("create-character", "completed");
        context.updateStep("base-template", "completed", {
          resultUrl: "/characters/hero/base-template/output.png"
        });
      }
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/module01/one-click-character-jobs",
      headers: {
        "x-ai-provider-id": "apimart",
        "x-ai-provider-api-key": "sk-apimart-test"
      },
      payload: makeStartPayload({
        firstFrame: {
          model: "apimart/gpt-image-2",
          prompt: "base template prompt",
          targetSize: 1024,
          keyColor: "#00ff00",
          style: "cel-anime"
        }
      })
    });

    expect(response.statusCode).toBe(202);
    const started = response.json();
    expect(started.job).toMatchObject({
      characterId: "hero",
      status: "running",
      progressPercent: expect.any(Number),
      currentStep: expect.any(String)
    });
    expect(started.job.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "base-template", label: expect.any(String), status: expect.any(String) }),
      expect.objectContaining({ id: "walk-video", label: expect.any(String), status: expect.any(String) }),
      expect.objectContaining({ id: "walk-loop-export", label: expect.any(String), status: expect.any(String) }),
      expect.objectContaining({ id: "idle-loop-export", label: expect.any(String), status: expect.any(String) })
    ]));

    const statusResponse = await app.inject({
      method: "GET",
      url: `/api/module01/one-click-character-jobs/${encodeURIComponent(started.job.jobId)}`
    });

    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json().job.progressPercent).toBeGreaterThanOrEqual(0);
    expect(statusResponse.json().job.progressPercent).toBeLessThanOrEqual(100);

    await app.close();
  });

  it("starts with APIMart when presets saved the OpenRouter Seedance model", async () => {
    const storageDir = makeStorageDir();
    const presetsDir = makePresetsDir();
    mkdirSync(join(presetsDir, "module01"), { recursive: true });
    writeFileSync(join(presetsDir, "module01", "workflow.json"), JSON.stringify({
      videoModel: "bytedance/seedance-2.0",
      videoDurationSeconds: 4,
      videoResolution: "720p"
    }));
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      presetsDir,
      storageDir,
      oneClickCharacterJobRunner: async () => undefined
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/module01/one-click-character-jobs",
      headers: {
        "x-ai-provider-id": "apimart",
        "x-ai-provider-api-key": "sk-apimart-test"
      },
      payload: makeStartPayload({
        firstFrame: {
          model: "apimart/gpt-image-2",
          prompt: "base template prompt",
          targetSize: 1024,
          keyColor: "#00ff00",
          style: "cel-anime"
        }
      })
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().job).toMatchObject({
      characterId: "hero",
      status: "running"
    });

    await app.close();
  });

  it("refuses attack generation when the saved attack midframe prompt is empty", async () => {
    const storageDir = makeStorageDir();
    const presetsDir = makePresetsDir();
    mkdirSync(join(presetsDir, "module01"), { recursive: true });
    writeFileSync(join(presetsDir, "module01", "workflow.json"), JSON.stringify({
      advancedAttackMidframeCustomPrompt: ""
    }));
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      presetsDir,
      storageDir,
      oneClickCharacterJobRunner: async () => undefined
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/module01/one-click-character-jobs",
      payload: makeStartPayload({
        actions: {
          run: false,
          attack1: true,
          jump: false
        }
      })
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("攻击中间帧");

    await app.close();
  });

  it("saves provider keys through the admin settings API without exposing the full value", async () => {
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      adminSettingsToken: "admin-test-token",
      storageDir: makeStorageDir()
    });
    await app.ready();

    const saveResponse = await app.inject({
      method: "PUT",
      url: "/api/admin/provider-settings",
      headers: {
        "x-admin-settings-token": "admin-test-token"
      },
      payload: {
        providers: [],
        models: [],
        defaults: {},
        secrets: {
          openrouter: {
            apiKey: "sk-or-v1-secret-tail"
          }
        }
      }
    });
    expect(saveResponse.statusCode).toBe(200);
    expect(saveResponse.json().secrets.openrouter).toEqual({ configured: true, suffix: "tail" });

    const readResponse = await app.inject({
      method: "GET",
      url: "/api/admin/provider-settings",
      headers: {
        "x-admin-settings-token": "admin-test-token"
      }
    });
    expect(readResponse.statusCode).toBe(200);
    expect(readResponse.json().secrets.openrouter).toEqual({ configured: true, suffix: "tail" });
    expect(JSON.stringify(readResponse.json())).not.toContain("sk-or-v1-secret-tail");

    await app.close();
  });
});
