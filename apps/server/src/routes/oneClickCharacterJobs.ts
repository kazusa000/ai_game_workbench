import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type { FastifyInstance, InjectOptions } from "fastify";
import type { AppConfig } from "../config";
import {
  createCharacterFolder,
  deleteCharacterFolder,
  ensureCharacterFolder,
  normalizeCharacterId,
  removeCharacterFilesByStem,
  resolveCharacterPath
} from "../characterStorage";
import { readModule01WorkflowConfig } from "./workflowConfig";

type AdvancedActionKind = "run" | "attack-1" | "jump";
type OneClickStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";
type OneClickJobStatus = "running" | "completed" | "failed";

export interface OneClickCharacterJob {
  jobId: string;
  characterId: string;
  status: OneClickJobStatus;
  currentStep: string;
  progressPercent: number;
  steps: OneClickJobStep[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OneClickJobStep {
  id: string;
  label: string;
  status: OneClickStepStatus;
  error?: string;
  resultUrl?: string;
}

export interface OneClickJobContext {
  updateStep: (stepId: string, status: OneClickStepStatus, patch?: Partial<OneClickJobStep>) => void;
  getStepStatus: (stepId: string) => OneClickStepStatus | undefined;
}

export type OneClickCharacterJobRunner = (
  job: OneClickCharacterJob,
  context: OneClickJobContext
) => Promise<void>;

type OneClickCharacterRouteConfig = Pick<AppConfig, "storageDir" | "openRouterApiKey" | "publicAssetBaseUrl" | "ffmpegPath"> & {
  oneClickCharacterJobRunner?: OneClickCharacterJobRunner;
};

interface OneClickCharacterJobInput {
  characterName?: string;
  overwrite?: boolean;
  publicAssetBaseUrl?: string;
  referenceImageDataUrl?: string;
  firstFrame?: {
    model?: string;
    prompt?: string;
    targetSize?: number;
    keyColor?: string;
    style?: string;
  };
  actions?: {
    run?: boolean;
    attack1?: boolean;
    jump?: boolean;
  };
}

const REQUIRED_BASE_STEP_IDS = [
  "create-character",
  "save-reference",
  "base-template",
  "walk-4dir",
  "idle-4dir",
  "walk-video",
  "walk-loop-export",
  "idle-loop-export"
] as const;

export function registerOneClickCharacterRoutes(app: FastifyInstance, config: OneClickCharacterRouteConfig): void {
  const jobs = new Map<string, OneClickCharacterJob>();

  app.put("/api/module01/secrets/openrouter-key", async (request, reply) => {
    const input = request.body as { apiKey?: string };
    const apiKey = input.apiKey?.trim();
    if (!apiKey) {
      await writeOpenRouterSecret(config.storageDir, "");
      return { configured: false };
    }
    await writeOpenRouterSecret(config.storageDir, apiKey);
    return { configured: true, suffix: getSecretSuffix(apiKey) };
  });

  app.get("/api/module01/secrets/openrouter-key", async () => {
    const apiKey = await readOpenRouterSecret(config.storageDir);
    return apiKey ? { configured: true, suffix: getSecretSuffix(apiKey) } : { configured: false };
  });

  app.get("/api/module01/one-click-character-jobs/active", async (request) => {
    const { characterId } = request.query as { characterId?: string };
    const normalized = characterId ? normalizeCharacterId(characterId) : "";
    const job = [...jobs.values()]
      .filter((item) => item.status === "running")
      .find((item) => !normalized || item.characterId === normalized);
    return { job: job ?? null };
  });

  app.get("/api/module01/one-click-character-jobs/:jobId", async (request, reply) => {
    const { jobId } = request.params as { jobId?: string };
    const job = jobId ? jobs.get(jobId) : undefined;
    if (!job) {
      return reply.code(404).send({ error: "一键生成任务不存在。" });
    }
    return { job };
  });

  app.post("/api/module01/one-click-character-jobs", async (request, reply) => {
    const input = request.body as OneClickCharacterJobInput;
    const validation = await validateStartInput(input, config, request.headers["x-openrouter-api-key"]);
    if ("error" in validation) {
      return reply.code(validation.statusCode).send(validation.body);
    }

    const steps = buildSteps(validation.actions);
    const job: OneClickCharacterJob = {
      jobId: `one-click-${randomUUID()}`,
      characterId: validation.characterId,
      status: "running",
      currentStep: steps[0]?.id ?? "completed",
      progressPercent: 0,
      steps,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    jobs.set(job.jobId, job);

    const context = createJobContext(job);
    void Promise.resolve()
      .then(async () => {
        const runner = config.oneClickCharacterJobRunner
          ?? ((currentJob, currentContext) => runDefaultOneClickJob(app, config, validation, currentJob, currentContext));
        await runner(job, context);
        if (job.status === "running") {
          for (const step of job.steps) {
            if (step.status === "pending" || step.status === "running") {
              context.updateStep(step.id, "completed");
            }
          }
          job.status = "completed";
          job.currentStep = "completed";
          job.progressPercent = 100;
          touchJob(job);
        }
      })
      .catch((error: unknown) => {
        job.status = "failed";
        job.error = getErrorMessage(error);
        const running = job.steps.find((step) => step.status === "running")
          ?? job.steps.find((step) => step.status === "pending");
        if (running) {
          context.updateStep(running.id, "failed", { error: job.error });
          job.currentStep = running.id;
        }
        touchJob(job);
      });

    return reply.code(202).send({ job });
  });
}

async function validateStartInput(
  input: OneClickCharacterJobInput,
  config: OneClickCharacterRouteConfig,
  apiKeyHeader: string | string[] | undefined
): Promise<{
  characterId: string;
  apiKey: string;
  publicAssetBaseUrl: string;
  referenceImageDataUrl: string;
  firstFrame: Required<NonNullable<OneClickCharacterJobInput["firstFrame"]>>;
  actions: { run: boolean; attack1: boolean; jump: boolean };
  workflowConfig: Record<string, unknown>;
} | { statusCode: number; body: Record<string, unknown>; error: true }> {
  let characterId: string;
  try {
    characterId = normalizeCharacterId(input.characterName ?? "");
  } catch (error: unknown) {
    return { error: true, statusCode: 400, body: { error: getErrorMessage(error) } };
  }

  const characterPath = resolveCharacterPath(config.storageDir, characterId);
  if (existsSync(characterPath) && !input.overwrite) {
    return {
      error: true,
      statusCode: 409,
      body: {
        code: "CHARACTER_EXISTS",
        characterId,
        error: "角色文件夹已存在，请确认覆盖后再启动一键生成。"
      }
    };
  }

  if (!input.referenceImageDataUrl?.trim()) {
    return { error: true, statusCode: 400, body: { error: "请先上传角色参考图。" } };
  }
  if (!input.firstFrame?.model?.trim() || !input.firstFrame.prompt?.trim()) {
    return { error: true, statusCode: 400, body: { error: "请填写角色基准模板模型和提示词。" } };
  }

  const workflowConfig = await readModule01WorkflowConfig(config.storageDir) ?? {};
  const actions = {
    run: Boolean(input.actions?.run),
    attack1: Boolean(input.actions?.attack1),
    jump: Boolean(input.actions?.jump)
  };
  if (actions.attack1 && !readString(workflowConfig, "advancedAttackMidframeCustomPrompt")) {
    return { error: true, statusCode: 400, body: { error: "攻击中间帧提示词为空，请先去攻击动作1页面保存配置。" } };
  }

  const apiKey = readHeaderApiKey(apiKeyHeader)
    ?? await readOpenRouterSecret(config.storageDir)
    ?? config.openRouterApiKey?.trim()
    ?? "";
  if (!apiKey) {
    return { error: true, statusCode: 400, body: { error: "OPENROUTER_API_KEY is not configured" } };
  }

  return {
    characterId,
    apiKey,
    publicAssetBaseUrl: input.publicAssetBaseUrl?.trim() || config.publicAssetBaseUrl?.trim() || "https://darn-skittle-unwoven.ngrok-free.dev",
    referenceImageDataUrl: input.referenceImageDataUrl,
    firstFrame: {
      model: input.firstFrame.model,
      prompt: input.firstFrame.prompt,
      targetSize: normalizeNumber(input.firstFrame.targetSize, 1024),
      keyColor: input.firstFrame.keyColor?.trim() || "#00ff00",
      style: input.firstFrame.style?.trim() || "cel-anime"
    },
    actions,
    workflowConfig
  };
}

function buildSteps(actions: { run: boolean; attack1: boolean; jump: boolean }): OneClickJobStep[] {
  const steps: OneClickJobStep[] = [
    { id: "create-character", label: "创建角色文件夹", status: "pending" },
    { id: "save-reference", label: "保存角色参考图", status: "pending" },
    { id: "base-template", label: "生成角色基准模板", status: "pending" },
    { id: "walk-4dir", label: "生成步行四方向图", status: "pending" },
    { id: "idle-4dir", label: "生成待机四方向图", status: "pending" },
    { id: "walk-video", label: "生成四方向步行视频", status: "pending" },
    { id: "walk-loop-export", label: "处理步行四方向循环", status: "pending" },
    { id: "idle-loop-export", label: "处理待机四方向", status: "pending" }
  ];
  if (actions.run) {
    steps.push(
      { id: "run-keyframe", label: "生成跑步四方向首帧", status: "pending" },
      { id: "run-video", label: "生成跑步四方向视频", status: "pending" },
      { id: "run-export", label: "处理跑步循环导出", status: "pending" }
    );
  }
  if (actions.attack1) {
    steps.push(
      { id: "attack-start", label: "准备攻击四方向1起始帧", status: "pending" },
      { id: "attack-midframe", label: "生成攻击四方向1中间帧", status: "pending" },
      { id: "attack-video", label: "生成攻击四方向1视频", status: "pending" },
      { id: "attack-export", label: "处理攻击四方向1导出", status: "pending" }
    );
  }
  if (actions.jump) {
    steps.push(
      { id: "jump-start", label: "准备跳跃起始帧", status: "pending" },
      { id: "jump-video", label: "生成跳跃四方向视频", status: "pending" },
      { id: "jump-export", label: "处理跳跃四方向导出", status: "pending" }
    );
  }
  return steps;
}

function createJobContext(job: OneClickCharacterJob): OneClickJobContext {
  return {
    getStepStatus(stepId) {
      return job.steps.find((item) => item.id === stepId)?.status;
    },
    updateStep(stepId, status, patch = {}) {
      const step = job.steps.find((item) => item.id === stepId);
      if (!step) {
        return;
      }
      Object.assign(step, patch, { status });
      if (status === "running") {
        job.currentStep = stepId;
      }
      if (status === "failed") {
        job.currentStep = stepId;
      }
      job.progressPercent = calculateProgress(job.steps);
      touchJob(job);
    }
  };
}

async function runDefaultOneClickJob(
  app: FastifyInstance,
  config: OneClickCharacterRouteConfig,
  input: Awaited<ReturnType<typeof validateStartInput>> & { error?: never },
  _job: OneClickCharacterJob,
  context: OneClickJobContext
): Promise<void> {
  await runRequiredStep(context, "create-character", async () => {
    const target = resolveCharacterPath(config.storageDir, input.characterId);
    if (existsSync(target)) {
      await deleteCharacterFolder(config.storageDir, input.characterId);
    }
    await createCharacterFolder(config.storageDir, input.characterId);
  });

  await runRequiredStep(context, "save-reference", async () => {
    const parsed = parseDataUrlImage(input.referenceImageDataUrl);
    await removeCharacterFilesByStem(config.storageDir, input.characterId, ["base-template"], "character-reference");
    const localPath = resolveCharacterPath(config.storageDir, input.characterId, "base-template", `character-reference.${parsed.extension}`);
    await mkdir(dirname(localPath), { recursive: true });
    await writeFile(localPath, parsed.buffer);
  });

  const headers = {
    "x-openrouter-api-key": input.apiKey,
    "x-public-asset-base-url": input.publicAssetBaseUrl,
    "x-character-id": encodeURIComponent(input.characterId)
  };
  const workflow = input.workflowConfig;
  const keyColor = input.firstFrame.keyColor;

  const baseTemplate = await runRequiredStep(context, "base-template", async () => injectJson(app, {
    method: "POST",
    url: "/api/generation/first-frame",
    headers,
    payload: {
      model: input.firstFrame.model,
      prompt: input.firstFrame.prompt,
      targetSize: input.firstFrame.targetSize,
      keyColor,
      referenceImageDataUrl: input.referenceImageDataUrl
    }
  }));
  context.updateStep("base-template", "completed", { resultUrl: readResultUrl(baseTemplate) });

  const directionImageModel = readString(workflow, "directionImageModel") || input.firstFrame.model;
  const directionSize = readNumber(workflow, "directionImageGenerationSize", input.firstFrame.targetSize);
  const walkPrompt = requireConfigString(workflow, "finalDirectionWalkPrompt", "四方向步行提示词");
  const idlePrompt = requireConfigString(workflow, "finalDirectionIdlePrompt", "四方向待机提示词");
  const videoModel = readString(workflow, "videoModel") || "bytedance/seedance-2.0";
  const videoDurationSeconds = readNumber(workflow, "videoDurationSeconds", 4);
  const videoResolution = readString(workflow, "videoResolution") || "720p";
  const videoPrompt = requireConfigString(workflow, "finalVideoPrompt", "步行视频提示词");

  const walk = await runRequiredStep(context, "walk-4dir", async () => injectJson(app, {
    method: "POST",
    url: "/api/generation/direction-template",
    headers,
    payload: {
      templateKind: "walk",
      model: directionImageModel,
      prompt: walkPrompt,
      targetSize: directionSize,
      keyColor,
      characterTemplateImageDataUrl: await readLocalImageAsDataUrl(baseTemplate)
    }
  }));
  context.updateStep("walk-4dir", "completed", { resultUrl: readResultUrl(walk) });

  const idle = await runRequiredStep(context, "idle-4dir", async () => injectJson(app, {
    method: "POST",
    url: "/api/generation/direction-template",
    headers,
    payload: {
      templateKind: "idle",
      model: directionImageModel,
      prompt: idlePrompt,
      targetSize: directionSize,
      keyColor,
      characterTemplateImageDataUrl: await readLocalImageAsDataUrl(walk)
    }
  }));
  context.updateStep("idle-4dir", "completed", { resultUrl: readResultUrl(idle) });

  const walkJobId = await runRequiredStep(context, "walk-video", async () => submitVideoAndPoll(app, {
    apiKey: input.apiKey,
    firstFrameUrl: requirePublicUrl(walk),
    prompt: videoPrompt,
    model: videoModel,
    durationSeconds: videoDurationSeconds,
    resolution: videoResolution,
    characterId: input.characterId
  }));
  await runRequiredStep(context, "walk-loop-export", async () => processBaseLoop(app, workflow, {
    jobId: walkJobId,
    characterId: input.characterId,
    keyColor
  }));
  await runRequiredStep(context, "idle-loop-export", async () => processIdleLoop(app, workflow, {
    characterId: input.characterId,
    keyColor
  }));

  if (input.actions.run) {
    await runOptionalAction(context, "run", async () => {
      const runPrompt = requireConfigString(workflow, "finalAdvancedRunPrompt", "跑步四方向提示词");
      const runVideoPrompt = requireConfigString(workflow, "finalAdvancedRunVideoPrompt", "跑步视频提示词");
      const runKeyframe = await runStep(context, "run-keyframe", async () => injectJson(app, {
        method: "POST",
        url: "/api/generation/direction-template",
        headers,
        payload: {
          templateKind: "run",
          model: directionImageModel,
          prompt: runPrompt,
          targetSize: directionSize,
          keyColor,
          characterTemplateImageDataUrl: await readLocalImageAsDataUrl(walk)
        }
      }));
      context.updateStep("run-keyframe", "completed", { resultUrl: readResultUrl(runKeyframe) });
      const runJobId = await runStep(context, "run-video", async () => submitVideoAndPoll(app, {
        apiKey: input.apiKey,
        firstFrameUrl: requirePublicUrl(runKeyframe),
        prompt: runVideoPrompt,
        model: videoModel,
        durationSeconds: videoDurationSeconds,
        resolution: videoResolution,
        characterId: input.characterId,
        actionKind: "run"
      }));
      await runStep(context, "run-export", async () => processAdvanced(app, workflow, {
        jobId: runJobId,
        characterId: input.characterId,
        actionKind: "run",
        mode: "loop",
        keyColor
      }));
    });
  }

  if (input.actions.attack1) {
    await runOptionalAction(context, "attack", async () => {
      const attackStart = await runStep(context, "attack-start", async () => prepareActionStart(app, workflow, {
        characterId: input.characterId,
        actionKind: "attack-1",
        keyColor
      }));
      const middle = await runStep(context, "attack-midframe", async () => injectJson(app, {
        method: "POST",
        url: "/api/generation/advanced-action-midframe",
        headers,
        payload: {
          actionKind: "attack-1",
          model: directionImageModel,
          prompt: requireConfigString(workflow, "advancedAttackMidframeCustomPrompt", "攻击中间帧提示词"),
          targetSize: directionSize,
          keyColor,
          startFrameImageDataUrl: await readLocalImageAsDataUrl(attackStart)
        }
      }));
      context.updateStep("attack-midframe", "completed", { resultUrl: readResultUrl(middle) });
      const attackJobId = await runStep(context, "attack-video", async () => submitVideoAndPoll(app, {
        apiKey: input.apiKey,
        firstFrameUrl: requirePublicUrl(attackStart, input.publicAssetBaseUrl),
        referenceOnly: true,
        inputReferenceUrls: [
          requirePublicUrl(attackStart, input.publicAssetBaseUrl),
          requirePublicUrl(middle)
        ],
        prompt: requireConfigString(workflow, "finalAdvancedAttackPrompt", "攻击视频提示词"),
        model: videoModel,
        durationSeconds: videoDurationSeconds,
        resolution: videoResolution,
        characterId: input.characterId,
        actionKind: "attack-1"
      }));
      await runStep(context, "attack-export", async () => processAdvanced(app, workflow, {
        jobId: attackJobId,
        characterId: input.characterId,
        actionKind: "attack-1",
        mode: "oneshot",
        keyColor
      }));
    });
  }

  if (input.actions.jump) {
    await runOptionalAction(context, "jump", async () => {
      const jumpStart = await runStep(context, "jump-start", async () => prepareActionStart(app, workflow, {
        characterId: input.characterId,
        actionKind: "jump",
        keyColor
      }));
      const jumpJobId = await runStep(context, "jump-video", async () => submitVideoAndPoll(app, {
        apiKey: input.apiKey,
        firstFrameUrl: requirePublicUrl(jumpStart, input.publicAssetBaseUrl),
        prompt: requireConfigString(workflow, "finalAdvancedJumpPrompt", "跳跃视频提示词"),
        model: videoModel,
        durationSeconds: videoDurationSeconds,
        resolution: videoResolution,
        characterId: input.characterId,
        actionKind: "jump"
      }));
      await runStep(context, "jump-export", async () => processAdvanced(app, workflow, {
        jobId: jumpJobId,
        characterId: input.characterId,
        actionKind: "jump",
        mode: "oneshot",
        keyColor
      }));
    });
  }
}

async function runRequiredStep<T>(
  context: OneClickJobContext,
  stepId: string,
  action: () => Promise<T>
): Promise<T> {
  return runStep(context, stepId, action);
}

async function runStep<T>(
  context: OneClickJobContext,
  stepId: string,
  action: () => Promise<T>
): Promise<T> {
  context.updateStep(stepId, "running");
  try {
    const result = await action();
    context.updateStep(stepId, "completed");
    return result;
  } catch (error: unknown) {
    context.updateStep(stepId, "failed", { error: getErrorMessage(error) });
    throw error;
  }
}

async function runOptionalAction(
  context: OneClickJobContext,
  actionPrefix: "run" | "attack" | "jump",
  action: () => Promise<void>
): Promise<void> {
  try {
    await action();
  } catch {
    for (const stepId of getOptionalStepIds(actionPrefix)) {
      const status = context.getStepStatus(stepId);
      if (status === "completed" || status === "skipped") {
        continue;
      }
      context.updateStep(stepId, "failed");
    }
  }
}

function getOptionalStepIds(prefix: "run" | "attack" | "jump"): string[] {
  if (prefix === "run") {
    return ["run-keyframe", "run-video", "run-export"];
  }
  if (prefix === "attack") {
    return ["attack-start", "attack-midframe", "attack-video", "attack-export"];
  }
  return ["jump-start", "jump-video", "jump-export"];
}

async function submitVideoAndPoll(
  app: FastifyInstance,
  input: {
    apiKey: string;
    firstFrameUrl: string;
    lastFrameUrl?: string;
    referenceOnly?: boolean;
    inputReferenceUrls?: string[];
    prompt: string;
    model: string;
    durationSeconds: number;
    resolution: string;
    characterId: string;
    actionKind?: AdvancedActionKind;
  }
): Promise<string> {
  const submit = await injectJson(app, {
    method: "POST",
    url: "/api/generation/video",
    headers: { "x-openrouter-api-key": input.apiKey },
    payload: {
      model: input.model,
      prompt: input.prompt,
      firstFrameUrl: input.firstFrameUrl,
      lastFrameUrl: input.lastFrameUrl,
      referenceOnly: input.referenceOnly,
      inputReferenceUrls: input.inputReferenceUrls,
      durationSeconds: input.durationSeconds,
      resolution: input.resolution
    }
  });
  const jobId = findStringValue(submit, ["id", "jobId", "job_id"]);
  if (!jobId) {
    throw new Error("视频任务没有返回 jobId。");
  }
  const query = new URLSearchParams({ characterId: input.characterId });
  if (input.actionKind) {
    query.set("actionKind", input.actionKind);
  }
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const status = await injectJson(app, {
      method: "GET",
      url: `/api/generation/video/${encodeURIComponent(jobId)}?${query.toString()}`,
      headers: { "x-openrouter-api-key": input.apiKey }
    });
    const normalized = findStringValue(status, ["status"])?.toLowerCase() ?? "pending";
    if (normalized === "completed" && findStringValue(status, ["localVideoUrl"])) {
      return jobId;
    }
    if (normalized === "failed") {
      throw new Error(`视频任务失败：${JSON.stringify(status)}`);
    }
    await sleep(3000);
  }
  throw new Error("视频任务轮询超时。");
}

async function processBaseLoop(
  app: FastifyInstance,
  workflow: Record<string, unknown>,
  input: { jobId: string; characterId: string; keyColor: string }
) {
  return injectJson(app, {
    method: "POST",
    url: "/api/processing/four-direction",
    payload: buildProcessingPayload(workflow, input)
  });
}

async function processIdleLoop(
  app: FastifyInstance,
  workflow: Record<string, unknown>,
  input: { characterId: string; keyColor: string }
) {
  return injectJson(app, {
    method: "POST",
    url: "/api/processing/idle-four-direction",
    payload: {
      characterId: input.characterId,
      keyColor: input.keyColor,
      tolerance: readNumber(workflow, "tolerance", 255)
    }
  });
}

async function prepareActionStart(
  app: FastifyInstance,
  workflow: Record<string, unknown>,
  input: { characterId: string; actionKind: "attack-1" | "jump"; keyColor: string }
) {
  return injectJson(app, {
    method: "POST",
    url: "/api/processing/advanced-action/start-frame",
    payload: {
      characterId: input.characterId,
      actionKind: input.actionKind,
      keyColor: input.keyColor,
      tolerance: readNumber(workflow, "tolerance", 255),
      scale: input.actionKind === "attack-1"
        ? readNumber(workflow, "advancedAttackStartScale", 0.74)
        : readNumber(workflow, "advancedJumpStartScale", 0.78)
    }
  });
}

async function processAdvanced(
  app: FastifyInstance,
  workflow: Record<string, unknown>,
  input: { jobId: string; characterId: string; actionKind: AdvancedActionKind; mode: "loop" | "oneshot"; keyColor: string }
) {
  return injectJson(app, {
    method: "POST",
    url: "/api/processing/advanced-action",
    payload: {
      ...buildProcessingPayload(workflow, input),
      actionKind: input.actionKind,
      mode: input.mode
    }
  });
}

function buildProcessingPayload(
  workflow: Record<string, unknown>,
  input: { jobId: string; characterId: string; keyColor: string }
) {
  return {
    jobId: input.jobId,
    characterId: input.characterId,
    frameCount: readNumber(workflow, "frameCount", 120),
    keyColor: input.keyColor,
    tolerance: readNumber(workflow, "tolerance", 255),
    minLoopFrames: readNumber(workflow, "minLoopFrames", 12),
    maxLoopFrames: readNumber(workflow, "maxLoopFrames", 60),
    exportFrameSize: readNumber(workflow, "exportFrameSize", 1024),
    fps: readNumber(workflow, "fps", 30)
  };
}

async function injectJson(
  app: FastifyInstance,
  input: { method: "GET" | "POST"; url: string; headers?: Record<string, string>; payload?: unknown }
): Promise<Record<string, unknown>> {
  const response = await app.inject(input as InjectOptions);
  const body = response.json() as Record<string, unknown>;
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(typeof body.error === "string" ? body.error : `请求失败：${response.statusCode}`);
  }
  return body;
}

async function readLocalImageAsDataUrl(response: Record<string, unknown>): Promise<string> {
  const localPath = findStringValue(response, ["localPath"]);
  if (!localPath) {
    throw new Error("缺少本地图像路径。");
  }
  const extension = String(localPath).toLowerCase().endsWith(".webp")
    ? "webp"
    : String(localPath).toLowerCase().endsWith(".jpg") || String(localPath).toLowerCase().endsWith(".jpeg")
      ? "jpeg"
      : "png";
  return `data:image/${extension};base64,${(await readFile(localPath)).toString("base64")}`;
}

function requirePublicUrl(response: Record<string, unknown>, publicBase?: string): string {
  const publicUrl = findStringValue(response, ["publicUrl"]);
  if (publicUrl) {
    return publicUrl;
  }
  const localUrl = findStringValue(response, ["localUrl", "imageUrl"]);
  if (localUrl && publicBase) {
    return `${publicBase.replace(/\/$/, "")}${localUrl.startsWith("/") ? "" : "/"}${localUrl}`;
  }
  throw new Error("缺少公网图片 URL。");
}

function readResultUrl(response: Record<string, unknown>): string | undefined {
  return findStringValue(response, ["localUrl", "imageUrl", "publicUrl"]);
}

function calculateProgress(steps: OneClickJobStep[]): number {
  if (steps.length === 0) {
    return 100;
  }
  const finished = steps.filter((step) => step.status === "completed" || step.status === "failed" || step.status === "skipped").length;
  return Math.min(100, Math.max(0, Math.round((finished / steps.length) * 100)));
}

function touchJob(job: OneClickCharacterJob): void {
  job.updatedAt = new Date().toISOString();
}

async function readOpenRouterSecret(storageDir: string): Promise<string | undefined> {
  const path = resolveSecretsPath(storageDir);
  if (!existsSync(path)) {
    return undefined;
  }
  const parsed = JSON.parse(await readFile(path, "utf8")) as { openRouterApiKey?: unknown };
  return typeof parsed.openRouterApiKey === "string" && parsed.openRouterApiKey.trim()
    ? parsed.openRouterApiKey.trim()
    : undefined;
}

async function writeOpenRouterSecret(storageDir: string, apiKey: string): Promise<void> {
  const path = resolveSecretsPath(storageDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ openRouterApiKey: apiKey }, null, 2)}\n`, "utf8");
}

function resolveSecretsPath(storageDir: string): string {
  return join(storageDir, "config", "module01-secrets.json");
}

function getSecretSuffix(apiKey: string): string {
  return apiKey.slice(-4);
}

function readHeaderApiKey(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || undefined;
}

function parseDataUrlImage(dataUrl: string): { buffer: Buffer; extension: "png" | "jpg" | "webp" } {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error("角色参考图 data URL 无法解析。");
  }
  return {
    buffer: Buffer.from(match[2] ?? "", "base64"),
    extension: extensionFromContentType(match[1] ?? "image/png")
  };
}

function extensionFromContentType(contentType: string): "png" | "jpg" | "webp" {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) {
    return "jpg";
  }
  if (contentType.includes("webp")) {
    return "webp";
  }
  return "png";
}

function readString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === "string" ? value.trim() : "";
}

function requireConfigString(config: Record<string, unknown>, key: string, label: string): string {
  const value = readString(config, key);
  if (!value) {
    throw new Error(`${label}为空，请先保存模块01配置。`);
  }
  return value;
}

function readNumber(config: Record<string, unknown>, key: string, fallback: number): number {
  return normalizeNumber(config[key], fallback);
}

function normalizeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function findStringValue(value: unknown, keys: readonly string[]): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const item = record[key];
    if (typeof item === "string" && item.trim()) {
      return item.trim();
    }
  }
  return undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
