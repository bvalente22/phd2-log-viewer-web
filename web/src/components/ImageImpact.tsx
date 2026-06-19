import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
import { useImagingSettingsStore } from '../state/imagingSettingsStore';
import { calcStats } from '../parser';
import {
  computeImageImpact, presetForFwhm, elongationRating, samplingRelation,
  SEEING_PRESETS, type ImageImpactResult,
} from '../parser/imageImpact';
import { fmtNumber, wrapTip } from '../i18n/format';
import { raDecColors } from '../themes';

const f2 = (n: number) => fmtNumber(n, 2);
const IMAGING_SCALE_CALC_URL = 'https://astronomy.tools/calculators/field_of_view/';

// Shared SVG geometry (RA horizontal, Dec vertical). Conceptual, not measured.
const W = 150, H = 104, CX = 75, CY = 52, MAX_R = 46, MIN_R = 8;

// Decimal-friendly numeric input: holds the raw string locally so partial
// entries like ".8" or "1." are accepted (no leading 0 required); emits a
// number only when the text parses.
function DecimalInput({ value, onChange, className, title, ariaLabel }: {
  value: number; onChange: (n: number) => void;
  className?: string; title?: string; ariaLabel?: string;
}) {
  const [text, setText] = useState(() => String(value));
  useEffect(() => {
    // Re-sync when the value changes externally (e.g. switching logs) but don't
    // clobber an in-progress entry that already equals the value.
    if (parseFloat(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="text" inputMode="decimal" value={text}
      title={title} aria-label={ariaLabel} className={className}
      onChange={(e) => {
        const t = e.target.value;
        if (!/^\d*\.?\d*$/.test(t)) return;
        setText(t);
        const n = parseFloat(t);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

function Axes({ raColor = '#94a3b8', decColor = '#94a3b8' }: { raColor?: string; decColor?: string } = {}) {
  return (
    <>
      <line x1={14} y1={CY} x2={W - 14} y2={CY} stroke="rgba(255,255,255,.12)" />
      <line x1={CX} y1={12} x2={CX} y2={H - 12} stroke="rgba(255,255,255,.12)" />
      <text x={W - 16} y={CY - 4} fontSize={10} fill={raColor} textAnchor="end">RA</text>
      <text x={CX + 3} y={22} fontSize={10} fill={decColor}>Dec</text>
    </>
  );
}

function axisRadii(major: number, minor: number, dominant: 'RA' | 'Dec') {
  const majR = Math.max(MIN_R, major);
  const minR = Math.max(MIN_R, minor);
  return dominant === 'Dec' ? { rx: minR, ry: majR } : { rx: majR, ry: minR };
}

const RATING_KEY = { low: 'imageImpact.ratingLow', moderate: 'imageImpact.ratingModerate', high: 'imageImpact.ratingHigh' } as const;
const SAMPLING_KEY = { same: 'imageImpact.samplingSame', coarser: 'imageImpact.samplingCoarser', finer: 'imageImpact.samplingFiner' } as const;

function guideTooltip(r: ImageImpactResult, t: TFunction): string {
  const orient = t(r.dominantAxis === 'RA' ? 'imageImpact.orientHorizontal' : 'imageImpact.orientVertical');
  const interp = r.axesEffectivelyEqual
    ? t('imageImpact.interpEqual', { ecc: f2(r.guidingOnlyEccentricity) })
    : t('imageImpact.interpGuide', { axis: r.dominantAxis, orient, ecc: f2(r.guidingOnlyEccentricity) });
  return wrapTip(`${interp} ${t('imageImpact.disclaimer')}`, 52);
}

function finalTooltip(r: ImageImpactResult, imagingScale: number, guideScale: number, fwhm: number, t: TFunction): string {
  const rating = t(RATING_KEY[elongationRating(r.estimatedEccentricity)]);
  const preset = presetForFwhm(fwhm);
  const interp = preset === 'custom'
    ? t('imageImpact.interpFinalCustom', { fwhm: f2(fwhm), ecc: f2(r.estimatedEccentricity), rating })
    : t('imageImpact.interpFinalPreset', { preset: t(`imageImpact.preset_${preset}`), fwhm: f2(fwhm), ecc: f2(r.estimatedEccentricity), rating });
  const sr = samplingRelation(guideScale, imagingScale);
  const samp = t(SAMPLING_KEY[sr.relation], { ratio: sr.ratio.toFixed(1) });
  return wrapTip(`${interp} ${samp} ${t('imageImpact.disclaimer')}`, 52);
}

function GuideEllipse({ r, title }: { r: ImageImpactResult; title: string }) {
  const { t } = useTranslation('stats');
  const scale = MAX_R / Math.max(r.majorRmsArcsec, r.minorRmsArcsec, 1e-6);
  const { rx, ry } = axisRadii(r.majorRmsArcsec * scale, r.minorRmsArcsec * scale, r.dominantAxis);
  const raVal = r.dominantAxis === 'RA' ? r.majorRmsArcsec : r.minorRmsArcsec;
  const decVal = r.dominantAxis === 'Dec' ? r.majorRmsArcsec : r.minorRmsArcsec;
  return (
    <div title={title}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('imageImpact.guidingError')}>
        <Axes />
        <ellipse cx={CX} cy={CY} rx={rx} ry={ry} fill="rgba(245,158,11,.18)" stroke="rgba(245,158,11,.9)" strokeWidth={2} />
        <text x={8} y={16} fontSize={10} fill="#94a3b8">RA {f2(raVal)}″</text>
        <text x={8} y={30} fontSize={10} fill="#94a3b8">Dec {f2(decVal)}″</text>
      </svg>
      <div className="mt-0.5 text-center text-[10px] text-slate-400">
        {t('imageImpact.guidingError')} · {r.axesEffectivelyEqual
          ? t('imageImpact.dominantEqual')
          : t('imageImpact.dominant', { axis: r.dominantAxis })}
      </div>
    </div>
  );
}

function FinalEllipse({ r, title, raColor, decColor }: {
  r: ImageImpactResult; title: string; raColor: string; decColor: string;
}) {
  const { t } = useTranslation('stats');
  const scale = MAX_R / Math.max(r.finalFwhmMajorArcsec, 1e-6);
  const { rx, ry } = axisRadii(r.finalFwhmMajorArcsec * scale, r.finalFwhmMinorArcsec * scale, r.dominantAxis);
  const baseR = Math.max(MIN_R * 0.8, r.baseFwhmArcsec * scale);
  return (
    <div title={title}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('imageImpact.finalStar')}>
        <Axes raColor={raColor} decColor={decColor} />
        <circle cx={CX} cy={CY} r={baseR} fill="none" stroke="rgba(52,211,153,.5)" strokeWidth={2} strokeDasharray="4 4" />
        {/* The final star's RA and Dec extents drawn as their own circles,
            each in the global RA/Dec preference color (rx = RA, ry = Dec). */}
        <circle cx={CX} cy={CY} r={ry} fill="none" stroke={decColor} strokeWidth={2} />
        <circle cx={CX} cy={CY} r={rx} fill="none" stroke={raColor} strokeWidth={2} />
      </svg>
      <div className="mt-0.5 text-center text-[10px] text-slate-400">
        {t('imageImpact.finalStar')} — {t('imageImpact.finalFwhm', {
          major: f2(r.finalFwhmMajorArcsec), minor: f2(r.finalFwhmMinorArcsec),
          majorpx: f2(r.finalFwhmMajorPx), minorpx: f2(r.finalFwhmMinorPx),
        })}
      </div>
    </div>
  );
}

/**
 * Image Impact panel — right of the StatsGrid on guiding sections. Estimates star
 * elongation from the section's RA/Dec arcsec RMS plus imaging scale + seeing.
 * Per-log values by default (imagingSettingsStore); the "Remember settings"
 * checkbox switches to one global value (viewStore) for all logs.
 */
export function ImageImpact() {
  const { t } = useTranslation('stats');
  const log = useLogStore((s) => s.log);
  const sectionIdx = useLogStore((s) => s.selectedSection);
  const hash = useLogStore((s) => s.meta?.hash);
  const exclusions = useViewStore((s) => s.exclusions);

  const swapRaDec = useViewStore((s) => s.swapRaDec);
  const { ra: raColor, dec: decColor } = raDecColors(swapRaDec);

  const remember = useViewStore((s) => s.rememberImaging);
  const setRemember = useViewStore((s) => s.setRememberImaging);
  const gScale = useViewStore((s) => s.imagingScale);
  const gFwhm = useViewStore((s) => s.seeingFwhm);
  const setGScale = useViewStore((s) => s.setImagingScale);
  const setGFwhm = useViewStore((s) => s.setSeeingFwhm);
  const perLog = useImagingSettingsStore((s) => s.record);
  const setForLog = useImagingSettingsStore((s) => s.setForLog);

  const ctx = useMemo(() => {
    if (!log || sectionIdx < 0) return null;
    const sec = log.sections[sectionIdx];
    if (!sec || sec.type !== 'GUIDING') return null;
    const session = log.sessions[sec.idx];
    const st = calcStats(session, exclusions.get(sec.idx));
    return { ra: st.rmsRaArcsec, dec: st.rmsDecArcsec, guideScale: session.pixelScale };
  }, [log, sectionIdx, exclusions]);

  if (!ctx) return null;

  // Effective values: global when "remember" is on, else this log's record, else
  // the global values as the seed for a never-seen log.
  const scale = remember ? gScale : (perLog?.imagingScale ?? gScale);
  const fwhm = remember ? gFwhm : (perLog?.seeingFwhm ?? gFwhm);

  const setScale = (n: number) => { if (remember) setGScale(n); else if (hash) void setForLog(hash, n, fwhm); };
  const setFwhm = (n: number) => { if (remember) setGFwhm(n); else if (hash) void setForLog(hash, scale, n); };
  const onToggleRemember = (checked: boolean) => {
    if (checked) { setGScale(scale); setGFwhm(fwhm); } // pin current values globally
    setRemember(checked);
  };

  const result = computeImageImpact(ctx.ra, ctx.dec, scale, fwhm);
  const preset = presetForFwhm(fwhm);

  return (
    <div className="px-4 py-2 text-sm" title={t('imageImpact.tooltip')}>
      {/* Header typography matches the Polar Alignment tab header (text-xs /
          font-semibold); each tab keeps its own accent color. */}
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-sky-300/80">{t('imageImpact.title')}</div>

      <div className="mb-2 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-0.5">
          <a
            href={IMAGING_SCALE_CALC_URL} target="_blank" rel="noopener noreferrer"
            title={t('imageImpact.imagingScaleLinkTitle')}
            className="text-[10px] text-sky-400 hover:text-sky-300 hover:underline"
          >
            {t('imageImpact.imagingScale')} ↗
          </a>
          <span className="flex items-center gap-1 rounded border border-slate-700 bg-slate-950 px-1.5 py-1">
            <DecimalInput
              value={scale} onChange={setScale}
              ariaLabel={t('imageImpact.imagingScale')}
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
                if (p) setFwhm(p.fwhm);
              }}
              className="rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-xs text-slate-100 focus:outline-none"
            >
              {SEEING_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>{t(`imageImpact.preset_${p.key}`)}</option>
              ))}
              <option value="custom">{t('imageImpact.preset_custom')}</option>
            </select>
            <span className="flex items-center gap-1 rounded border border-slate-700 bg-slate-950 px-1.5 py-1">
              <DecimalInput
                value={fwhm} onChange={setFwhm}
                title={t('imageImpact.seeingValueTitle')} ariaLabel={t('imageImpact.seeingValueTitle')}
                className="w-12 bg-transparent font-mono text-xs text-slate-100 focus:outline-none"
              />
              <span className="text-[10px] text-slate-500">″</span>
            </span>
          </span>
        </label>

        <label className="flex items-center gap-1.5 text-[10px] text-slate-400" title={t('imageImpact.rememberTooltip')}>
          <input type="checkbox" checked={remember} onChange={(e) => onToggleRemember(e.target.checked)} className="accent-sky-500" />
          {t('imageImpact.remember')}
        </label>
      </div>

      {result ? (
        <div className="flex flex-wrap gap-4">
          <GuideEllipse r={result} title={guideTooltip(result, t)} />
          <FinalEllipse r={result} title={finalTooltip(result, scale, ctx.guideScale, fwhm, t)} raColor={raColor} decColor={decColor} />
        </div>
      ) : (
        <div className="text-xs text-slate-500">{t('imageImpact.noData')}</div>
      )}
    </div>
  );
}
