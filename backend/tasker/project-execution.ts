import { ValidationError } from "../errors";
import { quoteToml, readBoolean, readInteger, readString } from "../tasks/toml";
import {
  DEFAULT_PROJECT_EXECUTION_SETTINGS,
  PACKAGE_MANAGERS,
  type ProjectExecutionSettings,
} from "../../src/types/project-execution";

const KNOWN_KEYS = [
  "default_timeout_minutes",
  "package_manager",
  "python_min_version",
  "install_dependencies",
  "install_timeout_minutes",
  "validation_scripts",
  "validation_timeout_minutes",
] as const;
const SCRIPT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,99}$/;
const PYTHON_VERSION_PATTERN = /^\d+(?:\.\d+){0,2}$/;
const TOML_STRING = String.raw`(?:(?:"(?:\\.|[^"\\\x00-\x1f])*")|(?:'[^'\x00-\x1f]*'))`;

function executionBounds(lines: string[]): { start: number; end: number } | null {
  const headers = lines.flatMap((line, index) =>
    /^\s*\[execution\]\s*(?:#.*)?$/.test(line) ? [index] : []
  );
  if (headers.length > 1) throw new ValidationError("Duplicate [execution] table in .tasker/project.toml.");
  if (!headers.length) return null;
  const start = headers[0];
  const next = lines.slice(start + 1).findIndex((line) => /^\s*\[\[?.+\]\]?\s*(?:#.*)?$/.test(line));
  return { start, end: next === -1 ? lines.length : start + 1 + next };
}

function executionSource(content: string): string {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  const bounds = executionBounds(lines);
  if (!bounds) return "";
  const source = lines.slice(bounds.start + 1, bounds.end).join("\n");
  for (const key of KNOWN_KEYS) {
    const matches = source.match(new RegExp(`^\\s*${key}\\s*=`, "gm"));
    if ((matches?.length ?? 0) > 1) throw new ValidationError(`Duplicate execution setting: ${key}.`);
  }
  return source;
}

function readStringArray(source: string, key: string): string[] | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`^\\s*${escaped}\\s*=\\s*(\\[\\s*(?:${TOML_STRING}(?:\\s*,\\s*${TOML_STRING})*\\s*,?)?\\s*\\])\\s*(?:#.*)?$`, "m"));
  if (!match) {
    if (new RegExp(`^\\s*${escaped}\\s*=`, "m").test(source)) {
      throw new ValidationError(`${key} must be a one-line TOML array of strings.`);
    }
    return undefined;
  }
  return [...match[1].matchAll(new RegExp(TOML_STRING, "g"))]
    .map((item) => readString(`value = ${item[0]}`, "value") ?? "");
}

function hasKey(source: string, key: string): boolean {
  return new RegExp(`^\\s*${key}\\s*=`, "m").test(source);
}

function strictString(source: string, key: string): string | undefined {
  const value = readString(source, key);
  if (value === undefined && hasKey(source, key)) throw new ValidationError(`${key} must be a TOML string.`);
  return value;
}

function strictBoolean(source: string, key: string): boolean | undefined {
  const value = readBoolean(source, key);
  if (value === undefined && hasKey(source, key)) throw new ValidationError(`${key} must be a TOML boolean.`);
  return value;
}

function strictInteger(source: string, key: string): number | undefined {
  const value = readInteger(source, key);
  if (value === undefined && hasKey(source, key)) throw new ValidationError(`${key} must be a positive TOML integer.`);
  return value;
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new ValidationError(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value as number;
}

export function validateProjectExecutionSettings(input: unknown): ProjectExecutionSettings {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ValidationError("Execution settings must be an object.");
  }
  const value = input as Record<string, unknown>;
  const allowed = ["defaultTimeoutMinutes", "packageManager", "pythonMinVersion", "installDependencies", "installTimeoutMinutes",
    "validationScripts", "validationTimeoutMinutes"];
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new ValidationError(`Unknown execution setting: ${unknown}.`);
  if (!PACKAGE_MANAGERS.includes(value.packageManager as never)) {
    throw new ValidationError("Package manager must be npm, pnpm, yarn, or bun.");
  }
  if (value.pythonMinVersion !== null && (typeof value.pythonMinVersion !== "string" || !PYTHON_VERSION_PATTERN.test(value.pythonMinVersion))) {
    throw new ValidationError("Python minimum version must be null or a version such as 3.11.");
  }
  if (typeof value.installDependencies !== "boolean") {
    throw new ValidationError("installDependencies must be a boolean.");
  }
  if (!Array.isArray(value.validationScripts) || value.validationScripts.length > 20 ||
      value.validationScripts.some((script) => typeof script !== "string" || !SCRIPT_PATTERN.test(script)) ||
      new Set(value.validationScripts).size !== value.validationScripts.length) {
    throw new ValidationError("Validation scripts must contain at most 20 distinct package script names.");
  }
  return {
    defaultTimeoutMinutes: integer(value.defaultTimeoutMinutes, "Default Run timeout", 1, 1_440),
    packageManager: value.packageManager as ProjectExecutionSettings["packageManager"],
    pythonMinVersion: value.pythonMinVersion as string | null,
    installDependencies: value.installDependencies,
    installTimeoutMinutes: integer(value.installTimeoutMinutes, "Install timeout", 1, 120),
    validationScripts: value.validationScripts as string[],
    validationTimeoutMinutes: integer(value.validationTimeoutMinutes, "Validation timeout", 1, 120),
  };
}

