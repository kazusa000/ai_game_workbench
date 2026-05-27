import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";

const fetchMock = vi.fn();

beforeEach(() => {
  const NativeURL = globalThis.URL;
  class TestURL extends NativeURL {
    static createObjectURL = vi.fn(() => "blob:uploaded-input-preview");
    static revokeObjectURL = vi.fn();
  }
  vi.stubGlobal("URL", TestURL);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes("/api/assets/first-frame")) {
      return jsonResponse({
        fileName: "hero-raw.png",
        localUrl: "/assets/hero-raw.png",
        publicUrl: "https://assets.example.com/hero-raw.png"
      });
    }
    if (url.includes("/api/assets/frame-video")) {
      return jsonResponse({
        fileName: "local-source.mp4",
        jobId: "local-video-123",
        localVideoUrl: "/jobs/local-video-123/source.mp4"
      });
    }
    if (url.includes("/api/generation/first-frame")) {
      return jsonResponse({
        fileName: "hero-processed.png",
        imageUrl: "/assets/hero-processed.png",
        localUrl: "/assets/hero-processed.png",
        publicUrl: "https://assets.example.com/hero-processed.png"
      });
    }
    if (url.includes("/api/generation/video/video_job_123")) {
      return jsonResponse({
        jobId: "video_job_123",
        status: "completed",
        localVideoUrl: "/jobs/video_job_123/source.mp4"
      });
    }
    if (url.includes("/api/generation/video") && init?.method === "POST") {
      return jsonResponse({
        id: "video_job_123",
        status: "queued"
      });
    }
    if (url.includes("/api/processing/frames")) {
      return jsonResponse({
        jobId: "video_job_123",
        frames: [
          { index: 1, url: "/jobs/video_job_123/frames/transparent/frame_001.png" },
          { index: 2, url: "/jobs/video_job_123/frames/transparent/frame_002.png" },
          { index: 3, url: "/jobs/video_job_123/frames/transparent/frame_003.png" }
        ]
      });
    }
    return jsonResponse({ error: "not found" }, false, 404);
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body
  };
}

function openSpriteAnimator() {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /AI 精灵动画生成/i }));
}

