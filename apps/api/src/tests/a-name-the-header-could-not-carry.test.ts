/**
 * Case evidence downloaded under the name it was uploaded with.
 *
 * The name went into the download header as typed, and Node refuses a header
 * carrying anything outside Latin-1. Measured: evidence uploaded as
 * "Rasit ɗin Ladi.pdf" stored (201) and then failed every download with a
 * 500, so an investigator could see it listed and never open it; a name with
 * a double quote produced a header that ended the name at the quote.
 *
 * The header now carries an ASCII fallback and the exact name, encoded.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { apiBaseUrl, createGovernmentUser, loginAs, post, resetDatabase, startTestServer, stopTestServer } from './helpers';
import { seedReferenceData } from '../db/seed';
import { contentDisposition } from '../lib/content-disposition';

let token = '';
let caseId = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Evidence Officer', phone: '+2348077980001', role: 'admin' });
  token = (await loginAs('+2348077980001')).accessToken;
  const opened = await post('/government/cases', { subject: 'Receipt dispute at Bukuru market' }, { token });
  assert.equal(opened.status, 201, JSON.stringify(opened.body));
  caseId = opened.body.id;
});

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('bank advice\n%%EOF')]);

async function uploadAndOpen(filename: string) {
  const query = new URLSearchParams({
    filename,
    description: 'Bank advice the trader brought in',
    provenance: 'Handed over at the Bukuru office',
  }).toString();
  const uploaded = await fetch(`${apiBaseUrl()}/government/cases/${caseId}/evidence/upload?${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/pdf', 'x-app-version': '1.0.0', authorization: `Bearer ${token}` },
    body: new Uint8Array(PDF),
  });
  assert.equal(uploaded.status, 201, await uploaded.clone().text());
  const { evidenceFileId } = (await uploaded.json()) as { evidenceFileId: string };
  const opened = await fetch(`${apiBaseUrl()}/government/cases/evidence/${evidenceFileId}/file`, {
    headers: { 'x-app-version': '1.0.0', authorization: `Bearer ${token}` },
  });
  return { opened, bytes: Buffer.from(await opened.arrayBuffer()) };
}

describe('evidence uploaded under a Hausa name', () => {
  it('opens, with its name intact', async () => {
    const { opened, bytes } = await uploadAndOpen('Rasit ɗin Ladi.pdf');
    assert.equal(opened.status, 200, bytes.toString());
    assert.deepEqual(bytes, PDF, 'the bytes that were uploaded');
    const header = opened.headers.get('content-disposition')!;
    assert.match(header, /filename\*=UTF-8''Rasit%20%C9%97in%20Ladi\.pdf/);
    assert.match(header, /^inline; filename="Rasit _in Ladi\.pdf"/);
  });
});

describe('evidence uploaded under a name with a quote in it', () => {
  it('opens, and the header still says where the name ends', async () => {
    const { opened } = await uploadAndOpen('Statement "final".pdf');
    assert.equal(opened.status, 200);
    const header = opened.headers.get('content-disposition')!;
    assert.match(header, /^inline; filename="Statement _final_\.pdf"; /);
    assert.match(header, /filename\*=UTF-8''Statement%20%22final%22\.pdf$/);
  });
});

describe('the header itself', () => {
  it('leaves a plain name as it was', () => {
    assert.equal(
      contentDisposition('attachment', 'rasit-ladi.pdf'),
      `attachment; filename="rasit-ladi.pdf"; filename*=UTF-8''rasit-ladi.pdf`,
    );
  });

  it('never carries a character Node would refuse, whatever the name', () => {
    for (const name of ['Ƙasa.pdf', 'Ɓangare.png', 'naira ₦.pdf', 'line\nbreak.pdf', 'back\\slash.pdf', "it's (1).pdf"]) {
      const header = contentDisposition('inline', name);
      assert.match(header, /^[\x20-\x7e]+$/, `${JSON.stringify(name)} gave ${JSON.stringify(header)}`);
      assert.equal(decodeURIComponent(header.split("filename*=UTF-8''")[1]!), name);
    }
  });

  /*
   * RFC 5987's attr-char leaves out ' ( ) and *, which encodeURIComponent
   * passes through. A client reading the encoded name strictly stops at the
   * apostrophe in "it's (1).pdf".
   */
  it('encodes the name using only the characters the encoded form allows', () => {
    const encoded = contentDisposition('inline', "it's (1)*.pdf").split("filename*=UTF-8''")[1]!;
    assert.match(encoded, /^(?:[A-Za-z0-9!#$&+\-.^_`|~]|%[0-9A-F]{2})+$/, encoded);
  });
});
