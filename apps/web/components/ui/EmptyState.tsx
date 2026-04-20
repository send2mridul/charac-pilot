import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-panel px-6 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-panel-elevated ring-1 ring-border">
        <Icon className="h-6 w-6 text-muted" aria-hidden />
      </div>
      <p className="mt-4 text-sm font-semibold text-text">{title}</p>
      <p className="mt-2 max-w-sm text-sm text-muted">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
