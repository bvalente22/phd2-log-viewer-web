import { useTranslation } from 'react-i18next';

interface Props {
  /** Source log filename (e.g. "PHD2_GuideLog_2026-04-15.txt"). */
  filename: string | undefined;
  /** Section kind — drives label text and accent color. */
  kind: 'GUIDING' | 'CALIBRATION';
  /** Section start date as captured by the parser; passed through verbatim. */
  date: string;
  /** 0-based index of the active section within `log.sections`. */
  sectionIndex: number;
  /** Total number of sections in the log. */
  totalSections: number;
}

/**
 * Always-visible identification strip that sits between the collapsible
 * SectionHeader and the chart. Shows which log file is loaded and which
 * section is active so the user never has to look up at the page header
 * (or expand the section header) to remember what they're looking at.
 *
 * Renders for both guiding and calibration sections. Stays visible
 * regardless of whether SectionHeader is twirled open — it's a sibling
 * in the layout, not a child of the disclosure.
 */
export function SectionSummary({ filename, kind, date, sectionIndex, totalSections }: Props) {
  const { t } = useTranslation('sections');
  const isCal = kind === 'CALIBRATION';
  // Reuse the SectionList labels so the strip and the sidebar stay in
  // visual sync ("Guide · 2026-04-15" / "Cal · 2026-04-15").
  const label = isCal
    ? t('list.calLabel', { date })
    : t('list.guideLabel', { date });
  return (
    <div
      className="flex flex-wrap items-baseline gap-x-2 border-b border-slate-800 bg-slate-900/40 px-3 py-1 text-xs"
      title={t('summary.tooltip', { filename: filename ?? '', label })}
    >
      <span className="font-medium text-slate-200" title={filename}>
        {filename ?? ''}
      </span>
      <span className="text-slate-600" aria-hidden>·</span>
      <span className={isCal ? 'text-amber-400' : 'text-sky-400'}>
        {label}
      </span>
      <span className="text-slate-500">
        {t('summary.position', { index: sectionIndex + 1, total: totalSections })}
      </span>
    </div>
  );
}
