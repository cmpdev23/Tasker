import type { Run } from "@db/schema";
import { CheckCircle2Icon, CircleDashedIcon, CircleXIcon, ExternalLinkIcon, Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { parseRunResult } from "./event-normalizer";
import { resolvedExecutionConfig } from "./execution-config";
import type { ProjectCommandActivity } from "./project-command-events";
import { ProjectCommands } from "./project-commands";
import { type PipelineStageStatus, pipelineStages } from "./pipeline-stages";

function statusText(status: PipelineStageStatus) {
  return { pending: "À venir", running: "En cours", success: "Terminée", failed: "Échec", skipped: "Non requise" }[status];
}

function StatusIcon({ status, className }: { status: PipelineStageStatus; className?: string }) {
  const Icon = status === "success" ? CheckCircle2Icon : status === "failed" ? CircleXIcon : status === "running" ? Loader2Icon : CircleDashedIcon;
  return <Icon className={cn("size-4 shrink-0", status === "success" ? "text-success" : status === "failed" ? "text-destructive" : "text-muted-foreground", status === "running" && "animate-spin", className)} />;
}

export function ExecutionPipeline({ run, commands, sequenceStep }: { run: Run; commands: ProjectCommandActivity[]; sequenceStep: boolean }) {
  const stages = pipelineStages(run, commands, sequenceStep);
  return (
    <section aria-labelledby="execution-pipeline-title" className="space-y-3">
      <div>
        <h2 id="execution-pipeline-title" className="text-sm font-medium">Progression de l’étape</h2>
        <p className="mt-1 text-xs text-muted-foreground">AgentTasker vérifie chaque phase avant de poursuivre la suivante.</p>
      </div>
      <ol className="grid gap-2 sm:grid-cols-5">
        {stages.map((stage) => (
          <li key={stage.id} className="flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-2 text-xs">
            <StatusIcon status={stage.status} />
            <span className="min-w-0 flex-1 truncate font-medium">{stage.label}</span>
            <span className={cn("shrink-0 text-[0.6875rem]", stage.status === "failed" ? "text-destructive" : "text-muted-foreground")}>{statusText(stage.status)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function EnvironmentPreparation({ run, commands, sequenceStep }: { run: Run; commands: ProjectCommandActivity[]; sequenceStep: boolean }) {
  const stage = pipelineStages(run, commands, sequenceStep).find((item) => item.id === "environment")!;
  return (
    <section aria-labelledby="environment-preparation-title" className="space-y-3">
      <div className="flex gap-3">
        <StatusIcon status={stage.status} className="mt-0.5" />
        <div>
          <h2 id="environment-preparation-title" className="text-sm font-medium">Préparation de l’environnement</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {sequenceStep
              ? "Worktree et branche partagés par toute la Sequence. Cette étape réutilise l’environnement déjà préparé."
              : "AgentTasker prépare la file, la branche, le worktree isolé et les dépendances configurées avant de lancer Codex."}
          </p>
        </div>
      </div>
      {commands.length > 0 && <ProjectCommands commands={commands} heading="Commandes de préparation" titleId="preparation-commands-title" commandLabel="Installation" />}
    </section>
  );
}

export function CodexCompletion({ run, commands, sequenceStep }: { run: Run; commands: ProjectCommandActivity[]; sequenceStep: boolean }) {
  const stage = pipelineStages(run, commands, sequenceStep).find((item) => item.id === "codex")!;
  const result = parseRunResult(run.result);
  const detail = stage.status === "success"
    ? "Codex a terminé correctement : code de sortie 0 et résultat structuré SUCCESS."
    : stage.status === "running" ? "Codex travaille dans le worktree isolé."
      : stage.status === "failed" ? "Codex n’a pas produit une terminaison valide pour cette étape."
        : stage.status === "skipped" ? "Codex a été arrêté avant la fin de cette étape."
          : "Codex démarrera après la préparation de l’environnement.";
  return (
    <section aria-labelledby="codex-completion-title" className="border-l-2 border-muted py-1 pl-4">
      <div className="flex gap-3">
        <StatusIcon status={stage.status} className="mt-0.5" />
        <div className="min-w-0">
          <h2 id="codex-completion-title" className="text-sm font-medium">Fin de Codex</h2>
          <p className="mt-1.5 text-sm leading-6 text-foreground/90">{detail}</p>
          {(run.exitCode !== null || result?.status) && <p className="mt-1 text-xs text-muted-foreground">Code de sortie : {run.exitCode ?? "non disponible"}{result?.status ? ` · Résultat structuré : ${result.status}` : ""}</p>}
        </div>
      </div>
    </section>
  );
}

export function GitFinalization({ run, commands, sequenceStep, publicationBranch, publishingDraft = false, draftError, onPublishDraft }: {
  run: Run;
  commands: ProjectCommandActivity[];
  sequenceStep: boolean;
  publicationBranch?: string | null;
  publishingDraft?: boolean;
  draftError?: string | null;
  onPublishDraft?: () => void;
}) {
  const stages = pipelineStages(run, commands, sequenceStep);
  const git = stages.find((item) => item.id === "git")!;
  const publication = stages.find((item) => item.id === "publication")!;
  const config = resolvedExecutionConfig(run.resolvedConfig);
  const publicationEnabled = config.push === true || config.createPullRequest === true || Boolean(run.pushedAt || run.pullRequestUrl);
  const showPublication = publicationEnabled || Boolean(onPublishDraft);
  const deferredSequencePublication = sequenceStep && run.kind === "SEQUENCE" &&
    !["after_each_step", "independent_after_each_step"].includes(config.sequencePullRequestStrategy ?? "") && publicationEnabled;
  const branch = publicationBranch ?? run.runBranch;

  return (
    <section aria-labelledby="git-finalization-title" className="space-y-4">
      <div className="flex gap-3">
        <StatusIcon status={git.status} className="mt-0.5" />
        <div>
          <h2 id="git-finalization-title" className="text-sm font-medium">Vérification Git et intégration</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {git.status === "success" ? "Le diff Git a été vérifié avant la finalisation de l’étape." : git.status === "running" ? "AgentTasker vérifie le diff et finalise les changements." : git.status === "failed" ? "La vérification Git ou la finalisation n’a pas abouti." : "Cette vérification sera exécutée après les validations."}
          </p>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <p className="rounded-md border px-3 py-2 text-xs"><span className="text-muted-foreground">Branche</span><br /><span className="break-all font-mono">{branch ?? "En attente"}</span></p>
        <p className="rounded-md border px-3 py-2 text-xs"><span className="text-muted-foreground">Commit</span><br /><span className="break-all font-mono">{run.commitHash ?? (git.status === "skipped" ? "Aucun commit requis" : "En attente")}</span></p>
      </div>
      {showPublication && (
        <div className="space-y-2 border-t pt-4">
          <div className="flex gap-3">
            <StatusIcon status={deferredSequencePublication ? "pending" : publication.status} className="mt-0.5" />
            <div>
              <h3 className="text-sm font-medium">Publication</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {deferredSequencePublication ? "La branche et la PR seront publiées après la dernière étape de la Sequence." : publication.status === "success" ? "La publication configurée a été réalisée." : publication.status === "failed" ? "La publication configurée n’a pas abouti." : publicationEnabled ? "La publication sera lancée après la finalisation Git." : "La publication automatique n’était pas activée pour cette exécution."}
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <p className="rounded-md border px-3 py-2 text-xs"><span className="text-muted-foreground">Push</span><br />{run.pushedAt ? "Branche poussée" : deferredSequencePublication ? "Prévu à la fin de la Sequence" : "En attente"}</p>
            <div className="rounded-md border px-3 py-2 text-xs"><span className="text-muted-foreground">Pull request</span><br />{run.pullRequestUrl ? <a href={run.pullRequestUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">Ouvrir la PR <ExternalLinkIcon className="size-3" /></a> : deferredSequencePublication ? "Prévue à la fin de la Sequence" : "En attente"}</div>
          </div>
          {onPublishDraft && !run.pullRequestUrl && (
            <div className="rounded-md border border-dashed px-3 py-3 text-xs">
              <p className="font-medium">Publier cette étape</p>
              <p className="mt-1 leading-5 text-muted-foreground">Crée une branche pointant sur ce commit exact et ouvre une pull request GitHub en brouillon, sans rejouer Codex ni les validations.</p>
              <Button type="button" size="sm" className="mt-3" disabled={publishingDraft} onClick={onPublishDraft}>
                {publishingDraft ? <Loader2Icon className="animate-spin" /> : null}
                {publishingDraft ? "Publication…" : "Publier une PR brouillon"}
              </Button>
              {draftError && <p role="alert" className="mt-2 text-destructive">{draftError}</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
