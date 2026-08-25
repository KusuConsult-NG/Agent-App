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

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { birthDateMessage, birthDateProblem } from '@psirs/shared';
import {
  ApiRequestError,
  api,
  isConnectivityFailure,
  newIdempotencyKey,
  type ApiError,
} from '../lib/api';
import type { ConnectionState } from '../lib/device';
import { saveDraft, submitOrQueue } from '../lib/drafts';
import { startFlow, track } from '../lib/usage';
import { useI18n } from '../lib/i18n';
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
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [lgas, setLgas] = useState<Lga[]>([]);
  const [wards, setWards] = useState<{ id: string; code: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null);
  const [result, setResult] = useState<{ taxpayerId: string; tin: string | null } | null>(null);
  const [savedOffline, setSavedOffline] = useState(false);

  /*
   * Follow this attempt.
   *
   * Registration is the step everything else depends on and the one nothing
   * could see failing: an abandoned registration creates no taxpayer, so a
   * form agents cannot get through looks exactly like a form nobody opens.
   * The flow is settled once — completed, queued offline, or abandoned when
   * the screen goes away — and carries no identity, only which step it
   * reached.
   */
  const flow = useRef<ReturnType<typeof startFlow> | null>(null);
  if (flow.current === null) flow.current = startFlow('taxpayer.registration', 'step-0');

  useEffect(() => {
    flow.current?.step(`step-${step}`);
  }, [step]);

  useEffect(
    () => () => {
      // Unmounting without having settled is somebody walking away from the
      // form. `startFlow` ignores a second settlement, so a completed
      // registration is not double-counted here.
      flow.current?.abandon();
    },
    [],
  );

  // Sector taxonomy fetched once on mount.
  const [sectors, setSectors] = useState<{
    code: string;
    label: string;
    hausa: string;
    suggestedItems: { id: string; code: string; name: string; frequency: string }[];
  }[]>([]);
  // Obligation IDs the agent has confirmed for this registration.
  const [selectedObligations, setSelectedObligations] = useState<string[]>([]);

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
    wardId: '',
    community: '',
    economicSector: '',
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

    fetch('/api/v1/taxpayers/sectors')
      .then((response) => (response.ok ? response.json() : []))
      .then(setSectors)
      .catch(() => setSectors([]));
  }, []);

  /*
   * Wards for the chosen LGA.
   *
   * This list existed, seeded, with an endpoint, and nothing had ever asked
   * for it. The consequence was not a blank column: the portal's revenue
   * intelligence screen offers a drill from State to LGA to Ward, and the ward
   * level LEFT JOINs every ward against transactions, so it reported all 187
   * wards in the state as having collected nothing. On a screen whose stated
   * purpose is finding where revenue is and is not being collected, that is a
   * false answer rather than a missing one.
   */
  useEffect(() => {
    if (!form.lgaId) {
      setWards([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/v1/reference/wards?lgaId=${encodeURIComponent(form.lgaId)}`)
      .then((response) => (response.ok ? response.json() : []))
      .then((list) => {
        if (!cancelled) setWards(list);
      })
      .catch(() => {
        if (!cancelled) setWards([]);
      });
    return () => {
      cancelled = true;
    };
  }, [form.lgaId]);

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
      wardId: form.wardId || undefined,
      community: form.community || undefined,
      economicSector: form.economicSector || undefined,
      occupation: form.occupation || undefined,
      businessActivity: form.businessActivity || undefined,
      taxObligationIds: selectedObligations.length > 0 ? selectedObligations : undefined,
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
      /*
       * One idempotency key per attempt, which covers a retry of *this*
       * request and nothing further. It does not travel into the queue: a
       * draft is a separate operation, posted later to a different endpoint,
       * and the key would not match there.
       *
       * What stops the awkward case — the request reached PSIRS, the reply did
       * not, and the capture was queued — is the duplicate check at sync time,
       * which the server runs against the register as it stands and which a
       * queued capture cannot wave aside. The record the first attempt created
       * is precisely the match it finds.
       */
      const idempotencyKey = newIdempotencyKey('taxpayer');
      const body = payload(acknowledgeDuplicates);

      const outcome = await submitOrQueue(
        'TAXPAYER_REGISTRATION',
        body,
        () =>
          api.post<{ taxpayerId: string; tin: string | null }>('/taxpayers', body, idempotencyKey),
        isConnectivityFailure,
      );

      if (outcome.sent) {
        flow.current?.complete(`step-${step}`);
        setResult(outcome.result);
      } else {
        // Queued, not lost — and a distinct outcome from finishing online,
        // because the agent's experience of the two is not the same.
        flow.current?.complete('queued-offline');
        track('draft.queued', { step: 'taxpayer.registration' });
        // No signal. The capture stays on the phone rather than being lost, and
        // the agent is told plainly what has and has not happened.
        setSavedOffline(true);
      }
    } catch (caught) {
      if (caught instanceof ApiRequestError) {
        setError(caught.error);
        // Not settled: a refusal is something the agent can correct and try
        // again, so the attempt is still running.
        track('taxpayer.registration', {
          flowId: flow.current?.flowId,
          step: `refused-${caught.error.code}`,
        });
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
    flow.current?.complete('saved-for-later');
    track('draft.queued', { step: 'taxpayer.registration' });
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

  /**
   * What this step is still waiting for, in the words the agent needs, or
   * `null` when it is ready. A greyed-out Continue with no explanation is the
   * worst of both worlds in the field: the agent has filled the form in as far
   * as they can see, and nothing tells them which value the form dislikes.
   */
  const blockedBecause = ((): string | null => {
    if (step === 0) {
      if (form.hasTin && form.existingTin.trim().length < 6) {
        return t.needExistingTin;
      }
      return null;
    }
    if (step === 1) {
      if (form.taxpayerType === 'BUSINESS') {
        if (form.businessName.trim().length < 2) return 'Enter the name of the business.';
      } else {
        if (form.firstName.trim().length < 2) return t.needFirstName;
        if (form.lastName.trim().length < 2) return t.needLastName;
      }
      if (form.phone.trim().length < 10) {
        return t.needPhone;
      }
      if (form.dateOfBirth) {
        const problem = birthDateProblem(form.dateOfBirth);
        // The shared rule decides *whether* the date is recordable; the
        // wording belongs to whichever language the agent chose.
        if (problem === 'IN_THE_FUTURE') return t.birthDateFuture;
        if (problem === 'TOO_LONG_AGO') return t.birthDateTooOld;
        if (problem) return t.birthDateMalformed;
      }
      if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
        return t.emailIncomplete;
      }
      return null;
    }
    if (step === 3) {
      if (form.address.trim().length < 5) return t.needAddress;
      if (form.lgaId === '') return t.needLga;
      return null;
    }
    if (step === 5) {
      if (!form.consentGiven) return t.needConsent;
      if (!form.declarationAccepted) return t.needDeclaration;
      return null;
    }
    return null;
  })();

  const canContinue = blockedBecause === null;

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
                aria-pressed={form.hasTin}
                onClick={() => set('hasTin', true)}
              >
                Yes
              </button>
              <button
                type="button"
                className={form.hasTin ? 'secondary' : ''}
                aria-pressed={!form.hasTin}
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
              <select
                value={form.lgaId}
                onChange={(event) => {
                  // Drop any ward chosen under the previous LGA. Leaving it
                  // selected would file this registration in a ward of a
                  // different LGA; the server refuses that, but the agent
                  // should not have to be told.
                  setForm((previous) => ({ ...previous, lgaId: event.target.value, wardId: '' }));
                }}
              >
                <option value="">Select LGA</option>
                {lgas.map((lga) => (
                  <option key={lga.id} value={lga.id}>
                    {lga.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Ward"
              hint="Where revenue is reported from. Without it this collection cannot be counted below LGA level."
            >
              <select
                value={form.wardId}
                disabled={!form.lgaId || wards.length === 0}
                onChange={(event) => set('wardId', event.target.value)}
              >
                <option value="">
                  {!form.lgaId ? 'Choose an LGA first' : wards.length === 0 ? 'No wards listed' : 'Select ward'}
                </option>
                {wards.map((ward) => (
                  <option key={ward.id} value={ward.id}>
                    {ward.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Community">
              <input value={form.community} onChange={(event) => set('community', event.target.value)} />
            </Field>
          </>
        )}

        {step === 4 && (() => {
          const selectedSector = sectors.find((s) => s.code === form.economicSector);
          return (
            <>
              <h2 className="card__title">Business or activity</h2>
              <Field label="Economic sector">
                <select
                  value={form.economicSector}
                  onChange={(event) => {
                    set('economicSector', event.target.value);
                    // Reset obligation selections when sector changes.
                    setSelectedObligations([]);
                    // Pre-select all suggested items for the new sector.
                    const newSector = sectors.find((s) => s.code === event.target.value);
                    if (newSector) {
                      setSelectedObligations(newSector.suggestedItems.map((item) => item.id));
                    }
                  }}
                >
                  <option value="">— Select sector —</option>
                  {sectors.map((sector) => (
                    <option key={sector.code} value={sector.code}>
                      {sector.label} ({sector.hausa})
                    </option>
                  ))}
                </select>
              </Field>

              {selectedSector && selectedSector.suggestedItems.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <p style={{ fontSize: '0.82rem', fontWeight: 600, margin: '0 0 8px', color: 'var(--ink)' }}>
                    Suggested tax obligations for {selectedSector.label}
                  </p>
                  <p style={{ fontSize: '0.78rem', color: 'var(--muted)', margin: '0 0 10px' }}>
                    Confirm which taxes apply to this taxpayer. You can add more later.
                  </p>
                  {selectedSector.suggestedItems.map((item) => (
                    <label
                      key={item.id}
                      style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 0', fontSize: '0.86rem', cursor: 'pointer' }}
                    >
                      <input
                        type="checkbox"
                        style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0 }}
                        checked={selectedObligations.includes(item.id)}
                        onChange={(event) => {
                          setSelectedObligations(
                            event.target.checked
                              ? [...selectedObligations, item.id]
                              : selectedObligations.filter((id) => id !== item.id),
                          );
                        }}
                      />
                      <span>
                        <strong>{item.name}</strong>{' '}
                        <span style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>
                          {item.frequency.toLowerCase().replace('_', '-')}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}

              <div style={{ marginTop: 16 }}>
                <Field label="Occupation (optional)">
                  <input value={form.occupation} onChange={(event) => set('occupation', event.target.value)} />
                </Field>
              </div>
              <Field label="Business activity (optional)">
                <input
                  value={form.businessActivity}
                  onChange={(event) => set('businessActivity', event.target.value)}
                />
              </Field>
            </>
          );
        })()}

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
                ['Ward', wards.find((ward) => ward.id === form.wardId)?.name ?? '—'],
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

        {blockedBecause && (
          <p className="card__hint" role="status" style={{ marginBottom: 0 }}>
            {blockedBecause}
          </p>
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
