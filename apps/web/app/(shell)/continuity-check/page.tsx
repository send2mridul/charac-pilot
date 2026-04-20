"use client";

import { mockContinuity } from "@characpilot/shared";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
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
        title="Continuity Check"
        subtitle="Scene-by-scene findings against your bible. Data below is static until a scan service exists."
        actions={
          <>
            <Button variant="secondary">Import timeline</Button>
            <Button>
              <ShieldAlert className="h-4 w-4" />
              Re-run scan
            </Button>
          </>
        }
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
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" className="px-3 py-2 text-xs">
                  Jump to cut
                </Button>
                <Button variant="secondary" className="px-3 py-2 text-xs">
                  Mark intentional
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
