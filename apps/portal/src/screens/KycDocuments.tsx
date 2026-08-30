/**
 * The identity documents behind one applicant (Addendum §28, NDPR).
 *
 * The capture side of this was built and the review side was not. Documents
 * were uploaded, stored, checksummed and access-logged, and `GET
 * /agents/kyc/documents/:id/file` — the only way to see one — had no caller
 * anywhere in the portal. `POST .../review` had none either.
 *
 * That left `governmentApproved`, the one genuinely human gate in the
 * clearance pipeline, being passed by an officer who could not open the
 * documents the applicant had submitted. `activationBlockers` gates on the KYC
 * provider's automated verdict; the person signing off saw a masked identity
 * number and nothing else. Meanwhile the access log had nothing to log,
 * because nobody could read anything.
 *
 * Three things this screen is careful about, all for the same reason — these
 * are photographs of a real person's identity papers:
 *
 *   * The bytes are fetched with the reviewer's token and shown from an object
 *     URL that is revoked the moment the viewer closes. Nothing is left in a
 *     URL an idle tab could keep alive.
 *
 *   * Opening a document is a logged event, not a side effect of loading the
 *     page. Documents are listed with their metadata and fetched only when the
 *     reviewer asks, so the access log records reviewers rather than renders.
 *
 *   * Rejecting carries a reason, and the applicant sees it. The agent app
 *     already shows `rejection_reason` against the document and lets them
 *     upload a replacement, so a rejection here is the start of a loop rather
 *     than a verdict into the void.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError, api, can, fetchFile, type ApiError } from '../lib/api';
import { Alert, Badge, Empty, ErrorAlert, Loading, Table, formatDateTime } from '../ui';
import { usePortalI18n } from '../lib/i18n';

export interface KycDocument {
  id: string;
  document_type: string;
  content_type: string;
  byte_size: number;
  checksum: string;
  verification_status: string;
  capture_source: string | null;
  original_filename: string | null;
  uploaded_at: string;
  reviewed_at: string | null;
  rejection_reason: string | null;
  superseded_at: string | null;
}

interface AccessEntry {
  access_type: string;
  created_at: string;
  ip_address: string | null;
  full_name: string | null;
  role: string | null;
}

const humanise = (value: string) => value.replace(/_/g, ' ').toLowerCase();

const sizeOf = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** How many documents still need a person to look at them. */
export function unreviewedCount(documents: KycDocument[]): number {
  return documents.filter(
    (doc) => !doc.superseded_at && doc.verification_status !== 'VERIFIED' && doc.verification_status !== 'REJECTED',
  ).length;
}

export function KycDocumentsCard({
  agentId,
  onReviewed,
}: {
  agentId: string;
  onReviewed?: () => void;
}) {
  const { t } = usePortalI18n();
  const [documents, setDocuments] = useState<KycDocument[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState<KycDocument | null>(null);

  const load = useCallback(() => {
    api
      .get<{ documents: KycDocument[] }>(`/agents/${agentId}/kyc/documents`)
      .then((data) => setDocuments(data.documents))
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
        setDocuments([]);
      });
  }, [agentId]);

  useEffect(load, [load]);

  const pending = documents ? unreviewedCount(documents) : 0;

  return (
    <div className="card">
      <div className="card__header">
        <h2 className="card__title">{t.ofcKycIdentityDocuments}</h2>
        <p className="card__hint">{t.ofcKycIntro}</p>
      </div>

      <ErrorAlert error={error} />
      {message && (
        <Alert kind="success" title="allocRecorded">
          <p style={{ margin: 0 }}>{message}</p>
        </Alert>
      )}

      {!documents ? (
        <Loading />
      ) : documents.length === 0 ? (
        <Empty>{t.ofcKycNoDocuments}</Empty>
      ) : (
        <>
          {pending > 0 && (
            <Alert kind="warning" title={{ text: t.ofcKycNotReviewed.replace('{{n}}', String(pending)) }}>
              <p style={{ margin: 0 }}>{t.ofcKycApprovingBlind}</p>
            </Alert>
          )}

          <Table
            columns={[
              { key: 'document_type', label: 'ofcKycDocument', render: (row) => humanise(row.document_type) },
              {
                key: 'verification_status',
                label: 'appStatus',
                render: (row) =>
                  row.superseded_at ? (
                    <Badge status="SUPERSEDED" />
                  ) : (
                    <Badge status={row.verification_status} />
                  ),
              },
              { key: 'capture_source', label: 'ofcKycCaptured', render: (row) => humanise(row.capture_source ?? 'unknown') },
              { key: 'byte_size', label: 'ofcKycSize', numeric: true, render: (row) => sizeOf(row.byte_size) },
              { key: 'uploaded_at', label: 'ofcAgSubmitted', render: (row) => formatDateTime(row.uploaded_at) },
              {
                key: 'reviewed_at',
                label: 'ofcKycReviewed',
                render: (row) => (row.reviewed_at ? formatDateTime(row.reviewed_at) : '—'),
              },
              {
                key: 'id',
                label: { text: '' },
                render: (row) => (
                  <button type="button" className="link" onClick={() => setOpen(row)}>
                    {row.superseded_at ? 'View' : 'Open and review'}
                  </button>
                ),
              },
            ]}
            rows={documents}
            empty="ofcNoneDocuments"
          />
        </>
      )}

      {open && (
        <DocumentViewer
          document={open}
          onClose={() => setOpen(null)}
          onReviewed={(text) => {
            setMessage(text);
            setOpen(null);
            load();
            onReviewed?.();
          }}
        />
      )}
    </div>
  );
}

