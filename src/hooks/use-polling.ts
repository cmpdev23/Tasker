import { useCallback, useEffect, useRef } from "react";
import { createPollingLoop } from "@/lib/polling";

/** The callback owns URLs, response validation, errors and the next delay. */
export function usePolling(enabled: boolean, poll: (signal: AbortSignal) => Promise<number>, initialDelay = 3000) {
  const loop = useRef<ReturnType<typeof createPollingLoop> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const current = createPollingLoop(poll, initialDelay);
    loop.current = current;
    current.start();
    return () => { current.dispose(); if (loop.current === current) loop.current = null; };
  }, [enabled, poll, initialDelay]);

  const refresh = useCallback(() => loop.current?.refresh(), []);
  const pause = useCallback(() => {
    const current = loop.current;
    const release = current?.pause();
    return {
      isCurrent: () => current !== null && loop.current === current,
      finish: (reload = false) => release?.(reload),
    };
  }, []);
  const mutate = useCallback(async <T,>(request: () => Promise<T>, apply: (data: T) => void) => {
    const transaction = pause();
    let failed = true;
    try {
      const data = await request();
      if (transaction.isCurrent()) apply(data);
      failed = false;
    } finally {
      // A network/contract error can occur after the server committed a change.
      transaction.finish(failed);
    }
  }, [pause]);
  return { refresh, mutate };
}
