import {
  ArrowLeft,
  Download,
  Eye,
  EyeOff,
  Film,
  Gamepad2,
  Pause,
  Play,
  RotateCcw,
  Save,
  Scissors,
  Settings,
  Square,
  Trash2,
  Upload,
  WandSparkles
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProviderModelCatalog, SavedAnimationKeys } from "@ai-game-workbench/core";
import {
  createOneClickCharacterJob,
  createAdvancedActionMidframeGeneration,
  createGodotExport,
  createDirectionTemplateGeneration,
  createCharacter,
  deleteCharacter,
  createFirstFrameGeneration,
  createVideoGeneration,
  getCharacterAssets,
  getOneClickCharacterJob,
  getModule01WorkflowConfig,
  getProviderModelCatalog,
  getVideoGenerationStatus,
  listCharacters,
  prepareAdvancedActionStartFrame,
  processAdvancedActionVideo,
  processFourDirectionVideo,
  processIdleFourDirection,
  saveModule01WorkflowConfig,
  toAbsoluteApiUrl,
  uploadFrameVideoAsset,
  uploadFirstFrameAsset,
  uploadModule01ReferenceImage
} from "../api/client";
import type {
  CharacterFolder,
  CharacterAssetFile,
  AdvancedActionAssets,
  AdvancedActionKind,
  DirectionProcessingResult,
  Module01ReferenceImageKind,
  ProcessFourDirectionResult,
  ProcessedFrame,
  GodotExportResult,
  OneClickCharacterJob
} from "../api/client";
import {
  Module01ActionSection,
  Module01AdvancedDetails,
  Module01MediaGrid,
  Module01PageStage
} from "./module01/Module01Stage";
import { Module01Settings } from "./module01/Module01Settings";
import { MODULE01_NAV_ITEMS, MODULE01_PAGE_LABELS, type Module01Page } from "./module01/module01Model";

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

interface AdvancedActionState {
  keyframePreview: MediaPreview | null;
  inputPreview: MediaPreview | null;
  outputPreview: MediaPreview | null;
  middleFramePreview: MediaPreview | null;
  jobId: string;
  result: ProcessFourDirectionResult | null;
  status: string;
  statusDetails: string;
  isGeneratingKeyframe: boolean;
  isGeneratingMidframe: boolean;
  isPreparingInput: boolean;
  isSubmittingVideo: boolean;
  isProcessing: boolean;
}

type PreviewDirection = DirectionProcessingResult["key"];
type CharacterPreviewBackgroundMode = "map-1" | "map-2" | "grid";

interface CharacterPreviewSettings {
  idleFps: number;
  walkFps: number;
  runFps: number;
  attackFps: number;
  jumpFps: number;
  previewSize: number;
  moveSpeed: number;
  backgroundMode: CharacterPreviewBackgroundMode;
  showGuides: boolean;
  showCellBounds: boolean;
}

interface SpriteAnimatorDraft {
  openRouterApiKey: string;
  imageModel: string;
  videoModel: string;
  keyColor: string;
  videoDurationSeconds: number;
  videoResolution: string;
  imageGenerationSize: number;
  imageStyle: string;
  imageSystemPrompt: string;
  imageCustomPrompt: string;
  finalImagePrompt: string;
  directionImageModel: string;
  directionImageGenerationSize: number;
  directionIdleSystemPrompt: string;
  directionIdleCustomPrompt: string;
  finalDirectionIdlePrompt: string;
  directionWalkSystemPrompt: string;
  directionWalkCustomPrompt: string;
  finalDirectionWalkPrompt: string;
  videoSystemPrompt: string;
  videoCustomPrompt: string;
  finalVideoPrompt: string;
  advancedRunSystemPrompt: string;
  advancedRunCustomPrompt: string;
  finalAdvancedRunPrompt: string;
  advancedRunVideoSystemPrompt: string;
  advancedRunVideoCustomPrompt: string;
  finalAdvancedRunVideoPrompt: string;
  advancedAttackSystemPrompt: string;
  advancedAttackCustomPrompt: string;
  finalAdvancedAttackPrompt: string;
  advancedAttackMidframeCustomPrompt: string;
  advancedAttackStartScale: number;
  advancedJumpSystemPrompt: string;
  advancedJumpCustomPrompt: string;
  finalAdvancedJumpPrompt: string;
  advancedJumpStartScale: number;
  frameCount: number;
  fps: number;
  tolerance: number;
  minLoopFrames: number;
  maxLoopFrames: number;
  exportFrameSize: number;
}

type BackendWorkflowDraft = Omit<SpriteAnimatorDraft, "openRouterApiKey"> & {
  characterPreviewSettings?: CharacterPreviewSettings;
};

const DRAFT_STORAGE_KEY = "ai-game-workbench.sprite-animator.workflow.v5";
const ACTIVE_CHARACTER_STORAGE_KEY = "ai-game-workbench.sprite-animator.active-character";
const CHARACTER_PREVIEW_SETTINGS_STORAGE_KEY = "ai-game-workbench.sprite-animator.character-preview.v1";
const LEGACY_DRAFT_STORAGE_KEYS = [
  "ai-game-workbench.sprite-animator.workflow.v4",
  "ai-game-workbench.sprite-animator.workflow.v3",
  "ai-game-workbench.sprite-animator.workflow.v2"
];
const FIXED_PUBLIC_ASSET_BASE_URL = "https://darn-skittle-unwoven.ngrok-free.dev";
const BUILT_IN_STYLE_REFERENCE_URL = "/style-references/cel-anime-south-facing.png";
const BUILT_IN_WALK_REFERENCE_URL = "/direction-references/walk-4dir.png";
const BUILT_IN_IDLE_REFERENCE_URL = "/direction-references/idle-4dir.png";
const BUILT_IN_RUN_REFERENCE_URL = "/direction-references/run-4dir.png";
const PREVIEW_GAME_MAP_1_URL = "/preview-maps/game-map-1.png";
const PREVIEW_GAME_MAP_2_URL = "/preview-maps/game-map-2.png";
const DEFAULT_EXPORT_FRAME_SIZE = 1024;
const DEFAULT_CHROMA_KEY_TOLERANCE = 255;
const DEFAULT_ATTACK_START_SCALE = 0.74;
const DEFAULT_JUMP_START_SCALE = 0.78;
const LOCAL_CODEX_IMAGE_MODEL = "local/gpt-image-2";
const APIMART_IMAGE_MODEL = "apimart/gpt-image-2";
interface ImageGenerationSizeOption {
  size: number;
  label: string;
}

interface ImageModelOption {
  id: string;
  label: string;
  sizeOptions: readonly ImageGenerationSizeOption[];
}

const IMAGE_MODELS = [
  {
    id: APIMART_IMAGE_MODEL,
    label: "APIMart GPT-Image-2",
    sizeOptions: [
      { size: 1024, label: "1024 x 1024 (1K)" },
      { size: 2048, label: "2048 x 2048 (2K)" },
      { size: 2880, label: "2880 x 2880 (4K)" }
    ]
  },
  {
    id: LOCAL_CODEX_IMAGE_MODEL,
    label: "local GPT image2",
    sizeOptions: [
      { size: 1024, label: "1024 x 1024" },
      { size: 2048, label: "2048 x 2048" },
      { size: 2880, label: "2880 x 2880" }
    ]
  },
  {
    id: "google/gemini-3.1-flash-image-preview",
    label: "Nano Banana 2 (google/gemini-3.1-flash-image-preview)",
    sizeOptions: [
      { size: 512, label: "512 x 512 (0.5K)" },
      { size: 1024, label: "1024 x 1024 (1K)" },
      { size: 2048, label: "2048 x 2048 (2K)" },
      { size: 4096, label: "4096 x 4096 (4K)" }
    ]
  }
] satisfies readonly ImageModelOption[];
const DEFAULT_IMAGE_MODEL = APIMART_IMAGE_MODEL;
const IMAGE_STYLES = [
  {
    id: "cel-anime",
    label: "赛璐璐风格"
  }
] as const;
const DEFAULT_IMAGE_STYLE = IMAGE_STYLES[0].id;
const DEFAULT_IMAGE_SYSTEM_PROMPT = [
  "使用第一张图作为画风、镜头、角色比例、朝向和构图参考，不复制参考图A中的角色身份、服装和具体设计：高清2D游戏角色精灵，斜俯视3/4正交镜头，下方向 / south-facing，角色居中，全身，纯色抠图背景。",
  "使用第二张图作为角色身份参考：保留角色的发型、长相、服装配色、主要装饰和整体辨识度，不保留原图姿势、镜头和构图。",
  "重新绘制一张新的高清2D游戏角色首帧：下方向走路循环第一帧。纯色 #00ff00 背景，无地面、无阴影、无文字、无UI、无特效。"
].join("\n\n");
const DEFAULT_IMAGE_CUSTOM_PROMPT = "";
const DEFAULT_DIRECTION_IDLE_SYSTEM_PROMPT = [
  "使用第一张图作为角色四方向步行参考图。",
  "严格保留第一张图中四个方向角色的身份、发型、长相、服装、配色、装饰、角色大小、镜头角度、站位、2x2 排布和整体辨识度。",
  "参考第二张图的四方向待机格式。",
  "第二张图只参考待机站立动作状态，不要复制第二张图里的角色身份、服装和具体设计。",
  "将第一张图中的四个方向角色分别改绘为待机站立状态，生成一张高清 2D 游戏角色四方向待机精灵图，纯色 #00ff00 背景。",
  "2x2 排布必须保持不变：\n左上：面朝下\n右上：面朝上\n左下：面朝左\n右下：面朝右",
  "动作状态：待机站立。",
  "四个方向角色大小一致，位置与第一张图对应方向对齐。",
  "不要改变角色比例，不要改变服装细节，不要改变四宫格位置。",
  "无地面、无阴影、无文字、无UI、无特效。"
].join("\n\n");
const DEFAULT_DIRECTION_WALK_SYSTEM_PROMPT = [
  "使用第一张图中的角色作为角色参考，保留角色的发型、长相、服装、配色、装饰和整体辨识度。",
  "参考第二张图的四方向游戏精灵格式，做四方向图。",
  "第二张图只参考朝向、镜头角度、角色比例、角色大小、站位、2x2 排布和动作状态，不要复制第二张图里的角色身份和服装。",
  "生成一张高清 2D 游戏角色四方向精灵图，纯色 #00ff00 背景。",
  "2x2 排布：\n左上：面朝下\n右上：面朝上\n左下：面朝左\n右下：面朝右",
  "动作状态：步行循环关键帧。\n四个方向角色大小一致，位置对齐，迈步幅度和动作节奏一致，适合后续生成四方向步行动画。"
].join("\n\n");
const DEFAULT_DIRECTION_CUSTOM_PROMPT = "";
const DEFAULT_VIDEO_SYSTEM_PROMPT = [
  "参考输入图像中的 2x2 四宫格角色，保持四宫格布局不变，每个格子里的角色都独立做原地走路循环动画。",
  "左上角色保持朝正面方向行走，右上角色保持背面方向行走，左下角色保持朝左侧方向行走，右下角色保持右侧方向行走。",
  "动画要求：2D 游戏精灵帧，角色全身可见，角色位置固定在各自格子中心，不要跨出格子，不要改变角色服装、发型、颜色、比例和轮廓。动作是自然的 walk cycle，双腿交替迈步，双手自然摆动，身体轻微上下起伏，适合拆成游戏精灵帧。",
  "画面要求：固定镜头，正交视角，无镜头移动，无缩放，无旋转，无景深。保持纯绿色抠图背景，背景不要变化，不要阴影，不要地面，不要文字，不要特效。整体动作平滑、可循环、适合后续拆帧和抠图。"
].join("\n\n");
const DEFAULT_VIDEO_CUSTOM_PROMPT = "";
const DEFAULT_ADVANCED_RUN_SYSTEM_PROMPT = [
  "使用第一张图作为角色四方向步行基准图，保持角色身份、发型、服装、配色、装饰、角色比例、2x2 排布和四个方向位置。",
  "参考第二张图的跑步四方向游戏精灵格式，只参考跑步动作状态、步幅节奏、镜头角度和角色大小，不复制第二张图里的角色身份和服装。",
  "生成一张高清 2D 游戏角色四方向跑步首帧图，纯色 #00ff00 背景。",
  "2x2 排布保持不变：左上面朝下，右上面朝上，左下面朝左，右下面朝右。四个方向角色大小一致，位置对齐。"
].join("\n\n");
const DEFAULT_ADVANCED_RUN_CUSTOM_PROMPT = "";
const DEFAULT_ADVANCED_RUN_VIDEO_SYSTEM_PROMPT = [
  "参考输入图像中的 2x2 四宫格跑步首帧，保持四宫格布局不变，每个格子里的角色都独立做原地跑步循环动画。",
  "左上角色保持面朝下方向跑步，右上角色保持面朝上方向跑步，左下角色保持面朝左方向跑步，右下角色保持面朝右方向跑步。",
  "动画要求：2D 游戏精灵帧，角色全身可见，角色位置固定在各自格子中心，不要跨出格子，不要改变角色服装、发型、颜色、比例和轮廓。动作是自然的 run cycle，双腿快速交替迈步，双臂自然摆动，身体轻微上下起伏，适合拆成游戏精灵帧。",
  "画面要求：固定镜头，正交视角，无镜头移动，无缩放，无旋转，无景深。保持纯绿色抠图背景，背景不要变化，不要阴影，不要地面，不要文字，不要特效。整体动作平滑、可循环、适合后续拆帧和抠图。"
].join("\n\n");
const DEFAULT_ADVANCED_RUN_VIDEO_CUSTOM_PROMPT = "";
const DEFAULT_ADVANCED_ATTACK_SYSTEM_PROMPT = [
  "输入参考图顺序：第一张是 @首帧，同时也是 @尾帧；第二张是 @攻击中间帧。",
  "参考 @首帧 的角色姿势、四宫格布局、角色大小、朝向和站位。攻击动作必须从 @首帧 的待机姿势开始，并在动作结束后回到 @尾帧 的待机姿势。",
  "参考 @攻击中间帧 的攻击姿势、武器方向、动作力度和身体摆动。@攻击中间帧 必须影响动画中段动作，不要忽略它；但不要复制参考图中的角色身份、服装或其他无关细节。",
  "生成同一个角色的四方向攻击动画视频。四宫格布局保持不变，每个象限里的角色独立完成同一个攻击动作：\n左上：面朝下，向画面下方攻击。\n右上：面朝上，向画面上方攻击。\n左下：面朝左，向画面左方攻击。\n右下：面朝右，向画面右方攻击。",
  "动作流程：\n从首帧待机姿势开始；\n迅速进入攻击预备；\n在中段达到 @攻击中间帧 的攻击姿势；\n完成攻击后收回武器；\n最后回到 @尾帧 待机姿势，并保持待机直到视频结束。",
  "要求：\n固定镜头，正交视角，无镜头移动，无缩放，无旋转。\n保持纯绿色 #00ff00 背景不变。\n角色不要跨出各自象限。\n不要改变角色发型、服装、配色、比例和轮廓。\n不要生成地面、阴影、文字、UI、特效。\n动作节奏四个方向一致，力度一致，适合后续拆成 2D 游戏精灵帧。"
].join("\n\n");
const DEFAULT_ADVANCED_ATTACK_CUSTOM_PROMPT = "";
const DEFAULT_ADVANCED_ATTACK_MIDFRAME_CUSTOM_PROMPT = "";
const DEFAULT_ADVANCED_JUMP_SYSTEM_PROMPT = [
  "参考输入图像中的 2x2 四宫格角色，以四个方向的待机姿态作为原地跳跃起始帧。",
  "每个格子里的角色都独立做原地跳跃四方向，动作开始于待机，起跳、滞空、落地后回到待机姿态，适合裁剪为一次性动作序列。",
  "角色保持在各自格子中心，不跨出格子，不改变角色服装、发型、颜色、比例和轮廓。",
  "固定镜头，正交视角，无镜头移动，无缩放，无旋转。保持纯绿色抠图背景，无地面、无阴影、无文字、无UI、无特效。"
].join("\n\n");
const DEFAULT_ADVANCED_JUMP_CUSTOM_PROMPT = "";

interface VideoModelOption {
  id: string;
  label: string;
  durationOptions: readonly number[];
  defaultDurationSeconds: number;
  resolutionOptions: readonly string[];
  defaultResolution: string;
}

