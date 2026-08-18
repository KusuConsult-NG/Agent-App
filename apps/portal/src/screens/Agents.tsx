/**
 * Agent clearance administration (Addendum §15, §16, §45, §46).
 *
 * The review screen is the single clearance checklist of Addendum §16: an
 * officer sees identity, referee and agent readiness in one place, and every
 * decision requires a reason. Approve and activate are separate actions
 * because they are separate facts — approval is a judgement, activation also
 * requires training, bank verification, an accepted agreement and a device.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api, can, stepUp, type ApiError, type User } from '../lib/api';
import { KycDocumentsCard } from './KycDocuments';
import { Alert, Badge, Checklist, ErrorAlert, KeyValue, Loading, Stat, Table, formatDateTime } from '../ui';

interface KycDashboard {
  counts: Record<string, string>;
  reviewQueue: {
    agentId: string;
    full_name: string;
    phone: string;
    application_number: string;
    application_submitted_at: string;
    lga_name: string | null;
    applicationState: string;
    checklist: Record<string, boolean>;
  }[];
}

export function AgentsScreen({ navigate }: { navigate: (path: string) => void }) {
  const [dashboard, setDashboard] = useState<KycDashboard | null>(null);
  const [agents, setAgents] = useState<any[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [statusFilter, setStatusFilter] = useState('');

  const load = useCallback(() => {
    api
      .get<KycDashboard>('/agents/kyc-dashboard')
      .then(setDashboard)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });

    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    api
      .get<any[]>(`/agents?${params.toString()}`)
      .then(setAgents)
      .catch(() => setAgents([]));
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <ErrorAlert error={error} />;
  if (!dashboard) return <Loading rows={6} />;

  const counts = dashboard.counts;

  return (
    <>
      <div className="stat-grid">
        <Stat label="Applications received" value={counts.applications_received} />
        <Stat
          label="Ready for review"
          value={counts.ready_for_review}
          variant={Number(counts.ready_for_review) > 0 ? 'accent' : undefined}
          hint="KYC and referee both cleared"
        />
        <Stat label="Active agents" value={counts.active} />
        <Stat
          label="Suspended"
          value={counts.suspended}
          variant={Number(counts.suspended) > 0 ? 'alert' : undefined}
        />
      </div>

      <div className="stat-grid">
        <Stat label="KYC pending" value={counts.kyc_pending} />
        <Stat label="KYC cleared" value={counts.kyc_cleared} />
        <Stat label="Referee pending" value={counts.referee_pending} />
        <Stat label="Referee failed" value={counts.referee_failed} />
      </div>

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <h2 className="card__title">Awaiting government review</h2>
          <p className="card__hint">
            These applicants have completed identity verification and referee clearance.
          </p>
        </div>
        <Table
          columns={[
            { key: 'application_number', label: 'Application' },
            { key: 'full_name', label: 'Applicant' },
            { key: 'phone', label: 'Phone' },
            { key: 'lga_name', label: 'LGA' },
            {
              key: 'application_submitted_at',
              label: 'Submitted',
              render: (row) => formatDateTime(row.application_submitted_at),
            },
            {
              key: 'action',
              label: '',
              render: (row) => (
                <button type="button" className="small" onClick={() => navigate(`/agents/${row.agentId}`)}>
                  Review
                </button>
              ),
            },
          ]}
          rows={dashboard.reviewQueue}
          empty="No applications are waiting for review."
        />
      </div>

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <div className="card__header">
            <div>
              <h2 className="card__title">All agents</h2>
              <p className="card__hint">
                Six independent status axes: an agent is only operational when every one is
                satisfied.
              </p>
            </div>
            <div className="field" style={{ marginBottom: 0, minWidth: 180 }}>
              <label htmlFor="status">Operational status</label>
              <select
                id="status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="">All</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
                <option value="SUSPENDED">Suspended</option>
              </select>
            </div>
          </div>
        </div>
        {!agents ? (
          <div style={{ padding: 18 }}>
            <Loading rows={4} />
          </div>
        ) : (
          <Table
            columns={[
              { key: 'agent_code', label: 'Code', render: (row) => row.agent_code ?? '—' },
              { key: 'full_name', label: 'Name' },
              { key: 'lga', label: 'LGA' },
              { key: 'kyc_status', label: 'KYC', render: (row) => <Badge status={row.kyc_status} /> },
              {
                key: 'referee_status',
                label: 'Referee',
                render: (row) => <Badge status={row.referee_status} />,
              },
              {
                key: 'training_status',
                label: 'Training',
                render: (row) => <Badge status={row.training_status} />,
              },
              {
                key: 'operational_status',
                label: 'Operational',
                render: (row) => <Badge status={row.operational_status} />,
              },
              {
                key: 'action',
                label: '',
                render: (row) => (
                  <button
                    type="button"
                    className="small secondary"
                    onClick={() => navigate(`/agents/${row.id}`)}
                  >
                    Open
                  </button>
                ),
              },
            ]}
            rows={agents}
            empty="No agents match this filter."
          />
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

interface AgentDetail {
  applicationState: string;
  accessStage: string;
  statuses: Record<string, string>;
  checklist: Record<string, boolean>;
  outstanding: string[];
  canCollectRevenue: boolean;
  kyc: Record<string, string> | null;
  referees: any[];
  training: any[];
  devices: any[];
  history: { event_type: string; reason: string | null; created_at: string }[];
}

export function AgentDetailScreen({
  agentId,
  user,
  navigate,
}: {
  agentId: string;
  user: User;
  navigate: (path: string) => void;
}) {
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [territories, setTerritories] = useState<{ id: string; name: string; lga_name: string }[]>([]);
  const [territoryId, setTerritoryId] = useState('');

  const load = useCallback(() => {
    api
      .get<AgentDetail>(`/agents/${agentId}`)
      .then(setDetail)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
  }, [agentId]);

  useEffect(() => {
    load();
    api
      .get<{ id: string; name: string; lga_name: string }[]>('/government/reference/territories')
      .then(setTerritories)
      .catch(() => setTerritories([]));
  }, [load]);

  async function act(fn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setMessage(await fn());
      load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
      else if (caught instanceof Error) {
        setError({ code: 'CLIENT', message: caught.message, moneyStatus: 'NOT_APPLICABLE' });
      }
    } finally {
      setBusy(false);
    }
  }

  if (error && !detail) return <ErrorAlert error={error} />;
  if (!detail) return <Loading rows={6} />;

  const checklist = detail.checklist;

  return (
    <>
      <button type="button" className="link" onClick={() => navigate('/agents')} style={{ marginBottom: 14 }}>
        ← Back to agents
      </button>

      <div className="stat-grid">
        <Stat label="Application state" value={<Badge status={detail.applicationState} />} />
        <Stat label="Access stage" value={<Badge status={detail.accessStage} />} />
        <Stat
          label="May collect revenue"
          value={detail.canCollectRevenue ? 'Yes' : 'No'}
          variant={detail.canCollectRevenue ? 'accent' : 'alert'}
        />
      </div>

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      <div className="grid-2">
        <div className="card">
          <h2 className="card__title">Clearance checklist</h2>
          <p className="card__hint">Every item must be satisfied before activation.</p>
          <Checklist
            items={[
              ['Identity verified (KYC)', checklist.kycCleared],
              ['Referee cleared', checklist.refereeCleared],
              ['Government approved', checklist.governmentApproved],
              ['Mandatory training completed', checklist.trainingCompleted],
              ['Commission bank account verified', checklist.bankVerified],
              ['Agent agreement accepted', checklist.agreementAccepted],
              ['Device registered', checklist.deviceRegistered],
            ]}
          />
          {detail.outstanding.length > 0 && (
            <Alert kind="warning" title="Outstanding">
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {detail.outstanding.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Alert>
          )}
        </div>

        <div className="card">
          <h2 className="card__title">Identity verification</h2>
          {detail.kyc ? (
            <KeyValue
              items={[
                ['Document type', detail.kyc.identity_type],
                ['Number on file', detail.kyc.identity_number_masked],
                ['Status', <Badge key="s" status={detail.kyc.verification_status} />],
                ['Liveness check', detail.kyc.liveness_result ?? 'Not performed'],
                ['Submitted', formatDateTime(detail.kyc.submitted_at)],
                ['Verified', formatDateTime(detail.kyc.verified_at)],
                ['Failure reason', detail.kyc.failure_reason ?? '—'],
              ]}
            />
          ) : (
            <p className="empty">The applicant has not submitted identity verification.</p>
          )}
        </div>

      </div>

      {/*
        The documents behind that verdict, full width and directly below it,
        because those are the two halves of the same question and an officer
        could only ever see the first. Not inside the two-column grid above: a
        document table needs the width, and a photograph of somebody's identity
        papers is not a sidebar item.
      */}
      <KycDocumentsCard agentId={agentId} onReviewed={load} />

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <h2 className="card__title">Referees</h2>
          <p className="card__hint">
            A replaced referee stays on the record — the history is never overwritten.
          </p>
        </div>
        <Table
          columns={[
            { key: 'reference_code', label: 'Reference' },
            { key: 'full_name', label: 'Referee' },
            { key: 'category', label: 'Category' },
            { key: 'relationship', label: 'Relationship' },
            { key: 'status', label: 'Status', render: (row) => <Badge status={row.status} /> },
            { key: 'responded_at', label: 'Responded', render: (row) => formatDateTime(row.responded_at) },
            {
              key: 'action',
              label: '',
              render: (row) =>
                ['SUBMITTED', 'UNDER_REVIEW'].includes(row.status) && can('agent:approve') ? (
                  <div className="button-row">
                    <button
                      type="button"
                      className="small"
                      disabled={busy || reason.trim().length < 10}
                      onClick={() =>
                        act(async () => {
                          await api.post(`/agents/referees/${row.id}/review`, {
                            decision: 'CLEAR',
                            reason,
                          });
                          return 'Referee cleared.';
                        })
                      }
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      className="small danger"
                      disabled={busy || reason.trim().length < 10}
                      onClick={() =>
                        act(async () => {
                          await api.post(`/agents/referees/${row.id}/review`, {
                            decision: 'REJECT',
                            reason,
                          });
                          return 'Referee rejected.';
                        })
                      }
                    >
                      Reject
                    </button>
                  </div>
                ) : null,
            },
          ]}
          rows={detail.referees}
          empty="No referee has been nominated."
        />
      </div>

      <div className="grid-2">
        <div className="card card--flush">
          <div style={{ padding: '18px 18px 0' }}>
            <h2 className="card__title">Training</h2>
          </div>
          <Table
            columns={[
              { key: 'code', label: 'Module' },
              { key: 'title', label: 'Title' },
              { key: 'status', label: 'Status', render: (row) => <Badge status={row.status} /> },
              { key: 'score', label: 'Score', numeric: true, render: (row) => (row.score ?? '—') },
            ]}
            rows={detail.training}
            empty="No training records."
          />
        </div>

        <div className="card card--flush">
          <div style={{ padding: '18px 18px 0' }}>
            <h2 className="card__title">Devices</h2>
            <p className="card__hint">Revoking a device ends its sessions immediately.</p>
          </div>
          <Table
            columns={[
              { key: 'device_name', label: 'Device', render: (row) => row.device_name ?? 'Unnamed' },
              { key: 'pwa_version', label: 'Version' },
              { key: 'status', label: 'Status', render: (row) => <Badge status={row.status} /> },
              {
                key: 'action',
                label: '',
                render: (row) =>
                  row.status !== 'REVOKED' && can('device:manage') ? (
                    <button
                      type="button"
                      className="small danger"
                      disabled={busy || reason.trim().length < 5}
                      onClick={() =>
                        act(async () => {
                          await api.post(`/agents/devices/${row.id}/revoke`, { reason });
                          return 'Device revoked and its sessions ended.';
                        })
                      }
                    >
                      Revoke
                    </button>
                  ) : null,
              },
            ]}
            rows={detail.devices}
            empty="No devices registered."
          />
        </div>
      </div>

      {(can('agent:approve') || can('agent:manage') || can('agent:suspend')) && (
        <div className="card">
          <h2 className="card__title">Decision</h2>
          <p className="card__hint">
            Every decision is recorded against your name in the audit log and requires a reason.
          </p>

          <div className="field">
            <label htmlFor="reason">Reason (minimum 10 characters)</label>
            <textarea
              id="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Identity verified against NIN; referee confirmed by district head; records in order."
            />
          </div>

          {detail.applicationState === 'READY_FOR_REVIEW' && can('agent:approve') && (
            <div className="button-row" style={{ marginBottom: 14 }}>
              <button
                type="button"
                disabled={busy || reason.trim().length < 10}
                onClick={() =>
                  act(async () => {
                    await api.post(`/agents/${agentId}/review`, { decision: 'APPROVE', reason });
                    return 'Application approved.';
                  })
                }
              >
                Approve application
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy || reason.trim().length < 10}
                onClick={() =>
                  act(async () => {
                    await api.post(`/agents/${agentId}/review`, { decision: 'REQUEST_INFO', reason });
                    return 'More information requested from the applicant.';
                  })
                }
              >
                Request more information
              </button>
              <button
                type="button"
                className="danger"
                disabled={busy || reason.trim().length < 10}
                onClick={() =>
                  act(async () => {
                    await api.post(`/agents/${agentId}/review`, { decision: 'REJECT', reason });
                    return 'Application rejected.';
                  })
                }
              >
                Reject
              </button>
            </div>
          )}

          {checklist.governmentApproved && !detail.canCollectRevenue && can('agent:manage') && (
            <>
              <div className="field">
                <label htmlFor="territory">Assign territory</label>
                <select
                  id="territory"
                  value={territoryId}
                  onChange={(event) => setTerritoryId(event.target.value)}
                >
                  <option value="">Select a territory</option>
                  {territories.map((territory) => (
                    <option key={territory.id} value={territory.id}>
                      {territory.name} ({territory.lga_name})
                    </option>
                  ))}
                </select>
                <p className="field__hint">
                  Every transaction is attributed to a territory, so one must be assigned before
                  activation.
                </p>
              </div>
              <button
                type="button"
                disabled={busy || detail.outstanding.length > 0 || !territoryId}
                onClick={() =>
                  act(async () => {
                    await api.post(`/agents/${agentId}/activate`, { territoryId });
                    return 'Agent activated.';
                  })
                }
              >
                Activate agent
              </button>
              {detail.outstanding.length > 0 && (
                <p className="field__hint" style={{ marginTop: 8 }}>
                  Activation is blocked until every clearance item is satisfied. An exception
                  requires an approved government override.
                </p>
              )}
            </>
          )}

          {detail.canCollectRevenue && can('agent:suspend') && (
            <button
              type="button"
              className="danger"
              disabled={busy || reason.trim().length < 10}
              onClick={() =>
                act(async () => {
                  await stepUp('agent.suspend', user.phone);
                  await api.post(`/agents/${agentId}/suspend`, { reason });
                  return 'Agent suspended. Their sessions and devices have been disabled.';
                })
              }
            >
              Suspend agent
            </button>
          )}
        </div>
      )}

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <h2 className="card__title">Clearance history</h2>
        </div>
        <Table
          columns={[
            { key: 'created_at', label: 'When', render: (row) => formatDateTime(row.created_at) },
            { key: 'event_type', label: 'Event', render: (row) => <Badge status={row.event_type} /> },
            { key: 'reason', label: 'Reason', render: (row) => row.reason ?? '—' },
          ]}
          rows={detail.history}
          empty="No clearance events recorded."
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

