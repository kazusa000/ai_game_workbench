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
      <div className="panel-title">First Frame</div>
      <div className="two-actions">
        <button className="tool-button" type="button" onClick={() => onStatus("Select a square pixel-art PNG first frame.")}>
          <Upload size={16} /> Upload First Frame
        </button>
        <button className="tool-button" type="button" onClick={() => onStatus("Generate a square pixel-art first frame through OpenRouter.")}>
          <ImagePlus size={16} /> Generate First Frame
        </button>
      </div>
      <label className="field">
        Direction
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
        Image Generation Size
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
        Image Prompt
        <textarea
          value={imagePrompt}
          onChange={(event) => onImagePromptChange(event.target.value)}
          rows={3}
        />
      </label>
      <label className="field">
        Image Prompt Instructions
        <textarea
          value={imagePromptInstructions}
          onChange={(event) => onImagePromptInstructionsChange(event.target.value)}
          rows={4}
        />
      </label>
      <label className="field">
        Final Image Prompt
        <textarea
          value={finalImagePrompt}
          onChange={(event) => onFinalImagePromptChange(event.target.value)}
          rows={5}
        />
      </label>
      <div className="hint-line">
        Export target {targetSize}px, generated first frame {imageGenerationSize}px, key background {keyColor}
      </div>
    </section>
  );
}
