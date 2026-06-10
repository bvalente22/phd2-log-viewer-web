import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLogStore } from '../state/logStore';
import { parseGuideHeader, type GuideHeaderInfo } from '../parser/guideHeader';

/**
 * Compact "dashboard" strip directly above the calibration plot — the
 * calibration-section counterpart to GuidingDashboard. It surfaces the
 * pointing context PHD2 records in the calibration header's coordinate line
 * (pier side, hour angle, declination, altitude, azimuth, rotator position),
 * grouped pointing → sky coords → mechanical.
 *
 * The calibration and guiding headers share the exact same coordinate line
 * format, so this reuses `parseGuideHeader`. We render only the
 * pointing-context fields here (no backlash / guide-algorithm tiles): those
 * settings belong to guiding, not the calibration run.
 *
 * Read-only, same visual rules as GuidingDashboard: slate-* surface so the
 * active theme retints it, the --dash-accent left rail / captions, every
 * tile only rendered when its field is present, and the whole strip hidden
 * when the header yielded nothing recognizable.
 */

/** One read-only labeled cell. `title` carries the explanation/raw value. */
function Tile({ caption, value }: { caption: string; value: string }) {
  return (
    <div
      className="min-w-[88px] grow bg-slate-800 px-2.5 py-1"
      title={`${caption}: ${value}`}
    >
      <span className="dash-accent block text-[9px] font-medium uppercase tracking-wide">{caption}</span>
      <span className="text-[13px] text-slate-100">{value}</span>
    </div>
  );
}

export function CalibrationDashboard() {
  const { t } = useTranslation('sections');
  const log = useLogStore((s) => s.log);
  const sectionIdx = useLogStore((s) => s.selectedSection);

  const info = useMemo<GuideHeaderInfo | null>(() => {
    if (!log || sectionIdx < 0) return null;
    const sec = log.sections[sectionIdx];
    if (!sec || sec.type !== 'CALIBRATION') return null;
    return parseGuideHeader(log.calibrations[sec.idx].hdr);
  }, [log, sectionIdx]);

  if (!info) return null;
  const hasAny =
    info.pierSide || info.hourAngle || info.declination ||
    info.altitude || info.azimuth || info.rotator;
  if (!hasAny) return null;

  return (
    <div
      className="flex flex-wrap gap-px border-y border-slate-700 bg-slate-700"
      style={{ borderLeft: '3px solid var(--dash-accent)' }}
      title={t('dashboard.calibrationTooltip')}
    >
      {/* Order: pointing (pier side, hour angle) → sky coords (Dec, Alt, Az)
          → mechanical (rotator). */}
      {info.pierSide && <Tile caption={t('dashboard.pierSide')} value={info.pierSide} />}
      {info.hourAngle && <Tile caption={t('dashboard.hourAngle')} value={`${info.hourAngle} h`} />}
      {info.declination && <Tile caption={t('dashboard.declination')} value={`${info.declination}°`} />}
      {info.altitude && <Tile caption={t('dashboard.altitude')} value={`${info.altitude}°`} />}
      {info.azimuth && <Tile caption={t('dashboard.azimuth')} value={`${info.azimuth}°`} />}
      {info.rotator && <Tile caption={t('dashboard.rotator')} value={`${info.rotator}°`} />}
    </div>
  );
}
