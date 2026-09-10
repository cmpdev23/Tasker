import os from "node:os";
import path from "node:path";

export const RUNNER_CONFIG = {
  tickMs: 2_000,
  timeoutMs: 3 * 60 * 60 * 1_000,
  maximumConcurrentRuns: 1,
  dataDirectory: process.env.AGENTTASKER_DATA_DIR || path.join(
    process.platform === "win32" ? process.env.LOCALAPPDATA || os.homedir()
      : process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support")
        : process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
    "AgentTasker"),
} as const;
