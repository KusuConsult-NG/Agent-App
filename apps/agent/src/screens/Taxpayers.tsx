/**
 * Taxpayer search, registration and profile (PRD §10-§13, §57).
 *
 * Registration follows the step sequence of PRD §57 — "Do you have a TIN?"
 * first, then basic details, identification, address, activity, review — so an
 * agent standing in a market works through short screens rather than one long
 * form.
 *
 * When the device is offline the same form saves a draft locally instead of
 * submitting, and the queued draft syncs later (PRD §30).
 */

import { useEffect, useState, type FormEvent } from 'react';
import { ApiRequestError, api, newIdempotencyKey, type ApiError } from '../lib/api';
import type { ConnectionState } from '../lib/device';
import { saveDraft } from '../lib/drafts';
import { Alert, Badge, ErrorAlert, Field, KeyValue, Loading, Money, Spinner } from '../ui';

interface TaxpayerSummary {
  id: string;
  taxpayer_type: string;
  tin: string | null;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  phone: string;
  lga_name: string;
  status: string;
}

function displayName(taxpayer: {
  business_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}): string {
  return (
    taxpayer.business_name ??
    `${taxpayer.first_name ?? ''} ${taxpayer.last_name ?? ''}`.trim() ??
    'Unnamed taxpayer'
  );
}

