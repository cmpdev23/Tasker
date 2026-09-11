import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { prepareRunWorktree, finalizeRunWorktree, cleanupSuccessfulWorktree, deleteRunArtifacts,
  type RunWorktree, type PrepareRunWorktreeOptions, type FinalizeRunWorktreeOptions } from "../backend/git/run-git.service";

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

test("isolated Git lifecycle: exact fetch, real changes, preservation, cancellation and safe cleanup", { timeout: 60000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agenttasker-git-test-"));
  t.after(async () => {
    const target = path.resolve(root);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert.ok(path.basename(target).startsWith("agenttasker-git-test-"));
    await fs.rm(target, { recursive: true, force: true });
  });
  const upstream = path.join(root, "upstream");
  const repo = path.join(root, "repo");
  const remote = path.join(root, "remote.git");
  const runtime = path.join(root, "runtime");
  await fs.mkdir(upstream);
  git(upstream, "init", "-b", "main");
  git(upstream, "config", "user.name", "Backend Test");
  git(upstream, "config", "user.email", "test@example.invalid");
  await fs.writeFile(path.join(upstream, "tracked.txt"), "base\n");
  await fs.writeFile(path.join(upstream, ".gitignore"), "ignored/\n");
  git(upstream, "add", "."); git(upstream, "commit", "-m", "base");
  git(root, "init", "--bare", remote);
  git(upstream, "remote", "add", "origin", remote);
  git(upstream, "push", "origin", "main");
  git(root, "clone", "-b", "main", remote, repo);
  git(repo, "config", "user.name", "Backend Test");
  git(repo, "config", "user.email", "test@example.invalid");
  const stale = git(repo, "rev-parse", "HEAD");
  git(repo, "switch", "-c", "user-feature");
  await fs.writeFile(path.join(repo, "tracked.txt"), "user staged\n");
  git(repo, "add", "tracked.txt");
  await fs.writeFile(path.join(repo, "private-user.txt"), "user work\n");
  const originalStatus = git(repo, "status", "--porcelain");
  await fs.writeFile(path.join(upstream, "fresh.txt"), "new remote commit\n");
  git(upstream, "add", "."); git(upstream, "commit", "-m", "fresh"); git(upstream, "push", "origin", "main");
  const fresh = git(upstream, "rev-parse", "HEAD");
  // A malicious/unusual default refmap must not redirect this fetch to a local branch.
  git(repo, "config", "remote.origin.fetch", "+refs/heads/main:refs/heads/should-not-update");
  const create = (overrides: Partial<PrepareRunWorktreeOptions> = {}) => prepareRunWorktree({ repoPath: repo, worktreesRoot: runtime,
    runId: randomUUID(), taskId: "test-task", remote: "origin", baseBranch: "main", ...overrides });
  const first = await create({ onPrepared: async metadata => {
    assert.equal(metadata.baseCommit, fresh);
    await assert.rejects(fs.stat(metadata.worktreePath), { code: "ENOENT" });
  } });
  assert.equal(first.baseCommit, fresh);
  assert.equal(git(repo, "rev-parse", "refs/remotes/origin/main"), fresh);
  assert.equal(git(repo, "rev-parse", "main"), stale);
  assert.throws(() => git(repo, "rev-parse", "--verify", "refs/heads/should-not-update"));
  assert.equal(git(repo, "branch", "--show-current"), "user-feature");
  assert.equal(git(repo, "status", "--porcelain"), originalStatus);
  // Existing runs under the runtime directory must not prevent a second run.
  const second = await create();
  assert.notEqual(first.worktreePath, second.worktreePath);
  const finish = (worktree: RunWorktree, overrides: Partial<FinalizeRunWorktreeOptions> = {}) => finalizeRunWorktree(worktree, { exitCode: 0,
    validationsSucceeded: true, commitMessage: "test: apply changes", ...overrides });
  await fs.writeFile(path.join(first.worktreePath, "new.txt"), "actual new file\n");
  await fs.unlink(path.join(first.worktreePath, "tracked.txt"));
  const success = await finish(first);
  assert.equal(success.success, true, success.error ?? undefined);
  assert.ok(success.commitSha);
  assert.match(success.diff, /new.txt/);
  assert.match(success.diff, /tracked.txt/);
  assert.deepEqual(await cleanupSuccessfulWorktree(first, success), { removed: true, reason: null });
  assert.equal(git(repo, "rev-parse", `refs/heads/${first.branch}`), success.commitSha);
  const unchanged = await finish(second);
  assert.equal(unchanged.success, true);
  assert.equal(unchanged.commitSha, null);
  const required = await finish(second, { expectChanges: true });
  assert.equal(required.success, false);
  assert.equal((await cleanupSuccessfulWorktree(second, required)).removed, false);
  await fs.writeFile(path.join(second.worktreePath, "partial.txt"), "partial\n");
  for (const checks of [{ exitCode: 1 }, { timedOut: true }, { cancelled: true }, { validationsSucceeded: false }]) {
    const failure = await finish(second, checks);
    assert.equal(failure.success, false);
    assert.equal(failure.commitSha, null);
    assert.equal(git(second.worktreePath, "rev-parse", "HEAD"), fresh);
  }
  const noCommit = await finish(second, { commit: false });
  assert.equal(noCommit.success, true);
  assert.equal((await cleanupSuccessfulWorktree(second, noCommit)).removed, false);
  const committed = await finish(second);
  assert.equal(committed.success, true, committed.error ?? undefined);
  await fs.mkdir(path.join(second.worktreePath, "ignored"));
  await fs.writeFile(path.join(second.worktreePath, "ignored", "keep.txt"), "preserve ignored data");
  assert.equal((await cleanupSuccessfulWorktree(second, committed)).removed, false);
  await assert.rejects(create({ worktreesRoot: path.join(repo, "nested") }), /outside/);
  await assert.rejects(create({ baseBranch: "missing" }));
  const abort = new AbortController();
  let planned: RunWorktree | undefined;
  await assert.rejects(create({ signal: abort.signal, onPrepared: metadata => { planned = metadata; abort.abort(); } }));
  assert.ok(planned);
  await assert.rejects(fs.stat(planned.worktreePath), { code: "ENOENT" });
  const third = await create();
  git(third.worktreePath, "commit", "--allow-empty", "-m", "agent changed history");
  const unsafe = await finish(third);
  assert.equal(unsafe.success, false);
  assert.match(unsafe.error ?? "", /history/);
  const secondRunId = second.branch.slice("tasker/run-".length, -"-test-task".length);
  await assert.rejects(deleteRunArtifacts({
    repoPath: repo,
    worktreesRoot: runtime,
    worktreePath: repo,
    branch: second.branch,
    runId: secondRunId,
    taskId: "test-task",
  }), /boundary/);
  assert.deepEqual(await deleteRunArtifacts({
    repoPath: repo,
    worktreesRoot: runtime,
    worktreePath: second.worktreePath,
    branch: second.branch,
    runId: secondRunId,
    taskId: "test-task",
  }), { worktreeRemoved: true, branchRemoved: true });
  await assert.rejects(fs.stat(second.worktreePath), { code: "ENOENT" });
  assert.throws(() => git(repo, "rev-parse", "--verify", `refs/heads/${second.branch}`));
  assert.equal(git(repo, "status", "--porcelain"), originalStatus);
});
