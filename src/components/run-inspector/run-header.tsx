import type { Run } from "@db/schema";
import { ExternalLinkIcon, FileTextIcon, Loader2Icon, RotateCcwIcon, SquareIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { isActiveRun, isRerunnableRun } from "@/components/task-ui-utils";
import { displayModel, resolvedExecutionConfig } from "./execution-config";
import { formatRunElapsed, shortId } from "./format";
import { RunStatusBadge } from "./run-status-badge";

export function RunHeader({ run, now, changedFiles, cancelling, cancelRequested, deleting, rerunning, savingLogs, onCancel, onDelete, onRerun, onSaveLogs }: {
  run: Run;
  now: number | null;
  changedFiles: number;
  cancelling: boolean;
  cancelRequested: boolean;
  deleting: boolean;
  rerunning: boolean;
  savingLogs?: boolean;
  onCancel: () => void;
  onDelete?: () => void;
  onRerun?: () => void;
  onSaveLogs?: () => void;
}) {
  const config = resolvedExecutionConfig(run.resolvedConfig);
  const meta = [
    displayModel(config.model),
    config.reasoning ? `${config.reasoning.charAt(0).toUpperCase()}${config.reasoning.slice(1)}` : null,
    config.sandbox,
    config.network == null ? null : config.network ? "Réseau activé" : "Réseau désactivé",
  ].filter((value): value is string => Boolean(value));
  const elapsed = formatRunElapsed(run.startedAt, run.completedAt, now);

  return (
    <SheetHeader className="gap-4 border-b px-5 py-5 pr-14 sm:px-7 sm:py-6 sm:pr-16">
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <SheetTitle className="break-words text-lg tracking-tight sm:text-xl">{run.taskName || run.taskId}</SheetTitle>
            <RunStatusBadge status={run.status} />
          </div>
          <SheetDescription className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span>{elapsed}</span>
            <span aria-hidden>·</span>
            <span className="font-mono" title={run.id}>Run {shortId(run.id)}</span>
          </SheetDescription>
          <p className="mt-3 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {meta.map((value, index) => <span className="whitespace-nowrap" key={value}>{index > 0 && <span className="mr-2" aria-hidden>·</span>}{value}</span>)}
          </p>
          {!isActiveRun(run.status) && (changedFiles > 0 || run.commitHash) && (
            <p className="mt-2 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              {changedFiles > 0 && <span>{changedFiles} fichier{changedFiles > 1 ? "s" : ""} modifié{changedFiles > 1 ? "s" : ""}</span>}
              {run.commitHash && <span>{run.kind === "SEQUENCE" ? "Commits d’étapes conservés" : "1 commit créé"}</span>}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 self-start">
          {run.pullRequestUrl && (
            <Button
              variant="outline"
              size="sm"
              render={<a href={run.pullRequestUrl} target="_blank" rel="noreferrer" />}
            >
              <ExternalLinkIcon data-icon="inline-start" />
              Ouvrir la PR
            </Button>
          )}
          {onSaveLogs && (
            <Button
              variant="outline"
              size="sm"
              disabled={savingLogs}
              onClick={onSaveLogs}
              title="Enregistrer les logs pertinents dans .tasker/logs/"
            >
              {savingLogs ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <FileTextIcon data-icon="inline-start" />}
              {savingLogs ? "Enregistrement…" : "Enregistrer les logs"}
            </Button>
          )}
          {isRerunnableRun(run.status) && onRerun && (
            <Button
              variant="outline"
              size="sm"
              disabled={rerunning}
              onClick={onRerun}
              title="Créer un nouveau Run avec la configuration actuelle"
            >
              {rerunning ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <RotateCcwIcon data-icon="inline-start" />}
              Réexécuter
            </Button>
          )}
          {onDelete && (
            <Button variant={run.status === "QUEUED" ? "destructive" : "outline"} size="sm" disabled={deleting} onClick={onDelete}>
              {deleting ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <Trash2Icon data-icon="inline-start" />}
              {run.status === "QUEUED" ? "Retirer de la file" : "Supprimer"}
            </Button>
          )}
          {isActiveRun(run.status) && run.status !== "QUEUED" && (
            <Button variant="destructive" size="sm" disabled={cancelling || cancelRequested} onClick={onCancel}>
              {cancelling || cancelRequested ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <SquareIcon data-icon="inline-start" />}
              {cancelRequested ? "Annulation demandée…" : "Annuler"}
            </Button>
          )}
        </div>
      </div>
    </SheetHeader>
  );
}
