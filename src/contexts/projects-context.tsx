"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

export interface ProjectItem {
  id: string;
  name: string;
  slug: string;
  repositoryPath: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProjectsContextType {
  projects: ProjectItem[];
  isLoading: boolean;
  error: string | null;
  refreshProjects: () => Promise<void>;
  createProject: (name: string) => Promise<ProjectItem>;
}

const ProjectsContext = createContext<ProjectsContextType | undefined>(undefined);

export function ProjectsProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProjects = useCallback((signal?: AbortSignal) => {
    return fetch("/api/projects", { signal }).then(async (res) => {
      if (!res.ok) {
        throw new Error("Failed to fetch projects");
      }
      const data = await res.json();
      if (signal?.aborted) return;
      setProjects(data);
    }).catch((err: unknown) => {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : "An error occurred");
    }).finally(() => {
      if (!signal?.aborted) setIsLoading(false);
    });
  }, []);

  const refreshProjects = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    await loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    const controller = new AbortController();
    void loadProjects(controller.signal);
    return () => controller.abort();
  }, [loadProjects]);

  const createProject = useCallback(
    async (name: string): Promise<ProjectItem> => {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: "Failed to create project" }));
        throw new Error(errData.error || "Failed to create project");
      }

      const newProj: ProjectItem = await res.json();
      setProjects((prev) => [newProj, ...prev.filter((p) => p.id !== newProj.id)]);
      return newProj;
    },
    []
  );

  return (
    <ProjectsContext.Provider
      value={{
        projects,
        isLoading,
        error,
        refreshProjects,
        createProject,
      }}
    >
      {children}
    </ProjectsContext.Provider>
  );
}

export function useProjects() {
  const context = useContext(ProjectsContext);
  if (!context) {
    throw new Error("useProjects must be used within a ProjectsProvider");
  }
  return context;
}
