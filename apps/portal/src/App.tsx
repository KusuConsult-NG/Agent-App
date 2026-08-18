/**
 * Government portal shell.
 *
 * Navigation is filtered by the signed-in officer's permissions rather than by
 * role name, so the menu always matches what the backend will actually allow
 * (PRD §36). Hiding a link is a convenience; the API is the control.
 *
 * The public verification and referee routes are resolved before any
 * authentication check, because neither requires an account (PRD §43,
 * Addendum §10).
 */

import { useEffect, useState } from 'react';
import { getUser, hasStoredSession, logout, restoreSession, type User } from './lib/api';
import { matchRoute, useRoute } from './router';
import { LoginScreen } from './screens/Login';
import { DashboardScreen, IntelligenceScreen } from './screens/Dashboard';
import { AgentDetailScreen, AgentsScreen, RefereesScreen } from './screens/Agents';
import { TransactionsScreen } from './screens/Transactions';
import { ApprovalsScreen, CommissionsScreen, ReconciliationScreen } from './screens/Finance';
import { AuditScreen, FraudScreen } from './screens/Oversight';
import { SupportScreen, TicketDetailScreen } from './screens/Support';
import { OutstandingScreen } from './screens/Outstanding';
import { CatalogueScreen, ProgrammesScreen } from './screens/Configuration';
import { RefereePortalScreen, VerifyScreen } from './screens/Public';

interface NavItem {
  path: string;
  label: string;
  permission?: string;
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Overview',
    items: [
      { path: '/', label: 'Dashboard', permission: 'report:read:all' },
      { path: '/intelligence', label: 'Revenue intelligence', permission: 'report:read:all' },
      { path: '/transactions', label: 'Transactions', permission: 'payment:read:all' },
    ],
  },
  {
    group: 'Agents',
    items: [
      { path: '/agents', label: 'Agents & clearance', permission: 'agent:read:all' },
      { path: '/referees', label: 'Referees', permission: 'agent:read:all' },
    ],
  },
  {
    group: 'Finance',
    items: [
      // report:financial, not payment:read:all. The screen is the settlement
      // dashboard, and GET /government/settlements requires report:financial or
      // payment:reconcile — neither of which an admin holds, because settlement
      // figures are a finance and audit responsibility rather than an
      // administrative one. Gating on the wider permission put the item in the
      // admin's menu and then answered a 403 when they opened it.
      { path: '/reconciliation', label: 'Reconciliation', permission: 'report:financial' },
      { path: '/commissions', label: 'Commissions', permission: 'commission:read:all' },
      { path: '/approvals', label: 'Approvals', permission: 'approval:review' },
    ],
  },
  {
    group: 'Oversight',
    items: [
      { path: '/fraud', label: 'Fraud & leakage', permission: 'fraud:read' },
      // support:read:all, not support:manage. An auditor holds the first and
      // not the second, and reading the support queue is exactly the kind of
      // thing an auditor is for — the screen hides the reply and status
      // controls from anyone who cannot use them.
      { path: '/support', label: 'Support desk', permission: 'support:read:all' },
      // payment:read:all, which every portal role holds, because the refund
      // queue is the part of this screen everyone should be able to see. The
      // TIN and vehicle-authority queues are guarded separately and the screen
      // shows only the sections the officer may read, rather than the page
      // answering 403 for whoever holds two of the three permissions.
      { path: '/outstanding', label: 'Outstanding work', permission: 'payment:read:all' },
      { path: '/audit', label: 'Audit log', permission: 'audit:read' },
    ],
  },
  {
    group: 'Configuration',
    items: [
      { path: '/catalogue', label: 'Revenue catalogue', permission: 'catalogue:read' },
      { path: '/programmes', label: 'Social incentives', permission: 'incentive:read:all' },
    ],
  },
];

