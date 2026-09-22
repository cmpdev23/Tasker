import type { Run, SequenceStepRun } from "@db/schema";
import { AlertCircleIcon, CheckCircle2Icon, ChevronDownIcon, CircleStopIcon, ExternalLinkIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatRunDate, isActiveRun } from "@/components/task-ui-utils";
import { cn } from "@/lib/utils";
import { ExecutionDetails } from "./execution-details";
import { parseRunResult } from "./event-normalizer";
import type { ProjectCommandActivity } from "./project-command-events";
import { RunStatusBadge } from "./run-status-badge";

function broadStepSummary(step: SequenceStepRun) {
  const summary = parseRunResult(step.result)?.summary;
  if (!summary) return null;
  const firstParagraph = summary.split(/\r?\n\s*\r?\n/)[0] ?? summary;
  return firstParagraph.length > 280 ? `${firstParagraph.slice(0, 280).trim()}…` : firstParagraph;
}

function isLegacyIndependentCheckpointFailure(run: Run, steps: SequenceStepRun[]): boolean {
  try {
    const strategy = (JSON.parse(run.resolvedConfig ?? "{}") as { sequence?: { pullRequestStrategy?: unknown } })
      .sequence?.pullRequestStrategy;
    return strategy === "independent_after_each_step" && run.status === "FAILED" && steps.length > 0 &&
      steps.every((step) => step.status === "SUCCESS");
  } catch { return false; }
}

function statusMessage(run: Run, completed: number, total: number, failed: number, complete: boolean) {
  if (complete) return `Les ${total} étapes ont été réalisées avec succès.`;
  if (run.status === "FAILED") return failed
    ? `${completed} étape${completed > 1 ? "s" : ""} réussie${completed > 1 ? "s" : ""} avant l’interruption de la Sequence.`
    : "La Sequence a été interrompue avant qu’une étape ne réussisse.";
  if (run.status === "CANCELLED") return "La Sequence a été annulée. Les étapes non terminées sont conservées dans cet état.";
  if (run.status === "QUEUED") return "La Sequence est dans la file d’exécution.";
  return "La Sequence est en cours. Les états des étapes se mettent à jour automatiquement.";
}

