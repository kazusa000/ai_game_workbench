interface AnimationPanelProps {
  actionTemplate: string;
  actionPrompt: string;
  composedPrompt: string;
  keyColor: string;
  onActionTemplateChange: (value: string) => void;
  onActionPromptChange: (value: string) => void;
  onKeyColorChange: (value: string) => void;
}

const actionTemplates = ["idle", "walk", "run", "jump", "attack", "hit", "defeated", "custom"];

export function AnimationPanel(props: AnimationPanelProps) {
  return (
    <section className="panel">
      <div className="panel-title">Animation</div>
      <label className="field">
        Action Template
        <select value={props.actionTemplate} onChange={(event) => props.onActionTemplateChange(event.target.value)}>
          {actionTemplates.map((template) => (
            <option value={template} key={template}>{template}</option>
          ))}
        </select>
      </label>
      <label className="field">
        Action Prompt
        <textarea
          value={props.actionPrompt}
          rows={3}
          onChange={(event) => props.onActionPromptChange(event.target.value)}
        />
      </label>
      <label className="field">
        Key Color
        <input type="color" value={props.keyColor} onChange={(event) => props.onKeyColorChange(event.target.value)} />
      </label>
      <div className="prompt-preview">{props.composedPrompt}</div>
    </section>
  );
}
