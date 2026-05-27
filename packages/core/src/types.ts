import type { ActionTemplateKey } from "./actionTemplates";

export type TargetSize = 64 | 128 | 256 | 512 | 1024;
export type CharacterDirection = "front" | "back" | "left" | "right";

export const CHARACTER_DIRECTIONS: readonly CharacterDirection[] = [
  "front",
  "back",
  "left",
  "right"
];

export const CHARACTER_DIRECTION_LABELS: Record<CharacterDirection, string> = {
  front: "front-facing",
  back: "back-facing",
  left: "left-facing side view",
  right: "right-facing side view"
};

export interface SavedAnimationKeys {
  assetKey: string;
  animationKey: string;
  fps: number;
  targetSize: TargetSize;
  loop: boolean;
}

export interface FirstFrameAsset {
  id: string;
  source: "uploaded" | "generated";
  localPath: string;
  publicUrl?: string;
}

export interface AnimationSettings extends SavedAnimationKeys {
  actionTemplate: ActionTemplateKey;
  actionPrompt: string;
  keyColor: string;
  direction: CharacterDirection;
  durationSeconds: number;
  providerModel: string;
}

export interface ProjectState {
  projectId: string;
  keys: SavedAnimationKeys;
  firstFrame?: FirstFrameAsset;
  updatedAt: string;
}

export const DEFAULT_KEYS: SavedAnimationKeys = {
  assetKey: "hero_mecha",
  animationKey: "idle",
  fps: 12,
  targetSize: 256,
  loop: true
};
