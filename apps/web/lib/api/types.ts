export type ProjectDto = {
  id: string;
  name: string;
  status: string;
  scene_count: number;
  lead: string;
  updated_at: string;
  description?: string;
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
  thumbnail_paths?: string[];
  source_speaker_labels: string[];
  source_episode_id: string | null;
  segment_count: number;
  total_speaking_duration: number;
  sample_texts: string[];
  is_narrator: boolean;
  default_voice_id: string | null;
  voice_provider: string | null;
  voice_display_name: string | null;
  voice_style_presets: Record<string, unknown> | null;
  preview_audio_path: string | null;
  /** catalog | designed | remixed when set */
  voice_source_type?: string | null;
  voice_parent_id?: string | null;
  voice_description_meta?: string | null;
};

export type VoiceCatalogItem = {
  voice_id: string;
  display_name: string;
  description: string;
  category?: string | null;
  tags: string[];
  suggested_use: string;
};

export type VoiceCatalogSource = "elevenlabs" | "local_fallback";

export type VoiceCatalogResponse = {
  voices: VoiceCatalogItem[];
  source: VoiceCatalogSource;
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
  message: string | null;
};

export type VoiceDesignSource = "elevenlabs" | "fallback";

export type VoicePreviewCandidateDto = {
  generated_voice_id: string;
  label: string;
  preview_audio_url: string;
  duration_secs: number | null;
};

export type DesignVoiceResponseDto = {
  source: VoiceDesignSource;
  message: string | null;
  preview_text_used: string;
  candidates: VoicePreviewCandidateDto[];
};

export type RemixVoiceResponseDto = DesignVoiceResponseDto;

export type SaveCustomVoiceResultDto = {
  character_id: string;
  voice_id: string;
  voice_name: string;
  source_type: string;
  provider: string;
};

export type PreviewDto = {
  preview_id: string;
  character_id: string;
  audio_url: string;
  duration_ms: number;
  text: string;
  provider: string;
  clip_id?: string | null;
};

export type VoiceClipDto = {
  id: string;
  character_id: string;
  project_id: string;
  voice_id: string;
  voice_name: string;
  text: string;
  tone_style_hint: string;
  audio_url: string;
  title: string;
  created_at: string;
};

export type GenerateClipsResponseDto = {
  character_id: string;
  mode: "multi_line" | "prompt" | string;
  provider: string;
  generated_count: number;
  clips: Array<{
    clip_id: string;
    title: string;
    text: string;
    audio_url: string;
    tone_style_hint: string;
    created_at: string;
  }>;
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
  speaker_count?: number;
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

export type SpeakerGroupDto = {
  speaker_label: string;
  display_name: string;
  segment_count: number;
  total_speaking_duration: number;
  sample_texts: string[];
  is_narrator: boolean;
};

export type ReplacementDto = {
  replacement_id: string;
  episode_id: string;
  segment_id: string;
  character_id: string;
  character_name: string;
  selected_voice_id: string;
  selected_voice_name: string;
  original_text: string;
  replacement_text: string;
  tone_style: string | null;
  generated_audio_path: string;
  audio_url: string;
  provider_used: string;
  fallback_used: boolean;
  created_at: string;
  updated_at: string;
};
