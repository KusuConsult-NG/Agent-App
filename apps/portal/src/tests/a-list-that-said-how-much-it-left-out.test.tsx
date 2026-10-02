/**
 * A capped list on a screen, and whether the screen says it is capped.
 *
 * `deliver` has always computed whether a list hit its cap. It puts `-PARTIAL`
 * into the filename of every file it writes and `complete: false` with the cap
 * into the export log — and for `format: 'json'` it discarded all of it. Its
 * own comment said what that left: "They still draw a capped list without
 * saying so; that is a separate gap on a separate surface and is not closed
 * here."
 *
 * So the export button beside the transactions list has disclosed the cap since
 * `f24a1f6` and the list above it did not — the same query, the same card, the
 * same officer, two different answers to "is this all of it". An officer who
 * exports a list they believe is complete and gets a file marked PARTIAL has no
 * way to tell which of the two lied to them.
 *
 * The endpoints answer `{ rows, truncated, cap }` now. These hold the screen
 * end: that the notice appears with the cap in it when the answer says it was
 * capped, that it does not appear when the answer says it was not, and that a
 * bare array — what a stale build or a cached response still returns — draws
 * the list rather than an error.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { permissionsForRole, translations } from '@psirs/shared';
import { TransactionsScreen } from '../screens/Transactions';
import { AuditScreen } from '../screens/Oversight';
import { api } from '../lib/api';
import { setPortalLanguage } from '../lib/i18n';

const en = translations.en;

const ROW = {
  transaction_reference: 'PSIRS-TX-2026-000901',
  amount_kobo: '4500000',
  status: 'PAID',
  created_at: '2026-09-09T10:00:00Z',
  verified_at: '2026-09-09T10:05:00Z',
  revenue_item: 'Direct Assessment / Self-Assessment',
  revenue_item_ha: null,
  revenue_category: 'Personal Income Tax',
  revenue_category_ha: null,
  lga: 'Jos North',
  agent_code: 'AGT-00042',
  taxpayer_name: 'Ladi Dung',
  tin: null,
  receipt_number: 'RCP-2026-000123',
  gateway_reference: 'RMT-1',
  payment_method: 'CARD',
};

function answering(transactions: unknown) {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.startsWith('/reference/lgas')) return [{ id: 'lga-1', name: 'Jos North' }] as never;
    return transactions as never;
  });
}

function signIn() {
  sessionStorage.setItem(
    'psirs.portal.user',
    JSON.stringify({
      id: 'u1',
      phone: '+2348000000002',
      fullName: 'Revenue Officer',
      role: 'revenue_officer',
      permissions: permissionsForRole('revenue_officer'),
    }),
  );
}

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  signIn();
  setPortalLanguage('en');
});

afterEach(() => cleanup());

describe('a transactions list that stopped at its cap', () => {
  it('says so, with the number to narrow against', async () => {
    answering({ rows: [ROW], truncated: true, cap: 200 });
    render(<TransactionsScreen />);

    const expected = en.ofcListStoppedAtCap.replace('{{n}}', '200');
    await waitFor(() => expect(screen.getByText(expected)).toBeTruthy());
    // And the rows are still drawn: the notice is beside the list, not instead
    // of it.
    expect(screen.getByText('PSIRS-TX-2026-000901')).toBeTruthy();
  });

  it('says nothing when the list is all of it', async () => {
    answering({ rows: [ROW], truncated: false, cap: null });
    render(<TransactionsScreen />);

    await waitFor(() => expect(screen.getByText('PSIRS-TX-2026-000901')).toBeTruthy());
    expect(screen.queryByText(/stopped at/i)).toBeNull();
  });

  /*
   * A bare array still draws a list.
   *
   * It is what the endpoint used to answer and what a cached response or a
   * front end running against an older API still gets. Turning that into an
   * error would replace a list missing one sentence with no list at all, which
   * is a worse screen than the one being fixed.
   */
  it('still draws a list when handed the old shape', async () => {
    answering([ROW]);
    render(<TransactionsScreen />);

    await waitFor(() => expect(screen.getByText('PSIRS-TX-2026-000901')).toBeTruthy());
    expect(screen.queryByText(/stopped at/i)).toBeNull();
  });

  /*
   * And `truncated: true` with no cap is still a disclosure worth nothing, so
   * it draws nothing rather than "stopped at null rows".
   *
   * The server never sends that combination — `cap` is the limit whenever
   * `truncated` is true — but a sentence with a hole in it is the failure this
   * branch has already fixed twice in other places, and it costs one condition
   * to make unreachable here.
   */
  it('does not print a sentence with a hole in it', async () => {
    answering({ rows: [ROW], truncated: true, cap: null });
    render(<TransactionsScreen />);

    await waitFor(() => expect(screen.getByText('PSIRS-TX-2026-000901')).toBeTruthy());
    /*
     * The notice is absent, asserted as absent rather than by looking for the
     * particular wrong texts it might have printed.
     *
     * The first version checked for `{{n}}` and for "stopped at null", and a
     * mutation that substituted `0` instead of `null` passed it — the notice
     * appeared saying the list stopped at zero rows, which is a false statement
     * about a list with a row in it. Matching the stem of the sentence catches
     * every value it could have been filled with.
     */
    expect(screen.queryByText(/stopped at/i)).toBeNull();
  });
});

/*
 * The same fact on the audit screen, which has three capped lists of its own.
 *
 * The entry list is capped by `limit` through `deliver`, like the transactions
 * list. The six standard questions are different: three of them are capped in
 * their own SQL — 500 entries of who has touched a taxpayer's record, 500
 * searches of the register, 1000 receipts for one revenue item — and three are
 * not capped at all, which is why the screen takes either shape rather than
 * assuming the new one.
 */
describe('the audit screen', () => {
  const ENTRY = {
    id: 'a-1',
    created_at: '2026-09-30T09:00:00Z',
    action: 'taxpayer.registered',
    entity_type: 'taxpayer',
    entity_id: 'tp-1',
    result: 'SUCCESS',
    actor_name: 'Musa Danladi',
    actor_role: 'revenue_officer',
  };

  function answeringAudit(entries: unknown) {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.includes('/government/workers'))
        return { jobs: [], healthy: true, needingAttention: 0 } as never;
      if (path.includes('/government/audit?')) return entries as never;
      return [] as never;
    });
  }

  it('says when the entry list stopped at its cap', async () => {
    answeringAudit({ rows: [ENTRY], truncated: true, cap: 150 });
    render(<AuditScreen />);

    const expected = en.ofcListStoppedAtCap.replace('{{n}}', '150');
    await waitFor(() => expect(screen.getByText(expected)).toBeTruthy());
  });

  it('says nothing when the entry list holds everything asked for', async () => {
    answeringAudit({ rows: [ENTRY], truncated: false, cap: null });
    render(<AuditScreen />);

    await waitFor(() => expect(screen.getByText(en.ofcOvUnattendedWork)).toBeTruthy());
    expect(screen.queryByText(/stopped at/i)).toBeNull();
  });

  it('still draws the entry list when handed the old shape', async () => {
    answeringAudit([ENTRY]);
    render(<AuditScreen />);

    await waitFor(() => expect(screen.getByText(en.ofcOvUnattendedWork)).toBeTruthy());
    expect(screen.queryByText(/stopped at/i)).toBeNull();
  });
});
