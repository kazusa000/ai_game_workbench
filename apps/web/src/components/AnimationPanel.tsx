interface AnimationPanelProps {
  actionTemplate: string;
  videoBasePrompt: string;
  templatePrompt: string;
  actionPrompt: string;
  finalVideoPrompt: string;
  keyColor: string;
  onActionTemplateChange: (value: string) => void;
  onVideoBasePromptChange: (value: string) => void;
  onTemplatePromptChange: (value: string) => void;
  onActionPromptChange: (value: string) => void;
  onFinalVideoPromptChange: (value: string) => void;
  onKeyColorChange: (value: string) => void;
}

const actionTemplates = ["idle", "walk", "run", "jump", "attack", "hit", "defeated", "custom"];
const actionTemplateLabels: Record<string, string> = {
  idle: "待机",
  walk: "行走",
  run: "奔跑",
  jump: "跳跃",
  attack: "攻击",
  hit: "受击",
  defeated: "倒地",
  custom: "自定义"
};

export function AnimationPanel(props: AnimationPanelProps) {
  return (
    <section className="panel">
      <div className="panel-title">动画</div>
      <label className="field">
        动作模板
        <select value={props.actionTemplate} onChange={(event) => props.onActionTemplateChange(event.target.value)}>
          {actionTemplates.map((template) => (
            <option value={template} key={template}>{actionTemplateLabels[template]}</option>
          ))}
        </select>
      </label>
      <label className="field">
        视频基础提示词
        <textarea
          value={props.videoBasePrompt}
          rows={3}
          onChange={(event) => props.onVideoBasePromptChange(event.target.value)}
        />
      </label>
      <label className="field">
        模板提示词
        <textarea
          value={props.templatePrompt}
          rows={2}
          onChange={(event) => props.onTemplatePromptChange(event.target.value)}
        />
      </label>
      <label className="field">
        动作提示词
        <textarea
          value={props.actionPrompt}
          rows={3}
          onChange={(event) => props.onActionPromptChange(event.target.value)}
        />
      </label>
      <label className="field">
        抠图背景色
        <input type="color" value={props.keyColor} onChange={(event) => props.onKeyColorChange(event.target.value)} />
      </label>
      <label className="field">
        最终视频提示词
        <textarea
          value={props.finalVideoPrompt}
          rows={5}
          onChange={(event) => props.onFinalVideoPromptChange(event.target.value)}
        />
      </label>
    </section>
  );
}
