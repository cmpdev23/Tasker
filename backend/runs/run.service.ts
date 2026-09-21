import { runRepository, ACTIVE_STATUSES } from "./run.repository";
import { taskService } from "../tasks/task.service";
import { ConflictError } from "../errors";
import { sqlite } from "../../db/client";
import { logRunDebug } from "./run-logger";
import { projectService } from "../projects/project.service";
import { deleteRunArtifacts } from "../git/run-git.service";
import { RUNNER_CONFIG } from "./runner-config";
import { saveRunLogs } from "./run-log-export";
import path from "node:path";

export const runService = {
  async enqueue(projectId: string, taskId: string) {
    const task = await taskService.get(projectId, taskId);
    const run = runRepository.create(projectId, task.id, task.name);
    const recoveryBlocker = runRepository.unverifiedTermination();
    const activeRun = runRepository.active()[0];
    logRunDebug("run-enqueued", {
      runId: run.id,
      projectId: run.projectId,
      taskId: run.taskId,
      queuedAt: run.queuedAt,
      recoveryBlockerRunId: recoveryBlocker?.id,
      recoveryBlockerStatus: recoveryBlocker?.status,
      activeRunId: activeRun?.id,
      activeRunStatus: activeRun?.status,
    });
    return run;
  },
  cancel(projectId: string, runId: string) {
    return sqlite.transaction(() => {
      const run = runRepository.get(projectId, runId);
      if (!ACTIVE_STATUSES.includes(run.status)) throw new ConflictError("This run has already finished.");
      runRepository.event(runId, "cancellation", "Cancellation requested");
      const cancelled = runRepository.update(runId, run.status === "QUEUED"
        ? { status: "CANCELLED", cancelRequested: true, completedAt: new Date().toISOString() }
        : { cancelRequested: true });
      logRunDebug("cancellation-requested", {
        runId,
        projectId,
        previousStatus: run.status,
        resultingStatus: cancelled.status,
      });
      return cancelled;
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
      logRunDebug("termination-manually-confirmed", { runId, projectId, status: recovered.status });
      return recovered;
    }).immediate();
  },
  async remove(projectId: string, runId: string, options: { deleteArtifacts?: boolean; confirmTermination?: boolean } = {}) {
    let candidate = runRepository.get(projectId, runId);
    if (!["QUEUED", "SUCCESS", "FAILED", "CANCELLED"].includes(candidate.status)) {
      throw new ConflictError("Annulez cette exécution active avant de la supprimer.");
    }
    if (!candidate.terminationVerified) {
      if (!options.confirmTermination) {
        throw new ConflictError("Confirmez l’arrêt du processus avant de supprimer ce Run.");
      }
      if (candidate.codexPid !== null) {
        throw new ConflictError("Un processus est encore associé à ce Run; attendez la vérification automatique avant de le supprimer.");
      }
      candidate = runService.confirmTermination(projectId, runId);
    }
    if (!candidate.resumeFromRunId && runRepository.hasContinuation(candidate.id)) {
      throw new ConflictError("Ce Run possède une reprise liée. Supprimez d’abord cette reprise pour préserver son worktree partagé.");
    }
    // A continuation displays its source coordinates for traceability but never owns or deletes them.
    const hasArtifacts = !candidate.resumeFromRunId && Boolean(candidate.worktreePath || candidate.runBranch);
    if (hasArtifacts && !options.deleteArtifacts) {
      throw new ConflictError("Ce Run possède du travail Git préservé. Confirmez sa suppression avec le worktree et la branche.");
    }
    if (hasArtifacts) {
      if (!candidate.worktreePath || !candidate.runBranch) {
        throw new ConflictError("Les métadonnées Git de ce Run sont incomplètes; suppression refusée pour protéger le repository.");
      }
      const project = await projectService.getProjectById(projectId);
      if (!project.repositoryPath) throw new ConflictError("Le repository du Project doit être configuré pour nettoyer ce Run.");
      await deleteRunArtifacts({
        repoPath: project.repositoryPath,
        worktreesRoot: path.join(RUNNER_CONFIG.dataDirectory, "worktrees"),
        worktreePath: candidate.worktreePath,
        branch: candidate.runBranch,
        runId: candidate.id,
        taskId: candidate.taskId,
      });
    }
    const removed = sqlite.transaction(() => {
      const current = runRepository.get(projectId, runId);
      if (current.status !== candidate.status || current.terminationVerified !== candidate.terminationVerified ||
          current.worktreePath !== candidate.worktreePath || current.runBranch !== candidate.runBranch) {
        throw new ConflictError("Le Run a changé pendant son nettoyage; rechargez son état avant de réessayer.");
      }
      runRepository.remove(runId);
      return current;
    }).immediate();
    logRunDebug("run-removed", {
      runId: removed.id,
      projectId: removed.projectId,
      taskId: removed.taskId,
      previousStatus: removed.status,
      terminationConfirmedDuringRemoval: Boolean(options.confirmTermination),
    });
    return removed;
  },
  saveLogs(projectId: string, runId: string) {
    return saveRunLogs(projectId, runId);
  },
};
