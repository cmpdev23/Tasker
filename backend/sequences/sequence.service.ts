import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import type {
  SequenceDefinition,
  SequenceStepDefinition,
} from "../../src/types/sequences";
import { DEFAULT_SEQUENCE_PULL_REQUEST_STRATEGY } from "../../src/types/sequences";
import {
  parseSequenceConfig,
  parseSequenceStepConfig,
  sequenceSlug,
  serializeSequenceConfig,
  serializeSequenceStepConfig,
  validateSequenceId,
  validateSequenceInput,
  validateSequenceStepInput,
  type SequenceConfig,
} from "./sequence-config";

export type { SequenceDefinition, SequenceInput, SequenceStepDefinition, SequenceStepInput } from "../../src/types/sequences";

type ProjectLookup = (id: string) => Promise<{ repositoryPath: string | null }>;
const STEP_FILES = ["step.toml", "instructions.md"] as const;

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
    throw new ValidationError("Sequence paths must remain inside their parent directory.");
  }
}

function directory(directoryPath: string, missingMessage?: string): boolean {
  const info = stat(directoryPath);
  if (!info) {
    if (missingMessage) throw new ValidationError(missingMessage);
    return false;
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new ValidationError("Sequence storage directories must be real directories, without symlinks or junctions.");
  }
  return true;
}

function safeDirectoryChain(absolutePath: string): void {
  const root = path.parse(absolutePath).root;
  let current = root;
  for (const part of path.relative(root, absolutePath).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    directory(current, "Sequence storage directory no longer exists.");
  }
}

function regularFile(filePath: string): fs.Stats {
  const info = stat(filePath);
  if (!info) throw new ValidationError(`Sequence configuration is incomplete: missing ${path.basename(filePath)}.`);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
    throw new ValidationError("Sequence files must be regular files without symbolic or hard links.");
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
      throw new ValidationError(`Unsafe or oversized Sequence file: ${path.basename(filePath)}.`);
    }
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const bytes = fs.readSync(fd, buffer, length, buffer.length - length, null);
      if (!bytes) break;
      length += bytes;
    }
    if (length > limit) throw new ValidationError("Sequence file exceeds its size limit.");
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)); }
    catch { throw new ValidationError("Sequence files must contain valid UTF-8."); }
  } finally { fs.closeSync(fd); }
}

