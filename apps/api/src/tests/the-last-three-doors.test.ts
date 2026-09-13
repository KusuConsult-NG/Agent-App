/**
 * The last three routes no test had ever called.
 *
 * Coverage, not a fix. With these, `route-coverage.mjs` reports 281 of 281.
 *
 *   POST /government/presumptive/band
 *   GET  /government/consumption-tax/not-paying
 *   POST /government/cases/:id/evidence/upload
 *
 * Being unexercised was never evidence that a route was wrong -- but the PAYE
 * cancellation defect and the overlap-refusal defect both came off this list,
 * so the argument for emptying it is that nothing else was going to say when
 * one of them broke.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  apiBaseUrl,
  createGovernmentUser,
  get,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';

const ADMIN = '+2348077600001';
const SUPERVISOR = '+2348077600002';

let officerId = '';
let adminToken = '';
let supervisorToken = '';
let homeLga = '';
let otherLga = '';
let seq = 0;

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  seq = 0;

  officerId = await createGovernmentUser({ fullName: 'Doors Admin', phone: ADMIN, role: 'admin' });
  adminToken = (await loginAs(ADMIN)).accessToken;

  const seeded = await queryOne<{ id: string; lga_id: string }>(
    pool,
    "SELECT id, lga_id FROM territories WHERE status = 'ACTIVE' ORDER BY name LIMIT 1",
    [],
  );
  homeLga = seeded!.lga_id;
  otherLga = (await queryOne<{ id: string }>(
    pool,
    'SELECT id FROM lgas WHERE id <> $1 ORDER BY name LIMIT 1',
    [homeLga],
  ))!.id;

  const supervisorId = await createGovernmentUser({
    fullName: 'Territory Supervisor',
    phone: SUPERVISOR,
    role: 'supervisor',
  });
  await query(
    pool,
    'INSERT INTO user_territories (user_id, territory_id, assigned_by) VALUES ($1,$2,$3)',
    [supervisorId, seeded!.id, officerId],
  );
  supervisorToken = (await loginAs(SUPERVISOR)).accessToken;
});

const admin = () => ({ token: adminToken });
const supervisor = () => ({ token: supervisorToken });

// ===========================================================================
describe('asking what band a business falls in', () => {
  /*
   * The route exists to answer BEFORE a schedule exists, which is the state
   * PSIRS is actually in while drafting one: "what band does a tailor with a
   * lock-up shop and two machines fall in, so the figure beside it can be
   * argued about". So it is asserted with nothing published -- if it needed a
   * schedule it would be useless for the job it was built for.
   */
  it('answers before any schedule has been published', async () => {
    const answer = await post(
      '/government/presumptive/band',
      { premises: 'LOCK_UP_SHOP', equipmentCount: 2, peopleWorking: 1 },
      admin(),
    );
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.equal(answer.body.sizeBand, 'SMALL');
  });

  it('puts a trader with nothing but a mat in the smallest band', async () => {
    const answer = await post(
      '/government/presumptive/band',
      { premises: 'NONE', equipmentCount: 0, peopleWorking: 0 },
      admin(),
    );
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.equal(answer.body.sizeBand, 'MICRO');
  });

  /*
   * A control on the shape of the answer. The band is worked out by the
   * server, and a request that supplies one must not be able to choose it --
   * the same rule the observation route holds, one step earlier.
   */
  it('refuses a request that tries to name the band itself', async () => {
    const answer = await post(
      '/government/presumptive/band',
      { premises: 'NONE', equipmentCount: 0, peopleWorking: 0, sizeBand: 'MICRO' },
      admin(),
    );
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.equal(
      Object.keys(answer.body).length,
      1,
      'the answer carries the band and nothing the caller sent',
    );
  });
});

