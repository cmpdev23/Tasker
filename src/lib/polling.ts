/** A serial polling loop. Aborting also invalidates responses from transports that ignore abort. */
export function createPollingLoop(poll: (signal: AbortSignal) => Promise<number>, initialDelay: number) {
  let disposed = false;
  let holds = 0;
  let delay = initialDelay;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let refreshPending = false;

  function cancel() {
    clearTimeout(timer);
    controller?.abort();
  }

  function schedule(immediate: boolean) {
    if (disposed || holds) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void tick(); }, immediate ? 0 : delay);
  }

  async function tick() {
    const current = new AbortController();
    controller = current;
    try {
      const nextDelay = await poll(current.signal);
      if (!current.signal.aborted) delay = nextDelay;
    } finally {
      // The caller handles request errors, so one failed resource cannot stop another.
      if (!current.signal.aborted) schedule(false);
    }
  }

  return {
    start() { schedule(true); },
    refresh() { cancel(); refreshPending = true; if (!holds) { refreshPending = false; schedule(true); } },
    pause() {
      holds++;
      cancel();
      let released = false;
      return (refresh = false) => {
        if (released) return;
        released = true;
        refreshPending ||= refresh;
        holds--;
        if (!holds) {
          const immediate = refreshPending;
          refreshPending = false;
          schedule(immediate);
        }
      };
    },
    dispose() { disposed = true; cancel(); },
  };
}
