import {
  ArrowLeft,
  Eye,
  EyeOff,
  Film,
  Pause,
  Play,
  Save,
  Scissors,
  Square,
  Upload,
  WandSparkles
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CharacterDirection, SavedAnimationKeys } from "@ai-game-workbench/core";
import {
  ACTION_TEMPLATES,
  CHARACTER_DIRECTION_LABELS,
  CHARACTER_DIRECTIONS
} from "@ai-game-workbench/core";
import {
  createFirstFrameGeneration,
  createVideoGeneration,
  getVideoGenerationStatus,
  processVideoFrames,
  toAbsoluteApiUrl,
  uploadFrameVideoAsset,
  uploadFirstFrameAsset
} from "../api/client";

interface SpriteAnimatorProps {
  defaultKeys: SavedAnimationKeys;
  onBack: () => void;
}

interface MediaPreview {
  name: string;
  url: string;
  publicUrl?: string;
}

interface FramePreview {
  index: number;
  url: string;
  hidden: boolean;
}

interface SpriteAnimatorDraft {
  openRouterApiKey: string;
  imageModel: string;
  videoModel: string;
  keyColor: string;
  direction: CharacterDirection;
  videoDirection: CharacterDirection;
  imageGenerationSize: number;
  imagePrompt: string;
  imagePromptInstructions: string;
  finalImagePrompt: string;
  finalImagePromptTouched: boolean;
  actionTemplate: keyof typeof ACTION_TEMPLATES;
  actionPrompt: string;
  finalVideoPrompt: string;
  finalVideoPromptTouched: boolean;
  frameCount: number;
  fps: number;
  tolerance: number;
}

const DRAFT_STORAGE_KEY = "ai-game-workbench.sprite-animator.workflow.v3";
const LEGACY_DRAFT_STORAGE_KEY = "ai-game-workbench.sprite-animator.workflow.v2";
const FIXED_PUBLIC_ASSET_BASE_URL = "https://darn-skittle-unwoven.ngrok-free.dev";
const LEGACY_SEEDREAM_IMAGE_MODEL = "bytedance-seed/seedream-4.5";
const IMAGE_MODELS = [
  { id: "openai/gpt-5.4-image-2", label: "GPT Image 2 (openai/gpt-5.4-image-2)" },
  { id: "google/gemini-3.1-flash-image-preview", label: "Nano Banana 2 (google/gemini-3.1-flash-image-preview)" },
  { id: LEGACY_SEEDREAM_IMAGE_MODEL, label: "Seedream 4.5 (bytedance-seed/seedream-4.5)" }
] as const;
const DEFAULT_IMAGE_MODEL = IMAGE_MODELS[0].id;
const DEFAULT_IMAGE_PROMPT = "白色短发、粉色眼睛、黑色服装配白色袖子和花饰的成年二次元像素角色";
const DEFAULT_IMAGE_PROMPT_INSTRUCTIONS =
  "生成正方形像素风首帧，单个全身角色居中，轮廓干净，转换为像素风，使用纯色抠图背景，无阴影、无地面、无文字。";

const VIDEO_MODELS = [
  { id: "bytedance/seedance-2.0", label: "Seedance 2.0", minDuration: 4 },
  { id: "bytedance/seedance-2.0-fast", label: "Seedance 2.0 Fast", minDuration: 4 },
  { id: "kwaivgi/kling-v3.0-std", label: "Kling v3.0 标准", minDuration: 3 },
  { id: "kwaivgi/kling-v3.0-pro", label: "Kling v3.0 Pro", minDuration: 3 }
] as const;

