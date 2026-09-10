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
};
