/**
 * Three queues of unfinished work, and what an officer is told after retrying.
 *
 * The refund queue is money a citizen has paid and not had back. The retry
 * button asks the gateway again, and what comes back is either "all of it went
 * out" or "some of it did, and these people are still waiting" — which is the
 * single most consequential sentence on this screen, because the second reading
 * is the one an officer has to act on.
 *
 * All three endpoints compose that sentence server-side and return it as
 * `message`, and this screen rendered it in preference to the dictionary string
 * sitting behind the `??`. So the sentence arrived in English, always, in an
 * application that offers Hausa — the ninth appearance of that exact shape.
 *
 * The counts are in the payload either way. So the fix was to compose here,
 * and what this file holds is that the composition happened: the numbers the
 * server reported survive into what is on the screen, in the officer's own
 * language, and the server's English does not appear at all.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { OutstandingScreen } from '../screens/Outstanding';
import * as apiModule from '../lib/api';
import { setPortalLanguage } from '../lib/i18n';

const ha = translations.ha as unknown as Record<string, string>;
const en = translations.en as unknown as Record<string, string>;

const REFUND = {
  id: 'rf-1',
  refund_reference: 'RFD-2026-000041',
  amount_kobo: '300000',
  status: 'PENDING',
  attempts: 2,
  failure_reason: 'gateway timeout',
  last_attempt_at: '2026-09-09T11:00:00.000Z',
  created_at: '2026-09-01T08:00:00.000Z',
  transaction_reference: 'TRX-2026-000041',
};

/** What the API sends back, English `message` included, as it really does. */
let retryReply: Record<string, unknown> = {};

beforeEach(() => {
  cleanup();
  setPortalLanguage('ha');
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
  vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) => {
    if (path.includes('refunds/outstanding')) return { refunds: [REFUND] } as never;
    if (path.includes('tin-outstanding')) return { taxpayers: [] } as never;
    if (path.includes('ended-with-arrears')) return { taxpayers: [] } as never;
    return { renewals: [], vehicles: [] } as never;
  });
  vi.spyOn(apiModule.api, 'post').mockImplementation(async () => retryReply as never);
});

afterEach(() => {
  setPortalLanguage('en');
  vi.restoreAllMocks();
});

/** Press "ask the gateway again" and wait for the answer to land. */
async function retryTheRefunds(): Promise<void> {
  render(<OutstandingScreen />);
  const button = await screen.findByText(ha.ofcOsAskTheGatewayAgain);
  fireEvent.click(button);
}

describe('what the retry actually did', () => {
  it('says every refund went back, in Hausa, with the count the server gave', async () => {
    retryReply = {
      attempted: 4,
      completed: 4,
      stillOutstanding: 0,
      message: '4 refund(s) returned to taxpayers.',
    };
    await retryTheRefunds();

    await waitFor(() => {
      expect(
        screen.getByText(ha.ofcOsRefundsReturned.replace('{{n}}', '4')),
      ).toBeTruthy();
    });
    // The server's own sentence is on the wire and must not be on the screen.
    expect(screen.queryByText('4 refund(s) returned to taxpayers.')).toBeNull();
  });

  /**
   * The reading that matters.
   *
   * Two citizens still have not had their money. An officer who reads
   * "complete" and closes the tab has left them there, so this asserts both
   * numbers reach the screen — the one that went out and the one that did not.
   */
  it('names how many are still owed when the retry only partly worked', async () => {
    retryReply = {
      attempted: 5,
      completed: 3,
      stillOutstanding: 2,
      message: '3 returned; 2 still owed. Those taxpayers have not had their money back yet.',
    };
    await retryTheRefunds();

    const expected = ha.ofcOsRefundsPartly
      .replace('{{done}}', '3')
      .replace('{{left}}', '2');

    await waitFor(() => {
      expect(screen.getByText(expected)).toBeTruthy();
    });
    expect(screen.getByText(expected).textContent).toContain('2');
    expect(
      screen.queryByText(/still owed\. Those taxpayers have not had their money back yet\./),
    ).toBeNull();
  });

  /**
   * A partial retry is not a success, and the screen has to look like it.
   *
   * `resolved` picks the styling. Green under a sentence that says two people
   * are still waiting is the cheerful reading of a queue that has not cleared,
   * and it is the reading an officer skimming will take.
   */
  it('does not dress a partial retry as a finished one', async () => {
    retryReply = { attempted: 5, completed: 3, stillOutstanding: 2, message: 'x' };
    await retryTheRefunds();

    const expected = ha.ofcOsRefundsPartly.replace('{{done}}', '3').replace('{{left}}', '2');
    await waitFor(() => expect(screen.getByText(expected)).toBeTruthy());

    const alert = screen.getByText(expected).closest('.alert');
    expect(alert?.className).not.toMatch(/alert--success|alert--good/);
  });

  /**
   * Both sentences per queue, both languages, negation intact.
   *
   * The six strings are new, and three of them are the ones that tell somebody
   * money is still outstanding. A dropped `ba` inverts that — the failure the
   * review sheet calls the worst one available — so each is checked for the
   * negation its English carries rather than merely for being non-empty.
   */
  it('has real Hausa for all six outcomes', () => {
    const partly = ['ofcOsRefundsPartly', 'ofcOsTinsPartly', 'ofcOsRenewalsPartly'] as const;
    const done = ['ofcOsRefundsReturned', 'ofcOsTinsAssigned', 'ofcOsRenewalsAcked'] as const;

    for (const key of [...partly, ...done]) {
      expect(ha[key], `${key} has no Hausa`).toBeTruthy();
      expect(ha[key], `${key} was never translated`).not.toBe(en[key]);
      // The placeholders have to survive translation or the count vanishes.
      for (const token of en[key].match(/\{\{\w+\}\}/g) ?? []) {
        expect(ha[key], `${key} lost ${token}`).toContain(token);
      }
    }

    // "still outstanding" is a negative claim in both languages.
    for (const key of partly) {
      expect(ha[key], `${key} lost its negation`).toMatch(/\b(ba|babu|bai|har yanzu)\b/);
    }
  });
});
