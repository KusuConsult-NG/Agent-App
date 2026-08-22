/** Vehicles, receipts, commission wallet and profile. */

import { useCallback, useEffect, useState } from 'react';
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
import { TaxpayerPicker, type PickedTaxpayer } from '../components/TaxpayerPicker';

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
  const [taxpayer, setTaxpayer] = useState<PickedTaxpayer | null>(null);
  const taxpayerId = taxpayer?.id ?? '';
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

              <TaxpayerPicker
                chosen={taxpayer}
                onChoose={setTaxpayer}
                onClear={() => setTaxpayer(null)}
              />

              <button type="button" disabled={busy || !revenueItemId || !taxpayerId} onClick={renew}>
                {busy ? <Spinner /> : null}
                Calculate and proceed to payment
              </button>
              {(!revenueItemId || !taxpayerId) && (
                <p className="card__hint" role="status" style={{ marginBottom: 0 }}>
                  {!revenueItemId
                    ? 'Choose which renewal is being paid for.'
                    : 'Find the taxpayer paying for this renewal. Every payment must be attributed to somebody.'}
                </p>
              )}
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
        <h2 className="card__title">Where your commission is paid</h2>
        <p className="card__hint">
          Change the bank account PSIRS pays your commission into. It takes a one-time code, the
          bank's confirmation and an officer's approval, so your existing account keeps being
          used until all three are done.
        </p>
        <a className="button secondary" href="#/bank">
          Change my bank account
        </a>
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

// ---------------------------------------------------------------------------

interface BankChange {
  approvalId: string;
  bankName: string;
  accountNumberMasked: string;
  accountName: string;
  verificationStatus: string;
  verificationResolvedName: string | null;
  verificationReason: string | null;
  requestedReason: string;
  requestedAt: string;
  current: { bankName: string; accountNumberMasked: string; accountName: string } | null;
}

/**
 * Changing where commission is paid.
 *
 * The account was captured once, on the application, and there was no way to
 * move it afterwards — so an agent whose account was closed could not be paid
 * at all. What makes self-service safe here is not who may ask but what has to
 * be true before anything moves: a one-time code with the request, the bank's
 * own confirmation of the new account, and an officer's approval. The screen
 * says all three, because an agent who does not know a change is still
 * pending will assume it has taken effect and wonder where their money went.
 */
