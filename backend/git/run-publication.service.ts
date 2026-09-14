import type { ProjectGitSettings } from "../../src/types/project-git";
import { gitService } from "./git.service";
import { githubCliService, parseGitHubRemote, type GitHubCliRunner } from "./github-cli.service";
import { verifyRunWorktree, type RunWorktree } from "./run-git.service";

export interface RunPublicationEvent {
  stage: "preflight" | "push" | "pull-request";
  status: "running" | "success" | "skipped";
  message: string;
  branch?: string;
  pullRequestUrl?: string;
}

export interface PublishRunOptions {
  settings: ProjectGitSettings;
  expectedHead: string | null;
  title: string;
  body: string;
  /** Remote head branch. Defaults to the Run branch. */
  branch?: string;
  /** Pull request base branch. Defaults to the Project base branch. */
  baseBranch?: string;
  signal?: AbortSignal;
  onEvent?: (event: RunPublicationEvent) => void;
}

export interface RunPublicationResult {
  pushed: boolean;
  pushedAt: string | null;
  pullRequestUrl: string | null;
  pullRequestCreated: boolean;
  branch: string | null;
}

function pullRequestUrl(stdout: string): string | null {
  const candidate = stdout.split(/\r?\n/).map((line) => line.trim())
    .find((line) => /^https:\/\/[^\s]+$/i.test(line));
  return candidate ?? null;
}

async function findOpenPullRequest(
  github: GitHubCliRunner,
  cwd: string,
  repository: string,
  branch: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const result = await github.run(["pr", "list", "--repo", repository, "--head", branch, "--state", "open",
    "--json", "url", "--limit", "1"], { cwd, signal });
  let entries: unknown;
  try { entries = JSON.parse(result.stdout); }
  catch { throw new Error("GitHub CLI returned an invalid pull request list."); }
  if (!Array.isArray(entries) || !entries.length) return null;
  const url = (entries[0] as { url?: unknown })?.url;
  if (typeof url !== "string" || !/^https:\/\/[^\s]+$/i.test(url)) {
    throw new Error("GitHub CLI returned an invalid pull request URL.");
  }
  return url;
}

export async function publishRunWorktree(
  worktree: RunWorktree,
  options: PublishRunOptions,
  github: GitHubCliRunner = githubCliService,
): Promise<RunPublicationResult> {
  const { settings, signal, onEvent } = options;
  if (!settings.push) {
    onEvent?.({ stage: "push", status: "skipped", message: "Remote publication is disabled for this Project." });
    return { pushed: false, pushedAt: null, pullRequestUrl: null, pullRequestCreated: false, branch: null };
  }
  if (!options.expectedHead) {
    onEvent?.({ stage: "push", status: "skipped", message: "No Run commit was produced; nothing was published." });
    return { pushed: false, pushedAt: null, pullRequestUrl: null, pullRequestCreated: false, branch: null };
  }
  signal?.throwIfAborted();
  const head = await verifyRunWorktree(worktree, signal);
  if (head !== options.expectedHead) throw new Error("Run HEAD no longer matches the commit selected for publication.");
  if (settings.remote !== worktree.remote) throw new Error("Resolved publication remote does not match the prepared worktree.");
  const branch = options.branch ?? worktree.branch;
  const baseBranch = options.baseBranch ?? worktree.baseBranch;
  const stepBranchPattern = new RegExp(`^${worktree.branch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-step-[0-9]{3}-[a-z0-9]+(?:-[a-z0-9]+)*$`);
  if (branch !== worktree.branch && !stepBranchPattern.test(branch)) {
    throw new Error("Publication branch is outside the AgentTasker Run namespace.");
  }
  for (const candidate of [branch, baseBranch]) {
    if (!candidate || candidate.startsWith("-") || /[\s\x00-\x1f]/.test(candidate)) {
      throw new Error("Publication requires valid Git branch names.");
    }
    await gitService.run(worktree.worktreePath, ["check-ref-format", "--branch", candidate], { signal });
  }

  let repository: ReturnType<typeof parseGitHubRemote> | null = null;
  if (settings.createPullRequest) {
    onEvent?.({ stage: "preflight", status: "running", message: "Checking GitHub CLI authentication before publication." });
    const remoteUrl = (await gitService.run(worktree.worktreePath,
      ["remote", "get-url", "--", settings.remote], { signal })).stdout.trim();
    repository = parseGitHubRemote(remoteUrl);
    await github.run(["auth", "status", "--hostname", repository.host], { cwd: worktree.worktreePath, signal });
    onEvent?.({ stage: "preflight", status: "success", message: `GitHub CLI is authenticated for ${repository.host}.` });
  }

  onEvent?.({ stage: "push", status: "running", message: `Pushing ${branch} to ${settings.remote}.`, branch });
  const pushArgs = ["push"];
  if (branch === worktree.branch) pushArgs.push("--set-upstream");
  const sourceRef = branch === worktree.branch ? `refs/heads/${branch}` : head;
  pushArgs.push("--porcelain", "--", settings.remote, `${sourceRef}:refs/heads/${branch}`);
  await gitService.run(worktree.worktreePath, pushArgs, { signal, timeoutMs: 300_000 });
  if (branch === worktree.branch) {
    const upstream = (await gitService.run(worktree.worktreePath,
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { signal })).stdout.trim();
    if (upstream !== `${settings.remote}/${branch}`) {
      throw new Error("Git did not configure the expected upstream branch after push.");
    }
  }
  const remoteHead = (await gitService.run(worktree.worktreePath,
    ["rev-parse", "--verify", `refs/remotes/${settings.remote}/${branch}^{commit}`], { signal })).stdout.trim();
  if (remoteHead !== head) {
    throw new Error("The pushed branch does not exactly match the verified Run commit.");
  }
  const pushedAt = new Date().toISOString();
  onEvent?.({ stage: "push", status: "success", message: `Verified ${settings.remote}/${branch} at ${head}.`, branch });
  if (!settings.createPullRequest || !repository) {
    return { pushed: true, pushedAt, pullRequestUrl: null, pullRequestCreated: false, branch };
  }

  onEvent?.({ stage: "pull-request", status: "running", message: "Looking for an existing pull request for the publication branch.", branch });
  const existing = await findOpenPullRequest(github, worktree.worktreePath, repository.cliRepository, branch, signal);
  if (existing) {
    onEvent?.({ stage: "pull-request", status: "success", message: "Existing pull request recovered.", branch, pullRequestUrl: existing });
    return { pushed: true, pushedAt, pullRequestUrl: existing, pullRequestCreated: false, branch };
  }

  const args = ["pr", "create", "--repo", repository.cliRepository, "--base", baseBranch,
    "--head", branch, "--title", options.title.slice(0, 256), "--body", options.body];
  if (settings.pullRequestDraft) args.push("--draft");
  let created: string | null = null;
  try {
    const result = await github.run(args, { cwd: worktree.worktreePath, signal });
    created = pullRequestUrl(result.stdout);
  } catch (error) {
    // A transport failure can happen after GitHub accepted the PR. Re-list before failing the Run.
    created = await findOpenPullRequest(github, worktree.worktreePath, repository.cliRepository, branch, signal)
      .catch(() => null);
    if (!created) throw error;
  }
  if (!created) throw new Error("GitHub CLI created no inspectable pull request URL.");
  onEvent?.({ stage: "pull-request", status: "success",
    message: settings.pullRequestDraft ? "Draft pull request created." : "Pull request created.", branch, pullRequestUrl: created });
  return { pushed: true, pushedAt, pullRequestUrl: created, pullRequestCreated: true, branch };
}
