/**
 * The officer who registers a group, approving it.
 *
 * `group:manage` both registers a group and approves it. Approval is what
 * makes the group's attested members eligible for incentive programmes, and
 * the ATTESTATION role lets the group's word on a member's stall stand against
 * an agent's count. Both are meant to follow a check by somebody other than
 * the person making the claim.
 *
 * Measured before the change: a revenue officer registered a farmers' union,
 * with a leader phone of their own choosing (201). They approved it
 * themselves (200, ACTIVE) and gave it the ATTESTATION role (200). The same
 * officer was recorded as `registered_by` and `approved_by`.
 *
 * Now a colleague has to approve the group and confer its role. The
 * registrant can still suspend it or take its role away, since both only
 * reduce what the group can do.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';

let registrantToken = '';
let colleagueToken = '';
let colleagueId = '';
let groupId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({
    fullName: 'Registering Officer',
    phone: '+2348000000452',
    role: 'revenue_officer',
  });
  colleagueId = await createGovernmentUser({
    fullName: 'Reviewing Officer',
    phone: '+2348000000453',
    role: 'revenue_officer',
  });
  registrantToken = (await loginAs('+2348000000452')).accessToken;
  colleagueToken = (await loginAs('+2348000000453')).accessToken;

  const registered = await post(
    '/groups',
    {
      name: 'Kuru Farmers Union',
      groupType: 'FARMERS_COOPERATIVE',
      lgaId: await firstLgaId(),
      leaderName: 'Union Chairman',
      leaderPhone: '+2348000000454',
    },
    { token: registrantToken },
  );
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  groupId = registered.body.groupId as string;
});

const groupRow = () =>
  queryOne<{ status: string; approved_by: string | null; tax_role: string }>(
    pool,
    'SELECT status, approved_by, tax_role FROM taxpayer_groups WHERE id = $1',
    [groupId],
  );

const review = (decision: 'APPROVE' | 'SUSPEND', token: string) =>
  post(
    `/groups/${groupId}/review`,
    { decision, reason: 'Checked against the ministry register of cooperatives.' },
    { token },
  );

const setRole = (taxRole: 'ATTESTATION' | 'ENUMERATION' | 'NONE', token: string) =>
  post(
    `/groups/${groupId}/tax-role`,
    { taxRole, reason: 'Recognised under the market bye-law of 2026.' },
    { token },
  );

describe('a group and the officer who registered it', () => {
  it('cannot be approved by that officer', async () => {
    const res = await review('APPROVE', registrantToken);
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.match(res.body.error.message, /You registered this group/);

    const row = await groupRow();
    assert.equal(row!.status, 'PENDING');
    assert.equal(row!.approved_by, null);
  });

  it('is approved by a colleague', async () => {
    const res = await review('APPROVE', colleagueToken);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const row = await groupRow();
    assert.equal(row!.status, 'ACTIVE');
    assert.equal(row!.approved_by, colleagueId);
  });

  it('cannot be given a part in enumeration by that officer, and can by a colleague', async () => {
    assert.equal((await review('APPROVE', colleagueToken)).status, 200);

    for (const taxRole of ['ATTESTATION', 'ENUMERATION'] as const) {
      const refused = await setRole(taxRole, registrantToken);
      assert.equal(refused.status, 403, `${taxRole}: ${JSON.stringify(refused.body)}`);
    }
    assert.equal((await groupRow())!.tax_role, 'NONE');

    const conferred = await setRole('ATTESTATION', colleagueToken);
    assert.equal(conferred.status, 200, JSON.stringify(conferred.body));
    assert.equal((await groupRow())!.tax_role, 'ATTESTATION');
  });

  it('can still be suspended by that officer', async () => {
    assert.equal((await review('APPROVE', colleagueToken)).status, 200);

    const suspended = await review('SUSPEND', registrantToken);
    assert.equal(suspended.status, 200, JSON.stringify(suspended.body));
    assert.equal((await groupRow())!.status, 'SUSPENDED');
  });

  it('can still have its part taken away by that officer', async () => {
    assert.equal((await review('APPROVE', colleagueToken)).status, 200);
    assert.equal((await setRole('ATTESTATION', colleagueToken)).status, 200);

    const withdrawn = await setRole('NONE', registrantToken);
    assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.body));
    assert.equal((await groupRow())!.tax_role, 'NONE');
  });
});
