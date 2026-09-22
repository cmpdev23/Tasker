import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { isolatedRunner } from "./helpers/runner";
import type { runCodex } from "../backend/codex/codex-runner";
import { projectCommandActivities } from "../src/components/run-inspector/project-command-events";

let fixture: Awaited<ReturnType<typeof isolatedRunner>>;
let executeRun: typeof import("../backend/runs/run-worker").executeRun;
before(async () => {
  fixture = await isolatedRunner();
  ({ executeRun } = await import("../backend/runs/run-worker"));
});
beforeEach(() => fixture.reset());
after(() => fixture?.close());

test("queued Runs install, validate and commit under a development host; validation failures preserve work", { timeout: 60_000 }, async () => {
  const project = await fixture.project();
  const repo = project.repositoryPath!;
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, {
    cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Runner Fixture");
  git(repo, "config", "user.email", "runner@example.invalid");
  const { updateProjectExecutionToml } = await import("../backend/tasker/project-execution");
  const { DEFAULT_PROJECT_EXECUTION_SETTINGS } = await import("../src/types/project-execution");
  const { DEFAULT_MAIN_CODEX_CONFIG, serializeMainCodexConfig } = await import("../backend/tasker/agents.service");
  fs.mkdirSync(path.join(repo, ".tasker", "agents"));
  fs.writeFileSync(path.join(repo, ".tasker", "agents", "main.toml"), serializeMainCodexConfig(DEFAULT_MAIN_CODEX_CONFIG));
  fs.writeFileSync(path.join(repo, ".tasker", "instructions.md"), "Fixture instructions.");
  const settings = { ...DEFAULT_PROJECT_EXECUTION_SETTINGS, installDependencies: true, validationScripts: ["build"] };
  const config = (scripts: string[]) => fs.writeFileSync(path.join(repo, ".tasker", "project.toml"),
    updateProjectExecutionToml('[git]\nbase_branch = "main"\n', { ...settings, validationScripts: scripts }));
  config(["build"]);
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "runner-fixture", version: "1.0.0", private: true,
    scripts: { build: "node check.cjs", reject: "node check.cjs reject" } }));
  fs.writeFileSync(path.join(repo, "package-lock.json"), JSON.stringify({ name: "runner-fixture", version: "1.0.0", lockfileVersion: 3,
    packages: { "": { name: "runner-fixture", version: "1.0.0" } } }));
  fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules/\n");
  fs.writeFileSync(path.join(repo, "check.cjs"), `
    const assert = require('node:assert/strict');
    assert.equal(process.env.NODE_ENV, undefined, 'Host mode leaked into validation');
    assert.equal(require('node:fs').readFileSync('article.txt', 'utf8'), 'fixture article');
    if (process.argv.includes('reject')) { console.error('Fixture validation rejected'); process.exitCode = 7; }
    else console.log('Fixture build succeeded');
  `);
  const task = await fixture.task(project.id, { type: "manual", timezone: "UTC" }, { expectChanges: true });
  git(repo, "add", ".");
  git(repo, "commit", "-m", "fixture");
  const remote = path.join(fixture.root, "remote.git");
  git(fixture.root, "init", "--bare", remote);
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "origin", "main");
  const base = git(repo, "rev-parse", "HEAD");
  const prompts: string[] = [];
  const fakeCodex: typeof runCodex = async options => {
    prompts.push(options.prompt);
    fs.writeFileSync(path.join(options.worktreePath, "article.txt"), "fixture article");
    const agentResult = { status: "SUCCESS" as const, summary: "Fixture article created", blocking_error: null };
    return { pid: null, exitCode: 0, signal: null, cancelled: false, timedOut: false,
      lastAgentMessage: JSON.stringify(agentResult), error: null, agentResult, terminationVerified: true };
  };
  const previous = process.env.NODE_ENV;
  try {
    Object.assign(process.env, { NODE_ENV: "development" });
    for (const reject of [false, true]) {
      config(reject ? ["reject", "build"] : ["build"]);
      const originalStatus = git(repo, "status", "--porcelain");
      const queued = fixture.runRepository.create(project.id, task.id, task.name);
      const claimed = fixture.runRepository.claim()!;
      assert.equal(claimed.id, queued.id);
      await executeRun(claimed, new AbortController(), fakeCodex);
      const run = fixture.runRepository.get(project.id, queued.id);
      assert.equal(run.status, reject ? "FAILED" : "SUCCESS", run.error ?? undefined);
      assert.equal(run.exitCode, 0, "Codex exit must stay separate from project command exit");
      assert.equal(run.terminationVerified, true);
      const commands = projectCommandActivities(fixture.runRepository.events(run.id), run);
      assert.deepEqual(commands.map(command => command.status), ["success", reject ? "failed" : "success"]);
      assert.equal(commands[1].exitCode, reject ? 7 : 0);
      assert.ok(commands[1].durationMs !== null);
      assert.match(commands[1].output, reject ? /Fixture validation rejected/ : /Fixture build succeeded/);
      if (reject) {
        assert.equal(run.commitHash, null);
        assert.equal(fs.readFileSync(path.join(run.worktreePath!, "article.txt"), "utf8"), "fixture article");
        assert.equal(git(repo, "rev-parse", run.runBranch!), base);
      } else {
        assert.ok(run.commitHash);
        assert.equal(git(repo, "rev-parse", `${run.commitHash}^`), base);
        assert.equal(git(repo, "show", `${run.commitHash}:article.txt`), "fixture article");
      }
      assert.equal(git(repo, "rev-parse", "HEAD"), base);
      assert.equal(git(repo, "status", "--porcelain"), originalStatus);
      assert.equal(process.env.NODE_ENV, "development");
    }
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Object.assign(process.env, { NODE_ENV: previous });
  }
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /read `\.tasker\/LESSONS\.md` in this worktree/i);
  assert.match(prompts[0], /Terminal, tooling, test, and build errors can be useful lessons/i);
});
