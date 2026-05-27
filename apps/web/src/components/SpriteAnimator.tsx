import { ArrowLeft, Download, Film, ImageUp, Play, Save, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import type { CharacterDirection, SavedAnimationKeys, TargetSize } from "@ai-game-workbench/core";
import { buildAnimationPrompt, buildExportNames } from "@ai-game-workbench/core";
import { FirstFramePanel } from "./FirstFramePanel";
import { AnimationPanel } from "./AnimationPanel";
import { FrameTimeline } from "./FrameTimeline";
import { ExportPanel } from "./ExportPanel";
import { StatusLog } from "./StatusLog";

interface SpriteAnimatorProps {
  defaultKeys: SavedAnimationKeys;
  onBack: () => void;
}

export function SpriteAnimator({ defaultKeys, onBack }: SpriteAnimatorProps) {
  const [assetKey, setAssetKey] = useState(defaultKeys.assetKey);
  const [animationKey, setAnimationKey] = useState(defaultKeys.animationKey);
  const [fps, setFps] = useState(defaultKeys.fps);
  const [targetSize, setTargetSize] = useState<TargetSize>(defaultKeys.targetSize);
  const [loop, setLoop] = useState(defaultKeys.loop);
  const [keyColor, setKeyColor] = useState("#00ff00");
  const [direction, setDirection] = useState<CharacterDirection>("front");
  const [actionTemplate, setActionTemplate] = useState("idle");
  const [actionPrompt, setActionPrompt] = useState("body slightly sways in a clean idle loop");
  const [status, setStatus] = useState("Ready. Choose or generate a first frame.");

  const composedPrompt = useMemo(
    () =>
      buildAnimationPrompt({
        actionTemplate: actionTemplate as Parameters<typeof buildAnimationPrompt>[0]["actionTemplate"],
        actionPrompt,
        keyColor
      }),
    [actionPrompt, actionTemplate, keyColor]
  );

  const exportNames = buildExportNames({
    assetKey,
    animationKey,
    frameIndex: 1
  });

  return (
    <main className="app-shell workbench-shell">
      <aside className="side-nav">
        <button className="icon-button" type="button" onClick={onBack} aria-label="Back to workbench hub">
          <ArrowLeft size={18} />
        </button>
        <div className="nav-brand">Workbench</div>
        <button className="nav-item nav-item-active" type="button">
          <Film size={18} /> Animator
        </button>
        <button className="nav-item" type="button" disabled>
          <Sparkles size={18} /> Library
        </button>
      </aside>

      <section className="main-stage">
        <header className="tool-header">
          <div>
            <p className="eyebrow">Module 01</p>
            <h1>AI Sprite Animator</h1>
          </div>
          <div className="toolbar">
            <button className="tool-button" type="button" onClick={() => setStatus("Project keys saved locally in UI state.")}>
              <Save size={16} /> Save Keys
            </button>
            <button className="tool-button primary" type="button" onClick={() => setStatus("Animation job payload is ready for OpenRouter.")}>
              <Play size={16} /> Generate Animation
            </button>
          </div>
        </header>

        <div className="stage-grid">
          <section className="preview-panel">
            <div className="preview-box">
              <ImageUp size={42} />
              <span>First frame / animation preview</span>
            </div>
            <FrameTimeline fps={fps} loop={loop} />
          </section>

          <section className="right-stack">
            <FirstFramePanel
              targetSize={targetSize}
              keyColor={keyColor}
              direction={direction}
              onDirectionChange={setDirection}
              onStatus={setStatus}
            />
            <AnimationPanel
              actionTemplate={actionTemplate}
              actionPrompt={actionPrompt}
              composedPrompt={composedPrompt}
              keyColor={keyColor}
              onActionPromptChange={setActionPrompt}
              onActionTemplateChange={setActionTemplate}
              onKeyColorChange={setKeyColor}
            />
            <ExportPanel
              assetKey={assetKey}
              animationKey={animationKey}
              fps={fps}
              targetSize={targetSize}
              loop={loop}
              exportNames={exportNames}
              onAssetKeyChange={setAssetKey}
              onAnimationKeyChange={setAnimationKey}
              onFpsChange={setFps}
              onTargetSizeChange={setTargetSize}
              onLoopChange={setLoop}
            />
          </section>
        </div>

        <StatusLog status={status} />
      </section>

      <button className="floating-export" type="button" onClick={() => setStatus(`Prepared export: ${exportNames.sheetName}`)}>
        <Download size={18} /> Export
      </button>
    </main>
  );
}
