"use client";

import { useState, useEffect, useCallback } from "react";
import { type Project } from "@db/schema";
import {
  Frame,
  FrameHeader,
  FrameTitle,
  FrameDescription,
  FramePanel,
} from "@/components/reui/frame";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  FolderOpenIcon,
  GitBranchIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  Loader2Icon,
  GlobeIcon,
  SparklesIcon,
} from "lucide-react";

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

interface ProjectSettingsFormProps {
  project: Project;
  onProjectUpdate?: (updated: Project) => void;
}

export function ProjectSettingsForm({
  project: initialProject,
  onProjectUpdate,
}: ProjectSettingsFormProps) {
  const [project, setProject] = useState<Project>(initialProject);
  const [repoPathInput, setRepoPathInput] = useState(
    initialProject.repositoryPath || ""
  );
  const [inspection, setInspection] = useState<GitInspection | null>(null);
  const [selectedDefaultBranch, setSelectedDefaultBranch] = useState<string>(
    initialProject.defaultBranch || "main"
  );
  const [isLoadingInspection, setIsLoadingInspection] = useState(Boolean(initialProject.repositoryPath));
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [isInitializingTasker, setIsInitializingTasker] = useState(false);
  const [isSavingPath, setIsSavingPath] = useState(false);

  // Load Git inspection whenever project.repositoryPath is available
  const fetchGitInspection = useCallback((path?: string, signal?: AbortSignal) => {
    const url = path !== undefined
      ? `/api/projects/${project.id}/git?path=${encodeURIComponent(path)}`
      : `/api/projects/${project.id}/git`;
    return fetch(url, { signal }).then(async (res) => {
      if (!res.ok) {
        throw new Error("Failed to inspect repository.");
      }
      const data = await res.json();
      if (signal?.aborted) return;
      setInspection(data.inspection);
      if (data.effectiveDefaultBranch) {
        setSelectedDefaultBranch(data.effectiveDefaultBranch);
      }
    }).catch((err: unknown) => {
      if (signal?.aborted) return;
      console.error(err);
      toast.error("Error checking Git repository status.");
    }).finally(() => {
      if (!signal?.aborted) setIsLoadingInspection(false);
    });
  }, [project.id]);

  useEffect(() => {
    if (!project.repositoryPath) return;
    const controller = new AbortController();
    void fetchGitInspection(undefined, controller.signal);
    return () => controller.abort();
  }, [project.repositoryPath, fetchGitInspection]);

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
      setProject(updatedProject);
      if (onProjectUpdate) {
        onProjectUpdate(updatedProject);
      }

      toast.success("Repository path updated.");
      // A changed path is inspected by the effect; a same-path save still
      // explicitly refreshes its Git status (e.g. selecting the folder again).
      if (updatedProject.repositoryPath && updatedProject.repositoryPath === project.repositoryPath) {
        await fetchGitInspection(updatedProject.repositoryPath);
      }
    } catch (err: unknown) {
      console.error(err);
      toast.error(
        err instanceof Error ? err.message : "Failed to save repository path."
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
      setProject(updatedProject);
      if (onProjectUpdate) {
        onProjectUpdate(updatedProject);
      }

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
        setProject(data.project);
        if (onProjectUpdate) {
          onProjectUpdate(data.project);
        }
      }
      if (data.inspection) {
        setInspection(data.inspection);
      }

      toast.success("Tasker initialized successfully in .tasker/");
    } catch (err: unknown) {
      console.error(err);
      toast.error(
        err instanceof Error ? err.message : "Failed to initialize Tasker."
      );
    } finally {
      setIsInitializingTasker(false);
    }
  };

  const isRepoValid = Boolean(
    project.repositoryPath &&
      inspection?.folderExists &&
      inspection?.isGitRepo &&
      inspection?.gitAvailable
  );

  const canInitializeTasker = Boolean(
    isRepoValid &&
      !inspection?.isTaskerInitialized &&
      !isInitializingTasker &&
      !isLoadingInspection
  );

  // Determine branch options
  const branchOptions =
    inspection?.branches && inspection.branches.length > 0
      ? inspection.branches
      : selectedDefaultBranch
      ? [selectedDefaultBranch]
      : ["main"];

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col gap-6">
      {/* 1. General Section */}
      <Frame stacked spacing="sm" className="w-full">
        <FrameHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-0.5">
            <FrameTitle>General</FrameTitle>
            <FrameDescription>
              Project identity and general settings.
            </FrameDescription>
          </div>
        </FrameHeader>

        <FramePanel className="p-0">
          <dl className="flex flex-col">
            <div className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(10rem,0.95fr)_minmax(0,1.35fr)] sm:gap-5 items-center">
              <dt className="text-muted-foreground text-sm font-medium">
                Project name
              </dt>
              <dd className="text-foreground text-sm">
                <Input
                  value={project.name}
                  readOnly
                  className="max-w-md bg-muted/40 cursor-default"
                />
              </dd>
            </div>
          </dl>
        </FramePanel>
      </Frame>

      {/* 2. Repository Section */}
      <Frame stacked spacing="sm" className="w-full">
        <FrameHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-0.5">
            <FrameTitle>Repository</FrameTitle>
            <FrameDescription>
              Local Git repository path associated with this project.
            </FrameDescription>
          </div>
        </FrameHeader>

        <FramePanel className="p-0">
          <dl className="flex flex-col">
            <div className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(10rem,0.95fr)_minmax(0,1.35fr)] sm:gap-5 items-center">
              <dt className="text-muted-foreground text-sm font-medium">
                Local repository
              </dt>
              <dd className="flex flex-col gap-2">
                <div className="flex items-center gap-2 max-w-xl">
                  <Input
                    placeholder="e.g. C:\Users\...\my-project or /home/.../my-project"
                    value={repoPathInput}
                    onChange={(e) => setRepoPathInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        saveRepositoryPath(repoPathInput);
                      }
                    }}
                    className="font-mono text-xs flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBrowseFolder}
                    disabled={isBrowsing}
                    className="shrink-0 gap-1.5"
                  >
                    {isBrowsing ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      <FolderOpenIcon className="size-4" />
                    )}
                    Browse
                  </Button>
                  {repoPathInput.trim() !== (project.repositoryPath || "") && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => saveRepositoryPath(repoPathInput)}
                      disabled={isSavingPath}
                      className="shrink-0"
                    >
                      {isSavingPath ? (
                        <Loader2Icon className="size-3.5 animate-spin" />
                      ) : (
                        "Save"
                      )}
                    </Button>
                  )}
                </div>
                {!project.repositoryPath && (
                  <p className="text-xs text-muted-foreground">
                    Click <strong>Browse</strong> to select a folder from your
                    local filesystem.
                  </p>
                )}
              </dd>
            </div>
          </dl>
        </FramePanel>
      </Frame>

      {/* 3. Git Information Section */}
      <Frame stacked spacing="sm" className="w-full">
        <FrameHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-0.5">
            <FrameTitle>Git information</FrameTitle>
            <FrameDescription>
              Inspection of the local Git environment and branches.
            </FrameDescription>
          </div>
          {isLoadingInspection && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2Icon className="size-3.5 animate-spin" />
              Checking Git...
            </div>
          )}
        </FrameHeader>

        <FramePanel className="p-0">
          {!project.repositoryPath ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No repository selected yet. Select a folder above to detect Git
              information.
            </div>
          ) : (
            <dl className="flex flex-col">
              {/* Git repository detection status */}
              <div className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(10rem,0.95fr)_minmax(0,1.35fr)] sm:gap-5 items-center">
                <dt className="text-muted-foreground text-sm font-medium">
                  Git repository
                </dt>
                <dd className="text-foreground text-sm flex items-center gap-2">
                  {inspection?.isGitRepo ? (
                    <Badge variant="success-light" className="gap-1.5">
                      <CheckCircle2Icon className="size-3.5" />
                      Repository detected
                    </Badge>
                  ) : inspection?.error ? (
                    <Badge variant="destructive-light" className="gap-1.5">
                      <AlertCircleIcon className="size-3.5" />
                      {inspection.error}
                    </Badge>
                  ) : isLoadingInspection ? (
                    <span className="text-muted-foreground text-xs flex items-center gap-1">
                      <Loader2Icon className="size-3.5 animate-spin" />
                      Detecting...
                    </span>
                  ) : (
                    <Badge variant="warning-light" className="gap-1.5">
                      <AlertCircleIcon className="size-3.5" />
                      Not a Git repository
                    </Badge>
                  )}
                </dd>
              </div>

              <Separator />

              {/* Remote */}
              <div className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(10rem,0.95fr)_minmax(0,1.35fr)] sm:gap-5 items-center">
                <dt className="text-muted-foreground text-sm font-medium">
                  Remote
                </dt>
                <dd className="text-foreground text-sm flex items-center gap-1.5 min-w-0">
                  {inspection?.remoteUrl ? (
                    <span className="font-mono text-xs truncate flex items-center gap-1.5">
                      <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      {inspection.remoteUrl}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs italic">
                      No remote configured (local repository)
                    </span>
                  )}
                </dd>
              </div>

              <Separator />

              {/* Current branch */}
              <div className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(10rem,0.95fr)_minmax(0,1.35fr)] sm:gap-5 items-center">
                <dt className="text-muted-foreground text-sm font-medium">
                  Current branch
                </dt>
                <dd className="text-foreground text-sm flex items-center gap-2">
                  {inspection?.currentBranch ? (
                    <span className="font-mono font-medium text-xs flex items-center gap-1.5">
                      <GitBranchIcon className="size-3.5 text-muted-foreground" />
                      {inspection.currentBranch}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs">
                      No active branch detected
                    </span>
                  )}
                </dd>
              </div>

              <Separator />

              {/* Base branch dropdown */}
              <div className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(10rem,0.95fr)_minmax(0,1.35fr)] sm:gap-5 items-start sm:items-center">
                <dt className="text-muted-foreground text-sm font-medium">
                  Base branch
                </dt>
                <dd className="text-foreground text-sm flex flex-col gap-1.5">
                  {branchOptions.length > 0 ? (
                    <Select
                      value={selectedDefaultBranch}
                      onValueChange={(val) => {
                        if (val) handleBaseBranchChange(val);
                      }}
                    >
                      <SelectTrigger className="w-48 font-mono text-xs">
                        <SelectValue>{selectedDefaultBranch}</SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start" alignItemWithTrigger={false}>
                        <SelectGroup>
                          {branchOptions.map((branch) => (
                            <SelectItem
                              key={branch}
                              value={branch}
                              className="font-mono text-xs"
                            >
                              {branch}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-muted-foreground text-xs">
                      No branches found
                    </span>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Branch used as the starting point for new task worktrees.
                  </p>
                </dd>
              </div>
            </dl>
          )}
        </FramePanel>
      </Frame>

      {/* 4. Tasker Section */}
      <Frame stacked spacing="sm" className="w-full">
        <FrameHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-0.5">
            <FrameTitle>Tasker</FrameTitle>
            <FrameDescription>
              Portable repository configuration (.tasker/ directory).
            </FrameDescription>
          </div>
          {canInitializeTasker && (
            <Button
              type="button"
              onClick={handleInitializeTasker}
              disabled={isInitializingTasker}
              className="gap-1.5"
            >
              {isInitializingTasker ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <SparklesIcon className="size-4" />
              )}
              Initialize Tasker
            </Button>
          )}
        </FrameHeader>

        <FramePanel className="p-0">
          <dl className="flex flex-col">
            {/* Status row */}
            <div className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(10rem,0.95fr)_minmax(0,1.35fr)] sm:gap-5 items-center">
              <dt className="text-muted-foreground text-sm font-medium">
                Status
              </dt>
              <dd className="text-foreground text-sm flex items-center gap-2">
                {inspection?.isTaskerInitialized ? (
                  <Badge variant="success-light" className="gap-1.5">
                    <CheckCircle2Icon className="size-3.5" />
                    Initialized
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1.5 text-muted-foreground">
                    Not initialized
                  </Badge>
                )}
              </dd>
            </div>

            {/* Configuration directory row if initialized */}
            {inspection?.isTaskerInitialized && (
              <>
                <Separator />
                <div className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(10rem,0.95fr)_minmax(0,1.35fr)] sm:gap-5 items-center">
                  <dt className="text-muted-foreground text-sm font-medium">
                    Configuration
                  </dt>
                  <dd className="text-foreground text-sm font-mono text-xs flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-muted font-medium">
                      .tasker/
                    </span>
                    <span className="text-muted-foreground">
                      (project.toml, instructions.md, agents/, tasks/)
                    </span>
                  </dd>
                </div>
              </>
            )}
          </dl>
        </FramePanel>
      </Frame>
    </div>
  );
}
