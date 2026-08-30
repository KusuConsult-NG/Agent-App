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
  status: string;
  status_reason: string | null;
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
  const [withdrawing, setWithdrawing] = useState<RevenueItem | null>(null);
  const [creating, setCreating] = useState(false);

  /*
   * Who may read a rate's history.
   *
   * `/government/audit/queries/rate-changes` is guarded on `audit:read` or
   * `catalogue:configure`, deliberately: what the rate used to be is public,
   * but who changed it, when and why is administrative information. A
   * supervisor holds neither and is offered this screen, so the History button
   * beside every row answered 403 for them — a control the platform advertises
   * and refuses.
   */
  const canReadRateHistory = can('audit:read') || can('catalogue:configure');

  const load = useCallback(() => {
    api
      // An officer configuring the catalogue sees what has been withdrawn as
      // well as what is on sale — otherwise a suspended item disappears the
      // moment it is suspended and nobody can ever restore it.
      .get<RevenueItem[]>(
        can('catalogue:configure') ? '/revenue/items?includeWithdrawn=true' : '/revenue/items',
      )
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
        <div className="card__header">
          <div>
            <h2 className="card__title">{t.ofcNavCatalogue}</h2>
            <p className="card__hint">
              Revenue items and their rates are government configuration, not code. Changing a rate
              creates a new version with an effective date — it never rewrites what was already
              assessed.
            </p>
          </div>
          {can('catalogue:configure') && !creating && (
            <button type="button" className="small" onClick={() => setCreating(true)}>
              Add a revenue item
            </button>
          )}
        </div>
      </div>

      {creating && (
        <NewItemForm
          onCancel={() => setCreating(false)}
          onDone={(note) => {
            setCreating(false);
            setMessage(note);
            load();
          }}
        />
      )}

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      {withdrawing && (
        <WithdrawItemForm
          item={withdrawing}
          onCancel={() => setWithdrawing(null)}
          onDone={(note) => {
            setWithdrawing(null);
            setMessage(note);
            load();
          }}
        />
      )}

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
              { key: 'version', label: 'ofcAgVersion', numeric: true },
              { key: 'rate_type', label: 'tpType' },
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
                label: 'ofcAgReason',
                render: (row) => row.decision_reason ?? row.requested_reason ?? '—',
              },
            ]}
            rows={history.rows}
            empty="ofcNoneRateHistory"
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
              { key: 'code', label: 'ofcAgCode', render: (row) => <span className="mono">{row.code}</span> },
              { key: 'name', label: 'colRevenueItem' },
              { key: 'category_name', label: 'ofcAgCategory' },
              { key: 'frequency', label: 'Frequency', render: (row) => <Badge status={row.frequency} /> },
              { key: 'rate', label: 'Current rate', render: (row) => describeRate(row) },
              {
                key: 'version',
                label: 'ofcAgVersion',
                numeric: true,
                render: (row) => row.version ?? '—',
              },
              {
                key: 'commission_eligible',
                label: 'navCommission',
                render: (row) => (row.commission_eligible ? 'Eligible' : 'Not eligible'),
              },
              {
                key: 'status',
                label: 'On sale',
                render: (row) =>
                  row.status === 'ACTIVE' ? (
                    <Badge status="ACTIVE" />
                  ) : (
                    <span title={row.status_reason ?? undefined}>
                      <Badge status={row.status} />
                    </span>
                  ),
              },
              {
                key: 'action',
                label: '',
                render: (row) => (
                  <div className="button-row">
                    {canReadRateHistory && (
                      <button
                        type="button"
                        className="small secondary"
                        onClick={async () => {
                          const rows = await api.get<any[]>(
                            `/government/audit/queries/rate-changes?revenueItemId=${row.id}`,
                          );
                          setHistory({ item: row, rows });
                        }}
                      >{t.colHistory}</button>
                    )}
                    {can('catalogue:configure') && row.status === 'ACTIVE' && (
                      <button type="button" className="small" onClick={() => setEditing(row)}>
                        Change rate
                      </button>
                    )}
                    {can('catalogue:configure') && row.status !== 'RETIRED' && (
                      <button
                        type="button"
                        className="small secondary"
                        onClick={() => setWithdrawing(row)}
                      >
                        {row.status === 'ACTIVE' ? 'Withdraw' : 'Restore'}
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
            rows={items}
            empty="ofcNoneRevenueItemsConfigured"
          />
        )}
      </div>
    </>
  );
}

