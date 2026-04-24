"use client";

import { Check, FileVideo, Users, Mic2, Sparkles, Download } from "lucide-react";

export type StepState = "done" | "current" | "todo" | "blocked";

export interface WorkflowStep {
  id: string;
  label: string;
  hint: string;
  state: StepState;
  count?: string;
}

const icons: Record<string, React.ComponentType<{ className?: string }>> = {
  import: FileVideo,
  cast: Users,
  voices: Mic2,
  generate: Sparkles,
  export: Download,
};

export function WorkflowStepper({ steps }: { steps: WorkflowStep[] }) {
  return (
    <div className="h-[68px] shrink-0 bg-surface border-b border-border flex items-stretch px-8">
      {steps.map((s, i) => {
        const Icon = icons[s.id] ?? FileVideo;
        const isLast = i === steps.length - 1;
        const stateCls =
          s.state === "done"    ? "text-success" :
          s.state === "current" ? "text-foreground" :
          s.state === "blocked" ? "text-warning-foreground" :
                                  "text-foreground-subtle";
        const dotCls =
          s.state === "done"    ? "bg-success text-white border-success" :
          s.state === "current" ? "bg-foreground text-surface border-foreground" :
          s.state === "blocked" ? "bg-warning-soft text-warning-foreground border-warning-border" :
                                  "bg-canvas text-foreground-subtle border-border";

        return (
          <div key={s.id} className="flex items-center flex-1 min-w-0">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className={`size-8 rounded-full border flex items-center justify-center shrink-0 transition-colors ${dotCls}`}>
                {s.state === "done"
                  ? <Check className="size-4" strokeWidth={3} />
                  : <Icon className="size-[15px]" />}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-[10.5px] font-bold uppercase tracking-[0.14em] ${stateCls}`}>
                    Step {i + 1}
                  </span>
                  {s.count && (
                    <span className="text-[10.5px] font-semibold num text-foreground-subtle">{s.count}</span>
                  )}
                </div>
                <div className={`text-[13.5px] font-bold tracking-tight leading-tight ${stateCls}`}>{s.label}</div>
                <div className="text-[11px] text-foreground-subtle leading-tight truncate">{s.hint}</div>
              </div>
            </div>
            {!isLast && <div className="h-px w-8 mx-2 bg-border shrink-0" />}
          </div>
        );
      })}
    </div>
  );
}