export function parseProjectExecutionSettings(content: string): ProjectExecutionSettings {
  const source = executionSource(content);
  const packageManager = strictString(source, "package_manager") ?? DEFAULT_PROJECT_EXECUTION_SETTINGS.packageManager;
  const settings = {
    defaultTimeoutMinutes: strictInteger(source, "default_timeout_minutes") ?? DEFAULT_PROJECT_EXECUTION_SETTINGS.defaultTimeoutMinutes,
    packageManager,
    pythonMinVersion: strictString(source, "python_min_version") ?? DEFAULT_PROJECT_EXECUTION_SETTINGS.pythonMinVersion,
    installDependencies: strictBoolean(source, "install_dependencies") ?? DEFAULT_PROJECT_EXECUTION_SETTINGS.installDependencies,
    installTimeoutMinutes: strictInteger(source, "install_timeout_minutes") ?? DEFAULT_PROJECT_EXECUTION_SETTINGS.installTimeoutMinutes,
    validationScripts: readStringArray(source, "validation_scripts") ?? DEFAULT_PROJECT_EXECUTION_SETTINGS.validationScripts,
    validationTimeoutMinutes: strictInteger(source, "validation_timeout_minutes") ?? DEFAULT_PROJECT_EXECUTION_SETTINGS.validationTimeoutMinutes,
  };
  return validateProjectExecutionSettings(settings);
}

function serializedLines(settings: ProjectExecutionSettings): string[] {
  return [
    `default_timeout_minutes = ${settings.defaultTimeoutMinutes}`,
    `package_manager = ${quoteToml(settings.packageManager)}`,
    ...(settings.pythonMinVersion ? [`python_min_version = ${quoteToml(settings.pythonMinVersion)}`] : []),
    `install_dependencies = ${settings.installDependencies}`,
    `install_timeout_minutes = ${settings.installTimeoutMinutes}`,
    `validation_scripts = [${settings.validationScripts.map(quoteToml).join(", ")}]`,
    `validation_timeout_minutes = ${settings.validationTimeoutMinutes}`,
  ];
}

export function updateProjectExecutionToml(content: string, input: unknown): string {
  const settings = validateProjectExecutionSettings(input);
  // Reject an already ambiguous file rather than silently normalizing duplicate keys.
  executionSource(content);
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  const bounds = executionBounds(lines);
  const generated = serializedLines(settings);
  if (!bounds) {
    while (lines.at(-1) === "") lines.pop();
    return `${[...lines, "", "[execution]", ...generated].join(newline)}${newline}`;
  }
  const body = lines.slice(bounds.start + 1, bounds.end)
    .filter((line) => !KNOWN_KEYS.some((key) => new RegExp(`^\\s*${key}\\s*=`).test(line)));
  while (body.length && body.at(-1)?.trim() === "") body.pop();
  const replacement = [lines[bounds.start], ...body, ...(body.length ? [""] : []), ...generated];
  const output = [...lines.slice(0, bounds.start), ...replacement, ...lines.slice(bounds.end)].join(newline);
  return output.endsWith(newline) ? output : `${output}${newline}`;
}

export function serializeDefaultExecutionSection(): string {
  return `[execution]\n${serializedLines(DEFAULT_PROJECT_EXECUTION_SETTINGS).join("\n")}\n`;
}
