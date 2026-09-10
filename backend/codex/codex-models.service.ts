import { spawn } from "node:child_process";
import { resolveCodexExecutable } from "./codex-executable";
import { createInterface } from "node:readline";
import {
  CODEX_REASONING_EFFORTS,
  type CodexModelOption,
  type CodexReasoningEffort,
} from "../../src/types/codex-agents";

interface AppServerModel {
  id?: unknown;
  model?: unknown;
  displayName?: unknown;
  defaultReasoningEffort?: unknown;
  supportedReasoningEfforts?: unknown;
  isDefault?: unknown;
  hidden?: unknown;
}

interface AppServerMessage {
  id?: number;
  result?: {
    data?: AppServerModel[];
    nextCursor?: string | null;
  };
  error?: {
    message?: string;
  };
}

const CACHE_DURATION_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

function isReasoningEffort(value: unknown): value is CodexReasoningEffort {
  return CODEX_REASONING_EFFORTS.includes(value as CodexReasoningEffort);
}

function normalizeModel(model: AppServerModel): CodexModelOption | null {
  const id = typeof model.id === "string" ? model.id : null;
  const modelSlug = typeof model.model === "string" ? model.model : id;

  if (!id || !modelSlug || model.hidden === true) {
    return null;
  }

  const supportedReasoningEfforts = Array.isArray(
    model.supportedReasoningEfforts
  )
    ? model.supportedReasoningEfforts.flatMap((entry) => {
        if (!entry || typeof entry !== "object") {
          return [];
        }
        const value = entry as {
          reasoningEffort?: unknown;
          description?: unknown;
        };
        if (!isReasoningEffort(value.reasoningEffort)) {
          return [];
        }
        return [
          {
            reasoningEffort: value.reasoningEffort,
            description:
              typeof value.description === "string" ? value.description : "",
          },
        ];
      })
    : [];

  return {
    id,
    model: modelSlug,
    displayName:
      typeof model.displayName === "string" ? model.displayName : modelSlug,
    defaultReasoningEffort: isReasoningEffort(model.defaultReasoningEffort)
      ? model.defaultReasoningEffort
      : null,
    supportedReasoningEfforts,
    isDefault: model.isDefault === true,
  };
}

export class CodexModelsService {
  private cache: { expiresAt: number; models: CodexModelOption[] } | null = null;
  private pendingRequest: Promise<CodexModelOption[]> | null = null;

  async listAvailableModels(): Promise<CodexModelOption[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.models;
    }

    if (this.pendingRequest) {
      return this.pendingRequest;
    }

    this.pendingRequest = this.fetchModels();
    try {
      const models = await this.pendingRequest;
      this.cache = {
        expiresAt: Date.now() + CACHE_DURATION_MS,
        models,
      };
      return models;
    } finally {
      this.pendingRequest = null;
    }
  }

  private fetchModels(): Promise<CodexModelOption[]> {
    return new Promise((resolve, reject) => {
      const child = spawn(resolveCodexExecutable(), ["app-server"], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const lines = createInterface({ input: child.stdout });
      const models: CodexModelOption[] = [];
      let requestId = 1;
      let settled = false;
      let stderr = "";

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        lines.close();
        child.kill();
        if (error) {
          reject(error);
        } else {
          const uniqueModels = Array.from(
            new Map(models.map((model) => [model.model, model])).values()
          );
          resolve(uniqueModels);
        }
      };

      const send = (message: unknown) => {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      };

      const requestModels = (cursor?: string) => {
        requestId += 1;
        send({
          method: "model/list",
          id: requestId,
          params: {
            limit: 100,
            includeHidden: false,
            ...(cursor ? { cursor } : {}),
          },
        });
      };

      const timeout = setTimeout(() => {
        finish(new Error("Codex model discovery timed out."));
      }, REQUEST_TIMEOUT_MS);

      child.stderr.on("data", (chunk: Buffer) => {
        if (stderr.length < 2_000) {
          stderr += chunk.toString("utf8");
        }
      });

      child.on("error", (error) => {
        finish(
          new Error(
            `Codex CLI is unavailable: ${error instanceof Error ? error.message : String(error)}`
          )
        );
      });

      child.on("exit", (code) => {
        if (!settled) {
          const detail = stderr.trim() ? ` ${stderr.trim()}` : "";
          finish(
            new Error(`Codex app-server exited with code ${code ?? "unknown"}.${detail}`)
          );
        }
      });

      lines.on("line", (line) => {
        let message: AppServerMessage;
        try {
          message = JSON.parse(line) as AppServerMessage;
        } catch {
          return;
        }

        if (message.error?.message) {
          finish(new Error(message.error.message));
          return;
        }

        if (message.id === 1) {
          send({ method: "initialized", params: {} });
          requestModels();
          return;
        }

        if (message.id === requestId && message.result) {
          for (const entry of message.result.data ?? []) {
            const normalized = normalizeModel(entry);
            if (normalized) models.push(normalized);
          }

          if (message.result.nextCursor) {
            requestModels(message.result.nextCursor);
          } else {
            finish();
          }
        }
      });

      send({
        method: "initialize",
        id: 1,
        params: {
          clientInfo: {
            name: "agenttasker",
            title: "AgentTasker",
            version: "0.1.0",
          },
        },
      });
    });
  }
}

export const codexModelsService = new CodexModelsService();
