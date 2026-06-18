// Locale-aware number / date helpers. Centralised here so every component
// formats numbers the same way (and so swapping languages re-renders cleanly
// — these readers all touch i18n.language, which Zustand-style consumers via
// useTranslation will subscribe to).
import i18n from './index';

const NULL_DASH = '—';

/** Fixed-decimal number, locale-aware. Returns the em-dash for non-finite. */
export function fmtNumber(n: number, decimals = 3): string {
  if (!Number.isFinite(n)) return NULL_DASH;
  return new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

/** Integer, locale-aware (uses thousand separators where applicable). */
export function fmtInteger(n: number): string {
  if (!Number.isFinite(n)) return NULL_DASH;
  return new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }).format(n);
}

/** Rounded integer, locale-aware (e.g. for "{{count}} steps" / "{{seconds}}s"). */
export function fmtRoundedInt(n: number): string {
  if (!Number.isFinite(n)) return NULL_DASH;
  return new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }).format(Math.round(n));
}

/**
 * Duration in seconds → compact "Hh Mm Ss" string, dropping leading zero
 * units (e.g. 45 → "45s", 125 → "2m 5s", 3725 → "1h 2m 5s"). The h/m/s
 * unit suffixes are left untranslated — they read the same across the
 * languages we ship and keep the sidebar sub-line terse. Returns the
 * em-dash for non-finite input.
 */
export function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return NULL_DASH;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (h > 0 || m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

/**
 * Word-wrap to a max line width by inserting newlines so a native `title`
 * tooltip renders narrow-and-tall instead of one very long line. Hard-breaks a
 * single token longer than max (e.g. CJK runs with no spaces). Keep tooltips
 * narrow across the app (≈44 chars) — see CLAUDE.md "UI conventions — tooltips".
 */
export function wrapTip(text: string, max = 44): string {
  const out: string[] = [];
  let line = '';
  const push = () => { if (line) { out.push(line); line = ''; } };
  for (const w of text.split(' ')) {
    let word = w;
    while (word.length > max) { push(); out.push(word.slice(0, max)); word = word.slice(max); }
    if (line && line.length + 1 + word.length > max) push();
    line = line ? `${line} ${word}` : word;
  }
  push();
  return out.join('\n');
}
