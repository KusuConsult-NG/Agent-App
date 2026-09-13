/**
 * The last portal screen no test had rendered.
 *
 * `TicketDetailScreen` is where an officer answers a citizen or an agent who
 * has raised a problem. Its load caught only `ApiRequestError`, so a failure
 * without a body set nothing — and the guard beneath it reads
 * `{!error && <Loading />}`, which means the screen went on loading for ever
 * with no sentence anywhere to say why.
 *
 * The way back to the queue survives the failure, which is the property worth
 * holding: a detail screen that loses its own navigation when a read fails
 * traps the officer on it, and reloading the page is the only way out.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { TicketDetailScreen } from '../screens/Support';
import * as apiModule from '../lib/api';
import { ApiRequestError } from '../lib/api';

const DROPPED = new Error('Failed to fetch');

const REFUSED = new ApiRequestError(404, {
  code: 'NOT_FOUND',
  message: 'That ticket could not be found.',
  moneyStatus: 'NOT_APPLICABLE',
});

const TICKET = {
  id: 'tk-1',
  ticket_number: 'SUP-2026-0042',
  category: 'PAYMENT',
  subject: 'Payment taken twice',
  description: 'The trader was charged for the same levy on two days.',
  status: 'OPEN',
  priority: 'HIGH',
  resolution: null,
  created_at: '2026-08-01T09:00:00.000Z',
  raised_by_name: 'Ladi Bature',
  raised_by_phone: '+2348030000001',
  raiser_role: 'agent',
  assigned_to_name: null,
  transaction_reference: null,
  total_amount_kobo: null,
  messages: [],
};

const navigated: string[] = [];
let answer: () => unknown;

beforeEach(() => {
  cleanup();
  navigated.length = 0;
  answer = () => TICKET;
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
  vi.spyOn(apiModule.api, 'get').mockImplementation(async () => answer() as never);
});

afterEach(() => vi.restoreAllMocks());

const draw = () =>
  render(<TicketDetailScreen ticketId="tk-1" navigate={(path) => navigated.push(path)} />);

describe('a ticket that will not load', () => {
  it('says so, rather than loading for ever in silence', async () => {
    answer = () => {
      throw DROPPED;
    };
    draw();

    await waitFor(() => expect(screen.getByText(/Failed to fetch/)).toBeTruthy());
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('says so for a refusal with a body too', async () => {
    answer = () => {
      throw REFUSED;
    };
    draw();

    await waitFor(() => expect(screen.getByText(/ticket could not be found/i)).toBeTruthy());
  });

  it('keeps the way back to the queue', async () => {
    // A detail screen that loses its own navigation traps the officer on it.
    answer = () => {
      throw DROPPED;
    };
    draw();
    await screen.findByText(/Failed to fetch/);

    fireEvent.click(screen.getByRole('button', { name: /queue/i }));
    expect(navigated).toEqual(['/support']);
  });
});

describe('a ticket that loads', () => {
  it('shows what the person actually raised', async () => {
    draw();

    expect(await screen.findByText('Payment taken twice')).toBeTruthy();
    expect(screen.getByText(/charged for the same levy on two days/)).toBeTruthy();
  });
});
