/**
 * What the Service expects to raise, and what a run rate says it will.
 *
 * The screen that makes every other revenue figure judgeable. Collections
 * without a target are a number an officer reads; collections against a target
 * are a number an officer can act on, and the difference between those two is
 * the whole of this file.
 *
 * TWO THINGS, KEPT VISIBLY APART
 *
 * The target panel is a decision somebody made, on a date, with their name
 * against it. The forecast panel is arithmetic, and it says so — the basis, the
 * confidence, and a sentence explaining what it was computed from, every time,
 * with no way to render the projected figure without them. A forecast shown as
 * a bare number is how an estimate becomes something a Council budgets against.
 *
 * WHY THE ROLLUP IS A REPORT AND NOT A WARNING
 *
 * The State target and the sum of the LGA targets under it usually disagree,
 * because the State figure carries headroom. Presenting that gap as an error
 * would train officers to ignore it. What is worth surfacing is the LGA with no
 * target at all, which is the one that will be invisible all quarter.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api, can, type ApiError, type User } from '../lib/api';
import {
  Alert,
  Badge,
  ErrorAlert,
  Loading,
  Money,
  ReasonRule,
  Stat,
  Table,
  formatDate,
} from '../ui';
import { usePortalI18n } from '../lib/i18n';
import type { TranslationDictionary } from '@psirs/shared';

const SCOPES = ['STATE', 'LGA', 'CATEGORY', 'ITEM', 'AGENT'] as const;
const PERIODS = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'] as const;

const SCOPE_LABEL: Record<string, keyof TranslationDictionary> = {
  STATE: 'ofcTgScopeState',
  LGA: 'ofcTgScopeLga',
  CATEGORY: 'ofcTgScopeCategory',
  ITEM: 'ofcTgScopeItem',
  AGENT: 'ofcTgScopeAgent',
};

const PERIOD_LABEL: Record<string, keyof TranslationDictionary> = {
  DAILY: 'ofcTgPeriodDaily',
  WEEKLY: 'ofcTgPeriodWeekly',
  MONTHLY: 'ofcTgPeriodMonthly',
  QUARTERLY: 'ofcTgPeriodQuarterly',
  ANNUAL: 'ofcTgPeriodAnnual',
};

interface TargetRow {
  id: string;
  scope: string;
  period_kind: string;
  period_start: string;
  period_end: string;
  target_kobo: string;
  collected_kobo: string;
  days_elapsed: number;
  days_in_period: number;
  status: string;
  note: string | null;
  lga_name: string | null;
  category_name: string | null;
  item_name: string | null;
  agent_code: string | null;
  agent_name: string | null;
  set_by_name: string;
}

interface Forecast {
  is_forecast: true;
  basis: string;
  confidence: string;
  period_start: string;
  period_end: string;
  days_elapsed: number;
  days_in_period: number;
  collected_kobo: string;
  projected_kobo: string;
  seasonal_share_bp: number | null;
  comparable_periods: number;
  target_kobo: string | null;
  projected_achievement_bp: number | null;
  explanation_key: string;
}

interface Rollup {
  state_target_kobo: string;
  lga_targets_kobo: string;
  lgas_with_a_target: string;
  lgas_total: string;
  category_targets_kobo: string;
  agent_targets_kobo: string;
}

export function TargetsScreen({ user }: { user: User }) {
  const { t } = usePortalI18n();
  const [rows, setRows] = useState<TargetRow[] | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [rollup, setRollup] = useState<Rollup | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [periodKind, setPeriodKind] = useState('MONTHLY');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [setting, setSetting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ periodKind });
      if (includeInactive) params.set('includeInactive', 'true');

      /*
       * The period comes from the server, not from this browser's clock.
       *
       * A handset with a wrong clock, or a browser in another timezone, would
       * otherwise ask for the rollup of a month that is not the month the
       * targets were set against.
       */
      const period = await api.get<{ periodStart: string; periodEnd: string }>(
        `/government/targets/period?kind=${periodKind}`,
      );

      const [targets, projection, roll] = await Promise.all([
        api.get<TargetRow[]>(`/government/targets?${params.toString()}`),
        api.get<Forecast>(`/government/forecast?periodKind=${periodKind}`),
        api.get<Rollup>(
          `/government/targets/rollup?periodStart=${period.periodStart}&periodEnd=${period.periodEnd}`,
        ),
      ]);
      setRows(targets);
      setForecast(projection);
      setRollup(roll);
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.error : null);
    }
  }, [periodKind, includeInactive]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="card">
        <h2>{t.ofcTgTitle}</h2>
        <p className="muted">{t.ofcTgIntro}</p>

        <div className="filters">
          <label>
            {t.ofcTgPeriod}
            <select value={periodKind} onChange={(event) => setPeriodKind(event.target.value)}>
              {PERIODS.map((period) => (
                <option key={period} value={period}>
                  {t[PERIOD_LABEL[period]!]}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(event) => setIncludeInactive(event.target.checked)}
            />
            {t.ofcTgShowSuperseded}
          </label>
          {can('target:manage') && (
            <button type="button" onClick={() => setSetting((value) => !value)}>
              {t.ofcTgSetTarget}
            </button>
          )}
        </div>
        <ErrorAlert error={error} />
        {notice && <Alert kind="success">{notice}</Alert>}
      </div>

      {setting && (
        <SetTargetForm
          onDone={async (message) => {
            setSetting(false);
            setNotice(message);
            await load();
          }}
        />
      )}

      {forecast && <ForecastPanel forecast={forecast} />}

      {rollup && (
        <div className="card">
          <h3>{t.ofcTgRollup}</h3>
          <p className="muted">{t.ofcTgRollupBody}</p>
          <div className="stat-grid">
            <Stat label="ofcTgStateTarget" value={<Money kobo={rollup.state_target_kobo} />} />
            <Stat label="ofcTgApportioned" value={<Money kobo={rollup.lga_targets_kobo} />} />
            <Stat
              label="ofcTgLgasWithout"
              value={Number(rollup.lgas_total) - Number(rollup.lgas_with_a_target)}
              variant={
                Number(rollup.lgas_total) > Number(rollup.lgas_with_a_target) ? 'alert' : undefined
              }
            />
          </div>
        </div>
      )}

      <div className="card">
        {!rows ? (
          <Loading />
        ) : (
          <Table
            rows={rows}
            empty="ofcNoneTargetsSet"
            columns={[
              {
                key: 'scope',
                label: 'ofcTgScope',
                render: (row: TargetRow) => (
                  <>
                    <strong>{t[SCOPE_LABEL[row.scope] ?? 'ofcTgScopeState']}</strong>
                    {(row.lga_name || row.category_name || row.item_name || row.agent_code) && (
                      <>
                        <br />
                        <span className="muted">
                          {[row.lga_name, row.category_name, row.item_name, row.agent_code]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </>
                    )}
                  </>
                ),
              },
              {
                key: 'period_start',
                label: 'ofcTgPeriod',
                render: (row: TargetRow) => (
                  <>
                    {t[PERIOD_LABEL[row.period_kind] ?? 'ofcTgPeriodMonthly']}
                    <br />
                    <span className="muted">
                      {formatDate(row.period_start)} – {formatDate(row.period_end)}
                    </span>
                  </>
                ),
              },
              {
                key: 'target_kobo',
                label: 'ofcTgTarget',
                numeric: true,
                render: (row: TargetRow) => <Money kobo={row.target_kobo} />,
              },
              {
                key: 'collected_kobo',
                label: 'ofcTgCollected',
                numeric: true,
                render: (row: TargetRow) => <Money kobo={row.collected_kobo} />,
              },
              {
                key: 'achievement',
                label: 'ofcTgAchievement',
                numeric: true,
                render: (row: TargetRow) => <Achievement row={row} />,
              },
              {
                key: 'gap',
                label: 'ofcTgGap',
                numeric: true,
                render: (row: TargetRow) => {
                  const gap = BigInt(row.target_kobo) - BigInt(row.collected_kobo);
                  return gap > 0n ? (
                    <span className="danger-text">
                      <Money kobo={gap.toString()} />
                    </span>
                  ) : (
                    <Money kobo="0" />
                  );
                },
              },
              {
                key: 'status',
                label: 'ofcCwStatus',
                render: (row: TargetRow) =>
                  row.status === 'ACTIVE' && can('target:manage') ? (
                    <WithdrawButton
                      targetId={row.id}
                      onDone={async (message) => {
                        setNotice(message);
                        await load();
                      }}
                    />
                  ) : (
                    <Badge status={row.status} />
                  ),
              },
            ]}
          />
        )}
      </div>
    </>
  );
}

/**
 * Achievement, with how far through the period it was measured.
 *
 * 40% of a monthly target is excellent on the 8th and alarming on the 28th, and
 * a bare percentage says neither. The elapsed fraction beside it is what turns
 * the number into a judgement.
 */
function Achievement({ row }: { row: TargetRow }) {
  const { t } = usePortalI18n();
  const target = BigInt(row.target_kobo);
  if (target <= 0n) return <>—</>;
  const achieved = Number((BigInt(row.collected_kobo) * 1000n) / target) / 10;
  const elapsed = row.days_in_period > 0
    ? Math.round((row.days_elapsed / row.days_in_period) * 100)
    : 0;

  // Behind the pace of the period, with the period still running.
  const behind = achieved < elapsed && row.days_elapsed < row.days_in_period;
  return (
    <>
      <strong className={behind ? 'danger-text' : undefined}>{achieved.toFixed(1)}%</strong>
      <br />
      <span className="muted">
        {elapsed}% {t.ofcTgThroughPeriod}
      </span>
    </>
  );
}

function WithdrawButton({
  targetId,
  onDone,
}: {
  targetId: string;
  onDone: (message: string) => Promise<void>;
}) {
  const { t } = usePortalI18n();
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  if (!open) {
    return (
      <button type="button" className="secondary" onClick={() => setOpen(true)}>
        {t.ofcTgWithdraw}
      </button>
    );
  }

  return (
    <div>
      <ErrorAlert error={error} />
      <input
        value={reason}
        placeholder={t.ofcTgWithdrawReason}
        onChange={(event) => setReason(event.target.value)}
      />
      <ReasonRule value={reason} minimum={10} />
      <button
        type="button"
        disabled={busy || reason.trim().length < 10}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api.post(`/government/targets/${targetId}/withdraw`, { reason: reason.trim() });
            setOpen(false);
            await onDone(t.ofcCwSaved);
          } catch (caught) {
            setError(caught instanceof ApiRequestError ? caught.error : null);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t.ofcTgWithdraw}
      </button>
    </div>
  );
}

