/** Sign-in and agent application intake (Addendum §3). */

import { useEffect, useState, type FormEvent } from 'react';
import { ApiRequestError, api, login, type ApiError, type Session } from '../lib/api';
import { Alert, ErrorAlert, Field, PasswordField, Spinner } from '../ui';
import { useI18n } from '../lib/i18n';

export function LoginScreen({
  onSignedIn,
  onApply,
  languageSwitch,
}: {
  onSignedIn: (user: Session['user']) => void;
  onApply: () => void;
  /** Rendered here because signed-out screens have no header to hold it. */
  languageSwitch?: React.ReactNode;
}) {
  const { t } = useI18n();
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
              // Kept in English as a last resort: ErrorAlert renders `errNetwork`
              // for this code, and anything that shows a raw message instead
              // should still say something rather than nothing.
              message: 'Could not reach PSIRS. Check your connection and try again.',
              moneyStatus: 'NOT_APPLICABLE',
            },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="brand">
        <img className="brand__mark" src="/icon.svg" alt="" />
        <p className="brand__name">{t.shellAgentBrand}</p>
        <p className="brand__tagline">{t.authPsirsFull}</p>
        {languageSwitch}
      </div>

      <form className="card" onSubmit={submit}>
        <h2 className="card__title">{t.authSignIn}</h2>
        <p className="card__hint">{t.authPhoneHint}</p>

        <ErrorAlert error={error} />

        <Field label={t.authPhone} required>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="username"
            placeholder="08012345678"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            required
          />
        </Field>

        <PasswordField
          label={t.authPassword}
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          required
        />

        <button type="submit" disabled={busy}>
          {busy ? <Spinner /> : null}
          {busy ? t.authSigningIn : t.authSignIn}
        </button>

        <button type="button" className="secondary" style={{ marginTop: 10 }} onClick={onApply}>{t.authApply}</button>
      </form>

      <Alert kind="info" title={t.neverCollectCash}>
        <p style={{ margin: 0 }}>{t.neverCollectCashBody}</p>
      </Alert>
    </div>
  );
}

interface Lga {
  id: string;
  name: string;
  zone: string;
}

