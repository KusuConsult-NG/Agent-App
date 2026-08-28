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
import type { TranslationDictionary } from '@psirs/shared';
import { useI18n } from '../lib/i18n';

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

/*
 * The stage names are dictionary keys rather than English, because this array
 * is module-level and a hook cannot reach it. Resolving `t[key]` at render is
 * what keeps an agent reading Hausa from meeting nine English words in the one
 * place that tells them how far their application has got.
 */
const STAGE_LABELS: [string, keyof TranslationDictionary][] = [
  ['APPLICATION_SUBMITTED', 'appStageSubmitted'],
  ['KYC_CLEARED', 'appStageKyc'],
  ['REFEREE_CLEARED', 'appRefereeConfirmed'],
  ['READY_FOR_REVIEW', 'appStageReview'],
  ['GOVERNMENT_APPROVED', 'appStageApproved'],
  ['TRAINING_COMPLETED', 'appStageTraining'],
  ['BANK_VERIFIED', 'appBankVerified'],
  ['DEVICE_REGISTERED', 'appStageDevice'],
  ['ACTIVE', 'appStageActive'],
];

export function ApplicationScreen({ navigate }: { navigate: (path: string) => void }) {
  const { t } = useI18n();
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
        <h2 className="card__title">{t.appYourApplication}</h2>
        <p className="card__hint">
          {t.appStatus}: <Badge status={status.applicationState} />
        </p>

        {isTerminal ? (
          <Alert
            kind={status.applicationState === 'ACTION_REQUIRED' ? 'warning' : 'error'}
            title={
              status.applicationState === 'ACTION_REQUIRED'
                ? t.appActionNeeded
                : status.applicationState === 'SUSPENDED'
                  ? t.appSuspended
                  : t.appNotApproved
            }
          >
            <p style={{ margin: 0 }}>
              {status.history[0]?.reason ?? t.appContactSupervisor}
            </p>
          </Alert>
        ) : status.canCollectRevenue ? (
          <Alert kind="success" title={t.appClearedToCollect}>
            <p style={{ margin: 0 }}>{t.appAllRequirementsMet}</p>
          </Alert>
        ) : (
          <Alert kind="info" title={t.appBeingProcessed}>
            <p style={{ margin: 0 }}>{t.appCannotCollectUntil}</p>
          </Alert>
        )}

        <ol className="steps">
          {STAGE_LABELS.map(([key, labelKey], index) => {
            // The stage that has been reached is only "current" while there is
            // something after it. Reaching the last one is not a step in
            // progress — it is the end of the list, and leaving it unticked
            // showed an active agent a checklist with an outstanding item
            // directly beneath "You are cleared to collect revenue".
            const isFinalStage = index === STAGE_LABELS.length - 1;
            const done =
              reachedIndex >= 0 && (index < reachedIndex || (index === reachedIndex && isFinalStage));
            const current = index === reachedIndex && !isFinalStage;
            return (
              <li
                key={key}
                className={`steps__item ${done ? 'steps__item--done' : ''} ${current ? 'steps__item--current' : ''}`}
              >
                <span className="steps__marker">{done ? '✓' : index + 1}</span>
                <div>
                  <p className="steps__label">{t[labelKey]}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {status.outstanding.length > 0 && (
        <div className="card">
          <h2 className="card__title">{t.appStillOutstanding}</h2>
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
        <button type="button" onClick={() => navigate('/')}>{t.appGoToDashboard}</button>
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


/**
 * Capture one identity document.
 *
 * `capture="environment"` opens the camera directly on a phone, which is where
 * this is used — an agent photographing a card held by the person in front of
 * them. On a desktop the same control falls back to the file picker, and the
 * platform is told which of the two happened, because a document photographed
 * at capture time and one chosen from a gallery are not the same evidence.
 *
 * The file is sent as it is captured rather than held: an identity document
 * left in browser storage on a shared handset is a worse problem than a
 * capture the agent has to repeat.
 */
function DocumentCapture({
  documentType,
  label,
  hint,
  existing,
  onUploaded,
}: {
  documentType: string;
  label: string;
  hint: string;
  existing?: KycDocument;
  onUploaded: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function send(file: File, source: 'CAMERA' | 'FILE') {
    setBusy(true);
    setError(null);
    try {
      // Shown from the file itself, so the agent can see the photograph is
      // legible before it becomes the thing a reviewer has to read.
      setPreview(URL.createObjectURL(file));
      await api.upload(
        `/agents/me/kyc/documents?type=${documentType}&captureSource=${source}`,
        file,
        file.name,
      );
      onUploaded();
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? caught.error.message
          : caught instanceof Error
            ? caught.message
            : t.appDocumentNotSent,
      );
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="capture">
      <div className="capture__head">
        <p className="capture__label">{label}</p>
        {existing ? (
          <Badge status={existing.verification_status} />
        ) : (
          <span className="capture__todo">{t.appNotCaptured}</span>
        )}
      </div>
      <p className="card__hint" style={{ marginTop: 0 }}>
        {hint}
      </p>

      {existing?.rejection_reason && (
        <Alert kind="warning" title={t.appDocumentNotAccepted}>
          <p style={{ margin: 0 }}>{existing.rejection_reason}</p>
        </Alert>
      )}

      {preview && <img className="capture__preview" src={preview} alt={`${label}, ${t.appJustCaptured}`} />}
      {error && (
        <Alert kind="error">
          <p style={{ margin: 0 }}>{error}</p>
        </Alert>
      )}

      <label className="button secondary capture__button">
        {busy ? t.appSending : existing ? t.appTakeAgain : t.appTakePhotograph}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          capture="environment"
          disabled={busy}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            // A camera capture arrives with a generated name; one chosen from
            // the device keeps its own. That is the honest signal available.
            if (file) void send(file, /^(image|capture)\.\w+$/i.test(file.name) ? 'CAMERA' : 'FILE');
            event.target.value = '';
          }}
        />
      </label>
    </div>
  );
}

interface KycDocument {
  id: string;
  document_type: string;
  verification_status: string;
  uploaded_at: string;
  rejection_reason: string | null;
  superseded_at: string | null;
}

/** What PSIRS asks every applicant for, in the order it is asked for. */
const REQUIRED_DOCUMENTS = [
  { type: 'IDENTITY_DOCUMENT', label: 'appIdDocument', hint: 'appIdDocumentHint' },
  { type: 'SELFIE', label: 'appSelfie', hint: 'appSelfieHint' },
] as const satisfies readonly {
  type: string;
  label: keyof TranslationDictionary;
  hint: keyof TranslationDictionary;
}[];

function KycSection({ status, onDone }: { status: ApplicationStatus; onDone: () => void }) {
  const { t } = useI18n();
  const [identityType, setIdentityType] = useState('NIN');
  const [identityNumber, setIdentityNumber] = useState('');
  const [documents, setDocuments] = useState<KycDocument[]>([]);
  const { busy, error, run } = useAction(onDone);

  const loadDocuments = useCallback(() => {
    api
      .get<{ documents: KycDocument[] }>('/agents/me/kyc/documents')
      .then((result) => setDocuments(result.documents.filter((d) => !d.superseded_at)))
      .catch(() => setDocuments([]));
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const held = (type: string) => documents.find((d) => d.document_type === type);
  const missing = REQUIRED_DOCUMENTS.filter((d) => !held(d.type));

  if (status.checklist.kycCleared) {
    return (
      <div className="card">
        <h2 className="card__title">{t.appIdentityVerification}</h2>
        <KeyValue
          items={[
            [t.appStatus, <Badge key="s" status={status.statuses.kyc ?? 'CLEARED'} />],
            [t.appDocumentOnFile, status.kyc?.identity_number_masked ?? '—'],
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
          await api.post('/agents/me/kyc', {
            identityType,
            identityNumber,
            // The provider is asked to match the captured face against the
            // identity record, rather than the number on its own.
            selfieDocumentId: held('SELFIE')?.id ?? null,
          });
        });
      }}
    >
      <h2 className="card__title">{t.appIdentityVerification}</h2>
      <p className="card__hint">{t.appKycHint}</p>

      <ErrorAlert error={error} />
      {status.kyc?.failure_reason && (
        <Alert kind="warning" title={t.appPreviousAttemptRejected}>
          <p style={{ margin: 0 }}>{status.kyc.failure_reason}</p>
        </Alert>
      )}

      <Field label={t.appIdentificationType} required>
        <select value={identityType} onChange={(event) => setIdentityType(event.target.value)}>
          <option value="NIN">{t.idNin} (NIN)</option>
          <option value="BVN">{t.idBvn} (BVN)</option>
          <option value="PASSPORT">{t.idPassport}</option>
          <option value="DRIVERS_LICENCE">{t.idLicence}</option>
          <option value="VOTERS_CARD">{t.idVoters}</option>
        </select>
      </Field>

      <Field label={t.appIdentificationNumber} required>
        <input
          inputMode="numeric"
          value={identityNumber}
          onChange={(event) => setIdentityNumber(event.target.value)}
          required
          minLength={5}
        />
      </Field>

      <p className="section-title">{t.appDocuments}</p>
      {REQUIRED_DOCUMENTS.map((doc) => (
        <DocumentCapture
          key={doc.type}
          documentType={doc.type}
          label={t[doc.label]}
          hint={t[doc.hint]}
          existing={held(doc.type)}
          onUploaded={loadDocuments}
        />
      ))}

      <button
        type="submit"
        disabled={busy || identityNumber.trim().length < 5 || missing.length > 0}
      >
        {busy ? <Spinner /> : null}
        {busy ? t.appVerifying : t.appSubmitForVerification}
      </button>
      {missing.length > 0 ? (
        <p className="card__hint">
          {t.appStillNeeded}{' '}
          {missing.map((d) => t[d.label].toLowerCase()).join(', ')}.
        </p>
      ) : (
        identityNumber.trim().length < 5 && (
          // The documents case explained itself and this one did not, so a
          // short number left the button dead with nothing said about why.
          <p className="card__hint" role="status">{t.appEnterIdInFull}</p>
        )
      )}
    </form>
  );
}

function RefereeSection({ status, onDone }: { status: ApplicationStatus; onDone: () => void }) {
  const { t } = useI18n();
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
      <h2 className="card__title">{t.appReferee}</h2>
      <p className="card__hint">
        {t.appRefereeWhoIs} {t.appRefereeNoAccount}
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
        <Alert kind="success" title={t.appVerificationSent}>
          <p style={{ margin: '0 0 6px' }}>{t.appRefereeShareLink}</p>
          <p style={{ margin: 0, wordBreak: 'break-all', fontSize: '0.78rem' }}>{link}</p>
        </Alert>
      )}
      {message && !link && <Alert kind="success">{message}</Alert>}

      {active?.status === 'CLEARED' ? (
        <Alert kind="success" title={t.appRefereeConfirmed}>
          <p style={{ margin: 0 }}>
            {active.full_name} {t.appRefereeConfirmedYour}
          </p>
        </Alert>
      ) : active ? (
        <Alert kind="info" title={t.appWaitingReferee}>
          <p style={{ margin: 0 }}>
            {active.full_name} {t.appRefereeSentRequest}
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

          <Field label={t.appRefereeFullName} required>
            <input
              value={form.fullName}
              onChange={(event) => setForm({ ...form, fullName: event.target.value })}
              required
              minLength={3}
            />
          </Field>
          <Field label={t.appRefereePhone} hint={t.appRefereeLinkHere} required>
            <input
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              required
            />
          </Field>
          <Field label={t.appRefereeEmail}>
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </Field>
          <Field label={t.appWhoIsThisPerson} required>
            <select
              value={form.category}
              onChange={(event) => setForm({ ...form, category: event.target.value })}
            >
              <option value="COMMUNITY_LEADER">{t.refCommunityLeader}</option>
              <option value="TRADITIONAL_AUTHORITY">{t.refTraditionalAuthority}</option>
              <option value="EMPLOYER">{t.refEmployer}</option>
              <option value="PUBLIC_SERVANT">{t.refCivilServant}</option>
              <option value="RECOGNISED_PROFESSIONAL">{t.refProfessional}</option>
              <option value="RELIGIOUS_LEADER">{t.refReligiousLeader}</option>
            </select>
          </Field>
          <Field label={t.appHowDoTheyKnowYou} required>
            <input
              value={form.relationship}
              onChange={(event) => setForm({ ...form, relationship: event.target.value })}
              placeholder={t.refDistrictHead}
              required
              minLength={3}
            />
          </Field>

          <button type="submit" disabled={busy}>
            {busy ? <Spinner /> : null}
            {active ? t.appNominateReplacement : t.appSendVerification}
          </button>
        </form>
      )}
    </div>
  );
}

function TrainingSection({ status, onDone }: { status: ApplicationStatus; onDone: () => void }) {
  const { t } = useI18n();
  const { busy, error, run } = useAction(onDone);
  const outstanding = status.training.filter((module) => module.status !== 'COMPLETED');

  return (
    <div className="card">
      <h2 className="card__title">{t.appTraining}</h2>
      <p className="card__hint">
        {outstanding.length === 0
          ? t.appTrainingAllComplete
          : t.appTrainingRemaining
              .replace('{{done}}', String(outstanding.length))
              .replace('{{total}}', String(status.training.length))}
      </p>

      <ErrorAlert error={error} />

      <ul className="list">
        {status.training.map((module) => (
          <li key={module.code} className="list__item" style={{ paddingLeft: 0, paddingRight: 0 }}>
            <div className="list__body">
              <p className="list__title">{module.title}</p>
              <p className="list__meta">
                {module.code}
                {module.assessed ? ` · ${t.appPassMark} ${module.pass_mark}%` : ` · ${t.appNoAssessment}`}
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
              >{t.appComplete}</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BankSection({ status, onDone }: { status: ApplicationStatus; onDone: () => void }) {
  const { t } = useI18n();
  const { busy, error, message, run } = useAction(onDone);

  return (
    <div className="card">
      <h2 className="card__title">{t.appBankAccount}</h2>
      <p className="card__hint">{t.appBankHint}</p>

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      {status.checklist.bankVerified ? (
        <Alert kind="success" title={t.appBankVerified}>
          <p style={{ margin: 0 }}>{t.appCommissionPaidHere}</p>
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
                ? t.appBankVerifiedMsg
                : (result.failureReason ?? t.appBankCouldNotVerify);
            })
          }
        >
          {busy ? <Spinner /> : null}
          {t.appVerifyBankAccount}
        </button>
      )}
    </div>
  );
}

function AgreementSection({ status, onDone }: { status: ApplicationStatus; onDone: () => void }) {
  const { t } = useI18n();
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
        <h2 className="card__title">{t.appAgreement}</h2>
        <Alert kind="success" title={t.appAgreementAccepted}>
          <p style={{ margin: 0 }}>{t.appAgreementRecorded}</p>
        </Alert>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="card__title">{t.appAgreement}</h2>
      <p className="card__hint">{t.appReadCarefully}</p>

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
              {t.appAcceptAgreementText
                .replace('{{title}}', agreement.title)
                .replace('{{version}}', agreement.version)}
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
            {t.appAcceptAgreement}
          </button>
        </>
      ) : (
        <Loading rows={4} />
      )}
    </div>
  );
}

function DeviceSection({ status, onDone }: { status: ApplicationStatus; onDone: () => void }) {
  const { t } = useI18n();
  const { busy, error, message, run } = useAction(onDone);
  const profile = describeDevice(APP_VERSION);
  const registered = status.devices.find(
    (device) => device.device_identifier === profile.deviceIdentifier,
  );

  return (
    <div className="card">
      <h2 className="card__title">{t.moreThisDevice}</h2>
      <p className="card__hint">{t.appDeviceOnlyRegistered}</p>

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      <KeyValue
        items={[
          [t.appDeviceLabel, profile.deviceName],
          [t.appAppVersion, APP_VERSION],
          [t.appStatus, registered ? <Badge key="s" status={registered.status} /> : t.appNotRegistered],
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
          {t.appRegisterDevice}
        </button>
      )}

      {!status.checklist.governmentApproved && !registered && (
        <p className="field__hint" style={{ marginTop: 8 }}>{t.appDeviceAfterApproval}</p>
      )}

      {status.devices.length > 1 && (
        <>
          <p className="section-title">{t.appOtherDevices}</p>
          <ul className="list">
            {status.devices
              .filter((device) => device.device_identifier !== profile.deviceIdentifier)
              .map((device) => (
                <li key={device.id} className="list__item" style={{ paddingLeft: 0, paddingRight: 0 }}>
                  <div className="list__body">
                    <p className="list__title">{device.device_name ?? t.appRegisteredDevice}</p>
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
