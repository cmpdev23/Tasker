import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, sqlite } from "../../db/client";
import { runnerLock, type Run } from "../../db/schema";
import type { ProjectCommandReport } from "../../src/types/project-command";
import type { ProjectProcessEnvironment } from "../../src/types/project-execution";
import { projectService } from "../projects/project.service";
import { taskService } from "../tasks/task.service";
import { readString, sectionContent } from "../tasks/toml";
import { agentsService } from "../tasker/agents.service";
import { parseProjectExecutionSettings } from "../tasker/project-execution";
import { parseProjectGitSettings } from "../tasker/project-git";
import { runCodex, CODEX_RUN_OUTPUT_SCHEMA, verifyExitedProcessTree } from "../codex/codex-runner";
import { prepareRunWorktree, finalizeRunWorktree, inspectRunChanges, cleanupSuccessfulWorktree,
  type RunWorktree } from "../git/run-git.service";
import { evaluateSchedules } from "../scheduler/scheduler.service";
import { RUNNER_CONFIG } from "./runner-config";
import { runRepository } from "./run.repository";
import { logRunDebug, type RunDebugDetails, type RunDebugLogger } from "./run-logger";
import {
  assertProjectExecutionRuntime,
  projectPreparationCommands,
  projectValidationCommands,
  projectExecutionRuntimeStatus,
  runProjectCommand,
  type ProjectCommand,
} from "./project-command-runner";
import { executeSequenceRun } from "../sequences/sequence-run-worker";
import { publishRunWorktree } from "../git/run-publication.service";
import { projectRuntimePreferenceService } from "./project-runtime-preference.service";
import { projectEnvironmentVariableService } from "./project-environment-variable.service";
import { createSecretRedactor } from "./secret-redactor";

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

function readProjectFile(repo: string, relative: string): string {
  const file = path.join(repo, relative);
  const real = fs.realpathSync(file);
  if (path.relative(fs.realpathSync(repo), real).startsWith("..") || fs.lstatSync(file).isSymbolicLink()) {
    throw new Error("Project configuration must stay inside the registered repository.");
  }
  return fs.readFileSync(file, "utf8");
}

