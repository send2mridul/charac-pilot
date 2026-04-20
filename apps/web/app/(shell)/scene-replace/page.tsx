"use client";

import { useCallback, useState } from "react";
import Image from "next/image";
import { mockSceneReplace } from "@characpilot/shared";
import { ArrowRight, Wand2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import type { JobDto } from "@/lib/api/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { ProgressBar } from "@/components/ui/ProgressBar";

export default function SceneReplacePage() {
  const { pairs } = mockSceneReplace;
  const [job, setJob] = useState<JobDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const poll = useCallback(async (jobId: string) => {
    const j = await api.getJob(jobId);
    setJob(j);
    if (j.status === "queued" || j.status === "running") {
      window.setTimeout(() => void poll(jobId), 400);
    }
  }, []);

  async function runStubReplace() {
    setError(null);
    try {
      const j = await api.replaceSegment("ep1", "seg_001");
      setJob(j);
      void poll(j.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Replace failed");
    }
  }

  return (
    <div className="space-y-10">
      <PageHeader
        title="Scene Replace"
        subtitle="Visual compare uses fixtures. “Preview swap” hits POST /episodes/{id}/segments/{segment_id}/replace for ep1 / seg_001."
        actions={
          <>
            <Button variant="secondary">Load EDL</Button>
            <Button onClick={() => void runStubReplace()}>
              <Wand2 className="h-4 w-4" />
              Preview swap (API)
            </Button>
          </>
        }
      />

      {error ? <ErrorBanner title="Replace" detail={error} /> : null}

      {job ? (
        <Panel>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-text">Job</h2>
            <Badge tone="accent">{job.status}</Badge>
          </div>
          <p className="mt-2 text-sm text-muted">{job.message}</p>
          <ProgressBar value={job.progress} className="mt-3" />
        </Panel>
      ) : null}

      <div className="space-y-6">
        {pairs.map((pair) => (
          <Panel key={pair.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-text">{pair.shot}</h2>
                <p className="mt-1 text-sm text-muted">{pair.note}</p>
              </div>
              <Badge tone="accent">Storyboard</Badge>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
              <div className="overflow-hidden rounded-xl ring-1 ring-white/10">
                <Image
                  src={pair.beforeThumb}
                  alt={`Before ${pair.shot}`}
                  width={640}
                  height={360}
                  className="h-auto w-full bg-panel"
                />
                <p className="bg-panel/90 px-3 py-2 text-xs text-muted">
                  Before
                </p>
              </div>
              <div className="flex justify-center md:px-2">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.05] ring-1 ring-white/10">
                  <ArrowRight className="h-5 w-5 text-accent" />
                </div>
              </div>
              <div className="overflow-hidden rounded-xl ring-1 ring-white/10">
                <Image
                  src={pair.afterThumb}
                  alt={`After ${pair.shot}`}
                  width={640}
                  height={360}
                  className="h-auto w-full bg-panel"
                />
                <p className="bg-panel/90 px-3 py-2 text-xs text-muted">
                  After
                </p>
              </div>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}
