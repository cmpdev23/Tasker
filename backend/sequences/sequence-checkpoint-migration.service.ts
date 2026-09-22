import fs from "node:fs";
import path from "node:path";
import { projectRepository } from "../projects/project.repository";
import { runRepository } from "../runs/run.repository";
import { parseProjectGitSettings } from "../tasker/project-git";
import { sequenceService } from "./sequence.service";
import { sequenceRunRepository } from "./sequence-run.repository";
import { publishSequenceCheckpointBranch, sequenceCheckpointService, type PortableSequenceCheckpoint, type SequenceCheckpointSourceStep } from "./sequence-checkpoint.service";
import { RUNNER_CONFIG } from "../runs/runner-config";

const ACTIVE = new Set(["QUEUED", "PREPARING", "RUNNING", "VALIDATING"]);

export interface SequenceCheckpointSyncResult {
  sequenceId: string;
  status: "READY" | "SYNCED" | "SKIPPED";
  message: string;
  runId?: string;
}

function identity(value: string): string {
  const resolved = fs.realpathSync(path.resolve(value));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function checkpointStatus(runStatus: string, steps: SequenceCheckpointSourceStep[]): PortableSequenceCheckpoint["status"] {
  if (steps.some((step) => step.status === "PENDING")) return "IN_PROGRESS";
  if (runStatus === "SUCCESS") return "SUCCESS";
  return runStatus === "CANCELLED" ? "CANCELLED" : "FAILED";
}

function compatiblePrefix(sequence: Awaited<ReturnType<typeof sequenceService.get>>, runId: string) {
  const steps = sequenceRunRepository.list(runId);
  if (!steps.length || steps.length > sequence.steps.length || !steps.some((step) => step.status === "SUCCESS")) return null;
  if (steps.some((step, index) => step.stepId !== sequence.steps[index]?.id || step.stepName !== sequence.steps[index]?.name)) return null;
  let seenIncomplete = false;
  for (const step of steps) {
    if (step.status === "SUCCESS") {
      if (seenIncomplete) return null;
    } else seenIncomplete = true;
  }
  return steps;
}

function checkpointSteps(sequence: Awaited<ReturnType<typeof sequenceService.get>>, source: SequenceCheckpointSourceStep[]): SequenceCheckpointSourceStep[] {
  return sequence.steps.map((step, position) => source[position] ?? {
    stepId: step.id,
    stepName: step.name,
    position,
    status: "PENDING",
    commitHash: null,
    publicationBranch: null,
    pullRequestUrl: null,
    completedAt: null,
  });
}

export const sequenceCheckpointMigrationService = {
  async sync(repositoryPath: string, options: { sequenceId?: string; dryRun?: boolean } = {}): Promise<SequenceCheckpointSyncResult[]> {
    const repository = fs.realpathSync(path.resolve(repositoryPath));
    const project = (await projectRepository.listAllProjects()).find((candidate) =>
      candidate.repositoryPath && identity(candidate.repositoryPath) === identity(repository));
    if (!project) throw new Error("This repository is not registered in the local AgentTasker database. Open it in AgentTasker first.");
    const projectToml = fs.readFileSync(path.join(repository, ".tasker", "project.toml"), "utf8");
    const git = parseProjectGitSettings(projectToml);
    if (!git.push) throw new Error("Enable Git push in Project Settings before publishing portable Sequence checkpoints.");
    const sequences = await sequenceService.list(project.id);
    const selected = options.sequenceId ? sequences.filter((sequence) => sequence.id === options.sequenceId) : sequences;
    if (options.sequenceId && !selected.length) throw new Error(`Sequence not found: ${options.sequenceId}`);
    const results: SequenceCheckpointSyncResult[] = [];
    for (const sequence of selected) {
      const candidate = runRepository.listSequences(project.id, sequence.id).find((run) =>
        !ACTIVE.has(run.status) && run.terminationVerified && run.baseRemote === git.remote &&
        run.baseBranch && run.baseCommit && run.runBranch && compatiblePrefix(sequence, run.id));
      if (!candidate) {
        results.push({ sequenceId: sequence.id, status: "SKIPPED", message: "No terminal, verified, compatible local Run with completed steps." });
        continue;
      }
      const steps = checkpointSteps(sequence, compatiblePrefix(sequence, candidate.id)!);
      const existing = await sequenceCheckpointService.load(repository, git.remote, sequence.id);
      if (existing && existing.runId !== candidate.id) {
        results.push({ sequenceId: sequence.id, status: "SKIPPED", runId: candidate.id,
          message: `The remote checkpoint belongs to newer or different Run ${existing.runId}; it was preserved.` });
        continue;
      }
      if (options.dryRun) {
        results.push({ sequenceId: sequence.id, status: "READY", runId: candidate.id,
          message: `Would publish ${steps.filter((step) => step.status === "SUCCESS").length}/${steps.length} certified step(s) from Run ${candidate.id}.` });
        continue;
      }
      const checkpointCommit = await publishSequenceCheckpointBranch({ repoPath: repository, remote: git.remote, branch: candidate.runBranch! });
      await sequenceCheckpointService.save({ repoPath: repository, runtimeRoot: RUNNER_CONFIG.dataDirectory,
        remote: git.remote, sequence, run: candidate, checkpointCommit, status: checkpointStatus(candidate.status, steps), steps });
      results.push({ sequenceId: sequence.id, status: "SYNCED", runId: candidate.id,
        message: `Published ${steps.filter((step) => step.status === "SUCCESS").length}/${steps.length} certified step(s).` });
    }
    return results;
  },
};
