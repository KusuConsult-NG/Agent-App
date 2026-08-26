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
import { Alert, Badge, ErrorAlert, KeyValue, Loading, Table } from '../ui';

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

export function TaxpayerRecordsScreen({ user }: { user: User }) {
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
    if (touched.length === 0) return 'Enter the corrected value in whichever field is wrong.';
    if (form.identityNumber.trim() && !form.identityType) {
      return 'Name the type of identification when changing the number.';
    }
    if (form.dateOfBirth && form.dateOfBirth > new Date().toISOString().slice(0, 10)) {
      return 'That date of birth is in the future. Check the year.';
    }
    if (form.reason.trim().length < 10) {
      return 'Say what is being corrected and why, in at least 10 characters. It is the only record of why.';
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
      const result = await api.post<{ message: string }>(`/taxpayers/${chosen.id}/identity`, body);
      setMessage(result.message);
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
        <h2 className="card__title">Correct a taxpayer record</h2>
        <p className="card__hint">
          Every correction is recorded against the officer who made it, with the reason given,
          and the taxpayer is sent a message telling them their record was changed. Only the
          fields you fill in are altered.
        </p>
      </div>

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      {!chosen && (
        <div className="card">
          <div className="filters">
            <div className="field">
              <label htmlFor="tp-search">Find the taxpayer</label>
              <input
                id="tp-search"
                value={search}
                placeholder="Name, phone, TIN or receipt number"
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
            >
              Search
            </button>
          </div>

          {busy && <Loading rows={2} />}

          {results && results.length === 0 && (
            <p className="empty">No taxpayer matches that search.</p>
          )}

          {results && results.length > 0 && (
            <ul className="list">
              {results.map((taxpayer) => (
                <li key={taxpayer.id}>
                  <button type="button" className="list__item" onClick={() => setChosen(taxpayer)}>
                    <div className="list__body">
                      <p className="list__title">{displayName(taxpayer)}</p>
                      <p className="list__meta">
                        {taxpayer.tin ? `TIN ${taxpayer.tin}` : 'No TIN yet'} · {taxpayer.phone}
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
              ['On record now', displayName(chosen)],
              ['TIN', chosen.tin ?? 'Not yet assigned'],
              ['Phone', chosen.phone],
            ]}
          />

          <p className="section-title">Corrected details</p>
          <p className="card__hint">Leave anything that is already right blank.</p>

          <div className="field">
            <label htmlFor="c-first">First name</label>
            <input id="c-first" value={form.firstName} onChange={set('firstName')} />
          </div>
          <div className="field">
            <label htmlFor="c-middle">Middle name</label>
            <input id="c-middle" value={form.middleName} onChange={set('middleName')} />
          </div>
          <div className="field">
            <label htmlFor="c-last">Last name</label>
            <input id="c-last" value={form.lastName} onChange={set('lastName')} />
          </div>
          <div className="field">
            <label htmlFor="c-business">Business name</label>
            <input id="c-business" value={form.businessName} onChange={set('businessName')} />
          </div>
          <div className="field">
            <label htmlFor="c-dob">Date of birth</label>
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
              <p className="section-title">Identification document</p>
              <p className="card__hint">
                This decides which person the record is about, so it is checked against every
                other active taxpayer before it is accepted.
              </p>
              <div className="field">
                <label htmlFor="c-idtype">Type</label>
                <select id="c-idtype" value={form.identityType} onChange={set('identityType')}>
                  <option value="">Unchanged</option>
                  <option value="NIN">National Identification Number</option>
                  <option value="BVN">Bank Verification Number</option>
                  <option value="PASSPORT">International passport</option>
                  <option value="DRIVERS_LICENCE">Driver&rsquo;s licence</option>
                  <option value="VOTERS_CARD">Voter&rsquo;s card</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="c-idnum">Number</label>
                <input
                  id="c-idnum"
                  inputMode="numeric"
                  value={form.identityNumber}
                  onChange={set('identityNumber')}
                />
              </div>
            </>
          ) : (
            <Alert kind="info" title="Changing the identification document needs an administrator">
              <p style={{ margin: 0 }}>
                A name or date of birth can be corrected here. The document the record is held
                under decides which person it is about, so an administrator has to make that
                change.
              </p>
            </Alert>
          )}

          <div className="field">
            <label htmlFor="c-reason">What is being corrected, and why</label>
            <textarea
              id="c-reason"
              rows={3}
              value={form.reason}
              onChange={set('reason')}
              placeholder="Surname was misspelt at registration; corrected against the NIN slip presented at the office."
            />
          </div>

          {blockedBecause && (
            <p className="card__hint" role="status" style={{ marginBottom: 0 }}>
              {blockedBecause}
            </p>
          )}

          <div className="button-row">
            <button type="button" disabled={busy || blockedBecause !== null} onClick={submit}>
              {busy ? 'Correcting…' : 'Record this correction'}
            </button>
            <button type="button" className="secondary" onClick={() => setChosen(null)}>
              Choose someone else
            </button>
          </div>
        </div>
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
  categoryName: string;
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
function Obligations({ taxpayerId }: { taxpayerId: string }) {
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
      const result = await api.put<{ message: string }>(
        `/taxpayers/${taxpayerId}/obligations`,
        { itemIds: remaining, source: 'OFFICER_REVIEW' },
      );
      setMessage(result.message);
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
      <div style={{ padding: '18px 18px 0' }}>
        <h2 className="card__title">What this taxpayer is liable for</h2>
        <p className="card__hint">
          Waiving an obligation stops future assessments against it. Invoices already raised stay
          payable — cancelling those is a separate decision, invoice by invoice.
        </p>
      </div>

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      <Table
        columns={[
          { key: 'code', label: 'Code', render: (row) => <span className="mono">{row.code}</span> },
          { key: 'name', label: 'Revenue item' },
          { key: 'categoryName', label: 'Category' },
          { key: 'source', label: 'Recorded by', render: (row) => readableSource(row.source) },
          { key: 'status', label: 'Status', render: (row) => <Badge status={row.status} /> },
          {
            key: 'action',
            label: '',
            render: (row) =>
              row.status === 'ACTIVE' ? (
                <button
                  type="button"
                  className="small danger"
                  disabled={busy}
                  onClick={() => void waive(row)}
                >
                  Waive
                </button>
              ) : null,
          },
        ]}
        rows={rows}
        empty="No obligations are recorded against this taxpayer."
      />
    </div>
  );
}

const readableSource = (source: string) =>
  source === 'AGENT_ONBOARDING'
    ? 'Agent, at registration'
    : source === 'AUTO_RECOMMENDATION'
      ? 'Suggested by sector'
      : 'Officer review';

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
      const result = await api.post<{ message: string }>(`/vehicles/${vehicle.id}/status`, {
        status,
        reason,
      });
      setMessage(result.message);
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
      <div style={{ padding: '18px 18px 0' }}>
        <h2 className="card__title">Vehicles on this record</h2>
        <p className="card__hint">
          Particulars cannot be renewed for a vehicle that is suspended or off the register.
          Renewals already issued stay valid for the period they were paid for.
        </p>

        {can('vehicle:manage') && vehicles.length > 0 && (
          <div className="field">
            <label htmlFor="veh-reason">Reason</label>
            <textarea
              id="veh-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Sold out of state and re-registered in Kaduna."
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
            label: 'Registration',
            render: (row) => <span className="mono">{row.registration_number}</span>,
          },
          {
            key: 'make',
            label: 'Vehicle',
            render: (row) => [row.make, row.model].filter(Boolean).join(' ') || row.vehicle_type,
          },
          {
            key: 'status',
            label: 'Status',
            render: (row) => (
              <span title={row.status_reason ?? undefined}>
                <Badge status={row.status} />
              </span>
            ),
          },
          {
            key: 'action',
            label: '',
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
                      >
                        Suspend
                      </button>
                      <button
                        type="button"
                        className="small danger"
                        disabled={busy || reason.trim().length < 5}
                        onClick={() => void change(row, 'ARCHIVED')}
                      >
                        Take off the register
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="small"
                      disabled={busy || reason.trim().length < 5}
                      onClick={() => void change(row, 'ACTIVE')}
                    >
                      Put back in service
                    </button>
                  )}
                </div>
              ) : null,
          },
        ]}
        rows={vehicles}
        empty="No vehicles are recorded against this taxpayer."
      />
    </div>
  );
}
