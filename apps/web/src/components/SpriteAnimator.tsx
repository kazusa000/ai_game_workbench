import { ArrowLeft, Download, Film, ImageUp, Play, Save, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { CharacterDirection, SavedAnimationKeys, TargetSize } from "@ai-game-workbench/core";
import { ACTION_TEMPLATES, buildAnimationPrompt, buildExportNames } from "@ai-game-workbench/core";
import { CHARACTER_DIRECTION_LABELS } from "@ai-game-workbench/core";
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
  const [imageGenerationSize, setImageGenerationSize] = useState<number>(defaultKeys.targetSize);
  const [loop, setLoop] = useState(defaultKeys.loop);
  const [keyColor, setKeyColor] = useState("#00ff00");
  const [direction, setDirection] = useState<CharacterDirection>("front");
  const [imagePrompt, setImagePrompt] = useState(
    "adult anime heroine character with short white hair, pink eyes, black outfit with white sleeves and flower accessories"
  );
  const [imagePromptInstructions, setImagePromptInstructions] = useState(
    "Generate a square front-facing pixel-art first frame, full-body centered, clean silhouette, flat solid chroma-key background, no shadow, no ground, no text."
  );
  const [finalImagePrompt, setFinalImagePrompt] = useState(
    buildFirstFramePrompt({
      imagePrompt:
        "adult anime heroine character with short white hair, pink eyes, black outfit with white sleeves and flower accessories",
      imagePromptInstructions:
        "Generate a square front-facing pixel-art first frame, full-body centered, clean silhouette, flat solid chroma-key background, no shadow, no ground, no text.",
      imageGenerationSize: defaultKeys.targetSize,
      direction: "front",
      keyColor: "#00ff00"
    })
  );
  const [finalImagePromptTouched, setFinalImagePromptTouched] = useState(false);
  const [actionTemplate, setActionTemplate] = useState("idle");
  const [videoBasePrompt, setVideoBasePrompt] = useState(
    "single 2D game character, full body, centered, no camera movement, no shadow, no ground, no particles, looping sprite animation style"
  );
  const [templatePrompt, setTemplatePrompt] = useState<string>(ACTION_TEMPLATES.idle);
  const [actionPrompt, setActionPrompt] = useState("body slightly sways in a clean idle loop");
  const [finalVideoPrompt, setFinalVideoPrompt] = useState(
    buildAnimationPrompt({
      actionTemplate: "idle",
      actionPrompt: "body slightly sways in a clean idle loop",
      keyColor: "#00ff00"
    })
  );
  const [finalVideoPromptTouched, setFinalVideoPromptTouched] = useState(false);
  const [status, setStatus] = useState("Ready. Choose or generate a first frame.");

  useEffect(() => {
    if (finalImagePromptTouched) {
      return;
    }
    setFinalImagePrompt(
      buildFirstFramePrompt({
        imagePrompt,
        imagePromptInstructions,
        imageGenerationSize,
        direction,
        keyColor
      })
    );
  }, [direction, finalImagePromptTouched, imageGenerationSize, imagePrompt, imagePromptInstructions, keyColor]);

  useEffect(() => {
    if (finalVideoPromptTouched) {
      return;
    }
    setFinalVideoPrompt(
      [videoBasePrompt, `solid ${keyColor} background`, templatePrompt, actionPrompt]
        .filter((part) => part.trim().length > 0)
        .join(", ")
    );
  }, [actionPrompt, finalVideoPromptTouched, keyColor, templatePrompt, videoBasePrompt]);

  const exportNames = buildExportNames({
    assetKey,
    animationKey,
    frameIndex: 1
  });

  const handleImageGenerationSizeChange = (size: number) => {
    if (!Number.isFinite(size)) {
      return;
    }
    setImageGenerationSize(Math.max(64, Math.min(1024, Math.round(size))));
    setFinalImagePromptTouched(false);
  };

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
              imageGenerationSize={imageGenerationSize}
              keyColor={keyColor}
              direction={direction}
              imagePrompt={imagePrompt}
              imagePromptInstructions={imagePromptInstructions}
              finalImagePrompt={finalImagePrompt}
              onImageGenerationSizeChange={handleImageGenerationSizeChange}
              onDirectionChange={(value) => {
                setDirection(value);
                setFinalImagePromptTouched(false);
              }}
              onImagePromptChange={(value) => {
                setImagePrompt(value);
                setFinalImagePromptTouched(false);
              }}
              onImagePromptInstructionsChange={(value) => {
                setImagePromptInstructions(value);
                setFinalImagePromptTouched(false);
              }}
              onFinalImagePromptChange={(value) => {
                setFinalImagePrompt(value);
                setFinalImagePromptTouched(true);
              }}
              onStatus={setStatus}
            />
            <AnimationPanel
              actionTemplate={actionTemplate}
              videoBasePrompt={videoBasePrompt}
              templatePrompt={templatePrompt}
              actionPrompt={actionPrompt}
              finalVideoPrompt={finalVideoPrompt}
              keyColor={keyColor}
              onActionPromptChange={(value) => {
                setActionPrompt(value);
                setFinalVideoPromptTouched(false);
              }}
              onActionTemplateChange={(value) => {
                setActionTemplate(value);
                setTemplatePrompt(ACTION_TEMPLATES[value as keyof typeof ACTION_TEMPLATES]);
                setFinalVideoPromptTouched(false);
              }}
              onVideoBasePromptChange={(value) => {
                setVideoBasePrompt(value);
                setFinalVideoPromptTouched(false);
              }}
              onTemplatePromptChange={(value) => {
                setTemplatePrompt(value);
                setFinalVideoPromptTouched(false);
              }}
              onFinalVideoPromptChange={(value) => {
                setFinalVideoPrompt(value);
                setFinalVideoPromptTouched(true);
              }}
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

function buildFirstFramePrompt(input: {
  imagePrompt: string;
  imagePromptInstructions: string;
  imageGenerationSize: number;
  direction: CharacterDirection;
  keyColor: string;
}): string {
  return [
    input.imagePromptInstructions,
    `Character: ${input.imagePrompt}`,
    `Canvas: ${input.imageGenerationSize}x${input.imageGenerationSize}`,
    `View direction: ${CHARACTER_DIRECTION_LABELS[input.direction]}`,
    `solid ${input.keyColor} background`
  ]
    .filter((part) => part.trim().length > 0)
    .join(" ");
}
