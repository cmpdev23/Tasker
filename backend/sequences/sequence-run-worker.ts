import fs from "node:fs";
import path from "node:path";
import type { Run } from "../../db/schema";
import type { ProjectCommandReport } from "../../src/types/project-command";
import type { ProjectProcessEnvironment } from "../../src/types/project-execution";
import type { SequenceStepDefinition } from "../../src/types/sequences";
import { runCodex, CODEX_RUN_OUTPUT_SCHEMA } from "../codex/codex-runner";
import { agentsService } from "../tasker/agents.service";
import { parseProjectExecutionSettings } from "../tasker/project-execution";
import { parseProjectGitSettings } from "../tasker/project-git";
import { projectService } from "../projects/project.service";
import { readString, sectionContent } from "../tasks/toml";
import {
  cleanupSuccessfulWorktree,
  finalizeRunWorktree,
  inspectRunChanges,
  prepareRunWorktree,
  type RunGitResult,
  type RunWorktree,
} from "../git/run-git.service";
import {
  assertProjectExecutionRuntime,
  projectPreparationCommands,
  projectValidationCommands,
  projectExecutionRuntimeStatus,
  runProjectCommand,
  type ProjectCommand,
} from "../runs/project-command-runner";
import { RUNNER_CONFIG } from "../runs/runner-config";
import { runRepository } from "../runs/run.repository";
import { sequenceRunRepository } from "./sequence-run.repository";
import { sequenceService } from "./sequence.service";
import { publishRunWorktree } from "../git/run-publication.service";
import { projectRuntimePreferenceService } from "../runs/project-runtime-preference.service";
import { projectEnvironmentVariableService } from "../runs/project-environment-variable.service";
import { createSecretRedactor } from "../runs/secret-redactor";

function readProjectFile(repo: string, relative: string): string {
  const file = path.join(repo, relative);
  const real = fs.realpathSync(file);
  if (path.relative(fs.realpathSync(repo), real).startsWith("..") || fs.lstatSync(file).isSymbolicLink()) {
    throw new Error("Project configuration must stay inside the registered repository.");
  }
  return fs.readFileSync(file, "utf8");
}

function previousStepContext(outcomes: Array<{ step: SequenceStepDefinition; summary: string }>): string {
  if (!outcomes.length) return "No previous step has completed.";
  const sections = outcomes.map(({ step, summary }, index) =>
    `## ${index + 1}. ${step.name}\n${summary.slice(0, 4_000)}`);
  let content = sections.join("\n\n");
  if (content.length > 64_000) content = `Earlier summaries omitted to keep the handoff bounded.\n\n${content.slice(-64_000)}`;
  return content;
}