/**
 * Adding a revenue item to the catalogue.
 *
 * `POST /revenue/items` existed, was permission-guarded, was audited, and was
 * called from nowhere. The catalogue screen could reprice an item, withdraw it
 * and restore it — everything except bring one into existence. A new bye-law
 * meant a database insert by hand, which is the state of affairs this platform
 * was built to end.
 *
 * A new item is created without a rate, deliberately: `POST /revenue/items`
 * takes no price and `POST /revenue/items/:id/rates` requires a reason and a
 * step-up, because setting what a citizen must pay is a separate decision from
 * naming the thing they pay it for. That is right, and it is not guessable
 * from a form, so the outcome message says so — an item with no rate cannot be
 * assessed in the field, and an officer who thinks they have finished has left
 * agents with a levy they cannot charge.
 */
function NewItemForm({
  onCancel,
  onDone,
}: {
  onCancel: () => void;
  onDone: (message: string) => void;
}) {
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    categoryId: '',
    code: '',
    name: '',
    description: '',
    frequency: 'ANNUAL',
    selfAssessable: false,
    commissionEligible: true,
    applicableTaxpayerTypes: ['INDIVIDUAL', 'BUSINESS'] as string[],
  });

  useEffect(() => {
    api
      .get<{ id: string; name: string }[]>('/revenue/categories')
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  const toggleType = (type: string) =>
    setForm({
      ...form,
      applicableTaxpayerTypes: form.applicableTaxpayerTypes.includes(type)
        ? form.applicableTaxpayerTypes.filter((entry) => entry !== type)
        : [...form.applicableTaxpayerTypes, type],
    });

  return (
    <div className="card">
      <div className="card__header">
        <div>
          <h2 className="card__title">New revenue item</h2>
          <p className="card__hint">
            The item is created without a price. Set its rate afterwards with “Change rate” — until
            you do, an agent cannot assess it in the field.
          </p>
        </div>
        <button type="button" className="small secondary" onClick={onCancel}>{t.camCancel}</button>
      </div>

      <ErrorAlert error={error} />

      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api.post<{ revenueItemId: string }>('/revenue/items', {
              categoryId: form.categoryId,
              code: form.code.trim().toUpperCase(),
              name: form.name.trim(),
              description: form.description.trim() || undefined,
              frequency: form.frequency,
              selfAssessable: form.selfAssessable,
              commissionEligible: form.commissionEligible,
              applicableTaxpayerTypes: form.applicableTaxpayerTypes,
            });
            onDone(
              `${form.name.trim()} has been added to the catalogue. It has no rate yet, so it ` +
                'cannot be assessed until you set one.',
            );
          } catch (caught) {
            if (caught instanceof ApiRequestError) setError(caught.error);
            else if (caught instanceof Error) {
              setError({ code: 'CLIENT', message: caught.message, moneyStatus: 'NOT_APPLICABLE' });
            }
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="filters">
          <div className="field">
            <label htmlFor="new-item-category">{t.ofcAgCategory}</label>
            <select
              id="new-item-category"
              required
              value={form.categoryId}
              onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
            >
              <option value="">Choose a category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="new-item-code">{t.ofcAgCode}</label>
            <input
              id="new-item-code"
              required
              minLength={2}
              maxLength={40}
              placeholder="MARKET-LEVY"
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="new-item-name">{t.tpName}</label>
            <input
              id="new-item-name"
              required
              minLength={2}
              maxLength={200}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="new-item-frequency">How often it is charged</label>
            <select
              id="new-item-frequency"
              value={form.frequency}
              onChange={(event) => setForm({ ...form, frequency: event.target.value })}
            >
              {['ONE_OFF', 'DAILY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'].map((frequency) => (
                <option key={frequency} value={frequency}>
                  {frequency.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="new-item-description">What it is for</label>
          <input
            id="new-item-description"
            maxLength={1000}
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </div>

        <fieldset style={{ border: 0, padding: 0, margin: '0 0 14px' }}>
          <legend style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>Who it applies to</legend>
          <div className="button-row">
            {['INDIVIDUAL', 'BUSINESS'].map((type) => (
              <label key={type} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={form.applicableTaxpayerTypes.includes(type)}
                  onChange={() => toggleType(type)}
                />
                {type === 'INDIVIDUAL' ? 'Individuals' : 'Businesses'}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="button-row" style={{ marginBottom: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={form.selfAssessable}
              onChange={(event) => setForm({ ...form, selfAssessable: event.target.checked })}
            />
            A taxpayer may assess this themselves
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={form.commissionEligible}
              onChange={(event) => setForm({ ...form, commissionEligible: event.target.checked })}
            />
            An agent earns commission on it
          </label>
        </div>

        <button
          type="submit"
          disabled={busy || form.applicableTaxpayerTypes.length === 0 || !form.categoryId}
        >
          {busy ? 'Adding…' : 'Add to the catalogue'}
        </button>
      </form>
    </div>
  );
}

/**
 * Withdrawing a revenue item, or putting it back.
 *
 * Two things the officer has to be told before they press it, because neither
 * is guessable: what happens to money already owed (nothing — invoices raised
 * under the old rule stay payable), and that retiring cannot be undone.
 */
function WithdrawItemForm({
  item,
  onCancel,
  onDone,
}: {
  item: RevenueItem;
  onCancel: () => void;
  onDone: (message: string) => void;
}) {
  const restoring = item.status !== 'ACTIVE';
  const [status, setStatus] = useState(restoring ? 'ACTIVE' : 'SUSPENDED');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  return (
    <div className="card">
      <div className="card__header">
        <div>
          <h2 className="card__title">
            {restoring ? 'Restore' : 'Withdraw'} — {item.name}
          </h2>
          <p className="card__hint">
            {restoring
              ? 'The item goes back into the catalogue and can be assessed against again.'
              : 'No new assessment can be raised against a withdrawn item. Invoices already issued stay payable — withdrawing an item is not a decision to write off arrears.'}
          </p>
        </div>
        <button type="button" className="small secondary" onClick={onCancel}>{t.camCancel}</button>
      </div>

      <ErrorAlert error={error} />

      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const result = await api.post<{ message: string }>(
              `/revenue/items/${item.id}/status`,
              { status, reason },
            );
            onDone(result.message);
          } catch (caught) {
            if (caught instanceof ApiRequestError) setError(caught.error);
            else if (caught instanceof Error) {
              setError({ code: 'CLIENT', message: caught.message, moneyStatus: 'NOT_APPLICABLE' });
            }
          } finally {
            setBusy(false);
          }
        }}
      >
        {!restoring && (
          <label>
            What is happening to this item
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="SUSPENDED">Suspend — pause collection while something is settled</option>
              <option value="RETIRED">Retire — the charge has ended, and cannot be brought back</option>
            </select>
          </label>
        )}

        <label>{t.ofcAgReason}<textarea
            required
            minLength={5}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={
              restoring
                ? 'What changed — for example, the tariff was confirmed against the gazette.'
                : 'For example: repealed by the Plateau State Finance Law amendment.'
            }
          />
        </label>

        {status === 'RETIRED' && (
          <Alert kind="warning">
            Retiring cannot be undone. If the charge is reintroduced later it needs a new revenue
            item, with its own code and rate.
          </Alert>
        )}

        <div className="button-row">
          <button type="submit" disabled={busy || reason.trim().length < 5}>
            {busy ? 'Saving…' : restoring ? 'Restore item' : 'Withdraw item'}
          </button>
        </div>
      </form>
    </div>
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
        <button type="button" className="secondary" onClick={onCancel}>{t.camCancel}</button>
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
              { key: 'code', label: 'ofcAgCode', render: (row) => <span className="mono">{row.code}</span> },
              { key: 'benefit_type', label: 'Benefit' },
              { key: 'minimum_score', label: 'Min. score', numeric: true },
              {
                key: 'requires_no_arrears',
                label: 'Requires no arrears',
                render: (row) => (row.requires_no_arrears ? 'Yes' : 'No'),
              },
              { key: 'eligible_taxpayers', label: 'Eligible', numeric: true },
              { key: 'status', label: 'appStatus', render: (row) => <Badge status={row.status} /> },
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
            empty="ofcNoneIncentiveProgrammesCreated"
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
                { key: 'tin', label: 'tpStepTin', render: (row) => <span className="mono">{row.tin ?? '—'}</span> },
                { key: 'name', label: 'tpName' },
                { key: 'lga_name', label: 'tpLgaShort' },
                { key: 'score', label: 'ofcAgScore', numeric: true, render: (row) => row.score ?? '—' },
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
              empty="ofcNoneBeneficiariesFound"
            />
          )}
        </div>
      )}
    </>
  );
}