async function executeTaskRun(
  run: Run,
  controller = new AbortController(),
  executeCodex = runCodex,
  publishWorktree: typeof publishRunWorktree = publishRunWorktree,
) {
  let worktree: RunWorktree | undefined;
  let projectEnvironment: ProjectProcessEnvironment = {};
  let redact = (value: string) => value;
  const event = (type: string, message: string, raw?: string) => runRepository.event(
    run.id,
    type,
    redact(message),
    raw === undefined ? undefined : redact(raw),
  );
  let pythonRuntime: ReturnType<typeof projectExecutionRuntimeStatus>["python"] | undefined;
  const executeProjectCommand = async (command: ProjectCommand, phase: "preparation" | "validation") => {
    if (!worktree) throw new Error("Project commands require a prepared worktree.");
    const display = `${command.executable} ${command.args.join(" ")}`;
    const startedAt = Date.now();
    let reported = false;
    const report = (status: ProjectCommandReport["status"], exitCode: number | null, error: string | null) => {
      const entry: ProjectCommandReport = { kind: "project-command", phase, command: display,
        status, exitCode, durationMs: status === "running" ? null : Date.now() - startedAt, error };
      event(phase, `${status === "running" ? "Starting" : status === "success" ? "Completed" : "Failed"} ${command.name}: ${display}`,
        JSON.stringify(entry));
      if (status !== "running") reported = true;
    };
    report("running", null, null);
    // Persist before spawn so a server crash never certifies an unknown child process as stopped.
    runRepository.update(run.id, { terminationVerified: false });
    try {
      const result = await runProjectCommand(command, {
        cwd: worktree.worktreePath,
        signal: controller.signal,
        pythonRuntime,
        environment: projectEnvironment,
        onEvent: (entry) => {
          if (entry.type === "started") {
            runRepository.update(run.id, { codexPid: entry.pid, terminationVerified: false });
          } else if (entry.type === "stdout" || entry.type === "stderr") {
            event(entry.type, `[${phase}] ${entry.text}`);
          } else {
            event("termination", JSON.stringify({ ...entry, command: display }));
          }
        },
      });
      runRepository.update(run.id, {
        codexPid: result.terminationVerified ? null : result.pid,
        terminationVerified: result.terminationVerified,
      });
      if (result.cancelled || result.timedOut || result.exitCode !== 0 || result.error) {
        const error = result.error || (result.cancelled
          ? `${command.name} was cancelled.`
          : result.timedOut
            ? `${command.name} timed out after ${Math.round(command.timeoutMs / 60_000)} minutes.`
            : `${command.name} failed.`);
        report(result.cancelled ? "cancelled" : result.timedOut ? "timed-out" : "failed", result.exitCode, error);
        throw new Error(error);
      }
      report("success", result.exitCode, null);
    } catch (error) {
      if (!reported) report("failed", null, error instanceof Error ? error.message : String(error));
      const current = runRepository.get(run.projectId, run.id);
      if (!current.codexPid) runRepository.update(run.id, { terminationVerified: true });
      throw error;
    }
  };
  const cancellation = setInterval(() => {
    if (runRepository.get(run.projectId, run.id).cancelRequested) controller.abort();
  }, 500);
  try {
    event("status", "Preparing isolated worktree");
    const project = await projectService.getProjectById(run.projectId);
    if (!project.repositoryPath) throw new Error("Configure the project repository in Settings first.");
    const task = await taskService.get(run.projectId, run.taskId);
    const projectToml = readProjectFile(project.repositoryPath, ".tasker/project.toml");
    const executionSettings = parseProjectExecutionSettings(projectToml);
    const localRuntime = await projectRuntimePreferenceService.get(run.projectId);
    projectEnvironment = projectEnvironmentVariableService.resolve(run.projectId);
    redact = createSecretRedactor(Object.values(projectEnvironment).filter((value): value is string => value !== undefined));
    const environmentVariableNames = Object.keys(projectEnvironment).sort();
    event("environment", environmentVariableNames.length
      ? `Configured project environment: ${environmentVariableNames.join(", ")}`
      : "No project environment variables configured.");
    const executionRuntime = projectExecutionRuntimeStatus(executionSettings, localRuntime.pythonExecutable);
    pythonRuntime = executionRuntime.python;
    event("runtime", `Python runtime: ${pythonRuntime.detail}`, JSON.stringify(pythonRuntime));
    assertProjectExecutionRuntime(executionSettings, pythonRuntime);
    const git = sectionContent(projectToml, "git");
    const gitSettings = parseProjectGitSettings(projectToml);
    const baseBranch = readString(git, "base_branch");
    if (!baseBranch) throw new Error("Configure a base branch in .tasker/project.toml.");
    const remote = gitSettings.remote;
    readProjectFile(project.repositoryPath, ".tasker/agents/main.toml");
    const { main } = await agentsService.getAgents(run.projectId);
    const projectInstructions = readProjectFile(project.repositoryPath, ".tasker/instructions.md");
    const timeoutMs = executionSettings.defaultTimeoutMinutes * 60_000;
    const preparationCommands = projectPreparationCommands(executionSettings);
    const validationCommands = projectValidationCommands(executionSettings);
    const managedCommands = [...preparationCommands, ...validationCommands]
      .map((command) => `- ${command.executable} ${command.args.join(" ")}`).join("\n") || "- None configured";
    const prompt = `# Project Instructions\n\n${projectInstructions}\n\n# Task: ${task.name}\n\n${task.instructions}\n\n# Execution constraints\nWork only in the provided worktree. Do not change another checkout, switch branches, commit, push, merge, or remove the worktree. AgentTasker owns dependency preparation, validation, and Git finalization. Do not install dependencies or run the runner-owned commands listed below. Do not report failure solely because those commands or their runtimes are unavailable inside your sandbox; AgentTasker executes them independently and decides the final Run status. Report a truthful result about the requested work and any other blocking error.\n\nRunner-owned commands:\n${managedCommands}\n`;
    runRepository.update(run.id, { baseRemote: remote, baseBranch,
      resolvedConfig: JSON.stringify({ codex: main, execution: executionSettings, python: pythonRuntime,
        localExecution: { ...localRuntime, environmentVariables: environmentVariableNames }, git: gitSettings,
        timeoutMs, expectChanges: task.expectChanges }) });
    controller.signal.throwIfAborted();
    worktree = await prepareRunWorktree({ repoPath: project.repositoryPath,
      worktreesRoot: path.join(RUNNER_CONFIG.dataDirectory, "worktrees"), runId: run.id,
      taskId: run.taskId, remote, baseBranch, signal: controller.signal,
      onPrepared: (prepared) => { runRepository.update(run.id, { baseCommit: prepared.baseCommit,
        runBranch: prepared.branch, worktreePath: prepared.worktreePath }); },
    });
    for (const command of preparationCommands) {
      controller.signal.throwIfAborted();
      await executeProjectCommand(command, "preparation");
    }
    runRepository.update(run.id, { status: "RUNNING", baseCommit: worktree.baseCommit,
      runBranch: worktree.branch, worktreePath: worktree.worktreePath });
    event("status", `Starting Codex (${main.model || "Codex default"}) in ${worktree.worktreePath}`);
    const outputSchemaPath = path.join(RUNNER_CONFIG.dataDirectory, "run-output.schema.json");
    fs.writeFileSync(outputSchemaPath, JSON.stringify(CODEX_RUN_OUTPUT_SCHEMA));
    // Persist before spawn: a server crash must never certify unknown descendants as stopped.
    runRepository.update(run.id, { terminationVerified: false });
    const result = await executeCodex({ worktreePath: worktree.worktreePath, prompt, config: main, outputSchemaPath,
      timeoutMs, signal: controller.signal, pythonRuntime, environment: projectEnvironment, onEvent: (entry) => {
        if (entry.type === "started") runRepository.update(run.id, { codexPid: entry.pid, terminationVerified: false });
        if (entry.type === "stdout" || entry.type === "stderr") event(entry.type, entry.text);
        else if (entry.type === "codex") event("codex", JSON.stringify(entry.event), JSON.stringify(entry.event));
        else event(entry.type, JSON.stringify(entry));
      } });
    runRepository.update(run.id, { codexPid: result.terminationVerified ? null : result.pid,
      terminationVerified: result.terminationVerified, exitCode: result.exitCode,
      result: result.lastAgentMessage === null ? null : redact(result.lastAgentMessage) });
    const cancelled = runRepository.get(run.projectId, run.id).cancelRequested;
    if (cancelled || result.cancelled || result.timedOut || result.exitCode !== 0 || result.error) {
      throw new Error(result.error || (cancelled ? "Run cancelled." : result.timedOut ? "Codex timed out." : "Codex did not complete successfully."));
    }
    runRepository.update(run.id, { status: "VALIDATING" });
    event("status", "Running configured validations");
    for (const command of validationCommands) {
      controller.signal.throwIfAborted();
      await executeProjectCommand(command, "validation");
    }
    event("status", "Validating Git changes and committing the run branch");
    const gitResult = await finalizeRunWorktree(worktree, { exitCode: result.exitCode,
      validationsSucceeded: true, expectChanges: task.expectChanges, commit: true,
      commitMessage: `task(${task.id}): run ${run.id}`, signal: controller.signal });
    runRepository.update(run.id, { diff: `${gitResult.status}\n${gitResult.diff}`, commitHash: gitResult.commitSha });
    if (!gitResult.success) throw new Error(gitResult.error || "Git validation failed.");
    if (runRepository.get(run.projectId, run.id).cancelRequested) throw new Error("Run cancelled; any completed commit is preserved.");
    const publication = await publishWorktree(worktree, {
      settings: gitSettings,
      expectedHead: gitResult.commitSha,
      title: `task(${task.id}): ${task.name}`,
      body: `## AgentTasker Run\n\n- **Task:** ${task.name} (\`${task.id}\`)\n- **Run:** \`${run.id}\`\n- **Base:** \`${remote}/${baseBranch}\` at \`${worktree.baseCommit}\`\n- **Branch:** \`${worktree.branch}\`\n- **Commit:** \`${gitResult.commitSha ?? "none"}\`\n- **Validations:** ${validationCommands.length ? validationCommands.map((command) => `\`${command.name}\``).join(", ") : "No Project command configured"}\n\n### Agent summary\n\n${redact(result.agentResult?.summary ?? result.lastAgentMessage ?? "Run completed successfully.").slice(0, 4_000)}\n\n> Created by AgentTasker. Human review and merge remain required.`,
      signal: controller.signal,
      onEvent: (entry) => {
        event("publication", entry.message, JSON.stringify({ kind: "run-publication", ...entry }));
        if (entry.stage === "push" && entry.status === "success") {
          runRepository.update(run.id, { pushedAt: new Date().toISOString() });
        }
        if (entry.pullRequestUrl) runRepository.update(run.id, { pullRequestUrl: entry.pullRequestUrl });
      },
    });
    runRepository.update(run.id, { pushedAt: publication.pushedAt, pullRequestUrl: publication.pullRequestUrl });
    const cleanup = await cleanupSuccessfulWorktree(worktree, gitResult).catch(error => ({ removed: false, reason: String(error) }));
    event("cleanup", cleanup.removed ? "Clean worktree removed; run branch and commit retained." : `Worktree preserved: ${cleanup.reason}`);
    const completed = runRepository.completeSuccess(run.projectId, run.id);
    if (completed.status === "CANCELLED") {
      event("status", "Cancelled after validation; committed work remains on the run branch.");
      return;
    }
    event("status", "Success");
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error));
    if (worktree) {
      try {
        const changes = await inspectRunChanges(worktree);
        runRepository.update(run.id, { diff: `${changes.status}\n${changes.diff}` });
      } catch { /* Preserve the worktree even if Git inspection itself failed. */ }
    }
    const cancelled = runRepository.get(run.projectId, run.id).cancelRequested;
    runRepository.update(run.id, { status: cancelled ? "CANCELLED" : "FAILED", error: message,
      completedAt: new Date().toISOString() });
    event("status", `${cancelled ? "Cancelled" : "Failed"}: ${message}. Existing worktree and branch preserved.`);
  } finally { clearInterval(cancellation); }
}

