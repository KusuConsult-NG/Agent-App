/**
 * The oversight reports, and who they answer.
 *
 * Five queries were computed and never shown. `GET /government/kpis` produced
 * thirteen platform figures, `GET /agents/performance` fifteen per agent, and
 * three audit questions took a parameter — transactions by one agent, receipts
 * under one revenue item, and who has looked at one taxpayer's record. None of
 * the five had a caller anywhere in the portal.
 *
 * The last of those is the question a data-protection enquiry actually asks.
 * It was answerable only by querying the database directly, on a screen whose
 * own words are "answerable without querying production tables directly".
 *
 * These tests pin the permissions the new screens rely on. Agent performance
 * is the one worth stating: the API accepts report:read:all OR
 * report:read:territory, and a supervisor holds only the second — so a menu
 * gated on the first alone would hide the screen from the role it is most for.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  get,
  loginAs,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { seedReferenceData } from '../db/seed';
import { permissionsForRole } from '@psirs/shared';

const TOKENS: Record<string, string> = {};
const ROLES = ['admin', 'revenue_officer', 'finance_officer', 'supervisor', 'auditor'] as const;

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
    ['admin', '+2348000000080'],
    ['revenue_officer', '+2348000000081'],
    ['finance_officer', '+2348000000082'],
    ['supervisor', '+2348000000083'],
    ['auditor', '+2348000000084'],
  ];
  for (const [role, phone] of people) {
    await createGovernmentUser({ fullName: `Oversight ${role}`, phone, role });
    TOKENS[role] = (await loginAs(phone)).accessToken;
  }
});

/** Each view, and the permissions its route accepts. */
const VIEWS = [
  { path: '/government/kpis', accepts: ['report:read:all'] },
  { path: '/agents/performance', accepts: ['report:read:all', 'report:read:territory'] },
] as const;

describe('Every role offered a view can load it', () => {
  for (const { path, accepts } of VIEWS) {
    it(`serves ${path} to whoever holds ${accepts.join(' or ')}`, async () => {
      for (const role of ROLES) {
        const held = permissionsForRole(role) as readonly string[];
        const allowed = accepts.some((permission) => held.includes(permission));
        const response = await get(path, { token: TOKENS[role]! });

        if (allowed) {
          assert.equal(
            response.status,
            200,
            `${role} holds one of ${accepts.join(', ')} and is offered this screen, ` +
              `but ${path} answered ${response.status}`,
          );
        } else {
          assert.equal(response.status, 403, `${role} holds none of ${accepts.join(', ')}`);
        }
      }
    });
  }

  it('reaches agent performance for a supervisor, who holds only the territory permission', async () => {
    // Stated on its own because it is the case a single-permission menu gate
    // gets wrong, and the role it excludes is the one the screen is for.
    const held = permissionsForRole('supervisor') as readonly string[];
    assert.ok(!held.includes('report:read:all'));
    assert.ok(held.includes('report:read:territory'));

    const response = await get('/agents/performance', { token: TOKENS.supervisor! });
    assert.equal(response.status, 200, JSON.stringify(response.body));
  });

  it('refuses the platform KPIs to a supervisor, which is why they are not on that screen', async () => {
    const response = await get('/government/kpis', { token: TOKENS.supervisor! });
    assert.equal(response.status, 403);
  });
});

describe('The parameterised audit questions', () => {
  it('will not run without the thing they are about', async () => {
    // Each takes a required parameter, which is why the screen has to collect
    // one before running rather than offering a bare button as it used to.
    for (const path of [
      '/government/audit/queries/agent-transactions',
      '/government/audit/queries/receipts-by-item',
      '/government/audit/queries/taxpayer-access',
    ]) {
      const response = await get(path, { token: TOKENS.auditor! });
      assert.equal(response.status, 422, `${path}: ${JSON.stringify(response.body)}`);
    }
  });

  it('answers an auditor, who is the person these exist for', async () => {
    const response = await get('/government/audit/queries/receipts-by-item?revenueItemCode=SHOPS-KIOSKS', {
      token: TOKENS.auditor!,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.ok(Array.isArray(response.body));
  });

  it('gives whoever can ask the question the lists it needs to be asked with', async () => {
    // The screen fills its selects from the agents list, the revenue catalogue
    // and taxpayer search. A role that can run the query and cannot load the
    // options would meet an empty select and no explanation.
    for (const role of ROLES) {
      const held = permissionsForRole(role) as readonly string[];
      if (!held.includes('audit:read')) continue;

      for (const lookup of ['/agents?limit=5', '/revenue/items', '/taxpayers/search?q=a&limit=5']) {
        const response = await get(lookup, { token: TOKENS[role]! });
        assert.notEqual(
          response.status,
          403,
          `${role} can ask the audit questions but cannot load ${lookup} to choose a subject`,
        );
      }
    }
  });
});
