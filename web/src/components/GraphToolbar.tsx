import { useTranslation } from 'react-i18next';
import { useViewStore } from '../state/viewStore';
import { useLogStore } from '../state/logStore';
import type { TraceVisibility } from '../state/viewStore';
import type { GuideSession } from '../parser';
import { AnalysisButton } from './AnalysisButton';
import { ToolbarPopover } from './ToolbarPopover';

// Hide the RA/Dec pulse-direction "flip" toggles in row 1 of the
// toolbar. Set this to `true` to restore them — the underlying
// flipRaPulses / flipDecPulses store fields and setters stay live so
// no functional change beyond UI visibility.
const SHOW_FLIP_TOGGLES = false;

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

// Per-toggle tone loosely keyed to the trace color used on the chart so the
// toolbar reads at a glance, but deliberately MUTED relative to those trace
// colors. A solid chip concentrates color far more than a thin plotted line,
// so matching the vibrant trace saturation makes the toolbar too loud (the
// yellow Mass chip especially). The chart traces (themes.ts) stay vibrant —
// the divergence is intentional. See feedback_toolbar_chip_colors.md.
// Inactive state tints only the text (subtle hint); active fills the
// background. Disabled stays neutral. RA/Dec pulses share their axis tone so
// the matching pair lines up visually.
type ChipTone = 'default' | 'ra' | 'dec' | 'mass' | 'snr';
const CHIP_TONE: Record<ChipTone, { active: string; inactive: string }> = {
  default: {
    active:   'bg-[#3f6b8f] text-white hover:bg-[#4a7ba3]',
    inactive: 'bg-slate-800 text-slate-400 hover:bg-slate-700',
  },
  ra: {
    active:   'bg-[#3f6b8f] text-white hover:bg-[#4a7ba3]',
    inactive: 'bg-slate-800 text-[#6fa3c4] hover:bg-slate-700',
  },
  dec: {
    active:   'bg-[#a85f5f] text-white hover:bg-[#b87070]',
    inactive: 'bg-slate-800 text-[#d09a9a] hover:bg-slate-700',
  },
  mass: {
    active:   'bg-[#ad924a] text-slate-900 hover:bg-[#c0a458]',
    inactive: 'bg-slate-800 text-[#c4ad6b] hover:bg-slate-700',
  },
  snr: {
    active:   'bg-[#d7dde5] text-slate-900 hover:bg-[#e6ebf1]',
    inactive: 'bg-slate-800 text-[#cbd5e1] hover:bg-slate-700',
  },
};

