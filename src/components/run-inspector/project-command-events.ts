import type { Run, RunEvent } from "@db/schema";
import type { ProjectCommandReport } from "@/types/project-command";

export interface ProjectCommandActivity extends Omit<ProjectCommandReport, "status"> {
  id: number;
  status: ProjectCommandReport["status"] | "interrupted";
  output: string;
  outputTruncated: boolean;
}

const OUTPUT_LIMIT = 12_000;

function report(event: RunEvent): ProjectCommandReport | null {
  try {
    const value = JSON.parse(event.rawPayload ?? "null") as Partial<ProjectCommandReport> | null;
    if (value?.kind !== "project-command" || value.phase !== event.type ||
        typeof value.command !== "string" || !value.command ||
        !["running", "success", "failed", "cancelled", "timed-out"].includes(value.status ?? "") ||
        !(value.exitCode === null || Number.isInteger(value.exitCode)) ||
        !(value.durationMs === null || (typeof value.durationMs === "number" && Number.isFinite(value.durationMs) && value.durationMs >= 0)) ||
        !(value.error === null || typeof value.error === "string")) return null;
    return value as ProjectCommandReport;
  } catch { return null; }
}

/** Reads both structured command results and the phase-prefixed events of older Runs. */
export function projectCommandActivities(events: RunEvent[], run: Pick<Run, "status" | "error">): ProjectCommandActivity[] {
  const commands: ProjectCommandActivity[] = [];
  let active: ProjectCommandActivity | undefined;
  for (const event of events) {
    if (event.type === "preparation" || event.type === "validation") {
      let entry = report(event);
      if (!entry) {
        const legacy = event.message.match(/^(Starting|Completed) .+?: ((?:npm|pnpm|yarn|bun) .+)$/);
        if (!legacy) continue;
        entry = { kind: "project-command", phase: event.type, command: legacy[2],
          status: legacy[1] === "Starting" ? "running" : "success",
          exitCode: legacy[1] === "Completed" ? 0 : null, durationMs: null, error: null };
      }
      if (entry.status === "running" || !active || active.phase !== entry.phase || active.command !== entry.command) {
        active = { ...entry, id: event.id, output: "", outputTruncated: false };
        commands.push(active);
      } else {
        Object.assign(active, entry);
      }
    } else if ((event.type === "stdout" || event.type === "stderr") && active?.status === "running") {
      const prefix = `[${active.phase}] `;
      if (!event.message.startsWith(prefix)) continue;
      const output = active.output + event.message.slice(prefix.length);
      active.outputTruncated ||= output.length > OUTPUT_LIMIT;
      active.output = output.slice(-OUTPUT_LIMIT);
    }
  }
  for (const command of commands) {
    if (command.status !== "running" || !["FAILED", "CANCELLED", "SUCCESS"].includes(run.status)) continue;
    // Never turn an incomplete command into a success from the final Run status.
    command.status = run.status === "CANCELLED" ? "cancelled" : "interrupted";
    if (run.status === "FAILED" && run.error?.startsWith(`${command.command} exited with code `)) {
      const code = run.error.slice(command.command.length).match(/^ exited with code (-?\d+)\./);
      command.status = "failed";
      command.exitCode = code ? Number(code[1]) : null;
      command.error = run.error;
    }
  }
  return commands;
}
