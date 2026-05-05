import { useTranslation } from 'react-i18next';
import { AnalysisModal } from '../components/AnalysisModal';
import { SectionList } from '../components/SectionList';
import { StatsGrid } from '../components/StatsGrid';
import { GuideGraph } from '../components/GuideGraph';
import { ScatterView } from '../components/ScatterView';
import { CalibrationPlot } from '../components/CalibrationPlot';
import { CalibrationStats } from '../components/CalibrationStats';
import { SectionHeader } from '../components/SectionHeader';
import { GraphToolbar } from '../components/GraphToolbar';
import { GraphContextMenu } from '../components/ContextMenu';
import { RecentsDropdown } from '../components/RecentsDropdown';
import { LogsFolderPane } from '../components/LogsFolderPane';
import { LanguagePicker } from '../components/LanguagePicker';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
import { useKeyboardShortcuts } from '../state/useKeyboard';

export function ViewerPage() {
  useKeyboardShortcuts();
  const { t } = useTranslation('common');
  const log = useLogStore((s) => s.log);
  const meta = useLogStore((s) => s.meta);
  const clear = useLogStore((s) => s.clear);
  const sectionIdx = useLogStore((s) => s.selectedSection);
  const graphMode = useViewStore((s) => s.graphMode);

  // No more dedicated home/landing page: the app always renders the viewer
  // chrome (header + sidebar + main pane). Until a log is loaded the sidebar
  // shows the Open-log drop zone (LogsFolderPane) and the Recents dropdown,
  // so the user has the same entry points without an extra hop.
  const sec = log && sectionIdx >= 0 ? log.sections[sectionIdx] : null;
  const isGuiding = sec?.type === 'GUIDING';
  const isCalibration = sec?.type === 'CALIBRATION';
  const sectionHdr = sec && log
    ? sec.type === 'GUIDING'
      ? log.sessions[sec.idx]?.hdr
      : log.calibrations[sec.idx]?.hdr
    : null;

  return (
    <>
      <div className="grid h-full grid-cols-[260px_1fr] grid-rows-[auto_1fr]">
        <header className="col-span-2 flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <h1 className="text-sm font-medium">
          {t('appName')}
          <span className="ms-2 text-xs text-slate-500" title={t('buildTooltip', { hash: __APP_GITHASH__ })}>
            v{__APP_VERSION__} · {__APP_GITHASH__}
          </span>
          {log && (
            <>
              <span className="mx-2 text-slate-700">|</span>
              <span className="text-slate-400">{meta?.name}</span>
              <span className="ms-2 text-xs text-slate-500">{t('phdVersion', { version: log.phdVersion })}</span>
            </>
          )}
        </h1>
        <div className="flex items-center gap-3">
          <LanguagePicker />
          {log && (
            <button
              className="text-xs text-slate-400 hover:text-slate-200"
              onClick={clear}
              title={t('openAnotherTooltip')}
            >
              {t('openAnother')}
            </button>
          )}
        </div>
      </header>
      {/* Sidebar spans the full content height so its scrollable section list
          extends to the bottom of the page, independent of the stats footer. */}
      <aside className="flex flex-col overflow-hidden border-e border-slate-800">
        <LogsFolderPane />
        <RecentsDropdown />
        <div className="flex-1 overflow-y-auto">
          <SectionList />
        </div>
      </aside>
      {/* Main column owns the toolbar, chart, and stats stack. The stats
          appear directly under the graph area (not under the sidebar). */}
      <main className="relative flex flex-col overflow-hidden">
        {isGuiding && (
          <>
            <GraphToolbar />
            {sectionHdr && <SectionHeader hdr={sectionHdr} kind="GUIDING" />}
            <GraphContextMenu>
              <div className="flex-1 overflow-hidden">
                {graphMode === 'TIME' ? <GuideGraph /> : <ScatterView />}
              </div>
            </GraphContextMenu>
            <div className="border-t border-slate-800 bg-slate-900/40">
              <StatsGrid />
            </div>
          </>
        )}
        {isCalibration && (
          <>
            {sectionHdr && <SectionHeader hdr={sectionHdr} kind="CALIBRATION" />}
            <div className="flex-1 overflow-hidden">
              <CalibrationPlot />
            </div>
            <div className="border-t border-slate-800 bg-slate-900/40">
              <CalibrationStats />
            </div>
          </>
        )}
        {!log && (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
            {t('noLogHint')}
          </div>
        )}
        {log && !sec && (
          <div className="flex h-full items-center justify-center text-slate-500">
            {t('selectSection')}
          </div>
        )}
      </main>
      </div>
      <AnalysisModal />
    </>
  );
}
