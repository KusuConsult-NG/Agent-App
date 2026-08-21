import { useState, type FormEvent } from 'react';
import { ApiRequestError, login, logout, type ApiError, type User } from '../lib/api';
import { belongsInPortal } from '../lib/permissions';
import { Alert, ErrorAlert } from '../ui';

export function LoginScreen({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [wrongApp, setWrongApp] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setWrongApp(false);
    try {
      const session = await login(phone, password);

      /*
       * A field agent has valid credentials and no business here.
       *
       * They hold `catalogue:read` and almost nothing else this portal's
       * screens are gated on, so the shell they got contained exactly one item
       * and no way to do their job — which reads as a broken portal rather than
       * as the wrong door. Their tools are in the agent app.
       *
       * The session is ended rather than merely hidden: leaving a live refresh
       * token in sessionStorage for a session the user cannot use is untidy at
       * best. This is a signpost, not a security boundary — every screen behind
       * it is permission-gated on the API whichever application asks.
       */
      if (!belongsInPortal(session.user.role)) {
        await logout();
        setWrongApp(true);
        setPassword('');
        return;
      }

      onSignedIn(session.user);
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? caught.error
          : {
              code: 'NETWORK',
              message: 'Could not reach the revenue platform. Check your connection.',
              moneyStatus: 'NOT_APPLICABLE',
            },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={submit}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <img src="/icon.svg" alt="" width={54} height={54} />
          <h1 style={{ fontSize: '1.05rem', margin: '10px 0 2px' }}>PSIRS Revenue Portal</h1>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>
            Plateau State Internal Revenue Service
          </p>
        </div>

        <ErrorAlert error={error} />

        {wrongApp && (
          <Alert kind="info" title="Your account belongs to the agent app">
            <p style={{ margin: '4px 0 0' }}>
              Field agents collect revenue in the PSIRS agent app, which works offline and holds
              your taxpayers, assessments and commission. This portal is for revenue, finance and
              oversight officers.
            </p>
            <p style={{ margin: '6px 0 0' }}>
              Your sign-in worked — you are simply in the wrong place.
            </p>
          </Alert>
        )}

        <div className="field">
          <label htmlFor="phone">Phone number</label>
          <input
            id="phone"
            type="tel"
            autoComplete="username"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="08012345678"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <div className="password">
            <input
              id="password"
              className="password__input"
              type={shown ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <button
              type="button"
              className="password__toggle"
              aria-pressed={shown}
              aria-label={shown ? 'Hide password' : 'Show password'}
              onClick={() => setShown((current) => !current)}
            >
              {shown ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        <button type="submit" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: 16, textAlign: 'center' }}>
          Access is monitored. Every action you take is recorded in the audit log.
        </p>
      </form>
    </div>
  );
}
