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

export type DraftType =
  | 'TAXPAYER_REGISTRATION'
  | 'SERVICE_REQUEST'
  | 'VEHICLE_CAPTURE'
  | 'DOCUMENT_CAPTURE';

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
 * Push queued drafts to the server, which assigns the real identifiers
 * (PRD §30: "Offline records must receive server-generated IDs after
 * synchronization").
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
  if (queued.length === 0) return { synced: 0, rejected: 0, duplicates: 0, messages: [] };

  const response = await poster(
    queued.map(({ clientReference, draftType, payload, capturedAt }) => ({
      clientReference,
      draftType,
      payload,
      capturedAt,
    })),
  );

  const outcome: SyncOutcome = { synced: 0, rejected: 0, duplicates: 0, messages: [] };

  for (const result of response.results) {
    const draft = queued.find((item) => item.clientReference === result.clientReference);
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

  return outcome;
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