export function SpriteAnimator({ defaultKeys, onBack }: SpriteAnimatorProps) {
  const savedDraft = loadDraft(defaultKeys);
  const [openRouterApiKey, setOpenRouterApiKey] = useState(savedDraft.openRouterApiKey);
  const [imageModel, setImageModel] = useState(savedDraft.imageModel);
  const [videoModel, setVideoModel] = useState(savedDraft.videoModel);
  const [keyColor, setKeyColor] = useState(savedDraft.keyColor);
  const [direction, setDirection] = useState<CharacterDirection>(savedDraft.direction);
  const [videoDirection, setVideoDirection] = useState<CharacterDirection>(savedDraft.videoDirection);
  const [imageGenerationSize, setImageGenerationSize] = useState(savedDraft.imageGenerationSize);
  const [imagePrompt, setImagePrompt] = useState(savedDraft.imagePrompt);
  const [imagePromptInstructions, setImagePromptInstructions] = useState(savedDraft.imagePromptInstructions);
  const [finalImagePrompt, setFinalImagePrompt] = useState(savedDraft.finalImagePrompt);
  const [finalImagePromptTouched, setFinalImagePromptTouched] = useState(savedDraft.finalImagePromptTouched);
  const [actionTemplate, setActionTemplate] = useState<keyof typeof ACTION_TEMPLATES>(savedDraft.actionTemplate);
  const [actionPrompt, setActionPrompt] = useState(savedDraft.actionPrompt);
  const [finalVideoPrompt, setFinalVideoPrompt] = useState(savedDraft.finalVideoPrompt);
  const [finalVideoPromptTouched, setFinalVideoPromptTouched] = useState(savedDraft.finalVideoPromptTouched);
  const [frameCount, setFrameCount] = useState(savedDraft.frameCount);
  const [fps, setFps] = useState(savedDraft.fps);
  const [tolerance, setTolerance] = useState(savedDraft.tolerance);

  const [firstFrameInputFile, setFirstFrameInputFile] = useState<File | null>(null);
  const [firstFrameInputPreview, setFirstFrameInputPreview] = useState<MediaPreview | null>(null);
  const [uploadedFirstFramePublicUrl, setUploadedFirstFramePublicUrl] = useState("");
  const [firstFrameOutputPreview, setFirstFrameOutputPreview] = useState<MediaPreview | null>(null);
  const [videoInputPreview, setVideoInputPreview] = useState<MediaPreview | null>(null);
  const [videoOutputPreview, setVideoOutputPreview] = useState<MediaPreview | null>(null);
  const [frameVideoInputPreview, setFrameVideoInputPreview] = useState<MediaPreview | null>(null);
  const [videoJobId, setVideoJobId] = useState("");
  const [frames, setFrames] = useState<FramePreview[]>([]);
  const [activeFrameIndex, setActiveFrameIndex] = useState(0);
  const [isProcessingFirstFrame, setIsProcessingFirstFrame] = useState(false);
  const [isSubmittingVideo, setIsSubmittingVideo] = useState(false);
  const [isProcessingFrames, setIsProcessingFrames] = useState(false);
  const [isPlayingFrames, setIsPlayingFrames] = useState(false);
  const [firstFrameStatus, setFirstFrameStatus] = useState("等待输入图片或直接生成首帧。");
  const [videoStatus, setVideoStatus] = useState("等待首帧输出。");
  const [frameStatus, setFrameStatus] = useState("等待视频下载完成。");
  const pollTimeoutRef = useRef<number | undefined>(undefined);

  const selectedVideoModel = useMemo(
    () => VIDEO_MODELS.find((model) => model.id === videoModel) ?? VIDEO_MODELS[0],
    [videoModel]
  );
  const visibleFrames = frames.filter((frame) => !frame.hidden);
  const activeFrame = visibleFrames[activeFrameIndex % Math.max(visibleFrames.length, 1)];

  useEffect(() => {
    if (finalImagePromptTouched) {
      return;
    }
    setFinalImagePrompt(buildFirstFramePrompt({
      imagePrompt,
      imagePromptInstructions,
      imageGenerationSize,
      direction,
      keyColor
    }));
  }, [direction, finalImagePromptTouched, imageGenerationSize, imagePrompt, imagePromptInstructions, keyColor]);

  useEffect(() => {
    if (finalVideoPromptTouched) {
      return;
    }
    setFinalVideoPrompt(buildVideoPrompt({
      direction: videoDirection,
      actionPrompt,
      keyColor
    }));
  }, [actionPrompt, finalVideoPromptTouched, keyColor, videoDirection]);

  useEffect(() => {
    if (!isPlayingFrames || visibleFrames.length === 0) {
      return undefined;
    }
    const interval = window.setInterval(() => {
      setActiveFrameIndex((current) => (current + 1) % visibleFrames.length);
    }, Math.max(40, Math.round(1000 / Math.max(1, fps))));
    return () => window.clearInterval(interval);
  }, [fps, isPlayingFrames, visibleFrames.length]);

  useEffect(() => {
    if (visibleFrames.length === 0) {
      setIsPlayingFrames(false);
      setActiveFrameIndex(0);
      return;
    }
    setActiveFrameIndex((current) => Math.min(current, visibleFrames.length - 1));
  }, [visibleFrames.length]);

  useEffect(() => {
    return () => {
      if (pollTimeoutRef.current) {
        window.clearTimeout(pollTimeoutRef.current);
      }
      if (firstFrameInputPreview?.url.startsWith("blob:")) {
        URL.revokeObjectURL(firstFrameInputPreview.url);
      }
    };
  }, [firstFrameInputPreview]);

  useEffect(() => {
    return () => {
      if (videoInputPreview?.url.startsWith("blob:")) {
        URL.revokeObjectURL(videoInputPreview.url);
      }
    };
  }, [videoInputPreview]);

  const handleFirstFrameUpload = (file: File) => {
    if (!file.type.startsWith("image/")) {
      setFirstFrameStatus("上传失败：请选择图片文件。");
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    setFirstFrameInputFile(file);
    setUploadedFirstFramePublicUrl("");
    setFirstFrameInputPreview((current) => {
      if (current?.url.startsWith("blob:")) {
        URL.revokeObjectURL(current.url);
      }
      return {
        name: file.name,
        url: previewUrl
      };
    });
    setFirstFrameStatus(`已载入输入图：${file.name}，正在保存资源。`);
    void uploadFirstFrameAsset(file, { publicAssetBaseUrl: FIXED_PUBLIC_ASSET_BASE_URL })
      .then((asset) => {
        setUploadedFirstFramePublicUrl(asset.publicUrl);
        setFirstFrameStatus(`输入图已保存：${asset.fileName}`);
      })
      .catch((error: unknown) => {
        setFirstFrameStatus(`输入图保存失败：${getErrorMessage(error)}`);
      });
  };

  const handleVideoFirstFrameUpload = (file: File) => {
    if (!file.type.startsWith("image/")) {
      setVideoStatus("上传失败：请选择图片文件。");
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    setVideoInputPreview((current) => {
      if (current?.url.startsWith("blob:")) {
        URL.revokeObjectURL(current.url);
      }
      return {
        name: file.name,
        url: previewUrl
      };
    });
    setVideoStatus(`已载入视频首帧：${file.name}，正在保存资源。`);
    void uploadFirstFrameAsset(file, { publicAssetBaseUrl: FIXED_PUBLIC_ASSET_BASE_URL })
      .then((asset) => {
        setVideoInputPreview((current) => {
          if (!current || current.url !== previewUrl) {
            return current;
          }
          return {
            ...current,
            name: asset.fileName,
            publicUrl: asset.publicUrl
          };
        });
        setVideoStatus(`视频首帧已保存：${asset.fileName}，可以提交视频任务。`);
      })
      .catch((error: unknown) => {
        setVideoStatus(`视频首帧保存失败：${getErrorMessage(error)}`);
      });
  };

  const handleProcessFirstFrame = async () => {
    setIsProcessingFirstFrame(true);
    setFirstFrameStatus("正在处理首帧...");
    try {
      const referenceImageDataUrl = firstFrameInputFile ? await readFileAsDataUrl(firstFrameInputFile) : undefined;
      const response = await createFirstFrameGeneration({
        model: imageModel,
        prompt: finalImagePrompt,
        targetSize: imageGenerationSize,
        keyColor,
        direction,
        referenceImageDataUrl
      }, {
        openRouterApiKey,
        publicAssetBaseUrl: FIXED_PUBLIC_ASSET_BASE_URL
      });
      const imageUrl = extractImageUrl(response);
      const publicUrl = extractPublicUrl(response) ?? imageUrl;
      if (!imageUrl) {
        throw new Error("首帧处理没有返回图片。");
      }
      const preview = {
        name: extractFileName(response) ?? "processed-first-frame.png",
        url: toAbsoluteApiUrl(imageUrl),
        publicUrl
      };
      setFirstFrameOutputPreview(preview);
      setVideoInputPreview(preview);
      setFirstFrameStatus("首帧处理完成，已自动导入第二段。");
      setVideoStatus("首帧已就绪，可以提交视频任务。");
    } catch (error: unknown) {
      setFirstFrameStatus(`首帧处理失败：${getErrorMessage(error)}`);
    } finally {
      setIsProcessingFirstFrame(false);
    }
  };

  const handleSubmitVideo = async () => {
    const firstFrameUrl = videoInputPreview?.publicUrl ?? videoInputPreview?.url ?? firstFrameOutputPreview?.publicUrl ?? "";
    if (!firstFrameUrl) {
      setVideoStatus("请先完成第一段首帧处理。");
      return;
    }
    if (!isPublicHttpsUrl(firstFrameUrl)) {
      setVideoStatus("视频模型需要公网 HTTPS 首帧 URL。请设置公网资源地址后重新处理首帧。");
      return;
    }
    setIsSubmittingVideo(true);
    setVideoStatus("正在提交视频任务...");
    try {
      const response = await createVideoGeneration({
        model: videoModel,
        prompt: finalVideoPrompt,
        firstFrameUrl,
        durationSeconds: selectedVideoModel.minDuration
      }, {
        openRouterApiKey
      });
      const jobId = extractJobId(response);
      if (!jobId) {
        throw new Error("视频任务没有返回 jobId。");
      }
      setVideoJobId(jobId);
      setVideoStatus(`视频任务已提交：${jobId}，正在轮询状态。`);
      await pollVideoJob(jobId);
    } catch (error: unknown) {
      setVideoStatus(`视频生成提交失败：${getErrorMessage(error)}`);
    } finally {
      setIsSubmittingVideo(false);
    }
  };

  const pollVideoJob = async (jobId: string) => {
    const result = await getVideoGenerationStatus(jobId, { openRouterApiKey });
    if (result.status === "completed" && result.localVideoUrl) {
      const videoUrl = toAbsoluteApiUrl(result.localVideoUrl);
      const preview = {
        name: "source.mp4",
        url: videoUrl,
        publicUrl: result.localVideoUrl
      };
      setVideoOutputPreview(preview);
      setFrameVideoInputPreview(preview);
      setVideoStatus(`视频已下载到 storage/jobs/${jobId}/source.mp4`);
      setFrameStatus("视频已载入，可以处理帧。");
      return;
    }
    if (result.status === "failed") {
      setVideoStatus("视频任务失败，请查看状态详情或调整提示词。");
      return;
    }
    setVideoStatus(`视频任务状态：${result.status}，继续轮询。`);
    pollTimeoutRef.current = window.setTimeout(() => {
      void pollVideoJob(jobId).catch((error: unknown) => {
        setVideoStatus(`视频状态查询失败：${getErrorMessage(error)}`);
      });
    }, 3000);
  };

  const handleProcessFrames = async () => {
    if (!videoJobId || !frameVideoInputPreview) {
      setFrameStatus("请先完成第二段视频生成。");
      return;
    }
    setIsProcessingFrames(true);
    setFrameStatus("正在抽帧并抠图...");
    try {
      const result = await processVideoFrames({
        jobId: videoJobId,
        frameCount,
        keyColor,
        tolerance
      });
      const frameVersion = Date.now().toString(36);
      const nextFrames = result.frames.map((frame) => ({
        index: frame.index,
        url: appendCacheBust(toAbsoluteApiUrl(frame.url), `${frameVersion}-${frame.index}`),
        hidden: false
      }));
      setFrames(nextFrames);
      setActiveFrameIndex(0);
      setIsPlayingFrames(false);
      setFrameStatus(`帧处理完成：${nextFrames.length} 帧。`);
    } catch (error: unknown) {
      setFrameStatus(`帧处理失败：${getErrorMessage(error)}`);
    } finally {
      setIsProcessingFrames(false);
    }
  };

  const handleFrameVideoUpload = (file: File) => {
    if (!file.type.startsWith("video/")) {
      setFrameStatus("上传失败：请选择视频文件。");
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    setFrameVideoInputPreview((current) => {
      if (current?.url.startsWith("blob:")) {
        URL.revokeObjectURL(current.url);
      }
      return {
        name: file.name,
        url: previewUrl
      };
    });
    setVideoJobId("");
    setFrames([]);
    setActiveFrameIndex(0);
    setIsPlayingFrames(false);
    setFrameStatus(`已载入帧处理视频：${file.name}，正在保存资源。`);
    void uploadFrameVideoAsset(file)
      .then((asset) => {
        const preview = {
          name: asset.fileName,
          url: toAbsoluteApiUrl(asset.localVideoUrl),
          publicUrl: asset.localVideoUrl
        };
        setVideoJobId(asset.jobId);
        setFrameVideoInputPreview(preview);
        setFrameStatus(`帧处理视频已载入：${asset.fileName}，可以处理视频帧。`);
      })
      .catch((error: unknown) => {
        setFrameStatus(`帧处理视频保存失败：${getErrorMessage(error)}`);
      });
  };

  const handleSelectFrame = (index: number) => {
    const nextIndex = visibleFrames.findIndex((frame) => frame.index === index);
    if (nextIndex >= 0) {
      setActiveFrameIndex(nextIndex);
    }
  };

  const handleToggleFrame = (index: number) => {
    setFrames((current) => current.map((frame) =>
      frame.index === index ? { ...frame, hidden: !frame.hidden } : frame
    ));
  };

  const handleSaveDraft = () => {
    const draft: SpriteAnimatorDraft = {
      openRouterApiKey,
      imageModel,
      videoModel,
      keyColor,
      direction,
      videoDirection,
      imageGenerationSize,
      imagePrompt,
      imagePromptInstructions,
      finalImagePrompt,
      finalImagePromptTouched,
      actionTemplate,
      actionPrompt,
      finalVideoPrompt,
      finalVideoPromptTouched,
      frameCount,
      fps,
      tolerance
    };
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    setFirstFrameStatus("配置已覆盖保存。");
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
      </aside>

      <section className="main-stage">
        <header className="tool-header">
          <div>
            <p className="eyebrow">模块 01</p>
            <h1>AI 精灵动画生成</h1>
          </div>
          <div className="toolbar">
            <label className="api-key-field">
              OpenRouter 密钥
              <input
                aria-label="OpenRouter 密钥"
                autoComplete="off"
                placeholder="sk-or-v1-..."
                type="password"
                value={openRouterApiKey}
                onChange={(event) => setOpenRouterApiKey(event.target.value)}
              />
            </label>
            <div className="fixed-url-field" aria-label="固定公网资源地址">
              <span>固定公网资源地址</span>
              <code>{FIXED_PUBLIC_ASSET_BASE_URL}</code>
            </div>
            <button className="tool-button" type="button" onClick={handleSaveDraft}>
              <Save size={16} /> 保存当前配置
            </button>
          </div>
        </header>

        <div className="workflow-stack">
          <WorkflowStage
            title="第一段 首帧处理"
            status={firstFrameStatus}
            inputTitle="输入预览"
            outputTitle="输出预览"
            input={<ImagePreview alt="首帧输入预览" preview={firstFrameInputPreview} emptyLabel="等待输入图" />}
            output={<ImagePreview alt="首帧输出预览" preview={firstFrameOutputPreview} emptyLabel="等待处理结果" />}
            controls={(
              <>
                <div className="control-row">
                  <label className="file-picker">
                    <Upload size={16} /> 上传输入图片
                    <input
                      aria-label="上传输入图片"
                      className="visually-hidden"
                      type="file"
                      accept="image/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          handleFirstFrameUpload(file);
                        }
                      }}
                    />
                  </label>
                  <button
                    className="tool-button primary"
                    type="button"
                    disabled={isProcessingFirstFrame}
                    onClick={() => void handleProcessFirstFrame()}
                  >
                    <WandSparkles size={16} /> {isProcessingFirstFrame ? "处理中" : "处理首帧"}
                  </button>
                </div>
                <div className="form-grid">
                  <label className="field">
                    图像模型
                    <select aria-label="图像模型" value={imageModel} onChange={(event) => setImageModel(event.target.value)}>
                      {IMAGE_MODELS.map((model) => (
                        <option key={model.id} value={model.id}>{model.label}</option>
                      ))}
                    </select>
                  </label>
                  <DirectionSelect label="朝向" value={direction} onChange={(value) => {
                    setDirection(value);
                    setFinalImagePromptTouched(false);
                  }} />
                  <label className="field">
                    图片生成尺寸
                    <input
                      aria-label="图片生成尺寸"
                      type="number"
                      min={64}
                      max={1024}
                      value={imageGenerationSize}
                      onChange={(event) => {
                        setImageGenerationSize(clamp(Number(event.target.value), 64, 1024));
                        setFinalImagePromptTouched(false);
                      }}
                    />
                  </label>
                  <label className="field">
                    抠图背景
                    <input type="color" value={keyColor} onChange={(event) => {
                      setKeyColor(event.target.value);
                      setFinalImagePromptTouched(false);
                      setFinalVideoPromptTouched(false);
                    }} />
                  </label>
                </div>
                <label className="field">
                  上传图公网 URL
                  <input value={uploadedFirstFramePublicUrl} readOnly />
                </label>
                <label className="field">
                  图片提示词
                  <textarea value={imagePrompt} rows={3} onChange={(event) => {
                    setImagePrompt(event.target.value);
                    setFinalImagePromptTouched(false);
                  }} />
                </label>
                <label className="field">
                  图片提示词约束
                  <textarea value={imagePromptInstructions} rows={3} onChange={(event) => {
                    setImagePromptInstructions(event.target.value);
                    setFinalImagePromptTouched(false);
                  }} />
                </label>
                <label className="field">
                  最终图片提示词
                  <textarea value={finalImagePrompt} rows={4} onChange={(event) => {
                    setFinalImagePrompt(event.target.value);
                    setFinalImagePromptTouched(true);
                  }} />
                </label>
              </>
            )}
          />

          <WorkflowStage
            title="第二段 视频生成"
            status={videoStatus}
            inputTitle="输入预览"
            outputTitle="输出预览"
            input={<ImagePreview alt="视频输入预览" preview={videoInputPreview} emptyLabel="等待首帧输出" />}
            output={<VideoPreview label="视频输出预览" preview={videoOutputPreview} emptyLabel="等待视频结果" />}
            controls={(
              <>
                <div className="control-row">
                  <label className="file-picker">
                    <Upload size={16} /> 上传视频首帧
                    <input
                      aria-label="上传视频首帧"
                      className="visually-hidden"
                      type="file"
                      accept="image/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          handleVideoFirstFrameUpload(file);
                        }
                      }}
                    />
                  </label>
                  <button
                    className="tool-button primary"
                    type="button"
                    disabled={isSubmittingVideo}
                    onClick={() => void handleSubmitVideo()}
                  >
                    <Play size={16} /> {isSubmittingVideo ? "提交中" : "提交视频任务"}
                  </button>
                  <span className="state-pill">当前模型最短时长：{selectedVideoModel.minDuration} 秒</span>
                  <span className="state-pill">固定 1:1 / 720p / 无音频</span>
                </div>
                <div className="form-grid">
                  <label className="field">
                    视频模型
                    <select aria-label="视频模型" value={videoModel} onChange={(event) => setVideoModel(event.target.value)}>
                      {VIDEO_MODELS.map((model) => (
                        <option key={model.id} value={model.id}>{model.label}</option>
                      ))}
                    </select>
                  </label>
                  <DirectionSelect label="视频视角" value={videoDirection} onChange={(value) => {
                    setVideoDirection(value);
                    setFinalVideoPromptTouched(false);
                  }} />
                  <label className="field">
                    动作模板
                    <select value={actionTemplate} onChange={(event) => {
                      const nextTemplate = event.target.value as keyof typeof ACTION_TEMPLATES;
                      setActionTemplate(nextTemplate);
                      setActionPrompt(ACTION_TEMPLATES[nextTemplate]);
                      setFinalVideoPromptTouched(false);
                    }}>
                      <option value="idle">待机</option>
                      <option value="walk">行走</option>
                      <option value="run">奔跑</option>
                      <option value="jump">跳跃</option>
                      <option value="attack">攻击</option>
                      <option value="hit">受击</option>
                      <option value="defeated">倒地</option>
                      <option value="custom">自定义</option>
                    </select>
                  </label>
                </div>
                <label className="field">
                  动作/模板提示词
                  <textarea value={actionPrompt} rows={3} onChange={(event) => {
                    setActionPrompt(event.target.value);
                    setFinalVideoPromptTouched(false);
                  }} />
                </label>
                <label className="field">
                  最终视频提示词
                  <textarea value={finalVideoPrompt} rows={4} onChange={(event) => {
                    setFinalVideoPrompt(event.target.value);
                    setFinalVideoPromptTouched(true);
                  }} />
                </label>
              </>
            )}
          />

          <WorkflowStage
            title="第三段 帧处理"
            status={frameStatus}
            inputTitle="输入预览"
            outputTitle="输出预览"
            input={<VideoPreview label="帧处理视频输入预览" preview={frameVideoInputPreview} emptyLabel="等待下载视频" />}
            output={(
              <FramePlayer
                activeFrame={activeFrame}
                frames={frames}
                visibleFrameCount={visibleFrames.length}
                isPlaying={isPlayingFrames}
              />
            )}
            controls={(
              <>
                <div className="control-row">
                  <label className="file-picker">
                    <Upload size={16} /> 上传帧处理视频
                    <input
                      aria-label="上传帧处理视频"
                      className="visually-hidden"
                      type="file"
                      accept="video/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          handleFrameVideoUpload(file);
                        }
                      }}
                    />
                  </label>
                  <button
                    className="tool-button primary"
                    type="button"
                    disabled={isProcessingFrames}
                    onClick={() => void handleProcessFrames()}
                  >
                    <Scissors size={16} /> {isProcessingFrames ? "处理中" : "处理视频帧"}
                  </button>
                  <button
                    className="tool-button"
                    type="button"
                    disabled={visibleFrames.length === 0}
                    onClick={() => {
                      setIsPlayingFrames(true);
                      setFrameStatus("播放中");
                    }}
                  >
                    <Play size={16} /> 播放帧动画
                  </button>
                  <button
                    className="tool-button"
                    type="button"
                    disabled={!isPlayingFrames}
                    onClick={() => {
                      setIsPlayingFrames(false);
                      setFrameStatus("已暂停");
                    }}
                  >
                    <Pause size={16} /> 暂停帧动画
                  </button>
                  <button
                    className="tool-button"
                    type="button"
                    onClick={() => {
                      setIsPlayingFrames(false);
                      setActiveFrameIndex(0);
                      setFrameStatus("已停止");
                    }}
                  >
                    <Square size={16} /> 停止帧动画
                  </button>
                </div>
                <div className="form-grid">
                  <label className="field">
                    抽帧数量
                    <input
                      aria-label="抽帧数量"
                      type="number"
                      min={1}
                      max={120}
                      value={frameCount}
                      onChange={(event) => setFrameCount(clamp(Number(event.target.value), 1, 120))}
                    />
                  </label>
                  <label className="field">
                    播放 FPS
                    <input
                      aria-label="播放 FPS"
                      type="number"
                      min={1}
                      max={60}
                      value={fps}
                      onChange={(event) => setFps(clamp(Number(event.target.value), 1, 60))}
                    />
                  </label>
                  <label className="field">
                    抠图容差
                    <input
                      aria-label="抠图容差"
                      type="number"
                      min={0}
                      max={255}
                      value={tolerance}
                      onChange={(event) => setTolerance(clamp(Number(event.target.value), 0, 255))}
                    />
                  </label>
                </div>
              </>
            )}
            footer={(
              <FrameTimeline
                activeFrame={activeFrame}
                frames={frames}
                visibleFrameCount={visibleFrames.length}
                onSelectFrame={handleSelectFrame}
                onToggleFrame={handleToggleFrame}
              />
            )}
          />
        </div>
      </section>
    </main>
  );
}

