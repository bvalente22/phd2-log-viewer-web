// Bootstraps i18next once at module load. Resources are statically imported
// so they get bundled (small JSON, ~50KB total across 6 languages) and we
// don't need a Suspense fallback while translations stream in.
//
// Adding a language: drop a sibling folder under ./locales/<lng>/, mirror the
// JSON file structure, then register it in `resources` and `SUPPORTED_LANGUAGES`
// below. PHD2 jargon (RA, Dec, RMS, SNR, AO, dither, FFT, etc.) is intentionally
// kept in English across all locales — see locales/README.md for the policy.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enCommon from './locales/en/common.json';
import enToolbar from './locales/en/toolbar.json';
import enAnalysis from './locales/en/analysis.json';
import enStats from './locales/en/stats.json';
import enSections from './locales/en/sections.json';
import enChart from './locales/en/chart.json';
import enErrors from './locales/en/errors.json';
import enBlt from './locales/en/blt.json';

import esCommon from './locales/es/common.json';
import esToolbar from './locales/es/toolbar.json';
import esAnalysis from './locales/es/analysis.json';
import esStats from './locales/es/stats.json';
import esSections from './locales/es/sections.json';
import esChart from './locales/es/chart.json';
import esErrors from './locales/es/errors.json';

import deCommon from './locales/de/common.json';
import deToolbar from './locales/de/toolbar.json';
import deAnalysis from './locales/de/analysis.json';
import deStats from './locales/de/stats.json';
import deSections from './locales/de/sections.json';
import deChart from './locales/de/chart.json';
import deErrors from './locales/de/errors.json';

import frCommon from './locales/fr/common.json';
import frToolbar from './locales/fr/toolbar.json';
import frAnalysis from './locales/fr/analysis.json';
import frStats from './locales/fr/stats.json';
import frSections from './locales/fr/sections.json';
import frChart from './locales/fr/chart.json';
import frErrors from './locales/fr/errors.json';

import itCommon from './locales/it/common.json';
import itToolbar from './locales/it/toolbar.json';
import itAnalysis from './locales/it/analysis.json';
import itStats from './locales/it/stats.json';
import itSections from './locales/it/sections.json';
import itChart from './locales/it/chart.json';
import itErrors from './locales/it/errors.json';

import zhCommon from './locales/zh/common.json';
import zhToolbar from './locales/zh/toolbar.json';
import zhAnalysis from './locales/zh/analysis.json';
import zhStats from './locales/zh/stats.json';
import zhSections from './locales/zh/sections.json';
import zhChart from './locales/zh/chart.json';
import zhErrors from './locales/zh/errors.json';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'it', label: 'Italiano' },
  { code: 'zh', label: '简体中文' },
] as const;

export type SupportedLanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

const NAMESPACES = ['common', 'toolbar', 'analysis', 'stats', 'sections', 'chart', 'errors', 'blt'] as const;

// English is the source of truth for the `blt` namespace (English-only
// for now — other locales fall back to en per i18next's resolution
// chain since they don't include this ns). Add per-locale catalogs
// later if/when the feature stabilizes.
const resources = {
  en:      { common: enCommon,    toolbar: enToolbar,    analysis: enAnalysis,    stats: enStats,    sections: enSections,    chart: enChart,    errors: enErrors,    blt: enBlt },
  es:      { common: esCommon,    toolbar: esToolbar,    analysis: esAnalysis,    stats: esStats,    sections: esSections,    chart: esChart,    errors: esErrors,    blt: enBlt },
  de:      { common: deCommon,    toolbar: deToolbar,    analysis: deAnalysis,    stats: deStats,    sections: deSections,    chart: deChart,    errors: deErrors,    blt: enBlt },
  fr:      { common: frCommon,    toolbar: frToolbar,    analysis: frAnalysis,    stats: frStats,    sections: frSections,    chart: frChart,    errors: frErrors,    blt: enBlt },
  it:      { common: itCommon,    toolbar: itToolbar,    analysis: itAnalysis,    stats: itStats,    sections: itSections,    chart: itChart,    errors: itErrors,    blt: enBlt },
  zh:      { common: zhCommon,    toolbar: zhToolbar,    analysis: zhAnalysis,    stats: zhStats,    sections: zhSections,    chart: zhChart,    errors: zhErrors,    blt: enBlt },
} as const;

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    ns: NAMESPACES as unknown as string[],
    defaultNS: 'common',
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
    // `nonExplicitSupportedLngs` lets browser locales like "es-AR" resolve
    // to "es" via the fallback chain. We deliberately do NOT set
    // `load: 'languageOnly'` because that would also strip "zh-CN" down to
    // "zh", and we treat zh-CN as a distinct catalog (region matters).
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      // localStorage first (user override), then browser navigator language.
      // No `cookie` or `htmlTag` — we set <html lang> ourselves below.
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'phd2-lang',
    },
    react: {
      useSuspense: false, // resources are sync-loaded above
    },
  });

// Keep <html lang> in sync so screen readers, browser auto-translate, and
// CSS :lang() selectors all see the active language.
const syncHtmlLang = (lng: string) => {
  document.documentElement.lang = lng;
};
syncHtmlLang(i18n.language);
i18n.on('languageChanged', syncHtmlLang);

export default i18n;
