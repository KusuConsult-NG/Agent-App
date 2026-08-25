/**
 * The declarations the API states and the ones the referee reads must match.
 *
 * `GET /referee/:token` returns four English sentences and the portal used to
 * render whatever came back, which left the only part of that page with a
 * stated legal consequence permanently in English. The portal now renders them
 * from its own dictionary so they can be read in Hausa.
 *
 * That introduces a way for the two to drift. `POST /referee/:token/respond`
 * takes four booleans — confirmsKnowsApplicant, confirmsInformationAccurate,
 * willingToActAsReferee, understandsConsequences — and records nothing about
 * the words. If the API's list changes, or is reordered, the portal goes on
 * showing the old sentences beside the new checkboxes and the referee agrees
 * to something nobody has told them.
 *
 * So the count and the order are pinned on both sides. The English wording is
 * pinned too: the portal's English must remain what the API says, because that
 * is the text an officer reviewing the response, or a court, would be shown.
 */

import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import {
  createGovernmentUser,
  firstLgaId,
  get,
  loginAs,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { seedReferenceData } from '../db/seed';
import { getTranslation } from '@psirs/shared';

function workspaceRoot(): string {
  let directory = process.cwd();
  for (;;) {
    const manifest = join(directory, 'package.json');
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { workspaces?: unknown };
      if (parsed.workspaces) return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error('no workspace root above ' + process.cwd());
    directory = parent;
  }
}

/** The order the portal renders, read from its source rather than restated. */
function portalDeclarationKeys(): string[] {
  const source = readFileSync(
    join(workspaceRoot(), 'apps/portal/src/screens/Public.tsx'),
    'utf8',
  );
  const block = /const DECLARATION_KEYS = \[([\s\S]*?)\] as const;/.exec(source);
  assert.ok(block, 'the portal no longer declares DECLARATION_KEYS');
  return [...block![1].matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

let invitationToken = '';

before(async () => {
  await startTestServer();
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Dec Admin', phone: '+2348000000130', role: 'admin' });

  const lgaId = await firstLgaId();
  const application = await post('/agents/apply', {
    fullName: 'Declaration Applicant',
    phone: '+2347055000030',
    password: 'FieldAgent2026',
    address: '1 Test Street, Jos',
    lgaId,
    bankName: 'Access Bank',
    bankCode: '044',
    accountName: 'Declaration Applicant',
    accountNumber: '0123456781',
  });
  assert.equal(application.status, 201, JSON.stringify(application.body));

  const token = (await loginAs('+2347055000030', 'FieldAgent2026')).accessToken;
  const referee = await post(
    '/agents/me/referees',
    {
      fullName: 'Declaration Referee',
      phone: '+2347066000030',
      category: 'COMMUNITY_LEADER',
      relationship: 'Community leader who knows the applicant',
    },
    { token },
  );
  assert.equal(referee.status, 201, JSON.stringify(referee.body));
  invitationToken = (referee.body.invitationUrl as string).split('/referee/')[1]!;
});

after(async () => {
  await stopTestServer();
});

describe('what the referee ticks is what the API asked', () => {
  it('renders one declaration per statement the API sends, in the same order', async () => {
    const invitation = await get(`/referee/${invitationToken}`);
    assert.equal(invitation.status, 200, JSON.stringify(invitation.body));

    const fromApi = invitation.body.declarations as string[];
    const keys = portalDeclarationKeys();

    assert.equal(
      keys.length,
      fromApi.length,
      `the API sends ${fromApi.length} declarations and the portal renders ${keys.length}`,
    );

    const english = getTranslation('en');
    for (const [index, key] of keys.entries()) {
      assert.equal(
        english[key as keyof typeof english],
        fromApi[index],
        `declaration ${index + 1} differs. The API says "${fromApi[index]}" and the portal ` +
          `shows "${english[key as keyof typeof english]}" — the checkbox beside it records ` +
          `the API's meaning, so the referee would be agreeing to something they were not shown.`,
      );
    }
  });

  it('has a Hausa rendering for every one of them', () => {
    const hausa = getTranslation('ha');
    const english = getTranslation('en');
    for (const key of portalDeclarationKeys()) {
      const k = key as keyof typeof hausa;
      assert.ok(hausa[k]?.trim(), `${key} has no Hausa`);
      assert.notEqual(
        hausa[k].trim(),
        english[k].trim(),
        `${key} is English passed off as Hausa`,
      );
    }
  });
});
