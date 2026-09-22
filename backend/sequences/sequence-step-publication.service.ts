import { ACTIVE_STATUSES, runRepository } from "../runs/run.repository";
import { projectService } from "../projects/project.service";
import { ConflictError, ValidationError } from "../errors";
import { sequenceRunRepository } from "./sequence-run.repository";
import { publishVerifiedCommit, type RunPublicationEvent } from "../git/run-publication.service";

function publicationBranch(runBranch: string, position: number, stepId: string) {
  return `${runBranch}-step-${String(position + 1).padStart(3, "0")}-${stepId}`;
}

/** Publish one completed Sequence step as an explicit, idempotent draft pull request. */
export async function publishSequenceStepDraft(
  projectId: string,
  runId: string,
  stepId: string,
  publish: typeof publishVerifiedCommit = publishVerifiedCommit,
) {
  const run = runRepository.get(projectId, runId);
  if (run.kind !== "SEQUENCE" || !run.sequenceId) throw new ValidationError("Draft publication is available only for a Sequence step.");
  if (ACTIVE_STATUSES.includes(run.status) || !run.terminationVerified || run.codexPid !== null) {
    throw new ConflictError("Wait until the Sequence Run has stopped before publishing a draft pull request.");
  }
  if (!run.baseRemote || !run.baseBranch || !run.runBranch) {
    throw new ConflictError("This historical Run has no verified Git coordinates for publication.");
  }
  const step = sequenceRunRepository.get(run.id, stepId);
  if (step.status !== "SUCCESS" || !step.commitHash) {
    throw new ConflictError("Only a completed Sequence step with a verified commit can be published.");
  }
  const project = await projectService.getProjectById(projectId);
  if (!project.repositoryPath) throw new ValidationError("Configure the local Project repository before publishing a pull request.");

  const steps = sequenceRunRepository.list(run.id);
  const resolvedStrategy = (() => {
    try { return (JSON.parse(run.resolvedConfig ?? "{}") as { sequence?: { pullRequestStrategy?: unknown } }).sequence?.pullRequestStrategy; }
    catch { return undefined; }
  })();
  const independent = resolvedStrategy === "independent_after_each_step";
  const priorBranch = independent ? null : steps.slice(0, step.position).reverse().find((candidate) => candidate.publicationBranch)?.publicationBranch;
  const expectedBranch = publicationBranch(run.runBranch, step.position, step.stepId);
  if (step.publicationBranch && step.publicationBranch !== expectedBranch) {
    throw new ConflictError("This historical step has an unexpected publication branch.");
  }
  const branch = step.publicationBranch ?? expectedBranch;
  const baseBranch = priorBranch ?? run.baseBranch;
  const settings = { remote: run.baseRemote, push: true, createPullRequest: true, pullRequestDraft: true };
  const body = `## AgentTasker Sequence Step\n\n- **Sequence:** ${run.taskName} (\`${run.sequenceId}\`)\n- **Run:** \`${run.id}\`\n- **Step:** ${step.position + 1} — ${step.stepName} (\`${step.stepId}\`)\n- **Base branch:** \`${baseBranch}\`\n- **Head branch:** \`${branch}\`\n- **Commit:** \`${step.commitHash}\`\n\n> Created on demand by AgentTasker. Human review and merge remain required.`;
  const onEvent = (entry: RunPublicationEvent) => {
    runRepository.event(run.id, "publication", `[${step.stepName}] ${entry.message}`,
      JSON.stringify({ kind: "run-publication", sequenceStepId: step.stepId, manual: true, ...entry }));
  };
  const publication = await publish({
    settings,
    repositoryPath: project.repositoryPath,
    expectedHead: step.commitHash,
    branch,
    baseBranch,
    title: `sequence(${run.sequenceId}): step ${step.position + 1} ${step.stepName}`,
    body,
    onEvent,
  });
  if (!publication.pushed || !publication.pullRequestUrl || !publication.branch || !publication.pushedAt) {
    throw new Error("Draft pull request publication did not produce the expected remote branch and URL.");
  }
  const updatedStep = sequenceRunRepository.update(run.id, step.stepId, {
    publicationBranch: publication.branch,
    pushedAt: publication.pushedAt,
    pullRequestUrl: publication.pullRequestUrl,
  });
  return { step: updatedStep };
}
