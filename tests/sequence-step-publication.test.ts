import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { isolatedRunner } from "./helpers/runner";
import type { SequenceDefinition } from "../src/types/sequences";

type PublishVerifiedCommit = typeof import("../backend/git/run-publication.service").publishVerifiedCommit;

let fixture: Awaited<ReturnType<typeof isolatedRunner>>;
let sequenceRunRepository: typeof import("../backend/sequences/sequence-run.repository").sequenceRunRepository;
let publishSequenceStepDraft: typeof import("../backend/sequences/sequence-step-publication.service").publishSequenceStepDraft;

const sequence: SequenceDefinition = {
  id: "content-pipeline",
  name: "Content pipeline",
  pullRequestStrategy: "after_sequence",
  failurePolicy: "stop",
  maxConsecutiveFailures: 2,
  steps: [
    { id: "research", name: "Research", instructions: "Research", expectChanges: true },
    { id: "write", name: "Write", instructions: "Write", expectChanges: true },
  ],
};

before(async () => {
  fixture = await isolatedRunner();
  ({ sequenceRunRepository } = await import("../backend/sequences/sequence-run.repository"));
  ({ publishSequenceStepDraft } = await import("../backend/sequences/sequence-step-publication.service"));
});
beforeEach(() => fixture.reset());
after(() => fixture?.close());

test("manual Sequence-step publication creates a draft PR from the exact stored commit", async () => {
  const project = await fixture.project();
  const run = fixture.runRepository.createSequence(project.id, sequence.id, sequence.name);
  fixture.runRepository.update(run.id, {
    status: "FAILED",
    baseRemote: "origin",
    baseBranch: "main",
    runBranch: "tasker/run-42-content-pipeline",
    terminationVerified: true,
    codexPid: null,
  });
  sequenceRunRepository.initialize(run.id, sequence);
  sequenceRunRepository.update(run.id, "research", {
    status: "SUCCESS",
    commitHash: "a".repeat(40),
  });
  sequenceRunRepository.update(run.id, "write", {
    status: "SUCCESS",
    commitHash: "b".repeat(40),
  });

  const calls: Parameters<PublishVerifiedCommit>[0][] = [];
  const publish: PublishVerifiedCommit = async (options) => {
    calls.push(options);
    options.onEvent?.({ stage: "push", status: "success", message: "Branch verified.", branch: options.branch });
    options.onEvent?.({ stage: "pull-request", status: "success", message: "Draft pull request created.", branch: options.branch,
      pullRequestUrl: "https://github.com/fixture/agenttasker/pull/71" });
    return { pushed: true, pushedAt: "2026-09-22T12:00:00.000Z", pullRequestUrl: "https://github.com/fixture/agenttasker/pull/71",
      pullRequestCreated: true, branch: options.branch };
  };

  const first = await publishSequenceStepDraft(project.id, run.id, "research", publish);
  assert.equal(first.step.pullRequestUrl, "https://github.com/fixture/agenttasker/pull/71");
  assert.equal(first.step.publicationBranch, "tasker/run-42-content-pipeline-step-001-research");
  assert.equal(calls[0].expectedHead, "a".repeat(40));
  assert.equal(calls[0].baseBranch, "main");
  assert.equal(calls[0].settings.pullRequestDraft, true);

  await publishSequenceStepDraft(project.id, run.id, "write", publish);
  assert.equal(calls[1].branch, "tasker/run-42-content-pipeline-step-002-write");
  assert.equal(calls[1].baseBranch, first.step.publicationBranch);
  assert.equal(fixture.runRepository.events(run.id).filter((event) => event.type === "publication").length, 4);
});

test("manual Sequence-step publication rejects active and uncommitted steps", async () => {
  const project = await fixture.project();
  const run = fixture.runRepository.createSequence(project.id, sequence.id, sequence.name);
  sequenceRunRepository.initialize(run.id, sequence);
  await assert.rejects(() => publishSequenceStepDraft(project.id, run.id, "research"), /stopped/i);

  fixture.runRepository.update(run.id, {
    status: "FAILED", baseRemote: "origin", baseBranch: "main", runBranch: "tasker/run-43-content-pipeline",
    terminationVerified: true, codexPid: null,
  });
  await assert.rejects(() => publishSequenceStepDraft(project.id, run.id, "research"), /verified commit/i);
});
