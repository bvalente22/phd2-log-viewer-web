import { useTranslation } from 'react-i18next';
import { useViewStore } from '../state/viewStore';

/**
 * Header dropdown that swaps the RA / Dec trace colors across every chart
 * except the periodogram. Native <select> to match ThemePicker (OS font
 * fallback, no shipped picker fonts). Writes the boolean `swapRaDec` to the
 * view store; charts read it and choose colors via `raDecColors()`.
 */
export function RaDecColorPicker() {
  const { t } = useTranslation('common');
  const swap = useViewStore((s) => s.swapRaDec);
  const setSwap = useViewStore((s) => s.setSwapRaDec);

  return (
    <label
      className="flex items-center gap-1 text-xs text-slate-400"
      title={t('raDecColorTooltip')}
    >
      <span className="sr-only">{t('raDecColor')}</span>
      <span aria-hidden>🔵🔴</span>
      <select
        aria-label={t('raDecColor')}
        value={swap ? 'swap' : 'normal'}
        onChange={(e) => setSwap(e.target.value === 'swap')}
        className="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-xs text-slate-200 hover:border-slate-600 focus:outline-none focus:ring-1 focus:ring-sky-500"
      >
        <option value="normal">{t('raDecColorNormal')}</option>
        <option value="swap">{t('raDecColorSwapped')}</option>
      </select>
    </label>
  );
}
