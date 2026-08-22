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

const readable = (value: string | null) =>
  value ? value.replace(/_/g, ' ').toLowerCase() : '—';

export function GroupsScreen({ navigate }: { navigate: (path: string) => void }) {
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [rounds, setRounds] = useState<RoundRow[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [attestationLink, setAttestationLink] = useState<{ name: string; url: string } | null>(null);

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

  async function act(fn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setMessage(await fn());
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
        <Alert kind="success" title="Done">
          <p style={{ margin: 0 }}>{message}</p>
        </Alert>
      )}

      {attestationLink && (
        <Alert kind="info" title={`Confirmation link for ${attestationLink.name}`}>
          <p style={{ margin: '0 0 8px' }}>
            Send this to the group leader. It is shown once — PSIRS stores only a hash of it, so
            it cannot be read back later. Request another if it is lost.
          </p>
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
          <h2 className="card__title">Waiting for a decision</h2>
          <p className="card__hint">
            An agent has recorded these groups in the field. Members cannot be added until a group
            is approved, so nothing else happens while they sit here.
          </p>

          <div className="field">
            <label htmlFor="group-reason">Reason (minimum 10 characters)</label>
            <textarea
              id="group-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Checked against the ministry register of cooperatives."
            />
          </div>

          <Table
            columns={[
              { key: 'code', label: 'Code' },
              { key: 'name', label: 'Group' },
              { key: 'group_type', label: 'Type', render: (row) => readable(row.group_type) },
              { key: 'lga_name', label: 'LGA' },
              { key: 'leader_name', label: 'Leader', render: (row) => `${row.leader_name} · ${row.leader_phone}` },
              {
                key: 'action',
                label: '',
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
                    >
                      Approve
                    </button>
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
                    >
                      Suspend
                    </button>
                  </div>
                ),
              },
            ]}
            rows={pending}
            empty="Nothing waiting."
          />
        </div>
      )}

      {can('allocation:read:all') && rounds !== null && (
        <div className="card card--flush">
          <div style={{ padding: '18px 18px 0' }}>
            <h2 className="card__title">Distributions</h2>
            <p className="card__hint">
              Fertiliser, seed and other allocations with a fixed quantity behind them. Open one to
              see who has been awarded and who has actually collected.
            </p>
          </div>
          <Table
            columns={[
              { key: 'name', label: 'Round' },
              { key: 'programme_name', label: 'Programme' },
              {
                key: 'total_quantity',
                label: 'Total',
                render: (row) => `${row.total_quantity} ${readable(row.unit)}`,
              },
              {
                key: 'awarded_quantity',
                label: 'Awarded',
                render: (row) => `${row.awarded_quantity} (${row.awarded_count} people)`,
              },
              { key: 'collected_count', label: 'Collected' },
              { key: 'status', label: 'Status', render: (row) => <Badge status={row.status} /> },
              {
                key: 'open',
                label: '',
                render: (row) => (
                  <button
                    type="button"
                    className="small secondary"
                    onClick={() => navigate(`/allocations/${row.id}`)}
                  >
                    Open
                  </button>
                ),
              },
            ]}
            rows={rounds}
            empty="No distributions have been set up yet."
          />
        </div>
      )}

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <h2 className="card__title">Registered groups</h2>
          <p className="card__hint">
            Cooperatives, market associations and unions. The member count is confirmed
            membership only — what an agent recorded but the leader has not yet confirmed does not
            count towards anything.
          </p>
          <div className="field" style={{ maxWidth: 260 }}>
            <label htmlFor="group-status">Status</label>
            <select
              id="group-status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">All</option>
              <option value="PENDING">Pending</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
            </select>
          </div>
        </div>

        <Table
          columns={[
            { key: 'code', label: 'Code' },
            { key: 'name', label: 'Group' },
            { key: 'group_type', label: 'Type', render: (row) => readable(row.group_type) },
            { key: 'economic_sector', label: 'Sector', render: (row) => readable(row.economic_sector) },
            { key: 'lga_name', label: 'LGA' },
            { key: 'attested_members', label: 'Confirmed members' },
            { key: 'status', label: 'Status', render: (row) => <Badge status={row.status} /> },
            {
              key: 'attest',
              label: '',
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
                  >
                    Ask the leader
                  </button>
                ) : null,
            },
          ]}
          rows={groups}
          empty="No groups have been registered yet."
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
        <Alert kind="success" title="Done">
          <p style={{ margin: 0 }}>{message}</p>
        </Alert>
      )}

      <div className="stat-grid">
        <div className="stat">
          <p className="stat__label">Total</p>
          <p className="stat__value">
            {round.total_quantity} <span style={{ fontSize: '0.7em' }}>{readable(round.unit)}</span>
          </p>
        </div>
        <div className="stat">
          <p className="stat__label">Awarded</p>
          <p className="stat__value">{round.awardedQuantity}</p>
          <p className="stat__hint">{round.awardedCount} beneficiaries</p>
        </div>
        <div className="stat">
          <p className="stat__label">Collected</p>
          <p className="stat__value">{round.collectedQuantity}</p>
          <p className="stat__hint">
            {round.collectedCount} of {round.awardedCount} ({collectionRate}%)
          </p>
        </div>
        <div className="stat">
          <p className="stat__label">Remaining</p>
          <p className="stat__value">{round.remainingQuantity}</p>
          <p className="stat__hint">enough for {round.beneficiariesRemaining} more</p>
        </div>
      </div>

      {round.awardedCount > 0 && collectionRate < 60 && (
        <Alert kind="warning" title="Most of this round has not been collected">
          <p style={{ margin: 0 }}>
            {round.awardedCount - round.collectedCount} beneficiaries were awarded and have not
            turned up. That is either a distribution that is not reaching people, or names on a
            list that do not correspond to anybody — worth establishing which before the next
            round.
          </p>
        </Alert>
      )}

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <h2 className="card__title">{round.name}</h2>
          <p className="card__hint">
            {round.quantity_per_beneficiary} {readable(round.unit)} each
            {round.collection_point ? ` · collected at ${round.collection_point}` : ''} ·{' '}
            <Badge status={round.status} />
          </p>
        </div>

        {awards === null ? (
          <Loading rows={3} />
        ) : awards.length === 0 ? (
          <Empty>Nobody has been awarded from this round yet.</Empty>
        ) : (
          <Table
            columns={[
              { key: 'taxpayer_name', label: 'Beneficiary' },
              { key: 'tin', label: 'TIN', render: (row) => row.tin ?? '—' },
              { key: 'group_name', label: 'Group', render: (row) => row.group_name ?? '—' },
              { key: 'quantity', label: 'Quantity' },
              {
                key: 'compliance_score',
                label: 'Score at award',
                render: (row) => (row.compliance_score === null ? '—' : String(row.compliance_score)),
              },
              { key: 'status', label: 'Status', render: (row) => <Badge status={row.status} /> },
              {
                key: 'collected_at',
                label: 'Collected',
                render: (row) => (row.collected_at ? formatDateTime(row.collected_at) : '—'),
              },
            ]}
            rows={awards}
            empty="Nobody has been awarded from this round yet."
          />
        )}
      </div>
    </>
  );
}
