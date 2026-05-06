import { useTranslation } from 'react-i18next';
import { useViewStore } from '../state/viewStore';
import { THEMES, type ThemeId } from '../themes';

/**
 * Header dropdown that switches the visual theme. Native <select> for the
 * same reason LanguagePicker uses one — OS font fallback handles non-Latin
 * locales without us shipping picker fonts. The picker just writes to the
 * view store; the data-theme attribute is applied by ViewerPage's effect
 * and Plotly chart layouts read theme colors from `themes.ts`.
 */
export function ThemePicker() {
  const { t } = useTranslation('common');
  const theme = useViewStore((s) => s.theme);
  const setTheme = useViewStore((s) => s.setTheme);

  return (
    <label
      className="flex items-center gap-1 text-xs text-slate-400"
      title={t('themeTooltip')}
    >
      <span className="sr-only">{t('theme')}</span>
      <span aria-hidden>🎨</span>
      <select
        aria-label={t('theme')}
        value={theme}
        onChange={(e) => setTheme(e.target.value as ThemeId)}
        className="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-xs text-slate-200 hover:border-slate-600 focus:outline-none focus:ring-1 focus:ring-sky-500"
      >
        {Object.values(THEMES).map((th) => (
          <option key={th.id} value={th.id}>
            {t(`themes.${th.i18nKey}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
