"use client";

import { Suspense, useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { mockExport } from "@characpilot/shared";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import type { JobDto } from "@/lib/api/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { ProgressBar } from "@/components/ui/ProgressBar";

function statusTone(s: string) {
  if (s === "done") return "success" as const;
  if (s === "running") return "accent" as const;
  if (s === "failed") return "danger" as const;
  return "default" as const;
}

function ExportInner() {
  const search = useSearchParams();
  const episodeFromQuery = search.get("episode");
  const { presets } = mockExport;
  const [job, setJob] = useState<JobDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const poll = useCallback(async (jobId: string) => {
    const j = await api.getJob(jobId);
    setJob(j);
    if (j.status === "queued" || j.status === "running") {
      window.setTimeout(() => void poll(jobId), 400);
    }
  }, []);

  async function queueStubExport() {
    const ep = episodeFromQuery ?? "ep1";
    setError(null);
    setJob(null);
    try {
      const j = await api.exportEpisode(ep);
      setJob(j);
      void poll(j.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Export failed");
    }
  }

  return (
    <div className="space-y-10">
      <PageHeader
        title="Export"
        subtitle="Preset cards are fixtures. Queue a real stub job with POST /episodes/{id}/export (defaults to ep1 or ?episode= from project detail)."
        actions={
          <Button variant="secondary" onClick={() => void queueStubExport()}>
            <Download className="h-4 w-4" />
            Queue API export
          </Button>
        }
      />

      {episodeFromQuery ? (
        <Panel>
          <p className="text-sm text-muted">
            Episode from query:{" "}
            <span className="font-mono text-text">{episodeFromQuery}</span>
          </p>
        </Panel>
      ) : null}

      {error ? <ErrorBanner title="Export" detail={error} /> : null}

      {job ? (
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-text">Active job</h2>
            <Badge tone={statusTone(job.status)}>{job.status}</Badge>
          </div>
          <p className="mt-2 font-mono text-xs text-muted">{job.id}</p>
          <p className="mt-1 text-sm text-muted">{job.message}</p>
          <ProgressBar value={job.progress} className="mt-3" />
          {job.status === "done" && job.result ? (
            <pre className="mt-4 max-h-40 overflow-auto rounded-lg bg-canvas p-3 text-xs text-muted">
              {JSON.stringify(job.result, null, 2)}
            </pre>
          ) : null}
        </Panel>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        {presets.map((preset) => (
          <Panel key={preset.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-text">
                  {preset.label}
                </h2>
                <p className="mt-1 text-sm text-muted">{preset.format}</p>
              </div>
              <Badge tone={statusTone(preset.status)}>{preset.status}</Badge>
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Resolution</dt>
                <dd className="text-right text-text">{preset.resolution}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">ETA</dt>
                <dd className="text-right text-text">{preset.eta}</dd>
              </div>
            </dl>
            <Button variant="secondary" className="mt-5 w-full">
              Queue export
            </Button>
          </Panel>
        ))}
      </div>
    </div>
  );
}

export default function ExportPage() {
  return (
    <Suspense
      fallback={
        <div className="text-sm text-muted">Loading export workspace…</div>
      }
    >
      <ExportInner />
    </Suspense>
  );
}
