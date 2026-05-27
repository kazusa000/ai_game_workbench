import { Boxes, Film, ImagePlus, Layers, Lock, Sparkles } from "lucide-react";

interface WorkbenchHubProps {
  onOpenSpriteAnimator: () => void;
}

const plannedModules = [
  { title: "Character Generator", icon: ImagePlus },
  { title: "Sprite Sheet Editor", icon: Layers },
  { title: "Tileset Generator", icon: Boxes },
  { title: "Portrait Generator", icon: Sparkles }
];

export function WorkbenchHub({ onOpenSpriteAnimator }: WorkbenchHubProps) {
  return (
    <main className="app-shell hub-shell">
      <section className="hub-hero">
        <div>
          <p className="eyebrow">Open Source Game Creation Toolkit</p>
          <h1>AI Game Workbench</h1>
          <p className="hub-copy">
            Build game-ready assets through compact AI workflows, local post-processing,
            and engine-friendly exports.
          </p>
        </div>
      </section>

      <section className="module-grid" aria-label="Workbench modules">
        <button className="module-card module-card-active" type="button" onClick={onOpenSpriteAnimator}>
          <span className="module-icon"><Film size={28} /></span>
          <span className="module-title">AI Sprite Animator</span>
          <span className="module-desc">First-frame pixel character to sprite animation.</span>
        </button>

        {plannedModules.map((module) => {
          const Icon = module.icon;
          return (
            <button className="module-card module-card-disabled" type="button" disabled key={module.title}>
              <span className="module-icon"><Icon size={28} /></span>
              <span className="module-title">{module.title}</span>
              <span className="module-desc"><Lock size={14} /> Planned module</span>
            </button>
          );
        })}
      </section>
    </main>
  );
}
