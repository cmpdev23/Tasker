export const CODEX_REASONING_EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export const CODEX_REASONING_SUMMARIES = [
  "auto",
  "concise",
  "detailed",
  "none",
] as const;

export const CODEX_VERBOSITIES = ["low", "medium", "high"] as const;

export const CODEX_SANDBOX_MODES = [
  "read-only",
  "workspace-write",
  "danger-full-access",
] as const;

export const CODEX_APPROVAL_POLICIES = ["on-request", "never"] as const;

export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];
export type CodexReasoningSummary =
  (typeof CODEX_REASONING_SUMMARIES)[number];
export type CodexVerbosity = (typeof CODEX_VERBOSITIES)[number];
export type CodexSandboxMode = (typeof CODEX_SANDBOX_MODES)[number];
export type CodexApprovalPolicy = (typeof CODEX_APPROVAL_POLICIES)[number];

export interface CodexSubagentDefaults {
  enabled: boolean;
  max_concurrent_threads_per_session: number | null;
  default_subagent_model: string;
  default_subagent_reasoning_effort: CodexReasoningEffort | "";
  interrupt_message: boolean;
}

export interface MainCodexAgentConfig {
  model: string;
  model_reasoning_effort: CodexReasoningEffort;
  model_reasoning_summary: CodexReasoningSummary;
  model_verbosity: CodexVerbosity;
  sandbox_mode: CodexSandboxMode;
  approval_policy: CodexApprovalPolicy;
  sandbox_workspace_write: {
    network_access: boolean;
  };
  agents: CodexSubagentDefaults;
}

export interface CodexSubagentConfig {
  id: string;
  name: string;
  description: string;
  developer_instructions: string;
  model: string;
  model_reasoning_effort: CodexReasoningEffort | "";
  sandbox_mode: CodexSandboxMode | "";
  filePath: string;
}

export interface CodexModelOption {
  id: string;
  model: string;
  displayName: string;
  defaultReasoningEffort: CodexReasoningEffort | null;
  supportedReasoningEfforts: Array<{
    reasoningEffort: CodexReasoningEffort;
    description: string;
  }>;
  isDefault: boolean;
}

export interface CodexAgentsResponse {
  main: MainCodexAgentConfig;
  mainFileExists: boolean;
  mainFilePath: string;
  subagents: CodexSubagentConfig[];
  models: CodexModelOption[];
  modelDiscoveryError: string | null;
}
