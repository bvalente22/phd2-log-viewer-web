import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '../i18n';

/**
 * Native <select> language switcher. Persists via i18next's localStorage
 * detector (key: phd2-lang) and rerenders all useTranslation consumers in
 * place — no app reload required.
 *
 * Native <select> over a custom dropdown so the choices render in the OS's
 * UI locale (font fallback handles 简体中文 etc. without us having to ship a
 * picker font).
 */
export function LanguagePicker() {
  const { i18n, t } = useTranslation('common');

  return (
    <label
      className="flex items-center gap-1 text-xs text-slate-400"
      title={t('languageTooltip')}
    >
      <span className="sr-only">{t('language')}</span>
      <span aria-hidden>🌐</span>
      <select
        value={i18n.resolvedLanguage ?? i18n.language}
        onChange={(e) => { void i18n.changeLanguage(e.target.value); }}
        className="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-xs text-slate-200 hover:border-slate-600 focus:outline-none focus:ring-1 focus:ring-sky-500"
      >
        {SUPPORTED_LANGUAGES.map((lng) => (
          <option key={lng.code} value={lng.code}>{lng.label}</option>
        ))}
      </select>
    </label>
  );
}
