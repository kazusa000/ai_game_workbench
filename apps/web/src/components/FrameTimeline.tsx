interface FrameTimelineProps {
  fps: number;
  loop: boolean;
}

export function FrameTimeline({ fps, loop }: FrameTimelineProps) {
  return (
    <section className="timeline-panel" aria-label="Frame timeline">
      <div className="timeline-meta">
        <span>{fps} FPS</span>
        <span>{loop ? "Loop" : "Once"}</span>
      </div>
      <div className="frame-strip">
        {Array.from({ length: 8 }, (_, index) => (
          <button className="frame-cell" type="button" key={index}>
            {String(index + 1).padStart(2, "0")}
          </button>
        ))}
      </div>
    </section>
  );
}
