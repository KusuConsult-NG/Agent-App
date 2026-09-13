/**
 * The register of who can sign in, and the sentence it produced when it could
 * not be read.
 *
 * `UserAccessScreen` caught a refused read with `setUsers([])`, and an empty
 * table prints "No officers are recorded."
 *
 * That is the screen an administrator opens to answer one of two questions:
 * who has access to this platform, and does somebody who left last month
 * still have it. Both are answered by the list. A failed request turned the
 * second answer into "nobody has access at all" — which is reassuring, wrong,
 * and indistinguishable from the truth.
 *
 * The refusal was set on the same `error` the role and account actions use, so
 * it did appear at the top of the screen. Two statements, and the false one
 * sits in the table the administrator came to read.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { UserAccessScreen } from '../screens/UserAccess';
import * as apiModule from '../lib/api';
import { ApiRequestError } from '../lib/api';
import { setPortalLanguage } from '../lib/i18n';

const USER = { id: 'u-1', phone: '+2348000000001', fullName: 'Ladi Dung', role: 'admin' };

const OFFICER = {
  id: 'u-2',
  full_name: 'Musa Bello',
  phone: '+2348000000002',
  role: 'revenue_officer',
  status: 'ACTIVE',
  last_login_at: '2026-09-09T09:00:00.000Z',
  isSelf: false,
};

const REFUSED = new ApiRequestError(503, {
  code: 'UPSTREAM_UNAVAILABLE',
  message: 'The user register could not be read.',
  moneyStatus: 'NOT_APPLICABLE',
});

beforeEach(() => {
  cleanup();
  setPortalLanguage('en');
  vi.restoreAllMocks();
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a register that could not be read', () => {
  it('does not answer "no officers are recorded"', async () => {
    vi.spyOn(apiModule.api, 'get').mockRejectedValue(REFUSED);
    render(<UserAccessScreen user={USER as never} />);

    await waitFor(() => expect(screen.getByText(/user register could not be read/i)).toBeTruthy());
    expect(screen.queryByText(/No officers are recorded/i)).toBeNull();
  });

  it('offers a way to ask again, and shows the register when it answers', async () => {
    const get = vi
      .spyOn(apiModule.api, 'get')
      .mockRejectedValueOnce(REFUSED)
      .mockResolvedValue({ users: [OFFICER] } as never);
    render(<UserAccessScreen user={USER as never} />);

    fireEvent.click(await screen.findByRole('button', { name: /Try again/i }));

    await waitFor(() => expect(screen.getByText('Musa Bello')).toBeTruthy());
    expect(get.mock.calls.filter(([path]) => String(path).includes('/users')).length).toBe(2);
  });
});

describe('a register that answered', () => {
  /*
   * The control. An empty register is a real state — a fresh deployment before
   * anybody is invited — and saying so is right.
   */
  it('says nobody is recorded when nobody is', async () => {
    vi.spyOn(apiModule.api, 'get').mockResolvedValue({ users: [] } as never);
    render(<UserAccessScreen user={USER as never} />);

    await waitFor(() => expect(screen.getByText(/No officers are recorded/i)).toBeTruthy());
  });

  it('lists the officers and what they hold', async () => {
    vi.spyOn(apiModule.api, 'get').mockResolvedValue({ users: [OFFICER] } as never);
    render(<UserAccessScreen user={USER as never} />);

    await waitFor(() => expect(screen.getByText('Musa Bello')).toBeTruthy());
    expect(document.body.textContent).toMatch(/\+2348000000002/);
  });
});
