import { ValidationError } from "../errors";
import { quoteToml, readBoolean, readString } from "../tasks/toml";
import {
  DEFAULT_PROJECT_GIT_SETTINGS,
  type ProjectGitSettings,
} from "../../src/types/project-git";

const KNOWN_KEYS = ["remote", "push", "create_pull_request", "pull_request_draft"] as const;

function gitBounds(lines: string[]): { start: number; end: number } | null {
  const headers = lines.flatMap((line, index) =>
    /^\s*\[git\]\s*(?:#.*)?$/.test(line) ? [index] : []
  );
  if (headers.length > 1) throw new ValidationError("Duplicate [git] table in .tasker/project.toml.");
  if (!headers.length) return null;
  const start = headers[0];
  const next = lines.slice(start + 1).findIndex((line) => /^\s*\[\[?.+\]\]?\s*(?:#.*)?$/.test(line));
  return { start, end: next === -1 ? lines.length : start + 1 + next };
}

function gitSource(content: string): string {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  const bounds = gitBounds(lines);
  if (!bounds) return "";
  const source = lines.slice(bounds.start + 1, bounds.end).join("\n");
  for (const key of KNOWN_KEYS) {
    const matches = source.match(new RegExp(`^\\s*${key}\\s*=`, "gm"));
    if ((matches?.length ?? 0) > 1) throw new ValidationError(`Duplicate Git setting: ${key}.`);
  }
  return source;
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

export function validateProjectGitSettings(input: unknown): ProjectGitSettings {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ValidationError("Git settings must be an object.");
  }
  const value = input as Record<string, unknown>;
  const allowed = ["remote", "push", "createPullRequest", "pullRequestDraft"];
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new ValidationError(`Unknown Git setting: ${unknown}.`);
  if (typeof value.remote !== "string" || !value.remote || value.remote.length > 100 ||
      value.remote.startsWith("-") || /[\s\x00-\x1f]/.test(value.remote)) {
    throw new ValidationError("Git remote must be a non-empty remote name without whitespace.");
  }
  for (const key of ["push", "createPullRequest", "pullRequestDraft"] as const) {
    if (typeof value[key] !== "boolean") throw new ValidationError(`${key} must be a boolean.`);
  }
  if (value.createPullRequest && !value.push) {
    throw new ValidationError("Pull request creation requires branch push to be enabled.");
  }
  return {
    remote: value.remote,
    push: value.push,
    createPullRequest: value.createPullRequest,
    pullRequestDraft: value.pullRequestDraft,
  } as ProjectGitSettings;
}

export function parseProjectGitSettings(content: string): ProjectGitSettings {
  const source = gitSource(content);
  return validateProjectGitSettings({
    remote: strictString(source, "remote") ?? DEFAULT_PROJECT_GIT_SETTINGS.remote,
    push: strictBoolean(source, "push") ?? DEFAULT_PROJECT_GIT_SETTINGS.push,
    createPullRequest: strictBoolean(source, "create_pull_request") ?? DEFAULT_PROJECT_GIT_SETTINGS.createPullRequest,
    pullRequestDraft: strictBoolean(source, "pull_request_draft") ?? DEFAULT_PROJECT_GIT_SETTINGS.pullRequestDraft,
  });
}

function serializedLines(settings: ProjectGitSettings): string[] {
  return [
    `remote = ${quoteToml(settings.remote)}`,
    `push = ${settings.push}`,
    `create_pull_request = ${settings.createPullRequest}`,
    `pull_request_draft = ${settings.pullRequestDraft}`,
  ];
}

export function updateProjectGitToml(content: string, input: unknown): string {
  const settings = validateProjectGitSettings(input);
  gitSource(content);
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  const bounds = gitBounds(lines);
  const generated = serializedLines(settings);
  if (!bounds) {
    while (lines.at(-1) === "") lines.pop();
    return `${[...lines, "", "[git]", ...generated].join(newline)}${newline}`;
  }
  const body = lines.slice(bounds.start + 1, bounds.end)
    .filter((line) => !KNOWN_KEYS.some((key) => new RegExp(`^\\s*${key}\\s*=`).test(line)));
  while (body.length && body.at(-1)?.trim() === "") body.pop();
  const replacement = [lines[bounds.start], ...body, ...(body.length ? [""] : []), ...generated];
  const output = [...lines.slice(0, bounds.start), ...replacement, ...lines.slice(bounds.end)].join(newline);
  return output.endsWith(newline) ? output : `${output}${newline}`;
}

export function serializeDefaultGitSettings(): string {
  return serializedLines(DEFAULT_PROJECT_GIT_SETTINGS).join("\n");
}
