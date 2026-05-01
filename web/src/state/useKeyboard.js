import { useEffect } from 'react';
import { useLogStore } from './logStore';
import { useViewStore } from './viewStore';
export function useKeyboardShortcuts() {
    const log = useLogStore((s) => s.log);
    const selected = useLogStore((s) => s.selectedSection);
    const select = useLogStore((s) => s.selectSection);
    const setVerticalMode = useViewStore((s) => s.setVerticalMode);
    useEffect(() => {
        const onKey = (e) => {
            const tag = e.target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA')
                return;
            if (!log)
                return;
            if (e.key === 'p' || e.key === 'P')
                setVerticalMode('PAN');
            else if (e.key === 'z' || e.key === 'Z')
                setVerticalMode('ZOOM');
            else if (e.key === '[' && selected > 0)
                select(selected - 1);
            else if (e.key === ']' && selected < log.sections.length - 1)
                select(selected + 1);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [log, selected, select, setVerticalMode]);
}
