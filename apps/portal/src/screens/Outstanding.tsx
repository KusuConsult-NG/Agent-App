/**
 * Work the platform has not finished (PRD §26, §46, §66, §71).
 *
 * Three integrations can say they could not be reached, and each keeps a queue
 * of what is still owed as a result: a taxpayer without the TIN they were
 * promised, a renewal the vehicle authority never acknowledged, and — the one
 * that matters most — money a citizen has not had back.
 *
 * Every one of those queues had an endpoint to read it, an endpoint to retry
 * it, and a background worker driving it. None of them had a screen. So the
 * retries happened, and no person could see what was outstanding or whether
 * the worker had been failing since Tuesday. A queue nobody can look at is
 * indistinguishable from an empty one, which is the wrong thing for a refund
 * to be indistinguishable from.
 *
 * The three queues are guarded by three different permissions, so this screen
 * fetches each independently and shows only the sections the officer may read.
 * Gating the whole page on one of them would repeat the mistake the
 * reconciliation menu item made — offering a screen that answers 403.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api, can, type ApiError } from '../lib/api';
import { Alert, Badge, Empty, ErrorAlert, Loading, Money, Stat, Table, formatDate, formatDateTime } from '../ui';

interface Refund {
  id: string;
  refund_reference: string;
  amount_kobo: string;
  status: string;
  attempts: number;
  failure_reason: string | null;
  last_attempt_at: string | null;
  created_at: string;
  transaction_reference: string;
}

interface AwaitingTin {
  id: string;
  display_name: string;
  phone: string;
  tin_status: string;
  tin_reason: string | null;
  tin_attempts: number;
  created_at: string;
}

interface AuthorityRenewal {
  id: string;
  registration_number: string;
  document_number: string;
  expiry_date: string;
  authority_notification_status: string;
  authority_notification_reason: string | null;
  authority_notification_attempts: number;
  created_at: string;
}

interface EndedWithArrears {
  id: string;
  name: string;
  tin: string | null;
  phone: string;
  status: string;
  status_reason: string | null;
  status_changed_at: string;
  ended_by: string | null;
  lga_name: string | null;
  outstanding_kobo: string;
  unpaid_invoices: number;
}

interface AwaitingAuthority {
  id: string;
  registration_number: string;
  owner_name: string;
  make: string | null;
  model: string | null;
  created_at: string;
}

/** A queue the signed-in officer may not read, stated rather than hidden. */
function NotYours({ what, permission }: { what: string; permission: string }) {
  return (
    <div className="card">
      <h2 className="card__title">{what}</h2>
      <p className="card__hint">
        Reading this queue needs <code>{permission}</code>, which your role does not hold. It is not
        empty — it is not yours.
      </p>
    </div>
  );
}

