/**
 * What the administrator is told before they stop every agent in the state.
 *
 * The count of handsets a new minimum would lock out is computed twice: once
 * on this screen as the number is typed, and once by the API when it is
 * published. If those two disagree the preview is a lie, and the person moving
 * the gate finds out what they did from a market rather than from the screen.
 * Both use `compareVersions` from the shared package for exactly that reason,
 * and the case that separates a correct comparison from a text one — 1.10.0
 * against 1.9.0 — is the one asserted here.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { FieldAppScreen } from '../screens/FieldApp';
import * as apiModule from '../lib/api';

const HISTORY = {
  minimumVersion: '1.9.0',
  recommendedVersion: '1.9.0',
  activeDevices: 12,
  fleet: [
    { version: null, devices: 1, belowMinimum: true },
    { version: '1.9.0', devices: 7, belowMinimum: false },
    { version: '1.10.0', devices: 4, belowMinimum: false },
  ],
  published: [
    {
      minimumVersion: '1.9.0',
      recommendedVersion: '1.9.0',
      notes: 'Rounding fix in 1.9.0.',
      effectiveFrom: '2026-03-01T09:00:00.000Z',
      inForce: true,
      publishedBy: 'Ladi Bulus',
    },
    {
      minimumVersion: '1.0.0',
      recommendedVersion: '1.0.0',
      notes: 'Initial release',
      effectiveFrom: '2026-01-01T09:00:00.000Z',
      inForce: false,
      publishedBy: null,
    },
  ],
};

describe('Moving the version gate', () => {
  beforeEach(() => {
    cleanup();
    vi.spyOn(apiModule.api, 'get').mockResolvedValue(structuredClone(HISTORY));
  });
  afterEach(() => vi.restoreAllMocks());

  const type = (label: RegExp, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it('shows the fleet against the minimum in force', async () => {
    render(<FieldAppScreen />);
    await screen.findByText(/Field application/i);

    expect(screen.getByText(/Minimum version in force/i)).toBeTruthy();
    // The handset that has never reported a version is named rather than
    // dropped: it is the one the gate refuses outright.
    expect(screen.getByText(/Never reported a version/i)).toBeTruthy();
  });

  it('counts what a proposed minimum would stop, before it is published', async () => {
    render(<FieldAppScreen />);
    await screen.findByLabelText(/Minimum version/i);

    type(/Minimum version/i, '1.10.0');
    // 7 handsets on 1.9.0 plus the 1 that never reported — not the 4 on
    // 1.10.0, which a text comparison would have counted as below 1.9.0's
    // successor and reported as 12.
    await waitFor(() =>
      expect(screen.getByText(/8 of 12 active handsets would stop collecting/i)).toBeTruthy(),
    );
  });

  it('refuses a minimum above the recommended build without asking the API', async () => {
    const post = vi.spyOn(apiModule.api, 'post');
    render(<FieldAppScreen />);
    await screen.findByLabelText(/Minimum version/i);

    type(/Minimum version/i, '2.0.0');
    type(/Recommended version/i, '1.9.0');
    type(/Why the minimum is moving/i, 'A minimum nobody could satisfy.');

    const publish = screen.getByRole('button', { name: /Publish this minimum/i });
    await waitFor(() => expect((publish as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText(/above the recommended 1\.9\.0/i)).toBeTruthy();
    fireEvent.click(publish);
    expect(post).not.toHaveBeenCalled();
  });

  it('will not publish without a reason an agent could be shown', async () => {
    render(<FieldAppScreen />);
    await screen.findByLabelText(/Minimum version/i);

    type(/Minimum version/i, '1.10.0');
    type(/Recommended version/i, '1.10.0');
    type(/Why the minimum is moving/i, 'because');

    const publish = screen.getByRole('button', { name: /Publish this minimum/i });
    await waitFor(() => expect((publish as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText(/at least 10 characters/i)).toBeTruthy();
  });

  it('sends what was entered and reports back what it did', async () => {
    const post = vi
      .spyOn(apiModule.api, 'post')
      .mockResolvedValue({ message: '8 of 12 active handsets cannot collect until they update.' });
    render(<FieldAppScreen />);
    await screen.findByLabelText(/Minimum version/i);

    type(/Minimum version/i, '1.10.0');
    type(/Recommended version/i, '1.10.0');
    type(/Why the minimum is moving/i, 'Build 1.9.0 rounds the service charge down.');

    const publish = screen.getByRole('button', { name: /Publish this minimum/i });
    await waitFor(() => expect((publish as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(publish);

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/agents/app-version', {
        minimumVersion: '1.10.0',
        recommendedVersion: '1.10.0',
        notes: 'Build 1.9.0 rounds the service charge down.',
      }),
    );
    await screen.findByText(/8 of 12 active handsets cannot collect until they update\./i);
  });

  it('says which row the platform shipped with rather than showing a blank', async () => {
    render(<FieldAppScreen />);
    await screen.findByText(/Field application/i);
    expect(screen.getByText(/Shipped with the platform/i)).toBeTruthy();
    expect(screen.getByText(/Ladi Bulus/i)).toBeTruthy();
  });
});
