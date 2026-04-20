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
      className={`rounded-2xl border border-white/[0.08] bg-panel/80 shadow-[0_0_0_1px_rgba(255,255,255,0.02)_inset] backdrop-blur-sm ${padded ? "p-5" : ""} ${className}`}
    >
      {children}
    </div>
  );
}
