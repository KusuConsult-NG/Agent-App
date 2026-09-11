/**
 * Being refused the camera, in the language the agent reads.
 *
 * Three things can stop the scanner opening, and all three are ordinary: the
 * agent declines the permission prompt, the handset has no working camera, or
 * the browser cannot reach one at all. None is an error in the usual sense —
 * each has a remedy the agent can act on, and the screen's whole job is to say
 * what it is.
 *
 * It said it in English. `scanner.ts` threw `CameraUnavailable` carrying an
 * English sentence, and both screens rendered that sentence *in preference to*
 * the translated string they already had in `allocCameraFailed` and
 * `verifyCameraFailed`. The translated one was the fallback; the English one
 * won every time the failure was one of the three named above — which is every
 * time it actually happens.
 *
 * Nothing failed. That is the point of this file. An English sentence sitting
 * in an Error's `message` looks exactly like a working one, no test read it,
 * and the person who finds out is an agent in a market holding a handset that
 * is refusing to scan and explaining itself in a language they do not read.
 *
 * The class no longer carries a sentence at all — there is nothing English
 * left to render — but "the type makes it impossible" is a claim about the
 * code, and this is a claim about what somebody sees. It drives the real
 * screen through all three refusals and reads what is on it.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { VerifyScreen } from '../screens/Verify';
import { CAMERA_UNAVAILABLE_TEXT, type CameraUnavailableReason } from '../lib/scanner';
import { setAppLanguage } from '../lib/i18n';

const en = translations.en as unknown as Record<string, string>;
const ha = translations.ha as unknown as Record<string, string>;

/**
 * Put the camera in the state we want to test, then open the scanner.
 *
 * `undefined` removes `mediaDevices` entirely, which is what a browser without
 * it looks like; a `DOMException` name is how a browser reports the other two.
 */
async function refuseTheCamera(failure: undefined | string) {
  const mediaDevices =
    failure === undefined
      ? undefined
      : {
          getUserMedia: vi.fn().mockRejectedValue(
            Object.assign(new Error('refused'), { name: failure }),
          ),
        };
  Object.defineProperty(navigator, 'mediaDevices', {
    value: mediaDevices,
    configurable: true,
    writable: true,
  });

  setAppLanguage('ha');
  render(<VerifyScreen connection="ONLINE" />);
  fireEvent.click(screen.getByText(ha.verifyScanQr));
}

beforeEach(() => {
  cleanup();
  setAppLanguage('en');
});
afterEach(() => {
  setAppLanguage('en');
  vi.restoreAllMocks();
});

/** The DOMException name each reason is reached by, and nothing else reaches. */
const REFUSALS: { name: string; failure: undefined | string; reason: CameraUnavailableReason }[] = [
  { name: 'the agent declines the permission', failure: 'NotAllowedError', reason: 'DENIED' },
  { name: 'the handset has no camera', failure: 'NotFoundError', reason: 'NO_CAMERA' },
  { name: 'the browser cannot open one at all', failure: undefined, reason: 'UNSUPPORTED' },
];

describe('a camera that will not open', () => {
  for (const { name, failure, reason } of REFUSALS) {
    it(`says so in Hausa when ${name}`, async () => {
      await refuseTheCamera(failure);
      const key = CAMERA_UNAVAILABLE_TEXT[reason];

      await waitFor(() => {
        expect(screen.getByText(ha[key])).toBeTruthy();
      });

      // The specific English, and the generic fallback that used to lose to it.
      expect(screen.queryByText(en[key])).toBeNull();
      expect(screen.queryByText(en.verifyCameraFailed)).toBeNull();
    });
  }

  /**
   * A translated string is not the same as a translated string that says
   * something. Each of these has to be Hausa, be its own sentence, and keep
   * the negative its English carries — the failure the review sheet calls the
   * worst one possible, because a dropped `ba` inverts the instruction.
   */
  it('gives each refusal its own Hausa, negation intact', () => {
    const keys = Object.values(CAMERA_UNAVAILABLE_TEXT);
    expect(new Set(keys).size).toBe(keys.length);

    for (const key of keys) {
      expect(ha[key]).toBeTruthy();
      expect(ha[key]).not.toBe(en[key]);
      expect(ha[key]).toMatch(/\b(ba|babu|bai|kada|banda)\b/i);
      expect(en[key]).toMatch(/\b(not|no|cannot)\b/i);
    }
  });
});
