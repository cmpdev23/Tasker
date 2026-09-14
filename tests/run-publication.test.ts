import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { finalizeRunWorktree, prepareRunWorktree } from "../backend/git/run-git.service";
import { publishRunWorktree } from "../backend/git/run-publication.service";
import type { GitHubCliRunner } from "../backend/git/github-cli.service";

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"] }).trim();
}

test("Run publication pushes the verified commit and creates one idempotent draft PR", { timeout: 60_000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agenttasker-publish-test-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const repo = path.join(root, "repo");
  const remote = path.join(root, "remote.git");
  const runtime = path.join(root, "runtime");
  await fs.mkdir(repo);
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Publication Fixture");
  git(repo, "config", "user.email", "publication@example.invalid");
  await fs.writeFile(path.join(repo, "base.txt"), "base\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "base");
  git(root, "init", "--bare", remote);
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "origin", "main");

  const worktree = await prepareRunWorktree({ repoPath: repo, worktreesRoot: runtime,
    runId: randomUUID(), taskId: "publish-test", remote: "origin", baseBranch: "main" });
  await fs.writeFile(path.join(worktree.worktreePath, "result.txt"), "published\n");
  const finalized = await finalizeRunWorktree(worktree, { exitCode: 0, validationsSucceeded: true,
    expectChanges: true, commitMessage: "test: publish run" });
  assert.equal(finalized.success, true, finalized.error ?? undefined);
  assert.ok(finalized.commitSha);

  // Keep a local push target while exposing the GitHub URL that gh must receive.
  git(repo, "remote", "set-url", "origin", "git@github.com:fixture/agenttasker.git");
  git(repo, "remote", "set-url", "--add", "--push", "origin", remote);
  const calls: string[][] = [];
  let existingUrl: string | null = null;
  const github: GitHubCliRunner = {
    async run(args) {
      calls.push([...args]);
      if (args[0] === "auth") return { stdout: "", stderr: "" };
      if (args[0] === "pr" && args[1] === "list") {
        return { stdout: JSON.stringify(existingUrl ? [{ url: existingUrl }] : []), stderr: "" };
      }
      if (args[0] === "pr" && args[1] === "create") {
        existingUrl = "https://github.com/fixture/agenttasker/pull/42";
        return { stdout: `${existingUrl}\n`, stderr: "" };
      }
      throw new Error(`Unexpected gh call: ${args.join(" ")}`);
    },
  };
  const settings = { remote: "origin", push: true, createPullRequest: true, pullRequestDraft: true };
  const first = await publishRunWorktree(worktree, { settings, expectedHead: finalized.commitSha,
    title: "test: publish", body: "Fixture PR" }, github);
  assert.equal(first.pushed, true);
  assert.equal(first.pullRequestCreated, true);
  assert.equal(first.pullRequestUrl, existingUrl);
  assert.equal(git(repo, "rev-parse", `refs/remotes/origin/${worktree.branch}`), finalized.commitSha);
  assert.ok(calls.some((args) => args[0] === "pr" && args[1] === "create" && args.includes("--draft")));

  calls.length = 0;
  const second = await publishRunWorktree(worktree, { settings, expectedHead: finalized.commitSha,
    title: "test: publish", body: "Fixture PR" }, github);
  assert.equal(second.pullRequestCreated, false);
  assert.equal(second.pullRequestUrl, existingUrl);
  assert.equal(calls.some((args) => args[0] === "pr" && args[1] === "create"), false);

  existingUrl = null;
  calls.length = 0;
  const firstStepBranch = `${worktree.branch}-step-001-research`;
  const firstStep = await publishRunWorktree(worktree, {
    settings,
    expectedHead: finalized.commitSha,
    branch: firstStepBranch,
    baseBranch: "main",
    title: "test: publish first step",
    body: "First stacked PR",
  }, github);
  assert.equal(firstStep.branch, firstStepBranch);
  assert.equal(git(remote, "rev-parse", `refs/heads/${firstStepBranch}`), finalized.commitSha);
  assert.ok(calls.some((args) => args[0] === "pr" && args[1] === "create" &&
    args[args.indexOf("--base") + 1] === "main" && args[args.indexOf("--head") + 1] === firstStepBranch));

  await fs.writeFile(path.join(worktree.worktreePath, "review.txt"), "reviewed\n");
  const secondFinalized = await finalizeRunWorktree({ ...worktree, baseCommit: finalized.commitSha! }, {
    exitCode: 0,
    validationsSucceeded: true,
    expectChanges: true,
    commitMessage: "test: publish second step",
  });
  assert.equal(secondFinalized.success, true, secondFinalized.error ?? undefined);
  assert.ok(secondFinalized.commitSha);
  existingUrl = null;
  calls.length = 0;
  const secondStepBranch = `${worktree.branch}-step-002-review`;
  await publishRunWorktree(worktree, {
    settings,
    expectedHead: secondFinalized.commitSha,
    branch: secondStepBranch,
    baseBranch: firstStepBranch,
    title: "test: publish second step",
    body: "Second stacked PR",
  }, github);
  assert.equal(git(remote, "rev-parse", `refs/heads/${secondStepBranch}`), secondFinalized.commitSha);
  assert.ok(calls.some((args) => args[0] === "pr" && args[1] === "create" &&
    args[args.indexOf("--base") + 1] === firstStepBranch && args[args.indexOf("--head") + 1] === secondStepBranch));
});
