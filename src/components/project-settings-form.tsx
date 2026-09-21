"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
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
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useProjects } from "@/contexts/projects-context";
import {
  DEFAULT_PROJECT_EXECUTION_SETTINGS,
  PACKAGE_MANAGERS,
  type ProjectExecutionRuntimeStatus,
  type ProjectExecutionSettings,
  type ProjectLocalExecutionSettings,
} from "@/types/project-execution";
import {
  DEFAULT_PROJECT_GIT_SETTINGS,
  type GitHubCliRuntimeStatus,
  type ProjectGitSettings,
} from "@/types/project-git";
import {
  FolderOpenIcon,
  GitBranchIcon,
  KeyRoundIcon,
  Loader2Icon,
  PlusIcon,
  GlobeIcon,
  SparklesIcon,
  TerminalSquareIcon,
  GitPullRequestDraftIcon,
  Trash2Icon,
  XIcon,
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

interface EnvironmentVariableDraft {
  id: string;
  name: string;
  value: string;
  configured: boolean;
}

export function ProjectSettingsForm({
  project: initialProject,
  onProjectUpdate,
}: ProjectSettingsFormProps) {
  const router = useRouter();
  const { deleteProject } = useProjects();
  const [project, setProject] = useState<Project>(initialProject);
  const [repoPathInput, setRepoPathInput] = useState(
    initialProject.repositoryPath || "",
  );
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDeleteProject = async () => {
    if (isDeletingProject) return;
    setIsDeletingProject(true);
    setDeleteError(null);
    try {
      await deleteProject(project.id);
      setIsDeleteDialogOpen(false);
      toast.success(`Projet « ${project.name} » supprimé.`);
      router.replace("/");
    } catch (err) {
      console.error(err);
      const message =
        err instanceof Error
          ? err.message
          : "Impossible de supprimer le projet.";
      setDeleteError(message);
      toast.error(message);
    } finally {
      setIsDeletingProject(false);
    }
  };
  const [inspection, setInspection] = useState<GitInspection | null>(null);
  const [selectedDefaultBranch, setSelectedDefaultBranch] = useState<string>(
    initialProject.defaultBranch || "main",
  );
  const [isLoadingInspection, setIsLoadingInspection] = useState(
    Boolean(initialProject.repositoryPath),
  );
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [isInitializingTasker, setIsInitializingTasker] = useState(false);
  const [isSavingPath, setIsSavingPath] = useState(false);
  const [executionSettings, setExecutionSettings] =
    useState<ProjectExecutionSettings>(DEFAULT_PROJECT_EXECUTION_SETTINGS);
  const [validationScripts, setValidationScripts] = useState("");
  const [pythonMinVersion, setPythonMinVersion] = useState("");
  const [pythonRuntimeMode, setPythonRuntimeMode] = useState<
    "auto" | "explicit"
  >("auto");
  const [localPythonExecutable, setLocalPythonExecutable] = useState("");
  const [environmentVariables, setEnvironmentVariables] = useState<
    EnvironmentVariableDraft[]
  >([]);
  const [isBrowsingPython, setIsBrowsingPython] = useState(false);
  const [executionRuntime, setExecutionRuntime] =
    useState<ProjectExecutionRuntimeStatus | null>(null);
  const [isLoadingExecution, setIsLoadingExecution] = useState(
    Boolean(initialProject.repositoryPath),
  );
  const [isSavingExecution, setIsSavingExecution] = useState(false);
  const [gitSettings, setGitSettings] = useState<ProjectGitSettings>(
    DEFAULT_PROJECT_GIT_SETTINGS,
  );
  const [gitRuntime, setGitRuntime] = useState<GitHubCliRuntimeStatus | null>(
    null,
  );
  const [isLoadingGitSettings, setIsLoadingGitSettings] = useState(
    Boolean(initialProject.repositoryPath),
  );
  const [isSavingGitSettings, setIsSavingGitSettings] = useState(false);

  // Load Git inspection whenever project.repositoryPath is available
  const fetchGitInspection = useCallback(
    (path?: string, signal?: AbortSignal) => {
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
          if (signal?.aborted) return;
          setInspection(data.inspection);
          if (data.effectiveDefaultBranch) {
            setSelectedDefaultBranch(data.effectiveDefaultBranch);
          }
        })
        .catch((err: unknown) => {
          if (signal?.aborted) return;
          console.error(err);
          toast.error("Error checking Git repository status.");
        })
        .finally(() => {
          if (!signal?.aborted) setIsLoadingInspection(false);
        });
    },
    [project.id],
  );

  useEffect(() => {
    if (!project.repositoryPath) return;
    const controller = new AbortController();
    void fetchGitInspection(undefined, controller.signal);
    return () => controller.abort();
  }, [project.repositoryPath, fetchGitInspection]);

  const fetchExecutionSettings = useCallback(
    (signal?: AbortSignal) => {
      return fetch(`/api/projects/${project.id}/execution`, { signal })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok)
            throw new Error(data.error || "Failed to load execution settings.");
          if (signal?.aborted) return;
          setExecutionSettings(data.settings);
          setValidationScripts(data.settings.validationScripts.join("\n"));
          setPythonMinVersion(data.settings.pythonMinVersion ?? "");
          const localRuntime = data.localRuntime as
            | ProjectLocalExecutionSettings
            | undefined;
          setLocalPythonExecutable(localRuntime?.pythonExecutable ?? "");
          setPythonRuntimeMode(
            localRuntime?.pythonExecutable ? "explicit" : "auto",
          );
          setEnvironmentVariables(
            (localRuntime?.environmentVariables ?? []).map((entry) => ({
              id: crypto.randomUUID(),
              name: entry.name,
              value: "",
              configured: entry.configured,
            })),
          );
          setExecutionRuntime(data.runtime);
        })
        .catch((error: unknown) => {
          if (signal?.aborted) return;
          console.error(error);
          toast.error(
            error instanceof Error
              ? error.message
              : "Failed to load execution settings.",
          );
        })
        .finally(() => {
          if (!signal?.aborted) setIsLoadingExecution(false);
        });
    },
    [project.id],
  );

  useEffect(() => {
    if (!inspection?.isTaskerInitialized) return;
    const controller = new AbortController();
    void fetchExecutionSettings(controller.signal);
    return () => controller.abort();
  }, [inspection?.isTaskerInitialized, fetchExecutionSettings]);

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
    if (!inspection?.isTaskerInitialized) return;
    const controller = new AbortController();
    void fetchGitSettings(controller.signal);
    return () => controller.abort();
  }, [inspection?.isTaskerInitialized, fetchGitSettings]);

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
        err instanceof Error ? err.message : "Failed to initialize Tasker.",
      );
    } finally {
      setIsInitializingTasker(false);
    }
  };

  const handleSaveExecution = async () => {
    const scripts = validationScripts
      .split(/[\n,]/)
      .map((script) => script.trim())
      .filter(Boolean);
    setIsSavingExecution(true);
    try {
      const response = await fetch(`/api/projects/${project.id}/execution`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            ...executionSettings,
            pythonMinVersion: pythonMinVersion.trim() || null,
            validationScripts: scripts,
          },
          localRuntime: {
            pythonExecutable:
              pythonRuntimeMode === "explicit"
                ? localPythonExecutable.trim() || null
                : null,
            environmentVariables: environmentVariables.map((entry) => ({
              name: entry.name,
              ...(!entry.configured || entry.value !== ""
                ? { value: entry.value }
                : {}),
            })),
          },
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Failed to save execution settings.");
      setExecutionSettings(data.settings);
      setValidationScripts(data.settings.validationScripts.join("\n"));
      setPythonMinVersion(data.settings.pythonMinVersion ?? "");
      setLocalPythonExecutable(data.localRuntime?.pythonExecutable ?? "");
      setPythonRuntimeMode(
        data.localRuntime?.pythonExecutable ? "explicit" : "auto",
      );
      setEnvironmentVariables(
        (data.localRuntime?.environmentVariables ?? []).map(
          (entry: { name: string; configured: true }) => ({
            id: crypto.randomUUID(),
            name: entry.name,
            value: "",
            configured: entry.configured,
          }),
        ),
      );
      setExecutionRuntime(data.runtime);
      if (
        (pythonRuntimeMode === "explicit" ||
          Boolean(pythonMinVersion.trim())) &&
        data.runtime?.python?.sandbox?.checked &&
        !data.runtime.python.sandbox.available
      ) {
        toast.warning(
          "Settings saved, but Python is not executable inside the Codex sandbox.",
        );
      } else {
        toast.success(
          "Execution settings, local runtime, and environment variables saved.",
        );
      }
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save execution settings.",
      );
    } finally {
      setIsSavingExecution(false);
    }
  };

  const handleBrowsePython = async () => {
    setIsBrowsingPython(true);
    try {
      const response = await fetch("/api/filesystem/browse-python", {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok || data.error)
        throw new Error(data.error || "Failed to select Python.");
      if (!data.canceled && data.path) {
        setPythonRuntimeMode("explicit");
        setLocalPythonExecutable(data.path);
        setExecutionRuntime(null);
      }
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Failed to select Python.",
      );
    } finally {
      setIsBrowsingPython(false);
    }
  };

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

      {/* 3. Tasker Section */}
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
            <div className="grid items-center gap-1 px-4 py-3 sm:grid-cols-[minmax(10rem,0.95fr)_minmax(0,1.35fr)] sm:gap-5">
              <dt className="text-sm font-medium text-muted-foreground">
                Status
              </dt>
              <dd className="flex items-center gap-2 text-sm text-foreground">
                {inspection?.isTaskerInitialized ? (
                  <Badge tone="success" variant="dot-outline">
                    Initialized
                  </Badge>
                ) : (
                  <Badge tone="outline">Not initialized</Badge>
                )}
              </dd>
            </div>

            {inspection?.isTaskerInitialized && (
              <>
                <Separator />
                <div className="grid items-center gap-1 px-4 py-3 sm:grid-cols-[minmax(10rem,0.95fr)_minmax(0,1.35fr)] sm:gap-5">
                  <dt className="text-sm font-medium text-muted-foreground">
                    Configuration
                  </dt>
                  <dd className="flex items-center gap-2 font-mono text-xs text-foreground">
                    <span className="rounded bg-muted px-2 py-0.5 font-medium">
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

      {/* 4. Git Information Section */}
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
                    <Badge tone="success" variant="dot-outline">
                      Repository detected
                    </Badge>
                  ) : inspection?.error ? (
                    <Badge tone="destructive" variant="dot-outline">
                      {inspection.error}
                    </Badge>
                  ) : isLoadingInspection ? (
                    <span className="text-muted-foreground text-xs flex items-center gap-1">
                      <Loader2Icon className="size-3.5 animate-spin" />
                      Detecting...
                    </span>
                  ) : (
                    <Badge tone="warning" variant="dot-outline">
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

      {/* 5. Execution settings */}
      <Frame stacked spacing="sm" className="w-full">
        <FrameHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-0.5">
            <FrameTitle>Execution settings</FrameTitle>
            <FrameDescription>
              Runtime, secrets, validation scripts, and advanced Run behavior.
            </FrameDescription>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={handleSaveExecution}
            disabled={
              !inspection?.isTaskerInitialized ||
              isLoadingExecution ||
              isSavingExecution
            }
            className="shrink-0 gap-1.5"
          >
            {isSavingExecution ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <TerminalSquareIcon className="size-4" />
            )}
            Save execution
          </Button>
        </FrameHeader>

        <FramePanel className="p-0">
          {!inspection?.isTaskerInitialized ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Initialize Tasker before configuring Project execution.
            </div>
          ) : isLoadingExecution ? (
            <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" /> Loading execution
              settings...
            </div>
          ) : (
            <Tabs defaultValue="runtime" className="gap-0">
              <div className="border-b border-border/60 bg-muted/25 px-3 pt-2">
                <TabsList
                  variant="line"
                  className="h-auto max-w-full flex-wrap justify-start gap-1"
                  aria-label="Execution settings sections"
                >
                  <TabsTrigger
                    value="runtime"
                    className="flex-none px-3 py-2 text-xs"
                  >
                    Packages &amp; Python
                  </TabsTrigger>
                  <TabsTrigger
                    value="environment"
                    className="flex-none px-3 py-2 text-xs"
                  >
                    Environment variables
                  </TabsTrigger>
                  <TabsTrigger
                    value="scripts"
                    className="flex-none px-3 py-2 text-xs"
                  >
                    Scripts
                  </TabsTrigger>
                  <TabsTrigger
                    value="advanced"
                    className="flex-none px-3 py-2 text-xs"
                  >
                    Advanced
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="runtime" className="m-0">
                <dl className="flex flex-col">
                  <div className="grid gap-2 px-4 py-4 sm:grid-cols-[minmax(10rem,0.95fr)_minmax(0,1.35fr)] sm:items-center sm:gap-5">
                    <dt className="text-sm font-medium text-muted-foreground">
                      Package manager
                    </dt>
                    <dd className="flex flex-col gap-1.5">
                      <Select
                        value={executionSettings.packageManager}
                        onValueChange={(value) => {
                          if (!value) return;
                          setExecutionRuntime(null);
                          setExecutionSettings((current) => ({
                            ...current,
                            packageManager:
                              value as ProjectExecutionSettings["packageManager"],
                          }));
                        }}
                      >
                        <SelectTrigger className="w-48 font-mono text-xs">
                          <SelectValue>
                            {executionSettings.packageManager}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent
                          align="start"
                          alignItemWithTrigger={false}
                        >
                          <SelectGroup>
                            {PACKAGE_MANAGERS.map((manager) => (
                              <SelectItem
                                key={manager}
                                value={manager}
                                className="font-mono text-xs"
                              >
                                {manager}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Choose the manager matching the repository lockfile.
                      </p>
                    </dd>
                  </div>

                  <Separator />

                  <div className="grid gap-2 px-4 py-4 sm:grid-cols-[minmax(10rem,0.95fr)_minmax(0,1.35fr)] sm:items-start sm:gap-5">
                    <dt className="text-sm font-medium text-muted-foreground">
                      Python runtime
                    </dt>
                    <dd className="flex max-w-lg flex-col gap-3">
                      <Input
                        value={pythonMinVersion}
                        onChange={(event) =>
                          setPythonMinVersion(event.target.value)
                        }
                        placeholder="Optional minimum, e.g. 3.11"
                        className="font-mono text-xs"
                        inputMode="decimal"
                      />
                      <p className="text-xs text-muted-foreground">
                        Portable minimum stored in .tasker/project.toml. Leave
                        empty when Python is optional.
                      </p>
                      <div className="flex flex-col gap-2 rounded-md border border-border/60 p-3">
                        <Select
                          value={pythonRuntimeMode}
                          onValueChange={(value) => {
                            if (value !== "auto" && value !== "explicit")
                              return;
                            setPythonRuntimeMode(value);
                            setExecutionRuntime(null);
                          }}
                        >
                          <SelectTrigger className="w-56 text-xs">
                            <SelectValue>
                              {pythonRuntimeMode === "auto"
                                ? "Auto-detect (recommended)"
                                : "Specific local interpreter"}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent
                            align="start"
                            alignItemWithTrigger={false}
                          >
                            <SelectItem value="auto">
                              Auto-detect (recommended)
                            </SelectItem>
                            <SelectItem value="explicit">
                              Specific local interpreter
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        {pythonRuntimeMode === "explicit" && (
                          <div className="flex gap-2">
                            <Input
                              value={localPythonExecutable}
                              onChange={(event) => {
                                setLocalPythonExecutable(event.target.value);
                                setExecutionRuntime(null);
                              }}
                              placeholder="C:\\...\\python.exe"
                              className="min-w-0 font-mono text-xs"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              onClick={handleBrowsePython}
                              disabled={isBrowsingPython}
                              className="shrink-0 gap-1.5"
                            >
                              {isBrowsingPython ? (
                                <Loader2Icon className="size-4 animate-spin" />
                              ) : (
                                <FolderOpenIcon className="size-4" />
                              )}
                              Browse
                            </Button>
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground">
                          The selected path is machine-local SQLite state. It is
                          never written to the repository.
                        </p>
                      </div>
                    </dd>
                  </div>

                  <Separator />

                  <div className="grid gap-2 px-4 py-4 sm:grid-cols-[minmax(10rem,0.95fr)_minmax(0,1.35fr)] sm:items-start sm:gap-5">
                    <dt className="text-sm font-medium text-muted-foreground">
                      Runtime preflight
                    </dt>
                    <dd className="flex flex-col gap-2 text-xs">
                      {(["node", "packageManager", "python"] as const).map(
                        (key) => {
                          const status = executionRuntime?.[key];
                          const pythonCandidates =
                            key === "python"
                              ? (executionRuntime?.python.candidates ?? [])
                              : [];
                          const label =
                            key === "node"
                              ? "Node.js"
                              : key === "python"
                                ? executionSettings.pythonMinVersion
                                  ? `Python ${executionSettings.pythonMinVersion}+`
                                  : "Python (optional)"
                                : executionSettings.packageManager;
                          return (
                            <div
                              key={key}
                              className="flex min-w-0 flex-col gap-1"
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <Badge
                                  tone={
                                    status == null
                                      ? "outline"
                                      : status.available
                                        ? "success"
                                        : "destructive"
                                  }
                                  variant="dot-outline"
                                >
                                  {status == null
                                    ? "Not checked"
                                    : status.available
                                      ? "Available"
                                      : "Unavailable"}
                                </Badge>
                                <span className="font-medium">{label}</span>
                                <span
                                  className="truncate font-mono text-muted-foreground"
                                  title={
                                    status?.executable ||
                                    status?.detail ||
                                    undefined
                                  }
                                >
                                  {status?.detail ||
                                    status?.executable ||
                                    "Save to refresh this check"}
                                </span>
                              </div>
                              {pythonCandidates.map((candidate) => (
                                <span
                                  key={`${candidate.command}-${candidate.executable}`}
                                  className="pl-20 font-mono text-muted-foreground"
                                >
                                  {candidate.command}: Python{" "}
                                  {candidate.version} — {candidate.executable}
                                </span>
                              ))}
                              {key === "python" &&
                                executionRuntime?.python.sandbox.checked && (
                                  <span
                                    className={`pl-20 text-xs ${executionRuntime.python.sandbox.available ? "text-muted-foreground" : "text-destructive"}`}
                                  >
                                    Sandbox:{" "}
                                    {executionRuntime.python.sandbox.detail}
                                  </span>
                                )}
                            </div>
                          );
                        },
                      )}
                    </dd>
                  </div>
                </dl>
              </TabsContent>

              <TabsContent value="environment" className="m-0">
                <div className="flex max-w-3xl flex-col gap-4 p-4 sm:p-5">
                  <div className="flex items-start gap-2 rounded-md border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-muted-foreground">
                    <KeyRoundIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
                    <p>
                      Local values injected into Codex, dependency installation,
                      and validations. Values are encrypted at rest, never
                      written to the worktree, and never returned after saving.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    {environmentVariables.length === 0 && (
                      <div className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
                        No local environment variables configured.
                      </div>
                    )}
                    {environmentVariables.map((entry) => (
                      <div
                        key={entry.id}
                        className="grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto]"
                      >
                        <Input
                          value={entry.name}
                          onChange={(event) =>
                            setEnvironmentVariables((current) =>
                              current.map((candidate) =>
                                candidate.id === entry.id
                                  ? {
                                      ...candidate,
                                      name: event.target.value,
                                      configured:
                                        candidate.name.toUpperCase() ===
                                          event.target.value.toUpperCase() &&
                                        candidate.configured,
                                    }
                                  : candidate,
                              ),
                            )
                          }
                          placeholder="SERPAPI_API_KEY"
                          aria-label="Environment variable name"
                          className="font-mono text-xs"
                        />
                        <Input
                          type="password"
                          value={entry.value}
                          onChange={(event) =>
                            setEnvironmentVariables((current) =>
                              current.map((candidate) =>
                                candidate.id === entry.id
                                  ? { ...candidate, value: event.target.value }
                                  : candidate,
                              ),
                            )
                          }
                          placeholder={
                            entry.configured
                              ? "Saved — leave blank to keep"
                              : "Value"
                          }
                          aria-label={`Value for ${entry.name || "environment variable"}`}
                          autoComplete="new-password"
                          className="font-mono text-xs"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setEnvironmentVariables((current) =>
                              current.filter(
                                (candidate) => candidate.id !== entry.id,
                              ),
                            )
                          }
                          aria-label={`Remove ${entry.name || "environment variable"}`}
                        >
                          <XIcon className="size-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-fit gap-1.5"
                    onClick={() =>
                      setEnvironmentVariables((current) => [
                        ...current,
                        {
                          id: crypto.randomUUID(),
                          name: "",
                          value: "",
                          configured: false,
                        },
                      ])
                    }
                  >
                    <PlusIcon className="size-4" /> Add variable
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Removing a row deletes that local value when you save.
                    Variable names are recorded in Run diagnostics; direct
                    values are redacted.
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="scripts" className="m-0">
                <dl className="flex flex-col">
                  <div className="grid gap-2 px-4 py-4 sm:grid-cols-[minmax(10rem,0.95fr)_minmax(0,1.35fr)] sm:items-center sm:gap-5">
                    <dt className="text-sm font-medium text-muted-foreground">
                      Install dependencies
                    </dt>
                    <dd className="flex flex-col gap-1.5">
                      <Select
                        value={
                          executionSettings.installDependencies
                            ? "enabled"
                            : "disabled"
                        }
                        onValueChange={(value) =>
                          value &&
                          setExecutionSettings((current) => ({
                            ...current,
                            installDependencies: value === "enabled",
                          }))
                        }
                      >
                        <SelectTrigger className="w-48 text-xs">
                          <SelectValue>
                            {executionSettings.installDependencies
                              ? "Enabled"
                              : "Disabled"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent
                          align="start"
                          alignItemWithTrigger={false}
                        >
                          <SelectItem value="enabled">Enabled</SelectItem>
                          <SelectItem value="disabled">Disabled</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Runs lifecycle scripts and may use the network. Enable
                        only for repositories you trust.
                      </p>
                    </dd>
                  </div>

                  <Separator />

                  <div className="grid gap-2 px-4 py-4 sm:grid-cols-[minmax(10rem,0.95fr)_minmax(0,1.35fr)] sm:items-start sm:gap-5">
                    <dt className="text-sm font-medium text-muted-foreground">
                      Validation scripts
                    </dt>
                    <dd className="flex flex-col gap-1.5">
                      <Textarea
                        value={validationScripts}
                        onChange={(event) =>
                          setValidationScripts(event.target.value)
                        }
                        placeholder={"lint\nbuild"}
                        className="min-h-24 max-w-md font-mono text-xs"
                      />
                      <p className="text-xs text-muted-foreground">
                        One package.json script per line. All scripts must pass
                        before AgentTasker commits.
                      </p>
                    </dd>
                  </div>

                  <Separator />

                  <div className="grid gap-2 px-4 py-4 sm:grid-cols-[minmax(10rem,0.95fr)_minmax(0,1.35fr)] sm:items-start sm:gap-5">
                    <dt className="text-sm font-medium text-muted-foreground">
                      Resolved commands
                    </dt>
                    <dd className="flex flex-col gap-1 font-mono text-xs">
                      <span>
                        {executionSettings.installDependencies
                          ? (
                              {
                                npm: "npm ci",
                                pnpm: "pnpm install --frozen-lockfile",
                                yarn: "yarn install --immutable",
                                bun: "bun install --frozen-lockfile",
                              } as const
                            )[executionSettings.packageManager]
                          : "Dependency installation disabled"}
                      </span>
                      {validationScripts
                        .split(/[\n,]/)
                        .map((script) => script.trim())
                        .filter(Boolean)
                        .map((script) => (
                          <span key={script}>
                            {executionSettings.packageManager} run {script}
                          </span>
                        ))}
                    </dd>
                  </div>
                </dl>
              </TabsContent>

              <TabsContent value="advanced" className="m-0">
                <div className="flex flex-col">
                  <dl className="flex flex-col">
                    <div className="grid gap-2 px-4 py-4 sm:grid-cols-[minmax(10rem,0.95fr)_minmax(0,1.35fr)] sm:items-start sm:gap-5">
                      <dt className="text-sm font-medium text-muted-foreground">
                        Timeouts
                      </dt>
                      <dd className="grid max-w-md gap-3 sm:grid-cols-3">
                        {(
                          [
                            ["Run", "defaultTimeoutMinutes"],
                            ["Install", "installTimeoutMinutes"],
                            ["Validation", "validationTimeoutMinutes"],
                          ] as const
                        ).map(([label, key]) => (
                          <label
                            key={key}
                            className="flex flex-col gap-1 text-xs text-muted-foreground"
                          >
                            {label} (minutes)
                            <Input
                              type="number"
                              min={1}
                              max={key === "defaultTimeoutMinutes" ? 1440 : 120}
                              value={executionSettings[key]}
                              onChange={(event) =>
                                setExecutionSettings((current) => ({
                                  ...current,
                                  [key]: Number(event.target.value),
                                }))
                              }
                              className="font-mono text-xs"
                            />
                          </label>
                        ))}
                      </dd>
                    </div>
                  </dl>

                  <Separator />

                  <div className="flex flex-col gap-3 bg-muted/15 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold">Git publication</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Push verified Run branches and optionally open GitHub
                        pull requests.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleSaveGitSettings}
                      disabled={isLoadingGitSettings || isSavingGitSettings}
                      className="shrink-0 gap-1.5"
                    >
                      {isSavingGitSettings ? (
                        <Loader2Icon className="size-4 animate-spin" />
                      ) : (
                        <GitPullRequestDraftIcon className="size-4" />
                      )}
                      Save publication
                    </Button>
                  </div>

                  {isLoadingGitSettings ? (
                    <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                      <Loader2Icon className="size-4 animate-spin" /> Loading
                      publication settings...
                    </div>
                  ) : (
                    <dl className="flex flex-col">
                      <div className="grid gap-2 px-4 py-4 sm:grid-cols-[minmax(10rem,0.95fr)_minmax(0,1.35fr)] sm:items-center sm:gap-5">
                        <dt className="text-sm font-medium text-muted-foreground">
                          Remote name
                        </dt>
                        <dd className="flex max-w-md flex-col gap-1.5">
                          <Input
                            value={gitSettings.remote}
                            onChange={(event) =>
                              setGitSettings((current) => ({
                                ...current,
                                remote: event.target.value,
                              }))
                            }
                            className="font-mono text-xs"
                          />
                          <p className="text-xs text-muted-foreground">
                            The configured remote is used both as the fresh Run
                            base and the push target.
                          </p>
                        </dd>
                      </div>

                      <Separator />

                      <div className="grid gap-2 px-4 py-4 sm:grid-cols-[minmax(10rem,0.95fr)_minmax(0,1.35fr)] sm:items-start sm:gap-5">
                        <dt className="text-sm font-medium text-muted-foreground">
                          Branch publication
                        </dt>
                        <dd className="flex max-w-md flex-col gap-3">
                          <label className="flex items-start gap-3 text-sm">
                            <input
                              type="checkbox"
                              className="mt-1 accent-primary"
                              checked={gitSettings.push}
                              onChange={(event) =>
                                setGitSettings((current) => ({
                                  ...current,
                                  push: event.target.checked,
                                  createPullRequest: event.target.checked
                                    ? current.createPullRequest
                                    : false,
                                }))
                              }
                            />
                            <span>
                              Push successful Run branches
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                The runner verifies that every remote
                                publication branch exactly matches its selected
                                Run commit.
                              </span>
                            </span>
                          </label>
                          <label className="flex items-start gap-3 text-sm">
                            <input
                              type="checkbox"
                              className="mt-1 accent-primary"
                              checked={gitSettings.createPullRequest}
                              onChange={(event) =>
                                setGitSettings((current) => ({
                                  ...current,
                                  push: event.target.checked
                                    ? true
                                    : current.push,
                                  createPullRequest: event.target.checked,
                                }))
                              }
                            />
                            <span>
                              Create a GitHub pull request
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                Requires GitHub CLI authentication. Each
                                Sequence chooses one final PR or stacked PRs
                                after its committed steps.
                              </span>
                            </span>
                          </label>
                          <label className="flex items-start gap-3 text-sm">
                            <input
                              type="checkbox"
                              className="mt-1 accent-primary"
                              checked={gitSettings.pullRequestDraft}
                              disabled={!gitSettings.createPullRequest}
                              onChange={(event) =>
                                setGitSettings((current) => ({
                                  ...current,
                                  pullRequestDraft: event.target.checked,
                                }))
                              }
                            />
                            <span>
                              Create as draft
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                Keeps human review mandatory before merge.
                              </span>
                            </span>
                          </label>
                        </dd>
                      </div>

                      <Separator />

                      <div className="grid gap-2 px-4 py-4 sm:grid-cols-[minmax(10rem,0.95fr)_minmax(0,1.35fr)] sm:items-center sm:gap-5">
                        <dt className="text-sm font-medium text-muted-foreground">
                          GitHub CLI
                        </dt>
                        <dd className="flex min-w-0 items-center gap-2 text-xs">
                          <Badge
                            tone={
                              gitRuntime?.authenticated
                                ? "success"
                                : gitRuntime?.available
                                  ? "warning"
                                  : "destructive"
                            }
                            variant="dot-outline"
                          >
                            {gitRuntime?.authenticated
                              ? "Authenticated"
                              : gitRuntime?.available
                                ? "Authentication required"
                                : "Unavailable"}
                          </Badge>
                          <span
                            className="truncate font-mono text-muted-foreground"
                            title={gitRuntime?.detail || undefined}
                          >
                            {gitRuntime?.detail ||
                              "Save to refresh the preflight check"}
                          </span>
                        </dd>
                      </div>
                    </dl>
                  )}

                  <Separator />

                  <div className="border-t-4 border-t-destructive/25 bg-destructive/[0.025] p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
                      <div className="flex flex-col gap-1">
                        <h3 className="text-sm font-semibold text-destructive">
                          Zone de danger
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          Supprime le projet et son historique de la base locale
                          AgentTasker. Le repository sur disque ne sera pas
                          supprimé.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => {
                          setDeleteError(null);
                          setIsDeleteDialogOpen(true);
                        }}
                        className="shrink-0 gap-1.5"
                      >
                        <Trash2Icon className="size-4" />
                        Supprimer le projet
                      </Button>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </FramePanel>
      </Frame>

      <Dialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          if (!open && !isDeletingProject) {
            setIsDeleteDialogOpen(false);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent showCloseButton={!isDeletingProject}>
          <DialogHeader>
            <DialogTitle>Supprimer le projet ?</DialogTitle>
            <DialogDescription>
              Cette action est irréversible. Le projet « {project.name} » et son
              historique d’exécutions seront supprimés d’AgentTasker. Le
              repository sur disque ne sera pas supprimé.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isDeletingProject}
              onClick={() => {
                setIsDeleteDialogOpen(false);
                setDeleteError(null);
              }}
            >
              Annuler
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isDeletingProject}
              onClick={handleDeleteProject}
            >
              {isDeletingProject && (
                <Loader2Icon className="size-4 animate-spin" />
              )}
              Supprimer le projet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