export async function executeSequenceRun(
  run: Run,
  controller = new AbortController(),
  executeCodex: typeof runCodex = runCodex,
  publishWorktree: typeof publishRunWorktree = publishRunWorktree,
) {
  if (run.kind !== "SEQUENCE" || !run.sequenceId) throw new Error("Expected a Sequence Run.");
  let worktree: RunWorktree | undefined;
  let activeStepId: string | null = null;
  let latestCommit: string | null = null;
  let previousPublicationBranch: string | null = null;
  let pythonRuntime: ReturnType<typeof projectExecutionRuntimeStatus>["python"] | undefined;
  let projectEnvironment: ProjectProcessEnvironment = {};
  let redact = (value: string) => value;
  const event = (type: string, message: string, raw?: string) => runRepository.event(
    run.id,
    type,
    redact(message),
    raw === undefined ? undefined : redact(raw),
  );
  const executeProjectCommand = async (command: ProjectCommand, phase: "preparation" | "validation") => {
    if (!worktree) throw new Error("Project commands require a prepared worktree.");
    const display = `${command.executable} ${command.args.join(" ")}`;
    const startedAt = Date.now();
    let reported = false;
    const report = (status: ProjectCommandReport["status"], exitCode: number | null, error: string | null) => {
      const entry: ProjectCommandReport & { sequenceStepId?: string } = {
        kind: "project-command",
        phase,
        command: display,
        status,
        exitCode,
        durationMs: status === "running" ? null : Date.now() - startedAt,
        error,
        ...(activeStepId ? { sequenceStepId: activeStepId } : {}),
      };
      event(phase, `${status === "running" ? "Starting" : status === "success" ? "Completed" : "Failed"} ${command.name}: ${display}`,
        JSON.stringify(entry));
      if (status !== "running") reported = true;
    };
    report("running", null, null);
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
            event("termination", JSON.stringify({ ...entry, command: display, sequenceStepId: activeStepId }));
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
    event("status", "Preparing Sequence and isolated worktree");
    const project = await projectService.getProjectById(run.projectId);
    if (!project.repositoryPath) throw new Error("Configure the project repository in Settings first.");
    const sequence = await sequenceService.get(run.projectId, run.sequenceId);
    if (!sequence.steps.length) throw new Error("The Sequence has no steps.");
    sequenceRunRepository.initialize(run.id, sequence);
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
    const publishEachStep = sequence.pullRequestStrategy === "after_each_step" && gitSettings.createPullRequest;
    previousPublicationBranch = baseBranch;
    readProjectFile(project.repositoryPath, ".tasker/agents/main.toml");
    const { main } = await agentsService.getAgents(run.projectId);
    const projectInstructions = readProjectFile(project.repositoryPath, ".tasker/instructions.md");
    const timeoutMs = executionSettings.defaultTimeoutMinutes * 60_000;
    const preparationCommands = projectPreparationCommands(executionSettings);
    const validationCommands = projectValidationCommands(executionSettings);
    const managedCommands = [...preparationCommands, ...validationCommands]
      .map((command) => `- ${command.executable} ${command.args.join(" ")}`).join("\n") || "- None configured";
    runRepository.update(run.id, {
      baseRemote: remote,
      baseBranch,
      resolvedConfig: JSON.stringify({
        codex: main,
        execution: executionSettings,
        python: pythonRuntime,
        localExecution: { ...localRuntime, environmentVariables: environmentVariableNames },
        git: gitSettings,
        timeoutMs,
        sequence: {
          id: sequence.id,
          name: sequence.name,
          pullRequestStrategy: sequence.pullRequestStrategy,
          steps: sequence.steps.map((step) => ({ id: step.id, name: step.name, expectChanges: step.expectChanges })),
        },
      }),
    });
    controller.signal.throwIfAborted();
    worktree = await prepareRunWorktree({
      repoPath: project.repositoryPath,
      worktreesRoot: path.join(RUNNER_CONFIG.dataDirectory, "worktrees"),
      runId: run.id,
      taskId: sequence.id,
      remote,
      baseBranch,
      signal: controller.signal,
      onPrepared: (prepared) => {
        runRepository.update(run.id, {
          baseCommit: prepared.baseCommit,
          runBranch: prepared.branch,
          worktreePath: prepared.worktreePath,
        });
      },
    });
    for (const command of preparationCommands) {
      controller.signal.throwIfAborted();
      await executeProjectCommand(command, "preparation");
    }

    const outputSchemaPath = path.join(RUNNER_CONFIG.dataDirectory, "run-output.schema.json");
    fs.writeFileSync(outputSchemaPath, JSON.stringify(CODEX_RUN_OUTPUT_SCHEMA));
    let stepBaseCommit = worktree.baseCommit;
    const outcomes: Array<{ step: SequenceStepDefinition; summary: string }> = [];

    for (let index = 0; index < sequence.steps.length; index++) {
      const step = sequence.steps[index];
      controller.signal.throwIfAborted();
      activeStepId = step.id;
      runRepository.update(run.id, { status: "RUNNING", currentStepId: step.id });
      sequenceRunRepository.update(run.id, step.id, { status: "RUNNING", startedAt: new Date().toISOString() });
      event("sequence-step", `Starting step ${index + 1} of ${sequence.steps.length}: ${step.name}`,
        JSON.stringify({ kind: "sequence-step", state: "started", stepId: step.id, stepName: step.name, position: index }));
      const prompt = `# Project Instructions\n\n${projectInstructions}\n\n# Sequence: ${sequence.name}\n\nYou are executing step ${index + 1} of ${sequence.steps.length}. This step belongs only to this Sequence and is not an AgentTasker Task.\n\n# Current Step: ${step.name}\n\n${step.instructions}\n\n# Previous Step Outcomes\n\n${previousStepContext(outcomes)}\n\nThe same isolated worktree and branch are shared by every step in this Sequence. Existing files and commits in this worktree may have been produced by previous successful steps. Treat them as the durable workflow state and continue from them.\n\n# Execution constraints\nWork only in the provided worktree. Do not change another checkout, switch branches, commit, push, merge, or remove the worktree. AgentTasker owns dependency preparation, validation, and Git finalization. Do not install dependencies or run the runner-owned commands listed below. Do not report failure solely because those commands or their runtimes are unavailable inside your sandbox; AgentTasker executes them independently and decides the final step and Sequence status. Report a truthful result about this step and any blocking error.\n\nRunner-owned commands:\n${managedCommands}\n`;
      runRepository.update(run.id, { terminationVerified: false });
      const result = await executeCodex({
        worktreePath: worktree.worktreePath,
        prompt,
        config: main,
        outputSchemaPath,
        timeoutMs,
        signal: controller.signal,
        pythonRuntime,
        environment: projectEnvironment,
        onEvent: (entry) => {
          if (entry.type === "started") runRepository.update(run.id, { codexPid: entry.pid, terminationVerified: false });
          if (entry.type === "stdout" || entry.type === "stderr") event(entry.type, entry.text);
          else if (entry.type === "codex") event("codex", JSON.stringify(entry.event), JSON.stringify(entry.event));
          else event(entry.type, JSON.stringify({ ...entry, sequenceStepId: step.id }));
        },
      });
      runRepository.update(run.id, {
        codexPid: result.terminationVerified ? null : result.pid,
        terminationVerified: result.terminationVerified,
        exitCode: result.exitCode,
        result: result.lastAgentMessage === null ? null : redact(result.lastAgentMessage),
      });
      sequenceRunRepository.update(run.id, step.id, {
        exitCode: result.exitCode,
        result: result.lastAgentMessage === null ? null : redact(result.lastAgentMessage),
      });
      const cancelled = runRepository.get(run.projectId, run.id).cancelRequested;
      if (cancelled || result.cancelled || result.timedOut || result.exitCode !== 0 || result.error) {
        throw new Error(result.error || (cancelled ? "Sequence cancelled." : result.timedOut
          ? `Step "${step.name}" timed out.` : `Step "${step.name}" did not complete successfully.`));
      }

      runRepository.update(run.id, { status: "VALIDATING" });
      sequenceRunRepository.update(run.id, step.id, { status: "VALIDATING" });
      event("sequence-step", `Validating step ${index + 1}: ${step.name}`,
        JSON.stringify({ kind: "sequence-step", state: "validating", stepId: step.id, stepName: step.name, position: index }));
      for (const command of validationCommands) {
        controller.signal.throwIfAborted();
        await executeProjectCommand(command, "validation");
      }
      const stepWorktree: RunWorktree = { ...worktree, baseCommit: stepBaseCommit };
      const gitResult = await finalizeRunWorktree(stepWorktree, {
        exitCode: result.exitCode,
        validationsSucceeded: true,
        expectChanges: step.expectChanges,
        commit: true,
        commitMessage: `sequence(${sequence.id}): step ${index + 1} ${step.id}`,
        signal: controller.signal,
      });
      if (!gitResult.success) throw new Error(gitResult.error || `Git validation failed for step "${step.name}".`);
      if (gitResult.commitSha) {
        stepBaseCommit = gitResult.commitSha;
        latestCommit = gitResult.commitSha;
      }
      if (publishEachStep && gitResult.commitSha) {
        const publicationBranch = `${worktree.branch}-step-${String(index + 1).padStart(3, "0")}-${step.id}`;
        const publication = await publishWorktree(worktree, {
          settings: gitSettings,
          expectedHead: gitResult.commitSha,
          branch: publicationBranch,
          baseBranch: previousPublicationBranch ?? baseBranch,
          title: `sequence(${sequence.id}): step ${index + 1} ${step.name}`,
          body: `## AgentTasker Sequence Step\n\n- **Sequence:** ${sequence.name} (\`${sequence.id}\`)\n- **Run:** \`${run.id}\`\n- **Step:** ${index + 1} of ${sequence.steps.length} — ${step.name} (\`${step.id}\`)\n- **Base branch:** \`${previousPublicationBranch ?? baseBranch}\`\n- **Head branch:** \`${publicationBranch}\`\n- **Commit:** \`${gitResult.commitSha}\`\n- **Validations:** ${validationCommands.length ? validationCommands.map((command) => `\`${command.name}\``).join(", ") : "No Project command configured"}\n\n### Agent summary\n\n${redact(result.agentResult?.summary ?? result.lastAgentMessage ?? "Step completed successfully.").slice(0, 4_000)}\n\n> This is a stacked Sequence step pull request. Review and merge the step pull requests in order.`,
          signal: controller.signal,
          onEvent: (entry) => {
            event("publication", `[${step.name}] ${entry.message}`,
              JSON.stringify({ kind: "run-publication", sequenceStepId: step.id, ...entry }));
            if (entry.stage === "push" && entry.status === "success") {
              const pushedAt = new Date().toISOString();
              sequenceRunRepository.update(run.id, step.id, { publicationBranch, pushedAt });
              runRepository.update(run.id, { pushedAt });
            }
            if (entry.pullRequestUrl) {
              sequenceRunRepository.update(run.id, step.id, { pullRequestUrl: entry.pullRequestUrl });
              runRepository.update(run.id, { pullRequestUrl: entry.pullRequestUrl });
            }
          },
        });
        sequenceRunRepository.update(run.id, step.id, {
          publicationBranch: publication.branch,
          pushedAt: publication.pushedAt,
          pullRequestUrl: publication.pullRequestUrl,
        });
        runRepository.update(run.id, {
          pushedAt: publication.pushedAt,
          pullRequestUrl: publication.pullRequestUrl,
        });
        previousPublicationBranch = publication.branch ?? previousPublicationBranch;
      }
      sequenceRunRepository.update(run.id, step.id, {
        status: "SUCCESS",
        completedAt: new Date().toISOString(),
        error: null,
        commitHash: gitResult.commitSha,
        diff: `${gitResult.status}\n${gitResult.diff}`,
      });
      outcomes.push({ step, summary: redact(result.agentResult?.summary ?? result.lastAgentMessage ?? "Step completed.") });
      event("sequence-step", `Step ${index + 1} succeeded: ${step.name}`,
        JSON.stringify({ kind: "sequence-step", state: "success", stepId: step.id, stepName: step.name,
          position: index, commitHash: gitResult.commitSha }));
      activeStepId = null;
    }

    if (runRepository.get(run.projectId, run.id).cancelRequested) {
      throw new Error("Sequence cancelled after its final validation; completed commits are preserved.");
    }
    const cumulative = await inspectRunChanges(worktree);
    runRepository.update(run.id, {
      currentStepId: null,
      commitHash: latestCommit,
      diff: `${cumulative.status}\n${cumulative.diff}`,
    });
    const cleanupResult: RunGitResult = {
      success: true,
      hasChanges: cumulative.hasChanges,
      commitSha: latestCommit,
      diff: cumulative.diff,
      status: cumulative.status,
      error: null,
    };
    if (!publishEachStep) {
      const publication = await publishWorktree(worktree, {
        settings: gitSettings,
        expectedHead: latestCommit,
        title: `sequence(${sequence.id}): ${sequence.name}`,
        body: `## AgentTasker Sequence Run\n\n- **Sequence:** ${sequence.name} (\`${sequence.id}\`)\n- **Run:** \`${run.id}\`\n- **Base:** \`${remote}/${baseBranch}\` at \`${worktree.baseCommit}\`\n- **Branch:** \`${worktree.branch}\`\n- **Final commit:** \`${latestCommit ?? "none"}\`\n- **Steps:** ${sequence.steps.map((step) => `\`${step.name}\``).join(", ")}\n- **Validations:** ${validationCommands.length ? validationCommands.map((command) => `\`${command.name}\``).join(", ") : "No Project command configured"}\n\n> Created by AgentTasker after every Sequence step succeeded. Human review and merge remain required.`,
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
    }
    const cleanup = await cleanupSuccessfulWorktree(worktree, cleanupResult)
      .catch((error) => ({ removed: false, reason: String(error) }));
    event("cleanup", cleanup.removed
      ? "Clean Sequence worktree removed; run branch and commits retained."
      : `Sequence worktree preserved: ${cleanup.reason}`);
    const completed = runRepository.completeSuccess(run.projectId, run.id);
    if (completed.status === "CANCELLED") {
      sequenceRunRepository.stopRemaining(run.id, "CANCELLED", "Sequence cancelled.");
      event("status", "Sequence cancelled after validation; completed commits remain on the run branch.");
      return;
    }
    event("status", `Sequence succeeded (${sequence.steps.length} steps)`);
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error));
    if (worktree) {
      try {
        const changes = await inspectRunChanges(worktree);
        runRepository.update(run.id, { diff: `${changes.status}\n${changes.diff}`, commitHash: latestCommit });
      } catch { /* Preserve the worktree even if Git inspection itself failed. */ }
    }
    const cancelled = runRepository.get(run.projectId, run.id).cancelRequested;
    if (activeStepId) {
      const step = sequenceRunRepository.get(run.id, activeStepId);
      if (["PENDING", "RUNNING", "VALIDATING"].includes(step.status)) {
        sequenceRunRepository.update(run.id, activeStepId, {
          status: cancelled ? "CANCELLED" : "FAILED",
          error: message,
          completedAt: new Date().toISOString(),
        });
      }
    }
    sequenceRunRepository.stopRemaining(run.id, cancelled ? "CANCELLED" : "SKIPPED",
      cancelled ? "Sequence cancelled." : "A previous Sequence step failed.");
    runRepository.update(run.id, {
      status: cancelled ? "CANCELLED" : "FAILED",
      error: message,
      currentStepId: null,
      completedAt: new Date().toISOString(),
    });
    event("status", `${cancelled ? "Sequence cancelled" : "Sequence failed"}: ${message}. Existing worktree and branch preserved.`);
  } finally {
    clearInterval(cancellation);
  }
}
