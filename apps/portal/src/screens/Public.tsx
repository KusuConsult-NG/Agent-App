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
import { usePublicI18n } from '../lib/i18n';
import { LanguageToggle } from '../ui';
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
  const { t } = usePublicI18n();
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
          <LanguageToggle />
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <img src="/icon.svg" alt="" width={48} height={48} />
          <h1 style={{ fontSize: '1.05rem', margin: '10px 0 2px' }}>{t.pubVerifyTitle}</h1>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>
            {t.pubService}
          </p>
        </div>

        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void check(input);
          }}
        >
          <div className="field">
            <label htmlFor="code">{t.pubVerifyField}</label>
            <input
              id="code"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="PSIRS/2026/000123"
              autoCapitalize="characters"
            />
          </div>
          <button type="submit" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
            {busy ? t.pubVerifyChecking : t.pubVerifyAction}
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
                  ? /*
                     * An acknowledgement is genuine, so it is VALID, and a
                     * verdict that says only VALID is read as "paid" by
                     * everybody who takes in the mark and not the paragraph
                     * under it. The mark has to carry the distinction itself.
                     */
                    result.documentType === 'PAYMENT_ACKNOWLEDGEMENT'
                    ? t.pubVerdictAcknowledgement
                    : t.pubVerdictValid
                  : result.status === 'REVERSED'
                    ? t.pubVerdictReversed
                    : result.status === 'NOT_FOUND'
                      ? t.pubVerdictNotFound
                      : t.pubVerdictInvalid}
              </p>
            </div>

            <p style={{ fontSize: '0.87rem' }}>{result.message}</p>

            {(result.receiptNumber || result.documentNumber) && (
              <KeyValue
                items={[
                  [t.pubVerifyReceiptNumber, result.receiptNumber ?? result.documentNumber ?? '—'],
                  [t.pubVerifyRevenueType, result.revenueType ?? result.documentType ?? '—'],
                  ['Amount', result.amountKobo ? <Money key="a" kobo={result.amountKobo} /> : '—'],
                  [t.pubVerifyIssued, formatDate(result.issuedAt)],
                  [t.pubVerifyLga, result.lga ?? '—'],
                  [
                    'Document fingerprint',
                    result.integrityConfirmed === undefined
                      ? '—'
                      : result.integrityConfirmed
                        ? t.pubVerifyMatches
                        : t.pubVerifyNoMatch,
                  ],
                ]}
              />
            )}

            <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: 14 }}>
              {t.pubVerifyPrivacy}
            </p>
          </div>
        )}

        {/*
          The only way into the citizen screen from inside the portal. Its
          route existed and nothing linked to it, so the one entrance was the
          reminder SMS — which, until this change, carried a URL the portal
          could not route. Outside the results block on purpose: somebody who
          has come to check a receipt should be able to reach their own status
          without checking one first.
        */}
        <p style={{ fontSize: '0.8rem', marginTop: 14, textAlign: 'center' }}>
          <a href="#/citizen">{t.pubCitizenTitle} →</a>
        </p>
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

/**
 * The four declarations, in the referee's language.
 *
 * `GET /referee/:token` returns these as English sentences and the screen used
 * to render whatever came back. That put the only part of this page with a
 * stated legal consequence — "I understand that providing false information
 * may have consequences" — permanently in English, whatever the reader chose.
 *
 * `POST /referee/:token/respond` records four booleans and nothing about the
 * words; what the referee understood themselves to be agreeing to is exactly
 * what this screen showed them. So the wording is rendered from the dictionary
 * in the order the API sends it, and `referee-declarations.test.ts` pins that
 * order against the API's own list so the two cannot drift apart.
 */
const DECLARATION_KEYS = [
  'pubDeclarationKnows',
  'pubDeclarationAccurate',
  'pubDeclarationWilling',
  'pubDeclarationConsequences',
] as const;

