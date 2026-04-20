import { notFound } from "next/navigation";
import { serverFetchJson } from "@/lib/api/server";
import type { CharacterDto, EpisodeDto, ProjectDto } from "@/lib/api/types";
import { ProjectDetailView } from "./ProjectDetailView";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  let project: ProjectDto;
  let episodes: EpisodeDto[];
  let characters: CharacterDto[];
  try {
    project = await serverFetchJson<ProjectDto>(`/projects/${projectId}`);
    episodes = await serverFetchJson<EpisodeDto[]>(
      `/projects/${projectId}/episodes`,
    );
    characters = await serverFetchJson<CharacterDto[]>(
      `/projects/${projectId}/characters`,
    );
  } catch {
    notFound();
  }

  return (
    <ProjectDetailView
      initialProject={project}
      initialEpisodes={episodes}
      initialCharacters={characters}
    />
  );
}
