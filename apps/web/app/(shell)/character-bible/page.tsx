"use client";

import { useEffect, useState } from "react";
import { BookOpen, ImageIcon } from "lucide-react";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import type { CharacterDto } from "@/lib/api/types";
import { useProjects } from "@/components/providers/ProjectProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";

export default function CharacterBiblePage() {
  const {
    projects,
    activeProjectId,
    setActiveProjectId,
    loading: projectsLoading,
  } = useProjects();
  const [characters, setCharacters] = useState<CharacterDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

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
          setError(
            e instanceof ApiError ? e : new ApiError("Request failed", 0, ""),
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  const active = projects.find((p) => p.id === activeProjectId);

  return (
    <div className="space-y-10">
      <PageHeader
        title="Character Bible"
        subtitle="Canonical look, behavior, and continuity rules — scoped to the active project in the sidebar."
        actions={
          <>
            <Button variant="secondary">Import references</Button>
            <Button>Add character</Button>
          </>
        }
      />

      <Panel>
        <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
          Active project
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <select
            className="min-w-[200px] rounded-xl border border-white/[0.08] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/20"
            value={activeProjectId ?? ""}
            disabled={projectsLoading || projects.length === 0}
            onChange={(e) => setActiveProjectId(e.target.value)}
          >
            {projects.length === 0 ? (
              <option value="">No projects</option>
            ) : (
              projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))
            )}
          </select>
          {active ? (
            <span className="text-xs text-muted">
              {active.scene_count} scenes tracked
            </span>
          ) : null}
        </div>
      </Panel>

      {error ? (
        <ErrorBanner
          title="Could not load characters"
          detail={error.message}
        />
      ) : null}

      {projectsLoading || loading ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel>
            <Skeleton className="h-40 w-full" />
          </Panel>
          <Panel>
            <Skeleton className="h-40 w-full" />
          </Panel>
        </div>
      ) : !activeProjectId ? (
        <EmptyState
          icon={BookOpen}
          title="Pick a project"
          description="Create a project first, then choose it above to load bible entries from the API."
        />
      ) : characters.length === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title="No characters in API"
          description="Seed data includes characters for projects p1 and p2. Switch project or extend the API store."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {characters.map((c) => (
            <Panel key={c.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-text">{c.name}</h2>
                  <p className="text-sm text-muted">{c.role}</p>
                </div>
                <Badge tone="violet">Bible</Badge>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <div className="sm:col-span-1">
                  <div className="flex aspect-[3/4] flex-col items-center justify-center rounded-xl bg-white/[0.03] ring-1 ring-dashed ring-white/15">
                    <ImageIcon className="h-8 w-8 text-muted" />
                    <p className="mt-2 text-xs text-muted">Reference grid</p>
                  </div>
                </div>
                <div className="sm:col-span-2 space-y-4 text-sm">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Traits
                    </p>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {c.traits.map((t) => (
                        <li key={t}>
                          <Badge tone="accent">{t}</Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Wardrobe
                    </p>
                    <p className="mt-2 leading-relaxed text-muted">
                      {c.wardrobe_notes}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Continuity rules
                    </p>
                    <ul className="mt-2 list-inside list-disc space-y-1 text-muted">
                      {c.continuity_rules.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
