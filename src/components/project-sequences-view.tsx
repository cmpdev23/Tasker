"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Project, Run, SequenceStepRun } from "@db/schema";
import type { RunQueueStatus } from "@/types/run-queue";
import type { SequenceDefinition, SequenceInput, SequenceStepDefinition, SequenceStepInput } from "@/types/sequences";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  ClockIcon,
  ExternalLinkIcon,
  EyeIcon,
  GitBranchIcon,
  GitCommitIcon,
  ListOrderedIcon,
  Loader2Icon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  SettingsIcon,
  Trash2Icon,
  WorkflowIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { QueueStatusPanel } from "@/components/run-inspector/queue-status-panel";
import { RunIdCopy, RunStatusBadge, TaskRunSheet } from "@/components/task-run-sheet";
import { SequenceEditorDialog, SequenceStepEditorDialog } from "@/components/sequence-editor-dialogs";
import { errorMessage, formatRunDate, isActiveRun, taskRequest } from "@/components/task-ui-utils";
import { cn } from "@/lib/utils";

interface PortableCheckpoint {
  sequenceId: string;
  runId: string;
  status: "IN_PROGRESS" | "SUCCESS" | "FAILED" | "CANCELLED";
  updatedAt: string;
  steps: Array<{ id: string; status: string }>;
}

export function ProjectSequencesView(props: { project: Project; onNavigateToSettings?: () => void }) {
  return <SequencesView key={`${props.project.id}:${props.project.repositoryPath}`} {...props} />;
}