export function App() {
  const [route, navigate] = useRoute();
  const [user, setUser] = useState<User | null>(getUser());
  const [restoring, setRestoring] = useState(hasStoredSession());

  useEffect(() => {
    if (!hasStoredSession()) {
      setRestoring(false);
      return;
    }
    restoreSession()
      .then(setUser)
      .finally(() => setRestoring(false));
  }, []);

  // Public routes, resolved before authentication.
  const verifyMatch = matchRoute(route, '/verify/:code') ?? matchRoute(route, '/verify');
  const refereeMatch = matchRoute(route, '/referee/:token');

  if (refereeMatch) return <RefereePortalScreen token={refereeMatch.token!} />;
  if (verifyMatch) return <VerifyScreen code={verifyMatch.code} />;

  if (restoring) {
    return (
      <div className="login">
        <div className="login__card">
          <p style={{ margin: 0, textAlign: 'center', color: 'var(--muted)' }}>
            Restoring your session…
          </p>
        </div>
      </div>
    );
  }

  if (!user) return <LoginScreen onSignedIn={setUser} />;

  const groups = NAV.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => !item.permission || user.permissions.includes(item.permission),
    ),
  })).filter((group) => group.items.length > 0);

  const activeLabel =
    groups.flatMap((group) => group.items).find((item) => item.path === route)?.label ??
    'Revenue administration';

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <img src="/icon.svg" alt="" width={32} height={32} />
          <div>
            <strong>PSIRS Portal</strong>
            <span>Plateau State Government</span>
          </div>
        </div>

        {groups.map((group) => (
          <nav className="sidebar__group" key={group.group} aria-label={group.group}>
            <p className="sidebar__group-title">{group.group}</p>
            {group.items.map((item) => (
              <a
                key={item.path}
                href={`#${item.path}`}
                aria-current={route === item.path ? 'page' : undefined}
              >
                {item.label}
              </a>
            ))}
          </nav>
        ))}

        <div className="sidebar__footer">
          <p style={{ margin: '0 0 2px', color: '#fff', fontWeight: 650 }}>{user.fullName}</p>
          <p style={{ margin: '0 0 10px', opacity: 0.7 }}>{user.role.replace(/_/g, ' ')}</p>
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              await logout();
              setUser(null);
            }}
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1>{activeLabel}</h1>
          <div className="topbar__meta">
            <div>{new Date().toLocaleDateString('en-NG', { dateStyle: 'full' })}</div>
            <div>Plateau State Internal Revenue Service</div>
          </div>
        </header>

        <div className="content">
          <Routes route={route} navigate={navigate} user={user} />
        </div>
      </div>
    </div>
  );
}

function Routes({
  route,
  navigate,
  user,
}: {
  route: string;
  navigate: (path: string) => void;
  user: User;
}) {
  const agentMatch = matchRoute(route, '/agents/:id');
  const ticketMatch = matchRoute(route, '/support/:id');

  if (matchRoute(route, '/')) return <DashboardScreen navigate={navigate} />;
  if (matchRoute(route, '/intelligence')) return <IntelligenceScreen />;
  if (matchRoute(route, '/transactions')) return <TransactionsScreen />;
  if (matchRoute(route, '/agents')) return <AgentsScreen navigate={navigate} />;
  if (agentMatch) return <AgentDetailScreen agentId={agentMatch.id!} user={user} navigate={navigate} />;
  if (matchRoute(route, '/referees')) return <RefereesScreen />;
  if (matchRoute(route, '/reconciliation')) return <ReconciliationScreen />;
  if (matchRoute(route, '/commissions')) return <CommissionsScreen />;
  if (matchRoute(route, '/approvals')) return <ApprovalsScreen user={user} />;
  if (matchRoute(route, '/fraud')) return <FraudScreen />;
  if (matchRoute(route, '/outstanding')) return <OutstandingScreen />;
  if (matchRoute(route, '/support')) return <SupportScreen navigate={navigate} />;
  if (ticketMatch) return <TicketDetailScreen ticketId={ticketMatch.id!} navigate={navigate} />;
  if (matchRoute(route, '/audit')) return <AuditScreen />;
  if (matchRoute(route, '/catalogue')) return <CatalogueScreen user={user} />;
  if (matchRoute(route, '/programmes')) return <ProgrammesScreen />;

  return (
    <div className="card">
      <p style={{ margin: 0 }}>
        That page does not exist. <a href="#/">Return to the dashboard</a>.
      </p>
    </div>
  );
}
