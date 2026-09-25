"use client";

import { useState, useEffect, useCallback, useRef } from "react";

import { type Project } from "@db/schema";

import { toast } from "sonner";

interface GitInspection {
  gitAvailable: boolean;
  folderExists: boolean;
  isDirectory: boolean;
  isGitRepo: boolean;
  remoteUrl: string | null;
  currentBranch: string | null;
  branches: string[];
  isTaskerInitialized: boolean;
  hasProjectToml: boolean;
  projectTomlBaseBranch: string | null;
  error?: string;
}

export function useRepositorySettings(project: Project, onProjectUpdate: (project: Project) => void) {
  const inspectionRevision = useRef(0);
  const invalidateInspection = useCallback(() => { inspectionRevision.current++; }, []);
  const [repoPathInput, setRepoPathInput] = useState(project.repositoryPath || "");
  const [inspection, setInspection] = useState<GitInspection | null>(null);
  const [selectedDefaultBranch, setSelectedDefaultBranch] = useState<string>(
    project.defaultBranch || "main",
  );
  const [isLoadingInspection, setIsLoadingInspection] = useState(
    Boolean(project.repositoryPath),
  );
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [isInitializingTasker, setIsInitializingTasker] = useState(false);
  const [isSavingPath, setIsSavingPath] = useState(false);
  // Load Git inspection whenever project.repositoryPath is available
  const fetchGitInspection = useCallback(
    (path?: string, signal?: AbortSignal) => {
      const revision = ++inspectionRevision.current;
      const url =
        path !== undefined
          ? `/api/projects/${project.id}/git?path=${encodeURIComponent(path)}`
          : `/api/projects/${project.id}/git`;
      return fetch(url, { signal })
        .then(async (res) => {
          if (!res.ok) {
            throw new Error("Failed to inspect repository.");
          }
          const data = await res.json();
          if (signal?.aborted || revision !== inspectionRevision.current) return;
          setInspection(data.inspection);
          if (data.effectiveDefaultBranch) {
            setSelectedDefaultBranch(data.effectiveDefaultBranch);
          }
        })
        .catch((err: unknown) => {
          if (signal?.aborted || revision !== inspectionRevision.current) return;
          console.error(err);
          toast.error("Error checking Git repository status.");
        })
        .finally(() => {
          if (!signal?.aborted && revision === inspectionRevision.current) setIsLoadingInspection(false);
        });
    },
    [project.id],
  );

  useEffect(() => {
    if (!project.repositoryPath) return;
    const controller = new AbortController();
    void fetchGitInspection(undefined, controller.signal);
    return () => { invalidateInspection(); controller.abort(); };
  }, [project.repositoryPath, fetchGitInspection, invalidateInspection]);

  // Handle Browse button
  const handleBrowseFolder = async () => {
    setIsBrowsing(true);
    try {
      const res = await fetch("/api/filesystem/browse", {
        method: "POST",
      });
      const data = await res.json();

      if (data.canceled) {
        setIsBrowsing(false);
        return;
      }

      if (data.error) {
        toast.error(data.error);
        setIsBrowsing(false);
        return;
      }

      if (data.path) {
        const selectedPath = data.path;
        setRepoPathInput(selectedPath);
        await saveRepositoryPath(selectedPath);
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to open local folder picker.");
    } finally {
      setIsBrowsing(false);
    }
  };

  // Save repository path in SQLite
  const saveRepositoryPath = async (newPath: string) => {
    setIsSavingPath(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repositoryPath: newPath.trim() || null,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to update repository path.");
      }

      const updatedProject = await res.json();
      setIsLoadingInspection(Boolean(updatedProject.repositoryPath));
      if (!updatedProject.repositoryPath) setInspection(null);
      onProjectUpdate(updatedProject);

      toast.success("Repository path updated.");
      // A changed path is inspected by the effect; a same-path save still
      // explicitly refreshes its Git status (e.g. selecting the folder again).
      if (
        updatedProject.repositoryPath &&
        updatedProject.repositoryPath === project.repositoryPath
      ) {
        await fetchGitInspection(updatedProject.repositoryPath);
      }
    } catch (err: unknown) {
      console.error(err);
      toast.error(
        err instanceof Error ? err.message : "Failed to save repository path.",
      );
    } finally {
      setIsSavingPath(false);
    }
  };

  // Handle changing base branch
  const handleBaseBranchChange = async (newBranch: string) => {
    setSelectedDefaultBranch(newBranch);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultBranch: newBranch,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to save base branch.");
      }

      const updatedProject = await res.json();
      onProjectUpdate(updatedProject);

      toast.success(`Base branch set to "${newBranch}".`);
    } catch (err) {
      console.error(err);
      toast.error("Failed to update base branch.");
    }
  };

  // Handle Initialize Tasker
  const handleInitializeTasker = async () => {
    if (!project.repositoryPath || !inspection?.isGitRepo) {
      toast.error("A valid Git repository is required.");
      return;
    }

    setIsInitializingTasker(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/init-tasker`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseBranch: selectedDefaultBranch,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to initialize Tasker.");
      }

      if (data.project) {
        onProjectUpdate(data.project);
      }
      if (data.inspection) {
        inspectionRevision.current++;
        setInspection(data.inspection);
        setIsLoadingInspection(false);
      }

      toast.success("Tasker initialized successfully in .tasker/");
    } catch (err: unknown) {
      console.error(err);
      toast.error(
        err instanceof Error ? err.message : "Failed to initialize Tasker.",
      );
    } finally {
      setIsInitializingTasker(false);
    }
  };

  const isRepoValid = Boolean(
    project.repositoryPath &&
    inspection?.folderExists &&
    inspection?.isGitRepo &&
    inspection?.gitAvailable,
  );

  const canInitializeTasker = Boolean(
    isRepoValid &&
    !inspection?.isTaskerInitialized &&
    !isInitializingTasker &&
    !isLoadingInspection,
  );

  // Determine branch options
  const branchOptions =
    inspection?.branches && inspection.branches.length > 0
      ? inspection.branches
      : selectedDefaultBranch
        ? [selectedDefaultBranch]
        : ["main"];

  return { repoPathInput, setRepoPathInput, inspection, selectedDefaultBranch, isLoadingInspection, isBrowsing, isInitializingTasker, isSavingPath, saveRepositoryPath, handleBrowseFolder, handleBaseBranchChange, handleInitializeTasker, canInitializeTasker, branchOptions };
}
export type RepositorySettings = ReturnType<typeof useRepositorySettings>;
