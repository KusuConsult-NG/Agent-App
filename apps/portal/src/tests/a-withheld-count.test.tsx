/**
 * A usage count the API withheld, on the screen.
 *
 * The usage reports now withhold a count between one and the minimum group
 * size (null), so that one agent's afternoon cannot be read off them
 * (`a-count-of-one` in the API). The table already draws a null cell as a
 * dash. The two places that do arithmetic with a count did not know: the
 * completion rate read a withheld completion as nought and said "0%", and the
 * stat hint said "null started".
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { translations, USAGE_MIN_GROUP_SIZE } from '@psirs/shared';
import { UsageScreen } from '../screens/Usage';
import * as apiModule from '../lib/api';

const en = translations.en;

const OVERVIEW = {
  funnels: [
    {
      event: 'taxpayer.registration',
      started: '12',
      completed: null,
      abandoned: '0',
      failed: null,
      median_completion_ms: null,
    },
    {
      event: 'collection',
      started: null,
      completed: null,
      abandoned: '0',
      failed: '0',
      median_completion_ms: null,
    },
  ],
  abandonment: [],
  offline: [],
  language: [],
  reach: [{ lga: 'Barkin Ladi', zone: 'Plateau North', started: null, completed: null, events: '10' }],
  screens: [],
};

beforeEach(() => {
  cleanup();
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
  vi.spyOn(apiModule.api, 'get').mockResolvedValue(OVERVIEW as never);
});
afterEach(() => vi.restoreAllMocks());

describe('a withheld usage count', () => {
  it('is never read as nought, and never printed as null', async () => {
    render(<UsageScreen />);
    await waitFor(() => expect(screen.getByText('Barkin Ladi')).toBeTruthy());

    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/\b0%/);
    expect(text).not.toMatch(/null/);
  });

  it('says how many started where it may, and that it was fewer than the minimum where not', async () => {
    render(<UsageScreen />);
    await waitFor(() => expect(screen.getByText('Barkin Ladi')).toBeTruthy());

    expect(screen.getByText(en.ofcUsStartedCount.replace('{{n}}', '12'))).toBeTruthy();
    expect(
      screen.getByText(en.ofcUsStartedCount.replace('{{n}}', `<${USAGE_MIN_GROUP_SIZE}`)),
    ).toBeTruthy();
  });
});
