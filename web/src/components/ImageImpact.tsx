import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
import { calcStats } from '../parser';
import {
  computeImageImpact, presetForFwhm, SEEING_PRESETS, type ImageImpactResult,
} from '../parser/imageImpact';
import { fmtNumber } from '../i18n/format';

const f2 = (n: number) => fmtNumber(n, 2);

// Shared SVG geometry for the two conceptual ellipse panels (RA horizontal,
// Dec vertical). Not a measurement plot — emphasizes shape, not absolute size.
const W = 150, H = 104, CX = 75, CY = 52, MAX_R = 46, MIN_R = 8;

function Axes() {
  return (
    <>
      <line x1={14} y1={CY} x2={W - 14} y2={CY} stroke="rgba(255,255,255,.12)" />
      <line x1={CX} y1={12} x2={CX} y2={H - 12} stroke="rgba(255,255,255,.12)" />
      <text x={W - 16} y={CY - 4} fontSize={10} fill="#94a3b8" textAnchor="end">RA</text>
      <text x={CX + 3} y={22} fontSize={10} fill="#94a3b8">Dec</text>
    </>
  );
}

// rx/ry for an ellipse whose major axis points along the dominant sky axis.
function axisRadii(major: number, minor: number, dominant: 'RA' | 'Dec') {
  const majR = Math.max(MIN_R, major);
  const minR = Math.max(MIN_R, minor);
  return dominant === 'Dec' ? { rx: minR, ry: majR } : { rx: majR, ry: minR };
}

function GuideEllipse({ r }: { r: ImageImpactResult }) {
  const { t } = useTranslation('stats');
  const scale = MAX_R / Math.max(r.majorRmsArcsec, r.minorRmsArcsec, 1e-6);
  const { rx, ry } = axisRadii(r.majorRmsArcsec * scale, r.minorRmsArcsec * scale, r.dominantAxis);
  const raVal = r.dominantAxis === 'RA' ? r.majorRmsArcsec : r.minorRmsArcsec;
  const decVal = r.dominantAxis === 'Dec' ? r.majorRmsArcsec : r.minorRmsArcsec;
  return (
    <div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('imageImpact.guidingError')}>
        <Axes />
        <ellipse cx={CX} cy={CY} rx={rx} ry={ry} fill="rgba(245,158,11,.18)" stroke="rgba(245,158,11,.9)" strokeWidth={2} />
        <text x={8} y={16} fontSize={10} fill="#94a3b8">RA {f2(raVal)}″</text>
        <text x={8} y={30} fontSize={10} fill="#94a3b8">Dec {f2(decVal)}″</text>
      </svg>
      <div className="mt-0.5 text-center text-[10px] text-slate-400">
        {t('imageImpact.guidingError')} · {t('imageImpact.dominant', { axis: r.dominantAxis })}
      </div>
    </div>
  );
}

function FinalEllipse({ r }: { r: ImageImpactResult }) {
  const { t } = useTranslation('stats');
  // Base circle + final ellipse share one scale (base sits inside, since
  // finalFwhmMinor >= baseFwhm) so the size growth reads honestly.
  const scale = MAX_R / Math.max(r.finalFwhmMajorArcsec, 1e-6);
  const { rx, ry } = axisRadii(r.finalFwhmMajorArcsec * scale, r.finalFwhmMinorArcsec * scale, r.dominantAxis);
  const baseR = Math.max(MIN_R * 0.8, r.baseFwhmArcsec * scale);
  return (
    <div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('imageImpact.finalStar')}>
        <Axes />
        <circle cx={CX} cy={CY} r={baseR} fill="none" stroke="rgba(52,211,153,.5)" strokeWidth={2} strokeDasharray="4 4" />
        <ellipse cx={CX} cy={CY} rx={rx} ry={ry} fill="rgba(143,180,255,.18)" stroke="rgba(143,180,255,.95)" strokeWidth={2} />
      </svg>
      <div className="mt-0.5 text-center text-[10px] text-slate-400">
        {t('imageImpact.finalStar')} — {t('imageImpact.finalFwhm', {
          major: f2(r.finalFwhmMajorArcsec), minor: f2(r.finalFwhmMinorArcsec),
          majorpx: f2(r.finalFwhmMajorPx), minorpx: f2(r.finalFwhmMinorPx),
        })}
        <span className="text-slate-500"> · {t('imageImpact.eccentricity', { value: f2(r.estimatedEccentricity) })}</span>
      </div>
    </div>
  );
}