function createFile(filePath: string, content: string): void {
  const fd = fs.openSync(/* turbopackIgnore: true */ filePath, "wx");
  try { fs.writeFileSync(fd, content, "utf8"); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}

function replaceFile(directoryPath: string, filename: string, content: string): void {
  safeDirectoryChain(directoryPath);
  const destination = path.join(/* turbopackIgnore: true */ directoryPath, filename);
  regularFile(destination);
  const temporary = path.join(directoryPath, `.${filename}.${randomUUID()}.tmp`);
  try {
    createFile(temporary, content);
    regularFile(temporary);
    fs.renameSync(temporary, destination);
  } finally {
    if (stat(temporary)) { regularFile(temporary); fs.unlinkSync(temporary); }
  }
}

function readStep(stepsDirectory: string, stepId: string): SequenceStepDefinition {
  validateSequenceId(stepId);
  const stepDirectory = path.join(stepsDirectory, stepId);
  contained(stepsDirectory, stepDirectory);
  if (!directory(stepDirectory)) throw new NotFoundError(`Sequence step "${stepId}" was not found.`);
  return parseSequenceStepConfig(
    readFile(path.join(stepDirectory, "step.toml"), 64 * 1024),
    stepId,
    readFile(path.join(stepDirectory, "instructions.md"), 1024 * 1024),
  );
}

function readSequence(sequencesDirectory: string, sequenceId: string): SequenceDefinition {
  validateSequenceId(sequenceId);
  const sequenceDirectory = path.join(sequencesDirectory, sequenceId);
  contained(sequencesDirectory, sequenceDirectory);
  if (!directory(sequenceDirectory)) throw new NotFoundError(`Sequence "${sequenceId}" was not found.`);
  const config = parseSequenceConfig(readFile(path.join(sequenceDirectory, "sequence.toml"), 64 * 1024), sequenceId);
  const stepsDirectory = path.join(sequenceDirectory, "steps");
  directory(stepsDirectory, `Sequence "${sequenceId}" is incomplete: missing steps directory.`);
  const entries = fs.readdirSync(stepsDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new ValidationError("Symlinks are not allowed in a Sequence steps directory.");
    if (!entry.isDirectory() || !config.stepIds.includes(entry.name)) {
      throw new ValidationError(`Sequence "${sequenceId}" contains an unreferenced or invalid step entry: ${entry.name}.`);
    }
  }
  if (entries.length !== config.stepIds.length) {
    throw new ValidationError(`Sequence "${sequenceId}" references a missing step directory.`);
  }
  return {
    id: config.id,
    name: config.name,
    pullRequestStrategy: config.pullRequestStrategy,
    steps: config.stepIds.map((stepId) => readStep(stepsDirectory, stepId)),
  };
}

function assertOnlyStepFiles(stepDirectory: string): void {
  const entries = fs.readdirSync(stepDirectory, { withFileTypes: true });
  if (entries.length !== STEP_FILES.length || entries.some((entry) =>
    entry.isSymbolicLink() || !entry.isFile() || !STEP_FILES.includes(entry.name as typeof STEP_FILES[number]))) {
    throw new ConflictError("Sequence step contains extra files; delete them manually before removing the step.");
  }
  for (const file of STEP_FILES) regularFile(path.join(/*turbopackIgnore: true*/ stepDirectory, file));
}

function sequenceConfig(sequence: SequenceDefinition): SequenceConfig {
  return {
    id: sequence.id,
    name: sequence.name,
    pullRequestStrategy: sequence.pullRequestStrategy,
    stepIds: sequence.steps.map((step) => step.id),
  };
}

export class SequenceService {
  private readonly lookup: ProjectLookup;

  constructor(lookup?: ProjectLookup) {
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
    const sequences = path.join(tasker, "sequences");
    if (!directory(sequences) && create) fs.mkdirSync(sequences);
    if (directory(sequences)) contained(fs.realpathSync(tasker), fs.realpathSync(sequences));
    return sequences;
  }

  async list(projectId: string): Promise<SequenceDefinition[]> {
    const sequences = await this.resolveDirectory(projectId);
    if (!directory(sequences)) return [];
    return fs.readdirSync(sequences, { withFileTypes: true })
      .filter((entry) => {
        if (entry.isSymbolicLink()) throw new ValidationError("Symlinks are not allowed in the Sequences directory.");
        return entry.isDirectory();
      })
      .map((entry) => readSequence(sequences, entry.name))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  async get(projectId: string, sequenceId: string): Promise<SequenceDefinition> {
    validateSequenceId(sequenceId);
    const sequences = await this.resolveDirectory(projectId);
    if (!directory(sequences)) throw new NotFoundError(`Sequence "${sequenceId}" was not found.`);
    return readSequence(sequences, sequenceId);
  }

  async create(projectId: string, input: unknown): Promise<SequenceDefinition> {
    const validated = validateSequenceInput(input);
    const sequences = await this.resolveDirectory(projectId, true);
    const base = sequenceSlug(validated.name);
    let id = base;
    for (let suffix = 2; stat(path.join(sequences, id)); suffix++) id = `${base}-${suffix}`;
    validateSequenceId(id);
    const sequenceDirectory = path.join(sequences, id);
    contained(sequences, sequenceDirectory);
    try { fs.mkdirSync(sequenceDirectory); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new ConflictError("Sequence ID was claimed concurrently; retry creation.");
      throw error;
    }
    const stepsDirectory = path.join(sequenceDirectory, "steps");
    const sequence: SequenceDefinition = {
      id,
      name: validated.name,
      pullRequestStrategy: validated.pullRequestStrategy ?? DEFAULT_SEQUENCE_PULL_REQUEST_STRATEGY,
      steps: [],
    };
    try {
      fs.mkdirSync(stepsDirectory);
      createFile(path.join(sequenceDirectory, "sequence.toml"), serializeSequenceConfig(sequenceConfig(sequence)));
      return sequence;
    } catch (error) {
      if (stat(path.join(sequenceDirectory, "sequence.toml"))) fs.unlinkSync(path.join(sequenceDirectory, "sequence.toml"));
      if (directory(stepsDirectory)) fs.rmdirSync(stepsDirectory);
      fs.rmdirSync(sequenceDirectory);
      throw error;
    }
  }

  async update(projectId: string, sequenceId: string, input: unknown): Promise<SequenceDefinition> {
    const validated = validateSequenceInput(input);
    const sequences = await this.resolveDirectory(projectId);
    const current = readSequence(sequences, sequenceId);
    const updated = {
      ...current,
      name: validated.name,
      pullRequestStrategy: validated.pullRequestStrategy ?? current.pullRequestStrategy,
    };
    replaceFile(path.join(sequences, sequenceId), "sequence.toml", serializeSequenceConfig(sequenceConfig(updated)));
    return updated;
  }

  async createStep(projectId: string, sequenceId: string, input: unknown): Promise<SequenceDefinition> {
    const validated = validateSequenceStepInput(input);
    const sequences = await this.resolveDirectory(projectId);
    const sequence = readSequence(sequences, sequenceId);
    if (sequence.steps.length >= 500) throw new ValidationError("A Sequence may contain at most 500 steps.");
    const base = sequenceSlug(validated.name, "step");
    let id = base;
    const stepsDirectory = path.join(sequences, sequenceId, "steps");
    for (let suffix = 2; stat(path.join(stepsDirectory, id)); suffix++) id = `${base}-${suffix}`;
    validateSequenceId(id);
    const stepDirectory = path.join(stepsDirectory, id);
    contained(stepsDirectory, stepDirectory);
    fs.mkdirSync(stepDirectory);
    const step: SequenceStepDefinition = { id, ...validated };
    const created: string[] = [];
    try {
      for (const [file, content] of [["instructions.md", step.instructions], ["step.toml", serializeSequenceStepConfig(step)]]) {
        const filePath = path.join(/* turbopackIgnore: true */ stepDirectory, file);
        createFile(filePath, content);
        created.push(filePath);
      }
      const updated = { ...sequence, steps: [...sequence.steps, step] };
      replaceFile(path.join(sequences, sequenceId), "sequence.toml", serializeSequenceConfig(sequenceConfig(updated)));
      return updated;
    } catch (error) {
      for (const file of created) if (stat(file)) fs.unlinkSync(file);
      if (directory(stepDirectory)) fs.rmdirSync(stepDirectory);
      throw error;
    }
  }

  async updateStep(projectId: string, sequenceId: string, stepId: string, input: unknown): Promise<SequenceDefinition> {
    validateSequenceId(stepId);
    const validated = validateSequenceStepInput(input);
    const sequences = await this.resolveDirectory(projectId);
    const sequence = readSequence(sequences, sequenceId);
    const index = sequence.steps.findIndex((step) => step.id === stepId);
    if (index < 0) throw new NotFoundError(`Sequence step "${stepId}" was not found.`);
    const previous = sequence.steps[index];
    const step: SequenceStepDefinition = { id: stepId, ...validated };
    const stepDirectory = path.join(sequences, sequenceId, "steps", stepId);
    let instructionsReplaced = false;
    try {
      replaceFile(stepDirectory, "instructions.md", step.instructions);
      instructionsReplaced = true;
      replaceFile(stepDirectory, "step.toml", serializeSequenceStepConfig(step));
    } catch (error) {
      if (instructionsReplaced) replaceFile(stepDirectory, "instructions.md", previous.instructions);
      throw error;
    }
    const steps = [...sequence.steps];
    steps[index] = step;
    return { ...sequence, steps };
  }

  async reorderSteps(projectId: string, sequenceId: string, orderedStepIds: unknown): Promise<SequenceDefinition> {
    if (!Array.isArray(orderedStepIds) || orderedStepIds.some((id) => typeof id !== "string")) {
      throw new ValidationError("orderedStepIds must be an array of step IDs.");
    }
    orderedStepIds.forEach(validateSequenceId);
    const sequences = await this.resolveDirectory(projectId);
    const sequence = readSequence(sequences, sequenceId);
    const currentIds = sequence.steps.map((step) => step.id);
    if (orderedStepIds.length !== currentIds.length || new Set(orderedStepIds).size !== currentIds.length ||
        currentIds.some((id) => !orderedStepIds.includes(id))) {
      throw new ValidationError("The reordered list must contain every Sequence step exactly once.");
    }
    const byId = new Map(sequence.steps.map((step) => [step.id, step]));
    const updated = { ...sequence, steps: orderedStepIds.map((id) => byId.get(id)!) };
    replaceFile(path.join(sequences, sequenceId), "sequence.toml", serializeSequenceConfig(sequenceConfig(updated)));
    return updated;
  }

  async deleteStep(projectId: string, sequenceId: string, stepId: string): Promise<SequenceDefinition> {
    validateSequenceId(stepId);
    const sequences = await this.resolveDirectory(projectId);
    const sequence = readSequence(sequences, sequenceId);
    const step = sequence.steps.find((candidate) => candidate.id === stepId);
    if (!step) throw new NotFoundError(`Sequence step "${stepId}" was not found.`);
    const stepDirectory = path.join(sequences, sequenceId, "steps", stepId);
    assertOnlyStepFiles(stepDirectory);
    const updated = { ...sequence, steps: sequence.steps.filter((candidate) => candidate.id !== stepId) };
    const sequenceDirectory = path.join(sequences, sequenceId);
    replaceFile(sequenceDirectory, "sequence.toml", serializeSequenceConfig(sequenceConfig(updated)));
    try {
      for (const file of STEP_FILES) fs.unlinkSync(path.join(/* turbopackIgnore: true */ stepDirectory, file));
      fs.rmdirSync(stepDirectory);
      return updated;
    } catch (error) {
      replaceFile(sequenceDirectory, "sequence.toml", serializeSequenceConfig(sequenceConfig(sequence)));
      throw error;
    }
  }

  async delete(projectId: string, sequenceId: string): Promise<void> {
    const sequences = await this.resolveDirectory(projectId);
    const sequence = readSequence(sequences, sequenceId);
    const sequenceDirectory = path.join(sequences, sequenceId);
    const stepsDirectory = path.join(sequenceDirectory, "steps");
    const rootEntries = fs.readdirSync(sequenceDirectory, { withFileTypes: true });
    if (rootEntries.length !== 2 || rootEntries.some((entry) =>
      entry.isSymbolicLink() || !["sequence.toml", "steps"].includes(entry.name))) {
      throw new ConflictError("Sequence contains extra files; delete them manually before removing the Sequence.");
    }
    regularFile(path.join(sequenceDirectory, "sequence.toml"));
    for (const step of sequence.steps) assertOnlyStepFiles(path.join(stepsDirectory, step.id));
    for (const step of sequence.steps) {
      const stepDirectory = path.join(stepsDirectory, step.id);
      for (const file of STEP_FILES) fs.unlinkSync(path.join(/* turbopackIgnore: true */ stepDirectory, file));
      fs.rmdirSync(stepDirectory);
    }
    fs.rmdirSync(stepsDirectory);
    fs.unlinkSync(path.join(/* turbopackIgnore: true */ sequenceDirectory, "sequence.toml"));
    fs.rmdirSync(sequenceDirectory);
  }
}

export const sequenceService = new SequenceService();
