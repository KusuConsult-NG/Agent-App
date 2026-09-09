/**
 * One box, every kind of government reference.
 *
 * An officer holding a reference — off a citizen's SMS, a bank statement, a
 * note somebody left on a desk — had to already know what kind of thing it was
 * before they could look it up: transactions on one screen, receipts on
 * another, taxpayers on a third. Guess wrong and you search three screens
 * before discovering the number was a receipt. Nobody investigating anything
 * works that way, so in practice they rang whoever had done it before.
 *
 * It lives in the shell rather than on a screen of its own because a search you
 * have to navigate to is a search you use once.
 *
 * WHAT IT DOES NOT DO
 *
 * It grants nothing. Each kind of result is gated on the API against the
 * permission that kind's own screen requires, so a supervisor searching a staff
 * name gets no officers and an officer who cannot open reconciliation cannot
 * reach a settlement through here either. This component renders whatever comes
 * back and makes no access decision of its own.
 */

import { useEffect, useRef, useState } from 'react';
import { ApiRequestError, api } from '../lib/api';
import { usePortalI18n } from '../lib/i18n';
import { Money } from '../ui';
import type { TranslationDictionary } from '@psirs/shared';

interface Hit {
  kind: string;
  id: string;
  reference: string;
  title: string;
  subtitle: string | null;
  path: string;
  amount_kobo: string | null;
  status: string | null;
  occurred_at: string | null;
}

/** A dictionary key per result kind, so no kind is labelled in English. */
const KIND_LABEL: Record<string, keyof TranslationDictionary> = {
  transaction: 'ofcSearchTransaction',
  taxpayer: 'ofcSearchTaxpayer',
  agent: 'ofcSearchAgent',
  officer: 'ofcSearchOfficer',
  invoice: 'ofcSearchInvoice',
  receipt: 'ofcSearchReceipt',
  payment: 'ofcSearchPayment',
  assessment: 'ofcSearchAssessment',
  vehicle: 'ofcSearchVehicle',
  revenue_item: 'ofcSearchRevenueItem',
  place: 'ofcSearchPlace',
  case: 'ofcSearchCase',
};

export function GlobalSearch({ navigate }: { navigate: (path: string) => void }) {
  const { t } = usePortalI18n();
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  /*
   * Debounced, and the in-flight request is discarded if the term moved on.
   *
   * Without the second part, a slow answer for "TXN" can land after a fast one
   * for "TXN-2026-000182" and replace the results with the wrong ones — which
   * looks like the search failing to find something it just found.
   */
  useEffect(() => {
    const trimmed = term.trim();
    if (trimmed.length < 2) {
      setHits(null);
      setSearching(false);
      return;
    }
    let live = true;
    setSearching(true);
    const timer = setTimeout(() => {
      api
        .get<{ hits: Hit[] }>(`/government/search?q=${encodeURIComponent(trimmed)}`)
        .then((result) => {
          if (!live) return;
          setHits(result.hits);
          setOpen(true);
        })
        .catch((caught) => {
          if (live) setHits(caught instanceof ApiRequestError ? [] : null);
        })
        .finally(() => {
          if (live) setSearching(false);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [term]);

  // Clicking anywhere else puts the results away.
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function go(hit: Hit) {
    setOpen(false);
    setTerm('');
    navigate(hit.path);
  }

  return (
    <div className="global-search" ref={box}>
      <input
        type="search"
        value={term}
        aria-label={t.ofcSearchLabel}
        placeholder={t.ofcSearchPlaceholder}
        onChange={(event) => setTerm(event.target.value)}
        onFocus={() => hits && setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
          // Enter on a single result is the common case: an officer pasted a
          // reference and there is exactly one thing it can be.
          if (event.key === 'Enter' && hits?.length === 1) go(hits[0]!);
        }}
      />

      {open && (
        <div className="global-search__results" role="listbox">
          {searching && <p className="muted">{t.ofcSearchSearching}</p>}
          {!searching && hits?.length === 0 && <p className="muted">{t.ofcSearchNoResults}</p>}
          {hits?.map((hit) => (
            <button
              key={`${hit.kind}-${hit.id}`}
              type="button"
              role="option"
              aria-selected={false}
              className="global-search__hit"
              onClick={() => go(hit)}
            >
              <span className="global-search__kind">{t[KIND_LABEL[hit.kind] ?? 'search']}</span>
              <span className="global-search__title">{hit.title}</span>
              {hit.subtitle && <span className="global-search__subtitle">{hit.subtitle}</span>}
              {hit.amount_kobo && (
                <span className="global-search__amount">
                  <Money kobo={hit.amount_kobo} />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
