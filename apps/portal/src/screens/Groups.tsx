/**
 * Informal-sector groups, and the distribution of what there is a fixed amount
 * of.
 *
 * Two screens that belong together because they are two halves of one job: a
 * cooperative is only worth registering if something eventually reaches its
 * members, and a distribution is only trustworthy if somebody vouched for who
 * the members are.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api, can, type ApiError } from '../lib/api';
import { Alert, Badge, ErrorAlert, Empty, Loading, Table, formatDateTime } from '../ui';
import { usePortalI18n } from '../lib/i18n';
import { enumLabel } from '@psirs/shared';

interface RoundRow {
  id: string;
  name: string;
  unit: string;
  total_quantity: string;
  status: string;
  programme_name: string;
  awarded_quantity: string;
  awarded_count: string;
  collected_count: string;
}

interface GroupRow {
  id: string;
  code: string;
  name: string;
  group_type: string;
  economic_sector: string | null;
  status: string;
  lga_name: string;
  leader_name: string;
  leader_phone: string;
  attested_members: string;
}

interface MemberRow {
  id: string;
  member_name: string | null;
  tin: string | null;
  status: string;
  attested_at: string | null;
  rejection_reason: string | null;
  left_at: string | null;
  left_reason: string | null;
}


export function GroupsScreen({ navigate }: { navigate: (path: string) => void }) {
  const { t } = usePortalI18n();
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [rounds, setRounds] = useState<RoundRow[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [attestationLink, setAttestationLink] = useState<{ name: string; url: string } | null>(null);
  const [members, setMembers] = useState<{ group: GroupRow; rows: MemberRow[] } | null>(null);
  const [departureReason, setDepartureReason] = useState('');

  const load = useCallback(() => {
    api
      .get<{ groups: GroupRow[] }>(`/groups${status ? `?status=${status}` : ''}`)
      .then((result) => setGroups(result.groups))
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
    if (can('allocation:read:all')) {
      api
        .get<{ rounds: RoundRow[] }>('/allocations/rounds')
        .then((result) => setRounds(result.rounds))
        .catch(() => setRounds([]));
    } else {
      setRounds([]);
    }
  }, [status]);

  useEffect(load, [load]);

  async function act(fn: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const note = await fn();
      // Opening a panel is not news; only say something when something changed.
      if (note) setMessage(note);
      load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  if (!groups) return <Loading rows={6} />;

  const pending = groups.filter((g) => g.status === 'PENDING');

  return (
    <>
      <ErrorAlert error={error} />
      {message && (
        <Alert kind="success" title="ofcSpDone">
          <p style={{ margin: 0 }}>{message}</p>
        </Alert>
      )}

      {attestationLink && (
        <Alert kind="info" title={{ text: t.ofcGpConfirmationLinkFor.replace('{{group}}', attestationLink.name) }}>
          <p style={{ margin: '0 0 8px' }}>{t.ofcGpLeaderCodeOnce}</p>
          <code
            style={{
              display: 'block',
              wordBreak: 'break-all',
              fontSize: '0.78rem',
              background: 'var(--surface-2, #f3f4f6)',
              padding: '8px 10px',
              borderRadius: 8,
            }}
          >
            {attestationLink.url}
          </code>
        </Alert>
      )}

      {pending.length > 0 && can('group:manage') && (
        <div className="card">
          <h2 className="card__title">{t.ofcGpWaitingDecision}</h2>
          <p className="card__hint">{t.ofcGpWaitingIntro}</p>

          <div className="field">
            <label htmlFor="group-reason">{t.ofcAgReasonMinimum}</label>
            <textarea
              id="group-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t.ofcGpSampleNote}
            />
          </div>

          <Table
            columns={[
              { key: 'code', label: 'ofcAgCode' },
              { key: 'name', label: 'pubAttestGroup' },
              { key: 'group_type', label: 'tpType', render: (row) => enumLabel(row.group_type, t) },
              { key: 'lga_name', label: 'tpLgaShort' },
              { key: 'leader_name', label: 'grpLeader', render: (row) => `${row.leader_name} · ${row.leader_phone}` },
              {
                key: 'action',
                label: { text: '' },
                render: (row) => (
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="small"
                      disabled={busy || reason.trim().length < 10}
                      onClick={() =>
                        act(async () => {
                          await api.post(`/groups/${row.id}/review`, {
                            decision: 'APPROVE',
                            reason,
                          });
                          return `${row.name} approved. Members can now be recorded.`;
                        })
                      }
                    >{t.ofcRhApprove}</button>
                    <button
                      type="button"
                      className="small danger"
                      disabled={busy || reason.trim().length < 10}
                      onClick={() =>
                        act(async () => {
                          await api.post(`/groups/${row.id}/review`, {
                            decision: 'SUSPEND',
                            reason,
                          });
                          return `${row.name} suspended.`;
                        })
                      }
                    >{t.ofcAgSuspend}</button>
                  </div>
                ),
              },
            ]}
            rows={pending}
            empty="ofcNoneNothingWaiting"
          />
        </div>
      )}

      {can('allocation:read:all') && rounds !== null && (
        <div className="card card--flush">
          <div style={{ padding: '18px 18px 0' }}>
            <h2 className="card__title">{t.ofcGpDistributions}</h2>
            <p className="card__hint">{t.ofcGpDistributionsIntro}</p>
          </div>
          <Table
            columns={[
              { key: 'name', label: 'ofcAlRound' },
              { key: 'programme_name', label: 'ofcAlProgramme' },
              {
                key: 'total_quantity',
                label: 'ofcGpTotal',
                render: (row) => `${row.total_quantity} ${enumLabel(row.unit, t)}`,
              },
              {
                key: 'awarded_quantity',
                label: 'ofcGpAwarded',
                render: (row) => `${row.awarded_quantity} (${row.awarded_count} people)`,
              },
              { key: 'collected_count', label: 'ofcPfCollected' },
              { key: 'status', label: 'appStatus', render: (row) => <Badge status={row.status} /> },
              {
                key: 'open',
                label: { text: '' },
                render: (row) => (
                  <button
                    type="button"
                    className="small secondary"
                    onClick={() => navigate(`/allocations/${row.id}`)}
                  >{t.ofcRhOpen}</button>
                ),
              },
            ]}
            rows={rounds}
            empty="ofcNoneDistributionsSetUp"
          />
        </div>
      )}

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <h2 className="card__title">{t.ofcGpRegisteredGroups}</h2>
          <p className="card__hint">{t.ofcGpGroupsIntro}</p>
          <div className="field" style={{ maxWidth: 260 }}>
            <label htmlFor="group-status">{t.appStatus}</label>
            <select
              id="group-status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">{t.ofcAgAll}</option>
              <option value="PENDING">{t.ofcAgPending}</option>
              <option value="ACTIVE">{t.ofcAgActive}</option>
              <option value="SUSPENDED">{t.ofcAgSuspendedStatus}</option>
            </select>
          </div>
        </div>

      {members && (
        <div className="card card--flush">
          <div style={{ padding: '18px 18px 0' }}>
            <div className="card__header">
              <div>
                <h2 className="card__title">
                  {t.ofcGpMembersFor.replace('{{name}}', members.group.name)}
                </h2>
                <p className="card__hint">{t.ofcGpMembersIntro}</p>
              </div>
              <button type="button" className="small secondary" onClick={() => setMembers(null)}>{t.ofcKycClose}</button>
            </div>

            {can('group:manage') && (
              <div className="field">
                <label htmlFor="departure-reason">{t.ofcGpMembershipEnded}</label>
                <textarea
                  id="departure-reason"
                  rows={2}
                  value={departureReason}
                  onChange={(event) => setDepartureReason(event.target.value)}
                  placeholder={t.ofcGpSampleEnded}
                />
              </div>
            )}
          </div>

          <Table
            columns={[
              { key: 'member_name', label: 'pubAttestYes', render: (row) => row.member_name ?? '—' },
              { key: 'tin', label: 'tpStepTin', render: (row) => row.tin ?? '—' },
              { key: 'status', label: 'appStatus', render: (row) => <Badge status={row.status} /> },
              {
                key: 'left_reason',
                label: 'ofcGpNote',
                render: (row) => row.left_reason ?? row.rejection_reason ?? '—',
              },
              {
                key: 'action',
                label: { text: '' },
                render: (row) =>
                  can('group:manage') && (row.status === 'ATTESTED' || row.status === 'PENDING_ATTESTATION') ? (
                    <button
                      type="button"
                      className="small danger"
                      disabled={busy || departureReason.trim().length < 5}
                      onClick={() =>
                        act(async () => {
                          const result = await api.post<{ message: string }>(
                            `/groups/${members.group.id}/members/${row.id}/departure`,
                            { reason: departureReason },
                          );
                          const refreshed = await api.get<MemberRow[]>(
                            `/groups/${members.group.id}/members`,
                          );
                          setMembers({ group: members.group, rows: refreshed });
                          setDepartureReason('');
                          return result.message;
                        })
                      }
                    >
                      {t.ofcGpRecordDeparture}
                    </button>
                  ) : null,
              },
            ]}
            rows={members.rows}
            empty="ofcNoneNobodyRecordedGroup"
          />
        </div>
      )}

        <Table
          columns={[
            { key: 'code', label: 'ofcAgCode' },
            { key: 'name', label: 'pubAttestGroup' },
            { key: 'group_type', label: 'tpType', render: (row) => enumLabel(row.group_type, t) },
            { key: 'economic_sector', label: 'ofcGpSector', render: (row) => enumLabel(row.economic_sector, t) },
            { key: 'lga_name', label: 'tpLgaShort' },
            { key: 'attested_members', label: 'ofcGpConfirmedMembers' },
            { key: 'status', label: 'appStatus', render: (row) => <Badge status={row.status} /> },
            {
              key: 'members',
              label: { text: '' },
              render: (row) =>
                can('group:read:all') || can('group:read:own') ? (
                  <button
                    type="button"
                    className="small secondary"
                    onClick={() =>
                      act(async () => {
                        const rows = await api.get<MemberRow[]>(`/groups/${row.id}/members`);
                        setMembers({ group: row, rows });
                        return null;
                      })
                    }
                  >{t.ofcGpMembers}</button>
                ) : null,
            },
            {
              key: 'attest',
              label: { text: '' },
              render: (row) =>
                row.status === 'ACTIVE' && can('group:manage') ? (
                  <button
                    type="button"
                    className="small secondary"
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        const result = await api.post<{ invitationUrl: string }>(
                          `/groups/${row.id}/attestation-request`,
                        );
                        setAttestationLink({ name: row.name, url: result.invitationUrl });
                        return 'Confirmation link created.';
                      })
                    }
                  >{t.ofcGpAskLeader}</button>
                ) : null,
            },
          ]}
          rows={groups}
          empty="ofcNoneGroupsRegistered"
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

interface RoundSummary {
  id: string;
  name: string;
  unit: string;
  total_quantity: string;
  quantity_per_beneficiary: string;
  status: string;
  collection_point: string | null;
  awardedCount: number;
  awardedQuantity: string;
  collectedCount: number;
  collectedQuantity: string;
  remainingQuantity: string;
  beneficiariesRemaining: number;
}

interface AwardRow {
  id: string;
  status: string;
  quantity: string;
  collection_code: string;
  compliance_score: number | null;
  awarded_at: string;
  collected_at: string | null;
  taxpayer_name: string;
  tin: string | null;
  group_name: string | null;
}

/**
 * One distribution: how much there is, who has been promised some, and who has
 * actually turned up for it.
 *
 * Awarded against collected is the number that matters. A large gap is either
 * a distribution that is not reaching people or a list of people who do not
 * exist, and both are worth knowing before the next round is planned.
 */
