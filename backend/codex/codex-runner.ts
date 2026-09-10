import { execFile, spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import type { MainCodexAgentConfig } from "../../src/types/codex-agents";
import { resolveCodexExecutable } from "./codex-executable";
import { runGitEnvironment } from "../git/git-environment";

export type CodexRunEvent =
  | { type: "started"; pid: number }
  | { type: "stdout" | "stderr"; text: string }
  | { type: "codex"; event: unknown }
  | { type: "termination"; reason: "cancelled" | "timeout" | "error"; phase: "graceful" | "force" };

export interface CodexRunOptions {
  worktreePath: string;
  prompt: string;
  config: MainCodexAgentConfig;
  timeoutMs: number;
  signal?: AbortSignal;
  terminationGraceMs?: number;
  /** Backend-owned file containing CODEX_RUN_OUTPUT_SCHEMA, outside the worktree. */
  outputSchemaPath?: string;
  /** Synchronous ordered sink; persistence/streaming belongs to the worker. */
  onEvent?: (event: CodexRunEvent) => void;
}

export interface CodexRunResult {
  pid: number | null;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  cancelled: boolean;
  timedOut: boolean;
  lastAgentMessage: string | null;
  error: string | null;
  agentResult: CodexAgentResult | null;
  /** False requires a durable queue block/manual recovery, even if the root PID has exited. */
  terminationVerified: boolean;
}

export interface CodexAgentResult {
  status: "SUCCESS" | "FAILURE";
  summary: string;
  blocking_error: string | null;
}

/** The worker may write this non-secret schema to its external runtime directory. */
export const CODEX_RUN_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["SUCCESS", "FAILURE"] },
    summary: { type: "string" },
    blocking_error: { type: ["string", "null"] },
  },
  required: ["status", "summary", "blocking_error"],
  additionalProperties: false,
} as const;

function parseAgentResult(message: string | null): CodexAgentResult | null {
  if (!message) return null;
  try {
    const value: unknown = JSON.parse(message);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const result = value as Record<string, unknown>;
    if ((result.status !== "SUCCESS" && result.status !== "FAILURE") || typeof result.summary !== "string" ||
        (result.blocking_error !== null && typeof result.blocking_error !== "string") ||
        Object.keys(result).some((key) => !["status", "summary", "blocking_error"].includes(key))) return null;
    return result as unknown as CodexAgentResult;
  } catch { return null; }
}

const execFileAsync = promisify(execFile);
const MAX_EVENT_LINE = 2 * 1024 * 1024;
const DEFAULT_TERMINATION_GRACE_MS = 5_000;

/** Every configured permission is explicit; never use --full-auto or bypass flags. */
export function buildCodexExecArgs(config: MainCodexAgentConfig, worktreePath: string, outputSchemaPath?: string): string[] {
  const args = ["exec", "--json", "--color", "never", "--cd", worktreePath];
  const set = (key: string, value: string | boolean | number) => {
    args.push("-c", `${key}=${JSON.stringify(value)}`);
  };
  if (config.model) set("model", config.model);
  set("model_reasoning_effort", config.model_reasoning_effort);
  set("model_reasoning_summary", config.model_reasoning_summary);
  set("model_verbosity", config.model_verbosity);
  set("sandbox_mode", config.sandbox_mode);
  set("approval_policy", config.approval_policy);
  set("sandbox_workspace_write.network_access", config.sandbox_workspace_write.network_access);
  set("agents.enabled", config.agents.enabled);
  set("agents.interrupt_message", config.agents.interrupt_message);
  if (config.agents.max_concurrent_threads_per_session !== null) {
    set("agents.max_concurrent_threads_per_session", config.agents.max_concurrent_threads_per_session);
  }
  if (config.agents.default_subagent_model) set("agents.default_subagent_model", config.agents.default_subagent_model);
  if (config.agents.default_subagent_reasoning_effort) set("agents.default_subagent_reasoning_effort", config.agents.default_subagent_reasoning_effort);
  if (outputSchemaPath) args.push("--output-schema", outputSchemaPath);
  args.push("-");
  return args;
}

interface WindowsProcess { ProcessId: number; ParentProcessId: number; Started: string }

