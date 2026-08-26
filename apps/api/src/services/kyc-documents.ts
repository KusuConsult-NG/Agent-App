/**
 * Identity document capture (PRD §5, §29, §64; Addendum §28).
 *
 * `kyc_documents` has existed since the second migration and nothing ever
 * wrote to it, because nothing could: there was no upload path anywhere in the
 * platform. An agent's identity was cleared on the strength of a number they
 * typed, and the KYC provider was asked to match a name and a number with no
 * document behind either.
 *
 * What is stored here is a photograph of somebody's national identity card, or
 * of their face. That shapes every decision in this file:
 *
 *   * the bytes are checked against the type they claim to be, because a
 *     Content-Type header is a claim by the uploader and nothing more;
 *   * a stored document is never replaced, only superseded, so a cleared
 *     identity can always be traced to the exact file a reviewer saw;
 *   * every read is logged with who did it, because "who has looked at this
 *     citizen's identity papers" is a question NDPR requires an answer to;
 *   * and an upload that did not reach storage never becomes a row, because a
 *     row pointing at nothing is a document the reviewer will be asked to
 *     approve and cannot open.
 */

import type { PoolClient } from 'pg';
import { pool, query, queryOne, withTransaction } from '../db/pool';
import { badRequest, forbidden, notFound, conflict } from '../lib/errors';
import { storage, storageKey } from './storage';
import { recordAudit } from './audit';

/** What a document can be. Kept small: each one is asked for by name. */
export const KYC_DOCUMENT_TYPES = [
  'IDENTITY_DOCUMENT',
  'ADDITIONAL_IDENTIFICATION',
  'SELFIE',
  'PROOF_OF_ADDRESS',
  'PASSPORT_PHOTOGRAPH',
  'SUPPORTING_DOCUMENT',
] as const;
export type KycDocumentType = (typeof KYC_DOCUMENT_TYPES)[number];

export const CAPTURE_SOURCES = ['CAMERA', 'FILE'] as const;
export type CaptureSource = (typeof CAPTURE_SOURCES)[number];

/**
 * Accepted types, and the bytes that prove it.
 *
 * The signature is checked rather than the header trusted. An uploader who
 * says "image/jpeg" and sends something else is either a broken client or
 * someone storing a payload behind a reviewer's image viewer, and neither is
 * a file this platform should keep.
 */
const ACCEPTED: { contentType: string; extension: string; matches: (bytes: Buffer) => boolean }[] = [
  {
    contentType: 'image/jpeg',
    extension: 'jpg',
    matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    contentType: 'image/png',
    extension: 'png',
    matches: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    contentType: 'image/webp',
    extension: 'webp',
    matches: (b) =>
      b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    contentType: 'application/pdf',
    extension: 'pdf',
    matches: (b) => b.length > 5 && b.subarray(0, 5).toString('ascii') === '%PDF-',
  },
];

export const ACCEPTED_CONTENT_TYPES = ACCEPTED.map((entry) => entry.contentType);

/** A phone photograph of an ID is comfortably under this; a video is not. */
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

export interface StoredKycDocument {
  documentId: string;
  documentType: KycDocumentType;
  contentType: string;
  byteSize: number;
  checksum: string;
  verificationStatus: string;
  uploadedAt: Date;
}

/**
 * Store one identity document for an agent or a referee.
 *
 * Storage is written before the row exists, and the row records the checksum
 * the driver reported for the bytes it actually stored — not one computed here
 * over bytes that may never have arrived.
 */
