export type RunQueueState = "IDLE" | "READY" | "RUNNING" | "BLOCKED_PROCESS" | "BLOCKED_RECOVERY" | "RECOVERY_REQUIRED";

export type RunQueueEntry = {
  id: string;
  projectId: string;
  taskId: string;
  taskName: string;
  status: string;
  queuedAt: string;
  startedAt: string | null;
  codexPid: number | null;
};

export type RunQueueStatus = {
  state: RunQueueState;
  queuedCount: number;
  position: number | null;
  blocker: RunQueueEntry | null;
  canRecover: boolean;
};