export function BankAccountScreen({ navigate }: { navigate: (path: string) => void }) {
  const [pending, setPending] = useState<BankChange | null | undefined>(undefined);
  const [form, setForm] = useState({
    bankName: '',
    bankCode: '',
    accountName: '',
    accountNumber: '',
    reason: '',
  });
  const [authorising, setAuthorising] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<{ change: BankChange | null }>('/agents/me/bank/change')
      .then((data) => setPending(data.change))
      .catch((caught) => {
        setPending(null);
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
  }, []);

  useEffect(load, [load]);

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((previous) => ({ ...previous, [key]: event.target.value }));

  /** What the form is still waiting for, in words rather than a dead button. */
  const blockedBecause = ((): string | null => {
    if (form.bankName.trim().length < 2) return 'Choose the bank the new account is with.';
    if (!/^\d{3,6}$/.test(form.bankCode.trim())) {
      return 'Enter the bank code. It is the 3 to 6 digit number the bank uses, not your account number.';
    }
    if (form.accountName.trim().length < 2) {
      return 'Enter the name the account is held in, exactly as the bank has it.';
    }
    if (!/^\d{10}$/.test(form.accountNumber.trim())) {
      return 'A Nigerian account number is 10 digits.';
    }
    if (form.reason.trim().length < 10) {
      return 'Say why the account is changing, in at least 10 characters.';
    }
    return null;
  })();

  async function submit() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.post('/agents/me/bank/change', {
        bankName: form.bankName.trim(),
        bankCode: form.bankCode.trim(),
        accountName: form.accountName.trim(),
        accountNumber: form.accountNumber.trim(),
        reason: form.reason.trim(),
      });
      setMessage(
        'Sent to PSIRS. Your commission still goes to your existing account until an officer approves the change.',
      );
      setForm({ bankName: '', bankCode: '', accountName: '', accountNumber: '', reason: '' });
      load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
      else if (caught instanceof Error) {
        setError({ code: 'CLIENT', message: caught.message, moneyStatus: 'NOT_APPLICABLE' });
      }
    } finally {
      setBusy(false);
      setAuthorising(false);
    }
  }

  if (pending === undefined) return <Loading rows={3} />;

  if (authorising) {
    return (
      <StepUpPrompt
        action="agent.bank_account.change"
        title="Authorise this change"
        confirmLabel="Send to PSIRS"
        description={
          <>
            <p style={{ margin: '0 0 4px' }}>
              You are asking PSIRS to pay your commission into {form.bankName}{' '}
              {form.accountNumber.slice(-4).padStart(8, '·')}.
            </p>
            <p style={{ margin: 0 }}>
              Nothing changes until an officer approves it.
            </p>
          </>
        }
        onAuthorised={submit}
        onCancel={() => setAuthorising(false)}
      />
    );
  }

  return (
    <>
      <div className="card">
        <h2 className="card__title">Where your commission is paid</h2>
        <p className="card__hint">
          Commission is paid only into an account PSIRS has confirmed with the bank, and only
          after an officer approves the change. Your existing account keeps being used until
          then.
        </p>
      </div>

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      {pending ? (
        <>
          <div className="card">
            <h2 className="card__title">A change is waiting for PSIRS</h2>
            <KeyValue
              items={[
                ['Paid into now', pending.current
                  ? `${pending.current.bankName} ${pending.current.accountNumberMasked}`
                  : '—'],
                ['Would change to', `${pending.bankName} ${pending.accountNumberMasked}`],
                ['Name on the new account', pending.accountName],
                [
                  'Bank check',
                  pending.verificationStatus === 'VERIFIED'
                    ? `Confirmed${pending.verificationResolvedName ? ` as ${pending.verificationResolvedName}` : ''}`
                    : pending.verificationStatus === 'PENDING'
                      ? 'Waiting — the bank could not be reached'
                      : `Not confirmed${pending.verificationReason ? `: ${pending.verificationReason}` : ''}`,
                ],
                ['Reason you gave', pending.requestedReason],
              ]}
            />
          </div>
          {pending.verificationStatus !== 'VERIFIED' && (
            <Alert kind="warning" title="The bank has not confirmed this account">
              <p style={{ margin: 0 }}>
                PSIRS cannot approve a change until the bank confirms the account belongs to you.
                If the details are wrong, ask your supervisor to refuse this request so you can
                send the right ones.
              </p>
            </Alert>
          )}
          <Alert kind="info" title="You will be told either way">
            <p style={{ margin: 0 }}>
              A message goes to your phone when this is approved or refused. Only one change can
              be waiting at a time.
            </p>
          </Alert>
        </>
      ) : (
        <div className="card">
          <h2 className="card__title">Ask for a different account</h2>
          <Field label="Bank" required>
            <input value={form.bankName} onChange={set('bankName')} />
          </Field>
          <Field label="Bank code" hint="The 3 to 6 digit code the bank uses" required>
            <input inputMode="numeric" value={form.bankCode} onChange={set('bankCode')} />
          </Field>
          <Field label="Name on the account" hint="Exactly as the bank has it" required>
            <input value={form.accountName} onChange={set('accountName')} />
          </Field>
          <Field label="Account number" required>
            <input inputMode="numeric" value={form.accountNumber} onChange={set('accountNumber')} />
          </Field>
          <Field label="Why it is changing" required>
            <textarea value={form.reason} onChange={set('reason')} rows={3} />
          </Field>

          {blockedBecause && (
            <p className="card__hint" role="status" style={{ marginBottom: 0 }}>
              {blockedBecause}
            </p>
          )}

          <div className="button-row">
            <button
              type="button"
              disabled={busy || blockedBecause !== null}
              onClick={() => setAuthorising(true)}
            >
              Continue
            </button>
            <button type="button" className="secondary" onClick={() => navigate('/profile')}>
              Back
            </button>
          </div>
        </div>
      )}
    </>
  );
}
