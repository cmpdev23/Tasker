export type ActivityState = "pending" | "running" | "success" | "failed" | "interrupted" | "neutral";

export interface ActivityBase {
  key: string;
  kind: string;
  timestamp: string;
  completedAt?: string;
  state: ActivityState;
  rawType: string;
}

export interface LifecycleActivity extends ActivityBase {
  kind: "lifecycle";
  title: string;
  detail?: string;
  metadata?: string[];
}

export interface AgentMessageActivity extends ActivityBase {
  kind: "agent-message";
  text: string;
  structuredStatus?: string;
  blockingError?: string;
}

export interface ReasoningActivity extends ActivityBase {
  kind: "reasoning";
  text: string;
}

export interface CommandActivity extends ActivityBase {
  kind: "command";
  command: string;
  output?: string;
  exitCode?: number;
}

export interface FileChange {
  path: string;
  kind: "add" | "delete" | "update" | string;
}

export interface FileChangeActivity extends ActivityBase {
  kind: "file-change";
  changes: FileChange[];
}

export interface ToolActivity extends ActivityBase {
  kind: "tool";
  toolKind: "mcp" | "web-search";
  name: string;
  server?: string;
  summary?: string;
  arguments?: unknown;
  result?: unknown;
  error?: string;
}

export interface SubagentState {
  id: string;
  status: string;
  message?: string;
}

export interface SubagentActivity extends ActivityBase {
  kind: "subagent";
  action: string;
  prompt?: string;
  threadIds: string[];
  agents: SubagentState[];
}

export interface TodoActivity extends ActivityBase {
  kind: "todo";
  items: Array<{ text: string; completed: boolean }>;
}

export interface ErrorActivity extends ActivityBase {
  kind: "error";
  title: string;
  message: string;
}

export interface FallbackActivity extends ActivityBase {
  kind: "fallback";
  title: string;
  summary?: string;
  raw: unknown;
}

export type NormalizedRunActivity =
  | LifecycleActivity
  | AgentMessageActivity
  | ReasoningActivity
  | CommandActivity
  | FileChangeActivity
  | ToolActivity
  | SubagentActivity
  | TodoActivity
  | ErrorActivity
  | FallbackActivity;