/**
 * Image Impact panel — sits to the right of the StatsGrid on guiding sections.
 * Estimates star elongation from the section's RA/Dec arcsec RMS plus the user's
 * imaging scale + estimated seeing. Renders nothing on non-guiding sections.
 */
export function ImageImpact() {
  const { t } = useTranslation('stats');
  const log = useLogStore((s) => s.log);
  const sectionIdx = useLogStore((s) => s.selectedSection);
  const exclusions = useViewStore((s) => s.exclusions);
  const imagingScale = useViewStore((s) => s.imagingScale);
  const seeingFwhm = useViewStore((s) => s.seeingFwhm);
  const setImagingScale = useViewStore((s) => s.setImagingScale);
  const setSeeingFwhm = useViewStore((s) => s.setSeeingFwhm);

  const rms = useMemo(() => {
    if (!log || sectionIdx < 0) return null;
    const sec = log.sections[sectionIdx];
    if (!sec || sec.type !== 'GUIDING') return null;
    const session = log.sessions[sec.idx];
    const st = calcStats(session, exclusions.get(sec.idx));
    return { ra: st.rmsRaArcsec, dec: st.rmsDecArcsec };
  }, [log, sectionIdx, exclusions]);

  if (!rms) return null;

  const result = computeImageImpact(rms.ra, rms.dec, imagingScale, seeingFwhm);
  const preset = presetForFwhm(seeingFwhm);

  return (
    <div className="border-s border-slate-700 px-4 py-2 text-sm" title={t('imageImpact.tooltip')}>
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-sky-300/80">{t('imageImpact.title')}</div>

      <div className="mb-2 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-slate-400">{t('imageImpact.imagingScale')}</span>
          <span className="flex items-center gap-1 rounded border border-slate-700 bg-slate-950 px-1.5 py-1">
            <input
              type="number" step="0.01" min="0" value={imagingScale}
              onChange={(e) => setImagingScale(Number(e.target.value))}
              className="w-14 bg-transparent font-mono text-xs text-slate-100 focus:outline-none"
            />
            <span className="text-[10px] text-slate-500">″/px</span>
          </span>
        </label>

        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-slate-400">{t('imageImpact.estimatedSeeing')}</span>
          <span className="flex items-center gap-1">
            <select
              value={preset}
              onChange={(e) => {
                const p = SEEING_PRESETS.find((x) => x.key === e.target.value);
                if (p) setSeeingFwhm(p.fwhm);
              }}
              className="rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-xs text-slate-100 focus:outline-none"
            >
              {SEEING_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>{t(`imageImpact.preset_${p.key}`)}</option>
              ))}
              <option value="custom">{t('imageImpact.preset_custom')}</option>
            </select>
            <span className="flex items-center gap-1 rounded border border-slate-700 bg-slate-950 px-1.5 py-1">
              <input
                type="number" step="0.05" min="0" value={seeingFwhm}
                title={t('imageImpact.seeingValueTitle')}
                onChange={(e) => setSeeingFwhm(Number(e.target.value))}
                className="w-12 bg-transparent font-mono text-xs text-slate-100 focus:outline-none"
              />
              <span className="text-[10px] text-slate-500">″</span>
            </span>
          </span>
        </label>
      </div>

      {result ? (
        <div className="flex flex-wrap gap-4">
          <GuideEllipse r={result} />
          <FinalEllipse r={result} />
        </div>
      ) : (
        <div className="text-xs text-slate-500">{t('imageImpact.noData')}</div>
      )}
    </div>
  );
}
