import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { isolatedRunner } from "./helpers/runner";
import type { runCodex } from "../backend/codex/codex-runner";
import type { SequencePullRequestStrategy } from "../src/types/sequences";

type PublishRunWorktree = typeof import("../backend/git/run-publication.service").publishRunWorktree;

let fixture: Awaited<ReturnType<typeof isolatedRunner>>;
let executeRun: typeof import("../backend/runs/run-worker").executeRun;
let sequenceService: typeof import("../backend/sequences/sequence.service").sequenceService;
let sequenceRunRepository: typeof import("../backend/sequences/sequence-run.repository").sequenceRunRepository;
let sequenceRunService: typeof import("../backend/sequences/sequence-run.service").sequenceRunService;
let projectEnvironmentVariableService: typeof import("../backend/runs/project-environment-variable.service").projectEnvironmentVariableService;

before(async () => {
  fixture = await isolatedRunner();
  ({ executeRun } = await import("../backend/runs/run-worker"));
  ({ sequenceService } = await import("../backend/sequences/sequence.service"));
  ({ sequenceRunRepository } = await import("../backend/sequences/sequence-run.repository"));
  ({ sequenceRunService } = await import("../backend/sequences/sequence-run.service"));
  ({ projectEnvironmentVariableService } = await import("../backend/runs/project-environment-variable.service"));
});
beforeEach(() => fixture.reset());
after(() => fixture?.close());

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function sequenceFixture(
  publication = false,
  pullRequestStrategy: SequencePullRequestStrategy = "after_sequence",
) {
  const project = await fixture.project();
  const repo = project.repositoryPath!;
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Sequence Fixture");
  git(repo, "config", "user.email", "sequence@example.invalid");
  const { DEFAULT_MAIN_CODEX_CONFIG, serializeMainCodexConfig } = await import("../backend/tasker/agents.service");
  fs.mkdirSync(path.join(repo, ".tasker", "agents"));
  fs.writeFileSync(path.join(repo, ".tasker", "agents", "main.toml"), serializeMainCodexConfig(DEFAULT_MAIN_CODEX_CONFIG));
  fs.writeFileSync(path.join(repo, ".tasker", "instructions.md"), "Sequence fixture instructions.");
  fs.writeFileSync(path.join(repo, ".tasker", "project.toml"), publication
    ? '[git]\nbase_branch = "main"\nremote = "origin"\npush = true\ncreate_pull_request = true\npull_request_draft = true\n'
    : '[git]\nbase_branch = "main"\n');
  let sequence = await sequenceService.create(project.id, { name: "Production SEO", pullRequestStrategy });
  sequence = await sequenceService.createStep(project.id, sequence.id, {
    name: "Research", instructions: "Create the research artifact.", expectChanges: true,
  });
  sequence = await sequenceService.createStep(project.id, sequence.id, {
    name: "Write", instructions: "Use the research artifact to write the final artifact.", expectChanges: true,
  });
  sequence = await sequenceService.createStep(project.id, sequence.id, {
    name: "Review", instructions: "Review the completed work.", expectChanges: false,
  });
  git(repo, "add", ".");
  git(repo, "commit", "-m", "fixture");
  const remote = path.join(fixture.root, `remote-${project.id}.git`);
  git(fixture.root, "init", "--bare", remote);
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "origin", "main");
  return { project, repo, sequence, base: git(repo, "rev-parse", "HEAD") };
}

