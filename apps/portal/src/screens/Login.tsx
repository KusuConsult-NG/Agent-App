import { useState, type FormEvent } from 'react';
import { ApiRequestError, login, type ApiError, type User } from '../lib/api';
import { ErrorAlert } from '../ui';

export function LoginScreen({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await login(phone, password);
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
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
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
