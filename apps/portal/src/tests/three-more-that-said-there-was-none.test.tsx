/**
 * The last three empty states that spoke from a failed read.
 *
 * Found by redoing the enumeration properly. I had swept this class from the
 * list of screens no test had ever drawn, which is the wrong list — a screen
 * having a test says nothing about whether its failure branches have one.
 * The right list is every catch that writes an empty array into state the
 * screen then describes, and reading what each empty state actually says.
 *
 * Thirty-one such catches remain. Twenty-eight write reference and filter
 * data — LGAs, categories, revenue items, territories — where an empty
 * dropdown makes no claim about the world and the report behind it is still
 * on screen. These three make claims:
 *
 *   "No sample has been drawn yet."          the auditor's workbench
 *   "No report has been generated yet."      the auditor's workbench
 *   "No posting has been recorded for this officer."
 *   "No distributions have been set up yet."
 *
 * Each is a statement somebody acts on. An auditor told no sample exists
 * draws another; told no report exists, concludes the work was never done —
 * on the screen whose entire purpose is recording that somebody checked. An
 * administrator told an officer has no posting history has nothing to check a
 * transfer against. And an officer told no distribution has been set up sets
 * one up, which is not a duplicate row: it is fertiliser awarded twice.
 *
 * The posting history was the worst of the three. Its catch set no error at
 * all, so the screen was silent as well as wrong.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { getTranslation, permissionsForRole, type Role } from '@psirs/shared';
import { WorkbenchScreen } from '../screens/Workbench';
import { GroupsScreen } from '../screens/Groups';
import { PostingPanel } from '../screens/Organisation';
import { ApiRequestError, api } from '../lib/api';
import * as apiModule from '../lib/api';

const en = getTranslation('en');

const REFUSED = new ApiRequestError(503, {
  code: 'UPSTREAM_UNAVAILABLE',
  message: 'That could not be read just now.',
  moneyStatus: 'NOT_APPLICABLE',
});

function signInAs(role: Role) {
  apiModule.setSession(null);
  sessionStorage.setItem(
    'psirs.portal.user',
    JSON.stringify({
      id: 'u1',
      phone: '+2348000000001',
      fullName: 'Auditor Ngo',
      role,
      permissions: permissionsForRole(role),
    }),
  );
}

const user = (role: Role) =>
  ({
    id: 'u1',
    phone: '+2348000000001',
    fullName: 'Auditor Ngo',
    email: null,
    role,
    permissions: permissionsForRole(role),
  }) as never;

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => cleanup());

describe('the auditor’s workbench, when it could not be read', () => {
  it('does not say no sample has been drawn', async () => {
    signInAs('auditor');
    vi.spyOn(api, 'get').mockRejectedValue(REFUSED);

    render(<WorkbenchScreen user={user('auditor')} />);

    await waitFor(() =>
      expect(screen.getAllByText('That could not be read just now.').length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(en.ofcWbNoSamples)).toBeNull();
  });

  it('does not say no report has been generated', async () => {
    // The sharper of the two. A signed report is the record that somebody
    // checked, and "none" reads as "the work was never done".
    signInAs('auditor');
    vi.spyOn(api, 'get').mockRejectedValue(REFUSED);

    render(<WorkbenchScreen user={user('auditor')} />);

    await waitFor(() =>
      expect(screen.getAllByText('That could not be read just now.').length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(en.ofcWbNoReports)).toBeNull();
  });

  it('offers the read again', async () => {
    signInAs('auditor');
    vi.spyOn(api, 'get').mockRejectedValue(REFUSED);

    render(<WorkbenchScreen user={user('auditor')} />);

    await screen.findByRole('button', { name: en.actionTryAgain });
  });
});

describe('the distributions list, when it could not be read', () => {
  it('does not say none have been set up', async () => {
    signInAs('admin');
    vi.spyOn(api, 'get').mockImplementation((async (path: string) => {
      if (path.startsWith('/allocations/rounds')) throw REFUSED;
      return { groups: [] } as never;
    }) as never);

    render(<GroupsScreen navigate={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getAllByText('That could not be read just now.').length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(en.ofcNoneDistributionsSetUp)).toBeNull();
  });
});

describe('an officer’s posting history, when it could not be read', () => {
  it('does not say no posting has been recorded', async () => {
    // The worst of the three: this catch set no error at all, so the screen
    // was silent as well as wrong. A posting history is what a transfer is
    // checked against.
    signInAs('admin');
    vi.spyOn(api, 'get').mockRejectedValue(REFUSED);

    render(<PostingPanel officerId="u-9" />);

    await waitFor(() =>
      expect(screen.getAllByText('That could not be read just now.').length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(en.ofcNoneTransfers)).toBeNull();
  });

  it('still says no posting has been recorded when that is the answer', async () => {
    signInAs('admin');
    vi.spyOn(api, 'get').mockResolvedValue([] as never);

    render(<PostingPanel officerId="u-9" />);

    await screen.findByText(en.ofcNoneTransfers);
  });
});

describe('what this must not have changed', () => {
  it('still says no sample has been drawn when that is the answer', async () => {
    // The sentences are not wrong. They are wrong from a failure.
    signInAs('auditor');
    vi.spyOn(api, 'get').mockResolvedValue({ samples: [], reports: [] } as never);

    render(<WorkbenchScreen user={user('auditor')} />);

    await screen.findByText(en.ofcWbNoSamples);
    expect(screen.getByText(en.ofcWbNoReports)).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.actionTryAgain })).toBeNull();
  });

  it('still says no distribution has been set up when that is the answer', async () => {
    signInAs('admin');
    vi.spyOn(api, 'get').mockImplementation((async (path: string) => {
      if (path.startsWith('/allocations/rounds')) return { rounds: [] } as never;
      return { groups: [] } as never;
    }) as never);

    render(<GroupsScreen navigate={vi.fn()} />);

    await screen.findByText(en.ofcNoneDistributionsSetUp);
  });

  it('still draws no distributions section for an officer who may not read them', async () => {
    // A supervisor holds no `allocation:read:all`, so the list is never
    // fetched and the section is absent. That silence is correct and is why
    // the emptiness could not be read as failure.
    signInAs('supervisor');
    vi.spyOn(api, 'get').mockResolvedValue({ groups: [] } as never);

    render(<GroupsScreen navigate={vi.fn()} />);

    await waitFor(() => expect(screen.queryByText(en.ofcGpDistributions)).toBeNull());
    expect(screen.queryByText(en.ofcNoneDistributionsSetUp)).toBeNull();
  });
});
