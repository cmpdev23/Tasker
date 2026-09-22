import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { isolatedRunner } from "./helpers/runner";

let fixture: Awaited<ReturnType<typeof isolatedRunner>>;
let sequenceService: typeof import("../backend/sequences/sequence.service").sequenceService;
let sequenceRunRepository: typeof import("../backend/sequences/sequence-run.repository").sequenceRunRepository;
let migrationService: typeof import("../backend/sequences/sequence-checkpoint-migration.service").sequenceCheckpointMigrationService;
let checkpointService: typeof import("../backend/sequences/sequence-checkpoint.service").sequenceCheckpointService;

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

before(async () => {
  fixture = await isolatedRunner();
  ({ sequenceService } = await import("../backend/sequences/sequence.service"));
  ({ sequenceRunRepository } = await import("../backend/sequences/sequence-run.repository"));
  ({ sequenceCheckpointMigrationService: migrationService } = await import("../backend/sequences/sequence-checkpoint-migration.service"));
  ({ sequenceCheckpointService: checkpointService } = await import("../backend/sequences/sequence-checkpoint.service"));
});
beforeEach(() => fixture.reset());
after(() => fixture?.close());

test("sequence sync previews and migrates a verified local history without running Codex", async () => {
  const project = await fixture.project();
  const repo = project.repositoryPath!;
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Checkpoint Fixture");
  git(repo, "config", "user.email", "checkpoint@example.invalid");
  fs.mkdirSync(path.join(repo, ".tasker", "agents"));
  fs.writeFileSync(path.join(repo, ".tasker", "agents", "main.toml"), "version = 1\n");
  fs.writeFileSync(path.join(repo, ".tasker", "instructions.md"), "Fixture instructions.");
  fs.writeFileSync(path.join(repo, ".tasker", "project.toml"), '[git]\nbase_branch = "main"\nremote = "origin"\npush = true\ncreate_pull_request = false\npull_request_draft = true\n');
  let sequence = await sequenceService.create(project.id, { name: "Portable migration" });
  sequence = await sequenceService.createStep(project.id, sequence.id, { name: "First", instructions: "First step", expectChanges: true });
  sequence = await sequenceService.createStep(project.id, sequence.id, { name: "Second", instructions: "Second step", expectChanges: true });
  git(repo, "add", ".");
  git(repo, "commit", "-m", "fixture");
  const remote = path.join(fixture.root, `remote-${project.id}.git`);
  git(fixture.root, "init", "--bare", remote);
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "origin", "main");

  const { prepareRunWorktree, finalizeRunWorktree } = await import("../backend/git/run-git.service");
  const { RUNNER_CONFIG } = await import("../backend/runs/runner-config");
  const run = fixture.runRepository.createSequence(project.id, sequence.id, sequence.name);
  const worktree = await prepareRunWorktree({ repoPath: repo, worktreesRoot: path.join(RUNNER_CONFIG.dataDirectory, "worktrees"),
    runId: run.id, taskId: sequence.id, remote: "origin", baseBranch: "main" });
  fs.writeFileSync(path.join(worktree.worktreePath, "first.txt"), "completed");
  const gitResult = await finalizeRunWorktree(worktree, { exitCode: 0, validationsSucceeded: true, expectChanges: true,
    commit: true, commitMessage: "sequence(migration): first" });
  assert.ok(gitResult.commitSha);
  fixture.runRepository.update(run.id, { status: "FAILED", baseRemote: "origin", baseBranch: "main", baseCommit: worktree.baseCommit,
    runBranch: worktree.branch, worktreePath: worktree.worktreePath, commitHash: gitResult.commitSha, completedAt: new Date().toISOString(), terminationVerified: true });
  sequenceRunRepository.initialize(run.id, sequence);
  sequenceRunRepository.update(run.id, sequence.steps[0].id, { status: "SUCCESS", completedAt: new Date().toISOString(), commitHash: gitResult.commitSha });
  sequenceRunRepository.update(run.id, sequence.steps[1].id, { status: "FAILED", completedAt: new Date().toISOString(), error: "Old local failure" });

  const preview = await migrationService.sync(repo, { sequenceId: sequence.id, dryRun: true });
  assert.equal(preview[0]?.status, "READY");
  assert.equal(await checkpointService.load(repo, "origin", sequence.id), null);

  const cli = spawnSync(process.execPath, [path.resolve("bin/agenttasker.mjs"), "sequence", "sync", "--id", sequence.id,
    "--dry-run", "--database", fixture.databasePath], { cwd: repo, encoding: "utf8", windowsHide: true,
    env: { ...process.env, DATABASE_PATH: fixture.databasePath, AGENTTASKER_DATA_DIR: path.join(fixture.root, "runtime") } });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, new RegExp(`READY\\s+${sequence.id}`));

  const migrated = await migrationService.sync(repo, { sequenceId: sequence.id });
  assert.equal(migrated[0]?.status, "SYNCED");
  const checkpoint = await checkpointService.load(repo, "origin", sequence.id);
  assert.equal(checkpoint?.runId, run.id);
  assert.deepEqual(checkpoint?.steps.map((step) => step.status), ["SUCCESS", "FAILED"]);
});

