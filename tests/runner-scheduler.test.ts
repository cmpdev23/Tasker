import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { isolatedRunner } from "./helpers/runner";

let fixture: Awaited<ReturnType<typeof isolatedRunner>>;
before(async () => { fixture = await isolatedRunner(); });
beforeEach(() => { fixture.reset(); });
after(() => { fixture?.close(); });
const daily = { type: "daily", timezone: "America/Toronto", time: "07:00" } as const;
async function evaluate(instant: string) {
  assert.deepEqual(await fixture.evaluateSchedules(new Date(instant)), []);
}

test("manual, disabled and future once tasks never queue; a due once task queues exactly once", async () => {
  const project = await fixture.project();
  await fixture.task(project.id, { type: "manual", timezone: "UTC" });
  await fixture.task(project.id, { type: "once", timezone: "UTC", startsAt: "2026-01-01T00:00:00Z" }, { enabled: false });
  await fixture.task(project.id, { type: "once", timezone: "UTC", startsAt: "2026-12-01T00:00:00Z" });
  const due = await fixture.task(project.id, { type: "once", timezone: "UTC", startsAt: "2026-09-01T11:00:00Z" });
  await evaluate("2026-09-10T12:00:00Z");
  const runs = fixture.runRepository.list(project.id);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].taskId, due.id);
  assert.equal(runs[0].scheduledAt, "2026-09-01T11:00:00.000Z");
  fixture.runRepository.update(runs[0].id, { status: "SUCCESS" });
  await evaluate("2026-09-11T12:00:00Z");
  assert.equal(fixture.runRepository.list(project.id).length, 1);
});

test("recurring registration establishes a baseline; downtime catches up only the latest occurrence", async () => {
  const project = await fixture.project();
  const task = await fixture.task(project.id, daily);
  await evaluate("2026-09-01T12:00:00Z");
  assert.equal(fixture.runRepository.list(project.id).length, 0);
  await evaluate("2026-09-10T12:00:00Z");
  const runs = fixture.runRepository.list(project.id, task.id);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].scheduledAt, "2026-09-10T11:00:00.000Z");
  await evaluate("2026-09-10T12:00:00Z");
  assert.equal(fixture.runRepository.list(project.id).length, 1);
});

test("archived projects stay recoverable locally but are excluded from the active list and scheduler", async () => {
  const { projectService } = await import("../backend/projects/project.service");
  const project = await fixture.project();
  await fixture.task(project.id, daily);
  await evaluate("2026-09-09T12:00:00Z");

  const archived = await projectService.updateProject(project.id, { archived: true });
  assert.ok(archived.archivedAt);
  assert.deepEqual(await projectService.listProjects(), []);
  assert.equal((await projectService.getProjectById(project.id)).archivedAt, archived.archivedAt);

  await evaluate("2026-09-10T12:00:00Z");
  assert.deepEqual(fixture.runRepository.list(project.id), []);
});

test("pending runs coalesce missed occurrences; finishing one permits the next scheduled day", async () => {
  const project = await fixture.project();
  const task = await fixture.task(project.id, daily);
  await evaluate("2026-09-01T12:00:00Z");
  const pending = await fixture.runService.enqueue(project.id, task.id);
  await evaluate("2026-09-10T12:00:00Z");
  await evaluate("2026-09-11T12:00:00Z");
  assert.deepEqual(fixture.runRepository.list(project.id).map(run => run.id), [pending.id]);
  fixture.runRepository.update(pending.id, { status: "SUCCESS" });
  await evaluate("2026-09-11T12:01:00Z");
  assert.equal(fixture.runRepository.list(project.id).length, 1, "Coalesced occurrences must not replay");
  await evaluate("2026-09-12T12:00:00Z");
  assert.equal(fixture.runRepository.list(project.id).length, 2);
  assert.equal(fixture.runRepository.list(project.id).find(run => run.id !== pending.id)?.scheduledAt, "2026-09-12T11:00:00.000Z");
});

test("simultaneous scheduler processes create a single occurrence and initial event", async () => {
  const project = await fixture.project();
  const task = await fixture.task(project.id, daily);
  await evaluate("2026-09-09T12:00:00Z");
  const results = await Promise.all(Array.from({ length: 4 }, () => fixture.child("evaluate", "2026-09-10T12:00:00Z")));
  assert.deepEqual(results, [[], [], [], []]);
  const runs = fixture.runRepository.list(project.id, task.id);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].scheduledAt, "2026-09-10T11:00:00.000Z");
  assert.equal(fixture.runRepository.events(runs[0].id).length, 1);
  fixture.runRepository.update(runs[0].id, { status: "SUCCESS" });
  // Rewind only the fixture cursor to exercise the persisted duplicate guard.
  fixture.sqlite.prepare("UPDATE scheduler_state SET evaluated_at = ? WHERE key = ?")
    .run("2026-09-09T12:00:00.000Z", `${project.id}/${task.id}`);
  await evaluate("2026-09-10T12:00:00Z");
  assert.equal(fixture.runRepository.list(project.id).length, 1);
});

test("scheduler transaction rolls back run, event and cursor together on a real DB constraint failure", async () => {
  const project = await fixture.project();
  const task = await fixture.task(project.id, daily);
  await evaluate("2026-09-09T12:00:00Z");
  // A SQLite trigger injects a storage failure, without replacing production functions.
  fixture.sqlite.exec("CREATE TEMP TRIGGER reject_test_event BEFORE INSERT ON run_events BEGIN SELECT RAISE(ABORT, 'test event storage failure'); END;");
  try {
    const errors = await fixture.evaluateSchedules(new Date("2026-09-10T12:00:00Z"));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /test event storage failure/);
    assert.equal(fixture.runRepository.list(project.id).length, 0);
    assert.deepEqual(fixture.sqlite.prepare("SELECT evaluated_at FROM scheduler_state WHERE key = ?").get(`${project.id}/${task.id}`),
      { evaluated_at: "2026-09-09T12:00:00.000Z" });
  } finally { fixture.sqlite.exec("DROP TRIGGER reject_test_event;"); }
  await evaluate("2026-09-10T12:00:00Z");
  assert.equal(fixture.runRepository.list(project.id).length, 1);
});

test("changed recurring schedule and re-enabling establish a fresh cursor without stale catchup", async () => {
  const project = await fixture.project();
  const task = await fixture.task(project.id, daily);
  await evaluate("2026-09-01T12:00:00Z");
  const { id, ...input } = task;
  await fixture.taskService.update(project.id, id, { ...input, schedule: { ...daily, time: "08:00" } });
  await evaluate("2026-09-10T13:00:00Z");
  assert.equal(fixture.runRepository.list(project.id).length, 0);
  await fixture.taskService.update(project.id, id, { ...input, enabled: false });
  await evaluate("2026-09-11T13:00:00Z");
  await fixture.taskService.update(project.id, id, input);
  await evaluate("2026-09-15T13:00:00Z");
  assert.equal(fixture.runRepository.list(project.id).length, 0);
  await evaluate("2026-09-16T13:00:00Z");
  assert.equal(fixture.runRepository.list(project.id)[0]?.scheduledAt, "2026-09-16T11:00:00.000Z");
});
