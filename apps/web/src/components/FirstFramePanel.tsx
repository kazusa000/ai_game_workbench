import { ImagePlus, Upload } from "lucide-react";
import {
  CHARACTER_DIRECTIONS,
  CHARACTER_DIRECTION_LABELS,
  type CharacterDirection,
  type TargetSize
} from "@ai-game-workbench/core";

interface FirstFramePanelProps {
  targetSize: TargetSize;
  keyColor: string;
  direction: CharacterDirection;
  onDirectionChange: (direction: CharacterDirection) => void;
  onStatus: (status: string) => void;
}

export function FirstFramePanel({
  targetSize,
  keyColor,
  direction,
  onDirectionChange,
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
        Character Prompt
        <textarea placeholder="armored 2D mecha pilot, clear silhouette" rows={3} />
      </label>
      <div className="hint-line">Target {targetSize}px, key background {keyColor}</div>
    </section>
  );
}
