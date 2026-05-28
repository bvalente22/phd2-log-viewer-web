/**
 * Pure row-stacking layout for inline INFO event labels on the time graph.
 *
 * Row placement happens in screen-pixel space (not data units): two labels
 * may share a row only if the later one's left edge clears the earlier one's
 * right edge by a 10 px breathing-room gap. This is a greedy "skyline" pack —
 * each label takes the LOWEST row that still clears, and only opens a new row
 * above the stack when every existing row is occupied at that x. Reusing freed
 * lower rows keeps the stack as flat as possible.
 *
 * This improves on the desktop's algorithm (LogViewFrame.cpp:1814-1842), which
 * tracks a single running `prev_end` + row counter and therefore cascades a
 * cluster into an ever-taller staircase, never dropping back to a row that has
 * since freed up. Per-row right-edge tracking here guarantees no two same-row
 * labels overlap and keeps the total height minimal.
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
  // rowRightPx[r] = right edge (px) of the last label placed on row r.
  const rowRightPx: number[] = [];

  for (const ev of sorted) {
    const xPosPx = ev.timeSec * pxPerSecond;
    const widthPx = measureTextPx(ev.text);

    // Lowest row whose previous label clears this one's left edge by the
    // gap; if none clears, open a fresh row above the stack.
    let row = rowRightPx.findIndex((rightPx) => xPosPx >= rightPx + PIXEL_GAP);
    if (row === -1) row = rowRightPx.length;

    rowRightPx[row] = xPosPx + widthPx;
    out.push({ ...ev, row });
  }

  return out;
}
