/**
 * Offline capture tests.
 *
 * Two things are being protected here, and they pull in opposite directions.
 *
 * The first is that a capture must never be lost. An agent standing in front of
 * a citizen with no signal has already done the work of collecting the details;
 * if pressing "Register" throws that away, offline mode does not exist in any
 * sense that matters in the field.
 *
 * The second is that offline mode must never authorise a government revenue
 * payment (Addendum §23). A queue that keeps work for later is exactly the
 * mechanism that could replay a payment the agent never had confirmed, so the
 * queue refuses financial payloads outright.
 *
 * The tension is real: "never lose a capture" and "never queue a payment" are
 * both absolute, and the resolution is that only non-financial records are
 * capturable at all. These tests hold both ends.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { ApiRequestError, isConnectivityFailure } from './api';
import {
  FinancialDraftRefused,
  listDrafts,
  pendingDrafts,
  removeDraft,
  saveDraft,
  submitOrQueue,
  syncDrafts,
} from './drafts';

const TAXPAYER = {
  taxpayerType: 'INDIVIDUAL',
  firstName: 'Ladi',
  lastName: 'Dung',
  phone: '+2347044000004',
  address: 'Village square, Kuru',
  lgaId: '0f6f4b1e-0000-4000-8000-000000000001',
  consentGiven: true,
  declarationAccepted: true,
};

function offlineError(): ApiRequestError {
  // What the service worker answers when the request cannot leave the device.
  return new ApiRequestError(503, {
    code: 'OFFLINE',
    message: 'You are offline.',
    moneyStatus: 'NOT_DEBITED',
  });
}

beforeEach(async () => {
  for (const draft of await listDrafts()) await removeDraft(draft.clientReference);
});

describe('telling "unreachable" apart from "refused"', () => {
  it('recognises the service worker offline response', () => {
    expect(isConnectivityFailure(offlineError())).toBe(true);
  });

  it('recognises a request that never left the device', () => {
    // fetch() rejects with a TypeError when there is no network at all.
    expect(isConnectivityFailure(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('does not mistake a rejection for an outage', () => {
    // Every one of these is PSIRS answering. Queueing them would defer a
    // correction the agent could make while the citizen is still standing there.
    const rejections = [
      new ApiRequestError(409, {
        code: 'TAXPAYER_ALREADY_EXISTS',
        message: 'Already registered',
        moneyStatus: 'NOT_APPLICABLE',
      }),
      new ApiRequestError(422, {
        code: 'VALIDATION_FAILED',
        message: 'Phone is not valid',
        moneyStatus: 'NOT_APPLICABLE',
      }),
      new ApiRequestError(403, {
        code: 'AGENT_NOT_CLEARED',
        message: 'Not cleared',
        moneyStatus: 'NOT_APPLICABLE',
      }),
      new ApiRequestError(500, {
        code: 'INTERNAL_ERROR',
        message: 'Server problem',
        moneyStatus: 'NOT_DEBITED',
      }),
    ];

    for (const rejection of rejections) {
      expect(isConnectivityFailure(rejection)).toBe(false);
    }
  });

  it('does not treat a 503 that is not an outage as one', () => {
    // The KYC and TIN services answer 503 when *they* are unreachable. That is
    // a real reply from PSIRS about a third party, not a lost connection.
    const upstream = new ApiRequestError(503, {
      code: 'TIN_SERVICE_UNAVAILABLE',
      message: 'The TIN service could not be reached.',
      moneyStatus: 'NOT_APPLICABLE',
    });
    expect(isConnectivityFailure(upstream)).toBe(false);
  });
});

describe('a capture is never lost to a missing signal', () => {
  it('sends when it can', async () => {
    const outcome = await submitOrQueue(
      'TAXPAYER_REGISTRATION',
      TAXPAYER,
      async () => ({ taxpayerId: 'tp-1', tin: '123456789' }),
      isConnectivityFailure,
    );

    expect(outcome.sent).toBe(true);
    expect(await pendingDrafts()).toHaveLength(0);
  });

  it('keeps the capture on the phone when it cannot', async () => {
    const outcome = await submitOrQueue(
      'TAXPAYER_REGISTRATION',
      TAXPAYER,
      async () => {
        throw offlineError();
      },
      isConnectivityFailure,
    );

    expect(outcome.sent).toBe(false);

    const queued = await pendingDrafts();
    expect(queued).toHaveLength(1);
    expect(queued[0]!.draftType).toBe('TAXPAYER_REGISTRATION');
    // The whole capture is kept, not a summary of it.
    expect(queued[0]!.payload).toEqual(TAXPAYER);
  });

  it('rethrows a rejection instead of hiding it in the queue', async () => {
    const rejection = new ApiRequestError(409, {
      code: 'TAXPAYER_ALREADY_EXISTS',
      message: 'This person is already registered.',
      moneyStatus: 'NOT_APPLICABLE',
    });

    await expect(
      submitOrQueue(
        'TAXPAYER_REGISTRATION',
        TAXPAYER,
        async () => {
          throw rejection;
        },
        isConnectivityFailure,
      ),
    ).rejects.toThrow('already registered');

    expect(await pendingDrafts()).toHaveLength(0);
  });

  it('queues a vehicle captured with no connection', async () => {
    const outcome = await submitOrQueue(
      'VEHICLE_CAPTURE',
      { registrationNumber: 'JOS123AB', vehicleType: 'PRIVATE', ownerName: 'Dung Pam' },
      async () => {
        throw new TypeError('Failed to fetch');
      },
      isConnectivityFailure,
    );

    expect(outcome.sent).toBe(false);
    expect((await pendingDrafts())[0]!.draftType).toBe('VEHICLE_CAPTURE');
  });
});

describe('offline mode cannot authorise a payment', () => {
  // Addendum §23. The draft type union already makes a payment inexpressible;
  // this is the runtime backstop, because the queue is the one place where the
  // agent's own device writes data that the server later replays.
  const financial = [
    { amountKobo: '500000' },
    { amount: 5000 },
    { total_kobo: '500000' },
    { paymentId: 'pay-1' },
    { paymentReference: 'PSIRS/2026/0001' },
    { transactionId: 'txn-1' },
    { gatewayReference: 'RRR280002091257' },
    { receiptNumber: 'PSIRS/RCT/0001' },
    { paymentStatus: 'VERIFIED' },
  ];

  for (const payload of financial) {
    const key = Object.keys(payload)[0]!;
    it(`refuses to queue a payload containing "${key}"`, async () => {
      await expect(saveDraft('TAXPAYER_REGISTRATION', payload)).rejects.toBeInstanceOf(
        FinancialDraftRefused,
      );
      expect(await pendingDrafts()).toHaveLength(0);
    });
  }

  it('refuses before attempting to send, not only on the queue path', async () => {
    // Otherwise a financial payload would go out on a good connection and be
    // refused only when the signal dropped — the opposite of fail-closed.
    let attempted = false;
    await expect(
      submitOrQueue(
        'TAXPAYER_REGISTRATION',
        { amountKobo: '500000' },
        async () => {
          attempted = true;
          return {};
        },
        isConnectivityFailure,
      ),
    ).rejects.toBeInstanceOf(FinancialDraftRefused);

    expect(attempted).toBe(false);
  });

  it('allows an ordinary registration through', async () => {
    // The guard must not be so broad that it blocks real work.
    await expect(saveDraft('TAXPAYER_REGISTRATION', TAXPAYER)).resolves.toBeTruthy();
  });
});

describe('syncing what the phone kept', () => {
  it('clears a draft the server accepted, and keeps one it rejected', async () => {
    const accepted = await saveDraft('TAXPAYER_REGISTRATION', TAXPAYER);
    const rejected = await saveDraft('TAXPAYER_REGISTRATION', { ...TAXPAYER, phone: '+2340000' });

    const outcome = await syncDrafts(async (drafts) => ({
      results: drafts.map((draft) => ({
        clientReference: draft.clientReference,
        status: draft.clientReference === accepted.clientReference ? 'SYNCED' : 'REJECTED',
        message: draft.clientReference === accepted.clientReference ? 'Registered.' : 'Bad phone',
      })),
    }));

    expect(outcome.synced).toBe(1);
    expect(outcome.rejected).toBe(1);

    const remaining = await listDrafts();
    expect(remaining).toHaveLength(1);
    // Kept, and marked, so the agent can correct it rather than recapture it.
    expect(remaining[0]!.clientReference).toBe(rejected.clientReference);
    expect(remaining[0]!.status).toBe('REJECTED');
    expect(remaining[0]!.message).toBe('Bad phone');
    // A rejected draft is not resent on the next sync.
    expect(await pendingDrafts()).toHaveLength(0);
  });

  it('does not resend a draft the server has already seen', async () => {
    await saveDraft('TAXPAYER_REGISTRATION', TAXPAYER);

    const outcome = await syncDrafts(async (drafts) => ({
      results: drafts.map((draft) => ({
        clientReference: draft.clientReference,
        status: 'DUPLICATE',
        message: 'Already synchronised.',
      })),
    }));

    expect(outcome.duplicates).toBe(1);
    // Removed from the phone: the record exists on the server, and Addendum §22
    // asks that government data not linger in the browser.
    expect(await listDrafts()).toHaveLength(0);
  });

  it('leaves the queue untouched when the sync itself fails', async () => {
    await saveDraft('TAXPAYER_REGISTRATION', TAXPAYER);

    await expect(
      syncDrafts(async () => {
        throw offlineError();
      }),
    ).rejects.toThrow();

    // Still queued. A failed sync must never look like a delivered one.
    expect(await pendingDrafts()).toHaveLength(1);
  });

  it('does nothing when there is nothing to send', async () => {
    let called = false;
    const outcome = await syncDrafts(async () => {
      called = true;
      return { results: [] };
    });

    expect(called).toBe(false);
    expect(outcome.synced).toBe(0);
  });
});
