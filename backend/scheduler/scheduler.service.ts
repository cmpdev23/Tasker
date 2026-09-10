import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, sqlite } from "../../db/client";
import { runs, schedulerState } from "../../db/schema";
import { projectRepository } from "../projects/project.repository";
import { taskService } from "../tasks/task.service";
import { runRepository } from "../runs/run.repository";
import { latestDueOccurrence } from "./schedule";

export async function evaluateSchedules(now = new Date()) {
  const errors: string[] = [];
  for (const project of await projectRepository.listProjects()) {
    if (!project.repositoryPath) continue;
    try {
      for (const task of await taskService.list(project.id)) {
        const key = `${project.id}/${task.id}`;
        const fingerprint = createHash("sha256").update(JSON.stringify([task.enabled, task.schedule])).digest("hex");
        sqlite.transaction(() => {
          const state = db.select().from(schedulerState).where(eq(schedulerState.key, key)).get();
          const after = state?.fingerprint === fingerprint ? new Date(state.evaluatedAt)
            : task.schedule.type === "once" ? new Date(0) : now;
          const occurrence = task.enabled ? latestDueOccurrence(task.schedule, after, now) : null;
          if (occurrence) {
            const duplicate = db.select({ id: runs.id }).from(runs).where(and(eq(runs.projectId, project.id),
              eq(runs.taskId, task.id), eq(runs.scheduledAt, occurrence))).get();
            const pending = db.select({ id: runs.id }).from(runs).where(and(eq(runs.projectId, project.id),
              eq(runs.taskId, task.id), eq(runs.status, "QUEUED"))).get();
            if (!duplicate && !pending) runRepository.create(project.id, task.id, task.name, occurrence);
          }
          db.insert(schedulerState).values({ key, fingerprint, evaluatedAt: now.toISOString() })
            .onConflictDoUpdate({ target: schedulerState.key, set: { fingerprint, evaluatedAt: now.toISOString() } }).run();
        }).immediate();
      }
    } catch (error) {
      errors.push(`${project.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return errors;
}
