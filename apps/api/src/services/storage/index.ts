/**
 * Document storage (PRD §64).
 *
 * One driver is active per deployment, chosen by `STORAGE_DRIVER`. The document
 * code imports `storage` and never names a driver, so moving a government's
 * receipts into object storage is a configuration change plus one adapter.
 *
 * Until now this exported the local filesystem driver directly, which meant
 * `STORAGE_DRIVER` was read only by the production boot guard and honoured by
 * nothing — the API refused to start in production, correctly, because there
 * was no other driver to select.
 *
 * Objects are never served from a guessable path. Access always goes through a
 * signed, expiring URL issued by this platform, so the same access-control
 * model applies whether the bytes sit on disk or in a bucket, and revocation
 * and access logging stay with the system that knows who may read what.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../../config';
import { LocalStorageDriver } from './local';
import { S3StorageDriver } from './s3';
import type { StorageDriver } from './types';

export type { StorageDriver, StoredObject } from './types';
export { LocalStorageDriver } from './local';
export { S3StorageDriver } from './s3';

function selectDriver(): StorageDriver {
  switch (config.storage.driver) {
    case 's3':
      return new S3StorageDriver();
    case 'local':
      return new LocalStorageDriver(config.storage.localPath);
    default:
      // An unrecognised driver must stop the process rather than fall back to
      // local disk, which on a replaceable container silently loses every
      // receipt it stores.
      throw new Error(
        `Unknown STORAGE_DRIVER "${config.storage.driver}". Supported values: s3, local.`,
      );
  }
}

export const storage: StorageDriver = selectDriver();

/**
 * Where this deployment's objects live inside the bucket.
 *
 * Keys are built from a document number, and document numbers come from a
 * sequence in *this* database — so two deployments pointed at one bucket
 * (a staging environment restored from a production backup, a copied `.env`)
 * issue the same numbers and write over each other's files. The row keeps its
 * checksum, so public verification would start reporting that a genuine
 * receipt had been tampered with.
 *
 * Applied when a key is built rather than inside the driver, so
 * `storage_reference` holds the whole key and anything stored before this
 * existed is still found by the reference it was written with.
 */
export function storageKey(...segments: string[]): string {
  const path = segments.join('/').replace(/^\/+/, '');
  return config.storage.keyPrefix ? `${config.storage.keyPrefix}/${path}` : path;
}

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