export async function executeRun(
  run: Run,
  controller = new AbortController(),
  executeCodex = runCodex,
  publishWorktree: typeof publishRunWorktree = publishRunWorktree,
) {
  return run.kind === "SEQUENCE"
    ? executeSequenceRun(run, controller, executeCodex, publishWorktree)
    : executeTaskRun(run, controller, executeCodex, publishWorktree);
}

export function createRunner(options: { debug?: RunDebugLogger } = {}) {
  const token = randomUUID();
  const debug = options.debug ?? logRunDebug;
  let busy = false;
  let stopping = false;
  let owned = false;
  let current: AbortController | undefined;
  let execution: Promise<void> | undefined;
  let currentRun: Pick<Run, "id" | "projectId" | "taskId"> | undefined;
  let lastErrors = "";
  let lastState = "";
  const tickWaiters: Array<() => void> = [];
  const state = (event: string, details: RunDebugDetails) => {
    const nextState = JSON.stringify({ event, ...details });
    if (nextState === lastState) return;
    lastState = nextState;
    debug(event, details);
  };
  const acquire = () => sqlite.transaction(() => {
    const lock = db.select().from(runnerLock).where(eq(runnerLock.id, 1)).get();
    if (lock?.token === token) return { acquired: true, reclaimedOwnerPid: null };
    if (lock && alive(lock.ownerPid)) {
      return { acquired: false, ownerPid: lock.ownerPid, reclaimedOwnerPid: null };
    }
    db.insert(runnerLock).values({ id: 1, ownerPid: process.pid, token }).onConflictDoUpdate({
      target: runnerLock.id, set: { ownerPid: process.pid, token } }).run();
    return { acquired: true, reclaimedOwnerPid: lock?.ownerPid ?? null };
  }).immediate();
  const release = () => db.delete(runnerLock).where(and(eq(runnerLock.id, 1), eq(runnerLock.token, token))).run();
  const tick = async () => {
    if (busy || stopping) return;
    busy = true;
    try {
      const lock = acquire();
      if (!lock.acquired) {
        state("queue-blocked-runner-lock", { ownerPid: lock.ownerPid, contenderPid: process.pid });
        return;
      }
      if (!owned) {
        owned = true;
        debug("runner-started", { ownerPid: process.pid, reclaimedOwnerPid: lock.reclaimedOwnerPid });
      }
      // A killed server may leave its active subprocess alive. Never start another Run or blindly kill a reused PID.
      for (const interrupted of execution ? [] : runRepository.active()) {
        if (interrupted.codexPid) {
          try {
            // A dead root can still have detached descendants. The platform-specific verifier
            // checks the complete process tree/group before certifying a queue restart.
            await verifyExitedProcessTree(interrupted.codexPid);
          } catch {
            const message = "Previous server stopped while a Run subprocess may still be alive. Queue paused until that process exits; worktree preserved.";
            if (interrupted.error !== message) {
              runRepository.update(interrupted.id, { error: message });
              runRepository.event(interrupted.id, "recovery", message);
            }
            state("queue-blocked-active-process", {
              runId: interrupted.id,
              projectId: interrupted.projectId,
              taskId: interrupted.taskId,
              status: interrupted.status,
              processPid: interrupted.codexPid,
            });
            return;
          }
        }
        const terminationVerified = interrupted.terminationVerified || interrupted.codexPid !== null;
        runRepository.update(interrupted.id, { status: interrupted.cancelRequested ? "CANCELLED" : "FAILED",
          error: terminationVerified ? "Server stopped before this run completed. Worktree and logs preserved."
            : "Server stopped before process termination was verified. Queue blocked pending local recovery; worktree and logs preserved.", codexPid: null,
          terminationVerified,
          completedAt: new Date().toISOString() });
        runRepository.event(interrupted.id, "recovery", terminationVerified
          ? "Interrupted run process tree verified stopped; queue resumed. Worktree preserved for inspection."
          : "Interrupted run recovered; preserved worktree for inspection.");
        if (interrupted.kind === "SEQUENCE") {
          const { sequenceRunRepository } = await import("../sequences/sequence-run.repository");
          sequenceRunRepository.stopRemaining(interrupted.id, interrupted.cancelRequested ? "CANCELLED" : "SKIPPED",
            "The AgentTasker server stopped before the Sequence completed.");
        }
        debug("interrupted-run-recovered", {
          runId: interrupted.id,
          projectId: interrupted.projectId,
          taskId: interrupted.taskId,
          status: interrupted.cancelRequested ? "CANCELLED" : "FAILED",
          terminationVerified,
        });
      }
      if (!execution) {
        const blocker = runRepository.unverifiedTermination();
        if (blocker) {
          state("queue-blocked-unverified-termination", {
            runId: blocker.id,
            projectId: blocker.projectId,
            taskId: blocker.taskId,
            status: blocker.status,
            processPid: blocker.codexPid,
            terminationVerified: blocker.terminationVerified,
          });
          return;
        }
      }
      const errors = (await evaluateSchedules()).join("\n");
      if (errors !== lastErrors) { lastErrors = errors; if (errors) console.warn("[AgentTasker] Schedule errors:\n" + errors); }
      if (stopping) return;
      if (execution) {
        state("run-executing", {
          runId: currentRun?.id,
          projectId: currentRun?.projectId,
          taskId: currentRun?.taskId,
        });
        return;
      }
      const run = runRepository.claim();
      if (run) {
        currentRun = { id: run.id, projectId: run.projectId, taskId: run.taskId };
        state("run-claimed", {
          runId: run.id,
          projectId: run.projectId,
          taskId: run.taskId,
          queuedAt: run.queuedAt,
          startedAt: run.startedAt,
        });
        current = new AbortController();
        execution = executeRun(run, current).catch(error => console.error("[AgentTasker] Worker error:", error))
          .finally(() => {
            try {
              const completed = runRepository.get(run.projectId, run.id);
              debug("run-finished", {
                runId: completed.id,
                projectId: completed.projectId,
                taskId: completed.taskId,
                status: completed.status,
                terminationVerified: completed.terminationVerified,
              });
            } catch (error) {
              console.error("[AgentTasker] Failed to read completed Run for diagnostics:", error);
            } finally {
              current = undefined;
              currentRun = undefined;
              execution = undefined;
              if (stopping) release();
            }
          });
      } else {
        state("queue-idle", { ownerPid: process.pid });
      }
    } catch (error) { console.error("[AgentTasker] Runner error:", error); }
    finally {
      busy = false;
      if (stopping && !execution) release();
      for (const resolve of tickWaiters.splice(0)) resolve();
    }
  };
  const timer = setInterval(() => void tick(), RUNNER_CONFIG.tickMs);
  timer.unref();
  debug("runner-created", { ownerPid: process.pid, tickMs: RUNNER_CONFIG.tickMs });
  void tick();
  return { tick, async stop() {
    debug("runner-stopping", { ownerPid: process.pid, activeRunId: currentRun?.id });
    stopping = true; clearInterval(timer); current?.abort();
    if (busy) await new Promise<void>(resolve => tickWaiters.push(resolve));
    await execution; release();
    debug("runner-stopped", { ownerPid: process.pid });
  } };
}

const globalRunner = globalThis as typeof globalThis & { agentTaskerRunner?: ReturnType<typeof createRunner> };
export function startRunner() {
  if (!globalRunner.agentTaskerRunner) {
    globalRunner.agentTaskerRunner = createRunner();
    process.once("SIGTERM", () => globalRunner.agentTaskerRunner?.stop());
    process.once("SIGINT", () => globalRunner.agentTaskerRunner?.stop());
  } else {
    logRunDebug("runner-reused", { ownerPid: process.pid });
  }
  return globalRunner.agentTaskerRunner;
}
