import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFirstFrameGeneration,
  getVideoGenerationStatus,
  getModule01WorkflowConfig,
  saveModule01WorkflowConfig,
  uploadFirstFrameAsset,
  uploadFrameVideoAsset
} from "../src/api/client";
import { App } from "../src/App";

const fetchMock = vi.fn();
const characterBase = "/characters/hero";
const pixelCharacterBase = "/module02/characters/pixel-hero";
let videoStatusPayload: unknown;
let module01WorkflowConfigPayload: unknown;
let advancedCharacterAssetsPayload: unknown;
let pixelCharacters: Array<{ id: string; name: string }>;

beforeEach(() => {
  const NativeURL = globalThis.URL;
  class TestURL extends NativeURL {
    static createObjectURL = vi.fn(() => "blob:uploaded-input-preview");
    static revokeObjectURL = vi.fn();
  }
  vi.stubGlobal("URL", TestURL);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  videoStatusPayload = {
    jobId: "video_job_123",
    status: "completed",
    localVideoUrl: `${characterBase}/base-character/walk-video/source.mp4`
  };
  module01WorkflowConfigPayload = null;
  advancedCharacterAssetsPayload = undefined;
  pixelCharacters = [{ id: "pixel-hero", name: "pixel-hero" }];
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/api/module02/characters")) {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body ?? "{}"));
        const character = { id: body.name, name: body.name };
        pixelCharacters = [...pixelCharacters.filter((item) => item.id !== character.id), character];
        return jsonResponse(character, true, 201);
      }
      return jsonResponse({ characters: pixelCharacters });
    }
    if (url.endsWith("/api/module02/characters/pixel-hero") && init?.method === "DELETE") {
      pixelCharacters = [];
      return jsonResponse({ deleted: true, character: { id: "pixel-hero", name: "pixel-hero" } });
    }
    if (url.includes("/api/module02/characters/pixel-hero/assets")) {
      return jsonResponse({
        characterId: "pixel-hero",
        assets: {
          baseTemplate: {
            characterReference: {
              fileName: "character-reference.png",
              url: `${pixelCharacterBase}/base-template/character-reference.png`
            },
            output: {
              fileName: "output.png",
              url: `${pixelCharacterBase}/base-template/output.png`
            }
          },
          walkTemplate: {
            output: {
              fileName: "output.png",
              url: `${pixelCharacterBase}/walk-template/output.png`
            }
          },
          slices: {
            idle: {
              frames: [
                { row: 1, index: 1, width: 64, height: 128, url: `${pixelCharacterBase}/slices/idle/frames/row_001/frame_001.png` }
              ]
            },
            walk: {
              frames: [
                { row: 1, index: 1, width: 64, height: 128, url: `${pixelCharacterBase}/slices/walk/frames/row_001/frame_001.png` },
                { row: 1, index: 2, width: 64, height: 128, url: `${pixelCharacterBase}/slices/walk/frames/row_001/frame_002.png` }
              ]
            }
          }
        }
      });
    }
    if (url.includes("/api/module02/characters/") && url.includes("/assets/")) {
      const kind = String(url).split("/assets/")[1] ?? "character-reference";
      const directory = kind === "walk-template" ? "walk-template" : "base-template";
      const storedName = kind === "character-reference" ? "character-reference.png" : "output.png";
      return jsonResponse({
        fileName: "upload.png",
        storedName,
        localUrl: `${pixelCharacterBase}/${directory}/${storedName}`,
        publicUrl: `https://assets.example.com${pixelCharacterBase}/${directory}/${storedName}`
      });
    }
    if (url.endsWith("/api/module02/generation/sprite-sheet/actions")) {
      return jsonResponse({
        actions: [
          {
            id: "idle",
            name: "角色基准模板",
            referenceImage: "idle-2x2-centered.png",
            constraintPrompt: "生成角色基准模板",
            defaultFrameCount: 2,
            directionCount: 2
          },
          {
            id: "walk",
            name: "四方向步行图",
            referenceImage: "walk-4x10-no-shadow.png",
            constraintPrompt: "生成四方向步行图",
            defaultFrameCount: 10,
            directionCount: 4
          }
        ]
      });
    }
    if (url.endsWith("/api/module02/generation/sprite-sheet")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const folder = body.actionId === "walk" ? "walk-template" : "base-template";
      return jsonResponse({
        fileName: "output.png",
        storedName: "output.png",
        spriteSheetUrl: `${pixelCharacterBase}/${folder}/output.png`,
        localUrl: `${pixelCharacterBase}/${folder}/output.png`,
        publicUrl: `https://assets.example.com${pixelCharacterBase}/${folder}/output.png`,
        action: { id: body.actionId, name: body.actionId === "walk" ? "四方向步行图" : "角色基准模板" },
        finalPrompt: body.constraintPrompt
      });
    }
    if (url.endsWith("/api/module02/processing/sprite-sheet")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const sliceKind = body.sliceKind ?? "walk";
      return jsonResponse({
        jobId: `module02-character-pixel-hero-${sliceKind}`,
        rows: body.rows,
        columns: body.columns,
        frameCount: 2,
        frames: [
          { row: 1, index: 1, width: 64, height: 128, url: `${pixelCharacterBase}/slices/${sliceKind}/frames/row_001/frame_001.png` },
          { row: 1, index: 2, width: 64, height: 128, url: `${pixelCharacterBase}/slices/${sliceKind}/frames/row_001/frame_002.png` }
        ]
      });
    }
    if (url.endsWith("/api/module01/workflow-config")) {
      if (init?.method === "PUT") {
        module01WorkflowConfigPayload = JSON.parse(String(init.body ?? "{}"));
        return jsonResponse({ config: module01WorkflowConfigPayload });
      }
      return jsonResponse({ config: module01WorkflowConfigPayload });
    }
    if (url.endsWith("/api/module01/secrets/openrouter-key")) {
      if (init?.method === "PUT") {
        return jsonResponse({ configured: true, suffix: "test" });
      }
      return jsonResponse({ configured: false });
    }
    if (url.endsWith("/api/module01/one-click-character-jobs") && init?.method === "POST") {
      return jsonResponse({
        job: {
          jobId: "one_click_job_123",
          characterId: "new-hero",
          status: "running",
          currentStep: "base-template",
          progressPercent: 25,
          steps: [
            { id: "create-character", label: "创建角色文件夹", status: "completed" },
            { id: "base-template", label: "生成角色基准模板", status: "running" },
            { id: "walk-video", label: "生成四方向步行视频", status: "pending" },
            { id: "walk-loop-export", label: "处理步行四方向循环", status: "pending" },
            { id: "idle-loop-export", label: "处理待机四方向", status: "pending" }
          ]
        }
      }, true, 202);
    }
    if (url.includes("/api/module01/one-click-character-jobs/one_click_job_123")) {
      return jsonResponse({
        job: {
          jobId: "one_click_job_123",
          characterId: "new-hero",
          status: "completed",
          currentStep: "completed",
          progressPercent: 100,
          steps: [
            { id: "create-character", label: "创建角色文件夹", status: "completed" },
            { id: "base-template", label: "生成角色基准模板", status: "completed" },
            { id: "walk-video", label: "生成四方向步行视频", status: "completed" },
            { id: "walk-loop-export", label: "处理步行四方向循环", status: "completed" },
            { id: "idle-loop-export", label: "处理待机四方向", status: "completed" }
          ]
        }
      });
    }
    if (url.includes("/api/module01/reference-images/")) {
      const kind = String(url).split("/api/module01/reference-images/")[1] ?? "";
      const urls: Record<string, string> = {
        style: "/style-references/cel-anime-south-facing.png",
        walk: "/direction-references/walk-4dir.png",
        idle: "/direction-references/idle-4dir.png",
        run: "/direction-references/run-4dir.png"
      };
      const storedNames: Record<string, string> = {
        style: "cel-anime-south-facing.png",
        walk: "walk-4dir.png",
        idle: "idle-4dir.png",
        run: "run-4dir.png"
      };
      return jsonResponse({
        kind,
        fileName: "uploaded-reference.png",
        storedName: storedNames[kind],
        url: urls[kind]
      });
    }
    if (url.endsWith("/api/characters")) {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body ?? "{}"));
        return jsonResponse({ id: body.name, name: body.name }, true, 201);
      }
      return jsonResponse({ characters: [{ id: "hero", name: "hero" }] });
    }
    if (url.endsWith("/api/characters/hero") && init?.method === "DELETE") {
      return jsonResponse({ deleted: true, character: { id: "hero", name: "hero" } });
    }
    if (url.includes("/api/characters/hero/assets")) {
      return jsonResponse({
        characterId: "hero",
        assets: {
          baseTemplate: {
            characterReference: {
              fileName: "character-reference.png",
              url: `${characterBase}/base-template/character-reference.png`
            },
            output: {
              fileName: "output.png",
              url: `${characterBase}/base-template/output.png`
            }
          },
          baseCharacter: {
            directionBaseTemplate: {
              fileName: "base-template.png",
              url: `${characterBase}/base-character/direction-templates/base-template.png`
            },
            idleDirectionTemplate: {
              fileName: "idle-4dir.png",
              url: `${characterBase}/base-character/direction-templates/idle-4dir.png`
            },
            walkDirectionTemplate: {
              fileName: "walk-4dir.png",
              url: `${characterBase}/base-character/direction-templates/walk-4dir.png`
            },
            walkVideoInput: {
              fileName: "input-4dir.png",
              url: `${characterBase}/base-character/walk-video/input-4dir.png`
            },
            walkVideoSource: {
              fileName: "source.mp4",
              url: `${characterBase}/base-character/walk-video/source.mp4`
            },
            loopExport: {
              jobId: "existing-video",
              frameCount: 2,
              rawFrames: [
                { index: 1, url: `${characterBase}/base-character/loop-export/raw/frame_001.png` }
              ],
              directions: [
                makeDirectionResult("down", "下方向"),
                makeDirectionResult("up", "上方向"),
                makeDirectionResult("left", "左方向"),
                makeDirectionResult("right", "右方向")
              ],
              spriteSheetUrl: `${characterBase}/base-character/loop-export/exports/sprite-sheet.png`,
              transparentZipUrl: `${characterBase}/base-character/loop-export/exports/transparent-frames.zip`,
              gifPreviewUrl: `${characterBase}/base-character/loop-export/exports/preview.gif`,
              idle: {
                frames: [
                  makeIdleDirectionFrame("down", "下方向"),
                  makeIdleDirectionFrame("up", "上方向"),
                  makeIdleDirectionFrame("left", "左方向"),
                  makeIdleDirectionFrame("right", "右方向")
                ],
                spriteSheetUrl: `${characterBase}/base-character/loop-export/exports/idle-4dir-sprite-sheet.png`
              }
            }
          },
          advancedCharacter: advancedCharacterAssetsPayload
        }
      });
    }
    if (url.includes(`${characterBase}/base-template/character-reference.png`)) {
      return imageResponse("character-reference");
    }
    if (url.includes(`${characterBase}/base-template/output.png`)) {
      return imageResponse("processed-base-template");
    }
    if (url.includes(`${characterBase}/base-character/direction-templates/walk-4dir.png`)) {
      return imageResponse("processed-walk-template");
    }
    if (url.includes(`${characterBase}/advanced-character/attack-1/video/input-4dir.png`)) {
      return imageResponse("attack-start-frame");
    }
    if (url.includes("/api/assets/first-frame")) {
      const kind = init?.headers instanceof Headers
        ? init.headers.get("x-character-asset-kind")
        : (init?.headers as Record<string, string> | undefined)?.["x-character-asset-kind"];
      if (kind === "direction-base-template") {
        return jsonResponse({
          fileName: "base-template.png",
          localUrl: `${characterBase}/base-character/direction-templates/base-template.png`,
          publicUrl: `https://assets.example.com${characterBase}/base-character/direction-templates/base-template.png`
        });
      }
      if (kind === "walk-video-input") {
        return jsonResponse({
          fileName: "walk-input.png",
          localUrl: `${characterBase}/base-character/walk-video/input-4dir.png`,
          publicUrl: `https://assets.example.com${characterBase}/base-character/walk-video/input-4dir.png`
        });
      }
      if (kind === "advanced-attack-reference") {
        return jsonResponse({
          fileName: "attack-reference.png",
          localUrl: `${characterBase}/advanced-character/attack-1/reference/reference.png`,
          publicUrl: `https://assets.example.com${characterBase}/advanced-character/attack-1/reference/reference.png`
        });
      }
      return jsonResponse({
        fileName: "hero-raw.png",
        localUrl: `${characterBase}/base-template/character-reference.png`,
        publicUrl: `https://assets.example.com${characterBase}/base-template/character-reference.png`
      });
    }
    if (url.includes("/api/assets/frame-video")) {
      return jsonResponse({
        fileName: "local-source.mp4",
        jobId: "local-video-123",
        localVideoUrl: `${characterBase}/base-character/walk-video/source.mp4`
      });
    }
    if (url.includes("/api/generation/direction-template")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const isWalk = body.templateKind === "walk";
      return jsonResponse({
        fileName: isWalk ? "walk-4dir.png" : "idle-4dir.png",
        imageUrl: isWalk ? `${characterBase}/base-character/direction-templates/walk-4dir.png` : `${characterBase}/base-character/direction-templates/idle-4dir.png`,
        localUrl: isWalk ? `${characterBase}/base-character/direction-templates/walk-4dir.png` : `${characterBase}/base-character/direction-templates/idle-4dir.png`,
        publicUrl: isWalk
          ? `https://assets.example.com${characterBase}/base-character/direction-templates/walk-4dir.png`
          : `https://assets.example.com${characterBase}/base-character/direction-templates/idle-4dir.png`
      });
    }
    if (url.includes("/api/generation/first-frame")) {
      return jsonResponse({
        fileName: "output.png",
        imageUrl: `${characterBase}/base-template/output.png`,
        localUrl: `${characterBase}/base-template/output.png`,
        publicUrl: `https://assets.example.com${characterBase}/base-template/output.png`
      });
    }
    if (url.includes("/api/generation/advanced-action-midframe")) {
      return jsonResponse({
        fileName: "middle-4dir.png",
        imageUrl: `${characterBase}/advanced-character/attack-1/midframe/middle-4dir.png`,
        localUrl: `${characterBase}/advanced-character/attack-1/midframe/middle-4dir.png`,
        publicUrl: `https://assets.example.com${characterBase}/advanced-character/attack-1/midframe/middle-4dir.png`
      });
    }
    if (url.includes("/api/generation/video/video_job_123")) {
      return jsonResponse(videoStatusPayload);
    }
    if (url.includes("/api/generation/video") && init?.method === "POST") {
      return jsonResponse({
        id: "video_job_123",
        status: "queued"
      });
    }
    if (url.includes("/api/processing/advanced-action/start-frame")) {
      return jsonResponse({
        fileName: "input-4dir.png",
        localUrl: `${characterBase}/advanced-character/attack-1/video/input-4dir.png`,
        publicUrl: `https://assets.example.com${characterBase}/advanced-character/attack-1/video/input-4dir.png`
      });
    }
    if (url.includes("/api/processing/four-direction")) {
      return jsonResponse({
        jobId: "local-video-123",
        frameCount: 120,
        rawFrames: [
          { index: 1, url: `${characterBase}/base-character/loop-export/raw/frame_001.png` },
          { index: 2, url: `${characterBase}/base-character/loop-export/raw/frame_002.png` }
        ],
        directions: [
          makeDirectionResult("down", "下方向"),
          makeDirectionResult("up", "上方向"),
          makeDirectionResult("left", "左方向"),
          makeDirectionResult("right", "右方向")
        ],
        spriteSheetUrl: `${characterBase}/base-character/loop-export/exports/sprite-sheet.png`,
        transparentZipUrl: `${characterBase}/base-character/loop-export/exports/transparent-frames.zip`,
        gifPreviewUrl: `${characterBase}/base-character/loop-export/exports/preview.gif`
      });
    }
    if (url.includes("/api/processing/idle-four-direction")) {
      return jsonResponse({
        frames: [
          makeIdleDirectionFrame("down", "下方向"),
          makeIdleDirectionFrame("up", "上方向"),
          makeIdleDirectionFrame("left", "左方向"),
          makeIdleDirectionFrame("right", "右方向")
        ],
        spriteSheetUrl: `${characterBase}/base-character/loop-export/exports/idle-4dir-sprite-sheet.png`
      });
    }
    if (url.includes("/api/export/godot")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      return jsonResponse({
        characterId: body.characterId,
        exportSize: body.exportSize,
        exportedActions: ["idle", "walk", "attack1"],
        animationCount: 12,
        exportRootPath: `E:\\game_develop\\tool\\ai_game_workbench\\Export\\Character_2D\\hero\\size-${body.exportSize}`,
        exportRootUrl: `/exports/character-2d/hero/size-${body.exportSize}`,
        manifestUrl: `/exports/character-2d/hero/size-${body.exportSize}/animations.json`,
        importScriptUrl: `/exports/character-2d/hero/size-${body.exportSize}/import_to_godot.gd`,
        zipUrl: `/exports/character-2d/hero/size-${body.exportSize}/godot-export.zip`
      });
    }
    if (url.includes("/api/processing/frames")) {
      return jsonResponse({
        jobId: "video_job_123",
        frames: [
          { index: 1, url: `${characterBase}/frames/transparent/frame_001.png` },
          { index: 2, url: `${characterBase}/frames/transparent/frame_002.png` },
          { index: 3, url: `${characterBase}/frames/transparent/frame_003.png` }
        ]
      });
    }
    return jsonResponse({ error: "not found" }, false, 404);
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body
  };
}

