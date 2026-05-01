import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
        return (_jsxs("div", { className: "mx-auto flex h-full max-w-2xl flex-col justify-center gap-4 p-6", children: [_jsx("h1", { className: "text-2xl font-semibold", children: "PHD2 Log Viewer" }), _jsx(DropZone, {}), _jsx(RecentsPanel, {})] }));
    }
    return (_jsxs("div", { className: "grid h-full grid-cols-[260px_1fr_320px] grid-rows-[auto_1fr]", children: [_jsxs("header", { className: "col-span-3 flex items-center justify-between border-b border-slate-800 px-4 py-2", children: [_jsxs("h1", { className: "text-sm font-medium", children: ["PHD2 Log Viewer \u2014 ", _jsx("span", { className: "text-slate-400", children: meta?.name })] }), _jsx("button", { className: "text-xs text-slate-400 hover:text-slate-200", onClick: clear, children: "Open another" })] }), _jsxs("aside", { className: "overflow-y-auto border-r border-slate-800", children: [_jsx(SectionList, {}), _jsx(RecentsPanel, {})] }), _jsx("main", { className: "relative", children: _jsx(GraphContextMenu, { children: _jsx("div", { className: "h-full", children: _jsx(GuideGraph, {}) }) }) }), _jsx("aside", { className: "overflow-y-auto border-l border-slate-800", children: _jsx(StatsGrid, {}) })] }));
}
