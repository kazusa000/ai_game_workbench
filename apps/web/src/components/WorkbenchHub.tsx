import { Boxes, Film, ImagePlus, Layers, Lock, Sparkles } from "lucide-react";

interface WorkbenchHubProps {
  onOpenSpriteAnimator: () => void;
}

const plannedModules = [
  { title: "角色生成器", icon: ImagePlus },
  { title: "精灵图编辑器", icon: Layers },
  { title: "地图块生成器", icon: Boxes },
  { title: "头像生成器", icon: Sparkles }
];

export function WorkbenchHub({ onOpenSpriteAnimator }: WorkbenchHubProps) {
  return (
    <main className="app-shell hub-shell">
      <section className="hub-hero">
        <div>
          <p className="eyebrow">开源游戏创作工具箱</p>
          <h1>AI 游戏工作台</h1>
          <p className="hub-copy">
            用紧凑的 AI 工作流、本地后处理和面向引擎的导出方式，制作可直接进入游戏管线的素材。
          </p>
        </div>
      </section>

      <section className="module-grid" aria-label="工作台模块">
        <button className="module-card module-card-active" type="button" onClick={onOpenSpriteAnimator}>
          <span className="module-icon"><Film size={28} /></span>
          <span className="module-title">AI 精灵动画生成</span>
          <span className="module-desc">从像素角色首帧生成精灵动画素材。</span>
        </button>

        {plannedModules.map((module) => {
          const Icon = module.icon;
          return (
            <button className="module-card module-card-disabled" type="button" disabled key={module.title}>
              <span className="module-icon"><Icon size={28} /></span>
              <span className="module-title">{module.title}</span>
              <span className="module-desc"><Lock size={14} /> 规划中</span>
            </button>
          );
        })}
      </section>
    </main>
  );
}
