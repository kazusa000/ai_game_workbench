export type PixelSpriteActionId = "idle" | "walk";

export interface PixelSpriteActionTemplate {
  id: PixelSpriteActionId;
  name: string;
  referenceImage: string;
  constraintPrompt: string;
  defaultFrameCount: number;
  directionCount: number;
}

export const PIXEL_SPRITE_ACTIONS: readonly PixelSpriteActionTemplate[] = [
  {
    id: "idle",
    name: "基准模板/待机",
    referenceImage: "idle-2x2-centered.png",
    constraintPrompt: "",
    defaultFrameCount: 2,
    directionCount: 2
  },
  {
    id: "walk",
    name: "步行",
    referenceImage: "walk-4x10-no-shadow.png",
    constraintPrompt: "",
    defaultFrameCount: 10,
    directionCount: 4
  }
] as const;

export function findPixelSpriteAction(actionId: string): PixelSpriteActionTemplate | undefined {
  return PIXEL_SPRITE_ACTIONS.find((action) => action.id === actionId);
}
