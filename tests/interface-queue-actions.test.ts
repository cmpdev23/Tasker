import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import type { RunQueueStatus } from "../src/types/run-queue";
import { useQueueActions } from "../src/modules/runs/use-queue-actions";

test("queue actions require confirmation, reject process blockers and serialize recovery/deletion", async (t) => {
  // Exercise the imperative action cycle; rendering and actual confirmations are checked in the browser.
  t.mock.method(React, "useRef", (current: unknown) => ({ current }));
  t.mock.method(React, "useState", (initial: unknown) => [initial, () => {}]);
  const queue = {
    state: "BLOCKED_RECOVERY", queuedCount: 1, position: null, canRecover: true,
    blocker: { id: "blocker", projectId: "another-project", taskId: "t", taskName: "Task", status: "FAILED", queuedAt: "2026-01-01", startedAt: null, codexPid: null },
  } satisfies RunQueueStatus;
  const fresh = { state: "READY", queuedCount: 1, position: null, blocker: null, canRecover: false } satisfies RunQueueStatus;
  let requests = 0;
  let resolve!: (response: Response) => void;
  t.mock.method(globalThis, "fetch", () => { requests++; return new Promise<Response>(done => { resolve = done; }); });
  const applied: unknown[] = [];
  const action = useQueueActions(async (request, apply) => apply(await request()), value => applied.push(value));
  let confirmations = 0;
  const confirm = () => { confirmations++; return true; };
  const apply = () => { applied.push("local"); };
  await action.execute("delete", { ...queue, state: "BLOCKED_PROCESS", canRecover: true }, confirm, apply);
  await action.execute("recover", { ...queue, canRecover: false }, confirm, apply);
  await action.execute("recover", queue, () => false, apply);
  assert.equal(requests, 0); assert.equal(confirmations, 0);
  const pending = action.execute("recover", queue, confirm, apply);
  await action.execute("delete", queue, confirm, apply);
  assert.equal(requests, 1); assert.equal(confirmations, 1);
  resolve(Response.json({ run: { id: "blocker", projectId: "another-project" }, queue: fresh })); await pending;
  assert.deepEqual(applied, [fresh, "local"], "global queue is reconciled before local effects");
  const preventive = action.execute("delete", { ...queue, state: "RECOVERY_REQUIRED", queuedCount: 0 }, confirm, apply);
  resolve(Response.json({ run: { id: "blocker", projectId: "another-project" }, queue: {} })); await preventive;
  assert.equal(requests, 2); assert.equal(confirmations, 2);
  assert.deepEqual(applied, [fresh, "local"], "an invalid response cannot remove the blocker locally");
  const unrelated = action.execute("recover", queue, confirm, apply);
  resolve(Response.json({ run: { id: "another-run", projectId: "another-project" }, queue: fresh })); await unrelated;
  assert.deepEqual(applied, [fresh, "local"], "a response for another run cannot update the queue");
  const failed = action.execute("recover", queue, confirm, apply);
  resolve(Response.json({ error: "Fixture network failure" }, { status: 503 })); await failed;
  assert.deepEqual(applied, [fresh, "local"]);
});
