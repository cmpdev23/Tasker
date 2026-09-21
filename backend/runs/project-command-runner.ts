import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { runGitEnvironment } from "../git/git-environment";
import { detectPythonRuntime, withPythonRuntimeEnvironment } from "./python-runtime";
import { terminateProcessTree, verifyExitedProcessTree } from "../codex/codex-runner";
import type {
  ExecutableStatus,
  PackageManager,
  ProjectExecutionRuntimeStatus,
  ProjectExecutionSettings,
  PythonRuntimeStatus,
} from "../../src/types/project-execution";

export interface ProjectCommand {
  name: string;
  executable: PackageManager;
  args: string[];
  timeoutMs: number;
}

export type ProjectCommandEvent =
  | { type: "started"; pid: number }
  | { type: "stdout" | "stderr"; text: string }
  | { type: "termination"; reason: "cancelled" | "timeout" | "error"; phase: "graceful" | "force" };

export interface ProjectCommandResult {
  pid: number | null;
  exitCode: number | null;
  cancelled: boolean;
  timedOut: boolean;
  error: string | null;
  terminationVerified: boolean;
}

interface Launch {
  executable: string;
  args: string[];
  displayExecutable: string;
}

function pathEntries(): string[] {
  const key = Object.keys(process.env).find((name) => name.toUpperCase() === "PATH");
  return (key ? process.env[key] : "")?.split(path.delimiter).filter((entry) => path.isAbsolute(entry)) ?? [];
}

function resolveOnPath(command: string): string | null {
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";")
    : [""];
  for (const directory of pathEntries()) {
    for (const extension of extensions) {
      const candidate = path.join(directory, process.platform === "win32" ? `${command}${extension.toLowerCase()}` : command);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      const originalCase = path.join(directory, `${command}${extension}`);
      if (originalCase !== candidate && fs.existsSync(originalCase) && fs.statSync(originalCase).isFile()) return originalCase;
    }
  }
  return null;
}

function npmCliPath(): string | null {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(path.dirname(process.execPath), "..", "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => path.isAbsolute(candidate) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
}

function windowsCommandLaunch(executable: string, args: string[]): Launch {
  if (/[%!\r\n]/.test(executable) || args.some((value) => !/^[A-Za-z0-9:._-]+$/.test(value))) {
    throw new Error("The Windows package-manager command contains unsupported characters.");
  }
  const commandLine = [`"${executable}"`, ...args.map((value) => `"${value}"`)].join(" ");
  return {
    executable: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", commandLine],
    displayExecutable: executable,
  };
}

function resolveLaunch(manager: PackageManager, args: string[]): Launch {
  if (manager === "npm") {
    const cli = npmCliPath();
    if (cli) return { executable: process.execPath, args: [cli, ...args], displayExecutable: cli };
  }
  const executable = resolveOnPath(manager);
  if (!executable) throw new Error(`${manager} is not installed or is not available to AgentTasker.`);
  if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(executable)) {
    return windowsCommandLaunch(executable, args);
  }
  return { executable, args, displayExecutable: executable };
}

function commandEnvironment(pythonRuntime?: PythonRuntimeStatus): NodeJS.ProcessEnv {
  const env = runGitEnvironment();
  // Next mutates the server's environment (next dev sets NODE_ENV=development).
  // A nested next build would keep that mode, mix React runtimes and fail at
  // prerendering. Production hosts can also cause installs to omit devDependencies.
  // Let each project command choose its own mode and load its own environment.
  // Keep public project variables, credentials and user-supplied NODE_OPTIONS.
  for (const key of Object.keys(env)) {
    const normalized = key.toUpperCase();
    if (normalized === "NODE_ENV" || normalized === "NEXT_RUNTIME" ||
        normalized === "TURBOPACK" || normalized.startsWith("__NEXT_")) {
      delete env[key];
    }
  }
  const key = Object.keys(env).find((name) => name.toUpperCase() === "PATH") ?? (process.platform === "win32" ? "Path" : "PATH");
  const nodeDirectory = path.dirname(process.execPath);
  const entries = (env[key] || "").split(path.delimiter).filter(Boolean);
  if (!entries.some((entry) => path.resolve(entry).toLowerCase() === path.resolve(nodeDirectory).toLowerCase())) {
    entries.unshift(nodeDirectory);
  }
  env[key] = entries.join(path.delimiter);
  return pythonRuntime ? withPythonRuntimeEnvironment(env, pythonRuntime) : env;
}

export function projectPreparationCommands(settings: ProjectExecutionSettings): ProjectCommand[] {
  if (!settings.installDependencies) return [];
  const args: Record<PackageManager, string[]> = {
    npm: ["ci"],
    pnpm: ["install", "--frozen-lockfile"],
    yarn: ["install", "--immutable"],
    bun: ["install", "--frozen-lockfile"],
  };
  return [{
    name: "Install dependencies",
    executable: settings.packageManager,
    args: args[settings.packageManager],
    timeoutMs: settings.installTimeoutMinutes * 60_000,
  }];
}

export function projectValidationCommands(settings: ProjectExecutionSettings): ProjectCommand[] {
  return settings.validationScripts.map((script) => ({
    name: `Validate package script: ${script}`,
    executable: settings.packageManager,
    args: ["run", script],
    timeoutMs: settings.validationTimeoutMinutes * 60_000,
  }));
}

