import { describe, expect, it } from "vitest";
import { buildAnimationPrompt } from "../src/actionTemplates";

describe("buildAnimationPrompt", () => {
  it("combines Chinese sprite constraints with the selected action and user prompt", () => {
    const prompt = buildAnimationPrompt({
      actionTemplate: "walk",
      actionPrompt: "稳定循环向前行走",
      keyColor: "#00ff00"
    });

    expect(prompt).toContain("单个2D游戏角色");
    expect(prompt).toContain("全身");
    expect(prompt).toContain("居中");
    expect(prompt).toContain("镜头固定");
    expect(prompt).toContain("纯色 #00ff00 背景");
    expect(prompt).toContain("循环精灵动画风格");
    expect(prompt).toContain("侧面视角，2D游戏角色向前行走");
    expect(prompt).toContain("稳定循环向前行走");
  });
});
