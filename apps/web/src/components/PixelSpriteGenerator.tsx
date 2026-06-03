import { useEffect, useMemo, useState } from "react";
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
  uploadModule02CharacterAsset,
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

const PAGE_LABELS: Record<PixelPage, string> = {
  "base-template": "基准模板",
  "walk-template": "步行",
  "character-preview": "角色预览",
  "module-settings": "模块设置"
};

const SETTINGS_GROUPS: Array<{ id: PixelSettingsGroup; label: string; saveLabel: string }> = [
  { id: "base-template", label: "基准模板设置", saveLabel: "保存基准模板设置" },
  { id: "walk-template", label: "步行设置", saveLabel: "保存步行设置" },
  { id: "character-preview", label: "角色预览设置", saveLabel: "保存角色预览设置" }
];
const DEFAULT_SETTINGS_GROUP = SETTINGS_GROUPS[0] as { id: PixelSettingsGroup; label: string; saveLabel: string };

const DEFAULT_DRAFT: PixelSpriteDraft = {
  imageModel: DEFAULT_IMAGE_MODEL,
  publicAssetBaseUrl: "",
  keyColor: DEFAULT_KEY_COLOR,
  basePrompt: "生成一个 2x2 接触表格式像素角色基准模板，保持纯色背景，角色居中，四方向一致。",
  walkPrompt: "基于角色基准模板生成四方向步行动作 sprite sheet。保持角色比例、服装、配色一致。",
  tolerance: 34,
  outputFrameWidth: 64,
  outputFrameHeight: 128,
  idleFps: 2,
  walkFps: 8,
  previewSize: 192,
  showGuides: false
};

