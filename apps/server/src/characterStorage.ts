import { existsSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";

export interface CharacterFolder {
  id: string;
  name: string;
}

const INVALID_CHARACTER_NAME = /[<>:"/\\|?*\u0000-\u001F]/;

export function getCharactersRoot(storageDir: string): string {
  return resolve(storageDir, "characters");
}

export async function listCharacterFolders(storageDir: string): Promise<CharacterFolder[]> {
  const root = getCharactersRoot(storageDir);
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ id: entry.name, name: entry.name }))
    .sort((first, second) => first.name.localeCompare(second.name, "zh-Hans-CN"));
}

export async function createCharacterFolder(storageDir: string, name: string): Promise<CharacterFolder> {
  const id = normalizeCharacterId(name);
  const target = resolveCharacterPath(storageDir, id);
  if (existsSync(target)) {
    throw new Error("角色文件夹已存在。");
  }
  await mkdir(target, { recursive: false });
  return { id, name: id };
}

export async function deleteCharacterFolder(storageDir: string, characterId: string): Promise<CharacterFolder> {
  const id = normalizeCharacterId(characterId);
  const target = resolveCharacterPath(storageDir, id);
  if (!existsSync(target)) {
    throw new Error("角色文件夹不存在。");
  }
  await rm(target, { recursive: true, force: true });
  return { id, name: id };
}

export async function ensureCharacterFolder(storageDir: string, characterId: string): Promise<string> {
  const target = resolveCharacterPath(storageDir, characterId);
  if (!existsSync(target)) {
    throw new Error("请先创建或选择角色文件夹。");
  }
  return target;
}

export function resolveCharacterPath(storageDir: string, characterId: string, ...segments: string[]): string {
  const id = normalizeCharacterId(characterId);
  const root = getCharactersRoot(storageDir);
  const characterRoot = resolve(root, id);
  const target = resolve(characterRoot, ...segments);
  ensurePathInside(characterRoot, target);
  return target;
}

export async function removeCharacterFilesByStem(
  storageDir: string,
  characterId: string,
  directorySegments: readonly string[],
  stem: string
): Promise<void> {
  const directory = resolveCharacterPath(storageDir, characterId, ...directorySegments);
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(`${stem}.`))
    .map((entry) => rm(resolveCharacterPath(storageDir, characterId, ...directorySegments, entry.name), { force: true })));
}

export async function findCharacterFileByStem(
  storageDir: string,
  characterId: string,
  directorySegments: readonly string[],
  stem: string
): Promise<{ fileName: string; path: string } | undefined> {
  const directory = resolveCharacterPath(storageDir, characterId, ...directorySegments);
  if (!existsSync(directory)) {
    return undefined;
  }
  const entries = await readdir(directory, { withFileTypes: true });
  const fileName = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(`${stem}.`))
    .map((entry) => entry.name)
    .sort()[0];
  return fileName
    ? { fileName, path: resolveCharacterPath(storageDir, characterId, ...directorySegments, fileName) }
    : undefined;
}

export async function resetCharacterDirectory(
  storageDir: string,
  characterId: string,
  ...segments: string[]
): Promise<string> {
  const target = resolveCharacterPath(storageDir, characterId, ...segments);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  return target;
}

export function toCharacterUrl(characterId: string, ...segments: string[]): string {
  const encoded = [normalizeCharacterId(characterId), ...segments].map((segment) => encodeURIComponent(segment));
  return `/characters/${encoded.join("/")}`;
}

export function normalizeCharacterId(value: string): string {
  const id = value.trim();
  if (!id) {
    throw new Error("请先创建或选择角色文件夹。");
  }
  if (id === "." || id === ".." || INVALID_CHARACTER_NAME.test(id)) {
    throw new Error("角色名不能包含路径符号或 Windows 文件名非法字符。");
  }
  return id;
}

function ensurePathInside(root: string, target: string): void {
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  if (target !== root && !target.startsWith(normalizedRoot)) {
    throw new Error("角色文件路径越界。");
  }
}
