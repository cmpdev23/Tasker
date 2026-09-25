"use client";

import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import type { ExecutionSettings } from "./use-execution-settings";
export function ScriptsSettingsSection({ executionSettings, setExecutionSettings, validationScripts, setValidationScripts }: Pick<ExecutionSettings, "executionSettings" | "setExecutionSettings" | "validationScripts" | "setValidationScripts">) {
  return (
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
  );
}
