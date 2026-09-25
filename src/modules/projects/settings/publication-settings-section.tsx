"use client";

import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Separator } from "@/components/ui/separator";

import { Loader2Icon, GitPullRequestDraftIcon } from "lucide-react";

import type { PublicationSettings } from "./use-publication-settings";
export function PublicationSettingsSection({ settings }: { settings: PublicationSettings }) {
  const { gitSettings, setGitSettings, gitRuntime, isLoadingGitSettings, isSavingGitSettings, handleSaveGitSettings } = settings;
  return <>
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
  </>;
}
