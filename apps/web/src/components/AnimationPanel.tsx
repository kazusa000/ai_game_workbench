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
        Video Base Prompt
        <textarea
          value={props.videoBasePrompt}
          rows={3}
          onChange={(event) => props.onVideoBasePromptChange(event.target.value)}
        />
      </label>
      <label className="field">
        Template Prompt
        <textarea
          value={props.templatePrompt}
          rows={2}
          onChange={(event) => props.onTemplatePromptChange(event.target.value)}
        />
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
      <label className="field">
        Final Video Prompt
        <textarea
          value={props.finalVideoPrompt}
          rows={5}
          onChange={(event) => props.onFinalVideoPromptChange(event.target.value)}
        />
      </label>
    </section>
  );
}
