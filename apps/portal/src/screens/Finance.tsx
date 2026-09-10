/** Reconciliation, settlement, commission and maker-checker approvals. */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api, can, stepUp, type ApiError, type User } from '../lib/api';
import { Alert, Badge, ErrorAlert, Loading, Money, Stat, Table, formatDate, formatDateTime } from '../ui';
import { withJustification } from '../lib/justify';
import { BankChangesCard } from './Agents';
import { usePortalI18n } from '../lib/i18n';
import { enumLabel } from '@psirs/shared';

// ------------------------------------------------------------ reconciliation

export function ReconciliationScreen() {
  const { t } = usePortalI18n();
  const [settlements, setSettlements] = useState<any | null>(null);
  const [exceptions, setExceptions] = useState<any[] | null>(null);
  const [inTransit, setInTransit] = useState<any[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  /**
   * A panel that could not be loaded, kept apart from `error`.
   *
   * Both used to share one alert rendered beneath the action buttons, so a
   * refusal to *read* the settlement figures appeared directly under "Recover
   * missed confirmations" and read as though that action had been refused. The
   * two say different things — one means "this is not yours to see", the other
   * "what you just did did not happen" — and on a reconciliation screen that is
   * not a distinction to blur.
   */
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState({
    from: new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
  });
  /*
   * Recording a settlement had no way in.
   *
   * `POST /government/settlements` is the entry point to the whole settlement
   * path — it is what moves a day's collections to SETTLED, and SETTLED is
   * what the commission ledger waits for — and no screen called it. Nothing
   * caught that: the reachability check compares a write endpoint against the
   * portal's source, and this screen already mentioned `/government/settlements`
   * to read the figures, so the POST looked reached.
   */
  const [entry, setEntry] = useState({
    settlementDate: new Date().toISOString().slice(0, 10),
    gatewayReferences: '',
    receivedNaira: '',
    bankReference: '',
  });

  const load = useCallback(() => {
    api
      .get('/government/settlements')
      .then((loaded) => {
        setSettlements(loaded);
        setLoadError(null);
      })
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setLoadError(caught.error);
      });
    /*
     * A list that could not be read is not a list with nothing in it.
     *
     * Both of these answered a failure with an empty array, and an empty
     * exceptions table reads as "reconciliation is clean" — which is the one
     * conclusion an officer must not draw from a request that failed. The
     * summary fetch above already reports its failure; these now do too, so a
     * scoped refusal on one endpoint is visible rather than reassuring.
     */
    api
      .get<any[]>('/government/reconciliation/exceptions')
      .then(setExceptions)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setLoadError(caught.error);
      });
    api
      .get<any[]>('/government/reconciliation/awaiting-settlement')
      .then(setInTransit)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setLoadError(caught.error);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Naira as an officer types it, kobo as the API takes it. */
  function toKobo(naira: string): string | null {
    const trimmed = naira.trim().replace(/,/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
    const [whole, fraction = ''] = trimmed.split('.');
    return `${BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'))}`;
  }

  async function record() {
    const receivedAmountKobo = toKobo(entry.receivedNaira);
    if (!receivedAmountKobo) {
      setError({ code: 'INVALID_AMOUNT', message: t.ofcFnEnterTheCreditedAmount } as ApiError);
      return;
    }
    const gatewayReferences = entry.gatewayReferences
      .split(/[\s,]+/)
      .map((reference) => reference.trim())
      .filter(Boolean);
    if (gatewayReferences.length === 0) {
      setError({ code: 'NO_REFERENCES', message: t.ofcFnListTheGatewayReferences } as ApiError);
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.post<{
        settlementReference: string;
        status: 'RECONCILED' | 'DISPUTED';
        transactionsSettled: number;
        varianceKobo: string;
      }>('/government/settlements', {
        settlementDate: entry.settlementDate,
        gatewayReferences,
        receivedAmountKobo,
        bankReference: entry.bankReference,
      });
      setMessage(
        result.status === 'RECONCILED'
          ? t.ofcFnSettlementRecorded
              .replace('{{reference}}', result.settlementReference)
              .replace('{{count}}', String(result.transactionsSettled))
          : t.ofcFnSettlementDisputed.replace('{{reference}}', result.settlementReference),
      );
      setEntry({ ...entry, gatewayReferences: '', receivedNaira: '', bankReference: '' });
      load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Close a settlement whose credit did not match what it covers.
   *
   * Three answers rather than one, which is why this does not go through
   * `withJustification` — but it has to hold the same line the helper was
   * written to hold. Every one of these checks used to be `?? ''` followed by
   * a bare `return`: an amount that did not parse, an empty bank reference, or
   * a note a character short all abandoned the action without a word, on the
   * screen directly above one that says the credited amount in so many words
   * when `record()` cannot read it. The officer had answered three questions
   * about money that has not arrived and was told nothing at all.
   *
   * `null` is the one quiet case, in each of the three: it means Cancel, and
   * somebody who changed their mind knows they did.
   */
  async function closeDispute(row: { id: string; settlement_reference: string }) {
    const typedAmount = window.prompt(
      t.ofcFnTotalCreditedPrompt.replace('{{reference}}', row.settlement_reference) +
        t.ofcFnItHasToAccount,
      '',
    );
    if (typedAmount === null) return;
    const receivedAmountKobo = toKobo(typedAmount);
    if (!receivedAmountKobo) {
      setError({ code: 'INVALID_AMOUNT', message: t.ofcFnEnterTheCreditedAmount } as ApiError);
      return;
    }

    const bankReference = window.prompt(t.ofcFnBankReferenceForThe, '');
    if (bankReference === null) return;
    if (!bankReference.trim()) {
      setError({ code: 'MISSING_REFERENCE', message: t.ofcFnBankReferenceRequired } as ApiError);
      return;
    }

    const note = window.prompt(t.ofcFnWhatTheVarianceTurned, '');
    if (note === null) return;
    if (note.trim().length < 10) {
      setError({ code: 'NOTE_TOO_SHORT', message: t.ofcFnDisputeNoteTooShort } as ApiError);
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.post<{ settlementReference: string; transactionsSettled: number }>(
        `/government/settlements/${row.id}/reconcile`,
        { receivedAmountKobo, bankReference: bankReference.trim(), note: note.trim() },
      );
      setMessage(
        t.ofcFnSettlementClosed
          .replace('{{reference}}', result.settlementReference)
          .replace('{{n}}', String(result.transactionsSettled)),
      );
      load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.post<{
        status: 'COMPLETED' | 'ABORTED';
        matched: number;
        exceptions: number;
        unchecked: number;
        byStatus: Record<string, number>;
        totalPlatformKobo: string;
        totalGatewayKobo: string;
        statementSource: string;
        abortReason?: string;
      }>('/government/reconciliation/run', {
        from: new Date(range.from).toISOString(),
        to: new Date(`${range.to}T23:59:59`).toISOString(),
      });

      if (result.status === 'ABORTED') {
        // Nothing was compared, so nothing may be reported as agreeing. Saying
        // "0 exceptions" here would be the most reassuring sentence available
        // and the least true one.
        setError({
          code: 'RECONCILIATION_ABORTED',
          moneyStatus: 'UNCONFIRMED',
          nextStep: t.ofcFnReRunThisPeriod,
          message:
            t.ofcFnReconciliationAborted.replace(
              '{{reason}}',
              result.abortReason ?? t.ofcFnStatementUnavailable,
            ) + t.ofcFnNothingWasComparedFor,
        });
        load();
        return;
      }

      setMessage(
        t.ofcFnReconciliationComplete
          .replace('{{matched}}', String(result.matched))
          .replace('{{exceptions}}', String(result.exceptions)) +
          (result.unchecked > 0
            ? t.ofcFnReconciliationUnchecked.replace('{{count}}', String(result.unchecked))
            : '') +
          (result.totalPlatformKobo === result.totalGatewayKobo
            ? t.ofcFnTotalsAgree
            : t.ofcFnTotalsDisagree),
      );
      load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  async function recover() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.post<{ attempted: number; verified: number }>(
        '/government/reconciliation/recover',
        {
          from: new Date(range.from).toISOString(),
          to: new Date(`${range.to}T23:59:59`).toISOString(),
        },
      );
      setMessage(
        t.ofcFnRecoverChecked
          .replace('{{attempted}}', String(result.attempted))
          .replace('{{verified}}', String(result.verified)),
      );
      load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card">
        <div className="card__header">
          <div>
            <h2 className="card__title">{t.ofcFnThreeWay}</h2>
            <p className="card__hint">{t.ofcFnThreeWayBody}</p>
          </div>
        </div>

        <div className="filters">
          <div className="field">
            <label htmlFor="from">{t.ofcFrom}</label>
            <input
              id="from"
              type="date"
              value={range.from}
              onChange={(event) => setRange({ ...range, from: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="to">{t.ofcTo}</label>
            <input
              id="to"
              type="date"
              value={range.to}
              onChange={(event) => setRange({ ...range, to: event.target.value })}
            />
          </div>
          {can('payment:reconcile') && (
            <>
              <button type="button" disabled={busy} onClick={run}>{t.ofcFnRunReconciliation}</button>
              <button type="button" className="secondary" disabled={busy} onClick={recover}>{t.ofcFnRecoverMissed}</button>
            </>
          )}
        </div>

        <p className="field__hint">{t.ofcFnRecoverMissedBody}</p>
      </div>

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      {loadError && (
        <Alert kind="info" title="ofcFnNotYourRole">
          <p style={{ margin: 0 }}>{loadError.message}</p>
        </Alert>
      )}

      {settlements && (
        <div className="stat-grid">
          <Stat label="ofcFnTotalExpected" value={<Money kobo={settlements.totals.total_expected_kobo} />} />
          <Stat label="ofcFnTotalReceived" value={<Money kobo={settlements.totals.total_received_kobo} />} />
          <Stat
            label="ofcFnVariance"
            value={<Money kobo={settlements.totals.total_variance_kobo} />}
            variant={settlements.totals.total_variance_kobo !== '0' ? 'alert' : undefined}
          />
          <Stat
            label="ofcLvAwaitingSettlement"
            value={<Money kobo={settlements.awaitingSettlement.amount_kobo} />}
            hint={{ text: t.ofcOvTransactionCount.replace('{{n}}', String(settlements.awaitingSettlement.count)) }}
          />
        </div>
      )}

      {can('payment:reconcile') && (
        <div className="card">
          <h2 className="card__title">{t.ofcFnRecordSettlementTitle}</h2>
          <p className="card__hint">{t.ofcFnStatementBody}</p>
          <div className="field-row">
            <div className="field">
              <label htmlFor="settlement-date">{t.ofcFnValueDate}</label>
              <input
                id="settlement-date"
                type="date"
                value={entry.settlementDate}
                onChange={(event) => setEntry({ ...entry, settlementDate: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="settlement-bank">{t.ofcFnBankReference}</label>
              <input
                id="settlement-bank"
                value={entry.bankReference}
                placeholder={t.ofcFnAsOnStatement}
                onChange={(event) => setEntry({ ...entry, bankReference: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="settlement-amount">{t.ofcFnCredited}</label>
              <input
                id="settlement-amount"
                inputMode="decimal"
                value={entry.receivedNaira}
                placeholder="1250000.00"
                onChange={(event) => setEntry({ ...entry, receivedNaira: event.target.value })}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="settlement-references">{t.ofcFnGatewayReferences}</label>
            <textarea
              id="settlement-references"
              rows={3}
              value={entry.gatewayReferences}
              placeholder={t.ofcFnOnePerLine}
              onChange={(event) => setEntry({ ...entry, gatewayReferences: event.target.value })}
            />
          </div>
          <button type="button" disabled={busy} onClick={record}>
            {t.ofcFnRecordSettlementAction}
          </button>
        </div>
      )}

      {/*
        * Money in transit, kept out of the exception queue.
        *
        * A payment the gateway has confirmed is money the *gateway* holds; it
        * reaches the government account in a batch a day or two later. That is
        * the third leg of the reconciliation, not a fault, and listing it as an
        * exception made ordinary business look like a problem while hiding the
        * case that is one — a collection confirmed days ago and never handed
        * over. Those have moved to the queue below.
        */}
      <div className="card card--flush">
        <div className="card__pad">
          <h2 className="card__title">{t.ofcFnAwaitingSettlement}</h2>
          <p className="card__hint">{t.ofcFnAwaitingSettlementBody}</p>
        </div>
        {!inTransit ? (
          <div style={{ padding: 18 }}>
            <Loading rows={3} />
          </div>
        ) : (
          <Table
            columns={[
              { key: 'transaction_reference', label: 'supTransactionLabel' },
              {
                key: 'name',
                label: 'colTaxpayerLabel',
                render: (row: any) =>
                  row.business_name ?? [row.first_name, row.last_name].filter(Boolean).join(' ') ?? '—',
              },
              {
                key: 'expected_amount_kobo',
                label: 'pubVerifyAmount',
                numeric: true,
                render: (row: any) => <Money kobo={row.expected_amount_kobo} />,
              },
              {
                key: 'age_hours',
                label: 'ofcRhWaiting',
                numeric: true,
                render: (row: any) =>
                  row.age_hours < 24
                    ? `${row.age_hours} h`
                    : `${Math.floor(row.age_hours / 24)} d ${row.age_hours % 24} h`,
              },
              { key: 'agent_code', label: 'ofcRhAgent' },
            ]}
            rows={inTransit}
            empty="ofcNoneConfirmedCollectionReachedGovernment"
          />
        )}
      </div>

      <div className="card card--flush">
        <div className="card__pad">
          <h2 className="card__title">{t.ofcFnExceptionQueue}</h2>
          <p className="card__hint">{t.ofcFnExceptionQueueBody}</p>
        </div>
        {!exceptions ? (
          <div style={{ padding: 18 }}>
            <Loading rows={4} />
          </div>
        ) : (
          <Table
            columns={[
              { key: 'status', label: 'ofcFnException', render: (row) => <Badge status={row.status} /> },
              {
                key: 'transaction_reference',
                label: 'supTransactionLabel',
                render: (row) => <span className="mono">{row.transaction_reference ?? '—'}</span>,
              },
              {
                key: 'gateway_reference',
                label: 'colGatewayReference',
                render: (row) => <span className="mono">{row.gateway_reference ?? '—'}</span>,
              },
              {
                key: 'expected_amount_kobo',
                label: 'ofcRhExpected',
                numeric: true,
                render: (row) => <Money kobo={row.expected_amount_kobo} />,
              },
              {
                key: 'received_amount_kobo',
                label: 'ofcRhReceived',
                numeric: true,
                render: (row) => <Money kobo={row.received_amount_kobo} />,
              },
              {
                key: 'variance_kobo',
                label: 'ofcFnVariance',
                numeric: true,
                render: (row) => <Money kobo={row.variance_kobo} />,
              },
              { key: 'agent_code', label: 'ofcRhAgent', render: (row) => row.agent_code ?? '—' },
              {
                key: 'action',
                label: { text: '' },
                render: (row) =>
                  can('payment:reconcile') ? (
                    <button
                      type="button"
                      className="small secondary"
                      onClick={() =>
                        void withJustification({
                          question: t.ofcFnRecordHowThisException,
                          minimum: 10,
                          tooShort: t.ofcFnResolveTooShort,
                          run: async (resolution) => {
                            await api.post(
                              `/government/reconciliation/exceptions/${row.id}/resolve`,
                              { resolution },
                            );
                            load();
                          },
                          onSuccess: t.ofcFnExceptionResolved,
                          setError,
                          setMessage,
                        })
                      }
                    >{t.ofcFnResolve}</button>
                  ) : null,
              },
            ]}
            rows={exceptions}
            empty="ofcNoneOpenReconciliationExceptions"
          />
        )}
      </div>

      {settlements && (
        <div className="card card--flush">
          <div className="card__pad">
            <h2 className="card__title">{t.ofcFnSettlements}</h2>
          </div>
          <Table
            columns={[
              {
                key: 'settlement_reference',
                label: 'errReference',
                render: (row) => <span className="mono">{row.settlement_reference}</span>,
              },
              { key: 'settlement_date', label: 'ofcFnDate', render: (row) => formatDate(row.settlement_date) },
              { key: 'bank_reference', label: 'ofcFnBankReference' },
              { key: 'transaction_count', label: 'ofcNavTransactions', numeric: true },
              {
                key: 'expected_amount_kobo',
                label: 'ofcRhExpected',
                numeric: true,
                render: (row) => <Money kobo={row.expected_amount_kobo} />,
              },
              {
                key: 'received_amount_kobo',
                label: 'ofcRhReceived',
                numeric: true,
                render: (row) => <Money kobo={row.received_amount_kobo} />,
              },
              { key: 'status', label: 'appStatus', render: (row) => <Badge status={row.status} /> },
              {
                key: 'id',
                label: { text: '' },
                render: (row) =>
                  row.status === 'DISPUTED' && can('payment:reconcile') ? (
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => closeDispute(row)}
                    >{t.ofcFnCloseDispute}</button>
                  ) : null,
              },
            ]}
            rows={settlements.recentSettlements}
            empty="ofcNoneSettlementsRecorded"
          />
          <p className="field__hint" style={{ padding: '0 18px 18px' }}>{t.ofcFnDisputeBody}</p>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- commissions

export function CommissionsScreen() {
  const { t } = usePortalI18n();
  const [payouts, setPayouts] = useState<any[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<any[]>('/government/commissions/payouts')
      .then(setPayouts)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <div className="card">
        <h2 className="card__title">{t.ofcFnCommissionPayouts}</h2>
        <p className="card__hint">{t.ofcFnCommissionBody}</p>
        {can('commission:manage') && (
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              const result = await api.post<{ promoted: number }>(
                '/government/commissions/promote',
              );
              setMessage(t.ofcFnPromotedForPayout.replace('{{n}}', String(result.promoted)));
              load();
            }}
          >{t.ofcFnPromoteEligible}</button>
        )}
      </div>

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      <div className="card card--flush">
        {!payouts ? (
          <div style={{ padding: 18 }}>
            <Loading rows={4} />
          </div>
        ) : (
          <Table
            columns={[
              {
                key: 'payout_reference',
                label: 'ofcFnPayout',
                render: (row) => <span className="mono">{row.payout_reference}</span>,
              },
              { key: 'agent_code', label: 'ofcRhAgent' },
              { key: 'full_name', label: 'tpName' },
              {
                key: 'amount_kobo',
                label: 'pubVerifyAmount',
                numeric: true,
                render: (row) => <Money kobo={row.amount_kobo} />,
              },
              { key: 'commission_count', label: 'ofcFnEntries', numeric: true },
              {
                key: 'bank',
                label: 'ofcFnBankAccount',
                render: (row) => (
                  <>
                    {row.bank_name} ····{String(row.account_number).slice(-4)}{' '}
                    <Badge status={row.verification_status} />
                  </>
                ),
              },
              { key: 'status', label: 'appStatus', render: (row) => <Badge status={row.status} /> },
              {
                key: 'action',
                label: { text: '' },
                render: (row) => (
                  <div className="button-row">
                    {row.status === 'REQUESTED' && can('commission:payout:approve') && (
                      <button
                        type="button"
                        className="small"
                        onClick={() =>
                          void withJustification({
                            question: t.ofcFnReasonForApprovingThis,
                            minimum: 5,
                            tooShort: t.ofcFnApprovePayoutTooShort,
                            run: async (reason) => {
                              await api.post(
                                `/government/commissions/payouts/${row.id}/approve`,
                                { reason },
                              );
                              load();
                            },
                            onSuccess: t.ofcFnPayoutApproved,
                            setError,
                            setMessage,
                          })
                        }
                      >{t.ofcRhApprove}</button>
                    )}
                    {row.status === 'APPROVED' && can('commission:manage') && (
                      <button
                        type="button"
                        className="small secondary"
                        onClick={() =>
                          void withJustification({
                            question: t.ofcFnBankTransferReferenceAt,
                            minimum: 3,
                            tooShort: t.ofcFnTransferReferenceTooShort,
                            run: async (bankReference) => {
                              await api.post(
                                `/government/commissions/payouts/${row.id}/complete`,
                                { bankReference },
                              );
                              load();
                            },
                            onSuccess: t.ofcFnPayoutPaid,
                            setError,
                            setMessage,
                          })
                        }
                      >
                        {t.ofcFnRecordPayment}
                      </button>
                    )}
                    {row.status === 'APPROVED' && can('commission:manage') && (
                      <button
                        type="button"
                        className="small secondary"
                        onClick={() =>
                          void withJustification({
                            question: t.ofcFnWhatDidTheBank,
                            minimum: 10,
                            tooShort: t.ofcFnPayoutFailedTooShort,
                            run: async (reason) => {
                              await api.post(
                                `/government/commissions/payouts/${row.id}/fail`,
                                { reason },
                              );
                              load();
                            },
                            onSuccess: t.ofcFnPayoutFailedRecorded,
                            setError,
                            setMessage,
                          })
                        }
                      >{t.ofcFnTransferFailed}</button>
                    )}
                  </div>
                ),
              },
            ]}
            rows={payouts}
            empty="ofcNonePayoutRequests"
          />
        )}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ approvals

export function ApprovalsScreen({ user }: { user: User }) {
  const { t } = usePortalI18n();
  const [approvals, setApprovals] = useState<any[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('REQUESTED');

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    api
      .get<any[]>(`/government/approvals?${params.toString()}`)
      .then(setApprovals)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(id: string, decision: 'REVIEW' | 'APPROVE' | 'REJECT') {
    await withJustification({
      question: t.ofcFnReasonForThisDecision,
      minimum: 10,
      tooShort: t.ofcFnDecisionTooShort,
      run: async (reason) => {
        await api.post(`/government/approvals/${id}/decide`, { decision, reason });
        load();
      },
      onSuccess: t.ofcFnRequestDecided.replace('{{decision}}', enumLabel(decision, t)),
      setError,
      setMessage,
    });
  }

  async function executeReversal(id: string) {
    setError(null);
    try {
      await stepUp('payment.reversal.approve', user.phone);
      const result = await api.post<{ refundReference: string; commissionReversed: number }>(
        `/government/approvals/${id}/execute-reversal`,
      );
      setMessage(
        t.ofcFnReversalExecuted
          .replace('{{reference}}', result.refundReference)
          .replace('{{count}}', String(result.commissionReversed)),
      );
      load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
      else if (caught instanceof Error) {
        setError({ code: 'CLIENT', message: caught.message, moneyStatus: 'NOT_APPLICABLE' });
      }
    }
  }

  return (
    <>
      {/*
        * Bank account changes get their own card above the generic queue.
        * A row reading "BANK_ACCOUNT_CHANGE / bank_account / <uuid>" tells an
        * officer nothing they can weigh; the decision turns on the name the
        * bank returned against the name the agent gave, and that has to be on
        * screen next to the buttons or it will not be looked at.
        */}
      <BankChangesCard />

      <div className="card">
        <div className="card__header">
          <div>
            <h2 className="card__title">{t.ofcFnMakerChecker}</h2>
            <p className="card__hint">{t.ofcFnMakerCheckerBody}</p>
          </div>
          <div className="field" style={{ marginBottom: 0, minWidth: 170 }}>
            <label htmlFor="approval-status">{t.appStatus}</label>
            <select
              id="approval-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">{t.ofcAgAll}</option>
              <option value="REQUESTED">{t.ofcRhRequested}</option>
              <option value="REVIEWED">{t.ofcKycReviewed}</option>
              <option value="APPROVED">{t.ofcFnApproved}</option>
              <option value="REJECTED">{t.ofcFnRejected}</option>
              <option value="EXECUTED">{t.ofcFnExecuted}</option>
            </select>
          </div>
        </div>
      </div>

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      <div className="card card--flush">
        {!approvals ? (
          <div style={{ padding: 18 }}>
            <Loading rows={4} />
          </div>
        ) : (
          <Table
            columns={[
              {
                key: 'approval_type',
                label: 'tpType',
                render: (row) => <Badge status={row.approval_type} />,
              },
              { key: 'entity_type', label: 'ofcSpSubject' },
              { key: 'requested_by_name', label: 'ofcFnRequestedBy' },
              { key: 'requested_reason', label: 'ofcAgReason' },
              {
                key: 'requested_at',
                label: 'ofcRhRequested',
                render: (row) => formatDateTime(row.requested_at),
              },
              { key: 'status', label: 'appStatus', render: (row) => <Badge status={row.status} /> },
              {
                key: 'action',
                label: { text: '' },
                render: (row) => {
                  /*
                   * By id, not by name.
                   *
                   * The server refuses self-approval on `requested_by` and has
                   * done all along, so this was never a way past the control —
                   * what it got wrong was the label, in both directions. Two
                   * officers sharing a name meant the second was shown "Your
                   * request" and no buttons, and was blocked from a review they
                   * were entitled to do; a difference of casing or spacing meant
                   * the requester was offered Approve on their own request and
                   * got a 403 for pressing it.
                   */
                  const isRequester = row.requested_by_user_id === user.id;
                  if (isRequester) {
                    return <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>{t.ofcFnYourRequest}</span>;
                  }
                  return (
                    <div className="button-row">
                      {['REQUESTED', 'REVIEWED'].includes(row.status) && can('approval:review') && (
                        <>
                          <button type="button" className="small" onClick={() => decide(row.id, 'APPROVE')}>{t.ofcRhApprove}</button>
                          <button
                            type="button"
                            className="small danger"
                            onClick={() => decide(row.id, 'REJECT')}
                          >{t.ofcAgReject}</button>
                        </>
                      )}
                      {row.status === 'APPROVED' &&
                        ['PAYMENT_REVERSAL', 'REFUND'].includes(row.approval_type) &&
                        can('payment:reverse:approve') && (
                          <button
                            type="button"
                            className="small secondary"
                            onClick={() => executeReversal(row.id)}
                          >{t.ofcFnExecuteReversal}</button>
                        )}
                    </div>
                  );
                },
              },
            ]}
            rows={approvals}
            empty="ofcNoneApprovalRequestsMatchFilter"
          />
        )}
      </div>
    </>
  );
}
