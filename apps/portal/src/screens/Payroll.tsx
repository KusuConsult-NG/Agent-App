/**
 * Employers who should be filing PAYE, and the return itself.
 *
 * Phase 3 of the informal-sector programme, and the largest line in it. A
 * private school with forty teachers is informal in the only sense that
 * matters — unregistered, unassessed, paying nothing — and is worth a hundred
 * tailors for one visit. The list on the left of this screen is built from
 * `economic_sector`, which the register has carried since registration, so it
 * costs no field work at all.
 *
 * THE SHAPE OF THE FORM IS THE CONTROL.
 *
 * There is no tax column. The officer enters what each person was paid and
 * the platform works out what was owed on it — and because the field does not
 * exist, there is nothing to negotiate over at a counter. That is the whole
 * failure mode of PAYE and it is designed out rather than validated against.
 *
 * The total updates as rows are entered, and it is the platform's figure
 * echoed back rather than a sum the browser did: a screen that showed its own
 * arithmetic would eventually disagree with the invoice, and the officer would
 * have to decide which to believe in front of the employer.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api, asApiError, can, type ApiError } from '../lib/api';
import { Alert, ErrorAlert, Loading, Money, Stat, Table, formatDate } from '../ui';
import { usePortalI18n } from '../lib/i18n';
import { enumLabel } from '@psirs/shared';

interface Lga {
  id: string;
  name: string;
}

interface Lead {
  taxpayerId: string;
  name: string;
  tin: string | null;
  phone: string;
  lgaId: string;
  lgaName: string;
  economicSector: string | null;
  natureOfBusiness: string | null;
  monthsSinceLastFiling: number | null;
  paidLastYearKobo: string;
}

interface Leads {
  summary: { leads: number; filing: number };
  rows: Lead[];
}

interface Return_ {
  scheduleId: string;
  periodYear: number;
  periodMonth: number;
  status: string;
  employeeCount: number;
  grossEmolumentsKobo: string;
  taxDueKobo: string;
  filedAt: string;
  cancelledReason: string | null;
}

interface Filed {
  employeeCount: number;
  grossEmolumentsKobo: string;
  taxDueKobo: string;
  invoiceNumber: string;
  employeesWithoutTin: number;
}

interface EmployeeRow {
  employeeName: string;
  employeeTin: string;
  grossNaira: string;
}

const blankRow = (): EmployeeRow => ({ employeeName: '', employeeTin: '', grossNaira: '' });

/** The month before this one, which is the one an employer files for. */
function lastCompleteMonth() {
  const now = new Date();
  const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { year: previous.getUTCFullYear(), month: previous.getUTCMonth() + 1 };
}

