import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ProviderModelCatalog } from "@ai-game-workbench/core";
import {
  ArrowLeft,
  Gamepad2,
  ImagePlus,
  RotateCcw,
  Save,
  Scissors,
  Settings,
  Trash2,
  Upload,
  WandSparkles
} from "lucide-react";
import {
  createPixelCharacter,
  createSpriteSheetGeneration,
  deletePixelCharacter,
  filterProviderModelCatalogForUserSettings,
  getProviderModelCatalog,
  getPixelCharacterAssets,
  getPixelSpriteActions,
  loadUserApiProviderSettings,
  listPixelCharacters,
  processSpriteSheet,
  toAbsoluteApiUrl,
  uploadModule02ActionReferenceImage,
  uploadModule02CharacterAsset,
  type Module02ActionReferenceId,
  type PixelCharacterAssetFile,
  type PixelCharacterAssets,
  type PixelCharacterFolder,
  type PixelCharacterFrameAsset,
  type PixelSpriteActionTemplate,
  type PixelSpriteSliceKind,
  type ProcessSpriteSheetResult,
  USER_API_PROVIDER_SETTINGS_UPDATED_EVENT
} from "../api/client";

type PixelPage = "base-template" | "walk-template" | "character-preview" | "module-settings";
type PixelSettingsGroup = "base-template" | "walk-template" | "character-preview";
type DirectionKey = "down" | "left" | "right" | "up";

interface PixelSpriteGeneratorProps {
  onBack: () => void;
}

interface PixelSpriteDraft {
  imageModel: string;
  publicAssetBaseUrl: string;
  keyColor: string;
  basePrompt: string;
  walkPrompt: string;
  tolerance: number;
  outputFrameWidth: number;
  outputFrameHeight: number;
  idleFps: number;
  walkFps: number;
  previewSize: number;
  previewMoveSpeed: number;
  showGuides: boolean;
}

interface MediaPreview {
  url: string;
  label?: string;
}

const ACTIVE_CHARACTER_STORAGE_KEY = "ai-game-workbench.pixel-sprite-generator.active-character";
const DRAFT_STORAGE_KEY = "ai-game-workbench.pixel-sprite-generator.workflow.v3";
const LEGACY_DRAFT_STORAGE_KEY = "ai-game-workbench.pixel-sprite-generator.workflow.v2";
const DEFAULT_IMAGE_MODEL = "apimart/gpt-image-2";
const DEFAULT_KEY_COLOR = "#00ff00";
const FIXED_PROCESS_FRAME_WIDTH = 64;
const FIXED_PROCESS_FRAME_HEIGHT = 128;
const FIXED_PROCESS_SUBJECT_HEIGHT = 96;
const LEGACY_SHORT_BASE_PROMPT = "生成一个 2x2 接触表格式像素角色基准模板/待机，保持纯色背景，角色居中，四方向一致。";
const LEGACY_SHORT_WALK_PROMPT = "基于基准模板/待机生成四方向步行动作 sprite sheet。保持角色比例、服装、配色一致。";
const DEFAULT_BASE_PROMPT = `你是一名资深像素艺术家和动画师，专门为电子游戏设计可直接投入生产的 2D 角色精灵图。你的核心专长在于保证结构布局的一致性、角色造型的一致性，并严格遵循轴测（等距）或正交网格的限制。

## 1. 核心限制与格式要求

* 网格布局：你必须严格按照第一张参考图的四方向待机姿势，将所有角色排布在 2 行 2 列的功能性布局中。
* 画布与宽高比：最终输出必须是 2×2 角色基准模板，四个角色各自位于方格中心，不要互相重叠。
* 画面纯净度：图像中不得出现任何 UI 元素、文本标签、可见的网格线、辅助线或数字。
* 背景：默认使用纯色、无缝的背景——标准的色键绿（绿幕），以便游戏开发者进行素材抠图。
* 动作约束：每个方向只生成 1 个稳定待机姿势，不生成多帧循环，不生成走路、跑步、攻击、跳跃、转身或夸张动作。

## 2. 输出排列

在生成角色待机图时，必须精准地按以下顺序安排四个方格：

* 左上：向下/正面待机
* 右上：向左待机
* 左下：向右待机
* 右下：向上/背面待机

## 3. 参考图

第一张图作为待机姿势参考，只参考姿势、方向顺序和角色在方格中的居中方式。
第二张图作为角色参考图，必须严格保持第二张图中的角色外观、发型、服装、配色、体型比例和像素颗粒感。
生成像素风格的角色基准模板。

2 行 2 列。
无阴影。不要生成脚底影子、椭圆影子、接触阴影、投影、地面、文字、编号、辅助线或可见网格线。`;
const DEFAULT_WALK_PROMPT = `你是一名资深像素艺术家和动画师，专门为电子游戏设计可直接投入生产的 2D 角色精灵图。你的核心专长在于保证结构布局的一致性、动作的流畅度，并严格遵循轴测（等距）或正交网格的限制。

## 1. 核心限制与格式要求

* 网格布局：你必须严格按照第一张参考图的动画序列，将所有角色图集排布在功能性的参考图网格布局中。
* 画布与宽高比：最终输出的画布比例必须严格和第一张参考图一样。
* 画面纯净度：图像中不得出现任何 UI 元素、文本标签、可见的网格线、辅助线或数字。
* 背景：默认使用纯色、无缝的背景——标准的色键绿（绿幕），以便游戏开发者进行素材抠图。
* 角色一致性：必须严格保持第二张图中的角色外观、发型、服装、配色、体型比例和像素颗粒感，只改变步行动作。

## 2. 动画序列工作流

在生成角色精灵图时，必须精准地按以下顺序安排各行内容：

* 第一行：向下走动（10 帧）
* 第二行：向左走动（10 帧）
* 第三行：向右走动（10 帧）
* 第四行：向上走动（10 帧）

## 3. 参考图

第一张图作为步行动作和四方向排布模板，只参考动作节奏、帧数、行列顺序、角色站位和网格比例。
第二张图作为角色基准模板，必须严格保持第二张图中的角色外观、发型、服装、配色、体型比例和像素颗粒感。
生成像素风格的四方向步行图。

四行10列。
无阴影。不要生成脚底影子、椭圆影子、接触阴影、投影、地面、文字、编号、辅助线或可见网格线。`;

const PAGE_LABELS: Record<PixelPage, string> = {
  "base-template": "基准模板/待机",
  "walk-template": "步行",
  "character-preview": "角色预览",
  "module-settings": "模块设置"
};

