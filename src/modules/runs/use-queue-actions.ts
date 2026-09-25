import { useRef, useState } from "react";
import type { RunQueueStatus } from "@/types/run-queue";
import { errorMessage } from "@/lib/client-request";
import { deleteBlockedRun, recoverBlockedRun } from "./queue-client";
import { requireQueue } from "./run-response";

type QueueResponse = Awaited<ReturnType<typeof recoverBlockedRun>>;
type Mutate = <T>(request: () => Promise<T>, apply: (data: T) => void) => Promise<void>;

/** Screens own confirmations and local effects; the shared cycle cannot confirm for them. */
export function useQueueActions(mutate: Mutate, setQueue: (queue: RunQueueStatus) => void) {
  const busy = useRef(false);
  const [action, setAction] = useState<"recover" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function execute(kind: "recover" | "delete", queue: RunQueueStatus | null, confirm: () => boolean, apply: (data: QueueResponse, blockerId: string) => void) {
    if (busy.current || !queue?.blocker || !queue.canRecover ||
        !["BLOCKED_RECOVERY", "RECOVERY_REQUIRED"].includes(queue.state)) return;
    if (!confirm()) return;
    busy.current = true;
    setAction(kind);
    setError(null);
    const blocker = queue.blocker;
    try {
      await mutate(() => kind === "recover" ? recoverBlockedRun(blocker) : deleteBlockedRun(blocker), data => {
        if (data?.run?.id !== blocker.id || data.run.projectId !== blocker.projectId) {
          throw new Error("Réponse de récupération invalide. Vérifiez l’historique avant de réessayer.");
        }
        const freshQueue = requireQueue(data?.queue);
        setQueue(freshQueue);
        apply(data, blocker.id);
      });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      busy.current = false;
      setAction(null);
    }
  }
  return { recovering: action === "recover", deleting: action === "delete", error, execute };
}
