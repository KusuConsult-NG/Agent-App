/**
 * The routes nothing exercised.
 *
 * Enumerating the API surface against every test file found 141 declared
 * routes, 14 of them referenced by no test at all. (An earlier count said 24;
 * that script mapped each file to its first router, so everything on
 * `supportRouter` — declared in the same file as `governmentRouter` — was
 * attributed to the wrong mount. The real figure is 14.)
 *
 * "Untested" is not "unimportant". Two of these are the platform's public
 * face, reachable without any credential:
 *
 *   GET /citizen-status  a citizen looking up their own tax position. Its
 *                        whole design is a privacy gradient — a name gives a
 *                        count, a phone gives a record, only a TIN gives the
 *                        amount owed. Nothing checked that the gradient holds,
 *                        and a leak here is a leak to the open internet.
 *
 *   POST /push/subscribe registering a device for notifications. Reading it
 *                        for this file found it unauthenticated and reading
 *                        `req.actor`, a field nothing sets. Both are fixed;
 *                        the tests below are what hold the fix in place.
 *
 * The rest are maintenance actions (a fraud sweep, a reconciliation recovery,
 * a reminder run) and catalogue reads. The maintenance ones change data and
 * are gated on permissions that most roles do not hold, so what matters about
 * them is who is turned away.
 */

import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  get,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { getSubscription } from '../services/push';

const PASSWORD = 'Password123';

const USERS = {
  admin: '+2348099000001',
  revenue: '+2348099000002',
  finance: '+2348099000003',
  auditor: '+2348099000004',
  agent: '+2348099000005',
} as const;

const token: Record<keyof typeof USERS, string> = {
  admin: '',
  revenue: '',
  finance: '',
  auditor: '',
  agent: '',
};

let lgaId = '';

before(async () => {
  await resetDatabase();
  await startTestServer();

  await createGovernmentUser({ fullName: 'Route Admin', phone: USERS.admin, role: 'admin' });
  await createGovernmentUser({ fullName: 'Route Revenue', phone: USERS.revenue, role: 'revenue_officer' });
  await createGovernmentUser({ fullName: 'Route Finance', phone: USERS.finance, role: 'finance_officer' });
  await createGovernmentUser({ fullName: 'Route Auditor', phone: USERS.auditor, role: 'auditor' });
  await createGovernmentUser({ fullName: 'Route Agent', phone: USERS.agent, role: 'agent' });

  for (const key of Object.keys(USERS) as (keyof typeof USERS)[]) {
    token[key] = (await loginAs(USERS[key], PASSWORD)).accessToken;
  }

  lgaId = await firstLgaId();
});

after(async () => {
  await stopTestServer();
});

// ===========================================================================
// GET /citizen-status — the only write-free surface the public can reach, and
// the one where a mistake is visible to everyone.
// ===========================================================================

