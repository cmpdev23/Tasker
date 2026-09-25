import { useCallback, useEffect, useRef, useState } from "react";
import type { Project, Run, SequenceStepRun } from "@db/schema";
import type { RunQueueStatus } from "@/types/run-queue";
import type { SequenceDefinition } from "@/types/sequences";
import { errorMessage, taskRequest } from "@/lib/client-request";
import { isActiveRun } from "@/modules/runs/run-presentation";

import { usePolling } from "@/hooks/use-polling";
import { requireSequence } from "./sequence-response";
import { requireQueue } from "@/modules/runs/run-response";

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
  const [checkpointRefresh, setCheckpointRefresh] = useState(0);
  const checkpointController = useRef<AbortController | null>(null);
  const checkpointKey = baseUrl + "/" + selectedSequenceId;
  const [checkpoint, setCheckpoint] = useState<{ key: string; value: PortableCheckpoint | null; error: string | null } | null>(null);
  const nextLoad = useRef<"all" | "runs">("all");

  useEffect(() => {
    if (!selectedSequenceId) return;
    const controller = new AbortController();
    checkpointController.current = controller;
    void taskRequest<{ checkpoint: PortableCheckpoint | null }>(`${baseUrl}/sequences/${encodeURIComponent(selectedSequenceId)}/checkpoint`, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        if (!data || !("checkpoint" in data) || (data.checkpoint !== null &&
          (data.checkpoint.sequenceId !== selectedSequenceId || !Array.isArray(data.checkpoint.steps)))) {
          throw new Error("Réponse du checkpoint invalide.");
        }
        setCheckpoint({ key: checkpointKey, value: data.checkpoint, error: null });
      })
      .catch((error) => { if (!controller.signal.aborted) setCheckpoint({ key: checkpointKey, value: null, error: errorMessage(error) }); });
    return () => controller.abort();
  }, [baseUrl, selectedSequenceId, checkpointKey, checkpointRefresh]);

  const poll = useCallback(async (signal: AbortSignal) => {
    const scope = nextLoad.current;
    nextLoad.current = "all";
    const [sequenceResult, runResult] = await Promise.allSettled([
      scope === "all" ? taskRequest<{ sequences: SequenceDefinition[] }>(`${baseUrl}/sequences`, { signal }) : Promise.resolve(null),
      taskRequest<{ runs: Run[]; stepRuns?: SequenceStepRun[]; queue: RunQueueStatus }>(`${baseUrl}/sequence-runs`, { signal }),
    ]);
    if (signal.aborted) return 3000;
    if (scope === "all") try {
      if (sequenceResult.status === "rejected") throw sequenceResult.reason;
      if (!Array.isArray(sequenceResult.value?.sequences)) throw new Error("Réponse de la liste des Sequences invalide.");
      setSequences(sequenceResult.value.sequences.map(requireSequence));
      setDefinitionError(null);
    } catch (error) { setDefinitionError(errorMessage(error)); }
    let hasActive = false;
    try {
      if (runResult.status === "rejected") throw runResult.reason;
      if (!Array.isArray(runResult.value?.runs) || !Array.isArray(runResult.value.stepRuns)) throw new Error("Réponse de l’historique invalide.");
      const queue = requireQueue(runResult.value.queue);
      setRuns(runResult.value.runs);
      setStepRuns(runResult.value.stepRuns);
      setQueue(queue);
      setRunError(null);
      hasActive = runResult.value.runs.some((run) => isActiveRun(run.status));
    } catch (error) { setRunError(errorMessage(error)); }
    setLoading(false);
    return hasActive ? 1500 : 3000;
  }, [baseUrl]);
  const polling = usePolling(Boolean(project.repositoryPath), poll);
  function refreshRuns() {
    nextLoad.current = "runs";
    checkpointController.current?.abort();
    setCheckpointRefresh(value => value + 1);
    polling.refresh();
  }

  return {
    sequences, setSequences, runs, setRuns, stepRuns, setStepRuns, queue, setQueue, loading,
    definitionError, runError,
    portableCheckpoint: checkpoint?.key === checkpointKey ? checkpoint.value : null,
    portableCheckpointError: checkpoint?.key === checkpointKey ? checkpoint.error : null,
    refreshRuns, mutate: polling.mutate,
  };
}
