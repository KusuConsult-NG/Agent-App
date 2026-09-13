/**
 * The lists an agent picks from, and what happens when one does not arrive.
 *
 * Six places loaded reference geography and taxonomy with a bare `fetch`:
 *
 *   fetch('/api/v1/reference/lgas')
 *     .then((response) => (response.ok ? response.json() : []))
 *     .catch(() => setLgas([]));
 *
 * Both branches end at the same place. A 500 becomes an empty list. A dropped
 * connection becomes an empty list. Nothing is recorded, nothing is shown, and
 * the screen carries on as though the State of Plateau had no Local Government
 * Areas in it.
 *
 * WHY THAT IS NOT MERELY UNTIDY
 *
 * On the taxpayer registration form the LGA is a required field. When its list
 * is empty the agent cannot continue, and the sentence under the button reads
 * "Choose the Local Government Area." There is nothing to choose. So an agent
 * standing in front of somebody who has agreed to register is stopped dead and
 * told they have failed to do something that cannot be done — with no message
 * naming the real cause, and nothing to press.
 *
 * An empty list and a list that could not be read are different answers, and
 * this is the type that keeps them apart. `failed` exists so a screen can say
 * which one it has.
 *
 * These endpoints are deliberately public — "putting this behind
 * authentication would make the application form impossible to complete" —
 * so the read goes through `request` with `authenticated: false`. Through
 * `request` rather than `fetch` is the other half of the fix: that is where a
 * connection failure becomes an error with a sentence in it rather than a
 * silently empty array.
 */

import { useCallback, useEffect, useState } from 'react';
import { request } from './api';

export interface ReferenceList<T> {
  items: T[];
  /** The read was refused or never arrived. `items` is empty and means nothing. */
  failed: boolean;
  loading: boolean;
  reload: () => void;
}

/**
 * @param path  The API path, or null to hold off — wards have no list until an
 *              LGA is chosen, and "not asked for yet" is not a failure.
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
    /*
     * The previous list goes before the next one is asked for.
     *
     * Wards are the reason. The path changes when the agent picks a different
     * Local Government Area, and holding the old LGA's wards until the new
     * ones arrive leaves them selectable in the meantime — the registration
     * screen already says why that must not happen: "Leaving it selected
     * would file this registration in a ward of a different LGA; the server
     * refuses that, but the agent should not have to be told."
     *
     * The selection is cleared by the screen. These are the options.
     */
    setItems([]);

    request<unknown>(path, { authenticated: false })
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
