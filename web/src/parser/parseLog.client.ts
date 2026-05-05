// Client-side wrapper around the parseLog Web Worker. Exposes a
// Promise-based `parseLogAsync(text)` so callers (logStore) don't have to
// know they're talking to a worker.
//
// The worker is lazily constructed on first use and reused for every
// subsequent parse — spinning up a worker has a non-trivial cost, and
// most users will load several logs in a session. If parsing somehow
// throws inside the worker we tear the worker down so the next call gets
// a fresh, clean process; otherwise the same instance is kept warm.
//
// Falls back to synchronous parseLog when `Worker` isn't available
// (vitest jsdom env, very old browsers, SSR). The store keeps working
// without code changes.

import { parseLog } from './parseLog';
import type { GuideLog } from './types';
// Vite worker import: see https://vitejs.dev/guide/features.html#web-workers
// The `?worker` suffix makes Vite emit the file as a separate worker bundle
// and gives us a constructor that returns a `Worker` instance.
import ParseLogWorker from './parseLog.worker?worker';
import type { ParseLogRequest, ParseLogResponse } from './parseLog.worker';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (log: GuideLog) => void; reject: (err: Error) => void }>();

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (worker) return worker;
  worker = new ParseLogWorker();
  worker.onmessage = (ev: MessageEvent<ParseLogResponse>) => {
    const reply = ev.data;
    const slot = pending.get(reply.id);
    if (!slot) return;
    pending.delete(reply.id);
    if (reply.ok) slot.resolve(reply.log);
    else slot.reject(new Error(reply.error));
  };
  worker.onerror = (ev) => {
    // Catastrophic worker failure: reject every pending request and
    // discard the worker so the next call instantiates a fresh one.
    const err = new Error(ev.message || 'parser worker crashed');
    for (const [, slot] of pending) slot.reject(err);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

export function parseLogAsync(text: string): Promise<GuideLog> {
  const w = getWorker();
  if (!w) {
    // Synchronous fallback for environments without Worker (vitest jsdom).
    // We still return a Promise so the call site remains uniform.
    return new Promise((resolve, reject) => {
      try { resolve(parseLog(text)); }
      catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
    });
  }
  const id = nextId++;
  return new Promise<GuideLog>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const req: ParseLogRequest = { id, text };
    w.postMessage(req);
  });
}
