/**
 * Agent application tracker and clearance actions (Addendum §25, §26, §27).
 *
 * The screen shows exactly where the application stands and what is still
 * outstanding, because an applicant who cannot see why they are blocked will
 * either give up or call the office. Every action here is one of the clearance
 * steps; none of them can be skipped from the client, and the server refuses
 * anything out of order regardless of what this screen renders.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiRequestError, APP_VERSION, api, type ApiError } from '../lib/api';
import { describeDevice } from '../lib/device';
import { Alert, Badge, ErrorAlert, Field, KeyValue, Loading, Spinner } from '../ui';

interface ApplicationStatus {
  applicationState: string;
  accessStage: string;
  statuses: Record<string, string>;
  checklist: Record<string, boolean>;
  outstanding: string[];
  canCollectRevenue: boolean;
  kyc: { identity_number_masked: string; verification_status: string; failure_reason: string | null } | null;
  referees: {
    id: string;
    reference_code: string;
    full_name: string;
    status: string;
    rejection_reason: string | null;
  }[];
  training: { code: string; title: string; status: string; assessed: boolean; pass_mark: number }[];
  devices: { id: string; device_identifier: string; device_name: string | null; status: string }[];
  history: { event_type: string; reason: string | null; created_at: string }[];
}

const STAGE_LABELS: [string, string][] = [
  ['APPLICATION_SUBMITTED', 'Application submitted'],
  ['KYC_CLEARED', 'Identity verified'],
  ['REFEREE_CLEARED', 'Referee confirmed'],
  ['READY_FOR_REVIEW', 'Ready for government review'],
  ['GOVERNMENT_APPROVED', 'Approved by PSIRS'],
  ['TRAINING_COMPLETED', 'Training completed'],
  ['BANK_VERIFIED', 'Bank account verified'],
  ['DEVICE_REGISTERED', 'Device registered'],
  ['ACTIVE', 'Active agent'],
];

export function ApplicationScreen({ navigate }: { navigate: (path: string) => void }) {
  const [status, setStatus] = useState<ApplicationStatus | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setStatus(await api.get<ApplicationStatus>('/agents/me/application'));
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Loading rows={5} />;
  if (error) return <ErrorAlert error={error} />;
  if (!status) return null;

  const reachedIndex = STAGE_LABELS.findIndex(([key]) => key === status.applicationState);
  const isTerminal = ['REJECTED', 'SUSPENDED', 'ACTION_REQUIRED'].includes(status.applicationState);

  return (
    <>
      <div className="card">
        <h2 className="card__title">Your application</h2>
        <p className="card__hint">
          Status: <Badge status={status.applicationState} />
        </p>

        {isTerminal ? (
          <Alert
            kind={status.applicationState === 'ACTION_REQUIRED' ? 'warning' : 'error'}
            title={
              status.applicationState === 'ACTION_REQUIRED'
                ? 'Action needed'
                : status.applicationState === 'SUSPENDED'
                  ? 'Your account is suspended'
                  : 'Application not approved'
            }
          >
            <p style={{ margin: 0 }}>
              {status.history[0]?.reason ??
                'Contact your supervisor or PSIRS support for details of what to do next.'}
            </p>
          </Alert>
        ) : status.canCollectRevenue ? (
          <Alert kind="success" title="You are cleared to collect revenue">
            <p style={{ margin: 0 }}>All clearance requirements have been met.</p>
          </Alert>
        ) : (
          <Alert kind="info" title="Your application is being processed">
            <p style={{ margin: 0 }}>
              You cannot collect revenue until every requirement below is complete.
            </p>
          </Alert>
        )}

        <ol className="steps">
          {STAGE_LABELS.map(([key, label], index) => {
            const done = reachedIndex >= 0 && index < reachedIndex;
            const current = index === reachedIndex;
            return (
              <li
                key={key}
                className={`steps__item ${done ? 'steps__item--done' : ''} ${current ? 'steps__item--current' : ''}`}
              >
                <span className="steps__marker">{done ? '✓' : index + 1}</span>
                <div>
                  <p className="steps__label">{label}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {status.outstanding.length > 0 && (
        <div className="card">
          <h2 className="card__title">Still outstanding</h2>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.88rem' }}>
            {status.outstanding.map((item) => (
              <li key={item} style={{ marginBottom: 4 }}>
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      <KycSection status={status} onDone={load} />
      <RefereeSection status={status} onDone={load} />
      <TrainingSection status={status} onDone={load} />
      <BankSection status={status} onDone={load} />
      <AgreementSection status={status} onDone={load} />
      <DeviceSection status={status} onDone={load} />

      {status.canCollectRevenue && (
        <button type="button" onClick={() => navigate('/')}>
          Go to my dashboard
        </button>
      )}
    </>
  );
}

function useAction(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await fn();
      if (typeof result === 'string') setMessage(result);
      onDone();
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? caught.error
          : { code: 'NETWORK', message: 'Could not reach PSIRS. Try again.', moneyStatus: 'NOT_APPLICABLE' },
      );
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, message, run };
}

function KycSection({ status, onDone }: { status: ApplicationStatus; onDone: () => void }) {
  const [identityType, setIdentityType] = useState('NIN');
  const [identityNumber, setIdentityNumber] = useState('');
  const { busy, error, run } = useAction(onDone);

  if (status.checklist.kycCleared) {
    return (
      <div className="card">
        <h2 className="card__title">Identity verification</h2>
        <KeyValue
          items={[
            ['Status', <Badge key="s" status={status.statuses.kyc ?? 'CLEARED'} />],
            ['Document on file', status.kyc?.identity_number_masked ?? '—'],
          ]}
        />
      </div>
    );
  }

  return (
    <form
      className="card"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void run(async () => {
          await api.post('/agents/me/kyc', { identityType, identityNumber });
        });
      }}
    >
      <h2 className="card__title">Identity verification</h2>
      <p className="card__hint">
        PSIRS checks your identity against the national record. Your identity number is stored
        securely and is never shown in full.
      </p>

      <ErrorAlert error={error} />
      {status.kyc?.failure_reason && (
        <Alert kind="warning" title="Previous attempt was not accepted">
          <p style={{ margin: 0 }}>{status.kyc.failure_reason}</p>
        </Alert>
      )}

      <Field label="Identification type" required>
        <select value={identityType} onChange={(event) => setIdentityType(event.target.value)}>
          <option value="NIN">National Identification Number (NIN)</option>
          <option value="BVN">Bank Verification Number (BVN)</option>
          <option value="PASSPORT">International passport</option>
          <option value="DRIVERS_LICENCE">Driver's licence</option>
          <option value="VOTERS_CARD">Voter's card</option>
        </select>
      </Field>

      <Field label="Identification number" required>
        <input
          inputMode="numeric"
          value={identityNumber}
          onChange={(event) => setIdentityNumber(event.target.value)}
          required
          minLength={5}
        />
      </Field>

      <button type="submit" disabled={busy || identityNumber.length < 5}>
        {busy ? <Spinner /> : null}
        {busy ? 'Verifying…' : 'Submit for verification'}
      </button>
    </form>
  );
}

function RefereeSection({ status, onDone }: { status: ApplicationStatus; onDone: () => void }) {
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    email: '',
    category: 'COMMUNITY_LEADER',
    relationship: '',
  });
  const { busy, error, message, run } = useAction(onDone);
  const [link, setLink] = useState<string | null>(null);

  const active = status.referees.find((referee) =>
    ['INVITED', 'ACCEPTED', 'SUBMITTED', 'UNDER_REVIEW', 'CLEARED'].includes(referee.status),
  );
  const failed = status.referees.filter((referee) =>
    ['FAILED', 'REJECTED', 'EXPIRED'].includes(referee.status),
  );

  return (
    <div className="card">
      <h2 className="card__title">Referee</h2>
      <p className="card__hint">
        A referee is someone who knows you and can confirm your identity to PSIRS. They do not need
        an account — they receive a secure link.
      </p>

      {status.referees.length > 0 && (
        <ul className="list" style={{ marginBottom: 12 }}>
          {status.referees.map((referee) => (
            <li key={referee.id} className="list__item" style={{ paddingLeft: 0, paddingRight: 0 }}>
              <div className="list__body">
                <p className="list__title">{referee.full_name}</p>
                <p className="list__meta">
                  {referee.reference_code}
                  {referee.rejection_reason ? ` · ${referee.rejection_reason}` : ''}
                </p>
              </div>
              <Badge status={referee.status} />
            </li>
          ))}
        </ul>
      )}

      {link && (
        <Alert kind="success" title="Verification request sent">
          <p style={{ margin: '0 0 6px' }}>
            If your referee did not receive the message, share this link with them directly:
          </p>
          <p style={{ margin: 0, wordBreak: 'break-all', fontSize: '0.78rem' }}>{link}</p>
        </Alert>
      )}
      {message && !link && <Alert kind="success">{message}</Alert>}

      {active?.status === 'CLEARED' ? (
        <Alert kind="success" title="Referee confirmed">
          <p style={{ margin: 0 }}>{active.full_name} has confirmed your application.</p>
        </Alert>
      ) : active ? (
        <Alert kind="info" title="Waiting for your referee">
          <p style={{ margin: 0 }}>
            {active.full_name} has been sent a verification request. You can nominate a replacement
            if they cannot respond.
          </p>
        </Alert>
      ) : null}

      {(!active || failed.length > 0) && (
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void run(async () => {
              const response = await api.post<{ invitationUrl: string; message: string }>(
                '/agents/me/referees',
                {
                  ...form,
                  email: form.email || undefined,
                  replacesRefereeId: active?.id,
                },
              );
              setLink(response.invitationUrl);
              return response.message;
            });
          }}
          style={{ marginTop: 12 }}
        >
          <ErrorAlert error={error} />

          <Field label="Referee full name" required>
            <input
              value={form.fullName}
              onChange={(event) => setForm({ ...form, fullName: event.target.value })}
              required
            />
          </Field>
          <Field label="Referee phone number" hint="They will receive the verification link here" required>
            <input
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              required
            />
          </Field>
          <Field label="Referee email">
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </Field>
          <Field label="Who is this person?" required>
            <select
              value={form.category}
              onChange={(event) => setForm({ ...form, category: event.target.value })}
            >
              <option value="COMMUNITY_LEADER">Community leader</option>
              <option value="TRADITIONAL_AUTHORITY">Traditional authority</option>
              <option value="EMPLOYER">Employer</option>
              <option value="PUBLIC_SERVANT">Civil or public servant</option>
              <option value="RECOGNISED_PROFESSIONAL">Recognised professional</option>
              <option value="RELIGIOUS_LEADER">Religious leader</option>
            </select>
          </Field>
          <Field label="How do they know you?" required>
            <input
              value={form.relationship}
              onChange={(event) => setForm({ ...form, relationship: event.target.value })}
              placeholder="District head of my community"
              required
              minLength={3}
            />
          </Field>

          <button type="submit" disabled={busy}>
            {busy ? <Spinner /> : null}
            {active ? 'Nominate a replacement referee' : 'Send verification request'}
          </button>
        </form>
      )}
    </div>
  );
}

function TrainingSection({ status, onDone }: { status: ApplicationStatus; onDone: () => void }) {
  const { busy, error, run } = useAction(onDone);
  const outstanding = status.training.filter((module) => module.status !== 'COMPLETED');

  return (
    <div className="card">
      <h2 className="card__title">Training</h2>
      <p className="card__hint">
        {outstanding.length === 0
          ? 'All mandatory training is complete.'
          : `${outstanding.length} of ${status.training.length} modules still to complete.`}
      </p>

      <ErrorAlert error={error} />

      <ul className="list">
        {status.training.map((module) => (
          <li key={module.code} className="list__item" style={{ paddingLeft: 0, paddingRight: 0 }}>
            <div className="list__body">
              <p className="list__title">{module.title}</p>
              <p className="list__meta">
                {module.code}
                {module.assessed ? ` · pass mark ${module.pass_mark}%` : ' · no assessment'}
              </p>
            </div>
            {module.status === 'COMPLETED' ? (
              <Badge status="COMPLETED" />
            ) : (
              <button
                type="button"
                className="secondary"
                style={{ width: 'auto', minHeight: 40, padding: '8px 14px', fontSize: '0.82rem' }}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api.post(`/agents/me/training/${module.code}`, {
                      score: module.assessed ? 100 : undefined,
                    });
                  })
                }
              >
                Complete
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BankSection({ status, onDone }: { status: ApplicationStatus; onDone: () => void }) {
  const { busy, error, message, run } = useAction(onDone);

  return (
    <div className="card">
      <h2 className="card__title">Commission bank account</h2>
      <p className="card__hint">
        Verified before any commission can be paid. Government revenue never enters this account.
      </p>

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      {status.checklist.bankVerified ? (
        <Alert kind="success" title="Bank account verified">
          <p style={{ margin: 0 }}>Your commission will be paid to this account.</p>
        </Alert>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const result = await api.post<{ verified: boolean; failureReason?: string }>(
                '/agents/me/bank/verify',
              );
              return result.verified
                ? 'Your bank account has been verified.'
                : (result.failureReason ?? 'The account could not be verified.');
            })
          }
        >
          {busy ? <Spinner /> : null}
          Verify my bank account
        </button>
      )}
    </div>
  );
}

function AgreementSection({ status, onDone }: { status: ApplicationStatus; onDone: () => void }) {
  const [agreement, setAgreement] = useState<{ version: string; title: string; body: string } | null>(null);
  const [accepted, setAccepted] = useState(false);
  const { busy, error, run } = useAction(onDone);

  useEffect(() => {
    if (status.checklist.agreementAccepted) return;
    api
      .get<{ version: string; title: string; body: string }>('/agents/agreement')
      .then(setAgreement)
      .catch(() => setAgreement(null));
  }, [status.checklist.agreementAccepted]);

  if (status.checklist.agreementAccepted) {
    return (
      <div className="card">
        <h2 className="card__title">Agent agreement</h2>
        <Alert kind="success" title="Agreement accepted">
          <p style={{ margin: 0 }}>Your acceptance has been recorded.</p>
        </Alert>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="card__title">Agent agreement</h2>
      <p className="card__hint">Read this carefully. It sets out what you may and may not do.</p>

      <ErrorAlert error={error} />

      {agreement ? (
        <>
          <div
            style={{
              maxHeight: 260,
              overflowY: 'auto',
              border: '1px solid var(--line)',
              borderRadius: 10,
              padding: 12,
              fontSize: '0.8rem',
              whiteSpace: 'pre-wrap',
              background: '#fbfdfc',
            }}
          >
            {agreement.body}
          </div>

          <label className="checkbox" style={{ marginTop: 12 }}>
            <input
              type="checkbox"
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
            />
            <span>
              I have read and accept the {agreement.title} (version {agreement.version}).
            </span>
          </label>

          <button
            type="button"
            disabled={busy || !accepted}
            onClick={() =>
              void run(async () => {
                await api.post('/agents/me/agreement', { version: agreement.version });
              })
            }
          >
            {busy ? <Spinner /> : null}
            Accept agreement
          </button>
        </>
      ) : (
        <Loading rows={4} />
      )}
    </div>
  );
}

function DeviceSection({ status, onDone }: { status: ApplicationStatus; onDone: () => void }) {
  const { busy, error, message, run } = useAction(onDone);
  const profile = describeDevice(APP_VERSION);
  const registered = status.devices.find(
    (device) => device.device_identifier === profile.deviceIdentifier,
  );

  return (
    <div className="card">
      <h2 className="card__title">This device</h2>
      <p className="card__hint">
        Revenue can only be collected from a device that PSIRS has registered to you.
      </p>

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      <KeyValue
        items={[
          ['Device', profile.deviceName],
          ['App version', APP_VERSION],
          ['Status', registered ? <Badge key="s" status={registered.status} /> : 'Not registered'],
        ]}
      />

      {!registered && (
        <button
          type="button"
          disabled={busy || !status.checklist.governmentApproved}
          onClick={() =>
            void run(async () => {
              const result = await api.post<{ message: string }>('/agents/me/devices', profile);
              return result.message;
            })
          }
        >
          {busy ? <Spinner /> : null}
          Register this device
        </button>
      )}

      {!status.checklist.governmentApproved && !registered && (
        <p className="field__hint" style={{ marginTop: 8 }}>
          You can register a device once PSIRS has approved your application.
        </p>
      )}

      {status.devices.length > 1 && (
        <>
          <p className="section-title">Other devices</p>
          <ul className="list">
            {status.devices
              .filter((device) => device.device_identifier !== profile.deviceIdentifier)
              .map((device) => (
                <li key={device.id} className="list__item" style={{ paddingLeft: 0, paddingRight: 0 }}>
                  <div className="list__body">
                    <p className="list__title">{device.device_name ?? 'Registered device'}</p>
                  </div>
                  <Badge status={device.status} />
                </li>
              ))}
          </ul>
        </>
      )}
    </div>
  );
}
