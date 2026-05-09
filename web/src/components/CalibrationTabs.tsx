import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalibrationPlot } from './CalibrationPlot';
import { CalibrationStats } from './CalibrationStats';
import { BacklashTab } from './BacklashTab';

type CalTab = 'calibration' | 'backlash';

/** Two-tab wrapper for the Calibration section view: the original cal
 *  plot + stats, plus the new Backlash Analysis tool. The user's tab
 *  choice is component-local (not persisted) — simplest behavior; the
 *  cal view comes up first on every section switch. */
export function CalibrationTabs() {
  const { t } = useTranslation('common');
  const [tab, setTab] = useState<CalTab>('calibration');
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-1 border-b border-slate-800 bg-slate-900/40 px-2 py-1">
        <TabBtn
          active={tab === 'calibration'}
          onClick={() => setTab('calibration')}
          title={t('calibrationTabs.calibrationResultsTooltip')}
        >
          {t('calibrationTabs.calibrationResults')}
        </TabBtn>
        <TabBtn
          active={tab === 'backlash'}
          onClick={() => setTab('backlash')}
          title={t('calibrationTabs.backlashAnalysisTooltip')}
        >
          {t('calibrationTabs.backlashAnalysis')}
        </TabBtn>
      </div>
      {tab === 'calibration' ? (
        <>
          <div className="flex-1 overflow-hidden">
            <CalibrationPlot />
          </div>
          <div className="border-t border-slate-800 bg-slate-900/40">
            <CalibrationStats />
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-hidden">
          <BacklashTab />
        </div>
      )}
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
