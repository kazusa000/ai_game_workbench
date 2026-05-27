import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App";

afterEach(() => {
  cleanup();
});

describe("App", () => {
  it("opens the AI sprite animator module from the Chinese workbench hub", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: /AI 游戏工作台/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /AI 精灵动画生成/i }));

    expect(screen.getByRole("heading", { name: /AI 精灵动画生成/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /上传首帧/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /生成首帧/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/朝向/i)).toHaveValue("front");
    expect(screen.getByLabelText(/资产标识/i)).toHaveValue("hero_mecha");
    expect(screen.getByLabelText(/动画标识/i)).toHaveValue("idle");
  });

  it("exposes Chinese generation prompts and custom image size as editable controls", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /AI 精灵动画生成/i }));

    const imagePrompt = screen.getByLabelText(/^图片提示词$/i);
    expect((imagePrompt as HTMLTextAreaElement).value).toContain("像素");
    fireEvent.change(imagePrompt, { target: { value: "正面像素骑士" } });
    expect(imagePrompt).toHaveValue("正面像素骑士");

    const imageInstructions = screen.getByLabelText(/图片提示词约束/i);
    fireEvent.change(imageInstructions, { target: { value: "使用纯色洋红背景" } });
    expect(imageInstructions).toHaveValue("使用纯色洋红背景");

    const imageSize = screen.getByLabelText(/图片生成尺寸/i);
    fireEvent.change(imageSize, { target: { value: "768" } });
    expect(imageSize).toHaveValue(768);

    const finalImagePrompt = screen.getByLabelText(/最终图片提示词/i);
    expect((finalImagePrompt as HTMLTextAreaElement).value).toContain("画布");
    fireEvent.change(finalImagePrompt, { target: { value: "最终自定义正方形像素角色提示词" } });
    expect(finalImagePrompt).toHaveValue("最终自定义正方形像素角色提示词");

    const finalVideoPrompt = screen.getByLabelText(/最终视频提示词/i);
    expect((finalVideoPrompt as HTMLTextAreaElement).value).toContain("循环精灵动画");

    const videoBasePrompt = screen.getByLabelText(/视频基础提示词/i);
    fireEvent.change(videoBasePrompt, { target: { value: "单个精灵，镜头锁定" } });
    expect(videoBasePrompt).toHaveValue("单个精灵，镜头锁定");

    const templatePrompt = screen.getByLabelText(/模板提示词/i);
    fireEvent.change(templatePrompt, { target: { value: "正面奔跑循环" } });
    expect(templatePrompt).toHaveValue("正面奔跑循环");

    const actionPrompt = screen.getByLabelText(/动作提示词/i);
    fireEvent.change(actionPrompt, { target: { value: "原地向前奔跑" } });
    expect(actionPrompt).toHaveValue("原地向前奔跑");

    fireEvent.change(finalVideoPrompt, { target: { value: "最终自定义 seedance 奔跑提示词" } });
    expect(finalVideoPrompt).toHaveValue("最终自定义 seedance 奔跑提示词");
  });
});
