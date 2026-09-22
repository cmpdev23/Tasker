import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Run, SequenceStepRun } from "../../db/schema";
import type { SequenceDefinition } from "../../src/types/sequences";
import { gitService } from "../git/git.service";
import { quoteToml, readInteger, readString } from "../tasks/toml";

export const SEQUENCE_STATE_BRANCH = "agenttasker/state";
const CHECKPOINT_ROOT = ".tasker/state/sequences";
const SHA = /^[0-9a-f]{40,64}$/i;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STEP_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;
const STATE = new Set(["IN_PROGRESS", "SUCCESS", "FAILED", "CANCELLED"]);

export interface PortableSequenceCheckpointStep {
  id: string;
  name: string;
  position: number;
  status: "SUCCESS" | "PENDING" | "FAILED" | "CANCELLED" | "SKIPPED";
  commitHash: string | null;
  publicationBranch: string | null;
  pullRequestUrl: string | null;
  completedAt: string | null;
}

export interface PortableSequenceCheckpoint {
  version: 1;
  sequenceId: string;
  sequenceName: string;
  runId: string;
  status: "IN_PROGRESS" | "SUCCESS" | "FAILED" | "CANCELLED";
  updatedAt: string;
  baseRemote: string;
  baseBranch: string;
  baseCommit: string;
  runBranch: string;
  checkpointCommit: string;
  steps: PortableSequenceCheckpointStep[];
}

export type SequenceCheckpointSourceStep = Pick<SequenceStepRun,
  "stepId" | "stepName" | "position" | "status" | "commitHash" | "publicationBranch" | "pullRequestUrl" | "completedAt">;

function checkpointPath(sequenceId: string) {
  if (!STEP_ID.test(sequenceId)) throw new Error("Invalid Sequence checkpoint identifier.");
  return `${CHECKPOINT_ROOT}/${sequenceId}.toml`;
}

async function git(cwd: string, args: string[], signal?: AbortSignal) {
  return (await gitService.run(cwd, args, { signal })).stdout;
}

function checkpointToml(checkpoint: PortableSequenceCheckpoint): string {
  const lines = [
    "# Portable AgentTasker Sequence checkpoint. Logs, process state and secrets remain local.",
    "version = 1",
    `sequence_id = ${quoteToml(checkpoint.sequenceId)}`,
    `sequence_name = ${quoteToml(checkpoint.sequenceName)}`,
    `run_id = ${quoteToml(checkpoint.runId)}`,
    `status = ${quoteToml(checkpoint.status)}`,
    `updated_at = ${quoteToml(checkpoint.updatedAt)}`,
    `base_remote = ${quoteToml(checkpoint.baseRemote)}`,
    `base_branch = ${quoteToml(checkpoint.baseBranch)}`,
    `base_commit = ${quoteToml(checkpoint.baseCommit)}`,
    `run_branch = ${quoteToml(checkpoint.runBranch)}`,
    `checkpoint_commit = ${quoteToml(checkpoint.checkpointCommit)}`,
  ];
  for (const step of checkpoint.steps) {
    lines.push("", "[[steps]]",
      `id = ${quoteToml(step.id)}`,
      `name = ${quoteToml(step.name)}`,
      `position = ${step.position}`,
      `status = ${quoteToml(step.status)}`,
    );
    if (step.commitHash) lines.push(`commit_hash = ${quoteToml(step.commitHash)}`);
    if (step.publicationBranch) lines.push(`publication_branch = ${quoteToml(step.publicationBranch)}`);
    if (step.pullRequestUrl) lines.push(`pull_request_url = ${quoteToml(step.pullRequestUrl)}`);
    if (step.completedAt) lines.push(`completed_at = ${quoteToml(step.completedAt)}`);
  }
  return `${lines.join("\n")}\n`;
}

