/**
 * Changing an officer's supervisor used to clear their department.
 *
 * `repost` is careful about this. Every column is guarded with a
 * `CASE WHEN $n::boolean`, so a field the request does not name is left
 * exactly as it was, and a field named as null is cleared. Two different
 * things, deliberately kept apart, because "she moved to Finance" and "she
 * has no department at the moment" are different facts.
 *
 * This form defeated it. It starts empty — it is never filled from the
 * officer's current posting — and it sent every key on every submit as
 * `value || null`. So an administrator who opened it to name a new
 * supervisor also sent `departmentId: null`, `revenueOfficeId: null`,
 * `jobTitle: null` and `staffNumber: null`. Each fired its CASE and cleared
 * the column.
 *
 * The screen then said "Saved", and the posting history — which this screen
 * shows, and which the database keeps append-only because it is evidence in
 * revenue disputes — recorded four dated transfers nobody asked for,
 * including the officer being removed from their department.
 *
 * What this holds is the request: a part not named is not sent.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { PostingPanel } from '../screens/Organisation';
import * as apiModule from '../lib/api';
import { setPortalLanguage } from '../lib/i18n';

const en = translations.en as unknown as Record<string, string>;

// `status` is load-bearing: the selects render only ACTIVE rows, so a
// fixture without it offers nothing to choose.
const DEPARTMENTS = [
  { id: 'dept-1', name: 'Assessment', name_ha: null, function: 'ASSESSMENT', status: 'ACTIVE' },
];
const OFFICES = [{ id: 'off-1', name: 'Jos North', name_ha: null, status: 'ACTIVE' }];
const OFFICERS = [
  { id: 'u-9', full_name: 'Musa Bello', role: 'supervisor' },
  { id: 'u-8', full_name: 'Amina Danladi', role: 'admin' },
];

/** What the panel posted, so the test can say what it did not send. */
let posted: { path: string; body: Record<string, unknown> } | null = null;

beforeEach(() => {
  cleanup();
  setPortalLanguage('en');
  posted = null;
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
  vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) => {
    if (path.includes('/departments')) return DEPARTMENTS as never;
    if (path.includes('/offices')) return OFFICES as never;
    if (path.includes('/users')) return OFFICERS as never;
    return [] as never;
  });
  vi.spyOn(apiModule.api, 'post').mockImplementation(async (path: string, body?: unknown) => {
    posted = { path, body: body as Record<string, unknown> };
    return { transfers: 1 } as never;
  });
});

afterEach(() => {
  setPortalLanguage('en');
  vi.restoreAllMocks();
});

/** Name one part, give a reason, and press the button. */
async function moveTheOfficer(fill: () => void): Promise<void> {
  render(<PostingPanel officerId="u-1" />);
  await screen.findByText(en.ofcOrPosting);
  fill();
  fireEvent.change(screen.getByLabelText(en.ofcOrWhyMoving), {
    target: { value: 'Reassigned at the start of the quarter.' },
  });
  fireEvent.click(screen.getByText(en.ofcOrMoveOfficer));
  await waitFor(() => expect(posted).not.toBeNull());
}

describe('moving one thing moves one thing', () => {
  /**
   * The whole finding, in one assertion.
   *
   * A department the administrator never touched must not appear in the
   * request at all — not as null, which is an instruction to clear it.
   */
  it('does not send a department the administrator did not name', async () => {
    await moveTheOfficer(() => {
      fireEvent.change(screen.getByLabelText(en.ofcOrSupervisor), { target: { value: 'u-9' } });
    });

    expect(posted!.body).toHaveProperty('supervisorId', 'u-9');
    expect(posted!.body).not.toHaveProperty('departmentId');
    expect(posted!.body).not.toHaveProperty('revenueOfficeId');
    expect(posted!.body).not.toHaveProperty('jobTitle');
    expect(posted!.body).not.toHaveProperty('staffNumber');
  });

  it('sends a job title on its own without touching the reporting line', async () => {
    await moveTheOfficer(() => {
      fireEvent.change(screen.getByLabelText(en.ofcOrJobTitle), {
        target: { value: 'Chief Finance Officer' },
      });
    });

    expect(posted!.body).toHaveProperty('jobTitle', 'Chief Finance Officer');
    expect(posted!.body).not.toHaveProperty('supervisorId');
    expect(posted!.body).not.toHaveProperty('departmentId');
  });

  /**
   * And naming several still moves several.
   *
   * The fix must not turn the panel into a one-field-at-a-time control: a
   * real posting moves a department, an office and a reporting line together,
   * and the API records each as its own dated transfer.
   */
  it('sends every part the administrator did name', async () => {
    await moveTheOfficer(() => {
      fireEvent.change(screen.getByLabelText(en.ofcOrDepartment), { target: { value: 'dept-1' } });
      fireEvent.change(screen.getByLabelText(en.ofcOrSupervisor), { target: { value: 'u-9' } });
      fireEvent.change(screen.getByLabelText(en.ofcOrJobTitle), {
        target: { value: 'Principal Officer' },
      });
    });

    expect(posted!.body).toMatchObject({
      departmentId: 'dept-1',
      supervisorId: 'u-9',
      jobTitle: 'Principal Officer',
    });
    expect(posted!.body).not.toHaveProperty('revenueOfficeId');
  });

  it('always sends the reason, which is the record of why', async () => {
    await moveTheOfficer(() => {
      fireEvent.change(screen.getByLabelText(en.ofcOrSupervisor), { target: { value: 'u-9' } });
    });
    expect(posted!.body.reason).toBe('Reassigned at the start of the quarter.');
  });
});
