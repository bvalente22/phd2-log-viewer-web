import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { listRecents, getRecent, deleteRecent } from '../storage/recents';
import { useLogStore } from '../state/logStore';
export function RecentsPanel() {
    const [items, setItems] = useState([]);
    const loadFromText = useLogStore((s) => s.loadFromText);
    const refresh = async () => setItems(await listRecents());
    useEffect(() => { void refresh(); }, []);
    if (items.length === 0)
        return null;
    return (_jsxs("div", { className: "border-t border-slate-800 p-3", children: [_jsx("h3", { className: "mb-2 text-xs font-medium uppercase tracking-wide text-slate-400", children: "Recent" }), _jsx("ul", { className: "space-y-1", children: items.map((r) => (_jsxs("li", { className: "flex items-center justify-between text-sm", children: [_jsx("button", { className: "flex-1 truncate text-left text-slate-200 hover:text-sky-300", onClick: async () => {
                                const rec = await getRecent(r.id);
                                if (rec)
                                    await loadFromText(rec.text, rec.name, { persist: false });
                            }, children: r.name }), _jsx("button", { className: "ml-2 text-slate-500 hover:text-red-400", onClick: async () => { await deleteRecent(r.id); await refresh(); }, title: "Remove", children: "\u00D7" })] }, r.id))) })] }));
}
