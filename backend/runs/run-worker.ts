import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, sqlite } from "../../db/client";
import { runnerLock, type Run } from "../../db/schema";
import { projectService } from "../projects/project.service";
import { taskService } from "../tasks/task.service";
import { readInteger, readString, sectionContent } from "../tasks/toml";
import { agentsService } from "../tasker/agents.service";
import { runCodex, CODEX_RUN_OUTPUT_SCHEMA } from "../codex/codex-runner";
import { prepareRunWorktree, finalizeRunWorktree, inspectRunChanges, cleanupSuccessfulWorktree,
  type RunWorktree } from "../git/run-git.service";
import { evaluateSchedules } from "../scheduler/scheduler.service";
import { RUNNER_CONFIG } from "./runner-config";
import { runRepository } from "./run.repository";

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

export async function executeRun(run: Run, controller = new AbortController()) {
  let worktree: RunWorktree | undefined;
  const event = (type: string, message: string, raw?: string) => runRepository.event(run.id, type, message, raw);
  const cancellation = setInterval(() => {
    if (runRepository.get(run.projectId, run.id).cancelRequested) controller.abort();
  }, 500);
  try {
    event("status", "Preparing isolated worktree");
    const project = await projectService.getProjectById(run.projectId);
    if (!project.repositoryPath) throw new Error("Configure the project repository in Settings first.");
    const task = await taskService.get(run.projectId, run.taskId);
    const projectToml = readProjectFile(project.repositoryPath, ".tasker/project.toml");
    const git = sectionContent(projectToml, "git");
    const baseBranch = readString(git, "base_branch");
    if (!baseBranch) throw new Error("Configure a base branch in .tasker/project.toml.");
    const remote = readString(git, "remote") || "origin";
    readProjectFile(project.repositoryPath, ".tasker/agents/main.toml");
    const { main } = await agentsService.getAgents(run.projectId);
    const projectInstructions = readProjectFile(project.repositoryPath, ".tasker/instructions.md");
    const timeoutMinutes = readInteger(sectionContent(projectToml, "execution"), "default_timeout_minutes");
    const timeoutMs = timeoutMinutes && timeoutMinutes > 0 ? timeoutMinutes * 60_000 : RUNNER_CONFIG.timeoutMs;
    const prompt = `# Project Instructions\n\n${projectInstructions}\n\n# Task: ${task.name}\n\n${task.instructions}\n\n# Execution constraints\nWork only in the provided worktree. Do not change another checkout, switch branches, commit, push, merge, or remove the worktree. AgentTasker owns Git finalization. Report a truthful final result and any blocking error.\n`;
    runRepository.update(run.id, { baseRemote: remote, baseBranch,
      resolvedConfig: JSON.stringify({ codex: main, timeoutMs, expectChanges: task.expectChanges }) });
    controller.signal.throwIfAborted();
    worktree = await prepareRunWorktree({ repoPath: project.repositoryPath,
      worktreesRoot: path.join(RUNNER_CONFIG.dataDirectory, "worktrees"), runId: run.id,
      taskId: run.taskId, remote, baseBranch, signal: controller.signal,
      onPrepared: (prepared) => { runRepository.update(run.id, { baseCommit: prepared.baseCommit,
        runBranch: prepared.branch, worktreePath: prepared.worktreePath }); },
    });
    runRepository.update(run.id, { status: "RUNNING", baseCommit: worktree.baseCommit,
      runBranch: worktree.branch, worktreePath: worktree.worktreePath });
    event("status", `Starting Codex (${main.model || "Codex default"}) in ${worktree.worktreePath}`);
    const outputSchemaPath = path.join(RUNNER_CONFIG.dataDirectory, "run-output.schema.json");
    fs.writeFileSync(outputSchemaPath, JSON.stringify(CODEX_RUN_OUTPUT_SCHEMA));
    // Persist before spawn: a server crash must never certify unknown descendants as stopped.
    runRepository.update(run.id, { terminationVerified: false });
    const result = await runCodex({ worktreePath: worktree.worktreePath, prompt, config: main, outputSchemaPath,
      timeoutMs, signal: controller.signal, onEvent: (entry) => {
        if (entry.type === "started") runRepository.update(run.id, { codexPid: entry.pid, terminationVerified: false });
        if (entry.type === "stdout" || entry.type === "stderr") event(entry.type, entry.text);
        else if (entry.type === "codex") event("codex", JSON.stringify(entry.event), JSON.stringify(entry.event));
        else event(entry.type, JSON.stringify(entry));
      } });
    runRepository.update(run.id, { codexPid: result.terminationVerified ? null : result.pid,
      terminationVerified: result.terminationVerified, exitCode: result.exitCode, result: result.lastAgentMessage });
    const cancelled = runRepository.get(run.projectId, run.id).cancelRequested;
    if (cancelled || result.cancelled || result.timedOut || result.exitCode !== 0 || result.error) {
      throw new Error(result.error || (cancelled ? "Run cancelled." : result.timedOut ? "Codex timed out." : "Codex did not complete successfully."));
    }
    runRepository.update(run.id, { status: "VALIDATING" });
    event("status", "Validating Git changes and committing the run branch");
    const gitResult = await finalizeRunWorktree(worktree, { exitCode: result.exitCode,
      validationsSucceeded: true, expectChanges: task.expectChanges, commit: true,
      commitMessage: `task(${task.id}): run ${run.id}`, signal: controller.signal });
    runRepository.update(run.id, { diff: `${gitResult.status}\n${gitResult.diff}`, commitHash: gitResult.commitSha });
    if (!gitResult.success) throw new Error(gitResult.error || "Git validation failed.");
    if (runRepository.get(run.projectId, run.id).cancelRequested) throw new Error("Run cancelled; any completed commit is preserved.");
    const cleanup = await cleanupSuccessfulWorktree(worktree, gitResult).catch(error => ({ removed: false, reason: String(error) }));
    event("cleanup", cleanup.removed ? "Clean worktree removed; run branch and commit retained." : `Worktree preserved: ${cleanup.reason}`);
    const completed = runRepository.completeSuccess(run.projectId, run.id);
    if (completed.status === "CANCELLED") {
      event("status", "Cancelled after validation; committed work remains on the run branch.");
      return;
    }
    event("status", "Success");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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

export function createRunner() {
  const token = randomUUID();
  let busy = false;
  let stopping = false;
  let owned = false;
  let current: AbortController | undefined;
  let execution: Promise<void> | undefined;
  let lastErrors = "";
  const tickWaiters: Array<() => void> = [];
  const acquire = () => sqlite.transaction(() => {
    const lock = db.select().from(runnerLock).where(eq(runnerLock.id, 1)).get();
    if (lock?.token === token) return true;
    if (lock && alive(lock.ownerPid)) return false;
    db.insert(runnerLock).values({ id: 1, ownerPid: process.pid, token }).onConflictDoUpdate({
      target: runnerLock.id, set: { ownerPid: process.pid, token } }).run();
    return true;
  }).immediate();
  const release = () => db.delete(runnerLock).where(and(eq(runnerLock.id, 1), eq(runnerLock.token, token))).run();
  const tick = async () => {
    if (busy || stopping) return;
    busy = true;
    try {
      if (!acquire()) return;
      if (!owned) { owned = true; console.info("[AgentTasker] Scheduler and single worker started."); }
      // A killed server may leave Codex alive. Never start another agent or blindly kill a reused PID.
      for (const interrupted of execution ? [] : runRepository.active()) {
        if (interrupted.codexPid && alive(interrupted.codexPid)) {
          const message = "Previous server stopped while Codex may still be alive. Queue paused until that process exits; worktree preserved.";
          if (interrupted.error !== message) {
            runRepository.update(interrupted.id, { error: message });
            runRepository.event(interrupted.id, "recovery", message);
          }
          return;
        }
        runRepository.update(interrupted.id, { status: interrupted.cancelRequested ? "CANCELLED" : "FAILED",
          error: interrupted.terminationVerified ? "Server stopped before this run completed. Worktree and logs preserved."
            : "Server stopped before process termination was verified. Queue blocked pending local recovery; worktree and logs preserved.", codexPid: null,
          completedAt: new Date().toISOString() });
        runRepository.event(interrupted.id, "recovery", "Interrupted run recovered; preserved worktree for inspection.");
      }
      if (!execution && runRepository.hasUnverifiedTermination()) return;
      const errors = (await evaluateSchedules()).join("\n");
      if (errors !== lastErrors) { lastErrors = errors; if (errors) console.warn("[AgentTasker] Schedule errors:\n" + errors); }
      if (stopping) return;
      const run = execution ? undefined : runRepository.claim();
      if (run) {
        current = new AbortController();
        execution = executeRun(run, current).catch(error => console.error("[AgentTasker] Worker error:", error))
          .finally(() => { current = undefined; execution = undefined; if (stopping) release(); });
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
  void tick();
  return { tick, async stop() {
    stopping = true; clearInterval(timer); current?.abort();
    if (busy) await new Promise<void>(resolve => tickWaiters.push(resolve));
    await execution; release();
  } };
}

const globalRunner = globalThis as typeof globalThis & { agentTaskerRunner?: ReturnType<typeof createRunner> };
export function startRunner() {
  if (!globalRunner.agentTaskerRunner) {
    globalRunner.agentTaskerRunner = createRunner();
    process.once("SIGTERM", () => globalRunner.agentTaskerRunner?.stop());
    process.once("SIGINT", () => globalRunner.agentTaskerRunner?.stop());
  }
  return globalRunner.agentTaskerRunner;
}
