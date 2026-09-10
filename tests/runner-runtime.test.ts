import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { isolatedRunner } from "./helpers/runner";

let fixture: Awaited<ReturnType<typeof isolatedRunner>>;
let createRunner: typeof import("../backend/runs/run-worker").createRunner;
before(async () => {
  fixture = await isolatedRunner();
  ({ createRunner } = await import("../backend/runs/run-worker"));
});
beforeEach(() => { fixture.reset(); });
after(() => { fixture?.close(); });

function lock() {
  return fixture.sqlite.prepare("SELECT owner_pid, token FROM runner_lock WHERE id = 1").get() as
    { owner_pid: number; token: string } | undefined;
}

async function eventually(predicate: () => boolean) {
  const deadline = Date.now() + 3_000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "Runner did not reach the expected persisted state");
    await delay(10);
  }
}

function exitedPid(): number {
  const child = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], {
    env: { NODE_ENV: "test" }, encoding: "utf8", windowsHide: true, timeout: 5_000,
  });
  assert.equal(child.status, 0);
  const pid = Number(child.stdout);
  assert.ok(Number.isInteger(pid) && pid > 0);
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  return pid;
}

test("stop awaits an in-flight scheduler tick and releases its lock before resolving", async () => {
  const project = await fixture.project();
  await fixture.task(project.id, { type: "manual", timezone: "UTC" });
  const runner = createRunner();
  assert.ok(lock(), "The initial tick acquired the lock before awaiting scheduler I/O");
  try {
    await runner.stop();
    assert.equal(lock(), undefined, "stop must finish its in-flight tick and release the lock");
  } finally {
    await runner.stop();
    // Drain even when the assertion fails so no work leaks into another test/DB cleanup.
    await eventually(() => !lock());
  }
});

test("runtime lock allows one owner; stopping a contender cannot release the owner's lock", async () => {
  const first = createRunner();
  const contender = createRunner();
  try {
    await eventually(() => Boolean(lock()));
    const original = lock()!;
    assert.equal(original.owner_pid, process.pid);
    await contender.tick();
    await contender.stop();
    assert.deepEqual(lock(), original);
    await first.stop();
    await eventually(() => !lock());
    const successor = createRunner();
    try {
      await eventually(() => Boolean(lock()));
      assert.notEqual(lock()!.token, original.token);
    } finally { await successor.stop(); }
  } finally { await contender.stop(); await first.stop(); }
  await eventually(() => !lock());
});

test("runtime reclaims an exited owner's lock and recovers interrupted runs without deleting work", async () => {
  const pid = exitedPid();
  fixture.sqlite.prepare("INSERT INTO runner_lock (id, owner_pid, token) VALUES (1, ?, ?)").run(pid, "exited-owner");
  const project = await fixture.project();
  const worktree = path.join(fixture.root, "preserved-worktree");
  fs.mkdirSync(worktree);
  fs.writeFileSync(path.join(worktree, "partial.txt"), "Partial work to recover.");
  const failed = fixture.runRepository.create(project.id, "interrupted", "Interrupted");
  fixture.runRepository.update(failed.id, { status: "RUNNING", codexPid: pid, worktreePath: worktree });
  const cancelled = fixture.runRepository.create(project.id, "cancelled", "Cancelled");
  fixture.runRepository.update(cancelled.id, { status: "VALIDATING", cancelRequested: true });
  const runner = createRunner();
  try {
    await eventually(() => fixture.runRepository.get(project.id, cancelled.id).status === "CANCELLED");
    assert.equal(lock()?.owner_pid, process.pid);
    assert.notEqual(lock()?.token, "exited-owner");
    const recovered = fixture.runRepository.get(project.id, failed.id);
    assert.equal(recovered.status, "FAILED");
    assert.equal(recovered.codexPid, null);
    assert.ok(recovered.completedAt);
    assert.equal(recovered.worktreePath, worktree);
    assert.equal(fs.readFileSync(path.join(worktree, "partial.txt"), "utf8"), "Partial work to recover.");
    assert.equal(fixture.runRepository.events(failed.id).filter(event => event.type === "recovery").length, 1);
    await runner.tick();
    assert.equal(fixture.runRepository.events(failed.id).filter(event => event.type === "recovery").length, 1);
  } finally { await runner.stop(); await eventually(() => !lock()); }
});

test("runtime verifies an exited interrupted process tree before it resumes the queue", async () => {
  const project = await fixture.project();
  const interrupted = fixture.runRepository.create(project.id, "interrupted", "Interrupted");
  fixture.runRepository.update(interrupted.id, { status: "RUNNING", codexPid: exitedPid(), terminationVerified: false });
  const runner = createRunner();
  try {
    await eventually(() => fixture.runRepository.get(project.id, interrupted.id).status === "FAILED");
    const recovered = fixture.runRepository.get(project.id, interrupted.id);
    assert.equal(recovered.terminationVerified, true);
    assert.equal(recovered.codexPid, null);
    assert.match(recovered.error ?? "", /Server stopped/i);
    assert.match(fixture.runRepository.events(interrupted.id).at(-1)?.message ?? "", /queue resumed/i);
  } finally { await runner.stop(); await eventually(() => !lock()); }
});

