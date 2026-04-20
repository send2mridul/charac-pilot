export type JobStatus = "queued" | "running" | "done" | "failed";
export type Severity = "low" | "medium" | "high";

export interface DashboardStats {
  activeProjects: number;
  rendersQueued: number;
  continuityScore: number;
  lastExportLabel: string;
}

export interface ActivityItem {
  id: string;
  title: string;
  detail: string;
  time: string;
  kind: "render" | "upload" | "continuity" | "export";
}

export interface ProjectRow {
  id: string;
  name: string;
  updatedAt: string;
  status: JobStatus | "active" | "archived";
  scenes: number;
  lead: string;
}

export interface CharacterCard {
  id: string;
  name: string;
  role: string;
  traits: string[];
  wardrobeNotes: string;
  continuityRules: string[];
}

export interface VoiceProfile {
  id: string;
  name: string;
  language: string;
  style: string;
  lastSample: string;
  stability: number;
  clarity: number;
}

export interface MatchCandidate {
  id: string;
  label: string;
  confidence: number;
  source: string;
}

export interface ScenePair {
  id: string;
  shot: string;
  beforeThumb: string;
  afterThumb: string;
  note: string;
}

export interface ContinuityIssue {
  id: string;
  scene: string;
  timecode: string;
  severity: Severity;
  summary: string;
  suggestion: string;
}

export interface ExportPreset {
  id: string;
  label: string;
  format: string;
  resolution: string;
  eta: string;
  status: JobStatus;
}