test("sequence sync migrates a completed historical prefix after steps are added", async () => {
  const project = await fixture.project();
  const repo = project.repositoryPath!;
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Checkpoint Fixture");
  git(repo, "config", "user.email", "checkpoint@example.invalid");
  fs.mkdirSync(path.join(repo, ".tasker", "agents"));
  fs.writeFileSync(path.join(repo, ".tasker", "agents", "main.toml"), "version = 1\n");
  fs.writeFileSync(path.join(repo, ".tasker", "instructions.md"), "Fixture instructions.");
  fs.writeFileSync(path.join(repo, ".tasker", "project.toml"), '[git]\nbase_branch = "main"\nremote = "origin"\npush = true\ncreate_pull_request = false\npull_request_draft = true\n');
  let sequence = await sequenceService.create(project.id, { name: "Growing migration" });
  sequence = await sequenceService.createStep(project.id, sequence.id, { name: "First", instructions: "First step", expectChanges: true });
  git(repo, "add", ".");
  git(repo, "commit", "-m", "fixture");
  const remote = path.join(fixture.root, `remote-growing-${project.id}.git`);
  git(fixture.root, "init", "--bare", remote);
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "origin", "main");

  const { prepareRunWorktree, finalizeRunWorktree } = await import("../backend/git/run-git.service");
  const { RUNNER_CONFIG } = await import("../backend/runs/runner-config");
  const run = fixture.runRepository.createSequence(project.id, sequence.id, sequence.name);
  const worktree = await prepareRunWorktree({ repoPath: repo, worktreesRoot: path.join(RUNNER_CONFIG.dataDirectory, "worktrees"),
    runId: run.id, taskId: sequence.id, remote: "origin", baseBranch: "main" });
  fs.writeFileSync(path.join(worktree.worktreePath, "first.txt"), "completed");
  const gitResult = await finalizeRunWorktree(worktree, { exitCode: 0, validationsSucceeded: true, expectChanges: true,
    commit: true, commitMessage: "sequence(migration): first" });
  fixture.runRepository.update(run.id, { status: "SUCCESS", baseRemote: "origin", baseBranch: "main", baseCommit: worktree.baseCommit,
    runBranch: worktree.branch, worktreePath: worktree.worktreePath, commitHash: gitResult.commitSha, completedAt: new Date().toISOString(), terminationVerified: true });
  sequenceRunRepository.initialize(run.id, sequence);
  sequenceRunRepository.update(run.id, sequence.steps[0].id, { status: "SUCCESS", completedAt: new Date().toISOString(), commitHash: gitResult.commitSha });

  sequence = await sequenceService.createStep(project.id, sequence.id, { name: "Second", instructions: "Second step", expectChanges: true });
  const migrated = await migrationService.sync(repo, { sequenceId: sequence.id });
  assert.equal(migrated[0]?.status, "SYNCED");
  const checkpoint = await checkpointService.load(repo, "origin", sequence.id);
  assert.equal(checkpoint?.status, "IN_PROGRESS");
  assert.deepEqual(checkpoint?.steps.map((step) => step.status), ["SUCCESS", "PENDING"]);
});

test("sequence sync repairs a completed independent Run from its verified remote branch", async () => {
  const project = await fixture.project();
  const repo = project.repositoryPath!;
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Checkpoint Fixture");
  git(repo, "config", "user.email", "checkpoint@example.invalid");
  fs.mkdirSync(path.join(repo, ".tasker", "agents"));
  fs.writeFileSync(path.join(repo, ".tasker", "agents", "main.toml"), "version = 1\n");
  fs.writeFileSync(path.join(repo, ".tasker", "instructions.md"), "Fixture instructions.");
  fs.writeFileSync(path.join(repo, ".tasker", "project.toml"), '[git]\nbase_branch = "main"\nremote = "origin"\npush = true\ncreate_pull_request = true\npull_request_draft = true\n');
  let sequence = await sequenceService.create(project.id, { name: "Independent repair", pullRequestStrategy: "independent_after_each_step" });
  sequence = await sequenceService.createStep(project.id, sequence.id, { name: "Only", instructions: "Only step", expectChanges: true });
  git(repo, "add", ".");
  git(repo, "commit", "-m", "fixture");
  const remote = path.join(fixture.root, `remote-independent-${project.id}.git`);
  git(fixture.root, "init", "--bare", remote);
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "origin", "main");

  const { prepareRunWorktree, finalizeRunWorktree } = await import("../backend/git/run-git.service");
  const { RUNNER_CONFIG } = await import("../backend/runs/runner-config");
  const run = fixture.runRepository.createSequence(project.id, sequence.id, sequence.name);
  const worktree = await prepareRunWorktree({ repoPath: repo, worktreesRoot: path.join(RUNNER_CONFIG.dataDirectory, "worktrees"),
    runId: run.id, taskId: sequence.id, remote: "origin", baseBranch: "main" });
  fs.writeFileSync(path.join(worktree.worktreePath, "only.txt"), "completed independently");
  const result = await finalizeRunWorktree(worktree, { exitCode: 0, validationsSucceeded: true, expectChanges: true,
    commit: true, commitMessage: "sequence(independent): only" });
  assert.ok(result.commitSha);
  git(worktree.worktreePath, "push", "origin", `refs/heads/${worktree.branch}:refs/heads/${worktree.branch}`);
  git(worktree.worktreePath, "reset", "--hard", worktree.baseCommit);
  fixture.runRepository.update(run.id, { status: "FAILED", baseRemote: "origin", baseBranch: "main", baseCommit: worktree.baseCommit,
    runBranch: worktree.branch, worktreePath: worktree.worktreePath, commitHash: result.commitSha,
    completedAt: new Date().toISOString(), terminationVerified: true });
  sequenceRunRepository.initialize(run.id, sequence);
  sequenceRunRepository.update(run.id, sequence.steps[0].id, { status: "SUCCESS", completedAt: new Date().toISOString(), commitHash: result.commitSha });

  const migrated = await migrationService.sync(repo, { sequenceId: sequence.id });
  assert.equal(migrated[0]?.status, "SYNCED");
  const checkpoint = await checkpointService.load(repo, "origin", sequence.id);
  assert.equal(checkpoint?.status, "SUCCESS");
  assert.equal(checkpoint?.checkpointCommit, result.commitSha);
});
