/**
 * Handing out an allocation at the collection point.
 *
 * The agent is standing at a store with a queue of farmers in front of them.
 * Each has a code; the job is to check it is real, hand over what it says, and
 * record that it happened — once.
 *
 * The screen keeps the confirmation deliberately loud and slow. A collection
 * cannot be undone from here, and the number of bags is the thing most likely
 * to be got wrong in a hurry, so what is being given and to whom is shown
 * before anything is recorded rather than after.
 */

import { useCallback, useRef, useState } from 'react';
import { ApiRequestError, api, isConnectivityFailure, type ApiError } from '../lib/api';
import { CameraUnavailable, scanForCode, verificationCodeFrom, type ScanHandle } from '../lib/scanner';
import { Alert, ErrorAlert, Spinner } from '../ui';
import { useI18n } from '../lib/i18n';
import { enumLabel } from '@psirs/shared';

interface Collected {
  awardId: string;
  taxpayerName: string;
  quantity: string;
  unit: string;
  message: string;
}

export function CollectionScreen() {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [collected, setCollected] = useState<Collected | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const handleRef = useRef<ScanHandle | null>(null);

  const stopCamera = useCallback(() => {
    handleRef.current?.stop();
    handleRef.current = null;
    setScanning(false);
  }, []);

  const record = useCallback(async (candidate: string) => {
    setBusy(true);
    setError(null);
    setCollected(null);
    try {
      const result = await api.post<Collected>('/allocations/collections', {
        collectionCode: candidate,
      });
      setCollected(result);
      setCode('');
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
      else if (isConnectivityFailure(caught)) {
        /*
         * Not queued for later, deliberately.
         *
         * Everything else this app captures offline is a record of something
         * the agent witnessed and can vouch for. A collection is a claim on a
         * finite store, and the platform is the only thing that knows whether
         * this code has already been used — recording it optimistically is how
         * the same bag of fertiliser gets handed out twice.
         */
        setError({
          code: 'OFFLINE',
          message:
            t.allocOfflineBody,
          moneyStatus: 'NOT_APPLICABLE',
        });
      } else {
        setError({
          code: 'COLLECTION_FAILED',
          message: t.allocFailed,
          moneyStatus: 'NOT_APPLICABLE',
        });
      }
    } finally {
      setBusy(false);
    }
  }, []);

  async function startScanning() {
    setCameraError(null);
    setCollected(null);
    setScanning(true);
    try {
      handleRef.current = await scanForCode({
        video: videoRef.current!,
        onCode: (text) => {
          const found = verificationCodeFrom(text);
          if (!found) {
            setCameraError(t.allocNotACode);
            return;
          }
          stopCamera();
          setCode(found);
          void record(found);
        },
      });
    } catch (caught) {
      setScanning(false);
      setCameraError(
        caught instanceof CameraUnavailable
          ? caught.message
          : t.allocCameraFailed,
      );
    }
  }

  return (
    <>
      <div className="card">
        <h2 className="card__title">{t.allocHandOut}</h2>
        <p className="card__hint">
          {t.allocScanHint}
        </p>

        {scanning ? (
          <>
            <video ref={videoRef} className="scanner__view" playsInline muted />
            <button type="button" className="secondary" onClick={stopCamera}>
              {t.allocStopScanning}
            </button>
          </>
        ) : (
          <button type="button" onClick={() => void startScanning()} disabled={busy}>
            {t.allocScanCode}
          </button>
        )}

        {cameraError && (
          <Alert kind="warning" title={t.scanCamera}>
            <p style={{ margin: 0 }}>{cameraError}</p>
          </Alert>
        )}

        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="collection-code">{t.allocTypeCode}</label>
          <input
            id="collection-code"
            value={code}
            autoCapitalize="characters"
            placeholder="ABCDE-12345"
            onChange={(event) => setCode(event.target.value)}
          />
        </div>

        <button
          type="button"
          disabled={busy || code.trim().length < 4}
          onClick={() => void record(code.trim())}
        >
          {busy ? <Spinner /> : null}
          {busy ? t.verifyChecking : t.allocRecordCollection}
        </button>

        <ErrorAlert error={error} />
      </div>

      {collected && (
        <div className="card">
          <Alert kind="success" title={t.allocRecorded}>
            <p style={{ margin: 0 }}>
              {t.allocGive} <strong>{collected.taxpayerName}</strong> {collected.quantity}{' '}
              {enumLabel(collected.unit, t)}.
            </p>
          </Alert>
          <p className="card__hint" style={{ marginTop: 10 }}>
            {t.allocCodeUsed}
          </p>
        </div>
      )}
    </>
  );
}
