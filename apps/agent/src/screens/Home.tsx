/** Agent home screen (PRD §29, §56). */

import { useEffect, useState } from 'react';
import { ApiRequestError, api, type ApiError } from '../lib/api';
import { Alert, ErrorAlert, Icons, Loading, Money } from '../ui';
import { useI18n } from '../lib/i18n';
import type { TranslationDictionary } from '@psirs/shared';
import { enumLabel, localName } from '@psirs/shared';

interface HomeData {
  today: { collected_kobo: string; successful: string; total: string; pending: string };
  commission: { lifetime_kobo: string; available_kobo: string; today_kobo: string };
  taxpayersOnboarded: { today: string; total: string };
  recentTransactions: {
    transaction_reference: string;
    amount_kobo: string;
    status: string;
    revenue_item: string;
    revenue_item_ha: string | null;
    taxpayer_name: string;
    receipt_number: string | null;
    created_at: string;
  }[];
}

const QUICK_ACTIONS = [
  { href: '#/taxpayers/new', label: 'tpRegisterTaxpayer', icon: Icons.add },
  { href: '#/collect', label: 'tpCollectRevenue', icon: Icons.collect },
  { href: '#/vehicles', label: 'homeQaRenewVehicle', icon: Icons.vehicle },
  { href: '#/taxpayers', label: 'homeQaFindTaxpayer', icon: Icons.search },
  // Agents are asked "is this receipt real?" in the field constantly; until
  // now answering meant leaving the application.
  { href: '#/verify', label: 'homeQaCheckReceipt', icon: Icons.receipt },
  // The collection point. Reachable from here rather than from a tab, because
  // a distribution is a season's work for an agent rather than a daily one —
  // but reachable, which the Profile screen was not until somebody looked.
  { href: '#/collections', label: 'homeQaHandOut', icon: Icons.check },
  // Registering a cooperative is how a whole market reaches the register at
  // once. The endpoint was written for an agent on a bound handset and had no
  // screen behind it at all.
  { href: '#/groups', label: 'homeQaGroups', icon: Icons.people },
] as const satisfies readonly { href: string; label: keyof TranslationDictionary; icon: unknown }[];

function greetingKey(): keyof TranslationDictionary {
  const hour = new Date().getHours();
  if (hour < 12) return 'homeGoodMorning';
  if (hour < 17) return 'homeGoodAfternoon';
  return 'homeGoodEvening';
}

export function HomeScreen({ navigate }: { navigate: (path: string) => void }) {
  const { lang, t } = useI18n();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<HomeData>('/agents/me/home')
      .then(setData)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      })
      .finally(() => setLoading(false));
  }, []);

  // An agent who is not yet cleared is sent to their application rather than
  // shown an empty dashboard (Addendum §25).
  if (error && ['AGENT_NOT_CLEARED', 'AGENT_SUSPENDED'].includes(error.code)) {
    return (
      <>
        <Alert
          kind={error.code === 'AGENT_SUSPENDED' ? 'error' : 'info'}
          title={
            error.code === 'AGENT_SUSPENDED'
              ? t.homeAccountSuspended
              : t.homeApplicationProcessing
          }
        >
          <p style={{ margin: 0 }}>{error.message}</p>
        </Alert>
        <button type="button" onClick={() => navigate('/application')}>
          {t.homeViewApplication}
        </button>
      </>
    );
  }

  if (loading) return <Loading rows={4} />;
  if (error) return <ErrorAlert error={error} />;
  if (!data) return null;

  return (
    <>
      <p style={{ margin: '0 0 10px', fontSize: '0.9rem', color: 'var(--muted)' }}>{t[greetingKey()]}</p>

      <section className="headline">
        <p className="headline__label">{t.homeCollectedToday}</p>
        <p className="headline__amount">
          <Money kobo={data.today.collected_kobo} />
        </p>
        <div className="headline__stats">
          <div>
            <strong>{data.today.successful}</strong>
            {t.homeTransactions}
          </div>
          <div>
            <strong>
              <Money kobo={data.commission.today_kobo} />
            </strong>
            {t.homeCommissionWord}
          </div>
          <div>
            <strong>{data.taxpayersOnboarded.today}</strong>
            {t.homeRegisteredWord}
          </div>
        </div>
      </section>

      {Number(data.today.pending) > 0 && (
        <Alert
          kind="warning"
          title={t.homePendingTitle.replace('{{n}}', String(data.today.pending))}
        >
          <p style={{ margin: 0 }}>{t.homePendingBody}</p>
        </Alert>
      )}

      <p className="section-title">{t.homeQuickActions}</p>
      <div className="grid-2">
        {QUICK_ACTIONS.map((action) => (
          <a key={action.href} className="quick-action" href={action.href}>
            <action.icon />
            {t[action.label]}
          </a>
        ))}
      </div>

      <p className="section-title">{t.homeRecentTransactions}</p>
      <div className="card card--flush">
        {data.recentTransactions.length === 0 ? (
          <p className="empty">{t.homeNoTransactions}</p>
        ) : (
          <ul className="list">
            {data.recentTransactions.map((transaction) => (
              <li key={transaction.transaction_reference}>
                <button
                  type="button"
                  className="list__item"
                  onClick={() => navigate(`/transactions/${transaction.transaction_reference}`)}
                >
                  <div className="list__body">
                    <p className="list__title">{transaction.taxpayer_name}</p>
                    <p className="list__meta">
                      {localName(lang, transaction.revenue_item, transaction.revenue_item_ha)} ·{' '}
                      {transaction.receipt_number ?? enumLabel(transaction.status, t)}
                    </p>
                  </div>
                  <span className="list__amount">
                    <Money kobo={transaction.amount_kobo} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="section-title">{t.homeLifetime}</p>
      <div className="card">
        <div className="kv">
          <dt>{t.homeTaxpayersRegistered}</dt>
          <dd>{data.taxpayersOnboarded.total}</dd>
        </div>
        <div className="kv">
          <dt>{t.homeCommissionEarned}</dt>
          <dd>
            <Money kobo={data.commission.lifetime_kobo} />
          </dd>
        </div>
        <div className="kv">
          <dt>{t.homeAvailableForPayout}</dt>
          <dd>
            <Money kobo={data.commission.available_kobo} />
          </dd>
        </div>
      </div>
    </>
  );
}
