/**
 * The two queues enumeration produces, and the decisions on them.
 *
 * Phase 5 puts an estimate in front of a citizen. Everything an officer does
 * about that estimate afterwards happens here, and the screen is shaped by
 * two things a person on the other side of the counter would want to know.
 *
 * WHEN THE AGENT AND THE LEADER DISAGREE, BOTH VERSIONS ARE SHOWN.
 *
 * Not a flag saying "disputed" — the two sets of facts, side by side, with the
 * band each would produce. A supervisor deciding between them needs to see how
 * far apart they actually are, and a disagreement that does not change the
 * band is a phone call while one that does is a visit.
 *
 * AN OBJECTION IS DECIDED BY SOMEBODY ELSE.
 *
 * The officer who raised the assessment may not decide the objection to it,
 * which the database enforces. This screen says so before they try, because
 * being refused by a constraint after writing a decision is a worse experience
 * than being told at the start — and because the reviewer needs to know to
 * pass it on rather than assume the system is broken.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api, can, getUser, type ApiError } from '../lib/api';
import { Alert, ErrorAlert, Loading, Money, Stat, Table, formatDate } from '../ui';
import { usePortalI18n } from '../lib/i18n';
import { enumLabel } from '@psirs/shared';

interface Disagreement {
  observationId: string;
  taxpayerId: string;
  taxpayerName: string;
  groupName: string | null;
  attestedByName: string | null;
  observedAt: string;
  agentSaw: { premises: string; equipmentCount: number; peopleWorking: number };
  leaderSays: {
    premises: string | null;
    equipmentCount: number | null;
    peopleWorking: number | null;
  };
  agentBand: string;
  leaderBand: string | null;
}

interface Recorded {
  observationId: string;
  taxpayerId: string;
  taxpayerName: string;
  economicSector: string;
  premises: string;
  equipmentCount: number;
  peopleWorking: number;
  sizeBand: string;
  attestationState: string;
  groupName: string | null;
  observedAt: string;
  presumptiveAssessmentId: string | null;
  taxTier: string | null;
  annualTaxKobo: string | null;
  underObjection: boolean;
}

interface Objection {
  objectionId: string;
  presumptiveAssessmentId: string;
  taxpayerId: string;
  taxpayerName: string;
  ground: string;
  statement: string;
  raisedAt: string;
  annualTaxKobo: string;
  assessedBy: string;
}

export function EnumerationScreen() {
  const { t } = usePortalI18n();
  const canDecide = can('approval:review');
  const me = getUser()?.id ?? null;

  const canAssess = can('paye:file');
  const canAttest = can('group:manage');
  const canObject = can('assessment:create') || can('paye:file');

  const [recorded, setRecorded] = useState<Recorded[] | null>(null);
  const [disagreements, setDisagreements] = useState<Disagreement[] | null>(null);
  const [objections, setObjections] = useState<Objection[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [decisionError, setDecisionError] = useState<ApiError | null>(null);
  const [reason, setReason] = useState('');
  const [attestedBy, setAttestedBy] = useState('');
  const [objectionGround, setObjectionGround] = useState('FACTS_WRONG');
  const [objectionStatement, setObjectionStatement] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api
      .get<Disagreement[]>('/government/enumeration/disagreements')
      .then(setDisagreements)
      .catch((caught: unknown) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
        setDisagreements([]);
      });
    api
      .get<Objection[]>('/government/enumeration/objections')
      .then(setObjections)
      .catch(() => setObjections([]));
    api
      .get<Recorded[]>('/government/enumeration/observations')
      .then(setRecorded)
      .catch(() => setRecorded([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (objectionId: string, uphold: boolean) => {
    /*
     * Unreachable while the buttons are disabled — mutating this line away
     * leaves every screen test passing. It is kept for a future caller that
     * does not come through those buttons, and the control that actually holds
     * is the service's, which refuses a decision with no reason and is tested
     * where it lives.
     */
    if (!reason.trim()) return;
    setBusy(true);
    setDecisionError(null);
    try {
      await api.post(`/government/enumeration/objections/${objectionId}/decide`, {
        uphold,
        reason: reason.trim(),
      });
      setReason('');
      load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setDecisionError(caught.error);
    } finally {
      setBusy(false);
    }
  };

  const act = async (path: string, body: unknown) => {
    setBusy(true);
    setDecisionError(null);
    try {
      await api.post(path, body);
      load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setDecisionError(caught.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="card">
        <h2 className="card__title">{t.ofcEnTitle}</h2>
        <p style={{ color: 'var(--muted)', marginTop: 0, fontSize: '0.85rem' }}>{t.ofcEnIntro}</p>
        <ErrorAlert error={error} />
      </div>

      <div className="card">
        <h2 className="card__title">{t.ofcEnRecorded}</h2>
        <p style={{ color: 'var(--muted)', marginTop: 0, fontSize: '0.85rem' }}>
          {t.ofcEnRecordedIntro}
        </p>
        {recorded === null ? (
          <Loading rows={2} />
        ) : (
          <Table
            columns={[
              { key: 'taxpayerName', label: 'colTaxpayerLabel' },
              {
                key: 'premises',
                label: 'ofcEnAgentSaw',
                render: (row: Recorded) =>
                  `${enumLabel(row.premises, t)}, ${row.equipmentCount}, ${row.peopleWorking}`,
              },
              {
                key: 'sizeBand',
                label: 'ofcPsBand',
                render: (row: Recorded) => enumLabel(row.sizeBand, t),
              },
              {
                key: 'attestationState',
                label: 'ofcEnAttestation',
                render: (row: Recorded) => enumLabel(row.attestationState, t),
              },
              {
                key: 'annualTaxKobo',
                label: 'ofcPsAnnualTax',
                numeric: true,
                render: (row: Recorded) =>
                  row.presumptiveAssessmentId === null ? (
                    <span>{t.ofcEnNotYetAssessed}</span>
                  ) : row.taxTier === 'NANO' ? (
                    <span>{t.ofcEnExempt}</span>
                  ) : (
                    <Money kobo={row.annualTaxKobo ?? '0'} />
                  ),
              },
              {
                key: 'observationId',
                label: 'ofcEnAction',
                render: (row: Recorded) => {
                  /*
                   * One column, because what an officer can do next depends
                   * entirely on where the observation has got to — and showing
                   * three greyed-out buttons would say less than one accurate
                   * sentence.
                   */
                  if (row.presumptiveAssessmentId === null) {
                    if (row.attestationState === 'DISAGREED') {
                      return <span>{t.ofcEnSettleFirst}</span>;
                    }
                    return (
                      <>
                        {canAttest && row.attestationState === 'PENDING' ? (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                act(
                                  `/government/enumeration/observations/${row.observationId}/attest`,
                                  { agrees: true, attestedByName: attestedBy || '—' },
                                )
                              }
                            >
                              {t.ofcEnLeaderAgrees}
                            </button>{' '}
                          </>
                        ) : null}
                        {canAssess ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              act(
                                `/government/enumeration/observations/${row.observationId}/assess`,
                                {},
                              )
                            }
                          >
                            {t.ofcEnAssess}
                          </button>
                        ) : null}
                      </>
                    );
                  }
                  if (row.underObjection) return <span>{t.ofcEnAlreadyObjected}</span>;
                  if (row.taxTier === 'NANO') return null;
                  return canObject ? (
                    <button
                      type="button"
                      disabled={busy || !objectionStatement.trim()}
                      title={objectionStatement.trim() ? undefined : t.ofcEnStatementFirst}
                      onClick={() =>
                        act(
                          `/government/enumeration/assessments/${row.presumptiveAssessmentId}/object`,
                          { ground: objectionGround, statement: objectionStatement.trim() },
                        )
                      }
                    >
                      {t.ofcEnRecordObjection}
                    </button>
                  ) : null;
                },
              },
            ]}
            rows={recorded}
            empty="ofcEnNothingRecorded"
          />
        )}

        {canAttest ? (
          <div className="field" style={{ maxWidth: 420 }}>
            <label htmlFor="en-attested-by">{t.ofcEnAttestedByName}</label>
            <input
              id="en-attested-by"
              value={attestedBy}
              onChange={(event) => setAttestedBy(event.target.value)}
            />
          </div>
        ) : null}

        {canObject ? (
          <div className="filters">
            <div className="field">
              <label htmlFor="en-ground">{t.ofcEnGround}</label>
              <select
                id="en-ground"
                value={objectionGround}
                onChange={(event) => setObjectionGround(event.target.value)}
              >
                {['FACTS_WRONG', 'HAS_RECORDS', 'NOT_TRADING', 'OTHER'].map((value) => (
                  <option key={value} value={value}>
                    {enumLabel(value, t)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ minWidth: 320 }}>
              <label htmlFor="en-statement">{t.ofcEnWhatTheySay}</label>
              <input
                id="en-statement"
                value={objectionStatement}
                onChange={(event) => setObjectionStatement(event.target.value)}
              />
            </div>
          </div>
        ) : null}

        <ErrorAlert error={decisionError} />
      </div>

      <div className="card">
        <h2 className="card__title">{t.ofcEnDisagreements}</h2>
        <p style={{ color: 'var(--muted)', marginTop: 0, fontSize: '0.85rem' }}>
          {t.ofcEnDisagreementsIntro}
        </p>
        {disagreements === null ? (
          <Loading rows={2} />
        ) : (
          <Table
            columns={[
              { key: 'taxpayerName', label: 'colTaxpayerLabel' },
              { key: 'groupName', label: 'ofcEnGroup' },
              {
                key: 'agentSaw',
                label: 'ofcEnAgentSaw',
                render: (row: Disagreement) =>
                  `${enumLabel(row.agentSaw.premises, t)}, ${row.agentSaw.equipmentCount}, ${row.agentSaw.peopleWorking}`,
              },
              {
                key: 'leaderSays',
                label: 'ofcEnLeaderSays',
                /*
                 * Only what the leader actually disputed. Filling the silent
                 * fields with the agent's figures would read as agreement they
                 * never gave; showing them empty is the truth.
                 */
                render: (row: Disagreement) =>
                  [
                    row.leaderSays.premises ? enumLabel(row.leaderSays.premises, t) : null,
                    row.leaderSays.equipmentCount === null
                      ? null
                      : String(row.leaderSays.equipmentCount),
                    row.leaderSays.peopleWorking === null
                      ? null
                      : String(row.leaderSays.peopleWorking),
                  ]
                    .filter(Boolean)
                    .join(', ') || '—',
              },
              {
                key: 'agentBand',
                label: 'ofcEnBandGap',
                /*
                 * The size of the gap, which is what decides whether this
                 * needs a visit or a phone call. Two versions that land in the
                 * same band disagree about nothing that matters to the bill.
                 */
                render: (row: Disagreement) =>
                  row.agentBand === row.leaderBand ? (
                    <span>{t.ofcEnSameBand}</span>
                  ) : (
                    <strong>
                      {enumLabel(row.agentBand, t)} → {row.leaderBand ? enumLabel(row.leaderBand, t) : '—'}
                    </strong>
                  ),
              },
              {
                key: 'observedAt',
                label: 'ofcEnObservedOn',
                render: (row: Disagreement) => formatDate(row.observedAt),
              },
              { key: 'attestedByName', label: 'ofcEnAttestedBy' },
            ]}
            rows={disagreements}
            empty="ofcEnNoDisagreements"
          />
        )}
      </div>

      <div className="card">
        <h2 className="card__title">{t.ofcEnObjections}</h2>
        {objections === null ? (
          <Loading rows={2} />
        ) : (
          <>
            <div className="stat-grid">
              <Stat label="ofcEnOpenObjections" value={String(objections.length)} />
              <Stat
                label="ofcEnUnderObjection"
                value={
                  <Money
                    kobo={objections
                      .reduce((total, row) => total + BigInt(row.annualTaxKobo), 0n)
                      .toString()}
                  />
                }
              />
            </div>

            <Alert kind="info" title="ofcEnWhileOpenTitle">
              {t.ofcEnWhileOpen}
            </Alert>

            {canDecide ? (
              <div className="field" style={{ maxWidth: 560 }}>
                <label htmlFor="en-reason">{t.ofcEnDecisionReason}</label>
                <textarea
                  id="en-reason"
                  rows={2}
                  value={reason}
                  placeholder={t.ofcEnDecisionReasonHint}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
            ) : null}

            <ErrorAlert error={decisionError} />

            <Table
              columns={[
                { key: 'taxpayerName', label: 'colTaxpayerLabel' },
                {
                  key: 'ground',
                  label: 'ofcEnGround',
                  render: (row: Objection) => enumLabel(row.ground, t),
                },
                { key: 'statement', label: 'ofcEnWhatTheySay' },
                {
                  key: 'annualTaxKobo',
                  label: 'ofcPsAnnualTax',
                  numeric: true,
                  render: (row: Objection) => <Money kobo={row.annualTaxKobo} />,
                },
                {
                  key: 'raisedAt',
                  label: 'ofcEnRaisedOn',
                  render: (row: Objection) => formatDate(row.raisedAt),
                },
                {
                  key: 'objectionId',
                  label: 'ofcEnDecision',
                  render: (row: Objection) => {
                    if (!canDecide) return null;
                    /*
                     * Said before they try. The database refuses this, and
                     * being stopped by a constraint after writing out a
                     * decision is a worse experience than being told at the
                     * start — and leaves the reviewer wondering whether the
                     * system is broken rather than knowing to pass it on.
                     */
                    if (row.assessedBy === me) {
                      return <span>{t.ofcEnYoursToPassOn}</span>;
                    }
                    return (
                      <>
                        <button
                          type="button"
                          disabled={busy || !reason.trim()}
                          title={reason.trim() ? undefined : t.ofcEnReasonFirst}
                          onClick={() => decide(row.objectionId, true)}
                        >
                          {t.ofcEnUphold}
                        </button>{' '}
                        <button
                          type="button"
                          disabled={busy || !reason.trim()}
                          title={reason.trim() ? undefined : t.ofcEnReasonFirst}
                          onClick={() => decide(row.objectionId, false)}
                        >
                          {t.ofcEnReject}
                        </button>
                      </>
                    );
                  },
                },
              ]}
              rows={objections}
              empty="ofcEnNoObjections"
            />
          </>
        )}
      </div>
    </>
  );
}