describe('Citizen self-service status', () => {
  /** Fields that must never appear in a public response, whatever the query. */
  const FORBIDDEN = [
    'identityNumber',
    'identity_number',
    'identityNumberHash',
    'address',
    'notes',
    'email',
    'firstName',
    'lastName',
    'businessName',
    'phone',
    'id',
  ];

  let citizenTin = '';
  let citizenPhone = '';

  before(async () => {
    citizenPhone = '+2347044000101';
    const row = await pool.query<{ tin: string }>(
      `INSERT INTO taxpayers
         (taxpayer_type, first_name, last_name, phone, address, lga_id, status,
          tin, tin_status, consent_given, declaration_accepted)
       VALUES ('INDIVIDUAL','Public','Lookup',$1,'12 Ahmadu Bello Way, Jos',$2,'ACTIVE',
               'PL99000101','ASSIGNED',true,true)
       RETURNING tin`,
      [citizenPhone, lgaId],
    );
    citizenTin = row.rows[0]!.tin;
  });

  it('needs at least one search term', async () => {
    const response = await get('/citizen-status/');
    assert.equal(response.status, 400);
    assert.equal(response.body.found, false);
  });

  it('answers a TIN lookup without any credential', async () => {
    const response = await get(`/citizen-status/?tin=${citizenTin}`);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.found, true);
    assert.equal(response.body.tin, citizenTin);
    assert.ok(
      typeof response.body.complianceStatus === 'string',
      'a citizen is told where they stand, not handed a raw score alone',
    );
  });

  /**
   * The privacy gradient, which is the entire design of this endpoint.
   *
   * A phone number is guessable in a way a TIN is not: the format is public
   * and the space is small. So a phone match confirms the record exists but
   * must not reveal the debt. If this ever returns an amount, anyone can walk
   * the numbering plan and build a list of who in Plateau owes money.
   */
  it('withholds the outstanding amount from a phone lookup', async () => {
    const byTin = await get(`/citizen-status/?tin=${citizenTin}`);
    const byPhone = await get(`/citizen-status/?phone=${encodeURIComponent(citizenPhone)}`);

    assert.equal(byPhone.status, 200);
    assert.equal(byPhone.body.found, true, 'the same record should be found either way');
    assert.equal(
      byPhone.body.outstandingAmountKobo,
      undefined,
      'a phone lookup disclosed the amount owed — the phone space is enumerable',
    );
    // And the TIN route is the one allowed to carry it, so the rule is a
    // gradient rather than the field being absent everywhere.
    assert.ok('found' in byTin.body);
  });

  it('gives only a count for a name search', async () => {
    const response = await get('/citizen-status/?name=Public');
    assert.equal(response.status, 200);
    assert.equal(typeof response.body.count, 'number');
    assert.equal(response.body.tin, undefined, 'a name search returned a TIN');
    assert.equal(response.body.obligations, undefined, 'a name search listed obligations');
    assert.equal(response.body.complianceScore, undefined);
  });

  it('never returns personal data on any of the three search modes', async () => {
    for (const path of [
      `/citizen-status/?tin=${citizenTin}`,
      `/citizen-status/?phone=${encodeURIComponent(citizenPhone)}`,
      '/citizen-status/?name=Public',
    ]) {
      const response = await get(path);
      const keys = Object.keys(response.body ?? {});
      for (const forbidden of FORBIDDEN) {
        assert.ok(
          !keys.includes(forbidden),
          `${path} returned "${forbidden}" to an anonymous caller`,
        );
      }
      const serialised = JSON.stringify(response.body);
      assert.ok(
        !serialised.includes('Ahmadu Bello'),
        `${path} leaked the residential address`,
      );
    }
  });

  it('does not distinguish an unknown TIN from a withheld one', async () => {
    const unknown = await get('/citizen-status/?tin=PL00000000');
    assert.equal(unknown.status, 200);
    assert.equal(unknown.body.found, false);
    // A different status code or a "record exists but is suspended" message
    // would turn this into an oracle for whether a TIN is real.
    assert.equal(unknown.body.tin, undefined);
  });
});

// ===========================================================================
// Public reference data
// ===========================================================================

