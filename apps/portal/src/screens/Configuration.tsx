/** Revenue catalogue and social incentive programmes (PRD §9, §41). */

import { useCallback, useEffect, useState } from 'react';
import { formatNaira, nairaToKobo } from '@psirs/shared';
import { ApiRequestError, api, can, stepUp, type ApiError, type User } from '../lib/api';
import { Alert, Badge, ErrorAlert, Loading, Money, Table, formatDate } from '../ui';

interface RevenueItem {
  id: string;
  code: string;
  name: string;
  category_name: string;
  frequency: string;
  rate_type: string | null;
  fixed_amount_kobo: string | null;
  rate_basis_points: number | null;
  minimum_amount_kobo: string | null;
  version: number | null;
  self_assessable: boolean;
  commission_eligible: boolean;
}

function describeRate(item: RevenueItem): string {
  if (!item.rate_type) return 'No approved rate in force';
  switch (item.rate_type) {
    case 'FIXED':
      return item.fixed_amount_kobo ? formatNaira(BigInt(item.fixed_amount_kobo)) : '—';
    case 'PERCENTAGE':
      return `${((item.rate_basis_points ?? 0) / 100).toFixed(2)}% of assessable amount`;
    case 'TIERED':
      return 'Progressive bands';
    case 'FORMULA':
      return 'Calculated by formula';
    default:
      return item.rate_type;
  }
}

