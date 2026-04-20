"use client";

import type { ReactNode } from "react";
import { useHydrated } from "@/lib/useHydrated";
import { Panel } from "./Panel";

export function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
}) {
  const hydrated = useHydrated();

  return (
    <Panel className="relative overflow-hidden">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted">
            {label}
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-text">
            {value}
          </p>
          {hint ? (
            <p className="mt-1 text-xs text-muted/90">{hint}</p>
          ) : null}
        </div>
        {icon ? (
          <div className="rounded-xl bg-accent-dim p-2 text-accent">
            {hydrated ? icon : <span className="block h-4 w-4" aria-hidden />}
          </div>
        ) : null}
      </div>
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-accent/10 blur-2xl" />
    </Panel>
  );
}