export function PayrollScreen() {
  const { t } = usePortalI18n();
  const canFile = can('paye:file');

  const [lgas, setLgas] = useState<Lga[]>([]);
  const [view, setView] = useState<'PAYE' | 'CONSUMPTION'>('PAYE');
  const [filters, setFilters] = useState({ lgaId: '' });
  const [leads, setLeads] = useState<Leads | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [openName, setOpenName] = useState<string>('');
  const [history, setHistory] = useState<Return_[] | null>(null);
  /*
   * "This employer has never filed a return." is what an empty history prints,
   * and it is a statement about a named employer that an officer acts on. The
   * catch used to write `[]` and say nothing, so a refused read produced that
   * sentence about somebody who may have filed every month.
   */
  const [historyError, setHistoryError] = useState<ApiError | null>(null);
  const [period, setPeriod] = useState(lastCompleteMonth());
  const [rows, setRows] = useState<EmployeeRow[]>([blankRow()]);
  const [filed, setFiled] = useState<Filed | null>(null);
  const [filingError, setFilingError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  /*
   * A written reason, on the page. Withdrawing a return retracts the State's
   * position on what an employer declared, and a retraction nobody explained
   * cannot be defended to them — the service refuses one without a reason, and
   * this is where the officer writes it.
   */
  const [withdrawReason, setWithdrawReason] = useState('');

  useEffect(() => {
    api.get<Lga[]>('/reference/lgas').then(setLgas).catch(() => setLgas([]));
  }, []);

  const loadLeads = useCallback(() => {
    setError(null);
    setLeads(null);
    const params = new URLSearchParams();
    if (filters.lgaId) params.set('lgaId', filters.lgaId);
    const path =
      view === 'PAYE'
        ? `/government/paye/not-filing?${params.toString()}`
        : `/government/consumption-tax/not-paying?${params.toString()}`;

    api
      .get<Leads>(path)
      .then(setLeads)
      .catch((caught: unknown) => {
        setError(asApiError(caught));
        setLeads({ summary: { leads: 0, filing: 0 }, rows: [] });
      });
  }, [filters, view]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  const openEmployer = (lead: Lead) => {
    setOpenId(lead.taxpayerId);
    setOpenName(lead.name);
    setFiled(null);
    setFilingError(null);
    setRows([blankRow()]);
    setHistory(null);
    setHistoryError(null);
    api
      .get<Return_[]>(`/government/paye/employers/${lead.taxpayerId}/returns`)
      .then(setHistory)
      .catch((caught: unknown) => {
        setHistoryError(asApiError(caught));
      });
  };

  const usable = rows.filter((row) => row.employeeName.trim() && row.grossNaira.trim());

  const withdraw = async (scheduleId: string) => {
    if (!withdrawReason.trim() || !openId) return;
    setBusy(true);
    setFilingError(null);
    try {
      await api.post(`/government/paye/returns/${scheduleId}/cancel`, {
        reason: withdrawReason.trim(),
      });
      setWithdrawReason('');
      const refreshed = await api.get<Return_[]>(
        `/government/paye/employers/${openId}/returns`,
      );
      setHistory(refreshed);
      loadLeads();
    } catch (caught) {
      setFilingError(asApiError(caught));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!openId || usable.length === 0) return;
    setBusy(true);
    setFilingError(null);
    try {
      const result = await api.post<Filed>('/government/paye/returns', {
        employerTaxpayerId: openId,
        periodYear: period.year,
        periodMonth: period.month,
        lines: usable.map((row) => ({
          employeeName: row.employeeName.trim(),
          ...(row.employeeTin.trim() ? { employeeTin: row.employeeTin.trim() } : {}),
          // Naira at the boundary, kobo underneath — the officer types the
          // unit on the payslip in front of them.
          grossEmolumentKobo: (BigInt(row.grossNaira.replace(/\D/g, '') || '0') * 100n).toString(),
        })),
      });
      setFiled(result);
      setRows([blankRow()]);
      loadLeads();
      api
        .get<Return_[]>(`/government/paye/employers/${openId}/returns`)
        .then(setHistory)
        .catch(() => undefined);
    } catch (caught) {
      setFilingError(asApiError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="card">
        <h2 className="card__title">{t.ofcPrTitle}</h2>
        <p className="card__hint">{t.ofcPrIntro}</p>

        <div className="filters">
          <div className="field">
            <label htmlFor="pr-view">{t.ofcPrWhichList}</label>
            <select
              id="pr-view"
              value={view}
              onChange={(event) => setView(event.target.value as 'PAYE' | 'CONSUMPTION')}
            >
              <option value="PAYE">{t.ofcPrListPaye}</option>
              <option value="CONSUMPTION">{t.ofcPrListConsumption}</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="pr-lga">{t.pubVerifyLga}</label>
            <select
              id="pr-lga"
              value={filters.lgaId}
              onChange={(event) => setFilters({ lgaId: event.target.value })}
            >
              <option value="">{t.ofcAllLgas}</option>
              {lgas.map((lga) => (
                <option key={lga.id} value={lga.id}>
                  {lga.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <ErrorAlert error={error} />
      </div>

      {leads === null ? (
        <Loading />
      ) : (
        <div className="card">
          <div className="stat-grid">
            <Stat label="ofcPrNotFiling" value={String(leads.summary.leads)} />
            {/*
              * The denominator. "Forty schools have never filed" reads very
              * differently against forty-two on the register than against four
              * hundred, and an officer given only the first number cannot tell
              * which situation they are in.
              */}
            <Stat label="ofcPrFiling" value={String(leads.summary.filing)} />
          </div>

          <Table
            columns={[
              { key: 'name', label: 'colTaxpayerLabel' },
              { key: 'tin', label: 'tpStepTin' },
              { key: 'phone', label: 'tpPhone' },
              { key: 'lgaName', label: 'tpLgaShort' },
              {
                key: 'economicSector',
                label: 'ofcPrSector',
                render: (row: Lead) => (row.economicSector ? enumLabel(row.economicSector, t) : '—'),
              },
              { key: 'natureOfBusiness', label: 'ofcPrNature' },
              {
                key: 'paidLastYearKobo',
                label: 'ofcIgPaidLastYear',
                numeric: true,
                render: (row: Lead) => <Money kobo={row.paidLastYearKobo} />,
              },
              {
                key: 'taxpayerId',
                label: 'ofcPrOpen',
                render: (row: Lead) => (
                  <button type="button" onClick={() => openEmployer(row)}>
                    {t.ofcPrOpen}
                  </button>
                ),
              },
            ]}
            rows={leads.rows}
            empty={view === 'PAYE' ? 'ofcPrNoneNotFiling' : 'ofcPrNoneNotPaying'}
          />
        </div>
      )}

      {openId ? (
        <div className="card">
          <h2 className="card__title">{openName}</h2>

          {historyError ? (
            <ErrorAlert error={historyError} />
          ) : history === null ? (
            <Loading rows={2} />
          ) : (
            <>
              <h3 style={{ marginTop: 0, fontSize: 'var(--text-md)' }}>{t.ofcPrFiledBefore}</h3>
              <Table
                columns={[
                  {
                    key: 'periodMonth',
                    label: 'ofcPrPeriod',
                    render: (row: Return_) =>
                      `${row.periodYear}-${String(row.periodMonth).padStart(2, '0')}`,
                  },
                  { key: 'employeeCount', label: 'ofcPrEmployees', numeric: true },
                  {
                    key: 'grossEmolumentsKobo',
                    label: 'ofcPrGross',
                    numeric: true,
                    render: (row: Return_) => <Money kobo={row.grossEmolumentsKobo} />,
                  },
                  {
                    key: 'taxDueKobo',
                    label: 'ofcPrTax',
                    numeric: true,
                    render: (row: Return_) => <Money kobo={row.taxDueKobo} />,
                  },
                  {
                    key: 'filedAt',
                    label: 'ofcPrFiledOn',
                    render: (row: Return_) => formatDate(row.filedAt),
                  },
                  {
                    key: 'status',
                    label: 'ofcOsState',
                    render: (row: Return_) => enumLabel(row.status, t),
                  },
                  { key: 'cancelledReason', label: 'ofcPrWithdrawnBecause' },
                  {
                    key: 'scheduleId',
                    label: 'ofcPrWithdraw',
                    render: (row: Return_) =>
                      canFile && row.status !== 'CANCELLED' ? (
                        <button
                          type="button"
                          disabled={busy || !withdrawReason.trim()}
                          title={withdrawReason.trim() ? undefined : t.ofcPrWithdrawFirst}
                          onClick={() => withdraw(row.scheduleId)}
                        >
                          {t.ofcPrWithdraw}
                        </button>
                      ) : null,
                  },
                ]}
                rows={history}
                empty="ofcPrNeverFiled"
              />

              {canFile && history.length > 0 ? (
                <div className="field" style={{ maxWidth: 560 }}>
                  <label htmlFor="pr-withdraw-reason">{t.ofcPrWithdrawReason}</label>
                  <textarea
                    id="pr-withdraw-reason"
                    rows={2}
                    value={withdrawReason}
                    onChange={(event) => setWithdrawReason(event.target.value)}
                  />
                </div>
              ) : null}
            </>
          )}

          {canFile ? (
            <>
              <h3 style={{ marginTop: 24, fontSize: 'var(--text-md)' }}>{t.ofcPrFileAReturn}</h3>

              {/*
                * Said plainly, because the officer is about to be asked for it
                * by the employer. There is no tax box on this form and that is
                * not an omission.
                */}
              <Alert kind="info" title="ofcPrHowTheTaxIsWorkedOut">
                {t.ofcPrHowExplained}
              </Alert>

              <div className="filters">
                <div className="field">
                  <label htmlFor="pr-year">{t.ofcPrYear}</label>
                  <input
                    id="pr-year"
                    type="number"
                    value={String(period.year)}
                    onChange={(event) =>
                      setPeriod({ ...period, year: Number(event.target.value) || period.year })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="pr-month">{t.ofcPrMonth}</label>
                  <input
                    id="pr-month"
                    type="number"
                    min="1"
                    max="12"
                    value={String(period.month)}
                    onChange={(event) =>
                      setPeriod({ ...period, month: Number(event.target.value) || period.month })
                    }
                  />
                </div>
              </div>

              <table>
                <thead>
                  <tr>
                    <th>{t.ofcPrEmployeeName}</th>
                    <th>{t.tpStepTin}</th>
                    <th>{t.ofcPrMonthlyPay}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={index}>
                      <td>
                        <input
                          aria-label={`${t.ofcPrEmployeeName} ${index + 1}`}
                          value={row.employeeName}
                          onChange={(event) => {
                            const next = [...rows];
                            next[index] = { ...row, employeeName: event.target.value };
                            setRows(next);
                          }}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`${t.tpStepTin} ${index + 1}`}
                          value={row.employeeTin}
                          onChange={(event) => {
                            const next = [...rows];
                            next[index] = { ...row, employeeTin: event.target.value };
                            setRows(next);
                          }}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`${t.ofcPrMonthlyPay} ${index + 1}`}
                          inputMode="numeric"
                          value={row.grossNaira}
                          onChange={(event) => {
                            const next = [...rows];
                            next[index] = { ...row, grossNaira: event.target.value };
                            setRows(next);
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p>
                <button type="button" onClick={() => setRows([...rows, blankRow()])}>
                  {t.ofcPrAddEmployee}
                </button>{' '}
                <button type="button" onClick={submit} disabled={busy || usable.length === 0}>
                  {t.ofcPrSubmit.replace('{{n}}', String(usable.length))}
                </button>
              </p>

              <ErrorAlert error={filingError} />

              {filed ? (
                <Alert kind="success" title="ofcPrFiledTitle">
                  {t.ofcPrFiledExplained
                    .replace('{{n}}', String(filed.employeeCount))
                    .replace('{{invoice}}', filed.invoiceNumber)}
                  {filed.employeesWithoutTin > 0
                    ? ' ' +
                      t.ofcPrMissingTins.replace('{{n}}', String(filed.employeesWithoutTin))
                    : ''}
                </Alert>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
