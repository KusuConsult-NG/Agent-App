/**
 * "Overdue: 31", on a queue holding thirty-five.
 *
 * The case workbench shows four figures above its table — cases, overdue,
 * urgent, nobody-yet — and counted all four in this component over the rows
 * it had. `/government/cases` answers with a hundred.
 *
 * Measured against the API on a 140-case open queue (5 urgent, 20 high, 100
 * normal, 15 low, every fourth overdue, every fifth unassigned):
 *
 *   the whole queue   140 cases, 35 overdue, 5 urgent, 28 unassigned
 *   the first 100     100 cases, 31 overdue, 5 urgent, 20 unassigned
 *
 * Three of the four wrong, and every one of them understating, so the queue
 * read as more under control than it was. The tile wearing the alert variant,
 * overdue, is one of the three.
 *
 * `urgent` was exact — URGENT sorts first and five fit on a page — which is
 * the ordering protecting a figure by accident. It comes from the server now
 * with the rest, because nothing announces when such an accident ends.
 *
 * What these cases pin is that the component prints the server's figures
 * rather than its own sums, that it says when the table stopped short, and
 * that it still falls back to counting the page rather than to a nought when
 * an older API answers with a bare array — a zero under "Overdue" from a read
 * that did not happen is the one reading an officer must never be given.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { CasesScreen } from '../screens/Cases';
import * as apiModule from '../lib/api';
import { getTranslation, permissionsForRole, translations, type Role } from '@psirs/shared';
import { setPortalLanguage } from '../lib/i18n';

const en = translations.en as unknown as Record<string, string>;

const user = (role: Role = 'admin') =>
  ({
    id: 'u1',
    phone: '+2348000000001',
    fullName: 'Admin Dung',
    email: null,
    role,
    permissions: permissionsForRole(role),
  }) as never;

function caseRow(n: number, over: Record<string, unknown> = {}) {
  return {
    id: `cc-${n}`,
    case_number: `CASE-2026-${String(n).padStart(6, '0')}`,
    subject: `Dispute ${n}`,
    category: 'TAXPAYER_DISPUTE',
    status: 'OPEN',
    priority: 'NORMAL',
    risk_level: 'MEDIUM',
    department: 'admin',
    due_at: '2026-12-01T09:00:00.000Z',
    created_at: '2026-09-01T09:00:00.000Z',
    updated_at: '2026-09-01T09:00:00.000Z',
    overdue: false,
    assignee_name: 'Officer Ngo',
    opened_by_name: 'Revenue Ladi',
    transaction_reference: null,
    transaction_id: null,
    agent_id: null,
    agent_code: null,
    taxpayer_id: null,
    taxpayer_name: null,
    comment_count: '0',
    evidence_count: '0',
    ...over,
  };
}

/** What `/government/cases` answers. Everything else gets an empty shape. */
let casesBody: unknown = { cases: [], matched: 0, overdue: 0, urgent: 0, unassigned: 0, cap: 100 };

beforeEach(() => {
  cleanup();
  setPortalLanguage('en');
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
  vi.spyOn(apiModule.api, 'get').mockImplementation((async (path: string) => {
    if (path.startsWith('/government/cases?')) return casesBody;
    if (path.startsWith('/government/my-work')) {
      return { counts: {}, assigned: [], opened: [], mentions: [], unassigned: [], approvals: [], exceptions: [], flags: [] };
    }
    return [];
  }) as never);
});

afterEach(() => {
  setPortalLanguage('en');
  vi.restoreAllMocks();
});

const show = () =>
  render(<CasesScreen user={user()} route="/cases" navigate={vi.fn()} />);

/**
 * The figure in the tile under a given label.
 *
 * Scoped to `.stat__label` inside the grid rather than looked up by text
 * anywhere on the page: "Case" is both a tile label and a column heading in
 * the table below it, so `getByText` finds two and throws. Reading the whole
 * tile's text would be worse than throwing — it would match "140" inside
 * "1400" and pass.
 */
function statValue(label: string): string {
  expect(label, 'the label this helper looks for').toBeTruthy();
  const tiles = Array.from(document.querySelectorAll('.stat'));
  const tile = tiles.find(
    (node) => node.querySelector('.stat__label')?.textContent?.trim() === label,
  );
  expect(tile, `no stat tile labelled "${label}"`).toBeTruthy();
  return tile!.querySelector('.stat__value')?.textContent?.trim() ?? '';
}

describe('the figures above a capped case table', () => {
  it('say what the queue holds, not what fitted on the page', async () => {
    casesBody = {
      cases: Array.from({ length: 100 }, (_, i) => caseRow(i)),
      matched: 140,
      overdue: 35,
      urgent: 5,
      unassigned: 28,
      cap: 100,
    };
    show();

    await waitFor(() => {
      expect(statValue(en.ofcCwCaseNumber)).toBe('140');
    });
    // The page holds none overdue and none unassigned of its own, so these
    // could only come from the server.
    expect(statValue(en.ofcMwOverdue)).toBe('35');
    expect(statValue(en.ofcCwNobody)).toBe('28');
    expect(statValue(en.ofcCwPriority)).toBe('5');
  });

  it('say that the table stopped short, and where', async () => {
    casesBody = {
      cases: Array.from({ length: 100 }, (_, i) => caseRow(i)),
      matched: 140,
      overdue: 35,
      urgent: 5,
      unassigned: 28,
      cap: 100,
    };
    show();

    await waitFor(() => {
      expect(screen.getByText(en.ofcCwTableStopsShort)).toBeTruthy();
    });
    expect(
      screen.getByText(
        en.ofcCwTableStopsShortBody.replace('{{shown}}', '100').replace('{{matched}}', '140'),
      ),
    ).toBeTruthy();
  });

  it('stay quiet about caps when the table holds the whole queue', async () => {
    // The bound. A notice drawn on every load would pass the case above and
    // tell every officer their complete queue is partial.
    casesBody = {
      cases: [caseRow(1), caseRow(2)],
      matched: 2,
      overdue: 0,
      urgent: 0,
      unassigned: 0,
      cap: 100,
    };
    show();

    await waitFor(() => {
      expect(statValue(en.ofcCwCaseNumber)).toBe('2');
    });
    expect(screen.queryByText(en.ofcCwTableStopsShort)).toBeNull();
  });

  it('count the page when an older API answers with a bare array', async () => {
    // Not a nought. This endpoint returned an array until the counts moved to
    // the server, and a screen that read only the envelope would show an
    // empty queue against the other shape.
    casesBody = [
      caseRow(1, { overdue: true, assignee_name: null }),
      caseRow(2, { priority: 'URGENT' }),
      caseRow(3),
    ];
    show();

    await waitFor(() => {
      expect(statValue(en.ofcCwCaseNumber)).toBe('3');
    });
    expect(statValue(en.ofcMwOverdue)).toBe('1');
    expect(statValue(en.ofcCwPriority)).toBe('1');
    expect(statValue(en.ofcCwNobody)).toBe('1');
    expect(screen.queryByText(en.ofcCwTableStopsShort)).toBeNull();
  });

  it('show a dash rather than a nought when the read was refused', async () => {
    vi.spyOn(apiModule.api, 'get').mockRejectedValue(new Error('network'));
    show();

    await waitFor(() => {
      expect(statValue(en.ofcMwOverdue)).toBe('—');
    });
    expect(statValue(en.ofcCwCaseNumber)).toBe('—');
    expect(statValue(en.ofcCwNobody)).toBe('—');
  });
});
