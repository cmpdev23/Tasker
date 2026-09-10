"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Run, RunEvent } from "@db/schema";
import { AlertCircleIcon, Loader2Icon } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { errorMessage, isActiveRun, taskRequest } from "@/components/task-ui-utils";
import { ActivityFeed } from "@/components/run-inspector/activity-feed";
import { normalizeRunEvents } from "@/components/run-inspector/event-normalizer";
import { changedFileCount } from "@/components/run-inspector/execution-config";
import { ExecutionDetails } from "@/components/run-inspector/execution-details";
import { RawEvents } from "@/components/run-inspector/raw-events";
import { RunHeader } from "@/components/run-inspector/run-header";
import { RunSummary } from "@/components/run-inspector/run-summary";

export { RunStatusBadge } from "@/components/run-inspector/run-status-badge";

export function TaskRunSheet({ projectId, initialRun, rerunning = false, onClose, onRerun }: {
  projectId: string;
  initialRun: Run;
  rerunning?: boolean;
  onClose: () => void;
  onRerun?: () => void;
}) {
  const [run, setRun] = useState(initialRun);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(initialRun.cancelRequested);
  const [follow, setFollow] = useState(() => isActiveRun(initialRun.status));
  // The Sheet is mounted only after a client-side selection, so this does not
  // participate in the page's server/client hydration boundary.
  const [now, setNow] = useState(() => Date.now());
  const activityEnd = useRef<HTMLDivElement>(null);
  const runUrl = `/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(initialRun.id)}`;
  const terminal = !isActiveRun(run.status);
  const activities = useMemo(
    () => normalizeRunEvents(events, { worktreePath: run.worktreePath, terminal }),
    [events, run.worktreePath, terminal],
  );
  const changedFiles = useMemo(() => changedFileCount(run.diff), [run.diff]);

  useEffect(() => {
    if (!isActiveRun(run.status)) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [run.status]);

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
        if (isActiveRun(data.run.status) || data.run.terminationVerified === false || data.events.length > 0) {
          timer = setTimeout(poll, 1500);
        }
      } catch (caught) {
        if (!stopped) {
          setError(errorMessage(caught));
          timer = setTimeout(poll, 1500);
        }
      } finally {
        if (!stopped) setLoading(false);
      }
    }
    void poll();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [runUrl]);

  useEffect(() => {
    if (follow && isActiveRun(run.status)) activityEnd.current?.scrollIntoView({ block: "end", behavior: "auto" });
  }, [activities.length, events.length, follow, run.status]);

  async function cancel() {
    if (cancelling || cancelRequested) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await taskRequest(runUrl + "/cancel", { method: "POST" });
      setCancelRequested(true);
    } catch (caught) {
      setCancelError(errorMessage(caught));
    } finally {
      setCancelling(false);
    }
  }

  async function recoverQueue() {
    if (recovering || !window.confirm("Confirmez seulement après avoir vérifié localement qu’aucun processus de ce Run n’utilise encore son worktree. Reprendre la file ?")) return;
    setRecovering(true);
    setRecoveryError(null);
    try {
      const data = await taskRequest<{ run: Run }>(runUrl + "/recover", { method: "POST" });
      if (!data?.run) throw new Error("Réponse de récupération invalide.");
      setRun(data.run);
    } catch (caught) {
      setRecoveryError(errorMessage(caught));
    } finally {
      setRecovering(false);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-4xl data-[side=right]:xl:max-w-5xl">
        <RunHeader
          run={run}
          now={now}
          changedFiles={changedFiles}
          cancelling={cancelling}
          cancelRequested={cancelRequested}
          rerunning={rerunning}
          onCancel={cancel}
          onRerun={onRerun}
        />
        {run.terminationVerified === false && (!isActiveRun(run.status) || run.error) && (
          <div role="alert" className="flex shrink-0 gap-3 border-b border-destructive/30 bg-destructive/10 px-5 py-3 sm:px-7">
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="space-y-1">
              <h2 className="text-sm font-medium text-destructive">File bloquée — arrêt non confirmé</h2>
              <p className="text-xs leading-relaxed">AgentTasker n’a pas pu vérifier l’arrêt de tous les processus. Le worktree est préservé. Vérifiez localement qu’aucun processus de ce Run ne l’utilise encore, puis confirmez la reprise.</p>
              {!isActiveRun(run.status) && <button type="button" className="mt-2 text-xs font-medium underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-60" disabled={recovering || run.codexPid !== null} onClick={() => void recoverQueue()}>{recovering ? "Reprise de la file…" : "Confirmer l’arrêt et reprendre la file"}</button>}
              {recoveryError && <p className="text-xs text-destructive">{recoveryError}</p>}
            </div>
          </div>
        )}
        <main
          onScroll={(event) => {
            if (!follow) return;
            const target = event.currentTarget;
            if (target.scrollHeight - target.scrollTop - target.clientHeight > 120) setFollow(false);
          }}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7 sm:py-6"
        >
          <div className="mx-auto max-w-3xl space-y-7">
            {isActiveRun(run.status) && (
              <p className="text-xs text-muted-foreground">Vous pouvez fermer ce panneau : le Run continue sur le serveur AgentTasker.</p>
            )}
            {error && (
              <p role="alert" className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <Loader2Icon className="size-3.5 animate-spin" />{error} Nouvelle tentative automatique…
              </p>
            )}
            {cancelError && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{cancelError}</p>}
            <RunSummary run={run} />
            <ExecutionDetails run={run} />
            <ActivityFeed activities={activities} loading={loading} active={isActiveRun(run.status)} follow={follow} onFollowChange={setFollow} />
            <div ref={activityEnd} aria-hidden />
            <RawEvents events={events} />
          </div>
        </main>
      </SheetContent>
    </Sheet>
  );
}
