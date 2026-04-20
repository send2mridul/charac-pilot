"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FolderPlus, Plus } from "lucide-react";
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

export default function ProjectsPage() {
  const router = useRouter();
  const { projects, loading, error, refresh, setActiveProjectId } = useProjects();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function onCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      const name = `Untitled ${new Date().toLocaleDateString()}`;
      const p = await api.createProject({ name, lead: "You" });
      setActiveProjectId(p.id);
      await refresh();
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
        subtitle="Productions in your workspace. List syncs from the local API — create a project to start the detail flow."
        actions={
          <Button disabled={creating} onClick={() => void onCreate()}>
            {creating ? (
              <>
                <Spinner className="h-4 w-4 border-t-canvas" />
                Creating…
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                New project
              </>
            )}
          </Button>
        }
      />

      {error ? (
        <ErrorBanner
          title="Could not load projects"
          detail={`${error.message} — is the API running on port 8000?`}
          onRetry={() => void refresh()}
        />
      ) : null}
      {createError ? (
        <ErrorBanner title="Create failed" detail={createError} />
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
          description="Create your first project to unlock episodes, characters, and stub ingest jobs."
          action={<Button onClick={() => void onCreate()}>Create project</Button>}
        />
      ) : (
        <Panel padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-xs uppercase tracking-wider text-muted">
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Scenes</th>
                  <th className="px-5 py-3 font-medium">Lead</th>
                  <th className="px-5 py-3 font-medium text-right">Updated</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]"
                  >
                    <td className="px-5 py-4">
                      <Link
                        href={`/projects/${p.id}`}
                        onClick={() => setActiveProjectId(p.id)}
                        className="font-medium text-text underline-offset-4 hover:text-accent hover:underline"
                      >
                        {p.name}
                      </Link>
                    </td>
                    <td className="px-5 py-4">
                      <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                    </td>
                    <td className="px-5 py-4 text-muted">{p.scene_count}</td>
                    <td className="px-5 py-4 text-muted">{p.lead}</td>
                    <td className="px-5 py-4 text-right text-muted">
                      {formatUpdated(p.updated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
