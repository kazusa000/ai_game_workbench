interface StatusLogProps {
  status: string;
}

export function StatusLog({ status }: StatusLogProps) {
  return (
    <footer className="status-log" aria-live="polite">
      <span>Status</span>
      <p>{status}</p>
    </footer>
  );
}
