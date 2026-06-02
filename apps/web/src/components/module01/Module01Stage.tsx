import type { ReactNode } from "react";

export interface Module01StatusItem {
  label: string;
  value: string;
  state?: "ready" | "missing" | "running" | "done";
}

export function Module01PageStage({
  title,
  status,
  statusItems,
  children
}: {
  title: string;
  status: string;
  statusItems?: readonly Module01StatusItem[];
  children: ReactNode;
}) {
  return (
    <section className="workflow-stage module01-page-stage">
      <div className="stage-heading">
        <h2>{title}</h2>
        <span>{status}</span>
      </div>
      {statusItems?.length ? (
        <div className="module01-status-grid">
          {statusItems.map((item) => (
            <div className={`module01-status-item module01-status-${item.state ?? "ready"}`} key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      ) : null}
      <div className="module01-page-body">{children}</div>
    </section>
  );
}

export function Module01ActionSection({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="module01-action-section" aria-label={title}>
      <div className="module01-section-heading">
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  );
}

export function Module01MediaGrid({
  children,
  columns = 2
}: {
  children: ReactNode;
  columns?: 2 | 3;
}) {
  return (
    <div className={["stage-media-grid", columns === 3 ? "stage-media-grid-three" : ""].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

export function Module01AdvancedDetails({
  title = "高级设置",
  children
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <details className="module01-advanced-details">
      <summary>{title}</summary>
      <div className="module01-advanced-body">{children}</div>
    </details>
  );
}
