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
import { dirname, join, normalize } from 'node:path';
import { AppError, notFound } from '../../lib/errors';
import type { StorageDriver, StoredObject } from './types';

export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local';

  private readonly root: string;

  constructor(root: string) {
    this.root = normalize(root);
    mkdirSync(this.root, { recursive: true });
  }

  private resolve(key: string): string {
    // Reject traversal outright rather than sanitising: a key that tries to
    // escape the root is a bug or an attack, never a legitimate document.
    const target = normalize(join(this.root, key));
    if (!target.startsWith(this.root)) {
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