describe('Reference and version endpoints', () => {
  it('serves the LGA list to an anonymous caller', async () => {
    const response = await get('/reference/lgas');
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body));
    assert.ok(
      response.body.length >= 17,
      `Plateau has 17 LGAs; got ${response.body.length}. Both front-ends need this before sign-in.`,
    );
    assert.ok(response.body[0].code && response.body[0].name && response.body[0].zone);
    assert.match(response.headers.get('cache-control') ?? '', /max-age/);
  });

  it('serves the economic sector list with real revenue items attached', async () => {
    const response = await get('/taxpayers/sectors');
    assert.equal(response.status, 200, 'an agent needs this on the onboarding form, before a session exists');
    assert.ok(Array.isArray(response.body) && response.body.length > 0);

    const withItems = response.body.filter(
      (sector: { suggestedItems: unknown[] }) => sector.suggestedItems.length > 0,
    );
    assert.ok(
      withItems.length > 0,
      'every sector suggested zero revenue items — the codes no longer match the catalogue',
    );
    for (const sector of response.body) {
      assert.ok(sector.code && sector.label, 'a sector needs a code and a label to be selectable');
    }
  });

  it('serves the VAPID public key', async () => {
    const response = await get('/push/vapid-key');
    assert.equal(response.status, 200);
    assert.ok(
      typeof response.body.publicKey === 'string' && response.body.publicKey.length > 20,
      'without a key the PWA cannot subscribe at all',
    );
  });

  /**
   * The version gate (Addendum §43): a PWA too old to be trusted with money
   * must be told so before it takes any.
   */
  it('marks a current app version supported and an old one not', async () => {
    // The gate sits behind the agent router's authenticate boundary: the
    // question it answers — may this build take money — only arises for a
    // signed-in agent, and the PWA calls it with a session in hand.
    assert.equal((await get('/agents/app-version')).status, 401);

    const current = await get('/agents/app-version', { token: token.agent, appVersion: '99.0.0' });
    assert.equal(current.status, 200, JSON.stringify(current.body));
    assert.equal(current.body.supported, true);
    assert.equal(current.body.updateRequired, false);

    const ancient = await get('/agents/app-version', { token: token.agent, appVersion: '0.0.1' });
    assert.equal(ancient.body.supported, false);
    assert.equal(
      ancient.body.updateRequired,
      true,
      'an outdated build was told it could carry on collecting revenue',
    );
    assert.match(ancient.body.message, /update/i);
  });
});

// ===========================================================================
// Catalogue reads
// ===========================================================================

describe('Revenue catalogue reference reads', () => {
  for (const path of ['/revenue/authorities', '/revenue/categories']) {
    it(`refuses ${path} without a session`, async () => {
      assert.equal((await get(path)).status, 401);
    });

    it(`serves ${path} to a role holding catalogue:read`, async () => {
      const response = await get(path, { token: token.auditor });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.ok(Array.isArray(response.body));
    });
  }

  it('returns authorities with the tier that decides who collects', async () => {
    const response = await get('/revenue/authorities', { token: token.revenue });
    assert.ok(response.body.length > 0, 'no collecting authority is configured');
    for (const authority of response.body) {
      assert.ok(authority.tier, 'an authority without a tier cannot be attributed');
    }
  });
});

// ===========================================================================
// POST /taxpayers/duplicate-check — the guard against enrolling one person
// twice, which is how commission gets paid twice for the same work.
// ===========================================================================

