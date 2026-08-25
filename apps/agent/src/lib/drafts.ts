/**
 * Offline draft queue (PRD §30; Addendum §23).
 *
 * Drafts are held in IndexedDB, keyed by a client-generated reference that
 * doubles as the server's idempotency key: syncing the same draft twice cannot
 * create two taxpayers.
 *
 * Only non-financial captures can be queued. There is no draft type for a
 * payment, because Addendum §23 is unambiguous — "Offline mode must never
 * authorize government revenue payment" — and the surest way to honour that is
 * to give the offline path no way to express one.
 */

/**
 * What may be captured without a connection.
 *
 * Every type here is a *record of something observed* — who the taxpayer is,
 * what the vehicle is. None of them moves money, and that is the whole
 * selection rule. There is no payment draft type, and adding one would break
 * Addendum §23 no matter how carefully it were handled.
 */
export type DraftType = 'TAXPAYER_REGISTRATION' | 'VEHICLE_CAPTURE';

/**
 * Fields that must never appear in a queued payload.
 *
 * A belt-and-braces check on top of the type restriction above. Offline capture
 * is the one place in the app where data is written by the agent's own device
 * and replayed later; if a payment-shaped payload ever reached this queue it
 * would be replayed against the server as though the agent had authorised it.
 * The type system already forbids it — this refuses it at runtime too.
 */
const FINANCIAL_KEYS = [
  'amount',
  'amountkobo',
  'totalkobo',
  'paymentid',
  'paymentreference',
  'paymentstatus',
  'transactionid',
  'gatewayreference',
  'receiptnumber',
];

export class FinancialDraftRefused extends Error {
  constructor(key: string) {
    super(
      `Refusing to queue a draft containing "${key}". Offline mode must never ` +
        'authorise a government revenue payment (Addendum §23).',
    );
    this.name = 'FinancialDraftRefused';
  }
}

function assertNotFinancial(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (FINANCIAL_KEYS.includes(key.toLowerCase().replace(/[_-]/g, ''))) {
      throw new FinancialDraftRefused(key);
    }
  }
}

export interface Draft {
  clientReference: string;
  draftType: DraftType;
  payload: Record<string, unknown>;
  capturedAt: string;
  status: 'PENDING_SYNC' | 'SYNCED' | 'REJECTED';
  message?: string;
  serverEntityId?: string;
}

const DB_NAME = 'psirs-agent';
const DB_VERSION = 1;
const STORE = 'drafts';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'clientReference' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = fn(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

export async function saveDraft(
  draftType: DraftType,
  payload: Record<string, unknown>,
): Promise<Draft> {
  assertNotFinancial(payload);

  const draft: Draft = {
    clientReference: `draft-${crypto.randomUUID()}`,
    draftType,
    payload,
    capturedAt: new Date().toISOString(),
    status: 'PENDING_SYNC',
  };
  await withStore('readwrite', (store) => store.put(draft));
  return draft;
}

export async function listDrafts(): Promise<Draft[]> {
  const drafts = await withStore<Draft[]>('readonly', (store) => store.getAll() as IDBRequest<Draft[]>);
  return drafts.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}

export async function pendingDrafts(): Promise<Draft[]> {
  return (await listDrafts()).filter((draft) => draft.status === 'PENDING_SYNC');
}

export async function updateDraft(draft: Draft): Promise<void> {
  await withStore('readwrite', (store) => store.put(draft));
}

/**
 * Remove a synced draft.
 *
 * Successfully synced captures are deleted from the device rather than kept:
 * once the record exists on the server the local copy is only a liability, and
 * Addendum §22 asks that sensitive government data not linger in the browser.
 */
export async function removeDraft(clientReference: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(clientReference));
}

export interface SyncOutcome {
  synced: number;
  rejected: number;
  duplicates: number;
  messages: string[];
}

