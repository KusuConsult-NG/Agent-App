/**
 * Check whether a receipt is genuine (PRD §16, §29).
 *
 * An agent is asked this constantly in the field — a taxpayer produces a
 * receipt from another agent, or from last year, and wants to know it counts.
 * Until now the only way to answer was to leave the application.
 *
 * The screen is built around one distinction, and the wording throughout keeps
 * it: reading the QR square tells you what is printed on the paper, and PSIRS
 * telling you the receipt exists tells you it is real. A forged receipt can
 * carry a perfectly well-formed QR code. So a scan never shows a verdict — it
 * fills in the code and then asks the server, exactly as typing the code by
 * hand would.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError, api, type ApiError } from '../lib/api';
import {
  CAMERA_UNAVAILABLE_TEXT,
  CameraUnavailable,
  scanForCode,
  verificationCodeFrom,
  type ScanHandle,
} from '../lib/scanner';
import { Alert, ErrorAlert, Field, KeyValue, Money, Spinner } from '../ui';
import type { ConnectionState } from '../lib/device';
import { useI18n } from '../lib/i18n';
import { VERIFICATION_TEXT, enumLabel, formatDateIn, type VerificationReason } from '@psirs/shared';

/** Exactly the shape `GET /verify/:code` returns. */
interface VerificationResult {
  status: 'VALID' | 'NOT_FOUND' | 'VOID' | 'TAMPERED';
  message: string;
  receiptNumber?: string;
  documentNumber?: string;
  documentType?: string;
  revenueType?: string;
  amountKobo?: string;
  issuedAt?: string;
  lga?: string;
  integrityConfirmed?: boolean;
  /** Which of the thirteen answers, so it can be read in Hausa. */
  reason: VerificationReason;
  expiresAt?: string;
}

export function VerifyScreen({ connection }: { connection: ConnectionState }) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const handleRef = useRef<ScanHandle | null>(null);

  const stopCamera = useCallback(() => {
    handleRef.current?.stop();
    handleRef.current = null;
    setScanning(false);
  }, []);

  // The camera must not outlive the screen. Leaving it running would be a
  // light on somebody's phone and a drain on a battery that has to last a day.
  useEffect(() => stopCamera, [stopCamera]);

  const verify = useCallback(async (candidate: string) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // Public route: an agent checks a receipt the same way a citizen would,
      // and gets the same answer.
      setResult(await api.get<VerificationResult>(`/verify/${encodeURIComponent(candidate)}`));
    } catch (caught) {
      if (caught instanceof ApiRequestError) {
        // "No such receipt" is an answer, not a failure, and it comes back as
        // the body of a 404. An agent checking a receipt a taxpayer is holding
        // needs to be told it was never issued — not that the request failed,
        // which reads as "try again" and lets a forged receipt pass.
        const verdict = caught.body as VerificationResult | null;
        if (caught.status === 404 && verdict?.status) setResult(verdict);
        else setError(caught.error);
      } else
        setError({
          code: 'VERIFY_FAILED',
          message: t.verifyCouldNotReach,
          moneyStatus: 'NOT_APPLICABLE',
        });
    } finally {
      setBusy(false);
    }
  }, []);

  async function startScanning() {
    setCameraError(null);
    setResult(null);
    setScanning(true);
    try {
      handleRef.current = await scanForCode({
        video: videoRef.current!,
        onCode: (text) => {
          const found = verificationCodeFrom(text);
          if (!found) {
            // Keep scanning: the agent may simply have caught something else
            // in frame. Telling them why is more useful than stopping.
            setCameraError(t.verifyNotAReceiptCode);
            return;
          }
          stopCamera();
          setCode(found);
          void verify(found);
        },
      });
    } catch (caught) {
      setScanning(false);
      setCameraError(
        caught instanceof CameraUnavailable
          ? t[CAMERA_UNAVAILABLE_TEXT[caught.reason]]
          : t.verifyCameraFailed,
      );
    }
  }

  return (
    <>
      <div className="card">
        <h2 className="card__title">{t.verifyCheckReceipt}</h2>
        <p className="card__hint">
          {t.verifyScanHint}
        </p>

        {connection === 'OFFLINE' && (
          <Alert kind="warning" title={t.verifyOffline}>
            <p style={{ margin: 0 }}>
              {t.verifyOfflineBody}
            </p>
          </Alert>
        )}

        <video
          ref={videoRef}
          className="scanner__view"
          style={{ display: scanning ? 'block' : 'none' }}
          muted
          playsInline
        />

        {cameraError && (
          <Alert kind="warning">
            <p style={{ margin: 0 }}>{cameraError}</p>
          </Alert>
        )}

        {scanning ? (
          <button type="button" className="secondary" onClick={stopCamera}>
            {t.allocStopScanning}
          </button>
        ) : (
          <button type="button" onClick={() => void startScanning()}>
            {t.verifyScanQr}
          </button>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            const found = verificationCodeFrom(code);
            if (!found) {
              setError({
                code: 'INVALID_CODE',
                message: t.receiptCodeShape,
                moneyStatus: 'NOT_APPLICABLE',
              });
              return;
            }
            void verify(found);
          }}
        >
          <Field label={t.verifyTypeCode}>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="T7C72-QTUDN"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
          </Field>
          <button type="submit" className="secondary" disabled={busy || code.trim().length === 0}>
            {busy ? <Spinner /> : null}
            {busy ? t.verifyChecking : t.verifyCheckThisCode}
          </button>
        </form>

        <ErrorAlert error={error} />
      </div>

      {result && <VerificationOutcome result={result} />}
    </>
  );
}

