import type { Run } from "@db/schema";
import { AlertCircleIcon, CheckCircle2Icon, CircleStopIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseRunResult } from "./event-normalizer";
import type { ProjectCommandActivity } from "./project-command-events";

export function RunSummary({ run, failedCommand }: { run: Run; failedCommand?: ProjectCommandActivity }) {
  const result = parseRunResult(run.result);
  const summary = result?.summary.replace(/\[([^\]]+)]\([^\s)]+\)/g, "$1");
  const firstParagraph = summary?.split(/\r?\n\s*\r?\n/)[0] ?? summary;
  const summaryLead = firstParagraph && firstParagraph.length > 240 ? `${firstParagraph.slice(0, 240).trim()}…` : firstParagraph;
  const longSummary = Boolean(summary && summary !== summaryLead);
  const failed = run.status === "FAILED";
  const cancelled = run.status === "CANCELLED";
  const success = run.status === "SUCCESS";
  if (!failed && !cancelled && !success && !result) return null;
  const Icon = failed ? AlertCircleIcon : cancelled ? CircleStopIcon : CheckCircle2Icon;
  const title = failed && failedCommand
    ? failedCommand.phase === "validation" ? "La validation du projet a échoué" : "L’installation des dépendances a échoué"
    : failed ? "Le Run a échoué" : cancelled ? "Le Run a été annulé" : "Résultat";
  return (
    <section aria-labelledby="run-result-title" className={cn(
      "border-l-2 py-1 pl-4",
      failed ? "border-destructive" : cancelled ? "border-muted-foreground" : "border-success",
    )}>
      <div className="flex gap-3">
        <Icon className={cn("mt-0.5 size-4 shrink-0", failed ? "text-destructive" : cancelled ? "text-muted-foreground" : "text-success")} />
        <div className="min-w-0">
          <h2 id="run-result-title" className={cn("text-sm font-medium", failed && "text-destructive")}>{title}</h2>
          {failed && failedCommand?.phase === "validation" && result?.status === "SUCCESS" && run.exitCode === 0 && (
            <p className="mt-1.5 text-sm leading-6">Codex a terminé son travail (code 0), mais la commande <code>{failedCommand.command}</code> n’a pas réussi. Le travail reste dans le worktree pour inspection.</p>
          )}
          {summaryLead && <p className="mt-1.5 max-w-2xl whitespace-pre-wrap break-words text-sm leading-6 text-foreground/90">{summaryLead}</p>}
          {longSummary && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-muted-foreground outline-none hover:text-foreground focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring">Afficher le compte rendu complet</summary>
              <p className="mt-2 max-w-2xl whitespace-pre-wrap break-words text-sm leading-6 text-foreground/90">{summary}</p>
            </details>
          )}
          {run.error && (!result?.blockingError || run.error !== result.blockingError) && (
            <p className={cn("mt-2 whitespace-pre-wrap break-words text-xs leading-5", failed ? "text-destructive" : "text-muted-foreground")}>{run.error}</p>
          )}
          {result?.blockingError && <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-destructive">{result.blockingError}</p>}
        </div>
      </div>
    </section>
  );
}