const ToggleChip = ({
  label, active, onClick, disabled, title, tone = 'default', className,
}: { label: string; active: boolean; onClick: () => void; disabled?: boolean; title?: string; tone?: ChipTone; className?: string }) => {
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
      className={`rounded px-2 py-0.5 text-xs transition-colors ${cls}${className ? ` ${className}` : ''}`}
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
  const flipRaPulses = useViewStore((s) => s.flipRaPulses);
  const setFlipRaPulses = useViewStore((s) => s.setFlipRaPulses);
  const flipDecPulses = useViewStore((s) => s.flipDecPulses);
  const setFlipDecPulses = useViewStore((s) => s.setFlipDecPulses);
  const toggleRaAxis = useViewStore((s) => s.toggleRaAxis);
  const toggleDecAxis = useViewStore((s) => s.toggleDecAxis);
  const toggleStarGroup = useViewStore((s) => s.toggleStarGroup);

  const sec = log && sectionIdx >= 0 ? log.sections[sectionIdx] : null;
  const session = sec && sec.type === 'GUIDING' ? log!.sessions[sec.idx] : null;
  const sessionIdx = sec && sec.type === 'GUIDING' ? sec.idx : -1;
  const mask = sessionIdx >= 0 ? exclusions.get(sessionIdx) : undefined;

  // The Mount/AO toggle is only meaningful when this session has AO entries.
  // Mirrors the desktop UI which disables the AO option for mount-only logs.
  const hasAo = !!session?.entries.some((e) => e.mount === 'AO');

  // RA / Dec / Mount / AO / dx / dy are PHD2 jargon — kept in English across
  // every locale (see locales/README.md). Trace toggles are grouped by
  // AXIS so each axis's overlays sit together. The first chip in each
  // axis group is a MASTER toggle (RA or Dec) that turns the entire
  // group on/off in one click; the remaining chips are the individual
  // sub-traces. Because the axis name is encoded by the master chip,
  // sub-trace labels drop the redundant "RA "/"Dec " prefix and read as
  // "trace · pulses · limits". Tone (sky for RA, red for Dec) keeps the
  // two groups visually distinct even with the shared sub-labels.
  type TraceItem = { key: keyof TraceVisibility; label: string; title: string; tone: ChipTone };
  const raItems: TraceItem[] = [
    { key: 'ra',       label: 'trace',  title: t('traces.raTooltip'),       tone: 'ra' },
    { key: 'raPulses', label: 'pulses', title: t('traces.raPulsesTooltip'), tone: 'ra' },
    { key: 'raLimits', label: 'limits', title: t('traces.raLimitsTooltip'), tone: 'ra' },
  ];
  const decItems: TraceItem[] = [
    { key: 'dec',       label: 'trace',  title: t('traces.decTooltip'),       tone: 'dec' },
    { key: 'decPulses', label: 'pulses', title: t('traces.decPulsesTooltip'), tone: 'dec' },
    { key: 'decLimits', label: 'limits', title: t('traces.decLimitsTooltip'), tone: 'dec' },
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

  // Groups with a master toggle: RA, Dec, and Guide Star. The master is
  // `active` whenever any sub-trace is on, so toggling individual chips
  // keeps the master in sync without any extra subscription. Click
  // behavior lives in the store (toggleRaAxis / toggleDecAxis /
  // toggleStarGroup) — see viewStore.ts for the snapshot semantics that
  // "remember which items were enabled."
  const raAnyOn   = traces.ra   || traces.raPulses  || traces.raLimits;
  const decAnyOn  = traces.dec  || traces.decPulses || traces.decLimits;
  const starAnyOn = traces.mass || traces.snr;
  // Per-tone border color for the master chips. Lighter shade than the
  // chip body so it stays visible on both the slate-800 inactive
  // background and the saturated active fill (e.g. sky-600). The border
  // — together with bold + uppercase + tracking — is what makes a master
  // chip read as a group header rather than another sub-trace sibling.
  const MASTER_BORDER: Record<'ra' | 'dec' | 'star', string> = {
    ra:   'border-[#5e87a6]',
    dec:  'border-[#c08e8e]',
    star: 'border-[#bd9f54]',
  };
  const renderMasterGroup = (
    masterLabel: string,
    masterTone: 'ra' | 'dec' | 'star',
    masterActive: boolean,
    onMasterToggle: () => void,
    masterTooltip: string,
    items: TraceItem[],
  ) => (
    <>
      <ToggleChip
        // ms-3 mirrors the spacing the old text headers ("RA:", "Guide
        // Star:") gave each group; without it, groups would butt up
        // against whatever sits to their left.
        label={masterLabel}
        active={masterActive}
        onClick={onMasterToggle}
        disabled={graphMode === 'SCATTER'}
        title={graphMode === 'SCATTER' ? t('traces.togglesScatterDisabled') : masterTooltip}
        // 'star' tone reuses the yellow 'mass' palette (the more visible
        // of the two guide-star metrics); the amber border keeps the
        // group visually distinct from the Mass sub-chip.
        tone={masterTone === 'star' ? 'mass' : masterTone}
        className={`ms-3 border-2 ${MASTER_BORDER[masterTone]} font-semibold uppercase tracking-wider`}
      />
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

  // Layout: a single always-visible primary row (the data/master groups +
  // Events), with the right-aligned cluster holding the "Display" popover
  // (all secondary how-it's-plotted controls) and the Analysis button. The
  // old DISPLAY row and the gesture-hint row are gone — the hint lived in a
  // row of its own and was the least-used line in the toolbar.
  return (
    <div className="flex w-full flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-1 text-xs">
      {renderMasterGroup('RA', 'ra', raAnyOn, toggleRaAxis, t('groups.raTooltip'), raItems)}
      {/* Pulse-direction "flip" toggles are temporarily hidden — flip the
          SHOW_FLIP_TOGGLES const back to true to restore. Store fields and
          setters stay live; nothing about the flip semantics changes. */}
      {SHOW_FLIP_TOGGLES && (
        <ToggleChip
          label={t('traces.flipRaPulses')}
          active={flipRaPulses}
          onClick={() => setFlipRaPulses(!flipRaPulses)}
          disabled={graphMode === 'SCATTER' || !traces.raPulses}
          title={
            graphMode === 'SCATTER'
              ? t('traces.togglesScatterDisabled')
              : !traces.raPulses
              ? t('traces.flipPulsesDisabled')
              : t('traces.flipRaPulsesTooltip')
          }
          tone="ra"
        />
      )}
      {renderMasterGroup('Dec', 'dec', decAnyOn, toggleDecAxis, t('groups.decTooltip'), decItems)}
      {SHOW_FLIP_TOGGLES && (
        <ToggleChip
          label={t('traces.flipDecPulses')}
          active={flipDecPulses}
          onClick={() => setFlipDecPulses(!flipDecPulses)}
          disabled={graphMode === 'SCATTER' || !traces.decPulses}
          title={
            graphMode === 'SCATTER'
              ? t('traces.togglesScatterDisabled')
              : !traces.decPulses
              ? t('traces.flipPulsesDisabled')
              : t('traces.flipDecPulsesTooltip')
          }
          tone="dec"
        />
      )}
      {renderMasterGroup(t('groups.guideStar'), 'star', starAnyOn, toggleStarGroup, t('groups.guideStarTooltip'), starItems)}
      {renderTraceGroup(t('groups.events'), t('groups.eventsTooltip'), eventItems)}

      {/* Right cluster: secondary display controls collapse into the
          Display popover; Analysis is the prominent primary action. */}
      <div className="ms-auto flex items-center gap-2">
        <ToolbarPopover
          label={<>{'⚙'}&nbsp;{t('groups.display')}&nbsp;{'▾'}</>}
          title={t('groups.displayTooltip')}
        >
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
          <span className="ms-3 me-1 text-slate-500" title={t('groups.yAxisTooltip')}>{t('groups.yAxis')}:</span>
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
            className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700"
            onClick={() => window.dispatchEvent(new CustomEvent('phd-recenter-y'))}
            title={t('scale.recenterYTooltip')}
          >
            {t('scale.recenterY')}
          </button>
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
        </ToolbarPopover>
        <AnalysisButton />
      </div>
    </div>
  );
}