function VerificationOutcome({ result }: { result: VerificationResult }) {
  const { t } = useI18n();
  const genuine = result.status === 'VALID';
  /*
   * An acknowledgement is genuine, so it comes back VALID — and this heading
   * said "Genuine receipt" directly above an alert saying, correctly, that it
   * is NOT a receipt and the money has not reached the government account.
   * The screen contradicted itself on the one distinction it exists to make.
   *
   * The public portal reached this conclusion already and says why: "a verdict
   * that says only VALID is read as 'paid' by everybody who takes in the mark
   * and not the paragraph under it. The mark has to carry the distinction
   * itself." That is truer here than there — the agent is the one standing in
   * front of the person holding the paper, reading the heading out.
   */
  const acknowledgement = result.documentType === 'PAYMENT_ACKNOWLEDGEMENT';
  return (
    <div className="card">
      <h2 className="card__title">
        {genuine
          ? acknowledgement
            ? t.pubVerdictAcknowledgement
            : t.genuineReceipt
          : t.receiptNotValid}
      </h2>
      <Alert kind={genuine ? 'success' : 'error'}>
        {/*
          * The answer, in the language the agent reads it out in.
          *
          * This is the sentence an agent says to the person holding the
          * paper, and it was the API's English. The difference between "a
          * genuine receipt" and "a genuine acknowledgement, and NOT a
          * receipt — the money has not reached the government account" is
          * the entire point of the exchange, and it cannot be made in a
          * language the reader does not have.
          */}
        <p style={{ margin: 0 }}>
          {result.expiresAt
            ? t[VERIFICATION_TEXT[result.reason]].replace(
                '{{date}}',
                formatDateIn(result.expiresAt, t),
              )
            : t[VERIFICATION_TEXT[result.reason]]}
        </p>
      </Alert>

      {genuine && (result.receiptNumber || result.documentNumber) && (
        <KeyValue
          items={[
            /*
             * A certificate has a document number and no receipt number, and
             * this read only the latter — so an agent verifying a vehicle
             * particulars certificate got a dash where the one identifier
             * tying the paper to the record should be. It was being sent and
             * dropped.
             *
             * The type is run through `enumLabel` for the same reason the
             * sentence above is translated: VEHICLE_CERTIFICATE is not a thing
             * to read out to anybody.
             */
            [t.receiptNumber, result.receiptNumber ?? result.documentNumber ?? '—'],
            [
              t.verifyRevenueItem,
              result.revenueType ?? (result.documentType ? enumLabel(result.documentType, t) : '—'),
            ],
            [t.amount, result.amountKobo ? <Money key="a" kobo={result.amountKobo} /> : '—'],
            [t.tpLga, result.lga ?? '—'],
            [
              t.verifyIssued,
              formatDateIn(result.issuedAt, t),
            ],
            [
              t.verifyFingerprint,
              result.integrityConfirmed ? t.verifyMatchesOriginal : t.verifyNotConfirmed,
            ],
          ]}
        />
      )}
    </div>
  );
}
