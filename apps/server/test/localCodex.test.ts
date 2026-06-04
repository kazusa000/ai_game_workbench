import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCodexCommand } from "../src/providers/localCodex";

const originalLocalAppData = process.env.LOCALAPPDATA;
const originalLocalCodexBin = process.env.LOCAL_CODEX_BIN;
const tempDirs: string[] = [];

afterEach(() => {
  process.env.LOCALAPPDATA = originalLocalAppData;
  if (originalLocalCodexBin === undefined) {
    delete process.env.LOCAL_CODEX_BIN;
  } else {
    process.env.LOCAL_CODEX_BIN = originalLocalCodexBin;
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("local Codex image provider", () => {
  it("resolves the Codex Desktop executable before falling back to PATH", () => {
    const localAppData = mkdtempSync(join(tmpdir(), "ai-game-workbench-codex-bin-"));
    tempDirs.push(localAppData);
    delete process.env.LOCAL_CODEX_BIN;
    process.env.LOCALAPPDATA = localAppData;
    const codexBinDir = join(localAppData, "OpenAI", "Codex", "bin", "desktop-build");
    mkdirSync(codexBinDir, { recursive: true });
    const codexExe = join(codexBinDir, "codex.exe");
    writeFileSync(codexExe, "");

    expect(resolveCodexCommand()).toEqual({
      command: codexExe,
      argsPrefix: [],
      label: codexExe
    });
  });
});
