import { ConflictError } from "../errors";
import { runRepository } from "../runs/run.repository";
import { logRunDebug } from "../runs/run-logger";
import { sequenceRunRepository } from "./sequence-run.repository";
import { sequenceService } from "./sequence.service";
import { projectService } from "../projects/project.service";
import { parseProjectGitSettings } from "../tasker/project-git";
import { sequenceCheckpointService, type PortableSequenceCheckpoint } from "./sequence-checkpoint.service";
import type { Run, SequenceStepRun } from "../../db/schema";
import type { SequenceDefinition } from "../../src/types/sequences";
import fs from "node:fs";
import path from "node:path";

export const sequenceRunService = {
  async enqueue(projectId: string, sequenceId: string) {
    const sequence = await sequenceService.get(projectId, sequenceId);
    if (!sequence.steps.length) throw new ConflictError("Ajoutez au moins une étape avant d’exécuter cette Sequence.");
    if (runRepository.hasActiveSequence(projectId, sequenceId)) {
      throw new ConflictError("Cette Sequence possède déjà un Run actif ou en attente.");
    }
    const history = runRepository.listSequences(projectId, sequence.id);
    const continuationSource = findUnattemptedContinuationSource(sequence, history);
    const run = continuationSource
      ? runRepository.createSequenceContinuation(continuationSource)
      : runRepository.createSequence(projectId, sequence.id, sequence.name);
    if (continuationSource) sequenceRunRepository.initializeContinuation(run.id, continuationSource.id, sequence);
    const blocker = runRepository.unverifiedTermination();
    const active = runRepository.active()[0];
    logRunDebug("sequence-run-enqueued", {
      runId: run.id,
      projectId,
      sequenceId,
      stepCount: sequence.steps.length,
      continuationSourceRunId: continuationSource?.id,
      recoveryBlockerRunId: blocker?.id,
      activeRunId: active?.id,
    });
    return run;
  },
  async resumeValidation(projectId: string, runId: string) {
    const source = runRepository.get(projectId, runId);
    assertResumableSequence(source);
    const sourceSteps = sequenceRunRepository.list(source.id);
    const failedIndex = sourceSteps.findIndex((step) => step.status === "FAILED");
    const failed = failedIndex < 0 ? undefined : sourceSteps[failedIndex];
    if (!failed || failed.exitCode !== 0 || !isSuccessfulCodexResult(failed.result)) {
      throw new ConflictError("Reprendre est offert seulement après un succès Codex suivi d’un échec de validation.");
    }
    if (sourceSteps.slice(0, failedIndex).some((step) => step.status !== "SUCCESS") ||
        sourceSteps.slice(failedIndex + 1).some((step) => step.status !== "SKIPPED")) {
      throw new ConflictError("La progression de cette Sequence ne permet pas une reprise sûre.");
    }
    const validationFailed = runRepository.allEvents(source.id).some((event) => {
      if (event.type !== "validation" || !event.rawPayload) return false;
      try {
        const payload = JSON.parse(event.rawPayload) as { kind?: string; status?: string; sequenceStepId?: string };
        return payload.kind === "project-command" && payload.sequenceStepId === failed.stepId &&
          (payload.status === "failed" || payload.status === "timed-out");
      } catch { return false; }
    });
    if (!validationFailed) throw new ConflictError("Aucune validation échouée vérifiable n’a été trouvée pour ce Run.");
    await sequenceService.get(projectId, source.sequenceId!);
    const resumed = runRepository.createSequenceValidationResume(source, failed.stepId);
    sequenceRunRepository.initializeValidationResume(resumed.id, source.id, failed.stepId);
    return resumed;
  },
  async resumeExecution(projectId: string, runId: string) {
    const source = runRepository.get(projectId, runId);
    assertResumableSequence(source);
    const sourceSteps = sequenceRunRepository.list(source.id);
    const failedIndex = sourceSteps.findIndex((step) => step.status === "FAILED");
    const failed = failedIndex < 0 ? undefined : sourceSteps[failedIndex];
    if (!failed || sourceSteps.slice(0, failedIndex).some((step) => step.status !== "SUCCESS") ||
        sourceSteps.slice(failedIndex + 1).some((step) => step.status !== "SKIPPED")) {
      throw new ConflictError("La progression de cette Sequence ne permet pas une reprise sûre.");
    }
    await sequenceService.get(projectId, source.sequenceId!);
    const resumed = runRepository.createSequenceExecutionResume(source, failed.stepId);
    sequenceRunRepository.initializeExecutionResume(resumed.id, source.id, failed.stepId);
    return resumed;
  },
  async resume(projectId: string, runId: string) {
    const source = runRepository.get(projectId, runId);
    const sourceSteps = sequenceRunRepository.list(source.id);
    const failed = sourceSteps.find((step) => step.status === "FAILED");
    const hasFailedValidation = Boolean(failed && failed.exitCode === 0 && isSuccessfulCodexResult(failed.result) &&
      runRepository.allEvents(source.id).some((event) => {
        if (event.type !== "validation" || !event.rawPayload) return false;
        try {
          const payload = JSON.parse(event.rawPayload) as { kind?: string; status?: string; sequenceStepId?: string };
          return payload.kind === "project-command" && payload.sequenceStepId === failed.stepId &&
            (payload.status === "failed" || payload.status === "timed-out");
        } catch { return false; }
      }));
    return hasFailedValidation ? this.resumeValidation(projectId, runId) : this.resumeExecution(projectId, runId);
  },
  async portableCheckpoint(projectId: string, sequenceId: string): Promise<PortableSequenceCheckpoint | null> {
    const [project, sequence] = await Promise.all([projectService.getProjectById(projectId), sequenceService.get(projectId, sequenceId)]);
    if (!project.repositoryPath) throw new ConflictError("Configure the project repository in Settings first.");
    const projectToml = fs.readFileSync(path.join(project.repositoryPath, ".tasker", "project.toml"), "utf8");
    const git = parseProjectGitSettings(projectToml);
    const checkpoint = await sequenceCheckpointService.load(project.repositoryPath, git.remote, sequence.id);
    return checkpoint;
  },
  async resumePortableCheckpoint(projectId: string, sequenceId: string) {
    const sequence = await sequenceService.get(projectId, sequenceId);
    if (!sequence.steps.length) throw new ConflictError("Ajoutez au moins une étape avant de reprendre cette Sequence.");
    if (runRepository.hasActiveSequence(projectId, sequenceId)) {
      throw new ConflictError("Cette Sequence possède déjà un Run actif ou en attente.");
    }
    const checkpoint = await this.portableCheckpoint(projectId, sequenceId);
    if (!checkpoint) throw new ConflictError("Aucun checkpoint portable n’a été trouvé pour cette Sequence.");
    if (checkpoint.status === "SUCCESS") throw new ConflictError("Le checkpoint portable indique que cette Sequence est déjà terminée.");
    const completed = checkpoint.steps.filter((step) => step.status === "SUCCESS");
    if (!completed.length || completed.length >= sequence.steps.length) {
      throw new ConflictError("Le checkpoint portable ne contient aucune étape incomplète à reprendre.");
    }
    const run = runRepository.createSequence(projectId, sequence.id, sequence.name);
    runRepository.update(run.id, {
      resumeStage: "REMOTE_CHECKPOINT",
      resolvedConfig: JSON.stringify({ portableCheckpoint: checkpoint }),
    });
    sequenceRunRepository.initializePortableCheckpoint(run.id, sequence, checkpoint);
    runRepository.event(run.id, "resume", `Portable checkpoint queued from Run ${checkpoint.runId}; ${completed.length} completed step${completed.length === 1 ? "" : "s"} retained.`);
    return runRepository.get(projectId, run.id);
  },
};

