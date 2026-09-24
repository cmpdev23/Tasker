import { useEffect, useState } from "react";
import type { Project, Run } from "@db/schema";
import type { TaskDefinition } from "@/types/tasks";
import type { RunQueueStatus } from "@/types/run-queue";
import { errorMessage, taskRequest } from "@/lib/client-request";

export function useTaskOverview(project: Project, baseUrl: string) {
  const [tasks, setTasks] = useState<TaskDefinition[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [queueStatus, setQueueStatus] = useState<RunQueueStatus | null>(null);
  const [resolvedBaseBranch, setResolvedBaseBranch] = useState({
    source: project.defaultBranch,
    value: project.defaultBranch || "main",
  });
  const [refresh, setRefresh] = useState(0);
  const baseBranch = resolvedBaseBranch.source === project.defaultBranch
    ? resolvedBaseBranch.value
    : project.defaultBranch || "main";

  // The portable project Git setting can override the branch cached in SQLite.
  useEffect(() => {
    if (!project.repositoryPath) return;
    const controller = new AbortController();
    const branchSource = project.defaultBranch;
    void taskRequest<{ effectiveDefaultBranch?: string }>(baseUrl + "/git", {
      signal: controller.signal,
    })
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
      if (taskResult.status === "fulfilled" && Array.isArray(taskResult.value?.tasks)) {
        setTasks(taskResult.value.tasks);
        setTaskError(null);
      } else {
        setTaskError(taskResult.status === "rejected"
          ? errorMessage(taskResult.reason)
          : "Réponse de la liste des tâches invalide.");
      }
      if (runResult.status === "fulfilled" && Array.isArray(runResult.value?.runs)) {
        setRuns(runResult.value.runs);
        if (runResult.value.queue) setQueueStatus(runResult.value.queue);
        setRunError(null);
      } else {
        setRunError(runResult.status === "rejected"
          ? errorMessage(runResult.reason)
          : "Réponse de l’historique invalide.");
      }
      setLoading(false);
      timer = setTimeout(poll, 3000);
    }
    void poll();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [baseUrl, project.repositoryPath, refresh]);

  return {
    tasks, setTasks, runs, setRuns, loading, taskError, runError,
    queueStatus, setQueueStatus, baseBranch, setRefresh,
  };
}
