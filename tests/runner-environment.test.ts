import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runCodex } from "../backend/codex/codex-runner";
import { gitService } from "../backend/git/git.service";
import { runGitEnvironment } from "../backend/git/git-environment";
import type { MainCodexAgentConfig } from "../src/types/codex-agents";

const preserved = {
  GIT_SSH: "test-ssh", GIT_SSH_COMMAND: "test-ssh -o BatchMode=yes", GIT_SSH_VARIANT: "ssh",
  GIT_ASKPASS: "test-askpass", SSH_ASKPASS: "test-ssh-askpass",
  GIT_AUTHOR_NAME: "Run Author", GIT_AUTHOR_EMAIL: "author@example.invalid", GIT_AUTHOR_DATE: "2001-01-01T00:00:00Z",
  GIT_COMMITTER_NAME: "Run Committer", GIT_COMMITTER_EMAIL: "committer@example.invalid", GIT_COMMITTER_DATE: "2001-01-01T00:00:00Z",
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
};

test("explicit routing denylist preserves transport, authentication and identity without mutating its source", () => {
  const routing = {
    GIT_DIR: "other", GIT_WORK_TREE: "other", GIT_INDEX_FILE: "other", GIT_COMMON_DIR: "other",
    GIT_OBJECT_DIRECTORY: "other", GIT_ALTERNATE_OBJECT_DIRECTORIES: "other", GIT_NAMESPACE: "other",
    GIT_CEILING_DIRECTORIES: "other", GIT_DISCOVERY_ACROSS_FILESYSTEM: "1",
    GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "core.worktree", GIT_CONFIG_VALUE_0: "other",
    GIT_CONFIG_KEY_1: "core.bare", GIT_CONFIG_VALUE_1: "true",
    GIT_CONFIG_PARAMETERS: "'core.worktree=other'", git_work_tree: "case-insensitive Windows key",
    git_config_key_27: "core.worktree", git_config_value_27: "other",
  };
  const source: NodeJS.ProcessEnv = { NODE_ENV: "test", ...preserved, ...routing };
  const original = { ...source };
  assert.deepEqual(runGitEnvironment(source), { NODE_ENV: "test", ...preserved });
  assert.deepEqual(source, original);
});

test("Git and agent subprocesses cannot inherit routing to the user's checkout or index", { timeout: 30_000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agenttasker-environment-test-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("agenttasker-environment-test-"));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const repo = path.join(root, "user-checkout");
  const worktree = path.join(root, "run-worktree");
  await fs.mkdir(repo);
  // No user Git config, hooks, credentials or environment is needed by this fixture.
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", PATH: process.env.PATH,
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null" };
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, {
    cwd, env, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Isolation test");
  git(repo, "config", "user.email", "isolation@example.invalid");
  await fs.writeFile(path.join(repo, "tracked.txt"), "committed base\n");
  git(repo, "add", "tracked.txt");
  git(repo, "commit", "-m", "fixture base");
  git(repo, "worktree", "add", "-b", "test-run", worktree);
  await fs.writeFile(path.join(repo, "tracked.txt"), "user uncommitted changes\n");
  const originalIndex = await fs.readFile(path.join(repo, ".git", "index"));
  const originalHead = git(repo, "rev-parse", "HEAD");
  const script = path.join(root, "agent-git-operation.cjs");
  await fs.writeFile(script, `
    const fs = require('node:fs');
    const { execFileSync } = require('node:child_process');
    process.stdin.resume();
    process.stdin.on('end', () => {
      const expected = ${JSON.stringify(preserved)};
      for (const [key, value] of Object.entries(expected)) {
        if (process.env[key] !== value) throw new Error('Expected test variable to be preserved: ' + key);
      }
      fs.writeFileSync('tracked.txt', 'run changes\\n');
      execFileSync('git', ['add', '--', 'tracked.txt'], { stdio: 'pipe', windowsHide: true });
    });
  `);
  const routing = {
    GIT_DIR: path.join(repo, ".git"), GIT_WORK_TREE: repo,
    GIT_INDEX_FILE: path.join(repo, ".git", "index"),
    GIT_COMMON_DIR: path.join(repo, ".git"),
    GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.worktree", GIT_CONFIG_VALUE_0: repo,
    GIT_CONFIG_PARAMETERS: "'core.bare=true'",
  };
  const assigned = { ...routing, ...preserved };
  const previous = new Map(Object.keys(assigned).map(key => [key, process.env[key]]));
  const config: MainCodexAgentConfig = {
    model: "", model_reasoning_effort: "low", model_reasoning_summary: "auto", model_verbosity: "medium",
    sandbox_mode: "workspace-write", approval_policy: "never", sandbox_workspace_write: { network_access: false },
    agents: { enabled: false, interrupt_message: false, max_concurrent_threads_per_session: null,
      default_subagent_model: "", default_subagent_reasoning_effort: "" },
  };
  try {
    Object.assign(process.env, assigned);
    const target = await gitService.run(worktree, ["rev-parse", "--show-toplevel"]);
    assert.equal(await fs.realpath(target.stdout.trim()), await fs.realpath(worktree));
    const author = await gitService.run(worktree, ["var", "GIT_AUTHOR_IDENT"]);
    assert.match(author.stdout, /^Run Author <author@example\.invalid> /);
    const committer = await gitService.run(worktree, ["var", "GIT_COMMITTER_IDENT"]);
    assert.match(committer.stdout, /^Run Committer <committer@example\.invalid> /);
    // Use the production spawn path and a real Git mutation in its child process, without calling a model.
    const result = await runCodex({ worktreePath: worktree, prompt: "Stage the fixture change.", config, timeoutMs: 10_000 },
      { executable: process.execPath, prefixArgs: [script] });
    assert.equal(result.exitCode, 0, result.error ?? undefined);
    assert.equal(result.error, null);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assert.deepEqual(await fs.readFile(path.join(repo, ".git", "index")), originalIndex,
    "The agent must never stage changes in the user's index");
  assert.equal(git(repo, "rev-parse", "HEAD"), originalHead);
  assert.equal(await fs.readFile(path.join(repo, "tracked.txt"), "utf8"), "user uncommitted changes\n");
  assert.equal(git(repo, "show", ":tracked.txt"), "committed base");
  assert.equal(git(worktree, "show", ":tracked.txt"), "run changes");
});
