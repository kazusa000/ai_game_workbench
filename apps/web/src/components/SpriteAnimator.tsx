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
  const defaultImagePrompt = "白色短发、粉色眼睛、黑色服装配白色袖子和花饰的成年二次元像素角色";
  const defaultImagePromptInstructions =
    "生成正方形像素风首帧，角色朝向为正面，全身居中，轮廓干净，使用纯色抠图背景，无阴影、无地面、无文字。";
  const defaultActionPrompt = "身体轻微起伏，形成干净的待机循环";
  const [assetKey, setAssetKey] = useState(defaultKeys.assetKey);
  const [animationKey, setAnimationKey] = useState(defaultKeys.animationKey);
  const [fps, setFps] = useState(defaultKeys.fps);
  const [targetSize, setTargetSize] = useState<TargetSize>(defaultKeys.targetSize);
  const [imageGenerationSize, setImageGenerationSize] = useState<number>(defaultKeys.targetSize);
  const [loop, setLoop] = useState(defaultKeys.loop);
  const [keyColor, setKeyColor] = useState("#00ff00");
  const [direction, setDirection] = useState<CharacterDirection>("front");
  const [imagePrompt, setImagePrompt] = useState(defaultImagePrompt);
  const [imagePromptInstructions, setImagePromptInstructions] = useState(defaultImagePromptInstructions);
  const [finalImagePrompt, setFinalImagePrompt] = useState(
    buildFirstFramePrompt({
      imagePrompt: defaultImagePrompt,
      imagePromptInstructions: defaultImagePromptInstructions,
      imageGenerationSize: defaultKeys.targetSize,
      direction: "front",
      keyColor: "#00ff00"
    })
  );
  const [finalImagePromptTouched, setFinalImagePromptTouched] = useState(false);
  const [actionTemplate, setActionTemplate] = useState("idle");
  const [videoBasePrompt, setVideoBasePrompt] = useState(
    "单个2D游戏角色，全身，居中，镜头固定，无阴影，无地面，无粒子，循环精灵动画风格"
  );
  const [templatePrompt, setTemplatePrompt] = useState<string>(ACTION_TEMPLATES.idle);
  const [actionPrompt, setActionPrompt] = useState(defaultActionPrompt);
  const [finalVideoPrompt, setFinalVideoPrompt] = useState(
    buildAnimationPrompt({
      actionTemplate: "idle",
      actionPrompt: defaultActionPrompt,
      keyColor: "#00ff00"
    })
  );
  const [finalVideoPromptTouched, setFinalVideoPromptTouched] = useState(false);
  const [status, setStatus] = useState("就绪：上传或生成一张首帧。");

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
      [videoBasePrompt, `纯色 ${keyColor} 背景`, templatePrompt, actionPrompt]
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
        <button className="icon-button" type="button" onClick={onBack} aria-label="返回工作台首页">
          <ArrowLeft size={18} />
        </button>
        <div className="nav-brand">工作台</div>
        <button className="nav-item nav-item-active" type="button">
          <Film size={18} /> 动画生成
        </button>
        <button className="nav-item" type="button" disabled>
          <Sparkles size={18} /> 素材库
        </button>
      </aside>

      <section className="main-stage">
        <header className="tool-header">
          <div>
            <p className="eyebrow">模块 01</p>
            <h1>AI 精灵动画生成</h1>
          </div>
          <div className="toolbar">
            <button className="tool-button" type="button" onClick={() => setStatus("项目标识已保存在网页状态中。")}>
              <Save size={16} /> 保存标识
            </button>
            <button className="tool-button primary" type="button" onClick={() => setStatus("动画任务参数已准备好，可发送到 OpenRouter。")}>
              <Play size={16} /> 生成动画
            </button>
          </div>
        </header>

        <div className="stage-grid">
          <section className="preview-panel">
            <div className="preview-box">
              <ImageUp size={42} />
              <span>首帧 / 动画预览</span>
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

      <button className="floating-export" type="button" onClick={() => setStatus(`已准备导出：${exportNames.sheetName}`)}>
        <Download size={18} /> 导出
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
    `角色：${input.imagePrompt}`,
    `画布：${input.imageGenerationSize}x${input.imageGenerationSize}`,
    `朝向：${CHARACTER_DIRECTION_LABELS[input.direction]}`,
    `纯色 ${input.keyColor} 背景`
  ]
    .filter((part) => part.trim().length > 0)
    .join(" ");
}