export function RefereesScreen() {
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    api
      .get('/agents/referee-dashboard')
      .then(setData)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
  }, []);

  if (error) return <ErrorAlert error={error} />;
  if (!data) return <Loading rows={5} />;

  return (
    <>
      <div className="stat-grid">
        <Stat label="Total referees" value={data.counts.total} />
        <Stat label="Pending" value={data.counts.pending} />
        <Stat label="Cleared" value={data.counts.cleared} />
        <Stat
          label="Failed or rejected"
          value={data.counts.failed}
          variant={Number(data.counts.failed) > 0 ? 'alert' : undefined}
        />
      </div>

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <h2 className="card__title">Referee risk flags</h2>
          <p className="card__hint">
            Patterns that suggest a referee relationship is not genuine. Flags are for review — they
            do not block anyone automatically.
          </p>
        </div>
        <Table
          columns={[
            { key: 'full_name', label: 'Referee' },
            { key: 'reference_code', label: 'Reference' },
            { key: 'rule', label: 'Signal', render: (row) => <Badge status={row.rule} /> },
            { key: 'severity', label: 'Severity', render: (row) => <Badge status={row.severity} /> },
            {
              key: 'detail',
              label: 'Detail',
              render: (row) => (
                <span className="mono">{JSON.stringify(row.detail)}</span>
              ),
            },
          ]}
          rows={data.suspiciousReferees}
          empty="No referee risk flags are open."
        />
      </div>

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <h2 className="card__title">Referees supporting more than one applicant</h2>
        </div>
        <Table
          columns={[
            { key: 'full_name', label: 'Referee' },
            { key: 'phone', label: 'Phone' },
            { key: 'agent_count', label: 'Applicants supported', numeric: true },
          ]}
          rows={data.refereesSupportingMultipleAgents}
          empty="No referee supports more than one applicant."
        />
      </div>
    </>
  );
}
