"use client";

import { useState, useEffect, useCallback } from "react";

import { type Project } from "@db/schema";

import { toast } from "sonner";

import { DEFAULT_PROJECT_EXECUTION_SETTINGS, type ProjectExecutionRuntimeStatus, type ProjectExecutionSettings, type ProjectLocalExecutionSettings } from "@/types/project-execution";

import { environmentDraft, environmentPayload, type EnvironmentVariableDraft } from "./environment-draft";

export function useExecutionSettings(project: Project, enabled: boolean) {
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
    true,
  );
  const [isSavingExecution, setIsSavingExecution] = useState(false);
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
          setEnvironmentVariables(environmentDraft(localRuntime?.environmentVariables));
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
    if (!enabled) return;
    const controller = new AbortController();
    void fetchExecutionSettings(controller.signal);
    return () => controller.abort();
  }, [enabled, fetchExecutionSettings]);

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
            environmentVariables: environmentPayload(environmentVariables),
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
      setEnvironmentVariables(environmentDraft(data.localRuntime?.environmentVariables));
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

  return { executionSettings, setExecutionSettings, validationScripts, setValidationScripts, pythonMinVersion, setPythonMinVersion, pythonRuntimeMode, setPythonRuntimeMode, localPythonExecutable, setLocalPythonExecutable, environmentVariables, setEnvironmentVariables, isBrowsingPython, executionRuntime, setExecutionRuntime, isLoadingExecution, isSavingExecution, handleSaveExecution, handleBrowsePython };
}
export type ExecutionSettings = ReturnType<typeof useExecutionSettings>;
