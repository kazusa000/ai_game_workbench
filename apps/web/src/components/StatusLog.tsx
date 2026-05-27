interface StatusLogProps {
  status: string;
}

export function StatusLog({ status }: StatusLogProps) {
  return (
    <footer className="status-log" aria-live="polite">
      <span>状态</span>
      <p>{status}</p>
    </footer>
  );
}
