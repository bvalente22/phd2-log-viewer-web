import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
import { fmtInteger, fmtDuration, fmtNumber, wrapTip } from '../i18n/format';
import { extractGAResults } from '../parser/gaResults';
import { defaultMasks, sessionRmsList } from './sectionRms';

const GuideIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <polyline points="6 16 10 11 13 14 17 8" />
    <polyline points="14 8 17 8 17 11" />
  </svg>
);

const CalibrationIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    <line x1="12" y1="2" x2="12" y2="5" />
    <line x1="12" y1="19" x2="12" y2="22" />
    <line x1="2" y1="12" x2="5" y2="12" />
    <line x1="19" y1="12" x2="22" y2="12" />
  </svg>
);

export function SectionList() {
  const { t } = useTranslation('sections');
  const log = useLogStore((s) => s.log);
  const selected = useLogStore((s) => s.selectedSection);
  const select = useLogStore((s) => s.selectSection);
  const exclusions = useViewStore((s) => s.exclusions);
  const scaleMode = useViewStore((s) => s.scaleMode);

  // Total RMS per guide session, live with each section's exclusions. The
  // default (first-view) masks only depend on the log, so they're built once
  // per log; the RMS pass re-runs on every exclusion change, which is cheap.
  const defaults = useMemo(() => (log ? defaultMasks(log.sessions) : []), [log]);
  const rmsBySession = useMemo(
    () => (log ? sessionRmsList(log.sessions, exclusions, defaults) : []),
    [log, exclusions, defaults],
  );

  if (!log || log.sections.length === 0) {
    return <p className="p-3 text-sm text-slate-400">{t('list.noSections')}</p>;
  }

  // Follows the global px / arc-sec toggle, like the stats footer.
  const arcsec = scaleMode === 'ARCSEC';
  const fmtRms = (px: number, pixelScale: number) =>
    arcsec ? `${fmtNumber(px * pixelScale, 2)}″` : `${fmtNumber(px, 2)} px`;

  return (
    <>
      {/* Group header so the per-section list reads as the CURRENT log's
          sections — distinct from the "Recent logs" picker above it, which
          opens a different log entirely. */}
      <div className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 px-3 py-1.5">
        <span className="text-[10px] uppercase tracking-widest text-slate-500" title={t('list.headingTooltip')}>
          {t('list.heading')}
        </span>
      </div>
      <ul>
      {log.sections.map((sec, i) => {
        const isCal = sec.type === 'CALIBRATION';
        const session = isCal ? null : log.sessions[sec.idx];
        const item = isCal ? log.calibrations[sec.idx] : log.sessions[sec.idx];
        const label = isCal
          ? t('list.calLabel', { date: item.date })
          : t('list.guideLabel', { date: item.date });
        const sub = isCal
          ? t('list.stepsSummary', { count: fmtInteger(log.calibrations[sec.idx].entries.length) })
          : t('list.framesSummary', {
              frames: fmtInteger(log.sessions[sec.idx].entries.length),
              duration: fmtDuration(log.sessions[sec.idx].duration),
            });
        const isSelected = selected === i;
        // GA badge: a session counts as having a Guiding Assistant run
        // when extractGAResults returns at least one recommendation/metric
        // run. Calibration sections never have GA (PHD2 only emits GA
        // events during guiding sessions).
        const hasGa = session ? extractGAResults(session).length > 0 : false;
        const baseTip = isCal
          ? t('list.calibrationTooltip', { date: item.date, count: fmtInteger(log.calibrations[sec.idx].entries.length) })
          : t('list.guideSessionTooltip', {
              date: item.date,
              frames: fmtInteger(log.sessions[sec.idx].entries.length),
              duration: fmtDuration(log.sessions[sec.idx].duration),
            });
        const tip = hasGa ? `${baseTip} · ${t('list.gaTooltip')}` : baseTip;
        const rms = session ? rmsBySession[sec.idx] : null;
        const rmsTip = rms && session
          ? t(rms.viewed ? 'list.rmsTooltip' : 'list.rmsTooltipUnviewed', {
              total: fmtRms(rms.rmsTotal, session.pixelScale),
              ra: fmtRms(rms.rmsRa, session.pixelScale),
              dec: fmtRms(rms.rmsDec, session.pixelScale),
              included: fmtInteger(rms.includedCount),
              frames: fmtInteger(session.entries.length),
            })
          : '';
        return (
          <li key={i}>
            <button
              // Full label is allowed to wrap onto a second line so the
              // user can read "Guide · 2024-01-15 22:05:00" complete in
              // a 260px-wide sidebar instead of getting truncated. Sub-
              // line stays compact.
              className={`flex w-full items-start gap-2 px-3 py-1.5 text-start text-xs hover:bg-slate-800 ${
                isSelected ? 'bg-slate-800 text-sky-300' : 'text-slate-200'
              }`}
              onClick={() => select(i)}
              title={tip}
            >
              <span
                className={`mt-0.5 flex-shrink-0 ${isCal ? 'text-amber-400' : 'text-sky-400'}`}
                title={isCal ? t('list.calibrationIconTooltip') : t('list.guideIconTooltip')}
              >
                {isCal ? <CalibrationIcon /> : <GuideIcon />}
              </span>
              <span className="flex-1 min-w-0">
                <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  {/* 1-based ordinal across the combined cal+guide list,
                      matching the "(N of M)" position shown in SectionSummary. */}
                  <span className="font-normal tabular-nums text-slate-500">{i + 1})</span>
                  <span className="break-words font-normal">{label}</span>
                  {hasGa && (
                    <span
                      // Bordered "GA" pill — small but high-contrast so it
                      // reads at a glance. Amber to match the analysis-
                      // modal banner where the user opens the GA panel.
                      // text-[9px] keeps it on the same line as the label
                      // without overpowering it.
                      className="inline-flex items-center rounded border border-amber-500/70 bg-amber-500/15 px-1 py-0 text-[9px] font-semibold uppercase leading-tight tracking-wide text-amber-300"
                      title={t('list.gaTooltip')}
                    >
                      GA
                    </span>
                  )}
                </span>
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] font-normal text-slate-400">{sub}</span>
                  {rms && session && (
                    // Right-aligned so the values read down the list as a
                    // column. It sits on the sub-line, not the label line:
                    // there it would squeeze the label into wrapping at the
                    // default sidebar width. The amber dot flags a section
                    // whose exclusions differ from the default settling ones
                    // (a manual range, Include all, the dither policy…).
                    <span
                      className={`flex flex-shrink-0 items-center gap-1 font-mono text-[11px] tabular-nums ${
                        isSelected ? 'text-sky-300' : 'text-slate-300'
                      }`}
                      title={wrapTip(rmsTip)}
                      data-testid="section-rms"
                    >
                      {rms.edited && (
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-amber-400"
                          title={wrapTip(t('list.rmsEditedTooltip'))}
                          aria-label={t('list.rmsEditedTooltip')}
                        />
                      )}
                      {rms.includedCount > 0 ? fmtRms(rms.rmsTotal, session.pixelScale) : '—'}
                    </span>
                  )}
                </span>
              </span>
            </button>
          </li>
        );
      })}
      </ul>
    </>
  );
}
