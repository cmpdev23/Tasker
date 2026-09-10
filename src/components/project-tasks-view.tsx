"use client";

import { useEffect, useRef, useState } from "react";
import type { Project, Run } from "@db/schema";
import type { TaskDefinition, TaskInput } from "@/types/tasks";
import { AlertCircleIcon, HistoryIcon, ListTodoIcon, Loader2Icon, PencilIcon, PlayIcon, PlusIcon, SettingsIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { TaskEditorDialog } from "@/components/task-editor-dialog";
import { RunStatusBadge, TaskRunSheet } from "@/components/task-run-sheet";
import { errorMessage, formatRunDate, SCHEDULE_LABELS, taskRequest, WEEKDAYS } from "@/components/task-ui-utils";

function scheduleLabel(task: TaskDefinition) {
  const { type, startsAt, time, timezone, days } = task.schedule;
  if (type === "manual") return "Manuelle";
  if (type === "once") return `${formatRunDate(startsAt, timezone)} · ${timezone}`;
  if (type === "hourly") return `Chaque heure · ${timezone}`;
  const frequency = type === "daily" ? SCHEDULE_LABELS.daily : WEEKDAYS.filter(([day]) => days?.includes(day)).map(([, label]) => label.slice(0, 3)).join(", ");
  return `${frequency} à ${time} · ${timezone}`;
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
  const [editor, setEditor] = useState<TaskDefinition | null | undefined>(undefined);
  const [deleteTask, setDeleteTask] = useState<TaskDefinition | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const startingRef = useRef(false);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [historyTask, setHistoryTask] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const baseUrl = `/api/projects/${encodeURIComponent(project.id)}`;

  useEffect(() => {
    if (!project.repositoryPath) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      const results = await Promise.allSettled([
        taskRequest<{ tasks: TaskDefinition[] }>(baseUrl + "/tasks", { signal: controller.signal }),
        taskRequest<{ runs: Run[] }>(baseUrl + "/runs", { signal: controller.signal }),
      ]);
      if (stopped) return;
      const [taskResult, runResult] = results;
      if (taskResult.status === "fulfilled" && Array.isArray(taskResult.value?.tasks)) { setTasks(taskResult.value.tasks); setTaskError(null); }
      else setTaskError(taskResult.status === "rejected" ? errorMessage(taskResult.reason) : "Réponse de la liste des tâches invalide.");
      if (runResult.status === "fulfilled" && Array.isArray(runResult.value?.runs)) { setRuns(runResult.value.runs); setRunError(null); }
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
      await taskRequest(baseUrl + `/tasks/${encodeURIComponent(deleteTask.id)}`, { method: "DELETE" });
      setTasks((current) => current.filter((task) => task.id !== deleteTask.id));
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

  const mergedRuns = new Map([...olderRuns, ...runs].map((run) => [run.id, run]));
  const orderedRuns = [...mergedRuns.values()].sort((a, b) => Date.parse(b.queuedAt) - Date.parse(a.queuedAt));
  const visibleRuns = orderedRuns.filter((run) => !historyTask || run.taskId === historyTask);
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
      <Frame stacked spacing="sm">
        <FrameHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1"><FrameTitle>Tasks</FrameTitle><FrameDescription>Planifiez le travail de Codex et suivez chaque exécution.</FrameDescription></div>
          <Button disabled={!project.repositoryPath || loading || !!taskError} onClick={() => setEditor(null)}><PlusIcon className="size-4" />Créer une tâche</Button>
        </FrameHeader>
        <FramePanel className="p-0">
          {!project.repositoryPath ? <div className="flex flex-col items-center gap-3 p-10 text-center"><AlertCircleIcon className="size-6 text-muted-foreground" /><p className="text-sm">Configurez le repository du projet pour créer des tâches.</p>{onNavigateToSettings && <Button variant="outline" onClick={onNavigateToSettings}><SettingsIcon className="size-4" />Ouvrir Settings</Button>}</div> : <>
            <div className="border-b px-4 py-3 text-xs text-muted-foreground"><span className="font-medium">Repository : </span><span className="break-all font-mono">{project.repositoryPath}</span></div>
            {taskError && <div role="alert" className="flex flex-wrap items-center gap-3 border-b bg-destructive/5 p-4 text-sm"><p className="flex-1 text-destructive">{taskError}{tasks.length > 0 && " La liste affichée peut être obsolète."}</p><Button size="sm" variant="outline" onClick={() => setRefresh((value) => value + 1)}>Réessayer</Button>{onNavigateToSettings && <Button size="sm" variant="outline" onClick={onNavigateToSettings}>Settings</Button>}</div>}
            {loading ? <div role="status" className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground"><Loader2Icon className="size-5 animate-spin" />Chargement des tâches…</div> : tasks.length === 0 ? !taskError && <div className="flex flex-col items-center gap-3 p-12 text-center"><ListTodoIcon className="size-8 text-muted-foreground" /><h3 className="text-sm font-medium">Votre première tâche</h3><p className="max-w-sm text-sm text-muted-foreground">Décrivez un travail à réaliser, puis lancez-le manuellement ou selon une planification.</p><Button variant="outline" onClick={() => setEditor(null)}><PlusIcon className="size-4" />Créer une tâche</Button></div> : <div className="overflow-x-auto">
              <table className="w-full text-left text-sm"><caption className="sr-only">Tâches du projet, planification et dernière exécution</caption><thead className="border-b bg-muted/20 text-xs text-muted-foreground"><tr><th scope="col" className="p-4 font-medium">Tâche</th><th scope="col" className="p-4 font-medium">Planification</th><th scope="col" className="p-4 font-medium">Dernier Run</th><th scope="col" className="p-4 text-right font-medium">Actions</th></tr></thead><tbody className="divide-y">{tasks.map((task) => {
                const last = lastRuns.get(task.id);
                return <tr key={task.id} className="align-top hover:bg-muted/20">
                  <th scope="row" className="min-w-44 p-4 font-normal"><span className="block font-medium">{task.name}</span><code className="mt-1 block text-xs text-muted-foreground">{task.id}</code>{!task.enabled && <Badge className="mt-2" variant="secondary">Désactivée</Badge>}</th>
                  <td className="min-w-40 p-4 text-xs leading-relaxed">{scheduleLabel(task)}{task.schedule.startsAt && task.schedule.type !== "once" && task.schedule.type !== "manual" && <span className="mt-1 block text-muted-foreground">À partir du {formatRunDate(task.schedule.startsAt, task.schedule.timezone)}</span>}</td>
                  <td className="min-w-36 p-4">{last ? <button type="button" className="rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setSelectedRun(last)} aria-label={`Ouvrir le dernier Run de ${task.name}`}><RunStatusBadge status={last.status} /><span className="mt-2 block text-xs text-muted-foreground">{formatRunDate(last.startedAt || last.queuedAt)}</span></button> : <span className="text-xs text-muted-foreground">{runError ? "Indisponible" : runs.length >= 200 && !historyEnd ? "Aucun Run récent" : "Jamais exécutée"}</span>}</td>
                  <td className="p-4"><div className="flex justify-end gap-1"><Button size="sm" variant="outline" disabled={!!starting || !!taskError} onClick={() => runNow(task.id)}>{starting === task.id ? <Loader2Icon className="size-4 animate-spin" /> : <PlayIcon className="size-4" />}Exécuter</Button><Button size="icon-sm" variant="ghost" aria-label={`Historique de ${task.name}`} title="Historique" onClick={() => { setHistoryTask(task.id); document.getElementById("task-run-history")?.scrollIntoView({ block: "start", behavior: "smooth" }); }}><HistoryIcon className="size-4" /></Button><Button size="icon-sm" variant="ghost" aria-label={`Modifier ${task.name}`} title="Modifier" disabled={!!taskError} onClick={() => setEditor(task)}><PencilIcon className="size-4" /></Button><Button size="icon-sm" variant="ghost" aria-label={`Supprimer ${task.name}`} title="Supprimer" disabled={!!taskError} onClick={() => { setDeleteError(null); setDeleteTask(task); }}><Trash2Icon className="size-4" /></Button></div></td>
                </tr>;
              })}</tbody></table>
            </div>}
          </>}
        </FramePanel>
      </Frame>
      {project.repositoryPath && <Frame stacked spacing="sm" id="task-run-history">
        <FrameHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between"><div><FrameTitle>Historique des Runs</FrameTitle><FrameDescription>{historyTask ? `Tâche : ${tasks.find((task) => task.id === historyTask)?.name || historyTask}` : "Toutes les exécutions du projet · actualisation toutes les 3 s"}</FrameDescription></div>{historyTask && <Button size="sm" variant="outline" onClick={() => setHistoryTask(null)}>Toutes les tâches</Button>}</FrameHeader>
        <FramePanel className="p-0">
          {runError && <p role="alert" className="border-b bg-destructive/5 p-4 text-sm text-destructive">{runError} Nouvelle tentative automatique…</p>}
          {loading ? <p role="status" className="p-6 text-sm text-muted-foreground">Chargement de l’historique…</p> : !visibleRuns.length ? <p className="p-6 text-sm text-muted-foreground">{runError ? "Historique indisponible." : "Aucune exécution dans l’historique chargé."}</p> : <ul className="max-h-[32rem] divide-y overflow-y-auto">{visibleRuns.map((run) => <li key={run.id}><button type="button" onClick={() => setSelectedRun(run)} className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"><span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{run.taskName || run.taskId}</span><span className="mt-1 block text-xs text-muted-foreground">{formatRunDate(run.startedAt || run.queuedAt)}</span><span className="mt-1 block break-all font-mono text-xs text-muted-foreground">{run.id}</span></span><RunStatusBadge status={run.status} /></button></li>)}</ul>}
          {olderError && <p role="alert" className="px-4 py-3 text-sm text-destructive">{olderError}</p>}
          {runs.length >= 200 && !historyEnd && <div className="border-t p-3"><Button variant="outline" size="sm" disabled={loadingOlder} onClick={loadOlderRuns}>{loadingOlder && <Loader2Icon className="size-4 animate-spin" />}Charger les Runs précédents</Button></div>}
        </FramePanel>
      </Frame>}
      {editor !== undefined && <TaskEditorDialog task={editor} onClose={() => setEditor(undefined)} onSave={saveTask} />}
      {selectedRun && <TaskRunSheet key={selectedRun.id} projectId={project.id} initialRun={selectedRun} onClose={() => { setSelectedRun(null); setRefresh((value) => value + 1); }} />}
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