test("a Sequence executes its own steps in order in one shared worktree", { timeout: 60_000 }, async () => {
  const { project, repo, sequence, base } = await sequenceFixture(true);
  projectEnvironmentVariableService.setAll(project.id, [
    { name: "SEARP_API_KEY", value: "fake-sequence-secret" },
  ]);
  const prompts: string[] = [];
  let call = 0;
  const fakeCodex: typeof runCodex = async (options) => {
    assert.deepEqual(options.environment, { SEARP_API_KEY: "fake-sequence-secret" });
    prompts.push(options.prompt);
    call++;
    if (call === 1) fs.writeFileSync(path.join(options.worktreePath, "research.txt"), "keyword opportunity");
    if (call === 2) {
      assert.equal(fs.readFileSync(path.join(options.worktreePath, "research.txt"), "utf8"), "keyword opportunity");
      fs.writeFileSync(path.join(options.worktreePath, "article.txt"), "article based on research");
    }
    const agentResult = { status: "SUCCESS" as const, summary: `Step ${call} summary`, blocking_error: null };
    return { pid: null, exitCode: 0, signal: null, cancelled: false, timedOut: false,
      lastAgentMessage: JSON.stringify(agentResult), error: null, agentResult, terminationVerified: true };
  };
  let publicationCalls = 0;
  const fakePublication: PublishRunWorktree = async (worktree, options) => {
    publicationCalls++;
    assert.equal(call, 3, "publication must wait until every Sequence step has completed");
    assert.equal(options.settings.push, true);
    assert.equal(options.settings.createPullRequest, true);
    assert.equal(options.settings.pullRequestDraft, true);
    assert.equal(options.expectedHead, git(worktree.worktreePath, "rev-parse", "HEAD"));
    const pushedAt = "2026-09-14T12:00:00.000Z";
    const pullRequestUrl = "https://github.com/fixture/agenttasker/pull/42";
    options.onEvent?.({ stage: "push", status: "success", message: "Published run branch." });
    options.onEvent?.({ stage: "pull-request", status: "success", message: "Draft pull request ready.", pullRequestUrl });
    return { pushed: true, pushedAt, pullRequestUrl, pullRequestCreated: true, branch: options.branch ?? worktree.branch };
  };
  const queued = fixture.runRepository.createSequence(project.id, sequence.id, sequence.name);
  assert.deepEqual(fixture.runRepository.list(project.id), [], "Sequence Runs must never appear in the Tasks history");
  assert.deepEqual(fixture.runRepository.listSequences(project.id).map((run) => run.id), [queued.id]);
  const claimed = fixture.runRepository.claim()!;
  await executeRun(claimed, new AbortController(), fakeCodex, fakePublication);

  const run = fixture.runRepository.get(project.id, queued.id);
  assert.equal(run.kind, "SEQUENCE");
  assert.equal(run.status, "SUCCESS", run.error ?? undefined);
  assert.equal(run.currentStepId, null);
  assert.equal(call, 3);
  assert.equal(publicationCalls, 1);
  assert.equal(run.pushedAt, "2026-09-14T12:00:00.000Z");
  assert.equal(run.pullRequestUrl, "https://github.com/fixture/agenttasker/pull/42");
  assert.deepEqual(JSON.parse(run.resolvedConfig ?? "{}").localExecution.environmentVariables, ["SEARP_API_KEY"]);
  assert.match(prompts[0], /step 1 of 3/i);
  assert.match(prompts[1], /Step 1 summary/);
  assert.match(prompts[2], /Step 2 summary/);
  const steps = sequenceRunRepository.list(run.id);
  assert.deepEqual(steps.map((step) => step.status), ["SUCCESS", "SUCCESS", "SUCCESS"]);
  assert.ok(steps[0].commitHash);
  assert.ok(steps[1].commitHash);
  assert.equal(steps[2].commitHash, null);
  assert.match(run.diff ?? "", /research\.txt/);
  assert.match(run.diff ?? "", /article\.txt/);
  assert.equal(git(repo, "rev-list", "--count", `${base}..${run.runBranch}`), "2");
});

test("a failed Sequence step stops every following step", { timeout: 60_000 }, async () => {
  const { project, sequence } = await sequenceFixture(true, "after_each_step");
  let call = 0;
  const fakeCodex: typeof runCodex = async (options) => {
    call++;
    if (call === 1) {
      fs.writeFileSync(path.join(options.worktreePath, "research.txt"), "partial research");
      const agentResult = { status: "SUCCESS" as const, summary: "Research complete", blocking_error: null };
      return { pid: null, exitCode: 0, signal: null, cancelled: false, timedOut: false,
        lastAgentMessage: JSON.stringify(agentResult), error: null, agentResult, terminationVerified: true };
    }
    const agentResult = { status: "FAILURE" as const, summary: "Writing blocked", blocking_error: "Missing source" };
    return { pid: null, exitCode: 0, signal: null, cancelled: false, timedOut: false,
      lastAgentMessage: JSON.stringify(agentResult), error: "Missing source", agentResult, terminationVerified: true };
  };
  let publicationCalls = 0;
  const fakePublication: PublishRunWorktree = async (worktree, options) => {
    publicationCalls++;
    assert.equal(call, 1, "the first step must be published before the next step starts");
    assert.equal(options.baseBranch, "main");
    assert.match(options.branch ?? "", /-step-001-research$/);
    const pushedAt = "2026-09-14T13:00:00.000Z";
    const pullRequestUrl = "https://github.com/fixture/agenttasker/pull/51";
    options.onEvent?.({ stage: "push", status: "success", message: "Published step branch.", branch: options.branch });
    options.onEvent?.({ stage: "pull-request", status: "success", message: "Draft step PR ready.",
      branch: options.branch, pullRequestUrl });
    return { pushed: true, pushedAt, pullRequestUrl, pullRequestCreated: true,
      branch: options.branch ?? worktree.branch };
  };
  const queued = fixture.runRepository.createSequence(project.id, sequence.id, sequence.name);
  await executeRun(fixture.runRepository.claim()!, new AbortController(), fakeCodex, fakePublication);
  const run = fixture.runRepository.get(project.id, queued.id);
  assert.equal(run.status, "FAILED");
  assert.equal(call, 2, "the third step must never be started");
  assert.equal(publicationCalls, 1);
  const steps = sequenceRunRepository.list(run.id);
  assert.deepEqual(steps.map((step) => step.status), ["SUCCESS", "FAILED", "SKIPPED"]);
  assert.match(steps[0].publicationBranch ?? "", /-step-001-research$/);
  assert.equal(steps[0].pullRequestUrl, "https://github.com/fixture/agenttasker/pull/51");
  assert.equal(steps[1].pullRequestUrl, null);
  assert.equal(run.pullRequestUrl, "https://github.com/fixture/agenttasker/pull/51");
  assert.ok(run.worktreePath && fs.existsSync(run.worktreePath), "failed Sequence work must be preserved");
});

