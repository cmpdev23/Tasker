import { useCallback, useEffect, useRef, useState } from "react";
import type { Project, Run } from "@db/schema";
import type { TaskDefinition } from "@/types/tasks";
import type { RunQueueStatus } from "@/types/run-queue";
import { errorMessage, taskRequest } from "@/lib/client-request";
import { usePolling } from "@/hooks/use-polling";
import { requireTask } from "./task-response";
import { requireQueue } from "@/modules/runs/run-response";

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
  const nextLoad = useRef<"all" | "runs">("all");
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
        if (!controller.signal.aborted && data?.effectiveDefaultBranch) {
          setResolvedBaseBranch({ source: branchSource, value: data.effectiveDefaultBranch });
        }
      })
      .catch(() => {
        // The task list remains usable when Git inspection is unavailable.
      });
    return () => controller.abort();
  }, [baseUrl, project.defaultBranch, project.repositoryPath]);

  const poll = useCallback(async (signal: AbortSignal) => {
    const scope = nextLoad.current;
    nextLoad.current = "all";
    const results = await Promise.allSettled([
      scope === "all" ? taskRequest<{ tasks: TaskDefinition[] }>(baseUrl + "/tasks", { signal }) : Promise.resolve(null),
      taskRequest<{ runs: Run[]; queue: RunQueueStatus }>(baseUrl + "/runs", { signal }),
    ]);
    if (signal.aborted) return 3000;
    const [taskResult, runResult] = results;
    if (scope === "all") try {
      if (taskResult.status === "rejected") throw taskResult.reason;
      if (!Array.isArray(taskResult.value?.tasks)) throw new Error("Réponse de la liste des tâches invalide.");
      setTasks(taskResult.value.tasks.map(requireTask));
      setTaskError(null);
    } catch (error) {
      setTaskError(errorMessage(error));
    }
    try {
      if (runResult.status === "rejected") throw runResult.reason;
      if (!Array.isArray(runResult.value?.runs)) throw new Error("Réponse de l’historique invalide.");
      const queue = requireQueue(runResult.value.queue);
      setRuns(runResult.value.runs);
      setQueueStatus(queue);
      setRunError(null);
    } catch (error) {
      setRunError(errorMessage(error));
    }
    setLoading(false);
    return 3000;
  }, [baseUrl]);
  const polling = usePolling(Boolean(project.repositoryPath), poll);
  function refresh() { nextLoad.current = "all"; polling.refresh(); }
  function refreshRuns() { nextLoad.current = "runs"; polling.refresh(); }

  return {
    tasks, setTasks, runs, setRuns, loading, taskError, runError,
    queueStatus, setQueueStatus, baseBranch, refresh, refreshRuns, mutate: polling.mutate,
  };
}
