import { getPublicApiBaseUrl } from "./config";
import { ApiError } from "./errors";
import type {
  CharacterDto,
  EpisodeDto,
  JobDto,
  ProjectDto,
  TranscriptDto,
  TranscriptSegmentDto,
  UploadCreateResponse,
} from "./types";

export { ApiError } from "./errors";

async function requestJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${getPublicApiBaseUrl()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(`API ${res.status} for ${path}`, res.status, text);
  }
  return (text ? JSON.parse(text) : null) as T;
}

export const api = {
  health: () => requestJson<{ status: string }>("/health"),

  listProjects: () => requestJson<ProjectDto[]>("/projects"),

  createProject: (body: { name: string; lead?: string }) =>
    requestJson<ProjectDto>("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  getProject: (id: string) => requestJson<ProjectDto>(`/projects/${id}`),

  listEpisodes: (projectId: string) =>
    requestJson<EpisodeDto[]>(`/projects/${projectId}/episodes`),

  /**
   * Multipart upload of a video file. Reports bytes-sent progress via onProgress (0–1).
   */
  uploadEpisodeFile(
    projectId: string,
    file: File,
    onProgress?: (ratio: number) => void,
  ): Promise<UploadCreateResponse> {
    return new Promise((resolve, reject) => {
      const url = `${getPublicApiBaseUrl()}/projects/${projectId}/episodes/upload`;
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.responseType = "json";

      xhr.upload.onprogress = (ev) => {
        if (!onProgress || !ev.lengthComputable) return;
        onProgress(ev.loaded / Math.max(ev.total, 1));
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.response as UploadCreateResponse);
          return;
        }
        const text =
          typeof xhr.response === "string"
            ? xhr.response
            : JSON.stringify(xhr.response ?? {});
        reject(
          new ApiError(
            `API ${xhr.status} for /projects/${projectId}/episodes/upload`,
            xhr.status,
            text,
          ),
        );
      };

      xhr.onerror = () =>
        reject(
          new ApiError("Network error during upload", 0, xhr.statusText || ""),
        );

      const body = new FormData();
      body.append("file", file, file.name);
      xhr.send(body);
    });
  },

  listCharacters: (projectId: string) =>
    requestJson<CharacterDto[]>(`/projects/${projectId}/characters`),

  getJob: (jobId: string) => requestJson<JobDto>(`/jobs/${jobId}`),

  getEpisodeTranscript: (episodeId: string) =>
    requestJson<TranscriptDto>(`/episodes/${episodeId}/transcript`),

  listEpisodeTranscriptSegments: (episodeId: string) =>
    requestJson<TranscriptSegmentDto[]>(`/episodes/${episodeId}/segments`),

  queueVoice: (characterId: string) =>
    requestJson<JobDto>(`/characters/${characterId}/voice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),

  replaceSegment: (episodeId: string, segmentId: string) =>
    requestJson<JobDto>(
      `/episodes/${episodeId}/segments/${segmentId}/replace`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    ),

  exportEpisode: (episodeId: string) =>
    requestJson<JobDto>(`/episodes/${episodeId}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preset: "review_prores" }),
    }),
};
