import { useEffect, useState } from "react";
import type { Project, Run, SequenceStepRun } from "@db/schema";
import type { RunQueueStatus } from "@/types/run-queue";
import type { SequenceDefinition } from "@/types/sequences";
import { errorMessage, taskRequest } from "@/lib/client-request";
import { isActiveRun } from "@/modules/runs/run-presentation";

export interface PortableCheckpoint {
  sequenceId: string;
  runId: string;
  status: "IN_PROGRESS" | "SUCCESS" | "FAILED" | "CANCELLED";
  updatedAt: string;
  steps: Array<{ id: string; status: string }>;
}

export function useSequenceOverview(project: Project, baseUrl: string, selectedSequenceId: string | null) {
  const [sequences, setSequences] = useState<SequenceDefinition[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [stepRuns, setStepRuns] = useState<SequenceStepRun[]>([]);
  const [queue, setQueue] = useState<RunQueueStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [definitionError, setDefinitionError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [portableCheckpoint, setPortableCheckpoint] = useState<PortableCheckpoint | null>(null);
  const [portableCheckpointError, setPortableCheckpointError] = useState<string | null>(null);

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
        if (Array.isArray(runResult.value.stepRuns)) setStepRuns(runResult.value.stepRuns);
        if (runResult.value.queue) setQueue(runResult.value.queue);
        setRunError(null);
        hasActive = runResult.value.runs.some((run) => isActiveRun(run.status));
      } else {
        setRunError(runResult.status === "rejected" ? errorMessage(runResult.reason) : "Réponse de l’historique invalide.");
      }
      setLoading(false);
      timer = setTimeout(poll, hasActive ? 1500 : 3000);
    }
    void poll();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [baseUrl, project.repositoryPath, refresh]);

  return {
    sequences, setSequences, runs, stepRuns, queue, setQueue, loading,
    definitionError, runError, portableCheckpoint, portableCheckpointError,
    setRefresh,
  };
}
