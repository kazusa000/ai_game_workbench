import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
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
  const dir = mkdtempSync(join(tmpdir(), "ai-game-workbench-module02-"));
  tempDirs.push(dir);
  return dir;
}

const TEST_OPENROUTER_API_KEY = "sk-or-v1-web-key";

describe("module 02 pixel character routes", () => {
  it("creates, lists, loads, and deletes pixel character folders", async () => {
    const storageDir = makeStorageDir();
    const app = createApp({ storageDir, port: 8787, ffmpegPath: "ffmpeg", openRouterApiKey: TEST_OPENROUTER_API_KEY });
    await app.ready();

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/module02/characters",
      payload: { name: "hero" }
    });
    const listResponse = await app.inject({
      method: "GET",
      url: "/api/module02/characters"
    });
    const assetsResponse = await app.inject({
      method: "GET",
      url: "/api/module02/characters/hero/assets"
    });
    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/api/module02/characters/hero"
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json()).toEqual({ id: "hero", name: "hero" });
    expect(listResponse.json()).toEqual({ characters: [{ id: "hero", name: "hero" }] });
    expect(assetsResponse.statusCode).toBe(200);
    expect(assetsResponse.json()).toMatchObject({
      characterId: "hero",
      assets: {
        baseTemplate: {},
        walkTemplate: {},
        slices: {
          idle: { frames: [] },
          walk: { frames: [] }
        }
      }
    });
    expect(deleteResponse.json()).toEqual({
      deleted: true,
      character: { id: "hero", name: "hero" }
    });
    expect(existsSync(join(storageDir, "characters_pixel", "hero"))).toBe(false);

    await app.close();
  });

  it("uploads module 02 assets under characters_pixel and returns module02 URLs", async () => {
    const storageDir = makeStorageDir();
    const app = createApp({ storageDir, port: 8787, ffmpegPath: "ffmpeg", openRouterApiKey: TEST_OPENROUTER_API_KEY });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/api/module02/characters",
      payload: { name: "hero" }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/module02/characters/hero/assets/base-template",
      headers: {
        "content-type": "multipart/form-data; boundary=----module02-test",
        "x-public-asset-base-url": "https://assets.example.com"
      },
      payload: multipartPayload("base.png", "image/png", "base-template")
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      fileName: "base.png",
      storedName: "output.png",
      localUrl: "/module02/characters/hero/base-template/output.png",
      publicUrl: "https://assets.example.com/module02/characters/hero/base-template/output.png"
    });
    expect(readFileSync(join(storageDir, "characters_pixel", "hero", "base-template", "output.png"), "utf8")).toBe("base-template");

    await app.close();
  });

  it("serves module 02 built-in reference assets and configured actions", async () => {
    const app = createApp({ storageDir: makeStorageDir(), port: 8787, ffmpegPath: "ffmpeg" });
    await app.ready();

    const actionsResponse = await app.inject({
      method: "GET",
      url: "/api/module02/generation/sprite-sheet/actions"
    });
    const referenceResponse = await app.inject({
      method: "GET",
      url: "/module02/action-references/walk-4x10-no-shadow.png"
    });

    expect(actionsResponse.statusCode).toBe(200);
    expect(actionsResponse.json().actions.map((action: { id: string }) => action.id)).toEqual(["idle", "walk"]);
    expect(referenceResponse.statusCode).toBe(200);
    expect(referenceResponse.headers["content-type"]).toContain("image/png");
    expect(referenceResponse.rawPayload.length).toBeGreaterThan(1000);

    await app.close();
  });

  it("builds and stores module 02 sprite sheets in the selected pixel character folder", async () => {
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
    const app = createApp({ storageDir, port: 8787, ffmpegPath: "ffmpeg", openRouterApiKey: TEST_OPENROUTER_API_KEY });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/api/module02/characters",
      payload: { name: "hero" }
    });
    await mkdir(join(storageDir, "characters_pixel", "hero", "base-template"), { recursive: true });
    writeFileSync(join(storageDir, "characters_pixel", "hero", "base-template", "character-reference.png"), Buffer.from([9, 9, 9]));

    const payloadResponse = await app.inject({
      method: "POST",
      url: "/api/module02/generation/sprite-sheet/payload",
      payload: {
        actionId: "idle",
        model: "google/gemini-3.1-flash-image-preview",
        constraintPrompt: "生成角色基准模板",
        customPrompt: "银发黑衣",
        keyColor: "#00ff00",
        pixelCharacterId: "hero",
        characterReferenceUrl: "/module02/characters/hero/base-template/character-reference.png"
      }
    });
    const generationResponse = await app.inject({
      method: "POST",
      url: "/api/module02/generation/sprite-sheet",
      headers: {
        "x-public-asset-base-url": "https://assets.example.com"
      },
      payload: {
        actionId: "walk",
        model: "google/gemini-3.1-flash-image-preview",
        constraintPrompt: "生成四方向步行图",
        keyColor: "#00ff00",
        pixelCharacterId: "hero",
        characterReferenceUrl: "/module02/characters/hero/base-template/character-reference.png"
      }
    });

    expect(payloadResponse.statusCode).toBe(200);
    expect(payloadResponse.json().messages[0].content).toEqual([
      expect.objectContaining({ type: "text", text: expect.stringContaining("银发黑衣") }),
      expect.objectContaining({ type: "image_url" }),
      expect.objectContaining({ type: "image_url" })
    ]);
    expect(generationResponse.statusCode).toBe(200);
    expect(generationResponse.json()).toMatchObject({
      fileName: "output.png",
      spriteSheetUrl: "/module02/characters/hero/walk-template/output.png",
      publicUrl: "https://assets.example.com/module02/characters/hero/walk-template/output.png"
    });
    expect([...readFileSync(join(storageDir, "characters_pixel", "hero", "walk-template", "output.png"))]).toEqual([1, 2, 3, 4]);

    await app.close();
  });

  it("cuts module 02 sprite sheets from module02 character URLs into character slice frames", async () => {
    const storageDir = makeStorageDir();
    const app = createApp({ storageDir, port: 8787, ffmpegPath: "ffmpeg" });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/api/module02/characters",
      payload: { name: "hero" }
    });
    await mkdir(join(storageDir, "characters_pixel", "hero", "walk-template"), { recursive: true });
    writeFileSync(join(storageDir, "characters_pixel", "hero", "walk-template", "output.png"), await createTestSheet());

    const response = await app.inject({
      method: "POST",
      url: "/api/module02/processing/sprite-sheet",
      payload: {
        pixelCharacterId: "hero",
        sliceKind: "walk",
        sourceUrl: "/module02/characters/hero/walk-template/output.png",
        rows: 2,
        columns: 2,
        keyColor: "#00ff00",
        tolerance: 8,
        centerFrames: true,
        outputFrameWidth: 64,
        outputFrameHeight: 64
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      jobId: "module02-character-hero-walk",
      rows: 2,
      columns: 2,
      frameCount: 4,
      frames: expect.arrayContaining([
        expect.objectContaining({
          row: 1,
          index: 1,
          url: "/module02/characters/hero/slices/walk/frames/row_001/frame_001.png"
        })
      ])
    });
    expect(existsSync(join(storageDir, "characters_pixel", "hero", "slices", "walk", "frames", "row_001", "frame_001.png"))).toBe(true);

    await app.close();
  });
});

function multipartPayload(fileName: string, contentType: string, body: string) {
  return [
    "------module02-test",
    `Content-Disposition: form-data; name="file"; filename="${fileName}"`,
    `Content-Type: ${contentType}`,
    "",
    body,
    "------module02-test--",
    ""
  ].join("\r\n");
}

async function createTestSheet(): Promise<Buffer> {
  const cell = 8;
  return sharp({
    create: {
      width: cell * 2,
      height: cell * 2,
      channels: 4,
      background: { r: 0, g: 255, b: 0, alpha: 1 }
    }
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: 4,
            height: 4,
            channels: 4,
            background: { r: 255, g: 0, b: 0, alpha: 1 }
          }
        }).png().toBuffer(),
        left: 2,
        top: 2
      }
    ])
    .png()
    .toBuffer();
}
