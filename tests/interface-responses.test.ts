import assert from "node:assert/strict";
import { test } from "node:test";
import { environmentDraft, environmentPayload } from "../src/modules/projects/settings/environment-draft";
import { requireQueue, requireRun } from "../src/modules/runs/run-response";
import { requireTask } from "../src/modules/tasks/task-response";
import { requireSequence } from "../src/modules/sequences/sequence-response";

test("a configured environment value stays omitted on an empty save and is never copied from a response", () => {
  const draft = environmentDraft([{ name: "TEST_KEY", configured: true, value: "synthetic-private-value" } as never]);
  assert.equal(draft[0].value, "");
  assert.deepEqual(environmentPayload(draft), [{ name: "TEST_KEY" }]);
  assert.deepEqual(environmentPayload([{ ...draft[0], value: "replacement" }]), [{ name: "TEST_KEY", value: "replacement" }]);
  assert.deepEqual(environmentPayload([{ ...draft[0], name: "RENAMED", configured: false }]), [{ name: "RENAMED", value: "" }]);
  assert.deepEqual(environmentPayload([]), []);
});

test("mutation contracts reject partial or cross-project responses before reconciliation", () => {
  assert.throws(() => requireRun({ id: "r", projectId: "another" } as never, "current"));
  for (const invalid of [null, {}, { id: "x" }]) {
    assert.throws(() => requireQueue(invalid));
    assert.throws(() => requireTask(invalid as never));
    assert.throws(() => requireSequence(invalid as never));
  }
  for (const state of ["BLOCKED_RECOVERY", "BLOCKED_PROCESS", "RECOVERY_REQUIRED"]) {
    const queue = { state, queuedCount: state === "RECOVERY_REQUIRED" ? 0 : 1, position: null, blocker: { id: "r", projectId: "p" }, canRecover: state !== "BLOCKED_PROCESS" };
    assert.equal(requireQueue(queue), queue);
  }
});
