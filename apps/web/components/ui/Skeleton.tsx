export function Skeleton({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-white/[0.06] ring-1 ring-white/[0.06] ${className}`}
    />
  );
}