/**
 * The projection, and everything needed to judge it.
 *
 * `is_forecast` is on the payload and the heading says so, the basis and the
 * confidence are rendered as badges, and the explanation is a translated
 * sentence rather than an enum an officer has to interpret. There is no code
 * path here that renders `projected_kobo` without them.
 */
function ForecastPanel({ forecast }: { forecast: Forecast }) {
  const { t } = usePortalI18n();
  const explanation = t[forecast.explanation_key as keyof TranslationDictionary] as
    | string
    | undefined;

  return (
    <div className="card">
      <h3>{t.ofcFcTitle}</h3>
      <Alert kind="info">{t.ofcFcNotATarget}</Alert>

      <div className="stat-grid">
        <Stat label="ofcTgCollected" value={<Money kobo={forecast.collected_kobo} />} />
        <Stat
          label="ofcFcProjected"
          value={<Money kobo={forecast.projected_kobo} />}
          variant="accent"
        />
        <Stat label="ofcFcBasis" value={<Badge status={forecast.basis} />} />
        <Stat label="ofcFcConfidence" value={<Badge status={forecast.confidence} />} />
      </div>

      {explanation && <p>{explanation}</p>}

      <dl className="kv-list">
        <dt>{t.ofcTgThroughPeriod}</dt>
        <dd>
          {forecast.days_elapsed} / {forecast.days_in_period}
        </dd>
        {forecast.seasonal_share_bp !== null && (
          <>
            <dt>{t.ofcFcSeasonalShare}</dt>
            <dd>{(forecast.seasonal_share_bp / 100).toFixed(1)}%</dd>
          </>
        )}
        <dt>{t.ofcFcComparablePeriods}</dt>
        <dd>{forecast.comparable_periods}</dd>
        {forecast.target_kobo && (
          <>
            <dt>{t.ofcTgTarget}</dt>
            <dd>
              <Money kobo={forecast.target_kobo} />
            </dd>
          </>
        )}
        {forecast.projected_achievement_bp !== null && (
          <>
            <dt>{t.ofcFcProjectedAchievement}</dt>
            <dd>{(forecast.projected_achievement_bp / 100).toFixed(1)}%</dd>
          </>
        )}
      </dl>
    </div>
  );
}

