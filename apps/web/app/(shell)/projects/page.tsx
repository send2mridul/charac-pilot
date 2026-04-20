"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FolderPlus, Plus, X } from "lucide-react";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { useProjects } from "@/components/providers/ProjectProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";

function statusTone(s: string) {
  if (s === "active") return "success" as const;
  if (s === "archived") return "default" as const;
  return "accent" as const;
}

function formatUpdated(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

type ProjStats = { total: number; voiced: number };

function setupHint(s: ProjStats | undefined): {
  line: string;
  tone: "default" | "accent" | "success";
} {
  if (!s || s.total === 0) {
    return { line: "Add or import characters", tone: "accent" };
  }
  if (s.voiced === 0) {
    return { line: `${s.total} character(s), attach voices`, tone: "accent" };
  }
  if (s.voiced < s.total) {
    return { line: `Voices ${s.voiced}/${s.total}`, tone: "accent" };
  }
  return { line: "Voices ready, open Replace Lines", tone: "success" };
}

export default function ProjectsPage() {
  const router = useRouter();
  const { projects, loading, error, refresh, setActiveProjectId } = useProjects();
  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [statsByProject, setStatsByProject] = useState<Record<string, ProjStats>>(
    {},
  );

  useEffect(() => {
    if (projects.length === 0) {
      setStatsByProject({});
      return;
    }
    let cancelled = false;
    void Promise.all(
      projects.map(async (p) => {
        try {
          const chars = await api.listCharacters(p.id);
          const voiced = chars.filter((c) => c.default_voice_id).length;
          return [p.id, { total: chars.length, voiced }] as const;
        } catch {
          return [p.id, { total: 0, voiced: 0 }] as const;
        }
      }),
    ).then((rows) => {
      if (cancelled) return;
      const next: Record<string, ProjStats> = {};
      for (const [id, s] of rows) next[id] = s;
      setStatsByProject(next);
    });
    return () => {
      cancelled = true;
    };
  }, [projects]);

  async function onCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const p = await api.createProject({
        name: newName.trim(),
        lead: "You",
        description: newDesc.trim(),
      });
      setActiveProjectId(p.id);
      await refresh();
      setModalOpen(false);
      setNewName("");
      setNewDesc("");
      router.push(`/projects/${p.id}`);
    } catch (e) {
      setCreateError(
        e instanceof ApiError ? e.message : "Could not create project",
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-10">
      <PageHeader
        title="Projects"
        subtitle="Start here: create a project, add characters, attach voices, then replace lines when you are ready."
        actions={
          <Button type="button" onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" />
            New project
          </Button>
        }
      />

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-project-title"
        >
          <div className="relative w-full max-w-md rounded-2xl border border-white/[0.1] bg-panel p-6 shadow-2xl ring-1 ring-white/10">
            <button
              type="button"
              className="absolute right-4 top-4 rounded-lg p-1 text-muted transition hover:bg-white/[0.06] hover:text-text"
              onClick={() => setModalOpen(false)}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
            <h2 id="new-project-title" className="text-lg font-semibold text-text">
              New project
            </h2>
            <p className="mt-1 text-sm text-muted">
              Name your production. Description is optional.
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-[11px] font-medium text-muted">
                  Project name
                </label>
                <input
                  autoFocus
                  className="mt-1 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Neon Alley, Season 2"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted">
                  Description (optional)
                </label>
                <textarea
                  className="mt-1 w-full rounded-lg border border-white/[0.12] bg-canvas/80 px-3 py-2 text-sm text-text outline-none focus:border-accent/40"
                  rows={3}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Short note for your future self"
                />
              </div>
            </div>
            {createError ? (
              <p className="mt-3 text-xs text-red-400">{createError}</p>
            ) : null}
            <div className="mt-6 flex justify-end gap-2">
              <Button
                variant="secondary"
                type="button"
                onClick={() => setModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={creating || !newName.trim()}
                onClick={() => void onCreate()}
              >
                {creating ? (
                  <Spinner className="h-4 w-4 border-t-canvas" />
                ) : null}
                Create and open
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <ErrorBanner
          title="Could not load projects"
          detail={`${error.message}. Is the API running on port 8000?`}
          onRetry={() => void refresh()}
        />
      ) : null}

      {loading ? (
        <Panel>
          <div className="space-y-3">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </Panel>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderPlus}
          title="No projects yet"
          description="Create a project, then add characters, attach voices, and replace lines."
          action={
            <Button type="button" onClick={() => setModalOpen(true)}>
              Create project
            </Button>
          }
        />
      ) : (
        <Panel padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-xs uppercase tracking-wider text-muted">
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Setup</th>
                  <th className="px-5 py-3 font-medium">Scenes</th>
                  <th className="px-5 py-3 font-medium text-right">Updated</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const hint = setupHint(statsByProject[p.id]);
                  return (
                    <tr
                      key={p.id}
                      className="border-b border-white/[0.04] transition last:border-0 hover:bg-white/[0.02]"
                    >
                      <td className="px-5 py-4">
                        <Link
                          href={`/projects/${p.id}`}
                          onClick={() => setActiveProjectId(p.id)}
                          className="font-medium text-text underline-offset-4 transition hover:text-accent hover:underline"
                        >
                          {p.name}
                        </Link>
                      </td>
                      <td className="px-5 py-4">
                        <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                      </td>
                      <td className="px-5 py-4">
                        <Badge tone={hint.tone}>{hint.line}</Badge>
                      </td>
                      <td className="px-5 py-4 text-muted">{p.scene_count}</td>
                      <td className="px-5 py-4 text-right text-muted">
                        {formatUpdated(p.updated_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
