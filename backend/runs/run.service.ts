import { runRepository, ACTIVE_STATUSES } from "./run.repository";
import { taskService } from "../tasks/task.service";
import { ConflictError } from "../errors";
import { sqlite } from "../../db/client";

export const runService = {
  async enqueue(projectId: string, taskId: string) {
    const task = await taskService.get(projectId, taskId);
    return runRepository.create(projectId, task.id, task.name);
  },
  cancel(projectId: string, runId: string) {
    return sqlite.transaction(() => {
      const run = runRepository.get(projectId, runId);
      if (!ACTIVE_STATUSES.includes(run.status)) throw new ConflictError("This run has already finished.");
      runRepository.event(runId, "cancellation", "Cancellation requested");
      return runRepository.update(runId, run.status === "QUEUED"
        ? { status: "CANCELLED", cancelRequested: true, completedAt: new Date().toISOString() }
        : { cancelRequested: true });
    }).immediate();
  },
  confirmTermination(projectId: string, runId: string) {
    return sqlite.transaction(() => {
      const run = runRepository.get(projectId, runId);
      if (ACTIVE_STATUSES.includes(run.status)) {
        throw new ConflictError("This run is still active and cannot be recovered manually.");
      }
      if (run.terminationVerified) {
        throw new ConflictError("Process termination has already been verified for this run.");
      }
      if (run.codexPid !== null) {
        throw new ConflictError("A process identity is still recorded for this run; wait for automatic recovery instead.");
      }
      const recovered = runRepository.update(runId, { terminationVerified: true });
      runRepository.event(runId, "recovery", "Process termination manually confirmed after local verification; queue resumed. Worktree preserved.");
      return recovered;
    }).immediate();
  },
};
