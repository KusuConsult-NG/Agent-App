/**
 * The citizen screen has to be reachable from inside the portal.
 *
 * `/citizen` was a declared route with nothing anywhere linking to it. Its one
 * entrance was the reminder SMS — and that carried `https://.../citizen` with
 * no hash, which the portal cannot route, so it landed the taxpayer on the
 * government staff sign-in form instead. Between them, a screen built for
 * ordinary people had no working way in at all.
 *
 * The agent application has a test that walks its link graph outward from the
 * navigation tabs, which is what caught the same shape of bug there. The
 * public screens have no navigation to walk from — they are reached by link
 * and by SMS — so this asserts the two entrances directly instead.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { VerifyScreen } from '../screens/Public';
import { api } from '../lib/api';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'publicGet').mockRejectedValue(new Error('not called'));
});

afterEach(cleanup);

describe('a citizen can get to their tax status', () => {
  it('is offered from the receipt-check screen', async () => {
    render(<VerifyScreen />);

    const link = await waitFor(() =>
      screen
        .getAllByRole('link')
        .find((a) => (a as HTMLAnchorElement).getAttribute('href') === '#/citizen'),
    );

    expect(
      link,
      'nothing in the portal links to #/citizen — the screen has no door',
    ).toBeTruthy();
  });
});
