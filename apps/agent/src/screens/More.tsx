/** Vehicles, receipts, commission wallet and profile. */

import { useEffect, useState } from 'react';
import {
  ApiRequestError,
  APP_VERSION,
  api,
  isConnectivityFailure,
  newIdempotencyKey,
  type ApiError,
} from '../lib/api';
import { describeDevice } from '../lib/device';
import { listDrafts, submitOrQueue, type Draft } from '../lib/drafts';
import { bluetoothPrinter } from '../lib/bluetooth-printer';
import { pushManager } from '../lib/push';
import { Alert, Badge, ErrorAlert, Field, KeyValue, Loading, Money, Spinner } from '../ui';
import { StepUpPrompt } from '../components/StepUp';

// ---------------------------------------------------------------- vehicles

interface VehicleLookup {
  /**
   * `REGISTRY_UNAVAILABLE` is not `NOT_FOUND`. The first means the authority
   * could not be asked; the second means it answered and holds no record. An
   * agent shown the wrong one of these captures a registered vehicle as
   * unregistered, so the screen keeps them apart.
   */
  source: 'PLATFORM' | 'AUTHORITY' | 'NOT_FOUND' | 'REGISTRY_UNAVAILABLE';
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
  const [capturedOffline, setCapturedOffline] = useState(false);
  const [offlineCapture, setOfflineCapture] = useState(false);
  const [manual, setManual] = useState({ ownerName: '', vehicleType: 'PRIVATE', ownerPhone: '' });

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
      // Offline, the lookup cannot happen at all — the authority is only
      // reachable from the server. The agent captures what they can see on the
      // vehicle instead, and the authority is consulted when the draft syncs.
      if (isConnectivityFailure(caught)) setOfflineCapture(true);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Capture a vehicle with no connection.
   *
   * This records only what an agent can read off the vehicle and ask its owner.
   * It creates no obligation and takes no money: the renewal, its price and its
   * payment all happen later, online, against a vehicle the authority has by
   * then been asked about.
   */
  async function captureOffline() {
    setBusy(true);
    setError(null);
    try {
      const body = {
        registrationNumber: registration.trim().toUpperCase(),
        vehicleType: manual.vehicleType,
        ownerName: manual.ownerName.trim(),
        ownerPhone: manual.ownerPhone.trim() || undefined,
        taxpayerId: taxpayerId || undefined,
      };
      const outcome = await submitOrQueue(
        'VEHICLE_CAPTURE',
        body,
        () => api.post<{ vehicleId: string }>('/vehicles', body),
        isConnectivityFailure,
      );
      setCapturedOffline(true);
      if (outcome.sent) setOfflineCapture(false);
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

      {capturedOffline && (
        <div className="card">
          <Alert kind="warning" title="Saved on this phone">
            <p style={{ margin: 0 }}>
              This vehicle is stored on your phone and will be sent to PSIRS automatically when you
              are back online. The vehicle authority has not been checked yet, and no renewal or
              payment can be started until it is sent.
            </p>
          </Alert>
        </div>
      )}

      {offlineCapture && !capturedOffline && (
        <div className="card">
          <h2 className="card__title">Capture without a connection</h2>
          <Alert kind="warning" title="The vehicle authority cannot be reached">
            <p style={{ margin: 0 }}>
              Record what you can see on the vehicle. It will be sent — and checked against the
              authority — as soon as you are online. You cannot take a payment for a renewal until
              then.
            </p>
          </Alert>

          <Field label="Owner's name" required>
            <input
              value={manual.ownerName}
              onChange={(event) => setManual({ ...manual, ownerName: event.target.value })}
              placeholder="As written on the papers"
            />
          </Field>
          <Field label="Owner's phone">
            <input
              value={manual.ownerPhone}
              onChange={(event) => setManual({ ...manual, ownerPhone: event.target.value })}
              inputMode="tel"
              placeholder="+234…"
            />
          </Field>
          <Field label="Vehicle type" required>
            <select
              value={manual.vehicleType}
              onChange={(event) => setManual({ ...manual, vehicleType: event.target.value })}
            >
              <option value="PRIVATE">Private</option>
              <option value="COMMERCIAL">Commercial</option>
              <option value="MOTORCYCLE">Motorcycle / Okada</option>
              <option value="TRICYCLE">Tricycle / Keke</option>
            </select>
          </Field>

          <button
            type="button"
            disabled={busy || manual.ownerName.trim().length < 2 || registration.trim().length < 4}
            onClick={captureOffline}
          >
            {busy ? <Spinner /> : null}
            Save vehicle on this phone
          </button>
        </div>
      )}

      {lookup && (
        <div className="card">
          <Alert
            kind={
              lookup.source === 'REGISTRY_UNAVAILABLE'
                ? 'error'
                : lookup.source === 'NOT_FOUND'
                  ? 'warning'
                  : lookup.authorityConfirmed
                    ? 'success'
                    : 'info'
            }
          >
            {lookup.message}
          </Alert>

          {lookup.source === 'REGISTRY_UNAVAILABLE' && (
            <button type="button" disabled={busy} onClick={find}>
              {busy ? <Spinner /> : null}
              Try the vehicle authority again
            </button>
          )}

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
    /** Commission paid on a transaction later reversed, owed back. */
    owedBackKobo: string;
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
  const [authorising, setAuthorising] = useState(false);

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

  /**
   * Spend the grant immediately.
   *
   * A step-up grant authorises one action and the API consumes it on use, so
   * this runs the moment the code is accepted rather than closing the panel
   * and leaving the agent to press the button again — which would spend the
   * grant on a request they had already authorised and make the second press
   * look like a failure.
   */
  async function requestPayout() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.post<{ payoutReference: string; message: string }>(
        '/agents/me/commission/payout',
      );
      setAuthorising(false);
      setMessage(`${result.message} Reference ${result.payoutReference}.`);
      await load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
      setAuthorising(false);
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

      {BigInt(data.wallet.owedBackKobo ?? '0') > 0n && (
        <Alert kind="warning" title="Some commission is owed back">
          <p style={{ margin: 0 }}>
            <Money kobo={data.wallet.owedBackKobo} /> was paid on transactions that were later
            reversed. It is taken off your next payout, so you will receive that much less than the
            amount above.
          </p>
        </Alert>
      )}

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      {authorising ? (
        <StepUpPrompt
          action="commission.payout.request"
          title="Authorise this payout"
          confirmLabel="Confirm payout"
          description={
            <>
              <p style={{ margin: '0 0 4px' }}>
                You are requesting a payout of <Money kobo={data.wallet.eligibleKobo} />.
              </p>
              {BigInt(data.wallet.owedBackKobo ?? '0') > 0n && (
                <p style={{ margin: 0 }}>
                  <Money kobo={data.wallet.owedBackKobo} /> owed back will be deducted.
                </p>
              )}
            </>
          }
          onAuthorised={requestPayout}
          onCancel={() => setAuthorising(false)}
        />
      ) : (
        <>
          <button
            type="button"
            disabled={busy || BigInt(data.wallet.eligibleKobo) === 0n}
            onClick={() => setAuthorising(true)}
          >
            {busy ? <Spinner /> : null}
            Request payout
          </button>
          <p className="field__hint" style={{ marginTop: 8 }}>
            Commission becomes available once the transaction has been settled to the government
            account and the hold period has passed. You will be sent a one-time code to confirm the
            request.
          </p>
        </>
      )}

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
  const [printerState, setPrinterState] = useState(bluetoothPrinter.getState());
  const [printerBusy, setPrinterBusy] = useState(false);
  const [printerMsg, setPrinterMsg] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState(pushManager.getPermission());
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const device = describeDevice(APP_VERSION);

  useEffect(() => {
    listDrafts().then(setDrafts);
    const unsub = bluetoothPrinter.subscribe(setPrinterState);
    return unsub;
  }, []);

  async function connectPrinter() {
    setPrinterBusy(true);
    setPrinterMsg(null);
    try {
      await bluetoothPrinter.connect();
      setPrinterMsg('Connected to Bluetooth printer.');
    } catch (err: any) {
      setPrinterMsg(err.message || 'Connection failed.');
    } finally {
      setPrinterBusy(false);
    }
  }

  async function testPrint() {
    setPrinterBusy(true);
    setPrinterMsg(null);
    try {
      await bluetoothPrinter.printTestSlip();
      setPrinterMsg('Test receipt sent to printer!');
    } catch (err: any) {
      setPrinterMsg(err.message || 'Print failed.');
    } finally {
      setPrinterBusy(false);
    }
  }

  async function togglePush() {
    setPushBusy(true);
    setPushMsg(null);
    try {
      if (pushStatus === 'granted') {
        await pushManager.unsubscribe();
        setPushStatus('default');
        setPushMsg('Push notifications disabled.');
      } else {
        const ok = await pushManager.subscribe();
        setPushStatus(ok ? 'granted' : 'denied');
        setPushMsg(ok ? 'Push notifications active!' : 'Permission was not granted.');
      }
    } catch (err: any) {
      setPushMsg(err.message || 'Could not configure push notifications.');
    } finally {
      setPushBusy(false);
    }
  }

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
        <h2 className="card__title">Field Thermal Printer</h2>
        <p className="card__hint">
          Pair a 58mm or 80mm Bluetooth ESC/POS mobile belt printer to issue instant paper receipts
          to taxpayers in remote field locations.
        </p>
        <KeyValue
          items={[
            ['Status', <Badge status={printerState.status} />],
            ['Connected Device', printerState.name || 'None'],
            ['Paper Width', printerState.paperWidth],
          ]}
        />
        {printerMsg && (
          <p style={{ fontSize: '0.82rem', margin: '8px 0', color: 'var(--green-700)' }}>
            {printerMsg}
          </p>
        )}
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
          <select
            value={printerState.paperWidth}
            onChange={(e) => bluetoothPrinter.setPaperWidth(e.target.value as any)}
            style={{ width: 'auto', padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--line)' }}
          >
            <option value="58mm">58mm (Standard)</option>
            <option value="80mm">80mm (Wide)</option>
          </select>
          {printerState.status === 'connected' ? (
            <>
              <button
                type="button"
                className="secondary"
                style={{ width: 'auto' }}
                disabled={printerBusy}
                onClick={testPrint}
              >
                {printerBusy ? <Spinner /> : 'Print test slip'}
              </button>
              <button
                type="button"
                className="secondary"
                style={{ width: 'auto' }}
                onClick={() => bluetoothPrinter.disconnect()}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              type="button"
              className="secondary"
              style={{ width: 'auto' }}
              disabled={printerBusy || !bluetoothPrinter.isSupported()}
              onClick={connectPrinter}
            >
              {printerBusy ? <Spinner /> : 'Pair Bluetooth Printer'}
            </button>
          )}
        </div>
        {!bluetoothPrinter.isSupported() && (
          <p className="field__hint" style={{ marginTop: '8px', color: 'var(--danger)' }}>
            Web Bluetooth is not supported on this browser (use Chrome on Android or desktop).
          </p>
        )}
      </div>

      <div className="card">
        <h2 className="card__title">Instant Push Notifications</h2>
        <p className="card__hint">
          Receive real-time alerts when your KYC clears, referee responds, or commissions settle.
        </p>
        <KeyValue
          items={[
            ['Permission', <Badge status={pushStatus === 'granted' ? 'ACTIVE' : 'DISABLED'} />],
            ['Push Engine', pushManager.isSupported() ? 'Supported' : 'Unavailable'],
          ]}
        />
        {pushMsg && (
          <p style={{ fontSize: '0.82rem', margin: '8px 0', color: 'var(--green-700)' }}>
            {pushMsg}
          </p>
        )}
        <div style={{ marginTop: '12px' }}>
          <button
            type="button"
            className="secondary"
            style={{ width: 'auto' }}
            disabled={pushBusy || !pushManager.isSupported()}
            onClick={togglePush}
          >
            {pushBusy ? <Spinner /> : pushStatus === 'granted' ? 'Disable Push Notifications' : 'Enable Push Notifications'}
          </button>
        </div>
      </div>

      <div className="card">
        <h2 className="card__title">Something wrong?</h2>
        <p className="card__hint">
          Report a problem to PSIRS — a payment that has not confirmed, a receipt that looks
          wrong, or anything a taxpayer has complained about.
        </p>
        <a className="button secondary" href="#/support">
          Get help
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
