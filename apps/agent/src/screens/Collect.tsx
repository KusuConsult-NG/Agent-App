/**
 * Revenue collection and payment (PRD §14-§19, §58, §60; Addendum §23, §44).
 *
 * The confirmation screen shows the taxpayer, the revenue item, the exact
 * amount and how it was calculated before anything is charged (PRD §15, §58).
 * The agent never types an amount — it comes from the catalogue.
 *
 * After payment, the app asks the server whether the gateway confirmed it. The
 * client never decides that a payment succeeded, and a pending answer is shown
 * as pending, in the language of PRD §60.
 */

import { whereAmI } from '../lib/location';
import { startFlow, track } from '../lib/usage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError, api, newIdempotencyKey, type ApiError } from '../lib/api';
import { verificationUrlFor } from '../lib/verification-url';
import { bluetoothPrinter } from '../lib/bluetooth-printer';
import type { ConnectionState } from '../lib/device';
import { queryParams, useRoute } from '../router';
import { useI18n } from '../lib/i18n';
import { Alert, Badge, ErrorAlert, Field, KeyValue, Loading, Money, Spinner } from '../ui';

interface RevenueItem {
  id: string;
  code: string;
  name: string;
  category_name: string;
  rate_type: string | null;
  frequency: string;
  self_assessable: boolean;
}

interface Quote {
  revenueItemName: string;
  categoryName: string;
  amountKobo: string;
  serviceChargeKobo: string;
  totalKobo: string;
  trace: { step: string; detail: string; amount?: string }[];
}

interface TaxpayerSummary {
  id: string;
  taxpayer_type: string;
  tin: string | null;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  phone: string;
  lga_name: string;
}

function taxpayerName(taxpayer: TaxpayerSummary): string {
  return taxpayer.business_name ?? `${taxpayer.first_name ?? ''} ${taxpayer.last_name ?? ''}`.trim();
}

