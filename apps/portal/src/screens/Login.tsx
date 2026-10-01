import { useState, type FormEvent } from 'react';
import { ApiRequestError, login, logout, type ApiError, type User } from '../lib/api';
import { belongsInPortal } from '../lib/permissions';
import { Alert, ErrorAlert, LanguageToggle, agentAppUrl, crestUrl } from '../ui';
import { usePortalI18n } from '../lib/i18n';

export function LoginScreen({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const { t } = usePortalI18n();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [wrongApp, setWrongApp] = useState(false);
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
    setWrongApp(false);
    try {
      const session = await login(phone, password, remember);

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

        {wrongApp && (
          <Alert kind="info" title="ofcLoginWrongPlace">
            <p style={{ margin: '4px 0 0' }}>
              {t.ofcLoginUseAgentApp}
            </p>
            <p style={{ margin: '6px 0 0' }}>
              {t.ofcLoginSignInWorked}
            </p>
            {/*
              * And the door, where this build knows where it is.
              *
              * The two sentences above told an agent they were in the wrong
              * place and left them there, which was all the portal could
              * honestly do while the agent app was on a hostname it had no
              * way to know. Served from one origin it is at the root, one
              * relative link away, and a signpost without a direction is
              * only half a signpost.
              *
              * `agentAppUrl()` is null unless this portal was built for a
              * subpath, which happens only in the combined image. Deployed
              * on its own hostname the portal still cannot know, and sending
              * an agent to a dead link would leave them worse off than the
              * sentence alone.
              */}
            {agentAppUrl() && (
              <p style={{ margin: '10px 0 0' }}>
                <a href={agentAppUrl()!}>{t.ofcLoginOpenAgentApp}</a>
              </p>
            )}
          </Alert>
        )}

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
