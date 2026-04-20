"use client";

import { useEffect, useState } from "react";
import { Play, SlidersHorizontal } from "lucide-react";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import type { CharacterDto, JobDto } from "@/lib/api/types";
import { useProjects } from "@/components/providers/ProjectProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Skeleton } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";

export default function VoiceStudioPage() {
  const { activeProjectId } = useProjects();
  const [characters, setCharacters] = useState<CharacterDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Record<string, JobDto | undefined>>({});

  useEffect(() => {
    if (!activeProjectId) {
      setCharacters([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .listCharacters(activeProjectId)
      .then((rows) => {
        if (!cancelled) setCharacters(rows);
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof ApiError ? e.message : "Load failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  async function poll(jobId: string, characterId: string) {
    const j = await api.getJob(jobId);
    setJobs((prev) => ({ ...prev, [characterId]: j }));
    if (j.status === "queued" || j.status === "running") {
      window.setTimeout(() => void poll(jobId, characterId), 400);
    }
  }

  async function onVoice(characterId: string) {
    setError(null);
    try {
      const j = await api.queueVoice(characterId);
      setJobs((prev) => ({ ...prev, [characterId]: j }));
      void poll(j.id, characterId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Voice queue failed");
    }
  }

  return (
    <div className="space-y-10">
      <PageHeader
        title="Voice Studio"
        subtitle="Characters load from the active project. Preview queues a stub job via POST /characters/{id}/voice."
        actions={
          <>
            <Button variant="secondary">
              <SlidersHorizontal className="h-4 w-4" />
              Mix presets
            </Button>
            <Button>New line pack</Button>
          </>
        }
      />

      {error ? <ErrorBanner title="Voice studio" detail={error} /> : null}

      {loading ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel>
            <Skeleton className="h-48 w-full" />
          </Panel>
          <Panel>
            <Skeleton className="h-48 w-full" />
          </Panel>
        </div>
      ) : characters.length === 0 ? (
        <Panel>
          <p className="text-sm text-muted">
            No characters for this project. Switch the active project in the
            sidebar or add entries in the API seed store.
          </p>
        </Panel>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {characters.map((v) => {
            const job = jobs[v.id];
            return (
              <Panel key={v.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-text">{v.name}</h2>
                    <p className="text-sm text-muted">
                      {v.role} · project voice
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Badge tone="accent">Stub</Badge>
                    {job ? (
                      <Badge
                        tone={
                          job.status === "done"
                            ? "success"
                            : job.status === "failed"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {job.status}
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 rounded-xl bg-canvas/80 p-4 ring-1 ring-white/[0.06]">
                  <div className="flex h-14 items-end gap-0.5">
                    {Array.from({ length: 48 }).map((_, i) => {
                      const h = 20 + ((i * 13) % 55);
                      return (
                        <div
                          key={i}
                          className="flex-1 rounded-sm bg-gradient-to-t from-accent/20 to-accent/70"
                          style={{ height: `${h}%` }}
                        />
                      );
                    })}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-muted">Waveform preview</p>
                    <Button
                      variant="secondary"
                      className="px-3 py-1.5 text-xs"
                      onClick={() => void onVoice(v.id)}
                    >
                      {job?.status === "running" || job?.status === "queued" ? (
                        <>
                          <Spinner className="h-3.5 w-3.5 border-t-text" />
                          Working…
                        </>
                      ) : (
                        <>
                          <Play className="h-3.5 w-3.5" />
                          Queue preview
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {job ? (
                  <p className="mt-3 text-xs text-muted">{job.message}</p>
                ) : (
                  <p className="mt-3 text-xs text-muted">
                    Traits: {v.traits.slice(0, 2).join(", ")}
                    {v.traits.length > 2 ? "…" : ""}
                  </p>
                )}

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted">Stub stability</p>
                    <ProgressBar value={0.62} className="mt-2" />
                  </div>
                  <div>
                    <p className="text-xs text-muted">Stub clarity</p>
                    <ProgressBar value={0.78} className="mt-2" />
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