function executableStatus(manager: PackageManager): ExecutableStatus {
  try {
    const launch = resolveLaunch(manager, ["--version"]);
    return { available: true, executable: launch.displayExecutable, detail: null };
  } catch (error) {
    return { available: false, executable: null, detail: error instanceof Error ? error.message : String(error) };
  }
}

export function projectExecutionRuntimeStatus(
  settings: ProjectExecutionSettings,
  localPythonExecutable: string | null = null,
): ProjectExecutionRuntimeStatus {
  return {
    node: { available: true, executable: process.execPath, detail: process.version },
    packageManager: executableStatus(settings.packageManager),
    python: detectPythonRuntime(settings.pythonMinVersion, undefined, localPythonExecutable),
  };
}

export function assertProjectExecutionRuntime(settings: ProjectExecutionSettings, pythonRuntime: PythonRuntimeStatus): void {
  if (settings.installDependencies || settings.validationScripts.length > 0) resolveLaunch(settings.packageManager, ["--version"]);
  if (settings.pythonMinVersion && !pythonRuntime.available) {
    throw new Error(`Python ${settings.pythonMinVersion}+ is required but is unavailable to AgentTasker. ${pythonRuntime.detail}`);
  }
}

export async function runProjectCommand(
  command: ProjectCommand,
  options: { cwd: string; signal?: AbortSignal; onEvent?: (event: ProjectCommandEvent) => void; pythonRuntime?: PythonRuntimeStatus },
  launchOverride?: { executable: string; prefixArgs?: string[] }
): Promise<ProjectCommandResult> {
  if (!path.isAbsolute(options.cwd)) throw new Error("Project command cwd must be absolute.");
  if (!Number.isSafeInteger(command.timeoutMs) || command.timeoutMs < 1 || command.timeoutMs > 2_147_483_647) {
    throw new Error("Project command timeout must be a positive, bounded duration in milliseconds.");
  }
  const launch = launchOverride
    ? { executable: launchOverride.executable, args: [...(launchOverride.prefixArgs ?? []), ...command.args] }
    : resolveLaunch(command.executable, command.args);
  const result: ProjectCommandResult = {
    pid: null, exitCode: null, cancelled: false, timedOut: false, error: null, terminationVerified: true,
  };
  if (options.signal?.aborted) return { ...result, cancelled: true };
  return new Promise((resolve) => {
    const child = spawn(launch.executable, launch.args, {
      cwd: options.cwd,
      env: commandEnvironment(options.pythonRuntime),
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let termination: Promise<void> | undefined;
    let finishing = false;
    let sinkFailed = false;
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    const emit = (event: ProjectCommandEvent) => {
      if (sinkFailed) return;
      try {
        options.onEvent?.(event);
      } catch (error) {
        sinkFailed = true;
        result.error = `Run event sink failed: ${error instanceof Error ? error.message : String(error)}`;
        stop("error");
      }
    };
    const stop = (reason: "cancelled" | "timeout" | "error") => {
      if (termination || finishing) return;
      if (reason === "cancelled") result.cancelled = true;
      if (reason === "timeout") result.timedOut = true;
      result.terminationVerified = false;
      // Schedule before emitting to avoid reentrancy if the sink throws.
      termination = Promise.resolve().then(async () => {
        emit({ type: "termination", reason, phase: "graceful" });
        if (child.pid) await terminateProcessTree(child.pid, 5_000,
          () => emit({ type: "termination", reason, phase: "force" }));
        result.terminationVerified = true;
      }).catch((error: unknown) => {
        result.error = error instanceof Error ? error.message : String(error);
        child.stdout.destroy();
        child.stderr.destroy();
        child.kill();
      });
    };
    const abort = () => stop("cancelled");
    const timer = setTimeout(() => stop("timeout"), command.timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      const text = stdoutDecoder.write(chunk);
      if (text) emit({ type: "stdout", text });
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = stderrDecoder.write(chunk);
      if (text) emit({ type: "stderr", text });
    });
    child.on("spawn", () => {
      result.pid = child.pid ?? null;
      result.terminationVerified = false;
      if (child.pid) emit({ type: "started", pid: child.pid });
      if (options.signal?.aborted) stop("cancelled");
    });
    child.on("error", (error) => { result.error = `Project command failed to start: ${error.message}`; });
    child.on("close", async (exitCode) => {
      finishing = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      const stdoutTail = stdoutDecoder.end();
      const stderrTail = stderrDecoder.end();
      if (stdoutTail) emit({ type: "stdout", text: stdoutTail });
      if (stderrTail) emit({ type: "stderr", text: stderrTail });
      result.exitCode = exitCode;
      await termination;
      if (!termination && result.pid !== null) {
        try {
          await verifyExitedProcessTree(result.pid);
          result.terminationVerified = true;
        } catch (error) {
          result.terminationVerified = false;
          result.error = error instanceof Error ? error.message : String(error);
        }
      }
      if (exitCode !== 0 && !result.error && !result.cancelled && !result.timedOut) {
        result.error = `${command.executable} ${command.args.join(" ")} exited with code ${exitCode ?? "unknown"}.`;
      }
      resolve(result);
    });
    if (options.signal?.aborted) stop("cancelled");
  });
}
