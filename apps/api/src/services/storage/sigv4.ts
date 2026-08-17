/**
 * AWS Signature Version 4, for S3-compatible object storage.
 *
 * Written out rather than pulled in. Every other outbound integration in this
 * codebase — Remita, KYC, the vehicle registry, bank name enquiry — speaks
 * plain `fetch`, and the AWS SDK would be by far the largest dependency in the
 * tree for one PUT, one GET and one HEAD. Signing by hand also keeps the driver
 * genuinely provider-neutral: MinIO, Backblaze B2 and DigitalOcean Spaces all
 * accept SigV4, and a government deployment may not be on AWS at all.
 *
 * The failure mode is safe to hand-roll against: a wrong signature is a 403,
 * which is loud and immediate. There is no version of "subtly mis-signed" that
 * silently stores nothing.
 *
 * Reference: AWS "Signature Version 4 signing process", authorization header
 * variant, with the payload hash sent in `x-amz-content-sha256`.
 */

import { createHash, createHmac } from 'node:crypto';

export interface SigningInput {
  method: string;
  /** Path portion of the URL, already encoded. Must begin with "/". */
  path: string;
  /** Canonical query string, or "" when there is none. */
  query?: string;
  headers: Record<string, string>;
  /** Hex SHA-256 of the body; "UNSIGNED-PAYLOAD" is deliberately not used. */
  payloadHash: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** ISO basic format, e.g. 20260817T120000Z. Injected so this stays testable. */
  timestamp: string;
}

function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

/**
 * Header names lowercased, values trimmed and inner whitespace collapsed, then
 * sorted by name. Getting this wrong is the usual cause of a 403.
 */
function canonicalHeaders(headers: Record<string, string>): {
  canonical: string;
  signed: string;
} {
  const normalised = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return {
    canonical: normalised.map(([name, value]) => `${name}:${value}\n`).join(''),
    signed: normalised.map(([name]) => name).join(';'),
  };
}

export function signRequest(input: SigningInput): Record<string, string> {
  const date = input.timestamp.slice(0, 8);
  const scope = `${date}/${input.region}/${input.service}/aws4_request`;

  const headers: Record<string, string> = {
    ...input.headers,
    'x-amz-date': input.timestamp,
    'x-amz-content-sha256': input.payloadHash,
  };

  const { canonical, signed } = canonicalHeaders(headers);

  const canonicalRequest = [
    input.method.toUpperCase(),
    input.path,
    input.query ?? '',
    canonical,
    signed,
    input.payloadHash,
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    input.timestamp,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, date), input.region), input.service),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return {
    ...headers,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signed}, Signature=${signature}`,
  };
}

/** ISO basic timestamp, the only format SigV4 accepts. */
export function amzTimestamp(now: Date): string {
  return `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

/**
 * Encode an object key for a URL path.
 *
 * `encodeURIComponent` escapes "/" too, which would flatten the key's prefixes
 * into one segment, so each segment is encoded separately. S3 also expects the
 * characters `!'()*` escaped, which `encodeURIComponent` leaves alone.
 */
export function encodeKey(key: string): string {
  return key
    .split('/')
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/');
}

export { sha256Hex };
