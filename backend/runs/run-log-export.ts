import fs from "node:fs";
import path from "node:path";
import type { Run, RunEvent } from "../../db/schema";
import { runRepository } from "./run.repository";
import { projectService } from "../projects/project.service";
import { ValidationError } from "../errors";
import { logRunDebug } from "./run-logger";

export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function prettyJson(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Strips raw base-85 binary patch blocks from git diffs, which can otherwise
 * produce tens of thousands of lines of unreadable binary chunks for images or media.
 */
export function stripBinaryDiff(diff: string): string {
  if (!diff || !diff.includes("GIT binary patch")) return diff;
  return diff
    .replace(/GIT binary patch\r?\n(?:(?!diff --git)[\s\S])*/g, "[GIT binary patch omitted]\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Truncates inline base64 media payloads to keep text logs clean and lightweight.
 */
export function sanitizeLogPayload(payload: string): string {
  if (!payload || typeof payload !== "string") return payload;
  return payload.replace(
    /data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]{128,}/g,
    (match) => {
      const prefix = match.slice(0, match.indexOf(";base64,") + 8);
      return `${prefix}[base64 data omitted (${match.length} chars)]`;
    }
  );
}

export function formatRunLog(run: Run, events: RunEvent[]): string {
  const lines: string[] = [];
  lines.push("=".repeat(80));
  lines.push("AGENTTASKER RUN LOG");
  lines.push("=".repeat(80));
  lines.push(`Run ID:           ${run.id}`);
  lines.push(`Run Kind:         ${run.kind}`);
  if (run.kind === "SEQUENCE") {
    lines.push(`Sequence ID:      ${run.sequenceId ?? run.taskId}`);
    lines.push(`Sequence Name:    ${run.taskName}`);
  } else {
    lines.push(`Task ID:          ${run.taskId}`);
    lines.push(`Task Name:        ${run.taskName}`);
  }
  lines.push(`Status:           ${run.status}`);
  lines.push(`Exit Code:        ${run.exitCode !== null && run.exitCode !== undefined ? run.exitCode : "N/A"}`);
  lines.push(`Termination:      ${run.terminationVerified ? "Verified" : "Unverified"}`);
  lines.push(`Queued At:        ${run.queuedAt}`);
  lines.push(`Started At:       ${run.startedAt ?? "N/A"}`);
  lines.push(`Completed At:     ${run.completedAt ?? "N/A"}`);
  if (run.startedAt) {
    const start = Date.parse(run.startedAt);
    const end = run.completedAt ? Date.parse(run.completedAt) : Date.now();
    if (Number.isFinite(start) && Number.isFinite(end)) {
      lines.push(`Duration:         ${formatDuration(end - start)}`);
    }
  }
  lines.push(`Base Remote:      ${run.baseRemote ?? "N/A"}`);
  lines.push(`Base Branch:      ${run.baseBranch ?? "N/A"}`);
  lines.push(`Base Commit:      ${run.baseCommit ?? "N/A"}`);
  lines.push(`Run Branch:       ${run.runBranch ?? "N/A"}`);
  lines.push(`Worktree Path:    ${run.worktreePath ?? "N/A"}`);
  lines.push(`Commit Hash:      ${run.commitHash ?? "N/A"}`);
  lines.push(`Pushed At:        ${run.pushedAt ?? "N/A"}`);
  lines.push(`Pull Request:     ${run.pullRequestUrl ?? "N/A"}`);
  lines.push("");

  lines.push("-".repeat(80));
  lines.push("RESULT SUMMARY");
  lines.push("-".repeat(80));
  lines.push(run.result ? run.result.trim() : "(No agent result summary)");
  lines.push("");

  if (run.error) {
    lines.push("-".repeat(80));
    lines.push("ERROR");
    lines.push("-".repeat(80));
    lines.push(run.error.trim());
    lines.push("");
  }

  if (run.warning) {
    lines.push("-".repeat(80));
    lines.push("WARNING");
    lines.push("-".repeat(80));
    lines.push(run.warning.trim());
    lines.push("");
  }

  if (run.resolvedConfig) {
    lines.push("-".repeat(80));
    lines.push("RESOLVED CONFIGURATION");
    lines.push("-".repeat(80));
    lines.push(prettyJson(run.resolvedConfig));
    lines.push("");
  }

  if (run.diff) {
    lines.push("-".repeat(80));
    lines.push("GIT CHANGES / DIFF");
    lines.push("-".repeat(80));
    lines.push(stripBinaryDiff(run.diff.trim()));
    lines.push("");
  }

  lines.push("=".repeat(80));
  lines.push(`EVENT LOG (${events.length} events)`);
  lines.push("=".repeat(80));

  for (const event of events) {
    lines.push(`[${event.timestamp}] [${event.type}] ${sanitizeLogPayload(event.message)}`);
    if (event.rawPayload && event.rawPayload.trim() !== event.message.trim()) {
      const formatted = prettyJson(sanitizeLogPayload(event.rawPayload));
      const indented = formatted.split(/\r?\n/).map((line) => `    ${line}`).join("\n");
      lines.push(indented);
    }
  }
  lines.push("");

  return lines.join("\n");
}

export async function saveRunLogs(projectId: string, runId: string) {
  const run = runRepository.get(projectId, runId);
  const events = runRepository.allEvents(runId);
  const project = await projectService.getProjectById(projectId);

  if (!project.repositoryPath || !project.repositoryPath.trim()) {
    throw new ValidationError("Configurez d'abord le repository du projet dans Settings.");
  }

  const repoPath = path.resolve(project.repositoryPath.trim());
  if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
    throw new ValidationError(`Le dossier du repository n'existe pas : ${repoPath}`);
  }

  const logsDir = path.join(repoPath, ".tasker", "logs");
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const definitionId = run.sequenceId ?? run.taskId;
  const safeTaskId = definitionId.replace(/[^a-zA-Z0-9_-]/g, "-") || (run.kind === "SEQUENCE" ? "sequence" : "task");
  const safeRunId = run.id.replace(/[^a-zA-Z0-9_-]/g, "-");
  const filename = `${safeTaskId}_${safeRunId}.txt`;
  const fullPath = path.join(logsDir, filename);

  const relativeFromLogs = path.relative(logsDir, fullPath);
  if (relativeFromLogs.startsWith("..") || path.isAbsolute(relativeFromLogs)) {
    throw new ValidationError("Nom de fichier de log invalide.");
  }

  const logContent = formatRunLog(run, events);
  fs.writeFileSync(fullPath, logContent, "utf8");

  const relativePath = path.posix.join(".tasker", "logs", filename);
  logRunDebug("run-logs-saved", {
    runId: run.id,
    projectId: run.projectId,
    taskId: run.taskId,
    filePath: relativePath,
    eventCount: events.length,
  });

  return {
    success: true,
    filename,
    filePath: relativePath,
    absolutePath: fullPath,
    byteCount: Buffer.byteLength(logContent, "utf8"),
    eventCount: events.length,
  };
}
