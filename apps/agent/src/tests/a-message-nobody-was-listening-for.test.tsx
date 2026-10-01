/**
 * The browser saying the signal is back, to nobody.
 *
 * `requestBackgroundSync` registers the `psirs-sync-drafts` tag, the browser
 * fires `sync` in the service worker when connectivity returns, and `sw.js`
 * posts `SYNC_DRAFTS` to every client it can find. Nothing in this application
 * listened. The whole chain ended in a dropped message.
 *
 * The catch in `App.tsx` that handles a sync dying of no signal asks for that
 * mechanism by name — "ask the browser to try again later and say nothing: the
 * connection banner already has it" — and was then never told when later came.
 *
 * What the worker cannot do is send the drafts itself. They are in IndexedDB,
 * which it can read, but a sync needs the access token this page holds. So the
 * message is the right design and only the receiver was missing.
 *
 * This does not help a handset whose app is fully closed: `matchAll` finds no
 * client and the sync event completes having done nothing. It helps the case a
 * field agent spends the day in — the app open but backgrounded, between a
 * stall with signal and one without.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { App } from '../App';
import { api } from '../lib/api';
import * as drafts from '../lib/drafts';

const HOME = {
  today: { collected_kobo: '0', successful: '0', total: '0', pending: '0' },
  commission: { lifetime_kobo: '0', available_kobo: '0', today_kobo: '0' },
  taxpayersOnboarded: { today: '0', total: '0' },
  recentTransactions: [],
};

vi.mock('../lib/drafts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/drafts')>()),
  pendingDrafts: vi.fn(),
  syncDrafts: vi.fn(),
  requestBackgroundSync: vi.fn(),
}));

/*
 * happy-dom has no `navigator.serviceWorker`, so the effect's own guard returns
 * before it ever attaches — which is why the rest of the agent suite is
 * untouched by this change, and why this file has to supply one. An EventTarget
 * is the whole of what the page uses: `addEventListener`, `removeEventListener`
 * and the message the worker dispatches.
 */
let worker: EventTarget;

beforeEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  worker = new EventTarget();
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: worker });
  vi.spyOn(api, 'get').mockResolvedValue(HOME as never);
  localStorage.setItem(
    'psirs.user',
    JSON.stringify({ id: 'u1', fullName: 'Demo Field Agent', role: 'agent' }),
  );
});

afterEach(() => {
  cleanup();
  delete (navigator as unknown as Record<string, unknown>).serviceWorker;
});

/** The worker's message, as `sw.js` actually posts it. */
function workerSays(type: string): void {
  worker.dispatchEvent(Object.assign(new Event('message'), { data: { type } }));
}

describe('the worker reporting that the signal is back', () => {
  it('sends the queue when the worker says to', async () => {
    // Nothing queued at mount, so the connectivity effect does not fire and
    // the only thing that can produce a sync is the message below. Without
    // that, a passing test would prove only that the app syncs on its own.
    vi.mocked(drafts.pendingDrafts).mockResolvedValue([] as never);
    vi.mocked(drafts.syncDrafts).mockResolvedValue({ synced: 1, rejected: 0, duplicates: 0 });

    render(<App />);
    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalled());
    expect(vi.mocked(drafts.syncDrafts)).not.toHaveBeenCalled();

    workerSays('SYNC_DRAFTS');

    await waitFor(() => expect(vi.mocked(drafts.syncDrafts)).toHaveBeenCalledTimes(1));
  });

  it('ignores a message it does not recognise', async () => {
    vi.mocked(drafts.pendingDrafts).mockResolvedValue([] as never);
    vi.mocked(drafts.syncDrafts).mockResolvedValue({ synced: 0, rejected: 0, duplicates: 0 });

    render(<App />);
    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalled());

    workerSays('SOMETHING_ELSE');
    workerSays('');

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(vi.mocked(drafts.syncDrafts)).not.toHaveBeenCalled();
  });

  it('stops listening when the shell goes away', async () => {
    // A listener left behind on every mount is a sync per mount, on a handset
    // that reopens the app all day.
    vi.mocked(drafts.pendingDrafts).mockResolvedValue([] as never);
    vi.mocked(drafts.syncDrafts).mockResolvedValue({ synced: 0, rejected: 0, duplicates: 0 });

    const view = render(<App />);
    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalled());
    view.unmount();

    workerSays('SYNC_DRAFTS');

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(vi.mocked(drafts.syncDrafts)).not.toHaveBeenCalled();
  });
});
