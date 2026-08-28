/**
 * Adding a levy to the catalogue.
 *
 * `POST /revenue/items` existed, was permission-guarded, was audited, and was
 * called from nowhere in either front end. The catalogue screen could reprice
 * an item, withdraw it and put it back — everything except bring one into
 * existence. A new bye-law meant somebody writing an INSERT by hand against
 * production, which is the state of affairs this platform was built to end.
 *
 * The second thing here is the one an officer cannot guess. A new item is
 * created with no rate, because setting what a citizen must pay is a separate
 * decision requiring a reason and a step-up. An officer who adds an item and
 * walks away has left agents with a levy they cannot charge, and nothing on
 * the screen would have said so.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { CatalogueScreen } from '../screens/Configuration';
import * as apiModule from '../lib/api';

const USER = {
  id: 'user-1',
  fullName: 'Catalogue Admin',
  phone: '+2348000000001',
  email: null,
  role: 'admin',
  permissions: ['catalogue:read', 'catalogue:configure'],
} as never;

let posted: { path: string; body: unknown }[] = [];

beforeEach(() => {
  cleanup();
  posted = [];
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
  vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) => {
    if (path.startsWith('/revenue/categories')) {
      return [{ id: 'cat-1', name: 'Market and trade levies' }] as never;
    }
    return [] as never;
  });
  vi.spyOn(apiModule.api, 'post').mockImplementation(async (path: string, body: unknown) => {
    posted.push({ path, body });
    return { revenueItemId: 'item-new' } as never;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function openTheForm() {
  render(<CatalogueScreen user={USER} />);
  fireEvent.click(await screen.findByRole('button', { name: /Add a revenue item/i }));
  await screen.findByLabelText(/^Code$/i);
}

describe('an officer with a new bye-law to implement', () => {
  it('can add the levy from the screen', async () => {
    await openTheForm();

    fireEvent.change(screen.getByLabelText(/Category/i), { target: { value: 'cat-1' } });
    fireEvent.change(screen.getByLabelText(/^Code$/i), { target: { value: 'abattoir-fee' } });
    fireEvent.change(screen.getByLabelText(/^Name$/i), { target: { value: 'Abattoir fee' } });
    fireEvent.click(screen.getByRole('button', { name: /Add to the catalogue/i }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.path).toBe('/revenue/items');
    expect(posted[0]!.body).toMatchObject({
      categoryId: 'cat-1',
      // Upper-cased on the way out: the catalogue's codes are, and an officer
      // typing lower case should not create the one item that is not.
      code: 'ABATTOIR-FEE',
      name: 'Abattoir fee',
    });
  });

  it('is told the levy has no price yet, because it has not', async () => {
    await openTheForm();

    fireEvent.change(screen.getByLabelText(/Category/i), { target: { value: 'cat-1' } });
    fireEvent.change(screen.getByLabelText(/^Code$/i), { target: { value: 'ABATTOIR-FEE' } });
    fireEvent.change(screen.getByLabelText(/^Name$/i), { target: { value: 'Abattoir fee' } });
    fireEvent.click(screen.getByRole('button', { name: /Add to the catalogue/i }));

    /*
     * An item with no rate cannot be assessed in the field. The officer who
     * created it is the only person who will find out in time.
     */
    await waitFor(() => expect(screen.getByText(/no rate yet/i)).toBeTruthy());
  });

  it('will not submit a levy that applies to nobody', async () => {
    await openTheForm();

    fireEvent.change(screen.getByLabelText(/Category/i), { target: { value: 'cat-1' } });
    fireEvent.change(screen.getByLabelText(/^Code$/i), { target: { value: 'ABATTOIR-FEE' } });
    fireEvent.change(screen.getByLabelText(/^Name$/i), { target: { value: 'Abattoir fee' } });
    fireEvent.click(screen.getByLabelText(/Individuals/i));
    fireEvent.click(screen.getByLabelText(/Businesses/i));

    const submit = screen.getByRole('button', { name: /Add to the catalogue/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(submit);
    expect(posted).toHaveLength(0);
  });

  it('will not submit without a category to file it under', async () => {
    await openTheForm();

    fireEvent.change(screen.getByLabelText(/^Code$/i), { target: { value: 'ABATTOIR-FEE' } });
    fireEvent.change(screen.getByLabelText(/^Name$/i), { target: { value: 'Abattoir fee' } });

    const submit = screen.getByRole('button', { name: /Add to the catalogue/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('an officer who may read the catalogue but not configure it', () => {
  it('is not offered the button', async () => {
    vi.spyOn(apiModule, 'can').mockImplementation((permission: string) => permission === 'catalogue:read');
    render(<CatalogueScreen user={USER} />);

    await screen.findByText(/Revenue catalogue/i);
    expect(screen.queryByRole('button', { name: /Add a revenue item/i })).toBeNull();
  });
});