export function AllocationRoundScreen({ roundId }: { roundId: string }) {
  const { t } = usePortalI18n();
  const [round, setRound] = useState<RoundSummary | null>(null);
  const [awards, setAwards] = useState<AwardRow[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get<RoundSummary>(`/allocations/rounds/${roundId}`)
      .then(setRound)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
    api
      .get<{ awards: AwardRow[] }>(`/allocations/rounds/${roundId}/awards`)
      .then((result) => setAwards(result.awards))
      .catch(() => undefined);
  }, [roundId]);

  useEffect(load, [load]);

  if (!round) return <Loading rows={5} />;

  const collectionRate =
    round.awardedCount > 0 ? Math.round((round.collectedCount / round.awardedCount) * 100) : 0;

  return (
    <>
      <ErrorAlert error={error} />
      {message && (
        <Alert kind="success" title="ofcSpDone">
          <p style={{ margin: 0 }}>{message}</p>
        </Alert>
      )}

      <div className="stat-grid">
        <div className="stat">
          <p className="stat__label">{t.ofcGpTotal}</p>
          <p className="stat__value">
            {round.total_quantity} <span style={{ fontSize: '0.7em' }}>{enumLabel(round.unit, t)}</span>
          </p>
        </div>
        <div className="stat">
          <p className="stat__label">{t.ofcGpAwarded}</p>
          <p className="stat__value">{round.awardedQuantity}</p>
          <p className="stat__hint">{round.awardedCount} beneficiaries</p>
        </div>
        <div className="stat">
          <p className="stat__label">{t.ofcPfCollected}</p>
          <p className="stat__value">{round.collectedQuantity}</p>
          <p className="stat__hint">
            {round.collectedCount} of {round.awardedCount} ({collectionRate}%)
          </p>
        </div>
        <div className="stat">
          <p className="stat__label">{t.ofcGpRemaining}</p>
          <p className="stat__value">{round.remainingQuantity}</p>
          <p className="stat__hint">
            {t.ofcGpEnoughForMore.replace('{{n}}', String(round.beneficiariesRemaining))}
          </p>
        </div>
      </div>

      {round.awardedCount > 0 && collectionRate < 60 && (
        <Alert kind="warning" title="ofcGpMostNotCollected">
          <p style={{ margin: 0 }}>
            {t.ofcGpAwardedNotCollected.replace(
              '{{n}}',
              String(round.awardedCount - round.collectedCount),
            )}
          </p>
        </Alert>
      )}

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <h2 className="card__title">{round.name}</h2>
          <p className="card__hint">
            {round.quantity_per_beneficiary} {enumLabel(round.unit, t)} each
            {round.collection_point ? ` · collected at ${round.collection_point}` : ''} ·{' '}
            <Badge status={round.status} />
          </p>
        </div>

        {awards === null ? (
          <Loading rows={3} />
        ) : awards.length === 0 ? (
          <Empty>{t.ofcNoneNobodyAwardedRound}</Empty>
        ) : (
          <Table
            columns={[
              { key: 'taxpayer_name', label: 'ofcAlBeneficiary' },
              { key: 'tin', label: 'tpStepTin', render: (row) => row.tin ?? '—' },
              { key: 'group_name', label: 'pubAttestGroup', render: (row) => row.group_name ?? '—' },
              { key: 'quantity', label: 'ofcAlQuantity' },
              {
                key: 'compliance_score',
                label: 'ofcGpScoreAtAward',
                render: (row) => (row.compliance_score === null ? '—' : String(row.compliance_score)),
              },
              { key: 'status', label: 'appStatus', render: (row) => <Badge status={row.status} /> },
              {
                key: 'collected_at',
                label: 'ofcPfCollected',
                render: (row) => (row.collected_at ? formatDateTime(row.collected_at) : '—'),
              },
            ]}
            rows={awards}
            empty="ofcNoneNobodyAwardedRound"
          />
        )}
      </div>
    </>
  );
}