function SequencesView({ project, onNavigateToSettings }: { project: Project; onNavigateToSettings?: () => void }) {
  const [sequences, setSequences] = useState<SequenceDefinition[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [stepRuns, setStepRuns] = useState<SequenceStepRun[]>([]);
  const [queue, setQueue] = useState<RunQueueStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [definitionError, setDefinitionError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [selectedSequenceId, setSelectedSequenceId] = useState<string | null>(null);
  const [selectedRunIdForView, setSelectedRunIdForView] = useState<string | null>(null);
  const [sequenceEditor, setSequenceEditor] = useState<SequenceDefinition | null | undefined>(undefined);
  const [stepEditor, setStepEditor] = useState<SequenceStepDefinition | null | undefined>(undefined);
  const [starting, setStarting] = useState<string | null>(null);
  const [resumingRunId, setResumingRunId] = useState<string | null>(null);
  const [mutating, setMutating] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [selectedStepRun, setSelectedStepRun] = useState<SequenceStepRun | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [deletingBlocker, setDeletingBlocker] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [portableCheckpoint, setPortableCheckpoint] = useState<PortableCheckpoint | null>(null);
  const [portableCheckpointError, setPortableCheckpointError] = useState<string | null>(null);
  const [resumingPortableCheckpoint, setResumingPortableCheckpoint] = useState(false);
  const startingRef = useRef(false);
  const baseUrl = `/api/projects/${encodeURIComponent(project.id)}`;
  const selectedSequence = sequences.find((sequence) => sequence.id === selectedSequenceId) ?? null;

  useEffect(() => {
    if (!selectedSequenceId) return;
    const controller = new AbortController();
    void taskRequest<{ checkpoint: PortableCheckpoint | null }>(`${baseUrl}/sequences/${encodeURIComponent(selectedSequenceId)}/checkpoint`, { signal: controller.signal })
      .then((data) => { setPortableCheckpoint(data.checkpoint ?? null); setPortableCheckpointError(null); })
      .catch((error) => { if (!controller.signal.aborted) setPortableCheckpointError(errorMessage(error)); });
    return () => controller.abort();
  }, [baseUrl, selectedSequenceId, refresh]);

  useEffect(() => {
    if (!project.repositoryPath) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      const results = await Promise.allSettled([
        taskRequest<{ sequences: SequenceDefinition[] }>(`${baseUrl}/sequences`, { signal: controller.signal }),
        taskRequest<{ runs: Run[]; stepRuns?: SequenceStepRun[]; queue: RunQueueStatus }>(`${baseUrl}/sequence-runs`, { signal: controller.signal }),
      ]);
      if (stopped) return;
      const [sequenceResult, runResult] = results;
      if (sequenceResult.status === "fulfilled" && Array.isArray(sequenceResult.value.sequences)) {
        setSequences(sequenceResult.value.sequences);
        setDefinitionError(null);
      } else {
        setDefinitionError(sequenceResult.status === "rejected" ? errorMessage(sequenceResult.reason) : "Réponse de la liste des Sequences invalide.");
      }
      let hasActive = false;
      if (runResult.status === "fulfilled" && Array.isArray(runResult.value.runs)) {
        setRuns(runResult.value.runs);
        if (Array.isArray(runResult.value.stepRuns)) {
          setStepRuns(runResult.value.stepRuns);
        }
        if (runResult.value.queue) setQueue(runResult.value.queue);
        setRunError(null);
        hasActive = runResult.value.runs.some((r) => isActiveRun(r.status));
      } else {
        setRunError(runResult.status === "rejected" ? errorMessage(runResult.reason) : "Réponse de l’historique invalide.");
      }
      setLoading(false);
      timer = setTimeout(poll, hasActive ? 1500 : 3000);
    }
    void poll();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [baseUrl, project.repositoryPath, refresh]);

  const stepRunsByRunId = useMemo(() => {
    const map = new Map<string, SequenceStepRun[]>();
    for (const item of stepRuns) {
      const list = map.get(item.runId);
      if (list) list.push(item);
      else map.set(item.runId, [item]);
    }
    return map;
  }, [stepRuns]);

  const sequenceRuns = useMemo(() => {
    if (!selectedSequence) return [];
    return runs.filter((run) => (run.sequenceId || run.taskId) === selectedSequence.id);
  }, [runs, selectedSequence]);

  const activeSequenceRun = useMemo(() => {
    return sequenceRuns.find((run) => isActiveRun(run.status)) ?? null;
  }, [sequenceRuns]);

  const latestSequenceRun = useMemo(() => {
    return sequenceRuns[0] ?? null;
  }, [sequenceRuns]);

  const displayRun = useMemo(() => {
    if (selectedRunIdForView) {
      const found = sequenceRuns.find((r) => r.id === selectedRunIdForView);
      if (found) return found;
    }
    return activeSequenceRun || latestSequenceRun || null;
  }, [selectedRunIdForView, sequenceRuns, activeSequenceRun, latestSequenceRun]);

  const displayStepRuns = useMemo(() => {
    if (!displayRun) return [];
    return stepRunsByRunId.get(displayRun.id) ?? [];
  }, [displayRun, stepRunsByRunId]);

  const continuationSource = useMemo(() => {
    if (!selectedSequence) return null;
    for (const [index, candidate] of sequenceRuns.entries()) {
      const completed = stepRunsByRunId.get(candidate.id) ?? [];
      const compatiblePrefix = candidate.status === "SUCCESS" && candidate.terminationVerified && candidate.runBranch && candidate.baseCommit && completed.length > 0 &&
        completed.length < selectedSequence.steps.length && completed.every((step, index) =>
          step.status === "SUCCESS" && step.stepId === selectedSequence.steps[index]?.id &&
          step.stepName === selectedSequence.steps[index]?.name);
      if (!compatiblePrefix) continue;
      const suffixWasAttemptedLater = sequenceRuns.slice(0, index).some((later) => {
        const laterSteps = stepRunsByRunId.get(later.id) ?? [];
        return laterSteps.length === selectedSequence.steps.length && laterSteps.every((step, stepIndex) =>
          step.stepId === selectedSequence.steps[stepIndex]?.id && step.stepName === selectedSequence.steps[stepIndex]?.name) &&
          laterSteps.slice(completed.length).some((step) => step.status !== "PENDING");
      });
      if (!suffixWasAttemptedLater) return candidate;
    }
    return null;
  }, [selectedSequence, sequenceRuns, stepRunsByRunId]);

  const continuationStepCount = continuationSource
    ? selectedSequence!.steps.length - (stepRunsByRunId.get(continuationSource.id)?.length ?? 0)
    : 0;
  const retainedStepCount = selectedSequence ? selectedSequence.steps.length - continuationStepCount : 0;

  function openRunInspector(run: Run) {
    setSelectedStepRun(null);
    setSelectedRun(run);
  }

  function openStepInspector(run: Run, stepRun: SequenceStepRun) {
    setSelectedStepRun(stepRun);
    setSelectedRun(run);
  }

  const completedStepsCount = useMemo(() => {
    return displayStepRuns.filter((sr) => sr.status === "SUCCESS").length;
  }, [displayStepRuns]);

  const hasFailedStep = useMemo(() => {
    return displayStepRuns.some((sr) => sr.status === "FAILED");
  }, [displayStepRuns]);

  const canResumeDisplayRun = useMemo(() => {
    if (!displayRun || displayRun.kind !== "SEQUENCE" || displayRun.status !== "FAILED" ||
        !displayRun.terminationVerified || displayRun.codexPid !== null) return false;
    const failedIndex = displayStepRuns.findIndex((step) => step.status === "FAILED");
    return failedIndex >= 0 && displayStepRuns.slice(0, failedIndex).every((step) => step.status === "SUCCESS") &&
      displayStepRuns.slice(failedIndex + 1).every((step) => step.status === "SKIPPED");
  }, [displayRun, displayStepRuns]);

  const selectedHasActiveRun = Boolean(activeSequenceRun);

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
      setSelectedRunIdForView(data.run.id);
      setSelectedRun(data.run);
      setRefresh((value) => value + 1);
      toast.success(data.run.resumeStage === "CONTINUING"
        ? "Nouvelle étape ajoutée à la file : les étapes déjà réussies seront conservées."
        : "Sequence ajoutée à la file.");
    } catch (caught) { toast.error(errorMessage(caught)); }
    finally { startingRef.current = false; setStarting(null); }
  }

  async function resumeSequence(runId: string) {
    if (resumingRunId) return;
    setResumingRunId(runId);
    try {
      const data = await taskRequest<{ run: Run }>(`${baseUrl}/runs/${encodeURIComponent(runId)}/resume`, { method: "POST" });
      if (!data?.run?.id) throw new Error("Réponse de reprise invalide.");
      setSelectedRunIdForView(data.run.id);
      setSelectedRun(data.run);
      setRefresh((value) => value + 1);
      toast.success(data.run.resumeStage === "VALIDATING"
        ? "Reprise ajoutée à la file : Codex ne sera pas relancé pour l’étape déjà terminée."
        : "Reprise ajoutée à la file : Codex continuera dans le worktree préservé, sans perdre les modifications existantes.");
    } catch (caught) { toast.error(errorMessage(caught)); }
    finally { setResumingRunId(null); }
  }

  async function resumePortableCheckpoint() {
    if (!selectedSequence || resumingPortableCheckpoint || selectedHasActiveRun) return;
    setResumingPortableCheckpoint(true);
    try {
      const data = await taskRequest<{ run: Run }>(`${baseUrl}/sequences/${encodeURIComponent(selectedSequence.id)}/checkpoint/resume`, { method: "POST" });
      if (!data?.run?.id) throw new Error("Réponse de reprise portable invalide.");
      setSelectedRunIdForView(data.run.id);
      setSelectedRun(data.run);
      setRefresh((value) => value + 1);
      toast.success("Checkpoint portable ajouté à la file : les étapes certifiées ne seront pas relancées.");
    } catch (caught) { toast.error(errorMessage(caught)); }
    finally { setResumingPortableCheckpoint(false); }
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
      if (selectedSequenceId === sequence.id) {
        setSelectedSequenceId(null);
        setSelectedRunIdForView(null);
      }
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
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2 mb-2"
                onClick={() => {
                  setSelectedSequenceId(null);
                  setSelectedRunIdForView(null);
                }}
              >
                <ArrowLeftIcon />Toutes les Sequences
              </Button>
              <div className="flex flex-wrap items-center gap-2.5">
                <FrameTitle className="text-base">{selectedSequence.name}</FrameTitle>
                {displayRun && (
                  <RunStatusBadge status={displayRun.status} />
                )}
              </div>
              <FrameDescription>
                {selectedSequence.steps.length} étape{selectedSequence.steps.length !== 1 ? "s" : ""} · {selectedSequence.pullRequestStrategy === "after_each_step" ? "une PR empilée par étape avec commit" : selectedSequence.pullRequestStrategy === "independent_after_each_step" ? "une PR indépendante par étape" : "une PR après la Sequence"}
              </FrameDescription>
              {canResumeDisplayRun && displayRun && (
                <p className="mt-1 text-xs text-success">
                  Reprise locale recommandée : l’étape échouée reprendra dans son worktree préservé. Le checkpoint distant reste destiné à un autre ordinateur.
                </p>
              )}
              {!canResumeDisplayRun && continuationSource && (
                <p className="mt-1 text-xs text-success">
                  {retainedStepCount === 1 ? "Une étape déjà réussie sera conservée." : `${retainedStepCount} étapes déjà réussies seront conservées.`} {continuationStepCount === 1
                    ? "Une nouvelle étape sera exécutée."
                    : `${continuationStepCount} nouvelles étapes seront exécutées.`}
                </p>
              )}
              {portableCheckpoint && portableCheckpoint.status !== "SUCCESS" && (
                <p className="mt-1 text-xs text-info">
                  Checkpoint portable : {portableCheckpoint.steps.filter((step) => step.status === "SUCCESS").length}/{portableCheckpoint.steps.length} étapes certifiées · {formatRunDate(portableCheckpoint.updatedAt)}.
                </p>
              )}
              {portableCheckpointError && <p className="mt-1 text-xs text-destructive">Checkpoint portable indisponible : {portableCheckpointError}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {canResumeDisplayRun && displayRun ? (
                <Button
                  disabled={resumingRunId === displayRun.id || selectedHasActiveRun}
                  onClick={() => void resumeSequence(displayRun.id)}
                >
                  {resumingRunId === displayRun.id ? <Loader2Icon className="animate-spin" /> : <RotateCcwIcon />}
                  Reprendre l’étape échouée
                </Button>
              ) : (
                <Button
                  variant={selectedHasActiveRun ? "secondary" : "default"}
                  disabled={!!starting || !selectedSequence.steps.length || selectedHasActiveRun}
                  onClick={() => void runSequence(selectedSequence.id)}
                >
                  {starting === selectedSequence.id ? (
                    <Loader2Icon className="animate-spin" />
                  ) : selectedHasActiveRun ? (
                    <Loader2Icon className="animate-spin text-info" />
                  ) : (
                    <PlayIcon />
                  )}
                  {selectedHasActiveRun ? "En cours" : continuationSource ? `Exécuter ${continuationStepCount} nouvelle${continuationStepCount > 1 ? "s" : ""} étape${continuationStepCount > 1 ? "s" : ""}` : "Exécuter"}
                </Button>
              )}
              {!canResumeDisplayRun && portableCheckpoint && portableCheckpoint.status !== "SUCCESS" && (
                <Button
                  variant="outline"
                  disabled={selectedHasActiveRun || !!starting || resumingPortableCheckpoint}
                  onClick={() => void resumePortableCheckpoint()}
                >
                  {resumingPortableCheckpoint ? <Loader2Icon className="animate-spin" /> : <RotateCcwIcon />}
                  Reprendre le checkpoint distant
                </Button>
              )}
              <Button variant="outline" disabled={selectedHasActiveRun || !!definitionError} onClick={() => setSequenceEditor(selectedSequence)}>
                <PencilIcon />Configurer
              </Button>
              <Button variant="outline" disabled={selectedHasActiveRun || !!definitionError} onClick={() => setStepEditor(null)}>
                <PlusIcon />Ajouter une étape
              </Button>
            </div>
          </FrameHeader>

          <FramePanel className="p-0">
            {displayRun ? (
              <div className="border-b bg-muted/15 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold">
                      {activeSequenceRun ? "Progression en cours" : "Dernière exécution"}
                    </span>
                    <RunStatusBadge status={displayRun.status} />
                    <RunIdCopy
                      id={displayRun.id}
                      displayText={displayRun.id.slice(0, 8)}
                      className="text-xs text-muted-foreground"
                    />
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">
                      {formatRunDate(displayRun.startedAt || displayRun.queuedAt)}
                      {displayRun.completedAt ? ` → ${formatRunDate(displayRun.completedAt)}` : ""}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {completedStepsCount} / {selectedSequence.steps.length} réussie{completedStepsCount > 1 ? "s" : ""}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-xs"
                      onClick={() => openRunInspector(displayRun)}
                    >
                      <EyeIcon className="size-3" />
                      Ouvrir l’inspecteur
                    </Button>
                  </div>
                </div>

                {selectedSequence.steps.length > 0 && (
                  <div className="mt-3">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
                      <div
                        className={cn(
                          "h-full transition-all duration-500",
                          displayRun.status === "SUCCESS"
                            ? "bg-success"
                            : hasFailedStep
                              ? "bg-destructive"
                              : isActiveRun(displayRun.status)
                                ? "bg-info animate-pulse"
                                : "bg-primary",
                        )}
                        style={{
                          width: `${Math.round((completedStepsCount / selectedSequence.steps.length) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {selectedHasActiveRun && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    La définition est verrouillée pendant son exécution afin que l’ordre et les instructions restent stables.
                  </p>
                )}
              </div>
            ) : selectedHasActiveRun ? (
              <p className="border-b bg-info/5 px-4 py-3 text-xs text-muted-foreground">
                La définition est verrouillée pendant son exécution afin que l’ordre et les instructions restent stables.
              </p>
            ) : null}

            {!selectedSequence.steps.length ? (
              <div className="flex flex-col items-center gap-3 p-12 text-center">
                <ListOrderedIcon className="size-8 text-muted-foreground" />
                <h3 className="text-sm font-medium">Ajoutez la première étape</h3>
                <p className="max-w-md text-sm text-muted-foreground">Chaque étape possède ses propres instructions. Elle ne crée ni ne référence aucune Task.</p>
                <Button variant="outline" onClick={() => setStepEditor(null)}><PlusIcon />Créer une étape</Button>
              </div>
            ) : (
              <ol className="divide-y">
                {selectedSequence.steps.map((step, index) => {
                  const stepRun = displayStepRuns.find((candidate) => candidate.stepId === step.id) ?? null;
                  const isRunning = stepRun ? isActiveRun(stepRun.status) : false;
                  const isSuccess = stepRun?.status === "SUCCESS";
                  const isFailed = stepRun?.status === "FAILED";
                  const isSkipped = stepRun?.status === "SKIPPED";
                  const isCancelled = stepRun?.status === "CANCELLED";

                  return (
                    <li
                      key={step.id}
                      className={cn(
                        "flex items-start gap-3 p-4 transition-colors",
                        isRunning && "border-l-2 border-l-info bg-info/5",
                        isFailed && "border-l-2 border-l-destructive bg-destructive/5",
                        isSuccess && "hover:bg-muted/20",
                        !stepRun && "hover:bg-muted/20",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-xs transition-colors",
                          isRunning && "bg-info/20 font-bold text-info ring-2 ring-info/30 ring-offset-1 animate-pulse",
                          isSuccess && "bg-success/20 font-semibold text-success",
                          isFailed && "bg-destructive/20 font-semibold text-destructive",
                          (isSkipped || isCancelled) && "bg-muted text-muted-foreground/60 line-through",
                          !stepRun && "bg-muted text-muted-foreground",
                        )}
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <button
                            type="button"
                            className="min-w-0 text-left outline-none hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring disabled:hover:no-underline"
                            disabled={selectedHasActiveRun}
                            onClick={() => setStepEditor(step)}
                          >
                            <span className="block break-words text-sm font-medium">{step.name}</span>
                          </button>
                          <div className="flex items-center gap-2">
                            {stepRun && <RunStatusBadge status={stepRun.status} />}
                          </div>
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <code className="text-xs text-muted-foreground">{step.id}</code>
                          <Badge tone={step.expectChanges ? "secondary" : "outline"}>
                            {step.expectChanges ? "Diff requis" : "Analyse permise"}
                          </Badge>
                        </div>

                        {stepRun && (
                          <div className="mt-2 space-y-1 text-xs">
                            {(stepRun.startedAt || stepRun.completedAt) && (
                              <p className="flex items-center gap-1.5 text-muted-foreground">
                                <ClockIcon className="size-3 shrink-0" />
                                <span>
                                  {formatRunDate(stepRun.startedAt)}
                                  {stepRun.completedAt ? ` → ${formatRunDate(stepRun.completedAt)}` : ""}
                                </span>
                              </p>
                            )}

                            {stepRun.commitHash && (
                              <p className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                                <GitCommitIcon className="size-3.5 shrink-0" />
                                <span className="break-all">Commit {stepRun.commitHash}</span>
                              </p>
                            )}

                            {stepRun.publicationBranch && (
                              <p className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                                <GitBranchIcon className="size-3.5 shrink-0" />
                                <span className="break-all">Branche {stepRun.publicationBranch}</span>
                              </p>
                            )}

                            {stepRun.error && (
                              <p className="mt-1.5 break-words rounded bg-destructive/10 p-2 text-xs text-destructive">
                                {stepRun.error}
                              </p>
                            )}

                            {stepRun.pullRequestUrl && (
                              <a
                                href={stepRun.pullRequestUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
                              >
                                Ouvrir la PR de l’étape <ExternalLinkIcon className="size-3" />
                              </a>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        {displayRun && stepRun && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => openStepInspector(displayRun, stepRun)}
                            aria-label={`Inspecter l’exécution de ${step.name}`}
                            title="Ouvrir l’inspecteur"
                          >
                            <EyeIcon />
                          </Button>
                        )}
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          disabled={selectedHasActiveRun || !!mutating || index === 0}
                          onClick={() => void reorderStep(index, -1)}
                          aria-label={`Monter ${step.name}`}
                          title="Monter"
                        >
                          <ArrowUpIcon />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          disabled={selectedHasActiveRun || !!mutating || index === selectedSequence.steps.length - 1}
                          onClick={() => void reorderStep(index, 1)}
                          aria-label={`Descendre ${step.name}`}
                          title="Descendre"
                        >
                          <ArrowDownIcon />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          disabled={selectedHasActiveRun || !!mutating}
                          onClick={() => setStepEditor(step)}
                          aria-label={`Modifier ${step.name}`}
                          title="Modifier"
                        >
                          <PencilIcon />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          disabled={selectedHasActiveRun || !!mutating}
                          onClick={() => void deleteStep(step)}
                          aria-label={`Supprimer ${step.name}`}
                          title="Supprimer"
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    </li>
                  );
                })}
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
                    const lastStepRuns = last ? (stepRunsByRunId.get(last.id) ?? []) : [];
                    const lastCompletedSteps = lastStepRuns.filter((sr) => sr.status === "SUCCESS").length;

                    return (
                      <tr key={sequence.id} className="hover:bg-muted/20">
                        <th scope="row" className="min-w-52 p-4 font-normal">
                          <button
                            className="text-left outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => {
                              setSelectedSequenceId(sequence.id);
                              setSelectedRunIdForView(null);
                            }}
                          >
                            <span className="block font-medium">{sequence.name}</span>
                            <code className="mt-1 block text-xs text-muted-foreground">{sequence.id}</code>
                          </button>
                        </th>
                        <td className="p-4">
                          <span className="font-medium">{sequence.steps.length}</span>
                          <span className="ml-1 text-xs text-muted-foreground">étape{sequence.steps.length !== 1 ? "s" : ""}</span>
                        </td>
                        <td className="p-4">
                          {last ? (
                            <button
                              className="text-left outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() => {
                                setSelectedSequenceId(sequence.id);
                                setSelectedRunIdForView(last.id);
                              }}
                            >
                              <div className="flex flex-wrap items-center gap-1.5">
                                <RunStatusBadge status={last.status} />
                                {lastStepRuns.length > 0 && (
                                  <span className="text-xs text-muted-foreground">
                                    ({lastCompletedSteps}/{lastStepRuns.length})
                                  </span>
                                )}
                              </div>
                              <span className="mt-1 block text-xs text-muted-foreground">
                                {formatRunDate(last.startedAt || last.queuedAt)}
                              </span>
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground">Jamais exécutée</span>
                          )}
                        </td>
                        <td className="p-4">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!!starting || !sequence.steps.length || active}
                              onClick={() => void runSequence(sequence.id)}
                            >
                              {starting === sequence.id ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
                              {active ? "En cours" : "Exécuter"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setSelectedSequenceId(sequence.id);
                                setSelectedRunIdForView(null);
                              }}
                            >
                              Ouvrir
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              disabled={active || !!mutating}
                              onClick={() => void deleteSequence(sequence)}
                              aria-label={`Supprimer ${sequence.name}`}
                              title="Supprimer"
                            >
                              <Trash2Icon />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            )}
          </FramePanel>
        </Frame>
      )}

      <Frame stacked spacing="sm">
        <FrameHeader>
          <FrameTitle>Historique des Sequences</FrameTitle>
          <FrameDescription>
            {selectedSequence
              ? `Runs de « ${selectedSequence.name} » et récents · actualisation toutes les 3 secondes`
              : "Runs récents · actualisation toutes les 3 secondes"}
          </FrameDescription>
        </FrameHeader>
        <FramePanel className="p-0">
          {runError && <p role="alert" className="border-b bg-destructive/5 p-4 text-sm text-destructive">{runError} Nouvelle tentative automatique…</p>}
          {!runs.length ? (
            <p className="p-6 text-sm text-muted-foreground">{loading ? "Chargement…" : "Aucune Sequence exécutée."}</p>
          ) : (
            <ul className="max-h-[28rem] divide-y overflow-y-auto">
              {runs.map((run) => {
                const isCurrentSequence = selectedSequence && (run.sequenceId || run.taskId) === selectedSequence.id;
                const isCurrentlyDisplayed = selectedSequence && displayRun?.id === run.id;
                const runStepRuns = stepRunsByRunId.get(run.id) ?? [];
                const runCompletedSteps = runStepRuns.filter((sr) => sr.status === "SUCCESS").length;

                return (
                  <li
                    key={run.id}
                    className={cn(
                      "flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/30",
                      isCurrentlyDisplayed && "border-l-2 border-l-primary bg-muted/15",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedRun(run)}
                      className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <span className="block break-words text-sm font-medium">
                        {run.taskName || run.sequenceId}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>
                          {formatRunDate(run.startedAt || run.queuedAt)} · Run <span className="font-mono">{run.id.slice(0, 8)}</span>
                        </span>
                        {runStepRuns.length > 0 && (
                          <span className="font-medium text-foreground/80">
                            · {runCompletedSteps}/{runStepRuns.length} étape{runStepRuns.length > 1 ? "s" : ""}
                          </span>
                        )}
                      </span>
                    </button>

                    <div className="flex shrink-0 items-center gap-2">
                      {isCurrentSequence && !isCurrentlyDisplayed && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => setSelectedRunIdForView(run.id)}
                        >
                          Afficher sur la page
                        </Button>
                      )}
                      {isCurrentlyDisplayed && (
                        <Badge tone="neutral" variant="dot-outline" className="text-[10px]">
                          Affiché
                        </Badge>
                      )}
                      <button
                        type="button"
                        onClick={() => setSelectedRun(run)}
                        className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded"
                      >
                        <RunStatusBadge status={run.status} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </FramePanel>
      </Frame>

      {sequenceEditor !== undefined && <SequenceEditorDialog sequence={sequenceEditor} onClose={() => setSequenceEditor(undefined)} onSave={saveSequence} />}
      {stepEditor !== undefined && <SequenceStepEditorDialog step={stepEditor} onClose={() => setStepEditor(undefined)} onSave={saveStep} />}
      {selectedRun && <TaskRunSheet key={`${selectedRun.id}:${selectedStepRun?.id ?? "run"}`} projectId={project.id} initialRun={selectedRun}
        initialSequenceStep={selectedStepRun}
        rerunning={starting === (selectedRun.sequenceId || selectedRun.taskId)}
        resuming={resumingRunId === selectedRun.id}
        onRerun={sequences.some((sequence) => sequence.id === (selectedRun.sequenceId || selectedRun.taskId))
          ? () => void runSequence(selectedRun.sequenceId || selectedRun.taskId) : undefined}
        onResume={() => void resumeSequence(selectedRun.id)}
        onClose={() => { setSelectedRun(null); setSelectedStepRun(null); setRefresh((value) => value + 1); }} />}
    </div>
  );
}
