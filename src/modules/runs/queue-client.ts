import type { Run } from "@db/schema";
import type { RunQueueStatus } from "@/types/run-queue";
import { taskRequest } from "@/lib/client-request";

type Blocker = { projectId: string; id: string };

export function recoverBlockedRun(blocker: Blocker) {
  return taskRequest<{ run?: Run; queue: RunQueueStatus }>(
    `/api/projects/${encodeURIComponent(blocker.projectId)}/runs/${encodeURIComponent(blocker.id)}/recover`,
    { method: "POST" },
  );
}

export function deleteBlockedRun(blocker: Blocker) {
  return taskRequest<{ run?: Run; queue: RunQueueStatus }>(
    `/api/projects/${encodeURIComponent(blocker.projectId)}/runs/${encodeURIComponent(blocker.id)}?deleteArtifacts=true&confirmTermination=true`,
    { method: "DELETE" },
  );
}