test("a validation resume reuses the completed Codex step and continues the Sequence", { timeout: 60_000 }, async () => {
  const { project, sequence, repo, base } = await sequenceFixture();
  const { prepareRunWorktree } = await import("../backend/git/run-git.service");
  const { RUNNER_CONFIG } = await import("../backend/runs/runner-config");
  const source = fixture.runRepository.createSequence(project.id, sequence.id, sequence.name);
  const worktree = await prepareRunWorktree({
    repoPath: repo, worktreesRoot: path.join(RUNNER_CONFIG.dataDirectory, "worktrees"), runId: source.id,
    taskId: sequence.id, remote: "origin", baseBranch: "main",
  });
  fs.writeFileSync(path.join(worktree.worktreePath, "retry.txt"), "completed before validation failed");
  const agentResult = JSON.stringify({ status: "SUCCESS", summary: "Research complete", blocking_error: null });
  fixture.runRepository.update(source.id, {
    status: "FAILED", baseRemote: "origin", baseBranch: "main", baseCommit: worktree.baseCommit,
    runBranch: worktree.branch, worktreePath: worktree.worktreePath, exitCode: 0, result: agentResult,
    error: "Validate package script: test failed.", completedAt: new Date().toISOString(), terminationVerified: true,
  });
  sequenceRunRepository.initialize(source.id, sequence);
  sequenceRunRepository.update(source.id, sequence.steps[0].id, {
    status: "FAILED", exitCode: 0, result: agentResult, error: "Validate package script: test failed.",
    startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
  });
  sequenceRunRepository.stopRemaining(source.id, "SKIPPED", "A previous Sequence step failed.");
  fixture.runRepository.event(source.id, "validation", "Failed test", JSON.stringify({
    kind: "project-command", phase: "validation", status: "failed", sequenceStepId: sequence.steps[0].id,
  }));

  const resumed = await sequenceRunService.resumeValidation(project.id, source.id);
  assert.equal(resumed.resumeFromRunId, source.id);
  assert.equal(resumed.resumeStepId, sequence.steps[0].id);
  let calls = 0;
  const fakeCodex: typeof runCodex = async (options) => {
    calls++;
    assert.ok(calls <= 2, "Codex must not be started again for the completed first step");
    assert.equal(fs.readFileSync(path.join(options.worktreePath, "retry.txt"), "utf8"), "completed before validation failed");
    fs.writeFileSync(path.join(options.worktreePath, calls === 1 ? "article.txt" : "review.txt"), `generated ${calls}`);
    const result = { status: "SUCCESS" as const, summary: `New step ${calls}`, blocking_error: null };
    return { pid: null, exitCode: 0, signal: null, cancelled: false, timedOut: false,
      lastAgentMessage: JSON.stringify(result), error: null, agentResult: result, terminationVerified: true };
  };
  await executeRun(fixture.runRepository.claim()!, new AbortController(), fakeCodex);

  const completed = fixture.runRepository.get(project.id, resumed.id);
  assert.equal(completed.status, "SUCCESS", completed.error ?? undefined);
  assert.equal(calls, 2, "only the two remaining Sequence steps use Codex");
  assert.deepEqual(sequenceRunRepository.list(completed.id).map((step) => step.status), ["SUCCESS", "SUCCESS", "SUCCESS"]);
  assert.equal(fixture.runRepository.get(project.id, source.id).status, "FAILED", "source history stays immutable");
  assert.equal(git(repo, "rev-list", "--count", `${base}..${worktree.branch}`), "3");
});
