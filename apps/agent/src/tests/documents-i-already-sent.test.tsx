/**
 * An applicant being told to send again what they already sent.
 *
 * The KYC step computes `missing` as the required documents minus what is on
 * file, and the catch on that read wrote `[]`. An empty list means EVERY
 * required document is missing, so a failed request produced a screen saying
 * "Not captured" beside an identity document the applicant uploaded last week.
 *
 * What an applicant does about that is upload it again — which supersedes the
 * copy on file and puts a second set of somebody's identity papers into
 * storage, for nothing. The list is the only thing on the screen that says
 * what has arrived, and it was answering from a request that failed.
 *
 * The agreement below it had the other half of the pair: its catch wrote
 * `null`, and null renders the skeleton, so a failed read was indistinguisable
 * from one still in flight — on the step that gates the whole clearance.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { AGENT_BLOCKERS, type AgentBlocker } from '@psirs/shared';
import { ApplicationScreen } from '../screens/Application';
import { ApiRequestError, api } from '../lib/api';

/** Far enough in to be at the identity step, with nothing cleared. */
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

const ON_FILE = {
  id: 'doc-1',
  document_type: 'IDENTITY_DOCUMENT',
  content_type: 'image/jpeg',
  byte_size: 245_760,
  verification_status: 'PENDING',
  uploaded_at: '2026-09-01T09:00:00Z',
  superseded_at: null,
  rejection_reason: null,
};

const REFUSED = new ApiRequestError(503, {
  code: 'STORAGE_UNAVAILABLE',
  message: 'Your documents could not be read just now.',
  moneyStatus: 'NOT_APPLICABLE',
});

/** Answer each of the application's reads separately. */
function mockLoads(handlers: { documents?: () => Promise<unknown>; agreement?: () => Promise<unknown> }) {
  const documents = handlers.documents ?? (async () => ({ documents: [ON_FILE] }));
  const agreement =
    handlers.agreement ??
    (async () => ({ version: '1.0', title: 'Agent agreement', body: 'The terms.' }));
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.includes('/kyc/documents')) return (await documents()) as never;
    if (path.includes('/agreement')) return (await agreement()) as never;
    return AT_KYC as never;
  });
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => cleanup());

describe('when the document list cannot be read', () => {
  it('does not report every document as not captured', async () => {
    mockLoads({ documents: () => Promise.reject(REFUSED) });
    render(<ApplicationScreen navigate={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(/documents could not be read just now/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/Not captured/i)).toBeNull();
  });

  it('offers to ask again, and shows what is on file when it answers', async () => {
    const get = vi.fn();
    let first = true;
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      get(path);
      if (path.includes('/kyc/documents')) {
        if (first) {
          first = false;
          throw REFUSED;
        }
        return { documents: [ON_FILE] } as never;
      }
      if (path.includes('/agreement')) return { version: '1.0', title: 'T', body: 'B' } as never;
      return AT_KYC as never;
    });

    render(<ApplicationScreen navigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Try again/i }));

    // "Take again" appears only against a document already on file, so it is
    // the thing that proves the second read landed rather than the first.
    await waitFor(() => expect(screen.getByText(/Take again/i)).toBeTruthy());
    expect(screen.getAllByText(/Not captured/i).length).toBe(1);
  });
});

describe('when it can be read', () => {
  /*
   * The controls. "Not captured" is the whole point of the step for somebody
   * who really has not sent anything, and it must keep saying so.
   */
  it('still says what has not been captured', async () => {
    mockLoads({ documents: async () => ({ documents: [] }) });
    render(<ApplicationScreen navigate={vi.fn()} />);

    await waitFor(() => expect(screen.getAllByText(/Not captured/i).length).toBeGreaterThan(0));
  });

  it('does not ask again for what is already on file', async () => {
    mockLoads({});
    render(<ApplicationScreen navigate={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/Take again/i)).toBeTruthy());
    // The selfie is still outstanding; the identity document is not.
    expect(screen.getAllByText(/Not captured/i).length).toBe(1);
  });
});

describe('the agreement that gates the clearance', () => {
  it('says it could not be fetched rather than loading for ever', async () => {
    mockLoads({
      agreement: () =>
        Promise.reject(
          new ApiRequestError(503, {
            code: 'UPSTREAM_UNAVAILABLE',
            message: 'The agreement could not be fetched.',
            moneyStatus: 'NOT_APPLICABLE',
          }),
        ),
    });
    render(<ApplicationScreen navigate={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/agreement could not be fetched/i)).toBeTruthy());
  });

  it('shows the agreement when it arrives', async () => {
    mockLoads({});
    render(<ApplicationScreen navigate={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('The terms.')).toBeTruthy());
  });
});
