import type { TargetSize } from "@ai-game-workbench/core";
import type { ExportNames } from "@ai-game-workbench/core";

interface ExportPanelProps {
  assetKey: string;
  animationKey: string;
  fps: number;
  targetSize: TargetSize;
  loop: boolean;
  exportNames: ExportNames;
  onAssetKeyChange: (value: string) => void;
  onAnimationKeyChange: (value: string) => void;
  onFpsChange: (value: number) => void;
  onTargetSizeChange: (value: TargetSize) => void;
  onLoopChange: (value: boolean) => void;
}

const targetSizes: TargetSize[] = [64, 128, 256, 512, 1024];

export function ExportPanel(props: ExportPanelProps) {
  return (
    <section className="panel">
      <div className="panel-title">Export Keys</div>
      <label className="field">
        Asset Key
        <input value={props.assetKey} onChange={(event) => props.onAssetKeyChange(event.target.value)} />
      </label>
      <label className="field">
        Animation Key
        <input value={props.animationKey} onChange={(event) => props.onAnimationKeyChange(event.target.value)} />
      </label>
      <div className="field-row">
        <label className="field">
          FPS
          <input
            type="number"
            min={1}
            max={60}
            value={props.fps}
            onChange={(event) => props.onFpsChange(Number(event.target.value))}
          />
        </label>
        <label className="field">
          Target Size
          <select
            value={props.targetSize}
            onChange={(event) => props.onTargetSizeChange(Number(event.target.value) as TargetSize)}
          >
            {targetSizes.map((size) => (
              <option value={size} key={size}>{size}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="toggle-line">
        <input type="checkbox" checked={props.loop} onChange={(event) => props.onLoopChange(event.target.checked)} />
        Loop playback
      </label>
      <div className="export-name">{props.exportNames.sheetName}</div>
    </section>
  );
}
