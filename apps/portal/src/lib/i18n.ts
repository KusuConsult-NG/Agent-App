/**
 * Language for the account-free public screens.
 *
 * Deliberately narrower than the agent application's version. An officer signs
 * in, works all day and has a profile to keep a preference in; a referee opens
 * one link, answers one question and never returns. So the choice lives in
 * `localStorage` only as a convenience for somebody who reloads or follows a
 * second link, and the toggle sits on the screen itself rather than behind a
 * settings page nobody without an account would look for.
 *
 * English remains the default. Guessing from `navigator.language` was
 * considered and rejected: a cheap Android handset sold in Jos reports `en-US`
 * regardless of what its owner reads, so the guess would be wrong in exactly
 * the population this exists for, and wrong silently.
 */

import { useEffect, useState } from 'react';
import { getTranslation, type Language, type TranslationDictionary } from '@psirs/shared';

const LANG_KEY = 'psirs_public_lang';

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

export function setPublicLanguage(lang: Language): void {
  current = lang;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // The choice still applies for this visit.
  }
  for (const listener of listeners) listener(lang);
}

export function getPublicLanguage(): Language {
  return current;
}

export function usePublicI18n(): {
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

  return { lang, t: getTranslation(lang), setLanguage: setPublicLanguage };
}