function rangeInclusive(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

const VIDEO_MODELS = [
  {
    id: "bytedance/seedance-2.0",
    label: "Seedance 2.0",
    durationOptions: rangeInclusive(4, 15),
    defaultDurationSeconds: 4,
    resolutionOptions: ["480p", "720p", "1080p"],
    defaultResolution: "720p"
  }
] satisfies readonly VideoModelOption[];
const DEFAULT_VIDEO_MODEL = "bytedance/seedance-2.0";
const FPS_MAX = 300;
const GODOT_EXPORT_SIZE_OPTIONS = [256, 384, 512, 1024] as const;
type GodotExportSize = (typeof GODOT_EXPORT_SIZE_OPTIONS)[number];

const PREVIEW_DIRECTION_ORDER = ["down", "up", "left", "right"] as const satisfies readonly PreviewDirection[];
const PREVIEW_DIRECTION_LABELS: Record<PreviewDirection, string> = {
  down: "下",
  up: "上",
  left: "左",
  right: "右"
};
const PREVIEW_KEY_TO_DIRECTION: Record<string, PreviewDirection> = {
  s: "down",
  w: "up",
  a: "left",
  d: "right"
};
const PREVIEW_DIRECTION_VECTORS: Record<PreviewDirection, { x: number; y: number }> = {
  down: { x: 0, y: 1 },
  up: { x: 0, y: -1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
};
const DEFAULT_CHARACTER_PREVIEW_SETTINGS = {
  idleFps: 12,
  walkFps: 30,
  runFps: 30,
  attackFps: 30,
  jumpFps: 30,
  previewSize: 160,
  moveSpeed: 120,
  backgroundMode: "map-1" as CharacterPreviewBackgroundMode,
  showGuides: true,
  showCellBounds: false
} satisfies CharacterPreviewSettings;

const REFERENCE_IMAGE_LABELS: Record<Module01ReferenceImageKind, string> = {
  style: "赛璐璐画风参考图",
  walk: "步行参考图",
  idle: "待机参考图",
  run: "跑步参考图"
};

export function SpriteAnimator({ defaultKeys, onBack }: SpriteAnimatorProps) {
  const savedDraft = loadDraft(defaultKeys);
  const [activePage, setActivePage] = useState<Module01Page>("base-template");
  const openRouterApiKey = "";
  const [providerModelCatalog, setProviderModelCatalog] = useState<ProviderModelCatalog | null>(null);
  const [imageModel, setImageModel] = useState(savedDraft.imageModel);
  const [videoModel, setVideoModel] = useState(savedDraft.videoModel);
  const [keyColor, setKeyColor] = useState(savedDraft.keyColor);
  const [videoDurationSeconds, setVideoDurationSeconds] = useState(savedDraft.videoDurationSeconds);
  const [videoResolution, setVideoResolution] = useState(savedDraft.videoResolution);
  const [imageGenerationSize, setImageGenerationSize] = useState(savedDraft.imageGenerationSize);
  const [imageStyle, setImageStyle] = useState(savedDraft.imageStyle);
  const [imageSystemPrompt, setImageSystemPrompt] = useState(savedDraft.imageSystemPrompt);
  const [imageCustomPrompt, setImageCustomPrompt] = useState(savedDraft.imageCustomPrompt);
  const [finalImagePrompt, setFinalImagePrompt] = useState(savedDraft.finalImagePrompt);
  const [directionImageModel, setDirectionImageModel] = useState(savedDraft.directionImageModel);
  const [directionImageGenerationSize, setDirectionImageGenerationSize] = useState(savedDraft.directionImageGenerationSize);
  const [directionIdleSystemPrompt, setDirectionIdleSystemPrompt] = useState(savedDraft.directionIdleSystemPrompt);
  const [directionIdleCustomPrompt, setDirectionIdleCustomPrompt] = useState(savedDraft.directionIdleCustomPrompt);
  const [finalDirectionIdlePrompt, setFinalDirectionIdlePrompt] = useState(savedDraft.finalDirectionIdlePrompt);
  const [directionWalkSystemPrompt, setDirectionWalkSystemPrompt] = useState(savedDraft.directionWalkSystemPrompt);
  const [directionWalkCustomPrompt, setDirectionWalkCustomPrompt] = useState(savedDraft.directionWalkCustomPrompt);
  const [finalDirectionWalkPrompt, setFinalDirectionWalkPrompt] = useState(savedDraft.finalDirectionWalkPrompt);
  const [videoSystemPrompt, setVideoSystemPrompt] = useState(savedDraft.videoSystemPrompt);
  const [videoCustomPrompt, setVideoCustomPrompt] = useState(savedDraft.videoCustomPrompt);
  const [finalVideoPrompt, setFinalVideoPrompt] = useState(savedDraft.finalVideoPrompt);
  const [advancedRunSystemPrompt, setAdvancedRunSystemPrompt] = useState(savedDraft.advancedRunSystemPrompt);
  const [advancedRunCustomPrompt, setAdvancedRunCustomPrompt] = useState(savedDraft.advancedRunCustomPrompt);
  const [finalAdvancedRunPrompt, setFinalAdvancedRunPrompt] = useState(savedDraft.finalAdvancedRunPrompt);
  const [advancedRunVideoSystemPrompt, setAdvancedRunVideoSystemPrompt] = useState(savedDraft.advancedRunVideoSystemPrompt);
  const [advancedRunVideoCustomPrompt, setAdvancedRunVideoCustomPrompt] = useState(savedDraft.advancedRunVideoCustomPrompt);
  const [finalAdvancedRunVideoPrompt, setFinalAdvancedRunVideoPrompt] = useState(savedDraft.finalAdvancedRunVideoPrompt);
  const [advancedAttackSystemPrompt, setAdvancedAttackSystemPrompt] = useState(savedDraft.advancedAttackSystemPrompt);
  const [advancedAttackCustomPrompt, setAdvancedAttackCustomPrompt] = useState(savedDraft.advancedAttackCustomPrompt);
  const [finalAdvancedAttackPrompt, setFinalAdvancedAttackPrompt] = useState(savedDraft.finalAdvancedAttackPrompt);
  const [advancedAttackMidframeCustomPrompt, setAdvancedAttackMidframeCustomPrompt] = useState(savedDraft.advancedAttackMidframeCustomPrompt);
  const [advancedAttackStartScale, setAdvancedAttackStartScale] = useState(savedDraft.advancedAttackStartScale);
  const [advancedJumpSystemPrompt, setAdvancedJumpSystemPrompt] = useState(savedDraft.advancedJumpSystemPrompt);
  const [advancedJumpCustomPrompt, setAdvancedJumpCustomPrompt] = useState(savedDraft.advancedJumpCustomPrompt);
  const [finalAdvancedJumpPrompt, setFinalAdvancedJumpPrompt] = useState(savedDraft.finalAdvancedJumpPrompt);
  const [advancedJumpStartScale, setAdvancedJumpStartScale] = useState(savedDraft.advancedJumpStartScale);
  const [frameCount, setFrameCount] = useState(savedDraft.frameCount);
  const [fps, setFps] = useState(savedDraft.fps);
  const [tolerance, setTolerance] = useState(savedDraft.tolerance);
  const [minLoopFrames, setMinLoopFrames] = useState(savedDraft.minLoopFrames);
  const [maxLoopFrames, setMaxLoopFrames] = useState(savedDraft.maxLoopFrames);
  const [exportFrameSize, setExportFrameSize] = useState(savedDraft.exportFrameSize);

  const [characterReferenceFile, setCharacterReferenceFile] = useState<File | null>(null);
  const [directionBaseTemplateFile, setDirectionBaseTemplateFile] = useState<File | null>(null);
  const [characterReferencePreview, setCharacterReferencePreview] = useState<MediaPreview | null>(null);
  const [oneClickCharacterName, setOneClickCharacterName] = useState("");
  const [oneClickReferenceFile, setOneClickReferenceFile] = useState<File | null>(null);
  const [oneClickReferencePreview, setOneClickReferencePreview] = useState<MediaPreview | null>(null);
  const [oneClickIncludeRun, setOneClickIncludeRun] = useState(false);
  const [oneClickIncludeAttack, setOneClickIncludeAttack] = useState(false);
  const [oneClickIncludeJump, setOneClickIncludeJump] = useState(false);
  const [oneClickJob, setOneClickJob] = useState<OneClickCharacterJob | null>(null);
  const [oneClickStatus, setOneClickStatus] = useState("等待输入角色名和角色参考图。");
  const [isStartingOneClick, setIsStartingOneClick] = useState(false);
  const [uploadedCharacterReferencePublicUrl, setUploadedCharacterReferencePublicUrl] = useState("");
  const [firstFrameOutputPreview, setFirstFrameOutputPreview] = useState<MediaPreview | null>(null);
  const [directionBaseTemplatePreview, setDirectionBaseTemplatePreview] = useState<MediaPreview | null>(null);
  const [idleDirectionOutputPreview, setIdleDirectionOutputPreview] = useState<MediaPreview | null>(null);
  const [walkDirectionOutputPreview, setWalkDirectionOutputPreview] = useState<MediaPreview | null>(null);
  const [videoInputPreview, setVideoInputPreview] = useState<MediaPreview | null>(null);
  const [videoOutputPreview, setVideoOutputPreview] = useState<MediaPreview | null>(null);
  const [frameVideoInputPreview, setFrameVideoInputPreview] = useState<MediaPreview | null>(null);
  const [videoJobId, setVideoJobId] = useState("");
  const [frames, setFrames] = useState<FramePreview[]>([]);
  const [fourDirectionResult, setFourDirectionResult] = useState<ProcessFourDirectionResult | null>(null);
  const [advancedActions, setAdvancedActions] = useState<Record<AdvancedActionKind, AdvancedActionState>>(() => ({
    run: buildInitialAdvancedActionState("等待步行图片，可先生成跑步首帧。"),
    "attack-1": buildInitialAdvancedActionState("等待待机处理结果，可准备攻击起始帧。"),
    jump: buildInitialAdvancedActionState("等待待机处理结果，可准备跳跃起始帧。")
  }));
  const [activeFrameIndex, setActiveFrameIndex] = useState(0);
  const [characters, setCharacters] = useState<CharacterFolder[]>([]);
  const [activeCharacterId, setActiveCharacterId] = useState(() => localStorage.getItem(ACTIVE_CHARACTER_STORAGE_KEY) ?? "");
  const [newCharacterName, setNewCharacterName] = useState("");
  const [characterStatus, setCharacterStatus] = useState(() => {
    const stored = localStorage.getItem(ACTIVE_CHARACTER_STORAGE_KEY);
    return stored ? `当前角色：${stored}` : "请先创建或选择角色文件夹。";
  });
  const [isProcessingFirstFrame, setIsProcessingFirstFrame] = useState(false);
  const [isCreatingCharacter, setIsCreatingCharacter] = useState(false);
  const [deletingCharacterId, setDeletingCharacterId] = useState("");
  const [processingDirectionTemplate, setProcessingDirectionTemplate] = useState<"idle" | "walk" | null>(null);
  const [isSubmittingVideo, setIsSubmittingVideo] = useState(false);
  const [isProcessingFrames, setIsProcessingFrames] = useState(false);
  const [isPlayingFrames, setIsPlayingFrames] = useState(false);
  const [firstFrameStatus, setFirstFrameStatus] = useState("等待角色参考图或直接生成基准模板。");
  const [referenceSettingsStatus, setReferenceSettingsStatus] = useState("上传参考图后会全局覆盖，并影响所有角色后续生成。");
  const [directionTemplateStatus, setDirectionTemplateStatus] = useState("等待角色基准模板。先生成步行 2x2，再基于步行图生成待机 2x2。");
  const [videoStatus, setVideoStatus] = useState("等待步行图片，或直接上传 2x2 步行图。");
  const [videoStatusDetails, setVideoStatusDetails] = useState("");
  const [frameStatus, setFrameStatus] = useState("等待视频下载完成。");
  const [godotExportSize, setGodotExportSize] = useState<GodotExportSize>(512);
  const [godotExportResult, setGodotExportResult] = useState<GodotExportResult | null>(null);
  const [godotExportStatus, setGodotExportStatus] = useState("选择导出尺寸后生成 Godot 导出包。");
  const [isExportingGodot, setIsExportingGodot] = useState(false);
  const pollTimeoutRef = useRef<number | undefined>(undefined);
  const oneClickPollTimeoutRef = useRef<number | undefined>(undefined);
  const assetHydrationVersionRef = useRef(0);
  const [referenceImageVersion, setReferenceImageVersion] = useState("");

  const imageModels = useMemo(
    () => providerModelCatalog ? toImageModelOptions(providerModelCatalog) : IMAGE_MODELS,
    [providerModelCatalog]
  );
  const videoModels = useMemo(
    () => providerModelCatalog ? toVideoModelOptions(providerModelCatalog) : VIDEO_MODELS,
    [providerModelCatalog]
  );
  const videoDurationOptions = useMemo(
    () => getVideoDurationOptions(videoModels, videoModel),
    [videoModels, videoModel]
  );
  const videoResolutionOptions = useMemo(
    () => getVideoResolutionOptions(videoModels, videoModel),
    [videoModels, videoModel]
  );
  const imageGenerationSizeOptions = useMemo(
    () => getImageGenerationSizeOptions(imageModels, imageModel),
    [imageModels, imageModel]
  );
  const directionImageGenerationSizeOptions = useMemo(
    () => getImageGenerationSizeOptions(imageModels, directionImageModel),
    [directionImageModel, imageModels]
  );
  const builtInStyleReferencePreview = useMemo<MediaPreview>(() => ({
    name: "cel-anime-south-facing.png",
    url: buildReferenceImageUrl(BUILT_IN_STYLE_REFERENCE_URL, referenceImageVersion, "style")
  }), [referenceImageVersion]);
  const builtInWalkReferencePreview = useMemo<MediaPreview>(() => ({
    name: "walk-4dir.png",
    url: buildReferenceImageUrl(BUILT_IN_WALK_REFERENCE_URL, referenceImageVersion, "walk")
  }), [referenceImageVersion]);
  const builtInIdleReferencePreview = useMemo<MediaPreview>(() => ({
    name: "idle-4dir.png",
    url: buildReferenceImageUrl(BUILT_IN_IDLE_REFERENCE_URL, referenceImageVersion, "idle")
  }), [referenceImageVersion]);
  const builtInRunReferencePreview = useMemo<MediaPreview>(() => ({
    name: "run-4dir.png",
    url: buildReferenceImageUrl(BUILT_IN_RUN_REFERENCE_URL, referenceImageVersion, "run")
  }), [referenceImageVersion]);
  const visibleFrames = frames.filter((frame) => !frame.hidden);
  const activeFrame = visibleFrames[activeFrameIndex % Math.max(visibleFrames.length, 1)];
  const activePreviewFrameCount = getFinalLoopFrameCount(fourDirectionResult) || visibleFrames.length;
  const effectiveDirectionBaseTemplatePreview = directionBaseTemplatePreview ?? firstFrameOutputPreview;
  const currentFinalImagePrompt = buildFirstFramePrompt({
    imageSystemPrompt,
    imageCustomPrompt
  });
  const oneClickProgress = oneClickJob?.progressPercent ?? 0;

  useEffect(() => {
    setImageGenerationSize((currentSize) => normalizeImageGenerationSize(imageModels, imageModel, currentSize));
  }, [imageModel, imageModels]);

  useEffect(() => {
    setDirectionImageGenerationSize((currentSize) => normalizeImageGenerationSize(imageModels, directionImageModel, currentSize));
  }, [directionImageModel, imageModels]);

  useEffect(() => {
    setVideoDurationSeconds((currentDuration) => normalizeVideoDuration(videoModels, videoModel, currentDuration));
    setVideoResolution((currentResolution) => normalizeVideoResolution(videoModels, videoModel, currentResolution));
  }, [videoModel, videoModels]);

  useEffect(() => {
    setFinalImagePrompt(buildFirstFramePrompt({
      imageSystemPrompt,
      imageCustomPrompt
    }));
  }, [imageCustomPrompt, imageSystemPrompt]);

  useEffect(() => {
    setFinalDirectionIdlePrompt(buildFirstFramePrompt({
      imageSystemPrompt: directionIdleSystemPrompt,
      imageCustomPrompt: directionIdleCustomPrompt
    }));
  }, [directionIdleCustomPrompt, directionIdleSystemPrompt]);

  useEffect(() => {
    setFinalDirectionWalkPrompt(buildFirstFramePrompt({
      imageSystemPrompt: directionWalkSystemPrompt,
      imageCustomPrompt: directionWalkCustomPrompt
    }));
  }, [directionWalkCustomPrompt, directionWalkSystemPrompt]);

  useEffect(() => {
    setFinalVideoPrompt(buildVideoPrompt({
      videoSystemPrompt,
      videoCustomPrompt
    }));
  }, [videoCustomPrompt, videoSystemPrompt]);

  useEffect(() => {
    setFinalAdvancedRunPrompt(buildFirstFramePrompt({
      imageSystemPrompt: advancedRunSystemPrompt,
      imageCustomPrompt: advancedRunCustomPrompt
    }));
  }, [advancedRunCustomPrompt, advancedRunSystemPrompt]);

  useEffect(() => {
    setFinalAdvancedRunVideoPrompt(buildVideoPrompt({
      videoSystemPrompt: advancedRunVideoSystemPrompt,
      videoCustomPrompt: advancedRunVideoCustomPrompt
    }));
  }, [advancedRunVideoCustomPrompt, advancedRunVideoSystemPrompt]);

  useEffect(() => {
    setFinalAdvancedAttackPrompt(buildVideoPrompt({
      videoSystemPrompt: advancedAttackSystemPrompt,
      videoCustomPrompt: advancedAttackCustomPrompt
    }));
  }, [advancedAttackCustomPrompt, advancedAttackSystemPrompt]);

  useEffect(() => {
    setFinalAdvancedJumpPrompt(buildVideoPrompt({
      videoSystemPrompt: advancedJumpSystemPrompt,
      videoCustomPrompt: advancedJumpCustomPrompt
    }));
  }, [advancedJumpCustomPrompt, advancedJumpSystemPrompt]);

  useEffect(() => {
    let isCancelled = false;
    void getProviderModelCatalog()
      .then((catalog) => {
        if (isCancelled) {
          return;
        }
        setProviderModelCatalog(catalog);
        setImageModel((current) => catalog.imageModels.some((model) => model.id === current)
          ? current
          : catalog.defaults.imageModelId);
        setDirectionImageModel((current) => catalog.imageModels.some((model) => model.id === current)
          ? current
          : catalog.defaults.imageModelId);
        setVideoModel((current) => catalog.videoModels.some((model) => model.id === current)
          ? current
          : catalog.defaults.videoModelId);
      })
      .catch((error: unknown) => {
        if (!isCancelled) {
          setFirstFrameStatus(`Provider model catalog load failed: ${getErrorMessage(error)}`);
        }
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;
    void getModule01WorkflowConfig()
      .then((config) => {
        if (isCancelled || !config) {
          return;
        }
        if (config.characterPreviewSettings) {
          saveCharacterPreviewSettings(normalizeCharacterPreviewSettings(
            config.characterPreviewSettings,
            loadCharacterPreviewSettings()
          ));
        }
        applyWorkflowDraft(normalizeBackendWorkflowConfig(config, defaultKeys, openRouterApiKey));
      })
      .catch((error: unknown) => {
        if (!isCancelled) {
          setFirstFrameStatus(`后端提示词配置加载失败：${getErrorMessage(error)}`);
        }
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isPlayingFrames || activePreviewFrameCount === 0) {
      return undefined;
    }
    const interval = window.setInterval(() => {
      setActiveFrameIndex((current) => (current + 1) % activePreviewFrameCount);
    }, getPlaybackIntervalMs(fps));
    return () => window.clearInterval(interval);
  }, [activePreviewFrameCount, fps, isPlayingFrames]);

  useEffect(() => {
    if (visibleFrames.length === 0) {
      setIsPlayingFrames(false);
      setActiveFrameIndex(0);
      return;
    }
    setActiveFrameIndex((current) => Math.min(current, visibleFrames.length - 1));
  }, [visibleFrames.length]);

  useEffect(() => {
    setActiveFrameIndex((current) => Math.min(current, Math.max(0, activePreviewFrameCount - 1)));
  }, [activePreviewFrameCount]);

  useEffect(() => {
    void listCharacters()
      .then((items) => {
        setCharacters(items);
        const stored = localStorage.getItem(ACTIVE_CHARACTER_STORAGE_KEY) ?? "";
        const selected = items.find((item) => item.id === stored)?.id ?? items[0]?.id ?? "";
        setActiveCharacterId(selected);
        setCharacterStatus(selected ? `当前角色：${selected}` : "请先创建或选择角色文件夹。");
      })
      .catch((error: unknown) => {
        setCharacterStatus(`角色列表加载失败：${getErrorMessage(error)}`);
      });
  }, []);

  useEffect(() => {
    if (activeCharacterId) {
      localStorage.setItem(ACTIVE_CHARACTER_STORAGE_KEY, activeCharacterId);
    } else {
      localStorage.removeItem(ACTIVE_CHARACTER_STORAGE_KEY);
    }
  }, [activeCharacterId]);

  useEffect(() => {
    return () => {
      if (pollTimeoutRef.current) {
        window.clearTimeout(pollTimeoutRef.current);
      }
      if (oneClickPollTimeoutRef.current) {
        window.clearTimeout(oneClickPollTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (characterReferencePreview?.url.startsWith("blob:")) {
        URL.revokeObjectURL(characterReferencePreview.url);
      }
    };
  }, [characterReferencePreview]);

  useEffect(() => {
    return () => {
      if (oneClickReferencePreview?.url.startsWith("blob:")) {
        URL.revokeObjectURL(oneClickReferencePreview.url);
      }
    };
  }, [oneClickReferencePreview]);

  useEffect(() => {
    return () => {
      if (videoInputPreview?.url.startsWith("blob:")) {
        URL.revokeObjectURL(videoInputPreview.url);
      }
    };
  }, [videoInputPreview]);

  useEffect(() => {
    return () => {
      if (directionBaseTemplatePreview?.url.startsWith("blob:")) {
        URL.revokeObjectURL(directionBaseTemplatePreview.url);
      }
    };
  }, [directionBaseTemplatePreview]);

  useEffect(() => {
    if (!activeCharacterId) {
      clearLoadedCharacterAssets();
      return;
    }
    void hydrateCharacterAssets(activeCharacterId);
  }, [activeCharacterId]);

  const requireCharacter = (setStatus: (message: string) => void): string | undefined => {
    if (activeCharacterId) {
      return activeCharacterId;
    }
    const message = "请先创建或选择角色文件夹。";
    setCharacterStatus(message);
    setStatus(message);
    return undefined;
  };

  const clearLoadedCharacterAssets = () => {
    assetHydrationVersionRef.current += 1;
    setCharacterReferenceFile(null);
    setDirectionBaseTemplateFile(null);
    setCharacterReferencePreview(null);
    setUploadedCharacterReferencePublicUrl("");
    setFirstFrameOutputPreview(null);
    setDirectionBaseTemplatePreview(null);
    setIdleDirectionOutputPreview(null);
    setWalkDirectionOutputPreview(null);
    setVideoInputPreview(null);
    setVideoOutputPreview(null);
    setFrameVideoInputPreview(null);
    setVideoJobId("");
    setVideoStatusDetails("");
    setFrames([]);
    setFourDirectionResult(null);
    setAdvancedActions({
      run: buildInitialAdvancedActionState("等待步行图片，可先生成跑步首帧。"),
      "attack-1": buildInitialAdvancedActionState("等待待机处理结果，可准备攻击起始帧。"),
      jump: buildInitialAdvancedActionState("等待待机处理结果，可准备跳跃起始帧。")
    });
    setGodotExportResult(null);
    setGodotExportStatus("选择导出尺寸后生成 Godot 导出包。");
    setActiveFrameIndex(0);
    setIsPlayingFrames(false);
  };

  const hydrateCharacterAssets = async (characterId: string) => {
    const hydrationVersion = assetHydrationVersionRef.current + 1;
    assetHydrationVersionRef.current = hydrationVersion;
    try {
      const assets = await getCharacterAssets(characterId);
      if (assetHydrationVersionRef.current !== hydrationVersion) {
        return;
      }
      const version = Date.now().toString(36);
      const characterReference = toMediaPreview(assets.baseTemplate.characterReference, version);
      const baseTemplateOutput = toMediaPreview(assets.baseTemplate.output, version);
      const directionBaseTemplate = toMediaPreview(assets.baseCharacter.directionBaseTemplate, version);
      const idleDirection = toMediaPreview(assets.baseCharacter.idleDirectionTemplate, version);
      const walkDirection = toMediaPreview(assets.baseCharacter.walkDirectionTemplate, version);
      const walkVideoInput = toMediaPreview(assets.baseCharacter.walkVideoInput, version);
      const walkVideoSource = toMediaPreview(assets.baseCharacter.walkVideoSource, version);
      setCharacterReferenceFile(null);
      setDirectionBaseTemplateFile(null);
      setCharacterReferencePreview(characterReference);
      setUploadedCharacterReferencePublicUrl(assets.baseTemplate.characterReference ? toPublicAssetUrl(assets.baseTemplate.characterReference.url) : "");
      setFirstFrameOutputPreview(baseTemplateOutput);
      setDirectionBaseTemplatePreview(directionBaseTemplate);
      setIdleDirectionOutputPreview(idleDirection);
      setWalkDirectionOutputPreview(walkDirection);
      setVideoInputPreview(walkVideoInput ?? walkDirection);
      setVideoOutputPreview(walkVideoSource);
      setFrameVideoInputPreview(walkVideoSource);
      setVideoJobId(walkVideoSource ? (assets.baseCharacter.loopExport?.jobId ?? "existing-video") : "");
      setFrames([]);
      setFourDirectionResult(assets.baseCharacter.loopExport ? normalizeFourDirectionResult(assets.baseCharacter.loopExport) : null);
      setAdvancedActions({
        run: advancedAssetToState(assets.advancedCharacter?.run, "等待步行图片，可先生成跑步首帧。"),
        "attack-1": advancedAssetToState(assets.advancedCharacter?.attack1, "等待待机处理结果，可准备攻击起始帧。"),
        jump: advancedAssetToState(assets.advancedCharacter?.jump, "等待待机处理结果，可准备跳跃起始帧。")
      });
      setActiveFrameIndex(0);
      setIsPlayingFrames(false);
      setFirstFrameStatus(baseTemplateOutput || characterReference ? "已自动载入该角色已有参考图和基准模板。" : "等待角色参考图或直接生成基准模板。");
      setDirectionTemplateStatus(directionBaseTemplate || idleDirection || walkDirection ? "已自动载入该角色已有模板文件。" : "等待角色基准模板。先生成步行 2x2，再基于步行图生成待机 2x2。");
      setVideoStatus(walkVideoSource ? "已自动载入该角色已有步行视频。" : walkVideoInput || walkDirection ? "已自动载入该角色已有步行图片，可以提交视频任务。" : "等待步行图片，或直接上传 2x2 步行图。");
      setFrameStatus(assets.baseCharacter.loopExport ? "已自动载入该角色已有循环导出结果。" : walkVideoSource ? "已自动载入该角色已有视频，可以处理帧。" : "等待视频下载完成。");
    } catch (error: unknown) {
      clearLoadedCharacterAssets();
      setCharacterStatus(`角色文件加载失败：${getErrorMessage(error)}`);
    }
  };

  const handleCreateCharacter = async () => {
    const name = newCharacterName.trim();
    if (!name) {
      setCharacterStatus("请输入角色文件夹名称。");
      return;
    }
    setIsCreatingCharacter(true);
    setCharacterStatus("正在创建角色文件夹...");
    try {
      const character = await createCharacter(name);
      setCharacters((current) => [...current.filter((item) => item.id !== character.id), character]
        .sort((first, second) => first.name.localeCompare(second.name, "zh-Hans-CN")));
      setActiveCharacterId(character.id);
      setNewCharacterName("");
      setCharacterStatus(`当前角色：${character.name}`);
    } catch (error: unknown) {
      setCharacterStatus(`角色创建失败：${getErrorMessage(error)}`);
    } finally {
      setIsCreatingCharacter(false);
    }
  };

  const handleSelectCharacter = (characterId: string) => {
    setActiveCharacterId(characterId);
    setCharacterStatus(characterId ? `当前角色：${characterId}` : "请先创建或选择角色文件夹。");
    setCharacterReferenceFile(null);
    setDirectionBaseTemplateFile(null);
    setCharacterReferencePreview(null);
    setUploadedCharacterReferencePublicUrl("");
    setFirstFrameOutputPreview(null);
    setDirectionBaseTemplatePreview(null);
    setIdleDirectionOutputPreview(null);
    setWalkDirectionOutputPreview(null);
    setVideoInputPreview(null);
    setVideoOutputPreview(null);
    setFrameVideoInputPreview(null);
    setVideoJobId("");
    setVideoStatusDetails("");
    setFrames([]);
    setFourDirectionResult(null);
    setAdvancedActions({
      run: buildInitialAdvancedActionState("等待步行图片，可先生成跑步首帧。"),
      "attack-1": buildInitialAdvancedActionState("等待待机处理结果，可准备攻击起始帧。"),
      jump: buildInitialAdvancedActionState("等待待机处理结果，可准备跳跃起始帧。")
    });
    setGodotExportResult(null);
    setActiveFrameIndex(0);
    setIsPlayingFrames(false);
    setFirstFrameStatus(characterId ? "等待角色参考图或直接生成基准模板。" : "请先创建或选择角色文件夹。");
    setDirectionTemplateStatus(characterId ? "等待角色基准模板。先生成步行 2x2，再基于步行图生成待机 2x2。" : "请先创建或选择角色文件夹。");
    setVideoStatus(characterId ? "等待步行图片，或直接上传 2x2 步行图。" : "请先创建或选择角色文件夹。");
    setFrameStatus(characterId ? "等待视频下载完成。" : "请先创建或选择角色文件夹。");
    setGodotExportStatus(characterId ? "选择导出尺寸后生成 Godot 导出包。" : "请先创建或选择角色文件夹。");
  };

  const handleDeleteCharacter = async (character: CharacterFolder) => {
    const confirmed = window.confirm(`确认删除角色「${character.name}」？此操作会删除整个角色文件夹，不能撤销。`);
    if (!confirmed) {
      return;
    }

    setDeletingCharacterId(character.id);
    setCharacterStatus(`正在删除角色：${character.name}...`);
    try {
      const deleted = await deleteCharacter(character.id);
      setCharacters((current) => current.filter((item) => item.id !== deleted.id));
      if (activeCharacterId === deleted.id) {
        handleSelectCharacter("");
      } else {
        setCharacterStatus(`已删除角色：${deleted.name}`);
      }
    } catch (error: unknown) {
      setCharacterStatus(`角色删除失败：${getErrorMessage(error)}`);
    } finally {
      setDeletingCharacterId("");
    }
  };

  const handleCharacterReferenceUpload = (file: File) => {
    const characterId = requireCharacter(setFirstFrameStatus);
    if (!characterId) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      setFirstFrameStatus("上传失败：请选择图片文件。");
      return;
    }
    assetHydrationVersionRef.current += 1;
    const previewUrl = URL.createObjectURL(file);
    setCharacterReferenceFile(file);
    setUploadedCharacterReferencePublicUrl("");
    setCharacterReferencePreview((current) => {
      if (current?.url.startsWith("blob:")) {
        URL.revokeObjectURL(current.url);
      }
      return {
        name: file.name,
        url: previewUrl
      };
    });
    setFirstFrameStatus(`已载入角色参考图：${file.name}，正在保存资源。`);
    void uploadFirstFrameAsset(file, {
      publicAssetBaseUrl: FIXED_PUBLIC_ASSET_BASE_URL,
      characterId,
      characterAssetKind: "base-template-reference"
    })
      .then((asset) => {
        setUploadedCharacterReferencePublicUrl(asset.publicUrl);
        setFirstFrameStatus(`角色参考图已保存：${asset.fileName}`);
      })
      .catch((error: unknown) => {
        setFirstFrameStatus(`角色参考图保存失败：${getErrorMessage(error)}`);
      });
  };

  const handleOneClickReferenceUpload = (file: File) => {
    if (!file.type.startsWith("image/")) {
      setOneClickStatus("上传失败：请选择图片文件。");
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    setOneClickReferenceFile(file);
    setOneClickReferencePreview((current) => {
      if (current?.url.startsWith("blob:")) {
        URL.revokeObjectURL(current.url);
      }
      return {
        name: file.name,
        url: previewUrl
      };
    });
    setOneClickStatus(`已载入角色参考图：${file.name}`);
  };

  const handleStartOneClickCharacterJob = async () => {
    const characterName = oneClickCharacterName.trim();
    if (!characterName) {
      setOneClickStatus("请先输入角色名。");
      return;
    }
    if (!oneClickReferenceFile) {
      setOneClickStatus("请先上传角色参考图。");
      return;
    }
    const existing = characters.some((character) => character.id === characterName || character.name === characterName);
    const overwrite = existing
      ? window.confirm(`角色「${characterName}」已存在。确认覆盖并重新生成整个角色文件夹吗？`)
      : false;
    if (existing && !overwrite) {
      setOneClickStatus("已取消覆盖，未启动一键生成。");
      return;
    }
    setIsStartingOneClick(true);
    setOneClickStatus("正在启动一键生成角色任务...");
    try {
      await saveDraft();
      const referenceImageDataUrl = await readFileAsDataUrl(oneClickReferenceFile);
      const job = await createOneClickCharacterJob({
        characterName,
        overwrite,
        publicAssetBaseUrl: FIXED_PUBLIC_ASSET_BASE_URL,
        referenceImageDataUrl,
        firstFrame: {
          model: imageModel,
          prompt: currentFinalImagePrompt,
          targetSize: imageGenerationSize,
          keyColor,
          style: imageStyle
        },
        actions: {
          run: oneClickIncludeRun,
          attack1: oneClickIncludeAttack,
          jump: oneClickIncludeJump
        }
      }, {
        publicAssetBaseUrl: FIXED_PUBLIC_ASSET_BASE_URL
      });
      setOneClickJob(job);
      setActiveCharacterId(job.characterId);
      setOneClickStatus(`一键生成任务已启动：${job.jobId}`);
      void pollOneClickCharacterJob(job.jobId);
    } catch (error: unknown) {
      setOneClickStatus(`一键生成角色启动失败：${getErrorMessage(error)}`);
    } finally {
      setIsStartingOneClick(false);
    }
  };

  const pollOneClickCharacterJob = async (jobId: string) => {
    try {
      const job = await getOneClickCharacterJob(jobId);
      setOneClickJob(job);
      setOneClickStatus(formatOneClickJobStatus(job));
      if (job.status === "completed") {
        const items = await listCharacters();
        setCharacters(items);
        setActiveCharacterId(job.characterId);
        await hydrateCharacterAssets(job.characterId);
        return;
      }
      if (job.status === "failed") {
        return;
      }
      oneClickPollTimeoutRef.current = window.setTimeout(() => {
        void pollOneClickCharacterJob(jobId);
      }, 3000);
    } catch (error: unknown) {
      setOneClickStatus(`一键生成角色状态查询失败：${getErrorMessage(error)}`);
    }
  };

  const handleDirectionBaseTemplateUpload = (file: File) => {
    const characterId = requireCharacter(setDirectionTemplateStatus);
    if (!characterId) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      setDirectionTemplateStatus("上传失败：请选择图片文件。");
      return;
    }
    assetHydrationVersionRef.current += 1;
    const previewUrl = URL.createObjectURL(file);
    setDirectionBaseTemplateFile(file);
    setDirectionBaseTemplatePreview((current) => {
      if (current?.url.startsWith("blob:")) {
        URL.revokeObjectURL(current.url);
      }
      return {
        name: file.name,
        url: previewUrl
      };
    });
    setDirectionTemplateStatus(`角色基准模板已载入：${file.name}，正在保存资源。`);
    void uploadFirstFrameAsset(file, {
      publicAssetBaseUrl: FIXED_PUBLIC_ASSET_BASE_URL,
      characterId,
      characterAssetKind: "direction-base-template"
    })
      .then((asset) => {
        setDirectionBaseTemplatePreview((current) => current ? {
          ...current,
          name: asset.fileName,
          publicUrl: asset.publicUrl
        } : current);
        setDirectionTemplateStatus(`角色基准模板已保存：${asset.fileName}`);
      })
      .catch((error: unknown) => {
        setDirectionTemplateStatus(`角色基准模板保存失败：${getErrorMessage(error)}`);
      });
  };

  const handleVideoFirstFrameUpload = (file: File) => {
    const characterId = requireCharacter(setVideoStatus);
    if (!characterId) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      setVideoStatus("上传失败：请选择图片文件。");
      return;
    }
    assetHydrationVersionRef.current += 1;
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
    setWalkDirectionOutputPreview({
      name: file.name,
      url: previewUrl
    });
    setVideoStatus(`已载入步行图片：${file.name}，正在保存资源。`);
    void uploadFirstFrameAsset(file, {
      publicAssetBaseUrl: FIXED_PUBLIC_ASSET_BASE_URL,
      characterId,
      characterAssetKind: "walk-video-input"
    })
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
        setWalkDirectionOutputPreview((current) => current?.url === previewUrl ? {
          ...current,
          name: asset.fileName,
          publicUrl: asset.publicUrl
        } : current);
        setVideoStatus(`步行图片已保存：${asset.fileName}，可以提交视频任务。`);
      })
      .catch((error: unknown) => {
        setVideoStatus(`步行图片保存失败：${getErrorMessage(error)}`);
      });
  };

  const handleProcessFirstFrame = async () => {
    const characterId = requireCharacter(setFirstFrameStatus);
    if (!characterId) {
      return;
    }
    assetHydrationVersionRef.current += 1;
    setIsProcessingFirstFrame(true);
    setFirstFrameStatus("正在生成角色基准模板...");
    try {
      const referenceImageDataUrl = await readOptionalPreviewImageAsDataUrl(characterReferenceFile, characterReferencePreview);
      const prompt = buildFirstFramePrompt({
        imageSystemPrompt,
        imageCustomPrompt
      });
      setFinalImagePrompt(prompt);
      const response = await createFirstFrameGeneration({
        model: imageModel,
        prompt,
        targetSize: imageGenerationSize,
        keyColor,
        referenceImageDataUrl
      }, {
        publicAssetBaseUrl: FIXED_PUBLIC_ASSET_BASE_URL,
        characterId
      });
      const imageUrl = extractImageUrl(response);
      const publicUrl = extractPublicUrl(response) ?? imageUrl;
      if (!imageUrl) {
        throw new Error("角色基准模板生成没有返回图片。");
      }
      const preview = {
        name: extractFileName(response) ?? "base-character-template.png",
        url: appendCacheBust(toAbsoluteApiUrl(imageUrl), Date.now().toString(36)),
        publicUrl
      };
      setFirstFrameOutputPreview(preview);
      setFirstFrameStatus("角色基准模板生成完成，已进入基础角色生成数据流。");
      setDirectionBaseTemplateFile(null);
      setDirectionBaseTemplatePreview(null);
      setDirectionTemplateStatus("角色基准模板已就绪，请先生成步行 2x2，再基于步行图生成待机 2x2。");
      setVideoStatus("角色基准模板已就绪，请先生成步行 2x2，或在步行页直接上传 2x2 步行图。");
    } catch (error: unknown) {
      setFirstFrameStatus(`基准模板生成失败：${getErrorMessage(error)}`);
    } finally {
      setIsProcessingFirstFrame(false);
    }
  };

  const handleGenerateDirectionTemplate = async (templateKind: "idle" | "walk") => {
    const characterId = requireCharacter(setDirectionTemplateStatus);
    if (!characterId) {
      return;
    }
    const finalPrompt = templateKind === "idle" ? finalDirectionIdlePrompt : finalDirectionWalkPrompt;
    const outputLabel = templateKind === "idle" ? "待机" : "步行";
    assetHydrationVersionRef.current += 1;
    setProcessingDirectionTemplate(templateKind);
    setDirectionTemplateStatus(`正在生成${outputLabel} 2x2...`);
    try {
      const characterTemplateImageDataUrl = await resolveDirectionTemplateSourceDataUrl(templateKind);
      const response = await createDirectionTemplateGeneration({
        templateKind,
        model: directionImageModel,
        prompt: finalPrompt,
        targetSize: directionImageGenerationSize,
        keyColor,
        characterTemplateImageDataUrl
      }, {
        publicAssetBaseUrl: FIXED_PUBLIC_ASSET_BASE_URL,
        characterId
      });
      const imageUrl = extractImageUrl(response);
      const publicUrl = extractPublicUrl(response) ?? imageUrl;
      if (!imageUrl) {
        throw new Error(`${outputLabel} 2x2 生成没有返回图片。`);
      }
      const preview = {
        name: extractFileName(response) ?? `${templateKind}-4dir.png`,
        url: appendCacheBust(toAbsoluteApiUrl(imageUrl), Date.now().toString(36)),
        publicUrl
      };
      if (templateKind === "idle") {
        setIdleDirectionOutputPreview(preview);
      } else {
        setWalkDirectionOutputPreview(preview);
        setIdleDirectionOutputPreview(null);
        setVideoInputPreview(preview);
        setVideoStatus("步行图片已就绪，可以提交步行视频任务。");
      }
      setDirectionTemplateStatus(`${outputLabel} 2x2 生成完成。`);
    } catch (error: unknown) {
      setDirectionTemplateStatus(`${outputLabel} 2x2 生成失败：${getErrorMessage(error)}`);
    } finally {
      setProcessingDirectionTemplate(null);
    }
  };

  const resolveDirectionBaseTemplateDataUrl = async () => {
    if (directionBaseTemplateFile) {
      return readFileAsDataUrl(directionBaseTemplateFile);
    }
    if (!effectiveDirectionBaseTemplatePreview) {
      throw new Error("请先生成或上传角色基准模板。");
    }
    return readImageUrlAsDataUrl(effectiveDirectionBaseTemplatePreview.url);
  };

  const resolveDirectionTemplateSourceDataUrl = async (templateKind: "idle" | "walk") => {
    if (templateKind === "walk") {
      return resolveDirectionBaseTemplateDataUrl();
    }
    if (!walkDirectionOutputPreview) {
      throw new Error("请先生成步行 2x2，再基于步行图生成待机 2x2。");
    }
    return readImageUrlAsDataUrl(walkDirectionOutputPreview.url);
  };

  const handleSubmitVideo = async () => {
    const characterId = requireCharacter(setVideoStatus);
    if (!characterId) {
      return;
    }
    const firstFrameUrl = videoInputPreview?.publicUrl ?? videoInputPreview?.url ?? "";
    if (!firstFrameUrl) {
      setVideoStatus("请先生成步行 2x2，或直接上传 2x2 步行图。");
      return;
    }
    if (!isPublicHttpsUrl(firstFrameUrl)) {
      setVideoStatus("视频模型需要公网 HTTPS 步行图片 URL。请重新生成步行图片或重新上传。");
      return;
    }
    setIsSubmittingVideo(true);
    setVideoStatus("正在提交视频任务...");
    setVideoStatusDetails("");
    try {
      const response = await createVideoGeneration({
        model: videoModel,
        prompt: finalVideoPrompt,
        firstFrameUrl,
        durationSeconds: videoDurationSeconds,
        resolution: videoResolution
      }, {
        characterId
      });
      const jobId = extractJobId(response);
      if (!jobId) {
        throw new Error("视频任务没有返回 jobId。");
      }
      setVideoJobId(jobId);
      setVideoStatusDetails(formatVideoStatusDetails(response, jobId));
      setVideoStatus(`视频任务已提交：${jobId}，正在轮询状态。`);
      await pollVideoJob(jobId, characterId);
    } catch (error: unknown) {
      setVideoStatus(`视频生成提交失败：${getErrorMessage(error)}`);
    } finally {
      setIsSubmittingVideo(false);
    }
  };

  const pollVideoJob = async (jobId: string, characterId = activeCharacterId) => {
    const result = await getVideoGenerationStatus(jobId, { characterId });
    setVideoStatusDetails(formatVideoStatusDetails(result, jobId));
    if (result.status === "completed" && result.localVideoUrl) {
      const videoUrl = toAbsoluteApiUrl(result.localVideoUrl);
      const preview = {
        name: "source.mp4",
        url: videoUrl,
        publicUrl: result.localVideoUrl
      };
      setVideoOutputPreview(preview);
      setFrameVideoInputPreview(preview);
      setVideoStatus(`视频已下载到 storage/characters/${characterId}/base-character/walk-video/source.mp4`);
      setFrameStatus("视频已载入，可以处理帧。");
      return;
    }
    if (result.status === "failed") {
      const failureReason = extractVideoFailureReason(result.providerResponse ?? result);
      setVideoStatus(failureReason ? `视频任务失败：${failureReason}` : "视频任务失败，请查看状态详情或调整提示词。");
      return;
    }
    setVideoStatus(`视频任务状态：${result.status}，继续轮询。`);
    pollTimeoutRef.current = window.setTimeout(() => {
      void pollVideoJob(jobId, characterId).catch((error: unknown) => {
        setVideoStatus(`视频状态查询失败：${getErrorMessage(error)}`);
      });
    }, 3000);
  };

  const handleProcessFourDirection = async () => {
    const characterId = requireCharacter(setFrameStatus);
    if (!characterId) {
      return;
    }
    if (!videoJobId || !frameVideoInputPreview) {
      setFrameStatus("请先完成步行视频，或上传步行视频。");
      return;
    }
    setIsProcessingFrames(true);
    setFrameStatus("正在一键处理步行视频...");
    try {
      const result = await processFourDirectionVideo({
        jobId: videoJobId,
        characterId,
        frameCount,
        keyColor,
        tolerance,
        minLoopFrames,
        maxLoopFrames,
        exportFrameSize,
        fps
      });
      setFourDirectionResult(normalizeFourDirectionResult(result));
      setActiveFrameIndex(0);
      setIsPlayingFrames(true);
      setFrameStatus(`步行处理完成：抽帧 ${result.frameCount} 帧，已生成走路循环。`);
    } catch (error: unknown) {
      setFrameStatus(`步行处理失败：${getErrorMessage(error)}`);
    } finally {
      setIsProcessingFrames(false);
    }
  };

  const handleProcessIdleDirection = async () => {
    const characterId = requireCharacter(setFrameStatus);
    if (!characterId) {
      return;
    }
    if (!fourDirectionResult?.directions.length) {
      setFrameStatus("请先完成步行一键处理，再处理待机。");
      return;
    }
    setIsProcessingFrames(true);
    setFrameStatus("正在按步行导出尺寸和中心规则处理待机...");
    try {
      const idle = await processIdleFourDirection({
        characterId,
        keyColor,
        tolerance
      });
      setFourDirectionResult((current) => current ? normalizeFourDirectionResult({
        ...current,
        idle
      }) : current);
      setFrameStatus("待机处理完成。");
    } catch (error: unknown) {
      setFrameStatus(`待机处理失败：${getErrorMessage(error)}`);
    } finally {
      setIsProcessingFrames(false);
    }
  };

  const handleFrameVideoUpload = (file: File) => {
    const characterId = requireCharacter(setFrameStatus);
    if (!characterId) {
      return;
    }
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
    setFourDirectionResult(null);
    setActiveFrameIndex(0);
    setIsPlayingFrames(false);
    setFrameStatus(`已载入帧处理视频：${file.name}，正在保存资源。`);
    void uploadFrameVideoAsset(file, { characterId })
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

  const handleChangeVideoModel = (nextModel: string) => {
    setVideoModel(nextModel);
    setVideoDurationSeconds(getDefaultVideoDuration(videoModels, nextModel));
    setVideoResolution(getDefaultVideoResolution(videoModels, nextModel));
  };

  const updateAdvancedAction = (actionKind: AdvancedActionKind, patch: Partial<AdvancedActionState>) => {
    setAdvancedActions((current) => ({
      ...current,
      [actionKind]: {
        ...current[actionKind],
        ...patch
      }
    }));
  };

  const getAdvancedPrompt = (actionKind: AdvancedActionKind) => {
    if (actionKind === "run") {
      return finalAdvancedRunVideoPrompt;
    }
    if (actionKind === "attack-1") {
      return finalAdvancedAttackPrompt;
    }
    return finalAdvancedJumpPrompt;
  };

  const handleGenerateRunKeyframe = async () => {
    const characterId = requireCharacter((message) => updateAdvancedAction("run", { status: message }));
    if (!characterId) {
      return;
    }
    if (!walkDirectionOutputPreview) {
      updateAdvancedAction("run", { status: "请先生成基础角色生成里的步行 2x2 图。" });
      return;
    }
    updateAdvancedAction("run", {
      isGeneratingKeyframe: true,
      status: "正在生成跑步首帧..."
    });
    try {
      const characterTemplateImageDataUrl = await readImageUrlAsDataUrl(walkDirectionOutputPreview.url);
      const response = await createDirectionTemplateGeneration({
        templateKind: "run",
        model: directionImageModel,
        prompt: finalAdvancedRunPrompt,
        targetSize: directionImageGenerationSize,
        keyColor,
        characterTemplateImageDataUrl
      }, {
        publicAssetBaseUrl: FIXED_PUBLIC_ASSET_BASE_URL,
        characterId
      });
      const imageUrl = extractImageUrl(response);
      const publicUrl = extractPublicUrl(response) ?? imageUrl;
      if (!imageUrl) {
        throw new Error("跑步首帧生成没有返回图片。");
      }
      const preview = {
        name: extractFileName(response) ?? "run-4dir.png",
        url: appendCacheBust(toAbsoluteApiUrl(imageUrl), Date.now().toString(36)),
        publicUrl
      };
      updateAdvancedAction("run", {
        keyframePreview: preview,
        inputPreview: preview,
        status: "跑步首帧已生成，可提交跑步视频任务。"
      });
    } catch (error: unknown) {
      updateAdvancedAction("run", { status: `跑步首帧生成失败：${getErrorMessage(error)}` });
    } finally {
      updateAdvancedAction("run", { isGeneratingKeyframe: false });
    }
  };

  const handlePrepareAdvancedStartFrame = async (actionKind: Exclude<AdvancedActionKind, "run">) => {
    const characterId = requireCharacter((message) => updateAdvancedAction(actionKind, { status: message }));
    if (!characterId) {
      return;
    }
    const label = getAdvancedActionLabel(actionKind);
    updateAdvancedAction(actionKind, {
      isPreparingInput: true,
      status: `正在准备${label}起始帧...`
    });
    try {
      const response = await prepareAdvancedActionStartFrame({
        characterId,
        actionKind,
        keyColor,
        tolerance,
        scale: actionKind === "attack-1" ? advancedAttackStartScale : advancedJumpStartScale
      });
      const localUrl = response.localUrl ?? extractImageUrl(response);
      if (!localUrl) {
        throw new Error(`${label}起始帧没有返回图片。`);
      }
      const preview = {
        name: response.fileName ?? "input-4dir.png",
        url: appendCacheBust(toAbsoluteApiUrl(localUrl), Date.now().toString(36)),
        publicUrl: response.publicUrl ?? toPublicAssetUrl(localUrl)
      };
      updateAdvancedAction(actionKind, {
        inputPreview: preview,
        ...(actionKind === "attack-1" ? { middleFramePreview: null } : {}),
        status: `${label}起始帧已准备，可提交视频任务。`
      });
    } catch (error: unknown) {
      updateAdvancedAction(actionKind, { status: `${label}起始帧准备失败：${getErrorMessage(error)}` });
    } finally {
      updateAdvancedAction(actionKind, { isPreparingInput: false });
    }
  };

  const handleGenerateAttackMidframe = async () => {
    const actionKind: AdvancedActionKind = "attack-1";
    const characterId = requireCharacter((message) => updateAdvancedAction(actionKind, { status: message }));
    if (!characterId) {
      return;
    }
    const startFrame = advancedActions[actionKind].inputPreview;
    if (!startFrame) {
      updateAdvancedAction(actionKind, { status: "请先准备攻击 1 起始帧，再生成攻击中间帧。" });
      return;
    }
    if (!advancedAttackMidframeCustomPrompt.trim()) {
      updateAdvancedAction(actionKind, { status: "请先填写攻击中间帧自定义提示词。" });
      return;
    }
    updateAdvancedAction(actionKind, {
      isGeneratingMidframe: true,
      status: "正在生成攻击 1 中间帧..."
    });
    try {
      const startFrameImageDataUrl = await readImageUrlAsDataUrl(startFrame.url);
      const response = await createAdvancedActionMidframeGeneration({
        actionKind,
        model: directionImageModel,
        prompt: advancedAttackMidframeCustomPrompt,
        targetSize: directionImageGenerationSize,
        keyColor,
        startFrameImageDataUrl
      }, {
        publicAssetBaseUrl: FIXED_PUBLIC_ASSET_BASE_URL,
        characterId
      });
      const imageUrl = extractImageUrl(response);
      const publicUrl = extractPublicUrl(response) ?? imageUrl;
      if (!imageUrl) {
        throw new Error("攻击中间帧生成没有返回图片。");
      }
      updateAdvancedAction(actionKind, {
        middleFramePreview: {
          name: extractFileName(response) ?? "middle-4dir.png",
          url: appendCacheBust(toAbsoluteApiUrl(imageUrl), Date.now().toString(36)),
          publicUrl
        },
        status: "攻击中间帧已生成，可提交攻击视频任务。"
      });
    } catch (error: unknown) {
      updateAdvancedAction(actionKind, { status: `攻击中间帧生成失败：${getErrorMessage(error)}` });
    } finally {
      updateAdvancedAction(actionKind, { isGeneratingMidframe: false });
    }
  };

  const handleSubmitAdvancedVideo = async (actionKind: AdvancedActionKind) => {
    const characterId = requireCharacter((message) => updateAdvancedAction(actionKind, { status: message }));
    if (!characterId) {
      return;
    }
    const state = advancedActions[actionKind];
    const firstFrameUrl = state.inputPreview?.publicUrl ?? state.inputPreview?.url ?? "";
    const label = getAdvancedActionLabel(actionKind);
    if (!firstFrameUrl) {
      updateAdvancedAction(actionKind, { status: `请先准备${label}的 2x2 输入图。` });
      return;
    }
    if (!isPublicHttpsUrl(firstFrameUrl)) {
      updateAdvancedAction(actionKind, { status: `${label}视频模型需要公网 HTTPS 输入图 URL，请重新生成或上传。` });
      return;
    }
    if (actionKind === "attack-1" && !state.middleFramePreview) {
      updateAdvancedAction(actionKind, { status: "请先生成攻击中间帧，再提交攻击视频任务。" });
      return;
    }
    const middleFrameUrl = state.middleFramePreview?.publicUrl ?? state.middleFramePreview?.url ?? "";
    if (actionKind === "attack-1" && !isPublicHttpsUrl(middleFrameUrl)) {
      updateAdvancedAction(actionKind, { status: "攻击中间帧需要公网 HTTPS 图片 URL，请重新生成。" });
      return;
    }
    const inputReferenceUrls = actionKind === "attack-1"
      ? [firstFrameUrl, middleFrameUrl]
      : [];
    updateAdvancedAction(actionKind, {
      isSubmittingVideo: true,
      status: `正在提交${label}视频任务...`,
      statusDetails: ""
    });
    try {
      const response = await createVideoGeneration({
        model: videoModel,
        prompt: getAdvancedPrompt(actionKind),
        firstFrameUrl,
        ...(actionKind === "attack-1" ? { referenceOnly: true } : {}),
        inputReferenceUrls,
        durationSeconds: videoDurationSeconds,
        resolution: videoResolution
      }, {
        characterId,
        actionKind
      });
      const jobId = extractJobId(response);
      if (!jobId) {
        throw new Error("视频任务没有返回 jobId。");
      }
      updateAdvancedAction(actionKind, {
        jobId,
        status: `${label}视频任务已提交：${jobId}，正在轮询状态。`,
        statusDetails: formatVideoStatusDetails(response, jobId)
      });
      await pollAdvancedVideoJob(jobId, characterId, actionKind);
    } catch (error: unknown) {
      updateAdvancedAction(actionKind, { status: `${label}视频生成提交失败：${getErrorMessage(error)}` });
    } finally {
      updateAdvancedAction(actionKind, { isSubmittingVideo: false });
    }
  };

  const pollAdvancedVideoJob = async (jobId: string, characterId: string, actionKind: AdvancedActionKind) => {
    const label = getAdvancedActionLabel(actionKind);
    const result = await getVideoGenerationStatus(jobId, { characterId, actionKind });
    updateAdvancedAction(actionKind, {
      statusDetails: formatVideoStatusDetails(result, jobId)
    });
    if (result.status === "completed" && result.localVideoUrl) {
      const preview = {
        name: "source.mp4",
        url: toAbsoluteApiUrl(result.localVideoUrl),
        publicUrl: result.localVideoUrl
      };
      updateAdvancedAction(actionKind, {
        outputPreview: preview,
        status: `${label}视频已下载到 storage/characters/${characterId}/advanced-character/${actionKind}/video/source.mp4`
      });
      return;
    }
    if (result.status === "failed") {
      const failureReason = extractVideoFailureReason(result.providerResponse ?? result);
      updateAdvancedAction(actionKind, {
        status: failureReason ? `${label}视频任务失败：${failureReason}` : `${label}视频任务失败，请查看状态详情或调整提示词。`
      });
      return;
    }
    updateAdvancedAction(actionKind, { status: `${label}视频任务状态：${result.status}，继续轮询。` });
    pollTimeoutRef.current = window.setTimeout(() => {
      void pollAdvancedVideoJob(jobId, characterId, actionKind).catch((error: unknown) => {
        updateAdvancedAction(actionKind, { status: `${label}视频状态查询失败：${getErrorMessage(error)}` });
      });
    }, 3000);
  };

  const handleProcessAdvancedAction = async (actionKind: AdvancedActionKind) => {
    const characterId = requireCharacter((message) => updateAdvancedAction(actionKind, { status: message }));
    if (!characterId) {
      return;
    }
    const state = advancedActions[actionKind];
    const label = getAdvancedActionLabel(actionKind);
    if (!state.jobId || !state.outputPreview) {
      updateAdvancedAction(actionKind, { status: `请先完成${label}视频生成或上传。` });
      return;
    }
    updateAdvancedAction(actionKind, {
      isProcessing: true,
      status: `正在处理${label}视频帧...`
    });
    try {
      const result = await processAdvancedActionVideo({
        jobId: state.jobId,
        characterId,
        actionKind,
        mode: actionKind === "run" ? "loop" : "oneshot",
        frameCount,
        keyColor,
        tolerance,
        minLoopFrames,
        maxLoopFrames,
        exportFrameSize,
        fps
      });
      updateAdvancedAction(actionKind, {
        result: normalizeFourDirectionResult(result),
        status: `${label}处理完成：抽帧 ${result.frameCount} 帧。`
      });
    } catch (error: unknown) {
      updateAdvancedAction(actionKind, { status: `${label}处理失败：${getErrorMessage(error)}` });
    } finally {
      updateAdvancedAction(actionKind, { isProcessing: false });
    }
  };

  const handleReferenceImageUpload = async (kind: Module01ReferenceImageKind, file: File) => {
    if (!file.type.startsWith("image/")) {
      setReferenceSettingsStatus("上传失败：请选择图片文件。");
      return;
    }
    const label = REFERENCE_IMAGE_LABELS[kind];
    setReferenceSettingsStatus(`正在上传并覆盖${label}...`);
    try {
      await uploadModule01ReferenceImage(kind, file);
      setReferenceImageVersion(Date.now().toString(36));
      setReferenceSettingsStatus(`${label}已全局覆盖。`);
    } catch (error: unknown) {
      setReferenceSettingsStatus(`${label}保存失败：${getErrorMessage(error)}`);
    }
  };

  const applyWorkflowDraft = (draft: SpriteAnimatorDraft) => {
    setImageModel(draft.imageModel);
    setVideoModel(draft.videoModel);
    setKeyColor(draft.keyColor);
    setVideoDurationSeconds(draft.videoDurationSeconds);
    setVideoResolution(draft.videoResolution);
    setImageGenerationSize(draft.imageGenerationSize);
    setImageStyle(draft.imageStyle);
    setImageSystemPrompt(draft.imageSystemPrompt);
    setImageCustomPrompt(draft.imageCustomPrompt);
    setFinalImagePrompt(draft.finalImagePrompt);
    setDirectionImageModel(draft.directionImageModel);
    setDirectionImageGenerationSize(draft.directionImageGenerationSize);
    setDirectionIdleSystemPrompt(draft.directionIdleSystemPrompt);
    setDirectionIdleCustomPrompt(draft.directionIdleCustomPrompt);
    setFinalDirectionIdlePrompt(draft.finalDirectionIdlePrompt);
    setDirectionWalkSystemPrompt(draft.directionWalkSystemPrompt);
    setDirectionWalkCustomPrompt(draft.directionWalkCustomPrompt);
    setFinalDirectionWalkPrompt(draft.finalDirectionWalkPrompt);
    setVideoSystemPrompt(draft.videoSystemPrompt);
    setVideoCustomPrompt(draft.videoCustomPrompt);
    setFinalVideoPrompt(draft.finalVideoPrompt);
    setAdvancedRunSystemPrompt(draft.advancedRunSystemPrompt);
    setAdvancedRunCustomPrompt(draft.advancedRunCustomPrompt);
    setFinalAdvancedRunPrompt(draft.finalAdvancedRunPrompt);
    setAdvancedRunVideoSystemPrompt(draft.advancedRunVideoSystemPrompt);
    setAdvancedRunVideoCustomPrompt(draft.advancedRunVideoCustomPrompt);
    setFinalAdvancedRunVideoPrompt(draft.finalAdvancedRunVideoPrompt);
    setAdvancedAttackSystemPrompt(draft.advancedAttackSystemPrompt);
    setAdvancedAttackCustomPrompt(draft.advancedAttackCustomPrompt);
    setFinalAdvancedAttackPrompt(draft.finalAdvancedAttackPrompt);
    setAdvancedAttackMidframeCustomPrompt(draft.advancedAttackMidframeCustomPrompt);
    setAdvancedAttackStartScale(draft.advancedAttackStartScale);
    setAdvancedJumpSystemPrompt(draft.advancedJumpSystemPrompt);
    setAdvancedJumpCustomPrompt(draft.advancedJumpCustomPrompt);
    setFinalAdvancedJumpPrompt(draft.finalAdvancedJumpPrompt);
    setAdvancedJumpStartScale(draft.advancedJumpStartScale);
    setFrameCount(draft.frameCount);
    setFps(draft.fps);
    setTolerance(draft.tolerance);
    setMinLoopFrames(draft.minLoopFrames);
    setMaxLoopFrames(draft.maxLoopFrames);
    setExportFrameSize(draft.exportFrameSize);
  };

  const buildCurrentDraft = (): SpriteAnimatorDraft => ({
    openRouterApiKey,
    imageModel,
    videoModel,
    keyColor,
    videoDurationSeconds,
    videoResolution,
    imageGenerationSize,
    imageStyle,
    imageSystemPrompt,
    imageCustomPrompt,
    finalImagePrompt: currentFinalImagePrompt,
    directionImageModel,
    directionImageGenerationSize,
    directionIdleSystemPrompt,
    directionIdleCustomPrompt,
    finalDirectionIdlePrompt,
    directionWalkSystemPrompt,
    directionWalkCustomPrompt,
    finalDirectionWalkPrompt,
    videoSystemPrompt,
    videoCustomPrompt,
    finalVideoPrompt,
    advancedRunSystemPrompt,
    advancedRunCustomPrompt,
    finalAdvancedRunPrompt,
    advancedRunVideoSystemPrompt,
    advancedRunVideoCustomPrompt,
    finalAdvancedRunVideoPrompt,
    advancedAttackSystemPrompt,
    advancedAttackCustomPrompt,
    finalAdvancedAttackPrompt,
    advancedAttackMidframeCustomPrompt,
    advancedAttackStartScale,
    advancedJumpSystemPrompt,
    advancedJumpCustomPrompt,
    finalAdvancedJumpPrompt,
    advancedJumpStartScale,
    frameCount,
    fps,
    tolerance,
    minLoopFrames,
    maxLoopFrames,
    exportFrameSize
  });

  const saveDraft = async () => {
    const draft = buildCurrentDraft();
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    for (const legacyKey of LEGACY_DRAFT_STORAGE_KEYS) {
      localStorage.removeItem(legacyKey);
    }
    await saveModule01WorkflowConfig(toBackendWorkflowDraft(draft));
  };

  const handleSaveFirstFrameDraft = async () => {
    setFirstFrameStatus("正在保存基准模板配置到后端...");
    try {
      await saveDraft();
      setFirstFrameStatus("基准模板配置已保存到后端并完全覆盖。");
    } catch (error: unknown) {
      setFirstFrameStatus(`基准模板配置保存失败：${getErrorMessage(error)}`);
    }
  };

  const handleSaveDirectionTemplateDraft = async () => {
    setDirectionTemplateStatus("正在保存基础动作配置到后端...");
    try {
      await saveDraft();
      setDirectionTemplateStatus("基础动作配置已保存到后端并完全覆盖。");
    } catch (error: unknown) {
      setDirectionTemplateStatus(`基础动作配置保存失败：${getErrorMessage(error)}`);
    }
  };

  const handleSaveVideoDraft = async () => {
    setVideoStatus("正在保存视频配置到后端...");
    try {
      await saveDraft();
      setVideoStatus("视频配置已保存到后端并完全覆盖。");
    } catch (error: unknown) {
      setVideoStatus(`视频配置保存失败：${getErrorMessage(error)}`);
    }
  };

  const handleCreateGodotExport = async () => {
    const characterId = requireCharacter(setGodotExportStatus);
    if (!characterId) {
      return;
    }
    setIsExportingGodot(true);
    setGodotExportResult(null);
    setGodotExportStatus(`正在生成 ${godotExportSize}x${godotExportSize} Godot 导出包...`);
    try {
      const result = await createGodotExport({
        characterId,
        exportSize: godotExportSize
      });
      setGodotExportResult(result);
      setGodotExportStatus(`Godot 导出完成：${result.exportedActions.join(" / ")}，共 ${result.animationCount} 组动画。`);
    } catch (error: unknown) {
      setGodotExportStatus(`Godot 导出失败：${getErrorMessage(error)}`);
    } finally {
      setIsExportingGodot(false);
    }
  };

  return (
    <main className="app-shell workbench-shell">
      <aside className="side-nav">
        <button className="icon-button" type="button" onClick={onBack} aria-label="返回工作台首页">
          <ArrowLeft size={18} />
        </button>
        <div className="nav-brand">模块 01</div>
        <section className="character-panel" aria-label="角色文件夹">
          <div className="nav-group-title">角色</div>
          <label className="field compact-field">
            当前角色
            <div className="character-select-row">
              <select
                aria-label="当前角色"
                value={activeCharacterId}
                onChange={(event) => handleSelectCharacter(event.target.value)}
              >
                <option value="">未选择角色</option>
                {activeCharacterId && !characters.some((character) => character.id === activeCharacterId) ? (
                  <option value={activeCharacterId}>{activeCharacterId}</option>
                ) : null}
                {characters.map((character) => (
                  <option key={character.id} value={character.id}>{character.name}</option>
                ))}
              </select>
              <button
                aria-label={activeCharacterId ? `删除角色 ${activeCharacterId}` : "删除角色"}
                className="icon-button character-delete-button"
                type="button"
                disabled={!activeCharacterId || deletingCharacterId === activeCharacterId}
                onClick={() => {
                  const character = characters.find((item) => item.id === activeCharacterId) ?? { id: activeCharacterId, name: activeCharacterId };
                  void handleDeleteCharacter(character);
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </label>
          <label className="field compact-field">
            新建角色
            <input
              aria-label="新建角色名称"
              placeholder="角色名"
              value={newCharacterName}
              onChange={(event) => setNewCharacterName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleCreateCharacter();
                }
              }}
            />
          </label>
          <button
            className="tool-button"
            type="button"
            disabled={isCreatingCharacter}
            onClick={() => void handleCreateCharacter()}
          >
            {isCreatingCharacter ? "创建中" : "创建角色"}
          </button>
          <span className="character-status">{characterStatus}</span>
        </section>
        <div className="nav-group-title">流程</div>
        {MODULE01_NAV_ITEMS.slice(0, 9).map((item) => (
          <button
            key={item.id}
            className={["nav-item", activePage === item.id ? "nav-item-active" : ""].filter(Boolean).join(" ")}
            type="button"
            onClick={() => setActivePage(item.id)}
          >
            <Module01NavIcon page={item.id} />
            {item.label}
          </button>
        ))}
        <div className="nav-group-title">配置</div>
        {MODULE01_NAV_ITEMS.slice(9).map((item) => (
          <button
            key={item.id}
            className={["nav-item", activePage === item.id ? "nav-item-active" : ""].filter(Boolean).join(" ")}
            type="button"
            onClick={() => setActivePage(item.id)}
          >
            <Module01NavIcon page={item.id} />
            {item.label}
          </button>
        ))}
      </aside>

      <section className="main-stage">
        <header className="tool-header">
          <div>
            <p className="eyebrow">模块 01 / {MODULE01_PAGE_LABELS[activePage]}</p>
            <h1>高清2D角色制作</h1>
          </div>
          <div className="toolbar">
            <div className="fixed-url-field" aria-label="固定公网资源地址">
              <span>固定公网资源地址</span>
              <code>{FIXED_PUBLIC_ASSET_BASE_URL}</code>
            </div>
            <div className="fixed-url-field" aria-label="API provider settings">
              <span>API providers</span>
              <code>Global settings</code>
            </div>
          </div>
        </header>

        <div className="workflow-stack">
          {activePage === "module-settings" ? (
            <Module01Settings
              status={referenceSettingsStatus}
              references={[
                {
                  group: "base-template",
                  label: "基准模板画风参考图",
                  alt: "基准模板画风参考图预览",
                  previewUrl: builtInStyleReferencePreview?.url ?? toAbsoluteApiUrl(BUILT_IN_STYLE_REFERENCE_URL),
                  onUpload: (file) => handleReferenceImageUpload("style", file)
                },
                {
                  group: "walk",
                  label: "步行参考图",
                  alt: "步行参考图预览",
                  previewUrl: builtInWalkReferencePreview?.url ?? toAbsoluteApiUrl(BUILT_IN_WALK_REFERENCE_URL),
                  onUpload: (file) => handleReferenceImageUpload("walk", file)
                },
                {
                  group: "idle",
                  label: "待机参考图",
                  alt: "待机参考图预览",
                  previewUrl: builtInIdleReferencePreview?.url ?? toAbsoluteApiUrl(BUILT_IN_IDLE_REFERENCE_URL),
                  onUpload: (file) => handleReferenceImageUpload("idle", file)
                },
                {
                  group: "run",
                  label: "跑步参考图",
                  alt: "跑步参考图预览",
                  previewUrl: builtInRunReferencePreview?.url ?? toAbsoluteApiUrl(BUILT_IN_RUN_REFERENCE_URL),
                  onUpload: (file) => handleReferenceImageUpload("run", file)
                }
              ]}
              panels={[
                {
                  group: "base-template",
                  onSave: handleSaveFirstFrameDraft,
                  content: (
                    <div className="module01-settings-fields">
                      <div className="form-grid">
                        <label className="field">
                          图像模型
                          <select aria-label="设置基准模板图像模型" value={imageModel} onChange={(event) => setImageModel(event.target.value)}>
                            {imageModels.map((model) => (
                              <option key={model.id} value={model.id}>{model.label}</option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          图片生成尺寸
                          <select aria-label="设置基准模板图片生成尺寸" value={imageGenerationSize} onChange={(event) => setImageGenerationSize(Number(event.target.value))}>
                            {imageGenerationSizeOptions.map((option) => (
                              <option key={option.size} value={option.size}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          图片风格
                          <select aria-label="设置基准模板图片风格" value={imageStyle} onChange={(event) => setImageStyle(event.target.value)}>
                            {IMAGE_STYLES.map((style) => (
                              <option key={style.id} value={style.id}>{style.label}</option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          抠图背景
                          <input type="color" value={keyColor} onChange={(event) => setKeyColor(event.target.value)} />
                        </label>
                      </div>
                      <div className="prompt-grid">
                        <label className="field">
                          系统提示词
                          <textarea aria-label="设置基准模板系统提示词" value={imageSystemPrompt} rows={7} onChange={(event) => setImageSystemPrompt(event.target.value)} />
                        </label>
                        <label className="field">
                          自定义提示词
                          <textarea aria-label="设置基准模板自定义提示词" value={imageCustomPrompt} rows={7} onChange={(event) => setImageCustomPrompt(event.target.value)} />
                        </label>
                      </div>
                      <label className="field prompt-final">
                        最终图片提示词
                        <textarea aria-label="设置基准模板最终图片提示词" value={currentFinalImagePrompt} rows={5} readOnly />
                      </label>
                    </div>
                  )
                },
                {
                  group: "walk",
                  onSave: handleSaveDirectionTemplateDraft,
                  content: (
                    <div className="module01-settings-fields">
                      <div className="form-grid">
                        <label className="field">
                          图像模型
                          <select aria-label="设置步行图像模型" value={directionImageModel} onChange={(event) => setDirectionImageModel(event.target.value)}>
                            {imageModels.map((model) => (
                              <option key={model.id} value={model.id}>{model.label}</option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          图片尺寸
                          <select aria-label="设置步行图片生成尺寸" value={directionImageGenerationSize} onChange={(event) => setDirectionImageGenerationSize(Number(event.target.value))}>
                            {directionImageGenerationSizeOptions.map((option) => (
                              <option key={option.size} value={option.size}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="prompt-grid">
                        <label className="field">
                          步行系统提示词
                          <textarea aria-label="设置步行系统提示词" value={directionWalkSystemPrompt} rows={7} onChange={(event) => setDirectionWalkSystemPrompt(event.target.value)} />
                        </label>
                        <label className="field">
                          步行自定义提示词
                          <textarea aria-label="设置步行自定义提示词" value={directionWalkCustomPrompt} rows={7} onChange={(event) => setDirectionWalkCustomPrompt(event.target.value)} />
                        </label>
                      </div>
                      <label className="field prompt-final">
                        步行最终提示词
                        <textarea aria-label="设置步行最终提示词" value={finalDirectionWalkPrompt} rows={5} readOnly />
                      </label>
                    </div>
                  )
                },
                {
                  group: "idle",
                  onSave: handleSaveDirectionTemplateDraft,
                  content: (
                    <div className="module01-settings-fields">
                      <div className="form-grid">
                        <label className="field">
                          图像模型
                          <select aria-label="设置待机图像模型" value={directionImageModel} onChange={(event) => setDirectionImageModel(event.target.value)}>
                            {imageModels.map((model) => (
                              <option key={model.id} value={model.id}>{model.label}</option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          图片尺寸
                          <select aria-label="设置待机图片生成尺寸" value={directionImageGenerationSize} onChange={(event) => setDirectionImageGenerationSize(Number(event.target.value))}>
                            {directionImageGenerationSizeOptions.map((option) => (
                              <option key={option.size} value={option.size}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="prompt-grid">
                        <label className="field">
                          待机系统提示词
                          <textarea aria-label="设置待机系统提示词" value={directionIdleSystemPrompt} rows={7} onChange={(event) => setDirectionIdleSystemPrompt(event.target.value)} />
                        </label>
                        <label className="field">
                          待机自定义提示词
                          <textarea aria-label="设置待机自定义提示词" value={directionIdleCustomPrompt} rows={7} onChange={(event) => setDirectionIdleCustomPrompt(event.target.value)} />
                        </label>
                      </div>
                      <label className="field prompt-final">
                        待机最终提示词
                        <textarea aria-label="设置待机最终提示词" value={finalDirectionIdlePrompt} rows={5} readOnly />
                      </label>
                    </div>
                  )
                },
                {
                  group: "run",
                  onSave: handleSaveVideoDraft,
                  content: (
                    <div className="module01-settings-fields">
                      <VideoDefaultFields
                        title="设置跑步"
                        videoModel={videoModel}
                        videoDurationSeconds={videoDurationSeconds}
                        videoResolution={videoResolution}
                        videoDurationOptions={videoDurationOptions}
                        videoResolutionOptions={videoResolutionOptions}
                        videoModels={videoModels}
                        onChangeVideoModel={handleChangeVideoModel}
                        onChangeVideoDuration={setVideoDurationSeconds}
                        onChangeVideoResolution={setVideoResolution}
                      />
                      <div className="prompt-grid">
                        <label className="field">
                          跑步首帧系统提示词
                          <textarea aria-label="设置跑步首帧系统提示词" value={advancedRunSystemPrompt} rows={7} onChange={(event) => setAdvancedRunSystemPrompt(event.target.value)} />
                        </label>
                        <label className="field">
                          跑步首帧自定义提示词
                          <textarea aria-label="设置跑步首帧自定义提示词" value={advancedRunCustomPrompt} rows={7} onChange={(event) => setAdvancedRunCustomPrompt(event.target.value)} />
                        </label>
                        <label className="field">
                          跑步视频系统提示词
                          <textarea aria-label="设置跑步视频系统提示词" value={advancedRunVideoSystemPrompt} rows={7} onChange={(event) => setAdvancedRunVideoSystemPrompt(event.target.value)} />
                        </label>
                        <label className="field">
                          跑步视频自定义提示词
                          <textarea aria-label="设置跑步视频自定义提示词" value={advancedRunVideoCustomPrompt} rows={7} onChange={(event) => setAdvancedRunVideoCustomPrompt(event.target.value)} />
                        </label>
                      </div>
                    </div>
                  )
                },
                {
                  group: "attack-1",
                  onSave: handleSaveVideoDraft,
                  content: (
                    <div className="module01-settings-fields">
                      <VideoDefaultFields
                        title="设置攻击 1"
                        videoModel={videoModel}
                        videoDurationSeconds={videoDurationSeconds}
                        videoResolution={videoResolution}
                        videoDurationOptions={videoDurationOptions}
                        videoResolutionOptions={videoResolutionOptions}
                        videoModels={videoModels}
                        onChangeVideoModel={handleChangeVideoModel}
                        onChangeVideoDuration={setVideoDurationSeconds}
                        onChangeVideoResolution={setVideoResolution}
                      />
                      <div className="form-grid">
                        <label className="field">
                          准备缩放比例
                          <input aria-label="设置攻击 1 准备缩放比例" type="number" min="0.45" max="0.95" step="0.01" value={advancedAttackStartScale} onChange={(event) => setAdvancedAttackStartScale(normalizeAdvancedStartScale(Number(event.target.value), advancedAttackStartScale))} />
                        </label>
                      </div>
                      <div className="prompt-grid">
                        <label className="field">
                          攻击视频系统提示词
                          <textarea aria-label="设置攻击 1 视频系统提示词" value={advancedAttackSystemPrompt} rows={7} onChange={(event) => setAdvancedAttackSystemPrompt(event.target.value)} />
                        </label>
                        <label className="field">
                          攻击视频自定义提示词
                          <textarea aria-label="设置攻击 1 视频自定义提示词" value={advancedAttackCustomPrompt} rows={7} onChange={(event) => setAdvancedAttackCustomPrompt(event.target.value)} />
                        </label>
                        <label className="field">
                          攻击中间帧自定义提示词
                          <textarea aria-label="设置攻击 1 中间帧自定义提示词" value={advancedAttackMidframeCustomPrompt} rows={7} onChange={(event) => setAdvancedAttackMidframeCustomPrompt(event.target.value)} />
                        </label>
                      </div>
                    </div>
                  )
                },
                {
                  group: "jump",
                  onSave: handleSaveVideoDraft,
                  content: (
                    <div className="module01-settings-fields">
                      <VideoDefaultFields
                        title="设置跳跃"
                        videoModel={videoModel}
                        videoDurationSeconds={videoDurationSeconds}
                        videoResolution={videoResolution}
                        videoDurationOptions={videoDurationOptions}
                        videoResolutionOptions={videoResolutionOptions}
                        videoModels={videoModels}
                        onChangeVideoModel={handleChangeVideoModel}
                        onChangeVideoDuration={setVideoDurationSeconds}
                        onChangeVideoResolution={setVideoResolution}
                      />
                      <div className="form-grid">
                        <label className="field">
                          准备缩放比例
                          <input aria-label="设置跳跃准备缩放比例" type="number" min="0.45" max="0.95" step="0.01" value={advancedJumpStartScale} onChange={(event) => setAdvancedJumpStartScale(normalizeAdvancedStartScale(Number(event.target.value), advancedJumpStartScale))} />
                        </label>
                      </div>
                      <div className="prompt-grid">
                        <label className="field">
                          跳跃视频系统提示词
                          <textarea aria-label="设置跳跃视频系统提示词" value={advancedJumpSystemPrompt} rows={7} onChange={(event) => setAdvancedJumpSystemPrompt(event.target.value)} />
                        </label>
                        <label className="field">
                          跳跃视频自定义提示词
                          <textarea aria-label="设置跳跃视频自定义提示词" value={advancedJumpCustomPrompt} rows={7} onChange={(event) => setAdvancedJumpCustomPrompt(event.target.value)} />
                        </label>
                      </div>
                    </div>
                  )
                },
                {
                  group: "character-preview",
                  onSave: handleSaveVideoDraft,
                  content: <EmptyPanel label="角色预览默认参数将在预览页生效。" />
                },
                {
                  group: "godot-export",
                  onSave: handleSaveVideoDraft,
                  content: (
                    <div className="form-grid">
                      <label className="field">
                        导出尺寸
                        <select aria-label="设置 Godot 导出尺寸" value={godotExportSize} onChange={(event) => setGodotExportSize(normalizeGodotExportSize(Number(event.target.value)))}>
                          {GODOT_EXPORT_SIZE_OPTIONS.map((size) => (
                            <option key={size} value={size}>{size} x {size}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )
                }
              ]}
            />
          ) : null}

          {activePage === "one-click-character" ? (
            <WorkflowStage
              title="一键生成"
              status={oneClickStatus}
              mediaPanes={[
                {
                  title: "角色参考",
                  content: <ImagePreview alt="一键生成角色参考图预览" preview={oneClickReferencePreview} emptyLabel="等待角色参考图" />
                },
                {
                  title: "生成结果",
                  content: <ImagePreview alt="一键生成基准模板预览" preview={firstFrameOutputPreview} emptyLabel="完成后自动加载角色结果" />
                }
              ]}
              controls={(
                <>
                  <div className="form-grid">
                    <label className="field">
                      角色名称
                      <input
                        aria-label="一键生成角色名称"
                        placeholder="输入新角色名"
                        value={oneClickCharacterName}
                        onChange={(event) => setOneClickCharacterName(event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="control-row">
                    <label className="file-picker">
                      <Upload size={16} /> 上传角色参考图
                      <input
                        aria-label="一键生成角色参考图"
                        className="visually-hidden"
                        type="file"
                        accept="image/*"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) {
                            handleOneClickReferenceUpload(file);
                          }
                        }}
                      />
                    </label>
                    <button
                      className="tool-button primary"
                      type="button"
                      disabled={isStartingOneClick}
                      onClick={() => void handleStartOneClickCharacterJob()}
                    >
                      <WandSparkles size={16} /> {isStartingOneClick ? "启动中" : "开始一键生成角色"}
                    </button>
                  </div>
                  <div className="one-click-action-grid" aria-label="一键生成动作选择">
                    <label><input aria-label="一键生成步行" type="checkbox" checked disabled readOnly /> 步行</label>
                    <label><input aria-label="一键生成待机" type="checkbox" checked disabled readOnly /> 待机</label>
                    <label><input aria-label="一键生成跑步" type="checkbox" checked={oneClickIncludeRun} onChange={(event) => setOneClickIncludeRun(event.target.checked)} /> 跑步</label>
                    <label><input aria-label="一键生成攻击 1" type="checkbox" checked={oneClickIncludeAttack} onChange={(event) => setOneClickIncludeAttack(event.target.checked)} /> 攻击 1</label>
                    <label><input aria-label="一键生成跳跃" type="checkbox" checked={oneClickIncludeJump} onChange={(event) => setOneClickIncludeJump(event.target.checked)} /> 跳跃</label>
                  </div>
                  <div className="one-click-progress-panel">
                    <div className="one-click-progress-header">
                      <span>生成进度</span>
                      <strong>{oneClickProgress}%</strong>
                    </div>
                    <div
                      aria-label="一键生成进度"
                      aria-valuemax={100}
                      aria-valuemin={0}
                      aria-valuenow={oneClickProgress}
                      className="one-click-progress-bar"
                      role="progressbar"
                    >
                      <span style={{ width: `${oneClickProgress}%` }} />
                    </div>
                    <div className="one-click-step-list">
                      {(oneClickJob?.steps ?? []).map((step) => (
                        <span key={step.id} className={`one-click-step one-click-step-${step.status}`}>
                          {step.label}：{formatOneClickStepStatus(step.status)}
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              )}
            />
          ) : null}

          {activePage === "base-template" ? (
          <WorkflowStage
              title="基准模板"
            status={firstFrameStatus}
            mediaPanes={[
              {
                title: "角色参考",
                content: <ImagePreview alt="角色参考图预览" preview={characterReferencePreview} emptyLabel="等待角色参考图" />
              },
              {
                title: "基准模板",
                content: <ImagePreview alt="基准模板输出预览" preview={firstFrameOutputPreview} emptyLabel="等待基准模板" />
              }
            ]}
            controls={(
              <>
                <div className="control-row">
                  <label className="file-picker">
                    <Upload size={16} /> 上传角色参考图
                    <input
                      aria-label="上传角色参考图"
                      className="visually-hidden"
                      type="file"
                      accept="image/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          handleCharacterReferenceUpload(file);
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
                    <WandSparkles size={16} /> {isProcessingFirstFrame ? "处理中" : "生成基准模板"}
                  </button>
                </div>
                <div className="form-grid">
                  <label className="field">
                    图像模型
                    <select aria-label="图像模型" value={imageModel} onChange={(event) => {
                      setImageModel(event.target.value);
                    }}>
                      {imageModels.map((model) => (
                        <option key={model.id} value={model.id}>{model.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    图片生成尺寸
                    <select
                      aria-label="图片生成尺寸"
                      value={imageGenerationSize}
                      onChange={(event) => {
                        setImageGenerationSize(Number(event.target.value));
                      }}
                    >
                      {imageGenerationSizeOptions.map((option) => (
                        <option key={option.size} value={option.size}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    图片风格
                    <select aria-label="图片风格" value={imageStyle} onChange={(event) => {
                      setImageStyle(event.target.value);
                    }}>
                      {IMAGE_STYLES.map((style) => (
                        <option key={style.id} value={style.id}>{style.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    抠图背景
                    <input type="color" value={keyColor} onChange={(event) => {
                      setKeyColor(event.target.value);
                    }} />
                  </label>
                </div>
                <div className="reference-url-grid reference-url-grid-single">
                  <label className="field">
                    角色参考图公网 URL
                    <input value={uploadedCharacterReferencePublicUrl} readOnly />
                  </label>
                </div>
              </>
            )}
            footer={(
              <div className="prompt-panel">
                <div className="prompt-grid">
                  <label className="field">
                    系统提示词
                    <textarea aria-label="系统提示词" value={imageSystemPrompt} rows={7} onChange={(event) => {
                      setImageSystemPrompt(event.target.value);
                    }} />
                  </label>
                  <label className="field">
                    自定义提示词
                    <textarea
                      aria-label="自定义提示词"
                      placeholder="填写动作、性格、姿态等本次生成需求"
                      value={imageCustomPrompt}
                      rows={7}
                      onChange={(event) => {
                      setImageCustomPrompt(event.target.value);
                    }} />
                  </label>
                </div>
                <label className="field prompt-final">
                  最终图片提示词
                  <textarea aria-label="最终图片提示词" value={currentFinalImagePrompt} rows={5} readOnly />
                </label>
                <div className="control-row">
                  <button className="tool-button" type="button" onClick={handleSaveFirstFrameDraft}>
                    <Save size={16} /> 保存基准模板配置
                  </button>
                </div>
              </div>
            )}
          />
          ) : null}

          {activePage === "walk" ? (
            <Module01PageStage
              title="步行"
              status={`${directionTemplateStatus} / ${videoStatus} / ${frameStatus}`}
              statusItems={[
                { label: "基准模板", value: effectiveDirectionBaseTemplatePreview ? "已准备" : "缺少", state: effectiveDirectionBaseTemplatePreview ? "ready" : "missing" },
                { label: "步行图片", value: walkDirectionOutputPreview || videoInputPreview ? "已准备" : "缺少", state: walkDirectionOutputPreview || videoInputPreview ? "ready" : "missing" },
                { label: "步行结果", value: fourDirectionResult?.directions.length ? "已处理" : "未处理", state: fourDirectionResult?.directions.length ? "done" : "missing" }
              ]}
            >
              <Module01ActionSection title="步行图片">
                <Module01MediaGrid>
                  <MediaPane title="角色基准模板">
                    <ImagePreview alt="角色基准模板预览" preview={effectiveDirectionBaseTemplatePreview} emptyLabel="等待基准模板" />
                  </MediaPane>
                  <MediaPane title="步行 2x2 输出">
                    <ImagePreview alt="步行 2x2 输出预览" preview={walkDirectionOutputPreview ?? videoInputPreview} emptyLabel="先生成或上传步行 2x2" />
                  </MediaPane>
                </Module01MediaGrid>
                <div className="control-row">
                  <label className="file-picker">
                    <Upload size={16} /> 上传角色基准模板
                    <input
                      aria-label="上传角色基准模板"
                      className="visually-hidden"
                      type="file"
                      accept="image/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          handleDirectionBaseTemplateUpload(file);
                        }
                      }}
                    />
                  </label>
                  <button
                    className="tool-button primary"
                    type="button"
                    disabled={processingDirectionTemplate !== null}
                    onClick={() => void handleGenerateDirectionTemplate("walk")}
                  >
                    <WandSparkles size={16} /> {processingDirectionTemplate === "walk" ? "生成中" : "生成步行 2x2"}
                  </button>
                  <label className="file-picker">
                    <Upload size={16} /> 上传 2x2 步行图
                    <input
                      aria-label="上传 2x2 步行图"
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
                </div>
                <div className="form-grid">
                  <label className="field">
                    图像模型
                    <select aria-label="图像模型" value={directionImageModel} onChange={(event) => setDirectionImageModel(event.target.value)}>
                      {imageModels.map((model) => (
                        <option key={model.id} value={model.id}>{model.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    图片尺寸
                    <select aria-label="图片尺寸" value={directionImageGenerationSize} onChange={(event) => setDirectionImageGenerationSize(Number(event.target.value))}>
                      {directionImageGenerationSizeOptions.map((option) => (
                        <option key={option.size} value={option.size}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    抠图背景
                    <input type="color" value={keyColor} onChange={(event) => setKeyColor(event.target.value)} />
                  </label>
                </div>
                <Module01AdvancedDetails title="步行图片提示词">
                  <section className="prompt-section">
                    <h3>步行图片提示词</h3>
                    <div className="prompt-grid">
                      <label className="field">
                        步行系统提示词
                        <textarea aria-label="步行系统提示词" value={directionWalkSystemPrompt} rows={7} onChange={(event) => setDirectionWalkSystemPrompt(event.target.value)} />
                      </label>
                      <label className="field">
                        步行自定义提示词
                        <textarea aria-label="步行自定义提示词" placeholder="填写步行幅度、性格、节奏等要求" value={directionWalkCustomPrompt} rows={7} onChange={(event) => setDirectionWalkCustomPrompt(event.target.value)} />
                      </label>
                    </div>
                    <label className="field prompt-final">
                      步行最终提示词
                      <textarea aria-label="步行最终提示词" value={finalDirectionWalkPrompt} rows={5} readOnly />
                    </label>
                  </section>
                  <button className="tool-button" type="button" onClick={handleSaveDirectionTemplateDraft}>
                    <Save size={16} /> 保存步行配置
                  </button>
                </Module01AdvancedDetails>
              </Module01ActionSection>
              <Module01ActionSection title="步行视频与一键处理">
                <Module01MediaGrid>
                  <MediaPane title="步行视频预览">
                    <VideoPreview label="帧处理视频输入预览" preview={frameVideoInputPreview ?? videoOutputPreview} emptyLabel="等待视频结果" />
                  </MediaPane>
                  <MediaPane title="处理状态">
                    <EmptyMedia label={fourDirectionResult?.directions.length ? "步行已处理" : "等待一键处理"} />
                  </MediaPane>
                </Module01MediaGrid>
                <div className="control-row">
                  <button
                    className="tool-button"
                    type="button"
                    disabled={isSubmittingVideo}
                    onClick={() => void handleSubmitVideo()}
                  >
                    <Play size={16} /> {isSubmittingVideo ? "提交中" : "提交视频任务"}
                  </button>
                  <label className="file-picker">
                    <Upload size={16} /> 上传步行视频
                    <input
                      aria-label="上传步行视频"
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
                    onClick={() => void handleProcessFourDirection()}
                  >
                    <Scissors size={16} /> {isProcessingFrames ? "处理中" : "一键处理"}
                  </button>
                  <button
                    className="tool-button"
                    type="button"
                    disabled={activePreviewFrameCount === 0}
                    onClick={() => setIsPlayingFrames((current) => !current)}
                  >
                    {isPlayingFrames ? <Pause size={16} /> : <Play size={16} />} {isPlayingFrames ? "暂停预览" : "播放预览"}
                  </button>
                </div>
                <div className="form-grid">
                  <label className="field">
                    视频模型
                    <select aria-label="视频模型" value={videoModel} onChange={(event) => handleChangeVideoModel(event.target.value)}>
                      {videoModels.map((model) => (
                        <option key={model.id} value={model.id}>{model.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    视频时长
                    <select aria-label="视频时长" value={String(videoDurationSeconds)} onChange={(event) => setVideoDurationSeconds(Number(event.target.value))}>
                      {videoDurationOptions.map((duration) => (
                        <option key={duration} value={duration}>{duration} 秒</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    视频分辨率
                    <select aria-label="视频分辨率" value={videoResolution} onChange={(event) => setVideoResolution(event.target.value)}>
                      {videoResolutionOptions.map((resolution) => (
                        <option key={resolution} value={resolution}>{resolution}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <Module01AdvancedDetails title="处理参数与视频提示词">
                  <div className="form-grid">
                    <label className="field">
                      抽帧数量
                      <input aria-label="抽帧数量" type="number" min={1} max={120} value={frameCount} onChange={(event) => setFrameCount(clamp(Number(event.target.value), 1, 120))} />
                    </label>
                    <label className="field">
                      预览 FPS
                      <input aria-label="预览 FPS" type="number" min={1} max={FPS_MAX} value={fps} onChange={(event) => setFps(clamp(Number(event.target.value), 1, FPS_MAX))} />
                    </label>
                    <label className="field">
                      抠图容差
                      <input aria-label="抠图容差" type="number" min={0} max={255} value={tolerance} onChange={(event) => setTolerance(clamp(Number(event.target.value), 0, 255))} />
                    </label>
                    <label className="field">
                      最小循环帧数
                      <input aria-label="最小循环帧数" type="number" min={2} max={120} value={minLoopFrames} onChange={(event) => setMinLoopFrames(clamp(Number(event.target.value), 2, 120))} />
                    </label>
                    <label className="field">
                      最大循环帧数
                      <input aria-label="最大循环帧数" type="number" min={2} max={120} value={maxLoopFrames} onChange={(event) => setMaxLoopFrames(clamp(Number(event.target.value), 2, 120))} />
                    </label>
                    <label className="field">
                      导出单帧尺寸
                      <input aria-label="导出单帧尺寸" type="number" min={64} max={1024} value={exportFrameSize} onChange={(event) => setExportFrameSize(clamp(Number(event.target.value), 64, 1024))} />
                    </label>
                  </div>
                  <section className="prompt-section">
                    <h3>步行视频提示词</h3>
                    <label className="field">
                      视频系统提示词
                      <textarea aria-label="视频系统提示词" value={videoSystemPrompt} rows={7} onChange={(event) => setVideoSystemPrompt(event.target.value)} />
                    </label>
                    <label className="field">
                      视频自定义提示词
                      <textarea aria-label="视频自定义提示词" value={videoCustomPrompt} rows={4} onChange={(event) => setVideoCustomPrompt(event.target.value)} />
                    </label>
                    <label className="field prompt-final">
                      最终视频提示词
                      <textarea aria-label="最终视频提示词" value={finalVideoPrompt} rows={5} readOnly />
                    </label>
                  </section>
                  {videoStatusDetails ? (
                    <details className="status-details">
                      <summary>视频状态详情</summary>
                      <pre>{videoStatusDetails}</pre>
                    </details>
                  ) : null}
                  <button className="tool-button" type="button" onClick={handleSaveVideoDraft}>
                    <Save size={16} /> 保存视频配置
                  </button>
                </Module01AdvancedDetails>
              </Module01ActionSection>
              <Module01ActionSection title="步行结果">
                <FourDirectionResultPanel result={fourDirectionResult} frameIndex={activeFrameIndex} isPlaying={isPlayingFrames} />
              </Module01ActionSection>
            </Module01PageStage>
          ) : null}

          {activePage === "idle" ? (
            <Module01PageStage
              title="待机"
              status={`${directionTemplateStatus} / ${frameStatus}`}
              statusItems={[
                { label: "步行图片", value: walkDirectionOutputPreview || videoInputPreview ? "已准备" : "缺少", state: walkDirectionOutputPreview || videoInputPreview ? "ready" : "missing" },
                { label: "待机图片", value: idleDirectionOutputPreview ? "已准备" : "缺少", state: idleDirectionOutputPreview ? "ready" : "missing" },
                { label: "待机结果", value: fourDirectionResult?.idle ? "已处理" : "未处理", state: fourDirectionResult?.idle ? "done" : "missing" }
              ]}
            >
              <Module01ActionSection title="待机图片">
                <Module01MediaGrid>
                  <MediaPane title="步行 2x2 基准">
                    <ImagePreview alt="步行 2x2 基准预览" preview={walkDirectionOutputPreview ?? videoInputPreview} emptyLabel="等待步行 2x2" />
                  </MediaPane>
                  <MediaPane title="待机 2x2 输出">
                    <ImagePreview alt="待机 2x2 输出预览" preview={idleDirectionOutputPreview} emptyLabel="先生成待机 2x2" />
                  </MediaPane>
                </Module01MediaGrid>
                <div className="control-row">
                  <button
                    className="tool-button primary"
                    type="button"
                    disabled={processingDirectionTemplate !== null || !walkDirectionOutputPreview}
                    onClick={() => void handleGenerateDirectionTemplate("idle")}
                  >
                    <WandSparkles size={16} /> {processingDirectionTemplate === "idle" ? "生成中" : "生成待机 2x2"}
                  </button>
                </div>
                <div className="form-grid">
                  <label className="field">
                    图像模型
                    <select aria-label="图像模型" value={directionImageModel} onChange={(event) => setDirectionImageModel(event.target.value)}>
                      {imageModels.map((model) => (
                        <option key={model.id} value={model.id}>{model.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    图片尺寸
                    <select aria-label="图片尺寸" value={directionImageGenerationSize} onChange={(event) => setDirectionImageGenerationSize(Number(event.target.value))}>
                      {directionImageGenerationSizeOptions.map((option) => (
                        <option key={option.size} value={option.size}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    抠图背景
                    <input type="color" value={keyColor} onChange={(event) => setKeyColor(event.target.value)} />
                  </label>
                </div>
                <Module01AdvancedDetails title="待机图片提示词">
                  <section className="prompt-section">
                    <h3>待机图片提示词</h3>
                    <div className="prompt-grid">
                      <label className="field">
                        待机系统提示词
                        <textarea aria-label="待机系统提示词" value={directionIdleSystemPrompt} rows={7} onChange={(event) => setDirectionIdleSystemPrompt(event.target.value)} />
                      </label>
                      <label className="field">
                        待机自定义提示词
                        <textarea aria-label="待机自定义提示词" placeholder="填写待机姿态、气质、细节要求" value={directionIdleCustomPrompt} rows={7} onChange={(event) => setDirectionIdleCustomPrompt(event.target.value)} />
                      </label>
                    </div>
                    <label className="field prompt-final">
                      待机最终提示词
                      <textarea aria-label="待机最终提示词" value={finalDirectionIdlePrompt} rows={5} readOnly />
                    </label>
                  </section>
                  <button className="tool-button" type="button" onClick={handleSaveDirectionTemplateDraft}>
                    <Save size={16} /> 保存待机配置
                  </button>
                </Module01AdvancedDetails>
              </Module01ActionSection>
              <Module01ActionSection title="待机一键处理">
                <div className="control-row">
                  <button
                    className="tool-button primary"
                    type="button"
                    disabled={isProcessingFrames || !fourDirectionResult?.directions.length}
                    onClick={() => void handleProcessIdleDirection()}
                  >
                    <Scissors size={16} /> {isProcessingFrames ? "处理中" : "一键处理"}
                  </button>
                  <span className="state-pill">{fourDirectionResult?.directions.length ? "已读取步行处理结果，可对齐待机。" : "请先完成步行一键处理。"}</span>
                </div>
                <Module01AdvancedDetails title="待机处理参数">
                  <div className="form-grid">
                    <label className="field">
                      抠图容差
                      <input aria-label="抠图容差" type="number" min={0} max={255} value={tolerance} onChange={(event) => setTolerance(clamp(Number(event.target.value), 0, 255))} />
                    </label>
                  </div>
                </Module01AdvancedDetails>
              </Module01ActionSection>
              <Module01ActionSection title="待机结果">
                <Module01MediaGrid>
                  <MediaPane title="待机 Sprite Sheet">
                    <IdleSpriteSheetPreview idle={fourDirectionResult?.idle} />
                  </MediaPane>
                  <MediaPane title="待机处理状态">
                    <EmptyMedia label={fourDirectionResult?.idle ? "待机已处理" : "等待待机处理"} />
                  </MediaPane>
                </Module01MediaGrid>
                <section className="loop-result-section">
                  <div className="loop-section-heading">
                    <h3>待机处理结果</h3>
                    <span>{fourDirectionResult?.idle ? "已按步行导出规格对齐" : "等待待机一键处理"}</span>
                  </div>
                  <IdleDirectionPreviewGrid idle={fourDirectionResult?.idle} />
                </section>
                <div className="control-row">
                  <DownloadLink href={fourDirectionResult?.idle?.spriteSheetUrl} label="导出待机 Sprite Sheet" />
                </div>
              </Module01ActionSection>
            </Module01PageStage>
          ) : null}

          {activePage === "run" ? (
            <AdvancedActionStage
              actionKind="run"
              title="跑步"
              status={advancedActions.run.status}
              baseInputPreview={walkDirectionOutputPreview}
              keyframePreview={advancedActions.run.keyframePreview}
              inputPreview={advancedActions.run.inputPreview}
              outputPreview={advancedActions.run.outputPreview}
              result={advancedActions.run.result}
              statusDetails={advancedActions.run.statusDetails}
              systemPrompt={advancedRunSystemPrompt}
              customPrompt={advancedRunCustomPrompt}
              finalPrompt={finalAdvancedRunPrompt}
              runVideoSystemPrompt={advancedRunVideoSystemPrompt}
              runVideoCustomPrompt={advancedRunVideoCustomPrompt}
              runFinalVideoPrompt={finalAdvancedRunVideoPrompt}
              videoModel={videoModel}
              videoDurationSeconds={videoDurationSeconds}
              videoResolution={videoResolution}
              videoDurationOptions={videoDurationOptions}
              videoResolutionOptions={videoResolutionOptions}
              videoModels={videoModels}
              imageModels={imageModels}
              imageModel={directionImageModel}
              imageGenerationSize={directionImageGenerationSize}
              imageGenerationSizeOptions={directionImageGenerationSizeOptions}
              isGeneratingKeyframe={advancedActions.run.isGeneratingKeyframe}
              isSubmittingVideo={advancedActions.run.isSubmittingVideo}
              isProcessing={advancedActions.run.isProcessing}
              onGenerateKeyframe={() => void handleGenerateRunKeyframe()}
              onSubmitVideo={() => void handleSubmitAdvancedVideo("run")}
              onProcess={() => void handleProcessAdvancedAction("run")}
              onChangeVideoModel={handleChangeVideoModel}
              onChangeVideoDuration={setVideoDurationSeconds}
              onChangeVideoResolution={setVideoResolution}
              onChangeImageModel={setDirectionImageModel}
              onChangeImageGenerationSize={setDirectionImageGenerationSize}
              onChangeSystemPrompt={setAdvancedRunSystemPrompt}
              onChangeCustomPrompt={setAdvancedRunCustomPrompt}
              onChangeRunVideoSystemPrompt={setAdvancedRunVideoSystemPrompt}
              onChangeRunVideoCustomPrompt={setAdvancedRunVideoCustomPrompt}
              onSaveConfig={handleSaveVideoDraft}
            />
          ) : null}

          {activePage === "attack-1" ? (
            <AdvancedActionStage
              actionKind="attack-1"
              title="攻击 1"
              status={advancedActions["attack-1"].status}
              baseInputPreview={idleDirectionOutputPreview}
              inputPreview={advancedActions["attack-1"].inputPreview}
              middleFramePreview={advancedActions["attack-1"].middleFramePreview}
              outputPreview={advancedActions["attack-1"].outputPreview}
              result={advancedActions["attack-1"].result}
              statusDetails={advancedActions["attack-1"].statusDetails}
              systemPrompt={advancedAttackSystemPrompt}
              customPrompt={advancedAttackCustomPrompt}
              finalPrompt={finalAdvancedAttackPrompt}
              videoModel={videoModel}
              videoDurationSeconds={videoDurationSeconds}
              videoResolution={videoResolution}
              videoDurationOptions={videoDurationOptions}
              videoResolutionOptions={videoResolutionOptions}
              videoModels={videoModels}
              imageModels={imageModels}
              imageModel={directionImageModel}
              imageGenerationSize={directionImageGenerationSize}
              imageGenerationSizeOptions={directionImageGenerationSizeOptions}
              startScale={advancedAttackStartScale}
              isGeneratingMidframe={advancedActions["attack-1"].isGeneratingMidframe}
              isPreparingInput={advancedActions["attack-1"].isPreparingInput}
              isSubmittingVideo={advancedActions["attack-1"].isSubmittingVideo}
              isProcessing={advancedActions["attack-1"].isProcessing}
              onPrepareInput={() => void handlePrepareAdvancedStartFrame("attack-1")}
              onGenerateMiddleFrame={() => void handleGenerateAttackMidframe()}
              onSubmitVideo={() => void handleSubmitAdvancedVideo("attack-1")}
              onProcess={() => void handleProcessAdvancedAction("attack-1")}
              onChangeVideoModel={handleChangeVideoModel}
              onChangeVideoDuration={setVideoDurationSeconds}
              onChangeVideoResolution={setVideoResolution}
              onChangeImageModel={setDirectionImageModel}
              onChangeImageGenerationSize={setDirectionImageGenerationSize}
              onChangeStartScale={setAdvancedAttackStartScale}
              onChangeSystemPrompt={setAdvancedAttackSystemPrompt}
              onChangeCustomPrompt={setAdvancedAttackCustomPrompt}
              attackMidframeCustomPrompt={advancedAttackMidframeCustomPrompt}
              onChangeAttackMidframeCustomPrompt={setAdvancedAttackMidframeCustomPrompt}
              onSaveConfig={handleSaveVideoDraft}
            />
          ) : null}

          {activePage === "jump" ? (
            <AdvancedActionStage
              actionKind="jump"
              title="跳跃"
              status={advancedActions.jump.status}
              baseInputPreview={idleDirectionOutputPreview}
              inputPreview={advancedActions.jump.inputPreview}
              outputPreview={advancedActions.jump.outputPreview}
              result={advancedActions.jump.result}
              statusDetails={advancedActions.jump.statusDetails}
              systemPrompt={advancedJumpSystemPrompt}
              customPrompt={advancedJumpCustomPrompt}
              finalPrompt={finalAdvancedJumpPrompt}
              videoModel={videoModel}
              videoDurationSeconds={videoDurationSeconds}
              videoResolution={videoResolution}
              videoDurationOptions={videoDurationOptions}
              videoResolutionOptions={videoResolutionOptions}
              videoModels={videoModels}
              imageModels={imageModels}
              imageModel={directionImageModel}
              imageGenerationSize={directionImageGenerationSize}
              imageGenerationSizeOptions={directionImageGenerationSizeOptions}
              startScale={advancedJumpStartScale}
              isPreparingInput={advancedActions.jump.isPreparingInput}
              isSubmittingVideo={advancedActions.jump.isSubmittingVideo}
              isProcessing={advancedActions.jump.isProcessing}
              onPrepareInput={() => void handlePrepareAdvancedStartFrame("jump")}
              onSubmitVideo={() => void handleSubmitAdvancedVideo("jump")}
              onProcess={() => void handleProcessAdvancedAction("jump")}
              onChangeVideoModel={handleChangeVideoModel}
              onChangeVideoDuration={setVideoDurationSeconds}
              onChangeVideoResolution={setVideoResolution}
              onChangeImageModel={setDirectionImageModel}
              onChangeImageGenerationSize={setDirectionImageGenerationSize}
              onChangeStartScale={setAdvancedJumpStartScale}
              onChangeSystemPrompt={setAdvancedJumpSystemPrompt}
              onChangeCustomPrompt={setAdvancedJumpCustomPrompt}
              onSaveConfig={handleSaveVideoDraft}
            />
          ) : null}

          {activePage === "character-preview" ? (
            <CharacterPreviewStage
              characterId={activeCharacterId}
              result={fourDirectionResult}
              advancedActions={{
                run: advancedActions.run.result,
                attack1: advancedActions["attack-1"].result,
                jump: advancedActions.jump.result
              }}
            />
          ) : null}

          {activePage === "godot-export" ? (
            <GodotExportStage
              activeCharacterId={activeCharacterId}
              exportSize={godotExportSize}
              status={godotExportStatus}
              result={godotExportResult}
              isExporting={isExportingGodot}
              onChangeExportSize={setGodotExportSize}
              onExport={handleCreateGodotExport}
            />
          ) : null}
        </div>
      </section>
    </main>
  );
}

function Module01NavIcon({ page }: { page: Module01Page }) {
  if (page === "one-click-character") {
    return <WandSparkles size={18} />;
  }
  if (page === "character-preview") {
    return <Gamepad2 size={18} />;
  }
  if (page === "godot-export") {
    return <Download size={18} />;
  }
  if (page === "module-settings") {
    return <Settings size={18} />;
  }
  return null;
}

function GodotExportStage({
  activeCharacterId,
  exportSize,
  status,
  result,
  isExporting,
  onChangeExportSize,
  onExport
}: {
  activeCharacterId: string;
  exportSize: GodotExportSize;
  status: string;
  result: GodotExportResult | null;
  isExporting: boolean;
  onChangeExportSize: (size: GodotExportSize) => void;
  onExport: () => void;
}) {
  return (
    <section className="workflow-stage godot-export-stage">
      <div className="stage-heading">
        <h2>导出</h2>
        <span>{status}</span>
      </div>
      <div className="export-grid godot-export-grid">
        <div className="export-actions">
          <label className="field">
            Godot 导出尺寸
            <select
              aria-label="Godot 导出尺寸"
              value={exportSize}
              onChange={(event) => onChangeExportSize(normalizeGodotExportSize(Number(event.target.value)))}
            >
              {GODOT_EXPORT_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
          <button
            className="tool-button primary"
            type="button"
            disabled={!activeCharacterId || isExporting}
            onClick={() => onExport()}
          >
            <Download size={18} /> {isExporting ? "导出中..." : "生成 Godot 导出包"}
          </button>
          <p className="prompt-hint">
            当前角色：{activeCharacterId || "未选择角色"}。导出会读取该角色已经处理好的待机、步行、跑步、攻击 1、跳跃透明帧。
          </p>
        </div>
        <div className="export-actions godot-export-result">
          <strong>导出结果</strong>
          <span>尺寸：{result ? `${result.exportSize}x${result.exportSize}` : `${exportSize}x${exportSize}`}</span>
          <span>动作：{result?.exportedActions.length ? result.exportedActions.join(" / ") : "等待导出"}</span>
          <span>动画组：{result?.animationCount ?? 0}</span>
          <span>导出目录：{result?.exportRootPath ?? "等待导出"}</span>
          <DownloadLink href={result?.zipUrl} label="下载 Godot 导出 ZIP" />
          <DownloadLink href={result?.manifestUrl} label="下载 animations.json" />
          <DownloadLink href={result?.importScriptUrl} label="下载 import_to_godot.gd" />
        </div>
      </div>
    </section>
  );
}

function WorkflowStage({
  title,
  status,
  inputTitle,
  outputTitle,
  input,
  output,
  mediaPanes,
  controls,
  footer
}: {
  title: string;
  status: string;
  inputTitle?: string;
  outputTitle?: string;
  input?: React.ReactNode;
  output?: React.ReactNode;
  mediaPanes?: readonly { title: string; content: React.ReactNode }[];
  controls: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const resolvedMediaPanes = mediaPanes ?? [
    { title: inputTitle ?? "输入预览", content: input },
    { title: outputTitle ?? "输出预览", content: output }
  ];
  return (
    <section className={["workflow-stage", resolvedMediaPanes.length >= 3 ? "workflow-stage-three-media" : ""].filter(Boolean).join(" ")}>
      <div className="stage-heading">
        <h2>{title}</h2>
        <span>{status}</span>
      </div>
      <div className={["stage-media-grid", resolvedMediaPanes.length >= 3 ? "stage-media-grid-three" : ""].filter(Boolean).join(" ")}>
        {resolvedMediaPanes.map((pane) => (
          <MediaPane key={pane.title} title={pane.title}>{pane.content}</MediaPane>
        ))}
      </div>
      <div className="stage-controls">{controls}</div>
      {footer ? <div className="stage-footer">{footer}</div> : null}
    </section>
  );
}

function VideoDefaultFields({
  title,
  videoModel,
  videoDurationSeconds,
  videoResolution,
  videoDurationOptions,
  videoResolutionOptions,
  videoModels,
  onChangeVideoModel,
  onChangeVideoDuration,
  onChangeVideoResolution
}: {
  title: string;
  videoModel: string;
  videoDurationSeconds: number;
  videoResolution: string;
  videoDurationOptions: readonly number[];
  videoResolutionOptions: readonly string[];
  videoModels: readonly VideoModelOption[];
  onChangeVideoModel: (model: string) => void;
  onChangeVideoDuration: (duration: number) => void;
  onChangeVideoResolution: (resolution: string) => void;
}) {
  return (
    <div className="form-grid">
      <label className="field">
        视频模型
        <select aria-label={`${title}视频模型`} value={videoModel} onChange={(event) => onChangeVideoModel(event.target.value)}>
          {videoModels.map((model) => (
            <option key={model.id} value={model.id}>{model.label}</option>
          ))}
        </select>
      </label>
      <label className="field">
        视频时长
        <select aria-label={`${title}视频时长`} value={String(videoDurationSeconds)} onChange={(event) => onChangeVideoDuration(Number(event.target.value))}>
          {videoDurationOptions.map((duration) => (
            <option key={duration} value={duration}>{duration} 秒</option>
          ))}
        </select>
      </label>
      <label className="field">
        视频分辨率
        <select aria-label={`${title}视频分辨率`} value={videoResolution} onChange={(event) => onChangeVideoResolution(event.target.value)}>
          {videoResolutionOptions.map((resolution) => (
            <option key={resolution} value={resolution}>{resolution}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

function AdvancedActionStage({
  actionKind,
  title,
  status,
  baseInputPreview,
  keyframePreview,
  inputPreview,
  middleFramePreview,
  outputPreview,
  result,
  statusDetails,
  systemPrompt,
  customPrompt,
  finalPrompt,
  runVideoSystemPrompt,
  runVideoCustomPrompt,
  runFinalVideoPrompt,
  videoModel,
  videoDurationSeconds,
  videoResolution,
  videoDurationOptions,
  videoResolutionOptions,
  videoModels,
  imageModels,
  imageModel,
  imageGenerationSize,
  imageGenerationSizeOptions,
  startScale,
  isGeneratingKeyframe = false,
  isGeneratingMidframe = false,
  isPreparingInput = false,
  isSubmittingVideo,
  isProcessing,
  onGenerateKeyframe,
  onGenerateMiddleFrame,
  onPrepareInput,
  onSubmitVideo,
  onProcess,
  onChangeVideoModel,
  onChangeVideoDuration,
  onChangeVideoResolution,
  onChangeImageModel,
  onChangeImageGenerationSize,
  onChangeStartScale,
  onChangeSystemPrompt,
  onChangeCustomPrompt,
  onChangeRunVideoSystemPrompt,
  onChangeRunVideoCustomPrompt,
  attackMidframeCustomPrompt,
  onChangeAttackMidframeCustomPrompt,
  onSaveConfig
}: {
  actionKind: AdvancedActionKind;
  title: string;
  status: string;
  baseInputPreview?: MediaPreview | null;
  keyframePreview?: MediaPreview | null;
  inputPreview?: MediaPreview | null;
  middleFramePreview?: MediaPreview | null;
  outputPreview?: MediaPreview | null;
  result?: ProcessFourDirectionResult | null;
  statusDetails: string;
  systemPrompt: string;
  customPrompt: string;
  finalPrompt: string;
  runVideoSystemPrompt?: string;
  runVideoCustomPrompt?: string;
  runFinalVideoPrompt?: string;
  videoModel: string;
  videoDurationSeconds: number;
  videoResolution: string;
  videoDurationOptions: readonly number[];
  videoResolutionOptions: readonly string[];
  videoModels: readonly VideoModelOption[];
  imageModels: readonly ImageModelOption[];
  imageModel: string;
  imageGenerationSize: number;
  imageGenerationSizeOptions: readonly ImageGenerationSizeOption[];
  startScale?: number;
  isGeneratingKeyframe?: boolean;
  isGeneratingMidframe?: boolean;
  isPreparingInput?: boolean;
  isSubmittingVideo: boolean;
  isProcessing: boolean;
  onGenerateKeyframe?: () => void;
  onGenerateMiddleFrame?: () => void;
  onPrepareInput?: () => void;
  onSubmitVideo: () => void;
  onProcess: () => void;
  onChangeVideoModel: (model: string) => void;
  onChangeVideoDuration: (duration: number) => void;
  onChangeVideoResolution: (resolution: string) => void;
  onChangeImageModel: (model: string) => void;
  onChangeImageGenerationSize: (size: number) => void;
  onChangeStartScale?: (scale: number) => void;
  onChangeSystemPrompt: (prompt: string) => void;
  onChangeCustomPrompt: (prompt: string) => void;
  onChangeRunVideoSystemPrompt?: (prompt: string) => void;
  onChangeRunVideoCustomPrompt?: (prompt: string) => void;
  attackMidframeCustomPrompt?: string;
  onChangeAttackMidframeCustomPrompt?: (prompt: string) => void;
  onSaveConfig: () => void;
}) {
  const mediaPanes = actionKind === "run"
    ? [
        {
          title: "步行 2x2 基准",
          content: <ImagePreview alt="步行 2x2 基准预览" preview={baseInputPreview ?? null} emptyLabel="等待步行 2x2" />
        },
        {
          title: "跑步首帧",
          content: <ImagePreview alt="跑步首帧预览" preview={keyframePreview ?? inputPreview ?? null} emptyLabel="等待跑步首帧" />
        },
        {
          title: "跑步视频",
          content: <VideoPreview label="跑步视频预览" preview={outputPreview ?? null} emptyLabel="等待跑步视频" />
        }
      ]
    : [
        {
          title: actionKind === "attack-1" ? "攻击起始帧" : "跳跃视频",
          content: actionKind === "attack-1"
            ? <ImagePreview alt="攻击 1 起始帧预览" preview={inputPreview ?? null} emptyLabel="等待攻击起始帧" />
            : <VideoPreview label="跳跃视频预览" preview={outputPreview ?? null} emptyLabel="等待跳跃视频" />
        },
        ...(actionKind === "attack-1" ? [{
          title: "攻击中间帧",
          content: <ImagePreview alt="攻击 1 中间帧预览" preview={middleFramePreview ?? null} emptyLabel="等待攻击中间帧" />
        }] : []),
        {
          title: actionKind === "attack-1" ? "攻击视频" : "动作输出",
          content: actionKind === "attack-1"
            ? <VideoPreview label="攻击 1 视频预览" preview={outputPreview ?? null} emptyLabel="等待攻击视频" />
            : result ? <DirectionPreviewGrid directions={result.directions} frameIndex={0} frameSelector={(direction) => direction.transparentFrames} imageAltSuffix="跳跃预览" showLoopInfo /> : <EmptyMedia label="等待动作处理结果" />
        }
      ];

  const primaryPromptPrefix = actionKind === "run" ? "跑步首帧" : "视频";
  const sectionTitle = (suffix: string) => title === "攻击 1" ? `${title} ${suffix}` : `${title}${suffix}`;
  const labelTitle = (suffix: string) => title === "攻击 1" ? `${title} ${suffix}` : `${title}${suffix}`;

  return (
    <Module01PageStage
      title={title}
      status={status}
      statusItems={[
        { label: "输入", value: baseInputPreview || inputPreview ? "已准备" : "缺少", state: baseInputPreview || inputPreview ? "ready" : "missing" },
        { label: "视频", value: outputPreview ? "已生成" : "未生成", state: outputPreview ? "done" : "missing" },
        { label: "结果", value: result?.directions.length ? "已处理" : "未处理", state: result?.directions.length ? "done" : "missing" }
      ]}
    >
      <Module01ActionSection title={sectionTitle("图片")}>
        <Module01MediaGrid columns={mediaPanes.length >= 3 ? 3 : 2}>
          {mediaPanes.map((pane) => (
            <MediaPane key={pane.title} title={pane.title}>{pane.content}</MediaPane>
          ))}
        </Module01MediaGrid>
      </Module01ActionSection>
      <Module01ActionSection title={sectionTitle("视频与一键处理")}>
        <>
          <div className="control-row">
            {onGenerateKeyframe ? (
              <button className="tool-button primary" type="button" disabled={isGeneratingKeyframe} onClick={onGenerateKeyframe}>
                <WandSparkles size={16} /> {isGeneratingKeyframe ? "生成中" : "生成跑步首帧"}
              </button>
            ) : null}
            {onPrepareInput ? (
              <button className="tool-button primary" type="button" disabled={isPreparingInput} onClick={onPrepareInput}>
                <WandSparkles size={16} /> {isPreparingInput ? "准备中" : actionKind === "attack-1" ? "准备攻击起始帧" : "准备跳跃起始帧"}
              </button>
            ) : null}
            {onGenerateMiddleFrame ? (
              <button className="tool-button primary" type="button" disabled={isGeneratingMidframe} onClick={onGenerateMiddleFrame}>
                <WandSparkles size={16} /> {isGeneratingMidframe ? "生成中" : "生成攻击中间帧"}
              </button>
            ) : null}
            <button className="tool-button" type="button" disabled={isSubmittingVideo} onClick={onSubmitVideo}>
              <Play size={16} /> {isSubmittingVideo ? "提交中" : "提交视频任务"}
            </button>
            <button className="tool-button primary" type="button" disabled={isProcessing} onClick={onProcess}>
              <Scissors size={16} /> {isProcessing ? "处理中" : "一键处理"}
            </button>
            <button className="tool-button" type="button" onClick={onSaveConfig}>
              <Save size={16} /> 保存视频配置
            </button>
          </div>
          <div className="form-grid">
            <label className="field">
              视频模型
              <select aria-label={`${title}视频模型`} value={videoModel} onChange={(event) => onChangeVideoModel(event.target.value)}>
                {videoModels.map((model) => (
                  <option key={model.id} value={model.id}>{model.label}</option>
                ))}
              </select>
            </label>
            <label className="field">
              视频时长
              <select aria-label={`${title}视频时长`} value={String(videoDurationSeconds)} onChange={(event) => onChangeVideoDuration(Number(event.target.value))}>
                {videoDurationOptions.map((duration) => (
                  <option key={duration} value={duration}>{duration} 秒</option>
                ))}
              </select>
            </label>
            <label className="field">
              视频分辨率
              <select aria-label={`${title}视频分辨率`} value={videoResolution} onChange={(event) => onChangeVideoResolution(event.target.value)}>
                {videoResolutionOptions.map((resolution) => (
                  <option key={resolution} value={resolution}>{resolution}</option>
                ))}
              </select>
            </label>
            {onChangeStartScale ? (
              <label className="field">
                准备缩放比例
                <input
                  aria-label={labelTitle("准备缩放比例")}
                  type="number"
                  min="0.45"
                  max="0.95"
                  step="0.01"
                  value={startScale ?? 0.75}
                  onChange={(event) => onChangeStartScale(normalizeAdvancedStartScale(Number(event.target.value), startScale ?? 0.75))}
                />
              </label>
            ) : null}
          </div>
          {actionKind === "attack-1" && onChangeAttackMidframeCustomPrompt ? (
            <section className="prompt-section">
              <h3>攻击中间帧生成</h3>
              <div className="form-grid">
                <label className="field">
                  中间帧图像模型
                  <select aria-label="攻击中间帧图像模型" value={imageModel} onChange={(event) => onChangeImageModel(event.target.value)}>
                    {imageModels.map((model) => (
                      <option key={model.id} value={model.id}>{model.label}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  中间帧图片尺寸
                  <select aria-label="攻击中间帧图片尺寸" value={String(imageGenerationSize)} onChange={(event) => onChangeImageGenerationSize(Number(event.target.value))}>
                    {imageGenerationSizeOptions.map((option) => (
                      <option key={option.size} value={option.size}>{option.label}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="field">
                攻击中间帧自定义提示词
                <textarea
                  aria-label="攻击中间帧自定义提示词"
                  value={attackMidframeCustomPrompt ?? ""}
                  rows={4}
                  onChange={(event) => onChangeAttackMidframeCustomPrompt(event.target.value)}
                />
              </label>
            </section>
          ) : null}
          <label className="field">
            {primaryPromptPrefix}系统提示词
            <textarea aria-label={`${primaryPromptPrefix}系统提示词`} value={systemPrompt} rows={7} onChange={(event) => onChangeSystemPrompt(event.target.value)} />
          </label>
          <label className="field">
            {primaryPromptPrefix}自定义提示词
            <textarea aria-label={`${primaryPromptPrefix}自定义提示词`} value={customPrompt} rows={4} onChange={(event) => onChangeCustomPrompt(event.target.value)} />
          </label>
          <label className="field">
            {primaryPromptPrefix}最终提示词
            <textarea aria-label={`${primaryPromptPrefix}最终提示词`} value={finalPrompt} rows={5} readOnly />
          </label>
          {actionKind === "run" && onChangeRunVideoSystemPrompt && onChangeRunVideoCustomPrompt ? (
            <section className="prompt-section">
              <h3>跑步视频提示词</h3>
              <label className="field">
                跑步视频系统提示词
                <textarea aria-label="跑步视频系统提示词" value={runVideoSystemPrompt ?? ""} rows={7} onChange={(event) => onChangeRunVideoSystemPrompt(event.target.value)} />
              </label>
              <label className="field">
                跑步视频自定义提示词
                <textarea aria-label="跑步视频自定义提示词" value={runVideoCustomPrompt ?? ""} rows={4} onChange={(event) => onChangeRunVideoCustomPrompt(event.target.value)} />
              </label>
              <label className="field">
                跑步视频最终提示词
                <textarea aria-label="跑步视频最终提示词" value={runFinalVideoPrompt ?? ""} rows={5} readOnly />
              </label>
            </section>
          ) : null}
          {statusDetails ? (
            <details className="status-details">
              <summary>视频状态详情</summary>
              <pre>{statusDetails}</pre>
            </details>
          ) : null}
        </>
      </Module01ActionSection>
      <Module01ActionSection title={sectionTitle("结果")}>
        {result ? (
          <FourDirectionResultPanel result={result} frameIndex={0} isPlaying={false} />
        ) : (
          <EmptyPanel label={`等待${title}一键处理结果`} />
        )}
      </Module01ActionSection>
    </Module01PageStage>
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

function DirectionPreviewGrid({
  directions,
  frameIndex,
  frameSelector,
  imageAltSuffix,
  showLoopInfo
}: {
  directions: readonly DirectionProcessingResult[];
  frameIndex: number;
  frameSelector: (direction: DirectionProcessingResult) => readonly ProcessedFrame[];
  imageAltSuffix: string;
  showLoopInfo: boolean;
}) {
  return (
    <div className="direction-preview-grid">
      {directions.map((direction) => {
        const frames = frameSelector(direction);
        const frame = frames[frameIndex % Math.max(1, frames.length)];
        return (
          <section className="direction-preview-card" key={direction.key}>
            <div className="direction-preview-title">
              <strong>{direction.label}</strong>
              {showLoopInfo ? <span>{direction.loop.startFrame}-{direction.loop.endFrame} / {direction.loop.frameCount} 帧</span> : null}
            </div>
            <div className="direction-preview-image">
              {frame ? <img alt={`${direction.label}${imageAltSuffix}`} src={frame.url} /> : <EmptyMedia label="等待方向帧" />}
            </div>
            {showLoopInfo ? <span className="direction-score">评分 {direction.loop.score.toFixed(4)}</span> : null}
          </section>
        );
      })}
    </div>
  );
}

function IdleSpriteSheetPreview({ idle }: { idle: ProcessFourDirectionResult["idle"] | undefined }) {
  if (!idle?.spriteSheetUrl) {
    return <EmptyMedia label="等待待机处理" />;
  }
  return <img alt="待机预览" src={idle.spriteSheetUrl} />;
}

function IdleDirectionPreviewGrid({ idle }: { idle: ProcessFourDirectionResult["idle"] | undefined }) {
  if (!idle?.frames.length) {
    return <EmptyPanel label="等待待机处理结果" />;
  }
  return (
    <div className="direction-preview-grid">
      {idle.frames.map((frame) => (
        <section className="direction-preview-card" key={frame.key}>
          <div className="direction-preview-title">
            <strong>{frame.label}</strong>
            <span>待机</span>
          </div>
          <div className="direction-preview-image">
            <img alt={`${frame.label}待机预览`} src={frame.url} />
          </div>
        </section>
      ))}
    </div>
  );
}

function FourDirectionResultPanel({
  result,
  frameIndex,
  isPlaying
}: {
  result: ProcessFourDirectionResult | null;
  frameIndex: number;
  isPlaying: boolean;
}) {
  return (
    <div className="loop-result-stack">
      <div className="loop-preview-duo">
        <section className="loop-result-section">
          <div className="loop-section-heading">
            <h3>最终循环预览</h3>
            <span>{result ? `${result.directions.length} 个方向 · ${isPlaying ? "播放中" : "已停止"}` : "等待抠图预览"}</span>
          </div>
          {result ? (
            <DirectionPreviewGrid
              directions={result.directions}
              frameIndex={frameIndex}
              frameSelector={(direction) => direction.transparentFrames}
              imageAltSuffix="最终循环预览"
              showLoopInfo
            />
          ) : <EmptyPanel label="等待一键处理结果" />}
        </section>
        <section className="loop-result-section">
          <div className="loop-section-heading">
            <h3>待机预览</h3>
            <span>{result?.idle ? "已拆解、抠图并按走路比例缩放" : "等待待机处理"}</span>
          </div>
          <IdleDirectionPreviewGrid idle={result?.idle} />
        </section>
      </div>
      <section className="loop-result-section">
        <div className="loop-section-heading">
          <h3>最终导出</h3>
          <span>透明帧 / 走路 Sprite Sheet / 待机 Sprite Sheet / GIF</span>
        </div>
        <div className="export-grid">
          <div className="sprite-sheet-preview">
            {result?.spriteSheetUrl ? (
              <img alt="Sprite Sheet 预览" src={toAbsoluteApiUrl(result.spriteSheetUrl)} />
            ) : <EmptyMedia label="等待 Sprite Sheet" />}
          </div>
          <div className="export-actions">
            <DownloadLink href={result?.transparentZipUrl} label="导出透明帧 ZIP" />
            <DownloadLink href={result?.spriteSheetUrl} label="导出走路 Sprite Sheet" />
            <DownloadLink href={result?.idle?.spriteSheetUrl} label="导出待机 Sprite Sheet" />
            <DownloadLink href={result?.gifPreviewUrl} label="导出 GIF" />
          </div>
        </div>
      </section>
    </div>
  );
}

function DownloadLink({ href, label }: { href?: string; label: string }) {
  if (!href) {
    return <span className="tool-button disabled-link">{label}</span>;
  }
  return <a className="tool-button" href={toAbsoluteApiUrl(href)} download>{label}</a>;
}

function EmptyPanel({ label }: { label: string }) {
  return <div className="empty-panel">{label}</div>;
}

function CharacterPreviewStage({
  characterId,
  result,
  advancedActions
}: {
  characterId: string;
  result: ProcessFourDirectionResult | null;
  advancedActions?: {
    run?: ProcessFourDirectionResult | null;
    attack1?: ProcessFourDirectionResult | null;
    jump?: ProcessFourDirectionResult | null;
  };
}) {
  const previewAssets = useMemo(() => buildCharacterPreviewAssets(result, advancedActions), [advancedActions, result]);
  const savedPreviewSettings = useMemo(() => loadCharacterPreviewSettings(), []);
  const [facingDirection, setFacingDirection] = useState<PreviewDirection>("down");
  const [pressedDirections, setPressedDirections] = useState<PreviewDirection[]>([]);
  const [isRunPressed, setIsRunPressed] = useState(false);
  const [oneShotAction, setOneShotAction] = useState<"attack1" | "jump" | null>(null);
  const [oneShotDirection, setOneShotDirection] = useState<PreviewDirection | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [idleFps, setIdleFps] = useState(savedPreviewSettings.idleFps);
  const [walkFps, setWalkFps] = useState(savedPreviewSettings.walkFps);
  const [runFps, setRunFps] = useState(savedPreviewSettings.runFps);
  const [attackFps, setAttackFps] = useState(savedPreviewSettings.attackFps);
  const [jumpFps, setJumpFps] = useState(savedPreviewSettings.jumpFps);
  const [previewSize, setPreviewSize] = useState(savedPreviewSettings.previewSize);
  const [moveSpeed, setMoveSpeed] = useState(savedPreviewSettings.moveSpeed);
  const [backgroundMode, setBackgroundMode] = useState<CharacterPreviewBackgroundMode>(savedPreviewSettings.backgroundMode);
  const [showGuides, setShowGuides] = useState(savedPreviewSettings.showGuides);
  const [showCellBounds, setShowCellBounds] = useState(savedPreviewSettings.showCellBounds);
  const [previewSettingsStatus, setPreviewSettingsStatus] = useState("");
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const movementDirection = pressedDirections.at(-1) ?? facingDirection;
  const activeDirection = oneShotAction && oneShotDirection ? oneShotDirection : movementDirection;
  const walkFrames = previewAssets.walk[activeDirection];
  const runFrames = previewAssets.run[activeDirection];
  const attackFrames = previewAssets.attack1[activeDirection];
  const jumpFrames = previewAssets.jump[activeDirection];
  const idleFrame = previewAssets.idle[activeDirection];
  const isTryingToWalk = pressedDirections.length > 0;
  const isRunning = isTryingToWalk && isRunPressed && runFrames.length > 0 && !oneShotAction;
  const isWalking = isTryingToWalk && !isRunning && walkFrames.length > 0 && !oneShotAction;
  const activeOneShotFrames = oneShotAction === "attack1" ? attackFrames : oneShotAction === "jump" ? jumpFrames : [];
  const isPlayingOneShot = Boolean(oneShotAction && activeOneShotFrames.length > 0);
  const activeMoveFrames = isRunning ? runFrames : walkFrames;
  const activePlaybackFps = isPlayingOneShot
    ? oneShotAction === "attack1" ? attackFps : jumpFps
    : isRunning ? runFps
    : isWalking ? walkFps
    : idleFps;
  const activeFrame = isPlayingOneShot
    ? activeOneShotFrames[Math.min(frameIndex, activeOneShotFrames.length - 1)]
    : (isWalking || isRunning)
    ? activeMoveFrames[frameIndex % activeMoveFrames.length]
    : idleFrame ?? walkFrames[0];
  const currentFrameNumber = isPlayingOneShot
    ? Math.min(frameIndex + 1, activeOneShotFrames.length)
    : (isWalking || isRunning) && activeMoveFrames.length > 0
    ? (frameIndex % activeMoveFrames.length) + 1
    : 1;
  const actionLabel = isPlayingOneShot ? (oneShotAction === "attack1" ? "攻击 1" : "跳跃") : isRunning ? "跑步" : isWalking ? "行走" : "待机";
  const statusLabel = !characterId
    ? "请先创建或选择角色文件夹"
    : previewAssets.hasRequiredAssets
      ? `${actionLabel} / 面朝${PREVIEW_DIRECTION_LABELS[activeDirection]}`
      : "缺少预览资源，请先完成步行和待机处理";

  const buildPreviewSettings = (): CharacterPreviewSettings => ({
    idleFps,
    walkFps,
    runFps,
    attackFps,
    jumpFps,
    previewSize,
    moveSpeed,
    backgroundMode,
    showGuides,
    showCellBounds
  });

  const applyPreviewSettings = (settings: CharacterPreviewSettings) => {
    setIdleFps(settings.idleFps);
    setWalkFps(settings.walkFps);
    setRunFps(settings.runFps);
    setAttackFps(settings.attackFps);
    setJumpFps(settings.jumpFps);
    setPreviewSize(settings.previewSize);
    setMoveSpeed(settings.moveSpeed);
    setBackgroundMode(settings.backgroundMode);
    setShowGuides(settings.showGuides);
    setShowCellBounds(settings.showCellBounds);
  };

  const handleSavePreviewSettings = async () => {
    const settings = buildPreviewSettings();
    setPreviewSettingsStatus("正在保存预览配置到后端全局配置...");
    try {
      saveCharacterPreviewSettings(settings);
      const currentConfig = await getModule01WorkflowConfig();
      await saveModule01WorkflowConfig({
        ...(currentConfig ?? {}),
        characterPreviewSettings: settings
      });
      setPreviewSettingsStatus("预览配置已保存到后端全局配置。");
    } catch (error: unknown) {
      setPreviewSettingsStatus(`预览配置保存失败：${getErrorMessage(error)}`);
    }
  };

  useEffect(() => {
    let isCancelled = false;
    void getModule01WorkflowConfig()
      .then((config) => {
        if (isCancelled || !config) {
          return;
        }
        const settings = normalizeCharacterPreviewSettings(
          config.characterPreviewSettings,
          loadCharacterPreviewSettings()
        );
        applyPreviewSettings(settings);
        saveCharacterPreviewSettings(settings);
      })
      .catch((error: unknown) => {
        if (!isCancelled) {
          setPreviewSettingsStatus(`预览配置加载失败：${getErrorMessage(error)}`);
        }
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) {
        return;
      }
      const direction = PREVIEW_KEY_TO_DIRECTION[event.key.toLowerCase()];
      if (event.key === "Shift") {
        event.preventDefault();
        setIsRunPressed(true);
        return;
      }
      if (event.key.toLowerCase() === "j") {
        event.preventDefault();
        if (attackFrames.length > 0) {
          setOneShotDirection(activeDirection);
          setOneShotAction("attack1");
          setFrameIndex(0);
        }
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        if (jumpFrames.length > 0) {
          setOneShotDirection(activeDirection);
          setOneShotAction("jump");
          setFrameIndex(0);
        }
        return;
      }
      if (!direction) {
        return;
      }
      event.preventDefault();
      setFacingDirection(direction);
      setPressedDirections((current) => current.includes(direction) ? current : [...current, direction]);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      const direction = PREVIEW_KEY_TO_DIRECTION[event.key.toLowerCase()];
      if (event.key === "Shift") {
        event.preventDefault();
        setIsRunPressed(false);
        return;
      }
      if (!direction) {
        return;
      }
      event.preventDefault();
      setPressedDirections((current) => {
        const next = current.filter((item) => item !== direction);
        setFacingDirection(next.at(-1) ?? direction);
        return next;
      });
    };
    const handleBlur = () => {
      setPressedDirections([]);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [activeDirection, attackFrames.length, jumpFrames.length]);

  useEffect(() => {
    setFrameIndex(0);
  }, [activeDirection, isRunning, isWalking, oneShotAction]);

  useEffect(() => {
    if (isPlayingOneShot) {
      if (activeOneShotFrames.length <= 1) {
        return undefined;
      }
      const interval = window.setInterval(() => {
        setFrameIndex((current) => {
          const next = current + 1;
          if (next >= activeOneShotFrames.length) {
            window.clearInterval(interval);
            setOneShotAction(null);
            setOneShotDirection(null);
            return 0;
          }
          return next;
        });
      }, getPlaybackIntervalMs(activePlaybackFps));
      return () => window.clearInterval(interval);
    }
    if ((!isWalking && !isRunning) || activeMoveFrames.length <= 1) {
      return undefined;
    }
    const interval = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % activeMoveFrames.length);
    }, getPlaybackIntervalMs(activePlaybackFps));
    return () => window.clearInterval(interval);
  }, [activeMoveFrames.length, activeOneShotFrames.length, activePlaybackFps, isPlayingOneShot, isRunning, isWalking]);

  useEffect(() => {
    if (pressedDirections.length === 0 || moveSpeed <= 0 || oneShotAction) {
      return undefined;
    }
    let frameId = 0;
    let lastTime = performance.now();
    const tick = (time: number) => {
      const direction = pressedDirections.at(-1);
      const vector = direction ? PREVIEW_DIRECTION_VECTORS[direction] : { x: 0, y: 0 };
      const deltaSeconds = Math.min(0.05, Math.max(0, (time - lastTime) / 1000));
      lastTime = time;
      const speed = isRunPressed && runFrames.length > 0 ? moveSpeed * 1.6 : moveSpeed;
      setPosition((current) => clampPreviewPosition({
        x: current.x + vector.x * speed * deltaSeconds,
        y: current.y + vector.y * speed * deltaSeconds
      }));
      frameId = window.requestAnimationFrame(tick);
    };
    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [isRunPressed, moveSpeed, oneShotAction, pressedDirections, runFrames.length]);

  useEffect(() => {
    saveCharacterPreviewSettings({
      idleFps,
      walkFps,
      runFps,
      attackFps,
      jumpFps,
      previewSize,
      moveSpeed,
      backgroundMode,
      showGuides,
      showCellBounds
    });
  }, [attackFps, backgroundMode, idleFps, jumpFps, moveSpeed, previewSize, runFps, showCellBounds, showGuides, walkFps]);

  return (
    <section className="workflow-stage character-preview-stage">
      <div className="stage-heading">
        <h2>角色预览</h2>
        <span>{statusLabel}</span>
      </div>
      <div className="character-preview-layout">
        <section className="character-preview-screen-panel">
          <div className={["character-preview-screen", `character-preview-background-${backgroundMode}`].join(" ")}>
            {showGuides ? (
              <>
                <span className="preview-guide-line preview-guide-line-x" />
                <span className="preview-guide-line preview-guide-line-y" />
              </>
            ) : null}
            {activeFrame ? (
              <img
                alt={`角色${actionLabel}预览`}
                className={["character-preview-avatar", showCellBounds ? "character-preview-avatar-bounded" : ""].filter(Boolean).join(" ")}
                src={activeFrame.url}
                style={{
                  width: `${previewSize}px`,
                  transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px))`
                }}
              />
            ) : (
              <EmptyMedia label="等待角色预览资源" />
            )}
            <div className="character-preview-hud">
              <span>{actionLabel}</span>
              <span>方向：{PREVIEW_DIRECTION_LABELS[activeDirection]}</span>
              <span>帧：{currentFrameNumber} / {Math.max(1, isPlayingOneShot ? activeOneShotFrames.length : isRunning ? runFrames.length : isWalking ? walkFrames.length : 1)}</span>
            </div>
          </div>
        </section>
        <section className="character-preview-control-panel">
          <div className="loop-parameter-header">控制</div>
          <div className="wasd-pad" aria-label="WASD 控制提示">
            <kbd>W</kbd>
            <kbd>A</kbd>
            <kbd>S</kbd>
            <kbd>D</kbd>
            <kbd>Shift</kbd>
            <kbd>J</kbd>
            <kbd>Space</kbd>
          </div>
          <p className="preview-help-text">WASD 行走，Shift 跑步，J 攻击 1，Space 跳跃。</p>
          <div className="form-grid">
            <label className="field">
              待机 FPS
              <input aria-label="角色预览待机 FPS" type="number" min={1} max={FPS_MAX} value={idleFps} onChange={(event) => setIdleFps(clamp(Number(event.target.value), 1, FPS_MAX))} />
            </label>
            <label className="field">
              行走 FPS
              <input aria-label="角色预览行走 FPS" type="number" min={1} max={FPS_MAX} value={walkFps} onChange={(event) => setWalkFps(clamp(Number(event.target.value), 1, FPS_MAX))} />
            </label>
            <label className="field">
              跑步 FPS
              <input aria-label="角色预览跑步 FPS" type="number" min={1} max={FPS_MAX} value={runFps} onChange={(event) => setRunFps(clamp(Number(event.target.value), 1, FPS_MAX))} />
            </label>
            <label className="field">
              攻击 1 FPS
              <input aria-label="角色预览攻击 1 FPS" type="number" min={1} max={FPS_MAX} value={attackFps} onChange={(event) => setAttackFps(clamp(Number(event.target.value), 1, FPS_MAX))} />
            </label>
            <label className="field">
              跳跃 FPS
              <input aria-label="角色预览跳跃 FPS" type="number" min={1} max={FPS_MAX} value={jumpFps} onChange={(event) => setJumpFps(clamp(Number(event.target.value), 1, FPS_MAX))} />
            </label>
            <label className="field">
              显示尺寸
              <input aria-label="角色预览显示尺寸" type="number" min={160} max={640} value={previewSize} onChange={(event) => setPreviewSize(clamp(Number(event.target.value), 160, 640))} />
            </label>
            <label className="field">
              移动速度
              <input aria-label="角色预览移动速度" type="number" min={0} max={360} value={moveSpeed} onChange={(event) => setMoveSpeed(clamp(Number(event.target.value), 0, 360))} />
            </label>
            <label className="field">
              舞台背景
              <select aria-label="角色预览舞台背景" value={backgroundMode} onChange={(event) => setBackgroundMode(normalizeCharacterPreviewBackground(event.target.value))}>
                <option value="map-1">游戏地图1</option>
                <option value="map-2">游戏地图2</option>
                <option value="grid">深色网格</option>
              </select>
            </label>
          </div>
          <div className="control-row">
            <button className="tool-button" type="button" onClick={() => void handleSavePreviewSettings()}>
              <Save size={16} /> 保存预览配置
            </button>
            <button className="tool-button" type="button" onClick={() => setPosition({ x: 0, y: 0 })}>
              <RotateCcw size={16} /> 回到中心
            </button>
            <label className="toggle-field">
              <input type="checkbox" checked={showGuides} onChange={(event) => setShowGuides(event.target.checked)} />
              显示中心线
            </label>
            <label className="toggle-field">
              <input type="checkbox" checked={showCellBounds} onChange={(event) => setShowCellBounds(event.target.checked)} />
              显示单帧边界
            </label>
          </div>
          {previewSettingsStatus ? <p className="preview-help-text">{previewSettingsStatus}</p> : null}
          <div className="preview-resource-grid">
            <div>
              <strong>待机</strong>
              <span>{previewAssets.idleCount} / 4 方向</span>
            </div>
            <div>
              <strong>行走</strong>
              <span>{previewAssets.walkDirectionCount} / 4 方向，{previewAssets.walkFrameCount} 帧</span>
            </div>
            <div>
              <strong>跑步</strong>
              <span>{previewAssets.runDirectionCount} / 4 方向，{previewAssets.runFrameCount} 帧</span>
            </div>
            <div>
              <strong>攻击 1</strong>
              <span>{previewAssets.attackDirectionCount} / 4 方向，{previewAssets.attackFrameCount} 帧</span>
            </div>
            <div>
              <strong>跳跃</strong>
              <span>{previewAssets.jumpDirectionCount} / 4 方向，{previewAssets.jumpFrameCount} 帧</span>
            </div>
            <div>
              <strong>角色</strong>
              <span>{characterId || "未选择"}</span>
            </div>
          </div>
          {previewAssets.missingMessages.length > 0 ? (
            <div className="preview-warning">
              {previewAssets.missingMessages.map((message) => <span key={message}>{message}</span>)}
            </div>
          ) : null}
        </section>
      </div>
    </section>
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

function loadDraft(defaultKeys: SavedAnimationKeys): SpriteAnimatorDraft {
  const fallback = buildDefaultDraft(defaultKeys);
  const storedDraft = readStoredDraft();
  if (!storedDraft) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(storedDraft.raw) as Partial<SpriteAnimatorDraft>;
    const draft = {
      ...fallback,
      ...parsed
    };
    return normalizeDraft(draft, fallback, storedDraft.isLegacy);
  } catch {
    return fallback;
  }
}

function normalizeBackendWorkflowConfig(
  config: Record<string, unknown>,
  defaultKeys: SavedAnimationKeys,
  openRouterApiKey: string
): SpriteAnimatorDraft {
  const fallback = buildDefaultDraft(defaultKeys);
  const parsed = config as Partial<SpriteAnimatorDraft>;
  return normalizeDraft({
    ...fallback,
    ...parsed,
    openRouterApiKey
  }, fallback, false);
}

function toBackendWorkflowDraft(draft: SpriteAnimatorDraft): BackendWorkflowDraft {
  const { openRouterApiKey: _openRouterApiKey, ...backendDraft } = draft;
  return {
    ...backendDraft,
    characterPreviewSettings: loadCharacterPreviewSettings()
  };
}

function readStoredDraft(): { raw: string; isLegacy: boolean } | null {
  const current = localStorage.getItem(DRAFT_STORAGE_KEY);
  if (current) {
    return { raw: current, isLegacy: false };
  }
  for (const key of LEGACY_DRAFT_STORAGE_KEYS) {
    const legacy = localStorage.getItem(key);
    if (legacy) {
      return { raw: legacy, isLegacy: true };
    }
  }
  return null;
}

function normalizeDraft(
  draft: SpriteAnimatorDraft,
  fallback: SpriteAnimatorDraft,
  isLegacy: boolean
): SpriteAnimatorDraft {
  const next = { ...draft };
  if (!isKnownImageModel(next.imageModel)) {
    next.imageModel = fallback.imageModel;
  }
  if (!isKnownImageModel(next.directionImageModel)) {
    next.directionImageModel = fallback.directionImageModel;
  }
  if (!isKnownVideoModel(next.videoModel)) {
    next.videoModel = fallback.videoModel;
  }
  next.imageGenerationSize = normalizeImageGenerationSize(next.imageModel, next.imageGenerationSize);
  next.directionImageGenerationSize = normalizeImageGenerationSize(
    next.directionImageModel,
    next.directionImageGenerationSize
  );
  next.videoDurationSeconds = normalizeVideoDuration(next.videoModel, Number(next.videoDurationSeconds));
  next.videoResolution = normalizeVideoResolution(next.videoModel, String(next.videoResolution ?? ""));
  next.frameCount = clamp(Number(next.frameCount), 1, 120);
  next.fps = clamp(Number(next.fps), 1, FPS_MAX);
  next.tolerance = clamp(Number(next.tolerance), 0, 255);
  next.minLoopFrames = clamp(Number(next.minLoopFrames), 2, 120);
  next.maxLoopFrames = Math.max(next.minLoopFrames, clamp(Number(next.maxLoopFrames), 2, 120));
  next.exportFrameSize = clamp(Number(next.exportFrameSize), 64, 1024);
  if (!isKnownImageStyle(next.imageStyle)) {
    next.imageStyle = fallback.imageStyle;
  }
  if (isLegacy || !next.imageSystemPrompt) {
    next.imageSystemPrompt = fallback.imageSystemPrompt;
  }
  if (isLegacy || typeof next.imageCustomPrompt !== "string") {
    next.imageCustomPrompt = fallback.imageCustomPrompt;
  }
  if (isLegacy || !next.directionIdleSystemPrompt) {
    next.directionIdleSystemPrompt = fallback.directionIdleSystemPrompt;
  }
  if (isLegacy || typeof next.directionIdleCustomPrompt !== "string") {
    next.directionIdleCustomPrompt = fallback.directionIdleCustomPrompt;
  }
  if (isLegacy || !next.directionWalkSystemPrompt) {
    next.directionWalkSystemPrompt = fallback.directionWalkSystemPrompt;
  }
  if (isLegacy || typeof next.directionWalkCustomPrompt !== "string") {
    next.directionWalkCustomPrompt = fallback.directionWalkCustomPrompt;
  }
  if (isLegacy || typeof next.videoSystemPrompt !== "string" || next.videoSystemPrompt.trim().length === 0) {
    next.videoSystemPrompt = fallback.videoSystemPrompt;
  }
  if (isLegacy || typeof next.videoCustomPrompt !== "string") {
    next.videoCustomPrompt = fallback.videoCustomPrompt;
  }
  if (isLegacy || typeof next.advancedRunSystemPrompt !== "string" || next.advancedRunSystemPrompt.trim().length === 0) {
    next.advancedRunSystemPrompt = fallback.advancedRunSystemPrompt;
  }
  if (isLegacy || typeof next.advancedRunCustomPrompt !== "string") {
    next.advancedRunCustomPrompt = fallback.advancedRunCustomPrompt;
  }
  if (isLegacy || typeof next.advancedRunVideoSystemPrompt !== "string" || next.advancedRunVideoSystemPrompt.trim().length === 0) {
    next.advancedRunVideoSystemPrompt = fallback.advancedRunVideoSystemPrompt;
  }
  if (isLegacy || typeof next.advancedRunVideoCustomPrompt !== "string") {
    next.advancedRunVideoCustomPrompt = fallback.advancedRunVideoCustomPrompt;
  }
  if (isLegacy || typeof next.advancedAttackSystemPrompt !== "string" || next.advancedAttackSystemPrompt.trim().length === 0) {
    next.advancedAttackSystemPrompt = fallback.advancedAttackSystemPrompt;
  }
  if (isLegacy || typeof next.advancedAttackCustomPrompt !== "string") {
    next.advancedAttackCustomPrompt = fallback.advancedAttackCustomPrompt;
  }
  if (typeof next.advancedAttackMidframeCustomPrompt !== "string") {
    next.advancedAttackMidframeCustomPrompt = fallback.advancedAttackMidframeCustomPrompt;
  }
  next.advancedAttackStartScale = normalizeAdvancedStartScale(next.advancedAttackStartScale, fallback.advancedAttackStartScale);
  if (isLegacy || typeof next.advancedJumpSystemPrompt !== "string" || next.advancedJumpSystemPrompt.trim().length === 0) {
    next.advancedJumpSystemPrompt = fallback.advancedJumpSystemPrompt;
  }
  if (isLegacy || typeof next.advancedJumpCustomPrompt !== "string") {
    next.advancedJumpCustomPrompt = fallback.advancedJumpCustomPrompt;
  }
  next.advancedJumpStartScale = normalizeAdvancedStartScale(next.advancedJumpStartScale, fallback.advancedJumpStartScale);
  next.finalImagePrompt = buildFirstFramePrompt({
    imageSystemPrompt: next.imageSystemPrompt,
    imageCustomPrompt: next.imageCustomPrompt
  });
  next.finalDirectionIdlePrompt = buildFirstFramePrompt({
    imageSystemPrompt: next.directionIdleSystemPrompt,
    imageCustomPrompt: next.directionIdleCustomPrompt
  });
  next.finalDirectionWalkPrompt = buildFirstFramePrompt({
    imageSystemPrompt: next.directionWalkSystemPrompt,
    imageCustomPrompt: next.directionWalkCustomPrompt
  });
  next.finalVideoPrompt = buildVideoPrompt({
    videoSystemPrompt: next.videoSystemPrompt,
    videoCustomPrompt: next.videoCustomPrompt
  });
  next.finalAdvancedRunPrompt = buildFirstFramePrompt({
    imageSystemPrompt: next.advancedRunSystemPrompt,
    imageCustomPrompt: next.advancedRunCustomPrompt
  });
  next.finalAdvancedRunVideoPrompt = buildVideoPrompt({
    videoSystemPrompt: next.advancedRunVideoSystemPrompt,
    videoCustomPrompt: next.advancedRunVideoCustomPrompt
  });
  next.finalAdvancedAttackPrompt = buildVideoPrompt({
    videoSystemPrompt: next.advancedAttackSystemPrompt,
    videoCustomPrompt: next.advancedAttackCustomPrompt
  });
  next.finalAdvancedJumpPrompt = buildVideoPrompt({
    videoSystemPrompt: next.advancedJumpSystemPrompt,
    videoCustomPrompt: next.advancedJumpCustomPrompt
  });
  return next;
}

function isKnownImageModel(model: string): boolean {
  return IMAGE_MODELS.some((item) => item.id === model);
}

function isKnownImageStyle(style: string): boolean {
  return IMAGE_STYLES.some((item) => item.id === style);
}

function isKnownVideoModel(model: string): boolean {
  return VIDEO_MODELS.some((item) => item.id === model);
}

function toImageModelOptions(catalog: ProviderModelCatalog): ImageModelOption[] {
  return catalog.imageModels.map((model) => ({
    id: model.id,
    label: model.label,
    sizeOptions: model.imageSizeOptions && model.imageSizeOptions.length > 0
      ? model.imageSizeOptions
      : [{ size: model.defaultImageSize ?? 1024, label: `${model.defaultImageSize ?? 1024} x ${model.defaultImageSize ?? 1024}` }]
  }));
}

function toVideoModelOptions(catalog: ProviderModelCatalog): VideoModelOption[] {
  return catalog.videoModels.map((model) => {
    const durationOptions = model.durationOptions && model.durationOptions.length > 0
      ? model.durationOptions
      : [model.defaultDurationSeconds ?? 4];
    const resolutionOptions = model.resolutionOptions && model.resolutionOptions.length > 0
      ? model.resolutionOptions
      : [model.defaultResolution ?? "720p"];
    return {
      id: model.id,
      label: model.label,
      durationOptions,
      defaultDurationSeconds: model.defaultDurationSeconds ?? durationOptions[0] ?? 4,
      resolutionOptions,
      defaultResolution: model.defaultResolution ?? resolutionOptions[0] ?? "720p"
    };
  });
}

function getImageGenerationSizeOptions(model: string): readonly ImageGenerationSizeOption[];
function getImageGenerationSizeOptions(models: readonly ImageModelOption[], model: string): readonly ImageGenerationSizeOption[];
function getImageGenerationSizeOptions(
  modelOrModels: string | readonly ImageModelOption[],
  modelId?: string
): readonly ImageGenerationSizeOption[] {
  const models = typeof modelOrModels === "string" ? IMAGE_MODELS : modelOrModels;
  const model = typeof modelOrModels === "string" ? modelOrModels : modelId ?? "";
  return (models.find((item) => item.id === model) ?? models[0] ?? IMAGE_MODELS[0])?.sizeOptions ?? [
    { size: 1024, label: "1024 x 1024" }
  ];
}

function getDefaultImageGenerationSize(model: string): number;
function getDefaultImageGenerationSize(models: readonly ImageModelOption[], model: string): number;
function getDefaultImageGenerationSize(modelOrModels: string | readonly ImageModelOption[], modelId?: string): number {
  return typeof modelOrModels === "string"
    ? getImageGenerationSizeOptions(modelOrModels)[0]?.size ?? 1024
    : getImageGenerationSizeOptions(modelOrModels, modelId ?? "")[0]?.size ?? 1024;
}

function normalizeImageGenerationSize(model: string, size: number): number;
function normalizeImageGenerationSize(models: readonly ImageModelOption[], model: string, size: number): number;
function normalizeImageGenerationSize(
  modelOrModels: string | readonly ImageModelOption[],
  modelOrSize: string | number,
  maybeSize?: number
): number {
  const model = typeof modelOrModels === "string" ? modelOrModels : String(modelOrSize);
  const size = typeof modelOrModels === "string" ? Number(modelOrSize) : Number(maybeSize);
  const options = typeof modelOrModels === "string"
    ? getImageGenerationSizeOptions(model)
    : getImageGenerationSizeOptions(modelOrModels, model);
  return options.some((option) => option.size === size)
    ? size
    : typeof modelOrModels === "string"
      ? getDefaultImageGenerationSize(model)
      : getDefaultImageGenerationSize(modelOrModels, model);
}

function getVideoModelOption(model: string): VideoModelOption;
function getVideoModelOption(models: readonly VideoModelOption[], model: string): VideoModelOption;
function getVideoModelOption(
  modelOrModels: string | readonly VideoModelOption[],
  modelId?: string
): VideoModelOption {
  const models = typeof modelOrModels === "string" ? VIDEO_MODELS : modelOrModels;
  const model = typeof modelOrModels === "string" ? modelOrModels : modelId ?? "";
  const fallbackDefault = typeof modelOrModels === "string" ? DEFAULT_VIDEO_MODEL : modelOrModels[0]?.id ?? DEFAULT_VIDEO_MODEL;
  const option = models.find((item) => item.id === model)
    ?? models.find((item) => item.id === fallbackDefault)
    ?? models[0];
  if (!option) {
    throw new Error("至少需要配置一个视频模型");
  }
  return option;
}

function getVideoDurationOptions(model: string): readonly number[];
function getVideoDurationOptions(models: readonly VideoModelOption[], model: string): readonly number[];
function getVideoDurationOptions(modelOrModels: string | readonly VideoModelOption[], modelId?: string): readonly number[] {
  return typeof modelOrModels === "string"
    ? getVideoModelOption(modelOrModels).durationOptions
    : getVideoModelOption(modelOrModels, modelId ?? "").durationOptions;
}

function getDefaultVideoDuration(model: string): number;
function getDefaultVideoDuration(models: readonly VideoModelOption[], model: string): number;
function getDefaultVideoDuration(modelOrModels: string | readonly VideoModelOption[], modelId?: string): number {
  return typeof modelOrModels === "string"
    ? getVideoModelOption(modelOrModels).defaultDurationSeconds
    : getVideoModelOption(modelOrModels, modelId ?? "").defaultDurationSeconds;
}

function normalizeVideoDuration(model: string, duration: number): number;
function normalizeVideoDuration(models: readonly VideoModelOption[], model: string, duration: number): number;
function normalizeVideoDuration(
  modelOrModels: string | readonly VideoModelOption[],
  modelOrDuration: string | number,
  maybeDuration?: number
): number {
  const model = typeof modelOrModels === "string" ? modelOrModels : String(modelOrDuration);
  const duration = typeof modelOrModels === "string" ? Number(modelOrDuration) : Number(maybeDuration);
  const options = typeof modelOrModels === "string"
    ? getVideoDurationOptions(model)
    : getVideoDurationOptions(modelOrModels, model);
  return options.includes(duration)
    ? duration
    : typeof modelOrModels === "string"
      ? getDefaultVideoDuration(model)
      : getDefaultVideoDuration(modelOrModels, model);
}

function normalizeGodotExportSize(size: number): GodotExportSize {
  return GODOT_EXPORT_SIZE_OPTIONS.includes(size as GodotExportSize) ? size as GodotExportSize : 512;
}

function getVideoResolutionOptions(model: string): readonly string[];
function getVideoResolutionOptions(models: readonly VideoModelOption[], model: string): readonly string[];
function getVideoResolutionOptions(modelOrModels: string | readonly VideoModelOption[], modelId?: string): readonly string[] {
  return typeof modelOrModels === "string"
    ? getVideoModelOption(modelOrModels).resolutionOptions
    : getVideoModelOption(modelOrModels, modelId ?? "").resolutionOptions;
}

function getDefaultVideoResolution(model: string): string;
function getDefaultVideoResolution(models: readonly VideoModelOption[], model: string): string;
function getDefaultVideoResolution(modelOrModels: string | readonly VideoModelOption[], modelId?: string): string {
  return typeof modelOrModels === "string"
    ? getVideoModelOption(modelOrModels).defaultResolution
    : getVideoModelOption(modelOrModels, modelId ?? "").defaultResolution;
}

function normalizeVideoResolution(model: string, resolution: string): string;
function normalizeVideoResolution(models: readonly VideoModelOption[], model: string, resolution: string): string;
function normalizeVideoResolution(
  modelOrModels: string | readonly VideoModelOption[],
  modelOrResolution: string,
  maybeResolution?: string
): string {
  const model = typeof modelOrModels === "string" ? modelOrModels : modelOrResolution;
  const resolution = typeof modelOrModels === "string" ? modelOrResolution : maybeResolution ?? "";
  const options = typeof modelOrModels === "string"
    ? getVideoResolutionOptions(model)
    : getVideoResolutionOptions(modelOrModels, model);
  return options.includes(resolution)
    ? resolution
    : typeof modelOrModels === "string"
      ? getDefaultVideoResolution(model)
      : getDefaultVideoResolution(modelOrModels, model);
}

function buildCharacterPreviewAssets(result: ProcessFourDirectionResult | null, advancedActions?: {
  run?: ProcessFourDirectionResult | null;
  attack1?: ProcessFourDirectionResult | null;
  jump?: ProcessFourDirectionResult | null;
}): {
  idle: Record<PreviewDirection, ProcessedFrame | undefined>;
  walk: Record<PreviewDirection, ProcessedFrame[]>;
  run: Record<PreviewDirection, ProcessedFrame[]>;
  attack1: Record<PreviewDirection, ProcessedFrame[]>;
  jump: Record<PreviewDirection, ProcessedFrame[]>;
  idleCount: number;
  walkDirectionCount: number;
  walkFrameCount: number;
  runDirectionCount: number;
  runFrameCount: number;
  attackDirectionCount: number;
  attackFrameCount: number;
  jumpDirectionCount: number;
  jumpFrameCount: number;
  hasRequiredAssets: boolean;
  missingMessages: string[];
} {
  const idle: Record<PreviewDirection, ProcessedFrame | undefined> = {
    down: undefined,
    up: undefined,
    left: undefined,
    right: undefined
  };
  const walk: Record<PreviewDirection, ProcessedFrame[]> = {
    down: [],
    up: [],
    left: [],
    right: []
  };
  const run = buildEmptyDirectionFrameMap();
  const attack1 = buildEmptyDirectionFrameMap();
  const jump = buildEmptyDirectionFrameMap();
  for (const frame of result?.idle?.frames ?? []) {
    idle[frame.key] = frame;
  }
  for (const direction of result?.directions ?? []) {
    walk[direction.key] = direction.transparentFrames;
  }
  fillDirectionFrames(run, advancedActions?.run ?? null);
  fillDirectionFrames(attack1, advancedActions?.attack1 ?? null);
  fillDirectionFrames(jump, advancedActions?.jump ?? null);

  const missingIdle = PREVIEW_DIRECTION_ORDER.filter((direction) => !idle[direction]);
  const missingWalk = PREVIEW_DIRECTION_ORDER.filter((direction) => walk[direction].length === 0);
  const missingMessages = [
    missingIdle.length > 0 ? `缺少待机方向：${missingIdle.map((direction) => PREVIEW_DIRECTION_LABELS[direction]).join("、")}` : "",
    missingWalk.length > 0 ? `缺少行走方向：${missingWalk.map((direction) => PREVIEW_DIRECTION_LABELS[direction]).join("、")}` : ""
  ].filter(Boolean);
  const idleCount = PREVIEW_DIRECTION_ORDER.filter((direction) => idle[direction]).length;
  const walkDirectionCount = PREVIEW_DIRECTION_ORDER.filter((direction) => walk[direction].length > 0).length;
  const walkFrameCount = PREVIEW_DIRECTION_ORDER.reduce((total, direction) => total + walk[direction].length, 0);
  const runDirectionCount = PREVIEW_DIRECTION_ORDER.filter((direction) => run[direction].length > 0).length;
  const runFrameCount = PREVIEW_DIRECTION_ORDER.reduce((total, direction) => total + run[direction].length, 0);
  const attackDirectionCount = PREVIEW_DIRECTION_ORDER.filter((direction) => attack1[direction].length > 0).length;
  const attackFrameCount = PREVIEW_DIRECTION_ORDER.reduce((total, direction) => total + attack1[direction].length, 0);
  const jumpDirectionCount = PREVIEW_DIRECTION_ORDER.filter((direction) => jump[direction].length > 0).length;
  const jumpFrameCount = PREVIEW_DIRECTION_ORDER.reduce((total, direction) => total + jump[direction].length, 0);

  return {
    idle,
    walk,
    run,
    attack1,
    jump,
    idleCount,
    walkDirectionCount,
    walkFrameCount,
    runDirectionCount,
    runFrameCount,
    attackDirectionCount,
    attackFrameCount,
    jumpDirectionCount,
    jumpFrameCount,
    hasRequiredAssets: idleCount === PREVIEW_DIRECTION_ORDER.length && walkDirectionCount === PREVIEW_DIRECTION_ORDER.length,
    missingMessages
  };
}

function buildEmptyDirectionFrameMap(): Record<PreviewDirection, ProcessedFrame[]> {
  return {
    down: [],
    up: [],
    left: [],
    right: []
  };
}

function fillDirectionFrames(target: Record<PreviewDirection, ProcessedFrame[]>, result: ProcessFourDirectionResult | null): void {
  for (const direction of result?.directions ?? []) {
    target[direction.key] = direction.transparentFrames;
  }
}

function loadCharacterPreviewSettings(): CharacterPreviewSettings {
  try {
    const raw = localStorage.getItem(CHARACTER_PREVIEW_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_CHARACTER_PREVIEW_SETTINGS;
    }
    return normalizeCharacterPreviewSettings(JSON.parse(raw), DEFAULT_CHARACTER_PREVIEW_SETTINGS);
  } catch {
    return DEFAULT_CHARACTER_PREVIEW_SETTINGS;
  }
}

function saveCharacterPreviewSettings(settings: CharacterPreviewSettings): void {
  localStorage.setItem(CHARACTER_PREVIEW_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

function normalizeCharacterPreviewSettings(value: unknown, fallback: CharacterPreviewSettings): CharacterPreviewSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }
  const parsed = value as Partial<CharacterPreviewSettings> & { previewFps?: number };
  const legacyFps = Number(parsed.previewFps);
  const fallbackFps = Number.isFinite(legacyFps) ? clamp(legacyFps, 1, FPS_MAX) : fallback.walkFps;
  return {
    idleFps: clamp(Number(parsed.idleFps ?? fallback.idleFps), 1, FPS_MAX),
    walkFps: clamp(Number(parsed.walkFps ?? fallbackFps), 1, FPS_MAX),
    runFps: clamp(Number(parsed.runFps ?? fallbackFps), 1, FPS_MAX),
    attackFps: clamp(Number(parsed.attackFps ?? fallbackFps), 1, FPS_MAX),
    jumpFps: clamp(Number(parsed.jumpFps ?? fallbackFps), 1, FPS_MAX),
    previewSize: clamp(Number(parsed.previewSize ?? fallback.previewSize), 160, 640),
    moveSpeed: clamp(Number(parsed.moveSpeed ?? fallback.moveSpeed), 0, 360),
    backgroundMode: normalizeCharacterPreviewBackground(parsed.backgroundMode ?? fallback.backgroundMode),
    showGuides: typeof parsed.showGuides === "boolean" ? parsed.showGuides : fallback.showGuides,
    showCellBounds: typeof parsed.showCellBounds === "boolean" ? parsed.showCellBounds : fallback.showCellBounds
  };
}

function getPlaybackIntervalMs(fps: number): number {
  return Math.max(1, Math.round(1000 / Math.max(1, fps)));
}

function normalizeCharacterPreviewBackground(value: unknown): CharacterPreviewBackgroundMode {
  if (value === "map-2") {
    return "map-2";
  }
  return value === "grid" ? "grid" : "map-1";
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function clampPreviewPosition(position: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.max(-220, Math.min(220, position.x)),
    y: Math.max(-170, Math.min(170, position.y))
  };
}

function getFinalLoopFrameCount(result: ProcessFourDirectionResult | null): number {
  if (!result) {
    return 0;
  }
  return Math.max(...result.directions.map((direction) => direction.transparentFrames.length), 0);
}

function normalizeFourDirectionResult(result: ProcessFourDirectionResult): ProcessFourDirectionResult {
  const version = Date.now().toString(36);
  return {
    ...result,
    rawFrames: result.rawFrames.map((frame) => normalizeProcessedFrame(frame, version)),
    directions: result.directions.map((direction) => ({
      ...direction,
      centeredFrames: direction.centeredFrames.map((frame) => normalizeProcessedFrame(frame, version)),
      loopFrames: direction.loopFrames.map((frame) => normalizeProcessedFrame(frame, version)),
      transparentFrames: direction.transparentFrames.map((frame) => normalizeProcessedFrame(frame, version))
    })),
    spriteSheetUrl: result.spriteSheetUrl ? appendCacheBust(toAbsoluteApiUrl(result.spriteSheetUrl), `${version}-sheet`) : undefined,
    transparentZipUrl: result.transparentZipUrl ? toAbsoluteApiUrl(result.transparentZipUrl) : undefined,
    gifPreviewUrl: result.gifPreviewUrl ? appendCacheBust(toAbsoluteApiUrl(result.gifPreviewUrl), `${version}-gif`) : undefined,
    idle: result.idle ? {
      frames: result.idle.frames.map((frame) => ({
        ...frame,
        url: appendCacheBust(toAbsoluteApiUrl(frame.url), `${version}-idle-${frame.key}`)
      })),
      spriteSheetUrl: result.idle.spriteSheetUrl ? appendCacheBust(toAbsoluteApiUrl(result.idle.spriteSheetUrl), `${version}-idle-sheet`) : undefined
    } : undefined
  };
}

function buildInitialAdvancedActionState(status: string): AdvancedActionState {
  return {
    keyframePreview: null,
    inputPreview: null,
    outputPreview: null,
    middleFramePreview: null,
    jobId: "",
    result: null,
    status,
    statusDetails: "",
    isGeneratingKeyframe: false,
    isGeneratingMidframe: false,
    isPreparingInput: false,
    isSubmittingVideo: false,
    isProcessing: false
  };
}

function advancedAssetToState(asset: AdvancedActionAssets | undefined, fallbackStatus: string): AdvancedActionState {
  if (!asset) {
    return buildInitialAdvancedActionState(fallbackStatus);
  }
  const version = Date.now().toString(36);
  return {
    ...buildInitialAdvancedActionState("已自动载入该角色已有进阶动作资源。"),
    keyframePreview: toMediaPreview(asset.keyframe, version),
    inputPreview: toMediaPreview(asset.videoInput ?? asset.keyframe, version),
    outputPreview: toMediaPreview(asset.videoSource, version),
    middleFramePreview: toMediaPreview(asset.middleFrame, version),
    jobId: asset.videoSource ? (asset.export?.jobId ?? "existing-video") : "",
    result: asset.export ? normalizeFourDirectionResult(asset.export) : null
  };
}

function normalizeProcessedFrame(frame: ProcessedFrame, version: string): ProcessedFrame {
  return {
    index: frame.index,
    url: appendCacheBust(toAbsoluteApiUrl(frame.url), `${version}-${frame.index}`)
  };
}

function getAdvancedActionLabel(actionKind: AdvancedActionKind): string {
  if (actionKind === "run") {
    return "跑步";
  }
  if (actionKind === "attack-1") {
    return "攻击 1";
  }
  return "跳跃";
}

function formatOneClickJobStatus(job: OneClickCharacterJob): string {
  if (job.status === "completed") {
    const hasFailedOptional = job.steps.some((step) => step.status === "failed");
    return hasFailedOptional ? "基础角色已生成，部分进阶动作失败。" : "一键生成角色完成。";
  }
  if (job.status === "failed") {
    return job.error ? `一键生成角色失败：${job.error}` : "一键生成角色失败。";
  }
  const current = job.steps.find((step) => step.id === job.currentStep);
  return current ? `正在处理：${current.label}` : "一键生成角色任务运行中。";
}

function formatOneClickStepStatus(status: string): string {
  if (status === "completed") {
    return "完成";
  }
  if (status === "running") {
    return "处理中";
  }
  if (status === "failed") {
    return "失败";
  }
  if (status === "skipped") {
    return "跳过";
  }
  return "等待";
}

function buildDefaultDraft(defaultKeys: SavedAnimationKeys): SpriteAnimatorDraft {
  const base: SpriteAnimatorDraft = {
    openRouterApiKey: "",
    imageModel: DEFAULT_IMAGE_MODEL,
    videoModel: DEFAULT_VIDEO_MODEL,
    keyColor: "#00ff00",
    videoDurationSeconds: getDefaultVideoDuration(DEFAULT_VIDEO_MODEL),
    videoResolution: getDefaultVideoResolution(DEFAULT_VIDEO_MODEL),
    imageGenerationSize: getDefaultImageGenerationSize(DEFAULT_IMAGE_MODEL),
    imageStyle: DEFAULT_IMAGE_STYLE,
    imageSystemPrompt: DEFAULT_IMAGE_SYSTEM_PROMPT,
    imageCustomPrompt: DEFAULT_IMAGE_CUSTOM_PROMPT,
    finalImagePrompt: "",
    directionImageModel: DEFAULT_IMAGE_MODEL,
    directionImageGenerationSize: getDefaultImageGenerationSize(DEFAULT_IMAGE_MODEL),
    directionIdleSystemPrompt: DEFAULT_DIRECTION_IDLE_SYSTEM_PROMPT,
    directionIdleCustomPrompt: DEFAULT_DIRECTION_CUSTOM_PROMPT,
    finalDirectionIdlePrompt: "",
    directionWalkSystemPrompt: DEFAULT_DIRECTION_WALK_SYSTEM_PROMPT,
    directionWalkCustomPrompt: DEFAULT_DIRECTION_CUSTOM_PROMPT,
    finalDirectionWalkPrompt: "",
    videoSystemPrompt: DEFAULT_VIDEO_SYSTEM_PROMPT,
    videoCustomPrompt: DEFAULT_VIDEO_CUSTOM_PROMPT,
    finalVideoPrompt: "",
    advancedRunSystemPrompt: DEFAULT_ADVANCED_RUN_SYSTEM_PROMPT,
    advancedRunCustomPrompt: DEFAULT_ADVANCED_RUN_CUSTOM_PROMPT,
    finalAdvancedRunPrompt: "",
    advancedRunVideoSystemPrompt: DEFAULT_ADVANCED_RUN_VIDEO_SYSTEM_PROMPT,
    advancedRunVideoCustomPrompt: DEFAULT_ADVANCED_RUN_VIDEO_CUSTOM_PROMPT,
    finalAdvancedRunVideoPrompt: "",
    advancedAttackSystemPrompt: DEFAULT_ADVANCED_ATTACK_SYSTEM_PROMPT,
    advancedAttackCustomPrompt: DEFAULT_ADVANCED_ATTACK_CUSTOM_PROMPT,
    finalAdvancedAttackPrompt: "",
    advancedAttackMidframeCustomPrompt: DEFAULT_ADVANCED_ATTACK_MIDFRAME_CUSTOM_PROMPT,
    advancedAttackStartScale: DEFAULT_ATTACK_START_SCALE,
    advancedJumpSystemPrompt: DEFAULT_ADVANCED_JUMP_SYSTEM_PROMPT,
    advancedJumpCustomPrompt: DEFAULT_ADVANCED_JUMP_CUSTOM_PROMPT,
    finalAdvancedJumpPrompt: "",
    advancedJumpStartScale: DEFAULT_JUMP_START_SCALE,
    frameCount: 120,
    fps: 30,
    tolerance: DEFAULT_CHROMA_KEY_TOLERANCE,
    minLoopFrames: 12,
    maxLoopFrames: 60,
    exportFrameSize: DEFAULT_EXPORT_FRAME_SIZE
  };
  return {
    ...base,
    finalImagePrompt: buildFirstFramePrompt({
      imageSystemPrompt: base.imageSystemPrompt,
      imageCustomPrompt: base.imageCustomPrompt
    }),
    finalDirectionIdlePrompt: buildFirstFramePrompt({
      imageSystemPrompt: base.directionIdleSystemPrompt,
      imageCustomPrompt: base.directionIdleCustomPrompt
    }),
    finalDirectionWalkPrompt: buildFirstFramePrompt({
      imageSystemPrompt: base.directionWalkSystemPrompt,
      imageCustomPrompt: base.directionWalkCustomPrompt
    }),
    finalVideoPrompt: buildVideoPrompt({
      videoSystemPrompt: base.videoSystemPrompt,
      videoCustomPrompt: base.videoCustomPrompt
    }),
    finalAdvancedRunPrompt: buildFirstFramePrompt({
      imageSystemPrompt: base.advancedRunSystemPrompt,
      imageCustomPrompt: base.advancedRunCustomPrompt
    }),
    finalAdvancedRunVideoPrompt: buildVideoPrompt({
      videoSystemPrompt: base.advancedRunVideoSystemPrompt,
      videoCustomPrompt: base.advancedRunVideoCustomPrompt
    }),
    finalAdvancedAttackPrompt: buildVideoPrompt({
      videoSystemPrompt: base.advancedAttackSystemPrompt,
      videoCustomPrompt: base.advancedAttackCustomPrompt
    }),
    finalAdvancedJumpPrompt: buildVideoPrompt({
      videoSystemPrompt: base.advancedJumpSystemPrompt,
      videoCustomPrompt: base.advancedJumpCustomPrompt
    })
  };
}

function buildFirstFramePrompt(input: {
  imageSystemPrompt: string;
  imageCustomPrompt: string;
}): string {
  return [
    input.imageSystemPrompt,
    input.imageCustomPrompt
  ].filter((part) => part.trim().length > 0).join("\n\n");
}

function buildVideoPrompt(input: {
  videoSystemPrompt: string;
  videoCustomPrompt: string;
}): string {
  return [
    input.videoSystemPrompt,
    input.videoCustomPrompt
  ].filter((part) => part.trim().length > 0).join("\n\n");
}

function normalizeAdvancedStartScale(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(0.45, Math.min(0.95, Number(numeric.toFixed(2))));
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

async function readImageUrlAsDataUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) {
    return url;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`读取角色基准模板失败：${response.status}`);
  }
  const blob = await response.blob();
  return readFileAsDataUrl(new File([blob], "character-template.png", { type: blob.type || "image/png" }));
}

async function readOptionalPreviewImageAsDataUrl(file: File | null, preview: MediaPreview | null): Promise<string | undefined> {
  if (file) {
    return readFileAsDataUrl(file);
  }
  if (preview?.url) {
    return readImageUrlAsDataUrl(preview.url);
  }
  return undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extractJobId(response: unknown): string | undefined {
  return findStringValue(response, ["id", "job_id", "jobId"]);
}

function extractVideoFailureReason(response: unknown): string | undefined {
  return findStringValue(response, [
    "message",
    "error",
    "detail",
    "reason",
    "failure_reason",
    "failed_reason",
    "status_message"
  ]);
}

function formatVideoStatusDetails(response: unknown, fallbackJobId: string): string {
  const details = {
    jobId: findStringValue(response, ["jobId", "job_id", "id"]) ?? fallbackJobId,
    status: findStringValue(response, ["status", "state"]),
    providerResponse: response && typeof response === "object" && "providerResponse" in response
      ? (response as { providerResponse?: unknown }).providerResponse
      : response
  };
  return JSON.stringify(details, null, 2);
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

function buildReferenceImageUrl(path: string, version: string, kind: Module01ReferenceImageKind): string {
  const absoluteUrl = toAbsoluteApiUrl(path);
  return version ? appendCacheBust(absoluteUrl, `${version}-${kind}`) : absoluteUrl;
}

function toMediaPreview(asset: CharacterAssetFile | undefined, version: string): MediaPreview | null {
  if (!asset) {
    return null;
  }
  return {
    name: asset.fileName,
    url: appendCacheBust(toAbsoluteApiUrl(asset.url), `${version}-${asset.fileName}`),
    publicUrl: toPublicAssetUrl(asset.url)
  };
}

function toPublicAssetUrl(localUrl: string): string {
  if (/^https?:\/\//i.test(localUrl)) {
    return localUrl;
  }
  return `${FIXED_PUBLIC_ASSET_BASE_URL}${localUrl.startsWith("/") ? "" : "/"}${localUrl}`;
}
