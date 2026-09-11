/**
 * Who already owes the State money, biggest first.
 *
 * Phase 1 of the informal-sector programme has no screen anywhere else,
 * because it is not a report — nobody reads it to know a number. It is a
 * morning's work: a list of names, amounts and phone numbers, worked from the
 * top until the day runs out.
 *
 * So the design is a call list rather than a dashboard. The figures at the top
 * exist to say how much of the money is on the page in front of you; the table
 * below is the actual product, and it carries the phone number and the
 * language the taxpayer reads, because the officer is about to ring them.
 *
 * TWO THINGS THIS SCREEN SAYS OUT LOUD.
 *
 * That a payment in flight takes somebody off the list. An officer who does
 * not know that will assume the list is stale and ring anyway, which is the
 * exact harm the exclusion was built to prevent. The rule is worth a line of
 * text at the top of the page.
 *
 * That lapsed debt is not on the list and why. Past its deadline an invoice
 * cannot be paid — the platform refuses the money — so those debts need a
 * fresh assessment before anybody rings anyone. Showing the figure without the
 * explanation would have officers hunting for names that are deliberately not
 * there.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api, asApiError, type ApiError } from '../lib/api';
import { Alert, Badge, ErrorAlert, Loading, Money, Stat, Table, formatDate } from '../ui';
import { usePortalI18n } from '../lib/i18n';

interface Lga {
  id: string;
  name: string;
}

interface ArrearsRow {
  taxpayerId: string;
  taxpayerType: string;
  tin: string | null;
  name: string;
  phone: string;
  preferredLanguage: string | null;
  lgaId: string;
  lgaName: string;
  ward: string | null;
  outstandingKobo: string;
  invoiceCount: number;
  oldestDaysOutstanding: number;
  daysUntilLapse: number | null;
  owedFor: string[];
  lastPaymentAt: string | null;
  partiallyPaid: boolean;
}

interface Worklist {
  summary: {
    taxpayers: number;
    totalKobo: string;
    endedElsewhereKobo: string;
    lapsedKobo: string;
    lapsedInvoices: number;
    inFlightInvoices: number;
  };
  rows: ArrearsRow[];
}

export function ArrearsScreen() {
  const { t } = usePortalI18n();
  const [lgas, setLgas] = useState<Lga[]>([]);
  const [filters, setFilters] = useState({ lgaId: '', minimumNaira: '', lapsingWithinDays: '' });
  const [worklist, setWorklist] = useState<Worklist | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    api.get<Lga[]>('/reference/lgas').then(setLgas).catch(() => setLgas([]));
  }, []);

  const load = useCallback(() => {
    setError(null);
    setWorklist(null);

    const params = new URLSearchParams();
    if (filters.lgaId) params.set('lgaId', filters.lgaId);
    if (filters.minimumNaira) params.set('minimumNaira', filters.minimumNaira);
    if (filters.lapsingWithinDays) params.set('lapsingWithinDays', filters.lapsingWithinDays);

    api
      .get<Worklist>(`/government/arrears?${params.toString()}`)
      .then(setWorklist)
      .catch((caught: unknown) => {
        setError(asApiError(caught));
        setWorklist({
          summary: {
            taxpayers: 0,
            totalKobo: '0',
            endedElsewhereKobo: '0',
            lapsedKobo: '0',
            lapsedInvoices: 0,
            inFlightInvoices: 0,
          },
          rows: [],
        });
      });
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <div className="card">
        <h2 className="card__title">{t.ofcArTitle}</h2>
        <p className="card__hint">
          {t.ofcArIntro}
        </p>

        <div className="filters">
          <div className="field">
            <label htmlFor="arrears-lga">{t.pubVerifyLga}</label>
            <select
              id="arrears-lga"
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
            <label htmlFor="arrears-minimum">{t.ofcArAtLeast}</label>
            <input
              id="arrears-minimum"
              type="number"
              min="0"
              inputMode="numeric"
              value={filters.minimumNaira}
              onChange={(event) => setFilters({ ...filters, minimumNaira: event.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="arrears-lapsing">{t.ofcArLapsingWithin}</label>
            <select
              id="arrears-lapsing"
              value={filters.lapsingWithinDays}
              onChange={(event) =>
                setFilters({ ...filters, lapsingWithinDays: event.target.value })
              }
            >
              <option value="">{t.ofcArAnyDeadline}</option>
              <option value="7">{t.ofcArWithin7}</option>
              <option value="14">{t.ofcArWithin14}</option>
              <option value="30">{t.ofcArWithin30}</option>
            </select>
          </div>
        </div>

        <ErrorAlert error={error} />
      </div>

      {worklist === null ? (
        <Loading />
      ) : (
        <>
          <div className="card">
            <div className="stat-grid">
              <Stat label="ofcArCollectableNow" value={<Money kobo={worklist.summary.totalKobo} />} />
              <Stat label="ofcArTaxpayers" value={String(worklist.summary.taxpayers)} />
              <Stat label="ofcArNeedsReassessment" value={<Money kobo={worklist.summary.lapsedKobo} />} />
              <Stat label="ofcArEndedElsewhere" value={<Money kobo={worklist.summary.endedElsewhereKobo} />} />
            </div>

            {/*
              * The rule that keeps this list safe to work, stated where the
              * person working it will read it. An officer who believes the
              * figures are a nightly snapshot will ring somebody who paid an
              * hour ago; the whole point of the exclusion is that they do not
              * have to.
              */}
            <Alert kind="info" title="ofcArWhoIsMissing">
              {t.ofcArInFlightExplained.replace(
                '{{n}}',
                String(worklist.summary.inFlightInvoices),
              )}
            </Alert>

            {worklist.summary.lapsedInvoices > 0 ? (
              <Alert kind="warning" title="ofcArLapsedTitle">
                {t.ofcArLapsedExplained.replace(
                  '{{n}}',
                  String(worklist.summary.lapsedInvoices),
                )}
              </Alert>
            ) : null}
          </div>

          <div className="card">
            <h2 className="card__title">{t.ofcArWhoToCall}</h2>
            {worklist.rows.length >= 100 ? (
              <Alert kind="info">
                {t.ofcArShowingLargest.replace('{{n}}', String(worklist.rows.length))}
              </Alert>
            ) : null}
            <Table
              columns={[
                { key: 'name', label: 'colTaxpayerLabel' },
                { key: 'tin', label: 'tpStepTin' },
                { key: 'phone', label: 'tpPhone' },
                {
                  key: 'lgaName',
                  label: 'tpLgaShort',
                  render: (row: ArrearsRow) => (row.ward ? `${row.lgaName} — ${row.ward}` : row.lgaName),
                },
                {
                  key: 'outstandingKobo',
                  label: 'ofcAgOutstanding',
                  numeric: true,
                  render: (row: ArrearsRow) => <Money kobo={row.outstandingKobo} />,
                },
                { key: 'invoiceCount', label: 'ofcLvInvoices', numeric: true },
                {
                  key: 'owedFor',
                  label: 'ofcArOwedFor',
                  render: (row: ArrearsRow) => row.owedFor.join(', '),
                },
                {
                  key: 'daysUntilLapse',
                  label: 'ofcArDaysLeft',
                  numeric: true,
                  /*
                   * Days, not a date, because the question is "do I ring this
                   * one today" and a date makes the reader do the subtraction.
                   * A debt with no deadline never lapses and says so rather
                   * than showing a blank an officer would read as zero.
                   */
                  render: (row: ArrearsRow) =>
                    row.daysUntilLapse === null ? t.ofcArNoDeadline : String(row.daysUntilLapse),
                },
                {
                  key: 'lastPaymentAt',
                  label: 'ofcArLastPaid',
                  render: (row: ArrearsRow) =>
                    row.lastPaymentAt ? formatDate(row.lastPaymentAt) : t.ofcArNeverPaid,
                },
                {
                  key: 'partiallyPaid',
                  label: 'ofcArPartPaid',
                  render: (row: ArrearsRow) =>
                    row.partiallyPaid ? <Badge status="PARTIALLY_PAID" /> : null,
                },
              ]}
              rows={worklist.rows}
              empty="ofcArNobodyOwes"
            />
          </div>
        </>
      )}
    </>
  );
}
