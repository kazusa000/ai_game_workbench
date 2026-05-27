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

interface MediaPreview {
  name: string;
  url: string;
}

interface SpriteAnimatorDraft {
  assetKey: string;
  animationKey: string;
  fps: number;
  targetSize: TargetSize;
  imageGenerationSize: number;
  loop: boolean;
  keyColor: string;
  direction: CharacterDirection;
  imagePrompt: string;
  imagePromptInstructions: string;
  finalImagePrompt: string;
  finalImagePromptTouched: boolean;
  videoBasePrompt: string;
  templatePrompt: string;
  actionPrompt: string;
  finalVideoPrompt: string;
  finalVideoPromptTouched: boolean;
  actionTemplate: string;
}

const DRAFT_STORAGE_KEY = "ai-game-workbench.sprite-animator.draft.v1";
const DEFAULT_IMAGE_PROMPT = "白色短发、粉色眼睛、黑色服装配白色袖子和花饰的成年二次元像素角色";
const DEFAULT_IMAGE_PROMPT_INSTRUCTIONS =
  "生成正方形像素风首帧，角色朝向为正面，全身居中，轮廓干净，使用纯色抠图背景，无阴影、无地面、无文字。";
const DEFAULT_ACTION_PROMPT = "身体轻微起伏，形成干净的待机循环";
const DEFAULT_VIDEO_BASE_PROMPT =
  "单个2D游戏角色，全身，居中，镜头固定，无阴影，无地面，无粒子，循环精灵动画风格";

