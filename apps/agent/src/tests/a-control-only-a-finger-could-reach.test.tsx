/**
 * The one step in the application a keyboard could not reach.
 *
 * Photographing an identity document is done through a file input dressed as
 * a button: a `<label class="button">` with the input inside it. The input
 * carried the `hidden` attribute, which is `display: none`, and a label is not
 * focusable on its own — so the whole control was reachable by tapping it and
 * by nothing else. No keyboard, no switch, no external control.
 *
 * Everything else in this application is reachable that way. This step is the
 * one that stands between somebody and being allowed to work, and the people
 * most likely to be using an assistive control are the ones least able to go
 * and find a counter instead.
 *
 * Clipped rather than hidden keeps the input in the focus order and in the
 * accessibility tree, and because the label wraps it, the label's words are
 * the input's name.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { AGENT_BLOCKERS, type AgentBlocker } from '@psirs/shared';
import { ApplicationScreen } from '../screens/Application';
import { api } from '../lib/api';

const AT_KYC = {
  applicationState: 'APPLICATION_SUBMITTED',
  accessStage: 'APPLICANT',
  statuses: {
    account: 'ACTIVE',
    kyc: 'PENDING',
    referee: 'PENDING',
    training: 'PENDING',
    clearance: 'PENDING',
    operational: 'PENDING',
  },
  checklist: {},
  outstanding: [...AGENT_BLOCKERS] as AgentBlocker[],
  canCollectRevenue: false,
  kyc: null,
  referees: [],
  training: [],
  devices: [],
  history: [],
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.includes('/kyc/documents')) return { documents: [] } as never;
    if (path.includes('/agreement')) return { version: '1', title: 'T', body: 'B' } as never;
    return AT_KYC as never;
  });
});

afterEach(() => cleanup());

async function captureInputs(): Promise<HTMLInputElement[]> {
  render(<ApplicationScreen navigate={vi.fn()} />);
  await waitFor(() => expect(screen.getAllByText(/Take photograph/i).length).toBeGreaterThan(0));
  return [...document.querySelectorAll('input[type="file"]')] as HTMLInputElement[];
}

describe('the control that photographs an identity document', () => {
  it('is not display:none, which is what takes a control out of the focus order', async () => {
    const inputs = await captureInputs();

    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      expect(input.hidden, 'a hidden input cannot be focused or tabbed to').toBe(false);
    }
  });

  it('is still not in anybody’s way on the screen', async () => {
    // Clipped, not shown: the label is the visible surface, and two file
    // pickers drawn on a phone screen would be worse than the defect.
    const inputs = await captureInputs();

    for (const input of inputs) {
      expect(input.className).toContain('capture__input');
    }
  });

  it('is named by the words on the label a person reads', async () => {
    await captureInputs();

    // The label wraps the input, so this is the input's accessible name.
    const byName = screen.getAllByLabelText(/Take photograph/i);
    expect(byName.length).toBeGreaterThan(0);
    expect((byName[0] as HTMLInputElement).type).toBe('file');
  });
});
