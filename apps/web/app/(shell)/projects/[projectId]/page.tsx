import Link from "next/link";
import { notFound } from "next/navigation";
import { serverFetchJson } from "@/lib/api/server";
import type { EpisodeDto, ProjectDto } from "@/lib/api/types";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/buttonStyles";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";

function formatUpdated(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  let project: ProjectDto;
  let episodes: EpisodeDto[];
  try {
    project = await serverFetchJson<ProjectDto>(`/projects/${projectId}`);
    episodes = await serverFetchJson<EpisodeDto[]>(
      `/projects/${projectId}/episodes`,
    );
  } catch {
    notFound();
  }

  return (
    <div className="space-y-10">
      <Link
        href="/projects"
        className={buttonClass("ghost", "inline-flex w-fit justify-start px-2")}
      >
        <span className="text-base leading-none" aria-hidden>
          ←
        </span>
        All projects
      </Link>

      <PageHeader
        title={project.name}
        subtitle={`${project.scene_count} tracked scenes · lead ${project.lead} · last update ${formatUpdated(project.updated_at)}`}
        actions={
          <>
            <Badge tone="success">{project.status}</Badge>
            <Link
              href="/character-bible"
              className={buttonClass("secondary", "px-4")}
            >
              Open bible
            </Link>
            <Link href="/upload-match" className={buttonClass("secondary", "px-4")}>
              Upload / match
            </Link>
          </>
        }
      />

      <Panel>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-text">Episodes</h2>
          <span className="text-xs text-muted">
            {episodes.length} in API store
          </span>
        </div>
        {episodes.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            No episodes yet. Use Upload / Match to queue a stub ingest job.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-white/[0.06]">
            {episodes.map((ep) => (
              <li
                key={ep.id}
                className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0"
              >
                <div>
                  <p className="text-sm font-medium text-text">{ep.title}</p>
                  <p className="mt-1 text-xs text-muted">
                    {ep.segment_count} segments · updated{" "}
                    {formatUpdated(ep.updated_at)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="accent">{ep.status}</Badge>
                  <Link
                    href={`/export?episode=${encodeURIComponent(ep.id)}`}
                    className={buttonClass("outline", "px-3 py-1.5 text-xs")}
                  >
                    Export
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
