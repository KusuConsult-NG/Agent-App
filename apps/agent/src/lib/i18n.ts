/**
 * Agent PWA Localisation Hook & State.
 */

import { useState, useEffect } from 'react';
import { getTranslation, type Language, type TranslationDictionary } from '@psirs/shared';

const LANG_KEY = 'psirs_agent_lang';

let currentLang: Language = (typeof localStorage !== 'undefined' && (localStorage.getItem(LANG_KEY) as Language)) || 'en';
const listeners = new Set<(lang: Language) => void>();

export function setAppLanguage(lang: Language): void {
  currentLang = lang;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(LANG_KEY, lang);
  }
  for (const listener of listeners) {
    listener(lang);
  }
}

export function getAppLanguage(): Language {
  return currentLang;
}

export function useI18n(): { lang: Language; t: TranslationDictionary; setLanguage: (lang: Language) => void } {
  const [lang, setLang] = useState<Language>(currentLang);

  useEffect(() => {
    listeners.add(setLang);
    return () => {
      listeners.delete(setLang);
    };
  }, []);

  return {
    lang,
    t: getTranslation(lang),
    setLanguage: setAppLanguage,
  };
}
