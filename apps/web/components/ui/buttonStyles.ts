export const buttonVariants = {
  primary:
    "bg-accent text-white shadow-[0_1px_0_0_rgba(255,255,255,0.2)_inset,0_1px_2px_rgba(17,24,39,0.18)] hover:opacity-95",
  secondary:
    "bg-panel text-text ring-1 ring-border shadow-[0_1px_2px_rgba(17,24,39,0.08)] hover:bg-panel-elevated",
  ghost: "text-muted hover:text-text hover:bg-slate-100",
  outline: "ring-1 ring-border text-text bg-panel hover:bg-slate-50",
} as const;

export function buttonClass(
  variant: keyof typeof buttonVariants,
  className = "",
) {
  return `inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition ${buttonVariants[variant]} ${className}`;
}
