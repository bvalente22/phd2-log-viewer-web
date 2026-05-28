import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLogStore } from '../state/logStore';
import { parseGuideHeader, type AlgoInfo, type GuideHeaderInfo } from '../parser/guideHeader';

/**
 * Compact "dashboard" strip directly above the guide chart that surfaces the
 * most-consulted setup facts from the section's PHD2 header — pier side,
 * pointing (hour angle / altitude / rotator), backlash compensation, and the
 * RA & Dec guide algorithms. Without it, this data is only reachable by
 * twirling open the raw 16-line SectionHeader block.
 *
 * Read-only. Surface uses slate-* classes so the active theme retints it; the
 * accent (left rail, section label, captions) uses the theme-aware
 * --dash-accent var (see index.css) so it pops on every skin and degrades to
 * red on Night / grayscale on Monochrome.
 *
 * Renders nothing for non-guiding sections or when the header yielded no
 * recognizable fields.
 */

/** One read-only labeled cell. `title` carries the explanation/raw value. */
function Tile({ caption, value, sub, wide }: {
  caption: string;
  value: string;
  sub?: string | null;
  wide?: boolean;
}) {
  return (
    <div
      className={`bg-slate-800 px-2.5 py-1 ${wide ? 'min-w-[150px] grow-[2]' : 'min-w-[88px] grow'}`}
      title={`${caption}: ${value}${sub ? ' ' + sub : ''}`}
    >
      <span className="dash-accent block text-[9px] font-medium uppercase tracking-wide">{caption}</span>
      <span className="text-[13px] text-slate-100">
        {value}
        {sub && <span className="text-[11px] text-slate-400"> {sub}</span>}
      </span>
    </div>
  );
}

/** "· agg 0.45 · min 0.098" — joins whatever the algorithm exposed. */
const algoSub = (a: AlgoInfo): string => {
  const parts: string[] = [];
  if (a.param) parts.push(a.param);
  if (a.minMove) parts.push(`min ${a.minMove}`);
  return parts.length ? `· ${parts.join(' · ')}` : '';
};

export function GuidingDashboard() {
  const { t } = useTranslation('sections');
  const log = useLogStore((s) => s.log);
  const sectionIdx = useLogStore((s) => s.selectedSection);

  const info = useMemo<GuideHeaderInfo | null>(() => {
    if (!log || sectionIdx < 0) return null;
    const sec = log.sections[sectionIdx];
    if (!sec || sec.type !== 'GUIDING') return null;
    return parseGuideHeader(log.sessions[sec.idx].hdr);
  }, [log, sectionIdx]);

  if (!info) return null;
  const hasAny =
    info.pierSide || info.hourAngle || info.altitude || info.rotator ||
    info.backlash || info.ra || info.dec;
  if (!hasAny) return null;

  return (
    <div
      className="flex flex-wrap gap-px border-y border-slate-700 bg-slate-700"
      style={{ borderLeft: '3px solid var(--dash-accent)' }}
      title={t('dashboard.tooltip')}
    >
      {info.pierSide && <Tile caption={t('dashboard.pierSide')} value={info.pierSide} />}
      {info.hourAngle && <Tile caption={t('dashboard.hourAngle')} value={`${info.hourAngle} h`} />}
      {info.altitude && <Tile caption={t('dashboard.altitude')} value={`${info.altitude}°`} />}
      {info.rotator && <Tile caption={t('dashboard.rotator')} value={`${info.rotator}°`} />}
      {info.backlash && (
        <Tile
          caption={t('dashboard.backlashComp')}
          value={info.backlash.enabled
            ? t('dashboard.backlashEnabled', { pulse: info.backlash.pulseMs })
            : t('dashboard.backlashDisabled')}
        />
      )}
      {info.ra && (
        <Tile wide caption={t('dashboard.raAlgorithm')} value={info.ra.name} sub={algoSub(info.ra)} />
      )}
      {info.dec && (
        <Tile wide caption={t('dashboard.decAlgorithm')} value={info.dec.name} sub={algoSub(info.dec)} />
      )}
    </div>
  );
}
