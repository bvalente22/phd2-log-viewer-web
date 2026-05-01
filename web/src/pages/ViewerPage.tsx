import { DropZone } from '../components/DropZone';
import { SectionList } from '../components/SectionList';
import { StatsGrid } from '../components/StatsGrid';
import { GuideGraph } from '../components/GuideGraph';
import { GraphContextMenu } from '../components/ContextMenu';
import { RecentsPanel } from '../components/RecentsPanel';
import { useLogStore } from '../state/logStore';
import { useKeyboardShortcuts } from '../state/useKeyboard';

export function ViewerPage() {
  useKeyboardShortcuts();
  const log = useLogStore((s) => s.log);
  const meta = useLogStore((s) => s.meta);
  const clear = useLogStore((s) => s.clear);

  if (!log) {
    return (
      <div className="mx-auto flex h-full max-w-2xl flex-col justify-center gap-4 p-6">
        <h1 className="text-2xl font-semibold">PHD2 Log Viewer</h1>
        <DropZone />
        <RecentsPanel />
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-[260px_1fr_320px] grid-rows-[auto_1fr]">
      <header className="col-span-3 flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <h1 className="text-sm font-medium">
          PHD2 Log Viewer — <span className="text-slate-400">{meta?.name}</span>
        </h1>
        <button
          className="text-xs text-slate-400 hover:text-slate-200"
          onClick={clear}
        >
          Open another
        </button>
      </header>
      <aside className="overflow-y-auto border-r border-slate-800">
        <SectionList />
        <RecentsPanel />
      </aside>
      <main className="relative">
        <GraphContextMenu>
          <div className="h-full">
            <GuideGraph />
          </div>
        </GraphContextMenu>
      </main>
      <aside className="overflow-y-auto border-l border-slate-800">
        <StatsGrid />
      </aside>
    </div>
  );
}
