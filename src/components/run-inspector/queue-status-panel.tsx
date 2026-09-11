import { AlertCircleIcon, Clock3Icon, Loader2Icon, Trash2Icon, UnlockIcon } from "lucide-react";
import type { RunQueueStatus } from "@/types/run-queue";
import { Button } from "@/components/ui/button";

export function QueueStatusPanel({ queue, recovering = false, deleting = false, error, onRecover, onDelete }: {
  queue: RunQueueStatus;
  recovering?: boolean;
  deleting?: boolean;
  error?: string | null;
  onRecover?: () => void;
  onDelete?: () => void;
}) {
  if (queue.state === "IDLE") return null;
  const needsRecovery = queue.state === "BLOCKED_RECOVERY" || queue.state === "RECOVERY_REQUIRED";
  const blocked = queue.state === "BLOCKED_RECOVERY" || queue.state === "BLOCKED_PROCESS";
  const title = queue.state === "BLOCKED_RECOVERY"
    ? "Pipeline bloqué — confirmation requise"
    : queue.state === "RECOVERY_REQUIRED"
      ? "Récupération requise avant le prochain Run"
    : queue.state === "BLOCKED_PROCESS"
      ? "Pipeline suspendu — processus encore détecté"
      : queue.state === "RUNNING"
        ? "En attente d’une autre exécution"
        : "Run prêt dans la file";
  const position = queue.position
    ? `Position ${queue.position} sur ${queue.queuedCount} dans la file.`
    : `${queue.queuedCount} Run${queue.queuedCount > 1 ? "s" : ""} en attente.`;
  const blocker = queue.blocker;
  const description = needsRecovery
    ? `Le Run « ${blocker?.taskName || blocker?.taskId || "inconnu"} » s’est terminé sans confirmation complète de l’arrêt. ${queue.state === "RECOVERY_REQUIRED" ? "Aucun Run n’attend actuellement, mais cette vérification sera requise avant la prochaine exécution." : position}`
    : queue.state === "BLOCKED_PROCESS"
      ? `AgentTasker détecte encore le processus du Run « ${blocker?.taskName || blocker?.taskId || "inconnu"} ». La vérification se poursuit automatiquement. ${position}`
      : queue.state === "RUNNING"
        ? `Le Run « ${blocker?.taskName || blocker?.taskId || "inconnu"} » occupe actuellement le worker. ${position}`
        : `${position} Le worker le prendra automatiquement.`;

  return (
    <div role={blocked || needsRecovery ? "alert" : "status"} className={`flex gap-3 rounded-lg border px-4 py-3 ${blocked || needsRecovery ? "border-destructive/30 bg-destructive/10" : "border-border bg-muted/30"}`}>
      {blocked || needsRecovery
        ? <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
        : <Clock3Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
      <div className="min-w-0 flex-1 space-y-1">
        <h2 className={`text-sm font-medium ${blocked || needsRecovery ? "text-destructive" : "text-foreground"}`}>{title}</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
        {blocker && <p className="break-all font-mono text-[11px] text-muted-foreground">Run {blocker.id}</p>}
        {needsRecovery && queue.canRecover && (onRecover || onDelete) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {onRecover && (
              <Button type="button" size="sm" variant="outline" disabled={recovering || deleting} onClick={onRecover}>
                {recovering ? <Loader2Icon className="animate-spin" /> : <UnlockIcon />}
                {recovering ? "Déblocage…" : "Conserver et débloquer"}
              </Button>
            )}
            {onDelete && (
              <Button type="button" size="sm" variant="destructive" disabled={recovering || deleting} onClick={onDelete}>
                {deleting ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
                {deleting ? "Suppression…" : "Supprimer le Run bloquant"}
              </Button>
            )}
          </div>
        )}
        {needsRecovery && !queue.canRecover && (
          <p className="text-xs text-destructive">Un processus est encore associé à ce Run; AgentTasker ne permettra pas une reprise manuelle tant qu’il est présent.</p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
