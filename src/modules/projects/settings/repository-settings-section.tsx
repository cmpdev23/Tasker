"use client";

import { type Project } from "@db/schema";
import { Frame, FrameHeader, FrameTitle, FrameDescription, FramePanel } from "@/components/reui/frame";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Separator } from "@/components/ui/separator";

import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { FolderOpenIcon, GitBranchIcon, Loader2Icon, GlobeIcon, SparklesIcon } from "lucide-react";

import type { RepositorySettings } from "./use-repository-settings";
export function RepositorySettingsSection({ project, settings }: { project: Project; settings: RepositorySettings }) {
  const { repoPathInput, setRepoPathInput, inspection, selectedDefaultBranch, isLoadingInspection, isBrowsing, isInitializingTasker, isSavingPath, saveRepositoryPath, handleBrowseFolder, handleBaseBranchChange, handleInitializeTasker, canInitializeTasker, branchOptions } = settings;
  return <>
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
  </>;
}
