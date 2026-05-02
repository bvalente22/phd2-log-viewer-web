import { useViewStore } from '../state/viewStore';
import { useLogStore } from '../state/logStore';
import type { TraceVisibility } from '../state/viewStore';
import type { GuideSession } from '../parser';

/**
 * Build a CSV blob for the active section. Columns mirror the PHD2 log row
 * order (so the output is round-trippable for downstream tooling) plus an
 * `excluded` flag that records whether the user excluded the frame in the
 * viewer. Line endings are CRLF for Excel friendliness.
 */
function sessionToCsv(s: GuideSession, mask: Uint8Array | undefined): string {
  const header = [
    'Frame', 'Time', 'Mount', 'dx', 'dy',
    'RARawDistance', 'DECRawDistance', 'RAGuideDistance', 'DECGuideDistance',
    'RADuration', 'DECDuration', 'StarMass', 'SNR', 'ErrorCode',
    'Info', 'Excluded',
  ];
  const lines: string[] = [header.join(',')];
  const escape = (v: string) => {
    if (v.includes(',') || v.includes('"') || v.includes('\n')) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };
  for (let i = 0; i < s.entries.length; i++) {
    const e = s.entries[i];
    const excluded = !e.included || mask?.[i] === 1;
    lines.push([
      e.frame, e.dt.toFixed(3), e.mount,
      e.dx.toFixed(3), e.dy.toFixed(3),
      e.raraw.toFixed(3), e.decraw.toFixed(3),
      e.raguide.toFixed(3), e.decguide.toFixed(3),
      e.radur, e.decdur, e.mass, e.snr.toFixed(2), e.err,
      escape(e.info), excluded ? '1' : '0',
    ].join(','));
  }
  return lines.join('\r\n');
}

