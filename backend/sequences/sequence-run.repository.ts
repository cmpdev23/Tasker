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