export function ApplyScreen({
  onDone,
  languageSwitch,
}: {
  onDone: () => void;
  languageSwitch?: React.ReactNode;
}) {
  const { t } = useI18n();
  const [lgas, setLgas] = useState<Lga[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<{ applicationNumber: string } | null>(null);
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    email: '',
    password: '',
    dateOfBirth: '',
    address: '',
    lgaId: '',
    community: '',
    occupation: '',
    bankName: '',
    accountName: '',
    accountNumber: '',
  });

  useEffect(() => {
    // Reference geography is public and cached by the service worker, so this
    // works on a weak connection.
    fetch('/api/v1/reference/lgas')
      .then((response) => (response.ok ? response.json() : []))
      .then(setLgas)
      .catch(() => setLgas([]));
  }, []);

  const update = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((previous) => ({ ...previous, [key]: event.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await api.post<{ applicationNumber: string }>('/agents/apply', {
        ...form,
        email: form.email || undefined,
        dateOfBirth: form.dateOfBirth || undefined,
        community: form.community || undefined,
        occupation: form.occupation || undefined,
      });
      setResult(response);
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? caught.error
          : {
              code: 'NETWORK',
              // Kept in English as a last resort: ErrorAlert renders `errNetwork`
              // for this code, and anything that shows a raw message instead
              // should still say something rather than nothing.
              message: 'Could not reach PSIRS. Check your connection and try again.',
              moneyStatus: 'NOT_APPLICABLE',
            },
      );
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="center-screen">
        <div className="card">
          <h2 className="card__title">{t.authApplicationReceived}</h2>
          <p className="card__hint">{t.authApplicationNumber}<strong>{result.applicationNumber}</strong>{t.authKeepItSafe}
          </p>
          <Alert kind="info" title={t.authWhatNext}>
            <ol style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              <li>{t.authNextSignIn}</li>
              <li>{t.authNextReferee}</li>
              <li>{t.authNextReview}</li>
              <li>{t.authNextClearance}</li>
            </ol>
          </Alert>
          <button type="button" onClick={onDone}>{t.authSignInTitle}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="center-screen">
      <div className="brand">
        <img className="brand__mark" src="/icon.svg" alt="" />
        <p className="brand__name">{t.authApplyTitle}</p>
        <p className="brand__tagline">{t.authNeedDocuments}</p>
        {languageSwitch}
      </div>

      <form className="card" onSubmit={submit}>
        <ErrorAlert error={error} />

        <p className="section-title">{t.authYourDetails}</p>
        <Field label={t.authFullName} required>
          <input value={form.fullName} onChange={update('fullName')} required minLength={3} />
        </Field>
        <Field label={t.authPhone} required>
          <input type="tel" inputMode="tel" placeholder="08012345678" value={form.phone} onChange={update('phone')} required />
        </Field>
        <Field label={t.authEmail}>
          <input type="email" inputMode="email" value={form.email} onChange={update('email')} />
        </Field>
        <Field label={t.authDateOfBirth}>
          {/*
            * Bounded here as well as on the server. The rule is the same one
            * the API applies, and applying it at the input means a slipped
            * year is caught while the applicant is still looking at the box
            * rather than at the end of a twenty-seven-field form.
            */}
          <input
            type="date"
            value={form.dateOfBirth}
            onChange={update('dateOfBirth')}
            min="1900-01-01"
            max={new Date().toISOString().slice(0, 10)}
          />
        </Field>
        <PasswordField
          label={t.authPassword}
          hint={t.authPasswordHint}
          autoComplete="new-password"
          value={form.password}
          onChange={(next) => setForm((current) => ({ ...current, password: next }))}
          required
          minLength={8}
          pattern="(?=.*[0-9])(?=.*[a-zA-Z]).{8,}"
          patternHint={t.authPasswordPatternHint}
        />

        <p className="section-title">{t.authWhereYouLive}</p>
        <Field label={t.authAddress} required>
          <input value={form.address} onChange={update('address')} required minLength={5} />
        </Field>
        <Field label={t.grpLga} required>
          <select value={form.lgaId} onChange={update('lgaId')} required>
            <option value="">{t.authSelectLga}</option>
            {lgas.map((lga) => (
              <option key={lga.id} value={lga.id}>
                {lga.name} ({lga.zone})
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.grpCommunity}>
          <input value={form.community} onChange={update('community')} />
        </Field>
        <Field label={t.authOccupation}>
          <input value={form.occupation} onChange={update('occupation')} />
        </Field>

        <p className="section-title">{t.appBankAccount}</p>
        <Alert kind="warning" title={t.commissionAccountOnly}>
          <p style={{ margin: 0 }}>
            {t.authRevenueNeverToAgent}
          </p>
        </Alert>
        <Field label={t.authBankName} required>
          <input value={form.bankName} onChange={update('bankName')} required minLength={2} />
        </Field>
        <Field label={t.authAccountName} required>
          <input value={form.accountName} onChange={update('accountName')} required minLength={3} />
        </Field>
        <Field label={t.authAccountNumber} hint={t.authTenDigits} required>
          <input
            inputMode="numeric"
            pattern="\d{10}"
            maxLength={10}
            value={form.accountNumber}
            onChange={update('accountNumber')}
            required
          />
        </Field>

        <button type="submit" disabled={busy}>
          {busy ? <Spinner /> : null}
          {busy ? t.authSubmitting : t.authSubmitApplication}
        </button>
        <button type="button" className="secondary" style={{ marginTop: 10 }} onClick={onDone}>{t.authBackToSignIn}</button>
      </form>
    </div>
  );
}
