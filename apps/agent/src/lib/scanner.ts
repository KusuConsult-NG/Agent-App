/**
 * Reading a QR code from the camera (PRD §16, §29).
 *
 * One thing to be clear about before any of the mechanics, because it is the
 * whole reason this is careful:
 *
 *   SCANNING IS NOT VERIFYING.
 *
 * A QR code is ink. Anyone can print one, and a forged receipt can carry a
 * code that encodes whatever its maker chose — including a well-formed PSIRS
 * verification URL. All a scan produces is a string the holder of the paper
 * controls. Whether a receipt is genuine is a question only the server can
 * answer, by looking up the code and checking the stored document's
 * fingerprint. So this module extracts a code and stops there: it never
 * reports a result, and the screen that uses it must not imply the scan
 * proved anything.
 *
 * The decoder is loaded on demand rather than bundled into the first paint.
 * An agent opening the application to collect revenue on a market day should
 * not pay for a scanner they may not use (PRD §55, low-bandwidth).
 */

/** Codes look like `T7C72-QTUDN`: two groups from an unambiguous alphabet. */
const VERIFICATION_CODE = /^[0-9A-HJ-NP-Z]{5}-[0-9A-HJ-NP-Z]{5}$/;

/**
 * The verification code inside whatever the camera read, or null.
 *
 * Accepts the URL printed on a receipt in either routing form, and a bare code
 * typed or scanned on its own. Anything else is not a PSIRS receipt code, and
 * saying so is more useful than trying to make sense of it.
 */
export function verificationCodeFrom(scanned: string): string | null {
  const text = scanned.trim();
  if (!text) return null;

  const bare = text.toUpperCase();
  if (VERIFICATION_CODE.test(bare)) return bare;

  // A URL: take the last path segment, whether it arrived as /verify/CODE or
  // as the hash route /#/verify/CODE the portal actually uses.
  try {
    const url = new URL(text);
    const segments = `${url.pathname}${url.hash}`.split('/').filter(Boolean);
    const last = segments[segments.length - 1]?.toUpperCase();
    if (last && VERIFICATION_CODE.test(last)) return last;
  } catch {
    // Not a URL. Fall through — the bare-code check above already ran.
  }

  return null;
}

export interface ScanHandle {
  /** The live stream, for a <video> element to display. */
  stream: MediaStream;
  /** Stops decoding and releases the camera. Safe to call more than once. */
  stop: () => void;
}

export class CameraUnavailable extends Error {
  readonly reason: 'DENIED' | 'NO_CAMERA' | 'UNSUPPORTED';

  constructor(reason: 'DENIED' | 'NO_CAMERA' | 'UNSUPPORTED', message: string) {
    super(message);
    this.name = 'CameraUnavailable';
    this.reason = reason;
  }
}

/**
 * Open the camera and call `onCode` with the first thing it reads.
 *
 * The caller decides what to do next; this keeps scanning until stopped, so a
 * misread or a code that is not a PSIRS one does not end the session.
 */
export async function scanForCode(params: {
  video: HTMLVideoElement;
  onCode: (text: string) => void;
  onError?: (error: Error) => void;
}): Promise<ScanHandle> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraUnavailable(
      'UNSUPPORTED',
      'This browser cannot open the camera. Type the code printed under the QR square instead.',
    );
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // The rear camera on a phone; ignored where there is only one.
      video: { facingMode: 'environment' },
      audio: false,
    });
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new CameraUnavailable(
        'DENIED',
        'PSIRS does not have permission to use the camera. Allow it in your browser settings, ' +
          'or type the code printed under the QR square.',
      );
    }
    throw new CameraUnavailable(
      'NO_CAMERA',
      'No camera was found on this device. Type the code printed under the QR square instead.',
    );
  }

  params.video.srcObject = stream;
  params.video.setAttribute('playsinline', 'true');
  await params.video.play().catch(() => undefined);

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  let stopped = false;
  let frame = 0;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    // Releasing every track matters: a camera left running is a light on
    // somebody's phone and a drain on a battery that has to last a market day.
    for (const track of stream.getTracks()) track.stop();
    params.video.srcObject = null;
  };

  // Loaded here rather than at module scope so the decoder is fetched only
  // when an agent actually opens the scanner.
  const { default: jsQR } = await import('jsqr');

  const tick = () => {
    if (stopped) return;
    frame = requestAnimationFrame(tick);

    if (!context || params.video.readyState !== params.video.HAVE_ENOUGH_DATA) return;

    canvas.width = params.video.videoWidth;
    canvas.height = params.video.videoHeight;
    if (!canvas.width || !canvas.height) return;

    context.drawImage(params.video, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const found = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
    if (found?.data) params.onCode(found.data);
  };

  frame = requestAnimationFrame(tick);
  return { stream, stop };
}
