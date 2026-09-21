import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, sqlite } from "../../db/client";
import { sequenceStepRuns, type SequenceStepRun } from "../../db/schema";
import type { SequenceDefinition } from "../../src/types/sequences";
import { NotFoundError } from "../errors";

export const sequenceRunRepository = {
  initialize(runId: string, sequence: SequenceDefinition): SequenceStepRun[] {
    return sqlite.transaction(() => {
      db.delete(sequenceStepRuns).where(eq(sequenceStepRuns.runId, runId)).run();
      if (sequence.steps.length) {
        db.insert(sequenceStepRuns).values(sequence.steps.map((step, position) => ({
          id: randomUUID(),
          runId,
          sequenceId: sequence.id,
          stepId: step.id,
          stepName: step.name,
          position,
          status: "PENDING",
        }))).run();
      }
      return this.list(runId);
    }).immediate();
  },
  initializeValidationResume(runId: string, sourceRunId: string, resumeStepId: string): SequenceStepRun[] {
    return sqlite.transaction(() => {
      const source = this.list(sourceRunId);
      const resumeIndex = source.findIndex((step) => step.stepId === resumeStepId && step.status === "FAILED");
      if (resumeIndex < 0) throw new Error("The source Sequence Run has no failed validation step to resume.");
      if (source.slice(0, resumeIndex).some((step) => step.status !== "SUCCESS")) throw new Error("The source Sequence Run has an incomplete prior step.");
      if (source.slice(resumeIndex + 1).some((step) => step.status !== "SKIPPED")) throw new Error("The source Sequence Run continued after its failed validation step.");
      db.delete(sequenceStepRuns).where(eq(sequenceStepRuns.runId, runId)).run();
      db.insert(sequenceStepRuns).values(source.map((step, position) => ({
        id: randomUUID(), runId, sequenceId: step.sequenceId, stepId: step.stepId, stepName: step.stepName, position,
        status: position < resumeIndex ? "SUCCESS" : "PENDING",
        ...(position < resumeIndex ? { startedAt: step.startedAt, completedAt: step.completedAt, exitCode: step.exitCode,
          result: step.result, commitHash: step.commitHash, publicationBranch: step.publicationBranch,
          pushedAt: step.pushedAt, pullRequestUrl: step.pullRequestUrl, diff: step.diff } : {}),
      }))).run();
      return this.list(runId);
    }).immediate();
  },
  list(runId: string): SequenceStepRun[] {
    return db.select().from(sequenceStepRuns).where(eq(sequenceStepRuns.runId, runId))
      .orderBy(asc(sequenceStepRuns.position)).all();
  },
  get(runId: string, stepId: string): SequenceStepRun {
    const step = db.select().from(sequenceStepRuns).where(and(eq(sequenceStepRuns.runId, runId),
      eq(sequenceStepRuns.stepId, stepId))).get();
    if (!step) throw new NotFoundError("Sequence step Run not found.");
    return step;
  },
  update(runId: string, stepId: string, values: Partial<typeof sequenceStepRuns.$inferInsert>) {
    const updated = db.update(sequenceStepRuns).set(values).where(and(eq(sequenceStepRuns.runId, runId),
      eq(sequenceStepRuns.stepId, stepId))).returning().get();
    if (!updated) throw new NotFoundError("Sequence step Run not found.");
    return updated;
  },
  stopRemaining(runId: string, status: "SKIPPED" | "CANCELLED", error: string) {
    return db.update(sequenceStepRuns).set({ status, error, completedAt: new Date().toISOString() })
      .where(and(eq(sequenceStepRuns.runId, runId), inArray(sequenceStepRuns.status, ["PENDING", "RUNNING", "VALIDATING"]))).run();
  },
};
