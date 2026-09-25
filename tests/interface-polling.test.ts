import assert from "node:assert/strict";
import { test } from "node:test";
import { createPollingLoop } from "../src/lib/polling";
import React from "react";
import { usePolling } from "../src/hooks/use-polling";

test("polling invalidates a late response across mutations and unmount", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const requests: Array<{ signal: AbortSignal; resolve: (delay: number) => void }> = [];
  const applied: number[] = [];
  const loop = createPollingLoop(async signal => {
    const value = await new Promise<number>(resolve => requests.push({ signal, resolve }));
    if (!signal.aborted) applied.push(value);
    return value;
  }, 3000);
  loop.start(); t.mock.timers.tick(0);
  const finish = loop.pause();
  assert.equal(requests[0].signal.aborted, true);
  requests[0].resolve(3000); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(applied, []);
  finish(true); t.mock.timers.tick(0);
  assert.equal(requests.length, 2);
  loop.dispose(); requests[1].resolve(1500); await Promise.resolve(); await Promise.resolve();
  t.mock.timers.tick(10000);
  assert.deepEqual(applied, []); assert.equal(requests.length, 2);
});

test("polling preserves adaptive delays and combines overlapping invalidations", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const loop = createPollingLoop(async () => { calls++; return 1500; }, 3000);
  loop.start(); t.mock.timers.tick(0); await Promise.resolve();
  t.mock.timers.tick(1499); assert.equal(calls, 1);
  t.mock.timers.tick(1); await Promise.resolve(); assert.equal(calls, 2);
  const first = loop.pause(); const second = loop.pause();
  first(true); t.mock.timers.tick(10000); assert.equal(calls, 2);
  second(); t.mock.timers.tick(0); await Promise.resolve(); assert.equal(calls, 3);
  second(true); t.mock.timers.tick(1499); assert.equal(calls, 3);
  loop.dispose();
});

test("mutation failure reconciles immediately and a disposed hook cannot apply a late mutation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const cleanups: Array<() => void> = [];
  t.mock.method(React, "useRef", (current: unknown) => ({ current }));
  t.mock.method(React, "useCallback", (callback: unknown) => callback);
  t.mock.method(React, "useEffect", (effect: () => () => void) => { cleanups.push(effect()); });
  let polls = 0;
  const hook = usePolling(true, async () => { polls++; return 3000; });
  t.mock.timers.tick(0); await Promise.resolve();
  await assert.rejects(hook.mutate(async () => { throw new Error("network failed after commit"); }, () => assert.fail("no invalid data applied")));
  t.mock.timers.tick(0); await Promise.resolve();
  assert.equal(polls, 2, "failure triggers a fresh read without waiting for the next interval");
  let resolve!: (value: string) => void;
  const late = hook.mutate(() => new Promise<string>(done => { resolve = done; }), () => assert.fail("unmounted target"));
  for (const cleanup of cleanups) cleanup();
  resolve("old project response"); await late;
  t.mock.timers.tick(10000); assert.equal(polls, 2);
});
