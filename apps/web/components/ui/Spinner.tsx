export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-white/15 border-t-accent ${className}`}
      aria-hidden
    />
  );
}
