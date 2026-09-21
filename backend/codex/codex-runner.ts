import { execFile, spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import { createInterface } from "node:readline";
import type { MainCodexAgentConfig } from "../../src/types/codex-agents";
import { resolveCodexExecutable } from "./codex-executable";
import { runGitEnvironment } from "../git/git-environment";
import { withPythonRuntimeEnvironment } from "../runs/python-runtime";
import type { PythonRuntimeStatus } from "../../src/types/project-execution";

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
  /** Selected by the runner from portable project settings; never contains environment values. */
  pythonRuntime?: PythonRuntimeStatus;
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

/** App-server process settings that are not expressible as per-turn protocol fields. */
export interface CodexPermissionProfile {
  id: string;
  configOverrides: string[];
}

export function buildCodexPermissionProfile(
  config: MainCodexAgentConfig,
  readableRoots: string[],
): CodexPermissionProfile | null {
  if (config.sandbox_mode === "danger-full-access" || readableRoots.length === 0) return null;
  const id = "agenttasker-run";
  const base = config.sandbox_mode === "read-only" ? ":read-only" : ":workspace";
  const roots = [...new Set(readableRoots.map((entry) => path.resolve(entry)))];
  const filesystem = roots.map((root) => `${JSON.stringify(root)} = "read"`).join(", ");
  const overrides = [
    `default_permissions=${JSON.stringify(id)}`,
    `permissions.${id}={ extends = ${JSON.stringify(base)}, filesystem = { ${filesystem} } }`,
  ];
  return { id, configOverrides: overrides };
}

export function buildCodexAppServerArgs(
  config: MainCodexAgentConfig,
  permissionProfile: CodexPermissionProfile | null = null,
): string[] {
  const args = ["app-server"];
  const set = (key: string, value: string | boolean | number) => {
    args.push("-c", `${key}=${JSON.stringify(value)}`);
  };
  set("model_verbosity", config.model_verbosity);
  set("agents.enabled", config.agents.enabled);
  set("agents.interrupt_message", config.agents.interrupt_message);
  if (config.agents.max_concurrent_threads_per_session !== null) {
    set("agents.max_concurrent_threads_per_session", config.agents.max_concurrent_threads_per_session);
  }
  if (config.agents.default_subagent_model) set("agents.default_subagent_model", config.agents.default_subagent_model);
  if (config.agents.default_subagent_reasoning_effort) set("agents.default_subagent_reasoning_effort", config.agents.default_subagent_reasoning_effort);
  for (const override of permissionProfile?.configOverrides ?? []) args.push("-c", override);
  return args;
}

type CodexSandboxPolicy =
  | { type: "dangerFullAccess" }
  | { type: "readOnly"; networkAccess: boolean }
  | { type: "workspaceWrite"; writableRoots: string[]; networkAccess: boolean;
      excludeTmpdirEnvVar: boolean; excludeSlashTmp: boolean };

export function buildCodexSandboxPolicy(
  config: MainCodexAgentConfig,
  worktreePath: string,
): CodexSandboxPolicy {
  if (config.sandbox_mode === "danger-full-access") return { type: "dangerFullAccess" };
  if (config.sandbox_mode === "read-only") return { type: "readOnly", networkAccess: false };
  return {
    type: "workspaceWrite",
    writableRoots: [path.resolve(worktreePath)],
    networkAccess: config.sandbox_workspace_write.network_access,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

function approvalPolicy(config: MainCodexAgentConfig): "never" | "onRequest" {
  return config.approval_policy === "never" ? "never" : "onRequest";
}

function appServerSandbox(config: MainCodexAgentConfig): "dangerFullAccess" | "readOnly" | "workspaceWrite" {
  if (config.sandbox_mode === "danger-full-access") return "dangerFullAccess";
  return config.sandbox_mode === "read-only" ? "readOnly" : "workspaceWrite";
}

function mappedStatus(value: unknown): unknown {
  return value === "inProgress" ? "in_progress" : value;
}

function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.flatMap((entry) => typeof entry === "string" ? [entry] : []).join("\n");
  return "";
}

/** Keep the existing Run Inspector contract while app-server becomes the transport. */
function mapAppServerItem(item: unknown): unknown {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  const source = item as Record<string, unknown>;
  const common = { ...source, status: mappedStatus(source.status) };
  switch (source.type) {
    case "agentMessage": return { ...common, type: "agent_message" };
    case "reasoning": return { ...common, type: "reasoning", text: textContent(source.summary) || textContent(source.content) };
    case "commandExecution": return { ...common, type: "command_execution", aggregated_output: source.aggregatedOutput,
      exit_code: source.exitCode };
    case "fileChange": return { ...common, type: "file_change" };
    case "mcpToolCall": return { ...common, type: "mcp_tool_call" };
    case "webSearch": return { ...common, type: "web_search" };
    case "collabToolCall": return { ...common, type: "collab_tool_call", sender_thread_id: source.senderThreadId,
      receiver_thread_id: source.receiverThreadId, new_thread_id: source.newThreadId };
    default: return common;
  }
}

async function gitReadOnlyRoots(worktreePath: string): Promise<string[]> {
  const dotGit = path.join(worktreePath, ".git");
  try {
    const info = await fs.stat(dotGit);
    if (info.isDirectory()) return [await fs.realpath(dotGit)];
    if (!info.isFile()) return [];
    const pointer = await fs.readFile(dotGit, "utf8");
    const match = pointer.match(/^gitdir:\s*(.+)\s*$/m);
    if (!match) return [];
    const gitDirectory = await fs.realpath(path.resolve(worktreePath, match[1]));
    try {
      const common = (await fs.readFile(path.join(gitDirectory, "commondir"), "utf8")).trim();
      return [await fs.realpath(path.resolve(gitDirectory, common))];
    } catch {
      return [gitDirectory];
    }
  } catch {
    return [];
  }
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
export async function verifyExitedProcessTree(pid: number): Promise<void> {
  if (process.platform === "win32") {
    // Toolhelp retains the original PPID after the parent exits, including detached children.
    if (descendants(await windowsProcesses(), pid).length > 0) {
      throw new Error("The process exited but descendant processes may still be running; queue must remain blocked.");
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
  throw new Error("The process exited but its process group still exists; queue must remain blocked.");
}

/** Retain descendants across parent exit; do not cancel force escalation when the parent closes. */
export async function terminateProcessTree(pid: number, graceMs: number, forceEvent: () => void): Promise<void> {
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
    throw new Error("The process group still exists after termination; queue must remain blocked.");
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
    throw new Error("Some child processes could not be terminated; keep the worktree for recovery.");
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
  const readableRoots = [
    ...(await gitReadOnlyRoots(options.worktreePath)),
    ...(options.pythonRuntime?.readableRoots ?? []),
  ];
  const permissionProfile = options.pythonRuntime?.readableRoots.length
    ? buildCodexPermissionProfile(options.config, readableRoots)
    : null;
  const sandboxPolicy = buildCodexSandboxPolicy(options.config, options.worktreePath);
  const args = buildCodexAppServerArgs(options.config, permissionProfile);
  // Git invoked by the agent must resolve its worktree from cwd, never an inherited checkout/index.
  const env = options.pythonRuntime ? withPythonRuntimeEnvironment(runGitEnvironment(), options.pythonRuntime) : runGitEnvironment();
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
    let threadId: string | null = null;
    let turnId: string | null = null;
    let turnFinished = false;
    const items = new Map<string, Record<string, unknown>>();
    const stdoutLines = createInterface({ input: child.stdout });
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
      if (threadId && turnId && child.stdin.writable) {
        try {
          child.stdin.write(`${JSON.stringify({ method: "turn/interrupt", id: 99, params: { threadId, turnId } })}\n`);
        } catch { /* Process-tree termination remains authoritative. */ }
      }
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
    const send = (message: unknown) => {
      if (!child.stdin.writable || termination) return;
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    const mappedEvent = (type: string, item?: unknown, extra?: Record<string, unknown>) => {
      const event = { type, ...(item === undefined ? {} : { item: mapAppServerItem(item) }), ...(extra ?? {}) };
      emit({ type: "codex", event });
      return event;
    };
    const respondToServerRequest = (message: { id: number; method: string }) => {
      if (message.method === "item/commandExecution/requestApproval" || message.method === "item/fileChange/requestApproval") {
        result.error ??= "Codex requested interactive approval, which AgentTasker cannot grant during a non-interactive Run.";
        send({ id: message.id, result: { decision: "decline" } });
      } else if (message.method === "item/permissions/requestApproval") {
        send({ id: message.id, result: { permissions: [], scope: "turn" } });
      } else if (message.method === "mcpServer/elicitation/request") {
        send({ id: message.id, result: { action: "decline", content: null } });
      } else {
        send({ id: message.id, error: { code: -32601, message: "AgentTasker does not provide this interactive capability." } });
      }
    };
    const parseLine = (line: string) => {
      if (!line.trim()) return;
      if (line.length > MAX_EVENT_LINE) {
        result.error = "Codex app-server emitted an oversized JSON message.";
        stop("error");
        return;
      }
      emit({ type: "stdout", text: `${line}\n` });
      let parsed: unknown;
      try { parsed = JSON.parse(line); } catch { return; }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      const message = parsed as { id?: number; method?: string; params?: Record<string, unknown>;
        result?: Record<string, unknown>; error?: { message?: string } };
      if (typeof message.id === "number" && typeof message.method === "string") {
        respondToServerRequest({ id: message.id, method: message.method });
        return;
      }
      if (message.error?.message) {
        result.error = message.error.message;
        stop("error");
        return;
      }
      if (message.id === 1) {
        send({ method: "initialized", params: {} });
        send({ method: "thread/start", id: 2, params: {
          ...(options.config.model ? { model: options.config.model } : {}),
          cwd: options.worktreePath,
          approvalPolicy: approvalPolicy(options.config),
          ...(permissionProfile ? { permissions: permissionProfile.id } : { sandbox: appServerSandbox(options.config) }),
          runtimeWorkspaceRoots: [options.worktreePath],
          serviceName: "agenttasker",
        } });
        return;
      }
      if (message.id === 2) {
        const thread = message.result?.thread as { id?: unknown } | undefined;
        if (typeof thread?.id !== "string") {
          result.error = "Codex app-server did not return a thread ID.";
          stop("error");
          return;
        }
        threadId = thread.id;
        send({ method: "turn/start", id: 3, params: {
          threadId,
          input: [{ type: "text", text: options.prompt }],
          cwd: options.worktreePath,
          approvalPolicy: approvalPolicy(options.config),
          ...(permissionProfile ? { permissions: permissionProfile.id } : { sandboxPolicy }),
          runtimeWorkspaceRoots: [options.worktreePath],
          ...(options.config.model ? { model: options.config.model } : {}),
          effort: options.config.model_reasoning_effort,
          summary: options.config.model_reasoning_summary,
          outputSchema: CODEX_RUN_OUTPUT_SCHEMA,
        } });
        return;
      }
      if (message.id === 3) {
        const turn = message.result?.turn as { id?: unknown } | undefined;
        if (typeof turn?.id === "string") turnId = turn.id;
        return;
      }
      if (!message.method) return;
      const params = message.params ?? {};
      if (message.method === "thread/started") {
        const thread = params.thread as { id?: unknown } | undefined;
        mappedEvent("thread.started", undefined, { thread_id: typeof thread?.id === "string" ? thread.id : threadId });
      } else if (message.method === "turn/started") {
        const turn = params.turn as { id?: unknown } | undefined;
        if (typeof turn?.id === "string") turnId = turn.id;
        mappedEvent("turn.started");
      } else if (message.method === "item/started" || message.method === "item/completed") {
        const item = params.item;
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const record = item as Record<string, unknown>;
          if (typeof record.id === "string") items.set(record.id, record);
          if (message.method === "item/completed" && record.type === "agentMessage" && typeof record.text === "string" && record.phase !== "commentary") {
            result.lastAgentMessage = record.text;
          }
        }
        mappedEvent(message.method === "item/started" ? "item.started" : "item.completed", item);
      } else if (message.method === "item/commandExecution/outputDelta") {
        const itemId = typeof params.itemId === "string" ? params.itemId : null;
        const delta = typeof params.delta === "string" ? params.delta : "";
        const current = itemId ? items.get(itemId) : undefined;
        if (itemId && current) {
          const updated = { ...current, aggregatedOutput: `${typeof current.aggregatedOutput === "string" ? current.aggregatedOutput : ""}${delta}` };
          items.set(itemId, updated);
          mappedEvent("item.updated", updated);
        }
      } else if (message.method === "turn/completed") {
        const turn = params.turn as { status?: unknown; error?: { message?: unknown }; usage?: unknown } | undefined;
        turnFinished = true;
        if (turn?.status === "failed") {
          const detail = typeof turn.error?.message === "string" ? turn.error.message : "Codex turn failed.";
          result.error ??= detail;
          mappedEvent("turn.failed", undefined, { error: { message: detail } });
        } else {
          mappedEvent("turn.completed", undefined, { usage: turn?.usage });
          if (turn?.status === "interrupted" && !result.cancelled && !result.timedOut) result.error ??= "Codex turn was interrupted.";
        }
        child.stdin.end();
      } else if (message.method === "error") {
        const error = params.error as { message?: unknown } | undefined;
        const detail = typeof error?.message === "string" ? error.message : "Codex reported an execution error.";
        result.error ??= detail;
        mappedEvent("error", undefined, { message: detail });
      } else {
        mappedEvent(message.method, undefined, params);
      }
    };
    const abort = () => stop("cancelled");
    const timer = setTimeout(() => stop("timeout"), options.timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    stdoutLines.on("line", parseLine);
    child.stderr.on("data", (chunk: Buffer) => {
      const text = stderrDecoder.write(chunk);
      if (text) emit({ type: "stderr", text });
    });
    child.stdin.on("error", (error) => {
      if (!finishing && !turnFinished) {
        result.error = `Could not communicate with Codex app-server: ${error.message}`;
        stop("error");
      }
    });
    child.on("spawn", () => {
      result.pid = child.pid ?? null;
      result.terminationVerified = false;
      if (child.pid) emit({ type: "started", pid: child.pid });
      if (options.signal?.aborted) stop("cancelled");
      if (!termination) send({ method: "initialize", id: 1, params: {
        clientInfo: { name: "agenttasker", title: "AgentTasker", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      } });
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
      stdoutLines.close();
      const tail = stderrDecoder.end();
      if (tail) emit({ type: "stderr", text: tail });
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
        result.error = `Codex app-server exited with ${signal ? `signal ${signal}` : `code ${exitCode ?? "unknown"}`}.`;
      } else if (!turnFinished && !result.error && !result.cancelled && !result.timedOut) {
        result.error = "Codex app-server exited before the turn completed.";
      }
      resolve(result);
    });
    // Cover a cancellation occurring between the initial check and listener registration.
    if (options.signal?.aborted) stop("cancelled");
  });
}
