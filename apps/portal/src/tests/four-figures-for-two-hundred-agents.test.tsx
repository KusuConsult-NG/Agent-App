/**
 * "Collected by agents", over the agents it could see.
 *
 * The performance screen sums four figures out of the rows it received:
 * collections, taxpayers onboarded, agents who worked, and open fraud flags.
 * It receives at most 200 rows, because `limit` on `/agents/performance` is
 * `z.coerce.number().int().max(200)` — 200 is the report's ceiling, not this
 * screen's preference, and there is no offset to page past it.
 *
 * So on an agency with more agents than that, every one of those four figures
 * is a subtotal presented as a total, and "{{worked}} of {{total}}" reports
 * 200 as the size of the agency.
 *
 * The ordering is what makes the fraud figure the worst of the four. The
 * report is `ORDER BY SUM(amount_kobo) DESC`, so the agents cut off are the
 * lowest collectors — which is exactly where an idle, absconded or suspect
 * agent sits. The count of open flags, and the banner that names the agents
 * carrying them, both stop at the line most likely to have them below it.
 *
 * The screen cannot recompute any of this: the endpoint answers with a bare
 * array and no count of what it matched. So it says what its figures cover,
 * which is the answer this codebase already gives to the same shape on the
 * arrears and levy worklists.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { PerformanceScreen } from '../screens/Performance';
import * as apiModule from '../lib/api';
import { api } from '../lib/api';
import { translations } from '@psirs/shared';

const en = translations.en as unknown as Record<string, string>;

/** The report's ceiling, and the number this screen asks for. */
const CEILING = 200;

function agents(count: number, options: { flags?: number } = {}) {
  return Array.from({ length: count }, (_, n) => ({
    agent_id: `a-${n}`,
    agent_code: `AG-${String(n).padStart(4, '0')}`,
    full_name: `Agent Number${n}`,
    lga: 'Jos North',
    operational_status: 'ACTIVE',
    successful_transactions: '10',
    failed_transactions: '0',
    reversed_transactions: '0',
    collected_kobo: '100000',
    average_transaction_kobo: '10000',
    taxpayers_onboarded: '3',
    tins_registered: '3',
    vehicle_renewals: '0',
    commission_earned_kobo: '5000',
    open_fraud_flags: n < (options.flags ?? 0) ? '1' : '0',
    active_days: '5',
    categories_processed: '2',
    month_kobo: '100000',
    previous_month_kobo: '100000',
    growth_bp: 0,
  }));
}

/** The sentence the screen should print when the report hit its ceiling. */
const ceilingNotice = (n: number) => en.ofcPfFiguresCoverTopAgents!.replace('{{n}}', String(n));

beforeEach(() => {
  cleanup();
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('figures summed from a report that stopped', () => {
  it('says what they are a total of when the report hit its ceiling', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(agents(CEILING) as never);
    render(<PerformanceScreen navigate={() => {}} />);

    await waitFor(() => expect(screen.getByText('Agent Number0')).toBeTruthy());
    expect(screen.getByText(ceilingNotice(CEILING))).toBeTruthy();
  });

  it('says nothing about it when every agent fitted', async () => {
    /*
     * The control, and the reason the notice carries information. A caveat on
     * every load is a caveat nobody reads — and most agencies, most of the
     * time, fit.
     */
    vi.spyOn(api, 'get').mockResolvedValue(agents(37) as never);
    render(<PerformanceScreen navigate={() => {}} />);

    await waitFor(() => expect(screen.getByText('Agent Number0')).toBeTruthy());
    expect(screen.queryByText(ceilingNotice(37))).toBeNull();
    expect(screen.queryByText(/highest-collecting agents/)).toBeNull();
  });

  it('still draws the figures, which are the point of the screen', async () => {
    // The second control: a caveat must not replace the numbers it qualifies.
    vi.spyOn(api, 'get').mockResolvedValue(agents(CEILING, { flags: 2 }) as never);
    render(<PerformanceScreen navigate={() => {}} />);

    await waitFor(() => expect(screen.getByText('Agent Number0')).toBeTruthy());
    expect(screen.getByText(en.ofcPfCollectedByAgents!)).toBeTruthy();
    // 200 agents × ₦1,000 each.
    expect(screen.getByText(/200,000/)).toBeTruthy();
  });

  it('asks for every row the report will give', async () => {
    /*
     * The notice is triggered by the row count reaching the limit, so a screen
     * that asked for fewer than the ceiling would caveat a list that was not
     * actually truncated — and one that asked for more would be refused
     * outright by the endpoint's `.max(200)`.
     */
    const get = vi.spyOn(api, 'get').mockResolvedValue(agents(CEILING) as never);
    render(<PerformanceScreen navigate={() => {}} />);

    await waitFor(() => expect(screen.getByText('Agent Number0')).toBeTruthy());
    expect(String(get.mock.calls[0]![0])).toContain(`limit=${CEILING}`);
  });
});
