import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ppecScreen from '../assets/ppec-screen.png';

/**
 * Small "PPEC" pill shown next to a Top-Peaks card's PEAK number. On hover it
 * pops up the PHD2 *Predictive PEC Guide Algorithm* settings screenshot
 * (web/src/assets/ppec-screen.png) with this peak's period rendered inside the
 * highlighted blue "Period Length" box — i.e. "type this value into PHD2".
 * It also stamps a red "disable" hint by the lower arrow (the Auto-adjust
 * period checkbox). A copy button rasterizes the same composed graphic to a
 * PNG on the clipboard.
 */
// Overlay boxes as a fraction of the 224×225 source PNG (detected from the
// image): the blue "Period Length" field (where the period value goes), and a
// patch just right of the lower red arrow (where the "disable" hint goes, by
// the "Auto-adjust period" checkbox the arrow points at). Percentages so the
// overlay scales with whatever width we render the screenshot at.
const VALUE_BOX = { left: 43.8, right: 63.8, top: 76.0, bottom: 86.2 };
const DISABLE_BOX = { left: 78.0, right: 99.0, top: 89.5, bottom: 96.5 };
const VALUE_INK = '#0f172a'; // slate-900, on the field's white interior
const DISABLE_INK = '#dc2626'; // red-600, matching the arrows
const IMG_W = 260;
const IMG_H = Math.round((IMG_W * 225) / 224);
// Image + padding (p-2 = 8px each side) + border. Used both as the rendered
// popup width and to clamp it inside the viewport.
const POPUP_W = IMG_W + 16 + 2;
const GAP = 8; // px between the pill and the popup
// Grace period after the mouse leaves the pill, so the user can travel across
// the GAP into the popup (a DOM descendant) to click Copy without it closing.
const HIDE_DELAY = 150;
// Upscale factor for the copied PNG so it's crisp when pasted into docs/chat.
const COPY_SCALE = 3;

type Box = { left: number; right: number; top: number; bottom: number };

/**
 * Largest monospace font (px) that fits `text` inside a box of the given pixel
 * size. ~0.62 is the advance/size ratio of a monospace glyph; capped by height
 * so it also fits vertically. Keeps long translations (e.g. German
 * "deaktivieren") inside the box in both the live overlay and the copied PNG.
 */
function fitFontPx(text: string, boxWpx: number, boxHpx: number): number {
  const byWidth = boxWpx / Math.max(1, text.length * 0.62);
  return Math.max(7, Math.min(boxHpx * 0.85, byWidth));
}

function boxCssFontSize(text: string, box: Box): number {
  return fitFontPx(
    text,
    ((box.right - box.left) / 100) * IMG_W,
    ((box.bottom - box.top) / 100) * IMG_H,
  );
}

