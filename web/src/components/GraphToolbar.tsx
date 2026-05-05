import { useTranslation } from 'react-i18next';
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

// Per-toggle tone keyed to the trace color used on the chart so the toolbar
// reads at a glance. Inactive state colors only the text (subtle hint),
// active state fills the background with the trace color. Disabled stays
// neutral. RA/Dec pulses share their axis color so the matching pair lines
// up visually.
type ChipTone = 'default' | 'ra' | 'dec' | 'mass' | 'snr';
const CHIP_TONE: Record<ChipTone, { active: string; inactive: string }> = {
  default: {
    active:   'bg-sky-700 text-white hover:bg-sky-600',
    inactive: 'bg-slate-800 text-slate-400 hover:bg-slate-700',
  },
  ra: {
    active:   'bg-sky-600 text-white hover:bg-sky-500',
    inactive: 'bg-slate-800 text-sky-400 hover:bg-slate-700',
  },
  dec: {
    active:   'bg-red-600 text-white hover:bg-red-500',
    inactive: 'bg-slate-800 text-red-400 hover:bg-slate-700',
  },
  mass: {
    active:   'bg-yellow-500 text-slate-900 hover:bg-yellow-400',
    inactive: 'bg-slate-800 text-yellow-400 hover:bg-slate-700',
  },
  snr: {
    active:   'bg-slate-100 text-slate-900 hover:bg-white',
    inactive: 'bg-slate-800 text-slate-200 hover:bg-slate-700',
  },
};

