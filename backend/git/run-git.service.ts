import fs from "node:fs/promises";
import path from "node:path";
import { gitService } from "./git.service";

export interface PrepareRunWorktreeOptions {
  repoPath: string;
  /** Trusted machine-local runtime directory supplied by the backend, never task TOML. */
  worktreesRoot: string;
  runId: string;
  taskId: string;
  remote: string;
  baseBranch: string;
  signal?: AbortSignal;
  /** Await durable worker metadata before creating any run branch or worktree. */
  onPrepared?: (worktree: RunWorktree) => void | Promise<void>;
}

export interface RunWorktree {
  readonly repoPath: string;
  readonly worktreesRoot: string;
  readonly worktreePath: string;
  readonly branch: string;
  readonly remote: string;
  readonly baseBranch: string;
  readonly trackingRef: string;
  readonly baseCommit: string;
}

export interface FinalizeRunWorktreeOptions {
  exitCode: number | null;
  /** The worker must independently finish validations before allowing a commit. */
  validationsSucceeded: boolean;
  cancelled?: boolean;
  timedOut?: boolean;
  expectChanges?: boolean;
  commit?: boolean;
  commitMessage: string;
  signal?: AbortSignal;
}

export interface RunGitResult {
  success: boolean;
  hasChanges: boolean;
  commitSha: string | null;
  /** Includes staged and unstaged tracked changes; status also lists new files. */
  diff: string;
  status: string;
  error: string | null;
}

