/**
 * Four screens nobody had ever rendered, and the defect that survived in them.
 *
 * The sweep that gave 82 handlers a branch for a failure that is not an API
 * refusal reached the screens tests exercised. These four it did not, because
 * no test had ever rendered them — the revenue summary, the usage overview,
 * the incentive programmes and the referee queue — and each still read:
 *
 *     .catch((caught) => {
 *       if (caught instanceof ApiRequestError) setError(caught.error);
 *     });
 *
 * So a connection that dropped, or any failure without a body, set no error
 * and left the data null. The screen then drew its skeleton forever, saying
 * nothing. That is the one failure an officer cannot even report: there is
 * nothing on screen to report.
 *
 * Two of them compounded it. `if (error) return <ErrorAlert error={error} />`
 * replaced the whole screen with a sentence and no control, so the only way
 * to ask again was reloading the page — the shape already fixed on the
 * intelligence drill-down after one dropped request ended that screen.
 *
 * These are the untested screens, so this is where the fixed bug was still
 * living. That is the argument for rendering them at all.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { RevenueScreen } from '../screens/Revenue';
import { UsageScreen } from '../screens/Usage';
import { ProgrammesScreen } from '../screens/Configuration';
import { RefereesScreen } from '../screens/Agents';
import * as apiModule from '../lib/api';
import { ApiRequestError } from '../lib/api';

/** Not an `ApiRequestError`: the case every one of these dropped. */
const DROPPED = new Error('Failed to fetch');

const REFUSED = new ApiRequestError(503, {
  code: 'UPSTREAM_UNAVAILABLE',
  message: 'The report could not be built.',
  moneyStatus: 'NOT_APPLICABLE',
});

const SUMMARY = {
  byMda: [],
  byWard: [],
  coverage: { transactions: '0', located: '0' },
  totals: { collectedKobo: '0', transactions: '0' },
  scope: { kind: 'STATEWIDE' },
};

const OVERVIEW = { funnels: [], screens: [], captured: 0 };

const spinner = () => document.querySelector('[aria-busy="true"]');

let answer: () => unknown;

beforeEach(() => {
  cleanup();
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
  vi.spyOn(apiModule.api, 'get').mockImplementation(async () => answer() as never);
});

afterEach(() => vi.restoreAllMocks());

const SCREENS: [string, () => React.ReactElement, unknown][] = [
  ['the revenue summary', () => <RevenueScreen />, SUMMARY],
  ['the usage overview', () => <UsageScreen />, OVERVIEW],
  ['the incentive programmes', () => <ProgrammesScreen />, []],
  ['the referee queue', () => <RefereesScreen />, { pending: [], flags: [] }],
];

describe('a read that fails without an API body', () => {
  for (const [name, draw] of SCREENS) {
    it(`is said out loud on ${name}, rather than loading forever`, async () => {
      answer = () => {
        throw DROPPED;
      };
      render(draw());

      await waitFor(() => expect(screen.getByText(/Failed to fetch/)).toBeTruthy());
      expect(spinner(), 'a failed read must not keep drawing a skeleton').toBeNull();
    });
  }
});

describe('a read that is refused with one', () => {
  for (const [name, draw] of SCREENS) {
    it(`is said out loud on ${name} too`, async () => {
      answer = () => {
        throw REFUSED;
      };
      render(draw());

      await waitFor(() => expect(screen.getByText(/report could not be built/i)).toBeTruthy());
      expect(spinner()).toBeNull();
    });
  }
});

describe('asking again', () => {
  for (const [name, draw, body] of SCREENS.filter(([label]) =>
    /revenue summary|usage overview|referee queue/.test(label),
  )) {
    it(`is possible on ${name} without reloading the page`, async () => {
      let attempt = 0;
      answer = () => {
        attempt += 1;
        if (attempt === 1) throw REFUSED;
        return body;
      };
      render(draw());
      await screen.findByText(/report could not be built/i);

      fireEvent.click(screen.getAllByRole('button', { name: /Try again/i })[0]!);

      await waitFor(() =>
        expect(screen.queryByText(/report could not be built/i)).toBeNull(),
      );
    });
  }
});

describe('when the read succeeds', () => {
  for (const [name, draw, body] of SCREENS) {
    it(`${name} draws, which is the control on all of the above`, async () => {
      answer = () => body;
      render(draw());

      await waitFor(() => expect(spinner()).toBeNull());
      expect(screen.queryByText(/Failed to fetch/)).toBeNull();
    });
  }
});
