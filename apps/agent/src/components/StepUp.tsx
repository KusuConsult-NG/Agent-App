/**
 * The one-time code panel (PRD §35).
 *
 * Shown in the page rather than in a dialogue, directly under a statement of
 * what is being authorised. Step-up exists so that a person confirms a
 * specific high-risk action, which they cannot do if the screen has been
 * covered by a prompt that says only "enter code".
 *
 * The countdown is not decoration. A code that has silently expired produces
 * "that verification code has expired" on submit, which reads as a fault in
 * the app rather than the passage of five minutes; showing the time left, and
 * offering a new code when it runs out, turns that into something the agent
 * can act on before it happens.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError, type ApiError } from '../lib/api';
import { grantStepUp, requestStepUpCode, stepUpDestination } from '../lib/step-up';
import { Alert, ErrorAlert, Field, Spinner } from '../ui';
import { useI18n } from '../lib/i18n';

/** Mask all but the last three digits: enough to recognise, not to publish. */
function maskPhone(phone: string): string {
  return phone.length <= 3 ? phone : `${'•'.repeat(Math.max(0, phone.length - 3))}${phone.slice(-3)}`;
}

export function StepUpPrompt({
  action,
  title,
  description,
  confirmLabel,
  onAuthorised,
  onCancel,
}: {
  /** The step-up action name the API expects, e.g. commission.payout.request. */
  action: string;
  title: string;
  /** What the agent is authorising. Shown above the code entry. */
  description: React.ReactNode;
  confirmLabel: string;
  /** Runs once a grant has been issued. One grant authorises one action. */
  onAuthorised: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(true);
  const [busy, setBusy] = useState(false);
  const [developmentCode, setDevelopmentCode] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  /** The length the server says the code has, rather than one assumed here. */
  const [codeLength, setCodeLength] = useState(6);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const destination = stepUpDestination();

  const send = useCallback(async () => {
    setSending(true);
    setError(null);
    setFailure(null);
    setCode('');
    setDevelopmentCode(null);
    try {
      const result = await requestStepUpCode();
      setSecondsLeft(result.expiresInSeconds);
      setCodeLength(result.codeLength);
      setDevelopmentCode(result.developmentCode ?? null);
      inputRef.current?.focus();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
      else setFailure(caught instanceof Error ? caught.message : t.stepUpCodeFailed);
    } finally {
      setSending(false);
    }
  }, []);

  // One code on opening. Asking again is the agent's decision, because each
  // request supersedes the last — an automatic retry would invalidate the code
  // they are in the middle of typing.
  useEffect(() => {
    void send();
  }, [send]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setInterval(() => setSecondsLeft((current) => Math.max(0, current - 1)), 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFailure(null);
    try {
      await grantStepUp(action, code.trim());
      await onAuthorised();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
      else setFailure(caught instanceof Error ? caught.message : t.stepUpAuthoriseFailed);
      // The grant failed, so the code is spent or wrong either way. Clearing it
      // stops a second submit re-sending the same rejected digits.
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  const expired = secondsLeft === 0 && !sending;
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = String(secondsLeft % 60).padStart(2, '0');

  return (
    <form className="card" onSubmit={submit}>
      <h2 className="card__title">{title}</h2>
      <div className="stepup__what">{description}</div>

      <p className="card__hint">
        {sending
          ? 'Sending a one-time code…'
          : destination
            ? `We sent a code to ${maskPhone(destination)}. It is only for this one action.`
            : 'We sent a code to your registered number.'}
      </p>

      <ErrorAlert error={error} />
      {failure && (
        <Alert kind="error" title={t.stepUpCouldNotContinue}>
          <p style={{ margin: 0 }}>{failure}</p>
        </Alert>
      )}

      {developmentCode && (
        <Alert kind="info" title={t.stepUpDevelopmentBuild}>
          <p style={{ margin: 0 }}>
            {t.stepUpNoSms} <strong>{developmentCode}</strong>
          </p>
        </Alert>
      )}

      <Field label={t.stepUpOneTimeCode} required>
        <input
          ref={inputRef}
          value={code}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={8}
          required
          disabled={sending}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
        />
      </Field>

      {!sending &&
        (expired ? (
          <Alert kind="warning" title={t.stepUpExpired}>
            <p style={{ margin: 0 }}>{t.stepUpAskNew}</p>
          </Alert>
        ) : (
          <p className="field__hint">
            {t.stepUpExpiresIn.replace('{{time}}', `${minutes}:${seconds}`)}
          </p>
        ))}

      <div className="button-row">
        {/*
          * The API requires exactly as many digits as it issued. Enabling at
          * four let the agent press Confirm on a half-typed code and be told it
          * was incorrect, which reads as "the code you were sent is wrong"
          * rather than "you have not finished typing it". The length comes
          * from the server because OTP_LENGTH is configuration.
          */}
        <button type="submit" disabled={busy || sending || code.trim().length !== codeLength}>
          {busy ? <Spinner /> : confirmLabel}
        </button>
        <button type="button" className="secondary" disabled={sending || busy} onClick={() => void send()}>
          {t.stepUpSendNew}
        </button>
      </div>

      <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
        {t.camCancel}
      </button>
    </form>
  );
}
