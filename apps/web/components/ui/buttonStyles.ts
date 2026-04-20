export const buttonVariants = {
  primary:
    "bg-accent text-canvas hover:bg-teal-300 shadow-[0_0_24px_-8px_rgba(94,234,212,0.7)]",
  secondary:
    "bg-panel-elevated text-text ring-1 ring-white/10 hover:bg-white/[0.06]",
  ghost: "text-muted hover:text-text hover:bg-white/[0.05]",
  outline: "ring-1 ring-white/15 text-text hover:bg-white/[0.04]",
} as const;

export function buttonClass(
  variant: keyof typeof buttonVariants,
  className = "",
) {
  return `inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${buttonVariants[variant]} ${className}`;
}
