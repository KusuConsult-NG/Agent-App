/**
 * A receipt an agent taps for, with somebody waiting for it.
 *
 * `ReceiptsScreen` lists what an agent has collected and opens the document
 * when one is tapped. That request sat in an async handler with no catch, so
 * a lost signal, an expired session or a storage outage produced no error, no
 * spinner and no change at all. The agent taps again. And again. The person
 * in front of them is waiting for the piece of paper that proves they paid.
 *
 * The screen also used to replace itself with the error when the LIST failed —
 * `if (error) return <ErrorAlert />` — which is the wrong trade twice over: a
 * receipt that would not open is not a reason to take away the ones that
 * would, and the heading explaining what the screen is went with it.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ReceiptsScreen } from '../screens/More';
import { ApiRequestError, api } from '../lib/api';

const RECEIPT = {
  id: 'r-1',
  receipt_number: 'RCT-2026-000042',
  taxpayer_name: 'Ladi Dung',
  revenue_item: 'Direct Assessment',
  revenue_item_ha: null,
  amount_kobo: '4500000',
  issued_at: '2026-09-10T09:00:00Z',
};

const REFUSED = new ApiRequestError(503, {
  code: 'STORAGE_UNAVAILABLE',
  message: 'The receipt could not be fetched just now.',
  moneyStatus: 'NOT_APPLICABLE',
});

beforeEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.stubGlobal('open', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('tapping a receipt that will not open', () => {
  it('says why, rather than doing nothing at all', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/receipts') return [RECEIPT] as never;
      throw REFUSED;
    });

    render(<ReceiptsScreen />);
    fireEvent.click(await screen.findByText('RCT-2026-000042'));

    await waitFor(() =>
      expect(screen.getByText(/receipt could not be fetched just now/i)).toBeTruthy(),
    );
  });

  it('leaves the other receipts where they were', async () => {
    // The list is the agent's record of what they have collected. One
    // document failing to open is not a reason to lose it.
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/receipts') return [RECEIPT] as never;
      throw REFUSED;
    });

    render(<ReceiptsScreen />);
    fireEvent.click(await screen.findByText('RCT-2026-000042'));

    await waitFor(() =>
      expect(screen.getByText(/receipt could not be fetched just now/i)).toBeTruthy(),
    );
    expect(screen.getByText('RCT-2026-000042')).toBeTruthy();
  });

  it('opens the document when it can', async () => {
    const opened = vi.fn();
    vi.stubGlobal('open', opened);
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/receipts') return [RECEIPT] as never;
      return { downloadUrl: 'https://psirs.example/receipt.pdf' } as never;
    });

    render(<ReceiptsScreen />);
    fireEvent.click(await screen.findByText('RCT-2026-000042'));

    await waitFor(() =>
      expect(opened).toHaveBeenCalledWith('https://psirs.example/receipt.pdf', '_blank', 'noopener'),
    );
  });
});

describe('a list of receipts that could not be read', () => {
  it('says why and keeps the heading that explains the screen', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(REFUSED);
    render(<ReceiptsScreen />);

    await waitFor(() =>
      expect(screen.getByText(/receipt could not be fetched just now/i)).toBeTruthy(),
    );
    expect(screen.getByText(/Receipts you facilitated/i)).toBeTruthy();
  });

  it('still says so when there genuinely are none', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([] as never);
    render(<ReceiptsScreen />);

    await waitFor(() => expect(screen.getByText(/No receipts yet/i)).toBeTruthy());
  });
});