const triggerDownload = (filename: string, content: string, mime: string) => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const ToggleChip = ({
  label, active, onClick, disabled, title,
}: { label: string; active: boolean; onClick: () => void; disabled?: boolean; title?: string }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
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
  const meta = useLogStore((s) => s.meta);
  const sectionIdx = useLogStore((s) => s.selectedSection);
  const traces = useViewStore((s) => s.traces);
  const toggleTrace = useViewStore((s) => s.toggleTrace);
  const exclusions = useViewStore((s) => s.exclusions);
  const scaleMode = useViewStore((s) => s.scaleMode);
  const setScaleMode = useViewStore((s) => s.setScaleMode);
  const graphMode = useViewStore((s) => s.graphMode);
  const setGraphMode = useViewStore((s) => s.setGraphMode);
  const coordMode = useViewStore((s) => s.coordMode);
  const setCoordMode = useViewStore((s) => s.setCoordMode);
  const device = useViewStore((s) => s.device);
  const setDevice = useViewStore((s) => s.setDevice);
  const scaleLocked = useViewStore((s) => s.scaleLocked);
  const setScaleLocked = useViewStore((s) => s.setScaleLocked);
  const autoScaleY = useViewStore((s) => s.autoScaleY);
  const setAutoScaleY = useViewStore((s) => s.setAutoScaleY);

  const sec = log && sectionIdx >= 0 ? log.sections[sectionIdx] : null;
  const session = sec && sec.type === 'GUIDING' ? log!.sessions[sec.idx] : null;
  const sessionIdx = sec && sec.type === 'GUIDING' ? sec.idx : -1;
  const mask = sessionIdx >= 0 ? exclusions.get(sessionIdx) : undefined;
  const excludedCount = mask ? mask.reduce((a, b) => a + b, 0) : 0;
  const totalCount = session?.entries.length ?? 0;

  // The Mount/AO toggle is only meaningful when this session has AO entries.
  // Mirrors the desktop UI which disables the AO option for mount-only logs.
  const hasAo = !!session?.entries.some((e) => e.mount === 'AO');

  const items: { key: keyof TraceVisibility; label: string; title: string }[] = [
    { key: 'ra', label: 'RA', title: 'Show/hide the RA error trace' },
    { key: 'dec', label: 'Dec', title: 'Show/hide the Dec error trace' },
    { key: 'raPulses', label: 'RA pulses', title: 'Show/hide RA correction pulse durations as bars on the 0 line' },
    { key: 'decPulses', label: 'Dec pulses', title: 'Show/hide Dec correction pulse durations as bars on the 0 line' },
    { key: 'mass', label: 'Mass', title: 'Show/hide guide-star mass (yellow), scaled to the bottom half of the chart' },
    { key: 'snr', label: 'SNR', title: 'Show/hide guide-star SNR (white), scaled to the bottom half of the chart' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-1 text-xs">
      <span className="mr-1 text-slate-500" title="Choose the chart layout">view:</span>
      <ToggleChip
        label="time"
        active={graphMode === 'TIME'}
        onClick={() => setGraphMode('TIME')}
        title="Time-series view: error traces and pulses vs. time"
      />
      <ToggleChip
        label="scatter"
        active={graphMode === 'SCATTER'}
        onClick={() => setGraphMode('SCATTER')}
        title="Scatter view: each frame as a point in (RA, Dec) space, with the error ellipse"
      />
      <span className="ml-3 mr-1 text-slate-500" title="Toggle individual traces in the time view">show:</span>
      {items.map((it) => (
        <ToggleChip
          key={it.key}
          label={it.label}
          active={traces[it.key]}
          onClick={() => toggleTrace(it.key)}
          disabled={graphMode === 'SCATTER'}
          title={graphMode === 'SCATTER' ? 'Trace toggles only apply in time view' : it.title}
        />
      ))}
      <span className="ml-3 mr-1 text-slate-500" title="Coordinate frame for the error trace">coord:</span>
      <ToggleChip
        label="RA/Dec"
        active={coordMode === 'RA_DEC'}
        onClick={() => setCoordMode('RA_DEC')}
        disabled={graphMode === 'SCATTER'}
        title="Plot mount-frame RA and Dec error (Dec is negated so north points up)"
      />
      <ToggleChip
        label="dx/dy"
        active={coordMode === 'DX_DY'}
        onClick={() => setCoordMode('DX_DY')}
        disabled={graphMode === 'SCATTER'}
        title="Plot raw camera-frame dx and dy (useful when calibration is suspect)"
      />
      <span className="ml-3 mr-1 text-slate-500" title="Filter entries by which device made the correction">device:</span>
      <ToggleChip
        label="Mount"
        active={device === 'MOUNT'}
        onClick={() => setDevice('MOUNT')}
        disabled={!hasAo}
        title={hasAo ? 'Show only frames where the mount made the correction' : 'No AO data in this session — all frames are mount frames'}
      />
      <ToggleChip
        label="AO"
        active={device === 'AO'}
        onClick={() => setDevice('AO')}
        disabled={!hasAo}
        title={hasAo ? 'Show only frames where the AO unit made the correction' : 'No AO data in this session'}
      />
      <span className="ml-3 mr-1 text-slate-500" title="Y-axis units">scale:</span>
      <ToggleChip
        label="arc-sec"
        active={scaleMode === 'ARCSEC'}
        onClick={() => setScaleMode('ARCSEC')}
        title="Display Y values in arc-seconds (multiplied by the session pixel scale)"
      />
      <ToggleChip
        label="pixels"
        active={scaleMode === 'PIXELS'}
        onClick={() => setScaleMode('PIXELS')}
        title="Display Y values in raw pixels"
      />
      <ToggleChip
        label="auto Y"
        active={autoScaleY}
        onClick={() => setAutoScaleY(!autoScaleY)}
        title="Auto-fit Y to the typical guiding range (99th percentile of |error|), so dithers and lost-star spikes don't squash the routine signal. Off = use raw min/max."
      />
      <ToggleChip
        label={scaleLocked ? '🔒 Y locked' : '🔓 Y'}
        active={scaleLocked}
        onClick={() => setScaleLocked(!scaleLocked)}
        title="Lock Y range across section changes so different nights can be compared at the same scale"
      />
      <button
        className="ml-1 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700"
        onClick={() => window.dispatchEvent(new CustomEvent('phd-recenter-y'))}
        title="Recenter Y axis around 0 without changing the current zoom level"
      >
        recenter Y
      </button>
      <button
        className="ml-1 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40"
        disabled={!session}
        onClick={() => {
          const stem = meta?.name?.replace(/\.[^.]+$/, '') ?? 'log';
          const fname = `phd2-${stem}-${session?.date ?? ''}`.replace(/[^a-zA-Z0-9-_]+/g, '-');
          window.dispatchEvent(new CustomEvent('phd-export-png', { detail: { filename: fname } }));
        }}
        title="Download a high-resolution PNG snapshot of the current chart"
      >
        PNG
      </button>
      <button
        className="ml-1 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40"
        disabled={!session}
        onClick={() => {
          if (!session) return;
          const csv = sessionToCsv(session, mask);
          const stem = meta?.name?.replace(/\.[^.]+$/, '') ?? 'log';
          const dateTag = session.date.replace(/[^a-zA-Z0-9]+/g, '-');
          triggerDownload(`${stem}-${dateTag}.csv`, csv, 'text/csv;charset=utf-8');
        }}
        title="Download the entries of the current section as a CSV (includes an Excluded column for frames you've removed from the analysis)"
      >
        CSV
      </button>
      <div className="ml-auto flex items-center gap-3 text-slate-400">
        <span
          className="flex items-center gap-1 text-slate-500"
          title="Vertical dotted line styles you'll see overlaid on the chart. Hover any line for the event text."
        >
          <span className="inline-block h-3 w-[2px] bg-purple-400/70" /> dither
          <span className="ml-2 inline-block h-3 w-[2px] bg-yellow-400/70" /> info
          <span className="ml-2 inline-block h-2 w-3 border border-orange-400/70 bg-orange-400/20" /> excluded
        </span>
        <span title="Frames excluded from stats / total frames in this section">
          {totalCount > 0 ? (
            <>
              <span className={excludedCount > 0 ? 'text-amber-400' : ''}>
                {excludedCount}
              </span>
              <span className="text-slate-600"> / {totalCount} excluded</span>
            </>
          ) : null}
        </span>
        <span
          className="text-slate-600"
          title="Mouse wheel zooms X around the cursor. Plain drag pans X and zooms Y at the same time. Shift+drag adds the time range to analysis. Ctrl+drag removes the time range from analysis."
        >
          scroll = X zoom · drag = X pan + Y zoom · shift+drag = include · ctrl+drag = exclude
        </span>
      </div>
    </div>
  );
}
