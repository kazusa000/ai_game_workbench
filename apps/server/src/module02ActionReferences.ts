import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

export type Module02ActionReferenceId = "idle" | "walk";

const MODULE02_ACTION_REFERENCE_DEFINITIONS: Record<Module02ActionReferenceId, {
  fileName: string;
  routePath: string;
  presetPath: readonly string[];
}> = {
  idle: {
    fileName: "idle-2x2-centered.png",
    routePath: "/module02/action-references/idle-2x2-centered.png",
    presetPath: ["module02", "base-idle", "action-reference.png"]
  },
  walk: {
    fileName: "walk-4x10-no-shadow.png",
    routePath: "/module02/action-references/walk-4x10-no-shadow.png",
    presetPath: ["module02", "walk", "action-reference.png"]
  }
};

export function isModule02ActionReferenceId(value: string | undefined): value is Module02ActionReferenceId {
  return value === "idle" || value === "walk";
}

export function getModule02ActionReferenceFileName(actionId: Module02ActionReferenceId): string {
  return MODULE02_ACTION_REFERENCE_DEFINITIONS[actionId].fileName;
}

export function getModule02ActionReferenceUrl(actionId: Module02ActionReferenceId): string {
  return MODULE02_ACTION_REFERENCE_DEFINITIONS[actionId].routePath;
}

export function resolveModule02ActionReferenceOverridePath(
  presetsDir: string,
  actionId: Module02ActionReferenceId
): string {
  return join(presetsDir, ...MODULE02_ACTION_REFERENCE_DEFINITIONS[actionId].presetPath);
}

export function resolveModule02ActionReferencePath(
  presetsDir: string,
  referenceImage: string
): string {
  const actionId = findModule02ActionReferenceIdByFileName(referenceImage);
  if (!actionId) {
    return join(presetsDir, "module02", basename(referenceImage));
  }
  return resolveModule02ActionReferenceOverridePath(presetsDir, actionId);
}

export function readModule02ActionReferenceBuffer(
  presetsDir: string,
  referenceImage: string
): Promise<Buffer> {
  return readFile(resolveModule02ActionReferencePath(presetsDir, referenceImage));
}

function findModule02ActionReferenceIdByFileName(fileName: string): Module02ActionReferenceId | undefined {
  const safeFileName = basename(fileName);
  return (Object.entries(MODULE02_ACTION_REFERENCE_DEFINITIONS) as Array<[Module02ActionReferenceId, { fileName: string }]>)
    .find(([, definition]) => definition.fileName === safeFileName)?.[0];
}
