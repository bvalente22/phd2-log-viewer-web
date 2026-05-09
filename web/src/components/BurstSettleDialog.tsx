import { useTranslation } from 'react-i18next';

interface BurstSettleDialogProps {
  bestPct: number;
  currentPct: number;
  onResolve: (keepBest: boolean) => void;
}

/** Inline banner shown after the user stops the auto-adjust search,
 *  when the global-best configuration the search ever found differs
 *  from the configuration the search ended at. Lets the user choose
 *  which set of slider values to lock in. */
export function BurstSettleDialog({ bestPct, currentPct, onResolve }: BurstSettleDialogProps) {
  const { t } = useTranslation('analysis');
  return (
    <div className="border-b border-amber-700 bg-amber-100/95 px-4 py-2 text-sm text-amber-950">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded bg-amber-700 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-amber-50">
          {t('burst.settle.label')}
        </span>
        <span>
          {t('burst.settle.message', { best: bestPct, current: currentPct })}
        </span>
        <div className="ms-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => onResolve(true)}
            title={t('burst.settle.keepBestTooltip', { best: bestPct })}
            className="rounded bg-emerald-700 px-3 py-0.5 text-xs text-white ring-1 ring-emerald-600 transition-colors hover:bg-emerald-600"
          >
            {t('burst.settle.keepBest', { best: bestPct })}
          </button>
          <button
            type="button"
            onClick={() => onResolve(false)}
            title={t('burst.settle.keepCurrentTooltip', { current: currentPct })}
            className="rounded bg-slate-800 px-3 py-0.5 text-xs text-white ring-1 ring-slate-700 transition-colors hover:bg-slate-700"
          >
            {t('burst.settle.keepCurrent', { current: currentPct })}
          </button>
        </div>
      </div>
    </div>
  );
}
