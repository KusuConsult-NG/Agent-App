/**
 * Three states the schema allowed and nothing could produce.
 *
 * `a-state-nothing-writes.test.ts` holds the property. This holds the three
 * instances it found on the day it was written, because a property test proves
 * the word is somewhere in the source, and only these prove the state does
 * what it is for.
 *
 *   revenue_items.status = 'RETIRED'
 *     The catalogue is the legal basis for collection. Every reader already
 *     required ACTIVE — `listItems`, `getItem`, and therefore `createAssessment`
 *     through it — so an item that stopped being collectable would have been
 *     refused correctly at every door. Nothing could change the status, so no
 *     item ever stopped being collectable. A levy repealed by the House stayed
 *     on sale for as long as the platform ran.
 *
 *   taxpayer_group_members.status = 'LEFT'
 *     Allocations and incentive eligibility both count only ATTESTED members.
 *     Membership never ended, so a trader who left the market association kept
 *     a claim on subsidised inputs meant for the people still in it.
 *
 *   vehicles.status = 'ARCHIVED'
 *     A vehicle record outlives the vehicle — sold, written off, scrapped. It
 *     could not be taken off the register, so particulars could be renewed for
 *     a car that no longer existed. Here the writer *and* the reader were
 *     missing: `initiateRenewal` never looked at the status either, which is
 *     why the pair had to arrive together.
 *
 * Each transition is audited, refuses to repeat itself, and leaves money that
 * was already owed exactly where it was.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  api,
  createGovernmentUser,
  firstLgaId,
  get,
  loginAs,
  pool,
  post,
  resetDatabase,
  revenueItemByCode,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';

const ADMIN = '+2348030002199';
const OFFICER = '+2348030002200';
const AUDITOR = '+2348030002201';

let officerToken = '';
let auditorToken = '';
let lgaId = '';
let agent = { token: '', device: '' };

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  lgaId = await firstLgaId();

  // seedDemoAgent needs an admin to approve the agent it creates.
  await createGovernmentUser({ role: 'admin', phone: ADMIN, fullName: 'Platform Admin' });
  await createGovernmentUser({ role: 'revenue_officer', phone: OFFICER, fullName: 'Catalogue Officer' });
  await createGovernmentUser({ role: 'auditor', phone: AUDITOR, fullName: 'Audit Officer' });
  officerToken = (await loginAs(OFFICER)).accessToken;
  auditorToken = (await loginAs(AUDITOR)).accessToken;

  const demo = await seedDemoAgent();
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };
});

async function taxpayer(name: string, phone: string): Promise<string> {
  const row = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO taxpayers (taxpayer_type, first_name, last_name, phone, address, lga_id,
                            consent_given, declaration_accepted, economic_sector, tin)
     VALUES ('INDIVIDUAL','Member',$1,$2,'Market Road',$3,true,true,'RETAIL_TRADE',$4)
     RETURNING id`,
    [name, phone, lgaId, `TIN${phone.slice(-8)}`],
  );
  return row!.id;
}

// ---------------------------------------------------------------------------
// A revenue item can be withdrawn
// ---------------------------------------------------------------------------

describe('withdrawing a revenue item from the catalogue', () => {
  it('stops it being assessable, without touching what is already owed', async () => {
    const itemId = await revenueItemByCode('MARKET-LEVY');
    const person = await taxpayer('Owed', '+2348100002001');

    // Raised while the item was still on sale.
    const before = await post(
      '/revenue/assessments',
      { taxpayerId: person, revenueItemId: itemId, inputs: {} },
      { token: agent.token, deviceId: agent.device },
    );
    assert.equal(before.status, 201, JSON.stringify(before.body));

    const withdrawn = await post(
      `/revenue/items/${itemId}/status`,
      { status: 'RETIRED', reason: 'Repealed by the Plateau State Finance Law amendment.' },
      { token: officerToken },
    );
    assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.body));
    assert.equal(withdrawn.body.to, 'RETIRED');

    // Nothing new can be raised against it.
    const after = await post(
      '/revenue/assessments',
      { taxpayerId: person, revenueItemId: itemId, inputs: {} },
      { token: agent.token, deviceId: agent.device },
    );
    assert.equal(after.status, 409, JSON.stringify(after.body));
    assert.equal(after.body.error.code, 'REVENUE_ITEM_INACTIVE');

    // The invoice raised before the repeal is still owed. The citizen was
    // liable under the rule in force on the day, and withdrawing the item is
    // not a decision to write off everybody's arrears.
    const invoice = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM invoices WHERE assessment_id = $1',
      [before.body.assessmentId],
    );
    assert.equal(invoice!.status, 'UNPAID');
  });

  it('takes it out of the catalogue an agent reads', async () => {
    const itemId = await revenueItemByCode('MARKET-LEVY');

    const listed = await get('/revenue/items', { token: agent.token, deviceId: agent.device });
    assert.ok(
      listed.body.some((item: { id: string }) => item.id === itemId),
      'the item should be on sale to begin with',
    );

    await post(
      `/revenue/items/${itemId}/status`,
      { status: 'SUSPENDED', reason: 'Held while the tariff is re-checked against the gazette.' },
      { token: officerToken },
    );

    const again = await get('/revenue/items', { token: agent.token, deviceId: agent.device });
    assert.ok(
      !again.body.some((item: { id: string }) => item.id === itemId),
      'a suspended item should not be offered for sale',
    );
  });

  it('can be brought back from suspension but never from retirement', async () => {
    const itemId = await revenueItemByCode('MARKET-LEVY');

    await post(
      `/revenue/items/${itemId}/status`,
      { status: 'SUSPENDED', reason: 'Held while the tariff is re-checked.' },
      { token: officerToken },
    );
    const restored = await post(
      `/revenue/items/${itemId}/status`,
      { status: 'ACTIVE', reason: 'Tariff confirmed against the gazette.' },
      { token: officerToken },
    );
    assert.equal(restored.status, 200, JSON.stringify(restored.body));

    await post(
      `/revenue/items/${itemId}/status`,
      { status: 'RETIRED', reason: 'Repealed.' },
      { token: officerToken },
    );
    const resurrected = await post(
      `/revenue/items/${itemId}/status`,
      { status: 'ACTIVE', reason: 'Changed our minds.' },
      { token: officerToken },
    );
    assert.equal(resurrected.status, 409, JSON.stringify(resurrected.body));
    assert.equal(resurrected.body.error.code, 'ITEM_RETIRED');
    assert.match(resurrected.body.error.message, /new revenue item/i);
  });

  it('refuses to withdraw an item that is already withdrawn', async () => {
    const itemId = await revenueItemByCode('MARKET-LEVY');
    await post(
      `/revenue/items/${itemId}/status`,
      { status: 'SUSPENDED', reason: 'Held while the tariff is re-checked.' },
      { token: officerToken },
    );
    const again = await post(
      `/revenue/items/${itemId}/status`,
      { status: 'SUSPENDED', reason: 'Held while the tariff is re-checked.' },
      { token: officerToken },
    );
    assert.equal(again.status, 409, JSON.stringify(again.body));
    assert.equal(again.body.error.code, 'ITEM_STATUS_UNCHANGED');
  });

  it('is an officer decision, not an agent one, and lands on the audit trail', async () => {
    const itemId = await revenueItemByCode('MARKET-LEVY');

    const byAgent = await post(
      `/revenue/items/${itemId}/status`,
      { status: 'RETIRED', reason: 'I would rather not sell this one.' },
      { token: agent.token, deviceId: agent.device },
    );
    assert.equal(byAgent.status, 403, JSON.stringify(byAgent.body));

    await post(
      `/revenue/items/${itemId}/status`,
      { status: 'RETIRED', reason: 'Repealed by the Plateau State Finance Law amendment.' },
      { token: officerToken },
    );

    const entry = await queryOne<{ action: string; new_value: { reason: string } }>(
      pool,
      `SELECT action, new_value FROM audit_logs
        WHERE entity_type = 'revenue_item' AND entity_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [itemId],
    );
    assert.equal(entry!.action, 'catalogue.item_withdrawn');
    assert.match(entry!.new_value.reason, /Finance Law/);
  });
});

// ---------------------------------------------------------------------------
// A member can leave a group
// ---------------------------------------------------------------------------

describe('a member leaving a group', () => {
  async function attestedGroupWithOneMember(): Promise<{ groupId: string; membershipId: string; taxpayerId: string }> {
    const registered = await post(
      '/groups',
      {
        name: 'Jos Main Market Traders',
        groupType: 'MARKET_ASSOCIATION',
        lgaId,
        community: 'Jos North',
        leaderName: 'Chairman Bitrus Dung',
        leaderPhone: '+2348099991001',
        memberEstimate: 40,
      },
      { token: agent.token, deviceId: agent.device },
    );
    assert.equal(registered.status, 201, JSON.stringify(registered.body));
    const groupId = registered.body.groupId;

    await post(
      `/groups/${groupId}/review`,
      { decision: 'APPROVE', reason: 'Association verified against the market register.' },
      { token: officerToken },
    );

    const taxpayerId = await taxpayer('Leaving', '+2348100002010');
    const added = await post(
      `/groups/${groupId}/members`,
      { taxpayerId },
      { token: agent.token, deviceId: agent.device },
    );
    assert.equal(added.status, 201, JSON.stringify(added.body));

    const invited = await post(`/groups/${groupId}/attestation-request`, undefined, {
      token: officerToken,
    });
    const attestToken = String(invited.body.invitationUrl).split('/group-attestation/')[1];
    const list = await get(`/group-attestation/${attestToken}`);
    const membershipId = list.body.members[0].id;

    const confirmed = await post(`/group-attestation/${attestToken}/confirm`, {
      confirmedMemberIds: [membershipId],
      rejectedMemberIds: [],
    });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));

    return { groupId, membershipId, taxpayerId };
  }

  it('ends the membership without deleting that it existed', async () => {
    const { groupId, membershipId } = await attestedGroupWithOneMember();

    const left = await post(
      `/groups/${groupId}/members/${membershipId}/departure`,
      { reason: 'Moved his stall to Bukuru market and left the association.' },
      { token: officerToken },
    );
    assert.equal(left.status, 200, JSON.stringify(left.body));
    assert.equal(left.body.from, 'ATTESTED');

    const row = await queryOne<{ status: string; left_reason: string; left_at: Date | null }>(
      pool,
      'SELECT status, left_reason, left_at FROM taxpayer_group_members WHERE id = $1',
      [membershipId],
    );
    assert.equal(row!.status, 'LEFT');
    assert.match(row!.left_reason, /Bukuru/);
    assert.ok(row!.left_at, 'the departure should be dated');
  });

  it('stops the person counting as a member of the group', async () => {
    const { groupId, membershipId, taxpayerId } = await attestedGroupWithOneMember();

    const before = await queryOne<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM taxpayer_group_members m
        WHERE m.taxpayer_id = $1 AND m.status = 'ATTESTED'`,
      [taxpayerId],
    );
    assert.equal(before!.count, '1');

    await post(
      `/groups/${groupId}/members/${membershipId}/departure`,
      { reason: 'Left the association at the end of the season.' },
      { token: officerToken },
    );

    // The same condition allocations.ts and incentives.ts both read.
    const after = await queryOne<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM taxpayer_group_members m
        WHERE m.taxpayer_id = $1 AND m.status = 'ATTESTED'`,
      [taxpayerId],
    );
    assert.equal(after!.count, '0');
  });

  it('will not turn a leader\'s rejection into a membership that ended', async () => {
    const registered = await post(
      '/groups',
      {
        name: 'Vom Poultry Farmers',
        groupType: 'FARMERS_COOPERATIVE',
        lgaId,
        leaderName: 'Chairman Yakubu Pam',
        leaderPhone: '+2348099991002',
      },
      { token: agent.token, deviceId: agent.device },
    );
    const groupId = registered.body.groupId;
    await post(
      `/groups/${groupId}/review`,
      { decision: 'APPROVE', reason: 'Cooperative verified against the ministry register.' },
      { token: officerToken },
    );
    const taxpayerId = await taxpayer('Denied', '+2348100002011');
    await post(`/groups/${groupId}/members`, { taxpayerId }, { token: agent.token, deviceId: agent.device });

    const invited = await post(`/groups/${groupId}/attestation-request`, undefined, {
      token: officerToken,
    });
    const attestToken = String(invited.body.invitationUrl).split('/group-attestation/')[1];
    const list = await get(`/group-attestation/${attestToken}`);
    const membershipId = list.body.members[0].id;
    await post(`/group-attestation/${attestToken}/confirm`, {
      confirmedMemberIds: [],
      rejectedMemberIds: [membershipId],
      rejectionReason: 'This man has never kept birds here.',
    });

    const departed = await post(
      `/groups/${groupId}/members/${membershipId}/departure`,
      { reason: 'Tidying the list.' },
      { token: officerToken },
    );
    assert.equal(departed.status, 409, JSON.stringify(departed.body));
    assert.equal(departed.body.error.code, 'MEMBERSHIP_REJECTED');
  });

  it('cannot be recorded twice, and is not an agent\'s to record', async () => {
    const { groupId, membershipId } = await attestedGroupWithOneMember();

    const byAgent = await post(
      `/groups/${groupId}/members/${membershipId}/departure`,
      { reason: 'He does not buy from me any more.' },
      { token: agent.token, deviceId: agent.device },
    );
    assert.equal(byAgent.status, 403, JSON.stringify(byAgent.body));

    await post(
      `/groups/${groupId}/members/${membershipId}/departure`,
      { reason: 'Left the association at the end of the season.' },
      { token: officerToken },
    );
    const again = await post(
      `/groups/${groupId}/members/${membershipId}/departure`,
      { reason: 'Left the association at the end of the season.' },
      { token: officerToken },
    );
    assert.equal(again.status, 409, JSON.stringify(again.body));
    assert.equal(again.body.error.code, 'MEMBER_ALREADY_LEFT');
  });
});

// ---------------------------------------------------------------------------
// A vehicle can be taken off the register
// ---------------------------------------------------------------------------

describe('taking a vehicle out of service', () => {
  let driverSeq = 0;

  async function captureVehicle(registration: string): Promise<string> {
    driverSeq += 1;
    const person = await taxpayer('Driver', `+23481000020${20 + driverSeq}`);
    const captured = await post(
      '/vehicles',
      {
        registrationNumber: registration,
        vehicleType: 'PRIVATE',
        make: 'Toyota',
        model: 'Corolla',
        ownerName: 'Driver Member',
        taxpayerId: person,
      },
      { token: agent.token, deviceId: agent.device, idempotencyKey: `veh-${registration}` },
    );
    assert.ok(captured.status < 400, JSON.stringify(captured.body));
    return captured.body.vehicleId;
  }

  async function renew(vehicleId: string) {
    return post(
      `/vehicles/${vehicleId}/renew`,
      {
        revenueItemId: await revenueItemByCode('VEH-RENEW-PRIVATE'),
        renewalPeriodMonths: 12,
        taxpayerId: (await queryOne<{ taxpayer_id: string }>(
          pool,
          'SELECT taxpayer_id FROM vehicles WHERE id = $1',
          [vehicleId],
        ))!.taxpayer_id,
      },
      { token: agent.token, deviceId: agent.device, idempotencyKey: `rnw-${vehicleId}` },
    );
  }

  it('refuses a renewal for a vehicle that has been archived', async () => {
    const vehicleId = await captureVehicle('PL-777-ARC');

    const archived = await post(
      `/vehicles/${vehicleId}/status`,
      { status: 'ARCHIVED', reason: 'Written off after an accident on the Bauchi road.' },
      { token: officerToken },
    );
    assert.equal(archived.status, 200, JSON.stringify(archived.body));

    const renewal = await renew(vehicleId);
    assert.equal(renewal.status, 409, JSON.stringify(renewal.body));
    assert.equal(renewal.body.error.code, 'VEHICLE_NOT_IN_SERVICE');
    assert.match(renewal.body.error.message, /Bauchi road/);
  });

  it('says which of the two it is, because they are not the same news', async () => {
    const vehicleId = await captureVehicle('PL-778-SUS');

    await post(
      `/vehicles/${vehicleId}/status`,
      { status: 'SUSPENDED', reason: 'Plate reported on a second chassis.' },
      { token: officerToken },
    );

    const renewal = await renew(vehicleId);
    assert.equal(renewal.status, 409, JSON.stringify(renewal.body));
    assert.match(renewal.body.error.message, /suspended/i);
    assert.match(renewal.body.error.message, /lift/i);
  });

  it('lets an officer put a vehicle back, unlike a retired revenue item', async () => {
    const vehicleId = await captureVehicle('PL-779-BACK');

    await post(
      `/vehicles/${vehicleId}/status`,
      { status: 'ARCHIVED', reason: 'Reported scrapped.' },
      { token: officerToken },
    );
    const restored = await post(
      `/vehicles/${vehicleId}/status`,
      { status: 'ACTIVE', reason: 'The report named the wrong plate; the vehicle is on the road.' },
      { token: officerToken },
    );
    assert.equal(restored.status, 200, JSON.stringify(restored.body));

    const renewal = await renew(vehicleId);
    assert.equal(renewal.status, 201, JSON.stringify(renewal.body));
  });

  it('is refused to an agent and to an auditor, and audited when an officer does it', async () => {
    const vehicleId = await captureVehicle('PL-780-AUD');

    const byAgent = await post(
      `/vehicles/${vehicleId}/status`,
      { status: 'ARCHIVED', reason: 'Customer says it is sold.' },
      { token: agent.token, deviceId: agent.device },
    );
    assert.equal(byAgent.status, 403, JSON.stringify(byAgent.body));

    // An auditor reads everything and changes nothing.
    const byAuditor = await post(
      `/vehicles/${vehicleId}/status`,
      { status: 'ARCHIVED', reason: 'Looks wrong to me.' },
      { token: auditorToken },
    );
    assert.equal(byAuditor.status, 403, JSON.stringify(byAuditor.body));

    await post(
      `/vehicles/${vehicleId}/status`,
      { status: 'ARCHIVED', reason: 'Sold out of state and re-registered in Kaduna.' },
      { token: officerToken },
    );

    const entry = await queryOne<{ action: string; old_value: { status: string } }>(
      pool,
      `SELECT action, old_value FROM audit_logs
        WHERE entity_type = 'vehicle' AND entity_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [vehicleId],
    );
    assert.equal(entry!.action, 'vehicle.taken_out_of_service');
    assert.equal(entry!.old_value.status, 'ACTIVE');
  });

  it('needs a reason, in every direction', async () => {
    const vehicleId = await captureVehicle('PL-781-WHY');

    const bare = await api('POST', `/vehicles/${vehicleId}/status`, { status: 'ARCHIVED' }, {
      token: officerToken,
    });
    assert.equal(bare.status, 422, JSON.stringify(bare.body));
    assert.equal(bare.body.error.details[0].field, 'reason');
  });
});