function isCompatibleSuccessfulPrefix(candidate: Run, steps: SequenceStepRun[], sequence: SequenceDefinition): boolean {
  return candidate.status === "SUCCESS" && candidate.terminationVerified && Boolean(candidate.runBranch) && Boolean(candidate.baseCommit) &&
    steps.length > 0 && steps.length < sequence.steps.length && steps.every((step, index) =>
      step.status === "SUCCESS" && step.stepId === sequence.steps[index]?.id && step.stepName === sequence.steps[index]?.name);
}

function isLaterAttemptOfSuffix(steps: SequenceStepRun[], sequence: SequenceDefinition, prefixLength: number): boolean {
  return steps.length === sequence.steps.length && steps.every((step, index) =>
    step.stepId === sequence.steps[index]?.id && step.stepName === sequence.steps[index]?.name) &&
    steps.slice(prefixLength).some((step) => step.status !== "PENDING");
}

function findUnattemptedContinuationSource(sequence: SequenceDefinition, history: Run[]): Run | null {
  for (const [index, candidate] of history.entries()) {
    const completed = sequenceRunRepository.list(candidate.id);
    if (!isCompatibleSuccessfulPrefix(candidate, completed, sequence)) continue;
    if (!history.slice(0, index).some((later) =>
      isLaterAttemptOfSuffix(sequenceRunRepository.list(later.id), sequence, completed.length))) return candidate;
  }
  return null;
}

function assertResumableSequence(source: ReturnType<typeof runRepository.get>) {
  if (source.kind !== "SEQUENCE" || !source.sequenceId) throw new ConflictError("Seules les Sequences peuvent être reprises.");
  if (source.status !== "FAILED" || !source.terminationVerified || source.codexPid !== null) {
    throw new ConflictError("Ce Run n’est pas dans un état sûr pour une reprise.");
  }
  if (!source.worktreePath || !source.runBranch || !source.baseCommit || !source.baseRemote || !source.baseBranch) {
    throw new ConflictError("Le worktree Git préservé est incomplet; la reprise est refusée.");
  }
}

function isSuccessfulCodexResult(result: string | null): boolean {
  if (!result) return false;
  try { return (JSON.parse(result) as { status?: string }).status === "SUCCESS"; }
  catch { return false; }
}
