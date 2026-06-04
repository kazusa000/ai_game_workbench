import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "ai-game-workbench-app-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("app routes", () => {
  it("reports the active storage directory in health checks", async () => {
    const app = createApp({ storageDir: tempDir });

    const response = await app.inject({
      method: "GET",
      url: "/api/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      storageDir: tempDir
    });

    await app.close();
  });
});
