/**
 * The screen an officer opens to find one agent, and what it said when it
 * could not look.
 *
 * `AgentsScreen` loads two things: the clearance dashboard — how many
 * applications are waiting, how many agents are suspended — and the list of
 * agents themselves. Both failures were handled badly, in opposite directions.
 *
 * The list caught with `.catch(() => setAgents([]))`, which prints "No agents
 * match this filter." That is the screen somebody opens to find a named agent
 * and suspend them, or to see who is waiting to be cleared, and "there is
 * nobody" is the one answer that ends a search.
 *
 * The dashboard did the opposite and took everything with it: `if (error)
 * return <ErrorAlert />` replaced the entire screen, so a failed count threw
 * away an agent list that had arrived perfectly well. One failed request, and
 * an officer loses the work they could still have done.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { AgentsScreen } from '../screens/Agents';
import { ApiRequestError, api } from '../lib/api';
import * as apiModule from '../lib/api';
import { permissionsForRole } from '@psirs/shared';

const DASHBOARD = {
  counts: {
    applications_received: 12,
    ready_for_review: 2,
    active: 40,
    suspended: 1,
    kyc_pending: 3,
    kyc_action_required: 1,
    kyc_cleared: 30,
    referee_pending: 4,
    referee_failed: 0,
  },
  reviewQueue: [],
};

const AGENT = {
  id: 'ag-1',
  agent_code: 'AGT-00042',
  full_name: 'Ladi Dung',
  phone: '+2348031234567',
  lga_name: 'Jos North',
  status: 'ACTIVE',
  application_state: 'APPROVED',
  can_collect_revenue: true,
};

const refusal = (what: string) =>
  new ApiRequestError(503, {
    code: 'UPSTREAM_UNAVAILABLE',
    message: `The ${what} could not be read.`,
    moneyStatus: 'NOT_APPLICABLE',
  });

function signIn() {
  apiModule.setSession(null);
  sessionStorage.setItem(
    'psirs.portal.user',
    JSON.stringify({
      id: 'u1',
      phone: '+2348000000001',
      fullName: 'Administrator',
      role: 'admin',
      permissions: permissionsForRole('admin'),
    }),
  );
}

function mockLoads(handlers: { dashboard?: () => Promise<unknown>; agents?: () => Promise<unknown> }) {
  const dashboard = handlers.dashboard ?? (async () => DASHBOARD);
  const agents = handlers.agents ?? (async () => [AGENT]);
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.includes('kyc-dashboard')) return (await dashboard()) as never;
    if (path.startsWith('/agents/bank-changes')) return { changes: [] } as never;
    return (await agents()) as never;
  });
}

const spinner = () => document.querySelector('[aria-busy="true"]');

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  signIn();
});

afterEach(() => cleanup());

describe('an agent list that could not be read', () => {
  it('does not answer that no agent matches', async () => {
    mockLoads({ agents: () => Promise.reject(refusal('agent list')) });
    render(<AgentsScreen navigate={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/agent list could not be read/i)).toBeTruthy());
    expect(screen.queryByText(/No agents match this filter/i)).toBeNull();
  });

  it('offers a way to ask again', async () => {
    mockLoads({ agents: () => Promise.reject(refusal('agent list')) });
    render(<AgentsScreen navigate={vi.fn()} />);

    expect(await screen.findByRole('button', { name: /Try again/i })).toBeTruthy();
  });

  it('leaves the dashboard readable', async () => {
    mockLoads({ agents: () => Promise.reject(refusal('agent list')) });
    render(<AgentsScreen navigate={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/Applications received/i)).toBeTruthy());
  });
});

describe('a dashboard that could not be read', () => {
  it('does not take the agent list down with it', async () => {
    mockLoads({ dashboard: () => Promise.reject(refusal('clearance dashboard')) });
    render(<AgentsScreen navigate={vi.fn()} />);

    // The reason an officer came to this screen is still on it.
    await waitFor(() => expect(screen.getByText('Ladi Dung')).toBeTruthy());
  });

  it('says why the figures are missing', async () => {
    mockLoads({ dashboard: () => Promise.reject(refusal('clearance dashboard')) });
    render(<AgentsScreen navigate={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(/clearance dashboard could not be read/i)).toBeTruthy(),
    );
  });

  it('does not claim no application is waiting for review', async () => {
    // The review queue is part of the same read, and its empty text is a
    // statement about a queue of people waiting to be cleared for work.
    mockLoads({ dashboard: () => Promise.reject(refusal('clearance dashboard')) });
    render(<AgentsScreen navigate={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Ladi Dung')).toBeTruthy());
    expect(screen.queryByText(/No applications are waiting|waiting for review/i)).toBeNull();
  });
});

describe('when both answer', () => {
  it('shows the figures and the agents', async () => {
    mockLoads({});
    render(<AgentsScreen navigate={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Ladi Dung')).toBeTruthy());
    expect(document.body.textContent).toMatch(/Applications received/i);
  });

  it('still shows a skeleton while a read is in flight', async () => {
    mockLoads({ agents: () => new Promise(() => {}) });
    render(<AgentsScreen navigate={vi.fn()} />);

    await waitFor(() => expect(spinner()).toBeTruthy());
    expect(screen.queryByText(/could not be read/i)).toBeNull();
  });
});
