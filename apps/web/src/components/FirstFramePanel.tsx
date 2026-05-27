import { ImagePlus, Upload } from "lucide-react";
import {
  CHARACTER_DIRECTIONS,
  CHARACTER_DIRECTION_LABELS,
  type CharacterDirection,
  type TargetSize
} from "@ai-game-workbench/core";

interface FirstFramePanelProps {
  targetSize: TargetSize;
  imageGenerationSize: number;
  keyColor: string;
  direction: CharacterDirection;
  imagePrompt: string;
  imagePromptInstructions: string;
  finalImagePrompt: string;
  onImageGenerationSizeChange: (size: number) => void;
  onDirectionChange: (direction: CharacterDirection) => void;
  onImagePromptChange: (prompt: string) => void;
  onImagePromptInstructionsChange: (prompt: string) => void;
  onFinalImagePromptChange: (prompt: string) => void;
  onStatus: (status: string) => void;
}

export function FirstFramePanel({
  targetSize,
  imageGenerationSize,
  keyColor,
  direction,
  imagePrompt,
  imagePromptInstructions,
  finalImagePrompt,
  onImageGenerationSizeChange,
  onDirectionChange,
  onImagePromptChange,
  onImagePromptInstructionsChange,
  onFinalImagePromptChange,
  onStatus
}: FirstFramePanelProps) {
  return (
    <section className="panel">
      <div className="panel-title">首帧</div>
      <div className="two-actions">
        <button className="tool-button" type="button" onClick={() => onStatus("请选择一张正方形像素风 PNG 首帧。")}>
          <Upload size={16} /> 上传首帧
        </button>
        <button className="tool-button" type="button" onClick={() => onStatus("通过 OpenRouter 生成正方形像素风首帧。")}>
          <ImagePlus size={16} /> 生成首帧
        </button>
      </div>
      <label className="field">
        朝向
        <select
          value={direction}
          onChange={(event) => onDirectionChange(event.target.value as CharacterDirection)}
        >
          {CHARACTER_DIRECTIONS.map((item) => (
            <option value={item} key={item}>
              {CHARACTER_DIRECTION_LABELS[item]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        图片生成尺寸
        <input
          type="number"
          min={64}
          max={1024}
          step={1}
          value={imageGenerationSize}
          onChange={(event) => onImageGenerationSizeChange(Number(event.target.value))}
        />
      </label>
      <label className="field">
        图片提示词
        <textarea
          value={imagePrompt}
          onChange={(event) => onImagePromptChange(event.target.value)}
          rows={3}
        />
      </label>
      <label className="field">
        图片提示词约束
        <textarea
          value={imagePromptInstructions}
          onChange={(event) => onImagePromptInstructionsChange(event.target.value)}
          rows={4}
        />
      </label>
      <label className="field">
        最终图片提示词
        <textarea
          value={finalImagePrompt}
          onChange={(event) => onFinalImagePromptChange(event.target.value)}
          rows={5}
        />
      </label>
      <div className="hint-line">
        导出目标 {targetSize}px，生成首帧 {imageGenerationSize}px，抠图背景 {keyColor}
      </div>
    </section>
  );
}
