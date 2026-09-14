import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { GitHubCliRuntimeStatus } from "../../src/types/project-git";
import { runGitEnvironment } from "./git-environment";
import { gitService } from "./git.service";

const execFileAsync = promisify(execFile);
const WINDOWS_GH = "C:\\Program Files\\GitHub CLI\\gh.exe";

export interface GitHubRepository {
  host: string;
  slug: string;
  cliRepository: string;
}

export interface GitHubCliRunner {
  run(args: readonly string[], options: { cwd: string; signal?: AbortSignal }): Promise<{ stdout: string; stderr: string }>;
}

export function parseGitHubRemote(remoteUrl: string): GitHubRepository {
  let host = "";
  let repositoryPath = "";
  try {
    const parsed = new URL(remoteUrl);
    if (!["https:", "http:", "ssh:", "git:"].includes(parsed.protocol)) throw new Error("Unsupported URL protocol.");
    host = parsed.hostname;
    repositoryPath = parsed.pathname;
  } catch {
    const scp = remoteUrl.match(/^(?:[^@\s]+@)?([^:\s/]+):(.+)$/);
    if (!scp) throw new Error("Pull request creation requires a GitHub remote URL.");
    host = scp[1];
    repositoryPath = scp[2];
  }
  const parts = repositoryPath.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "").split("/").filter(Boolean);
  if (!host || parts.length !== 2 || parts.some((part) => part === "." || part === "..")) {
    throw new Error("Pull request creation requires a GitHub OWNER/REPOSITORY remote URL.");
  }
  const slug = `${parts[0]}/${parts[1]}`;
  return {
    host: host.toLowerCase(),
    slug,
    cliRepository: host.toLowerCase() === "github.com" ? slug : `${host}/${slug}`,
  };
}

async function runExecutable(executable: string, args: readonly string[], cwd: string, signal?: AbortSignal) {
  const env = runGitEnvironment();
  env.GIT_TERMINAL_PROMPT = "0";
  return execFileAsync(executable, [...args], {
    cwd,
    env,
    shell: false,
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 120_000,
    signal,
  });
}

export class GitHubCliService implements GitHubCliRunner {
  private executable: string | null = null;

  private async resolveExecutable(cwd: string): Promise<string> {
    if (this.executable) return this.executable;
    const candidates = process.platform === "win32" ? ["gh", WINDOWS_GH] : ["gh"];
    for (const candidate of candidates) {
      try {
        await runExecutable(candidate, ["--version"], cwd);
        this.executable = candidate;
        return candidate;
      } catch { /* Try the supported fallback. */ }
    }
    throw new Error("GitHub CLI is unavailable. Install gh and authenticate it before enabling draft pull requests.");
  }

  async run(args: readonly string[], options: { cwd: string; signal?: AbortSignal }) {
    const executable = await this.resolveExecutable(options.cwd);
    return runExecutable(executable, args, options.cwd, options.signal);
  }

  async inspect(cwd: string, remote: string): Promise<GitHubCliRuntimeStatus> {
    try {
      const executable = await this.resolveExecutable(cwd);
      const remoteUrl = (await gitService.run(cwd, ["remote", "get-url", "--", remote])).stdout.trim();
      const repository = parseGitHubRemote(remoteUrl);
      await this.run(["auth", "status", "--hostname", repository.host], { cwd });
      return { available: true, authenticated: true, executable: path.basename(executable),
        detail: `Authenticated for ${repository.host}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const unavailable = /unavailable|ENOENT|not recognized|not found/i.test(message);
      return { available: !unavailable, authenticated: false, executable: this.executable ? path.basename(this.executable) : null,
        detail: message.slice(0, 500) };
    }
  }
}

export const githubCliService = new GitHubCliService();
