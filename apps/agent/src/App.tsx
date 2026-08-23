/**
 * Application shell.
 *
 * Owns three things that must be true everywhere:
 *   * session state and restoration;
 *   * the connection banner (Addendum §24), always visible so an agent never
 *     has to guess whether a payment can be attempted;
 *   * the version gate (Addendum §43) — an unsupported build is stopped here
 *     rather than at the moment money is about to move.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  APP_VERSION,
  api,
  ApiRequestError,
  getUser,
  hasStoredSession,
  isConnectivityFailure,
  logout,
  restoreSession,
  type Session,
} from './lib/api';
import {
  CONNECTION_COPY,
  detectConnectionState,
  watchConnection,
  type ConnectionState,
} from './lib/device';
import { pendingDrafts, requestBackgroundSync, syncDrafts } from './lib/drafts';
import { useI18n } from './lib/i18n';
import { matchRoute, useRoute } from './router';
import { Alert, Icons } from './ui';
import { ApplyScreen, LoginScreen } from './screens/Auth';
import { ApplicationScreen } from './screens/Application';
import { HomeScreen } from './screens/Home';
import { RegisterTaxpayerScreen, TaxpayerScreen, TaxpayersScreen } from './screens/Taxpayers';
import { CollectScreen, TransactionScreen } from './screens/Collect';
import {
  BankAccountScreen,
  CommissionScreen,
  ProfileScreen,
  ReceiptsScreen,
  VehiclesScreen,
} from './screens/More';
import { VerifyScreen } from './screens/Verify';
import { CollectionScreen } from './screens/Collection';
import { RaiseTicketScreen, SupportScreen, TicketScreen } from './screens/Support';

interface VersionState {
  supported: boolean;
  minimumVersion: string;
  recommendedVersion: string;
  message: string;
}

export function App() {
  const [route, navigate] = useRoute();
  const { lang, t, setLanguage } = useI18n();
  const [session, setSession] = useState<Session['user'] | null>(getUser());
  const [restoring, setRestoring] = useState(hasStoredSession());
  const [connection, setConnection] = useState<ConnectionState>(detectConnectionState);
  const [version, setVersion] = useState<VersionState | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  /**
   * A sync that failed for a reason retrying cannot mend.
   *
   * Losing the connection is not this: that resolves itself and is already
   * reported by the connection banner. This is the server refusing the
   * captures — an unregistered handset, a clearance withdrawn — where the
   * queue would otherwise sit at "waiting to send" for ever with the reason
   * known to the server and to nobody else.
   */
  const [syncProblem, setSyncProblem] = useState<{ message: string; nextStep?: string } | null>(
    null,
  );

  useEffect(() => watchConnection(setConnection), []);

  useEffect(() => {
    if (!hasStoredSession()) {
      setRestoring(false);
      return;
    }
    restoreSession()
      .then((restored) => setSession(restored?.user ?? null))
      .finally(() => setRestoring(false));
  }, []);

  const refreshPending = useCallback(() => {
    pendingDrafts().then((drafts) => setPendingCount(drafts.length));
  }, []);

  useEffect(() => {
    refreshPending();
  }, [refreshPending, route]);

  /** Push queued captures as soon as the connection is usable again. */
  const runSync = useCallback(async () => {
    if (!session || connection === 'OFFLINE') return;
    try {
      const outcome = await syncDrafts((drafts) => api.post('/drafts/sync', { drafts }));
      if (outcome.synced > 0 || outcome.rejected > 0) {
        setSyncMessage(
          `${outcome.synced} saved record(s) sent to PSIRS` +
            (outcome.rejected > 0 ? `, ${outcome.rejected} need correction` : '') +
            '.',
        );
      }
      setSyncProblem(null);
      refreshPending();
    } catch (caught) {
      if (isConnectivityFailure(caught)) {
        // The signal went, which is what the queue is for. Ask the browser to
        // try again later and say nothing: the connection banner already has it.
        requestBackgroundSync();
        return;
      }
      // The server refused the captures. Retrying will not register a handset
      // or restore a clearance, so the agent is told now, while the records are
      // still on the phone and can still be sent from somewhere that works.
      if (caught instanceof ApiRequestError) {
        setSyncProblem({ message: caught.error.message, nextStep: caught.error.nextStep });
      } else {
        setSyncProblem({
          message: 'Your saved records could not be sent to PSIRS. They are still on this phone.',
        });
      }
    }
  }, [session, connection, refreshPending]);

  useEffect(() => {
    if (connection !== 'OFFLINE' && pendingCount > 0) void runSync();
  }, [connection, pendingCount, runSync]);

  // Version check runs once a session exists, because the endpoint is
  // authenticated and the answer is per-agent.
  useEffect(() => {
    if (!session) return;
    api
      .get<VersionState>('/agents/app-version')
      .then(setVersion)
      .catch(() => setVersion(null));
  }, [session]);

  const signOut = useCallback(async () => {
    await logout();
    setSession(null);
    navigate('/');
  }, [navigate]);

  const nav = useMemo(
    () => [
      { path: '/', label: t.home, icon: Icons.home },
      { path: '/taxpayers', label: t.taxpayers, icon: Icons.people },
      { path: '/collect', label: t.collect, icon: Icons.collect },
      { path: '/receipts', label: t.receipts, icon: Icons.receipt },
      { path: '/commission', label: 'Commission', icon: Icons.wallet },
      { path: '/profile', label: 'Profile', icon: Icons.profile },
    ],
    [t],
  );

  if (restoring) {
    return (
      <div className="center-screen">
        <div className="brand">
          <img className="brand__mark" src="/icon.svg" alt="" />
          <p className="brand__name">Plateau State Revenue Agent</p>
          <p className="brand__tagline">Restoring your session…</p>
        </div>
      </div>
    );
  }

  if (!session) {
    /*
     * The language toggle lived only in the signed-in header, which put it
     * on the far side of the two things a Hausa-first applicant meets first:
     * the sign-in screen, and a twenty-seven-field application form. Somebody
     * who cannot read English could not reach the control that would have
     * helped them until they had already got through it in English.
     */
    const languageSwitch = (
      <button
        type="button"
        className="ghost"
        style={{ width: 'auto', padding: '4px 10px', fontSize: '0.8rem' }}
        onClick={() => setLanguage(lang === 'en' ? 'ha' : 'en')}
        aria-label="Switch language"
      >
        {lang === 'en' ? 'HA (Hausa)' : 'EN (English)'}
      </button>
    );

    if (matchRoute(route, '/apply')) {
      return <ApplyScreen onDone={() => navigate('/')} languageSwitch={languageSwitch} />;
    }
    return (
      <LoginScreen
        onSignedIn={(user) => setSession(user)}
        onApply={() => navigate('/apply')}
        languageSwitch={languageSwitch}
      />
    );
  }

  const connectionCopy = CONNECTION_COPY[connection];

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header__row">
          <img src="/icon.svg" alt="" width={30} height={30} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className="app-header__title">PSIRS Revenue Agent</h1>
            <p className="app-header__subtitle">{session.fullName}</p>
          </div>
          <button
            type="button"
            className="ghost"
            style={{ color: '#fff', width: 'auto', padding: '4px 8px', fontSize: '0.78rem', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '6px', marginRight: '6px' }}
            onClick={() => setLanguage(lang === 'en' ? 'ha' : 'en')}
            aria-label="Switch Language"
          >
            {lang === 'en' ? 'HA (Hausa)' : 'EN (English)'}
          </button>
          <button
            type="button"
            className="ghost"
            style={{ color: '#fff', width: 'auto' }}
            onClick={signOut}
          >
            Sign out
          </button>
        </div>

        <div className={`connection connection--${connection}`} role="status" aria-live="polite">
          <span className="connection__dot" />
          <span>
            {connectionCopy.label}
            {pendingCount > 0 && ` · ${pendingCount} saved record(s) waiting to send`}
          </span>
        </div>
      </header>

      <main className="app-main">
        {connection !== 'ONLINE' && (
          <Alert kind={connection === 'OFFLINE' ? 'error' : 'warning'} title={connectionCopy.label}>
            <p style={{ margin: 0 }}>{connectionCopy.detail}</p>
          </Alert>
        )}

        {version && !version.supported && (
          <Alert kind="error" title="Update required">
            <p style={{ margin: 0 }}>
              This version ({APP_VERSION}) can no longer be used for transactions. Close and reopen
              the app to install version {version.recommendedVersion}.
            </p>
          </Alert>
        )}

        {syncMessage && (
          <Alert kind="success" title="Records synchronised">
            <p style={{ margin: 0 }}>{syncMessage}</p>
          </Alert>
        )}

        {syncProblem && (
          <Alert kind="error" title="Saved records could not be sent">
            <p style={{ margin: 0 }}>{syncProblem.message}</p>
            {syncProblem.nextStep && <p style={{ margin: '0.5rem 0 0' }}>{syncProblem.nextStep}</p>}
            <p style={{ margin: '0.5rem 0 0' }}>
              Nothing has been lost — the records are still on this phone and will be sent once this
              is put right.
            </p>
          </Alert>
        )}

        <Routes route={route} navigate={navigate} connection={connection} onSignOut={signOut} />
      </main>

      <nav className="app-nav" aria-label="Main">
        {nav.map((item) => {
          const active = route === item.path || (item.path !== '/' && route.startsWith(item.path));
          return (
            <a
              key={item.path}
              href={`#${item.path}`}
              aria-current={active ? 'page' : undefined}
            >
              <item.icon />
              <span className="app-nav__label">{item.label}</span>
            </a>
          );
        })}
      </nav>
    </div>
  );
}

