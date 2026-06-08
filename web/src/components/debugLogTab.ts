/**
 * Opens the sibling PHD2 debug log in a NEW BROWSER TAB when the user double-
 * clicks a drift sample. The tab loads a small static page (public/debug-log-
 * tab.html) that virtualizes the whole log and highlights + centres the closest-
 * timestamp line. Browser sandboxing prevents launching the OS text editor; this
 * tab is the equivalent.
 *
 * The tab is opened (in the click gesture, popup-safe) DIRECTLY to the static
 * page, which then POLLS `window.opener.__debugTabData[key]` for its data. That
 * lets us open the tab instantly — before the (possibly 30 MB) log is read, or
 * while the user picks/grants the file — and render once it's ready, without any
 * fragile re-navigation of the popup. The lines array is handed off BY REFERENCE
 * (same-origin), so there's no megabyte copy.
 */

export type DebugTabSlot =
  | { state: 'loading' }
  | { state: 'needPick' }
  | { state: 'error'; message: string }
  | {
      state: 'ready';
      fileName: string;
      lines: string[];
      matchedIndex: number;
      /** Wall-clock ms (Date.UTC-encoded) of the clicked sample and matched line. */
      targetMs: number;
      matchedMs: number;
    };

let seq = 0;

function slots(): Record<string, DebugTabSlot> {
  const w = window as unknown as { __debugTabData?: Record<string, DebugTabSlot> };
  w.__debugTabData = w.__debugTabData || {};
  return w.__debugTabData;
}

/**
 * Open the debug-log tab synchronously (must run inside the click gesture so
 * popup blockers allow it). Returns the slot key and the Window (null if the
 * browser blocked the popup). The tab starts in the `loading` state.
 */
export function openDebugTab(): { key: string; tab: Window | null } {
  const key = String(++seq);
  slots()[key] = { state: 'loading' };
  const tab = window.open(`${import.meta.env.BASE_URL}debug-log-tab.html#${key}`, '_blank');
  return { key, tab };
}

/** Update the tab's data slot; the open tab polls and reacts to it. */
export function setDebugTabSlot(key: string, slot: DebugTabSlot): void {
  slots()[key] = slot;
}