// Toolhelp snapshots work without the WMI/CIM permissions that restricted Windows users lack.
// Only PID, parent PID and creation time leave this helper; no command lines or environment values.
const WINDOWS_PROCESS_SNAPSHOT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class AgentTaskerProcessSnapshot {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct Entry {
    public uint Size, Usage, ProcessId;
    public UIntPtr Heap;
    public uint Module, Threads, ParentProcessId;
    public int Priority;
    public uint Flags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string Name;
  }
  public sealed class Info {
    public uint ProcessId, ParentProcessId;
    public string Started;
  }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool Process32FirstW(IntPtr snapshot, ref Entry entry);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool Process32NextW(IntPtr snapshot, ref Entry entry);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr handle, out long created, out long exited, out long kernel, out long user);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr handle, out uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr handle, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  public static void Stop(uint pid, string expectedStart) {
    IntPtr handle = OpenProcess(0x101001, false, pid); // Query, terminate, and wait on this exact process object.
    if (handle == IntPtr.Zero) return; // Read() below verifies whether it is still alive.
    try {
      long created, exited, kernel, user;
      if (!GetProcessTimes(handle, out created, out exited, out kernel, out user)) throw new Win32Exception(Marshal.GetLastWin32Error());
      if (created.ToString() != expectedStart) return;
      uint code;
      if (GetExitCodeProcess(handle, out code) && code != 259) return;
      if (!TerminateProcess(handle, 1)) {
        int error = Marshal.GetLastWin32Error();
        // Stopping a parent can concurrently finish a child/console host. Only a signaled handle proves exit.
        if (WaitForSingleObject(handle, 1000) != 0) throw new Win32Exception(error);
      }
    } finally { CloseHandle(handle); }
  }
  public static Info[] Read() {
    IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
    if (snapshot == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
    var result = new List<Info>();
    try {
      var entry = new Entry { Size = (uint)Marshal.SizeOf(typeof(Entry)) };
      if (!Process32FirstW(snapshot, ref entry)) throw new Win32Exception(Marshal.GetLastWin32Error());
      do {
        string started = "";
        IntPtr handle = OpenProcess(0x1000, false, entry.ProcessId);
        if (handle != IntPtr.Zero) {
          try {
            uint code;
            if (GetExitCodeProcess(handle, out code) && code != 259) continue;
            long created, exited, kernel, user;
            if (GetProcessTimes(handle, out created, out exited, out kernel, out user)) started = created.ToString();
          } finally { CloseHandle(handle); }
        }
        result.Add(new Info { ProcessId=entry.ProcessId, ParentProcessId=entry.ParentProcessId, Started=started });
      } while (Process32NextW(snapshot, ref entry));
      int error = Marshal.GetLastWin32Error();
      if (error != 18) throw new Win32Exception(error);
      return result.ToArray();
    } finally { CloseHandle(snapshot); }
  }
}
'@
`;

async function windowsProcesses(): Promise<WindowsProcess[]> {
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `${WINDOWS_PROCESS_SNAPSHOT}\nConvertTo-Json -InputObject @([AgentTaskerProcessSnapshot]::Read()) -Compress`],
  { shell: false, windowsHide: true, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) throw new Error("Could not inspect the Windows process tree.");
  return parsed as WindowsProcess[];
}

async function forceWindowsProcesses(processes: WindowsProcess[]): Promise<void> {
  if (!processes.length) return;
  const commands = processes.map((entry) => {
    if (!Number.isSafeInteger(entry.ProcessId) || entry.ProcessId < 1 || !/^\d+$/.test(entry.Started)) {
      throw new Error("Cannot force a process whose identity is unverified.");
    }
    return `[AgentTaskerProcessSnapshot]::Stop(${entry.ProcessId}, '${entry.Started}')`;
  });
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `${WINDOWS_PROCESS_SNAPSHOT}\n${commands.join("\n")}`],
  { shell: false, windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 });
}

function descendants(processes: WindowsProcess[], pid: number): WindowsProcess[] {
  const ids = new Set([pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of processes) {
      if (ids.has(process.ParentProcessId) && !ids.has(process.ProcessId)) {
        ids.add(process.ProcessId);
        changed = true;
      }
    }
  }
  return processes.filter((process) => ids.has(process.ProcessId));
}

async function taskkill(pid: number, force: boolean): Promise<void> {
  try {
    await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])],
      { shell: false, windowsHide: true, timeout: 10_000 });
  } catch {
    // Console applications may reject graceful taskkill; the force phase verifies survivors.
  }
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

/** Root exit does not imply child exit. This check is read-only, including for a dead/reused root PID. */
async function verifyExitedProcessTree(pid: number): Promise<void> {
  if (process.platform === "win32") {
    // Toolhelp retains the original PPID after the parent exits, including detached children.
    if (descendants(await windowsProcesses(), pid).length > 0) {
      throw new Error("Codex exited but descendant processes may still be running; queue must remain blocked.");
    }
    return;
  }
  try {
    // Codex owns a dedicated POSIX group; stdio:'ignore' children can outlive its root.
    process.kill(-pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    throw error;
  }
  throw new Error("Codex exited but its process group still exists; queue must remain blocked.");
}

/** Retain descendants across parent exit; do not cancel force escalation when the parent closes. */
async function terminateProcessTree(pid: number, graceMs: number, forceEvent: () => void): Promise<void> {
  if (process.platform !== "win32") {
    signalProcessGroup(pid, "SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, graceMs));
    forceEvent();
    signalProcessGroup(pid, "SIGKILL");
    // A delivered signal alone is insufficient to allow another run into the queue.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try { process.kill(-pid, 0); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Codex process group still exists after termination; queue must remain blocked.");
  }
  let snapshot: WindowsProcess[] = [];
  let snapshotError: unknown;
  try {
    snapshot = descendants(await windowsProcesses(), pid);
    if (snapshot.some((entry) => !entry.Started)) throw new Error("A child process creation time could not be verified.");
  } catch (error) {
    snapshotError = error;
  }
  await taskkill(pid, false);
  await new Promise((resolve) => setTimeout(resolve, graceMs));
  forceEvent();
  let current: WindowsProcess[];
  try { current = await windowsProcesses(); }
  catch (cause) {
    await taskkill(pid, true);
    throw new Error("Process tree inspection failed; termination could not be fully verified.", { cause });
  }
  // Creation times prevent killing unrelated processes if Windows has reused a PID.
  const survivors = snapshot.filter((original) => current.some((entry) =>
    entry.ProcessId === original.ProcessId && entry.Started === original.Started));
  if (snapshotError) {
    // Best effort while the root still exists; report inability to verify the full tree.
    await taskkill(pid, true);
    throw new Error("Process tree inspection failed; termination could not be fully verified.", { cause: snapshotError });
  }
  // Include descendants created during the grace period, before stopping their parents.
  const targets = new Map(survivors.map((entry) => [entry.ProcessId, entry]));
  for (const survivor of survivors) {
    for (const entry of descendants(current, survivor.ProcessId)) targets.set(entry.ProcessId, entry);
  }
  // Native termination uses a handle bound to the verified creation time and needs no WMI.
  await forceWindowsProcesses([...targets.values()]);
  const remaining = await windowsProcesses();
  if ([...targets.values()].some((original) => remaining.some((entry) => entry.ProcessId === original.ProcessId && entry.Started === original.Started)) ||
      // A newly orphaned descendant must keep the queue blocked even if its root exited.
      remaining.some((entry) => targets.has(entry.ParentProcessId) || snapshot.some((original) => original.ProcessId === entry.ParentProcessId))) {
    throw new Error("Some Codex child processes could not be terminated; keep the worktree for recovery.");
  }
}

/** No DB, scheduler, shell, or prompt arguments. The optional launch seam is backend-only for stub tests. */
export async function runCodex(
  options: CodexRunOptions,
  launch?: { executable: string; prefixArgs?: string[] }
): Promise<CodexRunResult> {
  if (!path.isAbsolute(options.worktreePath)) throw new Error("Codex requires an absolute worktree path.");
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 2_147_483_647) {
    throw new Error("Codex timeout must be a positive, bounded duration in milliseconds.");
  }
  const graceMs = options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;
  if (!Number.isSafeInteger(graceMs) || graceMs < 0 || graceMs > 60_000) throw new Error("Invalid termination grace period.");
  const result: CodexRunResult = { pid: null, exitCode: null, signal: null, cancelled: false, timedOut: false, lastAgentMessage: null, error: null, agentResult: null, terminationVerified: true };
  if (options.signal?.aborted) return { ...result, cancelled: true };
  if (options.outputSchemaPath) {
    if (!path.isAbsolute(options.outputSchemaPath)) throw new Error("Output schema requires an absolute runtime path.");
    const directory = await fs.realpath(options.worktreePath);
    const schemaPath = await fs.realpath(options.outputSchemaPath);
    const relative = path.relative(directory, schemaPath);
    if (relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))) {
      throw new Error("The runtime output schema must be outside the run worktree.");
    }
  }
  const args = buildCodexExecArgs(options.config, options.worktreePath, options.outputSchemaPath);
  // Git invoked by the agent must resolve its worktree from cwd, never an inherited checkout/index.
  const env = runGitEnvironment();
  return new Promise((resolve) => {
    const child = spawn(launch?.executable ?? resolveCodexExecutable(), [...(launch?.prefixArgs ?? []), ...args], {
      cwd: options.worktreePath,
      env,
      shell: false,
      windowsHide: true,
      // POSIX creates a process group so descendants receive TERM and KILL too.
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let termination: Promise<void> | undefined;
    let finishing = false;
    let sinkFailed = false;
    let lineBuffer = "";
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    const emit = (event: CodexRunEvent) => {
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
        if (child.pid) {
          await terminateProcessTree(child.pid, graceMs, () => emit({ type: "termination", reason, phase: "force" }));
        }
        result.terminationVerified = true;
      }).catch((error: unknown) => {
        result.error = error instanceof Error ? error.message : String(error);
        // Unblock stream completion after an OS termination failure. The result remains failed.
        child.stdout.destroy();
        child.stderr.destroy();
        child.stdin.destroy();
        child.kill();
      });
    };
    const parseLine = (line: string) => {
      if (!line.trim()) return;
      let event: unknown;
      try { event = JSON.parse(line); } catch { return; } // Raw non-JSON output is still persisted.
      emit({ type: "codex", event });
      if (!event || typeof event !== "object") return;
      const value = event as { type?: string; item?: { type?: string; text?: string }; error?: { message?: string }; message?: string };
      if (value.type === "item.completed" && value.item?.type === "agent_message" && typeof value.item.text === "string") {
        result.lastAgentMessage = value.item.text;
      }
      if (value.type === "turn.failed" || value.type === "error") {
        result.error = value.error?.message ?? value.message ?? "Codex reported an execution error.";
      }
    };
    const stdout = (text: string) => {
      if (!text) return;
      emit({ type: "stdout", text });
      lineBuffer += text;
      let newline: number;
      while ((newline = lineBuffer.indexOf("\n")) !== -1) {
        const line = lineBuffer.slice(0, newline);
        lineBuffer = lineBuffer.slice(newline + 1);
        if (line.length > MAX_EVENT_LINE) {
          result.error = "Codex emitted an oversized JSON event.";
          stop("error");
        } else parseLine(line);
      }
      if (lineBuffer.length > MAX_EVENT_LINE) {
        lineBuffer = "";
        result.error = "Codex emitted an oversized unterminated event.";
        stop("error");
      }
    };
    const abort = () => stop("cancelled");
    const timer = setTimeout(() => stop("timeout"), options.timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => stdout(stdoutDecoder.write(chunk)));
    child.stderr.on("data", (chunk: Buffer) => {
      const text = stderrDecoder.write(chunk);
      if (text) emit({ type: "stderr", text });
    });
    child.stdin.on("error", (error) => {
      result.error = `Could not send the full prompt to Codex: ${error.message}`;
      stop("error");
    });
    child.on("spawn", () => {
      result.pid = child.pid ?? null;
      result.terminationVerified = false;
      if (child.pid) emit({ type: "started", pid: child.pid });
      if (options.signal?.aborted) stop("cancelled");
      if (!termination) child.stdin.end(options.prompt, "utf8");
      else child.stdin.end();
    });
    child.on("error", (error) => {
      result.error = `Codex process failed: ${error.message}`;
    });
    child.on("close", async (exitCode, signal) => {
      // Flushing events must never start a termination attempt against an already exited root.
      finishing = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      stdout(stdoutDecoder.end());
      const tail = stderrDecoder.end();
      if (tail) emit({ type: "stderr", text: tail });
      if (lineBuffer) parseLine(lineBuffer);
      result.exitCode = exitCode;
      result.signal = signal;
      await termination;
      if (!termination && result.pid !== null) {
        try {
          await verifyExitedProcessTree(result.pid);
          result.terminationVerified = true;
        } catch {
          result.terminationVerified = false;
          const message = "Codex process tree termination could not be verified after root exit; preserve the worktree and block the queue.";
          result.error = result.error ? `${result.error} ${message}` : message;
          // Do not signal a dead/reused root PID or silently discard surviving work.
        }
      }
      result.agentResult = parseAgentResult(result.lastAgentMessage);
      if (result.agentResult?.status === "FAILURE") {
        result.error ??= result.agentResult.blocking_error || result.agentResult.summary || "Codex reported task failure.";
      } else if (result.agentResult?.blocking_error != null) {
        result.error ??= result.agentResult.blocking_error || "Codex reported a blocking error despite SUCCESS.";
      } else if (options.outputSchemaPath && !result.agentResult && !result.cancelled && !result.timedOut) {
        result.error ??= "Codex did not return a valid structured task result.";
      }
      if (exitCode !== 0 && !result.error && !result.cancelled && !result.timedOut) {
        result.error = `Codex exited with ${signal ? `signal ${signal}` : `code ${exitCode ?? "unknown"}`}.`;
      }
      resolve(result);
    });
    // Cover a cancellation occurring between the initial check and listener registration.
    if (options.signal?.aborted) stop("cancelled");
  });
}
