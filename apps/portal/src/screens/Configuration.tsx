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

  /**
   * Why this rate cannot be recorded yet, or `null` when it can.
   *
   * This form decides what every taxpayer is charged for the item, so a value
   * it does not understand must stop it rather than be coerced into one it
   * does. Two coercions used to happen here silently. An empty box became
   * `'0'`, so an officer who never typed an amount set the rate to nothing;
   * and the percentage went through `Number.parseFloat`, which reads "5abc"
   * as 5 and asks no questions. A blank field is not a zero rate, and a rate
   * of zero is a decision somebody should have to type.
   */
  const rateProblem = ((): string | null => {
    if (reason.trim().length < 10) return 'Give a reason for the rate change, in at least 10 characters.';
    if (rateType === 'FIXED') {
      if (!amount.trim()) return 'Enter the new amount. Leave nothing to chance \u2014 type 0 if the levy is being suspended.';
      try {
        const kobo = nairaToKobo(amount);
        if (kobo < 0n) return 'A rate cannot be negative.';
      } catch {
        return `\u201c${amount.trim()}\u201d is not an amount in naira. Enter it as 15000 or 15000.00.`;
      }
      return null;
    }
    if (rateType === 'PERCENTAGE') {
      const typed = percent.trim();
      if (!typed) return 'Enter the new rate as a percentage. Type 0 if the levy is being suspended.';
      // Deliberately stricter than parseFloat: the whole box must be a number.
      if (!/^\d+(?:\.\d{1,2})?$/.test(typed)) {
        return `\u201c${typed}\u201d is not a percentage. Enter it as 5 or 5.00.`;
      }
      if (Number.parseFloat(typed) > 100) return 'A percentage rate cannot be more than 100%.';
      return null;
    }
    return null;
  })();

  async function submit() {
    // Checked before the one-time code is asked for. Validating afterwards
    // spends a step-up code on a request that was never going to be sent.
    if (rateProblem) {
      setError({ code: 'CLIENT', message: rateProblem, moneyStatus: 'NOT_APPLICABLE' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Changing a rate is a high-risk action: it needs a fresh one-time code
      // as well as the permission (PRD §35).
      await stepUp('catalogue.rate.change', user.phone);

      await api.post(`/revenue/items/${item.id}/rates`, {
        rateType,
        fixedAmountKobo: rateType === 'FIXED' ? nairaToKobo(amount).toString() : undefined,
        rateBasisPoints:
          rateType === 'PERCENTAGE' ? Math.round(Number.parseFloat(percent) * 100) : undefined,
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

      {rateProblem && (
        <p className="card__hint" role="status" style={{ marginBottom: 0 }}>
          {rateProblem}
        </p>
      )}

      <div className="button-row">
        <button type="button" disabled={busy || rateProblem !== null} onClick={submit}>
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
  const [selectedProgramme, setSelectedProgramme] = useState<any | null>(null);
  const [beneficiaries, setBeneficiaries] = useState<any[] | null>(null);
  const [evaluating, setEvaluating] = useState<string | null>(null);

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

  async function viewBeneficiaries(programme: any) {
    setSelectedProgramme(programme);
    setBeneficiaries(null);
    const result = await api.get<{ beneficiaries: any[] }>(
      `/government/programmes/${programme.id}/beneficiaries?limit=100`,
    );
    setBeneficiaries(result.beneficiaries);
  }

  async function evaluateAll(programme: any) {
    setEvaluating(programme.id);
    try {
      const result = await api.post<{ evaluated: number; message: string }>(
        `/government/programmes/${programme.id}/evaluate-all`,
        {},
      );
      setMessage(result.message);
      load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setEvaluating(null);
    }
  }

  return (
    <>
      <div className="card">
        <h2 className="card__title">Social incentive programmes</h2>
        <p className="card__hint">
          Programmes record who qualifies for a government benefit and why. They add entitlement —
          they never withdraw a service. Each citizen with a TIN who meets the criteria automatically
          qualifies when evaluated.
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
              { key: 'eligible_taxpayers', label: 'Eligible', numeric: true },
              { key: 'status', label: 'Status', render: (row) => <Badge status={row.status} /> },
              {
                key: 'action',
                label: '',
                render: (row) => (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      className="small secondary"
                      onClick={() => void viewBeneficiaries(row)}
                    >
                      Beneficiaries
                    </button>
                    {can('incentive:configure') && (
                      <>
                        <button
                          type="button"
                          className="small secondary"
                          disabled={evaluating === row.id}
                          onClick={() => void evaluateAll(row)}
                        >
                          {evaluating === row.id ? 'Evaluating…' : 'Evaluate all'}
                        </button>
                        <button
                          type="button"
                          className="small secondary"
                          onClick={async () => {
                            // Opening or closing a programme decides whether
                            // anybody can be awarded under it. A refusal — a
                            // programme that has since been deleted, a
                            // permission withdrawn mid-session — used to leave
                            // the screen unchanged and the officer guessing
                            // whether the toggle had taken.
                            const next = row.status === 'ACTIVE' ? 'CLOSED' : 'ACTIVE';
                            setError(null);
                            setMessage(null);
                            try {
                              await api.post(`/government/programmes/${row.id}/status`, {
                                status: next,
                              });
                              setMessage(`Programme "${row.name}" is now ${next.toLowerCase()}.`);
                              load();
                            } catch (caught) {
                              if (caught instanceof ApiRequestError) setError(caught.error);
                              else if (caught instanceof Error) {
                                setError({
                                  code: 'CLIENT',
                                  message: caught.message,
                                  moneyStatus: 'NOT_APPLICABLE',
                                });
                              }
                            }
                          }}
                        >
                          {row.status === 'ACTIVE' ? 'Close' : 'Activate'}
                        </button>
                      </>
                    )}
                  </div>
                ),
              },
            ]}
            rows={programmes}
            empty="No incentive programmes have been created."
          />
        )}
      </div>

      {/* Beneficiaries inline panel */}
      {selectedProgramme && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>
              Beneficiaries — {selectedProgramme.name}
            </h3>
            <button type="button" className="small secondary" onClick={() => { setSelectedProgramme(null); setBeneficiaries(null); }}>
              Close
            </button>
          </div>
          {!beneficiaries ? (
            <Loading rows={3} />
          ) : beneficiaries.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: '0.87rem' }}>
              No eligible taxpayers yet. Run "Evaluate all" to assess the active taxpayer population.
            </p>
          ) : (
            <Table
              columns={[
                { key: 'tin', label: 'TIN', render: (row) => <span className="mono">{row.tin ?? '—'}</span> },
                { key: 'name', label: 'Name' },
                { key: 'lga_name', label: 'LGA' },
                { key: 'score', label: 'Score', numeric: true, render: (row) => row.score ?? '—' },
                {
                  key: 'eligible',
                  label: 'Eligible',
                  render: (row) => (
                    <span style={{ color: row.eligible ? 'var(--success, #1a7f3c)' : 'var(--danger, #c0392b)', fontWeight: 600 }}>
                      {row.eligible ? '✓ Yes' : '✗ No'}
                    </span>
                  ),
                },
                {
                  key: 'evaluated_at',
                  label: 'Evaluated',
                  render: (row) => new Date(row.evaluated_at).toLocaleDateString('en-NG'),
                },
              ]}
              rows={beneficiaries}
              empty="No beneficiaries found."
            />
          )}
        </div>
      )}
    </>
  );
}
