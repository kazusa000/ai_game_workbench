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
  const dir = mkdtempSync(join(tmpdir(), "ai-game-workbench-provider-settings-"));
  tempDirs.push(dir);
  return dir;
}

describe("provider settings routes", () => {
  it("publishes enabled provider models with APIMart as the default image model", async () => {
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      storageDir: makeStorageDir()
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/api/provider-models"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      defaults: {
        imageModelId: "apimart/gpt-image-2",
        videoModelId: "bytedance/seedance-2.0"
      },
      imageModels: expect.arrayContaining([
        expect.objectContaining({
          id: "apimart/gpt-image-2",
          providerId: "openrouter-compatible",
          upstreamModel: "gpt-image-2"
        })
      ])
    });

    await app.close();
  });

  it("requires the admin token for provider settings and never returns full secrets", async () => {
    const storageDir = makeStorageDir();
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      adminSettingsToken: "admin-test-token",
      storageDir
    });
    await app.ready();

    const missingTokenResponse = await app.inject({
      method: "GET",
      url: "/api/admin/provider-settings"
    });
    const wrongTokenResponse = await app.inject({
      method: "GET",
      url: "/api/admin/provider-settings",
      headers: {
        "x-admin-settings-token": "wrong-token"
      }
    });
    const saveResponse = await app.inject({
      method: "PUT",
      url: "/api/admin/provider-settings",
      headers: {
        "x-admin-settings-token": "admin-test-token"
      },
      payload: {
        providers: [
          {
            id: "openrouter-compatible",
            label: "APIMart images endpoint",
            kind: "openai-images",
            enabled: true,
            baseUrl: "https://api.apimart.ai/v1"
          }
        ],
        models: [
          {
            id: "apimart/gpt-image-2",
            providerId: "openrouter-compatible",
            upstreamModel: "gpt-image-2",
            label: "APIMart GPT-Image-2",
            capability: "image",
            enabled: true,
            imageSizeOptions: [{ size: 1024, label: "1024 x 1024" }],
            defaultImageSize: 1024
          }
        ],
        defaults: {
          imageModelId: "apimart/gpt-image-2",
          videoModelId: "bytedance/seedance-2.0"
        },
        secrets: {
          "openrouter-compatible": {
            apiKey: "sk-compatible-secret-tail"
          }
        }
      }
    });
    const readResponse = await app.inject({
      method: "GET",
      url: "/api/admin/provider-settings",
      headers: {
        "x-admin-settings-token": "admin-test-token"
      }
    });

    expect(missingTokenResponse.statusCode).toBe(401);
    expect(wrongTokenResponse.statusCode).toBe(401);
    expect(saveResponse.statusCode).toBe(200);
    expect(readResponse.statusCode).toBe(200);
    expect(readResponse.json().secrets["openrouter-compatible"]).toEqual({ configured: true, suffix: "tail" });
    expect(JSON.stringify(readResponse.json())).not.toContain("sk-compatible-secret-tail");

    await app.close();
  });

  it("reports a missing admin token configuration before allowing settings writes", async () => {
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      storageDir: makeStorageDir()
    });
    await app.ready();

    const response = await app.inject({
      method: "PUT",
      url: "/api/admin/provider-settings",
      headers: {
        "x-admin-settings-token": "admin-test-token"
      },
      payload: {}
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error).toContain("ADMIN_SETTINGS_TOKEN");

    await app.close();
  });

  it("reads provider secret files that include a UTF-8 BOM", async () => {
    const storageDir = makeStorageDir();
    mkdirSync(join(storageDir, "config"), { recursive: true });
    writeFileSync(
      join(storageDir, "config", "provider-secrets.json"),
      `\uFEFF${JSON.stringify({ apiKeys: { "openrouter-compatible": "sk-compatible-bom-tail" } })}`,
      "utf8"
    );
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      adminSettingsToken: "admin-test-token",
      storageDir
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/api/admin/provider-settings",
      headers: {
        "x-admin-settings-token": "admin-test-token"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().secrets["openrouter-compatible"]).toEqual({ configured: true, suffix: "tail" });
    expect(JSON.stringify(response.json())).not.toContain("sk-compatible-bom-tail");

    await app.close();
  });
});
