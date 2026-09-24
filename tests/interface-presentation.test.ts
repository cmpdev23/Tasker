import assert from "node:assert/strict";
import { test } from "node:test";
import { taskState } from "../src/modules/tasks/task-presentation";
import { scheduleInstant } from "../src/modules/tasks/schedule-presentation";
import { legacyIndependentCheckpointFailure, sequencePresentationStatus, successfulSequencePrefixLength } from "../src/modules/sequences/sequence-presentation";

test("Task schedule input rejects Toronto DST gaps and overlaps", () => {
  assert.equal(scheduleInstant("2026-03-08T03:30", "America/Toronto"), "2026-03-08T07:30:00.000Z");
  assert.throws(() => scheduleInstant("2026-03-08T02:30", "America/Toronto"), /n’existe pas/);
  assert.throws(() => scheduleInstant("2026-11-01T01:30", "America/Toronto"), /deux fois/);
});

test("Task state keeps active Runs visible even when the Task is disabled", () => {
  assert.equal(taskState({ enabled: false }, { status: "RUNNING" }).label, "Running");
  assert.equal(taskState({ enabled: false }, { status: "SUCCESS" }).label, "Disabled");
  assert.equal(taskState({ enabled: true }, undefined).label, "Pending");
});

test("Sequence presentation certifies only an ordered matching prefix", () => {
  const sequence = {
    pullRequestStrategy: "independent_after_each_step" as const,
    steps: [{ id: "a", name: "First" }, { id: "b", name: "Second" }],
  };
  const first = { stepId: "a", stepName: "First", status: "SUCCESS" };
  const second = { stepId: "b", stepName: "Second", status: "SUCCESS" };
  assert.equal(successfulSequencePrefixLength([first, second], sequence), 2);
  assert.equal(successfulSequencePrefixLength([first, { ...second, stepName: "Renamed" }], sequence), 1);
  assert.equal(successfulSequencePrefixLength([{ ...first, status: "FAILED" }, second], sequence), 0);

  const failedRun = { status: "FAILED", pauseRequested: false };
  assert.equal(legacyIndependentCheckpointFailure(sequence, failedRun, [first, second]), true);
  assert.equal(sequencePresentationStatus(sequence, failedRun, [first, second]), "SUCCESS");
  assert.equal(sequencePresentationStatus(sequence, failedRun, [first]), "FAILED");
  assert.equal(sequencePresentationStatus(sequence, { status: "CANCELLED", pauseRequested: true }, [first]), "PAUSED");
});
