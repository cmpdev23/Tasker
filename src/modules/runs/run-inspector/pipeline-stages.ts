import type { Run } from "@db/schema";
import { parseRunResult } from "./event-normalizer";
import { resolvedExecutionConfig } from "./execution-config";
import type { ProjectCommandActivity } from "./project-command-events";

export type PipelineStageStatus = "pending" | "running" | "success" | "failed" | "skipped";

export interface PipelineStage {
  id: "environment" | "codex" | "validation" | "git" | "publication";
  label: string;
  status: PipelineStageStatus;
}

type PipelineRun = Pick<Run, "status" | "exitCode" | "result" | "error" | "commitHash" | "pushedAt" | "pullRequestUrl" | "worktreePath" | "resolvedConfig">;

function hasFailure(commands: ProjectCommandActivity[]) {
  return commands.some((command) => ["failed", "timed-out", "interrupted", "cancelled"].includes(command.status));
}

function hasRunningCommand(commands: ProjectCommandActivity[]) {
  return commands.some((command) => command.status === "running");
}

function isTerminal(status: string) {
  return ["SUCCESS", "FAILED", "CANCELLED", "SKIPPED"].includes(status);
}

/**
 * Derives the user-facing pipeline only from persisted Run state and command
 * reports. It intentionally never promotes a missing command result to success.
 */
export function pipelineStages(run: PipelineRun, commands: ProjectCommandActivity[], sequenceStep = false): PipelineStage[] {
  const preparation = commands.filter((command) => command.phase === "preparation");
  const validation = commands.filter((command) => command.phase === "validation");
  const result = parseRunResult(run.result);
  const config = resolvedExecutionConfig(run.resolvedConfig);
  const validationsConfigured = config.validationScripts?.length !== 0;
  const codexSucceeded = run.exitCode === 0 && result?.status === "SUCCESS";
  const codexFailed = run.exitCode !== null && !codexSucceeded;
  const terminal = isTerminal(run.status);

  const environment: PipelineStageStatus = sequenceStep
    ? run.worktreePath ? "success" : run.status === "PENDING" || run.status === "QUEUED" ? "pending" : "running"
    : hasFailure(preparation) ? "failed"
      : hasRunningCommand(preparation) || run.status === "PREPARING" ? "running"
        : run.status === "QUEUED" ? "pending"
          : run.status === "CANCELLED" ? "skipped"
            : run.status === "FAILED" && run.exitCode === null && preparation.length === 0 ? "failed"
            : "success";

  const codex: PipelineStageStatus = codexSucceeded ? "success"
    : codexFailed || result?.status === "FAILURE" ? "failed"
      : run.status === "RUNNING" ? "running"
        : run.status === "QUEUED" || run.status === "PREPARING" || run.status === "PENDING" ? "pending"
          : run.status === "VALIDATING" ? "success"
            : run.status === "CANCELLED" ? "skipped"
              : terminal ? "failed" : "pending";

  const validations: PipelineStageStatus = hasFailure(validation) ? "failed"
    : hasRunningCommand(validation) || run.status === "VALIDATING" ? "running"
      : validation.length > 0 ? "success"
        : run.status === "SUCCESS" ? validationsConfigured ? "success" : "skipped"
          : codex === "success" && run.status === "FAILED" ? "skipped"
            : "pending";

  const git: PipelineStageStatus = run.commitHash ? "success"
    : run.status === "SUCCESS" ? config.expectChanges === false ? "skipped" : "success"
      : run.status === "VALIDATING" && validations !== "failed" ? "running"
        : run.status === "FAILED" && codex === "success" && ["success", "skipped"].includes(validations) ? "failed"
          : "pending";

  const publicationConfigured = config.push === true || config.createPullRequest === true;
  const publication: PipelineStageStatus = !publicationConfigured && !run.pushedAt && !run.pullRequestUrl ? "skipped"
    : run.pushedAt || run.pullRequestUrl || run.status === "SUCCESS" ? "success"
      : run.status === "FAILED" && git === "success" ? "failed"
        : "pending";

  return [
    { id: "environment", label: "Environnement", status: environment },
    { id: "codex", label: "Codex", status: codex },
    { id: "validation", label: "Validations", status: validations },
    { id: "git", label: "Git", status: git },
    { id: "publication", label: "Publication", status: publication },
  ];
}
