import { DropZone } from '../components/DropZone';
import { SectionList } from '../components/SectionList';
import { StatsGrid } from '../components/StatsGrid';
import { GuideGraph } from '../components/GuideGraph';
import { ScatterView } from '../components/ScatterView';
import { CalibrationPlot } from '../components/CalibrationPlot';
import { GraphToolbar } from '../components/GraphToolbar';
import { GraphContextMenu } from '../components/ContextMenu';
import { RecentsPanel } from '../components/RecentsPanel';
import { RecentsDropdown } from '../components/RecentsDropdown';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
import { useKeyboardShortcuts } from '../state/useKeyboard';

export function ViewerPage() {
  useKeyboardShortcuts();
  const log = useLogStore((s) => s.log);
  const meta = useLogStore((s) => s.meta);
  const clear = useLogStore((s) => s.clear);
  const sectionIdx = useLogStore((s) => s.selectedSection);
  const graphMode = useViewStore((s) => s.graphMode);

  if (!log) {
    return (
      <div className="mx-auto flex h-full max-w-2xl flex-col justify-center gap-4 p-6">
        <div>
          <h1 className="text-2xl font-semibold">PHD2 Log Viewer</h1>
          <p className="mt-1 text-xs text-slate-500" title={`build ${__APP_GITHASH__}`}>
            v{__APP_VERSION__} · {__APP_GITHASH__}
          </p>
        </div>
        <DropZone />
        <RecentsPanel />
      </div>
    );
  }

  const sec = sectionIdx >= 0 ? log.sections[sectionIdx] : null;
  const isGuiding = sec?.type === 'GUIDING';
  const isCalibration = sec?.type === 'CALIBRATION';

  return (
    <div className="grid h-full grid-cols-[260px_1fr] grid-rows-[auto_1fr]">
      <header className="col-span-2 flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <h1 className="text-sm font-medium">
          PHD2 Log Viewer
          <span className="ml-2 text-xs text-slate-500" title={`build ${__APP_GITHASH__}`}>
            v{__APP_VERSION__} · {__APP_GITHASH__}
          </span>
          <span className="mx-2 text-slate-700">|</span>
          <span className="text-slate-400">{meta?.name}</span>
          <span className="ml-2 text-xs text-slate-500">PHD2 v{log.phdVersion}</span>
        </h1>
        <button
          className="text-xs text-slate-400 hover:text-slate-200"
          onClick={clear}
        >
          Open another
        </button>
      </header>
      {/* Sidebar spans the full content height so its scrollable section list
          extends to the bottom of the page, independent of the stats footer. */}
      <aside className="flex flex-col overflow-hidden border-r border-slate-800">
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
        {isCalibration && <CalibrationPlot />}
        {!sec && (
          <div className="flex h-full items-center justify-center text-slate-500">
            Select a section.
          </div>
        )}
      </main>
    </div>
  );
}
