import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface PrimaryPeriodFieldProps {
  /** Effective Primary period (seconds), or null when none. */
  value: number | null;
  /** True when the value is a user edit (vs the auto-detected dominant peak). */
  edited: boolean;
  /** Whether reset-to-auto can run (an auto value exists for the current section). */
  canReset: boolean;
  /** Commit a valid (> 0) edit. */
  onCommit: (sec: number) => void;
  /** Re-derive the auto value from the current section. */
  onReset: () => void;
}

/**
 * Editable Primary-period field shown beside "Max period" in the Analysis
 * bottom panel. Keeps a local text buffer so typing is free; commits on
 * blur / Enter. Invalid input (blank, ≤ 0, non-numeric) reverts to the current
 * value. The value is in seconds (the periodogram x-axis unit), independent of
 * the arc-sec/pixels amplitude toggle.
 */
export function PrimaryPeriodField({ value, edited, canReset, onCommit, onReset }: PrimaryPeriodFieldProps) {
  const { t } = useTranslation('analysis');
  const fmt = (v: number | null) => (v == null ? '' : String(Math.round(v * 10) / 10));
  const [text, setText] = useState(() => fmt(value));
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Resync the buffer when the external value changes (init / edit / reset /
  // section swap), unless the user is mid-edit in this very field.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setText(fmt(value));
  }, [value]);

  const commit = () => {
    const v = parseFloat(text);
    if (Number.isFinite(v) && v > 0) onCommit(v);
    else setText(fmt(value)); // revert invalid
  };

  return (
    <label className="flex items-center gap-1 text-slate-400" title={t('primaryPeriodTooltip')}>
      <span>{t('primaryPeriod')}</span>
      <input
        ref={inputRef}
        type="number"
        min={0}
        step="any"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); }
        }}
        className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-0.5 font-mono text-slate-200"
      />
      <span>{t('maxPeriodSuffix')}</span>
      <button
        type="button"
        onClick={onReset}
        disabled={!canReset}
        title={t('resetToAutoTooltip')}
        className="rounded px-1 text-base leading-none text-slate-400 transition-colors hover:text-slate-100 disabled:cursor-not-allowed disabled:text-slate-700"
        aria-label={t('resetToAuto')}
      >
        ↺
      </button>
      {edited && (
        <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">
          {t('edited')}
        </span>
      )}
    </label>
  );
}
