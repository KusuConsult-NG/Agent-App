import { useState, type FormEvent } from 'react';
import { ApiRequestError, login, type ApiError, type User } from '../lib/api';
import { ErrorAlert, LanguageToggle, crestUrl } from '../ui';
import { usePortalI18n } from '../lib/i18n';

export function LoginScreen({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const { t } = usePortalI18n();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  /*
   * Unticked, always, and never remembered between visits.
   *
   * Persisting the preference would defeat it: a shared desk would carry
   * the last officer's choice to the next one, who did not make it.
   */
  const [remember, setRemember] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      /*
       * Every role that can sign in, signs in.
       *
       * A field agent used to be logged straight back out here and shown
       * "your account belongs to the agent app" — honest at the time, because
       * the menu they would have got held two reference tables and no way to
       * do their job. They have a menu of their own now (`NAV_BY_ROLE.agent`)
       * and land on a screen written for them, so there is nothing left for
       * this branch to protect them from.
       *
       * It protected nothing else either: every screen behind it is gated on
       * a permission the API checks again whichever application asks.
       */
      const session = await login(phone, password, remember);
      onSignedIn(session.user);
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? caught.error
          : {
              code: 'NETWORK',
              message: t.ofcLgCouldNotReachThe,
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
        {/*
          * Before the heading, for the same reason the public screens put it
          * there: an officer who cannot read "PSIRS Revenue Portal" cannot
          * find a control described in those words either.
          */}
        <LanguageToggle />
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <img src={crestUrl()} alt="" width={54} height={54} />
          <h1 style={{ fontSize: 'var(--text-lg)', margin: '10px 0 2px' }}>{t.ofcLoginTitle}</h1>
          <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--muted)' }}>
            {t.authPsirsFull}
          </p>
        </div>

        <ErrorAlert error={error} />

        <div className="field">
          <label htmlFor="phone">{t.ofcLoginPhone}</label>
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
          <label htmlFor="password">{t.ofcLoginPassword}</label>
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
              aria-label={shown ? t.uiHidePassword : t.uiShowPassword}
              onClick={() => setShown((current) => !current)}
            >
              {shown ? t.uiHide : t.uiShow}
            </button>
          </div>
        </div>

        <div className="field">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            <span>{t.ofcLoginRememberMe}</span>
          </label>
          <p className="muted">{t.ofcLoginRememberMeHint}</p>
        </div>

        <button type="submit" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
          {busy ? t.authSigningIn : t.authSignIn}
        </button>

        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginTop: 16, textAlign: 'center' }}>
          {t.ofcLoginMonitored}
        </p>
      </form>
    </div>
  );
}
