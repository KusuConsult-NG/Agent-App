/**
 * Correcting what a taxpayer record says.
 *
 * Records are captured in markets, by agents, from what somebody told them.
 * Surnames get misspelt, dates of birth are a year out, identity documents
 * are replaced after being lost. Nothing in the platform could correct any of
 * it: the record was written at registration and only the TIN and the
 * compliance figures ever moved afterwards.
 *
 * The screen keeps the two tiers the API enforces visible rather than hiding
 * one behind a refusal. A name or a date of birth is ordinary correction
 * work. The identity document decides *which person the record is about* — it
 * is what duplicate detection blocks on — so it is administrator-only, and an
 * officer who cannot change it is told that before they type, not after.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api, can, stepUp, type ApiError, type User } from '../lib/api';
import { Alert, Badge, ErrorAlert, KeyValue, Loading, Money, Stat, Table, formatDate } from '../ui';
import { usePortalI18n } from '../lib/i18n';
import { enumLabel, localName } from '@psirs/shared';

interface FoundTaxpayer {
  id: string;
  taxpayer_type: string;
  tin: string | null;
  first_name: string | null;
  middle_name?: string | null;
  last_name: string | null;
  business_name: string | null;
  phone: string;
  lga_name?: string;
}

const displayName = (t: FoundTaxpayer) =>
  t.business_name ?? `${t.first_name ?? ''} ${t.last_name ?? ''}`.trim();

interface ByItem {
  revenueItem: string;
  payments: number;
  totalKobo: string;
}

interface PaidRow {
  transactionReference: string;
  paidAt: string | null;
  revenueItem: string;
  revenueItemHa: string | null;
  periodLabel: string | null;
  amountKobo: string;
  status: string;
  returned: boolean;
  receiptNumber: string | null;
}

interface PaidHistory {
  summary: { payments: number; totalKobo: string; returnedKobo: string; byItem: ByItem[] };
  rows: PaidRow[];
}

export function TaxpayerRecordsScreen({ user }: { user: User }) {
  const { t } = usePortalI18n();
  const [search, setSearch] = useState('');
  /** `null` until a search has run, so "found nobody" is not "not searched". */
  const [results, setResults] = useState<FoundTaxpayer[] | null>(null);
  const [chosen, setChosen] = useState<FoundTaxpayer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const mayChangeDocument = can('taxpayer:manage');
  const [form, setForm] = useState({
    firstName: '',
    middleName: '',
    lastName: '',
    businessName: '',
    dateOfBirth: '',
    identityType: '',
    identityNumber: '',
    reason: '',
  });

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((previous) => ({ ...previous, [key]: event.target.value }));

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResults(await api.get<FoundTaxpayer[]>(`/taxpayers/search?q=${encodeURIComponent(search.trim())}`));
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  const touched = Object.entries(form).filter(([key, value]) => key !== 'reason' && value.trim());

  const blockedBecause = ((): string | null => {
    if (touched.length === 0) return t.ofcTrEnterTheCorrectedValue;
    if (form.identityNumber.trim() && !form.identityType) {
      return t.ofcTrNameTheTypeOf;
    }
    if (form.dateOfBirth && form.dateOfBirth > new Date().toISOString().slice(0, 10)) {
      return t.birthDateFuture;
    }
    if (form.reason.trim().length < 10) {
      return t.ofcTrSayWhatIsBeing;
    }
    return null;
  })();

  async function submit() {
    if (!chosen || blockedBecause) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await stepUp('taxpayer.identity.change', user.phone);
      const body: Record<string, string> = { reason: form.reason.trim() };
      for (const [key, value] of touched) body[key] = value.trim();
      const result = await api.post<{ changed: string[] }>(
        `/taxpayers/${chosen.id}/identity`,
        body,
      );
      setMessage(
        result.changed.length === 1
          ? t.ofcTrOneDetailCorrected
          : t.ofcTrDetailsCorrected.replace('{{n}}', String(result.changed.length)),
      );
      setForm({
        firstName: '',
        middleName: '',
        lastName: '',
        businessName: '',
        dateOfBirth: '',
        identityType: '',
        identityNumber: '',
        reason: '',
      });
      setChosen(null);
      setResults(null);
      setSearch('');
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
      else if (caught instanceof Error) {
        setError({ code: 'CLIENT', message: caught.message, moneyStatus: 'NOT_APPLICABLE' });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card">
        <h2 className="card__title">{t.ofcTrTitle}</h2>
        <p className="card__hint">{t.ofcTrIntro}</p>
      </div>

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      {!chosen && (
        <div className="card">
          <div className="filters">
            <div className="field">
              <label htmlFor="tp-search">{t.ofcOvFindTheTaxpayer}</label>
              <input
                id="tp-search"
                value={search}
                placeholder={t.ofcTrSearchPlaceholder}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && search.trim().length >= 2) void run();
                }}
              />
            </div>
            <button
              type="button"
              className="secondary"
              disabled={busy || search.trim().length < 2}
              onClick={() => void run()}
            >{t.search}</button>
          </div>

          {busy && <Loading rows={2} />}

          {results && results.length === 0 && (
            <p className="empty">{t.ofcTrNoMatch}</p>
          )}

          {results && results.length > 0 && (
            <ul className="list list--rows">
              {results.map((taxpayer) => (
                <li key={taxpayer.id}>
                  <button type="button" className="list__item" onClick={() => setChosen(taxpayer)}>
                    <div className="list__body">
                      <p className="list__title">{displayName(taxpayer)}</p>
                      <p className="list__meta">
                        {taxpayer.tin ? `TIN ${taxpayer.tin}` : t.tpNoTinYet} · {taxpayer.phone}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {chosen && (
        <div className="card">
          <h2 className="card__title">{displayName(chosen)}</h2>
          <KeyValue
            items={[
              [t.ofcTrOnRecordNow, displayName(chosen)],
              ['TIN', chosen.tin ?? t.tpNotYetAssigned],
              [t.tpPhone, chosen.phone],
            ]}
          />

          <p className="section-title">{t.ofcTrCorrectedDetails}</p>
          <p className="card__hint">{t.ofcTrLeaveBlank}</p>

          <div className="field">
            <label htmlFor="c-first">{t.tpFirstName}</label>
            <input id="c-first" value={form.firstName} onChange={set('firstName')} />
          </div>
          <div className="field">
            <label htmlFor="c-middle">{t.tpMiddleName}</label>
            <input id="c-middle" value={form.middleName} onChange={set('middleName')} />
          </div>
          <div className="field">
            <label htmlFor="c-last">{t.tpLastName}</label>
            <input id="c-last" value={form.lastName} onChange={set('lastName')} />
          </div>
          <div className="field">
            <label htmlFor="c-business">{t.tpBusinessName}</label>
            <input id="c-business" value={form.businessName} onChange={set('businessName')} />
          </div>
          <div className="field">
            <label htmlFor="c-dob">{t.authDateOfBirth}</label>
            <input
              id="c-dob"
              type="date"
              min="1900-01-01"
              max={new Date().toISOString().slice(0, 10)}
              value={form.dateOfBirth}
              onChange={set('dateOfBirth')}
            />
          </div>

          {mayChangeDocument ? (
            <>
              <p className="section-title">{t.ofcTrIdentificationDocument}</p>
              <p className="card__hint">{t.ofcTrDecidesWhichPerson}</p>
              <div className="field">
                <label htmlFor="c-idtype">{t.tpType}</label>
                <select id="c-idtype" value={form.identityType} onChange={set('identityType')}>
                  <option value="">{t.ofcTrUnchanged}</option>
                  <option value="NIN">{t.pubIdNin}</option>
                  <option value="BVN">{t.pubIdBvn}</option>
                  <option value="PASSPORT">{t.pubIdPassport}</option>
                  <option value="DRIVERS_LICENCE">{t.idLicence}</option>
                  <option value="VOTERS_CARD">{t.idVoters}</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="c-idnum">{t.ofcTrNumber}</label>
                <input
                  id="c-idnum"
                  inputMode="numeric"
                  value={form.identityNumber}
                  onChange={set('identityNumber')}
                />
              </div>
            </>
          ) : (
            <Alert kind="info" title="ofcTrNeedsAdministrator">
              <p style={{ margin: 0 }}>{t.ofcTrNameOrDob}</p>
            </Alert>
          )}

          <div className="field">
            <label htmlFor="c-reason">{t.ofcTrWhatAndWhy}</label>
            <textarea
              id="c-reason"
              rows={3}
              value={form.reason}
              onChange={set('reason')}
              placeholder={t.ofcTrSampleCorrection}
            />
          </div>

          {blockedBecause && (
            <p className="card__hint" role="status" style={{ marginBottom: 0 }}>
              {blockedBecause}
            </p>
          )}

          <div className="button-row">
            <button type="button" disabled={busy || blockedBecause !== null} onClick={submit}>
              {busy ? t.ofcTrCorrecting : t.ofcTrRecordThisCorrection}
            </button>
            <button type="button" className="secondary" onClick={() => setChosen(null)}>{t.tpChooseSomeoneElse}</button>
          </div>
        </div>
      )}

      {chosen && can('taxpayer:correct') && (
        <RegisterStatus taxpayerId={chosen.id} name={displayName(chosen)} />
      )}

      {chosen && (can('report:read:all') || can('report:read:territory')) && (
        <PaymentHistory taxpayerId={chosen.id} />
      )}

      {chosen && can('taxpayer:obligation:waive') && <Obligations taxpayerId={chosen.id} />}

      {chosen && can('vehicle:read:all') && <VehicleRegister taxpayerId={chosen.id} />}
    </>
  );
}

interface ObligationRow {
  id: string;
  revenueItemId: string;
  code: string;
  name: string;
  nameHa: string | null;
  categoryName: string;
  categoryNameHa: string | null;
  frequency: string;
  source: string;
  status: string;
}

/**
 * What this taxpayer is liable for, and cancelling what they are not.
 *
 * `taxpayer:obligation:waive` is deliberately separate from `taxpayer:update`,
 * which agents hold — removing what a citizen owes government is a revenue
 * decision, not a correction. But no screen exercised it, so the separation
 * protected a permission nobody could use: an obligation recorded in error at
 * onboarding stayed on the record, kept the taxpayer in arrears, and kept
 * dragging their compliance score down.
 *
 * The endpoint takes the list that should remain, and waives whatever is
 * missing from it — so this sends the current set minus the one being removed,
 * rather than a delete.
 */
/**
 * What this person has already paid, and for what.
 *
 * The question a taxpayer actually asks, which the platform could not answer:
 * it knew what was owed and had no view of what had been settled. An officer
 * who has just found somebody by phone, name or TIN can now answer them
 * without leaving the record.
 *
 * The period defaults to the last twelve months rather than to everything.
 * "What did I pay this year" is the question people ask — they are reconciling
 * against a bank statement, or checking a levy they think they paid twice —
 * and an unbounded list answers a question nobody asked, slowly.
 */
function PaymentHistory({ taxpayerId }: { taxpayerId: string }) {
  const { lang, t } = usePortalI18n();
  const today = new Date();
  const yearAgo = new Date(today);
  yearAgo.setFullYear(today.getFullYear() - 1);
  const asDate = (value: Date) => value.toISOString().slice(0, 10);

  const [from, setFrom] = useState(asDate(yearAgo));
  const [to, setTo] = useState(asDate(today));
  const [history, setHistory] = useState<PaidHistory | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(() => {
    setError(null);
    setHistory(null);
    api
      .get<PaidHistory>(
        `/government/taxpayers/${taxpayerId}/payments?from=${from}&to=${to}`,
      )
      .then(setHistory)
      .catch((caught: unknown) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
  }, [taxpayerId, from, to]);

  useEffect(load, [load]);

  return (
    <div className="card">
      <h2 className="card__title">{t.ofcPhTitle}</h2>
      <p className="card__hint">{t.ofcPhIntro}</p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ maxWidth: 190 }}>
          <label htmlFor="ph-from">{t.ofcPhFrom}</label>
          <input id="ph-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field" style={{ maxWidth: 190 }}>
          <label htmlFor="ph-to">{t.ofcPhTo}</label>
          <input id="ph-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      <ErrorAlert error={error} />

      {history === null ? (
        <Loading rows={2} />
      ) : (
        <>
          <div className="stat-row">
            <Stat label="ofcPhPaid" value={<Money kobo={history.summary.totalKobo} />} />
            <Stat label="ofcPhPayments" value={String(history.summary.payments)} />
            {/*
              * Only when there is some. A row reading "returned ₦0.00" on every
              * record makes a reversal look like a normal part of paying tax.
              */}
            {history.summary.returnedKobo !== '0' ? (
              <Stat label="ofcPhReturned" value={<Money kobo={history.summary.returnedKobo} />} />
            ) : null}
          </div>

          {history.summary.byItem.length > 0 ? (
            <>
              <p className="section-title">{t.ofcPhForWhat}</p>
              <Table
                columns={[
                  { key: 'revenueItem', label: 'ofcPhLevy' },
                  { key: 'payments', label: 'ofcPhPayments' },
                  {
                    key: 'totalKobo',
                    label: 'ofcPhPaid',
                    numeric: true,
                    render: (row: ByItem) => <Money kobo={row.totalKobo} />,
                  },
                ]}
                rows={history.summary.byItem}
                empty="ofcPhNothingPaid"
              />
            </>
          ) : null}

          <p className="section-title">{t.ofcPhEachPayment}</p>
          <Table
            columns={[
              {
                key: 'paidAt',
                label: 'ofcPhWhen',
                render: (row: PaidRow) => (row.paidAt ? formatDate(row.paidAt) : '—'),
              },
              {
                key: 'revenueItem',
                label: 'ofcPhLevy',
                render: (row: PaidRow) => localName(lang, row.revenueItem, row.revenueItemHa),
              },
              { key: 'periodLabel', label: 'ofcPhPeriod' },
              {
                key: 'amountKobo',
                label: 'ofcPhAmount',
                numeric: true,
                render: (row: PaidRow) => <Money kobo={row.amountKobo} />,
              },
              { key: 'receiptNumber', label: 'ofcPhReceipt' },
              {
                key: 'status',
                label: 'appStatus',
                /*
                 * A reversal is shown as one. Rendering it as an ordinary
                 * payment would have somebody reading money back out of the
                 * account as money paid into it.
                 */
                render: (row: PaidRow) =>
                  row.returned ? <Badge status={row.status} /> : enumLabel(row.status, t),
              },
            ]}
            rows={history.rows}
            empty="ofcPhNothingPaid"
          />
        </>
      )}
    </div>
  );
}

function Obligations({ taxpayerId }: { taxpayerId: string }) {
  const { lang, t } = usePortalI18n();
  const [rows, setRows] = useState<ObligationRow[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get<ObligationRow[]>(`/taxpayers/${taxpayerId}/obligations`)
      .then(setRows)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
  }, [taxpayerId]);

  useEffect(() => {
    load();
  }, [load]);

  async function waive(row: ObligationRow) {
    if (!rows) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const remaining = rows
        .filter((r) => r.status === 'ACTIVE' && r.revenueItemId !== row.revenueItemId)
        .map((r) => r.revenueItemId);
      const result = await api.put<{ added: number; waived: number }>(
        `/taxpayers/${taxpayerId}/obligations`,
        { itemIds: remaining, source: 'OFFICER_REVIEW' },
      );
      setMessage(
        t.ofcTrObligationsUpdated
          .replace('{{added}}', String(result.added))
          .replace('{{waived}}', String(result.waived)),
      );
      load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
      else if (caught instanceof Error) {
        setError({ code: 'CLIENT', message: caught.message, moneyStatus: 'NOT_APPLICABLE' });
      }
    } finally {
      setBusy(false);
    }
  }

  if (!rows) return null;

  return (
    <div className="card card--flush">
      <div className="card__pad">
        <h2 className="card__title">{t.ofcTrLiableFor}</h2>
        <p className="card__hint">{t.ofcTrWaiveBody}</p>
      </div>

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      <Table
        columns={[
          { key: 'code', label: 'ofcAgCode', render: (row: ObligationRow) => <span className="mono">{row.code}</span> },
          { key: 'name', label: 'colRevenueItem', render: (row: ObligationRow) => localName(lang, row.name, row.nameHa) },
          { key: 'categoryName', label: 'ofcAgCategory', render: (row: ObligationRow) => localName(lang, row.categoryName, row.categoryNameHa) },
          { key: 'source', label: 'ofcTrRecordedBy', render: (row) => enumLabel(row.source, t) },
          { key: 'status', label: 'appStatus', render: (row) => <Badge status={row.status} /> },
          {
            key: 'action',
            label: { text: '' },
            render: (row) =>
              row.status === 'ACTIVE' ? (
                <button
                  type="button"
                  className="small danger"
                  disabled={busy}
                  onClick={() => void waive(row)}
                >{t.ofcTrWaive}</button>
              ) : null,
          },
        ]}
        rows={rows}
        empty="ofcNoneObligationsRecordedAgainstTaxpayer"
      />
    </div>
  );
}


interface VehicleRow {
  id: string;
  registration_number: string;
  make: string | null;
  model: string | null;
  vehicle_type: string;
  current_expiry_date: string | null;
  status: string;
  status_reason: string | null;
}

/**
 * The vehicles on this taxpayer's record, and taking one out of service.
 *
 * A vehicle record outlives the vehicle: it is sold, written off, scrapped.
 * Until there was a way to say so, particulars could be renewed for a car that
 * no longer existed, and the owner kept being treated as liable for it. The
 * control sits on the correction screen because that is what this is — the
 * platform saying something about somebody that has stopped being true.
 */
function VehicleRegister({ taxpayerId }: { taxpayerId: string }) {
  const { t } = usePortalI18n();
  const [vehicles, setVehicles] = useState<VehicleRow[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get<VehicleRow[]>(`/vehicles?taxpayerId=${taxpayerId}`)
      .then(setVehicles)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
  }, [taxpayerId]);

  useEffect(() => {
    load();
  }, [load]);

  async function change(vehicle: VehicleRow, status: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.post<{ registrationNumber: string; to: string }>(
        `/vehicles/${vehicle.id}/status`,
        {
          status,
          reason,
        },
      );
      setMessage(
        result.to === 'ACTIVE'
          ? t.ofcTrVehicleBackInService.replace('{{plate}}', result.registrationNumber)
          : result.to === 'SUSPENDED'
            ? t.ofcTrVehicleSuspended.replace('{{plate}}', result.registrationNumber)
            : t.ofcTrVehicleArchived.replace('{{plate}}', result.registrationNumber),
      );
      setReason('');
      load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
      else if (caught instanceof Error) {
        setError({ code: 'CLIENT', message: caught.message, moneyStatus: 'NOT_APPLICABLE' });
      }
    } finally {
      setBusy(false);
    }
  }

  if (!vehicles) return null;

  return (
    <div className="card card--flush">
      <div className="card__pad">
        <h2 className="card__title">{t.ofcTrVehiclesOnRecord}</h2>
        <p className="card__hint">{t.ofcTrVehiclesBody}</p>

        {can('vehicle:manage') && vehicles.length > 0 && (
          <div className="field">
            <label htmlFor="veh-reason">{t.ofcAgReason}</label>
            <textarea
              id="veh-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t.ofcTrSampleVehicle}
            />
          </div>
        )}
      </div>

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      <Table
        columns={[
          {
            key: 'registration_number',
            label: 'moreRegistrationLabel',
            render: (row) => <span className="mono">{row.registration_number}</span>,
          },
          {
            key: 'make',
            label: 'moreVehicleLabel',
            render: (row) => [row.make, row.model].filter(Boolean).join(' ') || row.vehicle_type,
          },
          {
            key: 'status',
            label: 'appStatus',
            render: (row) => (
              <span title={row.status_reason ?? undefined}>
                <Badge status={row.status} />
              </span>
            ),
          },
          {
            key: 'action',
            label: { text: '' },
            render: (row) =>
              can('vehicle:manage') ? (
                <div className="button-row">
                  {row.status === 'ACTIVE' ? (
                    <>
                      <button
                        type="button"
                        className="small secondary"
                        disabled={busy || reason.trim().length < 5}
                        onClick={() => void change(row, 'SUSPENDED')}
                      >{t.ofcAgSuspend}</button>
                      <button
                        type="button"
                        className="small danger"
                        disabled={busy || reason.trim().length < 5}
                        onClick={() => void change(row, 'ARCHIVED')}
                      >{t.ofcTrTakeOffRegister}</button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="small"
                      disabled={busy || reason.trim().length < 5}
                      onClick={() => void change(row, 'ACTIVE')}
                    >{t.ofcTrPutBackInService}</button>
                  )}
                </div>
              ) : null,
          },
        ]}
        rows={vehicles}
        empty="ofcNoneVehiclesRecordedAgainstTaxpayer"
      />
    </div>
  );
}

