/**
 * The answer to "who has looked at this record", in the reader's language.
 *
 * Migration 083 gave the platform a record of who opened a taxpayer's data,
 * and the audit query returns those rows beside the changes. Each row carries
 * two states: whether it is a reading or a change, and — on a reading — which
 * of the four things the officer was shown.
 *
 * The oversight table builds its columns from whatever the query returned and
 * renders each cell with `String(...)`, which is right for a receipt number and
 * wrong for a state. So the first version of this shipped a Hausa auditor the
 * words `READ` and `PAYMENT_HISTORY`, in a platform that holds every other
 * state in `ENUM_LABELS` precisely so that cannot happen. `every-state-has-a-
 * name.test.ts` caught the missing dictionary entries at the database end; it
 * cannot see whether the screen uses them, which is what this does.
 *
 * Only `kind` and `action` go through the dictionary, and that is also tested:
 * `enumLabel` lowercases a value it does not know, and the other four audit
 * answers' columns hold receipt numbers, transaction references and agent
 * codes. Lowercasing a receipt number on an audit screen would be a worse bug
 * than the one being fixed.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { AuditScreen } from '../screens/Oversight';
import * as api from '../lib/api';
import { setPortalLanguage } from '../lib/i18n';

const ha = translations.ha;

const ACCESS_ANSWER = [
  {
    kind: 'READ',
    created_at: '2026-09-30T11:02:00.000Z',
    action: 'PAYMENT_HISTORY',
    result: 'SUCCESS',
    full_name: 'Binta Sule',
    role: 'finance_officer',
    ip_address: '10.0.0.4',
    device_id: null,
  },
  {
    kind: 'CHANGE',
    created_at: '2026-09-02T08:00:00.000Z',
    action: 'taxpayer.status_changed',
    result: 'SUCCESS',
    full_name: 'Musa Danladi',
    role: 'revenue_officer',
    ip_address: '10.0.0.9',
    device_id: null,
  },
];

const RECEIPTS_ANSWER = [
  {
    receipt_number: 'PSIRS/RCT/2026/0001ABC',
    amount_kobo: '500000',
    issued_at: '2026-09-01T10:00:00.000Z',
    status: 'ISSUED',
    transaction_reference: 'TXN/2026/ABCD99',
    lga: 'Jos North',
    agent_code: 'AG-JN-0042',
  },
];

function answering(answers: Record<string, unknown>) {
  vi.spyOn(api.api, 'get').mockImplementation((path: string) => {
    if (path.includes('/government/workers'))
      return Promise.resolve({ jobs: [], healthy: true, needingAttention: 0 } as never);
    for (const [fragment, answer] of Object.entries(answers)) {
      if (path.includes(fragment)) return Promise.resolve(answer as never);
    }
    return Promise.resolve([] as never);
  });
}

async function renderSettled() {
  render(<AuditScreen />);
  await screen.findByText(ha.ofcOvUnattendedWork);
}

/** Open the taxpayer-access question, pick the one taxpayer, and run it. */
async function runTaxpayerAccess() {
  fireEvent.click(await screen.findByRole('button', { name: ha.ofcOvWhoLookedAtRecord }));
  fireEvent.change(await screen.findByLabelText(ha.ofcOvFindTheTaxpayer), {
    target: { value: 'Danjuma' },
  });
  fireEvent.click(await screen.findByRole('button', { name: ha.search }));
  const select = (await screen.findByLabelText(ha.ofcOvWhichTaxpayer)) as HTMLSelectElement;
  await waitFor(() => expect(select.options.length).toBeGreaterThan(1));
  fireEvent.change(select, { target: { value: 'tp-1' } });
  fireEvent.click(await screen.findByRole('button', { name: ha.ofcOvRunThisQuery }));
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  setPortalLanguage('ha');
});

afterEach(() => {
  cleanup();
  setPortalLanguage('en');
});

describe('what the audit answer says, in Hausa', () => {
  it('names the kind of entry and what was shown, out of the dictionary', async () => {
    answering({
      '/taxpayers/search': [{ id: 'tp-1', first_name: 'Danjuma', last_name: 'Audu', phone: '+2348030000001' }],
      '/audit/queries/taxpayer-access': ACCESS_ANSWER,
    });

    await renderSettled();
    await runTaxpayerAccess();

    await waitFor(() => expect(screen.getByText(ha.enumPaymentHistory)).toBeTruthy());
    expect(screen.getByText(ha.enumRead)).toBeTruthy();
    expect(screen.getByText(ha.enumChange)).toBeTruthy();

    // And not the tokens the database holds.
    expect(screen.queryByText('PAYMENT_HISTORY')).toBeNull();
    expect(screen.queryByText('READ')).toBeNull();
    expect(screen.queryByText('CHANGE')).toBeNull();
  });

  /*
   * A change's action is not a state, and must survive byte for byte.
   *
   * `taxpayer.status_changed` has no dictionary key and never will — there are
   * hundreds of audit actions and they are identifiers. The first version of
   * this change called `enumLabel` on every value in the column, and its
   * fallback takes the underscores out and lowercases, so the identifier was
   * rendered "taxpayer.status changed" — not translated, just damaged, and
   * no longer matching anything an auditor could search the log for. This
   * test is what found that.
   */
  it('leaves an audit action byte for byte as it is', async () => {
    answering({
      '/taxpayers/search': [{ id: 'tp-1', first_name: 'Danjuma', last_name: 'Audu', phone: '+2348030000001' }],
      '/audit/queries/taxpayer-access': ACCESS_ANSWER,
    });

    await renderSettled();
    await runTaxpayerAccess();

    await waitFor(() => expect(screen.getByText('taxpayer.status_changed')).toBeTruthy());
  });

  /*
   * The reason the dictionary is applied to two columns and not to every cell.
   */
  it('does not lowercase a receipt number in another answer', async () => {
    answering({
      '/revenue/items': [{ code: 'SHOPS-KIOSKS', name: 'Shops and kiosks' }],
      '/audit/queries/receipts-by-item': RECEIPTS_ANSWER,
    });

    await renderSettled();
    fireEvent.click(await screen.findByRole('button', { name: ha.ofcOvReceiptsOneItem }));
    const select = (await screen.findByLabelText(ha.ofcOvWhichRevenueItem)) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBeGreaterThan(1));
    fireEvent.change(select, { target: { value: 'SHOPS-KIOSKS' } });
    fireEvent.click(await screen.findByRole('button', { name: ha.ofcOvRunThisQuery }));

    await waitFor(() => expect(screen.getByText('PSIRS/RCT/2026/0001ABC')).toBeTruthy());
    expect(screen.queryByText('psirs/rct/2026/0001abc')).toBeNull();
    expect(screen.getByText('TXN/2026/ABCD99')).toBeTruthy();
    expect(screen.getByText('AG-JN-0042')).toBeTruthy();
  });
});