function parseStep(source: string): PortableSequenceCheckpointStep {
  const id = readString(source, "id");
  const name = readString(source, "name");
  const position = readInteger(source, "position");
  const status = readString(source, "status");
  if (!id || !STEP_ID.test(id) || !name || position === undefined || position < 0 ||
      !status || !["SUCCESS", "PENDING", "FAILED", "CANCELLED", "SKIPPED"].includes(status)) {
    throw new Error("The portable Sequence checkpoint contains an invalid step.");
  }
  const commitHash = readString(source, "commit_hash") ?? null;
  if (commitHash && !SHA.test(commitHash)) throw new Error("The portable Sequence checkpoint contains an invalid step commit.");
  return {
    id, name, position, status: status as PortableSequenceCheckpointStep["status"], commitHash,
    publicationBranch: readString(source, "publication_branch") ?? null,
    pullRequestUrl: readString(source, "pull_request_url") ?? null,
    completedAt: readString(source, "completed_at") ?? null,
  };
}

export function parsePortableSequenceCheckpoint(content: string): PortableSequenceCheckpoint {
  const parts = content.replace(/\r\n/g, "\n").split(/^\s*\[\[steps\]\]\s*$/m);
  const source = parts.shift() ?? "";
  const version = readInteger(source, "version");
  const sequenceId = readString(source, "sequence_id");
  const sequenceName = readString(source, "sequence_name");
  const runId = readString(source, "run_id");
  const status = readString(source, "status");
  const updatedAt = readString(source, "updated_at");
  const baseRemote = readString(source, "base_remote");
  const baseBranch = readString(source, "base_branch");
  const baseCommit = readString(source, "base_commit");
  const runBranch = readString(source, "run_branch");
  const checkpointCommit = readString(source, "checkpoint_commit");
  if (version !== 1 || !sequenceId || !STEP_ID.test(sequenceId) || !sequenceName || !runId || !RUN_ID.test(runId) ||
      !status || !STATE.has(status) || !updatedAt || !baseRemote || !baseBranch || !baseCommit || !SHA.test(baseCommit) ||
      !runBranch || !checkpointCommit || !SHA.test(checkpointCommit)) {
    throw new Error("The portable Sequence checkpoint is invalid.");
  }
  const expectedBranch = `tasker/run-${runId}-${sequenceId}`;
  if (runBranch !== expectedBranch) throw new Error("The portable Sequence checkpoint branch does not match its Run identity.");
  const steps = parts.filter((part) => part.trim()).map(parseStep).sort((a, b) => a.position - b.position);
  if (steps.some((step, index) => step.position !== index || (index > 0 && step.id === steps[index - 1].id))) {
    throw new Error("The portable Sequence checkpoint step order is invalid.");
  }
  return { version: 1, sequenceId, sequenceName, runId, status: status as PortableSequenceCheckpoint["status"], updatedAt,
    baseRemote, baseBranch, baseCommit, runBranch, checkpointCommit, steps };
}

async function remoteStateHead(repoPath: string, remote: string, signal?: AbortSignal): Promise<string | null> {
  const stdout = await git(repoPath, ["ls-remote", "--heads", "--", remote, `refs/heads/${SEQUENCE_STATE_BRANCH}`], signal);
  const line = stdout.trim().split(/\r?\n/).find(Boolean);
  if (!line) return null;
  const sha = line.split(/\s+/)[0];
  if (!SHA.test(sha)) throw new Error("Git returned an invalid Sequence state branch commit.");
  return sha;
}

