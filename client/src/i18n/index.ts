// react-i18next setup (PLAN.md "Localization"). The active language is a
// single app-wide preference (`~/.pivot/config.json`'s `language` field,
// via `GET/PUT /api/preferences/language` — see api/client.ts), not a
// per-workspace or browser-detected setting: `main.tsx` fetches it once
// before the first render and calls `i18n.changeLanguage`, and
// `SettingsPage`'s language picker calls both `setLanguagePreference` (so
// it persists) and `i18n.changeLanguage` (so the switch is instant,
// without waiting for a refetch/reload).
//
// Resources are bundled statically (not lazy-loaded per language) — with
// only two languages and a UI this size, a network split isn't worth the
// added complexity.

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './en.json';
import vi from './vi.json';

export const SUPPORTED_LANGUAGES = ['en', 'vi'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    vi: { translation: vi },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes.
  returnNull: false,
});

export default i18n;