const SETTINGS_GROUPS: Array<{ id: PixelSettingsGroup; label: string; saveLabel: string }> = [
  { id: "base-template", label: "基准模板/待机设置", saveLabel: "保存基准模板/待机设置" },
  { id: "walk-template", label: "步行设置", saveLabel: "保存步行设置" },
  { id: "character-preview", label: "角色预览设置", saveLabel: "保存角色预览设置" }
];
const DEFAULT_SETTINGS_GROUP = SETTINGS_GROUPS[0] as { id: PixelSettingsGroup; label: string; saveLabel: string };

const DEFAULT_DRAFT: PixelSpriteDraft = {
  imageModel: DEFAULT_IMAGE_MODEL,
  publicAssetBaseUrl: "",
  keyColor: DEFAULT_KEY_COLOR,
  basePrompt: DEFAULT_BASE_PROMPT,
  walkPrompt: DEFAULT_WALK_PROMPT,
  tolerance: 34,
  outputFrameWidth: 64,
  outputFrameHeight: 128,
  idleFps: 2,
  walkFps: 8,
  previewSize: 192,
  previewMoveSpeed: 120,
  showGuides: false
};

const FALLBACK_ACTIONS: Record<"idle" | "walk", PixelSpriteActionTemplate> = {
  idle: {
    id: "idle",
    name: "基准模板/待机",
    referenceImage: "idle-2x2-centered.png",
    rows: 2,
    columns: 2,
    constraintPrompt: DEFAULT_DRAFT.basePrompt
  },
  walk: {
    id: "walk",
    name: "四方向步行图",
    referenceImage: "walk-4x10-no-shadow.png",
    rows: 4,
    columns: 10,
    constraintPrompt: DEFAULT_DRAFT.walkPrompt
  }
};

const DIRECTION_ROWS: Array<{ key: DirectionKey; label: string; row: number }> = [
  { key: "down", label: "向下", row: 0 },
  { key: "left", label: "向左", row: 1 },
  { key: "right", label: "向右", row: 2 },
  { key: "up", label: "向上", row: 3 }
];

