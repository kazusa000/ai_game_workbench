import ffmpegStaticPath from "ffmpeg-static";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig, resolveDefaultFfmpegPath, resolveDefaultStorageDir } from "../src/config";

const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("server config", () => {
  it("uses the bundled ffmpeg-static binary when FFMPEG_PATH is not set", () => {
    expect(resolveDefaultFfmpegPath()).toBe(ffmpegStaticPath);
    expect(loadConfig({}).ffmpegPath).toBe(ffmpegStaticPath);
  });

  it("lets FFMPEG_PATH override the bundled binary", () => {
    expect(loadConfig({ FFMPEG_PATH: "custom-ffmpeg" }).ffmpegPath).toBe("custom-ffmpeg");
  });

  it("uses apps/server/storage as the stable default storage folder", () => {
    expect(resolveDefaultStorageDir()).toBe(resolve(SERVER_ROOT, "storage"));
    expect(loadConfig({}).storageDir).toBe(resolve(SERVER_ROOT, "storage"));
  });

  it("resolves relative STORAGE_DIR values from apps/server", () => {
    expect(loadConfig({ STORAGE_DIR: "./storage" }).storageDir).toBe(resolve(SERVER_ROOT, "storage"));
    expect(loadConfig({ STORAGE_DIR: "custom-storage" }).storageDir).toBe(resolve(SERVER_ROOT, "custom-storage"));
  });
});