function Routes({
  route,
  navigate,
  connection,
  onSignOut,
}: {
  route: string;
  navigate: (path: string) => void;
  connection: ConnectionState;
  onSignOut: () => void;
}) {
  const taxpayerMatch = matchRoute(route, '/taxpayers/:id');
  const transactionMatch = matchRoute(route, '/transactions/:reference');
  const ticketMatch = matchRoute(route, '/support/:id');

  if (matchRoute(route, '/')) return <HomeScreen navigate={navigate} />;
  if (matchRoute(route, '/application')) return <ApplicationScreen navigate={navigate} />;
  if (matchRoute(route, '/taxpayers')) return <TaxpayersScreen navigate={navigate} />;
  if (matchRoute(route, '/taxpayers/new')) {
    return <RegisterTaxpayerScreen navigate={navigate} connection={connection} />;
  }
  if (taxpayerMatch) return <TaxpayerScreen taxpayerId={taxpayerMatch.id!} navigate={navigate} />;
  if (matchRoute(route, '/collect')) return <CollectScreen navigate={navigate} connection={connection} />;
  if (transactionMatch) {
    return <TransactionScreen reference={transactionMatch.reference!} navigate={navigate} />;
  }
  if (matchRoute(route, '/vehicles')) return <VehiclesScreen navigate={navigate} />;
  if (matchRoute(route, '/receipts')) return <ReceiptsScreen />;
  if (matchRoute(route, '/verify')) return <VerifyScreen connection={connection} />;
  if (matchRoute(route, '/collections')) return <CollectionScreen />;
  if (matchRoute(route, '/commission')) return <CommissionScreen />;
  if (matchRoute(route, '/profile')) return <ProfileScreen onSignOut={onSignOut} />;
  if (matchRoute(route, '/bank')) return <BankAccountScreen navigate={navigate} />;
  if (matchRoute(route, '/support')) return <SupportScreen navigate={navigate} />;
  if (matchRoute(route, '/support/new')) return <RaiseTicketScreen navigate={navigate} />;
  // After /support/new, so the literal route is not swallowed by the pattern.
  if (ticketMatch) return <TicketScreen ticketId={ticketMatch.id!} />;

  return (
    <Alert kind="info" title="Page not found">
      <p style={{ margin: 0 }}>
        That screen does not exist. <a href="#/">Return to the home screen</a>.
      </p>
    </Alert>
  );
}
