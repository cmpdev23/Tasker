import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import type { TaskDefinition } from "../../src/types/tasks";
import { parseTaskConfig, serializeTaskConfig, taskSlug, validateTaskId, validateTaskInput } from "./task-config";

export type { TaskDefinition, TaskInput } from "../../src/types/tasks";

type ProjectLookup = (id: string) => Promise<{ repositoryPath: string | null }>;
const FILES = ["task.toml", "instructions.md"] as const;

function stat(filePath: string): fs.Stats | undefined {
  try { return fs.lstatSync(filePath); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function contained(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ValidationError("Task path must remain inside its parent directory.");
  }
}

function directory(directoryPath: string, missingMessage?: string): boolean {
  const info = stat(directoryPath);
  if (!info) {
    if (missingMessage) throw new ValidationError(missingMessage);
    return false;
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new ValidationError("Task storage directories must be real directories, without symlinks or junctions.");
  }
  return true;
}

/** Check every existing component, including ancestors of the repository. */
function safeDirectoryChain(absolutePath: string): void {
  const root = path.parse(absolutePath).root;
  let current = root;
  for (const part of path.relative(root, absolutePath).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    directory(current, "Task storage directory no longer exists.");
  }
}

function regularFile(filePath: string): fs.Stats {
  const info = stat(filePath);
  if (!info) throw new ValidationError(`Task is incomplete: missing ${path.basename(filePath)}.`);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
    throw new ValidationError("Task files must be regular files without symbolic or hard links.");
  }
  return info;
}

function readFile(filePath: string, limit: number): string {
  safeDirectoryChain(path.dirname(filePath));
  const before = regularFile(filePath);
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== before.ino || opened.dev !== before.dev || opened.size > limit) {
      throw new ValidationError(`Unsafe or oversized task file: ${path.basename(filePath)}.`);
    }
    // A bounded read also protects against a file growing after fstat.
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const bytes = fs.readSync(fd, buffer, length, buffer.length - length, null);
      if (!bytes) break;
      length += bytes;
    }
    if (length > limit) throw new ValidationError("Task file exceeds its size limit.");
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)); }
    catch { throw new ValidationError("Task files must contain valid UTF-8."); }
  } finally { fs.closeSync(fd); }
}

function readTask(tasksDirectory: string, id: string): TaskDefinition {
  validateTaskId(id);
  const taskDirectory = path.join(tasksDirectory, id);
  contained(tasksDirectory, taskDirectory);
  safeDirectoryChain(tasksDirectory);
  if (!directory(taskDirectory)) throw new NotFoundError(`Task "${id}" was not found.`);
  return parseTaskConfig(
    readFile(path.join(taskDirectory, "task.toml"), 64 * 1024), id,
    readFile(path.join(taskDirectory, "instructions.md"), 1024 * 1024),
  );
}

function assertOnlyTaskFiles(taskDirectory: string): void {
  safeDirectoryChain(taskDirectory);
  const entries = fs.readdirSync(taskDirectory);
  if (entries.length !== FILES.length || entries.some((entry) => !FILES.includes(entry as typeof FILES[number]))) {
    throw new ConflictError("Task folder contains extra or missing files; preserve them before deleting the task.");
  }
  for (const file of FILES) regularFile(path.join(/* turbopackIgnore: true */ taskDirectory, file));
}

export class TaskService {
  private readonly lookup: ProjectLookup;

  constructor(lookup?: ProjectLookup) {
    // Lazy import keeps filesystem tests independent of SQLite and its aliases.
    this.lookup = lookup ?? (async (id) => {
      const { projectService } = await import("../projects/project.service");
      return projectService.getProjectById(id);
    });
  }

  private async resolveDirectory(projectId: string, create = false): Promise<string> {
    if (typeof projectId !== "string" || !projectId.trim()) throw new ValidationError("Invalid project ID.");
    const project = await this.lookup(projectId);
    if (!project.repositoryPath?.trim()) throw new ValidationError("NO_REPOSITORY: Configure the project repository in Settings first.");
    if (!path.isAbsolute(project.repositoryPath.trim())) throw new ValidationError("Repository path must be absolute.");
    const repository = path.resolve(project.repositoryPath.trim());
    safeDirectoryChain(repository);
    const tasker = path.join(repository, ".tasker");
    directory(tasker, "NOT_INITIALIZED: Initialize Tasker in Settings first.");
    contained(fs.realpathSync(repository), fs.realpathSync(tasker));
    const tasks = path.join(tasker, "tasks");
    if (!directory(tasks) && create) fs.mkdirSync(tasks);
    if (directory(tasks)) contained(fs.realpathSync(tasker), fs.realpathSync(tasks));
    return tasks;
  }