export function OutstandingScreen() {
  const [refunds, setRefunds] = useState<Refund[] | null>(null);
  const [tins, setTins] = useState<AwaitingTin[] | null>(null);
  const [renewals, setRenewals] = useState<AuthorityRenewal[] | null>(null);
  const [vehicles, setVehicles] = useState<AwaitingAuthority[] | null>(null);
  const [ended, setEnded] = useState<EndedWithArrears[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<{ text: string; resolved: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const readsRefunds = can('payment:read:all');
  const readsTins = can('taxpayer:tin_sync');
  const readsVehicles = can('vehicle:authority_sync');
  const readsTaxpayers = can('taxpayer:read:all');

  const load = useCallback(() => {
    if (readsRefunds) {
      api
        .get<{ refunds: Refund[] }>('/government/refunds/outstanding')
        .then((data) => setRefunds(data.refunds))
        .catch(() => setRefunds([]));
    }
    if (readsTins) {
      api
        .get<{ taxpayers: AwaitingTin[] }>('/taxpayers/tin-outstanding')
        .then((data) => setTins(data.taxpayers))
        .catch(() => setTins([]));
    }
    if (readsTaxpayers) {
      api
        .get<{ taxpayers: EndedWithArrears[] }>('/taxpayers/ended-with-arrears')
        .then((data) => setEnded(data.taxpayers))
        .catch(() => setEnded([]));
    }
    if (readsVehicles) {
      api
        .get<{ renewals: AuthorityRenewal[]; vehiclesAwaitingAuthority: AwaitingAuthority[] }>(
          '/vehicles/renewals/authority-outstanding',
        )
        .then((data) => {
          setRenewals(data.renewals);
          setVehicles(data.vehiclesAwaitingAuthority);
        })
        .catch(() => {
          setRenewals([]);
          setVehicles([]);
        });
    }
  }, [readsRefunds, readsTins, readsVehicles, readsTaxpayers]);

  useEffect(load, [load]);

  async function retry(key: string, path: string) {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      const result = await api.post<{
        message?: string;
        stillOutstanding?: number;
        stillFailing?: number;
      }>(path, {});
      // The three queues report what is left under different names. Anything
      // left means the retry did not resolve it, and saying so in green under
      // the word "complete" would be the cheerful reading of a citizen still
      // waiting for their money.
      const left = result.stillOutstanding ?? result.stillFailing ?? 0;
      setMessage({ text: result.message ?? 'Retry complete.', resolved: left === 0 });
      load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(null);
    }
  }

  const owedKobo = (refunds ?? []).reduce((total, row) => total + BigInt(row.amount_kobo), 0n);
  const waiting =
    (refunds?.length ?? 0) + (tins?.length ?? 0) + (renewals?.length ?? 0) + (vehicles?.length ?? 0);

  // "Nothing is outstanding" may only be said once every queue this officer can
  // read has actually answered. Saying it while a fetch is in flight — or
  // because a queue they cannot read stayed null — is the reassuring version of
  // not knowing.
  const loaded =
    (!readsRefunds || refunds !== null) &&
    (!readsTins || tins !== null) &&
    (!readsVehicles || renewals !== null);

  return (
    <>
      {waiting === 0 && loaded ? (
        <Alert kind="success" title="Nothing is outstanding">
          <p style={{ margin: 0 }}>
            {readsRefunds && readsTins && readsVehicles
              ? 'Every refund has been returned, every taxpayer has their TIN, and the vehicle ' +
                'authority has acknowledged every renewal.'
              : 'Every queue you can see is empty. Others are guarded by permissions your role ' +
                'does not hold.'}
          </p>
        </Alert>
      ) : (
        <div className="stat-grid">
          <Stat label="Owed to taxpayers" value={<Money kobo={owedKobo.toString()} />} />
          <Stat label="Refunds not yet made" value={String(refunds?.length ?? 0)} />
          <Stat label="Waiting for a TIN" value={String(tins?.length ?? 0)} />
          <Stat label="Renewals unacknowledged" value={String(renewals?.length ?? 0)} />
        </div>
      )}

      <ErrorAlert error={error} />
      {message && (
        <Alert
          kind={message.resolved ? 'success' : 'warning'}
          title={message.resolved ? 'Cleared' : 'Still outstanding'}
        >
          <p style={{ margin: 0 }}>{message.text}</p>
        </Alert>
      )}

      {/* Money first. A citizen waiting on a refund outranks a missing number. */}
      {!readsRefunds ? (
        <NotYours what="Refunds owed to taxpayers" permission="payment:read:all" />
      ) : (
        <div className="card">
          <div className="card__header">
            <h2 className="card__title">Refunds owed to taxpayers</h2>
            <p className="card__hint">
              A reversal voids the receipt immediately; the money comes back only when the gateway
              confirms it. Until then the taxpayer has not been refunded.
            </p>
          </div>
          {!refunds ? (
            <Loading />
          ) : (
            <>
              <Table
                columns={[
                  { key: 'refund_reference', label: 'Refund' },
                  { key: 'transaction_reference', label: 'supTransactionLabel' },
                  {
                    key: 'amount_kobo',
                    label: 'pubVerifyAmount',
                    numeric: true,
                    render: (row) => <Money kobo={row.amount_kobo} />,
                  },
                  { key: 'status', label: 'appStatus', render: (row) => <Badge status={row.status} /> },
                  { key: 'attempts', label: 'Attempts', numeric: true },
                  {
                    key: 'failure_reason',
                    label: 'Why not yet',
                    render: (row) => row.failure_reason ?? 'Not attempted yet',
                  },
                  {
                    key: 'last_attempt_at',
                    label: 'Last tried',
                    render: (row) => (row.last_attempt_at ? formatDateTime(row.last_attempt_at) : '—'),
                  },
                  { key: 'created_at', label: 'Owed since', render: (row) => formatDate(row.created_at) },
                ]}
                rows={refunds}
                empty="ofcNoneRefundOutstanding"
              />
              {can('payment:reconcile') && refunds.length > 0 && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => retry('refunds', '/government/refunds/retry')}
                >
                  {busy === 'refunds' ? 'Asking the gateway…' : 'Ask the gateway again'}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {!readsTins ? (
        <NotYours what="Taxpayers waiting for a TIN" permission="taxpayer:tin_sync" />
      ) : (
        <div className="card">
          <div className="card__header">
            <h2 className="card__title">Taxpayers waiting for a TIN</h2>
            <p className="card__hint">
              Registered while the PSIRS TIN service could not be reached. They can be assessed and
              can pay; only the number is missing.
            </p>
          </div>
          {!tins ? (
            <Loading />
          ) : (
            <>
              <Table
                columns={[
                  { key: 'display_name', label: 'colTaxpayerLabel' },
                  { key: 'phone', label: 'tpPhone' },
                  { key: 'tin_status', label: 'appStatus', render: (row) => <Badge status={row.tin_status} /> },
                  { key: 'tin_attempts', label: 'Attempts', numeric: true },
                  { key: 'tin_reason', label: 'Why not yet', render: (row) => row.tin_reason ?? '—' },
                  { key: 'created_at', label: 'ofcRhRegistered', render: (row) => formatDate(row.created_at) },
                ]}
                rows={tins}
                empty="ofcNoneEveryoneTin"
              />
              {tins.length > 0 && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => retry('tins', '/taxpayers/tin-retry')}
                >
                  {busy === 'tins' ? 'Asking the TIN service…' : 'Ask the TIN service again'}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {!readsVehicles ? (
        <NotYours what="Renewals the vehicle authority has not acknowledged" permission="vehicle:authority_sync" />
      ) : (
        <div className="card">
          <div className="card__header">
            <h2 className="card__title">Renewals the vehicle authority has not acknowledged</h2>
            <p className="card__hint">
              The renewal itself is valid and paid for. What is outstanding is the authority
              recording it, which matters the first time the driver is stopped.
            </p>
          </div>
          {!renewals ? (
            <Loading />
          ) : (
            <>
              <Table
                columns={[
                  { key: 'registration_number', label: 'moreVehicleLabel' },
                  { key: 'document_number', label: 'Document' },
                  { key: 'expiry_date', label: 'Valid until', render: (row) => formatDate(row.expiry_date) },
                  {
                    key: 'authority_notification_status',
                    label: 'appStatus',
                    render: (row) => <Badge status={row.authority_notification_status} />,
                  },
                  { key: 'authority_notification_attempts', label: 'Attempts', numeric: true },
                  {
                    key: 'authority_notification_reason',
                    label: 'Why not yet',
                    render: (row) => row.authority_notification_reason ?? '—',
                  },
                ]}
                rows={renewals}
                empty="ofcNoneAuthorityAcknowledgedRenewal"
              />
              {renewals.length > 0 && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => retry('renewals', '/vehicles/renewals/authority-retry')}
                >
                  {busy === 'renewals' ? 'Sending to the authority…' : 'Send to the authority again'}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {readsVehicles && vehicles && vehicles.length > 0 && (
        <div className="card">
          <div className="card__header">
            <h2 className="card__title">Vehicles captured without an authority check</h2>
            <p className="card__hint">
              Recorded from what the owner presented because the authority could not be reached. The
              details have not been confirmed against the register.
            </p>
          </div>
          <Table
            columns={[
              { key: 'registration_number', label: 'moreRegistrationLabel' },
              { key: 'owner_name', label: 'moreOwnerLabel' },
              {
                key: 'make',
                label: 'moreVehicleLabel',
                render: (row) => [row.make, row.model].filter(Boolean).join(' ') || '—',
              },
              { key: 'created_at', label: 'Captured', render: (row) => formatDate(row.created_at) },
            ]}
            rows={vehicles}
            empty="ofcNoneNone"
          />
        </div>
      )}

      {/*
        * Records taken off the register while they still owed something.
        *
        * The counterpart to letting a record be closed at all. Refusing to
        * close one with arrears would mean a deceased taxpayer's record can
        * never be closed, so the pairing is surfaced instead of prevented —
        * the debt stays in every total, and stays somebody's job until it is
        * paid or the record is put back.
        */}
      {!readsTaxpayers ? (
        <NotYours what="Ended records that still owe" permission="taxpayer:read:all" />
      ) : (
        ended && (
          <div className="card card--flush">
            <div style={{ padding: '18px 18px 0' }}>
              <h2 className="card__title">Ended records that still owe</h2>
              <p className="card__hint">
                Closed or suspended while money was outstanding. Nothing has been written off — the
                reminder sweep has stopped chasing these, so they are worked by hand until they are
                paid or the record goes back on the register.
              </p>
            </div>
            <Table
              columns={[
                { key: 'name', label: 'colTaxpayerLabel' },
                { key: 'tin', label: 'tpStepTin', render: (row) => row.tin ?? '—' },
                { key: 'status', label: 'State', render: (row) => <Badge status={row.status} /> },
                {
                  key: 'outstanding_kobo',
                  label: 'Owed',
                  numeric: true,
                  render: (row) => <Money kobo={row.outstanding_kobo} />,
                },
                { key: 'unpaid_invoices', label: 'Invoices', numeric: true },
                {
                  key: 'status_reason',
                  label: 'Why it ended',
                  render: (row) => row.status_reason ?? '—',
                },
                {
                  key: 'status_changed_at',
                  label: 'Ended',
                  render: (row) =>
                    `${formatDate(row.status_changed_at)}${row.ended_by ? ` · ${row.ended_by}` : ''}`,
                },
              ]}
              rows={ended}
              empty="ofcNoneEndedRecordOwesAnything"
            />
          </div>
        )
      )}
    </>
  );
}
