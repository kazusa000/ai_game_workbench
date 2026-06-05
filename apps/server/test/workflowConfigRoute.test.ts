import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  const dir = mkdtempSync(join(tmpdir(), "ai-game-workbench-workflow-config-"));
  tempDirs.push(dir);
  return dir;
}

function makePresetsDir() {
  const dir = mkdtempSync(join(tmpdir(), "ai-game-workbench-presets-"));
  tempDirs.push(dir);
  return dir;
}

describe("module 01 workflow config route", () => {
  it("returns null when no backend workflow config has been saved", async () => {
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      presetsDir: makePresetsDir(),
      storageDir: makeStorageDir()
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/api/module01/workflow-config"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ config: null });

    await app.close();
  });

  it("fully replaces the saved backend workflow config", async () => {
    const storageDir = makeStorageDir();
    const presetsDir = makePresetsDir();
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      presetsDir,
      storageDir
    });
    await app.ready();

    await app.inject({
      method: "PUT",
      url: "/api/module01/workflow-config",
      payload: {
        imageSystemPrompt: "旧系统提示词",
        imageCustomPrompt: "旧自定义提示词"
      }
    });
    const response = await app.inject({
      method: "PUT",
      url: "/api/module01/workflow-config",
      payload: {
        videoSystemPrompt: "新视频系统提示词",
        videoCustomPrompt: "新视频自定义提示词"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      config: {
        videoSystemPrompt: "新视频系统提示词",
        videoCustomPrompt: "新视频自定义提示词"
      }
    });
    const savedPath = join(presetsDir, "module01", "workflow.json");
    expect(existsSync(savedPath)).toBe(true);
    expect(existsSync(join(storageDir, "config", "module01-workflow.json"))).toBe(false);
    expect(JSON.parse(readFileSync(savedPath, "utf8"))).toEqual({
      videoSystemPrompt: "新视频系统提示词",
      videoCustomPrompt: "新视频自定义提示词"
    });

    const getResponse = await app.inject({
      method: "GET",
      url: "/api/module01/workflow-config"
    });
    expect(getResponse.json()).toEqual(response.json());

    await app.close();
  });

  it("allows browser PUT preflight requests for saving workflow config", async () => {
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      presetsDir: makePresetsDir(),
      storageDir: makeStorageDir()
    });
    await app.ready();

    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/module01/workflow-config",
      headers: {
        origin: "http://127.0.0.1:5173",
        "access-control-request-method": "PUT",
        "access-control-request-headers": "content-type"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain("PUT");

    await app.close();
  });

  it("saves module 02 workflow config under presets", async () => {
    const storageDir = makeStorageDir();
    const presetsDir = makePresetsDir();
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      presetsDir,
      storageDir
    });
    await app.ready();

    const response = await app.inject({
      method: "PUT",
      url: "/api/module02/workflow-config",
      payload: {
        basePrompt: "pixel idle prompt",
        walkPrompt: "pixel walk prompt"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      config: {
        basePrompt: "pixel idle prompt",
        walkPrompt: "pixel walk prompt"
      }
    });
    const savedPath = join(presetsDir, "module02", "workflow.json");
    expect(existsSync(savedPath)).toBe(true);
    expect(JSON.parse(readFileSync(savedPath, "utf8"))).toEqual({
      basePrompt: "pixel idle prompt",
      walkPrompt: "pixel walk prompt"
    });

    const getResponse = await app.inject({
      method: "GET",
      url: "/api/module02/workflow-config"
    });
    expect(getResponse.json()).toEqual(response.json());

    await app.close();
  });
});
