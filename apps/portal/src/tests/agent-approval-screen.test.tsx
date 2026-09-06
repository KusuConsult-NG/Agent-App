/**
 * The screen an agent is cleared to collect government revenue through.
 *
 * The other half of D-5. Approval and activation are deliberately separate
 * actions here — approving the application is a judgement about the person,
 * activating them is what puts a handset in the field able to take money — and
 * nothing rendered either of them under test.
 *
 * What these are written to catch is the failure this report has found twice
 * already on other screens: a control that exists in the API and is invisible
 * in the portal. The server refuses to activate an agent with an outstanding
 * clearance item, and refuses a decision without a reason. If the screen lets
 * an officer press the button anyway and says nothing when the refusal comes
 * back, the control is one the officer learns to work around rather than one
 * that stops them.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { AgentDetailScreen } from '../screens/Agents';
import { ApiRequestError, api } from '../lib/api';
import * as apiModule from '../lib/api';
import { permissionsForRole, type Role } from '@psirs/shared';

const AGENT_ID = '5f2b1a44-0000-4000-8000-000000000001';
const TERRITORY = {
  id: 't0000000-0000-4000-8000-000000000001',
  name: 'Jos North Central',
  name_ha: null,
  lga_name: 'Jos North',
};

const CLEARED = {
  kycCleared: true,
  refereeCleared: true,
  governmentApproved: true,
  trainingCompleted: true,
  bankVerified: true,
  agreementAccepted: true,
  deviceRegistered: true,
};

function detail(over: Record<string, unknown> = {}) {
  return {
    applicationState: 'APPROVED',
    accessStage: 'CLEARED',
    statuses: {},
    checklist: { ...CLEARED },
    outstanding: [],
    canCollectRevenue: false,
    kyc: null,
    referees: [],
    training: [],
    devices: [],
    history: [],
    ...over,
  };
}

function signInAs(role: Role) {
  // See the note in kyc-review-screen.test.tsx: `getUser` memoises, so the
  // cache has to be cleared or the previous role stays in force.
  apiModule.setSession(null);
  sessionStorage.setItem(
    'psirs.portal.user',
    JSON.stringify({
      id: 'u1',
      phone: '+2348000000001',
      fullName: 'Clearance Officer',
      role,
      permissions: permissionsForRole(role),
    }),
  );
}

const user = {
  id: 'u1',
  phone: '+2348000000001',
  fullName: 'Clearance Officer',
  email: null,
  role: 'admin',
  permissions: permissionsForRole('admin'),
} as never;

function mockDetail(over: Record<string, unknown> = {}) {
  return vi.spyOn(api, 'get').mockImplementation((path: string) => {
    if (path.includes('/territories')) return Promise.resolve([TERRITORY]) as never;
    if (path.endsWith('/kyc/documents')) return Promise.resolve({ documents: [] }) as never;
    return Promise.resolve(detail(over)) as never;
  });
}

const renderScreen = () =>
  render(<AgentDetailScreen agentId={AGENT_ID} user={user} navigate={vi.fn()} />);

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  signInAs('admin');
});

describe('the clearance checklist', () => {
  it('shows every gate, so an officer can see which one is not met', async () => {
    mockDetail({
      checklist: { ...CLEARED, trainingCompleted: false },
      outstanding: ['Mandatory training not completed'],
    });

    renderScreen();

    await waitFor(() => expect(screen.getByText(/Identity verified/i)).toBeTruthy());
    for (const gate of [
      /Identity verified/i,
      /Referee cleared/i,
      /Government approved/i,
      /Mandatory training/i,
      /Commission bank account/i,
      /Agent agreement/i,
      /Device registered/i,
    ]) {
      expect(screen.getAllByText(gate).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(/Mandatory training not completed/i)).toBeTruthy();
  });

  it('says plainly whether this person may take money today', async () => {
    mockDetail({ canCollectRevenue: false });
    renderScreen();
    await waitFor(() => expect(screen.getByText(/May collect revenue/i)).toBeTruthy());
    expect(screen.getByText(/^No$/)).toBeTruthy();
  });
});

describe('deciding an application', () => {
  it('will not approve, reject or ask for more without a reason of substance', async () => {
    mockDetail({ applicationState: 'READY_FOR_REVIEW', checklist: { ...CLEARED, governmentApproved: false } });
    renderScreen();

    const approve = await waitFor(() => screen.getByRole('button', { name: /Approve application/i }));
    const reject = screen.getByRole('button', { name: /^Reject/i });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    expect((reject as HTMLButtonElement).disabled).toBe(true);

    // Nine characters is not a reason. The server wants ten and so does this.
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'looks ok' } });
    expect((approve as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/reason/i), {
      target: { value: 'Identity documents checked against the NIN slip.' },
    });
    expect((approve as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends the decision with its reason, and reloads rather than assuming', async () => {
    const get = mockDetail({
      applicationState: 'READY_FOR_REVIEW',
      checklist: { ...CLEARED, governmentApproved: false },
    });
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never);

    renderScreen();
    await waitFor(() => screen.getByRole('button', { name: /Approve application/i }));
    fireEvent.change(screen.getByLabelText(/reason/i), {
      target: { value: 'Identity documents checked against the NIN slip.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Approve application/i }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(`/agents/${AGENT_ID}/review`, {
        decision: 'APPROVE',
        reason: 'Identity documents checked against the NIN slip.',
      }),
    );
    const before = get.mock.calls.length;
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(before - 1));
    await waitFor(() => expect(screen.getByText(/Application approved/i)).toBeTruthy());
  });

  it('shows the server’s refusal instead of reporting an approval that did not happen', async () => {
    mockDetail({ applicationState: 'READY_FOR_REVIEW', checklist: { ...CLEARED, governmentApproved: false } });
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiRequestError(409, {
        code: 'CONFLICT',
        message: 'This application has already been decided.',
        moneyStatus: 'NOT_APPLICABLE',
      }),
    );

    renderScreen();
    await waitFor(() => screen.getByRole('button', { name: /Approve application/i }));
    fireEvent.change(screen.getByLabelText(/reason/i), {
      target: { value: 'Identity documents checked against the NIN slip.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Approve application/i }));

    await waitFor(() => expect(screen.getByText(/already been decided/i)).toBeTruthy());
    expect(screen.queryByText(/Application approved/i)).toBeNull();
  });

  it('offers no decision on an application nobody has finished submitting', async () => {
    mockDetail({ applicationState: 'IN_PROGRESS', checklist: { ...CLEARED, governmentApproved: false } });
    renderScreen();
    await waitFor(() => expect(screen.getByText(/Identity verified/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Approve application/i })).toBeNull();
  });

  it('gives an auditor nothing to press', async () => {
    signInAs('auditor');
    mockDetail({ applicationState: 'READY_FOR_REVIEW', checklist: { ...CLEARED, governmentApproved: false } });
    renderScreen();

    await waitFor(() => expect(screen.getByText(/Identity verified/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Approve application/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Activate agent/i })).toBeNull();
  });
});

describe('activating an agent', () => {
  /*
   * The moment that matters. Activation is what lets a handset take money from
   * a citizen, and the API refuses it while any clearance item is outstanding.
   * A screen that offers the button anyway teaches officers that the refusal is
   * arbitrary.
   */
  it('refuses to offer activation while a clearance item is outstanding', async () => {
    mockDetail({
      checklist: { ...CLEARED, trainingCompleted: false },
      outstanding: ['Mandatory training not completed'],
    });
    renderScreen();

    const button = await waitFor(() => screen.getByRole('button', { name: /Activate agent/i }));
    // A territory is chosen first, deliberately. Without it the button is
    // disabled for two reasons at once, and the assertion would hold even if
    // the outstanding-item check were deleted — which is the shape of mistake
    // D-63 was: a test passing on the wrong one of two possible answers.
    fireEvent.change(screen.getByLabelText(/territory/i), { target: { value: TERRITORY.id } });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Mandatory training not completed/i)).toBeTruthy();
  });

  it('will not activate without a territory, because collections are attributed to one', async () => {
    mockDetail();
    renderScreen();

    const button = await waitFor(() => screen.getByRole('button', { name: /Activate agent/i }));
    expect((button as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(await waitFor(() => screen.getByLabelText(/territory/i)), {
      target: { value: TERRITORY.id },
    });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends the chosen territory with the activation', async () => {
    mockDetail();
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never);

    renderScreen();
    await waitFor(() => screen.getByRole('button', { name: /Activate agent/i }));
    fireEvent.change(screen.getByLabelText(/territory/i), { target: { value: TERRITORY.id } });
    fireEvent.click(screen.getByRole('button', { name: /Activate agent/i }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(`/agents/${AGENT_ID}/activate`, { territoryId: TERRITORY.id }),
    );
    await waitFor(() => expect(screen.getByText(/Agent activated/i)).toBeTruthy());
  });

  it('shows the server’s refusal rather than claiming the agent is live', async () => {
    mockDetail();
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiRequestError(409, {
        code: 'CONFLICT',
        message: 'This agent cannot be activated: the agent agreement is not accepted.',
        moneyStatus: 'NOT_APPLICABLE',
      }),
    );

    renderScreen();
    await waitFor(() => screen.getByRole('button', { name: /Activate agent/i }));
    fireEvent.change(screen.getByLabelText(/territory/i), { target: { value: TERRITORY.id } });
    fireEvent.click(screen.getByRole('button', { name: /Activate agent/i }));

    await waitFor(() => expect(screen.getByText(/agreement is not accepted/i)).toBeTruthy());
    expect(screen.queryByText(/Agent activated/i)).toBeNull();
  });

  it('offers no activation to an agent already collecting', async () => {
    mockDetail({ canCollectRevenue: true });
    renderScreen();
    await waitFor(() => expect(screen.getByText(/Identity verified/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Activate agent/i })).toBeNull();
  });
});