function WorkflowStage({
  title,
  status,
  inputTitle,
  outputTitle,
  input,
  output,
  controls,
  footer
}: {
  title: string;
  status: string;
  inputTitle: string;
  outputTitle: string;
  input: React.ReactNode;
  output: React.ReactNode;
  controls: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className="workflow-stage">
      <div className="stage-heading">
        <h2>{title}</h2>
        <span>{status}</span>
      </div>
      <div className="stage-media-grid">
        <MediaPane title={inputTitle}>{input}</MediaPane>
        <MediaPane title={outputTitle}>{output}</MediaPane>
      </div>
      <div className="stage-controls">{controls}</div>
      {footer ? <div className="stage-footer">{footer}</div> : null}
    </section>
  );
}

function MediaPane({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="media-pane">
      <div className="media-pane-title">{title}</div>
      <div className="media-box">{children}</div>
    </section>
  );
}

function ImagePreview({ alt, preview, emptyLabel }: { alt: string; preview: MediaPreview | null; emptyLabel: string }) {
  const [failedUrl, setFailedUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    setFailedUrl(undefined);
  }, [preview?.url]);
  if (!preview) {
    return <EmptyMedia label={emptyLabel} />;
  }
  if (failedUrl === preview.url) {
    return <EmptyMedia label="预览加载失败" />;
  }
  return <img alt={alt} src={preview.url} onError={() => setFailedUrl(preview.url)} />;
}

