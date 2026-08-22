/**
 * Public, unauthenticated surfaces.
 *
 *   /verify/:code    — receipt and document verification (PRD §20, §43)
 *   /referee/:token  — referee verification portal (Addendum §10-§13)
 *   /citizen         — citizen self-service tax status lookup
 *
 * None of these require an account.
 */

import React, { useEffect, useState, type FormEvent } from 'react';
import { ApiRequestError, api, type ApiError } from '../lib/api';
import { Alert, ErrorAlert, KeyValue, Loading, Money, formatDate } from '../ui';

interface VerificationResult {
  status: 'VALID' | 'INVALID' | 'REVERSED' | 'NOT_FOUND';
  receiptNumber?: string;
  documentNumber?: string;
  documentType?: string;
  revenueType?: string;
  amountKobo?: string;
  issuedAt?: string;
  lga?: string;
  integrityConfirmed?: boolean;
  message: string;
}

export function VerifyScreen({ code }: { code?: string }) {
  const [input, setInput] = useState(code ?? '');
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function check(value: string) {
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await api.publicGet<VerificationResult>(`/verify/${encodeURIComponent(value.trim())}`),
      );
    } catch (caught) {
      if (caught instanceof ApiRequestError) {
        // A "not found" answer is a legitimate result, not an error — and for
        // a receipt nobody issued it is *the* answer this page exists to give.
        // It arrives as the response body on a 404, so read it from there
        // rather than from the error envelope, which that body does not carry.
        const verdict = caught.body as VerificationResult | null;
        if (caught.status === 404 && verdict?.status) {
          setResult(verdict);
        } else {
          setError(caught.error);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (code) void check(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const verdictClass =
    result?.status === 'VALID' ? 'valid' : result?.status === 'REVERSED' ? 'warning' : 'invalid';

  return (
    <div className="public">
      <div className="public__card">
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <img src="/icon.svg" alt="" width={48} height={48} />
          <h1 style={{ fontSize: '1.05rem', margin: '10px 0 2px' }}>Verify a government receipt</h1>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>
            Plateau State Internal Revenue Service
          </p>
        </div>

        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void check(input);
          }}
        >
          <div className="field">
            <label htmlFor="code">Receipt number or verification code</label>
            <input
              id="code"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="PSIRS/2026/000123"
              autoCapitalize="characters"
            />
          </div>
          <button type="submit" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
            {busy ? 'Checking…' : 'Verify'}
          </button>
        </form>

        <ErrorAlert error={error} />

        {result && (
          <div style={{ marginTop: 20 }}>
            <div className={`verdict verdict--${verdictClass}`}>
              <p className="verdict__mark">
                {result.status === 'VALID' ? '✓' : result.status === 'REVERSED' ? '!' : '×'}
              </p>
              <p className="verdict__label">
                {result.status === 'VALID'
                  ? 'VALID'
                  : result.status === 'REVERSED'
                    ? 'REVERSED'
                    : result.status === 'NOT_FOUND'
                      ? 'NOT FOUND'
                      : 'INVALID'}
              </p>
            </div>

            <p style={{ fontSize: '0.87rem' }}>{result.message}</p>

            {(result.receiptNumber || result.documentNumber) && (
              <KeyValue
                items={[
                  ['Receipt number', result.receiptNumber ?? result.documentNumber ?? '—'],
                  ['Revenue type', result.revenueType ?? result.documentType ?? '—'],
                  ['Amount', result.amountKobo ? <Money key="a" kobo={result.amountKobo} /> : '—'],
                  ['Issued', formatDate(result.issuedAt)],
                  ['Local Government Area', result.lga ?? '—'],
                  [
                    'Document fingerprint',
                    result.integrityConfirmed === undefined
                      ? '—'
                      : result.integrityConfirmed
                        ? 'Matches the original'
                        : 'Does not match the original',
                  ],
                ]}
              />
            )}

            <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: 14 }}>
              For privacy, taxpayer names, phone numbers and TINs are never shown on this page.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface Invitation {
  refereeId: string;
  referenceCode: string;
  refereeName: string;
  applicantName: string;
  applicantLga: string | null;
  relationship: string;
  category: string;
  expiresAt: string;
  declarations: string[];
}

export function RefereePortalScreen({ token }: { token: string }) {
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  const [declarations, setDeclarations] = useState([false, false, false, false]);
  const [identityType, setIdentityType] = useState('NIN');
  const [identityNumber, setIdentityNumber] = useState('');
  const [occupation, setOccupation] = useState('');

  useEffect(() => {
    api
      .publicGet<Invitation>(`/referee/${token}`)
      .then(setInvitation)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      })
      .finally(() => setLoading(false));
  }, [token]);

  async function respond() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.publicPost<{ message: string }>(`/referee/${token}/respond`, {
        confirmsKnowsApplicant: declarations[0],
        confirmsInformationAccurate: declarations[1],
        willingToActAsReferee: declarations[2],
        understandsConsequences: declarations[3],
        identityType: identityNumber ? identityType : undefined,
        identityNumber: identityNumber || undefined,
        occupation: occupation || undefined,
      });
      setOutcome(result.message);
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  async function decline() {
    const reason = window.prompt('You may give a reason (optional):') ?? undefined;
    setBusy(true);
    try {
      const result = await api.publicPost<{ message: string }>(`/referee/${token}/decline`, { reason });
      setOutcome(result.message);
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="public">
        <div className="public__card">
          <Loading rows={4} />
        </div>
      </div>
    );
  }

  if (outcome) {
    return (
      <div className="public">
        <div className="public__card">
          <div className="verdict verdict--valid">
            <p className="verdict__mark">✓</p>
            <p className="verdict__label">THANK YOU</p>
          </div>
          <p style={{ fontSize: '0.9rem' }}>{outcome}</p>
        </div>
      </div>
    );
  }

  if (error && !invitation) {
    return (
      <div className="public">
        <div className="public__card">
          <div style={{ textAlign: 'center', marginBottom: 18 }}>
            <img src="/icon.svg" alt="" width={48} height={48} />
            <h1 style={{ fontSize: '1rem', margin: '10px 0 0' }}>Agent verification request</h1>
          </div>
          <ErrorAlert error={error} />
        </div>
      </div>
    );
  }

  if (!invitation) return null;

  const allConfirmed = declarations.every(Boolean);

  return (
    <div className="public">
      <div className="public__card">
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <img src="/icon.svg" alt="" width={48} height={48} />
          <h1 style={{ fontSize: '1.05rem', margin: '10px 0 2px' }}>Agent verification request</h1>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>
            Plateau State Internal Revenue Service · {invitation.referenceCode}
          </p>
        </div>

        <Alert kind="info" title={`${invitation.applicantName} has named you as their referee`}>
          <p style={{ margin: 0 }}>
            They have applied to become an authorised revenue agent
            {invitation.applicantLga ? ` in ${invitation.applicantLga}` : ''}. PSIRS needs someone who
            knows them to confirm their identity and suitability.
          </p>
        </Alert>

        <KeyValue
          items={[
            ['Applicant', invitation.applicantName],
            ['You are recorded as', invitation.refereeName],
            ['Stated relationship', invitation.relationship],
            ['Referee category', invitation.category.replace(/_/g, ' ').toLowerCase()],
            ['Respond before', formatDate(invitation.expiresAt)],
          ]}
        />

        <ErrorAlert error={error} />

        <p className="card__hint" style={{ marginTop: 18, fontWeight: 650, color: 'var(--ink)' }}>
          Please confirm each of the following:
        </p>

        {invitation.declarations.map((declaration, index) => (
          <label
            key={declaration}
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              padding: '9px 0',
              fontSize: '0.88rem',
              fontWeight: 500,
            }}
          >
            <input
              type="checkbox"
              style={{ width: 20, height: 20, marginTop: 2, flexShrink: 0 }}
              checked={declarations[index]}
              onChange={(event) => {
                const next = [...declarations];
                next[index] = event.target.checked;
                setDeclarations(next);
              }}
            />
            <span>{declaration}</span>
          </label>
        ))}

        <div className="field" style={{ marginTop: 16 }}>
          <label htmlFor="id-type">Your identification type</label>
          <select id="id-type" value={identityType} onChange={(event) => setIdentityType(event.target.value)}>
            <option value="NIN">National Identification Number</option>
            <option value="BVN">Bank Verification Number</option>
            <option value="PASSPORT">International passport</option>
            <option value="DRIVERS_LICENCE">Driver's licence</option>
            <option value="VOTERS_CARD">Voter's card</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="id-number">Your identification number</label>
          <input
            id="id-number"
            inputMode="numeric"
            value={identityNumber}
            onChange={(event) => setIdentityNumber(event.target.value)}
          />
          <p className="field__hint">
            Stored securely and never shown in full. If you leave this blank, a PSIRS officer will
            review your response manually.
          </p>
        </div>

        <div className="field">
          <label htmlFor="occupation">Your occupation</label>
          <input
            id="occupation"
            value={occupation}
            onChange={(event) => setOccupation(event.target.value)}
          />
        </div>

        <div className="button-row" style={{ marginTop: 8 }}>
          <button type="button" disabled={busy || !allConfirmed} onClick={respond}>
            {busy ? 'Submitting…' : 'Confirm and submit'}
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={decline}>
            I cannot act as referee
          </button>
        </div>

        <p style={{ fontSize: '0.74rem', color: 'var(--muted)', marginTop: 16 }}>
          You do not need an account. This link can be used once and expires on{' '}
          {formatDate(invitation.expiresAt)}.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Citizen self-service tax status portal
// ---------------------------------------------------------------------------

/**
 * What the public status check is allowed to know.
 *
 * Narrower than it was, and narrower than the officer and agent views, for
 * the reason set out in `routes/citizen.ts`: nobody proves who they are
 * before asking, and a phone number is not proof. The TIN, the numeric
 * score, the obligation names and the eligible programmes are no longer
 * returned to an anonymous caller, so there is nothing here to render them
 * from.
 */
interface CitizenStatusResult {
  found: boolean;
  count?: number;
  tinStatus?: string;
  complianceStatus?: string;
  hasOutstanding?: boolean;
  message: string;
  detail?: string;
}

type SearchMode = 'tin' | 'phone' | 'name';

const STATUS_COLORS: Record<string, string> = {
  COMPLIANT: 'var(--success, #1a7f3c)',
  HAS_ARREARS: 'var(--danger, #c0392b)',
  NEEDS_ATTENTION: 'var(--warning, #b7651d)',
  NOT_ASSESSED: 'var(--muted)',
};

interface AttestationMember {
  id: string;
  status: string;
  full_name: string;
  phone: string;
  member_reference: string | null;
}

interface AttestationView {
  groupName: string;
  groupCode: string;
  leaderName: string;
  lga: string;
  members: AttestationMember[];
}

/**
 * The group leader's screen: is this person really one of yours?
 *
 * Reached by a link in an SMS, with no account, because a cooperative chairman
 * in a village has no reason to hold one. The question is deliberately narrow —
 * membership, one person at a time — since that is the only thing the leader
 * is being asked to put their name to.
 *
 * There is no "confirm all". The whole worth of an attestation over an
 * assertion is that somebody looked at each name, and a button that answers
 * three hundred at once removes exactly that. Members already confirmed are
 * shown but not asked about again, so a growing cooperative only ever presents
 * the people who are new.
 */
export function GroupAttestationScreen({ token }: { token: string }) {
  const [view, setView] = useState<AttestationView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, 'YES' | 'NO'>>({});

  useEffect(() => {
    api
      .publicGet<AttestationView>(`/group-attestation/${token}`)
      .then(setView)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      })
      .finally(() => setLoading(false));
  }, [token]);

  const pending = (view?.members ?? []).filter((m) => m.status === 'PENDING_ATTESTATION');
  const alreadyConfirmed = (view?.members ?? []).filter((m) => m.status === 'ATTESTED');
  const answered = pending.filter((m) => answers[m.id]).length;
  const allAnswered = pending.length > 0 && answered === pending.length;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.publicPost<{ message: string }>(
        `/group-attestation/${token}/confirm`,
        {
          confirmedMemberIds: pending.filter((m) => answers[m.id] === 'YES').map((m) => m.id),
          rejectedMemberIds: pending.filter((m) => answers[m.id] === 'NO').map((m) => m.id),
        },
      );
      setOutcome(result.message);
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="public">
        <div className="public__card">
          <Loading rows={4} />
        </div>
      </div>
    );
  }

  if (outcome) {
    return (
      <div className="public">
        <div className="public__card">
          <div className="verdict verdict--valid">
            <p className="verdict__mark">✓</p>
            <p className="verdict__label">THANK YOU</p>
          </div>
          <p style={{ fontSize: '0.9rem' }}>{outcome}</p>
        </div>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="public">
        <div className="public__card">
          <div style={{ textAlign: 'center', marginBottom: 18 }}>
            <img src="/icon.svg" alt="" width={48} height={48} />
            <h1 style={{ fontSize: '1rem', margin: '10px 0 0' }}>Group membership check</h1>
          </div>
          <ErrorAlert error={error} />
        </div>
      </div>
    );
  }

  return (
    <div className="public">
      <div className="public__card">
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <img src="/icon.svg" alt="" width={48} height={48} />
          <h1 style={{ fontSize: '1.05rem', margin: '10px 0 2px' }}>Group membership check</h1>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>
            Plateau State Internal Revenue Service · {view.groupCode}
          </p>
        </div>

        <Alert kind="info" title={`${view.groupName}`}>
          <p style={{ margin: 0 }}>
            You are recorded as the leader of this group in {view.lga}. PSIRS needs you to confirm
            which of these people really are members. Government support is offered to members, so
            confirming somebody who is not one takes it from somebody who is.
          </p>
        </Alert>

        <KeyValue
          items={[
            ['Group', view.groupName],
            ['You are recorded as', view.leaderName],
            ['Local Government Area', view.lga],
            ['Already confirmed', String(alreadyConfirmed.length)],
          ]}
        />

        <ErrorAlert error={error} />

        {pending.length === 0 ? (
          <Alert kind="success" title="Nothing waiting">
            <p style={{ margin: 0 }}>
              Every member on this list has already been confirmed. There is nothing for you to do.
            </p>
          </Alert>
        ) : (
          <>
            <p className="card__hint" style={{ marginTop: 18, fontWeight: 650, color: 'var(--ink)' }}>
              Is each of these people a member of your group? ({answered} of {pending.length}{' '}
              answered)
            </p>

            {pending.map((member) => (
              <div
                key={member.id}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 8,
                  padding: '12px 0',
                  borderBottom: '1px solid var(--line)',
                }}
              >
                {/*
                  * The name takes the whole row on a narrow screen.
                  * Sharing it with two buttons on a 390px phone broke names
                  * like "Nanribet Choji" across lines, and this is a screen
                  * whose entire job is reading a name and recognising it.
                  */}
                <div style={{ flex: '1 1 100%', minWidth: 0 }}>
                  <div style={{ fontWeight: 650 }}>{member.full_name.trim()}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                    {member.phone}
                    {member.member_reference ? ` · ${member.member_reference}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flex: '1 1 auto' }}>
                  <button
                    type="button"
                    className={answers[member.id] === 'YES' ? 'small' : 'small secondary'}
                    style={{ flex: 1, justifyContent: 'center' }}
                    aria-pressed={answers[member.id] === 'YES'}
                    onClick={() => setAnswers((prev) => ({ ...prev, [member.id]: 'YES' }))}
                  >
                    Member
                  </button>
                  <button
                    type="button"
                    className={answers[member.id] === 'NO' ? 'small danger' : 'small secondary'}
                    style={{ flex: 1, justifyContent: 'center' }}
                    aria-pressed={answers[member.id] === 'NO'}
                    onClick={() => setAnswers((prev) => ({ ...prev, [member.id]: 'NO' }))}
                  >
                    Not a member
                  </button>
                </div>
              </div>
            ))}

            <button
              type="button"
              disabled={busy || !allAnswered}
              style={{ width: '100%', justifyContent: 'center', marginTop: 18 }}
              onClick={() => void submit()}
            >
              {busy ? 'Sending…' : 'Send my answers to PSIRS'}
            </button>
            {!allAnswered && (
              <p className="card__hint" style={{ marginTop: 8 }}>
                Please answer for every person before sending.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function CitizenPortalScreen() {
  const [mode, setMode] = useState<SearchMode>('tin');
  const [input, setInput] = useState('');
  const [result, setResult] = useState<CitizenStatusResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!input.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const params = new URLSearchParams({ [mode]: input.trim() });
      const data = await api.publicGet<CitizenStatusResult>(
        `/citizen-status?${params.toString()}`,
      );
      setResult(data);
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  const placeholders: Record<SearchMode, string> = {
    tin: 'e.g. PL-000001234',
    phone: 'e.g. 08012345678',
    name: 'e.g. Aminu Ibrahim',
  };

  return (
    <div className="public">
      <div className="public__card">
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <img src="/icon.svg" alt="" width={48} height={48} />
          <h1 style={{ fontSize: '1.05rem', margin: '10px 0 2px' }}>
            Check your tax status
          </h1>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>
            Plateau State Internal Revenue Service
          </p>
        </div>

        {/* Search mode selector */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {(['tin', 'phone', 'name'] as SearchMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={mode === m ? undefined : 'secondary'}
              style={{ flex: 1, justifyContent: 'center', fontSize: '0.82rem', padding: '8px 4px' }}
              onClick={() => { setMode(m); setInput(''); setResult(null); setError(null); }}
            >
              {m === 'tin' ? 'By TIN' : m === 'phone' ? 'By phone' : 'By name'}
            </button>
          ))}
        </div>

        <form onSubmit={(e) => void search(e)}>
          <div className="field">
            <label htmlFor="citizen-input">
              {mode === 'tin' ? 'Tax Identification Number (TIN)' :
               mode === 'phone' ? 'Registered phone number' :
               'Full name or business name'}
            </label>
            <input
              id="citizen-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={placeholders[mode]}
              inputMode={mode === 'phone' ? 'tel' : 'text'}
            />
          </div>
          <button type="submit" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
            {busy ? 'Searching…' : 'Check status'}
          </button>
        </form>

        <ErrorAlert error={error} />

        {result && !result.found && (
          <div style={{ marginTop: 16 }}>
            <div className="verdict verdict--invalid">
              <p className="verdict__mark">×</p>
              <p className="verdict__label">NOT FOUND</p>
            </div>
            <p style={{ fontSize: '0.87rem' }}>{result.message}</p>
            {result.count !== undefined && result.count > 1 && (
              <p style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
                Use your TIN or exact phone number for a precise result.
              </p>
            )}
          </div>
        )}

        {/*
          * A name search answers with a count, never a record: the API sends
          * back `count` and a message and nothing else, because it has not
          * established which of the five Danjumas is asking. The block below
          * renders a specific person's status, so it must not run for that
          * case — `complianceStatus` being absent is what distinguishes the
          * two. Rendering it anyway drew "TIN status —" and "Outstanding
          * obligations: None" from undefined values, which reads as a clean
          * bill of health for a record that was never looked up.
          */}
        {/*
          * A name search matched somebody, but not a specific somebody, so it
          * gets its own answer rather than falling through to the record view
          * below or to the NOT FOUND block above — neither of which is true.
          */}
        {result?.found && result.complianceStatus === undefined && (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontSize: '0.87rem', margin: 0 }}>{result.message}</p>
          </div>
        )}

        {result?.found && result.complianceStatus !== undefined && (
          <div style={{ marginTop: 18 }}>
            {/* Compliance status badge */}
            <div style={{
              background: 'var(--surface-2, #f5f5f5)',
              border: `2px solid ${STATUS_COLORS[result.complianceStatus ?? ''] ?? 'var(--muted)'}`,
              borderRadius: 10,
              padding: '12px 16px',
              marginBottom: 14,
              textAlign: 'center',
            }}>
              <p style={{ margin: '0 0 4px', fontSize: '0.78rem', color: 'var(--muted)' }}>Tax compliance status</p>
              <p style={{
                margin: 0,
                fontWeight: 700,
                fontSize: '1.05rem',
                color: STATUS_COLORS[result.complianceStatus ?? ''] ?? 'var(--muted)',
              }}>
                {result.complianceStatus === 'COMPLIANT' ? '✓ Compliant' :
                 result.complianceStatus === 'HAS_ARREARS' ? '⚠ Has Arrears' :
                 result.complianceStatus === 'NEEDS_ATTENTION' ? '! Needs Attention' :
                 'Not yet assessed'}
              </p>
            </div>

            <p style={{ fontSize: '0.87rem', marginBottom: 14 }}>{result.message}</p>

            <KeyValue
              items={[
                ['TIN status', result.tinStatus ?? '—'],
                ['Outstanding obligations', result.hasOutstanding ? 'Yes — please contact PSIRS' : 'None'],
              ]}
            />

            <p style={{ fontSize: '0.74rem', color: 'var(--muted)', marginTop: 16 }}>
              {result.detail ??
                'For questions about your account, visit any PSIRS office or contact an authorised revenue agent.'}
            </p>
          </div>
        )}

        <div style={{ marginTop: 20, borderTop: '1px solid var(--border, #e0e0e0)', paddingTop: 14, textAlign: 'center' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--muted)', margin: '0 0 8px' }}>
            Also available:
          </p>
          <a href="#/verify" style={{ fontSize: '0.8rem' }}>Verify a payment receipt →</a>
        </div>
      </div>
    </div>
  );
}
