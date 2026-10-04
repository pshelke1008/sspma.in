import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Locale } from '@ashram/types';
import { en } from './locales/en';
import { mr } from './locales/mr';

const STORAGE_KEY = 'ashram.locale';

function storedLocale(): Locale {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === 'en' || value === 'mr') return value;
  } catch {
    /* storage blocked — fall through */
  }
  // First visit: follow the browser if it prefers Marathi.
  return navigator.language?.toLowerCase().startsWith('mr') ? 'mr' : 'en';
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, mr: { translation: mr } },
  lng: storedLocale(),
  fallbackLng: 'en',
  // Server messages are full sentences that may contain ':' — never treat
  // them as namespace prefixes when they are passed through t().
  nsSeparator: false,
  interpolation: { escapeValue: false },
  returnNull: false,
});

document.documentElement.lang = i18n.language;

export function currentLocale(): Locale {
  return i18n.language === 'mr' ? 'mr' : 'en';
}

/** Switches the interface language and remembers it on this device. */
export async function applyLocale(locale: Locale): Promise<void> {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = locale;
  if (i18n.language !== locale) await i18n.changeLanguage(locale);
}

/** Intl locale for dates and numbers: Marathi words, Latin digits. */
export function intlLocale(): string {
  return currentLocale() === 'mr' ? 'mr-IN-u-nu-latn' : 'en-IN';
}

export default i18n;
