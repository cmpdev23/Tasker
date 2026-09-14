import { test } from "node:test";
import assert from "node:assert/strict";
import type { RunEvent } from "../db/schema";
import { normalizeRunEvents, parseRunResult } from "../src/components/run-inspector/event-normalizer";
import { changedFileCount, displayModel, resolvedExecutionConfig } from "../src/components/run-inspector/execution-config";
import { isRemovableRun, isRerunnableRun } from "../src/components/task-ui-utils";

function event(id: number, type: string, payload: unknown, timestamp = `2026-09-10T12:00:${String(id).padStart(2, "0")}.000Z`): RunEvent {
  const rawPayload = payload == null ? null : JSON.stringify(payload);
  return { id, runId: "run-1", timestamp, type, message: rawPayload ?? "", rawPayload };
}

test("normalization merges an item lifecycle and extracts semantic command data", () => {
  const activities = normalizeRunEvents([
    event(1, "codex", { type: "item.started", item: { id: "item-1", type: "command_execution", command: "npm test", aggregated_output: "", status: "in_progress" } }),
    event(2, "codex", { type: "item.completed", item: { id: "item-1", type: "command_execution", command: "npm test", aggregated_output: "55 tests passed", exit_code: 0, status: "completed" } }),
  ]);
  assert.equal(activities.length, 1);
  assert.deepEqual(activities[0], {
    key: "item:item-1",
    kind: "command",
    timestamp: "2026-09-10T12:00:01.000Z",
    completedAt: "2026-09-10T12:00:02.000Z",
    state: "success",
    rawType: "command_execution",
    command: "npm test",
    output: "55 tests passed",
    exitCode: 0,
  });
});

test("normalization handles messages, worktree paths, subagents and future item types", () => {
  const root = "C:\\runtime\\worktree";
  const activities = normalizeRunEvents([
    event(1, "stdout", "raw duplicate"),
    event(2, "codex", { type: "item.completed", item: { id: "m", type: "agent_message", text: JSON.stringify({ status: "SUCCESS", summary: "Travail terminé", blocking_error: null }) } }),
    event(3, "codex", { type: "item.completed", item: { id: "f", type: "file_change", changes: [{ path: `${root}\\src\\app.tsx`, kind: "update" }], status: "completed" } }),
    event(4, "codex", { type: "item.completed", item: { id: "s", type: "collab_tool_call", tool: "spawn_agent", receiver_thread_ids: ["thread-child"], agents_states: { "thread-child": { status: "running", message: null } }, status: "completed" } }),
    event(5, "codex", { type: "item.completed", item: { id: "future", type: "new_codex_item", text: "Useful summary" } }),
  ], { worktreePath: root });
  assert.deepEqual(activities.map((activity) => activity.kind), ["agent-message", "file-change", "subagent", "fallback"]);
  assert.equal(activities[0].kind === "agent-message" && activities[0].text, "Travail terminé");
  assert.equal(activities[1].kind === "file-change" && activities[1].changes[0].path, "src/app.tsx");
  assert.equal(activities[2].kind === "subagent" && activities[2].agents[0].status, "running");
  assert.equal(activities[3].kind === "fallback" && activities[3].summary, "Useful summary");
});

test("terminal runs never leave incomplete items visually running", () => {
  const activities = normalizeRunEvents([
    event(1, "codex", { type: "item.started", item: { id: "orphan", type: "collab_tool_call", tool: "spawn_agent", status: "in_progress", receiver_thread_ids: [], agents_states: {} } }),
  ], { terminal: true });
  assert.equal(activities[0].state, "interrupted");
});

test("run result and execution snapshot helpers tolerate structured and malformed data", () => {
  assert.deepEqual(parseRunResult(JSON.stringify({ status: "FAILURE", summary: "Build failed", blocking_error: "Exit 1" })), {
    status: "FAILURE",
    summary: "Build failed",
    blockingError: "Exit 1",
  });
  assert.equal(parseRunResult("plain result")?.summary, "plain result");
  assert.equal(displayModel("gpt-5.6-terra"), "GPT-5.6 Terra");
  assert.equal(resolvedExecutionConfig("not-json").model, null);
  assert.equal(changedFileCount("?? src/new.ts\n M src/old.ts\n\n"), 2);
});

test("execution snapshot exposes runner-owned preparation and validation settings", () => {
  const config = resolvedExecutionConfig(JSON.stringify({
    timeoutMs: 14_400_000,
    execution: {
      packageManager: "npm",
      installDependencies: true,
      installTimeoutMinutes: 15,
      validationScripts: ["lint", "build"],
      validationTimeoutMinutes: 20,
    },
    sequence: { pullRequestStrategy: "after_each_step" },
  }));
  assert.equal(config.packageManager, "npm");
  assert.equal(config.installDependencies, true);
  assert.deepEqual(config.validationScripts, ["lint", "build"]);
  assert.equal(config.timeoutMs, 14_400_000);
  assert.equal(config.sequencePullRequestStrategy, "after_each_step");
});

test("only failed Runs expose the rerun action", () => {
  assert.equal(isRerunnableRun("FAILED"), true);
  for (const status of ["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "SUCCESS", "CANCELLED"]) {
    assert.equal(isRerunnableRun(status), false);
  }
});

test("queued and safely confirmable terminal Runs expose removal, including preserved Git work", () => {
  const run = { status: "QUEUED", terminationVerified: true, codexPid: null, worktreePath: null, runBranch: null };
  assert.equal(isRemovableRun(run), true);
  assert.equal(isRemovableRun({ ...run, status: "CANCELLED" }), true);
  assert.equal(isRemovableRun({ ...run, status: "FAILED", terminationVerified: false }), true);
  assert.equal(isRemovableRun({ ...run, status: "FAILED", terminationVerified: false, codexPid: 42 }), false);
  assert.equal(isRemovableRun({ ...run, status: "FAILED", worktreePath: "C:\\preserved" }), true);
  assert.equal(isRemovableRun({ ...run, status: "SUCCESS", runBranch: "tasker/preserved" }), true);
  for (const status of ["PREPARING", "RUNNING", "VALIDATING"]) {
    assert.equal(isRemovableRun({ ...run, status }), false);
  }
});
