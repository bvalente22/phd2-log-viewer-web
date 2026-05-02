import { useViewStore } from '../state/viewStore';
import { useLogStore } from '../state/logStore';
import type { TraceVisibility } from '../state/viewStore';

const ToggleChip = ({
  label, active, onClick, disabled,
}: { label: string; active: boolean; onClick: () => void; disabled?: boolean }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`rounded px-2 py-0.5 text-xs transition-colors ${
      disabled
        ? 'cursor-not-allowed bg-slate-900 text-slate-600'
        : active
        ? 'bg-sky-700 text-white hover:bg-sky-600'
        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
    }`}
  >
    {label}
  </button>
);

export function GraphToolbar() {
  const log = useLogStore((s) => s.log);
  const sectionIdx = useLogStore((s) => s.selectedSection);
  const traces = useViewStore((s) => s.traces);
  const toggleTrace = useViewStore((s) => s.toggleTrace);
  const exclusions = useViewStore((s) => s.exclusions);
  const scaleMode = useViewStore((s) => s.scaleMode);
  const setScaleMode = useViewStore((s) => s.setScaleMode);
  const graphMode = useViewStore((s) => s.graphMode);
  const setGraphMode = useViewStore((s) => s.setGraphMode);

  const sec = log && sectionIdx >= 0 ? log.sections[sectionIdx] : null;
  const session = sec && sec.type === 'GUIDING' ? log!.sessions[sec.idx] : null;
  const sessionIdx = sec && sec.type === 'GUIDING' ? sec.idx : -1;
  const mask = sessionIdx >= 0 ? exclusions.get(sessionIdx) : undefined;
  const excludedCount = mask ? mask.reduce((a, b) => a + b, 0) : 0;
  const totalCount = session?.entries.length ?? 0;

  const items: { key: keyof TraceVisibility; label: string }[] = [
    { key: 'ra', label: 'RA' },
    { key: 'dec', label: 'Dec' },
    { key: 'raPulses', label: 'RA pulses' },
    { key: 'decPulses', label: 'Dec pulses' },
    { key: 'mass', label: 'Mass' },
    { key: 'snr', label: 'SNR' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-1 text-xs">
      <span className="mr-1 text-slate-500">view:</span>
      <ToggleChip
        label="time"
        active={graphMode === 'TIME'}
        onClick={() => setGraphMode('TIME')}
      />
      <ToggleChip
        label="scatter"
        active={graphMode === 'SCATTER'}
        onClick={() => setGraphMode('SCATTER')}
      />
      <span className="ml-3 mr-1 text-slate-500">show:</span>
      {items.map((it) => (
        <ToggleChip
          key={it.key}
          label={it.label}
          active={traces[it.key]}
          onClick={() => toggleTrace(it.key)}
          disabled={graphMode === 'SCATTER'}
        />
      ))}
      <span className="ml-3 mr-1 text-slate-500">scale:</span>
      <ToggleChip
        label="arc-sec"
        active={scaleMode === 'ARCSEC'}
        onClick={() => setScaleMode('ARCSEC')}
      />
      <ToggleChip
        label="pixels"
        active={scaleMode === 'PIXELS'}
        onClick={() => setScaleMode('PIXELS')}
      />
      <button
        className="ml-3 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700"
        onClick={() => window.dispatchEvent(new CustomEvent('phd-recenter-y'))}
        title="Recenter Y axis around 0 without changing zoom"
      >
        recenter Y
      </button>
      <div className="ml-auto flex items-center gap-3 text-slate-400">
        <span>
          {totalCount > 0 ? (
            <>
              <span className={excludedCount > 0 ? 'text-amber-400' : ''}>
                {excludedCount}
              </span>
              <span className="text-slate-600"> / {totalCount} excluded</span>
            </>
          ) : null}
        </span>
        <span className="text-slate-600">scroll = X zoom · drag↕ = Y zoom · shift+drag = include · ctrl+drag = exclude</span>
      </div>
    </div>
  );
}
