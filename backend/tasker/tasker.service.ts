import fs from "node:fs";
import path from "node:path";
import { gitService } from "../git/git.service";
import { projectService } from "../projects/project.service";
import { ValidationError, ConflictError } from "../errors";
import {
  DEFAULT_MAIN_CODEX_CONFIG,
  serializeMainCodexConfig,
} from "./agents.service";
import {
  parseProjectExecutionSettings,
  serializeDefaultExecutionSection,
  updateProjectExecutionToml,
} from "./project-execution";
import type { ProjectExecutionSettings } from "../../src/types/project-execution";
import {
  parseProjectGitSettings,
  serializeDefaultGitSettings,
  updateProjectGitToml,
} from "./project-git";
import type { ProjectGitSettings } from "../../src/types/project-git";

export interface InitTaskerOptions {
  repoPath: string;
  projectName: string;
  baseBranch: string;
}

export const DEFAULT_INSTRUCTIONS = `# Instructions du projet

Tu travailles sur ce projet en tant qu'agent de développement.

## Instructions générales

- Lis et comprends le projet avant d'effectuer des modifications.
- Respecte l'architecture et les conventions existantes.
- Réutilise les composants et les fonctionnalités existantes lorsque possible.
- Évite les modifications qui ne sont pas nécessaires à la tâche demandée.
- Garde les changements simples, ciblés et maintenables.
- Vérifie ton travail avant de terminer.
`;

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

    // Create versioned configuration roots for agents, autonomous Tasks, and Sequences.
    fs.mkdirSync(path.join(taskerDir, "agents"), { recursive: false });
    fs.mkdirSync(path.join(taskerDir, "tasks"), { recursive: false });
    fs.mkdirSync(path.join(taskerDir, "sequences"), { recursive: false });

    // Create .tasker/project.toml
    const projectTomlContent = `version = 1
name = "${projectName.trim()}"

[git]
base_branch = "${baseBranch.trim()}"
${serializeDefaultGitSettings()}

${serializeDefaultExecutionSection()}
`;
    fs.writeFileSync(path.join(taskerDir, "project.toml"), projectTomlContent, "utf-8");

    // Create .tasker/instructions.md
    fs.writeFileSync(path.join(taskerDir, "instructions.md"), DEFAULT_INSTRUCTIONS, "utf-8");

    // Create the versioned Codex defaults used by future project Tasks.
    fs.writeFileSync(
      path.join(taskerDir, "agents", "main.toml"),
      serializeMainCodexConfig(DEFAULT_MAIN_CODEX_CONFIG),
      "utf-8"
    );
  }

  async getProjectInstructions(projectId: string): Promise<{ instructions: string; filePath: string }> {
    const project = await projectService.getProjectById(projectId);

    if (!project.repositoryPath || !project.repositoryPath.trim()) {
      throw new ValidationError("NO_REPOSITORY: Configurez d'abord le repository du projet dans Settings.");
    }

    const normalizedPath = path.resolve(project.repositoryPath.trim());
    const taskerDir = path.join(normalizedPath, ".tasker");

    if (!fs.existsSync(taskerDir) || !fs.statSync(taskerDir).isDirectory()) {
      throw new ValidationError("NOT_INITIALIZED: Initialisez Tasker dans Settings avant de configurer les instructions.");
    }

    const instructionsPath = path.join(taskerDir, "instructions.md");

    if (!fs.existsSync(instructionsPath)) {
      fs.writeFileSync(instructionsPath, DEFAULT_INSTRUCTIONS, "utf-8");
      return {
        instructions: DEFAULT_INSTRUCTIONS,
        filePath: ".tasker/instructions.md",
      };
    }

    const rawContent = fs.readFileSync(instructionsPath, "utf-8");
    const trimmed = rawContent.trim();
    const effectiveContent =
      trimmed === "" || trimmed === "# Project Instructions"
        ? DEFAULT_INSTRUCTIONS
        : rawContent;

    return {
      instructions: effectiveContent,
      filePath: ".tasker/instructions.md",
    };
  }

  async updateProjectInstructions(
    projectId: string,
    content: string
  ): Promise<{ instructions: string; filePath: string }> {
    if (typeof content !== "string") {
      throw new ValidationError("Instructions content must be a string.");
    }

    const project = await projectService.getProjectById(projectId);

    if (!project.repositoryPath || !project.repositoryPath.trim()) {
      throw new ValidationError("NO_REPOSITORY: Configurez d'abord le repository du projet dans Settings.");
    }

    const normalizedPath = path.resolve(project.repositoryPath.trim());
    const taskerDir = path.join(normalizedPath, ".tasker");

    if (!fs.existsSync(taskerDir) || !fs.statSync(taskerDir).isDirectory()) {
      throw new ValidationError("NOT_INITIALIZED: Initialisez Tasker dans Settings avant de configurer les instructions.");
    }

    const instructionsPath = path.join(taskerDir, "instructions.md");
    fs.writeFileSync(instructionsPath, content, "utf-8");

    return {
      instructions: content,
      filePath: ".tasker/instructions.md",
    };
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

  async getProjectExecutionSettings(projectId: string): Promise<{
    settings: ProjectExecutionSettings;
    filePath: string;
  }> {
    const projectTomlPath = await this.resolveProjectToml(projectId);
    return {
      settings: parseProjectExecutionSettings(fs.readFileSync(projectTomlPath, "utf-8")),
      filePath: ".tasker/project.toml",
    };
  }

  async updateProjectExecutionSettings(projectId: string, input: unknown): Promise<{
    settings: ProjectExecutionSettings;
    filePath: string;
  }> {
    const projectTomlPath = await this.resolveProjectToml(projectId);
    const current = fs.readFileSync(projectTomlPath, "utf-8");
    const next = updateProjectExecutionToml(current, input);
    const tempPath = `${projectTomlPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tempPath, next, { encoding: "utf-8", flag: "wx" });
      fs.renameSync(tempPath, projectTomlPath);
    } finally {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
    return {
      settings: parseProjectExecutionSettings(next),
      filePath: ".tasker/project.toml",
    };
  }

  async getProjectGitSettings(projectId: string): Promise<{
    settings: ProjectGitSettings;
    filePath: string;
  }> {
    const projectTomlPath = await this.resolveProjectToml(projectId);
    return {
      settings: parseProjectGitSettings(fs.readFileSync(projectTomlPath, "utf-8")),
      filePath: ".tasker/project.toml",
    };
  }

  async updateProjectGitSettings(projectId: string, input: unknown): Promise<{
    settings: ProjectGitSettings;
    filePath: string;
  }> {
    const projectTomlPath = await this.resolveProjectToml(projectId);
    const current = fs.readFileSync(projectTomlPath, "utf-8");
    const next = updateProjectGitToml(current, input);
    const tempPath = `${projectTomlPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tempPath, next, { encoding: "utf-8", flag: "wx" });
      fs.renameSync(tempPath, projectTomlPath);
    } finally {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
    return {
      settings: parseProjectGitSettings(next),
      filePath: ".tasker/project.toml",
    };
  }

  private async resolveProjectToml(projectId: string): Promise<string> {
    const project = await projectService.getProjectById(projectId);
    if (!project.repositoryPath?.trim()) {
      throw new ValidationError("NO_REPOSITORY: Configure the project repository in Settings first.");
    }
    const repository = fs.realpathSync(path.resolve(project.repositoryPath.trim()));
    const taskerDirectory = path.join(repository, ".tasker");
    if (!fs.existsSync(taskerDirectory) || !fs.statSync(taskerDirectory).isDirectory()) {
      throw new ValidationError("NOT_INITIALIZED: Initialize Tasker in Settings first.");
    }
    const taskerReal = fs.realpathSync(taskerDirectory);
    if (path.relative(repository, taskerReal).startsWith("..") || fs.lstatSync(taskerDirectory).isSymbolicLink()) {
      throw new ValidationError("Unsafe .tasker directory.");
    }
    const projectTomlPath = path.join(taskerReal, "project.toml");
    if (!fs.existsSync(projectTomlPath)) throw new ValidationError("Missing .tasker/project.toml.");
    const info = fs.lstatSync(projectTomlPath);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
      throw new ValidationError("Unsafe .tasker/project.toml file.");
    }
    return projectTomlPath;
  }
}

export const taskerService = new TaskerService();
