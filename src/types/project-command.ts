/** Runner-owned metadata, independent of the Codex JSONL protocol. No environment values. */
export interface ProjectCommandReport {
  kind: "project-command";
  phase: "preparation" | "validation";
  command: string;
  status: "running" | "success" | "failed" | "cancelled" | "timed-out";
  exitCode: number | null;
  durationMs: number | null;
  error: string | null;
}
