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
import {
  ApiRequestError,
  clearStoredSession,
  getUser,
  hasStoredSession,
  isConnectivityFailure,
  setSession,
  storedSessionExpired,
} from './api';

/**
 * Simulate the app being closed: module memory goes, storage stays. There is no
 * API for this, so the test re-imports nothing and instead relies on
 * `getUser()` repopulating itself from storage — which is exactly the path a
 * cold start takes.
 */
function clearMemoryOnly(): void {
  // getUser() reads storage when its in-memory copy is empty, and setSession
  // is the only writer of that copy, so this is a faithful stand-in.
  const refresh = localStorage.getItem('psirs.refresh')!;
  const user = localStorage.getItem('psirs.user')!;
  const expiry = localStorage.getItem('psirs.session.expires')!;
  setSession(null);
  localStorage.setItem('psirs.refresh', refresh);
  localStorage.setItem('psirs.user', user);
  localStorage.setItem('psirs.session.expires', expiry);
}
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

  /**
   * A day in a market with no signal.
   *
   * The server takes at most fifty drafts in one request and refuses the whole
   * body above that. This function sent every pending draft in a single post,
   * so an agent who captured a fifty-first was refused — not for that capture,
   * but for all of them, on every sync from then on. The queue could not
   * drain, and the only way out was to stop capturing.
   */
  it('sends a long queue in batches the server will accept', async () => {
    for (let index = 0; index < 128; index += 1) {
      await saveDraft('TAXPAYER_REGISTRATION', { ...TAXPAYER, phone: `+23480370006${index}` });
    }

    const batchSizes: number[] = [];
    const outcome = await syncDrafts(async (drafts) => {
      batchSizes.push(drafts.length);
      return {
        results: drafts.map((draft) => ({
          clientReference: draft.clientReference,
          status: 'SYNCED',
          message: 'Registered.',
        })),
      };
    });

    expect(Math.max(...batchSizes)).toBeLessThanOrEqual(50);
    expect(batchSizes.reduce((total, size) => total + size, 0)).toBe(128);
    expect(outcome.synced).toBe(128);
    expect(await pendingDrafts()).toHaveLength(0);
  });

  it('keeps what it has not sent when a later batch cannot be delivered', async () => {
    for (let index = 0; index < 60; index += 1) {
      await saveDraft('TAXPAYER_REGISTRATION', { ...TAXPAYER, phone: `+23480370007${index}` });
    }

    let posts = 0;
    await expect(
      syncDrafts(async (drafts) => {
        posts += 1;
        if (posts > 1) throw offlineError();
        return {
          results: drafts.map((draft) => ({
            clientReference: draft.clientReference,
            status: 'SYNCED',
            message: 'Registered.',
          })),
        };
      }),
    ).rejects.toThrow();

    // The first batch really did land, so those are gone; the rest are still
    // the phone's to deliver.
    expect(await pendingDrafts()).toHaveLength(10);
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

describe('staying signed in on a phone that gets closed', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setSession(null);
  });

  const SESSION = {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    user: {
      id: 'u-1',
      fullName: 'Danladi Musa',
      phone: '+2347011000001',
      email: null,
      role: 'agent',
      permissions: ['taxpayer:create'],
      agentId: 'a-1',
    },
  };

  it('survives the app being closed and reopened', () => {
    setSession(SESSION);
    // Closing the app clears memory but not storage. This is the whole point of
    // the change: an agent who reopens with no signal can keep collecting.
    clearMemoryOnly();

    expect(hasStoredSession()).toBe(true);
    expect(getUser()?.fullName).toBe('Danladi Musa');
  });

  it('keeps the access token out of storage entirely', () => {
    setSession(SESSION);

    // The access token is what actually authorises a request. It is short-lived
    // and stays in memory; nothing on disk may carry it.
    for (let i = 0; i < localStorage.length; i += 1) {
      expect(localStorage.getItem(localStorage.key(i)!)).not.toContain('access-1');
    }
    // The refresh token is the one deliberate exception.
    expect(localStorage.getItem('psirs.refresh')).toBe('refresh-1');
  });

  it('signs out completely, without needing a network', () => {
    setSession(SESSION);
    clearStoredSession();

    expect(hasStoredSession()).toBe(false);
    expect(getUser()).toBe(null);
    expect(localStorage.getItem('psirs.refresh')).toBe(null);
    expect(localStorage.getItem('psirs.user')).toBe(null);
  });

  it('refuses a session past its absolute expiry', () => {
    setSession(SESSION);
    // A phone found long after it was lost. Refused here without reaching
    // PSIRS at all — though the server would refuse it too.
    localStorage.setItem('psirs.session.expires', String(Date.now() - 1000));

    expect(storedSessionExpired()).toBe(true);
    expect(hasStoredSession()).toBe(false);
    // Checking also clears it, so nothing usable is left behind.
    expect(localStorage.getItem('psirs.refresh')).toBe(null);
  });

  it('does not let a refresh extend the absolute expiry', () => {
    setSession(SESSION);
    const bound = localStorage.getItem('psirs.session.expires');

    // A rotation: new tokens, same session chain.
    setSession({ ...SESSION, accessToken: 'access-2', refreshToken: 'refresh-2' });

    expect(localStorage.getItem('psirs.session.expires')).toBe(bound);
    expect(localStorage.getItem('psirs.refresh')).toBe('refresh-2');
  });

  it('clears anything left by the older sessionStorage build', () => {
    sessionStorage.setItem('psirs.refresh', 'stale-token');
    sessionStorage.setItem('psirs.user', '{}');

    clearStoredSession();

    expect(sessionStorage.getItem('psirs.refresh')).toBe(null);
    expect(sessionStorage.getItem('psirs.user')).toBe(null);
  });
});

