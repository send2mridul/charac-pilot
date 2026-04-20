"use client";

import { mockContinuity } from "@characpilot/shared";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";

function severityTone(s: string) {
  if (s === "high") return "danger" as const;
  if (s === "medium") return "warning" as const;
  return "default" as const;
}

export default function ContinuityCheckPage() {
  const { issues } = mockContinuity;

  return (
    <div className="space-y-10">
      <PageHeader
        title="Continuity"
        subtitle="Coming soon. Automated checks against your character notes. Sample data below is for layout only."
      />

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-text">Findings</h2>
          <Badge tone="violet">{issues.length} open</Badge>
        </div>
        <ul className="mt-4 divide-y divide-white/[0.06]">
          {issues.map((issue) => (
            <li
              key={issue.id}
              className="flex flex-col gap-3 py-4 first:pt-0 lg:flex-row lg:items-start lg:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-text">
                    Scene {issue.scene}
                  </span>
                  <Badge tone={severityTone(issue.severity)}>
                    {issue.severity}
                  </Badge>
                  <span className="font-mono text-xs text-muted">
                    {issue.timecode}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-text">
                  {issue.summary}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {issue.suggestion}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