export async function storeKycDocument(params: {
  agentId?: string | null;
  refereeId?: string | null;
  documentType: KycDocumentType;
  declaredContentType: string;
  bytes: Buffer;
  captureSource: CaptureSource;
  originalFilename?: string | null;
  actorId: string | null;
  actorRole?: string;
  ipAddress?: string | null;
}): Promise<StoredKycDocument> {
  const owner = ownerOf(params);

  // The declared type is checked first. An unsupported type never reaches the
  // body parser, so the bytes arrive empty — reporting that as "empty" would
  // send an agent back to recapture a document that was never the problem.
  const declared = ACCEPTED.find((entry) => entry.contentType === params.declaredContentType);
  if (!declared) {
    throw badRequest(
      `${params.declaredContentType || 'That file type'} is not a document type PSIRS accepts. ` +
        `Send one of: ${ACCEPTED_CONTENT_TYPES.join(', ')}.`,
      [{ field: 'Content-Type', issue: 'Unsupported document type' }],
    );
  }

  if (params.bytes.length === 0) {
    throw badRequest('The document is empty. Capture it again.');
  }
  if (params.bytes.length > MAX_DOCUMENT_BYTES) {
    throw badRequest(
      `That document is ${(params.bytes.length / 1024 / 1024).toFixed(1)} MB. ` +
        `The largest accepted is ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB — photograph the document rather than filming it.`,
    );
  }

  if (!declared.matches(params.bytes)) {
    // Deliberately not "corrupt file": the bytes are simply not what the
    // request said they were, and that is worth saying plainly.
    throw badRequest(
      `This file is not a ${params.declaredContentType}. Capture the document again.`,
      [{ field: 'body', issue: 'Content does not match the declared type' }],
    );
  }

  const key = storageKey(
    'kyc',
    owner.column === 'agent_id' ? 'agents' : 'referees',
    owner.id,
    `${params.documentType.toLowerCase()}-${Date.now()}.${declared.extension}`,
  );
  // Throws if the bytes are not durably stored, so no row is written for a
  // document that cannot be opened.
  const stored = await storage.put(key, params.bytes, declared.contentType);

  return withTransaction(async (client) => {
    // A fresh capture of the same thing supersedes the last one rather than
    // replacing its bytes, so what a reviewer cleared stays readable.
    await client.query(
      `UPDATE kyc_documents SET superseded_at = now()
        WHERE ${owner.column} = $1 AND document_type = $2 AND superseded_at IS NULL`,
      [owner.id, params.documentType],
    );

    const row = await queryOne<{
      id: string;
      verification_status: string;
      uploaded_at: Date;
    }>(
      client,
      `INSERT INTO kyc_documents
         (${owner.column}, document_type, storage_reference, content_type, byte_size, checksum,
          capture_source, uploaded_by, original_filename)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, verification_status, uploaded_at`,
      [
        owner.id,
        params.documentType,
        stored.storageReference,
        declared.contentType,
        stored.byteSize,
        stored.checksum,
        params.captureSource,
        params.actorId,
        params.originalFilename ?? null,
      ],
    );

    await logAccess(client, {
      documentId: row!.id,
      accessedBy: params.actorId,
      accessType: 'UPLOAD',
      ipAddress: params.ipAddress ?? null,
    });

    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole ?? 'agent',
      action: 'kyc.document.uploaded',
      entityType: 'kyc_document',
      entityId: row!.id,
      ipAddress: params.ipAddress ?? null,
      // The checksum, never the document and never its storage key.
      newValue: {
        documentType: params.documentType,
        contentType: declared.contentType,
        byteSize: stored.byteSize,
        checksum: stored.checksum,
        captureSource: params.captureSource,
      },
    });

    return {
      documentId: row!.id,
      documentType: params.documentType,
      contentType: declared.contentType,
      byteSize: stored.byteSize,
      checksum: stored.checksum,
      verificationStatus: row!.verification_status,
      uploadedAt: row!.uploaded_at,
    };
  });
}

/** The documents held for one agent or referee, without their bytes. */
export async function listKycDocuments(params: {
  agentId?: string | null;
  refereeId?: string | null;
}): Promise<Record<string, unknown>[]> {
  const owner = ownerOf(params);
  return query(
    pool,
    `SELECT id, document_type, content_type, byte_size, checksum, verification_status,
            capture_source, original_filename, uploaded_at, reviewed_at, rejection_reason,
            superseded_at
       FROM kyc_documents
      WHERE ${owner.column} = $1
      ORDER BY uploaded_at DESC`,
    [owner.id],
  );
}

/**
 * Fetch the bytes, and record that somebody did.
 *
 * The read is logged before the bytes are returned. A log written afterwards
 * would miss exactly the reads that matter — the ones that failed part way, or
 * the process that died holding somebody's identity document in memory.
 */
