import { ValidationError } from "../errors";
import type {
  SequenceInput,
  SequenceFailurePolicy,
  SequencePullRequestStrategy,
  SequenceStepDefinition,
  SequenceStepInput,
} from "../../src/types/sequences";
import {
  DEFAULT_SEQUENCE_PULL_REQUEST_STRATEGY,
  DEFAULT_SEQUENCE_FAILURE_POLICY,
  DEFAULT_SEQUENCE_MAX_CONSECUTIVE_FAILURES,
  SEQUENCE_FAILURE_POLICIES,
  SEQUENCE_PULL_REQUEST_STRATEGIES,
} from "../../src/types/sequences";
import { quoteToml, readBoolean, readInteger, readString } from "../tasks/toml";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED_ID = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
const STRING_TOKEN = String.raw`(?:(?:"(?:\\.|[^"\\\x00-\x1f])*")|(?:'[^'\x00-\x1f]*'))`;
const SCALAR = new RegExp(`^(?:${STRING_TOKEN}|true|false|0|[1-9][0-9]*)\\s*(?:#.*)?$`);
const ARRAY = new RegExp(`^(\\[\\s*(?:${STRING_TOKEN}(?:\\s*,\\s*${STRING_TOKEN})*\\s*,?)?\\s*\\])\\s*(?:#.*)?$`);

export interface SequenceConfig {
  id: string;
  name: string;
  pullRequestStrategy: SequencePullRequestStrategy;
  failurePolicy: SequenceFailurePolicy;
  maxConsecutiveFailures: number;
  stepIds: string[];
}

export function validateSequenceId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length > 100 || !ID_PATTERN.test(id) || RESERVED_ID.test(id)) {
    throw new ValidationError("Invalid Sequence ID: use a portable lowercase slug (maximum 100 characters).");
  }
}

export function sequenceSlug(name: string, fallback = "sequence"): string {
  const slug = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80).replace(/^-+|-+$/g, "") || fallback;
  return RESERVED_ID.test(slug) ? `${fallback}-${slug}` : slug;
}

