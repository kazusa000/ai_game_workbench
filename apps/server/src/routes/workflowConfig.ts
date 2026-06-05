import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

const MODULE01_WORKFLOW_CONFIG_PATH = ["module01", "workflow.json"] as const;
const MODULE02_WORKFLOW_CONFIG_PATH = ["module02", "workflow.json"] as const;

export function registerWorkflowConfigRoutes(
  app: FastifyInstance,
  options: { presetsDir: string }
): void {
  app.get("/api/module01/workflow-config", async () => ({
    config: await readModule01WorkflowConfig(options.presetsDir)
  }));

  app.put("/api/module01/workflow-config", async (request, reply) => {
    const config = request.body;
    if (!isPlainObject(config)) {
      return reply.code(400).send({ error: "workflow config must be an object" });
    }
    await writeModule01WorkflowConfig(options.presetsDir, config);
    return { config };
  });

  app.get("/api/module02/workflow-config", async () => ({
    config: await readModule02WorkflowConfig(options.presetsDir)
  }));

  app.put("/api/module02/workflow-config", async (request, reply) => {
    const config = request.body;
    if (!isPlainObject(config)) {
      return reply.code(400).send({ error: "workflow config must be an object" });
    }
    await writeModule02WorkflowConfig(options.presetsDir, config);
    return { config };
  });
}

export async function readModule01WorkflowConfig(presetsDir: string): Promise<Record<string, unknown> | null> {
  const path = resolveModule01WorkflowConfigPath(presetsDir);
  if (!existsSync(path)) {
    return null;
  }
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return isPlainObject(parsed) ? parsed : null;
}

export async function writeModule01WorkflowConfig(
  presetsDir: string,
  config: Record<string, unknown>
): Promise<void> {
  const path = resolveModule01WorkflowConfigPath(presetsDir);
  await mkdir(join(presetsDir, "module01"), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export async function readModule02WorkflowConfig(presetsDir: string): Promise<Record<string, unknown> | null> {
  const path = resolveModule02WorkflowConfigPath(presetsDir);
  if (!existsSync(path)) {
    return null;
  }
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return isPlainObject(parsed) ? parsed : null;
}

export async function writeModule02WorkflowConfig(
  presetsDir: string,
  config: Record<string, unknown>
): Promise<void> {
  const path = resolveModule02WorkflowConfigPath(presetsDir);
  await mkdir(join(presetsDir, "module02"), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function resolveModule01WorkflowConfigPath(presetsDir: string): string {
  return join(presetsDir, ...MODULE01_WORKFLOW_CONFIG_PATH);
}

function resolveModule02WorkflowConfigPath(presetsDir: string): string {
  return join(presetsDir, ...MODULE02_WORKFLOW_CONFIG_PATH);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
