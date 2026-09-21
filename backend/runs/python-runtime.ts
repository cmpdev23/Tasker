import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { PythonRuntimeCandidate, PythonRuntimeStatus } from "../../src/types/project-execution";

const PROBE = "import json,sys; print(json.dumps({'executable': sys.executable, 'version': '.'.join(map(str, sys.version_info[:3])), 'prefix': sys.prefix, 'basePrefix': sys.base_prefix}))";

export interface PythonProbe {
  command: string;
  args: string[];
  label: string;
  source: "auto" | "explicit";
}

type ProbeResult = { stdout: string } | null;
export type PythonRuntimeProbe = (candidate: PythonProbe) => ProbeResult;

function versionParts(version: string): number[] | null {
  const match = version.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

export function pythonVersionAtLeast(version: string, minimum: string): boolean {
  const current = versionParts(version);
  const required = versionParts(minimum);
  if (!current || !required) return false;
  for (let index = 0; index < current.length; index += 1) {
    if (current[index] !== required[index]) return current[index] > required[index];
  }
  return true;
}

export function pythonProbes(minimumVersion: string | null, explicitExecutable: string | null = null): PythonProbe[] {
  if (explicitExecutable) {
    return [{ command: explicitExecutable, args: ["-c", PROBE], label: "configured interpreter", source: "explicit" }];
  }
  const probes: PythonProbe[] = [];
  if (process.platform === "win32" && minimumVersion) {
    probes.push({ command: "py", args: [`-${minimumVersion}`, "-c", PROBE], label: `py -${minimumVersion}`, source: "auto" });
  }
  if (process.platform === "win32") probes.push({ command: "py", args: ["-3", "-c", PROBE], label: "py -3", source: "auto" });
  probes.push(
    { command: "python", args: ["-c", PROBE], label: "python", source: "auto" },
    { command: "python3", args: ["-c", PROBE], label: "python3", source: "auto" },
  );
  return probes;
}

function runProbe(candidate: PythonProbe): ProbeResult {
  const result = spawnSync(candidate.command, candidate.args, {
    shell: false,
    windowsHide: true,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 16 * 1024,
  });
  return result.status === 0 && typeof result.stdout === "string" ? { stdout: result.stdout } : null;
}

function candidateFromProbe(probe: PythonProbe, result: ProbeResult): PythonRuntimeCandidate | null {
  if (!result) return null;
  try {
    const value: unknown = JSON.parse(result.stdout.trim());
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (typeof record.executable !== "string" || !path.isAbsolute(record.executable) ||
        typeof record.version !== "string" || !versionParts(record.version) ||
        typeof record.prefix !== "string" || !path.isAbsolute(record.prefix) ||
        typeof record.basePrefix !== "string" || !path.isAbsolute(record.basePrefix)) return null;
    return { command: probe.label, executable: path.resolve(record.executable), version: record.version,
      prefix: path.resolve(record.prefix), basePrefix: path.resolve(record.basePrefix), source: probe.source };
  } catch { return null; }
}

function runtimeReadableRoots(candidate: PythonRuntimeCandidate | null): string[] {
  if (!candidate) return [];
  const filesystemRoot = path.parse(candidate.basePrefix).root;
  const home = path.resolve(os.homedir());
  return [...new Set([candidate.basePrefix, candidate.prefix].map((entry) => path.resolve(entry)))]
    .filter((entry) => entry !== filesystemRoot && entry !== home);
}

export function detectPythonRuntime(
  minimumVersion: string | null,
  probe: PythonRuntimeProbe = runProbe,
  explicitExecutable: string | null = null,
): PythonRuntimeStatus {
  const probes = pythonProbes(minimumVersion, explicitExecutable);
  const candidates = probes.flatMap((candidate) => {
    const detected = candidateFromProbe(candidate, probe(candidate));
    return detected ? [detected] : [];
  });
  const selected = candidates.find((candidate) => !minimumVersion || pythonVersionAtLeast(candidate.version, minimumVersion)) ?? null;
  const attempts = probes.map((candidate) => candidate.label);
  const detail = selected
    ? `Python ${selected.version} via ${selected.command}`
    : candidates.length
      ? `Detected ${candidates.map((candidate) => `Python ${candidate.version} via ${candidate.command}`).join(", ")}, but none satisfies ${minimumVersion}+.`
      : `No Python runtime detected. Checked ${attempts.join(", ")}.`;
  return { available: Boolean(selected), executable: selected?.executable ?? null, detail, minimumVersion,
    version: selected?.version ?? null, prefix: selected?.prefix ?? null, basePrefix: selected?.basePrefix ?? null,
    source: selected?.source ?? null, readableRoots: runtimeReadableRoots(selected), candidates, attempts,
    sandbox: { checked: false, available: false, detail: "Sandbox access has not been checked." } };
}

/** Adds only the selected interpreter directory; it never reads project env files or replaces PATH. */
export function withPythonRuntimeEnvironment(source: NodeJS.ProcessEnv, runtime: PythonRuntimeStatus): NodeJS.ProcessEnv {
  if (!runtime.executable) return { ...source };
  const env = { ...source };
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? (process.platform === "win32" ? "Path" : "PATH");
  const directory = path.dirname(runtime.executable);
  const entries = (env[pathKey] ?? "").split(path.delimiter).filter(Boolean);
  if (!entries.some((entry) => path.resolve(entry).toLowerCase() === path.resolve(directory).toLowerCase())) entries.unshift(directory);
  env[pathKey] = entries.join(path.delimiter);
  env.PYTHON = runtime.executable;
  env.PYTHONDONTWRITEBYTECODE = "1";
  return env;
}
