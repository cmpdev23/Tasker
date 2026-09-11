import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunEvent } from "../db/schema";
import type { ProjectCommandReport } from "../src/types/project-command";
import { projectCommandActivities } from "../src/components/run-inspector/project-command-events";

function event(id: number, type: string, message: string, payload?: unknown): RunEvent {
  return { id, runId: "fixture", timestamp: "2026-09-11T12:46:00Z", type, message,
    rawPayload: payload ? JSON.stringify(payload) : null };
}

test("historical build failure shows its own exit code and logs separately from Codex", () => {
  const events = [
    event(511, "preparation", "Starting Install dependencies: npm ci"),
    event(512, "stdout", "[preparation] installed\n"),
    event(522, "preparation", "Completed Install dependencies: npm ci"),
    event(523, "stdout", '{"type":"item.completed"}'),
    event(740, "validation", "Starting Validate package script: build: npm run build"),
    event(742, "stderr", '[validation] You are using a non-standard "NODE_ENV" value\n'),
    event(785, "stderr", "[validation] TypeError: Cannot read properties of null (reading 'useContext')\n"),
  ];
  const commands = projectCommandActivities(events, { status: "FAILED", error: "npm run build exited with code 1." });
  assert.deepEqual(commands.map(({ command, status, exitCode }) => ({ command, status, exitCode })), [
    { command: "npm ci", status: "success", exitCode: 0 },
    { command: "npm run build", status: "failed", exitCode: 1 },
  ]);
  assert.equal(commands[0].output, "installed\n");
  assert.match(commands[1].output, /NODE_ENV/);
  assert.match(commands[1].output, /useContext/);
  assert.doesNotMatch(commands[1].output, /item.completed|installed/);
});

test("structured command results preserve live state, exit codes, errors and timeouts", () => {
  const base: ProjectCommandReport = { kind: "project-command", command: "pnpm run build:site", phase: "validation",
    status: "running", exitCode: null, durationMs: null, error: null };
  const events = [event(1, "validation", "localized message", base), event(2, "stdout", "[validation] page built\n")];
  assert.equal(projectCommandActivities(events, { status: "VALIDATING", error: null })[0].status, "running");
  for (const status of ["success", "failed", "cancelled", "timed-out"] as const) {
    const terminal = { ...base, status, exitCode: status === "success" ? 0 : status === "failed" ? 2 : null,
      durationMs: 1500, error: status === "failed" ? "exit 2" : null };
    const commands = projectCommandActivities([...events, event(3, "validation", "result", terminal)], {
      status: status === "success" ? "SUCCESS" : "FAILED", error: null,
    });
    assert.equal(commands.length, 1);
    assert.equal(commands[0].status, status);
    assert.equal(commands[0].exitCode, terminal.exitCode);
    assert.equal(commands[0].durationMs, 1500);
    assert.equal(commands[0].output, "page built\n");
  }
});

test("missing results never become successes and malformed payloads fall back safely", () => {
  const events = [event(1, "validation", "Starting Validate package script: build: npm run build", { kind: "project-command" })];
  assert.equal(projectCommandActivities(events, { status: "FAILED", error: "Server stopped" })[0].status, "interrupted");
  assert.equal(projectCommandActivities(events, { status: "SUCCESS", error: null })[0].status, "interrupted");
  assert.equal(projectCommandActivities(events, { status: "CANCELLED", error: null })[0].status, "cancelled");
  assert.deepEqual(projectCommandActivities([event(1, "validation", "unknown", [])], { status: "FAILED", error: null }), []);
});

test("output tails are bounded and do not mix multiple validation scripts", () => {
  const commands = projectCommandActivities([
    event(1, "validation", "Starting Validate package script: lint: npm run lint"),
    event(2, "stdout", "[validation] lint passed"),
    event(3, "validation", "Completed Validate package script: lint: npm run lint"),
    event(4, "validation", "Starting Validate package script: build: npm run build"),
    event(5, "stderr", `[validation] ${"x".repeat(20_000)}\nactual build error`),
  ], { status: "FAILED", error: "npm run build exited with code 1." });
  assert.equal(commands[0].output, "lint passed");
  assert.equal(commands[1].output.length, 12_000);
  assert.equal(commands[1].outputTruncated, true);
  assert.ok(commands[1].output.endsWith("actual build error"));
});
