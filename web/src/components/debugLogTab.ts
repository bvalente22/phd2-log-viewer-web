/**
 * Opens the sibling PHD2 debug log in a NEW BROWSER TAB when the user double-
 * clicks a drift sample. The tab loads a small static page (public/debug-log-
 * tab.html) that virtualizes the whole log and highlights + centres the closest-
 * timestamp line. We hand the (potentially 30 MB) lines array to that page by
 * REFERENCE via `window.__debugTabData` (same-origin; the page reads it through
 * `window.opener`) — no megabyte copy and no serialization.
 *
 * Why a static page + about:blank handoff rather than a blob: URL: a popup that
 * has committed a blob: document silently ignores further `location.href`
 * navigations from the opener (breaking the not-found→pick flow). Keeping the
 * tab at about:blank (written via innerHTML) until a single navigation to the
 * static page sidesteps that, and virtualization keeps even a huge log smooth.
 *
 * Browser sandboxing prevents launching the OS text editor; this tab is the
 * equivalent.
 */

export interface DebugTabPayload {
  fileName: string;
  lines: string[];
  matchedIndex: number;
  /** Wall-clock ms (Date.UTC-encoded) of the clicked sample and matched line. */
  targetMs: number;
  matchedMs: number;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let seq = 0;

/**
 * Stash the payload where the debug-log-tab page can read it (keyed per open so
 * multiple tabs don't clobber each other) and return the URL to navigate to.
 */
export function debugTabUrl(data: DebugTabPayload): string {
  const w = window as unknown as { __debugTabData?: Record<string, DebugTabPayload> };
  w.__debugTabData = w.__debugTabData || {};
  const key = String(++seq);
  w.__debugTabData[key] = data;
  return `${import.meta.env.BASE_URL}debug-log-tab.html#${key}`;
}

const MESSAGE_INNER = (message: string): string =>
  `<head><meta charset="utf-8"><title>Debug log</title></head>` +
  `<body style="margin:0;background:#0f172a;color:#94a3b8;` +
  `font:14px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:2rem">` +
  `${esc(message)}</body>`;

/**
 * Open a blank tab synchronously (must run inside the click gesture so popup
 * blockers allow it) and show a "Loading…" placeholder. Returns null if blocked.
 * The tab stays at about:blank (written via innerHTML, NOT navigated) so the
 * later single navigation to the static page is the popup's first commit.
 */
export function openLoadingTab(): Window | null {
  const tab = window.open('', '_blank');
  if (tab) showMessageInTab(tab, 'Loading debug log…');
  return tab;
}

/** Show a short plain message in the about:blank tab (loading / fallback notices). */
export function showMessageInTab(tab: Window, message: string): void {
  try {
    tab.document.documentElement.innerHTML = MESSAGE_INNER(message);
  } catch {
    /* tab closed — ignore */
  }
}
