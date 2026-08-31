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
import { useI18n } from '../lib/i18n';

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
  const { t } = useI18n();
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
        <h2 className="card__title">{t.moreVehicleRenewal}</h2>
        <p className="card__hint">
          {t.moreSearchVehicleFirst}
        </p>
        <Field label={t.moreRegistrationNumber} required>
          <input
            value={registration}
            onChange={(event) => setRegistration(event.target.value.toUpperCase())}
            placeholder="JOS123AB"
            autoCapitalize="characters"
          />
        </Field>
        <button type="button" disabled={busy || registration.trim().length < 4} onClick={find}>
          {busy ? <Spinner /> : null}
          {t.moreSearchVehicle}
        </button>
      </div>

      <ErrorAlert error={error} />

      {capturedOffline && (
        <div className="card">
          <Alert kind="warning" title={t.moreSavedOnPhone}>
            <p style={{ margin: 0 }}>
              {t.moreVehicleSavedBody}
            </p>
          </Alert>
        </div>
      )}

      {offlineCapture && !capturedOffline && (
        <div className="card">
          <h2 className="card__title">{t.moreCaptureOffline}</h2>
          <Alert kind="warning" title={t.moreVehicleAuthorityUnreachable}>
            <p style={{ margin: 0 }}>
              {t.moreVehicleCaptureBody}
            </p>
          </Alert>

          <Field label={t.moreOwnerName} required>
            <input
              value={manual.ownerName}
              onChange={(event) => setManual({ ...manual, ownerName: event.target.value })}
              placeholder={t.moreOwnerNameHint}
            />
          </Field>
          <Field label={t.moreOwnerPhone}>
            <input
              value={manual.ownerPhone}
              onChange={(event) => setManual({ ...manual, ownerPhone: event.target.value })}
              inputMode="tel"
              placeholder="+234…"
            />
          </Field>
          <Field label={t.moreVehicleType} required>
            <select
              value={manual.vehicleType}
              onChange={(event) => setManual({ ...manual, vehicleType: event.target.value })}
            >
              <option value="PRIVATE">{t.morePrivate}</option>
              <option value="COMMERCIAL">{t.moreCommercial}</option>
              <option value="MOTORCYCLE">{t.moreMotorcycle}</option>
              <option value="TRICYCLE">{t.moreTricycle}</option>
            </select>
          </Field>

          <button
            type="button"
            disabled={busy || manual.ownerName.trim().length < 2 || registration.trim().length < 4}
            onClick={captureOffline}
          >
            {busy ? <Spinner /> : null}
            {t.moreSaveVehicleOnPhone}
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
              {t.moreTryVehicleAuthorityAgain}
            </button>
          )}

          {lookup.vehicle && (
            <>
              <KeyValue
                items={[
                  [
                    t.moreRegistrationLabel,
                    lookup.vehicle.registration_number ?? lookup.vehicle.registrationNumber,
                  ],
                  [t.moreOwnerLabel, lookup.vehicle.owner_name ?? lookup.vehicle.ownerName],
                  [
                    t.moreVehicleLabel,
                    [lookup.vehicle.make, lookup.vehicle.model].filter(Boolean).join(' ') || '—',
                  ],
                  [t.moreChassis, lookup.vehicle.chassis_number ?? lookup.vehicle.chassisNumber],
                  [
                    t.moreCurrentExpiry,
                    lookup.vehicle.current_expiry_date ?? lookup.vehicle.currentExpiryDate ?? '—',
                  ],
                  [
                    t.moreAuthorityConfirmed,
                    lookup.authorityConfirmed ? t.tpYes : t.moreEnteredManually,
                  ],
                ]}
              />

              <Field label={t.moreRenewalService} required>
                <select value={revenueItemId} onChange={(event) => setRevenueItemId(event.target.value)}>
                  <option value="">{t.moreSelectRenewalType}</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={t.moreRenewalPeriod} required>
                <select
                  value={months}
                  onChange={(event) => setMonths(Number(event.target.value) as 6 | 12 | 24)}
                >
                  {[6, 12, 24].map((n) => (
                    <option key={n} value={n}>
                      {t.moreMonths.replace('{{n}}', String(n))}
                    </option>
                  ))}
                </select>
              </Field>

              <TaxpayerPicker
                chosen={taxpayer}
                onChoose={setTaxpayer}
                onClear={() => setTaxpayer(null)}
              />

              <button type="button" disabled={busy || !revenueItemId || !taxpayerId} onClick={renew}>
                {busy ? <Spinner /> : null}
                {t.moreCalculateProceed}
              </button>
              {(!revenueItemId || !taxpayerId) && (
                <p className="card__hint" role="status" style={{ marginBottom: 0 }}>
                  {!revenueItemId
                    ? t.moreChooseRenewal
                    : t.moreFindPayingTaxpayer}
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
  const { t } = useI18n();
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
        <h2 className="card__title">{t.moreReceiptsFacilitated}</h2>
        <p className="card__hint">
          {t.moreReceiptsIssuedAfter}
        </p>
      </div>

      <div className="card card--flush">
        {receipts.length === 0 ? (
          <p className="empty">{t.moreNoReceipts}</p>
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
  const { t } = useI18n();
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
        <p className="headline__label">{t.moreAvailableForPayout}</p>
        <p className="headline__amount">
          <Money kobo={data.wallet.eligibleKobo} />
        </p>
        <div className="headline__stats">
          <div>
            <strong>
              <Money kobo={data.wallet.pendingKobo} />
            </strong>
            {t.morePendingWord}
          </div>
          <div>
            <strong>
              <Money kobo={data.wallet.paidKobo} />
            </strong>
            {t.morePaidWord}
          </div>
          <div>
            <strong>{data.wallet.transactionCount}</strong>
            {t.moreTransactionsWord}
          </div>
        </div>
      </section>

      <Alert kind="info" title={t.moreCommissionRecordNotAccount}>
        <p style={{ margin: 0 }}>{data.note}</p>
      </Alert>

      {BigInt(data.wallet.owedBackKobo ?? '0') > 0n && (
        <Alert kind="warning" title={t.moreSomeCommissionOwedBack}>
          <p style={{ margin: 0 }}>
            <Money kobo={data.wallet.owedBackKobo} /> {t.moreOwedBackBody}
          </p>
        </Alert>
      )}

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      {authorising ? (
        <StepUpPrompt
          action="commission.payout.request"
          title={t.moreAuthorisePayout}
          confirmLabel={t.moreConfirmPayout}
          description={
            <>
              <p style={{ margin: '0 0 4px' }}>{t.moreRequestingPayout}<Money kobo={data.wallet.eligibleKobo} />.
              </p>
              {BigInt(data.wallet.owedBackKobo ?? '0') > 0n && (
                <p style={{ margin: 0 }}>
                  <Money kobo={data.wallet.owedBackKobo} /> {t.moreOwedBackDeducted}
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
            {t.moreRequestPayout}
          </button>
          <p className="field__hint" style={{ marginTop: 8 }}>
            {t.moreCommissionAvailableWhen}
          </p>
        </>
      )}

      <p className="section-title">{t.moreCommissionHistory}</p>
      <div className="card card--flush">
        {data.entries.length === 0 ? (
          <p className="empty">{t.moreNoCommission}</p>
        ) : (
          <ul className="list">
            {data.entries.map((entry) => (
              <li key={entry.id} className="list__item">
                <div className="list__body">
                  <p className="list__title">{entry.revenue_item}</p>
                  <p className="list__meta">
                    {entry.transaction_reference} ·{' '}
                    {t.moreCommissionRateOf.replace(
                      '{{rate}}',
                      (entry.rate_basis_points / 100).toFixed(2),
                    )}{' '}
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
  const { t } = useI18n();
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
      setPrinterMsg(t.morePrinterConnected);
    } catch (err: any) {
      setPrinterMsg(err.message || t.morePrinterConnectFailed);
    } finally {
      setPrinterBusy(false);
    }
  }

  async function testPrint() {
    setPrinterBusy(true);
    setPrinterMsg(null);
    try {
      await bluetoothPrinter.printTestSlip();
      setPrinterMsg(t.morePrinterTestSent);
    } catch (err: any) {
      setPrinterMsg(err.message || t.morePrinterPrintFailed);
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
        setPushMsg(t.morePushDisabled);
      } else {
        const ok = await pushManager.subscribe();
        setPushStatus(ok ? 'granted' : 'denied');
        setPushMsg(ok ? t.morePushActive : t.morePushNotGranted);
      }
    } catch (err: any) {
      setPushMsg(err.message || t.morePushFailed);
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <>
      <div className="card">
        <h2 className="card__title">{t.moreThisDevice}</h2>
        <KeyValue
          items={[
            [t.appDeviceLabel, device.deviceName],
            [t.appAppVersion, APP_VERSION],
            [t.moreDeviceId, device.deviceIdentifier.slice(0, 18) + '…'],
          ]}
        />
        <a className="button secondary" href="#/application">{t.moreViewApplication}</a>
      </div>

      <div className="card">
        <h2 className="card__title">{t.morePrinter}</h2>
        <p className="card__hint">
          {t.morePrinterHint}
        </p>
        <KeyValue
          items={[
            [t.appStatus, <Badge status={printerState.status} />],
            [t.moreConnectedDevice, printerState.name || t.moreNone],
            [t.morePaperWidth, printerState.paperWidth],
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
            <option value="58mm">{t.morePaper58}</option>
            <option value="80mm">{t.morePaper80}</option>
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
                {printerBusy ? <Spinner /> : t.morePrintTestSlip}
              </button>
              <button
                type="button"
                className="secondary"
                style={{ width: 'auto' }}
                onClick={() => bluetoothPrinter.disconnect()}
              >{t.moreDisconnect}</button>
            </>
          ) : (
            <button
              type="button"
              className="secondary"
              style={{ width: 'auto' }}
              disabled={printerBusy || !bluetoothPrinter.isSupported()}
              onClick={connectPrinter}
            >
              {printerBusy ? <Spinner /> : t.morePairPrinter}
            </button>
          )}
        </div>
        {!bluetoothPrinter.isSupported() && (
          <p className="field__hint" style={{ marginTop: '8px', color: 'var(--danger)' }}>
            {t.moreNoWebBluetooth}
          </p>
        )}
      </div>

      <div className="card">
        <h2 className="card__title">{t.morePushTitle}</h2>
        <p className="card__hint">
          {t.morePushHint}
        </p>
        <KeyValue
          items={[
            [t.morePermission, <Badge status={pushStatus === 'granted' ? 'ACTIVE' : 'DISABLED'} />],
            [t.morePushEngine, pushManager.isSupported() ? t.moreSupported : t.moreUnavailable],
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
        <h2 className="card__title">{t.moreWhereCommissionPaid}</h2>
        <p className="card__hint">
          {t.moreChangeBankHint}
        </p>
        <a className="button secondary" href="#/bank">{t.moreChangeBankAccount}</a>
      </div>

      <div className="card">
        <h2 className="card__title">{t.moreSomethingWrong}</h2>
        <p className="card__hint">
          {t.moreSupportHint}
        </p>
        <a className="button secondary" href="#/support">{t.moreGetHelp}</a>
      </div>

      <div className="card">
        <h2 className="card__title">{t.moreSavedRecords}</h2>
        <p className="card__hint">
          {t.moreSavedRecordsHint}
        </p>
        {drafts.length === 0 ? (
          <p className="empty">{t.moreNothingWaiting}</p>
        ) : (
          <ul className="list">
            {drafts.map((draft) => (
              <li key={draft.clientReference} className="list__item" style={{ paddingLeft: 0, paddingRight: 0 }}>
                <div className="list__body">
                  <p className="list__title">{draft.draftType.replace(/_/g, ' ').toLowerCase()}</p>
                  <p className="list__meta">
                    {t.moreDraftCaptured.replace(
                      '{{when}}',
                      new Date(draft.capturedAt).toLocaleString('en-NG'),
                    )}
                    {draft.message ? ` · ${draft.message}` : ''}
                  </p>
                </div>
                <Badge status={draft.status} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <button type="button" className="danger" onClick={onSignOut}>{t.moreSignOut}</button>
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
  const { t } = useI18n();
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
    if (form.bankName.trim().length < 2) return t.moreNeedBankName;
    if (!/^\d{3,6}$/.test(form.bankCode.trim())) {
      return t.moreNeedBankCode;
    }
    if (form.accountName.trim().length < 2) {
      return t.moreNeedAccountName;
    }
    if (!/^\d{10}$/.test(form.accountNumber.trim())) {
      return t.moreNeedAccountNumber;
    }
    if (form.reason.trim().length < 10) {
      return t.moreNeedReason;
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
        title={t.moreAuthoriseChange}
        confirmLabel={t.supSendToPsirs}
        description={
          <>
            <p style={{ margin: '0 0 4px' }}>
              {t.moreBankChangeAsking.replace(
                '{{destination}}',
                `${form.bankName} ${form.accountNumber.slice(-4).padStart(8, '·')}`,
              )}
            </p>
            <p style={{ margin: 0 }}>{t.moreNothingChangesYet}</p>
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
        <h2 className="card__title">{t.moreWhereCommissionPaid}</h2>
        <p className="card__hint">
          {t.moreCommissionOnlyVerified}
        </p>
      </div>

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      {pending ? (
        <>
          <div className="card">
            <h2 className="card__title">{t.moreChangeWaiting}</h2>
            <KeyValue
              items={[
                [
                  t.morePaidIntoNow,
                  pending.current
                    ? `${pending.current.bankName} ${pending.current.accountNumberMasked}`
                    : '—',
                ],
                [t.moreWouldChangeTo, `${pending.bankName} ${pending.accountNumberMasked}`],
                [t.moreNameOnNewAccount, pending.accountName],
                [
                  t.moreBankCheck,
                  pending.verificationStatus === 'VERIFIED'
                    ? pending.verificationResolvedName
                      ? t.moreBankCheckConfirmedAs.replace(
                          '{{name}}',
                          pending.verificationResolvedName,
                        )
                      : t.moreBankCheckConfirmed
                    : pending.verificationStatus === 'PENDING'
                      ? t.moreBankCheckWaiting
                      : pending.verificationReason
                        ? t.moreBankCheckNotConfirmedBecause.replace(
                            '{{reason}}',
                            pending.verificationReason,
                          )
                        : t.moreBankCheckNotConfirmed,
                ],
                [t.moreReasonYouGave, pending.requestedReason],
              ]}
            />
          </div>
          {pending.verificationStatus !== 'VERIFIED' && (
            <Alert kind="warning" title={t.moreBankNotConfirmed}>
              <p style={{ margin: 0 }}>
                {t.moreBankMustConfirm}
              </p>
            </Alert>
          )}
          <Alert kind="info" title={t.moreToldEitherWay}>
            <p style={{ margin: 0 }}>
              {t.moreToldEitherWayBody}
            </p>
          </Alert>
        </>
      ) : (
        <div className="card">
          <h2 className="card__title">{t.moreAskDifferentAccount}</h2>
          <Field label={t.moreBankLabel} required>
            <input value={form.bankName} onChange={set('bankName')} />
          </Field>
          <Field label={t.moreBankCode} hint={t.moreBankCodeHint} required>
            <input inputMode="numeric" value={form.bankCode} onChange={set('bankCode')} />
          </Field>
          <Field label={t.moreAccountName} hint={t.moreAccountNameHint} required>
            <input value={form.accountName} onChange={set('accountName')} />
          </Field>
          <Field label={t.moreAccountNumber} required>
            <input inputMode="numeric" value={form.accountNumber} onChange={set('accountNumber')} />
          </Field>
          <Field label={t.moreWhyChanging} required>
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
            >{t.moreContinue}</button>
            <button type="button" className="secondary" onClick={() => navigate('/profile')}>
              {t.moreBack}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
