"use client";

import { useState, useEffect, useCallback } from "react";

import { type Project } from "@db/schema";

import { toast } from "sonner";

import { DEFAULT_PROJECT_GIT_SETTINGS, type GitHubCliRuntimeStatus, type ProjectGitSettings } from "@/types/project-git";

export function usePublicationSettings(project: Project, enabled: boolean) {
  const [gitSettings, setGitSettings] = useState<ProjectGitSettings>(
    DEFAULT_PROJECT_GIT_SETTINGS,
  );
  const [gitRuntime, setGitRuntime] = useState<GitHubCliRuntimeStatus | null>(
    null,
  );
  const [isLoadingGitSettings, setIsLoadingGitSettings] = useState(
    true,
  );
  const [isSavingGitSettings, setIsSavingGitSettings] = useState(false);

  const fetchGitSettings = useCallback(
    (signal?: AbortSignal) => {
      return fetch(`/api/projects/${project.id}/git-integration`, { signal })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok)
            throw new Error(
              data.error || "Failed to load Git publication settings.",
            );
          if (signal?.aborted) return;
          setGitSettings(data.settings);
          setGitRuntime(data.runtime);
        })
        .catch((error: unknown) => {
          if (signal?.aborted) return;
          console.error(error);
          toast.error(
            error instanceof Error
              ? error.message
              : "Failed to load Git publication settings.",
          );
        })
        .finally(() => {
          if (!signal?.aborted) setIsLoadingGitSettings(false);
        });
    },
    [project.id],
  );

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void fetchGitSettings(controller.signal);
    return () => controller.abort();
  }, [enabled, fetchGitSettings]);

  const handleSaveGitSettings = async () => {
    setIsSavingGitSettings(true);
    try {
      const response = await fetch(
        `/api/projects/${project.id}/git-integration`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings: gitSettings }),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data.error || "Failed to save Git publication settings.",
        );
      setGitSettings(data.settings);
      setGitRuntime(data.runtime);
      toast.success("Git publication settings saved in .tasker/project.toml.");
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save Git publication settings.",
      );
    } finally {
      setIsSavingGitSettings(false);
    }
  };

  return { gitSettings, setGitSettings, gitRuntime, isLoadingGitSettings, isSavingGitSettings, handleSaveGitSettings };
}
export type PublicationSettings = ReturnType<typeof usePublicationSettings>;
