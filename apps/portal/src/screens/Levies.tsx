/**
 * The three questions an officer asks about a levy, in one place (PRD §57).
 *
 * The platform could answer all of them about a *person* — open a taxpayer and
 * see what they were assessed, what they paid and what they owe. It could
 * answer none of them about a *levy*, which is the direction a revenue officer
 * actually works in. "How much has the Development Levy brought in this
 * quarter?", "who is registered under the shop rate in Jos North?" and "who is
 * behind on it?" each needed a person's name to begin with, and the officer
 * asking does not have one — finding the names is the question.
 *
 * The three endpoints behind this were built and tested and had no screen. So
 * the answers existed and no officer could reach them, which is the same as not
 * having them.
 *
 * One filter bar drives all three, because they are one question asked three
 * ways. Choosing "Development Levy" once should show what it collected, who is
 * on it, and who has not paid — an officer who has to re-enter the levy in
 * three places will use one of the three and believe it is the whole picture.
 *
 * Each section is fetched only if the officer holds the permission that section
 * needs. An auditor reads the money and the defaulters; they hold no
 * `taxpayer:read:all`, and asking anyway would render a permission error inside
 * a screen their own menu offered them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiRequestError, api, can, type ApiError } from '../lib/api';
import { Alert, Empty, ErrorAlert, Loading, Money, Stat, Table, formatDate } from '../ui';
import { usePortalI18n } from '../lib/i18n';
import { localName } from '@psirs/shared';

interface Category {
  id: string;
  name: string;
  name_ha: string | null;
  code: string;
}

interface Item {
  id: string;
  code: string;
  name: string;
  name_ha: string | null;
  category_name: string;
  category_name_ha: string | null;
}

interface Lga {
  id: string;
  name: string;
}

interface CategoryRow {
  category_id: string;
  category: string;
  category_ha: string | null;
  transactions: string;
  amount_kobo: string;
  settled_kobo: string;
  taxpayers: string;
}

interface ItemRow extends CategoryRow {
  revenue_item_id: string;
  revenue_item: string;
  revenue_item_ha: string | null;
  code: string;
}

interface CategoryReport {
  totalKobo: string;
  settledKobo: string;
  awaitingSettlementKobo: string;
  categories: CategoryRow[];
  items: ItemRow[];
}

interface DefaulterRow {
  taxpayer_id: string;
  name: string;
  tin: string | null;
  phone: string;
  lga: string;
  category: string;
  category_ha: string | null;
  revenue_item: string;
  revenue_item_ha: string | null;
  invoices: string;
  outstanding_kobo: string;
  oldest_due: string | null;
}

interface DefaulterReport {
  outstandingKobo: string;
  defaulters: number;
  rows: DefaulterRow[];
}

interface Registrant {
  id: string;
  taxpayer_type: string;
  tin: string | null;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  phone: string;
  lga_name: string;
  ward_name: string | null;
  status: string;
}

const displayName = (row: Registrant) =>
  row.business_name ?? `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() ?? '—';

export function LeviesScreen() {
  const { lang, t } = usePortalI18n();
  const canReadRevenue =
    can('report:read:all') || can('report:read:territory') || can('dashboard:executive');
  const canReadDefaulters =
    can('report:read:all') || can('report:read:territory') || can('taxpayer:read:all');
  /*
   * Listing citizens by levy, which is a report and not a lookup.
   *
   * The search endpoint refuses it to a collecting agent — the same call from
   * a handset is an enumeration of the register — and answers it for an
   * officer, bounded to the territories they hold. So the section belongs to
   * anyone with either the statewide taxpayer permission or a territory to be
   * bounded to, and a supervisor gets their own area's list.
   *
   * A supervisor with no territory assigned is refused with a message that
   * says so. That is shown rather than hidden on purpose: the account is
   * unfinished, and an officer who can see the reason can get it fixed.
   */
  const canReadTaxpayers = can('taxpayer:read:all') || can('report:read:territory');

  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [lgas, setLgas] = useState<Lga[]>([]);

  const [filters, setFilters] = useState({
    categoryId: '',
    revenueItemId: '',
    lgaId: '',
    from: '',
    to: '',
    outstandingOnly: false,
  });

  const [revenue, setRevenue] = useState<CategoryReport | null>(null);
  const [defaulters, setDefaulters] = useState<DefaulterReport | null>(null);
  const [registrants, setRegistrants] = useState<Registrant[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    api.get<Category[]>('/revenue/categories').then(setCategories).catch(() => setCategories([]));
    api.get<Item[]>('/revenue/items').then(setItems).catch(() => setItems([]));
    api.get<Lga[]>('/reference/lgas').then(setLgas).catch(() => setLgas([]));
  }, []);

  /*
   * The item list narrows to the chosen category, and a chosen item that no
   * longer belongs to it is dropped rather than left showing. A filter bar that
   * displays "Development Levy" while querying a category it is not in gives an
   * answer to a question nobody asked.
   */
  const itemsInScope = useMemo(
    () =>
      filters.categoryId
        ? items.filter((item) => {
            const category = categories.find((entry) => entry.id === filters.categoryId);
            return category ? item.category_name === category.name : true;
          })
        : items,
    [items, categories, filters.categoryId],
  );

  const load = useCallback(() => {
    setError(null);

    const money = new URLSearchParams();
    if (filters.categoryId) money.set('categoryId', filters.categoryId);
    if (filters.lgaId) money.set('lgaId', filters.lgaId);
    if (filters.from) money.set('from', filters.from);
    if (filters.to) money.set('to', filters.to);

    const owed = new URLSearchParams();
    if (filters.categoryId) owed.set('categoryId', filters.categoryId);
    if (filters.revenueItemId) owed.set('revenueItemId', filters.revenueItemId);
    if (filters.lgaId) owed.set('lgaId', filters.lgaId);

    const who = new URLSearchParams();
    if (filters.categoryId) who.set('categoryId', filters.categoryId);
    if (filters.revenueItemId) who.set('revenueItemId', filters.revenueItemId);
    if (filters.lgaId) who.set('lgaId', filters.lgaId);
    if (filters.outstandingOnly) who.set('outstandingOnly', 'true');

    const fail = (caught: unknown) => {
      if (caught instanceof ApiRequestError) setError(caught.error);
    };

    if (canReadRevenue) {
      setRevenue(null);
      api
        .get<CategoryReport>('/government/revenue/by-category?' + money.toString())
        .then(setRevenue)
        .catch(fail);
    }

    if (canReadDefaulters) {
      setDefaulters(null);
      api
        .get<DefaulterReport>('/government/revenue/defaulters?' + owed.toString())
        .then(setDefaulters)
        .catch(fail);
    }

    /*
     * Only when a levy has been chosen. `/taxpayers/search` refuses a request
     * with no criterion at all, and rightly — "every taxpayer in Plateau
     * State" is not a search. So this section stays empty until the officer
     * has named something, rather than opening with an error.
     */
    if (canReadTaxpayers && [...who.keys()].length > 0) {
      setRegistrants(null);
      api
        .get<Registrant[]>('/taxpayers/search?limit=100&' + who.toString())
        .then(setRegistrants)
        .catch(fail);
    } else {
      setRegistrants([]);
    }
  }, [filters, canReadRevenue, canReadDefaulters, canReadTaxpayers]);

  useEffect(() => {
    load();
  }, [load]);

  const chosenLevy = (() => {
    const item = itemsInScope.find((i) => i.id === filters.revenueItemId);
    if (item) return localName(lang, item.name, item.name_ha);
    const cat = categories.find((entry) => entry.id === filters.categoryId);
    if (cat) return localName(lang, cat.name, cat.name_ha);
    return 'every levy';
  })();

  return (
    <>
      <div className="card">
        <h2 className="card__title">{t.ofcLvTitle}</h2>
        {/*
          * The summary names what this officer will actually be shown.
          *
          * It read "what each levy brought in, who is registered under it, and
          * who is behind" for everyone — including a supervisor, who does not
          * get the middle one. A page that promises three answers and gives two
          * reads as a screen that failed to load rather than one that is doing
          * what it is meant to.
          */}
        <p style={{ color: 'var(--muted)', marginTop: 0, fontSize: '0.85rem' }}>
          {canReadTaxpayers ? t.ofcLvIntroAll : t.ofcLvIntroNoRegister}{' '}
          {t.ofcLvChooseOnce}
        </p>

        <div className="filters">
          <div className="field">
            <label htmlFor="levy-category">{t.ofcLvTaxCategory}</label>
            <select
              id="levy-category"
              value={filters.categoryId}
              onChange={(event) =>
                setFilters({ ...filters, categoryId: event.target.value, revenueItemId: '' })
              }
            >
              <option value="">{t.ofcLvAllCategories}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {localName(lang, category.name, category.name_ha)}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="levy-item">{t.ofcLvLevyOrItem}</label>
            <select
              id="levy-item"
              value={filters.revenueItemId}
              onChange={(event) => setFilters({ ...filters, revenueItemId: event.target.value })}
            >
              <option value="">{t.ofcLvAllItems}</option>
              {itemsInScope.map((item) => (
                <option key={item.id} value={item.id}>
                  {localName(lang, item.name, item.name_ha)} ({item.code})
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="levy-lga">{t.pubVerifyLga}</label>
            <select
              id="levy-lga"
              value={filters.lgaId}
              onChange={(event) => setFilters({ ...filters, lgaId: event.target.value })}
            >
              <option value="">{t.ofcAllLgas}</option>
              {lgas.map((lga) => (
                <option key={lga.id} value={lga.id}>
                  {lga.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="levy-from">{t.ofcLvCollectedFrom}</label>
            <input
              id="levy-from"
              type="date"
              value={filters.from}
              onChange={(event) => setFilters({ ...filters, from: event.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="levy-to">{t.ofcLvCollectedTo}</label>
            <input
              id="levy-to"
              type="date"
              value={filters.to}
              onChange={(event) => setFilters({ ...filters, to: event.target.value })}
            />
          </div>

          <button
            type="button"
            className="secondary"
            onClick={() =>
              setFilters({
                categoryId: '',
                revenueItemId: '',
                lgaId: '',
                from: '',
                to: '',
                outstandingOnly: false,
              })
            }
          >{t.ofcAgClear}</button>
        </div>
      </div>

      <ErrorAlert error={error} />

      {canReadRevenue && (
        <div className="card">
          <h2 className="card__title">{t.ofcLvBroughtIn.replace('{{levy}}', chosenLevy)}</h2>
          {revenue === null ? (
            <Loading />
          ) : (
            <>
              <div className="stat-grid">
                <Stat label="ofcPfCollected" value={<Money kobo={revenue.totalKobo} />} />
                <Stat label="ofcLvSettledToState" value={<Money kobo={revenue.settledKobo} />} />
                {/*
                  * Stated rather than left to be inferred from the difference.
                  * Money a gateway has confirmed and the State's account has
                  * not yet received is the number this platform exists to keep
                  * visible, and a summary showing only the first figure would
                  * be the old behaviour in a new screen.
                  */}
                <Stat
                  label="ofcLvAwaitingSettlement"
                  value={<Money kobo={revenue.awaitingSettlementKobo} />}
                />
              </div>

              <Table
                columns={[
                  { key: 'category', label: 'ofcAgCategory', render: (row: CategoryRow) => localName(lang, row.category, row.category_ha) },
                  { key: 'transactions', label: 'ofcLvCollections', numeric: true },
                  { key: 'taxpayers', label: 'ofcRhTaxpayers', numeric: true },
                  {
                    key: 'amount_kobo',
                    label: 'ofcPfCollected',
                    numeric: true,
                    render: (row) => <Money kobo={row.amount_kobo} />,
                  },
                  {
                    key: 'settled_kobo',
                    label: 'ofcLvSettled',
                    numeric: true,
                    render: (row) => <Money kobo={row.settled_kobo} />,
                  },
                ]}
                rows={revenue.categories}
                empty="ofcNoneNothingCollectedFilter"
              />

              <h3 style={{ marginTop: 24, fontSize: '0.95rem' }}>{t.ofcLvByIndividualLevy}</h3>
              <Table
                columns={[
                  { key: 'code', label: 'ofcAgCode' },
                  { key: 'revenue_item', label: 'ofcLvLevy', render: (row: ItemRow) => localName(lang, row.revenue_item, row.revenue_item_ha) },
                  { key: 'category', label: 'ofcAgCategory', render: (row: ItemRow) => localName(lang, row.category, row.category_ha) },
                  { key: 'transactions', label: 'ofcLvCollections', numeric: true },
                  {
                    key: 'amount_kobo',
                    label: 'ofcPfCollected',
                    numeric: true,
                    render: (row) => <Money kobo={row.amount_kobo} />,
                  },
                  {
                    key: 'settled_kobo',
                    label: 'ofcLvSettled',
                    numeric: true,
                    render: (row) => <Money kobo={row.settled_kobo} />,
                  },
                ]}
                rows={revenue.items}
                empty="ofcNoneIndividualLevyCollectedAnything"
              />
            </>
          )}
        </div>
      )}

      {canReadDefaulters && (
        <div className="card">
          <h2 className="card__title">{t.ofcLvBehindOn.replace('{{levy}}', chosenLevy)}</h2>
          {defaulters === null ? (
            <Loading />
          ) : (
            <>
              <div className="stat-grid">
                <Stat label="ofcLvTaxpayersInArrears" value={String(defaulters.defaulters)} />
                <Stat label="ofcLvTotalOutstanding" value={<Money kobo={defaulters.outstandingKobo} />} />
              </div>
              {defaulters.rows.length === 100 || defaulters.rows.length === 500 ? (
                <Alert kind="info">
                  {t.ofcLvShowingLargest.replace('{{n}}', String(defaulters.rows.length))}
                </Alert>
              ) : null}
              <Table
                columns={[
                  { key: 'name', label: 'colTaxpayerLabel' },
                  { key: 'tin', label: 'tpStepTin' },
                  { key: 'phone', label: 'tpPhone' },
                  { key: 'lga', label: 'tpLgaShort' },
                  { key: 'revenue_item', label: 'ofcLvLevy', render: (row: DefaulterRow) => localName(lang, row.revenue_item, row.revenue_item_ha) },
                  { key: 'invoices', label: 'ofcLvInvoices', numeric: true },
                  {
                    key: 'outstanding_kobo',
                    label: 'ofcAgOutstanding',
                    numeric: true,
                    render: (row) => <Money kobo={row.outstanding_kobo} />,
                  },
                  {
                    key: 'oldest_due',
                    label: 'ofcLvOldestDue',
                    render: (row) => formatDate(row.oldest_due),
                  },
                ]}
                rows={defaulters.rows}
                empty="ofcNoneNobodyArrearsFilter"
              />
            </>
          )}
        </div>
      )}

      {canReadTaxpayers && (
        <div className="card">
          <h2 className="card__title">
            {t.ofcLvRegisteredUnder.replace('{{levy}}', chosenLevy)}
          </h2>
          <div className="filters">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={filters.outstandingOnly}
                onChange={(event) =>
                  setFilters({ ...filters, outstandingOnly: event.target.checked })
                }
              />{t.ofcLvOnlyUnpaid}</label>
          </div>
          {registrants === null ? (
            <Loading />
          ) : registrants.length === 0 && !filters.categoryId && !filters.revenueItemId &&
            !filters.lgaId && !filters.outstandingOnly ? (
            <Empty>{t.ofcLvChooseFilter}</Empty>
          ) : (
            <Table
              columns={[
                { key: 'name', label: 'colTaxpayerLabel', render: (row) => displayName(row) },
                { key: 'taxpayer_type', label: 'tpType' },
                { key: 'tin', label: 'tpStepTin' },
                { key: 'phone', label: 'tpPhone' },
                { key: 'lga_name', label: 'tpLgaShort' },
                { key: 'ward_name', label: 'tpWard' },
                { key: 'status', label: 'appStatus' },
              ]}
              rows={registrants}
              empty="ofcNoneNobodyRegisteredFilter"
            />
          )}
        </div>
      )}
    </>
  );
}
