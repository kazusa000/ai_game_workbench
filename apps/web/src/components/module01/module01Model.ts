export type Module01Page =
  | "one-click-character"
  | "base-template"
  | "walk"
  | "idle"
  | "run"
  | "attack-1"
  | "jump"
  | "character-preview"
  | "godot-export"
  | "module-settings";

export type Module01SettingsGroup =
  | "base-template"
  | "walk"
  | "idle"
  | "run"
  | "attack-1"
  | "jump"
  | "character-preview"
  | "godot-export";

export interface Module01NavItem {
  id: Module01Page;
  label: string;
  shortLabel: string;
}

export const MODULE01_NAV_ITEMS = [
  { id: "one-click-character", label: "一键生成", shortLabel: "一键" },
  { id: "base-template", label: "基准模板", shortLabel: "基准" },
  { id: "walk", label: "步行", shortLabel: "步行" },
  { id: "idle", label: "待机", shortLabel: "待机" },
  { id: "run", label: "跑步", shortLabel: "跑步" },
  { id: "attack-1", label: "攻击 1", shortLabel: "攻击" },
  { id: "jump", label: "跳跃", shortLabel: "跳跃" },
  { id: "character-preview", label: "角色预览", shortLabel: "预览" },
  { id: "godot-export", label: "导出", shortLabel: "导出" },
  { id: "module-settings", label: "模块设置", shortLabel: "设置" }
] as const satisfies readonly Module01NavItem[];

export const MODULE01_PAGE_LABELS = Object.fromEntries(
  MODULE01_NAV_ITEMS.map((item) => [item.id, item.label])
) as Record<Module01Page, string>;

export interface Module01SettingsGroupItem {
  id: Module01SettingsGroup;
  label: string;
  saveLabel: string;
}

export const MODULE01_SETTINGS_GROUPS = [
  { id: "base-template", label: "基准模板设置", saveLabel: "保存基准模板设置" },
  { id: "walk", label: "步行设置", saveLabel: "保存步行设置" },
  { id: "idle", label: "待机设置", saveLabel: "保存待机设置" },
  { id: "run", label: "跑步设置", saveLabel: "保存跑步设置" },
  { id: "attack-1", label: "攻击 1 设置", saveLabel: "保存攻击 1 设置" },
  { id: "jump", label: "跳跃设置", saveLabel: "保存跳跃设置" },
  { id: "character-preview", label: "角色预览设置", saveLabel: "保存角色预览设置" },
  { id: "godot-export", label: "导出设置", saveLabel: "保存导出设置" }
] as const satisfies readonly Module01SettingsGroupItem[];
