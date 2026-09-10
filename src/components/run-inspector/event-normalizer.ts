import type { RunEvent } from "@db/schema";
import type {
  ActivityState,
  AgentMessageActivity,
  ErrorActivity,
  FallbackActivity,
  FileChange,
  NormalizedRunActivity,
  SubagentState,
} from "./types";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseJson(value: string | null) {
  if (!value) return null;
  try { return JSON.parse(value) as unknown; }
  catch { return null; }
}

function semanticMessage(value: string) {
  const parsed = parseJson(value);
  const object = record(parsed);
  if (!object) return { text: value };
  const summary = text(object.summary);
  if (!summary) return { text: value };
  return {
    text: summary,
    structuredStatus: text(object.status),
    blockingError: text(object.blocking_error),
  };
}

function readableReasoning(value: string) {
  return value.split(/\r?\n/).map((line) => line.replace(/^\*\*(.+)\*\*$/, "$1")).join("\n").trim();
}

function stateFromStatus(status: unknown, eventType: string): ActivityState {
  if (status === "failed" || status === "errored") return "failed";
  if (status === "in_progress" || eventType === "item.started") return "running";
  if (status === "completed" || eventType === "item.completed") return "success";
  return "neutral";
}

function relativePath(value: string, worktreePath?: string | null) {
  if (!worktreePath) return value;
  const normalizedValue = value.replaceAll("/", "\\");
  const normalizedRoot = worktreePath.replaceAll("/", "\\").replace(/\\+$/, "");
  if (normalizedValue.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}\\`)) {
    return normalizedValue.slice(normalizedRoot.length + 1).replaceAll("\\", "/");
  }
  return value;
}

function normalizeAgentStates(value: unknown): SubagentState[] {
  const states = record(value);
  if (!states) return [];
  return Object.entries(states).map(([id, entry]) => {
    const state = record(entry);
    return { id, status: text(state?.status) ?? "unknown", message: text(state?.message) };
  });
}

function normalizeItem(
  event: RunEvent,
  raw: Record<string, unknown>,
  item: Record<string, unknown>,
  startedAt: string,
  worktreePath?: string | null,
): NormalizedRunActivity {
  const eventType = text(raw.type) ?? "item.unknown";
  const itemType = text(item.type) ?? "unknown";
  const itemId = text(item.id) ?? String(event.id);
  const base = {
    key: `item:${itemId}`,
    timestamp: startedAt,
    completedAt: eventType === "item.completed" ? event.timestamp : undefined,
    state: stateFromStatus(item.status, eventType),
    rawType: itemType,
  } as const;

  if (itemType === "agent_message") {
    const message = semanticMessage(text(item.text) ?? "Message Codex sans contenu.");
    return {
      ...base,
      kind: "agent-message",
      ...message,
      state: message.structuredStatus === "FAILURE" || message.blockingError ? "failed" : base.state,
    } satisfies AgentMessageActivity;
  }
  if (itemType === "reasoning") {
    return { ...base, kind: "reasoning", text: readableReasoning(text(item.text) ?? "Réflexion en cours…") };
  }
  if (itemType === "command_execution") {
    return {
      ...base,
      kind: "command",
      command: text(item.command) ?? "Commande non renseignée",
      output: text(item.aggregated_output),
      exitCode: number(item.exit_code),
      state: number(item.exit_code) != null && number(item.exit_code) !== 0 ? "failed" : base.state,
    };
  }
  if (itemType === "file_change") {
    const changes = Array.isArray(item.changes) ? item.changes.flatMap((entry): FileChange[] => {
      const change = record(entry);
      const path = text(change?.path);
      if (!path) return [];
      return [{ path: relativePath(path, worktreePath), kind: text(change?.kind) ?? "update" }];
    }) : [];
    return { ...base, kind: "file-change", changes };
  }
  if (itemType === "mcp_tool_call") {
    const error = text(record(item.error)?.message);
    return {
      ...base,
      kind: "tool",
      toolKind: "mcp",
      name: text(item.tool) ?? "Outil MCP",
      server: text(item.server),
      arguments: item.arguments,
      result: item.result,
      error,
      state: error ? "failed" : base.state,
    };
  }
  if (itemType === "web_search") {
    const query = text(item.query);
    return {
      ...base,
      kind: "tool",
      toolKind: "web-search",
      name: "Recherche web",
      summary: query || "Recherche en cours…",
      arguments: item.action,
    };
  }
  if (itemType === "collab_tool_call") {
    const threadIds = Array.isArray(item.receiver_thread_ids)
      ? item.receiver_thread_ids.filter((entry): entry is string => typeof entry === "string")
      : [];
    return {
      ...base,
      kind: "subagent",
      action: text(item.tool) ?? "collaboration",
      prompt: text(item.prompt),
      threadIds,
      agents: normalizeAgentStates(item.agents_states),
    };
  }
  if (itemType === "todo_list") {
    const items = Array.isArray(item.items) ? item.items.flatMap((entry) => {
      const todo = record(entry);
      const value = text(todo?.text);
      return value ? [{ text: value, completed: todo?.completed === true }] : [];
    }) : [];
    return { ...base, kind: "todo", items };
  }
  if (itemType === "error") {
    return {
      ...base,
      kind: "error",
      title: "Erreur Codex",
      message: text(item.message) ?? "Codex a signalé une erreur sans détail.",
      state: "failed",
    } satisfies ErrorActivity;
  }
  return {
    ...base,
    kind: "fallback",
    title: "Événement Codex",
    summary: text(item.text) ?? text(item.message) ?? itemType.replaceAll("_", " "),
    raw: raw,
  } satisfies FallbackActivity;
}

function normalizeCodexTopLevel(event: RunEvent, raw: Record<string, unknown>): NormalizedRunActivity | null {
  const type = text(raw.type) ?? "unknown";
  const base = { key: `event:${event.id}`, timestamp: event.timestamp, state: "neutral" as ActivityState, rawType: type };
  if (type === "thread.started") {
    const id = text(raw.thread_id);
    return { ...base, kind: "lifecycle", title: "Session Codex ouverte", detail: id ? `Thread ${id}` : undefined, state: "success" };
  }
  if (type === "turn.started") {
    return { ...base, kind: "lifecycle", title: "Codex a commencé le travail", state: "running" };
  }
  if (type === "turn.completed") {
    const usage = record(raw.usage);
    const input = number(usage?.input_tokens);
    const output = number(usage?.output_tokens);
    const reasoning = number(usage?.reasoning_output_tokens);
    const metadata = [
      input == null ? null : `${input.toLocaleString("fr-CA")} tokens en entrée`,
      output == null ? null : `${output.toLocaleString("fr-CA")} en sortie`,
      reasoning == null ? null : `${reasoning.toLocaleString("fr-CA")} de reasoning`,
    ].filter((entry): entry is string => Boolean(entry));
    return { ...base, kind: "lifecycle", title: "Tour Codex terminé", metadata, state: "success" };
  }
  if (type === "turn.failed") {
    return { ...base, kind: "error", title: "Tour Codex interrompu", message: text(record(raw.error)?.message) ?? "Le tour Codex a échoué.", state: "failed" };
  }
  if (type === "error") {
    return { ...base, kind: "error", title: "Erreur Codex", message: text(raw.message) ?? "Le flux Codex a signalé une erreur.", state: "failed" };
  }
  return { ...base, kind: "fallback", title: "Événement Codex", summary: type, raw };
}

function normalizeRunnerEvent(event: RunEvent): NormalizedRunActivity | null {
  const base = { key: `event:${event.id}`, timestamp: event.timestamp, rawType: event.type };
  if (event.type === "stdout" || event.type === "stderr" || event.type === "started") return null;
  if (event.type === "status") {
    const value = event.message;
    if (/^Queued$/i.test(value)) return { ...base, kind: "lifecycle", title: "Run mis en file", state: "pending" };
    if (/^Preparing isolated worktree/i.test(value)) return { ...base, kind: "lifecycle", title: "Préparation de l’environnement", detail: "Création d’un worktree Git isolé.", state: "running" };
    if (/^Starting Codex/i.test(value)) return { ...base, kind: "lifecycle", title: "Démarrage de Codex", detail: value.match(/\((.+?)\)/)?.[1], state: "running" };
    if (/^Validating Git changes/i.test(value)) return { ...base, kind: "lifecycle", title: "Validation et finalisation Git", detail: "Vérification des changements avant le commit.", state: "running" };
    if (/^Success$/i.test(value)) return { ...base, kind: "lifecycle", title: "Run terminé avec succès", state: "success" };
    if (/^Cancelled/i.test(value)) return { ...base, kind: "lifecycle", title: "Run annulé", detail: value.replace(/^Cancelled:?\s*/i, ""), state: "interrupted" };
    if (/^Failed/i.test(value)) return { ...base, kind: "error", title: "Run en échec", message: value.replace(/^Failed:?\s*/i, ""), state: "failed" };
    return { ...base, kind: "lifecycle", title: value, state: "neutral" };
  }
  if (event.type === "cleanup") {
    return { ...base, kind: "lifecycle", title: "Nettoyage du worktree", detail: event.message, state: /removed/i.test(event.message) ? "success" : "neutral" };
  }
  if (event.type === "termination") {
    return { ...base, kind: "lifecycle", title: "Arrêt de Codex", detail: event.message, state: "interrupted" };
  }
  return { ...base, kind: "fallback", title: "Événement AgentTasker", summary: event.message, raw: event.rawPayload ?? event.message, state: "neutral" };
}

export function normalizeRunEvents(events: RunEvent[], options: { worktreePath?: string | null; terminal?: boolean } = {}) {
  const activities: NormalizedRunActivity[] = [];
  const itemIndexes = new Map<string, number>();

  for (const event of events) {
    const parsed = event.type === "codex" ? parseJson(event.rawPayload ?? event.message) : null;
    const raw = record(parsed);
    if (raw && /^item\.(?:started|updated|completed)$/.test(text(raw.type) ?? "")) {
      const item = record(raw.item);
      if (!item) {
        activities.push({ key: `event:${event.id}`, kind: "fallback", timestamp: event.timestamp, state: "neutral", rawType: text(raw.type) ?? "item.unknown", title: "Événement Codex", raw });
        continue;
      }
      const itemId = text(item.id) ?? String(event.id);
      const index = itemIndexes.get(itemId);
      const startedAt = index == null ? event.timestamp : activities[index].timestamp;
      const normalized = normalizeItem(event, raw, item, startedAt, options.worktreePath);
      if (index == null) {
        itemIndexes.set(itemId, activities.length);
        activities.push(normalized);
      } else {
        activities[index] = normalized;
      }
      continue;
    }
    const normalized = raw ? normalizeCodexTopLevel(event, raw) : normalizeRunnerEvent(event);
    if (normalized) activities.push(normalized);
  }

  if (options.terminal) {
    for (const activity of activities) {
      if (activity.rawType === "status" && (activity.state === "running" || activity.state === "pending")) {
        activity.state = "success";
      } else if (activity.rawType === "turn.started" && activities.some((entry) => entry.rawType === "turn.completed")) {
        activity.state = "success";
      } else if (activity.state === "running") {
        activity.state = "interrupted";
      }
    }
  } else {
    const completedTurn = activities.some((activity) => activity.rawType === "turn.completed");
    if (completedTurn) {
      for (const activity of activities) {
        if (activity.rawType === "turn.started") activity.state = "success";
      }
    }
  }
  return activities;
}

export function parseRunResult(value: string | null) {
  if (!value) return null;
  const parsed = parseJson(value);
  const object = record(parsed);
  return {
    status: text(object?.status),
    summary: text(object?.summary) ?? value,
    blockingError: text(object?.blocking_error),
  };
}
