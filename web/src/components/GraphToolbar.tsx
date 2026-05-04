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
  // every locale (see locales/README.md). Trace toggle labels and tooltips
  // come from the toolbar namespace.
  const items: { key: keyof TraceVisibility; label: string; title: string }[] = [
    { key: 'ra', label: 'RA', title: t('traces.raTooltip') },
    { key: 'dec', label: 'Dec', title: t('traces.decTooltip') },
    { key: 'raPulses', label: t('traces.raPulses'), title: t('traces.raPulsesTooltip') },
    { key: 'decPulses', label: t('traces.decPulses'), title: t('traces.decPulsesTooltip') },
    { key: 'mass', label: 'Mass', title: t('traces.massTooltip') },
    { key: 'snr', label: 'SNR', title: t('traces.snrTooltip') },
    { key: 'events', label: t('traces.events'), title: t('traces.eventsTooltip') },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-1 text-xs">
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
      <span className="ms-3 me-1 text-slate-500" title={t('groups.showTooltip')}>{t('groups.show')}:</span>
      {items.map((it) => (
        <ToggleChip
          key={it.key}
          label={it.label}
          active={traces[it.key]}
          onClick={() => toggleTrace(it.key)}
          disabled={graphMode === 'SCATTER'}
          title={graphMode === 'SCATTER' ? t('traces.togglesScatterDisabled') : it.title}
        />
      ))}
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
      <button
        className="ms-1 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40"
        disabled={!session}
        onClick={() => {
          const stem = meta?.name?.replace(/\.[^.]+$/, '') ?? 'log';
          const fname = `phd2-${stem}-${session?.date ?? ''}`.replace(/[^a-zA-Z0-9-_]+/g, '-');
          window.dispatchEvent(new CustomEvent('phd-export-png', { detail: { filename: fname } }));
        }}
        title={t('export.pngTooltip')}
      >
        PNG
      </button>
      <button
        className="ms-1 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40"
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
        CSV
      </button>
      <div className="ms-auto flex items-center gap-3 text-slate-400">
        <span
          className="flex items-center gap-1 text-slate-500"
          title={t('legend.tooltip')}
        >
          <span className="inline-block h-3 w-[2px] bg-purple-400/70" /> {t('legend.dither')}
          <span className="ms-2 inline-block h-3 w-[2px] bg-yellow-400/70" /> {t('legend.info')}
          <span className="ms-2 inline-block h-2 w-3 border border-orange-400/70 bg-orange-400/20" /> {t('legend.excluded')}
        </span>
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
        <span className="text-slate-600">
          {t('gestureHint')}
        </span>
      </div>
    </div>
  );
}
