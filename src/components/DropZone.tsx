import { useCallback, useRef, useState } from 'react';
import { useLogStore } from '../state/logStore';
import { useFolderStore } from '../state/folderStore';

export function DropZone() {
  const loadFromText = useLogStore((s) => s.loadFromText);
  const loading = useLogStore((s) => s.loading);
  const error = useLogStore((s) => s.error);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const folderState = useFolderStore((s) => s.state);
  const pickFolder = useFolderStore((s) => s.pickFolder);
  const folderSupported = folderState !== 'unsupported';

  const handleFile = useCallback(async (file: File) => {
    const text = await file.text();
    await loadFromText(text, file.name);
  }, [loadFromText]);

  return (
    <>
      <div
        title="Drop a PHD2 guide log file here. The log is parsed locally; nothing is uploaded."
        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
          dragOver ? 'border-sky-400 bg-sky-950/30' : 'border-slate-600'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void handleFile(f);
        }}
      >
        <p className="mb-3 text-slate-300">Drop a PHD2 guide log here</p>
        <button
          className="rounded bg-sky-600 px-3 py-1 text-sm hover:bg-sky-500"
          onClick={() => inputRef.current?.click()}
          title="Open the file picker to choose a PHD2 guide log"
        >
          or pick a file
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".log,.txt,text/plain"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = '';
          }}
        />
        {loading && <p className="mt-3 text-sm text-slate-400">Parsing…</p>}
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </div>
      {folderSupported && (
        <div className="mt-3 flex flex-col items-center gap-2">
          <button
            className="rounded bg-slate-800 px-3 py-1 text-sm text-slate-200 hover:bg-slate-700"
            onClick={() => void pickFolder()}
            title="Pick your PHD2 logs folder; afterwards every guide log will be browsable from the sidebar"
          >
            Choose logs folder…
          </button>
          <p className="text-xs text-slate-500">Browse all your guide logs by date.</p>
        </div>
      )}
    </>
  );
}