export function CollectScreen({
  navigate,
  connection,
}: {
  navigate: (path: string) => void;
  connection: ConnectionState;
}) {
  const { t } = useI18n();
  const [route] = useRoute();
  const initialTaxpayerId = queryParams(route).get('taxpayerId');

  const [taxpayer, setTaxpayer] = useState<TaxpayerSummary | null>(null);
  const [search, setSearch] = useState('');
  // `null` until a search has actually been run, so that "nothing found" can
  // be told apart from "nothing searched for yet". Starting at `[]` collapses
  // the two, and the screen then has no way to say the taxpayer is not
  // registered — which is the answer the agent most needs to hear.
  const [results, setResults] = useState<TaxpayerSummary[] | null>(null);
  const [items, setItems] = useState<RevenueItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<RevenueItem | null>(null);
  const [baseAmount, setBaseAmount] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);

  /*
   * Follow one collection, start to receipt.
   *
   * The money path is measured by transactions already; what is not is how
   * long the interface takes and where an agent gives up. A trader waiting at
   * a stall is the constraint this platform actually operates under, and
   * nothing recorded it.
   */
  const flow = useRef<ReturnType<typeof startFlow> | null>(null);
  if (flow.current === null) flow.current = startFlow('collection', 'find-taxpayer');

  useEffect(
    () => () => {
      flow.current?.abandon();
    },
    [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!initialTaxpayerId) return;
    api
      .get<{ taxpayer: TaxpayerSummary }>(`/taxpayers/${initialTaxpayerId}`)
      .then((profile) => setTaxpayer(profile.taxpayer))
      .catch(() => undefined);
  }, [initialTaxpayerId]);

  useEffect(() => {
    if (!taxpayer) return;
    api
      .get<RevenueItem[]>(`/revenue/items?taxpayerType=${taxpayer.taxpayer_type}`)
      .then(setItems)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
  }, [taxpayer]);

  const needsBaseAmount =
    selectedItem?.rate_type === 'PERCENTAGE' || selectedItem?.rate_type === 'TIERED';

  const getQuote = useCallback(async () => {
    // The taxpayer as well as the item: eleven revenue items now carry a rate
    // per Local Government Area, and the server resolves which from the
    // taxpayer. Quoting without them would resolve the statewide default —
    // which those items no longer have — so the guard is a real one, not a
    // formality for the type checker.
    if (!selectedItem || !taxpayer) return;
    setBusy(true);
    setError(null);
    try {
      const inputs: Record<string, string> = {};
      if (needsBaseAmount) {
        // Entered in naira for the agent's convenience; converted to kobo here
        // so no decimal ever reaches the financial path.
        const naira = Number.parseFloat(baseAmount.replace(/,/g, ''));
        if (!Number.isFinite(naira) || naira <= 0) {
          setError({
            code: 'INVALID_INPUT',
            message: 'Enter the amount the assessment is based on, in naira.',
            moneyStatus: 'NOT_APPLICABLE',
          });
          setBusy(false);
          return;
        }
        inputs.baseAmountKobo = String(Math.round(naira * 100));
      }
      setQuote(await api.post<Quote>('/revenue/quote', { revenueItemId: selectedItem.id, inputs, taxpayerId: taxpayer.id }));
      flow.current?.step('amount-calculated');
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(false);
    }
  }, [selectedItem, taxpayer, needsBaseAmount, baseAmount]);

  async function createAndPay() {
    if (!taxpayer || !selectedItem) return;
    setBusy(true);
    setError(null);
    try {
      const inputs: Record<string, string> = {};
      if (needsBaseAmount) {
        inputs.baseAmountKobo = String(Math.round(Number.parseFloat(baseAmount.replace(/,/g, '')) * 100));
      }

      /*
       * Where this is being collected.
       *
       * Asked for at the moment of collection and nowhere else — this is a
       * map of where the state's revenue comes from, not a track of where
       * the agent goes. `whereAmI` never rejects and gives up after a few
       * seconds, because a trader is waiting and a collection must not fail
       * for want of a satellite.
       */
      const point = await whereAmI();

      const assessment = await api.post<{ transactionId: string; transactionReference: string }>(
        '/revenue/assessments',
        {
          taxpayerId: taxpayer.id,
          revenueItemId: selectedItem.id,
          inputs,
          ...(point ? { latitude: point.latitude, longitude: point.longitude } : {}),
        },
        newIdempotencyKey('assessment'),
      );

      await api.post<{ authorisationUrl: string }>(
        '/payments/initiate',
        { transactionId: assessment.transactionId },
        newIdempotencyKey('payment'),
      );

      // Handed off to payment. Completed here rather than at the receipt,
      // because what this measures is the part of the collection the agent
      // drives — after this the taxpayer's bank has it.
      flow.current?.complete('payment-initiated');
      navigate(`/transactions/${assessment.transactionReference}`);
    } catch (caught) {
      if (caught instanceof ApiRequestError) {
        setError(caught.error);
        // A nil liability is not a failed collection — it is the correct
        // answer, and counting it as failure would make the exempt look like
        // a bug in the funnel.
        if (caught.error.code === 'NO_TAX_PAYABLE') flow.current?.complete('no-tax-payable');
        else flow.current?.fail(`refused-${caught.error.code}`);
      }
    } finally {
      setBusy(false);
    }
  }

  if (connection === 'OFFLINE') {
    return (
      <Alert kind="error" title="You are offline">
        <p style={{ margin: 0 }}>
          Revenue cannot be collected without a connection. Government payments must be confirmed by
          the payment system before a receipt can be issued — nothing can be marked as paid on this
          device.
        </p>
      </Alert>
    );
  }

  if (!taxpayer) {
    return (
      <>
        <div className="card">
          <h2 className="card__title">Who is paying?</h2>
          <p className="card__hint">{t.findTaxpayerFirst}</p>
          <Field label="Search taxpayer">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, phone or TIN"
            />
          </Field>
          <button
            type="button"
            disabled={busy || search.trim().length < 2}
            onClick={async () => {
              setBusy(true);
              try {
                setResults(
                  await api.get<TaxpayerSummary[]>(
                    `/taxpayers/search?q=${encodeURIComponent(search.trim())}`,
                  ),
                );
              } catch (caught) {
                if (caught instanceof ApiRequestError) setError(caught.error);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Spinner /> : null}
            Search
          </button>
        </div>

        <ErrorAlert error={error} />

        {results && results.length === 0 && (
          <div className="card card--flush">
            <p className="empty">
              {t.noTaxpayerMatch} {t.searchAnotherArea}
            </p>
          </div>
        )}

        {results && results.length > 0 && (
          <div className="card card--flush">
            <ul className="list">
              {results.map((result) => (
                <li key={result.id}>
                  <button type="button" className="list__item" onClick={() => setTaxpayer(result)}>
                    <div className="list__body">
                      <p className="list__title">{taxpayerName(result)}</p>
                      <p className="list__meta">
                        {result.tin ? `TIN ${result.tin}` : 'No TIN'} · {result.phone}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <button type="button" className="secondary" onClick={() => navigate('/taxpayers/new')}>
          Register a new taxpayer
        </button>
      </>
    );
  }

  return (
    <>
      <div className="card">
        <h2 className="card__title">{taxpayerName(taxpayer)}</h2>
        <p className="card__hint">
          {taxpayer.tin ? `TIN ${taxpayer.tin}` : 'No TIN yet'} · {taxpayer.phone} · {taxpayer.lga_name}
        </p>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            setTaxpayer(null);
            setSelectedItem(null);
            setQuote(null);
          }}
        >
          Change taxpayer
        </button>
      </div>

      <ErrorAlert error={error} />

      {!quote && (
        <div className="card">
          <h2 className="card__title">What are they paying?</h2>
          <Field label="Revenue item" required>
            <select
              value={selectedItem?.id ?? ''}
              onChange={(event) => {
                setSelectedItem(items.find((item) => item.id === event.target.value) ?? null);
                setQuote(null);
              }}
            >
              <option value="">Select a revenue item</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.category_name} — {item.name}
                </option>
              ))}
            </select>
          </Field>

          {needsBaseAmount && (
            <Field
              label="Amount the charge is calculated on (₦)"
              hint="For example turnover, income or contract value. The charge itself is set by government."
              required
            >
              <input
                inputMode="decimal"
                value={baseAmount}
                onChange={(event) => setBaseAmount(event.target.value)}
                placeholder="0.00"
              />
            </Field>
          )}

          <button type="button" disabled={busy || !selectedItem} onClick={getQuote}>
            {busy ? <Spinner /> : null}
            Calculate amount
          </button>
        </div>
      )}

      {quote && (
        <>
          {/*
            * Zero is an answer, not a collection.
            *
            * Under the Fourth Schedule to the Nigeria Tax Act, 2025 the first
            * ₦800,000 of annual income is exempt, so a nil liability is the
            * ordinary result for a grassroots trader rather than a rare one.
            * This screen used to announce it as "You are about to collect
            * ₦0.00" and offer the payment button anyway; the API then refused
            * the assessment, and at no point did anyone say the trader was
            * exempt.
            *
            * The agent is paid commission on what they collect, and the only
            * lever on this screen is the income figure they typed. A flow
            * that dead-ends at a refusal points them straight back at it.
            */}
          {BigInt(quote.totalKobo) === 0n ? (
            <Alert kind="info" title={t.noTaxPayable}>
              <p style={{ margin: 0 }}>{t.noTaxPayableBody}</p>
            </Alert>
          ) : (
            <div className="amount-confirm">
              <p className="amount-confirm__label">You are about to collect</p>
              <p className="amount-confirm__value">
                <Money kobo={quote.totalKobo} />
              </p>
              <p className="amount-confirm__label">{quote.revenueItemName}</p>
            </div>
          )}

          <div className="card">
            <KeyValue
              items={[
                ['Taxpayer', taxpayerName(taxpayer)],
                ['TIN', taxpayer.tin ?? 'Not yet assigned'],
                ['Revenue', `${quote.categoryName} — ${quote.revenueItemName}`],
                ['Government revenue', <Money key="a" kobo={quote.amountKobo} />],
                ...(BigInt(quote.serviceChargeKobo) > 0n
                  ? ([['Approved service charge', <Money key="s" kobo={quote.serviceChargeKobo} />]] as [
                      string,
                      React.ReactNode,
                    ][])
                  : []),
                ['Total payable', <Money key="t" kobo={quote.totalKobo} />],
              ]}
            />
          </div>

          <div className="card">
            <h2 className="card__title">How this amount was calculated</h2>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.82rem', color: 'var(--muted)' }}>
              {quote.trace.map((step, index) => (
                <li key={index} style={{ marginBottom: 4 }}>
                  <strong style={{ color: 'var(--ink)' }}>{step.step}:</strong> {step.detail}
                </li>
              ))}
            </ul>
          </div>

          {/* The working stays on screen either way: an agent who cannot
            * explain why the trader owes nothing is left saying the phone
            * refused, which is how a lawful exemption turns into an argument. */}
          {BigInt(quote.totalKobo) === 0n ? (
            <div className="button-row">
              <button type="button" className="secondary" onClick={() => setQuote(null)}>
                Change
              </button>
            </div>
          ) : (
            <>
              <Alert kind="warning" title={t.neverCollectCash}>
                <p style={{ margin: 0 }}>{t.cashChannelReminder}</p>
              </Alert>

              <div className="button-row">
                <button type="button" className="secondary" onClick={() => setQuote(null)}>
                  Change
                </button>
                <button type="button" disabled={busy} onClick={createAndPay}>
                  {busy ? <Spinner /> : null}
                  Confirm and proceed to payment
                </button>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Transaction status and payment confirmation
// ---------------------------------------------------------------------------

interface TransactionStatus {
  transaction: {
    id: string;
    transaction_reference: string;
    status: string;
    amount_kobo: string;
    total_amount_kobo: string;
    invoice_id: string;
    invoice_number: string;
    expires_at: string | null;
    revenue_item: string;
    revenue_category: string;
    first_name: string | null;
    last_name: string | null;
    business_name: string | null;
    tin: string | null;
    payment_id: string | null;
    payment_status: string | null;
    payment_reference: string | null;
    gateway_reference: string | null;
    failure_reason: string | null;
    receipt_id: string | null;
    receipt_number: string | null;
    receipt_code: string | null;
    document_id: string | null;
    acknowledgement_id: string | null;
    acknowledgement_number: string | null;
    acknowledgement_code: string | null;
  };
  events: { to_status: string; reason: string | null; created_at: string }[];
}

/**
 * Transaction detail.
 *
 * This screen is the answer to Addendum §44: whatever happened to the browser,
 * the agent can reopen the app and read the authoritative state from the
 * server, including the receipt if one was issued.
 */
export function TransactionScreen({
  reference,
  navigate,
}: {
  reference: string;
  navigate: (path: string) => void;
}) {
  const { t } = useI18n();
  const [data, setData] = useState<TransactionStatus | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [invoicing, setInvoicing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<TransactionStatus>(`/payments/transactions/${reference}/status`));
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setLoading(false);
    }
  }, [reference]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Render the invoice and open it.
   *
   * The endpoint is idempotent — a second call returns the document already
   * issued rather than minting another — so an agent who taps twice, or comes
   * back to a transaction tomorrow, gets the same invoice number rather than a
   * second document for one obligation.
   */
  async function giveInvoice() {
    setInvoicing(true);
    setError(null);
    try {
      const document = await api.post<{ downloadUrl: string; documentNumber: string }>(
        `/revenue/invoices/${transaction.invoice_id}/document`,
      );
      window.open(document.downloadUrl, '_blank', 'noopener');
      setNotice(`Invoice ${document.documentNumber} is ready to print or send.`);
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setInvoicing(false);
    }
  }

  async function confirmPayment() {
    if (!data?.transaction.payment_id) return;
    setConfirming(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.post<{ status: string; message: string; receiptNumber?: string }>(
        `/payments/${data.transaction.payment_id}/confirm`,
      );
      setNotice(result.message);
      await load();
    } catch (caught) {
      // A pending gateway answer arrives here as PAYMENT_UNCONFIRMED, and the
      // wording tells the agent explicitly not to collect again.
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setConfirming(false);
    }
  }

  /** Development helper: drive the mock gateway so the flow can be demonstrated. */
  async function simulate(outcome: 'SUCCESS' | 'FAILED') {
    if (!data?.transaction.gateway_reference) return;
    setConfirming(true);
    try {
      await api.post('/payments/simulate', {
        gatewayReference: data.transaction.gateway_reference,
        outcome,
        deliverWebhook: true,
      });
      await load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setConfirming(false);
    }
  }

  if (loading) return <Loading rows={5} />;
  if (error && !data) return <ErrorAlert error={error} />;
  if (!data) return null;

  const transaction = data.transaction;
  const paid = transaction.receipt_number !== null;
  /*
   * The middle state, and the one an agent standing at a stall most needs.
   *
   * The gateway has confirmed the payment; government has not yet received the
   * money, so there is no receipt. Reading that as "not yet confirmed" would
   * tell the agent the payment had not gone through and invite them to collect
   * a second time from someone who has already paid.
   */
  const acknowledged = !paid && transaction.acknowledgement_number !== null;
  const failed = ['FAILED', 'CANCELLED', 'EXPIRED'].includes(transaction.status);
  const name =
    transaction.business_name ??
    `${transaction.first_name ?? ''} ${transaction.last_name ?? ''}`.trim();

  return (
    <>
      {paid ? (
        <div className="amount-confirm">
          <p className="amount-confirm__label">{t.paymentSuccess}</p>
          <p className="amount-confirm__value">
            <Money kobo={transaction.amount_kobo} />
          </p>
          <p className="amount-confirm__label">Receipt {transaction.receipt_number}</p>
        </div>
      ) : acknowledged ? (
        <Alert kind="info" title={t.paymentAcknowledged}>
          <p style={{ margin: 0 }}>{t.paymentAcknowledgedBody}</p>
          <p style={{ margin: '0.5rem 0 0' }}>
            <strong>
              {t.acknowledgementLabel} {transaction.acknowledgement_number}
            </strong>
          </p>
        </Alert>
      ) : failed ? (
        <Alert kind="error" title={t.paymentFailed}>
          <p style={{ margin: 0 }}>
            {transaction.failure_reason ? `${transaction.failure_reason} ` : ''}
            {t.paymentFailedBody}
          </p>
        </Alert>
      ) : (
        <Alert kind="warning" title={t.paymentUnconfirmed}>
          <p style={{ margin: 0 }}>{t.paymentUnconfirmedBody}</p>
        </Alert>
      )}

      <ErrorAlert error={error} />
      {notice && !error && <Alert kind="success">{notice}</Alert>}

      <div className="card">
        <KeyValue
          items={[
            ['Taxpayer', name],
            ['TIN', transaction.tin ?? 'Not yet assigned'],
            ['Revenue', `${transaction.revenue_category} — ${transaction.revenue_item}`],
            ['Amount', <Money key="a" kobo={transaction.total_amount_kobo} />],
            ['Invoice', transaction.invoice_number],
            ['Transaction', transaction.transaction_reference],
            ['Status', <Badge key="s" status={transaction.status} />],
            ['Payment status', transaction.payment_status ? <Badge key="p" status={transaction.payment_status} /> : '—'],
            ['Gateway reference', transaction.gateway_reference ?? '—'],
          ]}
        />
      </div>

      {paid && transaction.document_id && (
        <div className="button-row" style={{ flexWrap: 'wrap', gap: '8px' }}>
          <a
            className="button"
            href={`/api/v1/receipts/${transaction.receipt_id}`}
            onClick={async (event) => {
              event.preventDefault();
              const receipt = await api.get<{ downloadUrl: string }>(
                `/receipts/${transaction.receipt_id}`,
              );
              window.open(receipt.downloadUrl, '_blank', 'noopener');
            }}
          >
            Download receipt
          </a>
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              try {
                setNotice('Transmitting receipt to Bluetooth printer...');
                await bluetoothPrinter.printReceipt({
                  receiptNumber: transaction.receipt_number!,
                  paymentReference: transaction.transaction_reference,
                  taxpayerName: name,
                  taxpayerTin: transaction.tin,
                  taxpayerPhone: null,
                  revenueItemName: transaction.revenue_item,
                  revenueCategoryName: transaction.revenue_category,
                  amountKobo: transaction.total_amount_kobo,
                  paymentMethod: transaction.payment_status || 'POS / Online',
                  channel: 'FIELD_AGENT',
                  lgaName: 'Plateau State',
                  wardName: null,
                  agentName: 'Authorized Field Officer',
                  agentCode: 'AGT',
                  issuedAt: new Date().toISOString(),
                  /*
                   * Omitted rather than guessed. This is printed on paper and
                   * handed over; a link to a machine no citizen can reach looks
                   * official and goes nowhere, which is worse than no link at
                   * all beside a code they can type in anywhere.
                   */
                  verificationUrl: verificationUrlFor(transaction.receipt_code) ?? undefined,
                  verificationCode: transaction.receipt_code ?? undefined,
                });
                setNotice('Receipt printed successfully on Bluetooth printer!');
              } catch (err: any) {
                setError({
                  code: 'PRINT_FAILED',
                  message: `Bluetooth printing failed: ${err.message || 'Check printer connection'}`,
                  moneyStatus: 'NOT_APPLICABLE',
                });
              }
            }}
          >
            Print (Bluetooth)
          </button>
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              const text =
                `PSIRS receipt ${transaction.receipt_number} for ${name}. ` +
                `Verify with code ${transaction.receipt_code}.`;
              if (navigator.share) {
                await navigator.share({ title: 'PSIRS receipt', text }).catch(() => undefined);
              } else {
                await navigator.clipboard.writeText(text).catch(() => undefined);
                setNotice('Receipt details copied. You can paste them into a message.');
              }
            }}
          >
            Share receipt
          </button>
        </div>
      )}

      {!paid && !failed && (
        <>
          {/*
            The artefact a taxpayer pays against later.
 
            Remita's model is that the reference is payable at any bank branch,
            ATM, POS or USSD channel, possibly days afterwards. The endpoint
            that renders that invoice as a PDF existed and nothing called it,
            so an agent whose taxpayer said "I will pay at the bank tomorrow"
            read a reference aloud and hoped they wrote it down correctly.
          */}
          <button type="button" className="secondary" disabled={invoicing} onClick={giveInvoice}>
            {invoicing ? <Spinner /> : null}
            {invoicing ? 'Preparing the invoice…' : 'Give the taxpayer an invoice'}
          </button>
          <p className="field__hint" style={{ marginTop: 8 }}>
            A printable demand notice with the invoice number, what it is for and how the amount
            was worked out
            {transaction.expires_at
              ? `, valid until ${new Date(transaction.expires_at).toLocaleDateString('en-NG')}`
              : ''}
            .{' '}
            {transaction.gateway_reference
              ? `Give them the payment reference ${transaction.gateway_reference} as well — that is what a bank or USSD channel asks for.`
              : 'Start the payment first if they want to pay at a bank: the reference a bank asks for is issued then, and the invoice does not carry it.'}
          </p>

          <button type="button" disabled={confirming} onClick={confirmPayment}>
            {confirming ? <Spinner /> : null}
            {confirming ? 'Checking with the payment system…' : 'Check payment status'}
          </button>

          {/* Development only. The API refuses simulation outside the mock
              gateway, but the control should not be visible to a field agent
              in a production build either. */}
          {import.meta.env.DEV && transaction.gateway_reference && (
            <div className="card" style={{ marginTop: 14 }}>
              <h2 className="card__title">Development gateway</h2>
              <p className="card__hint">
                This platform is running against a test payment gateway. Use these controls to
                simulate what a real gateway would report.
              </p>
              <div className="button-row">
                <button type="button" className="secondary" disabled={confirming} onClick={() => simulate('SUCCESS')}>
                  Simulate success
                </button>
                <button type="button" className="secondary" disabled={confirming} onClick={() => simulate('FAILED')}>
                  Simulate failure
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <p className="section-title">History</p>
      <div className="card card--flush">
        <ul className="list">
          {data.events.map((event, index) => (
            <li key={index} className="list__item">
              <div className="list__body">
                <p className="list__title">{event.to_status.replace(/_/g, ' ')}</p>
                <p className="list__meta">
                  {new Date(event.created_at).toLocaleString('en-NG')}
                  {event.reason ? ` · ${event.reason}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <button type="button" className="secondary" onClick={() => navigate('/')}>
        Back to home
      </button>
    </>
  );
}
