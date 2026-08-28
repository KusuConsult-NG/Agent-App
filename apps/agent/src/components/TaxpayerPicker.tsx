/**
 * Choosing the taxpayer a payment is attributed to.
 *
 * The vehicle renewal screen asked for this by putting a text box on screen
 * labelled "Taxpayer paying", hinted "Search for the taxpayer to get their
 * ID", and expecting the agent to type one in. A taxpayer id is a
 * thirty-six-character UUID, there was no search anywhere on that screen, and
 * the agent is standing beside a vehicle holding a phone. The field was not
 * hard to use; it was impassable, and the renewal flow behind it could not be
 * completed by anybody working the way agents actually work.
 *
 * The collect screen has always had the search this needed. Rather than
 * duplicate it a third time, it is a component: search, tap a name, and the
 * id the API wants never has to be seen by a person.
 */

import { useState } from 'react';
import { ApiRequestError, api, type ApiError } from '../lib/api';
import { ErrorAlert, Field, Spinner } from '../ui';
import { useI18n } from '../lib/i18n';

export interface PickedTaxpayer {
  id: string;
  taxpayer_type: string;
  tin: string | null;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  phone: string;
  lga_name?: string;
}

/**
 * A name to put on the screen, and the caller's word for having none.
 *
 * The fallback used to sit behind `??`, which a trimmed empty string never
 * reaches — a record with no name rendered as blank rather than as anything
 * an agent could act on. `||` is the operator that was meant, and the label
 * is passed in so it can be in the agent's own language: this is a plain
 * function and cannot reach the dictionary itself.
 */
export function taxpayerDisplayName(taxpayer: PickedTaxpayer, unnamed = 'Unnamed taxpayer'): string {
  return (
    taxpayer.business_name ||
    `${taxpayer.first_name ?? ''} ${taxpayer.last_name ?? ''}`.trim() ||
    unnamed
  );
}

export function TaxpayerPicker({
  label,
  hint,
  chosen,
  onChoose,
  onClear,
}: {
  label?: string;
  hint?: string;
  chosen: PickedTaxpayer | null;
  onChoose: (taxpayer: PickedTaxpayer) => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  /**
   * `null` until a search has been run, so "nothing found" can be told apart
   * from "nothing searched for yet" — the same distinction the collect screen
   * needed, and for the same reason: an agent who searches and sees no change
   * cannot tell whether the person is unregistered or the app has failed.
   */
  const [results, setResults] = useState<PickedTaxpayer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResults(
        await api.get<PickedTaxpayer[]>(
          `/taxpayers/search?q=${encodeURIComponent(search.trim())}`,
        ),
      );
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  if (chosen) {
    return (
      <div className="field">
        <label>{label ?? t.tpTaxpayerPaying}</label>
        <div className="card" style={{ margin: 0, padding: 12 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>
            {taxpayerDisplayName(chosen, t.tpUnnamedTaxpayer)}
          </p>
          <p className="list__meta" style={{ margin: '2px 0 8px' }}>
            {chosen.tin ? `TIN ${chosen.tin}` : t.tpNoTinYet} · {chosen.phone}
          </p>
          <button
            type="button"
            className="secondary"
            style={{ width: 'auto', minHeight: 38, padding: '6px 12px', fontSize: '0.82rem' }}
            onClick={() => {
              onClear();
              setResults(null);
              setSearch('');
            }}
          >
            {t.tpChooseSomeoneElse}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Field label={label ?? t.tpTaxpayerPaying} hint={hint ?? t.tpSearchByNamePhoneTin} required>
        <input
          type="search"
          value={search}
          placeholder={t.tpSearchPlaceholder}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (search.trim().length >= 2) void run();
            }
          }}
        />
      </Field>

      <button
        type="button"
        className="secondary"
        disabled={busy || search.trim().length < 2}
        onClick={() => void run()}
      >
        {busy ? <Spinner /> : null}
        Search
      </button>

      <ErrorAlert error={error} />

      {results && results.length === 0 && (
        <p className="empty">
          No taxpayer matches that search. They must be registered before a payment can be
          attributed to them. {t.searchAnotherArea}
        </p>
      )}

      {results && results.length > 0 && (
        <ul className="list">
          {results.map((taxpayer) => (
            <li key={taxpayer.id}>
              <button type="button" className="list__item" onClick={() => onChoose(taxpayer)}>
                <div className="list__body">
                  <p className="list__title">{taxpayerDisplayName(taxpayer, t.tpUnnamedTaxpayer)}</p>
                  <p className="list__meta">
                    {taxpayer.tin ? `TIN ${taxpayer.tin}` : t.tpNoTinYet} · {taxpayer.phone}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
