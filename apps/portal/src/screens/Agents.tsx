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
import { usePortalI18n } from '../lib/i18n';

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
  const { t } = usePortalI18n();
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
        <Stat label="ofcAgApplicationsReceived" value={counts.applications_received} />
        <Stat
          label="ofcAgReadyForReview"
          value={counts.ready_for_review}
          variant={Number(counts.ready_for_review) > 0 ? 'accent' : undefined}
          hint="ofcAgBothCleared"
        />
        <Stat label="ofcAgActiveAgents" value={counts.active} />
        <Stat
          label="ofcAgSuspendedStatus"
          value={counts.suspended}
          variant={Number(counts.suspended) > 0 ? 'alert' : undefined}
        />
      </div>

      <div className="stat-grid">
        <Stat label="ofcAgKycPending" value={counts.kyc_pending} />
        {/* Waiting on the applicant, not on us: these need chasing, not reviewing. */}
        <Stat
          label="ofcAgAwaitingApplicant"
          value={counts.kyc_action_required}
          variant={Number(counts.kyc_action_required) > 0 ? 'alert' : undefined}
        />
        <Stat label="ofcAgKycCleared" value={counts.kyc_cleared} />
        <Stat label="ofcAgRefereePending" value={counts.referee_pending} />
        <Stat label="ofcAgRefereeFailed" value={counts.referee_failed} />
      </div>

      <BankChangesCard />

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <h2 className="card__title">{t.ofcAgAwaitingGovernmentReview}</h2>
          <p className="card__hint">{t.ofcAgApplicantsCompleted}</p>
        </div>
        <Table
          columns={[
            { key: 'application_number', label: 'ofcAgApplication' },
            { key: 'full_name', label: 'pubRefereeApplicant' },
            { key: 'phone', label: 'tpPhone' },
            { key: 'lga_name', label: 'tpLgaShort' },
            {
              key: 'application_submitted_at',
              label: 'ofcAgSubmitted',
              render: (row) => formatDateTime(row.application_submitted_at),
            },
            {
              key: 'action',
              label: '',
              render: (row) => (
                <button type="button" className="small" onClick={() => navigate(`/agents/${row.agentId}`)}>{t.tpStepReview}</button>
              ),
            },
          ]}
          rows={dashboard.reviewQueue}
          empty="ofcNoneApplicationsWaitingReview"
        />
      </div>

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <div className="card__header">
            <div>
              <h2 className="card__title">{t.ofcAgAllAgents}</h2>
              <p className="card__hint">{t.ofcAgSixAxes}</p>
            </div>
            <div className="field" style={{ marginBottom: 0, minWidth: 180 }}>
              <label htmlFor="status">{t.ofcAgOperationalStatus}</label>
              <select
                id="status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="">{t.ofcAgAll}</option>
                <option value="ACTIVE">{t.ofcAgActive}</option>
                <option value="INACTIVE">{t.ofcAgInactive}</option>
                <option value="SUSPENDED">{t.ofcAgSuspendedStatus}</option>
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
              { key: 'agent_code', label: 'ofcAgCode', render: (row) => row.agent_code ?? '—' },
              { key: 'full_name', label: 'tpName' },
              { key: 'lga', label: 'tpLgaShort' },
              { key: 'kyc_status', label: 'ofcAgKyc', render: (row) => <Badge status={row.kyc_status} /> },
              {
                key: 'referee_status',
                label: 'appReferee',
                render: (row) => <Badge status={row.referee_status} />,
              },
              {
                key: 'training_status',
                label: 'appTraining',
                render: (row) => <Badge status={row.training_status} />,
              },
              {
                key: 'operational_status',
                label: 'ofcAgOperational',
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
                  >{t.ofcRhOpen}</button>
                ),
              },
            ]}
            rows={agents}
            empty="ofcNoneAgentsMatchFilter"
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
  const { t } = usePortalI18n();
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
      <button type="button" className="link" onClick={() => navigate('/agents')} style={{ marginBottom: 14 }}>{t.ofcAgBackToAgents}</button>

      <div className="stat-grid">
        <Stat label="ofcAgApplicationState" value={<Badge status={detail.applicationState} />} />
        <Stat label="ofcAgAccessStage" value={<Badge status={detail.accessStage} />} />
        <Stat
          label="ofcAgMayCollectRevenue"
          value={detail.canCollectRevenue ? 'Yes' : 'No'}
          variant={detail.canCollectRevenue ? 'accent' : 'alert'}
        />
      </div>

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      <div className="grid-2">
        <div className="card">
          <h2 className="card__title">{t.ofcAgClearanceChecklist}</h2>
          <p className="card__hint">{t.ofcAgEveryItemSatisfied}</p>
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
            <Alert kind="warning" title="ofcAgOutstanding">
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {detail.outstanding.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Alert>
          )}
        </div>

        <div className="card">
          <h2 className="card__title">{t.appIdentityVerification}</h2>
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
            <p className="empty">{t.ofcAgNoKycSubmitted}</p>
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
          <h2 className="card__title">{t.ofcNavReferees}</h2>
          <p className="card__hint">{t.ofcAgRefereeHistoryKept}</p>
        </div>
        <Table
          columns={[
            { key: 'reference_code', label: 'errReference' },
            { key: 'full_name', label: 'appReferee' },
            { key: 'category', label: 'ofcAgCategory' },
            { key: 'relationship', label: 'ofcAgRelationship' },
            { key: 'status', label: 'appStatus', render: (row) => <Badge status={row.status} /> },
            { key: 'responded_at', label: 'ofcAgResponded', render: (row) => formatDateTime(row.responded_at) },
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
                    >{t.ofcAgClear}</button>
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
                    >{t.ofcAgReject}</button>
                  </div>
                ) : null,
            },
          ]}
          rows={detail.referees}
          empty="ofcNoneRefereeNominated"
        />
      </div>

      <div className="grid-2">
        <div className="card card--flush">
          <div style={{ padding: '18px 18px 0' }}>
            <h2 className="card__title">{t.appTraining}</h2>
          </div>
          <Table
            columns={[
              { key: 'code', label: 'ofcAgModule' },
              { key: 'title', label: 'ofcAgTitleHeading' },
              { key: 'status', label: 'appStatus', render: (row) => <Badge status={row.status} /> },
              { key: 'score', label: 'ofcAgScore', numeric: true, render: (row) => (row.score ?? '—') },
            ]}
            rows={detail.training}
            empty="ofcNoneTrainingRecords"
          />
        </div>

        <div className="card card--flush">
          <div style={{ padding: '18px 18px 0' }}>
            <h2 className="card__title">{t.ofcAgDevices}</h2>
            <p className="card__hint">{t.ofcAgDevicesBody}</p>
          </div>
          <Table
            columns={[
              { key: 'device_name', label: 'appDeviceLabel', render: (row) => row.device_name ?? 'Unnamed' },
              { key: 'pwa_version', label: 'ofcAgVersion' },
              { key: 'status', label: 'appStatus', render: (row) => <Badge status={row.status} /> },
              {
                key: 'action',
                label: '',
                render: (row) =>
                  can('device:manage') ? (
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      {/*
                        * Approving takes no reason, unlike revoking. The API asks for
                        * none, and requiring one here would leave a newly registered
                        * phone stranded behind an empty textarea — which is the state
                        * every agent's first sign-in from a browser lands in.
                        */}
                      {row.status === 'PENDING' && (
                        <button
                          type="button"
                          className="small"
                          disabled={busy}
                          onClick={() =>
                            act(async () => {
                              await api.post(`/agents/devices/${row.id}/approve`);
                              return 'Device approved. The agent can now collect from it.';
                            })
                          }
                        >{t.ofcRhApprove}</button>
                      )}
                      {/*
                        * Pausing sits before revoking, and reads as the lesser
                        * thing, because it is: a mislaid handset, a phone in for
                        * repair, or one under a fraud flag somebody wants to look
                        * at. Revoking is final — that handset can never be
                        * registered to this agent again — and was for a long time
                        * the only lever here, so the choice was to ban a working
                        * phone or do nothing.
                        */}
                      {(row.status === 'ACTIVE' || row.status === 'APPROVED') && (
                        <button
                          type="button"
                          className="small secondary"
                          disabled={busy || reason.trim().length < 5}
                          onClick={() =>
                            act(async () => {
                              await api.post(`/agents/devices/${row.id}/suspend`, { reason });
                              return 'Device suspended and its sessions ended. It can be restored.';
                            })
                          }
                        >{t.ofcAgSuspend}</button>
                      )}
                      {row.status === 'SUSPENDED' && (
                        <button
                          type="button"
                          className="small"
                          disabled={busy || reason.trim().length < 5}
                          onClick={() =>
                            act(async () => {
                              await api.post(`/agents/devices/${row.id}/restore`, { reason });
                              return 'Device restored. The agent can collect from it again.';
                            })
                          }
                        >{t.ofcAgRestore}</button>
                      )}
                      {row.status !== 'REVOKED' && (
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
                        >{t.ofcAgRevoke}</button>
                      )}
                    </div>
                  ) : null,
              },
            ]}
            rows={detail.devices}
            empty="ofcNoneDevicesRegistered"
          />
        </div>
      </div>

      {(can('agent:approve') || can('agent:manage') || can('agent:suspend')) && (
        <div className="card">
          <h2 className="card__title">{t.ofcAgDecision}</h2>
          <p className="card__hint">{t.ofcAgDecisionRecorded}</p>

          <div className="field">
            <label htmlFor="reason">{t.ofcAgReasonMinimum}</label>
            <textarea
              id="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t.ofcAgSampleKycNote}
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
              >{t.ofcAgApproveApplication}</button>
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
              >{t.ofcAgRequestMoreInformation}</button>
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
              >{t.ofcAgReject}</button>
            </div>
          )}

          {checklist.governmentApproved && !detail.canCollectRevenue && can('agent:manage') && (
            <>
              <div className="field">
                <label htmlFor="territory">{t.ofcAgAssignTerritory}</label>
                <select
                  id="territory"
                  value={territoryId}
                  onChange={(event) => setTerritoryId(event.target.value)}
                >
                  <option value="">{t.ofcAgSelectTerritory}</option>
                  {territories.map((territory) => (
                    <option key={territory.id} value={territory.id}>
                      {territory.name} ({territory.lga_name})
                    </option>
                  ))}
                </select>
                <p className="field__hint">{t.ofcAgTerritoryRequired}</p>
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
              >{t.ofcAgActivateAgent}</button>
              {detail.outstanding.length > 0 && (
                <p className="field__hint" style={{ marginTop: 8 }}>{t.ofcAgActivationBlocked}</p>
              )}
            </>
          )}

          {/*
            * Moving a working agent to another territory.
            *
            * The selector above sets a territory at activation and there was
            * nothing that could change it afterwards, so `agent:assign_territory`
            * was a permission with no way to exercise it: an agent who moved
            * markets stayed attributed to the one they left, and every
            * collection they made went on the wrong LGA's figures. Historical
            * attribution is not rewritten — transactions keep the territory
            * they were collected under (PRD §74).
            */}
          {detail.canCollectRevenue && can('agent:assign_territory') && (
            <div className="field">
              <label htmlFor="reassign-territory">{t.ofcAgMoveTerritory}</label>
              <select
                id="reassign-territory"
                value={territoryId}
                onChange={(event) => setTerritoryId(event.target.value)}
              >
                <option value="">{t.ofcAgSelectTerritory}</option>
                {territories.map((territory) => (
                  <option key={territory.id} value={territory.id}>
                    {territory.name} ({territory.lga_name})
                  </option>
                ))}
              </select>
              <p className="field__hint">{t.ofcAgMoveTerritoryBody}</p>
              <button
                type="button"
                className="secondary"
                disabled={busy || !territoryId}
                onClick={() =>
                  act(async () => {
                    await api.post(`/agents/${agentId}/territory`, { territoryId });
                    setTerritoryId('');
                    return 'Territory reassigned. Future collections are attributed to it.';
                  })
                }
              >{t.ofcAgReassignTerritory}</button>
            </div>
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
            >{t.ofcAgSuspendAgent}</button>
          )}
        </div>
      )}

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <h2 className="card__title">{t.ofcAgClearanceHistory}</h2>
        </div>
        <Table
          columns={[
            { key: 'created_at', label: 'ofcRhWhen', render: (row) => formatDateTime(row.created_at) },
            { key: 'event_type', label: 'ofcAgEvent', render: (row) => <Badge status={row.event_type} /> },
            { key: 'reason', label: 'ofcAgReason', render: (row) => row.reason ?? '—' },
          ]}
          rows={detail.history}
          empty="ofcNoneClearanceEventsRecorded"
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