/**
 * Taking a record off the register, and putting it back.
 *
 * The record of a business that shut kept accruing assessments and kept being
 * sent reminders, because nothing could ever change its status. What this is
 * not is a write-off: what was already owed stays owed, stays in every total,
 * and moves to the ended-with-arrears queue on the Outstanding work screen —
 * so a debt cannot be made to quietly stop being anybody's job by closing the
 * record it sits on.
 */
function RegisterStatus({ taxpayerId, name }: { taxpayerId: string; name: string }) {
  const { t } = usePortalI18n();
  const [status, setStatus] = useState<'SUSPENDED' | 'CLOSED' | 'ACTIVE'>('CLOSED');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    if (reason.trim().length < 10) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.post<{
        status: string;
        outstandingKobo: string;
      }>(`/taxpayers/${taxpayerId}/status`, {
        status,
        reason: reason.trim(),
      });
      /*
       * Composed here, because the sentence changes what an officer does next.
       *
       * "No new assessment can be raised and reminders stop" is the operative
       * half, and "what is already owed remains owed" is the half a citizen
       * will ring about. Both arrived as the server's English.
       */
      setMessage(
        result.status === 'ACTIVE'
          ? t.ofcTrOnRegisterAgain.replace('{{name}}', name)
          : `${t.ofcTrRecordEnded
              .replace('{{name}}', name)
              .replace('{{status}}', enumLabel(result.status, t))} ` +
            (BigInt(result.outstandingKobo) > 0n
              ? t.ofcTrStillOwedAfterEnding
              : t.ofcTrNothingWasOutstanding),
      );
      setReason('');
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="card__title">{t.ofcTrRegisterFor.replace('{{name}}', name)}</h2>
      <p className="card__hint">{t.ofcTrEndedBody}</p>

      {error && <ErrorAlert error={error} />}
      {message && (
        <Alert kind="success">
          <p style={{ margin: 0 }}>{message}</p>
        </Alert>
      )}

      <div className="field">
        <label htmlFor="reg-status">{t.ofcTrWhatHappened}</label>
        <select
          id="reg-status"
          value={status}
          onChange={(event) => setStatus(event.target.value as typeof status)}
        >
          <option value="CLOSED">{t.ofcTrClosedOption}</option>
          <option value="SUSPENDED">{t.ofcTrSuspendedOption}</option>
          <option value="ACTIVE">{t.ofcTrActiveOption}</option>
        </select>
      </div>

      <div className="field">
        <label htmlFor="reg-reason">{t.ofcTrHowEstablished}</label>
        <textarea
          id="reg-reason"
          value={reason}
          rows={3}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t.ofcTrSampleClosure}
        />
      </div>

      <div className="button-row">
        <button type="button" disabled={busy || reason.trim().length < 10} onClick={submit}>
          {busy ? t.ofcTrRecording : status === 'ACTIVE' ? t.ofcTrPutBackOnThe : t.ofcTrTakeOffRegister}
        </button>
      </div>
    </div>
  );
}
