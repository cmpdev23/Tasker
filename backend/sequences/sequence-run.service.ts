import { ConflictError } from "../errors";
import { runRepository } from "../runs/run.repository";
import { logRunDebug } from "../runs/run-logger";
import { sequenceRunRepository } from "./sequence-run.repository";
import { sequenceService } from "./sequence.service";

export const sequenceRunService = {
  async enqueue(projectId: string, sequenceId: string) {
    const sequence = await sequenceService.get(projectId, sequenceId);
    if (!sequence.steps.length) throw new ConflictError("Ajoutez au moins une étape avant d’exécuter cette Sequence.");
    if (runRepository.hasActiveSequence(projectId, sequenceId)) {
      throw new ConflictError("Cette Sequence possède déjà un Run actif ou en attente.");
    }
    const run = runRepository.createSequence(projectId, sequence.id, sequence.name);
    const blocker = runRepository.unverifiedTermination();
    const active = runRepository.active()[0];
    logRunDebug("sequence-run-enqueued", {
      runId: run.id,
      projectId,
      sequenceId,
      stepCount: sequence.steps.length,
      recoveryBlockerRunId: blocker?.id,
      activeRunId: active?.id,
    });
    return run;
  },
  async resumeValidation(projectId: string, runId: string) {
    const source = runRepository.get(projectId, runId);
    if (source.kind !== "SEQUENCE" || !source.sequenceId) throw new ConflictError("Seules les Sequences peuvent être reprises.");
    if (source.status !== "FAILED" || !source.terminationVerified || source.codexPid !== null) throw new ConflictError("Ce Run n’est pas dans un état sûr pour une reprise.");
    if (!source.worktreePath || !source.runBranch || !source.baseCommit || !source.baseRemote || !source.baseBranch) {
      throw new ConflictError("Le worktree Git préservé est incomplet; la reprise est refusée.");
    }
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
    await sequenceService.get(projectId, source.sequenceId);
    const resumed = runRepository.createSequenceValidationResume(source, failed.stepId);
    sequenceRunRepository.initializeValidationResume(resumed.id, source.id, failed.stepId);
    return resumed;
  },
};

function isSuccessfulCodexResult(result: string | null): boolean {
  if (!result) return false;
  try { return (JSON.parse(result) as { status?: string }).status === "SUCCESS"; }
  catch { return false; }
}
