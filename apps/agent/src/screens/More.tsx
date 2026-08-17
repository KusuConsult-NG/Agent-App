/** Vehicles, receipts, commission wallet and profile. */

import { useEffect, useState } from 'react';
import { ApiRequestError, APP_VERSION, api, newIdempotencyKey, type ApiError } from '../lib/api';
import { describeDevice } from '../lib/device';
import { listDrafts, type Draft } from '../lib/drafts';
import { Alert, Badge, ErrorAlert, Field, KeyValue, Loading, Money, Spinner } from '../ui';

// ---------------------------------------------------------------- vehicles

interface VehicleLookup {
  source: 'PLATFORM' | 'AUTHORITY' | 'NOT_FOUND';
  vehicle: Record<string, string | null> | null;
  authorityConfirmed: boolean;
  message: string;
}

export function VehiclesScreen({ navigate }: { navigate: (path: string) => void }) {
  const [registration, setRegistration] = useState('');
  const [lookup, setLookup] = useState<VehicleLookup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [items, setItems] = useState<{ id: string; name: string; code: string }[]>([]);
  const [revenueItemId, setRevenueItemId] = useState('');
  const [months, setMonths] = useState<6 | 12 | 24>(12);
  const [taxpayerId, setTaxpayerId] = useState('');

  useEffect(() => {
    api
      .get<{ id: string; name: string; code: string }[]>('/revenue/items?search=Vehicle')
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  async function find() {
    setBusy(true);
    setError(null);
    setLookup(null);
    try {
      setLookup(
        await api.get<VehicleLookup>(`/vehicles/lookup/${encodeURIComponent(registration.trim())}`),
      );
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  async function renew() {
    if (!lookup?.vehicle) return;
    setBusy(true);
    setError(null);
    try {
      // A vehicle found only at the authority is captured on the platform
      // first, preserving which fields came from the authoritative registry.
      const vehicleId =
        (lookup.vehicle.id as string | undefined) ??
        (
          await api.post<{ vehicleId: string }>('/vehicles', {
            registrationNumber: lookup.vehicle.registrationNumber ?? registration.trim().toUpperCase(),
            chassisNumber: lookup.vehicle.chassisNumber ?? undefined,
            engineNumber: lookup.vehicle.engineNumber ?? undefined,
            make: lookup.vehicle.make ?? undefined,
            model: lookup.vehicle.model ?? undefined,
            vehicleType: lookup.vehicle.vehicleType ?? 'PRIVATE',
            vehicleClass: lookup.vehicle.vehicleClass ?? undefined,
            colour: lookup.vehicle.colour ?? undefined,
            ownerName: lookup.vehicle.ownerName ?? 'Unknown owner',
            taxpayerId,
          })
        ).vehicleId;

      const renewal = await api.post<{ transactionReference: string; transactionId: string }>(
        `/vehicles/${vehicleId}/renew`,
        { revenueItemId, renewalPeriodMonths: months, taxpayerId },
        newIdempotencyKey('renewal'),
      );

      await api.post('/payments/initiate', { transactionId: renewal.transactionId }, newIdempotencyKey('payment'));
      navigate(`/transactions/${renewal.transactionReference}`);
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card">
        <h2 className="card__title">Vehicle particulars renewal</h2>
        <p className="card__hint">
          Search the vehicle first. Records confirmed by the vehicle authority are marked as such.
        </p>
        <Field label="Registration number" required>
          <input
            value={registration}
            onChange={(event) => setRegistration(event.target.value.toUpperCase())}
            placeholder="JOS123AB"
            autoCapitalize="characters"
          />
        </Field>
        <button type="button" disabled={busy || registration.trim().length < 4} onClick={find}>
          {busy ? <Spinner /> : null}
          Search vehicle
        </button>
      </div>

      <ErrorAlert error={error} />

      {lookup && (
        <div className="card">
          <Alert kind={lookup.source === 'NOT_FOUND' ? 'warning' : lookup.authorityConfirmed ? 'success' : 'info'}>
            {lookup.message}
          </Alert>

          {lookup.vehicle && (
            <>
              <KeyValue
                items={[
                  ['Registration', lookup.vehicle.registration_number ?? lookup.vehicle.registrationNumber],
                  ['Owner', lookup.vehicle.owner_name ?? lookup.vehicle.ownerName],
                  [
                    'Vehicle',
                    [lookup.vehicle.make, lookup.vehicle.model].filter(Boolean).join(' ') || '—',
                  ],
                  ['Chassis', lookup.vehicle.chassis_number ?? lookup.vehicle.chassisNumber],
                  [
                    'Current expiry',
                    lookup.vehicle.current_expiry_date ?? lookup.vehicle.currentExpiryDate ?? '—',
                  ],
                  [
                    'Authority confirmed',
                    lookup.authorityConfirmed ? 'Yes' : 'No — entered manually',
                  ],
                ]}
              />

              <Field label="Renewal service" required>
                <select value={revenueItemId} onChange={(event) => setRevenueItemId(event.target.value)}>
                  <option value="">Select renewal type</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Renewal period" required>
                <select
                  value={months}
                  onChange={(event) => setMonths(Number(event.target.value) as 6 | 12 | 24)}
                >
                  <option value={6}>6 months</option>
                  <option value={12}>12 months</option>
                  <option value={24}>24 months</option>
                </select>
              </Field>

              <Field label="Taxpayer paying" hint="Search for the taxpayer to get their ID" required>
                <input
                  value={taxpayerId}
                  onChange={(event) => setTaxpayerId(event.target.value)}
                  placeholder="Taxpayer ID"
                />
              </Field>

              <button type="button" disabled={busy || !revenueItemId || !taxpayerId} onClick={renew}>
                {busy ? <Spinner /> : null}
                Calculate and proceed to payment
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- receipts

interface ReceiptRow {
  id: string;
  receipt_number: string;
  amount_kobo: string;
  issued_at: string;
  status: string;
  revenue_item: string;
  taxpayer_name: string;
  verification_code: string;
}

export function ReceiptsScreen() {
  const [receipts, setReceipts] = useState<ReceiptRow[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    api
      .get<ReceiptRow[]>('/receipts')
      .then(setReceipts)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
  }, []);

  if (error) return <ErrorAlert error={error} />;
  if (!receipts) return <Loading rows={4} />;

  return (
    <>
      <div className="card">
        <h2 className="card__title">Receipts you facilitated</h2>
        <p className="card__hint">
          Every receipt here was issued by government after the payment was independently confirmed.
        </p>
      </div>

      <div className="card card--flush">
        {receipts.length === 0 ? (
          <p className="empty">No receipts yet.</p>
        ) : (
          <ul className="list">
            {receipts.map((receipt) => (
              <li key={receipt.id}>
                <button
                  type="button"
                  className="list__item"
                  onClick={async () => {
                    const detail = await api.get<{ downloadUrl: string }>(`/receipts/${receipt.id}`);
                    window.open(detail.downloadUrl, '_blank', 'noopener');
                  }}
                >
                  <div className="list__body">
                    <p className="list__title">{receipt.receipt_number}</p>
                    <p className="list__meta">
                      {receipt.taxpayer_name} · {receipt.revenue_item}
                    </p>
                  </div>
                  <span className="list__amount">
                    <Money kobo={receipt.amount_kobo} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

// -------------------------------------------------------------- commission

interface Wallet {
  wallet: {
    pendingKobo: string;
    eligibleKobo: string;
    onHoldKobo: string;
    approvedKobo: string;
    paidKobo: string;
    reversedKobo: string;
    lifetimeKobo: string;
    transactionCount: number;
  };
  entries: {
    id: string;
    amount_kobo: string;
    rate_basis_points: number;
    basis_amount_kobo: string;
    status: string;
    transaction_reference: string;
    revenue_item: string;
  }[];
  note: string;
}

export function CommissionScreen() {
  const [data, setData] = useState<Wallet | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = () =>
    api
      .get<Wallet>('/agents/me/commission')
      .then(setData)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });

  useEffect(() => {
    void load();
  }, []);

  async function requestPayout() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.post<{ payoutReference: string; message: string }>(
        '/agents/me/commission/payout',
      );
      setMessage(`${result.message} Reference ${result.payoutReference}.`);
      await load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <ErrorAlert error={error} />;
  if (!data) return <Loading rows={4} />;

  return (
    <>
      <section className="headline">
        <p className="headline__label">Available for payout</p>
        <p className="headline__amount">
          <Money kobo={data.wallet.eligibleKobo} />
        </p>
        <div className="headline__stats">
          <div>
            <strong>
              <Money kobo={data.wallet.pendingKobo} />
            </strong>
            pending
          </div>
          <div>
            <strong>
              <Money kobo={data.wallet.paidKobo} />
            </strong>
            paid
          </div>
          <div>
            <strong>{data.wallet.transactionCount}</strong>
            transactions
          </div>
        </div>
      </section>

      <Alert kind="info" title="This is a commission record, not a bank account">
        <p style={{ margin: 0 }}>{data.note}</p>
      </Alert>

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      <button type="button" disabled={busy || BigInt(data.wallet.eligibleKobo) === 0n} onClick={requestPayout}>
        {busy ? <Spinner /> : null}
        Request payout
      </button>
      <p className="field__hint" style={{ marginTop: 8 }}>
        Commission becomes available once the transaction has been settled to the government account
        and the hold period has passed. A one-time code is required to request a payout.
      </p>

      <p className="section-title">Commission history</p>
      <div className="card card--flush">
        {data.entries.length === 0 ? (
          <p className="empty">No commission recorded yet.</p>
        ) : (
          <ul className="list">
            {data.entries.map((entry) => (
              <li key={entry.id} className="list__item">
                <div className="list__body">
                  <p className="list__title">{entry.revenue_item}</p>
                  <p className="list__meta">
                    {entry.transaction_reference} · {(entry.rate_basis_points / 100).toFixed(2)}% of{' '}
                    <Money kobo={entry.basis_amount_kobo} />
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className="list__amount">
                    <Money kobo={entry.amount_kobo} />
                  </span>
                  <div style={{ marginTop: 4 }}>
                    <Badge status={entry.status} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

// ----------------------------------------------------------------- profile

export function ProfileScreen({ onSignOut }: { onSignOut: () => void }) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const device = describeDevice(APP_VERSION);

  useEffect(() => {
    listDrafts().then(setDrafts);
  }, []);

  return (
    <>
      <div className="card">
        <h2 className="card__title">This device</h2>
        <KeyValue
          items={[
            ['Device', device.deviceName],
            ['App version', APP_VERSION],
            ['Device ID', device.deviceIdentifier.slice(0, 18) + '…'],
          ]}
        />
        <a className="button secondary" href="#/application">
          View my application and clearance
        </a>
      </div>

      <div className="card">
        <h2 className="card__title">Saved records on this device</h2>
        <p className="card__hint">
          Captures made offline. They are sent to PSIRS automatically when you have a connection.
        </p>
        {drafts.length === 0 ? (
          <p className="empty">Nothing is waiting to be sent.</p>
        ) : (
          <ul className="list">
            {drafts.map((draft) => (
              <li key={draft.clientReference} className="list__item" style={{ paddingLeft: 0, paddingRight: 0 }}>
                <div className="list__body">
                  <p className="list__title">{draft.draftType.replace(/_/g, ' ').toLowerCase()}</p>
                  <p className="list__meta">
                    Captured {new Date(draft.capturedAt).toLocaleString('en-NG')}
                    {draft.message ? ` · ${draft.message}` : ''}
                  </p>
                </div>
                <Badge status={draft.status} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <button type="button" className="danger" onClick={onSignOut}>
        Sign out
      </button>
    </>
  );
}
