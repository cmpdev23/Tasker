"use client";

import { useEffect, useRef, useState } from "react";
import type { Project, Run } from "@db/schema";
import type { TaskDefinition, TaskInput } from "@/types/tasks";
import type { RunQueueStatus } from "@/types/run-queue";
import { AlertCircleIcon, GitBranchIcon, ListTodoIcon, Loader2Icon, PencilIcon, PlayIcon, PlusIcon, RotateCcwIcon, SettingsIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { TaskEditorDialog } from "@/components/task-editor-dialog";
import { RunStatusBadge, TaskRunSheet } from "@/components/task-run-sheet";
import { QueueStatusPanel } from "@/components/run-inspector/queue-status-panel";
import { errorMessage, formatRunDate, isRemovableRun, isRerunnableRun, SCHEDULE_LABELS, taskRequest, WEEKDAYS } from "@/components/task-ui-utils";

function scheduleLabel(task: TaskDefinition) {
  const { type, startsAt, time, timezone, days } = task.schedule;
  if (type === "manual") return "Manuelle";
  if (type === "once") return `${formatRunDate(startsAt, timezone)} · ${timezone}`;
  if (type === "hourly") return `Chaque heure · ${timezone}`;
  const frequency = type === "daily" ? SCHEDULE_LABELS.daily : WEEKDAYS.filter(([day]) => days?.includes(day)).map(([, label]) => label.slice(0, 3)).join(", ");
  return `${frequency} à ${time} · ${timezone}`;
}

function taskState(task: TaskDefinition, last: Run | undefined) {
  switch (last?.status) {
    case "QUEUED": return { label: "Waiting", dotClass: "bg-warning", title: "Run en attente dans la file." };
    case "PREPARING": return { label: "Preparing", dotClass: "bg-info", title: "Préparation du worktree et des dépendances." };
    case "RUNNING": return { label: "Running", dotClass: "bg-info", title: "Codex exécute la tâche." };
    case "VALIDATING": return { label: "Validating", dotClass: "bg-info", title: "Les validations du projet sont en cours." };
    case "CLEANING_UP": return { label: "Cleaning", dotClass: "bg-info", title: "Finalisation de l’exécution en cours." };
  }
  if (!task.enabled) return { label: "Disabled", dotClass: "bg-muted-foreground", title: "La tâche est désactivée." };
  switch (last?.status) {
    case "SUCCESS": return { label: "Ready", dotClass: "bg-success", title: "La dernière exécution a réussi." };
    case "FAILED": return { label: "Failed", dotClass: "bg-destructive", title: "La dernière exécution a échoué." };
    case "CANCELLED": return { label: "Cancelled", dotClass: "bg-muted-foreground", title: "La dernière exécution a été annulée." };
    default: return { label: "Pending", dotClass: "bg-warning", title: "La tâche n’a pas encore été exécutée." };
  }
}

export function ProjectTasksView(props: { project: Project; onNavigateToSettings?: () => void }) {
  // Switching repositories/projects must discard requests and state belonging to the old target.
  return <TasksView key={`${props.project.id}:${props.project.repositoryPath}`} {...props} />;
}

function TasksView({ project, onNavigateToSettings }: { project: Project; onNavigateToSettings?: () => void }) {
  const [tasks, setTasks] = useState<TaskDefinition[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [olderRuns, setOlderRuns] = useState<Run[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [historyEnd, setHistoryEnd] = useState(false);
  const [loading, setLoading] = useState(true);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [queueStatus, setQueueStatus] = useState<RunQueueStatus | null>(null);
  const [recoveringPipeline, setRecoveringPipeline] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [editor, setEditor] = useState<TaskDefinition | null | undefined>(undefined);
  const [deleteTask, setDeleteTask] = useState<TaskDefinition | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [removingRun, setRemovingRun] = useState<string | null>(null);
  const startingRef = useRef(false);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [resolvedBaseBranch, setResolvedBaseBranch] = useState({
    source: project.defaultBranch,
    value: project.defaultBranch || "main",
  });
  const [refresh, setRefresh] = useState(0);
  const baseUrl = `/api/projects/${encodeURIComponent(project.id)}`;
  const baseBranch = resolvedBaseBranch.source === project.defaultBranch
    ? resolvedBaseBranch.value
    : project.defaultBranch || "main";

  // Settings may resolve the branch from .tasker/project.toml, which takes
  // precedence over the value cached on the Project record.
  useEffect(() => {
    if (!project.repositoryPath) return;
    const controller = new AbortController();
    const branchSource = project.defaultBranch;
    void taskRequest<{ effectiveDefaultBranch?: string }>(baseUrl + "/git", { signal: controller.signal })
      .then((data) => {
        if (data.effectiveDefaultBranch) {
          setResolvedBaseBranch({ source: branchSource, value: data.effectiveDefaultBranch });
        }
      })
      .catch(() => {
        // The task list remains usable when Git inspection is unavailable.
      });
    return () => controller.abort();
  }, [baseUrl, project.defaultBranch, project.repositoryPath]);

  useEffect(() => {
    if (!project.repositoryPath) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      const results = await Promise.allSettled([
        taskRequest<{ tasks: TaskDefinition[] }>(baseUrl + "/tasks", { signal: controller.signal }),
        taskRequest<{ runs: Run[]; queue: RunQueueStatus }>(baseUrl + "/runs", { signal: controller.signal }),
      ]);
      if (stopped) return;
      const [taskResult, runResult] = results;
      if (taskResult.status === "fulfilled" && Array.isArray(taskResult.value?.tasks)) { setTasks(taskResult.value.tasks); setTaskError(null); }
      else setTaskError(taskResult.status === "rejected" ? errorMessage(taskResult.reason) : "Réponse de la liste des tâches invalide.");
      if (runResult.status === "fulfilled" && Array.isArray(runResult.value?.runs)) {
        setRuns(runResult.value.runs);
        if (runResult.value.queue) setQueueStatus(runResult.value.queue);
        setRunError(null);
      }
      else setRunError(runResult.status === "rejected" ? errorMessage(runResult.reason) : "Réponse de l’historique invalide.");
      setLoading(false);
      timer = setTimeout(poll, 3000);
    }
    void poll();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [baseUrl, project.repositoryPath, refresh]);

  async function saveTask(payload: TaskInput, id?: string) {
    const data = await taskRequest<{ task: TaskDefinition }>(baseUrl + "/tasks" + (id ? `/${encodeURIComponent(id)}` : ""), {
      method: id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    if (!data?.task?.id) throw new Error("Réponse de sauvegarde invalide. Vérifiez la liste avant de réessayer.");
    setTasks((current) => [...current.filter((task) => task.id !== data.task.id), data.task]);
    setEditor(undefined);
    setRefresh((value) => value + 1);
    toast.success("Tâche enregistrée.");
  }

  async function removeTask() {
    if (!deleteTask?.id || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const data = await taskRequest<{ success: boolean; queue: RunQueueStatus }>(baseUrl + `/tasks/${encodeURIComponent(deleteTask.id)}`, { method: "DELETE" });
      setTasks((current) => current.filter((task) => task.id !== deleteTask.id));
      if (data.queue) setQueueStatus(data.queue);
      setDeleteTask(null);
      setRefresh((value) => value + 1);
      toast.success("Tâche supprimée.");
    } catch (error) { setDeleteError(errorMessage(error)); }
    finally { setDeleting(false); }
  }

  async function runNow(taskId: string) {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(taskId);
    try {
      const data = await taskRequest<{ run: Run }>(baseUrl + `/tasks/${encodeURIComponent(taskId)}/runs`, { method: "POST" });
      if (!data?.run?.id) throw new Error("Réponse du lancement invalide. Vérifiez l’historique avant de relancer.");
      setSelectedRun(data.run);
      setRefresh((value) => value + 1);
    } catch (error) { toast.error(errorMessage(error)); }
    finally { startingRef.current = false; setStarting(null); }
  }

  async function recoverPipeline() {
    const blocker = queueStatus?.blocker;
    if (!blocker || recoveringPipeline || !window.confirm("AgentTasker n’a plus d’identité de processus à vérifier automatiquement. Confirmez que l’ancienne exécution Codex n’est plus en cours, puis reprenez le pipeline.")) return;
    setRecoveringPipeline(true);
    setPipelineError(null);
    try {
      const data = await taskRequest<{ run: Run; queue: RunQueueStatus }>(`/api/projects/${encodeURIComponent(blocker.projectId)}/runs/${encodeURIComponent(blocker.id)}/recover`, { method: "POST" });
      if (data.queue) setQueueStatus(data.queue);
      setRefresh((value) => value + 1);
      toast.success("Pipeline débloqué. Les Runs en attente vont reprendre automatiquement.");
    } catch (error) {
      setPipelineError(errorMessage(error));
    } finally {
      setRecoveringPipeline(false);
    }
  }

  async function removeRun(run: Run) {
    const deleteArtifacts = Boolean(run.worktreePath || run.runBranch);
    const confirmTermination = !run.terminationVerified;
    const label = run.status === "QUEUED"
      ? "Retirer définitivement ce Run de la file ?"
      : confirmTermination
        ? "Supprimer définitivement ce Run bloquant ? En continuant, vous confirmez qu’aucun processus Codex de ce Run n’est encore actif. Son worktree, sa branche et tout travail non intégré seront supprimés. Aucun travail ne sera créé ou relancé."
      : deleteArtifacts
        ? "Supprimer définitivement ce Run, son worktree et sa branche ? Tout travail non intégré sera perdu."
        : "Supprimer définitivement ce Run de l’historique ?";
    if (removingRun || !window.confirm(label)) return;
    setRemovingRun(run.id);
    try {
      const params = new URLSearchParams();
      if (deleteArtifacts) params.set("deleteArtifacts", "true");
      if (confirmTermination) params.set("confirmTermination", "true");
      const query = params.size ? `?${params.toString()}` : "";
      const data = await taskRequest<{ run: Run; queue: RunQueueStatus }>(`${baseUrl}/runs/${encodeURIComponent(run.id)}${query}`, { method: "DELETE" });
      setRuns((current) => current.filter((item) => item.id !== run.id));
      setOlderRuns((current) => current.filter((item) => item.id !== run.id));
      if (data.queue) setQueueStatus(data.queue);
      if (selectedRun?.id === run.id) setSelectedRun(null);
      setRefresh((value) => value + 1);
      toast.success(run.status === "QUEUED" ? "Run retiré de la file." : "Run supprimé de l’historique.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setRemovingRun(null);
    }
  }

  async function removeBlockingRun() {
    const blocker = queueStatus?.blocker;
    if (!blocker || !queueStatus.canRecover || removingRun || !window.confirm(
      "Supprimer définitivement ce Run bloquant ? En continuant, vous confirmez qu’aucun processus Codex de ce Run n’est encore actif. Son worktree, sa branche et tout travail non intégré seront supprimés. Aucun travail ne sera créé ou relancé.",
    )) return;
    setRemovingRun(blocker.id);
    setPipelineError(null);
    try {
      const deleteUrl = `/api/projects/${encodeURIComponent(blocker.projectId)}/runs/${encodeURIComponent(blocker.id)}?deleteArtifacts=true&confirmTermination=true`;
      const data = await taskRequest<{ run: Run; queue: RunQueueStatus }>(deleteUrl, { method: "DELETE" });
      setRuns((current) => current.filter((item) => item.id !== blocker.id));
      setOlderRuns((current) => current.filter((item) => item.id !== blocker.id));
      if (data.queue) setQueueStatus(data.queue);
      if (selectedRun?.id === blocker.id) setSelectedRun(null);
      setRefresh((value) => value + 1);
      toast.success("Run bloquant supprimé. Aucun travail n’a été relancé.");
    } catch (error) {
      setPipelineError(errorMessage(error));
    } finally {
      setRemovingRun(null);
    }
  }

  const mergedRuns = new Map([...olderRuns, ...runs].map((run) => [run.id, run]));
  const orderedRuns = [...mergedRuns.values()].sort((a, b) => Date.parse(b.queuedAt) - Date.parse(a.queuedAt));
  const visibleRuns = orderedRuns;
  const lastRuns = new Map<string, Run>();
  for (const run of orderedRuns) if (!lastRuns.has(run.taskId)) lastRuns.set(run.taskId, run);

  async function loadOlderRuns() {
    if (loadingOlder || !orderedRuns.length) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const before = orderedRuns.reduce((oldest, run) => run.createdAt < oldest ? run.createdAt : oldest, orderedRuns[0].createdAt);
      const data = await taskRequest<{ runs: Run[] }>(`${baseUrl}/runs?before=${encodeURIComponent(before)}`);
      if (!Array.isArray(data?.runs)) throw new Error("Réponse de l’historique invalide.");
      setOlderRuns((current) => [...current, ...data.runs]);
      setHistoryEnd(data.runs.length < 200);
    } catch (error) { setOlderError(errorMessage(error)); }
    finally { setLoadingOlder(false); }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      {queueStatus && ["BLOCKED_RECOVERY", "BLOCKED_PROCESS", "RECOVERY_REQUIRED"].includes(queueStatus.state) && (
        <QueueStatusPanel
          queue={queueStatus}
          recovering={recoveringPipeline}
          deleting={removingRun === queueStatus.blocker?.id}
          error={pipelineError}
          onRecover={queueStatus.blocker ? () => void recoverPipeline() : undefined}
          onDelete={queueStatus.canRecover && queueStatus.blocker ? () => void removeBlockingRun() : undefined}
        />
      )}
      <Frame stacked spacing="sm">
        <FrameHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1"><FrameTitle>Tasks</FrameTitle><FrameDescription>Planifiez le travail de Codex et suivez chaque exécution.</FrameDescription></div>
          <Button variant="light" disabled={!project.repositoryPath || loading || !!taskError} onClick={() => setEditor(null)}><PlusIcon className="size-4" />Créer une tâche</Button>
        </FrameHeader>
        <FramePanel className="p-0">
          {!project.repositoryPath ? <div className="flex flex-col items-center gap-3 p-10 text-center"><AlertCircleIcon className="size-6 text-muted-foreground" /><p className="text-sm">Configurez le repository du projet pour créer des tâches.</p>{onNavigateToSettings && <Button variant="outline" onClick={onNavigateToSettings}><SettingsIcon className="size-4" />Ouvrir Settings</Button>}</div> : <>
            <div className="p-4 pb-3">
              <div className="rounded-lg border border-border/40 bg-muted/20 px-3.5 py-2 text-xs text-muted-foreground">
                <span className="font-medium">Repository : </span>
                <span className="break-all font-mono">{project.repositoryPath}</span>
              </div>
            </div>
            {taskError && <div role="alert" className="mx-4 mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm"><p className="flex-1 text-destructive">{taskError}{tasks.length > 0 && " La liste affichée peut être obsolète."}</p><Button size="sm" variant="outline" onClick={() => setRefresh((value) => value + 1)}>Réessayer</Button>{onNavigateToSettings && <Button size="sm" variant="outline" onClick={onNavigateToSettings}>Settings</Button>}</div>}
            {loading ? <div role="status" className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground"><Loader2Icon className="size-5 animate-spin" />Chargement des tâches…</div> : tasks.length === 0 ? !taskError && <div className="flex flex-col items-center gap-3 p-12 text-center"><ListTodoIcon className="size-8 text-muted-foreground" /><h3 className="text-sm font-medium">Votre première tâche</h3><p className="max-w-sm text-sm text-muted-foreground">Décrivez un travail à réaliser, puis lancez-le manuellement ou selon une planification.</p><Button variant="outline" onClick={() => setEditor(null)}><PlusIcon className="size-4" />Créer une tâche</Button></div> : <div className="overflow-x-auto">
              <table className="w-full text-left text-sm"><caption className="sr-only">Tâches du projet, planification et dernière exécution</caption><thead className="border-b border-border/40 text-xs text-muted-foreground"><tr><th scope="col" className="px-4 py-1.5 font-medium">Tâche</th><th scope="col" className="px-4 py-1.5 font-medium">Planification</th><th scope="col" className="px-4 py-1.5 font-medium">Dernier Run</th><th scope="col" className="px-4 py-1.5 text-right font-medium">Actions</th></tr></thead><tbody className="divide-y divide-border/40">{tasks.map((task) => {
                const last = lastRuns.get(task.id);
                const state = taskState(task, last);
                return <tr key={task.id} className="align-middle hover:bg-muted/15">
                  <th scope="row" className="min-w-44 px-4 py-2.5 font-normal"><span className="block font-medium text-foreground">{task.name}</span><code className="block text-xs font-mono text-muted-foreground">{task.id}</code>{!task.enabled && <Badge className="mt-1" variant="secondary">Désactivée</Badge>}</th>
                  <td className="min-w-40 px-4 py-2.5 text-xs leading-normal">{scheduleLabel(task)}{task.schedule.startsAt && task.schedule.type !== "once" && task.schedule.type !== "manual" && <span className="mt-0.5 block text-muted-foreground">À partir du {formatRunDate(task.schedule.startsAt, task.schedule.timezone)}</span>}</td>
                  <td className="min-w-36 px-4 py-2.5">{last ? <button type="button" className="rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setSelectedRun(last)} aria-label={`Ouvrir le dernier Run de ${task.name}`}><RunStatusBadge status={last.status} /><span className="mt-1 block text-xs text-muted-foreground">{formatRunDate(last.startedAt || last.queuedAt)}</span></button> : <span className="text-xs text-muted-foreground">{runError ? "Indisponible" : runs.length >= 200 && !historyEnd ? "Aucun Run récent" : "Jamais exécutée"}</span>}</td>
                  <td className="min-w-72 px-4 py-2.5">
                    <ButtonGroup className="ml-auto !w-72 shrink-0">
                      <ButtonGroupText className="h-8 min-w-0 flex-1 gap-2 border-border bg-muted/30 px-2.5 text-sm" title={`Base branch : ${baseBranch}`}>
                        <GitBranchIcon className="size-4" />
                        <span className="truncate font-mono">{baseBranch}</span>
                      </ButtonGroupText>
                      <ButtonGroupText className="h-8 w-26 shrink-0 gap-2 border-border bg-background px-2.5 text-sm" title={state.title}>
                        <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${state.dotClass}`} />
                        <span className="truncate">{state.label}</span>
                      </ButtonGroupText>
                      <Button type="button" size="icon" variant="outline" disabled={!!starting || !!taskError} onClick={() => runNow(task.id)} aria-label={`${isRerunnableRun(last?.status ?? "") ? "Réexécuter" : "Exécuter"} ${task.name}`} title={isRerunnableRun(last?.status ?? "") ? "Réexécuter" : "Exécuter"}>
                        {starting === task.id ? <Loader2Icon className="size-4 animate-spin" /> : isRerunnableRun(last?.status ?? "") ? <RotateCcwIcon className="size-4" /> : <PlayIcon className="size-4" />}
                      </Button>
                      <Button type="button" size="icon" variant="outline" aria-label={`Modifier ${task.name}`} title="Modifier" disabled={!!taskError} onClick={() => setEditor(task)}><PencilIcon className="size-4" /></Button>
                      <Button type="button" size="icon" variant="outline" className="hover:bg-destructive/10 hover:text-destructive" aria-label={`Supprimer ${task.name}`} title="Supprimer" disabled={!!taskError} onClick={() => { setDeleteError(null); setDeleteTask(task); }}><Trash2Icon className="size-4" /></Button>
                    </ButtonGroup>
                  </td>
                </tr>;
              })}</tbody></table>
            </div>}
          </>}
        </FramePanel>
      </Frame>
      {project.repositoryPath && <Frame stacked spacing="sm" id="task-run-history">
        <FrameHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between"><div><FrameTitle>Historique des Runs</FrameTitle><FrameDescription>Toutes les exécutions du projet · actualisation toutes les 3 s</FrameDescription></div></FrameHeader>
        <FramePanel className="p-0">
          {runError && <p role="alert" className="border-b bg-destructive/5 p-4 text-sm text-destructive">{runError} Nouvelle tentative automatique…</p>}
          {loading ? <p role="status" className="p-6 text-sm text-muted-foreground">Chargement de l’historique…</p> : !visibleRuns.length ? <p className="p-6 text-sm text-muted-foreground">{runError ? "Historique indisponible." : "Aucune exécution dans l’historique chargé."}</p> : <ul className="max-h-[32rem] divide-y overflow-y-auto">{visibleRuns.map((run) => {
            const taskExists = tasks.some((task) => task.id === run.taskId);
            return <li key={run.id} className="flex items-center gap-2 pr-4 transition-colors hover:bg-muted/30">
              <button type="button" onClick={() => setSelectedRun(run)} className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3 px-4 py-3 pr-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{run.taskName || run.taskId}</span><span className="mt-1 block text-xs text-muted-foreground">{formatRunDate(run.startedAt || run.queuedAt)}</span><span className="mt-1 block break-all font-mono text-xs text-muted-foreground">{run.id}</span></span><RunStatusBadge status={run.status} />
              </button>
              {isRerunnableRun(run.status) && taskExists && <Button type="button" size="sm" variant="outline" disabled={!!starting || !!taskError} onClick={() => void runNow(run.taskId)} title="Créer un nouveau Run avec la configuration actuelle">{starting === run.taskId ? <Loader2Icon className="size-4 animate-spin" /> : <RotateCcwIcon className="size-4" />}Réexécuter</Button>}
              {isRemovableRun(run) && <Button type="button" size="icon-sm" variant="ghost" disabled={!!removingRun} onClick={() => void removeRun(run)} aria-label={run.status === "QUEUED" ? `Retirer le Run ${run.id} de la file` : `Supprimer le Run ${run.id}`} title={run.status === "QUEUED" ? "Retirer de la file" : run.worktreePath || run.runBranch ? "Supprimer le Run et son travail préservé" : "Supprimer de l’historique"}>{removingRun === run.id ? <Loader2Icon className="size-4 animate-spin" /> : <Trash2Icon className="size-4" />}</Button>}
            </li>;
          })}</ul>}
          {olderError && <p role="alert" className="px-4 py-3 text-sm text-destructive">{olderError}</p>}
          {runs.length >= 200 && !historyEnd && <div className="border-t p-3"><Button variant="outline" size="sm" disabled={loadingOlder} onClick={loadOlderRuns}>{loadingOlder && <Loader2Icon className="size-4 animate-spin" />}Charger les Runs précédents</Button></div>}
        </FramePanel>
      </Frame>}
      {editor !== undefined && <TaskEditorDialog task={editor} onClose={() => setEditor(undefined)} onSave={saveTask} />}
      {selectedRun && <TaskRunSheet key={selectedRun.id} projectId={project.id} initialRun={selectedRun} rerunning={starting === selectedRun.taskId} onRerun={tasks.some((task) => task.id === selectedRun.taskId) ? () => void runNow(selectedRun.taskId) : undefined} onClose={() => { setSelectedRun(null); setRefresh((value) => value + 1); }} />}
      <Dialog open={!!deleteTask} onOpenChange={(open) => { if (!open && !deleting) setDeleteTask(null); }}>
        <DialogContent showCloseButton={!deleting}>
          <DialogHeader><DialogTitle>Supprimer la tâche ?</DialogTitle><DialogDescription>La définition de « {deleteTask?.name} » sera supprimée du repository. L’historique des Runs reste consultable.</DialogDescription></DialogHeader>
          {deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}
          <DialogFooter><Button variant="outline" disabled={deleting} onClick={() => setDeleteTask(null)}>Conserver</Button><Button variant="destructive" disabled={deleting} onClick={removeTask}>{deleting && <Loader2Icon className="size-4 animate-spin" />}Supprimer la tâche</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
