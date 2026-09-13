/**
 * Language for everything this deployment serves — the account-free public
 * screens and the officer portal behind them.
 *
 * It began as the public half alone, on the reasoning that a referee opens one
 * link and never returns while an officer signs in and has a profile to keep a
 * preference in. The officer half then stayed in English for a year, so the
 * distinction bought nothing and cost a second mechanism nobody built.
 *
 * One key, one toggle, one language per browser. A citizen checking a receipt
 * and an officer signing in are different people, but they are not usually the
 * same browser, and when they are, the second one changes the toggle.
 *
 * English remains the default. Guessing from `navigator.language` was
 * considered and rejected: a cheap Android handset sold in Jos reports `en-US`
 * regardless of what its owner reads, so the guess would be wrong in exactly
 * the population this exists for, and wrong silently.
 */

import { useEffect, useState } from 'react';
import { getTranslation, type Language, type TranslationDictionary } from '@psirs/shared';

const LANG_KEY = 'psirs_portal_lang';

function stored(): Language {
  try {
    const value = localStorage.getItem(LANG_KEY);
    return value === 'ha' || value === 'en' ? value : 'en';
  } catch {
    // Private browsing, or storage disabled. Not a reason to fail to render.
    return 'en';
  }
}

let current: Language = typeof localStorage === 'undefined' ? 'en' : stored();
const listeners = new Set<(lang: Language) => void>();

export function setPortalLanguage(lang: Language): void {
  current = lang;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // The choice still applies for this visit.
  }
  for (const listener of listeners) listener(lang);
}

export function getPortalLanguage(): Language {
  return current;
}

export function usePortalI18n(): {
  lang: Language;
  t: TranslationDictionary;
  setLanguage: (lang: Language) => void;
} {
  const [lang, setLang] = useState<Language>(current);

  useEffect(() => {
    listeners.add(setLang);
    return () => {
      listeners.delete(setLang);
    };
  }, []);

  return { lang, t: getTranslation(lang), setLanguage: setPortalLanguage };
}

/**
 * The names the public screens were written against.
 *
 * Kept so `Public.tsx` and its tests read as they did — the language is the
 * same language now, and renaming every call site would be a diff about
 * nothing.
 */
export const setPublicLanguage = setPortalLanguage;
export const getPublicLanguage = getPortalLanguage;
export const usePublicI18n = usePortalI18n;