export function TaxpayersScreen({ navigate }: { navigate: (path: string) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TaxpayerSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      setResults(
        await api.get<TaxpayerSummary[]>(`/taxpayers/search?q=${encodeURIComponent(query.trim())}`),
      );
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="card" onSubmit={search}>
        <h2 className="card__title">Find a taxpayer</h2>
        <p className="card__hint">
          Search by name, business name, phone number, TIN, receipt number or vehicle registration.
        </p>
        <Field label="Search">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, phone or TIN"
          />
        </Field>
        <button type="submit" disabled={busy || query.trim().length < 2}>
          {busy ? <Spinner /> : null}
          Search
        </button>
      </form>

      <ErrorAlert error={error} />

      {results && (
        <div className="card card--flush">
          {results.length === 0 ? (
            <p className="empty">
              No taxpayer matches that search. You can register them as a new taxpayer.
            </p>
          ) : (
            <ul className="list">
              {results.map((taxpayer) => (
                <li key={taxpayer.id}>
                  <button
                    type="button"
                    className="list__item"
                    onClick={() => navigate(`/taxpayers/${taxpayer.id}`)}
                  >
                    <div className="list__body">
                      <p className="list__title">{displayName(taxpayer)}</p>
                      <p className="list__meta">
                        {taxpayer.tin ? `TIN ${taxpayer.tin}` : 'No TIN yet'} · {taxpayer.phone} ·{' '}
                        {taxpayer.lga_name}
                      </p>
                    </div>
                    <Badge status={taxpayer.taxpayer_type} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <button type="button" className="secondary" onClick={() => navigate('/taxpayers/new')}>
        Register a new taxpayer
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Registration wizard
// ---------------------------------------------------------------------------

interface Lga {
  id: string;
  name: string;
}

interface DuplicateMatch {
  taxpayerId: string;
  displayName: string;
  tin: string | null;
  phone: string;
  score: number;
  reasons: string[];
}

const STEPS = ['TIN', 'Details', 'Identification', 'Address', 'Activity', 'Review'] as const;

export function RegisterTaxpayerScreen({
  navigate,
  connection,
}: {
  navigate: (path: string) => void;
  connection: ConnectionState;
}) {
  const [step, setStep] = useState(0);
  const [lgas, setLgas] = useState<Lga[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null);
  const [result, setResult] = useState<{ taxpayerId: string; tin: string | null } | null>(null);
  const [savedOffline, setSavedOffline] = useState(false);

  const [form, setForm] = useState({
    hasTin: false,
    existingTin: '',
    taxpayerType: 'INDIVIDUAL' as 'INDIVIDUAL' | 'BUSINESS',
    firstName: '',
    middleName: '',
    lastName: '',
    dateOfBirth: '',
    businessName: '',
    businessType: '',
    phone: '',
    email: '',
    identityType: 'NIN',
    identityNumber: '',
    address: '',
    lgaId: '',
    community: '',
    occupation: '',
    businessActivity: '',
    consentGiven: false,
    declarationAccepted: false,
  });

  useEffect(() => {
    fetch('/api/v1/reference/lgas')
      .then((response) => (response.ok ? response.json() : []))
      .then(setLgas)
      .catch(() => setLgas([]));
  }, []);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  function payload(acknowledgeDuplicates = false) {
    return {
      taxpayerType: form.taxpayerType,
      firstName: form.taxpayerType === 'INDIVIDUAL' ? form.firstName : undefined,
      middleName: form.middleName || undefined,
      lastName: form.taxpayerType === 'INDIVIDUAL' ? form.lastName : undefined,
      dateOfBirth: form.dateOfBirth || undefined,
      businessName: form.taxpayerType === 'BUSINESS' ? form.businessName : undefined,
      businessType: form.businessType || undefined,
      phone: form.phone,
      email: form.email || undefined,
      address: form.address,
      lgaId: form.lgaId,
      community: form.community || undefined,
      occupation: form.occupation || undefined,
      businessActivity: form.businessActivity || undefined,
      identityType: form.identityNumber ? form.identityType : undefined,
      identityNumber: form.identityNumber || undefined,
      existingTin: form.hasTin && form.existingTin ? form.existingTin : undefined,
      consentGiven: form.consentGiven,
      declarationAccepted: form.declarationAccepted,
      acknowledgeDuplicates,
    };
  }

  async function submit(acknowledgeDuplicates = false) {
    setBusy(true);
    setError(null);
    try {
      const response = await api.post<{ taxpayerId: string; tin: string | null }>(
        '/taxpayers',
        payload(acknowledgeDuplicates),
        newIdempotencyKey('taxpayer'),
      );
      setResult(response);
    } catch (caught) {
      if (caught instanceof ApiRequestError) {
        setError(caught.error);
        if (caught.error.code === 'POSSIBLE_DUPLICATE_TAXPAYER') {
          // Fetch the actual matches so the agent can look at them rather than
          // guessing what the warning refers to (PRD §11).
          try {
            const check = await api.post<{ possibleDuplicates: DuplicateMatch[] }>(
              '/taxpayers/duplicate-check',
              {
                taxpayerType: form.taxpayerType,
                firstName: form.firstName || undefined,
                lastName: form.lastName || undefined,
                businessName: form.businessName || undefined,
                phone: form.phone,
                lgaId: form.lgaId,
                identityNumber: form.identityNumber || undefined,
              },
            );
            setDuplicates(check.possibleDuplicates);
          } catch {
            setDuplicates([]);
          }
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveForLater() {
    await saveDraft('TAXPAYER_REGISTRATION', payload());
    setSavedOffline(true);
  }

  if (savedOffline) {
    return (
      <div className="card">
        <h2 className="card__title">Saved on this device</h2>
        <Alert kind="warning" title="Not yet sent to PSIRS">
          <p style={{ margin: 0 }}>
            This registration is stored on your phone and will be sent automatically when you are
            back online. No TIN has been issued yet, and no payment can be taken until it is sent.
          </p>
        </Alert>
        <button type="button" onClick={() => navigate('/')}>
          Back to home
        </button>
      </div>
    );
  }

  if (result) {
    return (
      <div className="card">
        <h2 className="card__title">Taxpayer registered</h2>
        {result.tin ? (
          <Alert kind="success" title={`TIN ${result.tin}`}>
            <p style={{ margin: 0 }}>
              Give this number to the taxpayer. They will need it for every government payment.
            </p>
          </Alert>
        ) : (
          <Alert kind="info" title="TIN request submitted">
            <p style={{ margin: 0 }}>
              The TIN service has not returned a number yet. It will appear on the taxpayer's
              profile once assigned.
            </p>
          </Alert>
        )}
        <div className="button-row">
          <button type="button" onClick={() => navigate(`/collect?taxpayerId=${result.taxpayerId}`)}>
            Collect revenue
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => navigate(`/taxpayers/${result.taxpayerId}`)}
          >
            View profile
          </button>
        </div>
      </div>
    );
  }

  const canContinue =
    step === 0
      ? !form.hasTin || form.existingTin.length >= 6
      : step === 1
        ? form.taxpayerType === 'BUSINESS'
          ? form.businessName.length >= 2 && form.phone.length >= 10
          : form.firstName.length >= 2 && form.lastName.length >= 2 && form.phone.length >= 10
        : step === 3
          ? form.address.length >= 5 && form.lgaId !== ''
          : step === 5
            ? form.consentGiven && form.declarationAccepted
            : true;

  return (
    <>
      <div className="card">
        <p className="card__hint" style={{ margin: 0 }}>
          Step {step + 1} of {STEPS.length}: <strong>{STEPS[step]}</strong>
        </p>
        <div
          style={{
            height: 6,
            background: 'var(--line)',
            borderRadius: 999,
            marginTop: 10,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${((step + 1) / STEPS.length) * 100}%`,
              background: 'var(--green-700)',
              transition: 'width 0.2s',
            }}
          />
        </div>
      </div>

      <ErrorAlert error={error} />

      {duplicates && duplicates.length > 0 && (
        <div className="card">
          <h2 className="card__title">Possible existing taxpayer</h2>
          <p className="card__hint">
            Check whether any of these is the same person before creating a new record.
          </p>
          <ul className="list">
            {duplicates.map((match) => (
              <li key={match.taxpayerId}>
                <button
                  type="button"
                  className="list__item"
                  onClick={() => navigate(`/taxpayers/${match.taxpayerId}`)}
                >
                  <div className="list__body">
                    <p className="list__title">{match.displayName}</p>
                    <p className="list__meta">
                      {match.tin ? `TIN ${match.tin} · ` : ''}
                      {match.reasons.join('; ')}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="secondary"
            style={{ marginTop: 12 }}
            disabled={busy}
            onClick={() => void submit(true)}
          >
            None of these — register as a new taxpayer
          </button>
        </div>
      )}

      <div className="card">
        {step === 0 && (
          <>
            <h2 className="card__title">Does the taxpayer already have a TIN?</h2>
            <div className="button-row">
              <button
                type="button"
                className={form.hasTin ? '' : 'secondary'}
                onClick={() => set('hasTin', true)}
              >
                Yes
              </button>
              <button
                type="button"
                className={form.hasTin ? 'secondary' : ''}
                onClick={() => set('hasTin', false)}
              >
                No
              </button>
            </div>
            {form.hasTin && (
              <Field label="Existing TIN" hint="We will confirm it with the PSIRS TIN service" required>
                <input
                  inputMode="numeric"
                  value={form.existingTin}
                  onChange={(event) => set('existingTin', event.target.value)}
                />
              </Field>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <h2 className="card__title">Basic information</h2>
            <Field label="Registering as" required>
              <select
                value={form.taxpayerType}
                onChange={(event) => set('taxpayerType', event.target.value as 'INDIVIDUAL' | 'BUSINESS')}
              >
                <option value="INDIVIDUAL">An individual</option>
                <option value="BUSINESS">A business</option>
              </select>
            </Field>

            {form.taxpayerType === 'BUSINESS' ? (
              <>
                <Field label="Business name" required>
                  <input value={form.businessName} onChange={(event) => set('businessName', event.target.value)} />
                </Field>
                <Field label="Type of business">
                  <input value={form.businessType} onChange={(event) => set('businessType', event.target.value)} />
                </Field>
              </>
            ) : (
              <>
                <Field label="First name" required>
                  <input value={form.firstName} onChange={(event) => set('firstName', event.target.value)} />
                </Field>
                <Field label="Middle name">
                  <input value={form.middleName} onChange={(event) => set('middleName', event.target.value)} />
                </Field>
                <Field label="Last name" required>
                  <input value={form.lastName} onChange={(event) => set('lastName', event.target.value)} />
                </Field>
                <Field label="Date of birth">
                  <input type="date" value={form.dateOfBirth} onChange={(event) => set('dateOfBirth', event.target.value)} />
                </Field>
              </>
            )}

            <Field label="Phone number" required>
              <input type="tel" inputMode="tel" value={form.phone} onChange={(event) => set('phone', event.target.value)} />
            </Field>
            <Field label="Email address">
              <input type="email" inputMode="email" value={form.email} onChange={(event) => set('email', event.target.value)} />
            </Field>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="card__title">Identification</h2>
            <p className="card__hint">
              Optional, but it helps prevent duplicate records. The number is stored securely and
              never shown in full.
            </p>
            <Field label="Identification type">
              <select value={form.identityType} onChange={(event) => set('identityType', event.target.value)}>
                <option value="NIN">National Identification Number</option>
                <option value="BVN">Bank Verification Number</option>
                <option value="PASSPORT">International passport</option>
                <option value="DRIVERS_LICENCE">Driver's licence</option>
                <option value="VOTERS_CARD">Voter's card</option>
              </select>
            </Field>
            <Field label="Identification number">
              <input
                inputMode="numeric"
                value={form.identityNumber}
                onChange={(event) => set('identityNumber', event.target.value)}
              />
            </Field>
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="card__title">Address</h2>
            <Field label="Address" required>
              <input value={form.address} onChange={(event) => set('address', event.target.value)} />
            </Field>
            <Field label="Local Government Area" required>
              <select value={form.lgaId} onChange={(event) => set('lgaId', event.target.value)}>
                <option value="">Select LGA</option>
                {lgas.map((lga) => (
                  <option key={lga.id} value={lga.id}>
                    {lga.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Community">
              <input value={form.community} onChange={(event) => set('community', event.target.value)} />
            </Field>
          </>
        )}

        {step === 4 && (
          <>
            <h2 className="card__title">Business or activity</h2>
            <Field label="Occupation">
              <input value={form.occupation} onChange={(event) => set('occupation', event.target.value)} />
            </Field>
            <Field label="Business activity">
              <input
                value={form.businessActivity}
                onChange={(event) => set('businessActivity', event.target.value)}
              />
            </Field>
          </>
        )}

        {step === 5 && (
          <>
            <h2 className="card__title">Review and confirm</h2>
            <KeyValue
              items={[
                ['Type', form.taxpayerType === 'BUSINESS' ? 'Business' : 'Individual'],
                [
                  'Name',
                  form.taxpayerType === 'BUSINESS'
                    ? form.businessName
                    : `${form.firstName} ${form.lastName}`,
                ],
                ['Phone', form.phone],
                ['LGA', lgas.find((lga) => lga.id === form.lgaId)?.name ?? '—'],
                ['Address', form.address],
                ['TIN', form.hasTin ? form.existingTin : 'Will be requested'],
              ]}
            />

            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.consentGiven}
                onChange={(event) => set('consentGiven', event.target.checked)}
              />
              <span>
                The taxpayer consents to their information being used by PSIRS for revenue
                administration.
              </span>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.declarationAccepted}
                onChange={(event) => set('declarationAccepted', event.target.checked)}
              />
              <span>The taxpayer declares that the information given is true and correct.</span>
            </label>
          </>
        )}

        <div className="button-row">
          {step > 0 && (
            <button type="button" className="secondary" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button type="button" disabled={!canContinue} onClick={() => setStep(step + 1)}>
              Continue
            </button>
          ) : (
            <button type="button" disabled={busy || !canContinue} onClick={() => void submit(false)}>
              {busy ? <Spinner /> : null}
              {busy ? 'Registering…' : 'Register taxpayer'}
            </button>
          )}
        </div>

        {connection === 'OFFLINE' && step === STEPS.length - 1 && (
          <>
            <Alert kind="warning" title="You are offline">
              <p style={{ margin: 0 }}>
                Save this registration on the device. It will be sent to PSIRS automatically when
                you are back online, and a TIN will be requested then.
              </p>
            </Alert>
            <button type="button" className="secondary" disabled={!canContinue} onClick={saveForLater}>
              Save on this device
            </button>
          </>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Taxpayer profile
// ---------------------------------------------------------------------------

interface Profile {
  /** AGENT_LIMITED for a field agent; FULL for government users. */
  scope: 'AGENT_LIMITED' | 'FULL';
  note?: string;
  taxpayer: Record<string, string | null>;
  transactions: {
    id: string;
    transaction_reference: string;
    amount_kobo: string;
    status: string;
    revenue_item: string;
  }[];
  receipts: { id: string; receipt_number: string; amount_kobo: string; status: string }[];
  vehicles: { id: string; registration_number: string; current_expiry_date: string | null }[];
}

export function TaxpayerScreen({
  taxpayerId,
  navigate,
}: {
  taxpayerId: string;
  navigate: (path: string) => void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<Profile>(`/taxpayers/${taxpayerId}`)
      .then(setProfile)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      })
      .finally(() => setLoading(false));
  }, [taxpayerId]);

  if (loading) return <Loading rows={5} />;
  if (error) return <ErrorAlert error={error} />;
  if (!profile) return null;

  const taxpayer = profile.taxpayer;

  return (
    <>
      <div className="card">
        <h2 className="card__title">{displayName(taxpayer as never)}</h2>
        <KeyValue
          items={[
            ['TIN', taxpayer.tin ?? 'Not yet assigned'],
            ['Phone', taxpayer.phone],
            ['LGA', taxpayer.lga_name],
            ['Address', taxpayer.address],
          ]}
        />
        <button type="button" onClick={() => navigate(`/collect?taxpayerId=${taxpayerId}`)}>
          Collect revenue
        </button>
      </div>

      <p className="section-title">Transactions you facilitated</p>
      <div className="card card--flush">
        {profile.transactions.length === 0 ? (
          <p className="empty">You have not processed any transaction for this taxpayer.</p>
        ) : (
          <ul className="list">
            {profile.transactions.map((transaction) => (
              <li key={transaction.id}>
                <button
                  type="button"
                  className="list__item"
                  onClick={() => navigate(`/transactions/${transaction.transaction_reference}`)}
                >
                  <div className="list__body">
                    <p className="list__title">{transaction.revenue_item}</p>
                    <p className="list__meta">{transaction.transaction_reference}</p>
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

      {profile.note && (
        <Alert kind="info" title="What you can see here">
          <p style={{ margin: 0 }}>{profile.note}</p>
        </Alert>
      )}

      {profile.vehicles.length > 0 && (
        <>
          <p className="section-title">Vehicles</p>
          <div className="card card--flush">
            <ul className="list">
              {profile.vehicles.map((vehicle) => (
                <li key={vehicle.id} className="list__item">
                  <div className="list__body">
                    <p className="list__title">{vehicle.registration_number}</p>
                    <p className="list__meta">
                      {vehicle.current_expiry_date
                        ? `Expires ${vehicle.current_expiry_date.slice(0, 10)}`
                        : 'No renewal on record'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </>
  );
}
