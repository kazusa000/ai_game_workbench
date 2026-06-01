import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import type { AppConfig } from "../config";
import {
  ensureCharacterFolder,
  normalizeCharacterId,
  resolveCharacterPath,
} from "../characterStorage";

type GodotExportRouteConfig = Pick<AppConfig, "storageDir" | "module01CharacterExportDir">;
type FourDirectionKey = "down" | "up" | "left" | "right";
type GodotActionKey = "idle" | "walk" | "run" | "attack1" | "jump";

interface GodotAnimationManifestEntry {
  name: string;
  action: GodotActionKey;
  direction: FourDirectionKey;
  fps: number;
  loop: boolean;
  frames: string[];
}

interface GodotExportManifest {
  characterId: string;
  frameSize: number;
  directions: FourDirectionKey[];
  animations: GodotAnimationManifestEntry[];
}

interface ActionDefinition {
  action: GodotActionKey;
  sourceSegments: readonly string[];
  fps: number;
  loop: boolean;
  singleDirectionFile?: boolean;
}

const GODOT_EXPORT_SIZES = [256, 384, 512, 1024] as const;
const DIRECTION_KEYS: readonly FourDirectionKey[] = ["down", "up", "left", "right"];
const ACTION_DEFINITIONS: readonly ActionDefinition[] = [
  {
    action: "idle",
    sourceSegments: ["base-character", "loop-export", "idle", "transparent"],
    fps: 12,
    loop: true,
    singleDirectionFile: true
  },
  {
    action: "walk",
    sourceSegments: ["base-character", "loop-export", "transparent"],
    fps: 30,
    loop: true
  },
  {
    action: "run",
    sourceSegments: ["advanced-character", "run", "export", "transparent"],
    fps: 30,
    loop: true
  },
  {
    action: "attack1",
    sourceSegments: ["advanced-character", "attack-1", "export", "transparent"],
    fps: 30,
    loop: false
  },
  {
    action: "jump",
    sourceSegments: ["advanced-character", "jump", "export", "transparent"],
    fps: 30,
    loop: false
  }
];

export function registerGodotExportRoutes(app: FastifyInstance, config: GodotExportRouteConfig): void {
  app.post("/api/export/godot", async (request, reply) => {
    const input = request.body as {
      characterId?: string;
      exportSize?: number;
    };
    const characterId = input.characterId?.trim() ?? "";
    const exportSize = input.exportSize ?? 512;
    if (!isGodotExportSize(exportSize)) {
      return reply.code(400).send({
        error: `Godot 导出尺寸只支持 ${GODOT_EXPORT_SIZES.join(" / ")}。`
      });
    }

    try {
      await ensureCharacterFolder(config.storageDir, characterId);
      const result = await exportGodotCharacter({
        storageDir: config.storageDir,
        exportDir: config.module01CharacterExportDir,
        characterId,
        exportSize
      });
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Godot 导出失败。";
      return reply.code(message.includes("没有可导出的动作帧") ? 404 : 400).send({ error: message });
    }
  });
}

async function exportGodotCharacter(input: {
  storageDir: string;
  exportDir: string;
  characterId: string;
  exportSize: (typeof GODOT_EXPORT_SIZES)[number];
}) {
  const characterId = normalizeCharacterId(input.characterId);
  const characterExportRoot = resolveExportPath(input.exportDir, characterId);
  await rm(characterExportRoot, { recursive: true, force: true });
  const exportRoot = resolveExportPath(input.exportDir, characterId, `size-${input.exportSize}`);
  await mkdir(exportRoot, { recursive: true });
  const filesForZip: Record<string, Buffer> = {};
  const manifest: GodotExportManifest = {
    characterId,
    frameSize: input.exportSize,
    directions: [...DIRECTION_KEYS],
    animations: []
  };
  const exportedActions = new Set<GodotActionKey>();

  for (const actionDefinition of ACTION_DEFINITIONS) {
    for (const direction of DIRECTION_KEYS) {
      const sourceFrames = await readActionDirectionFrames(input.storageDir, characterId, actionDefinition, direction);
      if (sourceFrames.length === 0) {
        continue;
      }

      const relativeFramePaths: string[] = [];
      const outputDir = join(exportRoot, "frames", actionDefinition.action, direction);
      await mkdir(outputDir, { recursive: true });
      for (const [index, sourceFrame] of sourceFrames.entries()) {
        const outputName = `${String(index).padStart(3, "0")}.png`;
        const relativePath = normalizeZipPath(join("frames", actionDefinition.action, direction, outputName));
        const outputBuffer = await resizeFrameForGodot(sourceFrame.buffer, input.exportSize);
        await writeFile(join(outputDir, outputName), outputBuffer);
        filesForZip[relativePath] = outputBuffer;
        relativeFramePaths.push(relativePath);
      }

      exportedActions.add(actionDefinition.action);
      manifest.animations.push({
        name: `${actionDefinition.action}_${direction}`,
        action: actionDefinition.action,
        direction,
        fps: actionDefinition.fps,
        loop: actionDefinition.loop,
        frames: relativeFramePaths
      });
    }
  }

  if (manifest.animations.length === 0) {
    throw new Error("当前角色没有可导出的动作帧，请先完成待机、步行或进阶动作处理。");
  }

  const manifestBuffer = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const importScriptBuffer = Buffer.from(buildGodotImportScript(), "utf8");
  await writeFile(join(exportRoot, "animations.json"), manifestBuffer);
  await writeFile(join(exportRoot, "import_to_godot.gd"), importScriptBuffer);
  filesForZip["animations.json"] = manifestBuffer;
  filesForZip["import_to_godot.gd"] = importScriptBuffer;
  await writeZipFile(join(exportRoot, "godot-export.zip"), filesForZip);

  return {
    characterId,
    exportSize: input.exportSize,
    exportedActions: [...exportedActions],
    animationCount: manifest.animations.length,
    exportRootPath: exportRoot,
    exportRootUrl: toCharacterExportUrl(characterId, `size-${input.exportSize}`),
    manifestUrl: toCharacterExportUrl(characterId, `size-${input.exportSize}`, "animations.json"),
    importScriptUrl: toCharacterExportUrl(characterId, `size-${input.exportSize}`, "import_to_godot.gd"),
    zipUrl: toCharacterExportUrl(characterId, `size-${input.exportSize}`, "godot-export.zip")
  };
}

