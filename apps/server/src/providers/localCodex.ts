import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import sharp from "sharp";

export const LOCAL_CODEX_IMAGE_MODEL = "local/gpt-image-2";

export interface LocalCodexImageGenerationInput {
  model: string;
  prompt: string;
  targetSize: number;
  keyColor: string;
  imagePaths: readonly string[];
  workingDirectory: string;
}

export interface LocalCodexImageGenerationResult {
  buffer: Buffer;
  extension: "png";
  providerResponse: Record<string, unknown>;
}

export type LocalCodexImageGenerator = (
  input: LocalCodexImageGenerationInput
) => Promise<LocalCodexImageGenerationResult>;

interface CodexCommand {
  command: string;
  argsPrefix: string[];
  label: string;
}

interface GeneratedImageSnapshot {
  path: string;
  mtimeMs: number;
}

export function isLocalCodexImageModel(model: string): boolean {
  return model === LOCAL_CODEX_IMAGE_MODEL;
}

export async function generateLocalCodexImage(
  input: LocalCodexImageGenerationInput
): Promise<LocalCodexImageGenerationResult> {
  const command = resolveCodexCommand();
  const generatedImagesBefore = snapshotGeneratedImages();
  const runDir = await mkdtemp(join(tmpdir(), "ai-game-workbench-local-codex-"));
  const messagePath = join(runDir, "last-message.txt");
  try {
    const args = [
      ...command.argsPrefix,
      "exec",
      "--json",
      "--sandbox",
      "danger-full-access",
      "--skip-git-repo-check",
      "-C",
      input.workingDirectory,
      ...input.imagePaths.flatMap((imagePath) => ["--image", imagePath]),
      "-o",
      messagePath,
      input.prompt
    ];
    const result = await runCommand(command.command, args, input.workingDirectory);
    const lastMessage = existsSync(messagePath) ? await readFile(messagePath, "utf8") : "";
    if (result.exitCode !== 0) {
      throw new Error([
        `Local Codex image generation failed with exit code ${result.exitCode}.`,
        result.stderr.trim(),
        lastMessage.trim()
      ].filter(Boolean).join("\n"));
    }
    const newImage = findNewestGeneratedImage(generatedImagesBefore);
    if (!newImage) {
      throw new Error([
        "Local Codex did not create an image file.",
        lastMessage.trim(),
        result.stderr.trim()
      ].filter(Boolean).join("\n"));
    }
    const sourceBuffer = await readFile(newImage.path);
    const buffer = await resizeImageToTarget(sourceBuffer, input.targetSize, input.keyColor);
    return {
      buffer,
      extension: "png",
      providerResponse: {
        provider: "local-codex",
        model: input.model,
        codexCommand: command.label,
        generatedImagePath: newImage.path,
        message: lastMessage.trim() || undefined
      }
    };
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
}

async function resizeImageToTarget(buffer: Buffer, targetSize: number, keyColor: string): Promise<Buffer> {
  const size = Number.isFinite(targetSize) && targetSize > 0 ? Math.round(targetSize) : 1024;
  return sharp(buffer)
    .resize(size, size, {
      fit: "contain",
      background: keyColor || "#00ff00"
    })
    .png()
    .toBuffer();
}

export function resolveCodexCommand(): CodexCommand {
  const configured = process.env.LOCAL_CODEX_BIN?.trim();
  if (configured) {
    if (configured.endsWith(".js")) {
      return {
        command: process.execPath,
        argsPrefix: [configured],
        label: configured
      };
    }
    return {
      command: configured,
      argsPrefix: [],
      label: configured
    };
  }

  const desktopCodexExe = findDesktopCodexExe();
  if (desktopCodexExe) {
    return {
      command: desktopCodexExe,
      argsPrefix: [],
      label: desktopCodexExe
    };
  }

  const cachedCodexJs = findCachedCodexJs();
  if (cachedCodexJs) {
    return {
      command: process.execPath,
      argsPrefix: [cachedCodexJs],
      label: cachedCodexJs
    };
  }

  return {
    command: "codex",
    argsPrefix: [],
    label: "codex"
  };
}

function findDesktopCodexExe(): string | undefined {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    return undefined;
  }
  const binRoot = join(localAppData, "OpenAI", "Codex", "bin");
  if (!existsSync(binRoot)) {
    return undefined;
  }
  const candidates: GeneratedImageSnapshot[] = [];
  const directExe = join(binRoot, "codex.exe");
  if (existsSync(directExe)) {
    candidates.push({ path: directExe, mtimeMs: statSync(directExe).mtimeMs });
  }
  for (const child of readdirSync(binRoot, { withFileTypes: true })) {
    if (!child.isDirectory()) {
      continue;
    }
    const candidate = join(binRoot, child.name, "codex.exe");
    if (existsSync(candidate)) {
      candidates.push({ path: candidate, mtimeMs: statSync(candidate).mtimeMs });
    }
  }
  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.path;
}

function findCachedCodexJs(): string | undefined {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    return undefined;
  }
  const npxRoot = join(localAppData, "npm-cache", "_npx");
  if (!existsSync(npxRoot)) {
    return undefined;
  }
  const candidates: GeneratedImageSnapshot[] = [];
  for (const child of readdirSync(npxRoot, { withFileTypes: true })) {
    if (!child.isDirectory()) {
      continue;
    }
    const candidate = join(npxRoot, child.name, "node_modules", "@openai", "codex", "bin", "codex.js");
    if (existsSync(candidate)) {
      candidates.push({ path: candidate, mtimeMs: statSync(candidate).mtimeMs });
    }
  }
  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.path;
}

function snapshotGeneratedImages(): Set<string> {
  return new Set(readGeneratedImages().map((image) => image.path));
}

function findNewestGeneratedImage(before: Set<string>): GeneratedImageSnapshot | undefined {
  return readGeneratedImages()
    .filter((image) => !before.has(image.path))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
}

function readGeneratedImages(): GeneratedImageSnapshot[] {
  const root = join(process.env.CODEX_HOME ?? join(process.env.USERPROFILE ?? "", ".codex"), "generated_images");
  if (!existsSync(root)) {
    return [];
  }
  const results: GeneratedImageSnapshot[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) {
      continue;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if ([".png", ".jpg", ".jpeg", ".webp"].includes(extname(entry.name).toLowerCase())) {
        results.push({
          path: fullPath,
          mtimeMs: statSync(fullPath).mtimeMs
        });
      }
    }
  }
  return results;
}

function runCommand(command: string, args: readonly string[], cwd: string): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    const timeoutMs = Number(process.env.LOCAL_CODEX_TIMEOUT_MS ?? 10 * 60 * 1000);
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Local Codex image generation timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ exitCode, stdout, stderr });
    });
  });
}
