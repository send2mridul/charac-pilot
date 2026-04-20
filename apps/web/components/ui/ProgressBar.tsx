export function ProgressBar({
  value,
  className = "",
}: {
  value: number;
  className?: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      className={`h-2 w-full overflow-hidden rounded-full bg-white/5 ring-1 ring-white/10 ${className}`}
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-accent to-teal-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
