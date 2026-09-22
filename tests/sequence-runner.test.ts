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
let sequenceCheckpointService: typeof import("../backend/sequences/sequence-checkpoint.service").sequenceCheckpointService;
let projectEnvironmentVariableService: typeof import("../backend/runs/project-environment-variable.service").projectEnvironmentVariableService;

before(async () => {
  fixture = await isolatedRunner();
  ({ executeRun } = await import("../backend/runs/run-worker"));
  ({ sequenceService } = await import("../backend/sequences/sequence.service"));
  ({ sequenceRunRepository } = await import("../backend/sequences/sequence-run.repository"));
  ({ sequenceRunService } = await import("../backend/sequences/sequence-run.service"));
  ({ sequenceCheckpointService } = await import("../backend/sequences/sequence-checkpoint.service"));
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
  assert.match(prompts[0], /read `\.tasker\/LESSONS\.md` in this worktree/i);
  assert.match(prompts[0], /Terminal, tooling, test, and build errors can be useful lessons/i);
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

test("adding a Sequence step continues from the completed prefix without rerunning it", { timeout: 60_000 }, async () => {
  const { project, repo, sequence: initialSequence, base } = await sequenceFixture();
  let initialCalls = 0;
  const initialCodex: typeof runCodex = async (options) => {
    initialCalls++;
    fs.writeFileSync(path.join(options.worktreePath, `initial-${initialCalls}.txt`), `completed ${initialCalls}`);
    const agentResult = { status: "SUCCESS" as const, summary: `Initial step ${initialCalls}`, blocking_error: null };
    return { pid: null, exitCode: 0, signal: null, cancelled: false, timedOut: false,
      lastAgentMessage: JSON.stringify(agentResult), error: null, agentResult, terminationVerified: true };
  };
  const initialRun = fixture.runRepository.createSequence(project.id, initialSequence.id, initialSequence.name);
  await executeRun(fixture.runRepository.claim()!, new AbortController(), initialCodex);
  assert.equal(fixture.runRepository.get(project.id, initialRun.id).status, "SUCCESS");
  assert.equal(initialCalls, 3);

  const sequence = await sequenceService.createStep(project.id, initialSequence.id, {
    name: "Publish", instructions: "Publish the completed work.", expectChanges: true,
  });
  const continued = await sequenceRunService.enqueue(project.id, sequence.id);
  assert.equal(continued.resumeFromRunId, initialRun.id);
  assert.equal(continued.resumeStage, "CONTINUING");
  assert.deepEqual(sequenceRunRepository.list(continued.id).map((step) => step.status), ["SUCCESS", "SUCCESS", "SUCCESS", "PENDING"]);

  let continuationCalls = 0;
  const continuationCodex: typeof runCodex = async (options) => {
    continuationCalls++;
    assert.equal(fs.readFileSync(path.join(options.worktreePath, "initial-1.txt"), "utf8"), "completed 1");
    fs.writeFileSync(path.join(options.worktreePath, "publish.txt"), "published");
    const agentResult = { status: "SUCCESS" as const, summary: "Published", blocking_error: null };
    return { pid: null, exitCode: 0, signal: null, cancelled: false, timedOut: false,
      lastAgentMessage: JSON.stringify(agentResult), error: null, agentResult, terminationVerified: true };
  };
  await executeRun(fixture.runRepository.claim()!, new AbortController(), continuationCodex);

  const completed = fixture.runRepository.get(project.id, continued.id);
  assert.equal(completed.status, "SUCCESS", completed.error ?? undefined);
  assert.equal(continuationCalls, 1, "only the new Sequence step should start Codex");
  assert.deepEqual(sequenceRunRepository.list(completed.id).map((step) => step.status), ["SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS"]);
  assert.equal(git(repo, "rev-list", "--count", `${base}..${completed.runBranch}`), "4");
});

test("a newer failed Run prevents an older prefix from being presented as new steps", async () => {
  const { project, sequence } = await sequenceFixture();
  const older = fixture.runRepository.createSequence(project.id, sequence.id, sequence.name);
  sequenceRunRepository.initialize(older.id, { ...sequence, steps: [sequence.steps[0]] });
  fixture.runRepository.update(older.id, {
    status: "SUCCESS", terminationVerified: true, runBranch: `tasker/run-${older.id}-${sequence.id}`,
    baseCommit: "a".repeat(40), completedAt: new Date().toISOString(),
  });
  sequenceRunRepository.update(older.id, sequence.steps[0].id, { status: "SUCCESS", completedAt: new Date().toISOString() });

  const newer = fixture.runRepository.createSequence(project.id, sequence.id, sequence.name);
  sequenceRunRepository.initialize(newer.id, sequence);
  fixture.runRepository.update(newer.id, { status: "FAILED", terminationVerified: true, completedAt: new Date().toISOString() });
  sequenceRunRepository.update(newer.id, sequence.steps[0].id, { status: "SUCCESS", completedAt: new Date().toISOString() });
  sequenceRunRepository.update(newer.id, sequence.steps[1].id, { status: "SUCCESS", completedAt: new Date().toISOString() });
  sequenceRunRepository.update(newer.id, sequence.steps[2].id, { status: "FAILED", completedAt: new Date().toISOString() });

  const enqueued = await sequenceRunService.enqueue(project.id, sequence.id);
  assert.equal(enqueued.resumeFromRunId, null);
  assert.equal(enqueued.resumeStage, null);
});

test("an expanded Sequence continues from the certified prefix of a failed Run", async () => {
  const { project, sequence } = await sequenceFixture();
  const initialDefinition = { ...sequence, steps: sequence.steps.slice(0, 1) };
  const source = fixture.runRepository.createSequence(project.id, sequence.id, sequence.name);
  sequenceRunRepository.initialize(source.id, initialDefinition);
  fixture.runRepository.update(source.id, {
    status: "SUCCESS",
    terminationVerified: true,
    runBranch: `tasker/run-${source.id}-${sequence.id}`,
    baseCommit: "a".repeat(40),
    completedAt: new Date().toISOString(),
  });
  sequenceRunRepository.update(source.id, initialDefinition.steps[0].id, {
    status: "SUCCESS",
    completedAt: new Date().toISOString(),
  });

  const attemptedDefinition = { ...sequence, steps: sequence.steps.slice(0, 2) };
  const attempted = fixture.runRepository.createSequenceContinuation(source);
  sequenceRunRepository.initializeContinuation(attempted.id, source.id, attemptedDefinition);
  fixture.runRepository.update(attempted.id, {
    status: "FAILED",
    terminationVerified: true,
    runBranch: `tasker/run-${attempted.id}-${sequence.id}`,
    baseCommit: "a".repeat(40),
    completedAt: new Date().toISOString(),
  });
  sequenceRunRepository.update(attempted.id, attemptedDefinition.steps[1].id, {
    status: "FAILED",
    completedAt: new Date().toISOString(),
  });

  const enqueued = await sequenceRunService.enqueue(project.id, sequence.id);
  assert.equal(enqueued.resumeFromRunId, attempted.id);
  assert.equal(enqueued.resumeStage, "CONTINUING");
  assert.deepEqual(
    sequenceRunRepository.list(enqueued.id).map((step) => step.status),
    ["SUCCESS", "PENDING", "PENDING"],
  );
});

test("Play does not rerun certified steps after a failed continuation", { timeout: 60_000 }, async () => {
  const { project, sequence: initialSequence } = await sequenceFixture();
  let initialCalls = 0;
  const initialCodex: typeof runCodex = async (options) => {
    initialCalls++;
    fs.writeFileSync(path.join(options.worktreePath, `initial-${initialCalls}.txt`), `completed ${initialCalls}`);
    const agentResult = { status: "SUCCESS" as const, summary: `Initial step ${initialCalls}`, blocking_error: null };
    return { pid: null, exitCode: 0, signal: null, cancelled: false, timedOut: false,
      lastAgentMessage: JSON.stringify(agentResult), error: null, agentResult, terminationVerified: true };
  };
  const initialRun = fixture.runRepository.createSequence(project.id, initialSequence.id, initialSequence.name);
  await executeRun(fixture.runRepository.claim()!, new AbortController(), initialCodex);
  assert.equal(fixture.runRepository.get(project.id, initialRun.id).status, "SUCCESS");
  assert.equal(initialCalls, 3);

  const withFailedStep = await sequenceService.createStep(project.id, initialSequence.id, {
    name: "Publish", instructions: "Publish the completed work.", expectChanges: true,
  });
  const failedRun = await sequenceRunService.enqueue(project.id, withFailedStep.id);
  const failedCodex: typeof runCodex = async () => {
    const agentResult = { status: "FAILURE" as const, summary: "Publish blocked", blocking_error: "Missing source" };
    return { pid: null, exitCode: 0, signal: null, cancelled: false, timedOut: false,
      lastAgentMessage: JSON.stringify(agentResult), error: "Missing source", agentResult, terminationVerified: true };
  };
  await executeRun(fixture.runRepository.claim()!, new AbortController(), failedCodex);
  assert.equal(fixture.runRepository.get(project.id, failedRun.id).status, "FAILED");
  assert.deepEqual(sequenceRunRepository.list(failedRun.id).map((step) => step.status), ["SUCCESS", "SUCCESS", "SUCCESS", "FAILED"]);

  const expanded = await sequenceService.createStep(project.id, initialSequence.id, {
    name: "Promote", instructions: "Promote the published work.", expectChanges: true,
  });
  const continued = await sequenceRunService.enqueue(project.id, expanded.id);
  assert.equal(continued.resumeFromRunId, failedRun.id);
  assert.equal(continued.resumeStage, "CONTINUING");
  assert.deepEqual(sequenceRunRepository.list(continued.id).map((step) => step.status), [
    "SUCCESS", "SUCCESS", "SUCCESS", "PENDING", "PENDING",
  ]);

  let resumedCalls = 0;
  const resumedCodex: typeof runCodex = async (options) => {
    resumedCalls++;
    assert.equal(fs.readFileSync(path.join(options.worktreePath, "initial-1.txt"), "utf8"), "completed 1");
    fs.writeFileSync(path.join(options.worktreePath, `resumed-${resumedCalls}.txt`), `completed ${resumedCalls}`);
    const agentResult = { status: "SUCCESS" as const, summary: `Resumed step ${resumedCalls}`, blocking_error: null };
    return { pid: null, exitCode: 0, signal: null, cancelled: false, timedOut: false,
      lastAgentMessage: JSON.stringify(agentResult), error: null, agentResult, terminationVerified: true };
  };
  await executeRun(fixture.runRepository.claim()!, new AbortController(), resumedCodex);
  assert.equal(fixture.runRepository.get(project.id, continued.id).status, "SUCCESS");
  assert.equal(resumedCalls, 2, "only the failed and newly added steps should run");
  assert.deepEqual(sequenceRunRepository.list(continued.id).map((step) => step.status), [
    "SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS",
  ]);
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

test("a portable checkpoint resumes the unfinished Sequence from its pushed Run branch", { timeout: 60_000 }, async () => {
  const { project, repo, sequence } = await sequenceFixture(true);
  let sourceCalls = 0;
  const sourceCodex: typeof runCodex = async (options) => {
    sourceCalls++;
    if (sourceCalls === 1) {
      fs.writeFileSync(path.join(options.worktreePath, "portable-research.txt"), "durable checkpoint work");
      const agentResult = { status: "SUCCESS" as const, summary: "Research complete", blocking_error: null };
      return { pid: null, exitCode: 0, signal: null, cancelled: false, timedOut: false,
        lastAgentMessage: JSON.stringify(agentResult), error: null, agentResult, terminationVerified: true };
    }
    const agentResult = { status: "FAILURE" as const, summary: "Source stopped", blocking_error: "Source stopped" };
    return { pid: null, exitCode: 0, signal: null, cancelled: false, timedOut: false,
      lastAgentMessage: JSON.stringify(agentResult), error: "Source stopped", agentResult, terminationVerified: true };
  };
  const source = fixture.runRepository.createSequence(project.id, sequence.id, sequence.name);
  await executeRun(fixture.runRepository.claim()!, new AbortController(), sourceCodex);
  assert.equal(fixture.runRepository.get(project.id, source.id).status, "FAILED");

  const checkpoint = await sequenceRunService.portableCheckpoint(project.id, sequence.id);
  assert.ok(checkpoint);
  assert.equal(checkpoint!.status, "FAILED");
  assert.deepEqual(checkpoint!.steps.map((step) => step.status), ["SUCCESS", "FAILED", "SKIPPED"]);
  assert.equal(checkpoint!.runBranch, source.runBranch ?? `tasker/run-${source.id}-${sequence.id}`);
  assert.equal(git(repo, "ls-remote", "--heads", "origin", `refs/heads/${checkpoint!.runBranch}`).split(/\s+/)[0], checkpoint!.checkpointCommit);

  const resumed = await sequenceRunService.resumePortableCheckpoint(project.id, sequence.id);
  assert.equal(resumed.resumeStage, "REMOTE_CHECKPOINT");
  assert.deepEqual(sequenceRunRepository.list(resumed.id).map((step) => step.status), ["SUCCESS", "PENDING", "PENDING"]);
  let resumedCalls = 0;
  const resumedCodex: typeof runCodex = async (options) => {
    resumedCalls++;
    assert.equal(fs.readFileSync(path.join(options.worktreePath, "portable-research.txt"), "utf8"), "durable checkpoint work");
    fs.writeFileSync(path.join(options.worktreePath, `portable-${resumedCalls}.txt`), "continued");
    const agentResult = { status: "SUCCESS" as const, summary: "Continued", blocking_error: null };
    return { pid: null, exitCode: 0, signal: null, cancelled: false, timedOut: false,
      lastAgentMessage: JSON.stringify(agentResult), error: null, agentResult, terminationVerified: true };
  };
  const fakeFinalPublication: PublishRunWorktree = async (worktree, options) => ({
    pushed: true, pushedAt: "2026-09-22T12:00:00.000Z", pullRequestUrl: null, pullRequestCreated: false,
    branch: options.branch ?? worktree.branch,
  });
  await executeRun(fixture.runRepository.claim()!, new AbortController(), resumedCodex, fakeFinalPublication);
  assert.equal(resumedCalls, 2);
  assert.equal(fixture.runRepository.get(project.id, resumed.id).status, "SUCCESS", fixture.runRepository.get(project.id, resumed.id).error ?? undefined);
  const completedCheckpoint = await sequenceRunService.portableCheckpoint(project.id, sequence.id);
  assert.equal(completedCheckpoint?.status, "SUCCESS");
  assert.deepEqual(completedCheckpoint?.steps.map((step) => step.status), ["SUCCESS", "SUCCESS", "SUCCESS"]);
});

test("independent step PRs continue after one failure and restart from the base", { timeout: 60_000 }, async () => {
  const { project, repo, sequence: initialSequence, base } = await sequenceFixture(true);
  const sequence = await sequenceService.update(project.id, initialSequence.id, {
    name: initialSequence.name,
    pullRequestStrategy: "independent_after_each_step",
    failurePolicy: "continue",
    maxConsecutiveFailures: 2,
  });
  let call = 0;
  const fakeCodex: typeof runCodex = async (options) => {
    call++;
    if (call === 1) {
      fs.writeFileSync(path.join(options.worktreePath, "research.txt"), "first article");
    } else if (call === 2) {
      assert.equal(fs.existsSync(path.join(options.worktreePath, "research.txt")), false);
      fs.writeFileSync(path.join(options.worktreePath, "failed.txt"), "partial article");
      const agentResult = { status: "FAILURE" as const, summary: "Missing source", blocking_error: "Missing source" };
      return { pid: null, exitCode: 0, signal: null, cancelled: false, timedOut: false,
        lastAgentMessage: JSON.stringify(agentResult), error: "Missing source", agentResult, terminationVerified: true };
    } else {
      assert.equal(fs.existsSync(path.join(options.worktreePath, "research.txt")), false);
      assert.equal(fs.existsSync(path.join(options.worktreePath, "failed.txt")), false);
      fs.writeFileSync(path.join(options.worktreePath, "review.txt"), "third article");
    }
    const agentResult = { status: "SUCCESS" as const, summary: `Step ${call} complete`, blocking_error: null };
    return { pid: null, exitCode: 0, signal: null, cancelled: false, timedOut: false,
      lastAgentMessage: JSON.stringify(agentResult), error: null, agentResult, terminationVerified: true };
  };
  const publicationBases: string[] = [];
  const fakePublication: PublishRunWorktree = async (worktree, options) => {
    publicationBases.push(options.baseBranch ?? "");
    assert.equal(options.baseBranch, "main");
    assert.equal(git(worktree.worktreePath, "rev-parse", `${options.expectedHead}^`), base);
    const branch = options.branch ?? worktree.branch;
    return { pushed: true, pushedAt: "2026-09-22T12:00:00.000Z",
      pullRequestUrl: `https://github.com/fixture/agenttasker/pull/${publicationBases.length}`,
      pullRequestCreated: true, branch };
  };
  const queued = fixture.runRepository.createSequence(project.id, sequence.id, sequence.name);
  await executeRun(fixture.runRepository.claim()!, new AbortController(), fakeCodex, fakePublication);

  const run = fixture.runRepository.get(project.id, queued.id);
  assert.equal(run.status, "SUCCESS", run.error ?? undefined);
  assert.equal(call, 3);
  assert.deepEqual(publicationBases, ["main", "main"]);
  assert.deepEqual(sequenceRunRepository.list(run.id).map((step) => step.status), ["SUCCESS", "FAILED", "SUCCESS"]);
  assert.equal(git(repo, "rev-parse", run.runBranch!), base, "the durable Run branch returns to the base after independent steps");
});

test("an independent Sequence finalizes its portable checkpoint without pushing its reset branch backwards", { timeout: 60_000 }, async () => {
  const { project, sequence: initialSequence } = await sequenceFixture(true);
  const sequence = await sequenceService.update(project.id, initialSequence.id, {
    name: initialSequence.name,
    pullRequestStrategy: "independent_after_each_step",
    failurePolicy: "continue",
    maxConsecutiveFailures: 2,
  });
  let calls = 0;
  const codex: typeof runCodex = async (options) => {
    calls++;
    fs.writeFileSync(path.join(options.worktreePath, `independent-${calls}.txt`), `step ${calls}`);
    const agentResult = { status: "SUCCESS" as const, summary: `Independent step ${calls}`, blocking_error: null };
    return { pid: null, exitCode: 0, signal: null, cancelled: false, timedOut: false,
      lastAgentMessage: JSON.stringify(agentResult), error: null, agentResult, terminationVerified: true };
  };
  const publication: PublishRunWorktree = async (worktree, options) => ({
    pushed: true, pushedAt: "2026-09-22T12:00:00.000Z", pullRequestUrl: null, pullRequestCreated: false,
    branch: options.branch ?? worktree.branch,
  });
  const queued = fixture.runRepository.createSequence(project.id, sequence.id, sequence.name);
  await executeRun(fixture.runRepository.claim()!, new AbortController(), codex, publication);

  const run = fixture.runRepository.get(project.id, queued.id);
  assert.equal(run.status, "SUCCESS", run.error ?? undefined);
  assert.equal(run.warning, null);
  const checkpoint = await sequenceRunService.portableCheckpoint(project.id, sequence.id);
  assert.equal(checkpoint?.status, "SUCCESS");
  assert.deepEqual(checkpoint?.steps.map((step) => step.status), ["SUCCESS", "SUCCESS", "SUCCESS"]);
});

test("a checkpoint sync warning does not mark certified independent steps as failed", { timeout: 60_000 }, async (t) => {
  const { project, sequence: initialSequence } = await sequenceFixture(true);
  const sequence = await sequenceService.update(project.id, initialSequence.id, {
    name: initialSequence.name,
    pullRequestStrategy: "independent_after_each_step",
    failurePolicy: "continue",
    maxConsecutiveFailures: 2,
  });
  const originalSave = sequenceCheckpointService.save;
  sequenceCheckpointService.save = async (options) => {
    if (options.status === "SUCCESS") throw new Error("State branch temporarily unavailable.");
    return originalSave(options);
  };
  t.after(() => { sequenceCheckpointService.save = originalSave; });
  let calls = 0;
  const codex: typeof runCodex = async (options) => {
    calls++;
    fs.writeFileSync(path.join(options.worktreePath, `warning-${calls}.txt`), `step ${calls}`);
    const agentResult = { status: "SUCCESS" as const, summary: `Independent step ${calls}`, blocking_error: null };
    return { pid: null, exitCode: 0, signal: null, cancelled: false, timedOut: false,
      lastAgentMessage: JSON.stringify(agentResult), error: null, agentResult, terminationVerified: true };
  };
  const publication: PublishRunWorktree = async (worktree, options) => ({
    pushed: true, pushedAt: "2026-09-22T12:00:00.000Z", pullRequestUrl: null, pullRequestCreated: false,
    branch: options.branch ?? worktree.branch,
  });
  const queued = fixture.runRepository.createSequence(project.id, sequence.id, sequence.name);
  await executeRun(fixture.runRepository.claim()!, new AbortController(), codex, publication);

  const run = fixture.runRepository.get(project.id, queued.id);
  assert.equal(run.status, "SUCCESS", run.error ?? undefined);
  assert.match(run.warning ?? "", /checkpoint distant/i);
  assert.deepEqual(sequenceRunRepository.list(run.id).map((step) => step.status), ["SUCCESS", "SUCCESS", "SUCCESS"]);
});

test("independent steps stop at the configured consecutive-failure limit", { timeout: 60_000 }, async () => {
  const { project, sequence: initialSequence } = await sequenceFixture(true);
  const sequence = await sequenceService.update(project.id, initialSequence.id, {
    name: initialSequence.name,
    pullRequestStrategy: "independent_after_each_step",
    failurePolicy: "continue",
    maxConsecutiveFailures: 2,
  });
  let calls = 0;
  const fakeCodex: typeof runCodex = async () => {
    calls++;
    const agentResult = { status: "FAILURE" as const, summary: "Blocked", blocking_error: "Blocked" };
    return { pid: null, exitCode: 0, signal: null, cancelled: false, timedOut: false,
      lastAgentMessage: JSON.stringify(agentResult), error: "Blocked", agentResult, terminationVerified: true };
  };
  const queued = fixture.runRepository.createSequence(project.id, sequence.id, sequence.name);
  await executeRun(fixture.runRepository.claim()!, new AbortController(), fakeCodex);

  const run = fixture.runRepository.get(project.id, queued.id);
  assert.equal(run.status, "FAILED");
  assert.equal(calls, 2);
  assert.match(run.error ?? "", /2 consecutive failed independent steps/);
  assert.deepEqual(sequenceRunRepository.list(run.id).map((step) => step.status), ["FAILED", "FAILED", "SKIPPED"]);
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

test("an execution resume keeps the failed step worktree and restarts only that step", { timeout: 60_000 }, async () => {
  const { project, sequence, repo } = await sequenceFixture();
  const source = fixture.runRepository.createSequence(project.id, sequence.id, sequence.name);
  let initialCalls = 0;
  const incompleteCodex: typeof runCodex = async (options) => {
    initialCalls += 1;
    assert.equal(initialCalls, 1);
    fs.writeFileSync(path.join(options.worktreePath, "research.txt"), "preserved partial research");
    return { pid: null, exitCode: 0, signal: null, cancelled: false, timedOut: false,
      lastAgentMessage: "A report without the required result JSON.", agentResult: null,
      error: "Codex did not return a valid structured task result.", terminationVerified: true };
  };
  await executeRun(fixture.runRepository.claim()!, new AbortController(), incompleteCodex);
  const failed = fixture.runRepository.get(project.id, source.id);
  assert.equal(failed.status, "FAILED");
  assert.ok(failed.worktreePath);
  assert.equal(fs.readFileSync(path.join(failed.worktreePath!, "research.txt"), "utf8"), "preserved partial research");

  const resumed = await sequenceRunService.resume(project.id, source.id);
  assert.equal(resumed.resumeStage, "EXECUTING");
  assert.equal(resumed.resumeStepId, sequence.steps[0].id);
  assert.deepEqual(sequenceRunRepository.list(resumed.id).map((step) => step.status), ["PENDING", "PENDING", "PENDING"]);

  let resumedCalls = 0;
  const resumedCodex: typeof runCodex = async (options) => {
    resumedCalls += 1;
    if (resumedCalls === 1) {
      assert.equal(options.worktreePath, failed.worktreePath);
      assert.match(options.prompt, /A report without the required result JSON/);
      assert.equal(fs.readFileSync(path.join(options.worktreePath, "research.txt"), "utf8"), "preserved partial research");
      fs.appendFileSync(path.join(options.worktreePath, "research.txt"), " and completed");
    } else if (resumedCalls === 2) {
      assert.match(fs.readFileSync(path.join(options.worktreePath, "research.txt"), "utf8"), /completed/);
      fs.writeFileSync(path.join(options.worktreePath, "article.txt"), "article based on preserved research");
    }
    const result = { status: "SUCCESS" as const, summary: `Resumed step ${resumedCalls}`, blocking_error: null };
    return { pid: null, exitCode: 0, signal: null, cancelled: false, timedOut: false,
      lastAgentMessage: JSON.stringify(result), agentResult: result, error: null, terminationVerified: true };
  };
  await executeRun(fixture.runRepository.claim()!, new AbortController(), resumedCodex);

  const complete = fixture.runRepository.get(project.id, resumed.id);
  assert.equal(complete.status, "SUCCESS", complete.error ?? undefined);
  assert.equal(resumedCalls, 3);
  assert.deepEqual(sequenceRunRepository.list(resumed.id).map((step) => step.status), ["SUCCESS", "SUCCESS", "SUCCESS"]);
  assert.match(git(repo, "show", `${complete.runBranch}:research.txt`), /preserved partial research and completed/);
});

test("a paused Sequence preserves its worktree and resumes only its unfinished suffix locally", { timeout: 60_000 }, async () => {
  const { project, sequence } = await sequenceFixture();
  const source = fixture.runRepository.createSequence(project.id, sequence.id, sequence.name);
  let sourceCalls = 0;
  const pausingCodex: typeof runCodex = async (options) => {
    sourceCalls++;
    if (sourceCalls === 1) {
      fs.writeFileSync(path.join(options.worktreePath, "research.txt"), "certified research");
    } else {
      fs.writeFileSync(path.join(options.worktreePath, "draft.txt"), "partial draft preserved across pause");
      fixture.runService.pauseSequence(project.id, source.id);
    }
    const result = { status: "SUCCESS" as const, summary: `Step ${sourceCalls} completed before pause`, blocking_error: null };
    return { pid: null, exitCode: 0, signal: null, cancelled: false, timedOut: false,
      lastAgentMessage: JSON.stringify(result), agentResult: result, error: null, terminationVerified: true };
  };

  await executeRun(fixture.runRepository.claim()!, new AbortController(), pausingCodex);
  const paused = fixture.runRepository.get(project.id, source.id);
  assert.equal(paused.status, "CANCELLED");
  assert.equal(paused.pauseRequested, true);
  assert.equal(paused.terminationVerified, true);
  assert.ok(paused.worktreePath);
  assert.equal(fs.readFileSync(path.join(paused.worktreePath!, "draft.txt"), "utf8"), "partial draft preserved across pause");
  assert.deepEqual(sequenceRunRepository.list(source.id).map((step) => step.status), ["SUCCESS", "CANCELLED", "CANCELLED"]);
  await assert.rejects(() => sequenceRunService.enqueue(project.id, sequence.id), /en pause/);

  const resumed = await sequenceRunService.resume(project.id, source.id);
  assert.equal(resumed.resumeStage, "VALIDATING", "Codex completed the paused step, so only its validation is replayed");
  assert.equal(resumed.resumeStepId, sequence.steps[1].id);
  assert.deepEqual(sequenceRunRepository.list(resumed.id).map((step) => step.status), ["SUCCESS", "PENDING", "PENDING"]);

  let resumedCalls = 0;
  const resumedCodex: typeof runCodex = async (options) => {
    resumedCalls++;
    assert.equal(options.worktreePath, paused.worktreePath);
    assert.equal(fs.readFileSync(path.join(options.worktreePath, "draft.txt"), "utf8"), "partial draft preserved across pause");
    fs.writeFileSync(path.join(options.worktreePath, "review.txt"), "reviewed preserved draft");
    const result = { status: "SUCCESS" as const, summary: "Review completed after local resume", blocking_error: null };
    return { pid: null, exitCode: 0, signal: null, cancelled: false, timedOut: false,
      lastAgentMessage: JSON.stringify(result), agentResult: result, error: null, terminationVerified: true };
  };
  await executeRun(fixture.runRepository.claim()!, new AbortController(), resumedCodex);

  const completed = fixture.runRepository.get(project.id, resumed.id);
  assert.equal(completed.status, "SUCCESS", completed.error ?? undefined);
  assert.equal(resumedCalls, 1, "the already-completed paused Codex step must not be restarted");
  assert.deepEqual(sequenceRunRepository.list(resumed.id).map((step) => step.status), ["SUCCESS", "SUCCESS", "SUCCESS"]);
});
