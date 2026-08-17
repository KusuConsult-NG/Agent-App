/**
 * S3-compatible object storage (PRD §64).
 *
 * Works against AWS S3, MinIO, Backblaze B2 and DigitalOcean Spaces — anything
 * that accepts SigV4 — because a state government deployment may well not be on
 * AWS. Path-style addressing is the default for that reason; virtual-hosted
 * style is a setting.
 *
 * WHAT THIS DRIVER REFUSES TO DO
 *
 * It will not report an object as stored unless the store confirmed it. `put`
 * checks the response status *and* compares the returned ETag against the MD5
 * of what was sent, so a truncated or corrupted upload fails here rather than
 * becoming a document record pointing at bytes that are not what we wrote.
 *
 * That matters more than it looks. The caller writes the returned reference
 * against a receipt and tells the taxpayer they can download their proof of
 * payment; a reference for an object that is not there turns a successful
 * payment into a citizen who cannot show they paid.
 *
 * Objects are private. Access is always through this platform's own signed,
 * expiring URLs (`signDocumentUrl`), never a public bucket URL, so revocation
 * and access logging stay with the platform that knows who may read what.
 */

import { createHash } from 'node:crypto';
import { AppError, notFound } from '../../lib/errors';
import { config } from '../../config';
import { amzTimestamp, encodeKey, sha256Hex, signRequest } from './sigv4';
import type { StorageDriver, StoredObject } from './types';

export interface ObjectLocation {
  url: string;
  host: string;
  /** The path the signature must cover — encoded, and including the bucket
   *  when addressing is path-style. */
  path: string;
}

/**
 * Where an object lives.
 *
 * Pure, and exported, because getting this wrong is silent until a signature
 * fails: the signed path and the requested path must agree exactly, and the two
 * addressing styles put the bucket in different places.
 */
export function objectUrl(params: {
  endpoint: string;
  bucket: string;
  key: string;
  forcePathStyle: boolean;
}): ObjectLocation {
  const encoded = encodeKey(params.key);
  const base = new URL(params.endpoint);

  if (params.forcePathStyle) {
    const path = `/${params.bucket}/${encoded}`;
    return { url: `${params.endpoint.replace(/\/+$/, '')}${path}`, host: base.host, path };
  }

  const host = `${params.bucket}.${base.host}`;
  return { url: `${base.protocol}//${host}/${encoded}`, host, path: `/${encoded}` };
}

export interface S3StorageOptions {
  endpoint?: string;
  bucket?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  timeoutMs?: number;
  /** Injected in tests so a signature can be asserted against a fixed clock. */
  now?: () => Date;
}

export class S3StorageDriver implements StorageDriver {
  readonly name = 's3';

  private readonly endpoint: string;
  private readonly bucket: string;
  private readonly region: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly forcePathStyle: boolean;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(options?: S3StorageOptions) {
    const settings = config.storage.s3;
    this.endpoint = (options?.endpoint ?? settings.endpoint).replace(/\/+$/, '');
    this.bucket = options?.bucket ?? config.storage.bucket;
    this.region = options?.region ?? settings.region;
    this.accessKeyId = options?.accessKeyId ?? settings.accessKeyId;
    this.secretAccessKey = options?.secretAccessKey ?? settings.secretAccessKey;
    this.forcePathStyle = options?.forcePathStyle ?? settings.forcePathStyle;
    this.timeoutMs = options?.timeoutMs ?? settings.timeoutMs;
    this.now = options?.now ?? (() => new Date());

    if (!this.endpoint || !this.bucket) {
      throw new Error(
        'S3 storage requires STORAGE_ENDPOINT and STORAGE_BUCKET. Refusing to start ' +
          'with a document store that cannot be written to.',
      );
    }
  }

  private target(key: string): ObjectLocation {
    return objectUrl({
      endpoint: this.endpoint,
      bucket: this.bucket,
      key,
      forcePathStyle: this.forcePathStyle,
    });
  }

  private async send(
    method: string,
    key: string,
    body?: Buffer,
    contentType?: string,
  ): Promise<Response> {
    const { url, host, path } = this.target(key);
    const payloadHash = sha256Hex(body ?? '');

    const headers = signRequest({
      method,
      path,
      headers: {
        host,
        ...(contentType ? { 'content-type': contentType } : {}),
        ...(body ? { 'content-length': String(body.byteLength) } : {}),
      },
      payloadHash,
      region: this.region,
      service: 's3',
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      timestamp: amzTimestamp(this.now()),
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, {
        method,
        headers,
        // Node's fetch accepts a Buffer directly; the DOM BodyInit type is
        // not in scope in a Node type environment.
        body: body as unknown as undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    let response: Response;
    try {
      response = await this.send('PUT', key, body, contentType);
    } catch (error) {
      // Unreachable store. Throwing is right: the caller must not record a
      // reference for a document that was never written.
      throw new AppError({
        statusCode: 503,
        code: 'STORAGE_UNAVAILABLE',
        message:
          'The document could not be stored because the document store could not be reached. ' +
          'Nothing has been recorded against it.',
        expose: false,
        details: [{ issue: error instanceof Error ? error.message : 'Unknown error' }],
      });
    }

    if (!response.ok) {
      throw new AppError({
        statusCode: 502,
        code: 'STORAGE_WRITE_FAILED',
        message: `The document store rejected the upload (${response.status}).`,
        expose: false,
      });
    }

    // The ETag of a single-part upload is the MD5 of the object. Comparing it
    // is how a truncated or altered upload is caught here rather than by a
    // taxpayer who cannot open their receipt.
    const etag = (response.headers.get('etag') ?? '').replace(/"/g, '');
    const expected = createHash('md5').update(body).digest('hex');
    if (etag && etag !== expected) {
      throw new AppError({
        statusCode: 502,
        code: 'STORAGE_WRITE_CORRUPTED',
        message: 'The stored document does not match what was sent.',
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
    const response = await this.send('GET', storageReference);

    if (response.status === 404) throw notFound('That document');
    if (!response.ok) {
      throw new AppError({
        statusCode: 502,
        code: 'STORAGE_READ_FAILED',
        message: `The document could not be retrieved (${response.status}).`,
        expose: false,
      });
    }

    return Buffer.from(await response.arrayBuffer());
  }

  async exists(storageReference: string): Promise<boolean> {
    const response = await this.send('HEAD', storageReference);
    return response.ok;
  }
}
