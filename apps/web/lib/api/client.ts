import { getPublicApiBaseUrl } from "./config";
import { ApiError } from "./errors";
import type {
  CharacterDto,
  EpisodeDto,
  JobDto,
  PreviewDto,
  ProjectDto,
  SpeakerGroupDto,
  TranscriptDto,
  TranscriptSegmentDto,
  UploadCreateResponse,
  VoiceCatalogItem,
  VoiceCatalogResponse,
  ReplacementDto,
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

  listSpeakerGroups: (episodeId: string) =>
    requestJson<SpeakerGroupDto[]>(`/episodes/${episodeId}/speaker-groups`),

  renameSpeakerGroup: (
    episodeId: string,
    speakerLabel: string,
    body: { display_name?: string; is_narrator?: boolean },
  ) =>
    requestJson<SpeakerGroupDto>(
      `/episodes/${episodeId}/speaker-groups/${encodeURIComponent(speakerLabel)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ),

  createCharacterFromGroup: (
    episodeId: string,
    speakerLabel: string,
    body: { name: string; project_id?: string },
  ) =>
    requestJson<CharacterDto>(
      `/episodes/${episodeId}/speaker-groups/${encodeURIComponent(speakerLabel)}/create-character`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ),

  getCharacter: (characterId: string) =>
    requestJson<CharacterDto>(`/characters/${characterId}`),

  patchCharacter: (
    characterId: string,
    body: Partial<Pick<CharacterDto, "name" | "role" | "default_voice_id" | "is_narrator" | "voice_style_presets" | "traits" | "wardrobe_notes">>,
  ) =>
    requestJson<CharacterDto>(`/characters/${characterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  generatePreview: (
    characterId: string,
    body: { text: string; voice_id?: string; style?: string },
  ) =>
    requestJson<PreviewDto>(`/characters/${characterId}/generate-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  listVoiceCatalog: (params?: { page?: number; page_size?: number }) => {
    const sp = new URLSearchParams();
    if (params?.page != null) sp.set("page", String(params.page));
    if (params?.page_size != null) sp.set("page_size", String(params.page_size));
    const q = sp.toString();
    return requestJson<VoiceCatalogResponse>(
      `/voices/catalog${q ? `?${q}` : ""}`,
    );
  },

  searchVoiceCatalog: (params?: {
    q?: string;
    page?: number;
    page_size?: number;
  }) => {
    const sp = new URLSearchParams();
    if (params?.q != null) sp.set("q", params.q);
    if (params?.page != null) sp.set("page", String(params.page));
    if (params?.page_size != null) sp.set("page_size", String(params.page_size));
    const q = sp.toString();
    return requestJson<VoiceCatalogResponse>(
      `/voices/catalog/search${q ? `?${q}` : ""}`,
    );
  },

  assignVoice: (
    characterId: string,
    body: { voice_id: string; provider?: string; display_name?: string },
  ) =>
    requestJson<CharacterDto>(`/characters/${characterId}/voice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  listEpisodeReplacements: (episodeId: string) =>
    requestJson<ReplacementDto[]>(`/episodes/${episodeId}/replacements`),

  createSegmentReplacement: (
    episodeId: string,
    segmentId: string,
    body: { character_id: string; replacement_text: string; tone_style?: string },
  ) =>
    requestJson<ReplacementDto>(
      `/episodes/${episodeId}/segments/${encodeURIComponent(segmentId)}/replace`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ),

  patchEpisodeReplacement: (
    episodeId: string,
    replacementId: string,
    body: {
      replacement_text?: string;
      tone_style?: string;
      regenerate_audio?: boolean;
    },
  ) =>
    requestJson<ReplacementDto>(
      `/episodes/${episodeId}/replacements/${encodeURIComponent(replacementId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ),

  deleteEpisodeReplacement: async (
    episodeId: string,
    replacementId: string,
  ): Promise<void> => {
    const url = `${getPublicApiBaseUrl()}/episodes/${episodeId}/replacements/${encodeURIComponent(replacementId)}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new ApiError(`API ${res.status} for DELETE replacement`, res.status, text);
    }
  },

  exportEpisode: (episodeId: string) =>
    requestJson<JobDto>(`/episodes/${episodeId}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preset: "review_prores" }),
    }),
};