export function SequenceRunOverview({ run, steps, commands, onInspectStep }: {
  run: Run;
  steps: SequenceStepRun[];
  commands: ProjectCommandActivity[];
  onInspectStep: (step: SequenceStepRun) => void;
}) {
  const succeeded = steps.filter((step) => step.status === "SUCCESS").length;
  const failed = steps.filter((step) => step.status === "FAILED").length;
  const skipped = steps.filter((step) => step.status === "SKIPPED").length;
  const cancelled = steps.filter((step) => step.status === "CANCELLED").length;
  const active = steps.filter((step) => isActiveRun(step.status)).length;
  const handled = succeeded + failed + skipped + cancelled;
  const progress = steps.length ? Math.round((handled / steps.length) * 100) : 0;
  const failedCommands = commands.filter((command) => command.status === "failed" || command.status === "timed-out" || command.status === "interrupted");
  const validations = commands.filter((command) => command.phase === "validation");
  const preparations = commands.filter((command) => command.phase === "preparation");
  const legacyCheckpointFailure = isLegacyIndependentCheckpointFailure(run, steps);
  const issues = [
    legacyCheckpointFailure ? null : run.error,
    ...steps.flatMap((step) => step.error ? [`${step.stepName} : ${step.error}`] : []),
    ...failedCommands.flatMap((command) => command.error ? [`${command.command} : ${command.error}`] : [`${command.command} : ${command.status === "timed-out" ? "délai dépassé" : "échec de la commande"}`]),
  ].filter((issue): issue is string => Boolean(issue));
  const uniqueIssues = [...new Set(issues)];
  const warnings = [
    run.warning,
    legacyCheckpointFailure
      ? "Toutes les étapes et leurs PR ont réussi. Un ancien bug de synchronisation du checkpoint a toutefois enregistré ce Run comme failed; le travail n’a pas échoué."
      : null,
  ].filter((warning): warning is string => Boolean(warning));
  const failedRun = run.status === "FAILED" && !legacyCheckpointFailure;
  const cancelledRun = run.status === "CANCELLED";
  const completeRun = run.status === "SUCCESS" || legacyCheckpointFailure;
  const Icon = failedRun ? AlertCircleIcon : cancelledRun ? CircleStopIcon : completeRun ? CheckCircle2Icon : Loader2Icon;

  return (
    <div className="space-y-7">
      <section aria-labelledby="sequence-overview-title" className={cn(
        "border-l-2 py-1 pl-4",
        failedRun ? "border-destructive" : cancelledRun ? "border-muted-foreground" : completeRun ? "border-success" : "border-info",
      )}>
        <div className="flex gap-3">
          <Icon className={cn("mt-0.5 size-4 shrink-0", failedRun ? "text-destructive" : cancelledRun ? "text-muted-foreground" : completeRun ? "text-success" : "animate-spin text-info")} />
          <div>
            <h2 id="sequence-overview-title" className={cn("text-sm font-medium", failedRun && "text-destructive")}>État de la Sequence</h2>
            <p className="mt-1.5 text-sm leading-6 text-foreground/90">{statusMessage(run, succeeded, steps.length, failed, completeRun)}</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="sequence-progress-title" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div>
            <h2 id="sequence-progress-title" className="text-sm font-medium">Progression de la Sequence</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {succeeded} réussie{succeeded > 1 ? "s" : ""} · {handled} / {steps.length} traitée{handled > 1 ? "s" : ""}
              {active ? ` · ${active} en cours` : ""}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2 text-xs text-muted-foreground">
            {failed > 0 && <span className="text-destructive">{failed} en échec</span>}
            {skipped > 0 && <span>{skipped} ignorée{skipped > 1 ? "s" : ""}</span>}
            {cancelled > 0 && <span>{cancelled} annulée{cancelled > 1 ? "s" : ""}</span>}
          </div>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted/60" aria-label={`${progress} % des étapes traitées`}>
          <div className={cn("h-full transition-all duration-500", failed ? "bg-destructive" : completeRun ? "bg-success" : "bg-info")} style={{ width: `${progress}%` }} />
        </div>
        {!steps.length ? (
          <p className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">Aucune étape historique n’est disponible pour ce Run.</p>
        ) : (
          <ol className="space-y-2">
            {steps.map((step) => {
              const summary = broadStepSummary(step);
              const hasDetails = Boolean(summary || step.error || step.commitHash || step.publicationBranch || step.pullRequestUrl || step.startedAt || step.completedAt);
              return (
                <li key={step.id}>
                  <details className="group rounded-lg border">
                    <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3 outline-none hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[11px] text-muted-foreground">{String(step.position + 1).padStart(2, "0")}</span>
                      <span className="min-w-0 flex-1 break-words text-sm font-medium">{step.stepName}</span>
                      <RunStatusBadge status={step.status} />
                      <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="border-t px-3 py-3 text-xs">
                      {hasDetails ? (
                        <div className="space-y-2 text-muted-foreground">
                          {(step.startedAt || step.completedAt) && <p>{formatRunDate(step.startedAt)}{step.completedAt ? ` → ${formatRunDate(step.completedAt)}` : ""}</p>}
                          {summary && <p className="whitespace-pre-wrap break-words leading-5 text-foreground/90">{summary}</p>}
                          {step.error && <p className="whitespace-pre-wrap break-words leading-5 text-destructive">{step.error}</p>}
                          {step.commitHash && <p className="break-all font-mono">Commit {step.commitHash}</p>}
                          {step.publicationBranch && <p className="break-all font-mono">Branche {step.publicationBranch}</p>}
                          {step.pullRequestUrl && <a href={step.pullRequestUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">Ouvrir la PR de l’étape <ExternalLinkIcon className="size-3" /></a>}
                        </div>
                      ) : <p className="text-muted-foreground">Cette étape n’a pas encore produit de détail.</p>}
                      <Button className="mt-3" type="button" size="sm" variant="outline" onClick={() => onInspectStep(step)}>Voir les détails de l’étape</Button>
                    </div>
                  </details>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section aria-labelledby="sequence-issues-title" className="space-y-3">
        <h2 id="sequence-issues-title" className="text-sm font-medium">Erreurs et points d’attention</h2>
        {uniqueIssues.length ? (
          <ul className="space-y-2">
            {uniqueIssues.map((issue) => <li key={issue} className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">{issue}</li>)}
          </ul>
        ) : <p className="rounded-md border border-success/25 bg-success/5 px-3 py-2 text-sm text-success">Aucune erreur enregistrée pour cette Sequence.</p>}
        {warnings.map((warning) => <p key={warning} className="rounded-md border border-warning/25 bg-warning/5 px-3 py-2 text-xs leading-5 text-warning">{warning}</p>)}
      </section>

      <section aria-labelledby="sequence-checks-title" className="space-y-3">
        <h2 id="sequence-checks-title" className="text-sm font-medium">Vérifications du projet</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <p className="rounded-md border px-3 py-2 text-xs"><span className="text-muted-foreground">Installation</span><br />{preparations.length ? `${preparations.filter((command) => command.status === "success").length} réussie${preparations.filter((command) => command.status === "success").length > 1 ? "s" : ""} sur ${preparations.length}` : "Non exécutée ou non requise"}</p>
          <p className="rounded-md border px-3 py-2 text-xs"><span className="text-muted-foreground">Validations</span><br />{validations.length ? `${validations.filter((command) => command.status === "success").length} réussie${validations.filter((command) => command.status === "success").length > 1 ? "s" : ""} sur ${validations.length}` : "Aucune validation enregistrée"}</p>
        </div>
        {failedCommands.length > 0 && <p className="text-xs text-destructive">Les commandes en échec sont listées dans les points d’attention ci-dessus. Le détail de leurs sorties reste accessible dans l’inspecteur de l’étape concernée.</p>}
      </section>

      <ExecutionDetails run={run} />
    </div>
  );
}
