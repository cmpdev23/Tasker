"use client";

import { useEffect, useRef, useState } from "react";
import type { Run, RunEvent } from "@db/schema";
import { AlertCircleIcon, Loader2Icon, SquareIcon } from "lucide-react";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { errorMessage, formatRunDate, isActiveRun, taskRequest } from "@/components/task-ui-utils";

export function RunStatusBadge({ status }: { status: string }) {
  const variant = status === "SUCCESS" ? "success-light" : status === "FAILED" ? "destructive-light" : isActiveRun(status) ? "info-light" : "secondary";
  return <Badge variant={variant}>{isActiveRun(status) && <Loader2Icon className="size-3 animate-spin" />}{status}</Badge>;
}

function outputText(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function resolvedCodexRows(value: string | null) {
  let codex: Record<string, unknown> | null = null;
  try {
    const config: unknown = value ? JSON.parse(value) : null;
    codex = objectValue(objectValue(config)?.codex);
  } catch { /* Older or malformed snapshots must not prevent reading a Run. */ }
  const text = (key: string) => typeof codex?.[key] === "string" && codex[key].trim()
    ? codex[key] : "Non renseigné";
  const network = objectValue(codex?.sandbox_workspace_write)?.network_access;
  return [
    ["Modèle Codex", text("model")],
    ["Sandbox", text("sandbox_mode")],
    ["Politique d’approbation", text("approval_policy")],
    ["Réseau (workspace-write)", network === true ? "Autorisé" : network === false ? "Désactivé" : "Non renseigné"],
  ];
}

export function TaskRunSheet({ projectId, initialRun, onClose }: {
  projectId: string;
  initialRun: Run;
  onClose: () => void;
}) {
  const [run, setRun] = useState(initialRun);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(initialRun.cancelRequested);
  const [follow, setFollow] = useState(true);
  const logEnd = useRef<HTMLDivElement>(null);
  const runUrl = `/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(initialRun.id)}`;

  useEffect(() => {
    let stopped = false;
    let cursor = 0;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const data = await taskRequest<{ run: Run; events: RunEvent[] }>(`${runUrl}?after=${cursor}`, { signal: controller.signal });
        if (stopped) return;
        if (!data?.run || !Array.isArray(data.events)) throw new Error("Réponse du suivi d’exécution invalide.");
        setRun(data.run);
        if (data.run.cancelRequested) setCancelRequested(true);
        setEvents((current) => {
          const merged = new Map(current.map((event) => [event.id, event]));
          for (const event of data.events) merged.set(event.id, event);
          return [...merged.values()].sort((a, b) => a.id - b.id);
        });
        for (const event of data.events) cursor = Math.max(cursor, event.id);
        setError(null);
        // Drain persisted event pages even after a terminal status, then stop.
        if (isActiveRun(data.run.status) || data.run.terminationVerified === false || data.events.length > 0) timer = setTimeout(poll, 1500);
      } catch (error) {
        if (!stopped) {
          setError(errorMessage(error));
          timer = setTimeout(poll, 1500);
        }
      } finally { if (!stopped) setLoading(false); }
    }
    void poll();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [runUrl]);

  useEffect(() => {
    if (follow) logEnd.current?.scrollIntoView({ block: "nearest" });
  }, [events.length, follow]);

  async function cancel() {
    if (cancelling || cancelRequested) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await taskRequest(runUrl + "/cancel", { method: "POST" });
      // The server owns the final status; polling confirms process termination.
      setCancelRequested(true);
    } catch (error) { setCancelError(errorMessage(error)); }
    finally { setCancelling(false); }
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
        <SheetHeader className="gap-2 border-b pr-14">
          <SheetTitle className="break-words">{run.taskName || run.taskId}</SheetTitle>
          <SheetDescription className="break-all">Run {run.id}</SheetDescription>
          <div className="flex flex-wrap items-center gap-3"><RunStatusBadge status={run.status} /><span className="text-xs text-muted-foreground">{isActiveRun(run.status) ? "Suivi toutes les 1,5 s" : "Historique conservé"}</span></div>
        </SheetHeader>
        {run.terminationVerified === false && (!isActiveRun(run.status) || run.error) && (
          <div role="alert" className="flex shrink-0 gap-3 border-b border-destructive/30 bg-destructive/10 p-4">
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-destructive">File d’exécution bloquée — arrêt non confirmé</h3>
              <p className="text-xs leading-relaxed">
                L’arrêt de tous les processus de ce Run n’a pas pu être vérifié.
                La file reste bloquée, même après redémarrage. Une intervention locale
                doit vérifier et arrêter les processus restants, puis rétablir la
                vérification de terminaison de ce Run avant la reprise de la file.
              </p>
            </div>
          </div>
        )}
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          <p className="text-xs text-muted-foreground">Vous pouvez fermer ce panneau : l’exécution continue sur le serveur AgentTasker.</p>
          <dl className="grid grid-cols-1 gap-x-5 gap-y-3 rounded-lg border p-4 sm:grid-cols-2">
            {[
              ["En file", formatRunDate(run.queuedAt)], ["Début", formatRunDate(run.startedAt)],
              ["Fin", formatRunDate(run.completedAt)], ["Code de sortie", run.exitCode == null ? "—" : String(run.exitCode)],
              ["Base distante", [run.baseRemote, run.baseBranch].filter(Boolean).join("/") || "—"],
              ["Commit de base", run.baseCommit || "—"], ["Branche du Run", run.runBranch || "—"],
              ["Commit produit", run.commitHash || "—"], ["Worktree", run.worktreePath || "—"],
            ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-all text-xs font-mono">{value}</dd></div>)}
          </dl>
          <section className="rounded-lg border p-4">
            <h3 className="mb-3 text-sm font-medium">Configuration de cette exécution</h3>
            <dl className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
              {resolvedCodexRows(run.resolvedConfig).map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 break-all font-mono text-xs">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
          {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error} Nouvelle tentative automatique…</p>}
          {run.error && <section className="rounded-lg border border-destructive/30 bg-destructive/5 p-4"><h3 className="mb-2 font-medium text-destructive">Erreur du Run</h3><pre className="whitespace-pre-wrap break-words text-xs">{run.error}</pre></section>}
          {run.result != null && <section className="rounded-lg border p-4"><h3 className="mb-2 font-medium">Résultat</h3><pre className="whitespace-pre-wrap break-words text-xs">{outputText(run.result)}</pre></section>}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-medium">Événements <span className="text-muted-foreground">({events.length})</span></h3><label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" className="accent-primary" checked={follow} onChange={(event) => setFollow(event.target.checked)} />Suivre les nouveaux événements</label></div>
            <div className="max-h-[50dvh] min-h-48 overflow-auto rounded-lg border bg-muted/30 p-3">
              {loading && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2Icon className="size-4 animate-spin" />Chargement des événements…</p>}
              {!loading && !events.length && <p className="text-xs text-muted-foreground">{isActiveRun(run.status) ? "En attente des premiers événements…" : "Aucun événement enregistré."}</p>}
              <ol className="space-y-3 font-mono text-xs">{events.map((event) => <li key={event.id} className="border-b pb-3 last:border-0">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-muted-foreground"><time dateTime={event.timestamp}>{formatRunDate(event.timestamp)}</time><Badge variant={/error|stderr/i.test(event.type) ? "destructive-light" : "outline"} size="sm">{event.type}</Badge></div>
                <pre className="whitespace-pre-wrap break-words">{event.message}</pre>
                {event.rawPayload != null && <details className="mt-2"><summary className="cursor-pointer text-muted-foreground">Données brutes</summary><pre className="mt-2 whitespace-pre-wrap break-words">{outputText(event.rawPayload)}</pre></details>}
              </li>)}</ol>
              <div ref={logEnd} />
            </div>
          </section>
        </div>
        <div className="flex flex-col gap-3 border-t p-4">
          {cancelError && <p role="alert" className="text-sm text-destructive">{cancelError}</p>}
          <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={onClose}>Fermer</Button>{isActiveRun(run.status) && <Button variant="destructive" disabled={cancelling || cancelRequested} onClick={cancel}>{cancelling || cancelRequested ? <Loader2Icon className="size-4 animate-spin" /> : <SquareIcon className="size-4" />}{cancelRequested ? "Annulation demandée…" : "Annuler l’exécution"}</Button>}</div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