export function CatalogueScreen({ user }: { user: User }) {
  const [items, setItems] = useState<RevenueItem[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<RevenueItem | null>(null);
  const [history, setHistory] = useState<{ item: RevenueItem; rows: any[] } | null>(null);

  const load = useCallback(() => {
    api
      .get<RevenueItem[]>('/revenue/items')
      .then(setItems)
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
        <h2 className="card__title">Revenue catalogue</h2>
        <p className="card__hint">
          Revenue items and their rates are government configuration, not code. Changing a rate
          creates a new version with an effective date — it never rewrites what was already assessed.
        </p>
      </div>

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      {editing && (
        <RateChangeForm
          item={editing}
          user={user}
          onCancel={() => setEditing(null)}
          onDone={(note) => {
            setEditing(null);
            setMessage(note);
            load();
          }}
        />
      )}

      {history && (
        <div className="card card--flush">
          <div style={{ padding: '18px 18px 0' }}>
            <div className="card__header">
              <div>
                <h2 className="card__title">Rate history — {history.item.name}</h2>
                <p className="card__hint">
                  Historical assessments remain attached to the version in force when they were
                  raised.
                </p>
              </div>
              <button type="button" className="small secondary" onClick={() => setHistory(null)}>
                Close
              </button>
            </div>
          </div>
          <Table
            columns={[
              { key: 'version', label: 'Version', numeric: true },
              { key: 'rate_type', label: 'Type' },
              {
                key: 'fixed_amount_kobo',
                label: 'Fixed amount',
                numeric: true,
                render: (row) => <Money kobo={row.fixed_amount_kobo} />,
              },
              {
                key: 'rate_basis_points',
                label: 'Rate',
                numeric: true,
                render: (row) =>
                  row.rate_basis_points ? `${(row.rate_basis_points / 100).toFixed(2)}%` : '—',
              },
              { key: 'effective_from', label: 'From', render: (row) => formatDate(row.effective_from) },
              {
                key: 'effective_to',
                label: 'To',
                render: (row) => (row.effective_to ? formatDate(row.effective_to) : 'Current'),
              },
              { key: 'changed_by', label: 'Changed by', render: (row) => row.changed_by ?? 'System' },
              {
                key: 'requested_reason',
                label: 'Reason',
                render: (row) => row.decision_reason ?? row.requested_reason ?? '—',
              },
            ]}
            rows={history.rows}
            empty="No rate history."
          />
        </div>
      )}

      <div className="card card--flush">
        {!items ? (
          <div style={{ padding: 18 }}>
            <Loading rows={6} />
          </div>
        ) : (
          <Table
            columns={[
              { key: 'code', label: 'Code', render: (row) => <span className="mono">{row.code}</span> },
              { key: 'name', label: 'Revenue item' },
              { key: 'category_name', label: 'Category' },
              { key: 'frequency', label: 'Frequency', render: (row) => <Badge status={row.frequency} /> },
              { key: 'rate', label: 'Current rate', render: (row) => describeRate(row) },
              {
                key: 'version',
                label: 'Version',
                numeric: true,
                render: (row) => row.version ?? '—',
              },
              {
                key: 'commission_eligible',
                label: 'Commission',
                render: (row) => (row.commission_eligible ? 'Eligible' : 'Not eligible'),
              },
              {
                key: 'action',
                label: '',
                render: (row) => (
                  <div className="button-row">
                    <button
                      type="button"
                      className="small secondary"
                      onClick={async () => {
                        const rows = await api.get<any[]>(
                          `/government/audit/queries/rate-changes?revenueItemId=${row.id}`,
                        );
                        setHistory({ item: row, rows });
                      }}
                    >
                      History
                    </button>
                    {can('catalogue:configure') && (
                      <button type="button" className="small" onClick={() => setEditing(row)}>
                        Change rate
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
            rows={items}
            empty="No revenue items configured."
          />
        )}
      </div>
    </>
  );
}

function RateChangeForm({
  item,
  user,
  onCancel,
  onDone,
}: {
  item: RevenueItem;
  user: User;
  onCancel: () => void;
  onDone: (message: string) => void;
}) {
  const [rateType, setRateType] = useState(item.rate_type ?? 'FIXED');
  const [amount, setAmount] = useState('');
  const [percent, setPercent] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(
    new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
  );
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      // Changing a rate is a high-risk action: it needs a fresh one-time code
      // as well as the permission (PRD §35).
      await stepUp('catalogue.rate.change', user.phone);

      await api.post(`/revenue/items/${item.id}/rates`, {
        rateType,
        fixedAmountKobo:
          rateType === 'FIXED' ? nairaToKobo(amount || '0').toString() : undefined,
        rateBasisPoints:
          rateType === 'PERCENTAGE' ? Math.round(Number.parseFloat(percent || '0') * 100) : undefined,
        effectiveFrom: new Date(`${effectiveFrom}T00:00:00`).toISOString(),
        reason,
      });

      onDone(
        `A new rate version for "${item.name}" has been recorded, effective ${effectiveFrom}. ` +
          'Existing assessments are unaffected.',
      );
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
    <div className="card">
      <h2 className="card__title">Change rate — {item.name}</h2>
      <p className="card__hint">
        The current version stays on record and keeps applying to assessments already raised.
      </p>

      <ErrorAlert error={error} />

      <div className="filters">
        <div className="field">
          <label htmlFor="rate-type">Rate type</label>
          <select id="rate-type" value={rateType} onChange={(event) => setRateType(event.target.value)}>
            <option value="FIXED">Fixed amount</option>
            <option value="PERCENTAGE">Percentage</option>
          </select>
        </div>

        {rateType === 'FIXED' ? (
          <div className="field">
            <label htmlFor="amount">New amount (₦)</label>
            <input
              id="amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="15000.00"
            />
          </div>
        ) : (
          <div className="field">
            <label htmlFor="percent">New rate (%)</label>
            <input
              id="percent"
              inputMode="decimal"
              value={percent}
              onChange={(event) => setPercent(event.target.value)}
              placeholder="5.00"
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="effective">Effective from</label>
          <input
            id="effective"
            type="date"
            value={effectiveFrom}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(event) => setEffectiveFrom(event.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="rate-reason">Reason for the change (minimum 10 characters)</label>
        <textarea
          id="rate-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Approved under the 2026 revenue review, Executive Council minute 14/2026."
        />
      </div>

      <div className="button-row">
        <button type="button" disabled={busy || reason.trim().length < 10} onClick={submit}>
          {busy ? 'Recording…' : 'Record new rate version'}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ProgrammesScreen() {
  const [programmes, setProgrammes] = useState<any[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<any[]>('/government/programmes')
      .then(setProgrammes)
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
        <h2 className="card__title">Social incentive programmes</h2>
        <p className="card__hint">
          Programmes record who qualifies for a government benefit and why. They add entitlement —
          they never withdraw a service.
        </p>
        <Alert kind="info" title="Essential services are protected">
          <p style={{ margin: 0 }}>
            A programme that links an essential public service to tax compliance can only be created
            if the legal or policy authority for that linkage is recorded against it.
          </p>
        </Alert>
      </div>

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      <div className="card card--flush">
        {!programmes ? (
          <div style={{ padding: 18 }}>
            <Loading rows={4} />
          </div>
        ) : (
          <Table
            columns={[
              { key: 'name', label: 'Programme' },
              { key: 'code', label: 'Code', render: (row) => <span className="mono">{row.code}</span> },
              { key: 'benefit_type', label: 'Benefit' },
              { key: 'minimum_score', label: 'Min. score', numeric: true },
              {
                key: 'requires_no_arrears',
                label: 'Requires no arrears',
                render: (row) => (row.requires_no_arrears ? 'Yes' : 'No'),
              },
              { key: 'approval_authority', label: 'Approval authority' },
              { key: 'eligible_taxpayers', label: 'Eligible taxpayers', numeric: true },
              { key: 'status', label: 'Status', render: (row) => <Badge status={row.status} /> },
              {
                key: 'action',
                label: '',
                render: (row) =>
                  can('incentive:configure') ? (
                    <button
                      type="button"
                      className="small secondary"
                      onClick={async () => {
                        const next = row.status === 'ACTIVE' ? 'CLOSED' : 'ACTIVE';
                        await api.post(`/government/programmes/${row.id}/status`, { status: next });
                        setMessage(`Programme "${row.name}" is now ${next.toLowerCase()}.`);
                        load();
                      }}
                    >
                      {row.status === 'ACTIVE' ? 'Close' : 'Activate'}
                    </button>
                  ) : null,
              },
            ]}
            rows={programmes}
            empty="No incentive programmes have been created."
          />
        )}
      </div>
    </>
  );
}
