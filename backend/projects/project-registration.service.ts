import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  PROJECT_REGISTRATION_VERSION,
  projectRegistrationDirectory,
} from "../../shared/agenttasker-local-data.mjs";
import { readString, sectionContent, topLevelContent } from "../tasks/toml";

export interface PendingProjectRegistration {
  repositoryPath: string;
  projectName: string;
  baseBranch: string;
}

type RegistrationConsumer = (registration: PendingProjectRegistration) => Promise<void>;

let activeImport: Promise<void> | null = null;

function regularFile(filePath: string, label: string): void {
  const info = fs.lstatSync(filePath);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
    throw new Error(`${label} must be a regular file.`);
  }
}

function readRegistration(filePath: string): PendingProjectRegistration {
  regularFile(filePath, "Registration request");
  if (fs.statSync(filePath).size > 64 * 1024) throw new Error("Registration request is too large.");
  const input = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
  if (input.version !== PROJECT_REGISTRATION_VERSION) throw new Error("Unsupported registration version.");
  if (typeof input.repositoryPath !== "string" || !path.isAbsolute(input.repositoryPath)) {
    throw new Error("Registration repository path must be absolute.");
  }

  const repositoryPath = fs.realpathSync(path.resolve(input.repositoryPath));
  if (!fs.statSync(repositoryPath).isDirectory()) throw new Error("Registered repository does not exist.");
  const taskerDirectory = path.join(repositoryPath, ".tasker");
  if (!fs.existsSync(taskerDirectory)) throw new Error("Registered repository is not initialized.");
  const taskerInfo = fs.lstatSync(taskerDirectory);
  if (!taskerInfo.isDirectory() || taskerInfo.isSymbolicLink()) throw new Error("Unsafe .tasker directory.");

  const projectTomlPath = path.join(taskerDirectory, "project.toml");
  regularFile(projectTomlPath, ".tasker/project.toml");
  const content = fs.readFileSync(projectTomlPath, "utf8");
  const projectName = readString(topLevelContent(content), "name")?.trim();
  const baseBranch = readString(sectionContent(content, "git"), "base_branch")?.trim();
  if (!projectName) throw new Error("Missing project name in .tasker/project.toml.");
  if (!baseBranch) throw new Error("Missing Git base branch in .tasker/project.toml.");
  return { repositoryPath, projectName, baseBranch };
}

async function importRequests(consume: RegistrationConsumer): Promise<void> {
  const directory = projectRegistrationDirectory();
  if (!fs.existsSync(directory)) return;
  const directoryInfo = fs.lstatSync(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new Error(`Unsafe project registration directory: ${directory}`);
  }
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.json$/.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const pending = path.join(directory, entry.name);
    const claimed = path.join(directory, `.${entry.name}.${process.pid}.${randomUUID()}.processing`);
    try {
      fs.renameSync(pending, claimed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    let registration: PendingProjectRegistration;
    try {
      registration = readRegistration(claimed);
    } catch (error) {
      const rejected = path.join(directory, `${entry.name}.failed-${Date.now()}-${randomUUID()}`);
      if (fs.existsSync(claimed)) fs.renameSync(claimed, rejected);
      console.warn(`AgentTasker project registration rejected (${entry.name}):`, error);
      continue;
    }
    try {
      await consume(registration);
      fs.unlinkSync(claimed);
    } catch (error) {
      // Database or application failures are retryable. A newer CLI request for
      // the same repository already supersedes this claimed copy when present.
      if (fs.existsSync(claimed)) {
        if (fs.existsSync(pending)) fs.unlinkSync(claimed);
        else fs.renameSync(claimed, pending);
      }
      throw error;
    }
  }
}

export async function importPendingProjectRegistrations(consume: RegistrationConsumer): Promise<void> {
  if (!activeImport) {
    activeImport = importRequests(consume).finally(() => {
      activeImport = null;
    });
  }
  await activeImport;
}
