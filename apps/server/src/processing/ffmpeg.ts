import { spawn } from "node:child_process";

export interface ExtractFramesInput {
  inputPath: string;
  outputPattern: string;
  fps: number;
}

export function buildExtractFramesArgs(input: ExtractFramesInput): string[] {
  return ["-y", "-i", input.inputPath, "-vf", `fps=${input.fps}`, input.outputPattern];
}

export async function extractFramesWithFfmpeg(
  ffmpegPath: string,
  input: ExtractFramesInput
): Promise<void> {
  await runFfmpeg(ffmpegPath, buildExtractFramesArgs(input));
}

export async function runFfmpeg(ffmpegPath: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, [...args], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg exited with ${code}: ${stderr}`));
    });
  });
}
