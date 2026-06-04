import { Save, Upload } from "lucide-react";
import { useState, type ReactNode } from "react";
import { MODULE01_SETTINGS_GROUPS, type Module01SettingsGroup } from "./module01Model";

export interface Module01SettingsReference {
  group: Module01SettingsGroup;
  label: string;
  alt: string;
  previewUrl: string;
  onUpload: (file: File) => void | Promise<void>;
}

export interface Module01SettingsPanel {
  group: Module01SettingsGroup;
  content: ReactNode;
  onSave: () => void;
  status?: string;
}

export function Module01Settings({
  status,
  references,
  panels
}: {
  status: string;
  references: readonly Module01SettingsReference[];
  panels: readonly Module01SettingsPanel[];
}) {
  const [activeGroup, setActiveGroup] = useState<Module01SettingsGroup>("base-template");
  const group = MODULE01_SETTINGS_GROUPS.find((item) => item.id === activeGroup) ?? MODULE01_SETTINGS_GROUPS[0];
  const activeReferences = references.filter((reference) => reference.group === activeGroup);
  const activePanel = panels.find((panel) => panel.group === activeGroup);
  const visibleStatuses = [activePanel?.status, status].filter((item): item is string => Boolean(item));
  const activeStatus = [...new Set(visibleStatuses)].join(" / ");

  return (
    <section className="workflow-stage module01-settings-center">
      <div className="stage-heading">
        <h2>模块设置</h2>
        <span>{activeStatus}</span>
      </div>
      <div className="module01-settings-layout">
        <nav className="module01-settings-nav" aria-label="模块设置分类">
          {MODULE01_SETTINGS_GROUPS.map((item) => (
            <button
              className={["nav-item", activeGroup === item.id ? "nav-item-active" : ""].filter(Boolean).join(" ")}
              key={item.id}
              type="button"
              onClick={() => setActiveGroup(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="module01-settings-content">
          <h3>{group.label}</h3>
          {activeReferences.length ? (
            <div className="module01-settings-references">
              {activeReferences.map((reference) => (
                <section className="module01-settings-reference" key={reference.label}>
                  <img alt={reference.alt} src={reference.previewUrl} />
                  <label className="file-picker">
                    <Upload size={16} /> 上传并覆盖{reference.label}
                    <input
                      aria-label={`上传并覆盖${reference.label}`}
                      className="visually-hidden"
                      type="file"
                      accept="image/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          void reference.onUpload(file);
                        }
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                </section>
              ))}
            </div>
          ) : null}
          {activePanel?.content}
          {activePanel ? (
            <button className="tool-button" type="button" onClick={() => void activePanel.onSave()}>
              <Save size={16} /> {group.saveLabel}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
