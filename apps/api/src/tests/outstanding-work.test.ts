/**
 * Who can see what the platform still owes.
 *
 * Three integrations can report that they could not be reached, and each keeps
 * a queue of what is owed as a result: a taxpayer without their TIN, a renewal
 * the vehicle authority never acknowledged, and money a citizen has not had
 * back. Every queue had a read endpoint, a retry endpoint and a background
 * worker. None had a screen, so the retries happened where no person could see
 * them and a queue that had been stuck for a week looked exactly like an empty
 * one.
 *
 * The screen that now shows them is one page over three differently-guarded
 * endpoints, which is the arrangement that produced the reconciliation menu
 * bug: an item offered to a role the API then refused. These tests pin the
 * permissions the screen relies on, so the sections it renders and the answers
 * it will get cannot drift apart.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  get,
  loginAs,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { seedReferenceData } from '../db/seed';
import { permissionsForRole } from '@psirs/shared';

const TOKENS: Record<string, string> = {};

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();

  const people: [string, string][] = [
    ['admin', '+2348000000060'],
    ['revenue_officer', '+2348000000061'],
    ['finance_officer', '+2348000000062'],
    ['supervisor', '+2348000000063'],
    ['auditor', '+2348000000064'],
  ];
  for (const [role, phone] of people) {
    await createGovernmentUser({ fullName: `Outstanding ${role}`, phone, role });
    TOKENS[role] = (await loginAs(phone)).accessToken;
  }
});

/** What the screen reads, and the permission each section is gated on. */
const QUEUES = [
  { path: '/government/refunds/outstanding', gate: 'payment:read:all' },
  { path: '/taxpayers/tin-outstanding', gate: 'taxpayer:tin_sync' },
  { path: '/vehicles/renewals/authority-outstanding', gate: 'vehicle:authority_sync' },
] as const;

/** What each section's retry button posts to, and what it needs. */
const RETRIES = [
  { path: '/government/refunds/retry', gate: 'payment:reconcile' },
  { path: '/taxpayers/tin-retry', gate: 'taxpayer:tin_sync' },
  { path: '/vehicles/renewals/authority-retry', gate: 'vehicle:authority_sync' },
] as const;

const ROLES = ['admin', 'revenue_officer', 'finance_officer', 'supervisor', 'auditor'] as const;

describe('Each queue answers exactly the roles the screen shows it to', () => {
  for (const { path, gate } of QUEUES) {
    it(`serves ${path} to whoever holds ${gate}, and refuses everyone else`, async () => {
      for (const role of ROLES) {
        const holds = (permissionsForRole(role) as readonly string[]).includes(gate);
        const response = await get(path, { token: TOKENS[role]! });

        if (holds) {
          assert.equal(
            response.status,
            200,
            `${role} holds ${gate} and the screen renders this section for them, ` +
              `but ${path} answered ${response.status}`,
          );
        } else {
          assert.equal(
            response.status,
            403,
            `${role} does not hold ${gate}; the screen hides this section from them`,
          );
        }
      }
    });
  }
});

describe('Each retry answers exactly the roles the screen offers the button to', () => {
  for (const { path, gate } of RETRIES) {
    it(`accepts ${path} from whoever holds ${gate}`, async () => {
      for (const role of ROLES) {
        const holds = (permissionsForRole(role) as readonly string[]).includes(gate);
        const response = await post(path, {}, { token: TOKENS[role]! });

        if (holds) {
          assert.notEqual(
            response.status,
            403,
            `${role} holds ${gate} and is shown the retry button, but ${path} refused them`,
          );
        } else {
          assert.equal(
            response.status,
            403,
            `${role} does not hold ${gate}; the button is not rendered for them`,
          );
        }
      }
    });
  }
});

describe('The empty case is a real answer, not a permission failure', () => {
  it('reports an empty queue as empty for a role that may read it', async () => {
    // With nothing outstanding these must return 200 and empty lists, so the
    // screen can say "nothing is outstanding" and mean it. A 403 rendered as
    // an empty table would say the same thing and be false.
    const refunds = await get('/government/refunds/outstanding', { token: TOKENS.finance_officer! });
    assert.equal(refunds.status, 200);
    assert.deepEqual(refunds.body.refunds, []);

    const tins = await get('/taxpayers/tin-outstanding', { token: TOKENS.revenue_officer! });
    assert.equal(tins.status, 200);
    assert.deepEqual(tins.body.taxpayers, []);

    const renewals = await get('/vehicles/renewals/authority-outstanding', {
      token: TOKENS.revenue_officer!,
    });
    assert.equal(renewals.status, 200);
    assert.deepEqual(renewals.body.renewals, []);
    assert.deepEqual(renewals.body.vehiclesAwaitingAuthority, []);
  });

  it('says in words what a retry did, on every queue', async () => {
    // The refund retry returned bare counts while the other two returned a
    // sentence, which left the screen to invent the wording for the case that
    // matters most — money still not returned.
    for (const { path, gate } of RETRIES) {
      const role = ROLES.find((r) => (permissionsForRole(r) as readonly string[]).includes(gate))!;
      const response = await post(path, {}, { token: TOKENS[role]! });
      assert.equal(response.status, 200, `${path}: ${JSON.stringify(response.body)}`);
      assert.equal(
        typeof response.body.message,
        'string',
        `${path} must say what happened, not only how many`,
      );
    }
  });
});
