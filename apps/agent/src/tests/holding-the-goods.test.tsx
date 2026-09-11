/**
 * The sentence that stops a bag of fertiliser going out twice.
 *
 * An agent is at a store with a queue of farmers. Each has a code; the job is
 * to check it is real, hand over what it says, and record that it happened
 * once. `CollectionScreen`'s own header explains why the offline path here
 * does NOT queue like every other capture in this app: a collection is a claim
 * on a finite store, the platform is the only thing that knows whether a code
 * has already been used, and recording it optimistically "is how the same bag
 * of fertiliser gets handed out twice".
 *
 * Which makes the agent the only control, and one sentence the only thing
 * directing them:
 *
 *     "PSIRS could not be reached, so this collection has not been recorded.
 *      Do not hand anything over until it has been."
 *
 * It had become unreachable. The catch tested `instanceof ApiRequestError`
 * before `isConnectivityFailure`, which was harmless until `request()` began
 * wrapping a lost signal as `ApiRequestError(0, { code: 'NETWORK' })` so it
 * could carry a translated sentence. After that the first branch swallowed
 * every connectivity failure, and what the agent read was "Could not reach
 * PSIRS. Try again." — which does not tell anybody to hold the goods.
 *
 * These drive a real rejected `fetch` rather than a hand-made error, and that
 * is not incidental: the whole defect lives in what `request()` does to a
 * TypeError on the way past. A test that constructs its own `ApiRequestError`
 * would have gone green over it, which is exactly how ten tests once went
 * green over a broken `isConnectivityFailure`.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { CollectionScreen } from '../screens/Collection';
import { setAppLanguage } from '../lib/i18n';

const ha = translations.ha;
const en = translations.en;

/** What `fetch` does when there is no network: it rejects, with a TypeError. */
function noNetwork() {
  return vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
}

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setAppLanguage('ha');
});

afterEach(() => {
  cleanup();
  setAppLanguage('en');
});

async function tryToRecord(code = 'ABCDE-12345') {
  const field = await screen.findByLabelText(ha.allocTypeCode, { exact: false });
  fireEvent.change(field, { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: ha.allocRecordCollection }));
}

describe('an agent at a store with no signal', () => {
  it('is told not to hand anything over', async () => {
    noNetwork();
    render(<CollectionScreen />);
    await tryToRecord();

    await waitFor(() => expect(screen.getByText(ha.allocOfflineBody)).toBeTruthy());
  });

  /*
   * The generic network sentence is a correct thing to say and the wrong thing
   * to say here. "Try again" is what an agent does with a failed lookup; it is
   * not what they do with a queue of people waiting for goods.
   */
  it('does not get the generic “try again” instead', async () => {
    noNetwork();
    render(<CollectionScreen />);
    await tryToRecord();

    await waitFor(() => expect(screen.getByText(ha.allocOfflineBody)).toBeTruthy());
    expect(screen.queryByText(ha.errNetwork)).toBeNull();
  });

  it('says it in English for an agent working in English', async () => {
    setAppLanguage('en');
    noNetwork();
    render(<CollectionScreen />);

    const field = await screen.findByLabelText(en.allocTypeCode, { exact: false });
    fireEvent.change(field, { target: { value: 'ABCDE-12345' } });
    fireEvent.click(screen.getByRole('button', { name: en.allocRecordCollection }));

    await waitFor(() => expect(screen.getByText(en.allocOfflineBody)).toBeTruthy());
    // The instruction is the half that matters, in either language.
    expect(en.allocOfflineBody).toMatch(/do not hand anything over/i);
  });
});

describe('a refusal that is not a lost signal', () => {
  /*
   * A code already used is the other outcome that matters at a collection
   * point, and it must not be dressed up as an outage — an agent told "could
   * not be reached" would wait and try again, when the answer is that this
   * person has already collected.
   */
  it('shows what PSIRS actually said', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'ALREADY_COLLECTED',
            message: 'This allocation has already been collected.',
            moneyStatus: 'NOT_APPLICABLE',
          },
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      ) as never,
    );
    render(<CollectionScreen />);
    await tryToRecord();

    await waitFor(() =>
      expect(screen.getByText('This allocation has already been collected.')).toBeTruthy(),
    );
    expect(screen.queryByText(ha.allocOfflineBody)).toBeNull();
  });
});
