"use client";

import { Input } from "@/components/ui/input";

import type { ExecutionSettings } from "./use-execution-settings";
export function TimeoutSettingsSection({ executionSettings, setExecutionSettings }: Pick<ExecutionSettings, "executionSettings" | "setExecutionSettings">) {
  return (
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
  );
}
