import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { isolatedRunner } from "./helpers/runner";

let fixture: Awaited<ReturnType<typeof isolatedRunner>>;
before(async () => { fixture = await isolatedRunner(); });
beforeEach(() => { fixture.reset(); });
after(() => { fixture?.close(); });

test("manual enqueue persists a queued run and its initial event without starting Codex", async () => {
  const project = await fixture.project();
  const task = await fixture.task(project.id, { type: "manual", timezone: "UTC" });
  const run = await fixture.runService.enqueue(project.id, task.id);
  assert.equal(run.status, "QUEUED");
  assert.equal(run.taskName, task.name);
  assert.equal(run.scheduledAt, null);
  assert.equal(run.startedAt, null);
  assert.equal(run.codexPid, null);
  assert.deepEqual(fixture.runRepository.active(), []);
  const events = fixture.runRepository.events(run.id);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "status");
  assert.equal(events[0].message, "Queued");
  await assert.rejects(fixture.runService.enqueue(project.id, "missing-task"), /not found/i);
  assert.equal(fixture.runRepository.list(project.id).length, 1);
});

test("queue claims FIFO and permits only one executing run across projects and connections", async () => {
  const firstProject = await fixture.project();
  const secondProject = await fixture.project();
  const first = fixture.runRepository.create(firstProject.id, "first", "First");
  const second = fixture.runRepository.create(secondProject.id, "second", "Second");
  fixture.runRepository.update(first.id, { queuedAt: "2026-09-10T10:00:00Z" });
  fixture.runRepository.update(second.id, { queuedAt: "2026-09-10T11:00:00Z" });
  const claims = await Promise.all(Array.from({ length: 4 }, () => fixture.child("claim")));
  assert.deepEqual(claims.filter(Boolean), [first.id]);
  assert.equal(fixture.runRepository.get(firstProject.id, first.id).status, "PREPARING");
  assert.ok(fixture.runRepository.get(firstProject.id, first.id).startedAt);
  for (const status of ["PREPARING", "RUNNING", "VALIDATING"]) {
    fixture.runRepository.update(first.id, { status });
    assert.equal(fixture.runRepository.claim(), undefined, `${status} must occupy the worker slot`);
  }
  fixture.runRepository.update(first.id, { status: "SUCCESS" });
  assert.equal(fixture.runRepository.claim()?.id, second.id);
  fixture.runRepository.update(second.id, { status: "FAILED" });
  assert.equal(fixture.runRepository.claim(), undefined);
});

test("queued cancellation persists immediately, excludes the run from claims, and rejects finished runs", async () => {
  const project = await fixture.project();
  const run = fixture.runRepository.create(project.id, "task", "Task");
  const cancelled = fixture.runService.cancel(project.id, run.id);
  assert.equal(cancelled?.status, "CANCELLED");
  assert.equal(cancelled.cancelRequested, true);
  assert.ok(cancelled.completedAt);
  assert.equal(cancelled.startedAt, null);
  assert.equal(fixture.runRepository.claim(), undefined);
  assert.equal(fixture.runRepository.events(run.id).at(-1)?.type, "cancellation");
  assert.throws(() => fixture.runService.cancel(project.id, run.id), /already finished/i);
  for (const status of ["SUCCESS", "FAILED"]) {
    fixture.runRepository.update(run.id, { status });
    assert.throws(() => fixture.runService.cancel(project.id, run.id), /already finished/i);
  }
  const active = fixture.runRepository.create(project.id, "task", "Task");
  fixture.runRepository.claim();
  assert.equal(fixture.runService.cancel(project.id, active.id)?.status, "PREPARING");
  assert.equal(fixture.runRepository.get(project.id, active.id).cancelRequested, true);
});

