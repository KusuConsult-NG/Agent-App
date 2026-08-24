/**
 * Government portal shell.
 *
 * Navigation is filtered by the signed-in officer's permissions rather than by
 * role name, so the menu always matches what the backend will actually allow
 * (PRD §36). Hiding a link is a convenience; the API is the control.
 *
 * The table that does the filtering lives in `lib/permissions.ts` so it can be
 * tested without a DOM — see the note there on the two gate bugs that reached
 * users because nothing checked it.
 *
 * The public verification and referee routes are resolved before any
 * authentication check, because neither requires an account (PRD §43,
 * Addendum §10).
 */

import { useEffect, useState } from 'react';
import { getUser, hasStoredSession, logout, restoreSession, type User } from './lib/api';
import { availableGroups, belongsInPortal, isReadOnly, landingPath } from './lib/permissions';
import { matchRoute, useRoute } from './router';
import { LoginScreen } from './screens/Login';
import { DashboardScreen, IntelligenceScreen } from './screens/Dashboard';
import { AgentDetailScreen, AgentsScreen, RefereesScreen } from './screens/Agents';
import { UserAccessScreen } from './screens/UserAccess';
import { TaxpayerRecordsScreen } from './screens/TaxpayerRecords';
import { PerformanceScreen } from './screens/Performance';
import { UsageScreen } from './screens/Usage';
import { TransactionsScreen } from './screens/Transactions';
import { ApprovalsScreen, CommissionsScreen, ReconciliationScreen } from './screens/Finance';
import { AuditScreen, FraudScreen } from './screens/Oversight';
import { SupportScreen, TicketDetailScreen } from './screens/Support';
import { OutstandingScreen } from './screens/Outstanding';
import { CatalogueScreen, ProgrammesScreen } from './screens/Configuration';
import { CitizenPortalScreen, RefereePortalScreen, GroupAttestationScreen, VerifyScreen } from './screens/Public';
import { AllocationRoundScreen, GroupsScreen } from './screens/Groups';

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
      .then((restored) => {
        // The same door check the login screen applies. A field agent who
        // signed in before this existed still has a stored session, and
        // restoring it would put them back in the one-item shell.
        setUser(restored && belongsInPortal(restored.role) ? restored : null);
      })
      .finally(() => setRestoring(false));
  }, []);

  /*
   * Land on a screen this officer can actually open.
   *
   * '/' renders the executive dashboard, which needs report:read:all. A
   * supervisor does not hold it, so signing in put them on "Your role
   * (supervisor) is not permitted to perform this action" — their first and
   * only impression of the portal, on a screen the menu had already decided not
   * to offer them.
   *
   * The menu is the authority on what a role may open, so the landing page is
   * taken from the same filter rather than assumed to be the dashboard.
   */
  useEffect(() => {
    if (!user || route !== '/') return;
    const first = landingPath(user);
    if (first && first !== '/') navigate(first);
  }, [user, route, navigate]);

  // Public routes, resolved before authentication.
  const verifyMatch = matchRoute(route, '/verify/:code') ?? matchRoute(route, '/verify');
  const refereeMatch = matchRoute(route, '/referee/:token');
  const attestationMatch = matchRoute(route, '/group-attestation/:token');
  const citizenMatch = matchRoute(route, '/citizen');

  if (refereeMatch) return <RefereePortalScreen token={refereeMatch.token!} />;
  if (attestationMatch) return <GroupAttestationScreen token={attestationMatch.token!} />;
  if (verifyMatch) return <VerifyScreen code={verifyMatch.code} />;
  if (citizenMatch) return <CitizenPortalScreen />;

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

  const groups = availableGroups(user);
  const available = groups.flatMap((group) => group.items);
  const readOnly = isReadOnly(user);

  /*
   * The heading names the screen, including the ones the menu does not list.
   *
   * Detail screens are reached from a list rather than from the sidebar, so
   * exact-matching the menu left an officer looking at one allocation round
   * under a heading that said "Revenue administration" — true of every page
   * and therefore useful on none. Falling back to the section the route sits
   * under says where they are.
   */
  const activeLabel =
    available.find((item) => item.path === route)?.label ??
    available.find((item) => item.path !== '/' && route.startsWith(item.path))?.label ??
    SECTION_LABELS[`/${route.split('/')[1]}`] ??
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
          <p style={{ margin: '0 0 10px', opacity: 0.7 }}>
            {user.role.replace(/_/g, ' ')}
            {/*
             * Say it, rather than leaving it to be inferred from an absence.
             *
             * An auditor holds no permission that changes anything — that is
             * the whole point of the role, and it is part of the control
             * environment a reviewer is entitled to observe. Until now the
             * portal expressed it only by not rendering buttons, which is
             * indistinguishable from a portal that forgot to.
             */}
            {readOnly && <span className="sidebar__tag">read-only</span>}
          </p>
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

/** Headings for screens reached from a list rather than from the menu. */
const SECTION_LABELS: Record<string, string> = {
  '/allocations': 'Distribution round',
};

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
  const roundMatch = matchRoute(route, '/allocations/:id');

  if (matchRoute(route, '/')) return <DashboardScreen navigate={navigate} />;
  if (matchRoute(route, '/intelligence')) return <IntelligenceScreen />;
  if (matchRoute(route, '/transactions')) return <TransactionsScreen />;
  if (matchRoute(route, '/agents')) return <AgentsScreen navigate={navigate} />;
  if (agentMatch) return <AgentDetailScreen agentId={agentMatch.id!} user={user} navigate={navigate} />;
  if (matchRoute(route, '/referees')) return <RefereesScreen />;
  if (matchRoute(route, '/performance')) return <PerformanceScreen navigate={navigate} />;
  if (matchRoute(route, '/usage')) return <UsageScreen />;
  if (matchRoute(route, '/reconciliation')) return <ReconciliationScreen />;
  if (matchRoute(route, '/commissions')) return <CommissionsScreen />;
  if (matchRoute(route, '/approvals')) return <ApprovalsScreen user={user} />;
  if (matchRoute(route, '/fraud')) return <FraudScreen />;
  if (matchRoute(route, '/outstanding')) return <OutstandingScreen />;
  if (matchRoute(route, '/support')) return <SupportScreen navigate={navigate} />;
  if (ticketMatch) return <TicketDetailScreen ticketId={ticketMatch.id!} navigate={navigate} />;
  if (matchRoute(route, '/audit')) return <AuditScreen />;
  if (matchRoute(route, '/users')) return <UserAccessScreen user={user} />;
  if (matchRoute(route, '/taxpayer-records')) return <TaxpayerRecordsScreen user={user} />;
  if (matchRoute(route, '/catalogue')) return <CatalogueScreen user={user} />;
  if (matchRoute(route, '/programmes')) return <ProgrammesScreen />;
  if (matchRoute(route, '/groups')) return <GroupsScreen navigate={navigate} />;
  if (roundMatch) return <AllocationRoundScreen roundId={roundMatch.id!} />;

  return (
    <div className="card">
      <p style={{ margin: 0 }}>
        That page does not exist. <a href="#/">Return to the dashboard</a>.
      </p>
    </div>
  );
}
