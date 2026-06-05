import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface PublicTunnelConfig {
  provider: string;
  url: string;
  publicAssetBaseUrl: string;
  updatedAt?: string;
}

export function resolvePublicTunnelConfigPath(storageDir: string): string {
  return join(storageDir, "config", "public-tunnel.json");
}

export function readPublicTunnelConfig(storageDir: string): PublicTunnelConfig | null {
  try {
    const raw = readFileSync(resolvePublicTunnelConfigPath(storageDir), "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw) as Partial<PublicTunnelConfig>;
    const provider = parsed.provider?.trim();
    const url = parsed.url?.trim();
    const publicAssetBaseUrl = parsed.publicAssetBaseUrl?.trim();
    if (!provider || !url || !publicAssetBaseUrl) {
      return null;
    }
    return {
      provider,
      url,
      publicAssetBaseUrl,
      updatedAt: parsed.updatedAt
    };
  } catch {
    return null;
  }
}

export function resolveRuntimePublicAssetBaseUrl(config: { storageDir: string; publicAssetBaseUrl?: string }): string | undefined {
  return config.publicAssetBaseUrl?.trim() || readPublicTunnelConfig(config.storageDir)?.publicAssetBaseUrl;
}
