/**
 * Filters that survive being navigated away from, and a change an auditor can
 * read.
 *
 * Both were the last two "Missing"/"Partial" rows in the officer-readiness
 * assessment, and both are properties only a rendering test can check: the API
 * suite proves the queries are right and can say nothing about whether an
 * officer who pressed back has to start again.
 *
 * WHAT THE FILTER TESTS ARE ABOUT
 *
 * Not that a value can be stored -- that would test `sessionStorage`. That the
 * precedence is right, which is the part that goes wrong: the URL beats the
 * remembered value, an explicitly emptied field in the URL stays empty rather
 * than being helpfully refilled, and two screens do not overwrite each other.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { useFilters } from '../lib/filters';
import { BeforeAfter } from '../ui';

beforeEach(() => {
  sessionStorage.clear();
  window.location.hash = '#/transactions';
});
afterEach(cleanup);

describe('filters an officer does not have to type twice', () => {
  it('starts from the defaults when there is nothing to remember', () => {
    const { result } = renderHook(() =>
      useFilters('transactions', '/transactions', { status: '', lgaId: '' }),
    );
    expect(result.current[0]).toEqual({ status: '', lgaId: '' });
  });

  it('writes what the officer chose into the address', () => {
    const { result } = renderHook(() =>
      useFilters('transactions', '/transactions', { status: '', lgaId: '' }),
    );
    act(() => result.current[1]({ status: 'SETTLED' }));
    expect(window.location.hash).toContain('status=SETTLED');
  });

  /*
   * The point of putting them in the address rather than only in storage: a
   * filtered view an officer can send to a colleague, and a back button that
   * behaves the way the officer expects.
   */
  it('reads them back out of the address, which is what makes a view shareable', () => {
    window.location.hash = '#/transactions?status=REVERSED&lgaId=abc';
    const { result } = renderHook(() =>
      useFilters('transactions', '/transactions', { status: '', lgaId: '' }),
    );
    expect(result.current[0]).toEqual({ status: 'REVERSED', lgaId: 'abc' });
  });

  it('remembers them across leaving the screen and coming back', () => {
    const first = renderHook(() =>
      useFilters('transactions', '/transactions', { status: '', lgaId: '' }),
    );
    act(() => first.result.current[1]({ status: 'SETTLED' }));
    first.unmount();

    // Somewhere else entirely, then back with no query string.
    window.location.hash = '#/transactions';
    const second = renderHook(() =>
      useFilters('transactions', '/transactions', { status: '', lgaId: '' }),
    );
    expect(second.result.current[0].status).toBe('SETTLED');
  });

  /*
   * The precedence that matters. An officer who clears a filter and reloads
   * must not have it put back for them: "?status=" is a decision, and
   * restoring the remembered value looks like the screen ignoring them.
   */
  it('lets an emptied filter in the address beat the remembered one', () => {
    const first = renderHook(() =>
      useFilters('transactions', '/transactions', { status: '', lgaId: '' }),
    );
    act(() => first.result.current[1]({ status: 'SETTLED' }));
    first.unmount();

    window.location.hash = '#/transactions?status=';
    const second = renderHook(() =>
      useFilters('transactions', '/transactions', { status: '', lgaId: '' }),
    );
    expect(second.result.current[0].status).toBe('');
  });

  it('does not let one screen’s filters land on another’s', () => {
    const transactions = renderHook(() =>
      useFilters('transactions', '/transactions', { status: '' }),
    );
    act(() => transactions.result.current[1]({ status: 'SETTLED' }));
    transactions.unmount();

    window.location.hash = '#/audit';
    const audit = renderHook(() => useFilters('audit', '/audit', { status: '' }));
    expect(audit.result.current[0].status).toBe('');
  });
});

// ===========================================================================
describe('what a change actually changed', () => {
  it('lists only the fields that moved', () => {
    render(
      <BeforeAfter
        before={{ amountKobo: '2500000', status: 'ACTIVE', code: 'SHOPS' }}
        after={{ amountKobo: '3000000', status: 'ACTIVE', code: 'SHOPS' }}
      />,
    );
    expect(screen.getByText('amountKobo')).toBeTruthy();
    expect(screen.getByText('2500000')).toBeTruthy();
    expect(screen.getByText('3000000')).toBeTruthy();
    // The two fields that did not move are not printed: a reader asked to spot
    // which of fourteen fields changed does not spot it.
    expect(screen.queryByText('status')).toBeNull();
    expect(screen.queryByText('code')).toBeNull();
  });

  it('shows a field that appeared, and one that went away', () => {
    render(<BeforeAfter before={{ note: null }} after={{ note: 'Corrected by hand' }} />);
    expect(screen.getByText('note')).toBeTruthy();
    expect(screen.getByText('Corrected by hand')).toBeTruthy();
  });

  /*
   * An action with neither side is a creation or a read. Rendering "no
   * changes" on every one of those would be noise on every line of the busiest
   * screen in the portal.
   */
  it('says nothing at all when there was no change to describe', () => {
    const { container } = render(<BeforeAfter before={null} after={null} />);
    expect(container.textContent).toBe('');
  });

  it('says nothing when both sides are the same', () => {
    const { container } = render(
      <BeforeAfter before={{ status: 'ACTIVE' }} after={{ status: 'ACTIVE' }} />,
    );
    expect(container.textContent).toBe('');
  });
});
