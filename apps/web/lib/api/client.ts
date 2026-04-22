import { getPublicApiBaseUrl } from "./config";
import { ApiError } from "./errors";
import type {
  CharacterDto,
  DesignVoiceResponseDto,
  DraftLineDto,
  EpisodeDto,
  GenerateClipsResponseDto,
  GenerateDraftLinesResponseDto,
  GenerateLinesResponseDto,
  JobDto,
  PreviewDto,
  ProjectDto,
  RemixVoiceResponseDto,
  SaveCustomVoiceResultDto,
  SpeakerGroupDto,
  TranscriptDto,
  TranscriptSegmentDto,
  UploadCreateResponse,
  VoiceCatalogResponse,
  ReplacementDto,
  VoiceClipDto,
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

  createProject: (body: {
    name: string;
    lead?: string;
    description?: string;
  }) =>
    requestJson<ProjectDto>("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  getProject: (id: string) => requestJson<ProjectDto>(`/projects/${id}`),

  patchProject: async (
    id: string,
    body: { name?: string; lead?: string; description?: string },
  ): Promise<ProjectDto> => {
    const base = getPublicApiBaseUrl();
    const url = `${base}/projects/${encodeURIComponent(id)}`;
    const init = {
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store" as RequestCache,
    };
    const attempts: (() => Promise<Response>)[] = [
      () => fetch(url, { method: "PATCH", ...init }),
      () => fetch(url, { method: "PUT", ...init }),
      () =>
        fetch(`${base}/projects/${encodeURIComponent(id)}/update`, {
          method: "POST",
          ...init,
        }),
    ];
    let lastStatus = 0;
    let lastText = "";
    for (const run of attempts) {
      const res = await run();
      lastText = await res.text();
      lastStatus = res.status;
      if (res.ok) {
        return (lastText ? JSON.parse(lastText) : null) as ProjectDto;
      }
      const projectMissing =
        res.status === 404 && lastText.includes("Project not found");
      const stop =
        projectMissing ||
        res.status === 422 ||
        res.status === 400 ||
        res.status === 403 ||
        res.status >= 500;
      if (stop) {
        throw new ApiError(`API ${res.status} for PATCH/PUT project`, res.status, lastText);
      }
    }
    throw new ApiError(`API ${lastStatus} for PATCH/PUT project`, lastStatus, lastText);
  },

  deleteProject: async (id: string): Promise<void> => {
    const base = getPublicApiBaseUrl();
    const url = `${base}/projects/${encodeURIComponent(id)}`;
    const postDeleteInit = {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store" as RequestCache,
    };
    /** POST /projects/delete/{id} first: path does not overlap GET /projects/{id}, so no 405 from route-order bugs. */
    const attempts: (() => Promise<Response>)[] = [
      () => fetch(`${base}/projects/delete/${encodeURIComponent(id)}`, postDeleteInit),
      () => fetch(`${base}/projects/${encodeURIComponent(id)}/delete`, postDeleteInit),
      () =>
        fetch(url, {
          method: "DELETE",
          headers: { Accept: "application/json" },
          cache: "no-store",
        }),
    ];
    let lastStatus = 0;
    let lastText = "";
    for (const run of attempts) {
      const res = await run();
      lastText = await res.text();
      lastStatus = res.status;
      if (res.ok) return;
      const projectMissing =
        res.status === 404 && lastText.includes("Project not found");
      const stop =
        projectMissing ||
        res.status === 422 ||
        res.status === 400 ||
        res.status === 403 ||
        res.status >= 500;
      if (stop) {
        throw new ApiError(`API ${res.status} for DELETE project`, res.status, lastText);
      }
    }
    throw new ApiError(`API ${lastStatus} for DELETE project`, lastStatus, lastText);
  },

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

  createCharacter: (
    projectId: string,
    body: { name: string; role?: string; wardrobe_notes?: string },
  ) =>
    requestJson<CharacterDto>(`/projects/${projectId}/characters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  uploadCharacterAvatar: (
    projectId: string,
    characterId: string,
    file: File,
  ): Promise<CharacterDto> => {
    const base = getPublicApiBaseUrl();
    const nested = `${base}/projects/${encodeURIComponent(projectId)}/characters/${encodeURIComponent(characterId)}/avatar`;
    const flat = `${base}/characters/${encodeURIComponent(characterId)}/avatar`;
    const post = (url: string) => {
      const fd = new FormData();
      fd.append("file", file, file.name);
      return fetch(url, {
        method: "POST",
        body: fd,
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
    };
    return (async () => {
      let res = await post(nested);
      if (res.status === 404) {
        res = await post(flat);
      }
      const text = await res.text();
      if (!res.ok) {
        throw new ApiError(`API ${res.status} for avatar`, res.status, text);
      }
      return JSON.parse(text) as CharacterDto;
    })();
  },

  getJob: (jobId: string) => requestJson<JobDto>(`/jobs/${jobId}`),

  getEpisodeTranscript: (episodeId: string) =>
    requestJson<TranscriptDto>(`/episodes/${episodeId}/transcript`),

  listEpisodeTranscriptSegments: (episodeId: string) =>
    requestJson<TranscriptSegmentDto[]>(`/episodes/${episodeId}/segments`),

  episodeTranscriptExportUrl: (
    episodeId: string,
    format: "txt" | "srt" | "vtt",
  ): string =>
    `${getPublicApiBaseUrl()}/episodes/${encodeURIComponent(episodeId)}/transcript/export.${format}`,

  segmentSourceAudioUrl: (episodeId: string, segmentId: string): string =>
    `${getPublicApiBaseUrl()}/episodes/${encodeURIComponent(episodeId)}/segments/${encodeURIComponent(segmentId)}/audio`,

  patchTranscriptSegmentText: (
    episodeId: string,
    segmentId: string,
    body: { text: string },
  ) =>
    requestJson<TranscriptSegmentDto>(
      `/episodes/${encodeURIComponent(episodeId)}/segments/${encodeURIComponent(segmentId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      },
    ),

  deleteTranscriptSegment: async (episodeId: string, segmentId: string): Promise<void> => {
    const res = await fetch(
      `${getPublicApiBaseUrl()}/episodes/${encodeURIComponent(episodeId)}/segments/${encodeURIComponent(segmentId)}`,
      { method: "DELETE", cache: "no-store" },
    );
    if (res.ok || res.status === 204) return;
    const text = await res.text();
    throw new ApiError(`API ${res.status} for DELETE segment`, res.status, text);
  },

  deleteEpisode: async (episodeId: string) => {
    const res = await fetch(
      `${getPublicApiBaseUrl()}/episodes/${encodeURIComponent(episodeId)}`,
      { method: "DELETE", cache: "no-store" },
    );
    if (res.ok) return;
    const text = await res.text();
    throw new ApiError(`API ${res.status} for DELETE episode`, res.status, text);
  },

  deleteCharacter: async (characterId: string) => {
    const res = await fetch(
      `${getPublicApiBaseUrl()}/characters/${encodeURIComponent(characterId)}`,
      { method: "DELETE", cache: "no-store" },
    );
    if (res.ok) return;
    const text = await res.text();
    throw new ApiError(`API ${res.status} for DELETE character`, res.status, text);
  },

  clearCharacterVoice: (characterId: string) =>
    requestJson<CharacterDto>(
      `/characters/${encodeURIComponent(characterId)}/clear-voice`,
      { method: "POST", headers: { Accept: "application/json" } },
    ),

  enableSourceMatchedVoice: (
    characterId: string,
    body: { rights_type: string; proof_note?: string },
  ) =>
    requestJson<CharacterDto>(
      `/characters/${encodeURIComponent(characterId)}/enable-source-voice`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      },
    ),

  setCharacterAvatarFromEpisodeThumb: (
    characterId: string,
    body: { episode_id: string; thumb_index: number },
  ) =>
    requestJson<CharacterDto>(
      `/characters/${encodeURIComponent(characterId)}/avatar-from-episode-thumb`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      },
    ),

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

  mergeSpeakerGroups: (
    episodeId: string,
    body: { from_label: string; into_label: string },
  ) =>
    requestJson<SpeakerGroupDto[]>(
      `/episodes/${episodeId}/speaker-groups/merge`,
      {
        method: "POST",
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
    body: Partial<
      Pick<
        CharacterDto,
        | "name"
        | "role"
        | "default_voice_id"
        | "is_narrator"
        | "voice_style_presets"
        | "traits"
        | "wardrobe_notes"
        | "continuity_rules"
        | "thumbnail_paths"
        | "voice_provider"
        | "voice_display_name"
        | "voice_source_type"
        | "voice_parent_id"
        | "voice_description_meta"
      >
    >,
  ) =>
    requestJson<CharacterDto>(`/characters/${characterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  generatePreview: (
    characterId: string,
    body: {
      text: string;
      voice_id?: string;
      style?: string;
      save_clip?: boolean;
      clip_title?: string;
    },
  ) =>
    requestJson<PreviewDto>(`/characters/${characterId}/generate-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  generateCharacterClips: (
    characterId: string,
    body: {
      mode: "multi_line" | "prompt";
      lines?: string[];
      prompt?: string;
      count?: number;
      style?: string;
      clip_label_prefix?: string;
      voice_id?: string;
    },
  ) =>
    requestJson<GenerateClipsResponseDto>(
      `/characters/${characterId}/generate-clips`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ),

  generateCharacterLines: (
    characterId: string,
    body: {
      prompt: string;
      count?: number;
    },
  ) =>
    requestJson<GenerateLinesResponseDto>(
      `/characters/${characterId}/generate-lines`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ),

  generateCharacterDraftLines: (
    characterId: string,
    body: {
      prompt: string;
      count?: number;
      style?: string;
    },
  ) =>
    requestJson<GenerateDraftLinesResponseDto>(
      `/characters/${characterId}/generate-draft-lines`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ),

  generateCharacterClipsFromLines: (
    characterId: string,
    body: {
      lines: Array<Pick<DraftLineDto, "text" | "tone_style">>;
      style?: string;
      clip_label_prefix?: string;
      voice_id?: string;
    },
  ) =>
    requestJson<GenerateClipsResponseDto>(
      `/characters/${characterId}/generate-clips-from-lines`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ),

  listCharacterClips: (characterId: string) =>
    requestJson<VoiceClipDto[]>(`/characters/${characterId}/clips`),

  listProjectClips: (projectId: string) =>
    requestJson<VoiceClipDto[]>(`/projects/${projectId}/clips`),

  listProjectReplacements: (projectId: string) =>
    requestJson<ReplacementDto[]>(`/projects/${projectId}/replacements`),

  patchVoiceClip: (clipId: string, body: { title?: string }) =>
    requestJson<VoiceClipDto>(`/clips/${encodeURIComponent(clipId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  deleteVoiceClip: async (clipId: string): Promise<void> => {
    const url = `${getPublicApiBaseUrl()}/clips/${encodeURIComponent(clipId)}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new ApiError(`API ${res.status} for DELETE clip`, res.status, text);
    }
  },

  characterClipsZipUrl: (characterId: string) =>
    `${getPublicApiBaseUrl()}/characters/${encodeURIComponent(characterId)}/clips/download-all`,

  projectClipsZipUrl: (projectId: string) =>
    `${getPublicApiBaseUrl()}/projects/${encodeURIComponent(projectId)}/clips/download-all`,

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
    body: {
      voice_id: string;
      provider?: string;
      display_name?: string;
      voice_source_type?: string;
    },
  ) =>
    requestJson<CharacterDto>(`/characters/${characterId}/voice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  designVoice: (body: {
    voice_description: string;
    preview_text: string;
    model_id?: string | null;
  }) =>
    requestJson<DesignVoiceResponseDto>("/voices/design", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  saveDesignedVoice: (body: {
    character_id: string;
    generated_voice_id: string;
    voice_name: string;
    voice_description: string;
  }) =>
    requestJson<SaveCustomVoiceResultDto>("/voices/design/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  remixVoice: (
    voiceId: string,
    body: { remix_prompt: string; preview_text: string },
  ) =>
    requestJson<RemixVoiceResponseDto>(
      `/voices/${encodeURIComponent(voiceId)}/remix`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ),

  saveRemixedVoice: (body: {
    character_id: string;
    generated_voice_id: string;
    voice_name: string;
    voice_description: string;
    parent_voice_id: string;
  }) =>
    requestJson<SaveCustomVoiceResultDto>("/voices/remix/save", {
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
