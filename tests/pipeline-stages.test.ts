import assert from "node:assert/strict";
import { test } from "node:test";
import { pipelineStages } from "../src/modules/runs/run-inspector/pipeline-stages";

const command = (phase: "preparation" | "validation", status: "running" | "success" | "failed") => ({
  id: 1, kind: "project-command" as const, phase, command: "npm run check", status,
  exitCode: status === "success" ? 0 : status === "failed" ? 1 : null,
  durationMs: null, error: status === "failed" ? "exit 1" : null, output: "", outputTruncated: false,
});

function run(overrides: Record<string, unknown> = {}) {
  return {
    status: "SUCCESS", exitCode: 0, result: JSON.stringify({ status: "SUCCESS", summary: "Done" }), error: null,
    commitHash: "abc123", pushedAt: null, pullRequestUrl: null, worktreePath: "C:\\worktree",
    resolvedConfig: JSON.stringify({ git: { push: false, createPullRequest: false } }), ...overrides,
  } as never;
}

test("pipeline exposes the deterministic success path in execution order", () => {
  const stages = pipelineStages(run(), [command("preparation", "success"), command("validation", "success")]);
  assert.deepEqual(stages.map(({ id, status }) => [id, status]), [
    ["environment", "success"], ["codex", "success"], ["validation", "success"], ["git", "success"], ["publication", "skipped"],
  ]);
});

test("pipeline stops at a failed validation without presenting Git as complete", () => {
  const stages = pipelineStages(run({ status: "FAILED", commitHash: null }), [command("validation", "failed")]);
  assert.equal(stages.find((stage) => stage.id === "codex")?.status, "success");
  assert.equal(stages.find((stage) => stage.id === "validation")?.status, "failed");
  assert.equal(stages.find((stage) => stage.id === "git")?.status, "pending");
});

test("a Sequence step identifies its prepared environment as shared", () => {
  const stages = pipelineStages(run({ status: "RUNNING", exitCode: null, result: null, commitHash: null }), [], true);
  assert.equal(stages[0].status, "success");
  assert.equal(stages[1].status, "running");
});