export async function publishSequenceCheckpointBranch(options: {
  repoPath: string; remote: string; branch: string; signal?: AbortSignal;
}): Promise<string> {
  const { repoPath, remote, branch, signal } = options;
  if (!/^tasker\/run-[0-9a-f-]{36}-[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/i.test(branch)) {
    throw new Error("The Sequence checkpoint branch is invalid.");
  }
  const head = (await git(repoPath, ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`], signal)).trim();
  if (!SHA.test(head)) throw new Error("Git returned an invalid Sequence checkpoint commit.");
  await git(repoPath, ["push", "--porcelain", "--", remote, `refs/heads/${branch}:refs/heads/${branch}`], signal);
  const remoteHead = (await git(repoPath, ["ls-remote", "--heads", "--", remote, `refs/heads/${branch}`], signal))
    .trim().split(/\s+/)[0];
  if (remoteHead !== head) throw new Error("The remote checkpoint branch does not match the verified Sequence commit.");
  return head;
}

export const sequenceCheckpointService = {
  async load(repoPath: string, remote: string, sequenceId: string, signal?: AbortSignal): Promise<PortableSequenceCheckpoint | null> {
    const branchHead = await remoteStateHead(repoPath, remote, signal);
    if (!branchHead) return null;
    const trackingRef = `refs/remotes/${remote}/${SEQUENCE_STATE_BRANCH}`;
    await git(repoPath, ["fetch", "--no-tags", "--no-recurse-submodules", "--refmap=", "--", remote,
      `+refs/heads/${SEQUENCE_STATE_BRANCH}:${trackingRef}`], signal);
    let content: string;
    try { content = await git(repoPath, ["show", `${trackingRef}:${checkpointPath(sequenceId)}`], signal); }
    catch { return null; }
    return parsePortableSequenceCheckpoint(content);
  },

  async save(options: {
    repoPath: string; runtimeRoot: string; remote: string; sequence: SequenceDefinition; run: Run;
    checkpointCommit: string; status: PortableSequenceCheckpoint["status"]; steps: SequenceCheckpointSourceStep[]; signal?: AbortSignal;
  }): Promise<PortableSequenceCheckpoint> {
    const { repoPath, runtimeRoot, remote, sequence, run, checkpointCommit, status, steps, signal } = options;
    if (!run.baseRemote || !run.baseBranch || !run.baseCommit || !run.runBranch || !SHA.test(checkpointCommit)) {
      throw new Error("The Sequence Run has incomplete Git coordinates for its portable checkpoint.");
    }
    const checkpoint: PortableSequenceCheckpoint = {
      version: 1, sequenceId: sequence.id, sequenceName: sequence.name, runId: run.id, status,
      updatedAt: new Date().toISOString(), baseRemote: run.baseRemote, baseBranch: run.baseBranch,
      baseCommit: run.baseCommit, runBranch: run.runBranch, checkpointCommit,
      steps: steps.map((step) => ({ id: step.stepId, name: step.stepName, position: step.position,
        status: step.status as PortableSequenceCheckpointStep["status"], commitHash: step.commitHash,
        publicationBranch: step.publicationBranch, pullRequestUrl: step.pullRequestUrl, completedAt: step.completedAt })),
    };
    const root = path.resolve(runtimeRoot, "sequence-state");
    await fs.mkdir(root, { recursive: true });
    for (let attempt = 0; attempt < 3; attempt++) {
      signal?.throwIfAborted();
      const expected = await remoteStateHead(repoPath, remote, signal);
      const startRef = expected
        ? `refs/remotes/${remote}/${SEQUENCE_STATE_BRANCH}`
        : `refs/remotes/${remote}/${run.baseBranch}`;
      if (expected) {
        await git(repoPath, ["fetch", "--no-tags", "--no-recurse-submodules", "--refmap=", "--", remote,
          `+refs/heads/${SEQUENCE_STATE_BRANCH}:${startRef}`], signal);
      } else {
        await git(repoPath, ["fetch", "--no-tags", "--no-recurse-submodules", "--refmap=", "--", remote,
          `+refs/heads/${run.baseBranch}:${startRef}`], signal);
      }
      const directory = path.join(root, `checkpoint-${randomUUID()}`);
      try {
        await git(repoPath, ["worktree", "add", "--detach", "--no-checkout", "--", directory, startRef], signal);
        await git(directory, ["checkout", "--detach", startRef], signal);
        const file = path.join(directory, ...checkpointPath(sequence.id).split("/"));
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, checkpointToml(checkpoint), "utf8");
        await git(directory, ["add", "--", checkpointPath(sequence.id)], signal);
        await git(directory, ["commit", "-m", `chore(agenttasker): checkpoint ${sequence.id}`], signal);
        const lease = `--force-with-lease=refs/heads/${SEQUENCE_STATE_BRANCH}:${expected ?? ""}`;
        await git(directory, ["push", "--porcelain", lease, "--", remote, `HEAD:refs/heads/${SEQUENCE_STATE_BRANCH}`], signal);
        return checkpoint;
      } catch (error) {
        if (attempt === 2) throw error;
      } finally {
        try { await git(repoPath, ["worktree", "remove", "--force", "--", directory], signal); } catch { /* Best-effort runtime cleanup. */ }
      }
    }
    throw new Error("Unable to write the portable Sequence checkpoint.");
  },
};
