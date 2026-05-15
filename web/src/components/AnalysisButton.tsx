import { useTranslation } from 'react-i18next';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
import { useAnalysisStore } from '../state/analysisStore';
import { canAnalyze, analyze } from '../parser/analyze';

/** Standalone "Analysis" button for the guiding-section UI. Functional
 *  equivalent of the right-click context-menu's "Analysis" item: opens
 *  the Analysis modal on the active session with kind='all-raw-ra' (Raw
 *  RA). The user can flip to Residual error / Manual Spike from inside
 *  the modal via the tabs. Hidden when no guiding section is selected or
 *  the session has too few entries for analyze() to run.
 *
 *  Default tab is Raw RA — matches the original desktop's startup view
 *  and is the more useful one when comparing guided vs. unguided
 *  tracking; users diagnosing PE typically want to see the raw signal
 *  first and only then drill into the residual after RA corrections. */
export function AnalysisButton() {
  const { t } = useTranslation('toolbar');
  const log = useLogStore((s) => s.log);
  const sectionIdx = useLogStore((s) => s.selectedSection);
  const exclusions = useViewStore((s) => s.exclusions);
  const scaleMode = useViewStore((s) => s.scaleMode);
  const openAnalysis = useAnalysisStore((s) => s.open);

  const sec = log && sectionIdx >= 0 ? log.sections[sectionIdx] : null;
  if (!sec || sec.type !== 'GUIDING') return null;

  const session = log!.sessions[sec.idx];
  const sessionMask = exclusions.get(sec.idx);
  const range = { begin: 0, end: session.entries.length };
  const enabled = canAnalyze(session, { range, undoRaCorrections: false, mask: sessionMask });

  const onClick = () => {
    if (!enabled) return;
    try {
      // Active garun = Raw RA (undoRaCorrections:true); counterpart = Residual.
      const garun = analyze(session, { range, undoRaCorrections: true, mask: sessionMask });
      // Pre-compute the Residual counterpart so the in-modal tab swap is
      // instant — same eager-pair pattern as the context menu.
      const garunOther = analyze(session, { range, undoRaCorrections: false, mask: sessionMask });
      openAnalysis({
        garun, garunOther, kind: 'all-raw-ra',
        initialScaleMode: scaleMode,
        spikeSource: { session, range, mask: sessionMask },
      });
    } catch (err) {
      // canAnalyze gates this; stay defensive on edge cases.
      // eslint-disable-next-line no-console
      console.error('analyze failed:', err);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      title={t('contextMenu.analysisTooltip')}
      className="rounded bg-amber-700 px-3 py-1 text-xs font-semibold text-amber-50 ring-1 ring-amber-600 transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 disabled:ring-slate-700"
    >
      {t('contextMenu.analysis')}
    </button>
  );
}