test("an alive orphan pauses the queue and records recovery once without signalling it", async () => {
  const project = await fixture.project();
  const orphan = fixture.runRepository.create(project.id, "orphan", "Orphan");
  // Our own live PID proves liveness without launching Codex or touching unrelated processes.
  fixture.runRepository.update(orphan.id, { status: "RUNNING", codexPid: process.pid });
  const queued = fixture.runRepository.create(project.id, "queued", "Queued");
  const runner = createRunner();
  try {
    await eventually(() => Boolean(fixture.runRepository.get(project.id, orphan.id).error));
    await runner.tick();
    await runner.tick();
    const preserved = fixture.runRepository.get(project.id, orphan.id);
    assert.equal(preserved.status, "RUNNING");
    assert.equal(preserved.codexPid, process.pid);
    assert.equal(preserved.completedAt, null);
    assert.equal(fixture.runRepository.get(project.id, queued.id).status, "QUEUED");
    assert.equal(fixture.runRepository.get(project.id, queued.id).startedAt, null);
    assert.equal(fixture.runRepository.events(orphan.id).filter(event => event.type === "recovery").length, 1);
  } finally { await runner.stop(); await eventually(() => !lock()); }
});

test("unverified termination blocks queued work even when the old run has a terminal status", async () => {
  const project = await fixture.project();
  const old = fixture.runRepository.create(project.id, "old", "Old run");
  assert.equal(old.terminationVerified, true);
  fixture.runRepository.update(old.id, { status: "FAILED", terminationVerified: false, codexPid: null });
  const queued = fixture.runRepository.create(project.id, "queued", "Queued");
  const runner = createRunner();
  try {
    for (const status of ["FAILED", "CANCELLED", "SUCCESS"]) {
      fixture.runRepository.update(old.id, { status });
      await runner.tick();
      assert.equal(fixture.runRepository.hasUnverifiedTermination(), true);
      assert.equal(fixture.runRepository.get(project.id, queued.id).status, "QUEUED");
      assert.equal(fixture.runRepository.get(project.id, queued.id).startedAt, null);
      assert.equal(fixture.runRepository.get(project.id, old.id).terminationVerified, false);
    }
    // Empty the queue before releasing the safety gate, so this test never executes an agent.
    fixture.runService.cancel(project.id, queued.id);
    fixture.runRepository.update(old.id, { terminationVerified: true });
    assert.equal(fixture.runRepository.hasUnverifiedTermination(), false);
    await runner.tick();
  } finally { await runner.stop(); await eventually(() => !lock()); }
});

test("restart fails an unverified active run without a PID and preserves the queue block across another restart", async () => {
  const project = await fixture.project();
  const worktree = path.join(fixture.root, "unverified-worktree");
  fs.mkdirSync(worktree);
  fs.writeFileSync(path.join(worktree, "partial.txt"), "Preserve pending recovery.");
  const interrupted = fixture.runRepository.create(project.id, "interrupted", "Interrupted before PID persistence");
  fixture.runRepository.update(interrupted.id, {
    status: "RUNNING", terminationVerified: false, codexPid: null, worktreePath: worktree,
  });
  // This queued item has no task definition: even a broken safety gate cannot launch Codex in this test.
  const queued = fixture.runRepository.create(project.id, "queued", "Queued");
  let completedAt: string | null = null;
  for (let restart = 0; restart < 2; restart++) {
    const runner = createRunner();
    try {
      await eventually(() => fixture.runRepository.get(project.id, interrupted.id).status === "FAILED");
      await runner.tick();
      const recovered = fixture.runRepository.get(project.id, interrupted.id);
      assert.equal(recovered.terminationVerified, false);
      assert.equal(recovered.codexPid, null);
      assert.ok(recovered.completedAt);
      assert.ok(recovered.error);
      if (restart === 0) completedAt = recovered.completedAt;
      else assert.equal(recovered.completedAt, completedAt);
      assert.equal(recovered.worktreePath, worktree);
      assert.equal(fs.readFileSync(path.join(worktree, "partial.txt"), "utf8"), "Preserve pending recovery.");
      assert.equal(fixture.runRepository.hasUnverifiedTermination(), true);
      assert.equal(fixture.runRepository.get(project.id, queued.id).status, "QUEUED");
      assert.equal(fixture.runRepository.get(project.id, queued.id).startedAt, null);
      assert.equal(fixture.runRepository.events(interrupted.id).filter(event => event.type === "recovery").length, 1,
        "Repeated ticks and restarts must not duplicate the recovery event");
    } finally { await runner.stop(); await eventually(() => !lock()); }
  }
});
