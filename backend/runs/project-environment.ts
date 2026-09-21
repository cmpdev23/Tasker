import type { ProjectProcessEnvironment } from "../../src/types/project-execution";

/** Apply explicit project variables case-insensitively without mutating the host process. */
export function withProjectEnvironment(
  source: NodeJS.ProcessEnv,
  overrides: ProjectProcessEnvironment | undefined,
): NodeJS.ProcessEnv {
  const result = { ...source };
  if (!overrides) return result;
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    const existing = Object.keys(result).find((key) => key.toUpperCase() === name.toUpperCase());
    if (existing && existing !== name) delete result[existing];
    result[name] = value;
  }
  return result;
}
