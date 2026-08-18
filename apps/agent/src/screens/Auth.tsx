/** Sign-in and agent application intake (Addendum §3). */

import { useEffect, useState, type FormEvent } from 'react';
import { ApiRequestError, api, login, type ApiError, type Session } from '../lib/api';
import { Alert, ErrorAlert, Field, PasswordField, Spinner } from '../ui';

export function LoginScreen({
  onSignedIn,
  onApply,
}: {
  onSignedIn: (user: Session['user']) => void;
  onApply: () => void;
}) {
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
        <p className="brand__name">Plateau State Revenue Agent</p>
        <p className="brand__tagline">Plateau State Internal Revenue Service</p>
      </div>

      <form className="card" onSubmit={submit}>
        <h2 className="card__title">Sign in</h2>
        <p className="card__hint">Use the phone number you registered with PSIRS.</p>

        <ErrorAlert error={error} />

        <Field label="Phone number" required>
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
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          required
        />

        <button type="submit" disabled={busy}>
          {busy ? <Spinner /> : null}
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <button type="button" className="secondary" style={{ marginTop: 10 }} onClick={onApply}>
          Apply to become an agent
        </button>
      </form>

      <Alert kind="info" title="Never collect cash">
        <p style={{ margin: 0 }}>
          Government revenue must always be paid by the taxpayer through an approved payment
          channel. Never accept cash into your own account.
        </p>
      </Alert>
    </div>
  );
}

interface Lga {
  id: string;
  name: string;
  zone: string;
}

export function ApplyScreen({ onDone }: { onDone: () => void }) {
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
          <h2 className="card__title">Application received</h2>
          <p className="card__hint">
            Your application number is <strong>{result.applicationNumber}</strong>. Keep it safe.
          </p>
          <Alert kind="info" title="What happens next">
            <ol style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              <li>Sign in and complete identity verification.</li>
              <li>Nominate a referee who can confirm who you are.</li>
              <li>PSIRS reviews your application.</li>
              <li>Complete training, bank verification and device registration.</li>
            </ol>
          </Alert>
          <button type="button" onClick={onDone}>
            Sign in to continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="center-screen">
      <div className="brand">
        <img className="brand__mark" src="/icon.svg" alt="" />
        <p className="brand__name">Apply to become a revenue agent</p>
        <p className="brand__tagline">
          You will need identity documents, bank details and a referee.
        </p>
      </div>

      <form className="card" onSubmit={submit}>
        <ErrorAlert error={error} />

        <p className="section-title">Your details</p>
        <Field label="Full name" required>
          <input value={form.fullName} onChange={update('fullName')} required minLength={3} />
        </Field>
        <Field label="Phone number" required>
          <input type="tel" inputMode="tel" placeholder="08012345678" value={form.phone} onChange={update('phone')} required />
        </Field>
        <Field label="Email address">
          <input type="email" inputMode="email" value={form.email} onChange={update('email')} />
        </Field>
        <Field label="Date of birth">
          <input type="date" value={form.dateOfBirth} onChange={update('dateOfBirth')} />
        </Field>
        <PasswordField
          label="Password"
          hint="At least 8 characters, including a letter and a number"
          autoComplete="new-password"
          value={form.password}
          onChange={(next) => setForm((current) => ({ ...current, password: next }))}
          required
          minLength={8}
        />

        <p className="section-title">Where you live</p>
        <Field label="Residential address" required>
          <input value={form.address} onChange={update('address')} required minLength={5} />
        </Field>
        <Field label="Local Government Area" required>
          <select value={form.lgaId} onChange={update('lgaId')} required>
            <option value="">Select your LGA</option>
            {lgas.map((lga) => (
              <option key={lga.id} value={lga.id}>
                {lga.name} ({lga.zone})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Community">
          <input value={form.community} onChange={update('community')} />
        </Field>
        <Field label="Occupation">
          <input value={form.occupation} onChange={update('occupation')} />
        </Field>

        <p className="section-title">Commission bank account</p>
        <Alert kind="warning" title="This account is for your commission only">
          <p style={{ margin: 0 }}>
            Government revenue is never paid into an agent's account. This account is used only to
            pay the commission you earn.
          </p>
        </Alert>
        <Field label="Bank name" required>
          <input value={form.bankName} onChange={update('bankName')} required />
        </Field>
        <Field label="Account name" required>
          <input value={form.accountName} onChange={update('accountName')} required />
        </Field>
        <Field label="Account number" hint="10 digits" required>
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
          {busy ? 'Submitting…' : 'Submit application'}
        </button>
        <button type="button" className="secondary" style={{ marginTop: 10 }} onClick={onDone}>
          Back to sign in
        </button>
      </form>
    </div>
  );
}