describe('two things asking for one sync', () => {
  /*
   * The connectivity effect in `App.tsx` asks for a sync when the connection
   * comes back, and the service worker posts SYNC_DRAFTS when the browser
   * reports the same thing — a message that until recently had no receiver, so
   * a second caller was not something this function had to think about.
   *
   * With both, two syncs of one queue go up together and the server sorts out
   * two requests carrying the same capture. It does: the draft-sync route
   * takes the second as a duplicate rather than registering the taxpayer
   * twice. What it cannot sort out is what the phone then tells the agent. The
   * second flight is answered DUPLICATE for every capture, so it reports that
   * none of them were sent — about work that had just been sent, by itself.
   */
  function serverLikePoster() {
    const seen = new Set<string>();
    const batches: string[][] = [];
    let open: (() => void) | undefined;
    // Every flight is held until released, so both are genuinely in the air at
    // once rather than one finishing before the other starts.
    const held = new Promise<void>((resolve) => {
      open = resolve;
    });

    const poster = async (
      drafts: { clientReference: string }[],
    ): Promise<{ results: { clientReference: string; status: string; message: string }[] }> => {
      batches.push(drafts.map((draft) => draft.clientReference));
      await held;
      return {
        results: drafts.map((draft) => {
          const firstSighting = !seen.has(draft.clientReference);
          seen.add(draft.clientReference);
          return {
            clientReference: draft.clientReference,
            // What `/drafts/sync` answers: the first request registers the
            // capture, a second carrying the same client reference is told it
            // is already there.
            status: firstSighting ? 'SYNCED' : 'DUPLICATE',
            message: firstSighting ? 'Registered.' : 'Already synchronised.',
          };
        }),
      };
    };

    return { poster, batches, release: () => open!() };
  }

  it('sends the queue once, and tells both callers the same true number', async () => {
    await saveDraft('TAXPAYER_REGISTRATION', TAXPAYER);
    await saveDraft('TAXPAYER_REGISTRATION', { ...TAXPAYER, phone: '+2347044000005' });

    const { poster, batches, release } = serverLikePoster();
    const fromTheConnection = syncDrafts(poster);
    const fromTheWorker = syncDrafts(poster);
    release();
    const [first, second] = await Promise.all([fromTheConnection, fromTheWorker]);

    expect(batches, 'the queue left the phone once, not twice over a reconnecting link')
      .toHaveLength(1);
    expect(second).toEqual(first);
    expect(first.synced).toBe(2);
    expect(
      second.synced,
      'the second caller was told none of the captures went, about work it had just sent itself',
    ).toBe(2);
    expect(second.duplicates).toBe(0);
    expect(await listDrafts()).toHaveLength(0);
  });

  it('starts a fresh sync for a capture made after the last one finished', async () => {
    /*
     * The guard on the guard. A flight that is never cleared would make the
     * first sync of a session the only one, and the agent's queue would sit on
     * the phone for ever with the app reporting nothing wrong.
     */
    await saveDraft('TAXPAYER_REGISTRATION', TAXPAYER);
    const firstRun = serverLikePoster();
    const first = syncDrafts(firstRun.poster);
    firstRun.release();
    expect((await first).synced).toBe(1);

    await saveDraft('TAXPAYER_REGISTRATION', { ...TAXPAYER, phone: '+2347044000006' });
    const secondRun = serverLikePoster();
    const second = syncDrafts(secondRun.poster);
    secondRun.release();

    expect((await second).synced).toBe(1);
    expect(secondRun.batches).toHaveLength(1);
    expect(await listDrafts()).toHaveLength(0);
  });

  it('fails every caller sharing a flight, and clears it so the next one runs', async () => {
    /*
     * A caller told nothing happened when a sync failed is a caller that will
     * not retry. Both get the failure, and the queue is intact for whichever
     * of them asks again.
     */
    await saveDraft('TAXPAYER_REGISTRATION', TAXPAYER);

    let refuse: ((error: Error) => void) | undefined;
    const refused = new Promise<never>((_resolve, reject) => {
      refuse = reject;
    });
    /*
     * Rejected below before the flight has reached the poster, so a handler is
     * attached here or Node reports it as unhandled and the run fails on an
     * error outside any test. The assertions that matter are further down.
     */
    refused.catch(() => {});
    const failing = async () => refused;

    const fromTheConnection = syncDrafts(failing);
    const fromTheWorker = syncDrafts(failing);
    refuse!(new Error('the signal went'));

    await expect(fromTheConnection).rejects.toThrow('the signal went');
    await expect(fromTheWorker).rejects.toThrow('the signal went');
    expect(await pendingDrafts()).toHaveLength(1);

    // And the flight is gone, so the retry is a real one.
    const retry = serverLikePoster();
    const after = syncDrafts(retry.poster);
    retry.release();
    expect((await after).synced).toBe(1);
  });
});