const ToggleChip = ({
  label, active, onClick, disabled, title, tone = 'default',
}: { label: string; active: boolean; onClick: () => void; disabled?: boolean; title?: string; tone?: ChipTone }) => {
  const palette = CHIP_TONE[tone];
  const cls = disabled
    ? 'cursor-not-allowed bg-slate-900 text-slate-600'
    : active
    ? palette.active
    : palette.inactive;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded px-2 py-0.5 text-xs transition-colors ${cls}`}
    >
      {label}
    </button>
  );
};

export function GraphToolbar() {
  const { t } = useTranslation('toolbar');
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
  const showRangeSlider = useViewStore((s) => s.showRangeSlider);
  const setShowRangeSlider = useViewStore((s) => s.setShowRangeSlider);

  const sec = log && sectionIdx >= 0 ? log.sections[sectionIdx] : null;
  const session = sec && sec.type === 'GUIDING' ? log!.sessions[sec.idx] : null;
  const sessionIdx = sec && sec.type === 'GUIDING' ? sec.idx : -1;
  const mask = sessionIdx >= 0 ? exclusions.get(sessionIdx) : undefined;
  const excludedCount = mask ? mask.reduce((a, b) => a + b, 0) : 0;
  const totalCount = session?.entries.length ?? 0;

  // The Mount/AO toggle is only meaningful when this session has AO entries.
  // Mirrors the desktop UI which disables the AO option for mount-only logs.
  const hasAo = !!session?.entries.some((e) => e.mount === 'AO');

  // RA / Dec / Mount / AO / dx / dy are PHD2 jargon — kept in English across
  // every locale (see locales/README.md). Trace toggles are grouped into
  // four sub-sections so each display attribute is obvious at a glance:
  // Axis (the error traces), Guide Pulses (correction-pulse bars), Guide
  // Star (mass and SNR overlays), and Events (inline INFO labels). Each
  // toggle is tinted to match its trace color on the chart.
  type TraceItem = { key: keyof TraceVisibility; label: string; title: string; tone: ChipTone };
  const axisItems: TraceItem[] = [
    { key: 'ra',  label: 'RA',  title: t('traces.raTooltip'),  tone: 'ra'  },
    { key: 'dec', label: 'Dec', title: t('traces.decTooltip'), tone: 'dec' },
  ];
  const pulseItems: TraceItem[] = [
    { key: 'raPulses',  label: t('traces.raPulses'),  title: t('traces.raPulsesTooltip'),  tone: 'ra'  },
    { key: 'decPulses', label: t('traces.decPulses'), title: t('traces.decPulsesTooltip'), tone: 'dec' },
  ];
  const starItems: TraceItem[] = [
    { key: 'mass', label: 'Mass', title: t('traces.massTooltip'), tone: 'mass' },
    { key: 'snr',  label: 'SNR',  title: t('traces.snrTooltip'),  tone: 'snr'  },
  ];
  const eventItems: TraceItem[] = [
    { key: 'events', label: t('traces.events'), title: t('traces.eventsTooltip'), tone: 'default' },
  ];
  const renderTraceGroup = (label: string, tooltip: string, items: TraceItem[]) => (
    <>
      <span className="ms-3 me-1 text-slate-500" title={tooltip}>{label}:</span>
      {items.map((it) => (
        <ToggleChip
          key={it.key}
          label={it.label}
          active={traces[it.key]}
          onClick={() => toggleTrace(it.key)}
          disabled={graphMode === 'SCATTER'}
          title={graphMode === 'SCATTER' ? t('traces.togglesScatterDisabled') : it.title}
          tone={it.tone}
        />
      ))}
    </>
  );

  // Layout: data-display row first (what's plotted), display-options row
  // second (how it's plotted / utilities), legend on its own line below
  // both, left-justified. Each row is a flex-wrap container so they wrap
  // independently on narrow viewports — they do NOT visually merge.
  return (
    <div className="flex flex-col border-b border-slate-800 text-xs">
      {/* Row 1 — DATA: what data is plotted on the chart. */}
      <div className="flex w-full flex-wrap items-center gap-2 px-3 py-1">
        {renderTraceGroup(t('groups.axis'),      t('groups.axisTooltip'),      axisItems)}
        {renderTraceGroup(t('groups.pulses'),    t('groups.pulsesTooltip'),    pulseItems)}
        {renderTraceGroup(t('groups.guideStar'), t('groups.guideStarTooltip'), starItems)}
        {renderTraceGroup(t('groups.events'),    t('groups.eventsTooltip'),    eventItems)}
        <span className="ms-3 me-1 text-slate-500" title={t('groups.coordTooltip')}>{t('groups.coord')}:</span>
        <ToggleChip
          label="RA/Dec"
          active={coordMode === 'RA_DEC'}
          onClick={() => setCoordMode('RA_DEC')}
          disabled={graphMode === 'SCATTER'}
          title={t('coord.raDecTooltip')}
        />
        <ToggleChip
          label="dx/dy"
          active={coordMode === 'DX_DY'}
          onClick={() => setCoordMode('DX_DY')}
          disabled={graphMode === 'SCATTER'}
          title={t('coord.dxDyTooltip')}
        />
        <span className="ms-3 me-1 text-slate-500" title={t('groups.deviceTooltip')}>{t('groups.device')}:</span>
        <ToggleChip
          label="Mount"
          active={device === 'MOUNT'}
          onClick={() => setDevice('MOUNT')}
          disabled={!hasAo}
          title={hasAo ? t('device.mountTooltip') : t('device.noAo')}
        />
        <ToggleChip
          label="AO"
          active={device === 'AO'}
          onClick={() => setDevice('AO')}
          disabled={!hasAo}
          title={hasAo ? t('device.aoTooltip') : t('device.noAoShort')}
        />
      </div>
      {/* Row 2 — DISPLAY: chart layout, scale, range slider, exports, hints. */}
      <div className="flex w-full flex-wrap items-center gap-2 px-3 py-1">
        <span className="me-1 text-slate-500" title={t('groups.viewTooltip')}>{t('groups.view')}:</span>
        <ToggleChip
          label={t('view.time')}
          active={graphMode === 'TIME'}
          onClick={() => setGraphMode('TIME')}
          title={t('view.timeTooltip')}
        />
        <ToggleChip
          label={t('view.scatter')}
          active={graphMode === 'SCATTER'}
          onClick={() => setGraphMode('SCATTER')}
          title={t('view.scatterTooltip')}
        />
        <span className="ms-3 me-1 text-slate-500" title={t('groups.scaleTooltip')}>{t('groups.scale')}:</span>
        <ToggleChip
          label={t('scale.arcsec')}
          active={scaleMode === 'ARCSEC'}
          onClick={() => setScaleMode('ARCSEC')}
          title={t('scale.arcsecTooltip')}
        />
        <ToggleChip
          label={t('scale.pixels')}
          active={scaleMode === 'PIXELS'}
          onClick={() => setScaleMode('PIXELS')}
          title={t('scale.pixelsTooltip')}
        />
        <ToggleChip
          label={t('scale.autoY')}
          active={autoScaleY}
          onClick={() => setAutoScaleY(!autoScaleY)}
          title={t('scale.autoYTooltip')}
        />
        <ToggleChip
          label={scaleLocked ? t('scale.yLocked') : t('scale.y')}
          active={scaleLocked}
          onClick={() => setScaleLocked(!scaleLocked)}
          title={t('scale.yLockedTooltip')}
        />
        <button
          className="ms-1 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700"
          onClick={() => window.dispatchEvent(new CustomEvent('phd-recenter-y'))}
          title={t('scale.recenterYTooltip')}
        >
          {t('scale.recenterY')}
        </button>
        <span className="ms-3 me-1 text-slate-500" title={t('groups.rangeSliderTooltip')}>{t('groups.rangeSlider')}:</span>
        <ToggleChip
          label={t('rangeSlider.show')}
          active={showRangeSlider}
          onClick={() => setShowRangeSlider(!showRangeSlider)}
          title={t('rangeSlider.showTooltip')}
        />
        <span className="ms-3 me-1 text-slate-500" title={t('groups.exportTooltip')}>{t('groups.export')}:</span>
        <button
          className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40"
          disabled={!session}
          onClick={() => {
            const stem = meta?.name?.replace(/\.[^.]+$/, '') ?? 'log';
            const fname = `phd2-${stem}-${session?.date ?? ''}`.replace(/[^a-zA-Z0-9-_]+/g, '-');
            window.dispatchEvent(new CustomEvent('phd-export-png', { detail: { filename: fname } }));
          }}
          title={t('export.pngTooltip')}
        >
          {t('export.png')}
        </button>
        <button
          className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40"
          disabled={!session}
          onClick={() => {
            if (!session) return;
            const csv = sessionToCsv(session, mask);
            const stem = meta?.name?.replace(/\.[^.]+$/, '') ?? 'log';
            const dateTag = session.date.replace(/[^a-zA-Z0-9]+/g, '-');
            triggerDownload(`${stem}-${dateTag}.csv`, csv, 'text/csv;charset=utf-8');
          }}
          title={t('export.csvTooltip')}
        >
          {t('export.csv')}
        </button>
      </div>
      {/* Row 3 — INFO: exclusion counter and gesture hint on their own
          dedicated row. Pulled out of row 2 so flex-wrap on a narrow
          viewport can never push the gesture-hint text down onto the
          legend's line. */}
      <div className="flex w-full flex-wrap items-center gap-3 px-3 pb-1 text-slate-400">
        <span title={t('exclusions.tooltip')}>
          {totalCount > 0 ? (
            <>
              <span className={excludedCount > 0 ? 'text-amber-400' : ''}>
                {excludedCount}
              </span>
              <span className="text-slate-600">{t('exclusions.labelTotal', { total: totalCount })}</span>
            </>
          ) : null}
        </span>
        <span className="ms-auto text-slate-600">
          {t('gestureHint')}
        </span>
      </div>
      {/* Row 4 — LEGEND: chart-overlay key. `display:block` guarantees
          it starts a new physical line regardless of how the rows above
          wrap on narrow viewports. The hairline top-border makes the
          separation obvious even when content above is short. */}
      <div
        className="block border-t border-slate-800/70 px-3 py-1 text-slate-500"
        title={t('legend.tooltip')}
      >
        <span className="inline-flex items-center gap-1 align-middle">
          <span className="inline-block h-3 w-[2px] bg-purple-400/70" />
          {t('legend.dither')}
        </span>
        <span className="ms-3 inline-flex items-center gap-1 align-middle">
          <span className="inline-block h-3 w-[2px] bg-yellow-400/70" />
          {t('legend.info')}
        </span>
        <span className="ms-3 inline-flex items-center gap-1 align-middle">
          <span className="inline-block h-2 w-3 border border-orange-400/70 bg-orange-400/20" />
          {t('legend.excluded')}
        </span>
      </div>
    </div>
  );
}
