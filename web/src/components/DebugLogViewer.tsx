import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useDebugLogStore } from '../state/debugLogStore';

const LINE_HEIGHT = 18; // px; must match the row style below
const OVERSCAN = 20; // extra rows above/below the viewport

/** Wall-clock-UTC ms → HH:MM:SS.mmm (the values are Date.UTC-encoded). */
function fmtWall(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`;
}

/**
 * Full-screen viewer for the sibling PHD2 DEBUG log, opened by double-clicking
 * the Analysis drift chart. The whole file is loaded; a hand-rolled virtual
 * list (fixed row height) renders only the visible slice so even a 40 MB / few-
 * hundred-thousand-line log scrolls smoothly. On open it scrolls the closest-
 * timestamp line to centre and highlights it. Browser sandboxing means we can't
 * hand the file to an external editor, so this in-app viewer stands in for that.
 */
export function DebugLogViewer() {
  const { t } = useTranslation('analysis');
  const status = useDebugLogStore((s) => s.status);
  const lines = useDebugLogStore((s) => s.lines);
  const matchedIndex = useDebugLogStore((s) => s.matchedIndex);
  const fileName = useDebugLogStore((s) => s.fileName);
  const targetMs = useDebugLogStore((s) => s.targetMs);
  const matchedMs = useDebugLogStore((s) => s.matchedMs);
  const errorKey = useDebugLogStore((s) => s.errorKey);
  const canPick = useDebugLogStore((s) => s.canPick);
  const close = useDebugLogStore((s) => s.close);
  const pickFile = useDebugLogStore((s) => s.pickFile);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);

  // Widest line drives the virtual content width (ch units == exact monospace
  // column width), so horizontal scroll is stable as rows recycle.
  const maxLen = useMemo(() => {
    let m = 0;
    for (let i = 0; i < lines.length; i++) if (lines[i].length > m) m = lines[i].length;
    return m;
  }, [lines]);

  const centreOnMatch = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const top = matchedIndex * LINE_HEIGHT - el.clientHeight / 2 + LINE_HEIGHT / 2;
    el.scrollTop = Math.max(0, top);
  }, [matchedIndex]);

  // Centre the matched line whenever a new match opens.
  useEffect(() => {
    if (status !== 'open') return;
    const el = scrollRef.current;
    if (!el) return;
    setViewportH(el.clientHeight);
    centreOnMatch();
    setScrollTop(el.scrollTop);
  }, [status, matchedIndex, centreOnMatch]);

  // Esc closes; keep viewport height in sync with window resizes.
  useEffect(() => {
    if (status === 'closed') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onResize = () => { if (scrollRef.current) setViewportH(scrollRef.current.clientHeight); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [status, close]);

  if (status === 'closed') return null;

  const firstVisible = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(viewportH / LINE_HEIGHT) + OVERSCAN * 2;
  const lastVisible = Math.min(lines.length, firstVisible + visibleCount);
  const slice: { i: number; text: string }[] = [];
  for (let i = firstVisible; i < lastVisible; i++) slice.push({ i, text: lines[i] });

  const onPickClick = () => fileInputRef.current?.click();

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-sky-800 bg-slate-900 px-4 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold uppercase tracking-wide text-sky-300">
            {t('debugViewer.title')}
          </span>
          {fileName && <span className="font-mono text-xs text-slate-400">{fileName}</span>}
          {status === 'open' && (
            <span className="font-mono text-xs text-slate-400" title={t('debugViewer.matchTooltip')}>
              {fmtWall(targetMs)} → <span className="text-amber-300">{fmtWall(matchedMs)}</span>
              {' '}({t('debugViewer.line', { n: matchedIndex + 1 })})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {status === 'open' && (
            <button
              onClick={centreOnMatch}
              className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 ring-1 ring-slate-700 hover:bg-slate-700"
              title={t('debugViewer.goToMatchTooltip')}
            >
              {t('debugViewer.goToMatch')}
            </button>
          )}
          <button
            onClick={close}
            className="flex items-center gap-1 rounded bg-slate-800 px-3 py-1 text-sm text-slate-100 ring-1 ring-slate-700 hover:bg-rose-700 hover:ring-rose-600"
            title={t('debugViewer.closeTooltip')}
          >
            <span className="text-base leading-none">✕</span>
            <span>{t('debugViewer.close')}</span>
            <span className="ms-1 text-xs opacity-70">{t('esc')}</span>
          </button>
        </div>
      </header>

      {status === 'loading' && (
        <div className="flex flex-1 items-center justify-center text-slate-400">
          {t('debugViewer.loading')}
        </div>
      )}

      {status === 'error' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="max-w-lg text-slate-300">{t(`debugViewer.error.${errorKey}`)}</div>
          {canPick && (
            <button
              onClick={onPickClick}
              className="rounded bg-sky-700 px-4 py-2 text-sm text-white ring-1 ring-sky-500 hover:bg-sky-600"
            >
              {t('debugViewer.pick')}
            </button>
          )}
        </div>
      )}

      {status === 'open' && (
        <div
          ref={scrollRef}
          onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
          className="flex-1 overflow-auto bg-slate-950 font-mono text-xs leading-[18px] text-slate-300"
        >
          <div style={{ position: 'relative', height: lines.length * LINE_HEIGHT, width: `${maxLen + 8}ch` }}>
            {slice.map(({ i, text }) => {
              const matched = i === matchedIndex;
              return (
                <div
                  key={i}
                  className={`absolute left-0 flex whitespace-pre ${matched ? 'bg-amber-500/25' : ''}`}
                  style={{ top: i * LINE_HEIGHT, height: LINE_HEIGHT, width: '100%' }}
                >
                  <span className="inline-block w-[7ch] flex-none select-none pe-2 text-right text-slate-600">
                    {i + 1}
                  </span>
                  <span className={matched ? 'text-amber-100' : ''}>{text}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.log,text/plain"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void pickFile(f);
        }}
      />
    </div>
  );
}
