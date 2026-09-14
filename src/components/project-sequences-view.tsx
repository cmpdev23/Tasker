"use client";

import { useEffect, useRef, useState } from "react";
import type { Project, Run } from "@db/schema";
import type { RunQueueStatus } from "@/types/run-queue";
import type { SequenceDefinition, SequenceInput, SequenceStepDefinition, SequenceStepInput } from "@/types/sequences";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  ListOrderedIcon,
  Loader2Icon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  SettingsIcon,
  Trash2Icon,
  WorkflowIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { QueueStatusPanel } from "@/components/run-inspector/queue-status-panel";
import { RunStatusBadge, TaskRunSheet } from "@/components/task-run-sheet";
import { SequenceEditorDialog, SequenceStepEditorDialog } from "@/components/sequence-editor-dialogs";
import { errorMessage, formatRunDate, isActiveRun, taskRequest } from "@/components/task-ui-utils";

export function ProjectSequencesView(props: { project: Project; onNavigateToSettings?: () => void }) {
  return <SequencesView key={`${props.project.id}:${props.project.repositoryPath}`} {...props} />;
}

function SequencesView({ project, onNavigateToSettings }: { project: Project; onNavigateToSettings?: () => void }) {
  const [sequences, setSequences] = useState<SequenceDefinition[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [queue, setQueue] = useState<RunQueueStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [definitionError, setDefinitionError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [selectedSequenceId, setSelectedSequenceId] = useState<string | null>(null);
  const [sequenceEditor, setSequenceEditor] = useState<SequenceDefinition | null | undefined>(undefined);
  const [stepEditor, setStepEditor] = useState<SequenceStepDefinition | null | undefined>(undefined);
  const [starting, setStarting] = useState<string | null>(null);
  const [mutating, setMutating] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [deletingBlocker, setDeletingBlocker] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const startingRef = useRef(false);
  const baseUrl = `/api/projects/${encodeURIComponent(project.id)}`;
  const selectedSequence = sequences.find((sequence) => sequence.id === selectedSequenceId) ?? null;

  useEffect(() => {
    if (!project.repositoryPath) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      const results = await Promise.allSettled([
        taskRequest<{ sequences: SequenceDefinition[] }>(`${baseUrl}/sequences`, { signal: controller.signal }),
        taskRequest<{ runs: Run[]; queue: RunQueueStatus }>(`${baseUrl}/sequence-runs`, { signal: controller.signal }),
      ]);
      if (stopped) return;
      const [sequenceResult, runResult] = results;
      if (sequenceResult.status === "fulfilled" && Array.isArray(sequenceResult.value.sequences)) {
        setSequences(sequenceResult.value.sequences);
        setDefinitionError(null);
      } else {
        setDefinitionError(sequenceResult.status === "rejected" ? errorMessage(sequenceResult.reason) : "Réponse de la liste des Sequences invalide.");
      }
      if (runResult.status === "fulfilled" && Array.isArray(runResult.value.runs)) {
        setRuns(runResult.value.runs);
        if (runResult.value.queue) setQueue(runResult.value.queue);
        setRunError(null);
      } else {
        setRunError(runResult.status === "rejected" ? errorMessage(runResult.reason) : "Réponse de l’historique invalide.");
      }
      setLoading(false);
      timer = setTimeout(poll, 3000);
    }
    void poll();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [baseUrl, project.repositoryPath, refresh]);

  async function saveSequence(input: SequenceInput, id?: string) {
    const data = await taskRequest<{ sequence: SequenceDefinition }>(`${baseUrl}/sequences${id ? `/${encodeURIComponent(id)}` : ""}`, {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!data?.sequence?.id) throw new Error("Réponse de sauvegarde invalide.");
    setSequences((current) => [...current.filter((sequence) => sequence.id !== data.sequence.id), data.sequence]
      .sort((a, b) => a.name.localeCompare(b.name)));
    if (!id) setSelectedSequenceId(data.sequence.id);
    setSequenceEditor(undefined);
    setRefresh((value) => value + 1);
    toast.success(id ? "Sequence configurée." : "Sequence créée. Ajoutez maintenant ses étapes.");
  }

  async function saveStep(input: SequenceStepInput, id?: string) {
    if (!selectedSequence) throw new Error("Aucune Sequence sélectionnée.");
    const url = `${baseUrl}/sequences/${encodeURIComponent(selectedSequence.id)}/steps${id ? `/${encodeURIComponent(id)}` : ""}`;
    const data = await taskRequest<{ sequence: SequenceDefinition }>(url, {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    setSequences((current) => current.map((sequence) => sequence.id === data.sequence.id ? data.sequence : sequence));
    setStepEditor(undefined);
    setRefresh((value) => value + 1);
    toast.success(id ? "Étape enregistrée." : "Étape ajoutée à la Sequence.");
  }

  async function runSequence(sequenceId: string) {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(sequenceId);
    try {
      const data = await taskRequest<{ run: Run }>(`${baseUrl}/sequences/${encodeURIComponent(sequenceId)}/runs`, { method: "POST" });
      if (!data?.run?.id) throw new Error("Réponse du lancement invalide.");
      setSelectedRun(data.run);
      setRefresh((value) => value + 1);
      toast.success("Sequence ajoutée à la file.");
    } catch (caught) { toast.error(errorMessage(caught)); }
    finally { startingRef.current = false; setStarting(null); }
  }

  async function reorderStep(index: number, direction: -1 | 1) {
    if (!selectedSequence || mutating) return;
    const target = index + direction;
    if (target < 0 || target >= selectedSequence.steps.length) return;
    const reordered = selectedSequence.steps.map((step) => step.id);
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setMutating(`order:${selectedSequence.steps[index].id}`);
    try {
      const data = await taskRequest<{ sequence: SequenceDefinition }>(`${baseUrl}/sequences/${encodeURIComponent(selectedSequence.id)}/steps/order`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedStepIds: reordered }),
      });
      setSequences((current) => current.map((sequence) => sequence.id === data.sequence.id ? data.sequence : sequence));
    } catch (caught) { toast.error(errorMessage(caught)); }
    finally { setMutating(null); }
  }

  async function deleteStep(step: SequenceStepDefinition) {
    if (!selectedSequence || mutating || !window.confirm(`Supprimer l’étape « ${step.name} » de cette Sequence ?`)) return;
    setMutating(`delete:${step.id}`);
    try {
      const data = await taskRequest<{ sequence: SequenceDefinition }>(`${baseUrl}/sequences/${encodeURIComponent(selectedSequence.id)}/steps/${encodeURIComponent(step.id)}`, { method: "DELETE" });
      setSequences((current) => current.map((sequence) => sequence.id === data.sequence.id ? data.sequence : sequence));
      toast.success("Étape supprimée.");
    } catch (caught) { toast.error(errorMessage(caught)); }
    finally { setMutating(null); }
  }

  async function deleteSequence(sequence: SequenceDefinition) {
    if (mutating || !window.confirm(`Supprimer la Sequence « ${sequence.name} » et toutes ses étapes ? Son historique de Runs restera consultable.`)) return;
    setMutating(`sequence:${sequence.id}`);
    try {
      await taskRequest(`${baseUrl}/sequences/${encodeURIComponent(sequence.id)}`, { method: "DELETE" });
      setSequences((current) => current.filter((candidate) => candidate.id !== sequence.id));
      if (selectedSequenceId === sequence.id) setSelectedSequenceId(null);
      setRefresh((value) => value + 1);
      toast.success("Sequence supprimée. Son historique est conservé.");
    } catch (caught) { toast.error(errorMessage(caught)); }
    finally { setMutating(null); }
  }

  async function recoverQueue() {
    const blocker = queue?.blocker;
    if (!blocker || recovering || !window.confirm("Confirmez localement que l’ancienne exécution n’est plus active, puis reprenez la file globale.")) return;
    setRecovering(true);
    setQueueError(null);
    try {
      const data = await taskRequest<{ queue: RunQueueStatus }>(`/api/projects/${encodeURIComponent(blocker.projectId)}/runs/${encodeURIComponent(blocker.id)}/recover`, { method: "POST" });
      if (data.queue) setQueue(data.queue);
      setRefresh((value) => value + 1);
    } catch (caught) { setQueueError(errorMessage(caught)); }
    finally { setRecovering(false); }
  }

  async function deleteQueueBlocker() {
    const blocker = queue?.blocker;
    if (!blocker || deletingBlocker || !window.confirm("Supprimer définitivement ce Run bloquant, son worktree et sa branche ? Tout travail non intégré sera perdu.")) return;
    setDeletingBlocker(true);
    setQueueError(null);
    try {
      const data = await taskRequest<{ queue: RunQueueStatus }>(`/api/projects/${encodeURIComponent(blocker.projectId)}/runs/${encodeURIComponent(blocker.id)}?deleteArtifacts=true&confirmTermination=true`, { method: "DELETE" });
      if (data.queue) setQueue(data.queue);
      setRefresh((value) => value + 1);
    } catch (caught) { setQueueError(errorMessage(caught)); }
    finally { setDeletingBlocker(false); }
  }

  const lastRuns = new Map<string, Run>();
  for (const run of runs) {
    const id = run.sequenceId || run.taskId;
    if (!lastRuns.has(id)) lastRuns.set(id, run);
  }
  const selectedHasActiveRun = selectedSequence
    ? runs.some((run) => (run.sequenceId || run.taskId) === selectedSequence.id && isActiveRun(run.status))
    : false;

  if (!project.repositoryPath) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <Frame stacked spacing="sm">
          <FrameHeader><FrameTitle>Sequences</FrameTitle><FrameDescription>Créez des workflows séquentiels possédant leurs propres étapes.</FrameDescription></FrameHeader>
          <FramePanel className="flex flex-col items-center gap-3 p-10 text-center">
            <WorkflowIcon className="size-7 text-muted-foreground" />
            <p className="text-sm">Configurez le repository du projet pour créer des Sequences.</p>
            {onNavigateToSettings && <Button variant="outline" onClick={onNavigateToSettings}><SettingsIcon />Ouvrir Settings</Button>}
          </FramePanel>
        </Frame>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      {queue && ["BLOCKED_RECOVERY", "BLOCKED_PROCESS", "RECOVERY_REQUIRED"].includes(queue.state) && (
        <QueueStatusPanel queue={queue} recovering={recovering} deleting={deletingBlocker} error={queueError}
          onRecover={queue.blocker ? () => void recoverQueue() : undefined}
          onDelete={queue.canRecover && queue.blocker ? () => void deleteQueueBlocker() : undefined} />
      )}

      {selectedSequence ? (
        <Frame stacked spacing="sm">
          <FrameHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={() => setSelectedSequenceId(null)}><ArrowLeftIcon />Toutes les Sequences</Button>
              <FrameTitle className="text-base">{selectedSequence.name}</FrameTitle>
              <FrameDescription>{selectedSequence.steps.length} étape{selectedSequence.steps.length !== 1 ? "s" : ""} · {selectedSequence.pullRequestStrategy === "after_each_step" ? "une PR empilée par étape avec commit" : "une PR après la Sequence"}</FrameDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={selectedHasActiveRun || !!definitionError} onClick={() => setSequenceEditor(selectedSequence)}><PencilIcon />Configurer</Button>
              <Button disabled={selectedHasActiveRun || !!definitionError} onClick={() => setStepEditor(null)}><PlusIcon />Ajouter une étape</Button>
            </div>
          </FrameHeader>
          <FramePanel className="p-0">
            {selectedHasActiveRun && <p className="border-b bg-info/5 px-4 py-3 text-xs text-muted-foreground">La définition est verrouillée pendant son exécution afin que l’ordre et les instructions restent stables.</p>}
            {!selectedSequence.steps.length ? (
              <div className="flex flex-col items-center gap-3 p-12 text-center">
                <ListOrderedIcon className="size-8 text-muted-foreground" />
                <h3 className="text-sm font-medium">Ajoutez la première étape</h3>
                <p className="max-w-md text-sm text-muted-foreground">Chaque étape possède ses propres instructions. Elle ne crée ni ne référence aucune Task.</p>
                <Button variant="outline" onClick={() => setStepEditor(null)}><PlusIcon />Créer une étape</Button>
              </div>
            ) : (
              <ol className="divide-y">
                {selectedSequence.steps.map((step, index) => (
                  <li key={step.id} className="flex items-start gap-3 p-4 hover:bg-muted/20">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                    <button type="button" className="min-w-0 flex-1 text-left outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring"
                      disabled={selectedHasActiveRun} onClick={() => setStepEditor(step)}>
                      <span className="block break-words text-sm font-medium">{step.name}</span>
                      <code className="mt-1 block text-xs text-muted-foreground">{step.id}</code>
                      <Badge className="mt-2" variant={step.expectChanges ? "secondary" : "outline"}>{step.expectChanges ? "Diff requis" : "Analyse permise"}</Badge>
                    </button>
                    <div className="flex shrink-0 gap-1">
                      <Button size="icon-sm" variant="ghost" disabled={selectedHasActiveRun || !!mutating || index === 0}
                        onClick={() => void reorderStep(index, -1)} aria-label={`Monter ${step.name}`} title="Monter"><ArrowUpIcon /></Button>
                      <Button size="icon-sm" variant="ghost" disabled={selectedHasActiveRun || !!mutating || index === selectedSequence.steps.length - 1}
                        onClick={() => void reorderStep(index, 1)} aria-label={`Descendre ${step.name}`} title="Descendre"><ArrowDownIcon /></Button>
                      <Button size="icon-sm" variant="ghost" disabled={selectedHasActiveRun || !!mutating}
                        onClick={() => setStepEditor(step)} aria-label={`Modifier ${step.name}`} title="Modifier"><PencilIcon /></Button>
                      <Button size="icon-sm" variant="ghost" disabled={selectedHasActiveRun || !!mutating}
                        onClick={() => void deleteStep(step)} aria-label={`Supprimer ${step.name}`} title="Supprimer"><Trash2Icon /></Button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </FramePanel>
        </Frame>
      ) : (
        <Frame stacked spacing="sm">
          <FrameHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><FrameTitle>Sequences</FrameTitle><FrameDescription>Créez des workflows ordonnés avec leurs propres étapes, indépendamment des Tasks.</FrameDescription></div>
            <Button disabled={loading || !!definitionError} onClick={() => setSequenceEditor(null)}><PlusIcon />Créer une Sequence</Button>
          </FrameHeader>
          <FramePanel className="p-0">
            <div className="border-b px-4 py-3 text-xs text-muted-foreground"><span className="font-medium">Repository : </span><span className="break-all font-mono">{project.repositoryPath}</span></div>
            {definitionError && <p role="alert" className="border-b bg-destructive/5 p-4 text-sm text-destructive">{definitionError} Nouvelle tentative automatique…</p>}
            {loading ? (
              <div role="status" className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground"><Loader2Icon className="animate-spin" />Chargement des Sequences…</div>
            ) : !sequences.length ? !definitionError && (
              <div className="flex flex-col items-center gap-3 p-12 text-center">
                <WorkflowIcon className="size-8 text-muted-foreground" />
                <h3 className="text-sm font-medium">Votre première Sequence</h3>
                <p className="max-w-md text-sm text-muted-foreground">Créez un workflow, ajoutez ses étapes, puis lancez-les automatiquement dans leur ordre.</p>
                <Button variant="outline" onClick={() => setSequenceEditor(null)}><PlusIcon />Créer une Sequence</Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Sequences du projet, nombre d’étapes et dernière exécution</caption>
                  <thead className="border-b bg-muted/20 text-xs text-muted-foreground"><tr><th className="p-4 font-medium">Sequence</th><th className="p-4 font-medium">Étapes</th><th className="p-4 font-medium">Dernier Run</th><th className="p-4 text-right font-medium">Actions</th></tr></thead>
                  <tbody className="divide-y">{sequences.map((sequence) => {
                    const last = lastRuns.get(sequence.id);
                    const active = Boolean(last && isActiveRun(last.status));
                    return <tr key={sequence.id} className="hover:bg-muted/20">
                      <th scope="row" className="min-w-52 p-4 font-normal"><button className="text-left outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setSelectedSequenceId(sequence.id)}><span className="block font-medium">{sequence.name}</span><code className="mt-1 block text-xs text-muted-foreground">{sequence.id}</code></button></th>
                      <td className="p-4"><span className="font-medium">{sequence.steps.length}</span><span className="ml-1 text-xs text-muted-foreground">étape{sequence.steps.length !== 1 ? "s" : ""}</span></td>
                      <td className="p-4">{last ? <button className="text-left" onClick={() => setSelectedRun(last)}><RunStatusBadge status={last.status} /><span className="mt-1 block text-xs text-muted-foreground">{formatRunDate(last.startedAt || last.queuedAt)}</span></button> : <span className="text-xs text-muted-foreground">Jamais exécutée</span>}</td>
                      <td className="p-4"><div className="flex justify-end gap-1"><Button size="sm" variant="outline" disabled={!!starting || !sequence.steps.length || active} onClick={() => void runSequence(sequence.id)}>{starting === sequence.id ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}{active ? "En cours" : "Exécuter"}</Button><Button size="sm" variant="ghost" onClick={() => setSelectedSequenceId(sequence.id)}>Ouvrir</Button><Button size="icon-sm" variant="ghost" disabled={active || !!mutating} onClick={() => void deleteSequence(sequence)} aria-label={`Supprimer ${sequence.name}`} title="Supprimer"><Trash2Icon /></Button></div></td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
            )}
          </FramePanel>
        </Frame>
      )}

      <Frame stacked spacing="sm">
        <FrameHeader><FrameTitle>Historique des Sequences</FrameTitle><FrameDescription>Runs récents · actualisation toutes les 3 secondes</FrameDescription></FrameHeader>
        <FramePanel className="p-0">
          {runError && <p role="alert" className="border-b bg-destructive/5 p-4 text-sm text-destructive">{runError} Nouvelle tentative automatique…</p>}
          {!runs.length ? <p className="p-6 text-sm text-muted-foreground">{loading ? "Chargement…" : "Aucune Sequence exécutée."}</p> : (
            <ul className="max-h-[28rem] divide-y overflow-y-auto">{runs.map((run) => <li key={run.id}>
              <button type="button" onClick={() => setSelectedRun(run)} className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <span className="min-w-0"><span className="block break-words text-sm font-medium">{run.taskName || run.sequenceId}</span><span className="mt-1 block text-xs text-muted-foreground">{formatRunDate(run.startedAt || run.queuedAt)} · Run <span className="font-mono">{run.id.slice(0, 8)}</span></span></span>
                <RunStatusBadge status={run.status} />
              </button>
            </li>)}</ul>
          )}
        </FramePanel>
      </Frame>

      {sequenceEditor !== undefined && <SequenceEditorDialog sequence={sequenceEditor} onClose={() => setSequenceEditor(undefined)} onSave={saveSequence} />}
      {stepEditor !== undefined && <SequenceStepEditorDialog step={stepEditor} onClose={() => setStepEditor(undefined)} onSave={saveStep} />}
      {selectedRun && <TaskRunSheet key={selectedRun.id} projectId={project.id} initialRun={selectedRun}
        rerunning={starting === (selectedRun.sequenceId || selectedRun.taskId)}
        onRerun={sequences.some((sequence) => sequence.id === (selectedRun.sequenceId || selectedRun.taskId))
          ? () => void runSequence(selectedRun.sequenceId || selectedRun.taskId) : undefined}
        onClose={() => { setSelectedRun(null); setRefresh((value) => value + 1); }} />}
    </div>
  );
}