function object(value: unknown, label: string, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object.`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new ValidationError(`Unknown ${label} field: ${key}.`);
  }
  return value as Record<string, unknown>;
}

function validName(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 200 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new ValidationError(`${label} must contain 1–200 characters without control characters.`);
  }
  return value.trim();
}

function readStringArray(lines: string[], index: number, token: string, label: string): { value: string; end: number } {
  const source = [token, ...lines.slice(index + 1)].join("\n");
  let value = "";
  let quote: '"' | "'" | null = null;
  let depth = 0;
  let seenArray = false;

  for (let position = 0; position < source.length; position++) {
    const character = source[position];
    if (quote === '"') {
      value += character;
      if (character === "\\") {
        if (position + 1 < source.length) value += source[++position];
      } else if (character === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      value += character;
      if (character === "'") quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      value += character;
      continue;
    }
    if (character === "#") {
      while (position + 1 < source.length && source[position + 1] !== "\n") position++;
      continue;
    }
    if (character === "[") {
      depth++;
      seenArray = true;
      value += character;
      continue;
    }
    if (character === "]") {
      depth--;
      value += character;
      if (!seenArray || depth < 0) break;
      if (depth === 0) {
        let remainder = position + 1;
        while (remainder < source.length && /[ \t\r]/.test(source[remainder])) remainder++;
        if (source[remainder] === "#") {
          while (remainder < source.length && source[remainder] !== "\n") remainder++;
        }
        if (remainder < source.length && source[remainder] !== "\n") {
          throw new ValidationError(`Invalid ${label} value after steps array.`);
        }
        return { value, end: index + source.slice(0, position).split("\n").length - 1 };
      }
      continue;
    }
    value += character;
  }
  throw new ValidationError("steps must be a TOML array of strings.");
}

export function validateSequenceInput(input: unknown): SequenceInput {
  const data = object(input, "Sequence", ["name", "pullRequestStrategy", "failurePolicy", "maxConsecutiveFailures"]);
  if (data.pullRequestStrategy !== undefined &&
      !SEQUENCE_PULL_REQUEST_STRATEGIES.includes(data.pullRequestStrategy as SequencePullRequestStrategy)) {
    throw new ValidationError("pullRequestStrategy must be after_sequence, after_each_step, or independent_after_each_step.");
  }
  if (data.failurePolicy !== undefined && !SEQUENCE_FAILURE_POLICIES.includes(data.failurePolicy as SequenceFailurePolicy)) {
    throw new ValidationError("failurePolicy must be stop or continue.");
  }
  if (data.maxConsecutiveFailures !== undefined && (!Number.isInteger(data.maxConsecutiveFailures) ||
      (data.maxConsecutiveFailures as number) < 1 || (data.maxConsecutiveFailures as number) > 20)) {
    throw new ValidationError("maxConsecutiveFailures must be an integer between 1 and 20.");
  }
  return {
    name: validName(data.name, "Sequence name"),
    ...(data.pullRequestStrategy === undefined
      ? {}
      : { pullRequestStrategy: data.pullRequestStrategy as SequencePullRequestStrategy }),
    ...(data.failurePolicy === undefined ? {} : { failurePolicy: data.failurePolicy as SequenceFailurePolicy }),
    ...(data.maxConsecutiveFailures === undefined ? {} : { maxConsecutiveFailures: data.maxConsecutiveFailures as number }),
  };
}

export function validateSequenceStepInput(input: unknown): SequenceStepInput {
  const data = object(input, "SequenceStep", ["name", "instructions", "expectChanges"]);
  if (typeof data.instructions !== "string" || !data.instructions.trim() || data.instructions.includes("\0") ||
      Buffer.byteLength(data.instructions, "utf8") > 1024 * 1024) {
    throw new ValidationError("Step instructions must be nonempty Markdown of at most 1 MiB without NUL characters.");
  }
  if (typeof data.expectChanges !== "boolean") {
    throw new ValidationError("expectChanges must be a boolean.");
  }
  return {
    name: validName(data.name, "Step name"),
    instructions: data.instructions,
    expectChanges: data.expectChanges,
  };
}

function parseRoot(content: string, label: string, allowed: string[]): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) throw new ValidationError(`${label} does not support TOML tables.`);
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) throw new ValidationError(`Invalid ${label} syntax at line ${index + 1}.`);
    const [, key, token] = match;
    if (!allowed.includes(key) || Object.hasOwn(root, key)) {
      throw new ValidationError(`Unknown or duplicate ${label} key: ${key}.`);
    }
    if (key === "steps") {
      const parsed = readStringArray(lines, index, token, label);
      const array = ARRAY.exec(parsed.value);
      if (!array) throw new ValidationError("steps must be a TOML array of strings.");
      root[key] = [...array[1].matchAll(new RegExp(STRING_TOKEN, "g"))]
        .map((item) => readString(`value = ${item[0]}`, "value"));
      index = parsed.end;
    } else {
      if (!SCALAR.test(token)) throw new ValidationError(`Invalid TOML value for ${key}.`);
      const source = `${key} = ${token}`;
      root[key] = readString(source, key) ?? readBoolean(source, key) ?? readInteger(source, key);
    }
  }
  return root;
}

export function parseSequenceConfig(content: string, id: string): SequenceConfig {
  validateSequenceId(id);
  const root = parseRoot(content, "sequence.toml", ["version", "id", "name", "pull_request_strategy", "failure_policy", "max_consecutive_failures", "steps"]);
  if (root.version !== 1 || root.id !== id || !Array.isArray(root.steps)) {
    throw new ValidationError("sequence.toml requires version = 1, a matching id, and a steps array.");
  }
  const stepIds = root.steps as unknown[];
  if (stepIds.length > 500 || stepIds.some((stepId) => typeof stepId !== "string")) {
    throw new ValidationError("A Sequence may contain at most 500 valid step IDs.");
  }
  for (const stepId of stepIds) validateSequenceId(stepId);
  if (new Set(stepIds).size !== stepIds.length) throw new ValidationError("Sequence step IDs must be unique.");
  const pullRequestStrategy = root.pull_request_strategy ?? DEFAULT_SEQUENCE_PULL_REQUEST_STRATEGY;
  if (!SEQUENCE_PULL_REQUEST_STRATEGIES.includes(pullRequestStrategy as SequencePullRequestStrategy)) {
    throw new ValidationError("pull_request_strategy must be after_sequence, after_each_step, or independent_after_each_step.");
  }
  const failurePolicy = root.failure_policy ?? DEFAULT_SEQUENCE_FAILURE_POLICY;
  const maxConsecutiveFailures = root.max_consecutive_failures ?? DEFAULT_SEQUENCE_MAX_CONSECUTIVE_FAILURES;
  if (!SEQUENCE_FAILURE_POLICIES.includes(failurePolicy as SequenceFailurePolicy)) {
    throw new ValidationError("failure_policy must be stop or continue.");
  }
  if (!Number.isInteger(maxConsecutiveFailures) || (maxConsecutiveFailures as number) < 1 || (maxConsecutiveFailures as number) > 20) {
    throw new ValidationError("max_consecutive_failures must be an integer between 1 and 20.");
  }
  return {
    id,
    name: validName(root.name, "Sequence name"),
    pullRequestStrategy: pullRequestStrategy as SequencePullRequestStrategy,
    failurePolicy: failurePolicy as SequenceFailurePolicy,
    maxConsecutiveFailures: maxConsecutiveFailures as number,
    stepIds: stepIds as string[],
  };
}

export function serializeSequenceConfig(sequence: SequenceConfig): string {
  validateSequenceId(sequence.id);
  const name = validName(sequence.name, "Sequence name");
  if (!SEQUENCE_PULL_REQUEST_STRATEGIES.includes(sequence.pullRequestStrategy)) {
    throw new ValidationError("pullRequestStrategy must be after_sequence, after_each_step, or independent_after_each_step.");
  }
  if (!SEQUENCE_FAILURE_POLICIES.includes(sequence.failurePolicy)) throw new ValidationError("failurePolicy must be stop or continue.");
  if (!Number.isInteger(sequence.maxConsecutiveFailures) || sequence.maxConsecutiveFailures < 1 || sequence.maxConsecutiveFailures > 20) {
    throw new ValidationError("maxConsecutiveFailures must be an integer between 1 and 20.");
  }
  if (sequence.stepIds.length > 500 || new Set(sequence.stepIds).size !== sequence.stepIds.length) {
    throw new ValidationError("A Sequence may contain at most 500 unique steps.");
  }
  sequence.stepIds.forEach(validateSequenceId);
  return [
    "version = 1",
    `id = ${quoteToml(sequence.id)}`,
    `name = ${quoteToml(name)}`,
    `pull_request_strategy = ${quoteToml(sequence.pullRequestStrategy)}`,
    `failure_policy = ${quoteToml(sequence.failurePolicy)}`,
    `max_consecutive_failures = ${sequence.maxConsecutiveFailures}`,
    `steps = [${sequence.stepIds.map(quoteToml).join(", ")}]`,
    "",
  ].join("\n");
}

export function parseSequenceStepConfig(content: string, id: string, instructions: string): SequenceStepDefinition {
  validateSequenceId(id);
  const root = parseRoot(content, "step.toml", ["version", "id", "name", "instructions", "expect_changes"]);
  if (root.version !== 1 || root.id !== id || root.instructions !== "instructions.md") {
    throw new ValidationError("step.toml requires version = 1, a matching id, and instructions = \"instructions.md\".");
  }
  return { id, ...validateSequenceStepInput({
    name: root.name,
    instructions,
    expectChanges: root.expect_changes,
  }) };
}

export function serializeSequenceStepConfig(step: SequenceStepDefinition): string {
  validateSequenceId(step.id);
  const validated = validateSequenceStepInput({
    name: step.name,
    instructions: step.instructions,
    expectChanges: step.expectChanges,
  });
  return [
    "version = 1",
    `id = ${quoteToml(step.id)}`,
    `name = ${quoteToml(validated.name)}`,
    'instructions = "instructions.md"',
    `expect_changes = ${validated.expectChanges}`,
    "",
  ].join("\n");
}
