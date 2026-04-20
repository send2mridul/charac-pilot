import type { ReactNode } from "react";

export function Panel({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-border bg-panel shadow-[0_1px_2px_rgba(17,24,39,0.06)] ${padded ? "p-5" : ""} ${className}`}
    >
      {children}
    </div>
  );
}
