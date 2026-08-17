/**
 * Document storage (PRD §64).
 *
 * "Generated PDFs should be stored in secure object storage... Private storage,
 * Signed access URLs, Expiration, Verification code, Versioning, Access
 * logging."
 *
 * The local driver below is for development. Objects are never served from a
 * guessable path: access always goes through a signed, expiring URL, so the
 * same access-control model applies whether the bytes sit on disk or in S3.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { config } from '../config';
import { AppError, notFound } from '../lib/errors';

export interface StoredObject {
  storageReference: string;
  byteSize: number;
  checksum: string;
}

export interface StorageDriver {
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  get(storageReference: string): Promise<Buffer>;
  exists(storageReference: string): Promise<boolean>;
}

class LocalStorageDriver implements StorageDriver {
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
    const { createHash } = await import('node:crypto');
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

export const storage: StorageDriver = new LocalStorageDriver(config.storage.localPath);

/**
 * Signed, expiring document URL.
 *
 * The signature covers the document id and the expiry, so a link cannot be
 * edited to point at another document or to last longer than it was granted.
 */
export function signDocumentUrl(documentId: string, ttlSeconds?: number): string {
  const expires = Math.floor(Date.now() / 1000) + (ttlSeconds ?? config.storage.signedUrlTtlSeconds);
  const signature = createHmac('sha256', config.auth.jwtSecret)
    .update(`${documentId}:${expires}`)
    .digest('hex');
  return `/api/v1/documents/${documentId}/download?expires=${expires}&signature=${signature}`;
}

export function verifyDocumentSignature(
  documentId: string,
  expires: string,
  signature: string,
): boolean {
  const expiresAt = Number.parseInt(expires, 10);
  if (Number.isNaN(expiresAt) || expiresAt * 1000 < Date.now()) return false;

  const expected = createHmac('sha256', config.auth.jwtSecret)
    .update(`${documentId}:${expiresAt}`)
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
