import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBltStore } from '../state/bltStore';
import { useLogStore } from '../state/logStore';
import { BltChart } from './BltChart';
import type { BltSequence } from '../parser/parseBlt';

/** Top-level "Backlash Analysis" tab content. Three states:
 *  - No debug log loaded → drop zone with hint about the matching filename.
 *  - Loading → spinner + filename.
 *  - Loaded → list of BLT runs on the left, chart + result card on the right.
 *
 *  The store is bound to the active guide log's filename via
 *  bindToGuideLog(), so reopening the same guide log restores the
 *  cached BLT analysis instantly. */
export function BacklashTab() {
  const { t } = useTranslation('blt');
  const meta = useLogStore((s) => s.meta);

  const guideLogName = meta?.name ?? '';
  const expectedDebugName = guideLogName
    ? guideLogName.replace(/GuideLog/i, 'DebugLog')
    : '';

  const bindToGuideLog = useBltStore((s) => s.bindToGuideLog);
  const loadDebugLog = useBltStore((s) => s.loadDebugLog);
  const clearCurrent = useBltStore((s) => s.clearCurrent);
  const setSelectedIndex = useBltStore((s) => s.setSelectedIndex);
  const debugLogName = useBltStore((s) => s.debugLogName);
  const debugLogSize = useBltStore((s) => s.debugLogSize);
  const sequences = useBltStore((s) => s.sequences);
  const selectedIndex = useBltStore((s) => s.selectedIndex);
  const loading = useBltStore((s) => s.loading);
  const error = useBltStore((s) => s.error);

  // Re-bind on guide-log change. Async; the store handles it.
  useEffect(() => {
    void bindToGuideLog(guideLogName);
  }, [guideLogName, bindToGuideLog]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const onPick = () => fileInputRef.current?.click();
  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void loadDebugLog(file);
    e.target.value = ''; // allow re-picking the same file
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void loadDebugLog(file);
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const onDragLeave = () => setDragOver(false);

  // ---- LOADING ----
  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-slate-400">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-700 border-t-amber-500" />
        <div>{t('loading')}</div>
      </div>
    );
  }

  // ---- DROP ZONE (no debug log loaded) ----
  if (sequences.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={`flex w-full max-w-2xl flex-col items-center gap-3 rounded-lg border-2 border-dashed px-8 py-12 transition-colors ${
            dragOver
              ? 'border-amber-500 bg-amber-500/5'
              : 'border-slate-700 bg-slate-900/40'
          }`}
        >
          <div className="text-base font-medium text-slate-200">{t('dropTitle')}</div>
          {expectedDebugName && (
            <div className="text-center text-xs text-slate-400">
              {t('dropExpected')}
              <div className="mt-1 break-all font-mono text-amber-300">{expectedDebugName}</div>
            </div>
          )}
          <button
            type="button"
            onClick={onPick}
            className="mt-2 rounded bg-amber-700 px-4 py-1.5 text-sm font-semibold text-amber-50 ring-1 ring-amber-600 hover:bg-amber-600"
          >
            {t('pickFile')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.log"
            className="hidden"
            onChange={onFileChosen}
          />
          {error && (
            <div className="mt-3 rounded border border-rose-700/60 bg-rose-900/30 px-3 py-2 text-xs text-rose-200">
              {t(`error.${error}`, t('error.parseFailed'))}
            </div>
          )}
        </div>
        <p className="mt-3 max-w-2xl text-center text-xs text-slate-500">
          {t('dropDescription')}
        </p>
      </div>
    );
  }

  // ---- RESULTS ----
  const selected = sequences[selectedIndex] ?? sequences[0];
  return (
    <div className="flex h-full flex-col">
      {/* Top strip — debug log filename + size + Clear button */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-900/40 px-3 py-1 text-xs">
        <span className="text-slate-500">{t('loadedFrom')}</span>
        <span className="break-all font-mono text-slate-200">{debugLogName}</span>
        <span className="text-slate-500">
          {t('fileSize', { mb: (debugLogSize / 1024 / 1024).toFixed(1) })}
        </span>
        <span className="text-slate-500">·</span>
        <span className="text-slate-300">{t('runCount', { count: sequences.length })}</span>
        <button
          type="button"
          onClick={() => void clearCurrent()}
          className="ms-auto rounded bg-slate-800 px-2 py-0.5 text-slate-300 ring-1 ring-slate-700 hover:bg-rose-700 hover:text-white hover:ring-rose-600"
          title={t('clearTooltip')}
        >
          {t('clear')}
        </button>
      </div>
      <div className="flex flex-1 overflow-hidden">
        {/* Left: sequence list (only when there's more than one). */}
        {sequences.length > 1 && (
          <aside className="w-48 flex-shrink-0 overflow-y-auto border-e border-slate-800 bg-slate-900/30">
            <div className="border-b border-slate-800 px-3 py-2 text-[10px] uppercase tracking-wider text-slate-500">
              {t('runsHeader')}
            </div>
            <ul>
              {sequences.map((s, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => setSelectedIndex(i)}
                    className={`w-full px-3 py-2 text-left text-xs transition-colors ${
                      i === selectedIndex
                        ? 'bg-slate-800 text-amber-300'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <div className="font-mono">{s.timestamp || `Run ${i + 1}`}</div>
                    <div className="mt-0.5 text-[10px] text-slate-400">
                      {t('runSummary', {
                        px: s.blPx.toFixed(1),
                        ms: s.blMs.toFixed(0),
                      })}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}
        <main className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <BltChart sequence={selected} />
          </div>
          <div className="border-t-2 border-amber-800 bg-slate-900/70 px-4 py-2">
            <BltResultsCard sequence={selected} />
          </div>
        </main>
      </div>
    </div>
  );
}

/** 7-field results grid matching the spec's display fields. */
function BltResultsCard({ sequence }: { sequence: BltSequence }) {
  const { t } = useTranslation('blt');
  const fields: Array<{ label: string; value: string }> = [
    { label: t('result.timestamp'), value: sequence.timestamp || '—' },
    { label: t('result.pulseSize'), value: t('value.ms', { value: sequence.pulseSize }) },
    { label: t('result.southClearing'), value: t('value.steps', { value: sequence.minSouthMoves }) },
    {
      label: t('result.northRate'),
      value: sequence.northRate > 0
        ? t('value.pxPerSec', { value: (1000 / sequence.northRate).toFixed(2) })
        : '0',
    },
    { label: t('result.southStepGoal'), value: t('value.px', { value: (0.9 * sequence.medianNorthMove).toFixed(1) }) },
    { label: t('result.blPx'), value: t('value.px', { value: sequence.blPx.toFixed(1) }) },
    { label: t('result.blMs'), value: t('value.ms', { value: Math.round(sequence.blMs) }) },
  ];
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4 md:grid-cols-7">
      {fields.map((f, i) => (
        <div key={i} className="rounded border border-amber-700/40 bg-slate-900 px-3 py-2 font-mono">
          <div className="text-[10px] uppercase tracking-wider text-amber-300">{f.label}</div>
          <div className="mt-0.5 text-slate-100">{f.value}</div>
        </div>
      ))}
    </div>
  );
}
