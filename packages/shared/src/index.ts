export * from "./types";

import dashboard from "./mocks/dashboard.json";
import projects from "./mocks/projects.json";
import characters from "./mocks/characters.json";
import voices from "./mocks/voices.json";
import uploadMatch from "./mocks/upload-match.json";
import sceneReplace from "./mocks/scene-replace.json";
import continuity from "./mocks/continuity.json";
import exportPresets from "./mocks/export.json";

import type {
  ActivityItem,
  CharacterCard,
  ContinuityIssue,
  DashboardStats,
  ExportPreset,
  MatchCandidate,
  ProjectRow,
  ScenePair,
  VoiceProfile,
} from "./types";

export const mockDashboard = dashboard as {
  stats: DashboardStats;
  activity: ActivityItem[];
};

export const mockProjects = projects as { projects: ProjectRow[] };

export const mockCharacters = characters as { characters: CharacterCard[] };

export const mockVoices = voices as { voices: VoiceProfile[] };

export const mockUploadMatch = uploadMatch as { candidates: MatchCandidate[] };

export const mockSceneReplace = sceneReplace as { pairs: ScenePair[] };

export const mockContinuity = continuity as { issues: ContinuityIssue[] };

export const mockExport = exportPresets as { presets: ExportPreset[] };