export function RefereePortalScreen({ token }: { token: string }) {
  const { t } = usePublicI18n();
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  /**
   * Declining is a two-step action, in the page rather than in a browser dialog.
   *
   * It is single-use and irreversible from the referee's side — the service
   * writes REJECTED and spends the token — and there is no account to sign back
   * into and undo it. The screen used `window.prompt` for the optional reason
   * and declined on whatever came back, so Cancel declined. It also arrives by
   * SMS and is opened in whichever in-app browser read the message; several
   * suppress prompts, and a suppressed prompt returns null immediately, so the
   * button refused the applicant on the first tap with no dialog at all.
   */
  const [confirmingDecline, setConfirmingDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState('');

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
    setBusy(true);
    setError(null);
    try {
      const result = await api.publicPost<{ message: string }>(`/referee/${token}/decline`, {
        reason: declineReason.trim() || undefined,
      });
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
          <LanguageToggle />
          <Loading rows={4} />
        </div>
      </div>
    );
  }

  if (outcome) {
    return (
      <div className="public">
        <div className="public__card">
          <LanguageToggle />
          <div className="verdict verdict--valid">
            <p className="verdict__mark">✓</p>
            <p className="verdict__label">{t.pubThankYou}</p>
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
          <LanguageToggle />
          <div style={{ textAlign: 'center', marginBottom: 18 }}>
            <img src="/icon.svg" alt="" width={48} height={48} />
            <h1 style={{ fontSize: '1rem', margin: '10px 0 0' }}>{t.pubRefereeTitle}</h1>
          </div>
          <ErrorAlert error={error} />
        </div>
      </div>
    );
  }

  if (!invitation) return null;

  if (confirmingDecline) {
    return (
      <div className="public">
        <div className="public__card">
          <LanguageToggle />
          <div style={{ textAlign: 'center', marginBottom: 18 }}>
            <img src="/icon.svg" alt="" width={48} height={48} />
            <h1 style={{ fontSize: '1rem', margin: '10px 0 0' }}>{t.pubDeclineTitle}</h1>
          </div>

          <ErrorAlert error={error} />

          <p style={{ fontSize: '0.9rem' }}>
            {t.pubDeclineBody1a} <strong>{invitation.applicantName}</strong>{' '}
            {t.pubDeclineBody1b}
          </p>
          <p style={{ fontSize: '0.9rem' }}>
            {t.pubDeclineBody2}
          </p>

          <div className="field" style={{ marginTop: 16 }}>
            <label htmlFor="decline-reason">{t.pubDeclineReason}</label>
            <textarea
              id="decline-reason"
              rows={3}
              value={declineReason}
              onChange={(event) => setDeclineReason(event.target.value)}
            />
            <p className="field__hint">
              {t.pubDeclineReasonHint}
            </p>
          </div>

          <div className="button-row" style={{ marginTop: 8 }}>
            <button type="button" className="secondary" disabled={busy} onClick={decline}>
              {busy ? t.pubDeclineSending : t.pubDeclineYes}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirmingDecline(false);
                setDeclineReason('');
                setError(null);
              }}
            >
              {t.pubDeclineNo}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const allConfirmed = declarations.every(Boolean);

  return (
    <div className="public">
      <div className="public__card">
          <LanguageToggle />
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <img src="/icon.svg" alt="" width={48} height={48} />
          <h1 style={{ fontSize: '1.05rem', margin: '10px 0 2px' }}>{t.pubRefereeTitle}</h1>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>
            {t.pubService} · {invitation.referenceCode}
          </p>
        </div>

        <Alert kind="info" title={`${invitation.applicantName} has named you as their referee`}>
          <p style={{ margin: 0 }}>
            {invitation.applicantLga ? `${invitation.applicantLga} — ` : ''}
            {t.pubRefereeIntro}
          </p>
        </Alert>

        <KeyValue
          items={[
            [t.pubRefereeApplicant, invitation.applicantName],
            [t.pubRefereeYouAre, invitation.refereeName],
            [t.pubRefereeRelationship, invitation.relationship],
            [t.pubRefereeCategory, invitation.category.replace(/_/g, ' ').toLowerCase()],
            [t.pubRefereeRespondBefore, formatDate(invitation.expiresAt)],
          ]}
        />

        <ErrorAlert error={error} />

        <p className="card__hint" style={{ marginTop: 18, fontWeight: 650, color: 'var(--ink)' }}>
          {t.pubRefereeConfirmEach}
        </p>

        {DECLARATION_KEYS.map((key, index) => (
          <label
            key={key}
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
            <span>{t[key]}</span>
          </label>
        ))}

        <div className="field" style={{ marginTop: 16 }}>
          <label htmlFor="id-type">{t.pubRefereeIdType}</label>
          <select id="id-type" value={identityType} onChange={(event) => setIdentityType(event.target.value)}>
            <option value="NIN">{t.pubIdNin}</option>
            <option value="BVN">{t.pubIdBvn}</option>
            <option value="PASSPORT">{t.pubIdPassport}</option>
            <option value="DRIVERS_LICENCE">{t.pubIdLicence}</option>
            <option value="VOTERS_CARD">{t.pubIdVoters}</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="id-number">{t.pubRefereeIdNumber}</label>
          <input
            id="id-number"
            inputMode="numeric"
            value={identityNumber}
            onChange={(event) => setIdentityNumber(event.target.value)}
          />
          <p className="field__hint">
            {t.pubRefereeIdHint}
          </p>
        </div>

        <div className="field">
          <label htmlFor="occupation">{t.pubRefereeOccupation}</label>
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
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => setConfirmingDecline(true)}
          >
            {t.pubRefereeDecline}
          </button>
        </div>

        <p style={{ fontSize: '0.74rem', color: 'var(--muted)', marginTop: 16 }}>
          {t.pubRefereeNoAccount} {formatDate(invitation.expiresAt)}.
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
  const { t } = usePublicI18n();
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
          <LanguageToggle />
          <Loading rows={4} />
        </div>
      </div>
    );
  }

  if (outcome) {
    return (
      <div className="public">
        <div className="public__card">
          <LanguageToggle />
          <div className="verdict verdict--valid">
            <p className="verdict__mark">✓</p>
            <p className="verdict__label">{t.pubThankYou}</p>
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
          <LanguageToggle />
          <div style={{ textAlign: 'center', marginBottom: 18 }}>
            <img src="/icon.svg" alt="" width={48} height={48} />
            <h1 style={{ fontSize: '1rem', margin: '10px 0 0' }}>{t.pubAttestTitle}</h1>
          </div>
          <ErrorAlert error={error} />
        </div>
      </div>
    );
  }

  return (
    <div className="public">
      <div className="public__card">
          <LanguageToggle />
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <img src="/icon.svg" alt="" width={48} height={48} />
          <h1 style={{ fontSize: '1.05rem', margin: '10px 0 2px' }}>{t.pubAttestTitle}</h1>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>
            {t.pubService} · {view.groupCode}
          </p>
        </div>

        <Alert kind="info" title={`${view.groupName}`}>
          <p style={{ margin: 0 }}>
            {view.lga} — {t.pubAttestIntro}
          </p>
        </Alert>

        <KeyValue
          items={[
            [t.pubAttestGroup, view.groupName],
            [t.pubRefereeYouAre, view.leaderName],
            [t.pubVerifyLga, view.lga],
            [t.pubAttestAlready, String(alreadyConfirmed.length)],
          ]}
        />

        <ErrorAlert error={error} />

        {pending.length === 0 ? (
          <Alert kind="success" title={t.pubAttestNothingTitle}>
            <p style={{ margin: 0 }}>
              {t.pubAttestNothingBody}
            </p>
          </Alert>
        ) : (
          <>
            <p className="card__hint" style={{ marginTop: 18, fontWeight: 650, color: 'var(--ink)' }}>
              {t.pubAttestQuestion} ({answered} of {pending.length}{' '}
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
                    {t.pubAttestYes}
                  </button>
                  <button
                    type="button"
                    className={answers[member.id] === 'NO' ? 'small danger' : 'small secondary'}
                    style={{ flex: 1, justifyContent: 'center' }}
                    aria-pressed={answers[member.id] === 'NO'}
                    onClick={() => setAnswers((prev) => ({ ...prev, [member.id]: 'NO' }))}
                  >
                    {t.pubAttestNo}
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
              {busy ? t.pubDeclineSending : t.pubAttestSubmit}
            </button>
            {!allAnswered && (
              <p className="card__hint" style={{ marginTop: 8 }}>
                {t.pubAttestAnswerAll}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function CitizenPortalScreen() {
  const { t } = usePublicI18n();
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
          <LanguageToggle />
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <img src="/icon.svg" alt="" width={48} height={48} />
          <h1 style={{ fontSize: '1.05rem', margin: '10px 0 2px' }}>
            {t.pubCitizenTitle}
          </h1>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>
            {t.pubService}
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
              {mode === 'tin' ? t.pubCitizenByTin :
               mode === 'phone' ? t.pubCitizenByPhone :
               t.pubCitizenByName}
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
              <p className="verdict__label">{t.pubVerdictNotFound}</p>
            </div>
            <p style={{ fontSize: '0.87rem' }}>{result.message}</p>
            {result.count !== undefined && result.count > 1 && (
              <p style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
                {t.pubCitizenTooMany}
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
              <p style={{ margin: '0 0 4px', fontSize: '0.78rem', color: 'var(--muted)' }}>{t.pubCitizenStatusHeading}</p>
              <p style={{
                margin: 0,
                fontWeight: 700,
                fontSize: '1.05rem',
                color: STATUS_COLORS[result.complianceStatus ?? ''] ?? 'var(--muted)',
              }}>
                {result.complianceStatus === 'COMPLIANT' ? `✓ ${t.pubCitizenCompliant}` :
                 result.complianceStatus === 'HAS_ARREARS' ? `⚠ ${t.pubCitizenArrears}` :
                 result.complianceStatus === 'NEEDS_ATTENTION' ? `! ${t.pubCitizenAttention}` :
                 t.pubCitizenNotAssessed}
              </p>
            </div>

            <p style={{ fontSize: '0.87rem', marginBottom: 14 }}>{result.message}</p>

            <KeyValue
              items={[
                [t.pubCitizenTinStatus, result.tinStatus ?? '—'],
                [
                t.pubCitizenOutstanding,
                result.hasOutstanding ? t.pubCitizenOutstandingYes : t.pubCitizenNone,
              ],
              ]}
            />

            <p style={{ fontSize: '0.74rem', color: 'var(--muted)', marginTop: 16 }}>
              {result.detail ??
                t.pubCitizenFooter}
            </p>
          </div>
        )}

        <div style={{ marginTop: 20, borderTop: '1px solid var(--border, #e0e0e0)', paddingTop: 14, textAlign: 'center' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--muted)', margin: '0 0 8px' }}>
            {t.pubCitizenAlso}
          </p>
          <a href="#/verify" style={{ fontSize: '0.8rem' }}>{t.pubCitizenVerifyLink} →</a>
        </div>
      </div>
    </div>
  );
}
