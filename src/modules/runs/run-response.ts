import type { Run } from "@db/schema";
import type { RunQueueStatus } from "@/types/run-queue";

export function isQueueStatus(value: unknown): value is RunQueueStatus {
  if (!value || typeof value !== "object") return false;
  const queue = value as RunQueueStatus;
  return ["IDLE", "READY", "RUNNING", "BLOCKED_PROCESS", "BLOCKED_RECOVERY", "RECOVERY_REQUIRED"].includes(queue.state) &&
    Number.isInteger(queue.queuedCount) && queue.queuedCount >= 0 &&
    (queue.position === null || (Number.isInteger(queue.position) && queue.position > 0)) &&
    typeof queue.canRecover === "boolean" &&
    (queue.blocker === null || (typeof queue.blocker === "object" && typeof queue.blocker.id === "string" && typeof queue.blocker.projectId === "string"));
}

export function requireRun(value: Run | undefined, projectId: string): Run {
  if (!value?.id || value.projectId !== projectId || !value.taskId || !value.queuedAt ||
      !["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "SUCCESS", "FAILED", "CANCELLED"].includes(value.status)) {
    throw new Error("Réponse du Run invalide. Vérifiez l’historique avant de réessayer.");
  }
  return value;
}

export function requireQueue(value: unknown): RunQueueStatus {
  if (!isQueueStatus(value)) throw new Error("Réponse de la queue invalide. Vérifiez l’historique avant de réessayer.");
  return value;
}