describe("App", () => {
  it("opens a Chinese three-stage sprite workflow", () => {
    openSpriteAnimator();

    expect(screen.getByRole("heading", { name: "AI 精灵动画生成" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /第一段.*首帧处理/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /第二段.*视频生成/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /第三段.*帧处理/ })).toBeInTheDocument();
    expect(screen.getAllByText("输入预览")).toHaveLength(3);
    expect(screen.getAllByText("输出预览")).toHaveLength(3);
    expect(screen.getByLabelText(/图像模型/i)).toHaveValue("openai/gpt-5.4-image-2");
    expect(screen.getByRole("option", { name: /Nano Banana 2/i })).toHaveValue("google/gemini-3.1-flash-image-preview");
    expect(screen.getByLabelText(/视频模型/i)).toHaveValue("bytedance/seedance-2.0");
    expect(screen.getByText("https://darn-skittle-unwoven.ngrok-free.dev")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /公网资源地址/i })).not.toBeInTheDocument();
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

  it("runs first-frame processing, video polling, and frame processing through the visible workflow", async () => {
    openSpriteAnimator();

    fireEvent.change(screen.getByLabelText(/OpenRouter 密钥/i), {
      target: { value: "sk-or-v1-web-key" }
    });

    const file = new File(["fake-image"], "hero-raw.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("上传输入图片"), {
      target: { files: [file] }
    });

    expect(screen.getByAltText("首帧输入预览")).toHaveAttribute("src", "blob:uploaded-input-preview");
    await screen.findByDisplayValue("https://assets.example.com/hero-raw.png");

    fireEvent.click(screen.getByRole("button", { name: /处理首帧/i }));

    await screen.findByAltText("首帧输出预览");
    expect(screen.getByAltText("视频输入预览")).toHaveAttribute(
      "src",
      "http://127.0.0.1:8787/assets/hero-processed.png"
    );

    fireEvent.change(screen.getByLabelText(/视频模型/i), {
      target: { value: "kwaivgi/kling-v3.0-std" }
    });
    expect(screen.getByText(/当前模型最短时长：3 秒/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /提交视频任务/i }));

    await screen.findByText(/视频已下载到 storage\/jobs\/video_job_123\/source.mp4/);
    expect(screen.getByLabelText("视频输出预览")).toHaveAttribute(
      "src",
      "http://127.0.0.1:8787/jobs/video_job_123/source.mp4"
    );
    expect(screen.getByLabelText("帧处理视频输入预览")).toHaveAttribute(
      "src",
      "http://127.0.0.1:8787/jobs/video_job_123/source.mp4"
    );

    fireEvent.change(screen.getByLabelText(/抽帧数量/i), {
      target: { value: "3" }
    });
    fireEvent.click(screen.getByRole("button", { name: /处理视频帧/i }));

    await screen.findByAltText("第 1 帧");
    expect(screen.getByAltText("第 1 帧")).toHaveAttribute(
      "src",
      expect.stringMatching(/frame_001\.png\?v=/)
    );
    expect(screen.getByLabelText("帧时间轴")).toBeInTheDocument();
    expect(screen.getByText("当前帧：1 / 3")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /选择第 .* 帧/ })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: /屏蔽第 .* 帧/ })).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "选择第 3 帧" }));
    expect(screen.getByAltText("第 3 帧")).toBeInTheDocument();
    expect(screen.getByText("当前帧：3 / 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "屏蔽第 1 帧" }));
    fireEvent.click(screen.getByRole("button", { name: "播放帧动画" }));
    expect(screen.getAllByText(/播放中/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "停止帧动画" }));
    expect(screen.getAllByText(/已停止/).length).toBeGreaterThan(0);

    const videoCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url).includes("/api/generation/video") && (init as RequestInit | undefined)?.method === "POST"
    );
    expect(JSON.parse(String(videoCall?.[1]?.body))).toMatchObject({
      model: "kwaivgi/kling-v3.0-std",
      durationSeconds: 3,
      firstFrameUrl: "https://assets.example.com/hero-processed.png"
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

    fireEvent.change(screen.getByLabelText(/OpenRouter 密钥/i), {
      target: { value: "sk-or-v1-web-key" }
    });
    const file = new File(["direct-video-frame"], "direct-first-frame.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("上传视频首帧"), {
      target: { files: [file] }
    });

    await screen.findByText(/视频首帧已保存/);
    expect(screen.getByAltText("视频输入预览")).toHaveAttribute("src", "blob:uploaded-input-preview");

    fireEvent.click(screen.getByRole("button", { name: /提交视频任务/i }));

    await screen.findByText(/视频已下载到 storage\/jobs\/video_job_123\/source.mp4/);
    const videoCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url).includes("/api/generation/video") && (init as RequestInit | undefined)?.method === "POST"
    );
    expect(JSON.parse(String(videoCall?.[1]?.body))).toMatchObject({
      firstFrameUrl: "https://assets.example.com/hero-raw.png"
    });
  });

  it("allows frame processing to upload a local video directly in the third stage", async () => {
    openSpriteAnimator();

    const file = new File(["local-video"], "local-source.mp4", { type: "video/mp4" });
    fireEvent.change(screen.getByLabelText("上传帧处理视频"), {
      target: { files: [file] }
    });

    await screen.findByText(/帧处理视频已载入：local-source.mp4/);
    expect(screen.getByLabelText("帧处理视频输入预览")).toHaveAttribute(
      "src",
      "http://127.0.0.1:8787/jobs/local-video-123/source.mp4"
    );

    fireEvent.click(screen.getByRole("button", { name: /处理视频帧/i }));

    await screen.findByText("当前帧：1 / 3");
    const processCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/processing/frames"));
    expect(JSON.parse(String(processCall?.[1]?.body))).toMatchObject({
      jobId: "local-video-123"
    });
  });

  it("shows a controlled fallback instead of oversized alt text when an image preview fails", async () => {
    openSpriteAnimator();

    fireEvent.change(screen.getByLabelText(/OpenRouter 密钥/i), {
      target: { value: "sk-or-v1-web-key" }
    });
    fireEvent.click(screen.getByRole("button", { name: /处理首帧/i }));

    const videoInput = await screen.findByAltText("视频输入预览");
    fireEvent.error(videoInput);

    expect(screen.queryByAltText("视频输入预览")).not.toBeInTheDocument();
    expect(screen.getAllByText("预览加载失败").length).toBeGreaterThan(0);
  });

  it("saves edited Chinese prompts and restores them when the module reopens", () => {
    openSpriteAnimator();

    fireEvent.change(screen.getByLabelText("图片提示词"), {
      target: { value: "已保存的正面像素骑士" }
    });
    fireEvent.change(screen.getByLabelText(/最终视频提示词/i), {
      target: { value: "已保存的正面奔跑循环提示词" }
    });

    fireEvent.click(screen.getByRole("button", { name: /保存当前配置/i }));
    expect(screen.getByText(/配置已覆盖保存/)).toBeInTheDocument();

    cleanup();
    openSpriteAnimator();

    expect(screen.getByLabelText("图片提示词")).toHaveValue("已保存的正面像素骑士");
    expect(screen.getByLabelText(/最终视频提示词/i)).toHaveValue("已保存的正面奔跑循环提示词");
    expect(screen.getByText("https://darn-skittle-unwoven.ngrok-free.dev")).toBeInTheDocument();
  });
});
