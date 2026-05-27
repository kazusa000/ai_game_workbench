export const ACTION_TEMPLATES = {
  idle: "侧面视角，2D游戏角色待机动画，身体轻微起伏",
  walk: "侧面视角，2D游戏角色向前行走",
  run: "侧面视角，2D游戏角色向前奔跑",
  jump: "侧面视角，2D游戏角色原地跳跃，包含起跳和下落",
  attack: "侧面视角，2D游戏角色做出清晰攻击动作",
  hit: "侧面视角，2D游戏角色受击并向后退缩",
  defeated: "侧面视角，2D游戏角色跪倒并倒地",
  custom: ""
} as const;

export type ActionTemplateKey = keyof typeof ACTION_TEMPLATES;

export interface BuildAnimationPromptInput {
  actionTemplate: ActionTemplateKey;
  actionPrompt: string;
  keyColor: string;
}

export function buildAnimationPrompt(input: BuildAnimationPromptInput): string {
  const baseConstraints = [
    "单个2D游戏角色",
    "全身",
    "居中",
    "镜头固定",
    `纯色 ${input.keyColor} 背景`,
    "无阴影",
    "无地面",
    "无粒子",
    "循环精灵动画风格"
  ];
  const template = ACTION_TEMPLATES[input.actionTemplate];
  return [...baseConstraints, template, input.actionPrompt]
    .filter((part) => part.trim().length > 0)
    .join(", ");
}