const FALLBACK_ACTIONS: Record<"idle" | "walk", PixelSpriteActionTemplate> = {
  idle: {
    id: "idle",
    name: "角色基准模板",
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
  const [baseStatus, setBaseStatus] = useState("选择或创建像素角色后，生成或上传基准模板。");
  const [walkStatus, setWalkStatus] = useState("先生成角色基准模板，再生成四方向步行图。");
  const [sliceStatus, setSliceStatus] = useState("切帧会写入当前像素角色的 slices/idle 与 slices/walk。");
  const [previewStatus, setPreviewStatus] = useState("");
  const [isGeneratingBase, setIsGeneratingBase] = useState(false);
  const [isGeneratingWalk, setIsGeneratingWalk] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeDirection, setActiveDirection] = useState<DirectionKey>("down");
  const [isWalking, setIsWalking] = useState(false);
  const [previewFrameIndex, setPreviewFrameIndex] = useState(0);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [settingsStatus, setSettingsStatus] = useState("按分类调整模块 02 默认参数，保存后影响后续生成和处理。");

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
      setActiveDirection(direction);
      setIsWalking(true);
      setPosition((current) => movePosition(current, direction));
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (keyToDirection(event.key)) {
        setIsWalking(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
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

  const handleGenerateBaseTemplate = async () => {
    const characterId = requireActiveCharacter(setBaseStatus);
    if (!characterId) {
      return;
    }
    setIsGeneratingBase(true);
    setBaseStatus("正在生成角色基准模板...");
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
      setBaseStatus("角色基准模板生成完成。");
    } catch (error: unknown) {
      setBaseStatus(`角色基准模板生成失败：${getErrorMessage(error)}`);
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
      setWalkStatus("请先生成或上传角色基准模板。");
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
      throw new Error(isIdle ? "缺少角色基准模板。" : "缺少四方向步行图。");
    }
    return processSpriteSheet({
      pixelCharacterId: characterId,
      sliceKind,
      sourceUrl,
      rows: isIdle ? idleAction.rows : walkAction.rows,
      columns: isIdle ? idleAction.columns : walkAction.columns,
      keyColor: draft.keyColor,
      tolerance: draft.tolerance,
      centerFrames: true,
      centerMode: isIdle ? "frame" : "row",
      outputFrameWidth: draft.outputFrameWidth,
      outputFrameHeight: draft.outputFrameHeight,
      normalizeSubjectScale: true,
      directionLayout: isIdle ? "contact-2x2" : "grid"
    });
  };

  const handleSlice = async (sliceKind: PixelSpriteSliceKind) => {
    setIsProcessing(true);
    setSliceStatus(sliceKind === "idle" ? "正在切分 idle 帧..." : "正在切分 walk 帧...");
    try {
      const result = await runSlice(sliceKind);
      setAssets((current) => applySliceFrames(current, sliceKind, result.frames));
      setSliceStatus(`${sliceKind} 切帧完成，共 ${result.frameCount} 帧。`);
    } catch (error: unknown) {
      setSliceStatus(`${sliceKind} 切帧失败：${getErrorMessage(error)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSliceAll = async () => {
    setIsProcessing(true);
    setSliceStatus("正在一键处理 walk 与 idle 切帧...");
    try {
      const walkResult = await runSlice("walk");
      setAssets((current) => applySliceFrames(current, "walk", walkResult.frames));
      const idleResult = await runSlice("idle");
      setAssets((current) => applySliceFrames(current, "idle", idleResult.frames));
      setSliceStatus(`一键切帧完成：walk ${walkResult.frameCount} 帧，idle ${idleResult.frameCount} 帧。`);
    } catch (error: unknown) {
      setSliceStatus(`一键切帧失败：${getErrorMessage(error)}`);
    } finally {
      setIsProcessing(false);
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
          基准模板
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
              title="角色基准模板"
              status={baseStatus}
              mediaPanes={[
                {
                  title: "角色参考图",
                  content: <ImagePreview alt="角色参考图预览" preview={characterReferencePreview} emptyLabel="等待角色参考图" />
                },
                {
                  title: "角色基准模板",
                  content: <ImagePreview alt="角色基准模板预览" preview={baseTemplatePreview} emptyLabel="等待角色基准模板" />
                }
              ]}
              controls={(
                <>
                  <div className="control-row">
                    <FileButton label="上传角色参考图" onFile={(file) => void handleUploadAsset("character-reference", file)} />
                    <FileButton label="上传角色基准模板" onFile={(file) => void handleUploadAsset("base-template", file)} />
                    <button className="tool-button primary" type="button" disabled={isGeneratingBase} onClick={() => void handleGenerateBaseTemplate()}>
                      <WandSparkles size={16} /> {isGeneratingBase ? "生成中" : "生成角色基准模板"}
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
                  title: "角色基准模板",
                  content: <ImagePreview alt="步行图输入基准模板预览" preview={baseTemplatePreview} emptyLabel="等待角色基准模板" />
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
                    <button className="tool-button" type="button" disabled={isProcessing} onClick={() => void handleSlice("idle")}>
                      <Scissors size={16} /> 处理 idle 帧
                    </button>
                    <button className="tool-button" type="button" disabled={isProcessing} onClick={() => void handleSlice("walk")}>
                      <Scissors size={16} /> 处理 walk 帧
                    </button>
                    <button aria-label="执行一键处理" className="tool-button primary" type="button" disabled={isProcessing} onClick={() => void handleSliceAll()}>
                      <Scissors size={16} /> {isProcessing ? "处理中" : "一键处理"}
                    </button>
                  </div>
                  <div className="stage-media-grid">
                    <div className="media-pane">
                      <div className="media-pane-title">idle 帧</div>
                      <FramePreviewGrid frames={idleFrames} emptyLabel="等待 idle 处理结果" />
                    </div>
                    <div className="media-pane">
                      <div className="media-pane-title">walk 帧</div>
                      <FramePreviewGrid frames={walkFrames} emptyLabel="等待 walk 处理结果" />
                    </div>
                  </div>
                </>
              )}
            />
          ) : null}

          {activePage === "module-settings" ? (
            <PixelModuleSettings
              activeGroup={activeSettingsGroup}
              draft={settingsDraft}
              idleActionReferencePreview={actionReferencePreview(idleAction)}
              imageModels={imageModels}
              status={settingsStatus}
              walkActionReferencePreview={actionReferencePreview(walkAction)}
              onChangeDraft={updateSettingsDraft}
              onChangeGroup={setActiveSettingsGroup}
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
  walkActionReferencePreview,
  onChangeDraft,
  onChangeGroup,
  onSave
}: {
  activeGroup: PixelSettingsGroup;
  draft: PixelSpriteDraft;
  idleActionReferencePreview: MediaPreview | null;
  imageModels: readonly { id: string; label: string }[];
  status: string;
  walkActionReferencePreview: MediaPreview | null;
  onChangeDraft: <Key extends keyof PixelSpriteDraft>(key: Key, value: PixelSpriteDraft[Key]) => void;
  onChangeGroup: (group: PixelSettingsGroup) => void;
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
                    </div>
                  </div>
                </SettingsSubsection>
                <SettingsSubsection title="图片设置">
                  <div className="form-grid">
                    <label className="field">
                      图像模型
                      <select aria-label="设置基准模板图像模型" value={draft.imageModel} onChange={(event) => onChangeDraft("imageModel", event.target.value)}>
                        {imageModels.map((model) => (
                          <option key={model.id} value={model.id}>{model.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      背景键色
                      <input aria-label="设置基准模板背景键色" type="color" value={draft.keyColor} onChange={(event) => onChangeDraft("keyColor", event.target.value)} />
                    </label>
                    <label className="field">
                      公网资源地址
                      <input aria-label="设置公网资源地址" value={draft.publicAssetBaseUrl} placeholder="https://your-public-asset-host.example" onChange={(event) => onChangeDraft("publicAssetBaseUrl", event.target.value)} />
                    </label>
                  </div>
                </SettingsSubsection>
                <SettingsSubsection title="提示词设置">
                  <label className="field">
                    基准模板提示词
                    <textarea aria-label="设置基准模板提示词" rows={7} value={draft.basePrompt} onChange={(event) => onChangeDraft("basePrompt", event.target.value)} />
                  </label>
                  <label className="field prompt-final">
                    基准模板最终提示词
                    <textarea aria-label="设置基准模板最终提示词" rows={5} value={draft.basePrompt} readOnly />
                  </label>
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
                    <label className="field">
                      输出帧宽
                      <input aria-label="设置一键处理输出帧宽" type="number" min={16} max={512} value={draft.outputFrameWidth} onChange={(event) => onChangeDraft("outputFrameWidth", clampNumber(Number(event.target.value), 16, 512, draft.outputFrameWidth))} />
                    </label>
                    <label className="field">
                      输出帧高
                      <input aria-label="设置一键处理输出帧高" type="number" min={16} max={512} value={draft.outputFrameHeight} onChange={(event) => onChangeDraft("outputFrameHeight", clampNumber(Number(event.target.value), 16, 512, draft.outputFrameHeight))} />
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

function FramePreviewGrid({ emptyLabel, frames }: { emptyLabel: string; frames: PixelCharacterFrameAsset[] }) {
  if (frames.length === 0) {
    return (
      <div className="media-box">
        <EmptyMedia label={emptyLabel} />
      </div>
    );
  }
  const groups = groupFramesByRow(frames);
  return (
    <div className="media-box">
      <div className="direction-preview-grid">
        {DIRECTION_ROWS.map((direction) => {
          const rowFrames = groups.get(direction.row) ?? [];
          const firstFrame = rowFrames[0];
          return (
            <div className="direction-preview-card" key={direction.key}>
              <div className="direction-preview-title">
                <strong>{direction.label}</strong>
                <span>{rowFrames.length} 帧</span>
              </div>
              <div className="direction-preview-image">
                {firstFrame ? <img alt={`${direction.label} 切帧预览`} src={toAbsoluteApiUrl(firstFrame.url)} style={{ imageRendering: "pixelated" }} /> : <EmptyMedia label="等待帧" />}
              </div>
            </div>
          );
        })}
      </div>
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

function actionReferencePreview(action: PixelSpriteActionTemplate): MediaPreview {
  return {
    url: `/module02/action-references/${encodeURIComponent(action.referenceImage)}`,
    label: action.name
  };
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
  return DIRECTION_ROWS.find((item) => item.key === direction)?.row ?? 0;
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

function movePosition(current: { x: number; y: number }, direction: DirectionKey): { x: number; y: number } {
  const step = 12;
  if (direction === "up") {
    return { ...current, y: current.y - step };
  }
  if (direction === "down") {
    return { ...current, y: current.y + step };
  }
  if (direction === "left") {
    return { ...current, x: current.x - step };
  }
  return { ...current, x: current.x + step };
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
  return {
    ...DEFAULT_DRAFT,
    ...input,
    tolerance: clampNumber(Number(input.tolerance), 0, 255, DEFAULT_DRAFT.tolerance),
    outputFrameWidth: clampNumber(Number(input.outputFrameWidth), 16, 512, DEFAULT_DRAFT.outputFrameWidth),
    outputFrameHeight: clampNumber(Number(input.outputFrameHeight), 16, 512, DEFAULT_DRAFT.outputFrameHeight),
    idleFps: clampNumber(Number(input.idleFps), 1, 24, DEFAULT_DRAFT.idleFps),
    walkFps: clampNumber(Number(input.walkFps), 1, 24, DEFAULT_DRAFT.walkFps),
    previewSize: clampNumber(Number(input.previewSize), 64, 512, DEFAULT_DRAFT.previewSize),
    showGuides: input.showGuides === true
  };
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
