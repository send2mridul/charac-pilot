"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  Clapperboard,
  Cpu,
  Sparkles,
} from "lucide-react";
import { mockDashboard } from "@characpilot/shared";
import { api } from "@/lib/api/client";
import { useProjects } from "@/components/providers/ProjectProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatCard } from "@/components/ui/StatCard";

const kindLabel: Record<string, string> = {
  render: "Render",
  upload: "Upload",
  continuity: "Continuity",
  export: "Export",
};

export default function DashboardPage() {
  const { stats, activity } = mockDashboard;
  const { projects, loading } = useProjects();
  const [apiOk, setApiOk] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .health()
      .then(() => setApiOk(true))
      .catch(() => setApiOk(false));
  }, []);

  return (
    <div className="space-y-10">
      <PageHeader
        title="Dashboard"
        subtitle="Continuity health, queue posture, and recent moves. Project counts sync from your local API when it is reachable."
        actions={
          <>
            <Button variant="secondary">View queue</Button>
            <Button>Open continuity report</Button>
          </>
        }
      />

      {apiOk === false ? (
        <ErrorBanner
          title="API unreachable"
          detail="Start the FastAPI service on port 8000 (see repo README) to hydrate live project counts."
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active projects"
          value={loading ? "…" : projects.filter((p) => p.status === "active").length}
          hint={
            apiOk === null
              ? "Checking API…"
              : apiOk
                ? "From GET /projects"
                : "API offline"
          }
          icon={<Clapperboard className="h-4 w-4" />}
        />
        <StatCard
          label="Renders queued"
          value={stats.rendersQueued}
          hint="Placeholder until worker metrics exist"
          icon={<Cpu className="h-4 w-4" />}
        />
        <StatCard
          label="Continuity score"
          value={`${stats.continuityScore}%`}
          hint="Demo metric from fixtures"
          icon={<Sparkles className="h-4 w-4" />}
        />
        <StatCard
          label="Last export"
          value={stats.lastExportLabel.split("·")[0]?.trim() ?? "—"}
          hint={stats.lastExportLabel}
          icon={<Activity className="h-4 w-4" />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-text">Recent activity</h2>
            <Badge tone="accent">Demo data</Badge>
          </div>
          <ul className="mt-4 divide-y divide-white/[0.06]">
            {activity.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-start justify-between gap-3 py-4 first:pt-0"
              >
                <div>
                  <p className="text-sm font-medium text-text">{item.title}</p>
                  <p className="mt-1 text-sm text-muted">{item.detail}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="violet">{kindLabel[item.kind]}</Badge>
                  <span className="text-xs text-muted">{item.time}</span>
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel>
          <h2 className="text-sm font-semibold text-text">Quick actions</h2>
          <p className="mt-1 text-sm text-muted">
            Keyboard hints are illustrative; wire command palette later.
          </p>
          <div className="mt-4 space-y-2">
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-xl bg-white/[0.03] px-3 py-3 text-left text-sm ring-1 ring-white/10 transition hover:bg-white/[0.06]"
            >
              <span className="font-medium text-text">Run continuity pass</span>
              <span className="text-xs text-muted">⌘ K</span>
            </button>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-xl bg-white/[0.03] px-3 py-3 text-left text-sm ring-1 ring-white/10 transition hover:bg-white/[0.06]"
            >
              <span className="font-medium text-text">Queue voice batch</span>
              <span className="text-xs text-muted">⌘ ⇧ V</span>
            </button>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-xl bg-white/[0.03] px-3 py-3 text-left text-sm ring-1 ring-white/10 transition hover:bg-white/[0.06]"
            >
              <span className="font-medium text-text">New export preset</span>
              <span className="text-xs text-muted">⌘ E</span>
            </button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