// ===========================================================================
function SetTargetForm({ onDone }: { onDone: (message: string) => Promise<void> }) {
  const { t } = usePortalI18n();
  const [form, setForm] = useState({
    scope: 'STATE',
    lgaId: '',
    categoryId: '',
    revenueItemId: '',
    periodKind: 'MONTHLY',
    amountNaira: '',
    note: '',
  });
  const [period, setPeriod] = useState<{ periodStart: string; periodEnd: string } | null>(null);
  /*
   * Why the period is missing, when it is.
   *
   * The submit button is disabled while `period` is null and `submit()`
   * returns early on the same condition, so a failed lookup produced a form
   * that would not send and did not say why. The catch wrote `null` and
   * nothing else: no alert, no sentence, nothing on the screen that had
   * changed.
   */
  const [periodError, setPeriodError] = useState<ApiError | null>(null);
  const [lgas, setLgas] = useState<{ id: string; name: string }[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ periodStart: string; periodEnd: string }>(
        `/government/targets/period?kind=${form.periodKind}`,
      )
      .then((loaded) => {
        setPeriod(loaded);
        setPeriodError(null);
      })
      .catch((caught) => {
        setPeriod(null);
        if (caught instanceof ApiRequestError) setPeriodError(caught.error);
        else if (caught instanceof Error) {
          setPeriodError({ code: 'CLIENT', message: caught.message, moneyStatus: 'NOT_APPLICABLE' });
        }
      });
  }, [form.periodKind]);

  useEffect(() => {
    api
      .get<{ id: string; name: string }[]>('/reference/lgas')
      .then(setLgas)
      .catch(() => setLgas([]));
    api
      .get<{ id: string; name: string }[]>('/revenue/categories')
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  async function submit() {
    if (!period) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/government/targets', {
        scope: form.scope,
        lgaId: form.scope === 'LGA' || form.lgaId ? form.lgaId || null : null,
        categoryId: form.scope === 'CATEGORY' ? form.categoryId || null : null,
        revenueItemId: form.scope === 'ITEM' ? form.revenueItemId || null : null,
        periodKind: form.periodKind,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        // Naira on the form, kobo on the wire. An officer plans in naira and
        // every amount the platform stores is kobo.
        amountKobo: String(Math.round(Number(form.amountNaira) * 100)),
        note: form.note.trim() || undefined,
      });
      await onDone(t.ofcCwSaved);
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.error : null);
    } finally {
      setBusy(false);
    }
  }

  const amountValid = Number(form.amountNaira) > 0;

  /*
   * What the form is still waiting for, in words rather than a dead button.
   *
   * Four conditions switch this button off and none of them said so. The
   * pattern is the one the allocations and bank-account screens already use:
   * name the missing thing, so the answer to "why will this not send" is on
   * the screen rather than in the reader's head. Silent while the period is
   * still being fetched — there is nothing wrong yet.
   */
  const blockedBecause = ((): string | null => {
    if (periodError) return null; // Said in full by the alert above the button.
    if (!period) return null;
    if (!amountValid) return t.ofcTgNeedAmount;
    if (form.scope === 'LGA' && !form.lgaId) return t.ofcTgNeedLga;
    if (form.scope === 'CATEGORY' && !form.categoryId) return t.ofcTgNeedCategory;
    return null;
  })();

  return (
    <div className="card">
      <h3>{t.ofcTgSetTarget}</h3>
      <ErrorAlert error={error} />
      <div className="filters">
        <label>
          {t.ofcTgScope}
          <select
            value={form.scope}
            onChange={(event) => setForm({ ...form, scope: event.target.value })}
          >
            {SCOPES.filter((scope) => scope !== 'AGENT').map((scope) => (
              <option key={scope} value={scope}>
                {t[SCOPE_LABEL[scope]!]}
              </option>
            ))}
          </select>
        </label>

        {(form.scope === 'LGA' || form.scope === 'CATEGORY' || form.scope === 'ITEM') && (
          <label>
            {t.ofcTgScopeLga}
            <select
              value={form.lgaId}
              onChange={(event) => setForm({ ...form, lgaId: event.target.value })}
            >
              <option value="">{t.ofcAllLgas}</option>
              {lgas.map((lga) => (
                <option key={lga.id} value={lga.id}>
                  {lga.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {form.scope === 'CATEGORY' && (
          <label>
            {t.ofcTgScopeCategory}
            <select
              value={form.categoryId}
              onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
            >
              <option value="">—</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label>
          {t.ofcTgPeriod}
          <select
            value={form.periodKind}
            onChange={(event) => setForm({ ...form, periodKind: event.target.value })}
          >
            {PERIODS.map((option) => (
              <option key={option} value={option}>
                {t[PERIOD_LABEL[option]!]}
              </option>
            ))}
          </select>
        </label>

        <label>
          {t.ofcTgAmount}
          <input
            type="number"
            min="1"
            value={form.amountNaira}
            onChange={(event) => setForm({ ...form, amountNaira: event.target.value })}
          />
        </label>
      </div>

      {period && (
        <p className="muted">
          {formatDate(period.periodStart)} – {formatDate(period.periodEnd)}
        </p>
      )}

      <ErrorAlert error={periodError} />

      <label>
        {t.ofcTgNote}
        <textarea
          rows={2}
          value={form.note}
          onChange={(event) => setForm({ ...form, note: event.target.value })}
        />
      </label>

      {blockedBecause && (
        <p className="muted" role="status">
          {blockedBecause}
        </p>
      )}

      <button
        type="button"
        disabled={
          busy ||
          !period ||
          !amountValid ||
          (form.scope === 'LGA' && !form.lgaId) ||
          (form.scope === 'CATEGORY' && !form.categoryId)
        }
        onClick={submit}
      >
        {busy ? '…' : t.ofcTgSetTarget}
      </button>
    </div>
  );
}
