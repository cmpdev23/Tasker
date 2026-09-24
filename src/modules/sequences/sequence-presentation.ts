import type { Run, SequenceStepRun } from "@db/schema";
import type { SequenceDefinition, SequenceStepDefinition } from "@/types/sequences";

type PresentedSequence = {
  pullRequestStrategy: SequenceDefinition["pullRequestStrategy"];
  steps: ReadonlyArray<Pick<SequenceStepDefinition, "id" | "name">>;
};
type PresentedStep = Pick<SequenceStepRun, "status" | "stepId" | "stepName">;
type PresentedRun = Pick<Run, "status" | "pauseRequested">;

/** Keep fully certified legacy independent Runs legible after checkpoint bookkeeping failed. */
export function legacyIndependentCheckpointFailure(sequence: PresentedSequence, run: PresentedRun, steps: PresentedStep[]): boolean {
  return sequence.pullRequestStrategy === "independent_after_each_step" && run.status === "FAILED" &&
    steps.length === sequence.steps.length && steps.every((step, index) =>
      step.status === "SUCCESS" && step.stepId === sequence.steps[index]?.id);
}

export function sequencePresentationStatus(sequence: PresentedSequence, run: PresentedRun, steps: PresentedStep[]): string {
  if (legacyIndependentCheckpointFailure(sequence, run, steps)) return "SUCCESS";
  return run.status === "CANCELLED" && run.pauseRequested ? "PAUSED" : run.status;
}

export function successfulSequencePrefixLength(steps: PresentedStep[], sequence: Pick<PresentedSequence, "steps">): number {
  let length = 0;
  for (const [index, step] of steps.entries()) {
    const definition = sequence.steps[index];
    if (step.status !== "SUCCESS" || step.stepId !== definition?.id || step.stepName !== definition?.name) break;
    length++;
  }
  return length;
}