export async function readKycDocument(params: {
  documentId: string;
  actorId: string | null;
  actorRole: string;
  /** Set for an agent reading their own; government readers leave it null. */
  ownAgentId?: string | null;
  accessType?: 'VIEW' | 'DOWNLOAD';
  ipAddress?: string | null;
}): Promise<{ bytes: Buffer; contentType: string; documentType: string; checksum: string }> {
  const doc = await queryOne<{
    id: string;
    agent_id: string | null;
    referee_id: string | null;
    document_type: string;
    storage_reference: string;
    content_type: string;
    checksum: string;
  }>(
    pool,
    `SELECT id, agent_id, referee_id, document_type, storage_reference, content_type, checksum
       FROM kyc_documents WHERE id = $1`,
    [params.documentId],
  );
  if (!doc) throw notFound('That document');

  if (params.ownAgentId && doc.agent_id !== params.ownAgentId) {
    throw forbidden('This document belongs to another applicant.');
  }

  await withTransaction((client) =>
    logAccess(client, {
      documentId: doc.id,
      accessedBy: params.actorId,
      accessType: params.accessType ?? 'VIEW',
      ipAddress: params.ipAddress ?? null,
    }),
  );

  const bytes = await storage.get(doc.storage_reference);
  return {
    bytes,
    contentType: doc.content_type,
    documentType: doc.document_type,
    checksum: doc.checksum,
  };
}

/** A reviewer's decision on one document (Addendum §28). */
export async function reviewKycDocument(params: {
  documentId: string;
  decision: 'ACCEPT' | 'REJECT';
  reason: string;
  actorId: string;
  actorRole: string;
  ipAddress?: string | null;
}): Promise<{ status: string }> {
  return withTransaction(async (client) => {
    const doc = await queryOne<{ id: string; verification_status: string; superseded_at: Date | null }>(
      client,
      'SELECT id, verification_status, superseded_at FROM kyc_documents WHERE id = $1 FOR UPDATE',
      [params.documentId],
    );
    if (!doc) throw notFound('That document');
    if (doc.superseded_at) {
      throw conflict(
        'DOCUMENT_SUPERSEDED',
        'A newer capture of this document has been submitted. Review that one instead.',
      );
    }

    const status = params.decision === 'ACCEPT' ? 'VERIFIED' : 'REJECTED';
    await client.query(
      `UPDATE kyc_documents
          SET verification_status = $1, reviewed_at = now(), reviewed_by = $2,
              rejection_reason = $3
        WHERE id = $4`,
      [status, params.actorId, params.decision === 'REJECT' ? params.reason : null, params.documentId],
    );

    await logAccess(client, {
      documentId: params.documentId,
      accessedBy: params.actorId,
      accessType: 'REVIEW',
      ipAddress: params.ipAddress ?? null,
    });

    // Every decision carries its reason, the same as an agent review.
    await recordAudit(client, {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: 'kyc.document.reviewed',
      entityType: 'kyc_document',
      entityId: params.documentId,
      ipAddress: params.ipAddress ?? null,
      newValue: { decision: params.decision, status, reason: params.reason },
    });

    return { status };
  });
}

/** Who has looked at this document, for a data-protection enquiry. */
export async function documentAccessHistory(documentId: string): Promise<Record<string, unknown>[]> {
  return query(
    pool,
    `SELECT l.access_type, l.created_at, l.ip_address, u.full_name, u.role
       FROM kyc_document_access_logs l
       LEFT JOIN users u ON u.id = l.accessed_by
      WHERE l.document_id = $1
      ORDER BY l.created_at DESC`,
    [documentId],
  );
}

function ownerOf(params: { agentId?: string | null; refereeId?: string | null }): {
  column: 'agent_id' | 'referee_id';
  id: string;
} {
  if (params.agentId && params.refereeId) {
    throw badRequest('A document belongs to an applicant or to a referee, not to both.');
  }
  if (params.agentId) return { column: 'agent_id', id: params.agentId };
  if (params.refereeId) return { column: 'referee_id', id: params.refereeId };
  throw badRequest('A document must belong to an applicant or a referee.');
}

async function logAccess(
  client: PoolClient,
  entry: {
    documentId: string;
    accessedBy: string | null;
    accessType: 'UPLOAD' | 'VIEW' | 'DOWNLOAD' | 'REVIEW';
    ipAddress: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO kyc_document_access_logs (document_id, accessed_by, access_type, ip_address)
     VALUES ($1,$2,$3,$4)`,
    [entry.documentId, entry.accessedBy, entry.accessType, entry.ipAddress],
  );
}