function imageResponse(body: string) {
  return {
    ok: true,
    status: 200,
    blob: async () => new Blob([body], { type: "image/png" })
  };
}

function makeDirectionResult(key: string, label: string) {
  return {
    key,
    label,
    centeredFrames: [
      { index: 1, url: `${characterBase}/base-character/loop-export/centered/${key}/frame_001.png` },
      { index: 2, url: `${characterBase}/base-character/loop-export/centered/${key}/frame_002.png` }
    ],
    loopFrames: [
      { index: 2, url: `${characterBase}/base-character/loop-export/loop/${key}/frame_002.png` },
      { index: 3, url: `${characterBase}/base-character/loop-export/loop/${key}/frame_003.png` }
    ],
    transparentFrames: [
      { index: 2, url: `${characterBase}/base-character/loop-export/transparent/${key}/frame_002.png` },
      { index: 3, url: `${characterBase}/base-character/loop-export/transparent/${key}/frame_003.png` }
    ],
    loop: {
      startFrame: 2,
      endFrame: 3,
      frameCount: 2,
      score: 0.98
    }
  };
}

function makeIdleDirectionFrame(key: string, label: string) {
  return {
    key,
    label,
    index: 1,
    url: `${characterBase}/base-character/loop-export/idle/transparent/${key}.png`
  };
}

