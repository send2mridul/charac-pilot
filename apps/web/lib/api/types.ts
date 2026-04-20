export type ProjectDto = {
  id: string;
  name: string;
  status: string;
  scene_count: number;
  lead: string;
  updated_at: string;
};

export type EpisodeDto = {
  id: string;
  project_id: string;
  title: string;
  status: string;
  segment_count: number;
  updated_at: string;
};

export type CharacterDto = {
  id: string;
  project_id: string;
  name: string;
  role: string;
  traits: string[];
  wardrobe_notes: string;
  continuity_rules: string[];
};

export type JobDto = {
  id: string;
  type: string;
  status: string;
  progress: number;
  message: string;
  result: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type MatchCandidateDto = {
  id: string;
  label: string;
  confidence: number;
  source: string;
};

export type UploadCreateResponse = {
  job_id: string;
  episode_id: string;
  project_id: string;
  message: string;
};

/** Job result payload for episode_media (FFmpeg preprocess). */
export type EpisodeMediaJobResult = {
  episode_id: string;
  project_id: string;
  source_video_path: string;
  extracted_audio_path: string;
  thumbnail_paths: string[];
  duration_sec?: number;
  transcript_segment_count?: number;
  transcript_language?: string | null;
};

export type TranscriptSegmentDto = {
  segment_id: string;
  episode_id: string;
  start_time: number;
  end_time: number;
  text: string;
  speaker_label: string | null;
};

export type TranscriptDto = {
  episode_id: string;
  language: string | null;
  segments: TranscriptSegmentDto[];
};
