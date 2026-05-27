import type { ProjectState, SavedAnimationKeys } from "@ai-game-workbench/core";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";

export async function getProject(projectId = "default"): Promise<ProjectState> {
  const response = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}`);
  if (!response.ok) {
    throw new Error(`Failed to load project: ${response.status}`);
  }
  return response.json() as Promise<ProjectState>;
}

export async function saveProjectKeys(
  projectId: string,
  keys: SavedAnimationKeys
): Promise<ProjectState> {
  const response = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/keys`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(keys)
  });
  if (!response.ok) {
    throw new Error(`Failed to save project keys: ${response.status}`);
  }
  return response.json() as Promise<ProjectState>;
}
