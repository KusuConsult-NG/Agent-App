/**
 * Camera QR & Barcode Scanner Modal.
 *
 * Provides a mobile-optimized real-time camera viewfinder for scanning receipt QR
 * codes, vehicle plate codes, and taxpayer IDs in the field.
 */

import { useEffect, useRef, useState } from 'react';
import { CameraScanner, type ScannerCapabilities } from '../lib/camera-scanner';
import { Icons, Spinner } from '../ui';
import { useI18n } from '../lib/i18n';

interface CameraScannerModalProps {
  isOpen: boolean;
  title?: string;
  onScan: (scannedText: string) => void;
  onClose: () => void;
}

export function CameraScannerModal({
  isOpen,
  title,
  onScan,
  onClose,
}: CameraScannerModalProps) {
  const { t } = useI18n();
  const heading = title ?? t.scanQr;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scannerRef = useRef<CameraScanner | null>(null);

  const [capabilities, setCapabilities] = useState<ScannerCapabilities | null>(null);
  const [torchActive, setTorchActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) {
      if (scannerRef.current) {
        scannerRef.current.stop();
        scannerRef.current = null;
      }
      setLoading(true);
      setError(null);
      return;
    }

    const scanner = new CameraScanner();
    scannerRef.current = scanner;

    const timer = setTimeout(async () => {
      if (!videoRef.current || !canvasRef.current) return;
      try {
        setLoading(true);
        setError(null);
        const caps = await scanner.start(videoRef.current, canvasRef.current, (result) => {
          scanner.stop();
          onScan(result);
          onClose();
        });
        setCapabilities(caps);
        setLoading(false);
      } catch (err: any) {
        setError(err.message || t.camNoAccess);
        setLoading(false);
      }
    }, 100);

    return () => {
      clearTimeout(timer);
      if (scannerRef.current) {
        scannerRef.current.stop();
        scannerRef.current = null;
      }
    };
  }, [isOpen, onScan, onClose]);

  if (!isOpen) return null;

  const handleToggleTorch = async () => {
    if (scannerRef.current) {
      const active = await scannerRef.current.toggleTorch();
      setTorchActive(active);
    }
  };

  const handleSwitchCamera = async () => {
    if (scannerRef.current) {
      try {
        const caps = await scannerRef.current.switchCamera((result) => {
          if (scannerRef.current) scannerRef.current.stop();
          onScan(result);
          onClose();
        });
        setCapabilities(caps);
      } catch (err: any) {
        setError(err.message || t.camSwitchFailed);
      }
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={heading}>
      <div className="modal-card scanner-modal">
        <div className="scanner-header">
          <h3>{heading}</h3>
          <button type="button" className="btn-icon" onClick={onClose} aria-label={t.camClose}>
            ✕
          </button>
        </div>

        <div className="scanner-viewport">
          <video ref={videoRef} playsInline muted autoPlay className="scanner-video" />
          <canvas ref={canvasRef} style={{ display: 'none' }} />

          {loading && (
            <div className="scanner-loading">
              <Spinner />
              <p>{t.camInitializing}</p>
            </div>
          )}

          {error && (
            <div className="scanner-error">
              <p>{error}</p>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => {
                  setError(null);
                  setLoading(true);
                  if (videoRef.current && canvasRef.current && scannerRef.current) {
                    scannerRef.current
                      .start(videoRef.current, canvasRef.current, (res) => {
                        onScan(res);
                        onClose();
                      })
                      .then(setCapabilities)
                      .catch((e) => setError(e.message))
                      .finally(() => setLoading(false));
                  }
                }}
              >
                {t.camTryAgain}
              </button>
            </div>
          )}

          {!loading && !error && (
            <div className="scanner-reticle">
              <div className="reticle-box">
                <div className="laser-line" />
              </div>
              <p className="reticle-hint">{t.camAlign}</p>
            </div>
          )}
        </div>

        <div className="scanner-controls">
          {capabilities?.hasTorch && (
            <button
              type="button"
              className={`btn btn--sm ${torchActive ? 'btn--primary' : 'btn--secondary'}`}
              onClick={handleToggleTorch}
            >
              {torchActive ? t.camFlashOn : t.camFlashOff}
            </button>
          )}

          {capabilities?.canSwitchCamera && (
            <button type="button" className="btn btn--sm btn--secondary" onClick={handleSwitchCamera}>
              {t.camFlip}
            </button>
          )}

          <button type="button" className="btn btn--sm btn--outline" onClick={onClose}>
            {t.camCancel}
          </button>
        </div>
      </div>
    </div>
  );
}
