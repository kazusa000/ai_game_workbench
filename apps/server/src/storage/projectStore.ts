import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DEFAULT_KEYS, type ProjectState, type SavedAnimationKeys } from "@ai-game-workbench/core";

export interface ProjectStore {
  getOrCreateProject(projectId: string): Promise<ProjectState>;
  saveProjectKeys(projectId: string, keys: SavedAnimationKeys): Promise<ProjectState>;
}

export function createProjectStore(options: { storageDir: string }): ProjectStore {
  return {
    async getOrCreateProject(projectId) {
      const path = resolveProjectPath(options.storageDir, projectId);
      const existing = await readProject(path);
      if (existing) {
        return existing;
      }
      return writeProject(path, createDefaultProject(projectId));
    },

    async saveProjectKeys(projectId, keys) {
      const path = resolveProjectPath(options.storageDir, projectId);
      const existing = await readProject(path);
      return writeProject(path, {
        ...(existing ?? createDefaultProject(projectId)),
        projectId,
        keys,
        updatedAt: new Date().toISOString()
      });
    }
  };
}

function createDefaultProject(projectId: string): ProjectState {
  return {
    projectId,
    keys: DEFAULT_KEYS,
    updatedAt: new Date().toISOString()
  };
}

async function readProject(path: string): Promise<ProjectState | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as ProjectState;
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeProject(path: string, project: ProjectState): Promise<ProjectState> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(project, null, 2)}\n`, "utf8");
  return project;
}

function resolveProjectPath(storageDir: string, projectId: string): string {
  return join(storageDir, "projects", encodeURIComponent(projectId || "default"), "project.json");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
