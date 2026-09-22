import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, sqlite } from "../../db/client";
import { sequenceStepRuns, type SequenceStepRun } from "../../db/schema";
import type { SequenceDefinition } from "../../src/types/sequences";
import { NotFoundError } from "../errors";
import type { PortableSequenceCheckpoint } from "./sequence-checkpoint.service";

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
  initializeExecutionResume(runId: string, sourceRunId: string, resumeStepId: string): SequenceStepRun[] {
    return sqlite.transaction(() => {
      const source = this.list(sourceRunId);
      const resumeIndex = source.findIndex((step) => step.stepId === resumeStepId && step.status === "FAILED");
      if (resumeIndex < 0) throw new Error("The source Sequence Run has no failed executable step to resume.");
      if (source.slice(0, resumeIndex).some((step) => step.status !== "SUCCESS") ||
          source.slice(resumeIndex + 1).some((step) => step.status !== "SKIPPED")) {
        throw new Error("The source Sequence Run does not have a resumable failed-step boundary.");
      }
      db.delete(sequenceStepRuns).where(eq(sequenceStepRuns.runId, runId)).run();
      db.insert(sequenceStepRuns).values(source.map((step, position) => ({
        id: randomUUID(), runId, sequenceId: step.sequenceId, stepId: step.stepId, stepName: step.stepName, position,
        ...(position < resumeIndex ? {
          status: "SUCCESS", startedAt: step.startedAt, completedAt: step.completedAt, exitCode: step.exitCode,
          result: step.result, commitHash: step.commitHash, publicationBranch: step.publicationBranch,
          pushedAt: step.pushedAt, pullRequestUrl: step.pullRequestUrl, diff: step.diff,
        } : { status: "PENDING" }),
      }))).run();
      return this.list(runId);
    }).immediate();
  },
  initializeContinuation(runId: string, sourceRunId: string, sequence: SequenceDefinition): SequenceStepRun[] {
    return sqlite.transaction(() => {
      const source = this.list(sourceRunId);
      if (!source.length || source.length >= sequence.steps.length || source.some((step, index) =>
        step.status !== "SUCCESS" || step.stepId !== sequence.steps[index]?.id ||
        step.stepName !== sequence.steps[index]?.name)) {
        throw new Error("The completed Sequence Run is not a compatible prefix of the current definition.");
      }
      db.delete(sequenceStepRuns).where(eq(sequenceStepRuns.runId, runId)).run();
      db.insert(sequenceStepRuns).values(sequence.steps.map((step, position) => {
        const completed = source[position];
        return completed ? {
          id: randomUUID(), runId, sequenceId: sequence.id, stepId: step.id, stepName: step.name, position,
          status: "SUCCESS", startedAt: completed.startedAt, completedAt: completed.completedAt,
          exitCode: completed.exitCode, result: completed.result, commitHash: completed.commitHash,
          publicationBranch: completed.publicationBranch, pushedAt: completed.pushedAt,
          pullRequestUrl: completed.pullRequestUrl, diff: completed.diff,
        } : { id: randomUUID(), runId, sequenceId: sequence.id, stepId: step.id, stepName: step.name, position, status: "PENDING" };
      })).run();
      return this.list(runId);
    }).immediate();
  },
  initializePortableCheckpoint(runId: string, sequence: SequenceDefinition, checkpoint: PortableSequenceCheckpoint): SequenceStepRun[] {
    return sqlite.transaction(() => {
      const completed = checkpoint.steps.filter((step) => step.status === "SUCCESS");
      if (checkpoint.sequenceId !== sequence.id || checkpoint.steps.length !== sequence.steps.length ||
          completed.length === 0 || completed.length >= sequence.steps.length ||
          checkpoint.steps.some((step, index) => step.id !== sequence.steps[index]?.id || step.name !== sequence.steps[index]?.name) ||
          checkpoint.steps.some((step, index) => index < completed.length ? step.status !== "SUCCESS" : step.status === "SUCCESS")) {
        throw new Error("The portable checkpoint is not a compatible incomplete Sequence prefix.");
      }
      db.delete(sequenceStepRuns).where(eq(sequenceStepRuns.runId, runId)).run();
      db.insert(sequenceStepRuns).values(sequence.steps.map((step, position) => {
        const source = checkpoint.steps[position];
        if (position < completed.length) {
          return {
            id: randomUUID(), runId, sequenceId: sequence.id, stepId: step.id, stepName: step.name, position,
            status: "SUCCESS", startedAt: source.completedAt, completedAt: source.completedAt, exitCode: 0,
            // Logs and agent output deliberately remain local. This bounded placeholder preserves prompt continuity.
            result: JSON.stringify({ status: "SUCCESS", summary: "Completed in the portable Sequence checkpoint.", blocking_error: null }),
            commitHash: source.commitHash, publicationBranch: source.publicationBranch,
            pushedAt: source.publicationBranch ? source.completedAt : null, pullRequestUrl: source.pullRequestUrl,
          };
        }
        return { id: randomUUID(), runId, sequenceId: sequence.id, stepId: step.id, stepName: step.name, position, status: "PENDING" };
      })).run();
      return this.list(runId);
    }).immediate();
  },
  list(runId: string): SequenceStepRun[] {
    return db.select().from(sequenceStepRuns).where(eq(sequenceStepRuns.runId, runId))
      .orderBy(asc(sequenceStepRuns.position)).all();
  },
  listForRuns(runIds: string[]): SequenceStepRun[] {
    if (!runIds.length) return [];
    return db.select().from(sequenceStepRuns).where(inArray(sequenceStepRuns.runId, runIds))
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
