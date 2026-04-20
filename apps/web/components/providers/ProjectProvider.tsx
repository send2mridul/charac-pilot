"use client";

import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import type { ProjectDto } from "@/lib/api/types";

const STORAGE_KEY = "characpilot.activeProjectId";

type Ctx = {
  projects: ProjectDto[];
  loading: boolean;
  error: ApiError | null;
  refresh: () => Promise<void>;
  activeProjectId: string | null;
  setActiveProjectId: (id: string) => void;
  activeProject: ProjectDto | null;
};

const ProjectContext = createContext<Ctx | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(
    null,
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listProjects();
      setProjects(list);
      setActiveProjectIdState((current) => {
        if (current && list.some((p) => p.id === current)) return current;
        const stored =
          typeof window !== "undefined"
            ? window.localStorage.getItem(STORAGE_KEY)
            : null;
        if (stored && list.some((p) => p.id === stored)) return stored;
        return list[0]?.id ?? null;
      });
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError("Request failed", 0, ""));
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setActiveProjectId = useCallback((id: string) => {
    setActiveProjectIdState(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  const value = useMemo(
    () => ({
      projects,
      loading,
      error,
      refresh,
      activeProjectId,
      setActiveProjectId,
      activeProject,
    }),
    [
      projects,
      loading,
      error,
      refresh,
      activeProjectId,
      setActiveProjectId,
      activeProject,
    ],
  );

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
}

export function useProjects() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProjects must be used within ProjectProvider");
  return ctx;
}
