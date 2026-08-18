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
import { CameraUnavailable, scanForCode, verificationCodeFrom, type ScanHandle } from '../lib/scanner';
import { Alert, ErrorAlert, Field, KeyValue, Money, Spinner } from '../ui';
import type { ConnectionState } from '../lib/device';

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
}

export function VerifyScreen({ connection }: { connection: ConnectionState }) {
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
      if (caught instanceof ApiRequestError) setError(caught.error);
      else
        setError({
          code: 'VERIFY_FAILED',
          message: 'PSIRS could not be reached, so this receipt could not be checked.',
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
            setCameraError('That QR code is not a PSIRS receipt code. Keep the receipt in frame.');
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
          ? caught.message
          : 'The camera could not be opened. Type the code printed under the QR square instead.',
      );
    }
  }

  return (
    <>
      <div className="card">
        <h2 className="card__title">Check a receipt</h2>
        <p className="card__hint">
          Scan the square on the receipt, or type the code printed beneath it. PSIRS confirms
          whether the receipt was issued — reading the code only tells you what is on the paper.
        </p>

        {connection === 'OFFLINE' && (
          <Alert kind="warning" title="You are offline">
            <p style={{ margin: 0 }}>
              A receipt can only be checked against PSIRS, so this needs a connection. You can still
              scan the code and check it when you are back online.
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
            Stop scanning
          </button>
        ) : (
          <button type="button" onClick={() => void startScanning()}>
            Scan the QR code
          </button>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            const found = verificationCodeFrom(code);
            if (!found) {
              setError({
                code: 'INVALID_CODE',
                message: 'A receipt code looks like T7C72-QTUDN. Check the code and try again.',
                moneyStatus: 'NOT_APPLICABLE',
              });
              return;
            }
            void verify(found);
          }}
        >
          <Field label="Or type the receipt code">
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
            {busy ? 'Checking with PSIRS…' : 'Check this code'}
          </button>
        </form>

        <ErrorAlert error={error} />
      </div>

      {result && <VerificationOutcome result={result} />}
    </>
  );
}

function VerificationOutcome({ result }: { result: VerificationResult }) {
  const genuine = result.status === 'VALID';
  return (
    <div className="card">
      <h2 className="card__title">{genuine ? 'Genuine receipt' : 'Not a valid receipt'}</h2>
      <Alert kind={genuine ? 'success' : 'error'}>
        <p style={{ margin: 0 }}>{result.message}</p>
      </Alert>

      {genuine && (
        <KeyValue
          items={[
            ['Receipt number', result.receiptNumber ?? '—'],
            ['Revenue item', result.revenueType ?? '—'],
            [
              'Amount',
              result.amountKobo ? <Money key="a" kobo={result.amountKobo} /> : '—',
            ],
            ['Local Government Area', result.lga ?? '—'],
            [
              'Issued',
              result.issuedAt ? new Date(result.issuedAt).toLocaleDateString('en-NG') : '—',
            ],
            [
              'Document fingerprint',
              result.integrityConfirmed ? 'Matches the original' : 'Could not be confirmed',
            ],
          ]}
        />
      )}
    </div>
  );
}