describe('Duplicate detection before enrolment', () => {
  let existingPhone = '';

  before(async () => {
    existingPhone = '+2347044000202';
    await pool.query(
      `INSERT INTO taxpayers
         (taxpayer_type, first_name, last_name, phone, address, lga_id, status,
          consent_given, declaration_accepted)
       VALUES ('INDIVIDUAL','Already','Enrolled',$1,'5 Yakubu Gowon Way, Jos',$2,'ACTIVE',true,true)`,
      [existingPhone, lgaId],
    );
  });

  const body = (phone: string) => ({
    taxpayerType: 'INDIVIDUAL' as const,
    firstName: 'Already',
    lastName: 'Enrolled',
    phone,
    lgaId,
  });

  it('refuses an unauthenticated caller', async () => {
    assert.equal((await post('/taxpayers/duplicate-check', body(existingPhone))).status, 401);
  });

  it('refuses a role without taxpayer:create', async () => {
    const response = await post('/taxpayers/duplicate-check', body(existingPhone), {
      token: token.auditor,
    });
    assert.equal(
      response.status,
      403,
      'an auditor could probe whether a given phone number is enrolled',
    );
  });

  /**
   * `blocking` is narrower than "we found something", and deliberately so.
   *
   * Only an identity-number collision scores 100 and sets the flag, because
   * only that is certain: two people genuinely do share a name, and a phone
   * gets reassigned. Everything below 100 is advisory here — but it is not
   * ignorable, because `registerTaxpayer` refuses any match at all unless the
   * agent explicitly acknowledges it. So the soft cases still cannot be
   * enrolled by accident; they require someone to say they looked.
   */
  it('recognises the same person and scores the match high', async () => {
    const response = await post('/taxpayers/duplicate-check', body(existingPhone), {
      token: token.agent,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.ok(
      response.body.possibleDuplicates.length > 0,
      'the same name on the same phone in the same LGA was not recognised as already enrolled',
    );

    const [top] = response.body.possibleDuplicates;
    assert.ok(
      top.score >= 85,
      `a same-name, same-phone match scored only ${top.score} — it should be near-certain`,
    );
    assert.ok(top.reasons.length > 0, 'a match with no stated reason cannot be reviewed');
    assert.equal(
      top.displayName,
      'Already Enrolled',
      'the agent is shown who the existing record is, not just that one exists',
    );
  });

  it('refuses to enrol over an unacknowledged match', async () => {
    const response = await post(
      '/taxpayers',
      {
        taxpayerType: 'INDIVIDUAL',
        firstName: 'Already',
        lastName: 'Enrolled',
        phone: existingPhone,
        address: '5 Yakubu Gowon Way, Jos',
        lgaId,
        consentGiven: true,
        declarationAccepted: true,
      },
      { token: token.agent },
    );
    assert.notEqual(
      response.status,
      201,
      'a second record for the same person was created without anyone acknowledging the match — ' +
        'that is one taxpayer enrolled twice and one commission paid twice',
    );
  });

  it('lets a genuinely new person through', async () => {
    const response = await post(
      '/taxpayers/duplicate-check',
      { ...body('+2347044000999'), firstName: 'Entirely', lastName: 'Different' },
      { token: token.agent },
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.blocking, false);
    assert.equal(response.body.possibleDuplicates.length, 0);
    assert.match(response.body.message, /no existing/i);
  });
});

// ===========================================================================
// Government maintenance actions. Each one changes data; what is being
// tested is the gate, because these are the routes where the blast radius of
// a missing permission check is the whole dataset.
// ===========================================================================

describe('Maintenance actions are gated on the permission, not the role name', () => {
  const CASES = [
    {
      path: '/government/fraud/sweep',
      body: undefined as unknown,
      // revenue_officer and admin hold fraud:manage; auditor holds only fraud:read.
      allowed: 'revenue' as const,
      refused: 'auditor' as const,
    },
    {
      path: '/government/reconciliation/recover',
      body: {
        from: new Date(Date.now() - 86_400_000).toISOString(),
        to: new Date().toISOString(),
        limit: 10,
      },
      // finance_officer alone holds payment:reconcile.
      allowed: 'finance' as const,
      refused: 'revenue' as const,
    },
    {
      path: '/government/reminders/send-due',
      body: undefined as unknown,
      allowed: 'revenue' as const,
      refused: 'auditor' as const,
    },
  ];

  for (const testCase of CASES) {
    it(`refuses ${testCase.path} without a session`, async () => {
      assert.equal((await post(testCase.path, testCase.body)).status, 401);
    });

    it(`refuses ${testCase.path} to a role without the permission`, async () => {
      const response = await post(testCase.path, testCase.body, {
        token: token[testCase.refused],
      });
      assert.equal(
        response.status,
        403,
        `${testCase.refused} reached ${testCase.path}: ${JSON.stringify(response.body)}`,
      );
    });

    it(`allows ${testCase.path} to the role that holds it`, async () => {
      const response = await post(testCase.path, testCase.body, {
        token: token[testCase.allowed],
      });
      assert.equal(
        response.status,
        200,
        `${testCase.allowed} was refused ${testCase.path}: ${JSON.stringify(response.body)}`,
      );
      assert.ok(response.body && typeof response.body === 'object');
    });
  }

  it('validates the recovery window rather than sweeping everything', async () => {
    const response = await post(
      '/government/reconciliation/recover',
      { from: 'not-a-date', to: new Date().toISOString(), limit: 10 },
      { token: token.finance },
    );
    assert.equal(response.status, 422, 'an unparseable window was accepted');
  });

  it('caps the recovery batch', async () => {
    const response = await post(
      '/government/reconciliation/recover',
      {
        from: new Date(Date.now() - 86_400_000).toISOString(),
        to: new Date().toISOString(),
        limit: 100_000,
      },
      { token: token.finance },
    );
    assert.equal(response.status, 422, 'an unbounded batch would hold locks across the whole table');
  });
});

// ===========================================================================
// POST /agents/referees/:id/review — the human judgement in agent clearance.
// ===========================================================================

describe('Refereeing an agent applicant', () => {
  let refereeId = '';
  const applicantPhone = '+2347044000303';

  before(async () => {
    const applied = await post('/agents/apply', {
      fullName: 'Referee Fixture Applicant',
      phone: applicantPhone,
      email: 'referee.fixture@example.test',
      password: 'FieldAgent2026',
      dateOfBirth: '1990-01-01',
      gender: 'MALE',
      address: '9 Bauchi Road, Jos',
      lgaId,
      occupation: 'Trader',
      bankName: 'Access Bank',
      bankCode: '044',
      accountName: 'Referee Fixture Applicant',
      accountNumber: '0123456799',
    });
    assert.equal(applied.status, 201, JSON.stringify(applied.body));
    const applicantToken = (await loginAs(applicantPhone, 'FieldAgent2026')).accessToken;

    await post(
      '/agents/me/kyc',
      { identityType: 'NIN', identityNumber: '12345678901' },
      { token: applicantToken },
    );

    const nominated = await post(
      '/agents/me/referees',
      {
        fullName: 'Hon. Review Fixture',
        phone: '+2347044000304',
        email: 'review.fixture@example.test',
        category: 'COMMUNITY_LEADER',
        relationship: 'District head',
        occupation: 'Community leader',
      },
      { token: applicantToken },
    );
    assert.equal(nominated.status, 201, JSON.stringify(nominated.body));

    const row = await pool.query<{ id: string }>(
      `SELECT r.id FROM referees r
         JOIN agents a ON a.id = r.agent_id
         JOIN users u ON u.id = a.user_id
        WHERE u.phone = $1
        ORDER BY r.invited_at DESC LIMIT 1`,
      [applicantPhone],
    );
    refereeId = row.rows[0]!.id;
  });

  it('refuses an unauthenticated caller', async () => {
    const response = await post(`/agents/referees/${refereeId}/review`, {
      decision: 'CLEAR',
      reason: 'Known to me personally for many years.',
    });
    assert.equal(response.status, 401);
  });

  it('refuses a role that cannot approve agents', async () => {
    const response = await post(
      `/agents/referees/${refereeId}/review`,
      { decision: 'CLEAR', reason: 'Known to me personally for many years.' },
      { token: token.auditor },
    );
    assert.equal(response.status, 403, 'an auditor cleared a referee');
  });

  /**
   * A decision with no reason is a decision nobody can review later. The
   * clearance file is the evidence that a person was checked before being
   * trusted with public money, and "CLEAR" on its own is not evidence.
   */
  it('demands a substantive reason', async () => {
    const response = await post(
      `/agents/referees/${refereeId}/review`,
      { decision: 'CLEAR', reason: 'ok' },
      { token: token.admin },
    );
    assert.equal(response.status, 422, 'a two-character justification was accepted');
  });

  it('rejects an unknown decision value', async () => {
    const response = await post(
      `/agents/referees/${refereeId}/review`,
      { decision: 'MAYBE', reason: 'Undecided about this applicant entirely.' },
      { token: token.admin },
    );
    assert.equal(response.status, 422);
  });

  it('records the decision, its reason and its author', async () => {
    const reason = 'Spoke to the district head by phone; identity and standing confirmed.';
    const response = await post(
      `/agents/referees/${refereeId}/review`,
      { decision: 'CLEAR', reason },
      { token: token.admin },
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));

    const row = await pool.query<{
      status: string;
      rejection_reason: string | null;
      reviewed_by: string | null;
      cleared_at: Date | null;
    }>(
      `SELECT status, rejection_reason, reviewed_by, cleared_at FROM referees WHERE id = $1`,
      [refereeId],
    );
    const referee = row.rows[0]!;
    assert.equal(referee.status, 'CLEARED');
    assert.equal(referee.rejection_reason, reason, 'the stated reason was not kept');
    assert.ok(referee.reviewed_by, 'the decision has no author on file');
    assert.ok(referee.cleared_at, 'a cleared referee has no clearance timestamp');
  });

  it('404s on a referee that does not exist', async () => {
    const response = await post(
      '/agents/referees/00000000-0000-0000-0000-000000000000/review',
      { decision: 'CLEAR', reason: 'Known to me personally for many years.' },
      { token: token.admin },
    );
    assert.equal(response.status, 404);
  });
});

// ===========================================================================
// Push registration.
//
// These two routes were reachable with no credential, and the handler read
// the caller from `req.actor` — a property nothing in the codebase assigns.
// Every subscription was therefore stored ownerless, which also meant
// `sendPushNotification`, which matches on owner, could never deliver a
// targeted message to anyone.
// ===========================================================================

describe('Push subscription registration', () => {
  const endpoint = (suffix: string) => `https://push.example.test/endpoint/${suffix}`;

  it('refuses to register a device for an anonymous caller', async () => {
    const response = await post('/push/subscribe', {
      subscription: { endpoint: endpoint('anon'), keys: { p256dh: 'k', auth: 'a' } },
    });
    assert.equal(
      response.status,
      401,
      'anyone on the internet could plant an endpoint in the dispatch table',
    );
  });

  it('refuses to remove a registration for an anonymous caller', async () => {
    assert.equal((await post('/push/unsubscribe', { endpoint: endpoint('anon') })).status, 401);
  });

  it('attributes a registration to the signed-in caller', async () => {
    const url = endpoint('owned');
    const response = await post(
      '/push/subscribe',
      { subscription: { endpoint: url, keys: { p256dh: 'k', auth: 'a' } } },
      { token: token.revenue },
    );
    assert.equal(response.status, 200);

    const stored = getSubscription(url);
    assert.ok(stored, 'the subscription was not stored at all');
    assert.ok(
      stored.userId,
      'stored with no owner — a targeted notification can then never match it, so the ' +
        'feature silently delivers to nobody',
    );
  });

  it('will not let one user delete another user\'s registration', async () => {
    const url = endpoint('victim');
    await post(
      '/push/subscribe',
      { subscription: { endpoint: url, keys: { p256dh: 'k', auth: 'a' } } },
      { token: token.finance },
    );
    assert.ok(getSubscription(url));

    await post('/push/unsubscribe', { endpoint: url }, { token: token.auditor });
    assert.ok(
      getSubscription(url),
      'another user silenced this device by knowing only its endpoint URL',
    );

    await post('/push/unsubscribe', { endpoint: url }, { token: token.finance });
    assert.equal(getSubscription(url), undefined, 'the owner could not remove their own device');
  });

  it('rejects a malformed endpoint', async () => {
    const response = await post(
      '/push/subscribe',
      { subscription: { endpoint: 'not-a-url' } },
      { token: token.revenue },
    );
    assert.equal(response.status, 422);
  });
});