// ===========================================================================
describe('who is not paying consumption tax', () => {
  async function hotelIn(lgaId: string): Promise<string> {
    seq += 1;
    const suffix = String(seq).padStart(4, '0');
    const row = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO taxpayers
         (taxpayer_type, business_name, phone, address, lga_id, economic_sector, status)
       VALUES ('BUSINESS', $1, $2, '4 Rock Haven, Jos', $3, 'HOTEL_HOSPITALITY', 'ACTIVE')
       RETURNING id`,
      [`Rock Haven Hotel ${suffix}`, `+23480499${suffix}0`, lgaId],
    );
    return row!.id;
  }

  it('names a hotel that has not been assessed in the last year', async () => {
    const id = await hotelIn(homeLga);

    const answer = await get('/government/consumption-tax/not-paying', admin());
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    const rows = answer.body.rows as { taxpayerId: string }[];
    assert.ok(
      rows.some((row) => row.taxpayerId === id),
      JSON.stringify(answer.body),
    );
  });

  /*
   * The same defaulted-scope hole as the objections and the coverage leads.
   * `premisesNotPayingConsumptionTax` falls back to STATEWIDE when no scope is
   * passed, so a route that stopped passing it would hand a supervisor the
   * name, phone number and address of every hotel in Plateau State.
   */
  it('does not hand a supervisor the hotels of another LGA', async () => {
    const away = await hotelIn(otherLga);

    const answer = await get('/government/consumption-tax/not-paying', supervisor());
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    const rows = answer.body.rows as { taxpayerId: string }[];
    assert.ok(
      !rows.some((row) => row.taxpayerId === away),
      'a territory-scoped supervisor was served a hotel from another LGA',
    );
  });

  it('still serves it to a reader whose scope is the whole State', async () => {
    const away = await hotelIn(otherLga);

    const answer = await get('/government/consumption-tax/not-paying', admin());
    const rows = answer.body.rows as { taxpayerId: string }[];
    assert.ok(rows.some((row) => row.taxpayerId === away), JSON.stringify(answer.body));
  });
});

// ===========================================================================
describe('attaching evidence that did not come from this platform', () => {
  /** A real PNG header, because the service checks the bytes, not the header. */
  const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 7),
  ]);

  async function openCase(): Promise<string> {
    const created = await post(
      '/government/cases',
      {
        subject: 'Bank advice contradicting a settlement',
        category: 'GENERAL',
        riskLevel: 'MEDIUM',
      },
      admin(),
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));
    return created.body.id as string;
  }

  /**
   * The body is the file, so this goes around `post`, which JSON-encodes.
   * `apiBaseUrl` is exported for exactly this.
   */
  async function upload(
    caseId: string,
    bytes: Buffer,
    contentType: string,
    queryString = 'filename=advice.png&description=Bank%20advice&provenance=Emailed%20by%20the%20bank',
  ) {
    /*
     * The path is built on its own line, starting with a slash, so that
     * `route-coverage.mjs` can see it. That tool reads string literals
     * beginning with `/` out of the test corpus, and a URL template that opens
     * with `${apiBaseUrl()}` is invisible to it -- the route would be
     * exercised and still counted as uncovered.
     */
    const path = `/government/cases/${caseId}/evidence/upload?${queryString}`;
    const response = await fetch(
      `${apiBaseUrl()}${path}`,
      {
        method: 'POST',
        headers: {
          'content-type': contentType,
          'x-app-version': '1.0.0',
          authorization: `Bearer ${adminToken}`,
        },
        body: new Uint8Array(bytes),
      },
    );
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  it('keeps a file, with a checksum of what was actually stored', async () => {
    const caseId = await openCase();

    const stored = await upload(caseId, PNG, 'image/png');
    assert.equal(stored.status, 201, JSON.stringify(stored.body));
    assert.equal(stored.body.byteSize, PNG.length);
    assert.match(stored.body.checksum, /^[a-f0-9]{64}$/);
  });

  /*
   * The claim the route's own comment makes: "The declared type is checked
   * against the bytes inside `uploadEvidence`, because a Content-Type header
   * is the uploader's claim and nothing more."
   *
   * A PDF header sent as image/png is the shape that matters -- a payload
   * parked behind an image viewer -- and it must not reach the case file.
   */
  it('refuses bytes that are not what the header says they are', async () => {
    const caseId = await openCase();
    const notAPng = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 7)]);

    const stored = await upload(caseId, notAPng, 'image/png');
    assert.equal(stored.status, 400, JSON.stringify(stored.body));
    assert.match(stored.body.error.message, /not a image\/png/i);

    const kept = await query(
      pool,
      'SELECT id FROM case_evidence_files WHERE case_id = $1',
      [caseId],
    );
    assert.equal(kept.length, 0, 'a file the platform refused was kept anyway');
  });

  it('refuses an empty file with a sentence about the file, not the type', async () => {
    const caseId = await openCase();

    const stored = await upload(caseId, Buffer.alloc(0), 'image/png');
    assert.equal(stored.status, 400, JSON.stringify(stored.body));
    assert.match(stored.body.error.message, /empty/i);
  });

  /*
   * The caller names the file and the name is kept as a label. It must not
   * reach the storage path -- the key is built from the case id, a timestamp
   * and the extension the platform chose, so `../` in a filename is a string
   * in a column rather than a way out of the directory.
   */
  it('does not let the caller\'s filename choose where the file is written', async () => {
    const caseId = await openCase();

    const stored = await upload(
      caseId,
      PNG,
      'image/png',
      'filename=..%2F..%2F..%2Fetc%2Fpasswd&description=Traversal%20attempt&provenance=Test',
    );
    assert.equal(stored.status, 201, JSON.stringify(stored.body));

    const row = await queryOne<{ storage_reference: string; original_filename: string }>(
      pool,
      'SELECT storage_reference, original_filename FROM case_evidence_files WHERE case_id = $1',
      [caseId],
    );
    assert.ok(row, 'the file was kept');
    assert.ok(
      !row!.storage_reference.includes('..'),
      `the caller's filename reached the storage reference: ${row!.storage_reference}`,
    );
    assert.match(
      row!.storage_reference,
      /\.png$/,
      "the extension is the platform's, not the caller's",
    );
    /*
     * And the name the caller sent IS kept -- as a label on the record, which
     * is where it belongs. Refusing to store it would lose what the officer
     * called the file; letting it choose a path would be the defect.
     */
    assert.equal(row!.original_filename, '../../../etc/passwd');
  });
});
