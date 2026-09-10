import fs from "node:fs";
import path from "node:path";
import { gitService } from "../git/git.service";
import { ValidationError, ConflictError } from "../errors";

export interface InitTaskerOptions {
  repoPath: string;
  projectName: string;
  baseBranch: string;
}

export class TaskerService {
  async initTasker(options: InitTaskerOptions): Promise<void> {
    const { repoPath, projectName, baseBranch } = options;

    if (!repoPath || !repoPath.trim()) {
      throw new ValidationError("Repository path is required.");
    }
    if (!projectName || !projectName.trim()) {
      throw new ValidationError("Project name is required.");
    }
    if (!baseBranch || !baseBranch.trim()) {
      throw new ValidationError("Base branch is required.");
    }

    const normalizedPath = path.resolve(repoPath.trim());
    const inspection = await gitService.inspectRepository(normalizedPath);

    if (!inspection.folderExists || !inspection.isDirectory) {
      throw new ValidationError(`Directory does not exist: ${normalizedPath}`);
    }

    if (!inspection.isGitRepo) {
      throw new ValidationError(`Directory is not a valid Git repository: ${normalizedPath}`);
    }

    const taskerDir = path.join(normalizedPath, ".tasker");
    if (fs.existsSync(taskerDir)) {
      throw new ConflictError("Tasker is already initialized in this repository.");
    }

    // Create .tasker directory
    fs.mkdirSync(taskerDir, { recursive: false });

    // Create .tasker/agents/ and .tasker/tasks/
    fs.mkdirSync(path.join(taskerDir, "agents"), { recursive: false });
    fs.mkdirSync(path.join(taskerDir, "tasks"), { recursive: false });

    // Create .tasker/project.toml
    const projectTomlContent = `version = 1
name = "${projectName.trim()}"

[git]
base_branch = "${baseBranch.trim()}"
`;
    fs.writeFileSync(path.join(taskerDir, "project.toml"), projectTomlContent, "utf-8");

    // Create .tasker/instructions.md
    const instructionsContent = `# Project Instructions\n`;
    fs.writeFileSync(path.join(taskerDir, "instructions.md"), instructionsContent, "utf-8");
  }

  updateProjectTomlBaseBranch(repoPath: string, newBaseBranch: string): boolean {
    if (!repoPath || !repoPath.trim() || !newBaseBranch || !newBaseBranch.trim()) {
      return false;
    }

    const normalizedPath = path.resolve(repoPath.trim());
    const projectTomlPath = path.join(normalizedPath, ".tasker", "project.toml");

    if (!fs.existsSync(projectTomlPath)) {
      return false;
    }

    try {
      let content = fs.readFileSync(projectTomlPath, "utf-8");
      if (/base_branch\s*=\s*["'][^"']+["']/.test(content)) {
        content = content.replace(
          /base_branch\s*=\s*["'][^"']+["']/,
          `base_branch = "${newBaseBranch.trim()}"`
        );
      } else if (/\[git\]/.test(content)) {
        content = content.replace(
          /\[git\]/,
          `[git]\nbase_branch = "${newBaseBranch.trim()}"`
        );
      } else {
        content += `\n[git]\nbase_branch = "${newBaseBranch.trim()}"\n`;
      }
      fs.writeFileSync(projectTomlPath, content, "utf-8");
      return true;
    } catch {
      return false;
    }
  }
}

export const taskerService = new TaskerService();