test("manual recovery only releases a terminal run with no remaining process identity", async () => {
  const project = await fixture.project();
  const recoverable = fixture.runRepository.create(project.id, "recoverable", "Recoverable run");
  fixture.runRepository.update(recoverable.id, { status: "FAILED", terminationVerified: false, codexPid: null });

  const recovered = fixture.runService.confirmTermination(project.id, recoverable.id);
  assert.equal(recovered.terminationVerified, true);
  assert.match(fixture.runRepository.events(recoverable.id).at(-1)?.message ?? "", /manually confirmed/i);
  assert.throws(() => fixture.runService.confirmTermination(project.id, recoverable.id), /already been verified/i);

  const active = fixture.runRepository.create(project.id, "active", "Active run");
  fixture.runRepository.update(active.id, { status: "RUNNING", terminationVerified: false, codexPid: null });
  assert.throws(() => fixture.runService.confirmTermination(project.id, active.id), /still active/i);

  const identified = fixture.runRepository.create(project.id, "identified", "Identified run");
  fixture.runRepository.update(identified.id, { status: "FAILED", terminationVerified: false, codexPid: process.pid });
  assert.throws(() => fixture.runService.confirmTermination(project.id, identified.id), /process identity/i);
});

test("unverified termination lookup identifies the run that blocks the queue", async () => {
  const project = await fixture.project();
  const oldest = fixture.runRepository.create(project.id, "oldest", "Oldest blocker");
  const newest = fixture.runRepository.create(project.id, "newest", "Newest blocker");
  fixture.runRepository.update(oldest.id, {
    status: "FAILED", terminationVerified: false, createdAt: "2026-09-10T10:00:00.000Z",
  });
  fixture.runRepository.update(newest.id, {
    status: "FAILED", terminationVerified: false, createdAt: "2026-09-10T11:00:00.000Z",
  });

  assert.equal(fixture.runRepository.unverifiedTermination()?.id, oldest.id);
  assert.equal(fixture.runRepository.hasUnverifiedTermination(), true);
  fixture.runRepository.update(oldest.id, { terminationVerified: true });
  assert.equal(fixture.runRepository.unverifiedTermination()?.id, newest.id);
});

test("queue status explains position, active work, and terminal recovery blockers", async () => {
  const project = await fixture.project();
  const active = fixture.runRepository.create(project.id, "active", "Active work");
  const queued = fixture.runRepository.create(project.id, "queued", "Queued work");
  fixture.runRepository.claim();

  assert.deepEqual(fixture.runRepository.queueStatus(queued.id), {
    state: "RUNNING",
    queuedCount: 1,
    position: 1,
    blocker: {
      id: active.id, projectId: project.id, taskId: active.taskId, taskName: active.taskName,
      status: "PREPARING", queuedAt: active.queuedAt, startedAt: fixture.runRepository.get(project.id, active.id).startedAt,
      codexPid: null,
    },
    canRecover: false,
  });

  fixture.runRepository.update(active.id, { status: "FAILED", terminationVerified: false });
  const blocked = fixture.runRepository.queueStatus(queued.id);
  assert.equal(blocked.state, "BLOCKED_RECOVERY");
  assert.equal(blocked.blocker?.id, active.id);
  assert.equal(blocked.canRecover, true);
  fixture.runRepository.remove(queued.id);
  const recoveryRequired = fixture.runRepository.queueStatus();
  assert.equal(recoveryRequired.state, "RECOVERY_REQUIRED");
  assert.equal(recoveryRequired.queuedCount, 0);
  assert.equal(recoveryRequired.blocker?.id, active.id);
});

