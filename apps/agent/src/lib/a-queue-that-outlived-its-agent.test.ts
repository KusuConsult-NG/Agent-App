/**
 * A capture belongs to the agent who made it, not to the handset.
 *
 * Agents share handsets. This application has device registration, clearance
 * and a session that refuses a blocked device precisely because they do, and
 * signing out already gives the push subscription back for the same reason.
 *
 * The draft queue was the other half of that and was not given back. It lives
 * in IndexedDB, which outlives a session; `logout()` clears the session and the
 * push endpoint and never touches it; and a draft carried no record of who
 * captured it. So the next agent to sign in on the phone saw the last one's
 * queue, and syncing it sent their work up under the new name: the sync route
 * attributes a draft to `req.auth.agentId` — the session that posted it — and
 * there was nothing in the draft to say otherwise.
 *
 * The end of that path is a presumptive assessment. A BUSINESS_OBSERVATION
 * becomes the office's record of what a stall looks like, and the State then
 * holds that agent B observed premises B never visited. It is the provenance an
 * objection turns on.
 *
 * No money can ride this: the queue refuses financial payloads outright
 * (Addendum §23), so what leaks is provenance and the trader's details, not a
 * payment.
 *
 * The fix is ownership rather than deletion. Clearing the queue on sign-out
 * would be simpler and would break the older promise — never lose a capture —
 * by destroying work an agent has not yet been able to send. A's drafts stay on
 * the device, invisible to B, and go up when A signs in again.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { logout, setSession, clearStoredSession } from './api';
import { saveDraft, listDrafts, pendingDrafts } from './drafts';

function agent(id: string, fullName: string, phone: string) {
  return {
    accessToken: `token-${id}`,
    refreshToken: `refresh-${id}`,
    user: {
      id,
      fullName,
      phone,
      email: null,
      role: 'agent',
      permissions: [],
      mustChangePassword: false,
    },
  } as never;
}

const A = agent('agent-a', 'Danladi Musa', '+2347011000001');
const B = agent('agent-b', 'Amina Bello', '+2347011000002');

/** Sign out and hand the phone over, the way a shift change does it. */
async function handOver(to: typeof B): Promise<void> {
  await logout();
  setSession(to);
}

beforeEach(async () => {
  clearStoredSession();
  // The store outlives a session by design, so each case starts by emptying
  // whatever the last one left — as the handset never does.
  setSession(A);
  for (const draft of await listDrafts()) {
    const { removeDraft } = await import('./drafts');
    await removeDraft(draft.clientReference);
  }
  clearStoredSession();
});

describe('a queue that outlived its agent', () => {
  it('does not show one agent the captures of the last one', async () => {
    setSession(A);
    await saveDraft('BUSINESS_OBSERVATION', {
      businessName: 'Mama Ngozi Provisions',
      lgaId: 'lga-1',
    });
    expect(await pendingDrafts()).toHaveLength(1);

    await handOver(B);

    expect(await pendingDrafts()).toHaveLength(0);
    expect(await listDrafts()).toHaveLength(0);
  });

  it('does not let one agent sync the captures of the last one', async () => {
    setSession(A);
    await saveDraft('TAXPAYER_REGISTRATION', { firstName: 'Ngozi', lastName: 'Eze' });

    await handOver(B);

    // syncDrafts sends whatever pendingDrafts returns, so an empty queue here
    // is the whole guarantee: nothing of A's can reach the wire as B's.
    const { syncDrafts } = await import('./drafts');
    let posted = 0;
    await syncDrafts(async (batch) => {
      posted += batch.length;
      return { results: [] };
    });
    expect(posted).toBe(0);
  });

  it('gives the captures back when their own agent returns', async () => {
    setSession(A);
    await saveDraft('BUSINESS_OBSERVATION', {
      businessName: 'Mama Ngozi Provisions',
      lgaId: 'lga-1',
    });

    await handOver(B);
    expect(await pendingDrafts()).toHaveLength(0);

    // The work was hidden, not destroyed. Losing a capture an agent cannot yet
    // send is the failure this queue exists to prevent.
    await handOver(A);
    const returned = await pendingDrafts();
    expect(returned).toHaveLength(1);
    expect(returned[0]!.payload.businessName).toBe('Mama Ngozi Provisions');
  });

  // --- controls ---

  it('still shows an agent their own captures across a sign-out and back in', async () => {
    setSession(A);
    await saveDraft('VEHICLE_CAPTURE', { plateNumber: 'ABC-123-XY' });

    await logout();
    setSession(A);

    expect(await pendingDrafts()).toHaveLength(1);
  });

  it('still refuses to queue anything that looks like a payment', async () => {
    setSession(A);
    await expect(
      saveDraft('BUSINESS_OBSERVATION', { businessName: 'Stall', amountKobo: '5000' }),
    ).rejects.toThrow(/refusing to queue a draft/i);
  });
});
