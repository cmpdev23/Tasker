"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { KeyRoundIcon, PlusIcon, XIcon } from "lucide-react";

import type { ExecutionSettings } from "./use-execution-settings";
export function EnvironmentSettingsSection({ environmentVariables, setEnvironmentVariables }: Pick<ExecutionSettings, "environmentVariables" | "setEnvironmentVariables">) {
  return (
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
  );
}