test("run removal supports direct confirmed deletion of an unverified terminal blocker", async () => {
  const project = await fixture.project();
  const queued = fixture.runRepository.create(project.id, "queued", "Queued");
  const queuedEvent = fixture.runRepository.events(queued.id)[0];
  assert.equal((await fixture.runService.remove(project.id, queued.id)).id, queued.id);
  assert.throws(() => fixture.runRepository.get(project.id, queued.id), /not found/i);
  assert.deepEqual(fixture.runRepository.events(queued.id), []);
  assert.ok(queuedEvent);

  const cancelled = fixture.runRepository.create(project.id, "cancelled", "Cancelled");
  fixture.runService.cancel(project.id, cancelled.id);
  assert.equal((await fixture.runService.remove(project.id, cancelled.id)).status, "CANCELLED");

  const running = fixture.runRepository.create(project.id, "running", "Running");
  fixture.runRepository.claim();
  await assert.rejects(fixture.runService.remove(project.id, running.id), /annulez/i);
  fixture.runRepository.update(running.id, { status: "FAILED", terminationVerified: false, codexPid: null });
  await assert.rejects(fixture.runService.remove(project.id, running.id), /confirmez l’arrêt/i);
  assert.equal((await fixture.runService.remove(project.id, running.id, { confirmTermination: true })).status, "FAILED");
  assert.throws(() => fixture.runRepository.get(project.id, running.id), /not found/i);

  const identified = fixture.runRepository.create(project.id, "identified", "Identified process");
  fixture.runRepository.update(identified.id, { status: "FAILED", terminationVerified: false, codexPid: process.pid });
  await assert.rejects(
    fixture.runService.remove(project.id, identified.id, { confirmTermination: true }),
    /processus est encore associé/i,
  );

  const preserved = fixture.runRepository.create(project.id, "preserved", "Preserved work");
  fixture.runRepository.update(preserved.id, { status: "FAILED" });
  fixture.runRepository.update(preserved.id, {
    runBranch: "tasker/preserved",
    worktreePath: "C:\\preserved-worktree",
  });
  await assert.rejects(fixture.runService.remove(project.id, preserved.id), /travail Git préservé/i);
});

test("completeSuccess honors a late cancellation and rejects cancellation after success", async () => {
  const { ConflictError } = await import("../backend/errors");
  const project = await fixture.project();
  const cancelledRun = fixture.runRepository.create(project.id, "late-cancel", "Late cancellation");
  const commitHash = "a".repeat(40);
  fixture.runRepository.update(cancelledRun.id, { status: "VALIDATING", commitHash, diff: "Completed fixture diff" });
  // The cancellation arrives after validation/commit and before the final completion transaction.
  assert.equal(fixture.runService.cancel(project.id, cancelledRun.id)?.status, "VALIDATING");
  const cancelled = fixture.runRepository.completeSuccess(project.id, cancelledRun.id);
  assert.equal(cancelled?.status, "CANCELLED");
  assert.equal(cancelled.cancelRequested, true);
  assert.ok(cancelled.completedAt);
  assert.match(cancelled.error ?? "", /cancel/i);
  assert.equal(cancelled.commitHash, commitHash);
  assert.equal(cancelled.diff, "Completed fixture diff");
  assert.deepEqual(fixture.runRepository.get(project.id, cancelledRun.id), cancelled);
  assert.equal(fixture.runRepository.events(cancelledRun.id).filter(event => event.type === "cancellation").length, 1);

  const successRun = fixture.runRepository.create(project.id, "success-first", "Success wins first");
  fixture.runRepository.update(successRun.id, { status: "VALIDATING", commitHash });
  const success = fixture.runRepository.completeSuccess(project.id, successRun.id);
  assert.equal(success?.status, "SUCCESS");
  assert.equal(success.cancelRequested, false);
  assert.ok(success.completedAt);
  assert.equal(success.error, null);
  assert.throws(() => fixture.runService.cancel(project.id, successRun.id), ConflictError);
  assert.deepEqual(fixture.runRepository.get(project.id, successRun.id), success);
  assert.equal(fixture.runRepository.events(successRun.id).filter(event => event.type === "cancellation").length, 0);
});

test("project boundaries prevent reading or cancelling another project's run", async () => {
  const first = await fixture.project();
  const second = await fixture.project();
  const run = fixture.runRepository.create(first.id, "task", "Task");
  assert.throws(() => fixture.runRepository.get(second.id, run.id), /not found/i);
  assert.throws(() => fixture.runService.cancel(second.id, run.id), /not found/i);
  assert.deepEqual(fixture.runRepository.list(second.id), []);
  assert.equal(fixture.runRepository.get(first.id, run.id).status, "QUEUED");
});

