import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AnalysisModal } from '../components/AnalysisModal';
import { SectionList } from '../components/SectionList';
import { StatsGrid } from '../components/StatsGrid';
import { GuideGraph } from '../components/GuideGraph';
import { ScatterView } from '../components/ScatterView';
import { CalibrationTabs } from '../components/CalibrationTabs';
import { SectionHeader } from '../components/SectionHeader';
import { SectionSummary } from '../components/SectionSummary';
import { GraphToolbar } from '../components/GraphToolbar';
import { GraphContextMenu } from '../components/ContextMenu';
import { AnalysisButton } from '../components/AnalysisButton';
import { RecentsDropdown } from '../components/RecentsDropdown';
import { LogsFolderPane } from '../components/LogsFolderPane';
import { LanguagePicker } from '../components/LanguagePicker';
import { ThemePicker } from '../components/ThemePicker';
import { GAResultsPanel } from '../components/GAResultsPanel';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
import { useKeyboardShortcuts } from '../state/useKeyboard';
import { themeOf } from '../themes';

export function ViewerPage() {
  useKeyboardShortcuts();
  const { t } = useTranslation('common');
  const log = useLogStore((s) => s.log);
  const meta = useLogStore((s) => s.meta);
  const sectionIdx = useLogStore((s) => s.selectedSection);
  const graphMode = useViewStore((s) => s.graphMode);
  const theme = useViewStore((s) => s.theme);
  const sidebarCollapsed = useViewStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useViewStore((s) => s.setSidebarCollapsed);

  // Apply the active theme to <html> as a data attribute. CSS in
  // index.css selectors `[data-theme="paper"] .bg-slate-900 { ... }`
  // override the default Tailwind slate-* surface classes for non-default
  // themes. We use the html element (not body) so the rule cascade also
  // affects the body background painted before React hydrates — avoids
  // a flash of dark theme on first paint when a non-default theme is
  // restored from localStorage.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = themeOf(theme).dataAttr;
    return () => { delete root.dataset.theme; };
  }, [theme]);

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

  // Grid template flips between expanded sidebar (260px) and a thin
  // 32px rail that holds only the expand toggle. Keeping the rail
  // visible (rather than fully hiding the sidebar) guarantees the
  // user can always see how to bring the sidebar back.
  const sidebarWidth = sidebarCollapsed ? '32px' : '260px';

  return (
    <>
      <div
        className="grid h-full grid-rows-[auto_1fr]"
        style={{ gridTemplateColumns: `${sidebarWidth} 1fr` }}
      >
        <header className="col-span-2 flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <h1 className="text-sm font-medium">
          {t('appName')}
          <span className="ms-2 text-xs text-slate-500" title={t('buildTooltip', { hash: __APP_GITHASH__ })}>
            v{__APP_VERSION__} · {__APP_GITHASH__}
          </span>
          {log && (
            <>
              <span className="mx-2 text-slate-700">|</span>
              {/* Filename can be 30+ chars on real PHD2 logs; the
                  smaller text-xs + lighter slate-400 keeps it readable
                  without forcing the header to wrap on narrow viewports.
                  The full name also lives in the SectionSummary strip. */}
              <span className="break-all text-xs font-normal text-slate-400" title={meta?.name}>
                {meta?.name}
              </span>
              <span className="ms-2 text-xs text-slate-500">{t('phdVersion', { version: log.phdVersion })}</span>
            </>
          )}
        </h1>
        <div className="flex items-center gap-3">
          <ThemePicker />
          <LanguagePicker />
        </div>
      </header>
      {/* Sidebar spans the full content height so its scrollable section list
          extends to the bottom of the page, independent of the stats footer.
          Collapses to a 32px rail whose only content is the expand toggle —
          the rail stays visible so the user always knows where to click to
          bring the sidebar back. */}
      <aside className="relative flex flex-col overflow-hidden border-e border-slate-800">
        {sidebarCollapsed ? (
          // Collapsed: the entire rail is the expand button, painted in
          // a warm amber that complements the cool slate/blue chrome so
          // the call-to-action is impossible to miss. Filling the full
          // height (vs. a small icon) maximizes the click target; the
          // chevron points right toward where the sidebar reappears.
          <button
            type="button"
            onClick={() => setSidebarCollapsed(false)}
            title={t('sidebar.expandTooltip')}
            aria-label={t('sidebar.expand')}
            className="group flex h-full w-full flex-col items-center justify-center gap-3 bg-amber-500 text-slate-900 hover:bg-amber-400"
          >
            <span className="text-xl font-semibold leading-none transition-transform group-hover:translate-x-0.5">›</span>
            {/* Vertical "Expand" hint reinforces the affordance. CSS
                writing-mode rotates the text rather than relying on a
                separate icon font. */}
            <span
              className="text-[10px] font-semibold uppercase tracking-widest"
              style={{ writingMode: 'vertical-rl' }}
            >
              {t('sidebar.expand')}
            </span>
          </button>
        ) : (
          <>
            {/* Top strip: collapse button on the right edge in the same
                amber accent as the collapsed rail, so the user reads the
                two states as the same control. The chevron points left
                toward where the sidebar will tuck away. */}
            <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/40 px-2 py-1">
              <span className="text-[10px] uppercase tracking-widest text-slate-500">
                {t('sidebar.title')}
              </span>
              <button
                type="button"
                onClick={() => setSidebarCollapsed(true)}
                title={t('sidebar.collapseTooltip')}
                aria-label={t('sidebar.collapse')}
                className="group flex items-center gap-1 rounded bg-amber-500 px-2 py-0.5 text-xs font-semibold text-slate-900 hover:bg-amber-400"
              >
                <span className="leading-none transition-transform group-hover:-translate-x-0.5">‹</span>
                <span>{t('sidebar.hide')}</span>
              </button>
            </div>
            <LogsFolderPane />
            <RecentsDropdown />
            <div className="flex-1 overflow-y-auto">
              <SectionList />
            </div>
          </>
        )}
      </aside>
      {/* Main column owns the toolbar, chart, and stats stack. The stats
          appear directly under the graph area (not under the sidebar). */}
      <main className="relative flex flex-col overflow-hidden">
        {isGuiding && (
          <>
            <GraphToolbar />
            {sectionHdr && <SectionHeader hdr={sectionHdr} kind="GUIDING" />}
            {/* Always-visible identification strip — sits below the
                collapsible SectionHeader as a sibling so it stays put
                whether the header is twirled open or closed. */}
            {sec && log && (
              <SectionSummary
                filename={meta?.name}
                kind="GUIDING"
                date={log.sessions[sec.idx]?.date ?? ''}
                sectionIndex={sectionIdx}
                totalSections={log.sections.length}
              />
            )}
            <GAResultsPanel />
            <GraphContextMenu>
              <div className="relative flex-1 overflow-hidden">
                {graphMode === 'TIME' ? <GuideGraph /> : <ScatterView />}
                {/* Analysis button overlays the lower-left of the
                    chart area — functional equivalent of the
                    right-click "Analysis" menu item. Positioned with a
                    margin so it's clear of the chart's axis labels. */}
                <div className="pointer-events-none absolute bottom-3 left-3 z-10">
                  <div className="pointer-events-auto">
                    <AnalysisButton />
                  </div>
                </div>
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
            {sec && log && (
              <SectionSummary
                filename={meta?.name}
                kind="CALIBRATION"
                date={log.calibrations[sec.idx]?.date ?? ''}
                sectionIndex={sectionIdx}
                totalSections={log.sections.length}
              />
            )}
            {/* Two-tab view: original Calibration plot+stats on tab 1,
                Backlash Analysis on tab 2 (loads a paired DEBUG log). */}
            <CalibrationTabs />
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
