/**
 * A fraud flag about an officer, and who gets to decide it.
 *
 * Two rules flag officers rather than agents: UNUSUAL_OFFICER_ACTIVITY, and
 * FREQUENT_MANUAL_INTERVENTION, raised on whoever keeps requesting reversals,
 * refunds and corrections. Deciding a flag takes fraud:manage, which revenue
 * officers hold, and those requests come from revenue officers.
 *
 * Measured before the change: a revenue officer flagged for frequent manual
 * interventions found the flag in the flags list and dismissed it, "These
 * were all legitimate corrections" (200). The flag was recorded as DISMISSED
 * and reviewed by the officer it was about.
 *
 * The officer cannot decide it now, and neither the flags list nor the work
 * list shows them the flag. A colleague can see it and decide it.
 *
 * A case opened from the flag was not about the officer either, unless
 * whoever opened it remembered to say so: it could be assigned to them, and
 * they could read it and comment on it. The case now takes its subject from
 * the flag.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  get,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne, withTransaction } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { raiseFlag } from '../services/fraud';

const FLAGGED = '+2348030000470';
const COLLEAGUE = '+2348030000471';
const AUDITOR = '+2348030000472';

let flaggedId = '';
let flaggedToken = '';
let colleagueToken = '';
let auditorToken = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  flaggedId = await createGovernmentUser({
    role: 'revenue_officer',
    phone: FLAGGED,
    fullName: 'Flagged Officer',
  });
  await createGovernmentUser({ role: 'revenue_officer', phone: COLLEAGUE, fullName: 'Colleague' });
  flaggedToken = (await loginAs(FLAGGED)).accessToken;
  colleagueToken = (await loginAs(COLLEAGUE)).accessToken;
  await createGovernmentUser({ role: 'auditor', phone: AUDITOR, fullName: 'Case Auditor' });
  auditorToken = (await loginAs(AUDITOR)).accessToken;
});

const flagAbout = async (userId: string): Promise<string> => {
  await withTransaction((client) =>
    raiseFlag(client, {
      rule: 'FREQUENT_MANUAL_INTERVENTION',
      severity: 'MEDIUM',
      entityType: 'USER',
      entityId: userId,
      detail: { requests: 9, windowDays: 7 },
    }),
  );
  const row = await queryOne<{ id: string }>(
    pool,
    `SELECT id FROM fraud_flags WHERE entity_type = 'USER' AND entity_id = $1`,
    [userId],
  );
  return row!.id;
};

const flagRow = (id: string) =>
  queryOne<{ status: string; reviewed_by: string | null }>(
    pool,
    'SELECT status, reviewed_by FROM fraud_flags WHERE id = $1',
    [id],
  );

const listed = async (token: string, id: string) => {
  const res = await get<Array<{ id: string }>>('/government/fraud/flags', { token });
  assert.equal(res.status, 200);
  return res.body.some((f) => f.id === id);
};

const onWorkList = async (token: string, id: string) => {
  const res = await get<{ flags: Array<{ id: string }> }>('/government/my-work', { token });
  assert.equal(res.status, 200);
  return res.body.flags.some((f) => f.id === id);
};

describe('a fraud flag about the officer reviewing it', () => {
  it('cannot be dismissed by the officer it is about', async () => {
    const id = await flagAbout(flaggedId);

    const res = await post(
      `/government/fraud/flags/${id}/review`,
      { decision: 'DISMISSED', note: 'These were all legitimate corrections.' },
      { token: flaggedToken },
    );
    assert.equal(res.status, 403);
    assert.match(res.body.error.message, /about you/);

    const row = await flagRow(id);
    assert.equal(row!.status, 'OPEN');
    assert.equal(row!.reviewed_by, null);
  });

  it('cannot be taken under review by the officer it is about either', async () => {
    const id = await flagAbout(flaggedId);
    const res = await post(
      `/government/fraud/flags/${id}/review`,
      { decision: 'UNDER_REVIEW', note: 'Looking into my own activity.' },
      { token: flaggedToken },
    );
    assert.equal(res.status, 403);
    assert.equal((await flagRow(id))!.status, 'OPEN');
  });

  it('is not shown to the officer it is about, in the flags list or the work list', async () => {
    const id = await flagAbout(flaggedId);
    assert.equal(await listed(flaggedToken, id), false);
    assert.equal(await onWorkList(flaggedToken, id), false);
  });

  it('is shown to a colleague, who can decide it', async () => {
    const id = await flagAbout(flaggedId);
    assert.equal(await listed(colleagueToken, id), true);
    assert.equal(await onWorkList(colleagueToken, id), true);

    const res = await post(
      `/government/fraud/flags/${id}/review`,
      { decision: 'DISMISSED', note: 'Checked each correction against its ticket.' },
      { token: colleagueToken },
    );
    assert.equal(res.status, 200);
    const row = await flagRow(id);
    assert.equal(row!.status, 'DISMISSED');
    assert.notEqual(row!.reviewed_by, flaggedId);
  });

  it('leaves the officer able to see and decide flags about someone else', async () => {
    const colleague = await queryOne<{ id: string }>(pool, 'SELECT id FROM users WHERE phone = $1', [
      COLLEAGUE,
    ]);
    const id = await flagAbout(colleague!.id);
    assert.equal(await listed(flaggedToken, id), true);
    assert.equal(await onWorkList(flaggedToken, id), true);

    const res = await post(
      `/government/fraud/flags/${id}/review`,
      { decision: 'UNDER_REVIEW', note: 'Pulling the request history.' },
      { token: flaggedToken },
    );
    assert.equal(res.status, 200);
  });
});

describe('a case opened from a fraud flag about an officer', () => {
  const openFrom = (flagId: string, extra: Record<string, unknown> = {}) =>
    post(
      '/government/cases',
      {
        subject: 'Frequent manual interventions',
        department: 'revenue_officer',
        sourceType: 'FRAUD_FLAG',
        sourceId: flagId,
        ...extra,
      },
      { token: auditorToken },
    );

  it('is about that officer without anyone having to say so', async () => {
    const id = await flagAbout(flaggedId);
    const opened = await openFrom(id);
    assert.equal(opened.status, 201);

    const row = await queryOne<{ subject_user_id: string | null }>(
      pool,
      'SELECT subject_user_id FROM cases WHERE id = $1',
      [opened.body.id],
    );
    assert.equal(row!.subject_user_id, flaggedId);

    const read = await get(`/government/cases/${opened.body.id}`, { token: flaggedToken });
    assert.equal(read.status, 403);
    const commented = await post(
      `/government/cases/${opened.body.id}/comments`,
      { body: 'Nothing to see here, closing.' },
      { token: flaggedToken },
    );
    assert.equal(commented.status, 403);
  });

  it('cannot be assigned to the officer the flag is about', async () => {
    const id = await flagAbout(flaggedId);
    const opened = await openFrom(id, { assigneeId: flaggedId });
    assert.equal(opened.status, 400);
    assert.match(opened.body.error.message, /officer it is about/);
  });

  it('cannot name a different officer from the flag', async () => {
    const id = await flagAbout(flaggedId);
    const colleague = await queryOne<{ id: string }>(pool, 'SELECT id FROM users WHERE phone = $1', [
      COLLEAGUE,
    ]);
    const opened = await openFrom(id, { subjectUserId: colleague!.id });
    assert.equal(opened.status, 400);
  });

  it('has to come from a flag that exists', async () => {
    const opened = await openFrom('00000000-0000-4000-8000-000000000000');
    assert.equal(opened.status, 404);
  });
});