export interface DeleteRunArtifactsOptions {
  repoPath: string;
  worktreesRoot: string;
  worktreePath: string;
  branch: string;
  runId: string;
  taskId: string;
  signal?: AbortSignal;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TASK_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;

function contains(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

async function canonicalProspectivePath(target: string): Promise<string> {
  try {
    return await fs.realpath(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = path.dirname(target);
    if (parent === target) throw error;
    return path.join(/* turbopackIgnore: true */ await canonicalProspectivePath(parent), path.basename(target));
  }
}

async function git(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
  return (await gitService.run(cwd, args, { signal })).stdout;
}

async function ensureExternalRoot(repoPath: string, root: string, signal?: AbortSignal) {
  const entries = (await git(repoPath, ["worktree", "list", "--porcelain", "-z"], signal)).split("\0\0");
  for (const entry of entries) {
    const fields = entry.split("\0");
    const directory = fields.find((field) => field.startsWith("worktree "));
    if (!directory) continue;
    const checkout = await canonicalProspectivePath(directory.slice("worktree ".length));
    const existingRun = fields.some((field) => field.startsWith("branch refs/heads/tasker/run-"));
    if (contains(checkout, root) || (contains(root, checkout) && (!existingRun || checkout === repoPath))) {
      throw new Error("The runtime worktrees directory must be outside and separate from existing repository checkouts.");
    }
  }
}

/** Fetch only the chosen branch into its exact tracking ref, then pin a worktree to its SHA. */
export async function prepareRunWorktree(options: PrepareRunWorktreeOptions): Promise<RunWorktree> {
  const { signal, runId, taskId, remote, baseBranch } = options;
  signal?.throwIfAborted();
  if (!UUID.test(runId) || !TASK_ID.test(taskId)) throw new Error("Invalid run UUID or task identifier.");
  if (!path.isAbsolute(options.worktreesRoot)) throw new Error("The runtime worktrees directory must be absolute.");
  if (!remote || remote.startsWith("-") || /[\s\x00-\x1f]/.test(remote)) throw new Error("Invalid Git remote name.");
  if (!baseBranch || baseBranch.startsWith("-") || baseBranch.startsWith("refs/")) throw new Error("Expected a logical base branch name.");
  const repoPath = await fs.realpath((await git(options.repoPath, ["rev-parse", "--show-toplevel"], signal)).trim());
  const remotes = (await git(repoPath, ["remote"], signal)).trim().split(/\r?\n/);
  if (!remotes.includes(remote)) throw new Error("The configured Git remote does not exist.");
  const trackingRef = `refs/remotes/${remote}/${baseBranch}`;
  await git(repoPath, ["check-ref-format", `refs/heads/${baseBranch}`], signal);
  await git(repoPath, ["check-ref-format", trackingRef], signal);
  const branch = `tasker/run-${runId}-${taskId}`;
  const worktreesRoot = await canonicalProspectivePath(path.resolve(options.worktreesRoot));
  await ensureExternalRoot(repoPath, worktreesRoot, signal);
  await fs.mkdir(worktreesRoot, { recursive: true });
  if (await fs.realpath(/* turbopackIgnore: true */ worktreesRoot) !== worktreesRoot) throw new Error("Runtime directory changed during preparation.");
  const worktreePath = path.join(worktreesRoot, `run-${runId}-${taskId}`);
  // An existing branch or path is never reused, reset, or removed, even after a failed attempt.
  try {
    await fs.lstat(worktreePath);
    throw new Error("The run worktree path already exists.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // --refmap= prevents configured fetch mappings from updating unrelated local branches.
  await git(repoPath, ["fetch", "--no-tags", "--no-recurse-submodules", "--refmap=", "--", remote,
    `+refs/heads/${baseBranch}:${trackingRef}`], signal);
  const baseCommit = (await git(repoPath, ["rev-parse", "--verify", `${trackingRef}^{commit}`], signal)).trim();
  if (!/^[0-9a-f]{40,64}$/.test(baseCommit)) throw new Error("Git returned an invalid base commit.");
  const worktree: RunWorktree = { repoPath, worktreesRoot, worktreePath, branch, remote, baseBranch, trackingRef, baseCommit };
  try {
    await options.onPrepared?.(worktree);
    signal?.throwIfAborted();
    await fs.mkdir(worktreePath); // Reserve this unique location atomically.
    await git(repoPath, ["worktree", "add", "--no-track", "-b", branch, "--", worktreePath, baseCommit], signal);
    await verifyRunWorktree(worktree, signal);
    return worktree;
  } catch (cause) {
    // The worker can persist recovery coordinates even if worktree creation only partly succeeded.
    throw Object.assign(new Error("Worktree preparation failed; any partial branch/worktree was preserved.", { cause }), { worktree });
  }
}

/** Reject replaced directories, detached HEAD, switched branches, or another repository. */
export async function verifyRunWorktree(worktree: RunWorktree, signal?: AbortSignal): Promise<string> {
  if (!/^tasker\/run-[0-9a-f-]{36}-[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/i.test(worktree.branch)) {
    throw new Error("Not an AgentTasker run branch.");
  }
  const root = await fs.realpath(worktree.worktreesRoot);
  const directory = await fs.realpath(worktree.worktreePath);
  const repo = await fs.realpath(worktree.repoPath);
  if (root !== worktree.worktreesRoot || directory !== worktree.worktreePath || repo !== worktree.repoPath ||
      path.dirname(directory) !== root || contains(repo, directory) || contains(directory, repo) ||
      path.basename(directory) !== worktree.branch.slice("tasker/".length)) {
    throw new Error("Run worktree path failed the runtime boundary check.");
  }
  const top = await fs.realpath((await git(directory, ["rev-parse", "--show-toplevel"], signal)).trim());
  if (top !== directory) throw new Error("Run directory is not a worktree root.");
  const common = await fs.realpath((await git(directory, ["rev-parse", "--path-format=absolute", "--git-common-dir"], signal)).trim());
  const expected = await fs.realpath((await git(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"], signal)).trim());
  if (common !== expected) throw new Error("Run worktree belongs to another repository.");
  const current = (await git(directory, ["symbolic-ref", "--quiet", "HEAD"], signal)).trim();
  if (current !== `refs/heads/${worktree.branch}`) throw new Error("The agent changed the run branch; worktree preserved.");
  return (await git(directory, ["rev-parse", "--verify", "HEAD^{commit}"], signal)).trim();
}

export async function inspectRunChanges(worktree: RunWorktree, signal?: AbortSignal) {
  await verifyRunWorktree(worktree, signal);
  const status = await git(worktree.worktreePath, ["status", "--porcelain=v1", "--untracked-files=all"], signal);
  const diff = await git(worktree.worktreePath, ["diff", "--no-ext-diff", "--no-textconv", "--binary", worktree.baseCommit, "--"], signal);
  return { status, diff, hasChanges: status.length > 0 || diff.length > 0 };
}

/** Fail closed. No failure path deletes, resets, commits partial work, or pushes anything. */
export async function finalizeRunWorktree(worktree: RunWorktree, options: FinalizeRunWorktreeOptions): Promise<RunGitResult> {
  let result: RunGitResult = { success: false, hasChanges: false, commitSha: null, diff: "", status: "", error: null };
  try {
    const { signal } = options;
    signal?.throwIfAborted();
    result = { ...result, ...await inspectRunChanges(worktree, signal) };
    if (options.exitCode !== 0 || options.cancelled || options.timedOut || !options.validationsSucceeded) {
      throw new Error("Run did not pass process and validation checks; worktree preserved.");
    }
    if (await verifyRunWorktree(worktree, signal) !== worktree.baseCommit) {
      throw new Error("The agent changed Git history; automatic commit refused and worktree preserved.");
    }
    if (!result.hasChanges) {
      if (options.expectChanges) throw new Error("The task expected changes, but the worktree is unchanged.");
      return { ...result, success: true };
    }
    if (options.commit === false) return { ...result, success: true };
    if (!options.commitMessage.trim() || options.commitMessage.includes("\0")) throw new Error("A valid commit message is required.");
    // Stage all actual changes, including new/deleted files; Git's ignore rules remain in force.
    await git(worktree.worktreePath, ["add", "--all", "--", "."], signal);
    const tree = (await git(worktree.worktreePath, ["write-tree"], signal)).trim();
    const baseTree = (await git(worktree.worktreePath, ["rev-parse", `${worktree.baseCommit}^{tree}`], signal)).trim();
    if (tree === baseTree) throw new Error("No committable changes; non-file changes require manual review.");
    if (await verifyRunWorktree(worktree, signal) !== worktree.baseCommit) throw new Error("Run HEAD changed before commit.");
    await git(worktree.worktreePath, ["commit", "-m", options.commitMessage], signal);
    const commitSha = await verifyRunWorktree(worktree, signal);
    result.commitSha = commitSha;
    const parent = (await git(worktree.worktreePath, ["rev-list", "--parents", "-n", "1", commitSha], signal)).trim();
    const committedTree = (await git(worktree.worktreePath, ["rev-parse", `${commitSha}^{tree}`], signal)).trim();
    if (parent !== `${commitSha} ${worktree.baseCommit}` || committedTree !== tree) {
      throw new Error("Commit differs from the verified changes; worktree preserved for review.");
    }
    result.status = await git(worktree.worktreePath, ["status", "--porcelain=v1", "--untracked-files=all"], signal);
    if (result.status) throw new Error("Worktree changed during commit; preserved for review.");
    result.diff = await git(worktree.worktreePath, ["diff", "--no-ext-diff", "--no-textconv", "--binary", worktree.baseCommit, commitSha, "--"], signal);
    return { ...result, success: true };
  } catch (error) {
    return { ...result, success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Keep the branch as the durable local recovery reference. Never use remove --force. */
export async function cleanupSuccessfulWorktree(worktree: RunWorktree, result: RunGitResult): Promise<{ removed: boolean; reason: string | null }> {
  try {
    if (!result.success) throw new Error("Failed runs are always preserved.");
    const head = await verifyRunWorktree(worktree);
    if (head !== (result.commitSha ?? worktree.baseCommit)) throw new Error("Run HEAD no longer matches the recorded result.");
    if (result.hasChanges && !result.commitSha) throw new Error("Uncommitted work is preserved.");
    const branchHead = (await git(worktree.repoPath, ["rev-parse", "--verify", `refs/heads/${worktree.branch}^{commit}`])).trim();
    if (branchHead !== head) throw new Error("Run commit is not safely retained by its branch.");
    const status = await git(worktree.worktreePath, ["status", "--porcelain=v1", "--untracked-files=all", "--ignored"]);
    if (status) throw new Error("Worktree contains changed, untracked, or ignored files; preserved.");
    await git(worktree.repoPath, ["worktree", "remove", "--", worktree.worktreePath]);
    return { removed: true, reason: null };
  } catch (error) {
    return { removed: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Explicit destructive cleanup requested by the user for a terminal Run. */
export async function deleteRunArtifacts(options: DeleteRunArtifactsOptions): Promise<{ worktreeRemoved: boolean; branchRemoved: boolean }> {
  const { runId, taskId, signal } = options;
  signal?.throwIfAborted();
  if (!UUID.test(runId) || !TASK_ID.test(taskId)) throw new Error("Invalid run UUID or task identifier.");
  const expectedBranch = `tasker/run-${runId}-${taskId}`;
  if (options.branch !== expectedBranch) throw new Error("Run branch does not match the Run identity.");
  if (!path.isAbsolute(options.worktreesRoot) || !path.isAbsolute(options.worktreePath)) {
    throw new Error("Run cleanup paths must be absolute.");
  }
  const repoPath = await fs.realpath((await git(options.repoPath, ["rev-parse", "--show-toplevel"], signal)).trim());
  const worktreesRoot = await canonicalProspectivePath(path.resolve(options.worktreesRoot));
  const worktreePath = await canonicalProspectivePath(path.resolve(options.worktreePath));
  const expectedPath = path.join(worktreesRoot, expectedBranch.slice("tasker/".length));
  if (worktreePath !== expectedPath || path.dirname(worktreePath) !== worktreesRoot || contains(repoPath, worktreePath) || contains(worktreePath, repoPath)) {
    throw new Error("Run cleanup path failed the runtime boundary check.");
  }
  await ensureExternalRoot(repoPath, worktreesRoot, signal);

  let worktreeExists = true;
  try { await fs.lstat(worktreePath); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    worktreeExists = false;
  }
  if (worktreeExists) {
    await verifyRunWorktree({
      repoPath,
      worktreesRoot,
      worktreePath,
      branch: expectedBranch,
      remote: "",
      baseBranch: "",
      trackingRef: "",
      baseCommit: "",
    }, signal);
    await git(repoPath, ["worktree", "remove", "--force", "--", worktreePath], signal);
  }

  try {
    await fs.lstat(worktreePath);
    throw new Error("Run worktree still exists after cleanup.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  let branchRemoved = false;
  try {
    await git(repoPath, ["rev-parse", "--verify", `refs/heads/${expectedBranch}^{commit}`], signal);
    await git(repoPath, ["branch", "-D", "--", expectedBranch], signal);
    branchRemoved = true;
  } catch (error) {
    try {
      await git(repoPath, ["rev-parse", "--verify", `refs/heads/${expectedBranch}^{commit}`], signal);
    } catch {
      return { worktreeRemoved: worktreeExists, branchRemoved };
    }
    throw error;
  }
  return { worktreeRemoved: worktreeExists, branchRemoved };
}

export const runGitService = { prepareRunWorktree, verifyRunWorktree, inspectRunChanges, finalizeRunWorktree, cleanupSuccessfulWorktree, deleteRunArtifacts };