export function PixelSpriteGenerator({ onBack }: PixelSpriteGeneratorProps) {
  const [activePage, setActivePage] = useState<PixelPage>("base-template");
  const [characters, setCharacters] = useState<PixelCharacterFolder[]>([]);
  const [activeCharacterId, setActiveCharacterId] = useState(() => readStoredText(ACTIVE_CHARACTER_STORAGE_KEY, ""));
  const [newCharacterName, setNewCharacterName] = useState("");
  const [characterStatus, setCharacterStatus] = useState("正在加载像素角色库...");
  const [isCreatingCharacter, setIsCreatingCharacter] = useState(false);
  const [deletingCharacterId, setDeletingCharacterId] = useState("");
  const [assets, setAssets] = useState<PixelCharacterAssets>(() => createEmptyPixelAssets());
  const [actions, setActions] = useState<PixelSpriteActionTemplate[]>([]);
  const [draft, setDraft] = useState<PixelSpriteDraft>(() => loadDraft());
  const [settingsDraft, setSettingsDraft] = useState<PixelSpriteDraft>(() => loadDraft());
  const [activeSettingsGroup, setActiveSettingsGroup] = useState<PixelSettingsGroup>("base-template");
  const [providerModelCatalog, setProviderModelCatalog] = useState<ProviderModelCatalog | null>(null);
  const [userApiProviderSettings, setUserApiProviderSettings] = useState(() => loadUserApiProviderSettings());
  const [baseStatus, setBaseStatus] = useState("选择或创建像素角色后，生成或上传基准模板/待机。");
  const [walkStatus, setWalkStatus] = useState("先生成基准模板/待机，再生成四方向步行图。");
  const [sliceStatus, setSliceStatus] = useState("切帧会写入当前像素角色的 slices/idle 与 slices/walk。");
  const [previewStatus, setPreviewStatus] = useState("");
  const [isGeneratingBase, setIsGeneratingBase] = useState(false);
  const [isGeneratingWalk, setIsGeneratingWalk] = useState(false);
  const [processingSliceKind, setProcessingSliceKind] = useState<PixelSpriteSliceKind | null>(null);
  const [activeDirection, setActiveDirection] = useState<DirectionKey>("down");
  const [isWalking, setIsWalking] = useState(false);
  const [previewFrameIndex, setPreviewFrameIndex] = useState(0);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [settingsStatus, setSettingsStatus] = useState("按分类调整模块 02 默认参数，保存后影响后续生成和处理。");
  const [actionReferenceVersion, setActionReferenceVersion] = useState(0);
  const [uploadingActionReferenceId, setUploadingActionReferenceId] = useState<Module02ActionReferenceId | null>(null);
  const pressedDirectionsRef = useRef<DirectionKey[]>([]);
  const previewMoveSpeedRef = useRef(draft.previewMoveSpeed);

  const idleAction = useMemo(() => actions.find((action) => action.id === "idle") ?? FALLBACK_ACTIONS.idle, [actions]);
  const walkAction = useMemo(() => actions.find((action) => action.id === "walk") ?? FALLBACK_ACTIONS.walk, [actions]);
  const filteredProviderModelCatalog = useMemo(
    () => providerModelCatalog ? filterProviderModelCatalogForUserSettings(providerModelCatalog, userApiProviderSettings) : null,
    [providerModelCatalog, userApiProviderSettings]
  );
  const imageModels = useMemo(
    () => filteredProviderModelCatalog?.imageModels ?? [{ id: DEFAULT_IMAGE_MODEL, label: "APIMart GPT-Image-2" }],
    [filteredProviderModelCatalog]
  );
  const idleFrames = assets.slices.idle.frames;
  const walkFrames = assets.slices.walk.frames;
  const groupedIdleFrames = useMemo(() => groupFramesByRow(idleFrames), [idleFrames]);
  const groupedWalkFrames = useMemo(() => groupFramesByRow(walkFrames), [walkFrames]);
  const activePreviewFrames = isWalking
    ? groupedWalkFrames.get(directionToRow(activeDirection)) ?? []
    : groupedIdleFrames.get(directionToRow(activeDirection)) ?? [];
  const activePreviewFrame = activePreviewFrames[previewFrameIndex % Math.max(1, activePreviewFrames.length)];

  useEffect(() => {
    let cancelled = false;
    void getProviderModelCatalog()
      .then((catalog) => {
        if (cancelled) {
          return;
        }
        setProviderModelCatalog(catalog);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setBaseStatus(`Provider model catalog load failed: ${getErrorMessage(error)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const reloadUserApiProviderSettings = () => setUserApiProviderSettings(loadUserApiProviderSettings());
    window.addEventListener(USER_API_PROVIDER_SETTINGS_UPDATED_EVENT, reloadUserApiProviderSettings);
    window.addEventListener("storage", reloadUserApiProviderSettings);
    return () => {
      window.removeEventListener(USER_API_PROVIDER_SETTINGS_UPDATED_EVENT, reloadUserApiProviderSettings);
      window.removeEventListener("storage", reloadUserApiProviderSettings);
    };
  }, []);

  useEffect(() => {
    if (!filteredProviderModelCatalog) {
      return;
    }
    setDraft((current) => {
      if (filteredProviderModelCatalog.imageModels.some((model) => model.id === current.imageModel)) {
        return current;
      }
      const next = { ...current, imageModel: filteredProviderModelCatalog.defaults.imageModelId };
      setSettingsDraft(next);
      return next;
    });
  }, [filteredProviderModelCatalog]);

  useEffect(() => {
    previewMoveSpeedRef.current = draft.previewMoveSpeed;
  }, [draft.previewMoveSpeed]);

  useEffect(() => {
    let cancelled = false;
    void getPixelSpriteActions()
      .then((loadedActions) => {
        if (!cancelled) {
          setActions(loadedActions);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setBaseStatus(`动作模板加载失败：${getErrorMessage(error)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listPixelCharacters()
      .then((loadedCharacters) => {
        if (cancelled) {
          return;
        }
        setCharacters(loadedCharacters);
        setCharacterStatus(loadedCharacters.length > 0 ? `已加载 ${loadedCharacters.length} 个像素角色。` : "还没有像素角色。");
        setActiveCharacterId((current) => current || loadedCharacters[0]?.id || "");
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCharacterStatus(`像素角色库加载失败：${getErrorMessage(error)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    writeStoredText(ACTIVE_CHARACTER_STORAGE_KEY, activeCharacterId);
    setPreviewFrameIndex(0);
    if (!activeCharacterId) {
      setAssets(createEmptyPixelAssets());
      return;
    }
    let cancelled = false;
    void getPixelCharacterAssets(activeCharacterId)
      .then((loadedAssets) => {
        if (!cancelled) {
          setAssets(normalizePixelAssets(loadedAssets));
          setCharacterStatus(`已加载像素角色：${activeCharacterId}`);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setAssets(createEmptyPixelAssets());
          setCharacterStatus(`像素角色资源加载失败：${getErrorMessage(error)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeCharacterId]);

  useEffect(() => {
    if (activePreviewFrames.length <= 1) {
      setPreviewFrameIndex(0);
      return;
    }
    const fps = isWalking ? draft.walkFps : draft.idleFps;
    const timer = window.setInterval(() => {
      setPreviewFrameIndex((index) => (index + 1) % activePreviewFrames.length);
    }, Math.max(80, Math.round(1000 / Math.max(1, fps))));
    return () => window.clearInterval(timer);
  }, [activePreviewFrames.length, draft.idleFps, draft.walkFps, isWalking]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }
      const direction = keyToDirection(event.key);
      if (!direction) {
        return;
      }
      event.preventDefault();
      const pressedDirections = pressedDirectionsRef.current;
      if (!pressedDirections.includes(direction)) {
        pressedDirectionsRef.current = [...pressedDirections, direction];
      }
      setActiveDirection(direction);
      setIsWalking(true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      const direction = keyToDirection(event.key);
      if (!direction) {
        return;
      }
      pressedDirectionsRef.current = pressedDirectionsRef.current.filter((item) => item !== direction);
      const nextDirection = pressedDirectionsRef.current[pressedDirectionsRef.current.length - 1];
      if (nextDirection) {
        setActiveDirection(nextDirection);
      } else {
        setIsWalking(false);
      }
    };
    const clearPressedDirections = () => {
      pressedDirectionsRef.current = [];
      setIsWalking(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", clearPressedDirections);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", clearPressedDirections);
    };
  }, []);

  useEffect(() => {
    let frameId = 0;
    let lastTimestamp = 0;
    const tick = (timestamp: number) => {
      const direction = pressedDirectionsRef.current[pressedDirectionsRef.current.length - 1];
      if (direction && lastTimestamp > 0) {
        const deltaSeconds = Math.min(0.05, (timestamp - lastTimestamp) / 1000);
        setPosition((current) => movePosition(current, direction, previewMoveSpeedRef.current * deltaSeconds));
      }
      lastTimestamp = timestamp;
      frameId = window.requestAnimationFrame(tick);
    };
    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  const baseTemplatePreview = toPreview(assets.baseTemplate.output);
  const characterReferencePreview = toPreview(assets.baseTemplate.characterReference);
  const walkTemplatePreview = toPreview(assets.walkTemplate.output);

  const handleCreateCharacter = async () => {
    const name = newCharacterName.trim();
    if (!name) {
      setCharacterStatus("请输入像素角色名称。");
      return;
    }
    setIsCreatingCharacter(true);
    setCharacterStatus("正在创建像素角色...");
    try {
      const character = await createPixelCharacter(name);
      setCharacters((current) => upsertCharacter(current, character));
      setActiveCharacterId(character.id);
      setNewCharacterName("");
      setCharacterStatus(`已创建像素角色：${character.name}`);
    } catch (error: unknown) {
      setCharacterStatus(`像素角色创建失败：${getErrorMessage(error)}`);
    } finally {
      setIsCreatingCharacter(false);
    }
  };

  const handleDeleteCharacter = async (character: PixelCharacterFolder) => {
    const confirmed = window.confirm(`确认删除像素角色「${character.id}」？此操作会删除整个像素角色文件夹，不能撤销。`);
    if (!confirmed) {
      return;
    }
    setDeletingCharacterId(character.id);
    setCharacterStatus(`正在删除像素角色：${character.id}`);
    try {
      await deletePixelCharacter(character.id);
      setCharacters((current) => current.filter((item) => item.id !== character.id));
      setActiveCharacterId((current) => (current === character.id ? "" : current));
      setCharacterStatus(`已删除像素角色：${character.id}`);
    } catch (error: unknown) {
      setCharacterStatus(`像素角色删除失败：${getErrorMessage(error)}`);
    } finally {
      setDeletingCharacterId("");
    }
  };

  const handleUploadAsset = async (kind: "character-reference" | "base-template" | "walk-template", file: File | undefined) => {
    const characterId = requireActiveCharacter(setCharacterStatus);
    if (!characterId || !file) {
      return;
    }
    const statusSetter = kind === "walk-template" ? setWalkStatus : setBaseStatus;
    statusSetter("正在上传像素角色资源...");
    try {
      const uploaded = await uploadModule02CharacterAsset(characterId, kind, file, {
        publicAssetBaseUrl: draft.publicAssetBaseUrl
      });
      const assetFile = {
        fileName: uploaded.fileName,
        url: uploaded.localUrl ?? uploaded.publicUrl
      };
      setAssets((current) => applyUploadedAsset(current, kind, assetFile));
      statusSetter("像素角色资源已上传。");
    } catch (error: unknown) {
      statusSetter(`像素角色资源上传失败：${getErrorMessage(error)}`);
    }
  };

  const handleUploadActionReference = async (actionId: Module02ActionReferenceId, file: File | undefined) => {
    if (!file) {
      return;
    }
    const label = actionId === "idle" ? "基准模板/待机" : "步行";
    setUploadingActionReferenceId(actionId);
    setSettingsStatus(`正在上传${label}参考图...`);
    try {
      await uploadModule02ActionReferenceImage(actionId, file);
      setActionReferenceVersion((current) => current + 1);
      setSettingsStatus(`${label}参考图已更新。`);
    } catch (error: unknown) {
      setSettingsStatus(`参考图上传失败：${getErrorMessage(error)}`);
    } finally {
      setUploadingActionReferenceId(null);
    }
  };

  const handleGenerateBaseTemplate = async () => {
    const characterId = requireActiveCharacter(setBaseStatus);
    if (!characterId) {
      return;
    }
    setIsGeneratingBase(true);
    setBaseStatus("正在生成基准模板/待机...");
    try {
      const result = await createSpriteSheetGeneration({
        actionId: "idle",
        model: draft.imageModel,
        constraintPrompt: idleAction.constraintPrompt,
        customPrompt: draft.basePrompt,
        keyColor: draft.keyColor,
        pixelCharacterId: characterId,
        characterReferenceUrl: assets.baseTemplate.characterReference?.url
      }, {
        publicAssetBaseUrl: draft.publicAssetBaseUrl
      });
      setAssets((current) => ({
        ...current,
        baseTemplate: {
          ...current.baseTemplate,
          output: {
            fileName: result.fileName,
            url: result.localUrl
          }
        }
      }));
      setBaseStatus("基准模板/待机生成完成。");
    } catch (error: unknown) {
      setBaseStatus(`基准模板/待机生成失败：${getErrorMessage(error)}`);
    } finally {
      setIsGeneratingBase(false);
    }
  };

  const handleGenerateWalkTemplate = async () => {
    const characterId = requireActiveCharacter(setWalkStatus);
    if (!characterId) {
      return;
    }
    const referenceUrl = assets.baseTemplate.output?.url ?? assets.baseTemplate.characterReference?.url;
    if (!referenceUrl) {
      setWalkStatus("请先生成或上传基准模板/待机。");
      return;
    }
    setIsGeneratingWalk(true);
    setWalkStatus("正在生成四方向步行图...");
    try {
      const result = await createSpriteSheetGeneration({
        actionId: "walk",
        model: draft.imageModel,
        constraintPrompt: walkAction.constraintPrompt,
        customPrompt: draft.walkPrompt,
        keyColor: draft.keyColor,
        pixelCharacterId: characterId,
        characterReferenceUrl: referenceUrl
      }, {
        publicAssetBaseUrl: draft.publicAssetBaseUrl
      });
      setAssets((current) => ({
        ...current,
        walkTemplate: {
          output: {
            fileName: result.fileName,
            url: result.localUrl
          }
        }
      }));
      setWalkStatus("四方向步行图生成完成。");
    } catch (error: unknown) {
      setWalkStatus(`四方向步行图生成失败：${getErrorMessage(error)}`);
    } finally {
      setIsGeneratingWalk(false);
    }
  };

  const runSlice = async (sliceKind: PixelSpriteSliceKind): Promise<ProcessSpriteSheetResult> => {
    const characterId = requireActiveCharacter(setSliceStatus);
    if (!characterId) {
      throw new Error("缺少像素角色。");
    }
    const isIdle = sliceKind === "idle";
    const sourceUrl = isIdle ? assets.baseTemplate.output?.url : assets.walkTemplate.output?.url;
    if (!sourceUrl) {
      throw new Error(isIdle ? "缺少基准模板/待机。" : "缺少四方向步行图。");
    }
    return processSpriteSheet({
      pixelCharacterId: characterId,
      sliceKind,
      sourceUrl,
      rows: getActionRows(isIdle ? idleAction : walkAction),
      columns: getActionColumns(isIdle ? idleAction : walkAction),
      keyColor: draft.keyColor,
      tolerance: draft.tolerance,
      centerFrames: true,
      centerMode: isIdle ? "frame" : "row",
      outputFrameWidth: FIXED_PROCESS_FRAME_WIDTH,
      outputFrameHeight: FIXED_PROCESS_FRAME_HEIGHT,
      normalizeSubjectScale: true,
      targetSubjectHeight: FIXED_PROCESS_SUBJECT_HEIGHT,
      directionLayout: isIdle ? "contact-2x2" : "grid"
    });
  };

  const handleSliceOne = async (sliceKind: PixelSpriteSliceKind) => {
    const label = sliceKind === "idle" ? "待机" : "步行";
    setProcessingSliceKind(sliceKind);
    setSliceStatus(`正在一键处理${label}，使用绿幕抠图，固定规格 64 x 128，角色高度 96px...`);
    try {
      const result = await runSlice(sliceKind);
      setAssets((current) => applySliceFrames(current, sliceKind, result.frames));
      setSliceStatus(`${label}一键处理完成：${result.frameCount} 帧，固定规格 64 x 128，角色高度 96px。`);
    } catch (error: unknown) {
      setSliceStatus(`${label}一键处理失败：${getErrorMessage(error)}`);
    } finally {
      setProcessingSliceKind(null);
    }
  };

  const updateSettingsDraft = <Key extends keyof PixelSpriteDraft>(key: Key, value: PixelSpriteDraft[Key]) => {
    setSettingsDraft((current) => ({ ...current, [key]: value }));
  };

  const handleSaveSettings = () => {
    const normalized = normalizeDraft(settingsDraft);
    setDraft(normalized);
    setSettingsDraft(normalized);
    writeDraft(normalized);
    const group = SETTINGS_GROUPS.find((item) => item.id === activeSettingsGroup);
    const label = group?.label ?? "模块设置";
    const message = `${label}已保存。`;
    setSettingsStatus(message);
    if (activeSettingsGroup === "character-preview") {
      setPreviewStatus(message);
    }
  };

  const requireActiveCharacter = (setStatus: (status: string) => void) => {
    if (!activeCharacterId) {
      setStatus("请先创建或选择一个像素角色。");
      return "";
    }
    return activeCharacterId;
  };

  return (
    <main className="app-shell workbench-shell">
      <aside className="side-nav">
        <button className="icon-button" type="button" onClick={onBack} aria-label="返回工作台首页">
          <ArrowLeft size={18} />
        </button>
        <div className="nav-brand">模块 02</div>
        <section className="character-panel" aria-label="像素角色文件夹">
          <div className="nav-group-title">像素角色</div>
          <label className="field compact-field">
            当前像素角色
            <div className="character-select-row">
              <select
                aria-label="当前像素角色"
                value={activeCharacterId}
                onChange={(event) => setActiveCharacterId(event.target.value)}
              >
                <option value="">未选择像素角色</option>
                {activeCharacterId && !characters.some((character) => character.id === activeCharacterId) ? (
                  <option value={activeCharacterId}>{activeCharacterId}</option>
                ) : null}
                {characters.map((character) => (
                  <option key={character.id} value={character.id}>{character.name}</option>
                ))}
              </select>
              <button
                aria-label={activeCharacterId ? `删除像素角色 ${activeCharacterId}` : "删除像素角色"}
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
            新建像素角色
            <input
              aria-label="新建像素角色名称"
              placeholder="像素角色名"
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
            {isCreatingCharacter ? "创建中" : "创建像素角色"}
          </button>
          <span className="character-status">{characterStatus}</span>
        </section>

        <div className="nav-group-title">像素角色生成</div>
        <NavButton active={activePage === "base-template"} icon={<WandSparkles size={18} />} onClick={() => setActivePage("base-template")}>
          基准模板/待机
        </NavButton>
        <NavButton active={activePage === "walk-template"} icon={<ImagePlus size={18} />} onClick={() => setActivePage("walk-template")}>
          步行
        </NavButton>
        <NavButton active={activePage === "character-preview"} icon={<Gamepad2 size={18} />} onClick={() => setActivePage("character-preview")}>
          角色预览
        </NavButton>
        <div className="nav-group-title">配置</div>
        <NavButton active={activePage === "module-settings"} icon={<Settings size={18} />} onClick={() => setActivePage("module-settings")}>
          模块设置
        </NavButton>
      </aside>

      <section className="main-stage">
        <header className="tool-header">
          <div>
            <p className="eyebrow">模块 02 / {PAGE_LABELS[activePage]}</p>
            <h1>像素角色制作</h1>
          </div>
        </header>

        <div className="workflow-stack">
          {activePage === "base-template" ? (
            <WorkflowStage
              title="基准模板/待机"
              status={baseStatus}
              mediaPanes={[
                {
                  title: "角色参考图",
                  content: <ImagePreview alt="角色参考图预览" preview={characterReferencePreview} emptyLabel="等待角色参考图" />
                },
                {
                  title: "基准模板/待机",
                  content: <ImagePreview alt="基准模板/待机预览" preview={baseTemplatePreview} emptyLabel="等待基准模板/待机" />
                }
              ]}
              controls={(
                <>
                  <div className="control-row">
                    <FileButton label="上传角色参考图" onFile={(file) => void handleUploadAsset("character-reference", file)} />
                    <FileButton label="上传基准模板/待机" onFile={(file) => void handleUploadAsset("base-template", file)} />
                    <button className="tool-button primary" type="button" disabled={isGeneratingBase} onClick={() => void handleGenerateBaseTemplate()}>
                      <WandSparkles size={16} /> {isGeneratingBase ? "生成中" : "生成基准模板/待机"}
                    </button>
                  </div>
                  <div className="control-row">
                    <button aria-label="一键处理待机" className="tool-button primary" type="button" disabled={processingSliceKind === "idle"} onClick={() => void handleSliceOne("idle")}>
                      <Scissors size={16} /> {processingSliceKind === "idle" ? "处理中" : "一键处理待机"}
                    </button>
                  </div>
                </>
              )}
            />
          ) : null}

          {activePage === "walk-template" ? (
            <WorkflowStage
              title="步行"
              status={walkStatus}
              mediaPanes={[
                {
                  title: "基准模板/待机",
                  content: <ImagePreview alt="步行图输入基准模板/待机预览" preview={baseTemplatePreview} emptyLabel="等待基准模板/待机" />
                },
                {
                  title: "四方向步行图",
                  content: <ImagePreview alt="四方向步行图预览" preview={walkTemplatePreview} emptyLabel="等待四方向步行图" />
                }
              ]}
              controls={(
                <>
                  <div className="control-row">
                    <FileButton label="上传四方向步行图" onFile={(file) => void handleUploadAsset("walk-template", file)} />
                    <button className="tool-button primary" type="button" disabled={isGeneratingWalk} onClick={() => void handleGenerateWalkTemplate()}>
                      <WandSparkles size={16} /> {isGeneratingWalk ? "生成中" : "生成四方向步行图"}
                    </button>
                  </div>
                  <div className="control-row">
                    <button aria-label="一键处理步行" className="tool-button primary" type="button" disabled={processingSliceKind === "walk"} onClick={() => void handleSliceOne("walk")}>
                      <Scissors size={16} /> {processingSliceKind === "walk" ? "处理中" : "一键处理步行"}
                    </button>
                  </div>
                </>
              )}
            />
          ) : null}

          {activePage === "module-settings" ? (
            <PixelModuleSettings
              activeGroup={activeSettingsGroup}
              draft={settingsDraft}
              idleActionReferencePreview={actionReferencePreview(idleAction, actionReferenceVersion)}
              imageModels={imageModels}
              status={settingsStatus}
              uploadingActionReferenceId={uploadingActionReferenceId}
              walkActionReferencePreview={actionReferencePreview(walkAction, actionReferenceVersion)}
              onChangeDraft={updateSettingsDraft}
              onChangeGroup={setActiveSettingsGroup}
              onUploadActionReference={handleUploadActionReference}
              onSave={handleSaveSettings}
            />
          ) : null}

          {activePage === "character-preview" ? (
            <section className="workflow-stage character-preview-stage">
              <div className="stage-heading">
                <h2>角色预览</h2>
                <span>{previewStatus || "WASD 控制方向和移动，预览使用已切好的 idle / walk 帧。"}</span>
              </div>
              <div className="character-preview-layout">
                <section className="character-preview-screen-panel">
                  <div className="character-preview-screen character-preview-background-grid">
                    {draft.showGuides ? (
                      <>
                        <span className="preview-guide-line preview-guide-line-x" />
                        <span className="preview-guide-line preview-guide-line-y" />
                      </>
                    ) : null}
                    {activePreviewFrame ? (
                      <img
                        alt="像素角色预览"
                        className="character-preview-avatar character-preview-avatar-bounded"
                        src={toAbsoluteApiUrl(activePreviewFrame.url)}
                        style={{
                          width: `${draft.previewSize}px`,
                          imageRendering: "pixelated",
                          transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px))`
                        }}
                      />
                    ) : (
                      <EmptyMedia label="等待 idle / walk 切帧结果" />
                    )}
                    <div className="character-preview-hud">
                      <span>{isWalking ? "walk" : "idle"}</span>
                      <span>方向：{DIRECTION_ROWS.find((direction) => direction.key === activeDirection)?.label}</span>
                      <span>帧：{activePreviewFrames.length > 0 ? previewFrameIndex % activePreviewFrames.length + 1 : 0} / {activePreviewFrames.length}</span>
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
                  </div>
                  <p className="preview-help-text">WASD 行走；松开按键回到 idle。角色位置和帧资源只在当前预览中使用。</p>
                  <div className="control-row">
                    <button className="tool-button" type="button" onClick={() => setPosition({ x: 0, y: 0 })}>
                      <RotateCcw size={16} /> 回到中心
                    </button>
                  </div>
                  <div className="preview-resource-grid">
                    <div>
                      <strong>idle</strong>
                      <span>{idleFrames.length} 帧</span>
                    </div>
                    <div>
                      <strong>walk</strong>
                      <span>{walkFrames.length} 帧</span>
                    </div>
                    <div>
                      <strong>角色</strong>
                      <span>{activeCharacterId || "未选择"}</span>
                    </div>
                  </div>
                </section>
              </div>
            </section>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function NavButton({
  active,
  children,
  icon,
  onClick
}: {
  active: boolean;
  children: ReactNode;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className={["nav-item", active ? "nav-item-active" : ""].filter(Boolean).join(" ")} type="button" onClick={onClick}>
      {icon} {children}
    </button>
  );
}

function PixelModuleSettings({
  activeGroup,
  draft,
  idleActionReferencePreview,
  imageModels,
  status,
  uploadingActionReferenceId,
  walkActionReferencePreview,
  onChangeDraft,
  onChangeGroup,
  onUploadActionReference,
  onSave
}: {
  activeGroup: PixelSettingsGroup;
  draft: PixelSpriteDraft;
  idleActionReferencePreview: MediaPreview | null;
  imageModels: readonly { id: string; label: string }[];
  status: string;
  uploadingActionReferenceId: Module02ActionReferenceId | null;
  walkActionReferencePreview: MediaPreview | null;
  onChangeDraft: <Key extends keyof PixelSpriteDraft>(key: Key, value: PixelSpriteDraft[Key]) => void;
  onChangeGroup: (group: PixelSettingsGroup) => void;
  onUploadActionReference: (actionId: Module02ActionReferenceId, file: File | undefined) => void;
  onSave: () => void;
}) {
  const group = SETTINGS_GROUPS.find((item) => item.id === activeGroup) ?? DEFAULT_SETTINGS_GROUP;
  return (
    <section className="workflow-stage module01-settings-center">
      <div className="stage-heading">
        <h2>模块设置</h2>
        <span>{status}</span>
      </div>
      <div className="module01-settings-layout">
        <nav className="module01-settings-nav" aria-label="模块 02 设置分类">
          {SETTINGS_GROUPS.map((item) => (
            <button
              className={["nav-item", activeGroup === item.id ? "nav-item-active" : ""].filter(Boolean).join(" ")}
              key={item.id}
              type="button"
              onClick={() => onChangeGroup(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="module01-settings-content">
          <h3>{group.label}</h3>
          <div className="module01-settings-fields">
            {activeGroup === "base-template" ? (
              <>
                <SettingsSubsection title="参考图设置">
                  <div className="stage-media-grid">
                    <div className="media-pane">
                      <div className="media-pane-title">idle 动作参考</div>
                      <ImagePreview alt="idle 动作参考图预览" preview={idleActionReferencePreview} emptyLabel="等待 idle 动作参考" />
                      <div className="control-row">
                        <FileButton
                          label={uploadingActionReferenceId === "idle" ? "上传中" : "上传并覆盖 idle 参考图"}
                          onFile={(file) => onUploadActionReference("idle", file)}
                        />
                      </div>
                    </div>
                  </div>
                </SettingsSubsection>
                <SettingsSubsection title="图片设置">
                  <div className="form-grid">
                    <label className="field">
                      图像模型
                      <select aria-label="设置基准模板/待机图像模型" value={draft.imageModel} onChange={(event) => onChangeDraft("imageModel", event.target.value)}>
                        {imageModels.map((model) => (
                          <option key={model.id} value={model.id}>{model.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      背景键色
                      <input aria-label="设置基准模板/待机背景键色" type="color" value={draft.keyColor} onChange={(event) => onChangeDraft("keyColor", event.target.value)} />
                    </label>
                    <label className="field">
                      公网资源地址
                      <input aria-label="设置公网资源地址" value={draft.publicAssetBaseUrl} placeholder="https://your-public-asset-host.example" onChange={(event) => onChangeDraft("publicAssetBaseUrl", event.target.value)} />
                    </label>
                  </div>
                </SettingsSubsection>
                <SettingsSubsection title="提示词设置">
                  <label className="field">
                    基准模板/待机提示词
                    <textarea aria-label="设置基准模板/待机提示词" rows={7} value={draft.basePrompt} onChange={(event) => onChangeDraft("basePrompt", event.target.value)} />
                  </label>
                  <label className="field prompt-final">
                    基准模板/待机最终提示词
                    <textarea aria-label="设置基准模板/待机最终提示词" rows={5} value={draft.basePrompt} readOnly />
                  </label>
                </SettingsSubsection>
                <SettingsSubsection title="处理设置">
                  <div className="form-grid">
                    <label className="field">
                      键色容差
                      <input aria-label="设置基准模板/待机键色容差" type="number" min={0} max={255} value={draft.tolerance} onChange={(event) => onChangeDraft("tolerance", clampNumber(Number(event.target.value), 0, 255, draft.tolerance))} />
                    </label>
                  </div>
                </SettingsSubsection>
              </>
            ) : null}

            {activeGroup === "walk-template" ? (
              <>
                <SettingsSubsection title="参考图设置">
                  <div className="stage-media-grid">
                    <div className="media-pane">
                      <div className="media-pane-title">walk 动作参考</div>
                      <ImagePreview alt="walk 动作参考图预览" preview={walkActionReferencePreview} emptyLabel="等待 walk 动作参考" />
                      <div className="control-row">
                        <FileButton
                          label={uploadingActionReferenceId === "walk" ? "上传中" : "上传并覆盖 walk 参考图"}
                          onFile={(file) => onUploadActionReference("walk", file)}
                        />
                      </div>
                    </div>
                  </div>
                </SettingsSubsection>
                <SettingsSubsection title="图片设置">
                  <div className="form-grid">
                    <label className="field">
                      图像模型
                      <select aria-label="设置步行图图像模型" value={draft.imageModel} onChange={(event) => onChangeDraft("imageModel", event.target.value)}>
                        {imageModels.map((model) => (
                          <option key={model.id} value={model.id}>{model.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                </SettingsSubsection>
                <SettingsSubsection title="提示词设置">
                  <label className="field">
                    步行图提示词
                    <textarea aria-label="设置步行图提示词" rows={7} value={draft.walkPrompt} onChange={(event) => onChangeDraft("walkPrompt", event.target.value)} />
                  </label>
                  <label className="field prompt-final">
                    步行图最终提示词
                    <textarea aria-label="设置步行图最终提示词" rows={5} value={draft.walkPrompt} readOnly />
                  </label>
                </SettingsSubsection>
                <SettingsSubsection title="处理设置">
                  <div className="form-grid">
                    <label className="field">
                      键色容差
                      <input aria-label="设置一键处理键色容差" type="number" min={0} max={255} value={draft.tolerance} onChange={(event) => onChangeDraft("tolerance", clampNumber(Number(event.target.value), 0, 255, draft.tolerance))} />
                    </label>
                  </div>
                </SettingsSubsection>
              </>
            ) : null}

            {activeGroup === "character-preview" ? (
              <SettingsSubsection title="预览设置">
                <div className="form-grid">
                  <label className="field">
                    idle FPS
                    <input aria-label="设置角色预览 idle FPS" type="number" min={1} max={24} value={draft.idleFps} onChange={(event) => onChangeDraft("idleFps", clampNumber(Number(event.target.value), 1, 24, draft.idleFps))} />
                  </label>
                  <label className="field">
                    walk FPS
                    <input aria-label="设置角色预览 walk FPS" type="number" min={1} max={24} value={draft.walkFps} onChange={(event) => onChangeDraft("walkFps", clampNumber(Number(event.target.value), 1, 24, draft.walkFps))} />
                  </label>
                  <label className="field">
                    显示尺寸
                    <input aria-label="设置角色预览显示尺寸" type="number" min={64} max={512} value={draft.previewSize} onChange={(event) => onChangeDraft("previewSize", clampNumber(Number(event.target.value), 64, 512, draft.previewSize))} />
                  </label>
                  <label className="field">
                    移动速度
                    <input aria-label="设置角色预览移动速度" type="number" min={20} max={600} value={draft.previewMoveSpeed} onChange={(event) => onChangeDraft("previewMoveSpeed", clampNumber(Number(event.target.value), 20, 600, draft.previewMoveSpeed))} />
                  </label>
                </div>
                <label className="toggle-field">
                  <input aria-label="设置角色预览显示中心线" type="checkbox" checked={draft.showGuides} onChange={(event) => onChangeDraft("showGuides", event.target.checked)} />
                  显示中心线
                </label>
              </SettingsSubsection>
            ) : null}
          </div>
          <button className="tool-button" type="button" onClick={onSave}>
            <Save size={16} /> {group.saveLabel}
          </button>
        </div>
      </div>
    </section>
  );
}

function SettingsSubsection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="module01-settings-subsection">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function WorkflowStage({
  controls,
  mediaPanes,
  status,
  title
}: {
  controls: React.ReactNode;
  mediaPanes: Array<{ title: string; content: ReactNode }>;
  status: string;
  title: string;
}) {
  return (
    <section className={["workflow-stage", mediaPanes.length >= 3 ? "workflow-stage-three-media" : ""].filter(Boolean).join(" ")}>
      <div className="stage-heading">
        <h2>{title}</h2>
        <span>{status}</span>
      </div>
      <div className={["stage-media-grid", mediaPanes.length >= 3 ? "stage-media-grid-three" : ""].filter(Boolean).join(" ")}>
        {mediaPanes.map((pane) => (
          <div className="media-pane" key={pane.title}>
            <div className="media-pane-title">{pane.title}</div>
            {pane.content}
          </div>
        ))}
      </div>
      <div className="stage-controls">{controls}</div>
    </section>
  );
}

function FileButton({ label, onFile }: { label: string; onFile: (file: File | undefined) => void }) {
  return (
    <label className="file-picker">
      <Upload size={16} /> {label}
      <input
        accept="image/*"
        type="file"
        style={{ display: "none" }}
        onChange={(event) => {
          onFile(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
    </label>
  );
}

function ImagePreview({
  alt,
  emptyLabel,
  preview
}: {
  alt: string;
  emptyLabel: string;
  preview: MediaPreview | null;
}) {
  return (
    <div className="media-box">
      {preview ? (
        <img alt={alt} src={toAbsoluteApiUrl(preview.url)} style={{ imageRendering: "pixelated" }} />
      ) : (
        <EmptyMedia label={emptyLabel} />
      )}
    </div>
  );
}

function EmptyMedia({ label }: { label: string }) {
  return (
    <div className="media-empty">
      <span>{label}</span>
    </div>
  );
}

function createEmptyPixelAssets(): PixelCharacterAssets {
  return {
    baseTemplate: {},
    walkTemplate: {},
    slices: {
      idle: { frames: [] },
      walk: { frames: [] }
    }
  };
}

function normalizePixelAssets(input: PixelCharacterAssets | null | undefined): PixelCharacterAssets {
  return {
    baseTemplate: {
      characterReference: input?.baseTemplate?.characterReference,
      output: input?.baseTemplate?.output
    },
    walkTemplate: {
      output: input?.walkTemplate?.output
    },
    slices: {
      idle: { frames: input?.slices?.idle?.frames ?? [] },
      walk: { frames: input?.slices?.walk?.frames ?? [] }
    }
  };
}

function applyUploadedAsset(
  current: PixelCharacterAssets,
  kind: "character-reference" | "base-template" | "walk-template",
  assetFile: PixelCharacterAssetFile
): PixelCharacterAssets {
  if (kind === "character-reference") {
    return {
      ...current,
      baseTemplate: {
        ...current.baseTemplate,
        characterReference: assetFile
      }
    };
  }
  if (kind === "base-template") {
    return {
      ...current,
      baseTemplate: {
        ...current.baseTemplate,
        output: assetFile
      }
    };
  }
  return {
    ...current,
    walkTemplate: {
      output: assetFile
    }
  };
}

function applySliceFrames(
  current: PixelCharacterAssets,
  sliceKind: PixelSpriteSliceKind,
  frames: PixelCharacterFrameAsset[]
): PixelCharacterAssets {
  return {
    ...current,
    slices: {
      ...current.slices,
      [sliceKind]: {
        frames
      }
    }
  };
}

function toPreview(asset: PixelCharacterAssetFile | undefined): MediaPreview | null {
  return asset ? { url: asset.url, label: asset.fileName } : null;
}

function actionReferencePreview(action: PixelSpriteActionTemplate, version = 0): MediaPreview {
  const cacheSuffix = version > 0 ? `?v=${version}` : "";
  return {
    url: `/module02/action-references/${encodeURIComponent(action.referenceImage)}${cacheSuffix}`,
    label: action.name
  };
}

function getActionRows(action: PixelSpriteActionTemplate): number {
  return action.rows ?? action.directionCount ?? 1;
}

function getActionColumns(action: PixelSpriteActionTemplate): number {
  return action.columns ?? action.defaultFrameCount ?? 1;
}

function upsertCharacter(characters: PixelCharacterFolder[], character: PixelCharacterFolder): PixelCharacterFolder[] {
  const exists = characters.some((item) => item.id === character.id);
  if (exists) {
    return characters.map((item) => (item.id === character.id ? character : item));
  }
  return [...characters, character].sort((first, second) => first.name.localeCompare(second.name));
}

function groupFramesByRow(frames: readonly PixelCharacterFrameAsset[]): Map<number, PixelCharacterFrameAsset[]> {
  const groups = new Map<number, PixelCharacterFrameAsset[]>();
  for (const frame of frames) {
    const group = groups.get(frame.row) ?? [];
    group.push(frame);
    groups.set(frame.row, group);
  }
  for (const group of groups.values()) {
    group.sort((first, second) => first.index - second.index);
  }
  return groups;
}

function directionToRow(direction: DirectionKey): number {
  return (DIRECTION_ROWS.find((item) => item.key === direction)?.row ?? 0) + 1;
}

function keyToDirection(key: string): DirectionKey | undefined {
  switch (key.toLowerCase()) {
    case "w":
      return "up";
    case "a":
      return "left";
    case "s":
      return "down";
    case "d":
      return "right";
    default:
      return undefined;
  }
}

function movePosition(current: { x: number; y: number }, direction: DirectionKey, distance: number): { x: number; y: number } {
  if (direction === "up") {
    return { ...current, y: current.y - distance };
  }
  if (direction === "down") {
    return { ...current, y: current.y + distance };
  }
  if (direction === "left") {
    return { ...current, x: current.x - distance };
  }
  return { ...current, x: current.x + distance };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function loadDraft(): PixelSpriteDraft {
  const raw = readStoredText(DRAFT_STORAGE_KEY, "") || readStoredText(LEGACY_DRAFT_STORAGE_KEY, "");
  if (!raw) {
    return DEFAULT_DRAFT;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PixelSpriteDraft>;
    return normalizeDraft(parsed);
  } catch {
    return DEFAULT_DRAFT;
  }
}

function normalizeDraft(input: Partial<PixelSpriteDraft>): PixelSpriteDraft {
  const basePrompt = normalizePromptValue(input.basePrompt, LEGACY_SHORT_BASE_PROMPT, DEFAULT_DRAFT.basePrompt);
  const walkPrompt = normalizePromptValue(input.walkPrompt, LEGACY_SHORT_WALK_PROMPT, DEFAULT_DRAFT.walkPrompt);
  return {
    ...DEFAULT_DRAFT,
    ...input,
    basePrompt,
    walkPrompt,
    tolerance: clampNumber(Number(input.tolerance), 0, 255, DEFAULT_DRAFT.tolerance),
    outputFrameWidth: clampNumber(Number(input.outputFrameWidth), 16, 512, DEFAULT_DRAFT.outputFrameWidth),
    outputFrameHeight: clampNumber(Number(input.outputFrameHeight), 16, 512, DEFAULT_DRAFT.outputFrameHeight),
    idleFps: clampNumber(Number(input.idleFps), 1, 24, DEFAULT_DRAFT.idleFps),
    walkFps: clampNumber(Number(input.walkFps), 1, 24, DEFAULT_DRAFT.walkFps),
    previewSize: clampNumber(Number(input.previewSize), 64, 512, DEFAULT_DRAFT.previewSize),
    previewMoveSpeed: clampNumber(Number(input.previewMoveSpeed), 20, 600, DEFAULT_DRAFT.previewMoveSpeed),
    showGuides: input.showGuides === true
  };
}

function normalizePromptValue(value: unknown, legacyShortValue: string, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed === legacyShortValue) {
    return fallback;
  }
  return value;
}

function writeDraft(draft: PixelSpriteDraft): void {
  writeStoredText(DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

function readStoredText(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStoredText(key: string, value: string): void {
  try {
    if (value) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // localStorage can be unavailable in some embedded browsers.
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
