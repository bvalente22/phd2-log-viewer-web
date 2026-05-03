/**
 * Pure row-stacking layout for inline INFO event labels on the time graph.
 *
 * Ports the desktop algorithm in LogViewFrame.cpp:1814-1842, which decides
 * row placement in screen-pixel space (not data units): two labels share a
 * row only if the next label's left edge sits beyond the previous label's
 * right edge plus a 10 px breathing-room gap. When they don't, the new
 * label is bumped onto a higher row, and `prev_end` continues to track the
 * widest right-edge seen so far so subsequent labels also know to stack.
 *
 * The helper is deliberately UI-agnostic: the caller injects pxPerSecond
 * (derived from the current x-axis range and chart pixel width) and a
 * measurement function (a memoized canvas measureText in production, a
 * fixed-width fake in tests). That keeps the row math testable without a
 * DOM.
 */

export interface EventInput {
  /** Time of the event, in seconds since the session start. */
  timeSec: number;
  /** The label string already formatted (caller appends "×N" for repeats). */
  text: string;
  /** True for DITHER events; controls border color upstream. */
  isDither: boolean;
}

export interface EventLayoutItem extends EventInput {
  /** 0-indexed row from the bottom. row=0 = lowest, row=1 = stacked above. */
  row: number;
}

export type MeasureTextFn = (text: string) => number;

const PIXEL_GAP = 10; // matches the `prev_end + 10` guard in the desktop code

export function layoutInlineEvents(
  events: ReadonlyArray<EventInput>,
  pxPerSecond: number,
  measureTextPx: MeasureTextFn,
): EventLayoutItem[] {
  if (events.length === 0) return [];

  // Defensive sort. The parser inserts infos in time order, but a misuse
  // upstream shouldn't silently produce garbage rows.
  const sorted = [...events].sort((a, b) => a.timeSec - b.timeSec);

  const out: EventLayoutItem[] = [];
  let prevEndPx = -Infinity;
  let row = 0;

  for (const ev of sorted) {
    const xPosPx = ev.timeSec * pxPerSecond;
    const widthPx = measureTextPx(ev.text);

    if (xPosPx < prevEndPx + PIXEL_GAP) {
      row += 1;
    } else {
      row = 0;
    }

    if (xPosPx + widthPx > prevEndPx) {
      prevEndPx = xPosPx + widthPx;
    }

    out.push({ ...ev, row });
  }

  return out;
}
