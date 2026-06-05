import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type Module01ReferenceImageKind = "style" | "walk" | "idle" | "run";

const REFERENCE_IMAGE_DEFINITIONS: Record<Module01ReferenceImageKind, {
  fileName: string;
  routePath: string;
  presetPath: readonly string[];
}> = {
  style: {
    fileName: "cel-anime-south-facing.png",
    routePath: "/style-references/cel-anime-south-facing.png",
    presetPath: ["module01", "base-template", "style-reference.png"]
  },
  walk: {
    fileName: "walk-4dir.png",
    routePath: "/direction-references/walk-4dir.png",
    presetPath: ["module01", "walk", "direction-reference.png"]
  },
  idle: {
    fileName: "idle-4dir.png",
    routePath: "/direction-references/idle-4dir.png",
    presetPath: ["module01", "idle", "direction-reference.png"]
  },
  run: {
    fileName: "run-4dir.png",
    routePath: "/direction-references/run-4dir.png",
    presetPath: ["module01", "run", "direction-reference.png"]
  }
};

export function isModule01ReferenceImageKind(value: string | undefined): value is Module01ReferenceImageKind {
  return value === "style" || value === "walk" || value === "idle" || value === "run";
}

export function getModule01ReferenceImageFileName(kind: Module01ReferenceImageKind): string {
  return REFERENCE_IMAGE_DEFINITIONS[kind].fileName;
}

export function getModule01ReferenceImageUrl(kind: Module01ReferenceImageKind): string {
  return REFERENCE_IMAGE_DEFINITIONS[kind].routePath;
}

export function resolveModule01ReferenceImageOverridePath(
  presetsDir: string,
  kind: Module01ReferenceImageKind
): string {
  return join(presetsDir, ...REFERENCE_IMAGE_DEFINITIONS[kind].presetPath);
}

export function resolveModule01ReferenceImagePath(
  presetsDir: string,
  kind: Module01ReferenceImageKind
): string {
  return resolveModule01ReferenceImageOverridePath(presetsDir, kind);
}

export function readModule01ReferenceImageBuffer(
  presetsDir: string,
  kind: Module01ReferenceImageKind
): Promise<Buffer> {
  return readFile(resolveModule01ReferenceImagePath(presetsDir, kind));
}
