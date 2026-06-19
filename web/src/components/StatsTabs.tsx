import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StatsGrid } from './StatsGrid';
import { ImageImpact } from './ImageImpact';
import { PolarAlignmentPanel } from './PolarAlignmentPanel';

type StatsTab = 'stats' | 'imaging' | 'pa';

/** Three-tab footer for the guiding view: Stats (default) | Estimated Imaging
 *  Impact | Polar Alignment. Only the active tab renders, so the default Stats
 *  tab is shorter than the old combined footer. Tab choice is component-local
 *  (not persisted) and resets to Stats on every section switch — same
 *  convention as CalibrationTabs.
 *  See docs/superpowers/specs/2026-06-19-tabbed-stats-footer-design.md */
export function StatsTabs() {
  const { t } = useTranslation('common');
  const [tab, setTab] = useState<StatsTab>('stats');
  return (
    // Elevated slate-800 surface (matches the dashboard) so the footer reads as
    // a separate panel, not a continuation of the chart background.
    <div className="border-t border-slate-700 bg-slate-800">
      <div className="flex items-center gap-1 border-b border-slate-700 bg-slate-900/40 px-2 py-1">
        <TabBtn active={tab === 'stats'} onClick={() => setTab('stats')} title={t('statsTabs.statsTooltip')}>
          {t('statsTabs.stats')}
        </TabBtn>
        <TabBtn active={tab === 'imaging'} onClick={() => setTab('imaging')} title={t('statsTabs.imagingImpactTooltip')}>
          {t('statsTabs.imagingImpact')}
        </TabBtn>
        <TabBtn active={tab === 'pa'} onClick={() => setTab('pa')} title={t('statsTabs.polarAlignmentTooltip')}>
          {t('statsTabs.polarAlignment')}
        </TabBtn>
      </div>
      {tab === 'stats' && <StatsGrid />}
      {tab === 'imaging' && <ImageImpact />}
      {tab === 'pa' && <PolarAlignmentPanel />}
    </div>
  );
}

function TabBtn({ active, onClick, children, title }: {
  active: boolean; onClick: () => void; children: React.ReactNode; title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`rounded px-3 py-0.5 text-xs font-semibold transition-colors ${
        active
          ? 'bg-amber-700 text-amber-50'
          : 'bg-slate-800 text-slate-300 ring-1 ring-slate-700 hover:bg-slate-700'
      }`}
    >
      {children}
    </button>
  );
}
