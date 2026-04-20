import type { ReactNode } from "react";

const tones: Record<string, string> = {
  default: "bg-white/5 text-muted ring-1 ring-white/10",
  accent: "bg-accent-dim text-accent ring-1 ring-accent/25",
  violet: "bg-violet-dim text-violet ring-1 ring-violet/25",
  success: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/25",
  warning: "bg-warning/15 text-warning ring-1 ring-warning/30",
  danger: "bg-danger/15 text-danger ring-1 ring-danger/25",
};

export function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: keyof typeof tones;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