async function readActionDirectionFrames(
  storageDir: string,
  characterId: string,
  action: ActionDefinition,
  direction: FourDirectionKey
): Promise<{ fileName: string; buffer: Buffer }[]> {
  if (action.singleDirectionFile) {
    const path = resolveCharacterPath(storageDir, characterId, ...action.sourceSegments, `${direction}.png`);
    if (!existsSync(path)) {
      return [];
    }
    return [{
      fileName: `${direction}.png`,
      buffer: await readFile(path)
    }];
  }

  const directory = resolveCharacterPath(storageDir, characterId, ...action.sourceSegments, direction);
  if (!existsSync(directory)) {
    return [];
  }
  const frameNames = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"))
    .map((entry) => entry.name)
    .sort(compareFrameNames);
  const frames = [];
  for (const fileName of frameNames) {
    frames.push({
      fileName,
      buffer: await readFile(join(directory, fileName))
    });
  }
  return frames;
}

async function resizeFrameForGodot(buffer: Buffer, exportSize: number): Promise<Buffer> {
  return sharp(buffer)
    .resize(exportSize, exportSize, {
      fit: "contain",
      kernel: sharp.kernel.lanczos3,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();
}

function compareFrameNames(first: string, second: string): number {
  const firstNumber = inferFrameNumber(first);
  const secondNumber = inferFrameNumber(second);
  if (firstNumber !== secondNumber) {
    return firstNumber - secondNumber;
  }
  return first.localeCompare(second, "en");
}

function inferFrameNumber(fileName: string): number {
  const match = fileName.match(/(\d+)(?=\.[^.]+$)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function isGodotExportSize(value: number): value is (typeof GODOT_EXPORT_SIZES)[number] {
  return GODOT_EXPORT_SIZES.includes(value as (typeof GODOT_EXPORT_SIZES)[number]);
}

function normalizeZipPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function resolveExportPath(exportDir: string, characterId: string, ...segments: string[]): string {
  const root = resolve(exportDir);
  const target = resolve(root, normalizeCharacterId(characterId), ...segments);
  ensurePathInside(root, target);
  return target;
}

function ensurePathInside(root: string, target: string): void {
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  if (target !== root && !target.startsWith(normalizedRoot)) {
    throw new Error("导出路径越界。");
  }
}

function toCharacterExportUrl(characterId: string, ...segments: string[]): string {
  const encoded = [normalizeCharacterId(characterId), ...segments].map((segment) => encodeURIComponent(segment));
  return `/exports/character-2d/${encoded.join("/")}`;
}

function buildGodotImportScript(): string {
  return `@tool
extends EditorScript

# Godot 4 helper.
# Put this exported folder under res://, then run this script from the Godot editor.
# It reads animations.json and creates a SpriteFrames resource next to it.

func _run() -> void:
	var base_path := get_script().resource_path.get_base_dir()
	var manifest_path := base_path.path_join("animations.json")
	if not FileAccess.file_exists(manifest_path):
		push_error("animations.json not found: " + manifest_path)
		return
	var parsed := JSON.parse_string(FileAccess.get_file_as_string(manifest_path))
	if typeof(parsed) != TYPE_DICTIONARY:
		push_error("animations.json is invalid.")
		return
	var frames := SpriteFrames.new()
	for animation in parsed.get("animations", []):
		var animation_name := String(animation.get("name", ""))
		if animation_name.is_empty():
			continue
		frames.add_animation(animation_name)
		frames.set_animation_speed(animation_name, float(animation.get("fps", 30)))
		frames.set_animation_loop(animation_name, bool(animation.get("loop", true)))
		for frame_path in animation.get("frames", []):
			var texture := load(base_path.path_join(String(frame_path)))
			if texture:
				frames.add_frame(animation_name, texture)
	ResourceSaver.save(frames, base_path.path_join("sprite_frames.tres"))
	print("Saved SpriteFrames: " + base_path.path_join("sprite_frames.tres"))
`;
}

async function writeZipFile(path: string, files: Record<string, Buffer>): Promise<void> {
  const entries = Object.entries(files);
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const [name, data] of entries) {
    const nameBuffer = Buffer.from(normalizeZipPath(name), "utf8");
    const crc = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + data.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  await writeFile(path, Buffer.concat([...localParts, ...centralParts, end]));
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
