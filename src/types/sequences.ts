export const SEQUENCE_PULL_REQUEST_STRATEGIES = ["after_sequence", "after_each_step", "independent_after_each_step"] as const;
export type SequencePullRequestStrategy = typeof SEQUENCE_PULL_REQUEST_STRATEGIES[number];
export const DEFAULT_SEQUENCE_PULL_REQUEST_STRATEGY: SequencePullRequestStrategy = "after_sequence";

export const SEQUENCE_FAILURE_POLICIES = ["stop", "continue"] as const;
export type SequenceFailurePolicy = typeof SEQUENCE_FAILURE_POLICIES[number];
export const DEFAULT_SEQUENCE_FAILURE_POLICY: SequenceFailurePolicy = "stop";
export const DEFAULT_SEQUENCE_MAX_CONSECUTIVE_FAILURES = 2;

export interface SequenceStepDefinition {
  id: string;
  name: string;
  /** Markdown content, never a filesystem path. */
  instructions: string;
  expectChanges: boolean;
}

export interface SequenceDefinition {
  id: string;
  name: string;
  pullRequestStrategy: SequencePullRequestStrategy;
  /** Used only by independent per-step publication. */
  failurePolicy: SequenceFailurePolicy;
  maxConsecutiveFailures: number;
  /** Ordered execution list owned by this Sequence. */
  steps: SequenceStepDefinition[];
}

/** Full replacement for create/update; the service owns the immutable ID. */
export type SequenceInput = Pick<SequenceDefinition, "name"> & {
  pullRequestStrategy?: SequencePullRequestStrategy;
  failurePolicy?: SequenceFailurePolicy;
  maxConsecutiveFailures?: number;
};
export type SequenceStepInput = Omit<SequenceStepDefinition, "id">;
