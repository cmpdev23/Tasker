import { SEQUENCE_FAILURE_POLICIES, SEQUENCE_PULL_REQUEST_STRATEGIES, type SequenceDefinition } from "@/types/sequences";

export function requireSequence(sequence: SequenceDefinition | undefined): SequenceDefinition {
  if (!sequence?.id || typeof sequence.name !== "string" ||
      !SEQUENCE_PULL_REQUEST_STRATEGIES.includes(sequence.pullRequestStrategy) ||
      !SEQUENCE_FAILURE_POLICIES.includes(sequence.failurePolicy) ||
      !Number.isInteger(sequence.maxConsecutiveFailures) || !Array.isArray(sequence.steps) ||
      sequence.steps.some(step => !step?.id || typeof step.name !== "string" ||
        typeof step.instructions !== "string" || typeof step.expectChanges !== "boolean")) {
    throw new Error("Réponse de la Sequence invalide. Vérifiez la liste avant de réessayer.");
  }
  return sequence;
}
