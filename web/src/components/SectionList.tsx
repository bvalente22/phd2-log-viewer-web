import { useLogStore } from '../state/logStore';

export function SectionList() {
  const log = useLogStore((s) => s.log);
  const selected = useLogStore((s) => s.selectedSection);
  const select = useLogStore((s) => s.selectSection);

  if (!log || log.sections.length === 0) {
    return <p className="p-3 text-sm text-slate-400">No sections.</p>;
  }

  return (
    <ul className="overflow-y-auto">
      {log.sections.map((sec, i) => {
        const isCal = sec.type === 'CALIBRATION';
        const item = isCal ? log.calibrations[sec.idx] : log.sessions[sec.idx];
        const label = isCal ? `Cal: ${item.date}` : `Guide: ${item.date}`;
        const sub = isCal
          ? `${log.calibrations[sec.idx].entries.length} steps`
          : `${log.sessions[sec.idx].entries.length} frames, ${Math.round(log.sessions[sec.idx].duration)}s`;
        return (
          <li key={i}>
            <button
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-800 ${
                selected === i ? 'bg-slate-800 text-sky-300' : 'text-slate-200'
              }`}
              onClick={() => select(i)}
            >
              <div className="font-medium">{label}</div>
              <div className="text-xs text-slate-400">{sub}</div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
