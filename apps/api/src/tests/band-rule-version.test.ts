/**
 * The floor that stops an old handset telling a trader the wrong size.
 *
 * The agent's phone works out a band at the stall so a trader gets an answer
 * with no signal. That is only safe while the phone's arithmetic is the
 * platform's arithmetic, and a handset in Wase may not have seen an update in
 * a month. `BAND_RULE_SINCE` is the version the current rule shipped in, and
 * a build below it is refused the one act that depends on the rule.
 *
 * TWO PROPERTIES, AND THE SECOND IS THE ONE THAT LASTS.
 *
 * The first is that the gate refuses. The second is that the floor cannot be
 * left behind: the rule's whole behaviour is fingerprinted here, and changing
 * `bandFor` without raising `BAND_RULE_SINCE` fails this file. A version floor
 * somebody forgot to raise is worse than none — it reads as a guarantee and
 * holds nothing, and the failure it lets through is invisible until a taxpayer
 * complains that the agent said something else.
 */

import './env';
import { createHash } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BAND_RULE_SINCE,
  bandFor,
  compareVersions,
  type Premises,
} from '@psirs/shared';
import {
  createGovernmentUser,
  loginAs,
  post,
  pool,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { adoptNanoPolicy, classifyLga, publishScheduleEntry } from '../services/presumptive';

const PREMISES: Premises[] = ['NONE', 'STALL', 'KIOSK', 'LOCK_UP_SHOP', 'BUILDING'];

/**
 * Every answer the rule gives, over the whole range that can change one.
 *
 * Counts to 12 because the highest threshold in the rule is 10; anything
 * beyond that is the same answer repeated, and a fingerprint padded with
 * repetition hides a change at the edge rather than catching it.
 */
function fingerprintOfTheRule(): string {
  const answers: string[] = [];
  for (const premises of PREMISES) {
    for (let equipment = 0; equipment <= 12; equipment += 1) {
      for (let people = 0; people <= 12; people += 1) {
        answers.push(`${premises}/${equipment}/${people}=${bandFor({
          premises,
          equipmentCount: equipment,
          peopleWorking: people,
        })}`);
      }
    }
  }
  return createHash('sha256').update(answers.join('\n')).digest('hex').slice(0, 16);
}

/**
 * The fingerprint of the rule as it stands, and the version it shipped in.
 *
 * Both move together or neither does. If this test fails, the rule changed:
 * raise `BAND_RULE_SINCE` in `packages/shared/src/banding.ts` to the app
 * version that will carry the new rule, put the new fingerprint here, and
 * every handset still running the old arithmetic stops being able to tell a
 * trader anything.
 */
const RULE = { since: '1.0.0', fingerprint: '5581239cfd76a0c7' };

describe('the band rule and the floor that goes with it', () => {
  it('has not changed without the floor being raised', () => {
    assert.equal(
      fingerprintOfTheRule(),
      RULE.fingerprint,
      'The band rule changed. Raise BAND_RULE_SINCE to the app version carrying the new ' +
        'rule and update RULE here, or handsets in the field will keep telling traders ' +
        'the old answer.',
    );
    assert.equal(
      BAND_RULE_SINCE,
      RULE.since,
      'BAND_RULE_SINCE moved without the rule changing, or the record here was not kept up.',
    );
  });

  it('is a floor a real build can actually be below', () => {
    // A floor nothing can fall under is a decoration. Pinned so that setting
    // it to something impossible — '0.0.0' — is a failure rather than a quiet
    // disabling of the gate.
    assert.ok(compareVersions(BAND_RULE_SINCE, '0.0.1') > 0);
  });
});

describe('enumerating from a handset', () => {
  let auth: { token: string; deviceId: string };
  let officerId: string;
  let taxpayerId: string;

  before(async () => { await startTestServer(); });
  after(async () => { await stopTestServer(); });

  beforeEach(async () => {
    await resetDatabase();
    await seedReferenceData();
    officerId = await createGovernmentUser({
      fullName: 'Assessing Officer',
      phone: '+2348000000001',
      role: 'admin',
    });
    const lgaId = (await queryOne<{ id: string }>(pool, 'SELECT id FROM lgas ORDER BY name LIMIT 1', []))!.id;
    await adoptNanoPolicy(pool, {
      construction: 'CONJUNCTIVE',
      turnoverCeilingKobo: '1200000000',
      legalBasis: 'Opinion of the Attorney-General of Plateau State, 12 January 2026',
      effectiveFrom: '2026-01-01',
      actorId: officerId,
      actorRole: 'admin',
    });
    await classifyLga(pool, {
      lgaId,
      classCode: 'A',
      indexInputs: { roadAccess: 'paved' },
      indexSource: 'National Bureau of Statistics',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2029-01-01',
      actorId: officerId,
      actorRole: 'admin',
    });
    await publishScheduleEntry(pool, {
      economicSector: 'ARTISAN_CRAFT',
      sizeBand: 'SMALL',
      lgaClass: 'A',
      assumedAnnualTurnoverKobo: '1800000000',
      instrumentReference: 'Plateau State Revenue (Presumptive Assessment) Regulation 2026',
      effectiveFrom: '2026-01-01',
      actorId: officerId,
      actorRole: 'admin',
    });

    const demo = await seedDemoAgent();
    const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
    auth = { token: session.accessToken, deviceId: demo!.deviceIdentifier };

    const registered = await post(
      '/taxpayers',
      {
        taxpayerType: 'INDIVIDUAL',
        firstName: 'Amina',
        lastName: 'Bulus',
        phone: '+2348044400001',
        address: '7 Terminus Market, Jos',
        lgaId,
        economicSector: 'ARTISAN_CRAFT',
        consentGiven: true,
        declarationAccepted: true,
      },
      { ...auth, idempotencyKey: 'band-gate-tp-1' },
    );
    taxpayerId = registered.body.taxpayerId;
  });

  const capture = {
    premises: 'LOCK_UP_SHOP',
    equipmentCount: 3,
    peopleWorking: 2,
    economicSector: 'ARTISAN_CRAFT',
  };

  it('refuses a build older than the rule it is showing sizes from', async () => {
    const response = await post(
      '/government/enumeration/observations',
      { taxpayerId, ...capture, bandAtCapture: 'MICRO' },
      { ...auth, appVersion: '0.9.9' },
    );

    assert.equal(response.status, 426, JSON.stringify(response.body));
    assert.equal(response.body.error.code, 'UPDATE_REQUIRED_TO_ENUMERATE');
    assert.match(response.body.error.message, /old rule/i);

    const written = await queryOne<{ count: string }>(
      pool,
      'SELECT count(*)::text AS count FROM presumptive_observations WHERE taxpayer_id = $1',
      [taxpayerId],
    );
    assert.equal(written!.count, '0', 'and nothing was recorded from the refused capture');
  });

  it('refuses a handset that names no version at all', async () => {
    // An absent header is not an old build being honest, it is a caller that
    // is not the app. Treated as below the floor rather than waved through.
    const response = await post(
      '/government/enumeration/observations',
      { taxpayerId, ...capture },
      { ...auth, appVersion: '' },
    );
    assert.equal(response.status, 426, JSON.stringify(response.body));
  });

  it('accepts a build at the floor', async () => {
    const response = await post(
      '/government/enumeration/observations',
      { taxpayerId, ...capture, bandAtCapture: 'SMALL' },
      { ...auth, appVersion: BAND_RULE_SINCE },
    );
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.sizeBand, 'SMALL');
  });

  it('does not gate an officer, whose portal is not the handset', async () => {
    /*
     * The floor is about a build in somebody's pocket that has not seen an
     * update in a month. The portal is served with the API and is whatever
     * was last deployed, and it carries its own version — which is not the
     * PWA's and has no reason to march in step with it. Gating officers on
     * the handset's floor would stop market visits being recorded because a
     * phone build somewhere else was old.
     */
    const officer = await loginAs('+2348000000001');
    const response = await post(
      '/government/enumeration/observations',
      { taxpayerId, ...capture },
      { token: officer.accessToken, appVersion: '0.0.1' },
    );
    assert.equal(response.status, 201, JSON.stringify(response.body));
  });

  it('still takes the queue from an old handset, so field work is not stranded', async () => {
    /*
     * The capture in the queue was taken before anything could stop it, and
     * its facts are as good as any — what is stale is only the size the agent
     * was shown. Refusing the sync would strand real work on a phone to punish
     * a display, and the platform reaches its own band from those facts
     * anyway.
     */
    const response = await post(
      '/drafts/sync',
      {
        drafts: [
          {
            clientReference: 'old-build-observation-000001',
            draftType: 'BUSINESS_OBSERVATION',
            capturedAt: new Date(Date.now() - 86_400_000).toISOString(),
            payload: { taxpayerId, ...capture, bandAtCapture: 'MICRO' },
          },
        ],
      },
      { ...auth, appVersion: '0.9.9' },
    );

    assert.equal(response.status, 200, JSON.stringify(response.body));
    const [result] = response.body.results;
    assert.equal(result.status, 'SYNCED', JSON.stringify(result));

    const stored = await queryOne<{ band_at_capture: string }>(
      pool,
      'SELECT band_at_capture FROM presumptive_observations WHERE id = $1',
      [result.entityId],
    );
    assert.equal(stored!.band_at_capture, 'MICRO', 'what the old build showed is kept');

    const flagged = await queryOne<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM audit_logs
        WHERE entity_id = $1 AND action = 'observation.band_disagreed_with_handset'`,
      [result.entityId],
    );
    assert.equal(flagged!.count, '1', 'and the trader having been told otherwise is on record');
  });
});
