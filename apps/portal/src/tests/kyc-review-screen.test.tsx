/**
 * The screen an officer clears somebody's identity through.
 *
 * D-5 has carried this since revision 8: `KycDocuments.tsx` was referenced by
 * no test, rendered or otherwise. It is not an ordinary gap. `governmentApproved`
 * is the one genuinely human gate in the clearance pipeline, and this screen is
 * the only place the human can see what they are approving — the photographs of
 * a real person's identity papers. Everything else in the pipeline is an
 * automated verdict.
 *
 * On this codebase "exercised by nothing" has predicted "wrong" at close to one
 * defect per surface read, so these were written to break the screen rather
 * than to demonstrate it. Three properties are worth more than the rendering:
 *
 *   * The bytes are fetched with the reviewer's token and shown from an object
 *     URL that is revoked when the viewer closes. If that revocation does not
 *     happen, somebody's identity documents stay reachable from an idle tab.
 *
 *   * Opening a document is a logged event rather than a side effect of loading
 *     the page, so the access log records reviewers and not renders.
 *
 *   * A decision carries a reason and the applicant sees it, so a rejection is
 *     the start of a loop rather than a verdict into the void.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { KycDocumentsCard, unreviewedCount, type KycDocument } from '../screens/KycDocuments';
import { ApiRequestError, api } from '../lib/api';
import * as apiModule from '../lib/api';
import { permissionsForRole } from '@psirs/shared';

const AGENT_ID = '5f2b1a44-0000-4000-8000-000000000001';

const doc = (over: Partial<KycDocument> = {}): KycDocument => ({
  id: 'd0000000-0000-4000-8000-000000000001',
  document_type: 'IDENTITY_DOCUMENT',
  content_type: 'image/jpeg',
  byte_size: 245_760,
  checksum: 'ab12cd34ef56ab78cd90ef12ab34cd56ef78ab90cd12ef34ab56cd78ef90ab12',
  verification_status: 'PENDING',
  capture_source: 'IN_APP_CAMERA',
  original_filename: null,
  uploaded_at: '2026-08-01T09:15:00.000Z',
  reviewed_at: null,
  rejection_reason: null,
  superseded_at: null,
  ...over,
});

/**
 * The real permission list for the role, not a hand-picked pair: a permission
 * taken away from this role should surface here as a failing test rather than
 * as a screen that quietly loses its buttons.
 */
function signInAs(role: 'admin' | 'revenue_officer' | 'auditor') {
  // `getUser` memoises into a module-level `currentUser` and only falls back to
  // sessionStorage when that is empty, so clearing storage alone leaves the
  // previous role in force. Harmless in the app — a real sign-in goes through
  // `setSession` — but a test that switches roles has to clear the cache, or it
  // renders the last role and reports the screen as broken.
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

let createdUrls: string[];
let revokedUrls: string[];

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  signInAs('admin');

  // jsdom has no object-URL implementation, and the revocation is the property
  // under test rather than an incidental — so it is recorded, not stubbed away.
  createdUrls = [];
  revokedUrls = [];
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn((_blob: Blob) => {
      const url = `blob:psirs/${createdUrls.length + 1}`;
      createdUrls.push(url);
      return url;
    }),
    revokeObjectURL: vi.fn((url: string) => {
      revokedUrls.push(url);
    }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('unreviewedCount', () => {
  it('counts what still needs a person, and nothing else', () => {
    expect(
      unreviewedCount([
        doc({ id: '1', verification_status: 'PENDING' }),
        doc({ id: '2', verification_status: 'VERIFIED' }),
        doc({ id: '3', verification_status: 'REJECTED' }),
        // Superseded by a replacement the applicant uploaded: the officer is
        // not owed a look at a document that has been withdrawn.
        doc({ id: '4', verification_status: 'PENDING', superseded_at: '2026-08-02T00:00:00.000Z' }),
      ]),
    ).toBe(1);
  });
});

describe('the list of documents behind an applicant', () => {
  it('asks for this applicant’s documents and nobody else’s', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ documents: [doc()] } as never);
    render(<KycDocumentsCard agentId={AGENT_ID} />);

    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(get).toHaveBeenCalledWith(`/agents/${AGENT_ID}/kyc/documents`);
  });

  it('warns that approving now would be approving blind, and says how many', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      documents: [doc({ id: 'a' }), doc({ id: 'b' }), doc({ id: 'c', verification_status: 'VERIFIED' })],
    } as never);

    render(<KycDocumentsCard agentId={AGENT_ID} />);

    // Two of the three still need a person; the count is the whole point of
    // the warning, so a wrong one is worse than none.
    // A warning Alert carries role="status"; only errors are role="alert".
    // Querying the wrong one passes vacuously, which is how a missing warning
    // would go unnoticed.
    const warning = await waitFor(() => screen.getByRole('status'));
    expect(warning.textContent).toMatch(/\b2\b/);
  });

  it('does not warn when every document has been decided', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      documents: [
        doc({ id: 'a', verification_status: 'VERIFIED', reviewed_at: '2026-08-02T10:00:00.000Z' }),
        doc({ id: 'b', verification_status: 'REJECTED', reviewed_at: '2026-08-02T10:00:00.000Z' }),
      ],
    } as never);

    render(<KycDocumentsCard agentId={AGENT_ID} />);
    await waitFor(() => expect(screen.getAllByRole('button').length).toBeGreaterThan(0));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not fetch any document just because the page loaded', async () => {
    const fetchFile = vi.spyOn(apiModule, 'fetchFile');
    vi.spyOn(api, 'get').mockResolvedValue({ documents: [doc(), doc({ id: 'second' })] } as never);

    render(<KycDocumentsCard agentId={AGENT_ID} />);
    await waitFor(() => expect(screen.getAllByRole('button').length).toBeGreaterThan(0));

    // The access log is meant to record reviewers, not renders. Prefetching
    // here would write an entry for every officer who opened the applicant.
    expect(fetchFile).not.toHaveBeenCalled();
  });
});

