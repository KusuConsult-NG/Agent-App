/**
 * The storage key that walked out of the storage directory.
 *
 * `LocalStorageDriver.resolve` says what it is for — "Reject traversal
 * outright rather than sanitising: a key that tries to escape the root is a
 * bug or an attack, never a legitimate document" — and did it with:
 *
 *     if (!target.startsWith(this.root)) throw …
 *
 * A prefix match, not a boundary. With a root of `/app/storage` that accepts
 * every sibling directory whose name merely begins with `storage`:
 *
 *     ../etc/passwd                -> /app/etc/passwd            rejected
 *     ../storage-evil/x.pdf        -> /app/storage-evil/x.pdf    ACCEPTED
 *     ../storage/../storage-x/z    -> /app/storage-x/z           ACCEPTED
 *
 * `put` creates the directories it writes into, so an escaping key lands a
 * document beside the mounted volume rather than in it: readable for as long
 * as the container lives, gone when it is replaced, and the document row still
 * pointing at it.
 *
 * SAID PLAINLY, BECAUSE THE SIZE OF A FINDING IS PART OF IT. Nothing reachable
 * produces such a key. Every one is built by `storageKey` from a document
 * number or a uuid, no request body reaches it, and `config.ts` refuses to
 * boot in production while this driver is selected at all. This is a latent
 * defect in a development driver, fixed because the check claims to reject
 * traversal and rejected only some of it — not because anything was exposed.
 *
 * The tests below drive the driver directly against a temporary root, because
 * a rule with no caller that can break it is exactly the rule that rots.
 */

import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { LocalStorageDriver } from '../services/storage';

let base = '';
let root = '';
let driver: LocalStorageDriver;

before(() => {
  base = mkdtempSync(join(tmpdir(), 'psirs-storage-'));
  // A sibling whose name starts with the root's, which is the whole point.
  root = join(base, 'storage');
  driver = new LocalStorageDriver(root);
});
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const bytes = Buffer.from('a receipt');

async function refuses(key: string, why: string) {
  await assert.rejects(
    () => driver.put(key, bytes, 'application/pdf'),
    (error: { code?: string }) => {
      assert.equal(error.code, 'INVALID_STORAGE_KEY', `refused for the wrong reason on ${key}`);
      return true;
    },
    why,
  );
}

describe('a storage key that tries to leave the root', () => {
  it('is refused when it walks up and out', async () => {
    await refuses('../etc/passwd', 'the plainest traversal there is');
    await refuses('../../etc/passwd', 'and the same, further up');
  });

  it('is refused when it lands on a sibling that merely starts with the root', async () => {
    /*
     * The defect. `startsWith` cannot tell `/…/storage-evil` from a path
     * inside `/…/storage`, because one is a prefix of the other.
     */
    await refuses('../storage-evil/x.pdf', 'a sibling directory is not the root');
    await refuses('../storageX/y.pdf', 'nor is one whose name simply runs on');
    await refuses('../storage/../storage-sneaky/z.pdf', 'nor one reached the long way round');
  });

  it('leaves nothing behind when it refuses', async () => {
    // `put` creates directories before it writes, so a refusal that happened
    // after the mkdir would still have made the escape visible on disk.
    assert.equal(existsSync(join(base, 'storage-evil')), false);
    assert.equal(existsSync(join(base, 'storageX')), false);
    assert.equal(existsSync(join(base, 'storage-sneaky')), false);
  });

  it('still stores and returns an ordinary key', async () => {
    // The control. A boundary check that refused real keys would be a worse
    // defect than the one it replaced, and this is the shape every caller
    // actually produces: `storageKey('receipt', '2026', 'PSIRS-2026-000001.pdf')`.
    const key = join('receipt', '2026', 'PSIRS-2026-000001.pdf').split(sep).join('/');
    const stored = await driver.put(key, bytes, 'application/pdf');

    assert.equal(stored.storageReference, key);
    assert.equal(stored.byteSize, bytes.byteLength);
    assert.deepEqual(await driver.get(key), bytes);
    assert.equal(await driver.exists(key), true);
  });

  it('is not confused by a root written with a trailing separator', async () => {
    /*
     * The boundary check builds `root + sep`. A root of `/…/storage/` would
     * make that `//`, which no normalised path starts with — so every key
     * would be refused and no document could be stored at all. Configuration
     * is written by hand and a trailing slash is the likeliest typo in it.
     */
    const trailing = new LocalStorageDriver(`${root}${sep}`);
    const stored = await trailing.put('receipt/2026/trailing.pdf', bytes, 'application/pdf');
    assert.equal(stored.byteSize, bytes.byteLength);
    assert.deepEqual(await trailing.get('receipt/2026/trailing.pdf'), bytes);
  });
});
