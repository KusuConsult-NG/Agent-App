/**
 * "Register paying" in a territory view.
 *
 * The API now reports a territory view's register and share paying as
 * unknown (null), because nothing records which registered taxpayers belong
 * to a territory (`a-share-of-the-wrong-register` in the API). The column
 * already drew null as a dash, but a column of dashes reads as "nothing to
 * show"; the screen says why there is nothing, and only where that is why.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { IntelligenceScreen } from '../screens/Dashboard';
import { api } from '../lib/api';

const en = translations.en;

const row = (registered: string | null, compliance: number | null) => ({
  level: 'Jos North',
  level_id: 'lga-1',
  level_type: 'LGA',
  zone: 'Plateau North',
  taxpayers: '1',
  transactions: '1',
  amount_kobo: '100000',
  previous_amount_kobo: '0',
  average_kobo: '100000',
  registered_taxpayers: registered,
  growth_bp: null,
  compliance_bp: compliance,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('register paying', () => {
  it('says why it is not shown in a territory view', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([row(null, null)] as never);
    render(<IntelligenceScreen />);
    expect(await screen.findByText(en.ofcRvComplianceTerritory)).toBeTruthy();
  });

  it('says nothing of the kind where the share is shown', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([row('4', 2_500)] as never);
    render(<IntelligenceScreen />);
    expect(await screen.findByText('25%')).toBeTruthy();
    expect(screen.queryByText(en.ofcRvComplianceTerritory)).toBeNull();
  });
});