describe('opening one document', () => {
  const openFirst = async () => {
    const button = await waitFor(() => screen.getByRole('button', { name: /Open and review/i }));
    fireEvent.click(button);
  };

  it('fetches the bytes through the API, and shows them from an object URL', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ documents: [doc()] } as never);
    const fetchFile = vi
      .spyOn(apiModule, 'fetchFile')
      .mockResolvedValue(new Blob(['jpeg-bytes'], { type: 'image/jpeg' }));

    render(<KycDocumentsCard agentId={AGENT_ID} />);
    await openFirst();

    await waitFor(() => expect(fetchFile).toHaveBeenCalledWith(`/agents/kyc/documents/${doc().id}/file`));
    const image = await waitFor(() => screen.getByRole('img'));
    expect(image.getAttribute('src')).toBe(createdUrls[0]);
  });

  it('revokes the object URL when the viewer closes, so the papers do not outlive it', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ documents: [doc()] } as never);
    vi.spyOn(apiModule, 'fetchFile').mockResolvedValue(new Blob(['jpeg-bytes'], { type: 'image/jpeg' }));

    render(<KycDocumentsCard agentId={AGENT_ID} />);
    await openFirst();
    await waitFor(() => expect(createdUrls.length).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: /close/i }));

    await waitFor(() => expect(revokedUrls).toEqual(createdUrls));
  });

  it('shows the checksum, so a reviewer can say which file they looked at', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ documents: [doc()] } as never);
    vi.spyOn(apiModule, 'fetchFile').mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }));

    render(<KycDocumentsCard agentId={AGENT_ID} />);
    await openFirst();

    await waitFor(() => expect(screen.getByText(/ab12cd34ef56ab78/)).toBeTruthy());
  });

  it('says so when the bytes cannot be fetched, rather than showing an empty frame', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ documents: [doc()] } as never);
    vi.spyOn(apiModule, 'fetchFile').mockRejectedValue(
      new ApiRequestError(403, {
        code: 'FORBIDDEN',
        message: 'You do not have permission to read identity documents.',
        moneyStatus: 'NOT_APPLICABLE',
      }),
    );

    render(<KycDocumentsCard agentId={AGENT_ID} />);
    await openFirst();

    await waitFor(() =>
      expect(screen.getByText(/You do not have permission to read identity documents/i)).toBeTruthy(),
    );
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('deciding on a document', () => {
  const openFirst = async () => {
    const button = await waitFor(() => screen.getByRole('button', { name: /Open and review/i }));
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('img')).toBeTruthy());
  };

  beforeEach(() => {
    vi.spyOn(apiModule, 'fetchFile').mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }));
  });

  it('will not accept or reject without a reason', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ documents: [doc()] } as never);
    render(<KycDocumentsCard agentId={AGENT_ID} />);
    await openFirst();

    const accept = screen.getByRole('button', { name: /^Accept/i });
    const reject = screen.getByRole('button', { name: /^Reject/i });
    expect((accept as HTMLButtonElement).disabled).toBe(true);
    expect((reject as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/why/i), { target: { value: 'ok' } });
    expect((accept as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/why/i), {
      target: { value: 'Matches the NIN slip and the selfie.' },
    });
    expect((accept as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends the decision and the reason, and reloads the list afterwards', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ documents: [doc()] } as never);
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never);
    const onReviewed = vi.fn();

    render(<KycDocumentsCard agentId={AGENT_ID} onReviewed={onReviewed} />);
    await openFirst();

    fireEvent.change(screen.getByLabelText(/why/i), {
      target: { value: 'Photograph is blurred beyond reading the number.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Reject/i }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(`/agents/kyc/documents/${doc().id}/review`, {
        decision: 'REJECT',
        reason: 'Photograph is blurred beyond reading the number.',
      }),
    );
    // The applicant can act on a rejection, so the officer is told that.
    await waitFor(() => expect(screen.getByText(/replacement/i)).toBeTruthy());
    expect(onReviewed).toHaveBeenCalled();
    // Reloaded rather than patched in memory: the server decides what the
    // list now says.
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(1));
  });

  it('shows the server’s refusal rather than reporting a decision that did not happen', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ documents: [doc()] } as never);
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiRequestError(409, {
        code: 'CONFLICT',
        message: 'This document has already been reviewed.',
        moneyStatus: 'NOT_APPLICABLE',
      }),
    );

    render(<KycDocumentsCard agentId={AGENT_ID} />);
    await openFirst();
    fireEvent.change(screen.getByLabelText(/why/i), { target: { value: 'Looks correct to me.' } });
    fireEvent.click(screen.getByRole('button', { name: /^Accept/i }));

    await waitFor(() => expect(screen.getByText(/already been reviewed/i)).toBeTruthy());
  });

  it('offers no decision on a document somebody has already decided', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      documents: [
        doc({
          verification_status: 'REJECTED',
          reviewed_at: '2026-08-02T10:00:00.000Z',
          rejection_reason: 'Expired document.',
        }),
      ],
    } as never);

    render(<KycDocumentsCard agentId={AGENT_ID} />);
    await openFirst();

    expect(screen.queryByRole('button', { name: /^Accept/i })).toBeNull();
    expect(screen.getByText(/Expired document\./)).toBeTruthy();
  });

  it('offers no decision on a document the applicant has replaced', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      documents: [doc({ superseded_at: '2026-08-03T10:00:00.000Z' })],
    } as never);

    render(<KycDocumentsCard agentId={AGENT_ID} />);
    const button = await waitFor(() => screen.getByRole('button', { name: /^View$/i }));
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('img')).toBeTruthy());

    expect(screen.queryByRole('button', { name: /^Accept/i })).toBeNull();
  });

  it('gives an officer without the approval permission no buttons to press', async () => {
    signInAs('auditor');
    vi.spyOn(api, 'get').mockResolvedValue({ documents: [doc()] } as never);

    render(<KycDocumentsCard agentId={AGENT_ID} />);
    await openFirst();

    expect(screen.queryByRole('button', { name: /^Accept/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Reject/i })).toBeNull();
  });
});