test("project deletion rejects unverified terminal runs and preserves their recovery evidence", async () => {
  const { projectService } = await import("../backend/projects/project.service");
  const { ConflictError } = await import("../backend/errors");
  const project = await fixture.project();
  const run = fixture.runRepository.create(project.id, "unverified", "Unverified termination");
  fixture.runRepository.update(run.id, { terminationVerified: false, codexPid: null });
  fixture.runRepository.event(run.id, "recovery", "Descendant termination still requires verification.");
  const events = fixture.runRepository.events(run.id);
  for (const status of ["FAILED", "CANCELLED", "SUCCESS"]) {
    fixture.runRepository.update(run.id, { status });
    await assert.rejects(projectService.deleteProject(project.id), ConflictError);
    assert.equal((await projectService.getProjectById(project.id)).id, project.id);
    assert.equal(fixture.runRepository.get(project.id, run.id).status, status);
    assert.equal(fixture.runRepository.get(project.id, run.id).terminationVerified, false);
    assert.equal(fixture.runRepository.hasUnverifiedTermination(), true);
    assert.deepEqual(fixture.runRepository.events(run.id), events);
  }
  fixture.runRepository.update(run.id, { terminationVerified: true });
  assert.equal(await projectService.deleteProject(project.id), true,
    "A completed project remains deletable once its process termination is verified");
  assert.deepEqual(fixture.runRepository.list(project.id), []);
  assert.deepEqual(fixture.runRepository.events(run.id), []);
});

test("project archiving rejects active runs before hiding the project", async () => {
  const { projectService } = await import("../backend/projects/project.service");
  const { ConflictError } = await import("../backend/errors");
  const project = await fixture.project();
  fixture.runRepository.create(project.id, "queued", "Queued run");

  await assert.rejects(projectService.updateProject(project.id, { archived: true }), ConflictError);
  assert.equal((await projectService.getProjectById(project.id)).archivedAt, null);
});

test("history filters by task and exclusive cursor, newest first, with a 200-run page", async () => {
  const project = await fixture.project();
  const expected: string[] = [];
  for (let index = 0; index < 205; index++) {
    const run = fixture.runRepository.create(project.id, "history", "Historical task name");
    fixture.runRepository.update(run.id, { createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(), status: "SUCCESS" });
    expected.unshift(run.id);
  }
  fixture.runRepository.create(project.id, "other", "Other task");
  const firstPage = fixture.runRepository.list(project.id, "history");
  assert.deepEqual(firstPage.map(run => run.id), expected.slice(0, 200));
  const secondPage = fixture.runRepository.list(project.id, "history", firstPage.at(-1)!.createdAt);
  assert.deepEqual(secondPage.map(run => run.id), expected.slice(200));
  assert.ok(secondPage.every(run => run.taskName === "Historical task name"));
});

test("events persist across processes and support incremental pages without cross-run leakage", async () => {
  const project = await fixture.project();
  const run = fixture.runRepository.create(project.id, "events", "Events");
  const other = fixture.runRepository.create(project.id, "other", "Other");
  const initial = fixture.runRepository.events(run.id)[0];
  const expected: number[] = [];
  for (let index = 0; index < 505; index++) {
    const event = fixture.runRepository.event(run.id, "stdout", `line ${index}`, JSON.stringify({ index }));
    expected.push(event.id);
    if (index % 100 === 0) fixture.runRepository.event(other.id, "stderr", "Other run");
  }
  const firstPage = fixture.runRepository.events(run.id, initial.id);
  assert.deepEqual(firstPage.map(event => event.id), expected.slice(0, 500));
  assert.equal(firstPage[0].rawPayload, '{"index":0}');
  const secondPage = fixture.runRepository.events(run.id, firstPage.at(-1)!.id);
  assert.deepEqual(secondPage.map(event => event.id), expected.slice(500));
  assert.deepEqual(fixture.runRepository.events(run.id, secondPage.at(-1)!.id), []);
  const snapshot = await fixture.child("read", project.id, run.id, String(firstPage.at(-1)!.id));
  assert.deepEqual(snapshot, { run: fixture.runRepository.get(project.id, run.id), events: secondPage });
});