function VideoPreview({ label, preview, emptyLabel }: { label: string; preview: MediaPreview | null; emptyLabel: string }) {
  if (!preview) {
    return <EmptyMedia label={emptyLabel} />;
  }
  return <video aria-label={label} controls src={preview.url} />;
}

function EmptyMedia({ label }: { label: string }) {
  return (
    <div className="media-empty">
      <Film size={30} />
      <span>{label}</span>
    </div>
  );
}

function FramePlayer({
  activeFrame,
  frames,
  visibleFrameCount,
  isPlaying
}: {
  activeFrame: FramePreview | undefined;
  frames: readonly FramePreview[];
  visibleFrameCount: number;
  isPlaying: boolean;
}) {
  return (
    <div className="frame-player">
      <div className="frame-player-screen">
        {activeFrame ? <img alt={`第 ${activeFrame.index} 帧`} src={activeFrame.url} /> : <EmptyMedia label="等待帧输出" />}
        {activeFrame ? (
          <span className="frame-current-badge">
            当前帧：{activeFrame.index} / {frames.length} · 可播放 {visibleFrameCount}
          </span>
        ) : null}
        {frames.length > 0 ? <span className="playback-badge">{isPlaying ? "播放中" : "已停止"}</span> : null}
      </div>
    </div>
  );
}

