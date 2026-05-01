import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useRef, useState } from 'react';
import { useLogStore } from '../state/logStore';
export function DropZone() {
    const loadFromText = useLogStore((s) => s.loadFromText);
    const loading = useLogStore((s) => s.loading);
    const error = useLogStore((s) => s.error);
    const inputRef = useRef(null);
    const [dragOver, setDragOver] = useState(false);
    const handleFile = useCallback(async (file) => {
        const text = await file.text();
        await loadFromText(text, file.name);
    }, [loadFromText]);
    return (_jsxs("div", { className: `flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${dragOver ? 'border-sky-400 bg-sky-950/30' : 'border-slate-600'}`, onDragOver: (e) => { e.preventDefault(); setDragOver(true); }, onDragLeave: () => setDragOver(false), onDrop: (e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f)
                void handleFile(f);
        }, children: [_jsx("p", { className: "mb-3 text-slate-300", children: "Drop a PHD2 guide log here" }), _jsx("button", { className: "rounded bg-sky-600 px-3 py-1 text-sm hover:bg-sky-500", onClick: () => inputRef.current?.click(), children: "or pick a file" }), _jsx("input", { ref: inputRef, type: "file", accept: ".log,.txt,text/plain", className: "hidden", onChange: (e) => {
                    const f = e.target.files?.[0];
                    if (f)
                        void handleFile(f);
                    e.target.value = '';
                } }), loading && _jsx("p", { className: "mt-3 text-sm text-slate-400", children: "Parsing\u2026" }), error && _jsx("p", { className: "mt-3 text-sm text-red-400", children: error })] }));
}
