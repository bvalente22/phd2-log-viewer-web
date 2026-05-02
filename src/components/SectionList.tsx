import { useLogStore } from '../state/logStore';

const GuideIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <polyline points="6 16 10 11 13 14 17 8" />
    <polyline points="14 8 17 8 17 11" />
  </svg>
);

const CalibrationIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    <line x1="12" y1="2" x2="12" y2="5" />
    <line x1="12" y1="19" x2="12" y2="22" />
    <line x1="2" y1="12" x2="5" y2="12" />
    <line x1="19" y1="12" x2="22" y2="12" />
  </svg>
);

export function SectionList() {
  const log = useLogStore((s) => s.log);
  const selected = useLogStore((s) => s.selectedSection);
  const select = useLogStore((s) => s.selectSection);

  if (!log || log.sections.length === 0) {
    return <p className="p-3 text-sm text-slate-400">No sections.</p>;
  }

  return (
    <ul>
      {log.sections.map((sec, i) => {
        const isCal = sec.type === 'CALIBRATION';
        const item = isCal ? log.calibrations[sec.idx] : log.sessions[sec.idx];
        const label = isCal ? `Cal · ${item.date}` : `Guide · ${item.date}`;
        const sub = isCal
          ? `${log.calibrations[sec.idx].entries.length} steps`
          : `${log.sessions[sec.idx].entries.length} frames · ${Math.round(log.sessions[sec.idx].duration)}s`;
        const isSelected = selected === i;
        const tip = isCal
          ? `Calibration · ${item.date} · ${log.calibrations[sec.idx].entries.length} steps`
          : `Guide session · ${item.date} · ${log.sessions[sec.idx].entries.length} frames · ${Math.round(log.sessions[sec.idx].duration)}s`;
        return (
          <li key={i}>
            <button
              className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-slate-800 ${
                isSelected ? 'bg-slate-800 text-sky-300' : 'text-slate-200'
              }`}
              onClick={() => select(i)}
              title={tip}
            >
              <span
                className={isCal ? 'text-amber-400' : 'text-sky-400'}
                title={isCal ? 'Calibration section' : 'Guide session'}
              >
                {isCal ? <CalibrationIcon /> : <GuideIcon />}
              </span>
              <span className="flex-1 min-w-0">
                <div className="truncate font-medium">{label}</div>
                <div className="truncate text-xs text-slate-400">{sub}</div>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
