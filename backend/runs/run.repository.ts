import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { db, sqlite } from "../../db/client";
import { runs, runEvents, type Run } from "../../db/schema";
import { NotFoundError } from "../errors";
import type { RunQueueEntry, RunQueueStatus } from "../../src/types/run-queue";

export const ACTIVE_STATUSES = ["QUEUED", "PREPARING", "RUNNING", "VALIDATING"];
export const EXECUTING_STATUSES = ACTIVE_STATUSES.slice(1);

function queueEntry(run: Run): RunQueueEntry {
  return {
    id: run.id,
    projectId: run.projectId,
    taskId: run.taskId,
    taskName: run.taskName,
    status: run.status,
    queuedAt: run.queuedAt,
    startedAt: run.startedAt,
    codexPid: run.codexPid,
  };
}

export const runRepository = {
  create(projectId: string, taskId: string, taskName: string, scheduledAt: string | null = null): Run {
    return sqlite.transaction(() => {
      const now = new Date().toISOString();
      const run = db.insert(runs).values({ id: randomUUID(), projectId, taskId, taskName,
        status: "QUEUED", scheduledAt, queuedAt: now, createdAt: now }).returning().get();
      this.event(run.id, "status", "Queued");
      return run;
    }).immediate();
  },
  get(projectId: string, runId: string): Run {
    const run = db.select().from(runs).where(and(eq(runs.id, runId), eq(runs.projectId, projectId))).get();
    if (!run) throw new NotFoundError("Run not found.");
    return run;
  },
  list(projectId: string, taskId?: string, before?: string) {
    return db.select().from(runs).where(and(eq(runs.projectId, projectId),
      taskId ? eq(runs.taskId, taskId) : undefined,
      before ? lt(runs.createdAt, before) : undefined)).orderBy(desc(runs.createdAt)).limit(200).all();
  },
  update(id: string, values: Partial<typeof runs.$inferInsert>) {
    return db.update(runs).set(values).where(eq(runs.id, id)).returning().get();
  },
  completeSuccess(projectId: string, runId: string) {
    return sqlite.transaction(() => {
      const run = this.get(projectId, runId);
      return this.update(runId, { status: run.cancelRequested ? "CANCELLED" : "SUCCESS",
        completedAt: new Date().toISOString(),
        error: run.cancelRequested ? "Cancelled after validation; any completed commit is preserved." : null });
    }).immediate();
  },
  event(runId: string, type: string, message: string, rawPayload?: string) {
    return db.insert(runEvents).values({ runId, timestamp: new Date().toISOString(), type,
      message, rawPayload: rawPayload ?? null }).returning().get();
  },
  events(runId: string, after = 0) {
    return db.select().from(runEvents).where(and(eq(runEvents.runId, runId), gt(runEvents.id, after)))
      .orderBy(asc(runEvents.id)).limit(500).all();
  },
  active() { return db.select().from(runs).where(inArray(runs.status, EXECUTING_STATUSES)).all(); },
  unverifiedTermination() {
    return db.select().from(runs).where(eq(runs.terminationVerified, false))
      .orderBy(asc(runs.createdAt)).get();
  },
  hasUnverifiedTermination() {
    return Boolean(this.unverifiedTermination());
  },
  hasActive(projectId: string, taskId: string) {
    return Boolean(db.select({ id: runs.id }).from(runs).where(and(eq(runs.projectId, projectId),
      eq(runs.taskId, taskId), inArray(runs.status, ACTIVE_STATUSES))).get());
  },
  queueStatus(runId?: string): RunQueueStatus {
    const queued = db.select().from(runs).where(eq(runs.status, "QUEUED"))
      .orderBy(asc(runs.queuedAt), asc(runs.createdAt)).all();
    const unverified = db.select().from(runs).where(eq(runs.terminationVerified, false))
      .orderBy(asc(runs.createdAt)).all();
    const recoveryBlocker = unverified.find((run) => !EXECUTING_STATUSES.includes(run.status));
    const active = this.active()[0];
    const processBlocker = active?.terminationVerified === false && Boolean(active.error) ? active : undefined;
    const blocker = recoveryBlocker ?? processBlocker ?? active;
    const state = recoveryBlocker
      ? queued.length ? "BLOCKED_RECOVERY" : "RECOVERY_REQUIRED"
      : processBlocker
        ? "BLOCKED_PROCESS"
        : active
          ? "RUNNING"
          : queued.length
            ? "READY"
            : "IDLE";
    const position = runId ? queued.findIndex((run) => run.id === runId) : -1;
    return {
      state,
      queuedCount: queued.length,
      position: position < 0 ? null : position + 1,
      blocker: blocker ? queueEntry(blocker) : null,
      canRecover: (state === "BLOCKED_RECOVERY" || state === "RECOVERY_REQUIRED") && blocker?.codexPid === null,
    };
  },
  remove(runId: string) {
    db.delete(runs).where(eq(runs.id, runId)).run();
  },
  claim(): Run | undefined {
    return sqlite.transaction(() => {
      if (this.active().length) return undefined;
      const run = db.select().from(runs).where(eq(runs.status, "QUEUED")).orderBy(asc(runs.queuedAt)).get();
      if (!run) return undefined;
      return this.update(run.id, { status: "PREPARING", startedAt: new Date().toISOString() });
    }).immediate();
  },
};