describe('who has looked at somebody’s identity papers', () => {
  const openFirst = async () => {
    const button = await waitFor(() => screen.getByRole('button', { name: /Open and review/i }));
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('img')).toBeTruthy());
  };

  beforeEach(() => {
    vi.spyOn(apiModule, 'fetchFile').mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }));
  });

  it('lists the reads on request', async () => {
    vi.spyOn(api, 'get').mockImplementation((path: string) => {
      if (path.endsWith('/access')) {
        return Promise.resolve({
          access: [
            {
              access_type: 'VIEW',
              created_at: '2026-08-02T11:00:00.000Z',
              ip_address: '10.1.2.3',
              full_name: 'Another Officer',
              role: 'revenue_officer',
            },
          ],
        }) as never;
      }
      return Promise.resolve({ documents: [doc()] }) as never;
    });

    render(<KycDocumentsCard agentId={AGENT_ID} />);
    await openFirst();
    fireEvent.click(screen.getByRole('button', { name: /who/i }));

    await waitFor(() => expect(screen.getByText('Another Officer')).toBeTruthy());
    expect(screen.getByText('10.1.2.3')).toBeTruthy();
  });

  /*
   * The access log is evidence about who read a person's identity papers.
   * "Nobody has looked" and "I could not find out who looked" are different
   * answers, and only one of them is ever safe to show — an officer checking
   * whether a colleague opened a file needs to know when the question failed
   * rather than be told the answer is no.
   */
  it('does not answer “nobody” when the question failed', async () => {
    vi.spyOn(api, 'get').mockImplementation((path: string) => {
      if (path.endsWith('/access')) {
        return Promise.reject(
          new ApiRequestError(500, {
            code: 'INTERNAL',
            message: 'The access log could not be read.',
            moneyStatus: 'NOT_APPLICABLE',
          }),
        ) as never;
      }
      return Promise.resolve({ documents: [doc()] }) as never;
    });

    render(<KycDocumentsCard agentId={AGENT_ID} />);
    await openFirst();
    fireEvent.click(screen.getByRole('button', { name: /who/i }));

    await waitFor(() => expect(screen.getByText(/could not be read|could not be loaded/i)).toBeTruthy());
  });
});