export function RefereesScreen() {
  const { t } = usePortalI18n();
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [reviewing, setReviewing] = useState<any | null>(null);
  const [decision, setDecision] = useState<'UNDER_REVIEW' | 'CONFIRMED' | 'DISMISSED'>('UNDER_REVIEW');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get('/agents/referee-dashboard')
      .then(setData)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
  }, []);

  useEffect(load, [load]);

  /**
   * Closing a flag, which is what makes the queue readable.
   *
   * The flags were raised and nothing could ever move them, so the list only
   * grew — and a queue that only grows is a queue that stops being read.
   * Confirming one is not a note either: a referee with an upheld flag against
   * them cannot be cleared until an officer dismisses it on the record.
   */
  async function submitReview() {
    if (!reviewing || note.trim().length < 10) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.post(`/agents/referees/flags/${reviewing.id}/review`, {
        decision,
        note: note.trim(),
      });
      setMessage(
        decision === 'CONFIRMED'
          ? 'Flag upheld. This referee cannot be cleared until it is dismissed.'
          : decision === 'DISMISSED'
            ? 'Flag dismissed. The referee can be cleared as normal.'
            : 'Flag marked as under review.',
      );
      setReviewing(null);
      setNote('');
      load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <ErrorAlert error={error} />;
  if (!data) return <Loading rows={5} />;

  return (
    <>
      {error && <ErrorAlert error={error} />}
      {message && (
        <Alert kind="success">
          <p style={{ margin: 0 }}>{message}</p>
        </Alert>
      )}
      <div className="stat-grid">
        <Stat label="ofcAgTotalReferees" value={data.counts.total} />
        <Stat label="ofcAgPending" value={data.counts.pending} />
        <Stat label="ofcAgCleared" value={data.counts.cleared} />
        <Stat
          label="ofcAgFailedRejected"
          value={data.counts.failed}
          variant={Number(data.counts.failed) > 0 ? 'alert' : undefined}
        />
      </div>

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <h2 className="card__title">{t.ofcAgRefereeRiskFlags}</h2>
          <p className="card__hint">{t.ofcAgRefereeRiskBody}</p>
        </div>
        <Table
          columns={[
            { key: 'full_name', label: 'appReferee' },
            { key: 'reference_code', label: 'errReference' },
            { key: 'rule', label: 'ofcAgSignal', render: (row) => <Badge status={row.rule} /> },
            { key: 'severity', label: 'ofcAgSeverity', render: (row) => <Badge status={row.severity} /> },
            {
              key: 'detail',
              label: 'ofcAgDetail',
              render: (row) => (
                <span className="mono">{JSON.stringify(row.detail)}</span>
              ),
            },
            {
              key: 'action',
              label: '',
              render: (row) =>
                can('fraud:manage') ? (
                  <button
                    type="button"
                    className="small secondary"
                    onClick={() => {
                      setReviewing(row);
                      setDecision(row.status === 'UNDER_REVIEW' ? 'CONFIRMED' : 'UNDER_REVIEW');
                      setNote('');
                      setMessage(null);
                    }}
                  >{t.tpStepReview}</button>
                ) : null,
            },
          ]}
          rows={data.suspiciousReferees}
          empty="ofcNoneRefereeRiskFlagsOpen"
        />
      </div>

      {reviewing && (
        <div className="card">
          <h2 className="card__title">Risk flag — {reviewing.full_name}</h2>
          <p className="card__hint">
            {String(reviewing.rule).replace(/_/g, ' ').toLowerCase()}. Record what you found: it is
            the only account of why this flag was left open, upheld or set aside.
          </p>

          <div className="field">
            <label htmlFor="flag-decision">{t.ofcAgWhatYouFound}</label>
            <select
              id="flag-decision"
              value={decision}
              onChange={(event) => setDecision(event.target.value as typeof decision)}
            >
              <option value="UNDER_REVIEW">{t.ofcAgLookingIntoIt}</option>
              <option value="CONFIRMED">{t.ofcAgUpheld}</option>
              <option value="DISMISSED">{t.ofcAgDismissed}</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="flag-note">{t.ofcAgWhatYouFound}</label>
            <textarea
              id="flag-note"
              value={note}
              rows={3}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t.ofcAgSampleRefereeNote}
            />
          </div>

          <div className="button-row">
            <button type="button" disabled={busy || note.trim().length < 10} onClick={submitReview}>
              {busy ? 'Saving…' : 'Record this'}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setReviewing(null);
                setNote('');
              }}
            >{t.camCancel}</button>
          </div>
        </div>
      )}

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <h2 className="card__title">{t.ofcAgRefereesMultiple}</h2>
        </div>
        <Table
          columns={[
            { key: 'full_name', label: 'appReferee' },
            { key: 'phone', label: 'tpPhone' },
            { key: 'agent_count', label: 'ofcAgApplicantsSupported', numeric: true },
          ]}
          rows={data.refereesSupportingMultipleAgents}
          empty="ofcNoneRefereeSupportsMoreApplicant"
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

