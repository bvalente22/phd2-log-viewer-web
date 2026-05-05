// Web Worker entry point for parseLog. Lives on a background thread so a
// multi-MB log doesn't freeze the UI while it's being parsed (parseLog is
// purely CPU-bound: tokenize → parse rows → assemble GuideLog). The
// returned GuideLog is a plain-object/array tree, fully structured-cloneable
// across the worker boundary — no classes, no functions, no DOM refs.
//
// Wire-protocol:
//   inbound : { id: number; text: string }
//   outbound: { id: number; ok: true;  log: GuideLog }
//          or { id: number; ok: false; error: string }
//
// `id` lets the client wrapper match responses to in-flight requests, so
// concurrent loads (rare, but possible if the user re-drops mid-parse)
// don't cross-resolve.

import { parseLog } from './parseLog';
import type { GuideLog } from './types';

export interface ParseLogRequest {
  id: number;
  text: string;
}
export type ParseLogResponse =
  | { id: number; ok: true; log: GuideLog }
  | { id: number; ok: false; error: string };

self.onmessage = (ev: MessageEvent<ParseLogRequest>) => {
  const { id, text } = ev.data;
  try {
    const log = parseLog(text);
    const reply: ParseLogResponse = { id, ok: true, log };
    (self as unknown as Worker).postMessage(reply);
  } catch (e) {
    const reply: ParseLogResponse = {
      id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
    (self as unknown as Worker).postMessage(reply);
  }
};
