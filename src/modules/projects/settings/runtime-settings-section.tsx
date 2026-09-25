"use client";

import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Separator } from "@/components/ui/separator";

import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { PACKAGE_MANAGERS, type ProjectExecutionSettings } from "@/types/project-execution";

import { FolderOpenIcon, Loader2Icon } from "lucide-react";

import type { ExecutionSettings } from "./use-execution-settings";
export function RuntimeSettingsSection({ executionSettings, setExecutionSettings, pythonMinVersion, setPythonMinVersion, pythonRuntimeMode, setPythonRuntimeMode, localPythonExecutable, setLocalPythonExecutable, isBrowsingPython, executionRuntime, setExecutionRuntime, handleBrowsePython }: Pick<ExecutionSettings, "executionSettings" | "setExecutionSettings" | "pythonMinVersion" | "setPythonMinVersion" | "pythonRuntimeMode" | "setPythonRuntimeMode" | "localPythonExecutable" | "setLocalPythonExecutable" | "isBrowsingPython" | "executionRuntime" | "setExecutionRuntime" | "handleBrowsePython">) {
  return (
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
  );
}
