/** Agent home screen (PRD §29, §56). */

import { useEffect, useState } from 'react';
import { ApiRequestError, api, type ApiError } from '../lib/api';
import { Alert, ErrorAlert, Icons, Loading, Money } from '../ui';

interface HomeData {
  today: { collected_kobo: string; successful: string; total: string; pending: string };
  commission: { lifetime_kobo: string; available_kobo: string; today_kobo: string };
  taxpayersOnboarded: { today: string; total: string };
  recentTransactions: {
    transaction_reference: string;
    amount_kobo: string;
    status: string;
    revenue_item: string;
    taxpayer_name: string;
    receipt_number: string | null;
    created_at: string;
  }[];
}

const QUICK_ACTIONS = [
  { href: '#/taxpayers/new', label: 'Register taxpayer', icon: Icons.add },
  { href: '#/collect', label: 'Collect revenue', icon: Icons.collect },
  { href: '#/vehicles', label: 'Renew vehicle', icon: Icons.vehicle },
  { href: '#/taxpayers', label: 'Find taxpayer', icon: Icons.search },
];

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function HomeScreen({ navigate }: { navigate: (path: string) => void }) {
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
              ? 'Your agent account is suspended'
              : 'Your application is still being processed'
          }
        >
          <p style={{ margin: 0 }}>{error.message}</p>
        </Alert>
        <button type="button" onClick={() => navigate('/application')}>
          View my application
        </button>
      </>
    );
  }

  if (loading) return <Loading rows={4} />;
  if (error) return <ErrorAlert error={error} />;
  if (!data) return null;

  return (
    <>
      <p style={{ margin: '0 0 10px', fontSize: '0.9rem', color: 'var(--muted)' }}>{greeting()}</p>

      <section className="headline">
        <p className="headline__label">Collected today</p>
        <p className="headline__amount">
          <Money kobo={data.today.collected_kobo} />
        </p>
        <div className="headline__stats">
          <div>
            <strong>{data.today.successful}</strong>
            transactions
          </div>
          <div>
            <strong>
              <Money kobo={data.commission.today_kobo} />
            </strong>
            commission
          </div>
          <div>
            <strong>{data.taxpayersOnboarded.today}</strong>
            registered
          </div>
        </div>
      </section>

      {Number(data.today.pending) > 0 && (
        <Alert kind="warning" title={`${data.today.pending} payment(s) awaiting confirmation`}>
          <p style={{ margin: 0 }}>
            These are not yet confirmed. Do not ask the taxpayer to pay again — open the transaction
            to check its status.
          </p>
        </Alert>
      )}

      <p className="section-title">Quick actions</p>
      <div className="grid-2">
        {QUICK_ACTIONS.map((action) => (
          <a key={action.href} className="quick-action" href={action.href}>
            <action.icon />
            {action.label}
          </a>
        ))}
      </div>

      <p className="section-title">Recent transactions</p>
      <div className="card card--flush">
        {data.recentTransactions.length === 0 ? (
          <p className="empty">No transactions yet. Start by registering or finding a taxpayer.</p>
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
                      {transaction.revenue_item} ·{' '}
                      {transaction.receipt_number ?? transaction.status.replace(/_/g, ' ').toLowerCase()}
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

      <p className="section-title">Lifetime</p>
      <div className="card">
        <div className="kv">
          <dt>Taxpayers registered</dt>
          <dd>{data.taxpayersOnboarded.total}</dd>
        </div>
        <div className="kv">
          <dt>Commission earned</dt>
          <dd>
            <Money kobo={data.commission.lifetime_kobo} />
          </dd>
        </div>
        <div className="kv">
          <dt>Available for payout</dt>
          <dd>
            <Money kobo={data.commission.available_kobo} />
          </dd>
        </div>
      </div>
    </>
  );
}