interface PendingBankChange {
  approvalId: string;
  agentId: string;
  agentName: string;
  agentCode: string;
  bankName: string;
  accountNumberMasked: string;
  accountName: string;
  verificationStatus: string;
  verificationResolvedName: string | null;
  verificationReason: string | null;
  requestedReason: string;
  requestedAt: string;
  requestedByRole: string | null;
  current: { bankName: string; accountNumberMasked: string; accountName: string } | null;
}

/**
 * Changes of the account an agent's commission is paid into.
 *
 * The decision an officer makes here moves where public money goes, so the
 * screen is built around the one piece of evidence that matters: the name the
 * bank returned for the new account. That is the thing somebody redirecting a
 * payout cannot supply, and it is shown next to the name the agent gave
 * rather than reduced to a status badge, because "verified" tells an officer
 * nothing they can weigh.
 *
 * Approve is not offered at all until the bank has confirmed the account. The
 * API refuses it in that state regardless; hiding the button as well means an
 * officer is never invited to press something that cannot work.
 */
export function BankChangesCard() {
  const { t } = usePortalI18n();
  const [changes, setChanges] = useState<PendingBankChange[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<{ changes: PendingBankChange[] }>('/agents/bank-changes')
      .then((data) => setChanges(data.changes))
      .catch((caught) => {
        setChanges([]);
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
  }, []);

  useEffect(load, [load]);

  async function act(id: string, run: () => Promise<string>) {
    setBusy(id);
    setError(null);
    setMessage(null);
    try {
      setMessage(await run());
      load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
      else if (caught instanceof Error) {
        setError({ code: 'CLIENT', message: caught.message, moneyStatus: 'NOT_APPLICABLE' });
      }
    } finally {
      setBusy(null);
    }
  }

  function decide(change: PendingBankChange, decision: 'APPROVE' | 'REJECT') {
    const reason = window.prompt(
      decision === 'APPROVE'
        ? `Say how you confirmed this change with ${change.agentName} (at least 10 characters):`
        : `Say why this change is being refused (at least 10 characters):`,
    );
    if (reason === null) return;
    if (reason.trim().length < 10) {
      setError({
        code: 'CLIENT',
        message:
          'Give a reason of at least 10 characters. It is the only record of why the account ' +
          'somebody is paid into was moved.',
        moneyStatus: 'NOT_APPLICABLE',
      });
      return;
    }
    void act(change.approvalId, async () => {
      const result = await api.post<{ message?: string }>(
        `/government/approvals/${change.approvalId}/decide`,
        { decision, reason: reason.trim() },
      );
      return (
        result.message ??
        (decision === 'APPROVE'
          ? `${change.agentName}'s commission account has been changed.`
          : `The change for ${change.agentName} was refused. Their existing account is unchanged.`)
      );
    });
  }

  if (!changes) return <Loading rows={2} />;

  return (
    <div className="card">
      <h2 className="card__title">{t.ofcAgBankAccountChanges}</h2>
      <p className="card__hint">
        {t.ofcAgBankChangeBody}
      </p>

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      {changes.length === 0 ? (
        <p className="empty">{t.ofcAgNoBankChanges}</p>
      ) : (
        <ul className="list">
          {changes.map((change) => {
            const confirmed = change.verificationStatus === 'VERIFIED';
            const nameDiffers =
              confirmed &&
              change.verificationResolvedName !== null &&
              change.verificationResolvedName.trim().toLowerCase() !==
                change.accountName.trim().toLowerCase();
            return (
              <li key={change.approvalId} style={{ padding: '14px 0' }}>
                <p className="list__title" style={{ margin: '0 0 6px' }}>
                  {change.agentName} <span className="mono">{change.agentCode}</span>
                </p>
                <KeyValue
                  items={[
                    [
                      'Paid into now',
                      change.current
                        ? `${change.current.bankName} ${change.current.accountNumberMasked}`
                        : '—',
                    ],
                    ['Would change to', `${change.bankName} ${change.accountNumberMasked}`],
                    ['Name the agent gave', change.accountName],
                    [
                      'Name the bank returned',
                      confirmed
                        ? (change.verificationResolvedName ?? 'Confirmed, no name returned')
                        : change.verificationStatus === 'PENDING'
                          ? 'The bank could not be reached'
                          : `Not confirmed${change.verificationReason ? `: ${change.verificationReason}` : ''}`,
                    ],
                    ['Reason given', change.requestedReason],
                    [
                      'Asked for by',
                      change.requestedByRole === 'agent'
                        ? 'The agent'
                        : `An officer (${change.requestedByRole ?? 'unknown role'})`,
                    ],
                    ['Requested', formatDateTime(change.requestedAt)],
                  ]}
                />

                {nameDiffers && (
                  <Alert kind="warning" title="ofcAgBankDifferentName">
                    <p style={{ margin: 0 }}>
                      The agent gave &ldquo;{change.accountName}&rdquo; and the bank holds this
                      account as &ldquo;{change.verificationResolvedName}&rdquo;. Confirm with the
                      agent directly before approving.
                    </p>
                  </Alert>
                )}

                {!confirmed && (
                  <Alert kind="warning" title="moreBankNotConfirmed">
                    <p style={{ margin: 0 }}>
                      {change.verificationStatus === 'PENDING'
                        ? 'The bank verification service could not be reached. Try again before deciding — an unconfirmed account cannot be approved.'
                        : 'This account cannot be approved while the bank does not confirm it. Refuse the request so the agent can send the right details.'}
                    </p>
                  </Alert>
                )}

                <div className="button-row">
                  {can('agent:manage') && change.verificationStatus === 'PENDING' && (
                    <button
                      type="button"
                      className="small secondary"
                      disabled={busy === change.approvalId}
                      onClick={() =>
                        void act(change.approvalId, async () => {
                          const result = await api.post<{ verified: boolean; outcome: string }>(
                            `/agents/bank-changes/${change.approvalId}/verify`,
                            {},
                          );
                          return result.verified
                            ? 'The bank confirmed the account.'
                            : `The bank still did not confirm it (${result.outcome.toLowerCase()}).`;
                        })
                      }
                    >{t.ofcAgAskBankAgain}</button>
                  )}
                  {can('approval:authorise') && confirmed && (
                    <button
                      type="button"
                      className="small"
                      disabled={busy === change.approvalId}
                      onClick={() => decide(change, 'APPROVE')}
                    >{t.ofcRhApprove}</button>
                  )}
                  {can('approval:review') && (
                    <button
                      type="button"
                      className="small danger"
                      disabled={busy === change.approvalId}
                      onClick={() => decide(change, 'REJECT')}
                    >{t.ofcAgRefuse}</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
