/**
 * Local filesystem storage — development only.
 *
 * `config.ts` refuses to boot in production while this driver is selected. On a
 * replaceable container, local disk means a taxpayer's receipt exists until the
 * next deploy, which is worse than not storing it at all: the document record
 * would still point at it.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { AppError, notFound } from '../../lib/errors';
import type { StorageDriver, StoredObject } from './types';

export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local';

  private readonly root: string;

  constructor(root: string) {
    // Trailing separators stripped, because the boundary check below builds
    // `root + sep`, and a root of `/app/storage/` would make that `//` — which
    // no legitimate normalised path starts with, so every key would be
    // refused.
    let resolved = normalize(root);
    while (resolved.length > 1 && resolved.endsWith(sep)) resolved = resolved.slice(0, -1);
    this.root = resolved;
    mkdirSync(this.root, { recursive: true });
  }

  private resolve(key: string): string {
    /*
     * Reject traversal outright rather than sanitising: a key that tries to
     * escape the root is a bug or an attack, never a legitimate document.
     *
     * This compared `target.startsWith(this.root)`, which is a prefix match
     * and not a boundary. With a root of `/app/storage` it accepted every
     * sibling directory whose name merely begins with `storage`:
     *
     *   ../etc/passwd                 -> /app/etc/passwd          rejected
     *   ../storage-evil/x.pdf         -> /app/storage-evil/x.pdf  ACCEPTED
     *   ../storage/../storage-x/z     -> /app/storage-x/z         ACCEPTED
     *
     * and `put` creates the directories it writes into, so an escaping key
     * would have landed documents beside the volume rather than in it —
     * readable until the container was replaced, and then gone, with the
     * document row still pointing at them.
     *
     * Nothing reachable produces such a key today: every one is built by
     * `storageKey` from a document number or a uuid, and this driver refuses
     * to run in production at all. The check is corrected because it claims to
     * reject traversal and rejected only some of it.
     */
    const target = normalize(join(this.root, key));
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new AppError({
        statusCode: 400,
        code: 'INVALID_STORAGE_KEY',
        message: 'That document location is not valid.',
      });
    }
    return target;
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<StoredObject> {
    const path = this.resolve(key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);

    // Read the size back rather than trusting the buffer: a short write on a
    // full disk must not be reported as a stored document.
    const written = statSync(path).size;
    if (written !== body.byteLength) {
      throw new AppError({
        statusCode: 500,
        code: 'STORAGE_WRITE_INCOMPLETE',
        message: 'The document could not be stored completely.',
        expose: false,
      });
    }

    return {
      storageReference: key,
      byteSize: body.byteLength,
      checksum: createHash('sha256').update(body).digest('hex'),
    };
  }

  async get(storageReference: string): Promise<Buffer> {
    const path = this.resolve(storageReference);
    if (!existsSync(path)) throw notFound('That document');
    return readFileSync(path);
  }

  async exists(storageReference: string): Promise<boolean> {
    return existsSync(this.resolve(storageReference));
  }
}
