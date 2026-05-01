import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as RCM from '@radix-ui/react-context-menu';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
const computeSettlingMask = (s) => {
    const m = new Uint8Array(s.entries.length);
    let inSettle = false;
    let startEntryIdx = 0;
    for (const info of s.infos) {
        if (info.info === 'state=1' && !inSettle) {
            inSettle = true;
            startEntryIdx = info.idx;
        }
        else if (info.info === 'state=0' && inSettle) {
            for (let i = startEntryIdx; i < info.idx && i < s.entries.length; i++)
                m[i] = 1;
            inSettle = false;
        }
    }
    if (inSettle) {
        for (let i = startEntryIdx; i < s.entries.length; i++)
            m[i] = 1;
    }
    return m;
};
export function GraphContextMenu({ children }) {
    const log = useLogStore((s) => s.log);
    const sectionIdx = useLogStore((s) => s.selectedSection);
    const includeAll = useViewStore((s) => s.includeAll);
    const excludeAll = useViewStore((s) => s.excludeAll);
    const setMask = useViewStore((s) => s.setMask);
    const sec = log && sectionIdx >= 0 ? log.sections[sectionIdx] : null;
    const session = sec && sec.type === 'GUIDING' ? log.sessions[sec.idx] : null;
    const sessionIdx = sec && sec.type === 'GUIDING' ? sec.idx : -1;
    const isUnguided = !!session && session.entries.length > 0 && !session.entries[0].guiding;
    return (_jsxs(RCM.Root, { children: [_jsx(RCM.Trigger, { asChild: true, children: children }), _jsx(RCM.Portal, { children: _jsxs(RCM.Content, { className: "min-w-[14rem] rounded border border-slate-700 bg-slate-900 p-1 text-sm shadow-lg", children: [_jsx(Item, { disabled: !session, onSelect: () => session && includeAll(sessionIdx, session.entries.length), children: "Include all frames" }), _jsx(Item, { disabled: !session, onSelect: () => session && excludeAll(sessionIdx, session.entries.length), children: "Exclude all frames" }), _jsx(Item, { disabled: !session, onSelect: () => session && setMask(sessionIdx, computeSettlingMask(session)), children: "Exclude frames settling" }), _jsx(RCM.Separator, { className: "my-1 h-px bg-slate-700" }), _jsx(Item, { disabled: true, hint: "Coming in v3", children: "Analyze selected frames" }), _jsx(Item, { disabled: true, hint: "Coming in v3", children: "Analyze selected, raw RA" }), isUnguided && _jsx(Item, { disabled: true, hint: "Coming in v3", children: "Analyze unguided section" })] }) })] }));
}
function Item({ children, onSelect, disabled, hint }) {
    return (_jsxs(RCM.Item, { disabled: disabled, onSelect: onSelect, className: `flex cursor-pointer items-center justify-between rounded px-2 py-1 outline-none ${disabled ? 'text-slate-500' : 'text-slate-100 data-[highlighted]:bg-slate-800'}`, children: [_jsx("span", { children: children }), hint && _jsx("span", { className: "ml-3 text-xs text-slate-500", children: hint })] }));
}
