import { ArrowLeft, Plus, Save, Settings, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  getAdminProviderSettings,
  saveAdminProviderSettings,
  type AdminProviderSettingsResponse,
  type ProviderSecretPatch,
  type ProviderSettingsDocument
} from "../api/client";
import type { GenerationCapability, ProviderModelPreset, ProviderSettings } from "@ai-game-workbench/core";

interface ApiSettingsProps {
  onBack: () => void;
}

const ADMIN_TOKEN_STORAGE_KEY = "ai-game-workbench.admin-settings-token";
const COMPATIBLE_PROVIDER_ID = "openrouter-compatible";

export function ApiSettings({ onBack }: ApiSettingsProps) {
  const [adminToken, setAdminToken] = useState(() => sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) ?? "");
  const [settings, setSettings] = useState<ProviderSettingsDocument | null>(null);
  const [secrets, setSecrets] = useState<AdminProviderSettingsResponse["secrets"]>({});
  const [secretPatches, setSecretPatches] = useState<Record<string, ProviderSecretPatch>>({});
  const [status, setStatus] = useState("Enter the admin token to load provider settings.");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const imageModels = useMemo(
    () => settings?.models.filter((model) => model.enabled && model.capability === "image") ?? [],
    [settings]
  );
  const videoModels = useMemo(
    () => settings?.models.filter((model) => model.enabled && model.capability === "video") ?? [],
    [settings]
  );

  const loadSettings = async () => {
    const token = adminToken.trim();
    if (!token) {
      setStatus("Admin token is required.");
      return;
    }
    setIsLoading(true);
    setStatus("Loading provider settings...");
    try {
      sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
      const result = await getAdminProviderSettings(token);
      applyResponse(result);
      setStatus("Provider settings loaded.");
    } catch (error: unknown) {
      setStatus(`Load failed: ${getErrorMessage(error)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const saveSettings = async () => {
    if (!settings) {
      setStatus("Load settings before saving.");
      return;
    }
    const token = adminToken.trim();
    if (!token) {
      setStatus("Admin token is required.");
      return;
    }
    setIsSaving(true);
    setStatus("Saving provider settings...");
    try {
      sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
      const result = await saveAdminProviderSettings(token, {
        ...settings,
        secrets: secretPatches
      });
      applyResponse(result);
      setStatus("Provider settings saved.");
    } catch (error: unknown) {
      setStatus(`Save failed: ${getErrorMessage(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const applyResponse = (response: AdminProviderSettingsResponse) => {
    setSettings(response.settings);
    setSecrets(response.secrets);
    setSecretPatches({});
  };

  const updateProvider = (providerId: string, patch: Partial<ProviderSettings>) => {
    setSettings((current) => current ? {
      ...current,
      providers: current.providers.map((provider) => provider.id === providerId ? { ...provider, ...patch } : provider)
    } : current);
  };

  const updateModel = (modelId: string, patch: Partial<ProviderModelPreset>) => {
    setSettings((current) => current ? {
      ...current,
      models: current.models.map((model) => model.id === modelId ? { ...model, ...patch } : model)
    } : current);
  };

  const addCompatibleImageModel = () => {
    setSettings((current) => {
      if (!current) {
        return current;
      }
      const modelId = `compatible/${Date.now().toString(36)}`;
      return {
        ...current,
        models: [
          ...current.models,
          {
            id: modelId,
            providerId: COMPATIBLE_PROVIDER_ID,
            upstreamModel: "provider/image-model",
            label: "Compatible image model",
            capability: "image",
            enabled: true,
            imageSizeOptions: [
              { size: 1024, label: "1024 x 1024" }
            ],
            defaultImageSize: 1024
          }
        ]
      };
    });
  };

  const removeModel = (modelId: string) => {
    setSettings((current) => current ? {
      ...current,
      models: current.models.filter((model) => model.id !== modelId),
      defaults: {
        imageModelId: current.defaults.imageModelId === modelId ? imageModels[0]?.id ?? current.defaults.imageModelId : current.defaults.imageModelId,
        videoModelId: current.defaults.videoModelId === modelId ? videoModels[0]?.id ?? current.defaults.videoModelId : current.defaults.videoModelId
      }
    } : current);
  };

  const updateSecretPatch = (providerId: string, patch: ProviderSecretPatch) => {
    setSecretPatches((current) => ({
      ...current,
      [providerId]: patch
    }));
  };

  return (
    <main className="app-shell settings-shell">
      <header className="settings-header">
        <button className="icon-button" type="button" onClick={onBack} aria-label="Back to workbench">
          <ArrowLeft size={18} />
        </button>
        <div>
          <p className="eyebrow">Admin / API</p>
          <h1>API Settings</h1>
        </div>
      </header>

      <section className="settings-band">
        <div className="settings-token-row">
          <label className="field">
            Admin token
            <input
              aria-label="Admin settings token"
              autoComplete="off"
              type="password"
              value={adminToken}
              onChange={(event) => setAdminToken(event.target.value)}
            />
          </label>
          <button className="tool-button primary" type="button" disabled={isLoading} onClick={() => void loadSettings()}>
            <Settings size={16} /> {isLoading ? "Loading" : "Load"}
          </button>
          <button className="tool-button" type="button" disabled={!settings || isSaving} onClick={() => void saveSettings()}>
            <Save size={16} /> {isSaving ? "Saving" : "Save"}
          </button>
        </div>
        <p className="settings-status">{status}</p>
      </section>

      {settings ? (
        <section className="settings-layout">
          <section className="settings-section">
            <h2>Providers</h2>
            <div className="settings-table">
              {settings.providers.map((provider) => (
                <div className="settings-row" key={provider.id}>
                  <label className="settings-check">
                    <input
                      type="checkbox"
                      checked={provider.enabled}
                      onChange={(event) => updateProvider(provider.id, { enabled: event.target.checked })}
                    />
                    Enabled
                  </label>
                  <label className="field">
                    Label
                    <input value={provider.label} onChange={(event) => updateProvider(provider.id, { label: event.target.value })} />
                  </label>
                  <label className="field">
                    Base URL
                    <input
                      value={provider.baseUrl ?? ""}
                      disabled={provider.kind === "local-codex"}
                      onChange={(event) => updateProvider(provider.id, { baseUrl: event.target.value })}
                    />
                  </label>
                  <label className="field">
                    API key
                    <input
                      aria-label={`${provider.label} API key`}
                      autoComplete="off"
                      placeholder={secrets[provider.id]?.configured ? `Configured ...${secrets[provider.id]?.suffix ?? ""}` : "Paste new key"}
                      type="password"
                      disabled={provider.kind === "local-codex"}
                      value={secretPatches[provider.id]?.apiKey ?? ""}
                      onChange={(event) => updateSecretPatch(provider.id, { apiKey: event.target.value })}
                    />
                  </label>
                  <button
                    className="tool-button"
                    type="button"
                    disabled={provider.kind === "local-codex"}
                    onClick={() => updateSecretPatch(provider.id, { clear: true })}
                  >
                    Clear key
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-heading">
              <h2>Models</h2>
              <button className="tool-button" type="button" onClick={addCompatibleImageModel}>
                <Plus size={16} /> Add compatible image model
              </button>
            </div>
            <div className="settings-defaults">
              <label className="field">
                Default image model
                <select
                  value={settings.defaults.imageModelId}
                  onChange={(event) => setSettings({
                    ...settings,
                    defaults: { ...settings.defaults, imageModelId: event.target.value }
                  })}
                >
                  {imageModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                </select>
              </label>
              <label className="field">
                Default video model
                <select
                  value={settings.defaults.videoModelId}
                  onChange={(event) => setSettings({
                    ...settings,
                    defaults: { ...settings.defaults, videoModelId: event.target.value }
                  })}
                >
                  {videoModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                </select>
              </label>
            </div>
            <div className="settings-table">
              {settings.models.map((model) => (
                <div className="settings-row settings-row-model" key={model.id}>
                  <label className="settings-check">
                    <input
                      type="checkbox"
                      checked={model.enabled}
                      onChange={(event) => updateModel(model.id, { enabled: event.target.checked })}
                    />
                    Enabled
                  </label>
                  <label className="field">
                    Model id
                    <input value={model.id} disabled />
                  </label>
                  <label className="field">
                    Label
                    <input value={model.label} onChange={(event) => updateModel(model.id, { label: event.target.value })} />
                  </label>
                  <label className="field">
                    Provider
                    <select value={model.providerId} onChange={(event) => updateModel(model.id, { providerId: event.target.value })}>
                      {settings.providers.map((provider) => (
                        <option key={provider.id} value={provider.id}>{provider.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Upstream model
                    <input value={model.upstreamModel} onChange={(event) => updateModel(model.id, { upstreamModel: event.target.value })} />
                  </label>
                  <label className="field">
                    Capability
                    <select
                      value={model.capability}
                      onChange={(event) => updateModel(model.id, { capability: event.target.value as GenerationCapability })}
                    >
                      <option value="image">Image</option>
                      <option value="video">Video</option>
                    </select>
                  </label>
                  {model.providerId === COMPATIBLE_PROVIDER_ID ? (
                    <button className="tool-button danger" type="button" onClick={() => removeModel(model.id)}>
                      <Trash2 size={16} /> Remove
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        </section>
      ) : null}
    </main>
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
