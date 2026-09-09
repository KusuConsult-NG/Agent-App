/**
 * Filters that survive being navigated away from.
 *
 * Every screen kept its filters in component state, so they lasted exactly as
 * long as the component: an officer who narrowed the transaction list to one
 * LGA and one week, opened a transaction to read it, and pressed back, got the
 * unfiltered list and started again. On the busiest screens that is most of
 * what the officer spends their time doing.
 *
 * THREE PLACES, IN ORDER
 *
 * The URL first, because a filtered view an officer can send to a colleague is
 * worth more than one only they can reach, and because it makes the browser's
 * own back button work the way they expect.
 *
 * Then this session's storage, so returning to a screen from somewhere else
 * restores what they had. Per screen and per officer's tab: two officers on
 * one machine do not share a view, and neither do two tabs.
 *
 * Then the defaults.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not save filters across sign-ins, and it does not offer named views.
 * Both are storage on the server, and a saved view is a small piece of
 * somebody's working method that would then need a permission, a retention
 * decision and a way to delete it. What was actually broken -- losing the
 * filters on the way back from a transaction -- is fixed by remembering them
 * for as long as the officer is working, which is what a session is.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { replaceQuery } from '../router';

/**
 * The values are strings because that is what a query string can carry and
 * what an `<input>` produces. A screen wanting a number parses it, which keeps
 * this from having to guess at types it cannot see.
 */
export type FilterValues = Record<string, string>;

const STORAGE_PREFIX = 'psirs.filters.';

function read(key: string): FilterValues | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_PREFIX + key);
    return stored ? (JSON.parse(stored) as FilterValues) : null;
  } catch {
    /*
     * Storage can be unavailable or hold something a previous version wrote.
     * A screen that cannot remember its filters is worse than one that cannot
     * open, so this fails quietly back to the defaults.
     */
    return null;
  }
}

function write(key: string, values: FilterValues): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(values));
  } catch {
    // As above: not remembering is a smaller failure than not working.
  }
}

export function useFilters<T extends FilterValues>(
  /** The screen, so two screens' filters do not overwrite each other. */
  key: string,
  path: string,
  defaults: T,
): [T, (next: Partial<T>) => void, () => void] {
  const initial = useMemo((): T => {
    const fromUrl = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    const stored = read(key);
    const merged = { ...defaults } as T;
    for (const field of Object.keys(defaults) as (keyof T)[]) {
      const name = String(field);
      /*
       * A field present in the URL wins even when it is empty: "?lga=" is an
       * officer having cleared that filter, and falling back to the stored
       * value would put it back and look like the screen ignoring them.
       */
      if (fromUrl.has(name)) {
        merged[field] = fromUrl.get(name) as T[keyof T];
      } else if (stored && name in stored) {
        merged[field] = stored[name] as T[keyof T];
      }
    }
    return merged;
    // Deliberately once: this is the initial value, and recomputing it while
    // the officer types would fight them for control of the fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [values, setValues] = useState<T>(initial);

  useEffect(() => {
    write(key, values);
    const params = new URLSearchParams();
    for (const [field, value] of Object.entries(values)) {
      if (value !== '' && value !== undefined) params.set(field, value);
    }
    replaceQuery(path, params);
  }, [key, path, values]);

  const update = useCallback((next: Partial<T>) => {
    setValues((current) => ({ ...current, ...next }));
  }, []);

  const clear = useCallback(() => setValues(defaults), [defaults]);

  return [values, update, clear];
}
