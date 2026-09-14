import { ConflictError } from "../errors";
import { runRepository } from "../runs/run.repository";
import { logRunDebug } from "../runs/run-logger";
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
};
