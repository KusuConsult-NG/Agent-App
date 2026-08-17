/**
 * Public, unauthenticated surfaces.
 *
 *   /verify/:code    — receipt and document verification (PRD §20, §43)
 *   /referee/:token  — referee verification portal (Addendum §10-§13)
 *
 * Neither requires an account. The verification page deliberately shows very
 * little: enough to prove a receipt is genuine, and nothing that would let a
 * stranger learn about a taxpayer's affairs.
 */

import { useEffect, useState, type FormEvent } from 'react';
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
        // A "not found" answer is a legitimate result, not an error.
        if (caught.status === 404 && (caught.error as unknown as VerificationResult).status) {
          setResult(caught.error as unknown as VerificationResult);
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