/** Draw the screenshot + period value + "disable" hint to a canvas, copy PNG. */
async function copyGraphic(value: string, disableLabel: string): Promise<boolean> {
  const img = new Image();
  img.src = ppecScreen;
  try {
    await img.decode();
  } catch {
    return false;
  }
  const w = (img.naturalWidth || 224) * COPY_SCALE;
  const h = (img.naturalHeight || 225) * COPY_SCALE;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  ctx.drawImage(img, 0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Same box geometry as the live overlays, in canvas pixels.
  const draw = (text: string, box: Box, ink: string) => {
    const cx = ((box.left + box.right) / 2 / 100) * w;
    const cy = ((box.top + box.bottom) / 2 / 100) * h;
    const px = fitFontPx(text, ((box.right - box.left) / 100) * w, ((box.bottom - box.top) / 100) * h);
    ctx.fillStyle = ink;
    ctx.font = `600 ${Math.round(px)}px ui-monospace, "Courier New", monospace`;
    ctx.fillText(text, cx, cy);
  };
  draw(value, VALUE_BOX, VALUE_INK);
  draw(disableLabel, DISABLE_BOX, DISABLE_INK);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function PpecPeakHint({ periodSec }: { periodSec: number }) {
  const { t } = useTranslation('analysis');
  const triggerRef = useRef<HTMLButtonElement>(null);
  // null = hidden. When shown, holds viewport-clamped fixed-position coords so
  // card #1's popup (pill near the left edge) can't run off-screen — and
  // likewise card #3 near the right. Computed from the pill's screen rect.
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const hideTimer = useRef<number>();
  const copiedTimer = useRef<number>();
  const value = periodSec.toFixed(1);
  const disableLabel = t('ppec.disable');

  const show = () => {
    window.clearTimeout(hideTimer.current);
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const centerX = r.left + r.width / 2;
    const left = Math.min(
      Math.max(GAP, centerX - POPUP_W / 2),
      window.innerWidth - POPUP_W - GAP,
    );
    // Anchor the popup's bottom just above the pill (it grows upward).
    setPos({ left, bottom: window.innerHeight - r.top + GAP });
  };

  const scheduleHide = () => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setPos(null), HIDE_DELAY);
  };

  const onCopy = async () => {
    const ok = await copyGraphic(value, disableLabel);
    if (!ok) return;
    setCopied(true);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    // Hover handlers on the span: because the popup is a DOM descendant, moving
    // into it keeps us "inside" for mouseleave purposes (the HIDE_DELAY bridges
    // the visual GAP between pill and popup).
    <span className="inline-flex" onMouseEnter={show} onMouseLeave={scheduleHide}>
      <button
        ref={triggerRef}
        type="button"
        tabIndex={-1}
        title={t('ppec.tooltip')}
        aria-label={t('ppec.tooltip')}
        // Solid green so it stays visible on every theme — the card's
        // bg-slate-900 is remapped to white (paper/monochrome) / crimson
        // (night), and emerald utility classes are NOT theme-remapped, so a
        // translucent/light-text pill would vanish on the light themes.
        className="rounded border border-emerald-700 bg-emerald-600 px-1 text-[8px] font-semibold leading-[1.4] tracking-wider text-white transition-colors hover:bg-emerald-500"
      >
        {t('ppec.label')}
      </button>
      {pos && (
        <div
          className="fixed z-[60] rounded-md border border-slate-600 bg-slate-800 p-2 shadow-2xl"
          style={{ left: pos.left, bottom: pos.bottom, width: POPUP_W }}
        >
          <div className="relative" style={{ width: IMG_W }}>
            <img
              src={ppecScreen}
              alt=""
              width={IMG_W}
              draggable={false}
              className="block select-none rounded-sm"
            />
            {/* Period value overlaid inside the blue Period Length box. */}
            <span
              className="absolute flex items-center justify-center font-mono font-semibold"
              style={{
                left: `${VALUE_BOX.left}%`,
                width: `${VALUE_BOX.right - VALUE_BOX.left}%`,
                top: `${VALUE_BOX.top}%`,
                height: `${VALUE_BOX.bottom - VALUE_BOX.top}%`,
                fontSize: 12,
                color: VALUE_INK,
              }}
            >
              {value}
            </span>
            {/* "disable" hint by the lower red arrow → the Auto-adjust period
                checkbox the user should turn off. Auto-fit so translations of
                varying length stay inside the patch. */}
            <span
              className="absolute flex items-center justify-center whitespace-nowrap font-mono font-semibold"
              style={{
                left: `${DISABLE_BOX.left}%`,
                width: `${DISABLE_BOX.right - DISABLE_BOX.left}%`,
                top: `${DISABLE_BOX.top}%`,
                height: `${DISABLE_BOX.bottom - DISABLE_BOX.top}%`,
                fontSize: boxCssFontSize(disableLabel, DISABLE_BOX),
                color: DISABLE_INK,
              }}
            >
              {disableLabel}
            </span>
          </div>
          <div className="mt-1.5 flex items-start gap-2">
            <div className="flex-1 text-[10px] leading-snug text-slate-400">
              {t('ppec.caption', { period: value })}
            </div>
            <button
              type="button"
              onClick={onCopy}
              title={t('ppec.copyTooltip')}
              aria-label={t('ppec.copyTooltip')}
              // Theme-aware classes (bg-slate-800 / text-slate-300 are
              // remapped per theme); solid green for the copied state so the
              // check reads on light themes too.
              className={`shrink-0 rounded border p-1 transition-colors ${
                copied
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