function DocumentViewer({
  document: doc,
  onClose,
  onReviewed,
}: {
  document: KycDocument;
  onClose: () => void;
  onReviewed: (message: string) => void;
}) {
  const { t } = usePortalI18n();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [access, setAccess] = useState<AccessEntry[] | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchFile(`/agents/kyc/documents/${doc.id}/file`)
      .then((blob) => {
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        urlRef.current = objectUrl;
        setUrl(objectUrl);
      })
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });

    return () => {
      cancelled = true;
      // The document does not outlive the viewer. Leaving the object URL alive
      // keeps somebody's identity papers reachable from an idle tab.
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [doc.id]);

  const showAccess = useCallback(() => {
    api
      .get<{ access: AccessEntry[] }>(`/agents/kyc/documents/${doc.id}/access`)
      .then((data) => setAccess(data.access))
      .catch(() => setAccess([]));
  }, [doc.id]);

  async function decide(decision: 'ACCEPT' | 'REJECT') {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/agents/kyc/documents/${doc.id}/review`, { decision, reason });
      onReviewed(
        decision === 'ACCEPT'
          ? `${humanise(doc.document_type)} accepted.`
          : `${humanise(doc.document_type)} rejected. The applicant can see the reason and submit a replacement.`,
      );
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  const isImage = doc.content_type.startsWith('image/');
  const decided = doc.verification_status === 'VERIFIED' || doc.verification_status === 'REJECTED';

  return (
    <div className="document-viewer">
      <div className="document-viewer__head">
        <h3>{humanise(doc.document_type)}</h3>
        <button type="button" className="secondary" onClick={onClose}>{t.ofcKycClose}</button>
      </div>

      <ErrorAlert error={error} />

      {!url && !error ? (
        <Loading rows={2} />
      ) : url ? (
        isImage ? (
          <img className="document-viewer__image" src={url} alt={`${humanise(doc.document_type)} submitted by the applicant`} />
        ) : (
          <p className="card__hint">
            This is a {doc.content_type} file.{' '}
            <a href={url} target="_blank" rel="noreferrer">{t.ofcKycOpenNewTab}</a>
            .
          </p>
        )
      ) : null}

      <p className="card__hint">{t.ofcKycChecksum}<code>{doc.checksum.slice(0, 16)}…</code> · {sizeOf(doc.byte_size)} ·{' '}
        {doc.original_filename ?? 'captured in the app'}
      </p>

      {doc.superseded_at ? (
        <Alert kind="info" title="ofcKycSupersededLabel">
          <p style={{ margin: 0 }}>{t.ofcKycSuperseded}</p>
        </Alert>
      ) : decided ? (
        <Alert kind="info" title={{ text: t.ofcKycAlready.replace('{{status}}', humanise(doc.verification_status)) }}>
          <p style={{ margin: 0 }}>
            {doc.rejection_reason
              ? `Reason given: ${doc.rejection_reason}`
              : 'Reviewed on ' + formatDateTime(doc.reviewed_at)}
          </p>
        </Alert>
      ) : can('agent:approve') ? (
        <div className="field">
          <label htmlFor="kyc-review-reason">{t.ofcKycWhyRequired}</label>
          <textarea
            id="kyc-review-reason"
            value={reason}
            rows={2}
            minLength={4}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="button-row">
            <button type="button" disabled={busy || reason.trim().length < 4} onClick={() => decide('ACCEPT')}>{t.ofcKycAccept}</button>
            <button
              type="button"
              className="danger"
              disabled={busy || reason.trim().length < 4}
              onClick={() => decide('REJECT')}
            >{t.ofcAgReject}</button>
          </div>
        </div>
      ) : (
        <p className="card__hint">{t.ofcKycNeedsPermission}</p>
      )}

      {can('audit:read') && (
        <div className="document-viewer__access">
          {!access ? (
            <button type="button" className="link" onClick={showAccess}>{t.ofcKycWhoLooked}</button>
          ) : access.length === 0 ? (
            <Empty>{t.ofcNoneAccessRecorded}</Empty>
          ) : (
            <Table
              columns={[
                { key: 'full_name', label: 'ofcKycWho', render: (row) => row.full_name ?? 'the applicant' },
                { key: 'role', label: 'ofcRhRole', render: (row) => humanise(row.role ?? 'unknown') },
                { key: 'access_type', label: 'ofcKycWhat', render: (row) => humanise(row.access_type) },
                { key: 'created_at', label: 'ofcRhWhen', render: (row) => formatDateTime(row.created_at) },
                { key: 'ip_address', label: 'ofcFrom', render: (row) => row.ip_address ?? '—' },
              ]}
              rows={access}
              empty="ofcNoneAccessRecorded"
            />
          )}
        </div>
      )}
    </div>
  );
}
