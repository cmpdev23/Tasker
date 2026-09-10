import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { runGitEnvironment } from "./git-environment";

const execFileAsync = promisify(execFile);

export interface GitRepositoryInspection {
  gitAvailable: boolean;
  folderExists: boolean;
  isDirectory: boolean;
  isGitRepo: boolean;
  remoteUrl: string | null;
  currentBranch: string | null;
  branches: string[];
  isTaskerInitialized: boolean;
  hasProjectToml: boolean;
  projectTomlBaseBranch: string | null;
  error?: string;
}

export class GitService {
  /** Run an argument-vector Git command without a shell. Runtime callers own policy. */
  async run(
    repoPath: string,
    args: readonly string[],
    options: { signal?: AbortSignal; timeoutMs?: number } = {}
  ): Promise<{ stdout: string; stderr: string }> {
    // Ambient Git routing variables must never redirect a run to another checkout/index.
    const env = runGitEnvironment();
    env.GIT_TERMINAL_PROMPT = "0";
    return execFileAsync("git", [...args], {
      cwd: repoPath,
      env,
      shell: false,
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: options.timeoutMs ?? 120_000,
      signal: options.signal,
    });
  }

  async isGitAvailable(): Promise<boolean> {
    try {
      await execFileAsync("git", ["--version"]);
      return true;
    } catch {
      return false;
    }
  }

  async inspectRepository(repoPath: string | null | undefined): Promise<GitRepositoryInspection> {
    const gitAvailable = await this.isGitAvailable();

    if (!repoPath || !repoPath.trim()) {
      return {
        gitAvailable,
        folderExists: false,
        isDirectory: false,
        isGitRepo: false,
        remoteUrl: null,
        currentBranch: null,
        branches: [],
        isTaskerInitialized: false,
        hasProjectToml: false,
        projectTomlBaseBranch: null,
      };
    }

    const normalizedPath = path.resolve(repoPath.trim());

    let folderExists = false;
    let isDirectory = false;

    try {
      const stat = fs.statSync(normalizedPath);
      folderExists = true;
      isDirectory = stat.isDirectory();
    } catch {
      folderExists = false;
      isDirectory = false;
    }

    if (!folderExists || !isDirectory) {
      return {
        gitAvailable,
        folderExists,
        isDirectory,
        isGitRepo: false,
        remoteUrl: null,
        currentBranch: null,
        branches: [],
        isTaskerInitialized: false,
        hasProjectToml: false,
        projectTomlBaseBranch: null,
        error: "Folder does not exist or is not a directory.",
      };
    }

    if (!gitAvailable) {
      return {
        gitAvailable: false,
        folderExists: true,
        isDirectory: true,
        isGitRepo: false,
        remoteUrl: null,
        currentBranch: null,
        branches: [],
        isTaskerInitialized: false,
        hasProjectToml: false,
        projectTomlBaseBranch: null,
        error: "Git CLI is not installed or not available in PATH.",
      };
    }

    // Check if it's a Git repository
    let isGitRepo = false;
    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd: normalizedPath,
      });
      isGitRepo = stdout.trim() === "true";
    } catch {
      isGitRepo = false;
    }

    if (!isGitRepo) {
      return {
        gitAvailable: true,
        folderExists: true,
        isDirectory: true,
        isGitRepo: false,
        remoteUrl: null,
        currentBranch: null,
        branches: [],
        isTaskerInitialized: false,
        hasProjectToml: false,
        projectTomlBaseBranch: null,
        error: "Directory is not a valid Git repository.",
      };
    }

    // Get remote url (origin)
    let remoteUrl: string | null = null;
    try {
      const { stdout } = await execFileAsync("git", ["config", "--get", "remote.origin.url"], {
        cwd: normalizedPath,
      });
      const trimmed = stdout.trim();
      if (trimmed) {
        remoteUrl = trimmed;
      }
    } catch {
      // Remote might not exist, which is completely normal
      remoteUrl = null;
    }

    // Get current branch
    let currentBranch: string | null = null;
    try {
      const { stdout } = await execFileAsync("git", ["branch", "--show-current"], {
        cwd: normalizedPath,
      });
      const trimmed = stdout.trim();
      if (trimmed) {
        currentBranch = trimmed;
      } else {
        // Fallback for detached HEAD or older git versions
        const { stdout: headRef } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
          cwd: normalizedPath,
        });
        const headTrimmed = headRef.trim();
        if (headTrimmed && headTrimmed !== "HEAD") {
          currentBranch = headTrimmed;
        }
      }
    } catch {
      currentBranch = null;
    }

    // Get available local branches
    const branches: string[] = [];
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["for-each-ref", "--format=%(refname:short)", "refs/heads/"],
        {
          cwd: normalizedPath,
        }
      );
      const lines = stdout
        .split(/\r?\n/)
        .map((b) => b.trim())
        .filter(Boolean);
      branches.push(...lines);
    } catch {
      // No branches or error
    }

    // If currentBranch is detected and not yet in branches list, add it
    if (currentBranch && !branches.includes(currentBranch)) {
      branches.unshift(currentBranch);
    }

    // Check .tasker directory and project.toml
    const taskerDirPath = path.join(normalizedPath, ".tasker");
    let isTaskerInitialized = false;
    let hasProjectToml = false;
    let projectTomlBaseBranch: string | null = null;

    try {
      if (fs.existsSync(taskerDirPath) && fs.statSync(taskerDirPath).isDirectory()) {
        isTaskerInitialized = true;

        const projectTomlPath = path.join(taskerDirPath, "project.toml");
        if (fs.existsSync(projectTomlPath) && fs.statSync(projectTomlPath).isFile()) {
          hasProjectToml = true;
          const tomlContent = fs.readFileSync(projectTomlPath, "utf-8");
          // Match base_branch = "..." in [git] section
          const match = tomlContent.match(/base_branch\s*=\s*["']([^"']+)["']/);
          if (match?.[1]) {
            projectTomlBaseBranch = match[1];
          }
        }
      }
    } catch {
      // Ignore filesystem check errors
    }

    return {
      gitAvailable: true,
      folderExists: true,
      isDirectory: true,
      isGitRepo: true,
      remoteUrl,
      currentBranch,
      branches,
      isTaskerInitialized,
      hasProjectToml,
      projectTomlBaseBranch,
    };
  }
}

export const gitService = new GitService();
