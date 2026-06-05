import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  const dir = mkdtempSync(join(tmpdir(), "ai-game-workbench-reference-images-"));
  tempDirs.push(dir);
  return dir;
}

function makePresetsDir() {
  const dir = mkdtempSync(join(tmpdir(), "ai-game-workbench-presets-"));
  tempDirs.push(dir);
  return dir;
}

describe("module 01 reference image routes", () => {
  it("serves a globally overridden cel anime style reference image", async () => {
    const storageDir = makeStorageDir();
    const presetsDir = makePresetsDir();
    const overrideDir = join(presetsDir, "module01", "base-template");
    mkdirSync(overrideDir, { recursive: true });
    writeFileSync(join(overrideDir, "style-reference.png"), "style-override");
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      presetsDir,
      storageDir
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/style-references/cel-anime-south-facing.png"
    });

    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.toString("utf8")).toBe("style-override");

    await app.close();
  });

  it("uploads and globally overwrites the walk direction reference image", async () => {
    const storageDir = makeStorageDir();
    const presetsDir = makePresetsDir();
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      presetsDir,
      storageDir
    });
    await app.ready();

    const multipart = buildMultipartImagePayload("walk-reference.png", onePixelPng());
    const response = await app.inject({
      method: "POST",
      url: "/api/module01/reference-images/walk",
      headers: {
        "content-type": multipart.contentType
      },
      payload: multipart.payload
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      kind: "walk",
      fileName: "walk-reference.png",
      storedName: "walk-4dir.png",
      url: "/direction-references/walk-4dir.png"
    });
    const savedPath = join(presetsDir, "module01", "walk", "direction-reference.png");
    expect(existsSync(savedPath)).toBe(true);
    expect(existsSync(join(storageDir, "config", "reference-images", "walk-4dir.png"))).toBe(false);
    expect(readFileSync(savedPath).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

    await app.close();
  });

  it("uploads and globally overwrites the run direction reference image", async () => {
    const storageDir = makeStorageDir();
    const presetsDir = makePresetsDir();
    const app = createApp({
      ffmpegPath: "ffmpeg",
      port: 8787,
      presetsDir,
      storageDir
    });
    await app.ready();

    const multipart = buildMultipartImagePayload("run-reference.png", onePixelPng());
    const response = await app.inject({
      method: "POST",
      url: "/api/module01/reference-images/run",
      headers: {
        "content-type": multipart.contentType
      },
      payload: multipart.payload
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      kind: "run",
      fileName: "run-reference.png",
      storedName: "run-4dir.png",
      url: "/direction-references/run-4dir.png"
    });
    expect(existsSync(join(presetsDir, "module01", "run", "direction-reference.png"))).toBe(true);
    expect(existsSync(join(storageDir, "config", "reference-images", "run-4dir.png"))).toBe(false);

    await app.close();
  });
});

function buildMultipartImagePayload(filename: string, content: Buffer) {
  const boundary = "----ai-game-workbench-test-boundary";
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        "Content-Type: image/png\r\n\r\n",
        "utf8"
      ),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`, "utf8")
    ])
  };
}

function onePixelPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64"
  );
}
