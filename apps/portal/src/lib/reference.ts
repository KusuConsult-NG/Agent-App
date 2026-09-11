/**
 * The lists an officer picks from, and what happens when one does not arrive.
 *
 * Seventeen places across the portal read reference geography and taxonomy
 * like this:
 *
 *   api.get<Lga[]>('/reference/lgas').then(setLgas).catch(() => setLgas([]));
 *
 * A 500 becomes an empty list. A dropped connection becomes an empty list.
 * Nothing is recorded, nothing is shown, and the screen carries on as though
 * the State of Plateau had no Local Government Areas in it.
 *
 * The agent PWA was swept for exactly this and has carried
 * `apps/agent/src/lib/reference.ts` since; the portal was not. This is the
 * same type for the officer side. Authenticated, because an officer is signed
 * in and these reads go through the session — that is the only difference.
 *
 * WHY IT IS NOT MERELY UNTIDY
 *
 * Two buttons in this portal are switched off by an empty list and say
 * nothing about why:
 *
 *   - Presumptive: the preview button is `disabled={busy || !check.lgaId}`,
 *     and `lgaId` is seeded from the first row of the list. No list, no
 *     seed, and an officer cannot classify the trader in front of them —
 *     the button is grey and the select beside it is empty.
 *
 *   - Organisation: creating an office is `disabled={... || !form.lgaId}`,
 *     and the only option left is the placeholder. A new tax office cannot
 *     be opened, and nothing on the screen says the platform failed to read
 *     the LGA list rather than Plateau State having no LGAs.
 *
 * The rest are report filters. An empty one does not stop the report, but it
 * silently removes the officer's ability to scope it by territory — the
 * defaulters report for Jos North quietly becomes the defaulters report for
 * the State, with no indication that a filter was lost.
 *
 * An empty list and a list that could not be read are different answers.
 * `failed` exists so a screen can say which one it has.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

export interface ReferenceList<T> {
  items: T[];
  /** The read was refused or never arrived. `items` is empty and means nothing. */
  failed: boolean;
  loading: boolean;
  reload: () => void;
}

/**
 * @param path  The API path, or null to hold off — a dependent list has no
 *              path until its parent is chosen, and "not asked for yet" is
 *              not a failure.
 */
export function useReferenceList<T>(
  path: string | null,
  options: { select?: (body: unknown) => T[] } = {},
): ReferenceList<T> {
  const [items, setItems] = useState<T[]>([]);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(path !== null);
  const [attempt, setAttempt] = useState(0);

  const { select } = options;

  useEffect(() => {
    if (path === null) {
      setItems([]);
      setFailed(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFailed(false);
    // The previous list goes before the next one is asked for, so a stale
    // option is never selectable against a path it does not belong to.
    setItems([]);

    api
      .get<unknown>(path)
      .then((body) => {
        if (cancelled) return;
        setItems(select ? select(body) : (body as T[]));
        setFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        /*
         * The list is left empty, because there is nothing to show. What
         * changes is that `failed` says so, and the screens read it rather
         * than reading the emptiness as an answer.
         */
        setItems([]);
        setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `select` is a literal at every call site; `attempt` is what the retry moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { items, failed, loading, reload };
}
