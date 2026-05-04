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