function makeAdvancedActionResult(action: string) {
  return {
    jobId: `${action}-job`,
    frameCount: 2,
    rawFrames: [],
    directions: [
      makeDirectionResult("down", "下方向"),
      makeDirectionResult("up", "上方向"),
      makeDirectionResult("left", "左方向"),
      makeDirectionResult("right", "右方向")
    ],
    spriteSheetUrl: `${characterBase}/advanced-character/${action}/export/exports/sprite-sheet.png`,
    transparentZipUrl: `${characterBase}/advanced-character/${action}/export/exports/transparent-frames.zip`,
    gifPreviewUrl: `${characterBase}/advanced-character/${action}/export/exports/preview.gif`
  };
}

function openSpriteAnimator() {
  localStorage.setItem("ai-game-workbench.sprite-animator.active-character", "hero");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /模块 01：高清2D角色制作/i }));
}

function openPixelSpriteGenerator() {
  localStorage.setItem("ai-game-workbench.pixel-sprite-generator.active-character", "pixel-hero");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /模块 02：像素角色制作/i }));
}

describe("App", () => {
  it("opens module 02 with its own pixel character sidebar and delete action", async () => {
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmMock);
    openPixelSpriteGenerator();

    expect(screen.getByRole("heading", { name: "像素角色制作" })).toBeInTheDocument();
    expect(await screen.findByLabelText("当前像素角色")).toHaveValue("pixel-hero");
    expect(screen.getByRole("button", { name: "角色基准模板" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "四方向步行图" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切帧" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "角色预览" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "删除像素角色 pixel-hero" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/module02/characters/pixel-hero",
      expect.objectContaining({ method: "DELETE" })
    ));
    expect(confirmMock).toHaveBeenCalledWith("确认删除像素角色「pixel-hero」？此操作会删除整个像素角色文件夹，不能撤销。");
    expect(screen.getByLabelText("当前像素角色")).toHaveValue("");
  });

  it("uses module 02 APIs for base generation, walk generation, and one-click slicing", async () => {
    openPixelSpriteGenerator();

    expect(await screen.findByAltText("角色参考图预览")).toHaveAttribute(
      "src",
      expect.stringContaining(`${pixelCharacterBase}/base-template/character-reference.png`)
    );

    fireEvent.click(screen.getByRole("button", { name: "生成角色基准模板" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) =>
      String(url).endsWith("/api/module02/generation/sprite-sheet")
      && String((init as RequestInit).body).includes('"actionId":"idle"')
    )).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "四方向步行图" }));
    fireEvent.click(screen.getByRole("button", { name: "生成四方向步行图" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) =>
      String(url).endsWith("/api/module02/generation/sprite-sheet")
      && String((init as RequestInit).body).includes('"actionId":"walk"')
    )).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "切帧" }));
    fireEvent.click(screen.getByRole("button", { name: "一键处理切帧" }));

    await waitFor(() => {
      const processingCalls = fetchMock.mock.calls
        .filter(([url]) => String(url).endsWith("/api/module02/processing/sprite-sheet"))
        .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
      expect(processingCalls).toEqual(expect.arrayContaining([
        expect.objectContaining({
          pixelCharacterId: "pixel-hero",
          sliceKind: "walk",
          sourceUrl: `${pixelCharacterBase}/walk-template/output.png`
        }),
        expect.objectContaining({
          pixelCharacterId: "pixel-hero",
          sliceKind: "idle",
          sourceUrl: `${pixelCharacterBase}/base-template/output.png`
        })
      ]));
    });
  });

  it("opens module 01 with two-level navigation and the base template page", () => {
    openSpriteAnimator();

    expect(screen.getByRole("heading", { name: "高清2D角色制作" })).toBeInTheDocument();
    expect(screen.getByLabelText("当前角色")).toHaveValue("hero");
    expect(screen.getByRole("button", { name: "角色基准模板生成" })).toBeInTheDocument();
    expect(screen.getByText("基础角色生成")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "步行四方向" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "待机四方向" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "四方向模板图生成" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "四方向步行视频" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "智能循环与导出" })).not.toBeInTheDocument();
    expect(screen.getByText("进阶角色生成")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "跑步四方向" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "攻击四方向1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "跳跃四方向" })).toBeInTheDocument();
    const oneClickButton = screen.getByRole("button", { name: "一键生成角色" });
    const characterPreviewButton = screen.getByRole("button", { name: "角色预览" });
    const godotExportButton = screen.getByRole("button", { name: "导出" });
    expect(oneClickButton.compareDocumentPosition(characterPreviewButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(characterPreviewButton.compareDocumentPosition(godotExportButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(characterPreviewButton).toBeInTheDocument();
    expect(godotExportButton).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "角色基准模板生成" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "四方向步行视频" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "智能循环与导出" })).not.toBeInTheDocument();
    expect(screen.queryByText("画风参考")).not.toBeInTheDocument();
    expect(screen.getByText("角色参考")).toBeInTheDocument();
    expect(screen.getByText("基准模板")).toBeInTheDocument();
    expect(screen.queryByLabelText(/视频模型/i)).not.toBeInTheDocument();
    expect(screen.getAllByText("设置").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "参考图设置" })).toBeInTheDocument();
    expect(screen.queryByAltText("赛璐璐画风参考图预览")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("上传画风参考图")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/图像模型/i)).toHaveValue("openai/gpt-5.4-image-2");
    expect(screen.getByRole("option", { name: "local GPT image2" })).toHaveValue("local/gpt-image-2");
    expect(screen.getByRole("option", { name: /Nano Banana 2/i })).toHaveValue("google/gemini-3.1-flash-image-preview");
    const imageStyleSelect = screen.getByLabelText("图片风格");
    expect(imageStyleSelect).toHaveValue("cel-anime");
    expect(within(imageStyleSelect).getAllByRole("option")).toHaveLength(1);
    expect(within(imageStyleSelect).getByRole("option", { name: "赛璐璐风格" })).toBeInTheDocument();
    expect((screen.getByLabelText(/系统提示词/i) as HTMLTextAreaElement).value).toContain("使用第一张图作为画风");
    expect((screen.getByLabelText(/系统提示词/i) as HTMLTextAreaElement).value).toContain("使用第二张图作为角色身份参考");
    expect(screen.getByLabelText(/自定义提示词/i)).toHaveValue("");
    expect(screen.getByLabelText(/最终图片提示词/i)).toHaveAttribute("readonly");
    expect(screen.queryByLabelText(/图片风格提示词/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/图片约束提示词/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("朝向")).not.toBeInTheDocument();
    expect(screen.getByText("https://darn-skittle-unwoven.ngrok-free.dev")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /公网资源地址/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /保存当前配置/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /保存基准模板配置/i })).toBeInTheDocument();
  });

  it("shows the one-click character page with locked required actions and a progress bar", () => {
    openSpriteAnimator();

    fireEvent.click(screen.getByRole("button", { name: "一键生成角色" }));

    expect(screen.getByRole("heading", { name: "一键生成角色" })).toBeInTheDocument();
    expect(screen.getByLabelText("一键生成角色名称")).toBeInTheDocument();
    expect(screen.getByLabelText("一键生成角色参考图")).toBeInTheDocument();
    expect(screen.getByLabelText("一键生成图片风格")).toHaveValue("cel-anime");
    expect(screen.getByLabelText("一键生成步行")).toBeChecked();
    expect(screen.getByLabelText("一键生成步行")).toBeDisabled();
    expect(screen.getByLabelText("一键生成待机")).toBeChecked();
    expect(screen.getByLabelText("一键生成待机")).toBeDisabled();
    expect(screen.getByLabelText("一键生成跑步")).not.toBeChecked();
    expect(screen.getByLabelText("一键生成攻击四方向1")).not.toBeChecked();
    expect(screen.getByLabelText("一键生成跳跃")).not.toBeChecked();
    expect(screen.getByRole("progressbar", { name: "一键生成进度" })).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("deletes the selected character folder from the sidebar", async () => {
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmMock);
    openSpriteAnimator();

    fireEvent.click(await screen.findByRole("button", { name: "删除角色 hero" }));

    expect(screen.queryByLabelText("角色列表")).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/characters/hero",
      expect.objectContaining({ method: "DELETE" })
    ));
    expect(confirmMock).toHaveBeenCalledWith("确认删除角色「hero」？此操作会删除整个角色文件夹，不能撤销。");
    expect(screen.getByLabelText("当前角色")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "删除角色 hero" })).not.toBeInTheDocument();
    expect(screen.getAllByText("请先创建或选择角色文件夹。").length).toBeGreaterThan(0);
  });

  it("auto-loads existing files for the selected character", async () => {
    openSpriteAnimator();

    expect(await screen.findByAltText("角色参考图预览")).toHaveAttribute(
      "src",
      expect.stringContaining(`${characterBase}/base-template/character-reference.png`)
    );
    expect(screen.getByAltText("基准模板输出预览")).toHaveAttribute(
      "src",
      expect.stringContaining(`${characterBase}/base-template/output.png`)
    );

    fireEvent.click(screen.getByRole("button", { name: "步行四方向" }));
    expect(screen.getByAltText("角色基准模板预览")).toHaveAttribute(
      "src",
      expect.stringContaining(`${characterBase}/base-character/direction-templates/base-template.png`)
    );
    expect(screen.getByAltText("步行 2x2 输出预览")).toHaveAttribute(
      "src",
      expect.stringContaining(`${characterBase}/base-character/direction-templates/walk-4dir.png`)
    );
    expect(screen.getByLabelText("帧处理视频输入预览")).toHaveAttribute(
      "src",
      expect.stringContaining(`${characterBase}/base-character/walk-video/source.mp4`)
    );
    expect(screen.getByAltText("下方向最终循环预览")).toHaveAttribute(
      "src",
      expect.stringContaining(`${characterBase}/base-character/loop-export/transparent/down/frame_002.png`)
    );

    fireEvent.click(screen.getByRole("button", { name: "待机四方向" }));
    expect(screen.getByAltText("待机 2x2 输出预览")).toHaveAttribute(
      "src",
      expect.stringContaining(`${characterBase}/base-character/direction-templates/idle-4dir.png`)
    );
    expect(screen.getByAltText("待机四方向预览")).toHaveAttribute(
      "src",
      expect.stringContaining(`${characterBase}/base-character/loop-export/exports/idle-4dir-sprite-sheet.png`)
    );
  });

  it("opens character preview with shared map settings below the stage", () => {
    openSpriteAnimator();

    fireEvent.click(screen.getByRole("button", { name: "角色预览" }));

    expect(screen.getByRole("heading", { name: "角色预览" })).toBeInTheDocument();
    expect(screen.getByLabelText("角色预览行走 FPS")).toHaveValue(30);
    expect(screen.getByLabelText("角色预览显示尺寸")).toHaveValue(160);
    const backgroundSelect = screen.getByLabelText("角色预览舞台背景");
    expect(backgroundSelect).toHaveValue("map-1");
    expect(within(backgroundSelect).getByRole("option", { name: "游戏地图1" })).toBeInTheDocument();
    expect(within(backgroundSelect).getByRole("option", { name: "游戏地图2" })).toBeInTheDocument();
    expect(within(backgroundSelect).getByRole("option", { name: "深色网格" })).toBeInTheDocument();
    expect(within(backgroundSelect).queryByRole("option", { name: "透明棋盘" })).not.toBeInTheDocument();
    expect(within(backgroundSelect).queryByRole("option", { name: "测试地面" })).not.toBeInTheDocument();

    fireEvent.change(backgroundSelect, {
      target: { value: "map-2" }
    });
    fireEvent.change(screen.getByLabelText("角色预览显示尺寸"), {
      target: { value: "180" }
    });

    cleanup();
    openSpriteAnimator();
    fireEvent.click(screen.getByRole("button", { name: "角色预览" }));

    expect(screen.getByLabelText("角色预览舞台背景")).toHaveValue("map-2");
    expect(screen.getByLabelText("角色预览显示尺寸")).toHaveValue(180);
  });

  it("exports the selected character for Godot from the dedicated export page", async () => {
    openSpriteAnimator();

    fireEvent.click(screen.getByRole("button", { name: "导出" }));

    expect(screen.getByRole("heading", { name: "导出" })).toBeInTheDocument();
    const sizeSelect = screen.getByLabelText("Godot 导出尺寸");
    expect(sizeSelect).toHaveValue("512");
    expect(within(sizeSelect).getByRole("option", { name: "256" })).toBeInTheDocument();
    expect(within(sizeSelect).getByRole("option", { name: "384" })).toBeInTheDocument();
    expect(within(sizeSelect).getByRole("option", { name: "512" })).toBeInTheDocument();
    expect(within(sizeSelect).getByRole("option", { name: "1024" })).toBeInTheDocument();

    fireEvent.change(sizeSelect, {
      target: { value: "384" }
    });
    fireEvent.click(screen.getByRole("button", { name: "生成 Godot 导出包" }));

    await screen.findByText(/Godot 导出完成/);
    const exportCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url).includes("/api/export/godot") && init?.method === "POST"
    );
    expect(JSON.parse(String(exportCall?.[1]?.body))).toEqual({
      characterId: "hero",
      exportSize: 384
    });
    expect(screen.getByRole("link", { name: "下载 Godot 导出 ZIP" })).toHaveAttribute(
      "href",
      expect.stringContaining(`/exports/character-2d/hero/size-384/godot-export.zip`)
    );
    expect(screen.getByRole("link", { name: "下载 animations.json" })).toHaveAttribute(
      "href",
      expect.stringContaining(`/exports/character-2d/hero/size-384/animations.json`)
    );
    expect(screen.getByRole("link", { name: "下载 import_to_godot.gd" })).toHaveAttribute(
      "href",
      expect.stringContaining(`/exports/character-2d/hero/size-384/import_to_godot.gd`)
    );
    expect(screen.getByText(/Export\\Character_2D\\hero\\size-384/)).toBeInTheDocument();
  });

  it("loads and saves per-action character preview FPS in backend workflow config", async () => {
    module01WorkflowConfigPayload = {
      imageSystemPrompt: "保留已有全局配置",
      characterPreviewSettings: {
        idleFps: 8,
        walkFps: 24,
        runFps: 120,
        attackFps: 18,
        jumpFps: 90,
        previewSize: 180,
        moveSpeed: 140,
        backgroundMode: "map-2",
        showGuides: false,
        showCellBounds: true
      }
    };
    openSpriteAnimator();

    fireEvent.click(screen.getByRole("button", { name: "角色预览" }));

    await waitFor(() => {
      expect(screen.getByLabelText("角色预览待机 FPS")).toHaveValue(8);
    });
    expect(screen.getByLabelText("角色预览行走 FPS")).toHaveValue(24);
    expect(screen.getByLabelText("角色预览跑步 FPS")).toHaveValue(120);
    expect(screen.getByLabelText("角色预览攻击四方向1 FPS")).toHaveValue(18);
    expect(screen.getByLabelText("角色预览跳跃四方向 FPS")).toHaveValue(90);

    fireEvent.change(screen.getByLabelText("角色预览跑步 FPS"), {
      target: { value: "240" }
    });
    fireEvent.change(screen.getByLabelText("角色预览跳跃四方向 FPS"), {
      target: { value: "300" }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存预览配置" }));

    await waitFor(() => {
      expect(module01WorkflowConfigPayload).toMatchObject({
        imageSystemPrompt: "保留已有全局配置",
        characterPreviewSettings: {
          idleFps: 8,
          walkFps: 24,
          runFps: 240,
          attackFps: 18,
          jumpFps: 300,
          previewSize: 180,
          moveSpeed: 140,
          backgroundMode: "map-2",
          showGuides: false,
          showCellBounds: true
        }
      });
    });
    expect(screen.getByText("预览配置已保存到后端全局配置。")).toBeInTheDocument();
  });

  it("uses configured jump FPS for one-shot playback timing", async () => {
    advancedCharacterAssetsPayload = {
      jump: {
        export: makeAdvancedActionResult("jump")
      }
    };
    localStorage.setItem("ai-game-workbench.sprite-animator.character-preview.v1", JSON.stringify({
      idleFps: 12,
      walkFps: 30,
      runFps: 30,
      attackFps: 30,
      jumpFps: 300,
      previewSize: 160,
      moveSpeed: 120,
      backgroundMode: "map-1",
      showGuides: true,
      showCellBounds: false
    }));
    openSpriteAnimator();

    fireEvent.click(screen.getByRole("button", { name: "角色预览" }));
    await waitFor(() => {
      expect(screen.getAllByText("4 / 4 方向，8 帧").length).toBeGreaterThanOrEqual(2);
    });

    vi.useFakeTimers();
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    expect(screen.getByText("帧：1 / 2")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4);
    });

    expect(screen.getByText("帧：2 / 2")).toBeInTheDocument();
  });

  it("locks jump direction while queuing movement input until the jump ends", async () => {
    advancedCharacterAssetsPayload = {
      jump: {
        export: makeAdvancedActionResult("jump")
      }
    };
    localStorage.setItem("ai-game-workbench.sprite-animator.character-preview.v1", JSON.stringify({
      idleFps: 12,
      walkFps: 30,
      runFps: 30,
      attackFps: 30,
      jumpFps: 300,
      previewSize: 160,
      moveSpeed: 120,
      backgroundMode: "map-1",
      showGuides: true,
      showCellBounds: false
    }));
    openSpriteAnimator();

    fireEvent.click(screen.getByRole("button", { name: "角色预览" }));
    await waitFor(() => {
      expect(screen.getAllByText("4 / 4 方向，8 帧").length).toBeGreaterThanOrEqual(2);
    });

    vi.useFakeTimers();
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    fireEvent.keyDown(window, { key: "a", code: "KeyA" });

    expect(screen.getAllByText("跳跃").length).toBeGreaterThan(0);
    expect(screen.getByText("方向：下")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(8);
    });

    expect(screen.getAllByText("行走").length).toBeGreaterThan(0);
    expect(screen.getByText("方向：左")).toBeInTheDocument();
  });

  it("opens advanced character generation pages", () => {
    openSpriteAnimator();

    fireEvent.click(screen.getByRole("button", { name: "跑步四方向" }));
    expect(screen.getByRole("heading", { name: "跑步四方向" })).toBeInTheDocument();
    expect(screen.getByText("步行 2x2 基准")).toBeInTheDocument();
    expect(screen.queryByText("跑步参考")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /生成跑步四方向首帧/i })).toBeInTheDocument();
    expect(screen.getByLabelText("跑步首帧系统提示词")).toBeInTheDocument();
    expect(screen.getByLabelText("跑步视频系统提示词")).toBeInTheDocument();
    expect(screen.getByLabelText("跑步视频最终提示词")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "攻击四方向1" }));
    expect(screen.getByRole("heading", { name: "攻击四方向1" })).toBeInTheDocument();
    expect(screen.queryByText("待机四方向基准")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /准备攻击起始帧/i })).toBeInTheDocument();
    expect(screen.queryByLabelText("上传攻击四方向1参考图")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /生成攻击中间帧/i })).toBeInTheDocument();
    expect(screen.getByLabelText("攻击中间帧自定义提示词")).toBeInTheDocument();
    expect(screen.getByLabelText("攻击四方向1准备缩放比例")).toHaveValue(0.74);

    fireEvent.click(screen.getByRole("button", { name: "跳跃四方向" }));
    expect(screen.getByRole("heading", { name: "跳跃四方向" })).toBeInTheDocument();
    expect(screen.queryByText("待机四方向基准")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /准备跳跃起始帧/i })).toBeInTheDocument();
    expect(screen.getByLabelText("跳跃四方向准备缩放比例")).toHaveValue(0.78);
  });

  it("passes the generated attack middle frame when submitting attack video generation", async () => {
    openSpriteAnimator();

    fireEvent.click(screen.getByRole("button", { name: "攻击四方向1" }));
    fireEvent.change(screen.getByLabelText(/OpenRouter 密钥/i), {
      target: { value: "sk-or-v1-web-key" }
    });

    fireEvent.change(screen.getByLabelText("攻击四方向1准备缩放比例"), {
      target: { value: "0.62" }
    });
    fireEvent.click(screen.getByRole("button", { name: /准备攻击起始帧/i }));
    await screen.findByAltText("攻击四方向1起始帧预览");

    await waitFor(() => {
      const prepareCall = fetchMock.mock.calls.find(([url, init]) =>
        String(url).includes("/api/processing/advanced-action/start-frame") && (init as RequestInit | undefined)?.method === "POST"
      );
      expect(prepareCall).toBeTruthy();
      expect(JSON.parse(String(prepareCall?.[1]?.body))).toMatchObject({
        actionKind: "attack-1",
        scale: 0.62
      });
    });

    fireEvent.change(screen.getByLabelText("攻击中间帧自定义提示词"), {
      target: { value: "四方向角色都进入攻击动作中段，武器挥出但不出格。" }
    });
    fireEvent.click(screen.getByRole("button", { name: /生成攻击中间帧/i }));
    await screen.findByAltText("攻击四方向1中间帧预览");

    await waitFor(() => {
      const midframeCall = fetchMock.mock.calls.find(([url, init]) =>
        String(url).includes("/api/generation/advanced-action-midframe") && (init as RequestInit | undefined)?.method === "POST"
      );
      expect(midframeCall).toBeTruthy();
      expect(JSON.parse(String(midframeCall?.[1]?.body))).toMatchObject({
        actionKind: "attack-1",
        prompt: "四方向角色都进入攻击动作中段，武器挥出但不出格。",
        startFrameImageDataUrl: expect.stringMatching(/^data:image\/png;base64,/)
      });
    });

    fireEvent.click(screen.getByRole("button", { name: /提交视频任务/i }));

    await waitFor(() => {
      const videoCall = fetchMock.mock.calls.find(([url, init]) =>
        String(url).includes("/api/generation/video") && (init as RequestInit | undefined)?.method === "POST"
      );
      expect(videoCall).toBeTruthy();
      expect(JSON.parse(String(videoCall?.[1]?.body))).toMatchObject({
        firstFrameUrl: `https://assets.example.com${characterBase}/advanced-character/attack-1/video/input-4dir.png`,
        referenceOnly: true,
        inputReferenceUrls: [
          `https://assets.example.com${characterBase}/advanced-character/attack-1/video/input-4dir.png`,
          `https://assets.example.com${characterBase}/advanced-character/attack-1/midframe/middle-4dir.png`
        ]
      });
    });
  });

  it("opens global reference image settings and uploads overrides outside character folders", async () => {
    openSpriteAnimator();

    expect(screen.getByText("设置")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "参考图设置" }));

    expect(screen.getByRole("heading", { name: "参考图设置" })).toBeInTheDocument();
    expect(screen.getByAltText("赛璐璐画风参考图预览")).toHaveAttribute(
      "src",
      "http://127.0.0.1:8787/style-references/cel-anime-south-facing.png"
    );
    expect(screen.getByAltText("四方向步行参考图预览")).toHaveAttribute(
      "src",
      "http://127.0.0.1:8787/direction-references/walk-4dir.png"
    );
    expect(screen.getByAltText("四方向待机参考图预览")).toHaveAttribute(
      "src",
      "http://127.0.0.1:8787/direction-references/idle-4dir.png"
    );
    expect(screen.getByAltText("四方向跑步参考图预览")).toHaveAttribute(
      "src",
      "http://127.0.0.1:8787/direction-references/run-4dir.png"
    );
    expect(screen.queryByRole("button", { name: /恢复默认/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("上传并覆盖赛璐璐画风参考图"), {
      target: { files: [new File(["style"], "style.png", { type: "image/png" })] }
    });

    await screen.findByText(/赛璐璐画风参考图已全局覆盖/);
    expect(screen.getByAltText("赛璐璐画风参考图预览")).toHaveAttribute(
      "src",
      expect.stringMatching(/http:\/\/127\.0\.0\.1:8787\/style-references\/cel-anime-south-facing\.png\?v=/)
    );
    const uploadCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/module01/reference-images/style"));
    expect(uploadCall?.[1]).toMatchObject({
      method: "POST"
    });
    expect(uploadCall?.[1]?.headers).toBeUndefined();
  });

  it("opens each base character generation subpage from the left navigation", () => {
    openSpriteAnimator();

    fireEvent.click(screen.getByRole("button", { name: "步行四方向" }));
    expect(screen.getByRole("heading", { name: "步行四方向" })).toBeInTheDocument();
    expect(screen.getByText("角色基准模板")).toBeInTheDocument();
    expect(screen.queryByText("步行参考")).not.toBeInTheDocument();
    expect(screen.getByText("步行 2x2 输出")).toBeInTheDocument();
    expect(screen.getByText("步行视频预览")).toBeInTheDocument();
    expect(screen.queryByText("步行循环预览")).not.toBeInTheDocument();
    expect(screen.queryByAltText("四方向步行参考图预览")).not.toBeInTheDocument();
    expect(screen.queryByAltText("四方向待机参考图预览")).not.toBeInTheDocument();
    expect(screen.queryByAltText("四方向跑步参考图预览")).not.toBeInTheDocument();
    expect(screen.getByLabelText("上传角色基准模板")).toBeInTheDocument();
    expect(screen.getByLabelText(/四方向图像模型/i)).toHaveValue("openai/gpt-5.4-image-2");
    expect(screen.getByLabelText(/四方向图片生成尺寸/i)).toHaveValue("1024");
    expect((screen.getByLabelText("步行系统提示词") as HTMLTextAreaElement).value).toContain("动作状态：步行循环关键帧");
    expect(screen.getByRole("button", { name: /生成步行四方向图/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /一键处理步行循环/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /保存步行四方向配置/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/视频模型/i)).toHaveValue("bytedance/seedance-2.0");
    expect(screen.getByRole("option", { name: /Grok Imagine Video/i })).toHaveValue("x-ai/grok-imagine-video");
    expect(screen.getByLabelText(/视频时长/i)).toHaveValue("4");
    expect(screen.getByLabelText(/视频分辨率/i)).toHaveValue("720p");
    expect(within(screen.getByLabelText(/视频分辨率/i)).getByRole("option", { name: "1080p" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/视频视角/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/动作模板/i)).not.toBeInTheDocument();
    expect((screen.getByLabelText("视频系统提示词") as HTMLTextAreaElement).value).toContain("参考输入图像中的 2x2 四宫格角色");
    expect((screen.getByLabelText("视频系统提示词") as HTMLTextAreaElement).value).toContain("每个格子里的角色都独立做原地走路循环动画");
    expect(screen.getByLabelText("视频自定义提示词")).toHaveValue("");
    expect(screen.getByLabelText("最终视频提示词")).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: /保存视频配置/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "2 切四方向并中心化" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("帧时间轴")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "待机四方向" }));
    expect(screen.getByRole("heading", { name: "待机四方向" })).toBeInTheDocument();
    expect(screen.getByText("步行 2x2 基准")).toBeInTheDocument();
    expect(screen.queryByText("待机参考")).not.toBeInTheDocument();
    expect(screen.getByText("待机 2x2 输出")).toBeInTheDocument();
    expect((screen.getByLabelText("待机系统提示词") as HTMLTextAreaElement).value).toContain("使用第一张图作为角色四方向步行参考图");
    expect((screen.getByLabelText("待机系统提示词") as HTMLTextAreaElement).value).toContain("位置与第一张图对应方向对齐");
    expect(screen.getByRole("button", { name: /基于步行图生成待机四方向图/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /一键处理待机四方向/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /保存待机四方向配置/i })).toBeInTheDocument();
    expect(screen.getAllByText("待机四方向预览").length).toBeGreaterThanOrEqual(1);
  });

  it("migrates the old Seedream image default to GPT Image 2 while keeping saved keys", () => {
    localStorage.setItem("ai-game-workbench.sprite-animator.workflow.v2", JSON.stringify({
      openRouterApiKey: "sk-or-v1-saved-key",
      imageModel: "bytedance-seed/seedream-4.5"
    }));

    openSpriteAnimator();

    expect(screen.getByLabelText(/OpenRouter 密钥/i)).toHaveValue("sk-or-v1-saved-key");
    expect(screen.getByLabelText(/图像模型/i)).toHaveValue("openai/gpt-5.4-image-2");
  });

  it("shows model-specific first-frame size choices and submits the selected size", async () => {
    openSpriteAnimator();

    const sizeSelect = screen.getByLabelText(/图片生成尺寸/i);
    expect(sizeSelect).toHaveValue("1024");
    expect(within(sizeSelect).getByRole("option", { name: /1024 x 1024/ })).toBeInTheDocument();
    expect(within(sizeSelect).getByRole("option", { name: /2048 x 2048/ })).toBeInTheDocument();
    expect(within(sizeSelect).getByRole("option", { name: /2880 x 2880/ })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/图像模型/i), {
      target: { value: "google/gemini-3.1-flash-image-preview" }
    });

    const nanoSizeSelect = screen.getByLabelText(/图片生成尺寸/i);
    expect(nanoSizeSelect).toHaveValue("1024");
    expect(within(nanoSizeSelect).getByRole("option", { name: /512 x 512/ })).toBeInTheDocument();
    expect(within(nanoSizeSelect).getByRole("option", { name: /4096 x 4096/ })).toBeInTheDocument();

    fireEvent.change(nanoSizeSelect, {
      target: { value: "4096" }
    });
    fireEvent.click(screen.getByRole("button", { name: /生成基准模板/i }));

    await screen.findByAltText("基准模板输出预览");
    const firstFrameCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url).includes("/api/generation/first-frame") && (init as RequestInit | undefined)?.method === "POST"
    );
    expect(JSON.parse(String(firstFrameCall?.[1]?.body))).toMatchObject({
      model: "google/gemini-3.1-flash-image-preview",
      targetSize: 4096
    });
    expect(JSON.parse(String(firstFrameCall?.[1]?.body))).not.toHaveProperty("direction");
  });

  it("combines editable first-frame system and custom prompts", async () => {
    openSpriteAnimator();

    fireEvent.change(screen.getByLabelText(/系统提示词/i), {
      target: { value: "系统固定规则：赛璐璐风格，第一张图控制镜头，第二张图控制角色。纯色 #00ff00 背景。" }
    });
    fireEvent.change(screen.getByLabelText(/自定义提示词/i), {
      target: { value: "怯生生走路第一帧，左脚向画面下方小幅迈出。" }
    });

    const finalPrompt = screen.getByLabelText(/最终图片提示词/i);
    expect((finalPrompt as HTMLTextAreaElement).value).toBe(
      "系统固定规则：赛璐璐风格，第一张图控制镜头，第二张图控制角色。纯色 #00ff00 背景。\n\n" +
      "怯生生走路第一帧，左脚向画面下方小幅迈出。"
    );

    fireEvent.click(screen.getByRole("button", { name: /保存基准模板配置/i }));
    const savedDraft = JSON.parse(String(localStorage.getItem("ai-game-workbench.sprite-animator.workflow.v5")));
    expect(savedDraft).toMatchObject({
      imageStyle: "cel-anime",
      imageSystemPrompt: "系统固定规则：赛璐璐风格，第一张图控制镜头，第二张图控制角色。纯色 #00ff00 背景。",
      imageCustomPrompt: "怯生生走路第一帧，左脚向画面下方小幅迈出。"
    });
  });

  it("submits the current first-frame custom prompt when generating", async () => {
    openSpriteAnimator();

    fireEvent.change(screen.getByLabelText(/图像模型/i), {
      target: { value: "local/gpt-image-2" }
    });
    fireEvent.change(screen.getByLabelText(/系统提示词/i), {
      target: { value: "系统提示词：只参考第一张图的镜头。" }
    });
    fireEvent.change(screen.getByLabelText(/自定义提示词/i), {
      target: { value: "自定义提示词：角色低头怯生生，左脚向画面下方迈出。" }
    });
    fireEvent.click(screen.getByRole("button", { name: /生成基准模板/i }));

    await screen.findByAltText("基准模板输出预览");
    const firstFrameCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url).includes("/api/generation/first-frame") && (init as RequestInit | undefined)?.method === "POST"
    );
    expect(JSON.parse(String(firstFrameCall?.[1]?.body))).toMatchObject({
      model: "local/gpt-image-2",
      prompt: "系统提示词：只参考第一张图的镜头。\n\n自定义提示词：角色低头怯生生，左脚向画面下方迈出。"
    });
    expect(screen.getByAltText("基准模板输出预览")).toHaveAttribute(
      "src",
      expect.stringMatching(/\/characters\/hero\/base-template\/output\.png\?v=/)
    );
  });

  it("submits the auto-loaded character reference image when generating a base template", async () => {
    openSpriteAnimator();

    await screen.findByAltText("角色参考图预览");
    fireEvent.change(screen.getByLabelText(/图像模型/i), {
      target: { value: "local/gpt-image-2" }
    });
    fireEvent.click(screen.getByRole("button", { name: /生成基准模板/i }));

    let firstFrameCall: Parameters<typeof fetchMock>[0] | undefined;
    await waitFor(() => {
      firstFrameCall = fetchMock.mock.calls.find(([url, init]) =>
        String(url).includes("/api/generation/first-frame") && (init as RequestInit | undefined)?.method === "POST"
      );
      expect(firstFrameCall).toBeDefined();
    });
    expect(JSON.parse(String(firstFrameCall?.[1]?.body))).toMatchObject({
      model: "local/gpt-image-2",
      referenceImageDataUrl: "data:image/png;base64,Y2hhcmFjdGVyLXJlZmVyZW5jZQ=="
    });
  });

  it("generates the walk sheet first, then uses that walk sheet as the idle source image", async () => {
    openSpriteAnimator();
    fireEvent.click(screen.getByRole("button", { name: "步行四方向" }));

    fireEvent.change(screen.getByLabelText(/OpenRouter 密钥/i), {
      target: { value: "sk-or-v1-web-key" }
    });
    const baseTemplateFile = new File(["base-template"], "base-template.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("上传角色基准模板"), {
      target: { files: [baseTemplateFile] }
    });

    expect(screen.getByAltText("角色基准模板预览")).toHaveAttribute("src", "blob:uploaded-input-preview");

    fireEvent.change(screen.getByLabelText("步行自定义提示词"), {
      target: { value: "步行幅度轻微，保持角色害羞气质。" }
    });
    expect((screen.getByLabelText("步行最终提示词") as HTMLTextAreaElement).value).toContain("步行幅度轻微");

    fireEvent.click(screen.getByRole("button", { name: /生成步行四方向图/i }));
    await screen.findByAltText("步行 2x2 输出预览");
    expect(screen.getByAltText("步行 2x2 输出预览")).toHaveAttribute(
      "src",
      expect.stringMatching(new RegExp(`http://127\\.0\\.0\\.1:8787${characterBase}/base-character/direction-templates/walk-4dir\\.png\\?v=`))
    );

    fireEvent.click(screen.getByRole("button", { name: "待机四方向" }));
    fireEvent.change(screen.getByLabelText("待机自定义提示词"), {
      target: { value: "待机更安静，手臂自然下垂。" }
    });
    expect((screen.getByLabelText("待机最终提示词") as HTMLTextAreaElement).value).toContain("待机更安静");
    await waitFor(() => expect(screen.getByRole("button", { name: /基于步行图生成待机四方向图/i })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: /基于步行图生成待机四方向图/i }));
    await screen.findByAltText("待机 2x2 输出预览");
    expect(screen.getByAltText("待机 2x2 输出预览")).toHaveAttribute(
      "src",
      expect.stringMatching(new RegExp(`http://127\\.0\\.0\\.1:8787${characterBase}/base-character/direction-templates/idle-4dir\\.png\\?v=`))
    );

    const directionCalls = fetchMock.mock.calls.filter(([url, init]) =>
      String(url).includes("/api/generation/direction-template") && (init as RequestInit | undefined)?.method === "POST"
    );
    expect(directionCalls).toHaveLength(2);
    expect(JSON.parse(String(directionCalls[0]?.[1]?.body))).toMatchObject({
      templateKind: "walk",
      model: "openai/gpt-5.4-image-2",
      targetSize: 1024,
      characterTemplateImageDataUrl: expect.stringMatching(/^data:image\/png;base64,/),
      prompt: expect.stringContaining("步行幅度轻微")
    });
    expect(JSON.parse(String(directionCalls[1]?.[1]?.body))).toMatchObject({
      templateKind: "idle",
      model: "openai/gpt-5.4-image-2",
      targetSize: 1024,
      characterTemplateImageDataUrl: "data:image/png;base64,cHJvY2Vzc2VkLXdhbGstdGVtcGxhdGU=",
      prompt: expect.stringContaining("待机更安静")
    });

    fireEvent.click(screen.getByRole("button", { name: /保存待机四方向配置/i }));
    const savedDraft = JSON.parse(String(localStorage.getItem("ai-game-workbench.sprite-animator.workflow.v5")));
    expect(savedDraft).toMatchObject({
      directionImageModel: "openai/gpt-5.4-image-2",
      directionImageGenerationSize: 1024,
      directionIdleCustomPrompt: "待机更安静，手臂自然下垂。",
      directionWalkCustomPrompt: "步行幅度轻微，保持角色害羞气质。"
    });
  });

  it("runs first-frame processing, video polling, and frame processing through the visible workflow", async () => {
    openSpriteAnimator();

    fireEvent.change(screen.getByLabelText(/OpenRouter 密钥/i), {
      target: { value: "sk-or-v1-web-key" }
    });

    const characterFile = new File(["character-reference"], "character-reference.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("上传角色参考图"), {
      target: { files: [characterFile] }
    });

    expect(screen.getByAltText("角色参考图预览")).toHaveAttribute("src", "blob:uploaded-input-preview");

    fireEvent.click(screen.getByRole("button", { name: /生成基准模板/i }));

    await screen.findByAltText("基准模板输出预览");
    fireEvent.click(screen.getByRole("button", { name: "步行四方向" }));
    fireEvent.click(screen.getByRole("button", { name: /生成步行四方向图/i }));
    await screen.findByAltText("步行 2x2 输出预览");
    fireEvent.click(screen.getByRole("button", { name: "步行四方向" }));
    expect(screen.getByAltText("步行 2x2 输出预览")).toHaveAttribute(
      "src",
      expect.stringMatching(new RegExp(`http://127\\.0\\.0\\.1:8787${characterBase}/base-character/direction-templates/walk-4dir\\.png\\?v=`))
    );
    const firstFrameCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url).includes("/api/generation/first-frame") && (init as RequestInit | undefined)?.method === "POST"
    );
    const firstFrameBody = JSON.parse(String(firstFrameCall?.[1]?.body));
    expect(firstFrameBody).not.toHaveProperty("styleReferenceImageDataUrl");
    expect(firstFrameBody.referenceImageDataUrl).toMatch(/^data:image\/png;base64,/);

    fireEvent.change(screen.getByLabelText(/视频模型/i), {
      target: { value: "kwaivgi/kling-v3.0-std" }
    });
    expect(screen.getByLabelText(/视频时长/i)).toHaveValue("3");
    expect(screen.getByLabelText(/视频分辨率/i)).toHaveValue("720p");
    expect(within(screen.getByLabelText(/视频分辨率/i)).queryByRole("option", { name: "1080p" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /提交视频任务/i }));

    await screen.findByText(/视频已下载到 storage\/characters\/hero\/base-character\/walk-video\/source.mp4/);
    expect(screen.getByLabelText("帧处理视频输入预览")).toHaveAttribute(
      "src",
      `http://127.0.0.1:8787${characterBase}/base-character/walk-video/source.mp4`
    );
    expect(screen.getByLabelText("帧处理视频输入预览")).toHaveAttribute(
      "src",
      `http://127.0.0.1:8787${characterBase}/base-character/walk-video/source.mp4`
    );

    fireEvent.click(screen.getByRole("button", { name: /一键处理步行循环/i }));
    await screen.findByText(/步行四方向处理完成/);
    expect(screen.getByText("四方向最终循环预览")).toBeInTheDocument();
    expect(screen.queryByLabelText("帧时间轴")).not.toBeInTheDocument();

    const videoCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url).includes("/api/generation/video") && (init as RequestInit | undefined)?.method === "POST"
    );
    expect(JSON.parse(String(videoCall?.[1]?.body))).toMatchObject({
      model: "kwaivgi/kling-v3.0-std",
      durationSeconds: 3,
      resolution: "720p",
      firstFrameUrl: `https://assets.example.com${characterBase}/base-character/direction-templates/walk-4dir.png`
    });
    const uploadCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/assets/first-frame"));
    expect(uploadCall?.[1]).toMatchObject({
      headers: expect.objectContaining({
        "x-public-asset-base-url": "https://darn-skittle-unwoven.ngrok-free.dev"
      })
    });
  });

  it("allows video generation to upload a first frame directly in the second stage", async () => {
    openSpriteAnimator();
    fireEvent.click(screen.getByRole("button", { name: "步行四方向" }));

    fireEvent.change(screen.getByLabelText(/OpenRouter 密钥/i), {
      target: { value: "sk-or-v1-web-key" }
    });
    const file = new File(["direct-video-frame"], "direct-first-frame.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("上传四方向步行图"), {
      target: { files: [file] }
    });

    await screen.findByText(/四方向步行图已保存/);
    expect(screen.getByAltText("步行 2x2 输出预览")).toHaveAttribute("src", "blob:uploaded-input-preview");

    fireEvent.change(screen.getByLabelText(/视频模型/i), {
      target: { value: "x-ai/grok-imagine-video" }
    });
    const durationSelect = screen.getByLabelText(/视频时长/i);
    expect(durationSelect).toHaveValue("1");
    expect(within(durationSelect).getByRole("option", { name: "2 秒" })).toBeInTheDocument();
    const resolutionSelect = screen.getByLabelText(/视频分辨率/i);
    expect(resolutionSelect).toHaveValue("480p");
    expect(within(resolutionSelect).getByRole("option", { name: "720p" })).toBeInTheDocument();
    fireEvent.change(durationSelect, {
      target: { value: "2" }
    });
    fireEvent.change(resolutionSelect, {
      target: { value: "720p" }
    });
    fireEvent.click(screen.getByRole("button", { name: /提交视频任务/i }));

    await screen.findByText(/视频已下载到 storage\/characters\/hero\/base-character\/walk-video\/source.mp4/);
    const videoCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url).includes("/api/generation/video") && (init as RequestInit | undefined)?.method === "POST"
    );
    expect(JSON.parse(String(videoCall?.[1]?.body))).toMatchObject({
      model: "x-ai/grok-imagine-video",
      durationSeconds: 2,
      resolution: "720p",
      firstFrameUrl: `https://assets.example.com${characterBase}/base-character/walk-video/input-4dir.png`
    });
  });

  it("shows provider details when a video job fails", async () => {
    videoStatusPayload = {
      jobId: "video_job_123",
      status: "failed",
      providerResponse: {
        error: {
          message: "Input image could not be loaded"
        }
      }
    };
    openSpriteAnimator();
    fireEvent.click(screen.getByRole("button", { name: "步行四方向" }));

    fireEvent.change(screen.getByLabelText(/OpenRouter 密钥/i), {
      target: { value: "sk-or-v1-web-key" }
    });
    fireEvent.change(screen.getByLabelText("上传四方向步行图"), {
      target: { files: [new File(["walk-sheet"], "walk-2x2.png", { type: "image/png" })] }
    });
    await screen.findByText(/四方向步行图已保存/);

    fireEvent.click(screen.getByRole("button", { name: /提交视频任务/i }));

    await screen.findByText(/视频任务失败：Input image could not be loaded/);
    expect(screen.getByText("视频状态详情")).toBeInTheDocument();
    expect(screen.getAllByText(/Input image could not be loaded/).length).toBeGreaterThanOrEqual(2);
  });

  it("runs four-direction loop processing from an uploaded local video", async () => {
    openSpriteAnimator();
    fireEvent.click(screen.getByRole("button", { name: "步行四方向" }));

    const file = new File(["local-video"], "local-source.mp4", { type: "video/mp4" });
    fireEvent.change(screen.getByLabelText("上传步行视频"), {
      target: { files: [file] }
    });

    await screen.findByText(/帧处理视频已载入：local-source.mp4/);
    expect(screen.getByLabelText("帧处理视频输入预览")).toHaveAttribute(
      "src",
      `http://127.0.0.1:8787${characterBase}/base-character/walk-video/source.mp4`
    );

    expect(screen.queryByRole("button", { name: "1 抽帧" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "2 切四方向并中心化" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "3 寻找循环" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "4 抠图预览" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("帧时间轴")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /一键处理步行循环/i }));

    await screen.findByText(/步行四方向处理完成/);
    expect(screen.getByAltText("下方向最终循环预览")).toHaveAttribute(
      "src",
      expect.stringContaining(`${characterBase}/base-character/loop-export/transparent/down/frame_002.png`)
    );
    expect(screen.getByText("四方向最终循环预览")).toBeInTheDocument();
    expect(screen.getAllByText("下方向").length).toBeGreaterThan(0);
    expect(screen.getAllByText("上方向").length).toBeGreaterThan(0);
    expect(screen.getAllByText("左方向").length).toBeGreaterThan(0);
    expect(screen.getAllByText("右方向").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /导出走路 Sprite Sheet/i })).toHaveAttribute(
      "href",
      expect.stringContaining(`${characterBase}/base-character/loop-export/exports/sprite-sheet.png`)
    );
    expect(screen.getByRole("link", { name: /导出透明帧 ZIP/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /导出 GIF/i })).toBeInTheDocument();

    const processCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/processing/four-direction"));
    expect(JSON.parse(String(processCall?.[1]?.body))).toMatchObject({
      jobId: "local-video-123",
      characterId: "hero",
      frameCount: 120,
      minLoopFrames: 12,
      maxLoopFrames: 60,
      exportFrameSize: 1024
    });
  });

  it("runs idle processing from the idle four-direction page after walk processing exists", async () => {
    openSpriteAnimator();
    fireEvent.click(screen.getByRole("button", { name: "待机四方向" }));

    const processIdleButton = screen.getByRole("button", { name: /一键处理待机四方向/i });
    await waitFor(() => {
      expect(processIdleButton).not.toBeDisabled();
    });
    fireEvent.click(processIdleButton);

    await screen.findByText(/待机四方向处理完成/);
    expect(screen.getByAltText("待机四方向预览")).toHaveAttribute(
      "src",
      expect.stringContaining(`${characterBase}/base-character/loop-export/exports/idle-4dir-sprite-sheet.png`)
    );
    expect(screen.getByAltText("下方向待机预览")).toHaveAttribute(
      "src",
      expect.stringContaining(`${characterBase}/base-character/loop-export/idle/transparent/down.png`)
    );
    expect(screen.getByRole("link", { name: /导出待机 Sprite Sheet/i })).toHaveAttribute(
      "href",
      expect.stringContaining(`${characterBase}/base-character/loop-export/exports/idle-4dir-sprite-sheet.png`)
    );

    const idleProcessCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/processing/idle-four-direction"));
    expect(JSON.parse(String(idleProcessCall?.[1]?.body))).toMatchObject({
      characterId: "hero",
      keyColor: "#00ff00",
      tolerance: 255
    });
  });

  it("shows a controlled fallback instead of oversized alt text when an image preview fails", async () => {
    openSpriteAnimator();

    fireEvent.click(screen.getByRole("button", { name: "步行四方向" }));
    const file = new File(["walk-sheet"], "walk-2x2.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("上传四方向步行图"), {
      target: { files: [file] }
    });

    const videoInput = await screen.findByAltText("步行 2x2 输出预览");
    fireEvent.error(videoInput);

    await waitFor(() => {
      expect(screen.queryByAltText("步行 2x2 输出预览")).not.toBeInTheDocument();
    });
    expect(screen.getAllByText("预览加载失败").length).toBeGreaterThan(0);
  });

  it("saves edited Chinese prompts and restores them when the module reopens", async () => {
    openSpriteAnimator();

    fireEvent.change(screen.getByLabelText("自定义提示词"), {
      target: { value: "已保存的高清2D骑士首帧" }
    });

    fireEvent.click(screen.getByRole("button", { name: /保存基准模板配置/i }));
    await screen.findByText(/基准模板配置已保存到后端/);

    cleanup();
    openSpriteAnimator();

    expect(screen.getByLabelText("自定义提示词")).toHaveValue("已保存的高清2D骑士首帧");
    expect(screen.getByText("https://darn-skittle-unwoven.ngrok-free.dev")).toBeInTheDocument();
  });

  it("loads backend workflow prompts and saves prompt edits back to the backend config", async () => {
    module01WorkflowConfigPayload = {
      imageModel: "local/gpt-image-2",
      imageGenerationSize: 2048,
      imageStyle: "cel-anime",
      imageSystemPrompt: "后端系统提示词：第一张图控制画风，第二张图控制角色。",
      imageCustomPrompt: "后端自定义提示词：下方向怯生生走路第一帧。",
      directionImageModel: "openai/gpt-5.4-image-2",
      directionImageGenerationSize: 1024,
      directionIdleSystemPrompt: "后端待机系统提示词",
      directionIdleCustomPrompt: "后端待机自定义提示词",
      directionWalkSystemPrompt: "后端步行系统提示词",
      directionWalkCustomPrompt: "后端步行自定义提示词",
      videoModel: "x-ai/grok-imagine-video",
      videoDurationSeconds: 2,
      videoResolution: "720p",
      videoSystemPrompt: "后端视频系统提示词",
      videoCustomPrompt: "后端视频自定义提示词"
    };

    openSpriteAnimator();

    await waitFor(() => {
      expect(screen.getByLabelText("系统提示词")).toHaveValue("后端系统提示词：第一张图控制画风，第二张图控制角色。");
    });
    expect(screen.getByLabelText("自定义提示词")).toHaveValue("后端自定义提示词：下方向怯生生走路第一帧。");
    expect(screen.getByLabelText(/图像模型/i)).toHaveValue("local/gpt-image-2");
    expect(screen.getByLabelText(/图片生成尺寸/i)).toHaveValue("2048");

    fireEvent.change(screen.getByLabelText("系统提示词"), {
      target: { value: "网页覆盖后的系统提示词" }
    });
    fireEvent.change(screen.getByLabelText("自定义提示词"), {
      target: { value: "网页覆盖后的自定义提示词" }
    });
    fireEvent.click(screen.getByRole("button", { name: /保存基准模板配置/i }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url, init]) =>
        String(url).endsWith("/api/module01/workflow-config") && (init as RequestInit | undefined)?.method === "PUT"
      )).toBe(true);
    });
    const saveCall = fetchMock.mock.calls.findLast(([url, init]) =>
      String(url).endsWith("/api/module01/workflow-config") && (init as RequestInit | undefined)?.method === "PUT"
    );
    expect(JSON.parse(String(saveCall?.[1]?.body))).toMatchObject({
      imageSystemPrompt: "网页覆盖后的系统提示词",
      imageCustomPrompt: "网页覆盖后的自定义提示词",
      directionIdleSystemPrompt: "后端待机系统提示词",
      directionWalkSystemPrompt: "后端步行系统提示词",
      videoSystemPrompt: "后端视频系统提示词",
      videoCustomPrompt: "后端视频自定义提示词"
    });
    expect(JSON.parse(String(saveCall?.[1]?.body))).not.toHaveProperty("openRouterApiKey");
    expect(Object.keys(JSON.parse(String(saveCall?.[1]?.body))).filter((key) => key.endsWith("DefaultVersion"))).toEqual([]);
    expect(screen.getByText(/基准模板配置已保存到后端/)).toBeInTheDocument();
  });

  it("client reads and fully replaces module 01 workflow config", async () => {
    await saveModule01WorkflowConfig({
      imageSystemPrompt: "直接保存系统提示词",
      videoCustomPrompt: "直接保存视频自定义提示词"
    });

    expect(module01WorkflowConfigPayload).toEqual({
      imageSystemPrompt: "直接保存系统提示词",
      videoCustomPrompt: "直接保存视频自定义提示词"
    });
    await expect(getModule01WorkflowConfig()).resolves.toEqual({
      imageSystemPrompt: "直接保存系统提示词",
      videoCustomPrompt: "直接保存视频自定义提示词"
    });
  });

  it("saves edited video generation config from the second stage", async () => {
    openSpriteAnimator();
    fireEvent.click(screen.getByRole("button", { name: "步行四方向" }));

    fireEvent.change(screen.getByLabelText(/视频模型/i), {
      target: { value: "kwaivgi/kling-v3.0-pro" }
    });
    fireEvent.change(screen.getByLabelText("视频系统提示词"), {
      target: { value: "已保存的视频系统提示词：四方向四宫格原地行走循环。" }
    });
    fireEvent.change(screen.getByLabelText("视频自定义提示词"), {
      target: { value: "动作幅度轻微，保持角色原位置。" }
    });
    expect(screen.getByLabelText(/最终视频提示词/i)).toHaveValue(
      "已保存的视频系统提示词：四方向四宫格原地行走循环。\n\n动作幅度轻微，保持角色原位置。"
    );

    fireEvent.click(screen.getByRole("button", { name: /保存视频配置/i }));
    await screen.findByText(/视频配置已保存到后端/);

    cleanup();
    openSpriteAnimator();
    fireEvent.click(screen.getByRole("button", { name: "步行四方向" }));

    expect(screen.getByLabelText(/视频模型/i)).toHaveValue("kwaivgi/kling-v3.0-pro");
    expect(screen.getByLabelText(/视频时长/i)).toHaveValue("3");
    expect(screen.queryByLabelText(/视频视角/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/动作模板/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("视频系统提示词")).toHaveValue("已保存的视频系统提示词：四方向四宫格原地行走循环。");
    expect(screen.getByLabelText("视频自定义提示词")).toHaveValue("动作幅度轻微，保持角色原位置。");
    expect(screen.getByLabelText(/最终视频提示词/i)).toHaveValue(
      "已保存的视频系统提示词：四方向四宫格原地行走循环。\n\n动作幅度轻微，保持角色原位置。"
    );
  });

  it("encodes non-ASCII character ids before sending them in headers", async () => {
    const encodedCharacterId = encodeURIComponent("测试角色");

    await uploadFirstFrameAsset(new File(["image"], "hero.png", { type: "image/png" }), {
      characterId: "测试角色",
      publicAssetBaseUrl: "https://assets.example.com"
    });
    expect(readHeader(fetchMock.mock.calls.at(-1)?.[1]?.headers, "x-character-id")).toBe(encodedCharacterId);

    await uploadFrameVideoAsset(new File(["video"], "source.mp4", { type: "video/mp4" }), {
      characterId: "测试角色"
    });
    expect(readHeader(fetchMock.mock.calls.at(-1)?.[1]?.headers, "x-character-id")).toBe(encodedCharacterId);

    await createFirstFrameGeneration({
      model: "openai/gpt-5.4-image-2",
      prompt: "生成角色",
      targetSize: 1024,
      keyColor: "#00ff00"
    }, {
      characterId: "测试角色"
    });
    expect(readHeader(fetchMock.mock.calls.at(-1)?.[1]?.headers, "x-character-id")).toBe(encodedCharacterId);

    await getVideoGenerationStatus("video_job_123", {
      characterId: "测试角色"
    });
    const [statusUrl, statusInit] = fetchMock.mock.calls.at(-1) ?? [];
    expect(String(statusUrl)).toContain(`characterId=${encodedCharacterId}`);
    expect(readHeader(statusInit?.headers, "x-character-id")).toBe(encodedCharacterId);
  });
});

function readHeader(headers: RequestInit["headers"], name: string): string | null {
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  return (headers as Record<string, string> | undefined)?.[name] ?? null;
}