function FrameTimeline({
  activeFrame,
  frames,
  visibleFrameCount,
  onSelectFrame,
  onToggleFrame
}: {
  activeFrame: FramePreview | undefined;
  frames: readonly FramePreview[];
  visibleFrameCount: number;
  onSelectFrame: (index: number) => void;
  onToggleFrame: (index: number) => void;
}) {
  if (frames.length === 0) {
    return (
      <section className="frame-timeline" aria-label="帧时间轴">
        <div className="frame-timeline-header">
          <strong>帧时间轴</strong>
          <span>等待帧输出</span>
        </div>
      </section>
    );
  }

  return (
    <section className="frame-timeline" aria-label="帧时间轴">
      <div className="frame-timeline-header">
        <strong>帧时间轴</strong>
        <span>当前帧：{activeFrame?.index ?? "-"} / {frames.length}</span>
        <span>可播放：{visibleFrameCount}</span>
      </div>
      <div className="frame-thumb-strip">
        {frames.map((frame) => (
          <div
            key={frame.index}
            className={[
              "frame-thumb-card",
              frame.hidden ? "frame-thumb-hidden" : "",
              activeFrame?.index === frame.index ? "frame-thumb-selected" : ""
            ].filter(Boolean).join(" ")}
          >
            <button
              className="frame-select-button"
              type="button"
              aria-label={`选择第 ${frame.index} 帧`}
              disabled={frame.hidden}
              onClick={() => onSelectFrame(frame.index)}
            >
              <img alt="" src={frame.url} />
              <span>{String(frame.index).padStart(2, "0")}</span>
            </button>
            <button
              className="frame-visibility-button"
              type="button"
              aria-label={`${frame.hidden ? "恢复" : "屏蔽"}第 ${frame.index} 帧`}
              onClick={() => onToggleFrame(frame.index)}
            >
              {frame.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function DirectionSelect({
  label,
  value,
  onChange
}: {
  label: string;
  value: CharacterDirection;
  onChange: (value: CharacterDirection) => void;
}) {
  return (
    <label className="field">
      {label}
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value as CharacterDirection)}>
        {CHARACTER_DIRECTIONS.map((item) => (
          <option key={item} value={item}>{CHARACTER_DIRECTION_LABELS[item]}</option>
        ))}
      </select>
    </label>
  );
}

function loadDraft(defaultKeys: SavedAnimationKeys): SpriteAnimatorDraft {
  const fallback = buildDefaultDraft(defaultKeys);
  const storedDraft = readStoredDraft();
  if (!storedDraft) {
    return fallback;
  }
  try {
    const draft = {
      ...fallback,
      ...JSON.parse(storedDraft.raw)
    };
    return normalizeDraft(draft, fallback, storedDraft.isLegacy);
  } catch {
    return fallback;
  }
}

function readStoredDraft(): { raw: string; isLegacy: boolean } | null {
  const current = localStorage.getItem(DRAFT_STORAGE_KEY);
  if (current) {
    return { raw: current, isLegacy: false };
  }
  const legacy = localStorage.getItem(LEGACY_DRAFT_STORAGE_KEY);
  return legacy ? { raw: legacy, isLegacy: true } : null;
}

function normalizeDraft(
  draft: SpriteAnimatorDraft,
  fallback: SpriteAnimatorDraft,
  isLegacy: boolean
): SpriteAnimatorDraft {
  const next = { ...draft };
  if (isLegacy && next.imageModel === LEGACY_SEEDREAM_IMAGE_MODEL) {
    next.imageModel = DEFAULT_IMAGE_MODEL;
  }
  if (!isKnownImageModel(next.imageModel)) {
    next.imageModel = fallback.imageModel;
  }
  return next;
}

function isKnownImageModel(model: string): boolean {
  return IMAGE_MODELS.some((item) => item.id === model);
}

function buildDefaultDraft(defaultKeys: SavedAnimationKeys): SpriteAnimatorDraft {
  const base: SpriteAnimatorDraft = {
    openRouterApiKey: "",
    imageModel: DEFAULT_IMAGE_MODEL,
    videoModel: "bytedance/seedance-2.0",
    keyColor: "#00ff00",
    direction: "front",
    videoDirection: "front",
    imageGenerationSize: defaultKeys.targetSize,
    imagePrompt: DEFAULT_IMAGE_PROMPT,
    imagePromptInstructions: DEFAULT_IMAGE_PROMPT_INSTRUCTIONS,
    finalImagePrompt: "",
    finalImagePromptTouched: false,
    actionTemplate: "run",
    actionPrompt: ACTION_TEMPLATES.run,
    finalVideoPrompt: "",
    finalVideoPromptTouched: false,
    frameCount: 12,
    fps: defaultKeys.fps,
    tolerance: 8
  };
  return {
    ...base,
    finalImagePrompt: buildFirstFramePrompt({
      imagePrompt: base.imagePrompt,
      imagePromptInstructions: base.imagePromptInstructions,
      imageGenerationSize: base.imageGenerationSize,
      direction: base.direction,
      keyColor: base.keyColor
    }),
    finalVideoPrompt: buildVideoPrompt({
      direction: base.videoDirection,
      actionPrompt: base.actionPrompt,
      keyColor: base.keyColor
    })
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
  ].filter(Boolean).join(" ");
}

function buildVideoPrompt(input: {
  direction: CharacterDirection;
  actionPrompt: string;
  keyColor: string;
}): string {
  return [
    "单个2D游戏角色",
    "全身居中",
    "镜头固定",
    `视角：${CHARACTER_DIRECTION_LABELS[input.direction]}`,
    input.actionPrompt,
    `纯色 ${input.keyColor} 背景`,
    "无阴影、无地面、无粒子、无文字",
    "循环精灵动画风格"
  ].filter((part) => part.trim().length > 0).join("，");
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extractJobId(response: unknown): string | undefined {
  return findStringValue(response, ["id", "job_id", "jobId"]);
}

function extractImageUrl(response: unknown): string | undefined {
  return findStringValue(response, ["imageUrl", "image_url", "publicUrl", "url"]);
}

function extractPublicUrl(response: unknown): string | undefined {
  return findStringValue(response, ["publicUrl"]);
}

function extractFileName(response: unknown): string | undefined {
  return findStringValue(response, ["fileName", "filename", "storedName"]);
}

function findStringValue(value: unknown, keys: readonly string[]): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const item = record[key];
    if (typeof item === "string" && item.trim().length > 0) {
      return item;
    }
  }
  for (const item of Object.values(record)) {
    if (Array.isArray(item)) {
      for (const child of item) {
        const found = findStringValue(child, keys);
        if (found) {
          return found;
        }
      }
    } else if (item && typeof item === "object") {
      const found = findStringValue(item, keys);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

function isPublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      return false;
    }
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "::1" || host.startsWith("127.")) {
      return false;
    }
    if (host.startsWith("10.") || host.startsWith("192.168.")) {
      return false;
    }
    const parts = host.split(".").map((part) => Number(part));
    const [first, second] = parts;
    return !(parts.length === 4 && first === 172 && second !== undefined && second >= 16 && second <= 31);
  } catch {
    return false;
  }
}

function appendCacheBust(url: string, version: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`;
}