export function SpriteAnimator({ defaultKeys, onBack }: SpriteAnimatorProps) {
  const savedDraft = loadDraft(defaultKeys);
  const [assetKey, setAssetKey] = useState(savedDraft.assetKey);
  const [animationKey, setAnimationKey] = useState(savedDraft.animationKey);
  const [fps, setFps] = useState(savedDraft.fps);
  const [targetSize, setTargetSize] = useState<TargetSize>(savedDraft.targetSize);
  const [imageGenerationSize, setImageGenerationSize] = useState<number>(savedDraft.imageGenerationSize);
  const [loop, setLoop] = useState(savedDraft.loop);
  const [keyColor, setKeyColor] = useState(savedDraft.keyColor);
  const [direction, setDirection] = useState<CharacterDirection>(savedDraft.direction);
  const [imagePrompt, setImagePrompt] = useState(savedDraft.imagePrompt);
  const [imagePromptInstructions, setImagePromptInstructions] = useState(savedDraft.imagePromptInstructions);
  const [finalImagePrompt, setFinalImagePrompt] = useState(savedDraft.finalImagePrompt);
  const [finalImagePromptTouched, setFinalImagePromptTouched] = useState(savedDraft.finalImagePromptTouched);
  const [actionTemplate, setActionTemplate] = useState(savedDraft.actionTemplate);
  const [videoBasePrompt, setVideoBasePrompt] = useState(savedDraft.videoBasePrompt);
  const [templatePrompt, setTemplatePrompt] = useState<string>(savedDraft.templatePrompt);
  const [actionPrompt, setActionPrompt] = useState(savedDraft.actionPrompt);
  const [finalVideoPrompt, setFinalVideoPrompt] = useState(savedDraft.finalVideoPrompt);
  const [finalVideoPromptTouched, setFinalVideoPromptTouched] = useState(savedDraft.finalVideoPromptTouched);
  const [firstFramePreview, setFirstFramePreview] = useState<MediaPreview | null>(null);
  const [videoPreview] = useState<MediaPreview | null>(null);
  const [exportPreview] = useState<MediaPreview | null>(null);
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

  useEffect(() => {
    return () => {
      if (firstFramePreview) {
        URL.revokeObjectURL(firstFramePreview.url);
      }
    };
  }, [firstFramePreview]);

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

  const handleFirstFrameUpload = (file: File) => {
    if (!file.type.startsWith("image/")) {
      setStatus("上传失败：请选择 PNG、JPG 或 WebP 图片。");
      return;
    }
    setFirstFramePreview((current) => {
      if (current) {
        URL.revokeObjectURL(current.url);
      }
      return {
        name: file.name,
        url: URL.createObjectURL(file)
      };
    });
    setStatus(`已载入首帧：${file.name}`);
  };

  const handleSaveDraft = () => {
    const draft: SpriteAnimatorDraft = {
      assetKey,
      animationKey,
      fps,
      targetSize,
      imageGenerationSize,
      loop,
      keyColor,
      direction,
      imagePrompt,
      imagePromptInstructions,
      finalImagePrompt,
      finalImagePromptTouched,
      videoBasePrompt,
      templatePrompt,
      actionPrompt,
      finalVideoPrompt,
      finalVideoPromptTouched,
      actionTemplate
    };
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    setStatus("配置已覆盖保存，重新进入模块会自动恢复。");
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
            <button className="tool-button" type="button" onClick={handleSaveDraft}>
              <Save size={16} /> 保存当前配置
            </button>
            <button
              className="tool-button primary"
              type="button"
              onClick={() => setStatus("动画任务参数已准备好，视频生成结果会显示到视频预览。")}
            >
              <Play size={16} /> 生成动画
            </button>
          </div>
        </header>

        <div className="stage-grid">
          <section className="preview-panel" aria-label="生成预览">
            <div className="preview-grid">
              <PreviewSlot
                title="首帧预览"
                label={firstFramePreview?.name ?? "等待首帧"}
                kind="image"
                preview={firstFramePreview}
              />
              <PreviewSlot
                title="视频预览"
                label={videoPreview?.name ?? "等待视频生成结果"}
                kind="video"
                preview={videoPreview}
              />
              <PreviewSlot
                title="导出预览"
                label={exportPreview?.name ?? exportNames.sheetName}
                kind="image"
                preview={exportPreview}
              />
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
              onFirstFrameUpload={handleFirstFrameUpload}
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
              onKeyColorChange={(value) => {
                setKeyColor(value);
                setFinalImagePromptTouched(false);
                setFinalVideoPromptTouched(false);
              }}
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

function PreviewSlot({
  title,
  label,
  kind,
  preview
}: {
  title: string;
  label: string;
  kind: "image" | "video";
  preview: MediaPreview | null;
}) {
  return (
    <section className="preview-slot">
      <div className="preview-slot-header">
        <span>{title}</span>
        <small>{label}</small>
      </div>
      <div className="preview-stage">
        {preview && kind === "image" ? <img alt={title} src={preview.url} /> : null}
        {preview && kind === "video" ? <video controls src={preview.url} /> : null}
        {!preview ? (
          <div className="preview-empty">
            <ImageUp size={34} />
            <span>{label}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function loadDraft(defaultKeys: SavedAnimationKeys): SpriteAnimatorDraft {
  const fallback = buildDefaultDraft(defaultKeys);
  const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
  if (!raw) {
    return fallback;
  }
  try {
    return {
      ...fallback,
      ...JSON.parse(raw)
    };
  } catch {
    return fallback;
  }
}

function buildDefaultDraft(defaultKeys: SavedAnimationKeys): SpriteAnimatorDraft {
  const finalImagePrompt = buildFirstFramePrompt({
    imagePrompt: DEFAULT_IMAGE_PROMPT,
    imagePromptInstructions: DEFAULT_IMAGE_PROMPT_INSTRUCTIONS,
    imageGenerationSize: defaultKeys.targetSize,
    direction: "front",
    keyColor: "#00ff00"
  });
  const finalVideoPrompt = buildAnimationPrompt({
    actionTemplate: "idle",
    actionPrompt: DEFAULT_ACTION_PROMPT,
    keyColor: "#00ff00"
  });
  return {
    assetKey: defaultKeys.assetKey,
    animationKey: defaultKeys.animationKey,
    fps: defaultKeys.fps,
    targetSize: defaultKeys.targetSize,
    imageGenerationSize: defaultKeys.targetSize,
    loop: defaultKeys.loop,
    keyColor: "#00ff00",
    direction: "front",
    imagePrompt: DEFAULT_IMAGE_PROMPT,
    imagePromptInstructions: DEFAULT_IMAGE_PROMPT_INSTRUCTIONS,
    finalImagePrompt,
    finalImagePromptTouched: false,
    videoBasePrompt: DEFAULT_VIDEO_BASE_PROMPT,
    templatePrompt: ACTION_TEMPLATES.idle,
    actionPrompt: DEFAULT_ACTION_PROMPT,
    finalVideoPrompt,
    finalVideoPromptTouched: false,
    actionTemplate: "idle"
  };
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
