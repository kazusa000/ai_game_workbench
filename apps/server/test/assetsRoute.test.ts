import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "ai-game-workbench-assets-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("asset routes", () => {
  it("returns the cloudflared public asset base written by the startup script", async () => {
    await mkdir(join(tempDir, "config"), { recursive: true });
    await writeFile(join(tempDir, "config", "public-tunnel.json"), `\uFEFF${JSON.stringify({
      provider: "cloudflare-quick-tunnel",
      url: "https://auto-tunnel.trycloudflare.com",
      publicAssetBaseUrl: "https://auto-tunnel.trycloudflare.com/assets",
      updatedAt: "2026-06-05T00:00:00.000Z"
    })}`);
    const app = createApp({
      storageDir: tempDir,
      port: 8787
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/runtime-config"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      publicAssetBaseUrl: "https://auto-tunnel.trycloudflare.com/assets",
      publicTunnelProvider: "cloudflare-quick-tunnel",
      publicTunnelUrl: "https://auto-tunnel.trycloudflare.com"
    });
  });

  it("creates and lists character folders without metadata files", async () => {
    const app = createApp({
      storageDir: tempDir,
      port: 8787
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { name: "hero" }
    });
    const listResponse = await app.inject({
      method: "GET",
      url: "/api/characters"
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json()).toEqual({ id: "hero", name: "hero" });
    expect(listResponse.json()).toEqual({ characters: [{ id: "hero", name: "hero" }] });
    await expect(readFile(join(tempDir, "characters", "hero", "character.json"))).rejects.toThrow();
  });

  it("uploads a character reference into the selected character folder", async () => {
    const app = createApp({
      storageDir: tempDir,
      port: 8787
    });
    await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { name: "hero" }
    });
    const boundary = "----ai-game-workbench-test";
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="hero.png"',
      "Content-Type: image/png",
      "",
      "fake-png-bytes",
      `--${boundary}--`,
      ""
    ].join("\r\n");

    const response = await app.inject({
      method: "POST",
      url: "/api/assets/first-frame",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "x-public-asset-base-url": "https://asset-tunnel.example.com",
        "x-character-id": "hero"
      },
      payload
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      localUrl: "/characters/hero/base-template/character-reference.png",
      publicUrl: "https://asset-tunnel.example.com/characters/hero/base-template/character-reference.png"
    });
    expect(await readFile(join(tempDir, "characters", "hero", "base-template", "character-reference.png"), "utf8")).toBe("fake-png-bytes");
  });

  it("uploads a first-frame image and returns a public asset URL", async () => {
    const app = createApp({
      storageDir: tempDir,
      port: 8787,
      publicAssetBaseUrl: "http://127.0.0.1:8787/assets"
    });
    const boundary = "----ai-game-workbench-test";
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="hero.png"',
      "Content-Type: image/png",
      "",
      "fake-png-bytes",
      `--${boundary}--`,
      ""
    ].join("\r\n");

    const response = await app.inject({
      method: "POST",
      url: "/api/assets/first-frame",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`
      },
      payload
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.fileName).toBe("hero.png");
    expect(body.localUrl).toMatch(/^\/assets\/.+\.png$/);
    expect(body.publicUrl).toMatch(/^http:\/\/127\.0\.0\.1:8787\/assets\/.+\.png$/);
    expect(await readFile(body.localPath, "utf8")).toBe("fake-png-bytes");
  });

  it("uses a tunnel base URL from the upload request", async () => {
    const app = createApp({
      storageDir: tempDir,
      port: 8787
    });
    const boundary = "----ai-game-workbench-test";
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="hero.png"',
      "Content-Type: image/png",
      "",
      "fake-png-bytes",
      `--${boundary}--`,
      ""
    ].join("\r\n");

    const response = await app.inject({
      method: "POST",
      url: "/api/assets/first-frame",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "x-public-asset-base-url": "https://asset-tunnel.trycloudflare.com"
      },
      payload
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().localUrl).toMatch(/^\/assets\/.+\.png$/);
    expect(response.json().publicUrl).toMatch(/^https:\/\/asset-tunnel\.trycloudflare\.com\/assets\/.+\.png$/);
  });

  it("rejects non-HTTPS tunnel base URLs from the upload request", async () => {
    const app = createApp({
      storageDir: tempDir,
      port: 8787
    });
    const boundary = "----ai-game-workbench-test";
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="hero.png"',
      "Content-Type: image/png",
      "",
      "fake-png-bytes",
      `--${boundary}--`,
      ""
    ].join("\r\n");

    const response = await app.inject({
      method: "POST",
      url: "/api/assets/first-frame",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "x-public-asset-base-url": "http://asset-tunnel.local"
      },
      payload
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("HTTPS");
  });

  it("uploads a frame-processing video as a local job source", async () => {
    const app = createApp({
      storageDir: tempDir,
      port: 8787
    });
    const boundary = "----ai-game-workbench-test";
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="source.mp4"',
      "Content-Type: video/mp4",
      "",
      "fake-video-bytes",
      `--${boundary}--`,
      ""
    ].join("\r\n");

    const response = await app.inject({
      method: "POST",
      url: "/api/assets/frame-video",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`
      },
      payload
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.jobId).toMatch(/^local-video-/);
    expect(body.localVideoUrl).toBe(`/jobs/${body.jobId}/source.mp4`);
    expect(await readFile(body.localPath, "utf8")).toBe("fake-video-bytes");
  });

  it("uploads a character frame-processing video without putting the character name in the job id", async () => {
    const app = createApp({
      storageDir: tempDir,
      port: 8787
    });
    await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { name: "测试角色" }
    });
    const boundary = "----ai-game-workbench-test";
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="source.mp4"',
      "Content-Type: video/mp4",
      "",
      "fake-video-bytes",
      `--${boundary}--`,
      ""
    ].join("\r\n");

    const response = await app.inject({
      method: "POST",
      url: "/api/assets/frame-video",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "x-character-id": encodeURIComponent("测试角色")
      },
      payload
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.jobId).toMatch(/^local-video-[0-9a-f-]+$/);
    expect(body.localVideoUrl).toBe("/characters/%E6%B5%8B%E8%AF%95%E8%A7%92%E8%89%B2/base-character/walk-video/source.mp4");
    expect(await readFile(join(tempDir, "characters", "测试角色", "base-character", "walk-video", "source.mp4"), "utf8")).toBe(
      "fake-video-bytes"
    );
  });

  it("uploads an attack middle frame into the selected character folder", async () => {
    const app = createApp({
      storageDir: tempDir,
      port: 8787
    });
    await app.inject({
      method: "POST",
      url: "/api/characters",
      payload: { name: "hero" }
    });
    const boundary = "----ai-game-workbench-test";
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="middle.png"',
      "Content-Type: image/png",
      "",
      "fake-middle-bytes",
      `--${boundary}--`,
      ""
    ].join("\r\n");

    const response = await app.inject({
      method: "POST",
      url: "/api/assets/first-frame",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "x-public-asset-base-url": "https://asset-tunnel.example.com",
        "x-character-id": "hero",
        "x-character-asset-kind": "advanced-midframe",
        "x-character-action-kind": "attack-1"
      },
      payload
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      localUrl: "/characters/hero/advanced-character/attack-1/midframe/middle-4dir.png",
      publicUrl: "https://asset-tunnel.example.com/characters/hero/advanced-character/attack-1/midframe/middle-4dir.png"
    });
    expect(await readFile(join(tempDir, "characters", "hero", "advanced-character", "attack-1", "midframe", "middle-4dir.png"), "utf8")).toBe(
      "fake-middle-bytes"
    );
  });
});