/**
 * How many drafts may travel in one request.
 *
 * `POST /drafts/sync` refuses a body carrying more than this — the whole body,
 * not the surplus. Sending the queue in one post therefore worked until an
 * agent captured the fifty-first, and from then on every sync was refused for
 * all of them at once: the queue could not drain, and the only way to make
 * progress was to stop capturing. A day in a market without signal reaches
 * fifty easily.
 */
const SYNC_BATCH = 50;

/**
 * Push queued drafts to the server, which assigns the real identifiers
 * (PRD §30: "Offline records must receive server-generated IDs after
 * synchronization").
 *
 * Batches are delivered in order and each is settled before the next is sent,
 * so a connection that dies partway leaves the delivered ones gone from the
 * phone and the rest still queued. The failure is rethrown: a sync that did
 * not finish must never look like one that did.
 */
export async function syncDrafts(
  poster: (drafts: Pick<Draft, 'clientReference' | 'draftType' | 'payload' | 'capturedAt'>[]) => Promise<{
    results: {
      clientReference: string;
      status: string;
      entityId?: string;
      message: string;
    }[];
  }>,
): Promise<SyncOutcome> {
  const queued = await pendingDrafts();
  const outcome: SyncOutcome = { synced: 0, rejected: 0, duplicates: 0, messages: [] };
  if (queued.length === 0) return outcome;

  for (let start = 0; start < queued.length; start += SYNC_BATCH) {
    const batch = queued.slice(start, start + SYNC_BATCH);

    const response = await poster(
      batch.map(({ clientReference, draftType, payload, capturedAt }) => ({
        clientReference,
        draftType,
        payload,
        capturedAt,
      })),
    );

    for (const result of response.results) {
      const draft = batch.find((item) => item.clientReference === result.clientReference);
      if (!draft) continue;

      if (result.status === 'SYNCED') {
        outcome.synced += 1;
        await removeDraft(draft.clientReference);
      } else if (result.status === 'DUPLICATE') {
        outcome.duplicates += 1;
        await removeDraft(draft.clientReference);
      } else if (result.status === 'REJECTED') {
        outcome.rejected += 1;
        await updateDraft({ ...draft, status: 'REJECTED', message: result.message });
      }
      outcome.messages.push(result.message);
    }
  }

  return outcome;
}

/**
 * Submit a capture, keeping it on the phone if PSIRS cannot be reached.
 *
 * This is what makes offline collection work in the field rather than in
 * principle. Before it, an agent standing in front of a citizen with no signal
 * had to know to press "Save for later" *instead* of "Register"; pressing
 * "Register" produced a network error and the capture was theirs to retype.
 *
 * Only a connectivity failure is caught. A rejection — a duplicate, a missing
 * field, an unconfirmable TIN — is the server answering, and it is rethrown so
 * the agent sees it and fixes it. Queueing a rejected capture would just defer
 * the same rejection and lose the chance to correct it while the citizen is
 * still standing there.
 */
export async function submitOrQueue<T>(
  draftType: DraftType,
  payload: Record<string, unknown>,
  send: () => Promise<T>,
  isConnectivityFailure: (error: unknown) => boolean,
): Promise<{ sent: true; result: T } | { sent: false; draft: Draft }> {
  // Refuse a financial payload before either path, so it can neither be sent
  // as a draft nor silently fall through to the queue on a flaky connection.
  assertNotFinancial(payload);

  try {
    return { sent: true, result: await send() };
  } catch (error) {
    if (!isConnectivityFailure(error)) throw error;
    return { sent: false, draft: await saveDraft(draftType, payload) };
  }
}

/** Ask the browser to retry the sync when connectivity returns. */
export async function requestBackgroundSync(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const sync = (registration as ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> };
    }).sync;
    await sync?.register('psirs-sync-drafts');
  } catch {
    // Background Sync is not available on every browser; the app also syncs
    // whenever it regains connectivity in the foreground.
  }
}