  async list(projectId: string): Promise<TaskDefinition[]> {
    const tasks = await this.resolveDirectory(projectId);
    if (!directory(tasks)) return [];
    return fs.readdirSync(tasks, { withFileTypes: true })
      .filter((entry) => {
        if (entry.isSymbolicLink()) throw new ValidationError("Symlinks are not allowed in the tasks directory.");
        // Ordinary supporting files, e.g. README.md, are not task definitions.
        return entry.isDirectory();
      })
      .map((entry) => readTask(tasks, entry.name))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  async get(projectId: string, taskId: string): Promise<TaskDefinition> {
    validateTaskId(taskId);
    const tasks = await this.resolveDirectory(projectId);
    if (!directory(tasks)) throw new NotFoundError(`Task "${taskId}" was not found.`);
    return readTask(tasks, taskId);
  }

  async create(projectId: string, input: unknown): Promise<TaskDefinition> {
    const config = validateTaskInput(input);
    const tasks = await this.resolveDirectory(projectId, true);
    const base = taskSlug(config.name);
    let id = base;
    for (let suffix = 2; stat(path.join(tasks, id)); suffix++) id = `${base}-${suffix}`;
    validateTaskId(id);
    const taskDirectory = path.join(tasks, id);
    contained(tasks, taskDirectory);
    safeDirectoryChain(tasks);
    try { fs.mkdirSync(taskDirectory); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new ConflictError("Task ID was claimed concurrently; retry creation.");
      throw error;
    }
    const task: TaskDefinition = { id, ...config };
    const created: string[] = [];
    try {
      for (const [file, content] of [["instructions.md", task.instructions], ["task.toml", serializeTaskConfig(task)]]) {
        safeDirectoryChain(taskDirectory);
        const filePath = path.join(/* turbopackIgnore: true */ taskDirectory, file);
        // Open separately so a partially written file is also cleaned up on error.
        // External .tasker files belong to the user's repository, not the build.
        const fd = fs.openSync(/* turbopackIgnore: true */ filePath, "wx");
        created.push(filePath);
        try { fs.writeFileSync(fd, content, "utf8"); fs.fsyncSync(fd); }
        finally { fs.closeSync(fd); }
      }
      return task;
    } catch (error) {
      safeDirectoryChain(taskDirectory);
      for (const file of created) { regularFile(file); fs.unlinkSync(file); }
      fs.rmdirSync(taskDirectory);
      throw error;
    }
  }

  async update(projectId: string, taskId: string, input: unknown): Promise<TaskDefinition> {
    validateTaskId(taskId);
    const config = validateTaskInput(input);
    const tasks = await this.resolveDirectory(projectId);
    if (!directory(tasks)) throw new NotFoundError(`Task "${taskId}" was not found.`);
    const previous = readTask(tasks, taskId);
    const task: TaskDefinition = { id: taskId, ...config };
    const taskDirectory = path.join(tasks, taskId);
    const staged: string[] = [];
    let instructionsReplaced = false;
    const stage = (file: string, content: string): string => {
      safeDirectoryChain(taskDirectory);
      const temporary = path.join(taskDirectory, `.${file}.${randomUUID()}.tmp`);
      const fd = fs.openSync(temporary, "wx");
      staged.push(temporary);
      try { fs.writeFileSync(fd, content, "utf8"); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      return temporary;
    };
    const replace = (source: string, file: string): void => {
      safeDirectoryChain(taskDirectory);
      regularFile(source);
      // These destinations are resolved in the user's repository at runtime.
      regularFile(path.join(/* turbopackIgnore: true */ taskDirectory, file));
      fs.renameSync(source, path.join(/* turbopackIgnore: true */ taskDirectory, file));
    };
    try {
      const instructions = stage("instructions.md", task.instructions);
      const toml = stage("task.toml", serializeTaskConfig(task));
      replace(instructions, "instructions.md");
      instructionsReplaced = true;
      replace(toml, "task.toml");
      return task;
    } catch (error) {
      if (instructionsReplaced) replace(stage("instructions.md", previous.instructions), "instructions.md");
      throw error;
    } finally {
      safeDirectoryChain(taskDirectory);
      for (const temporary of staged) {
        if (stat(temporary)) { regularFile(temporary); fs.unlinkSync(temporary); }
      }
    }
  }

  async delete(projectId: string, taskId: string): Promise<void> {
    validateTaskId(taskId);
    const tasks = await this.resolveDirectory(projectId);
    const taskDirectory = path.join(tasks, taskId);
    contained(tasks, taskDirectory);
    if (!directory(tasks) || !directory(taskDirectory)) throw new NotFoundError(`Task "${taskId}" was not found.`);
    assertOnlyTaskFiles(taskDirectory);
    // No recursive deletion: extra files and nested directories are preserved.
    for (const file of FILES) {
      safeDirectoryChain(taskDirectory);
      // Trace neither validation nor deletion paths into the application bundle.
      regularFile(path.join(/* turbopackIgnore: true */ taskDirectory, file));
      fs.unlinkSync(path.join(/* turbopackIgnore: true */ taskDirectory, file));
    }
    safeDirectoryChain(taskDirectory);
    fs.rmdirSync(taskDirectory);
  }
}

export const taskService = new TaskService();
