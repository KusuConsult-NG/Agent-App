/**
 * "Nothing is waiting to be sent", from a device that could not be asked.
 *
 * The profile screen lists the captures saved on the phone while offline —
 * the one thing on it that cannot be recovered from the server. It started
 * as an empty list and was read with `listDrafts().then(setDrafts)`, with no
 * catch at all, so a store that could not be read left the list empty and the
 * card said "Nothing is waiting to be sent."
 *
 * An unreadable store is exactly the case in which offline captures may not
 * be saving either. Telling the agent nothing is pending gives them no reason
 * to hand the device back carefully, keep its data, or report it.
 *
 * Signing out does not clear the queue — `logout` leaves IndexedDB alone, and
 * `a-queue-that-outlived-its-agent` holds that — so the cost was the false
 * assurance rather than lost work. These cases pin the difference between the
 * three answers the card can give: still reading, could not read, and
 * genuinely empty.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { ProfileScreen } from '../screens/More';
import * as drafts from '../lib/drafts';
import { bluetoothPrinter } from '../lib/bluetooth-printer';
import { setAppLanguage } from '../lib/i18n';

vi.mock('../lib/drafts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/drafts')>()),
  listDrafts: vi.fn(),
}));

const en = translations.en;

beforeEach(() => {
  cleanup();
  setAppLanguage('en');
  vi.spyOn(bluetoothPrinter, 'subscribe').mockReturnValue(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the saved records on this device', () => {
  it('says they could not be read, rather than that nothing is waiting', async () => {
    vi.mocked(drafts.listDrafts).mockRejectedValue(new Error('IndexedDB unavailable'));
    render(<ProfileScreen onSignOut={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(en.moreSavedRecordsUnreadable)).toBeTruthy();
    });
    expect(screen.getByText(en.moreSavedRecordsUnreadableBody)).toBeTruthy();
    expect(
      screen.queryByText(en.moreNothingWaiting),
      'an unreadable store told the agent nothing was waiting',
    ).toBeNull();
  });

  it('does not say nothing is waiting before it has asked', () => {
    // A read that never settles. The card must not answer a question it has
    // not finished asking.
    vi.mocked(drafts.listDrafts).mockReturnValue(new Promise(() => {}));
    render(<ProfileScreen onSignOut={() => {}} />);

    expect(screen.queryByText(en.moreNothingWaiting)).toBeNull();
    expect(screen.queryByText(en.moreSavedRecordsUnreadable)).toBeNull();
  });

  it('says nothing is waiting when nothing genuinely is', async () => {
    // The bound. An empty queue that has been read is the true answer.
    vi.mocked(drafts.listDrafts).mockResolvedValue([]);
    render(<ProfileScreen onSignOut={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(en.moreNothingWaiting)).toBeTruthy();
    });
    expect(screen.queryByText(en.moreSavedRecordsUnreadable)).toBeNull();
  });
});
