/**
 * What is connected to a taxpayer, and who the State has not yet assessed.
 *
 * Phase 2 of the informal-sector programme. Phase 1 collected from people
 * already assessed; this finds people who should have been and were not, from
 * the vehicle register PSIRS already keeps.
 *
 * THE SCREEN IS PART OF THE CONTROL, NOT A WINDOW ONTO IT.
 *
 * The API will not answer a request for a person's record without a stated
 * purpose, so this screen makes the officer choose one before it asks. That is
 * a deliberate piece of friction: a dropdown that defaulted to something would
 * mean every read carried whichever value was cheapest to leave alone, and the
 * log would record that rather than a reason.
 *
 * Confidence is shown as words, not as a number in a corner. "The register
 * names them" and "matched on a shared phone number" are different grounds for
 * knocking on somebody's door, and an officer reading `85` has to already know
 * what the scale means to act correctly on it.
 *
 * The dispute button is on the officer's screen because the citizen has no
 * account to log into. A taxpayer who says "that is my brother's bus" needs
 * that recorded against the claim on the spot; leaving it to a note in a file
 * is how the graph goes on asserting something the State has been told is
 * wrong.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api, asApiError, can, type ApiError } from '../lib/api';
import { Alert, Badge, ErrorAlert, Loading, Money, ReferenceListFailure, Stat, Table, formatDate, formatDateTime } from '../ui';
import { useReferenceList } from '../lib/reference';
import { usePortalI18n } from '../lib/i18n';
import { enumLabel } from '@psirs/shared';

interface Lga {
  id: string;
  name: string;
}

interface Lead {
  taxpayerId: string;
  name: string;
  tin: string | null;
  phone: string;
  lgaId: string;
  lgaName: string;
  commercialVehicles: number;
  registrations: string[];
  lowestConfidence: number;
  chargedCommercialRate: boolean;
  paidLastYearKobo: string;
}

interface Leads {
  summary: { leads: number; vehicles: number; unmatchedVehicles: number };
  rows: Lead[];
}

interface Connection {
  id: string;
  kind: string;
  subjectType: string;
  subjectLabel: string;
  source: string;
  confidence: number;
  matchBasis: string;
  lawfulBasis: string;
  state: string;
  stateReason: string | null;
  obtainedAt: string;
  obtainedByJob: string | null;
}

interface Liability {
  kind: string;
  reference: string;
  description: string;
  amountKobo: string;
  since: string | null;
  payable: boolean;
}

interface Record_ {
  taxpayerId: string;
  name: string;
  tin: string | null;
  connections: Connection[];
  liabilities: Liability[];
  totalOwedKobo: string;
}

const PURPOSES = ['COVERAGE_LEAD', 'CONSISTENCY_CHECK', 'TAXPAYER_REQUEST'] as const;

export function ConnectionsScreen() {
  const { lang, t } = usePortalI18n();
  const canRebuild = can('system:configure');
  const canDecide = can('taxpayer:correct');
  /*
   * `audit:read`, as the endpoint is. The route's comment says why it is not
   * the report permissions: "the officers who look at the graph should not be
   * the ones who decide what the log of their looking says."
   */
  const canAudit = can('audit:read');

  const lgaList = useReferenceList<Lga>('/reference/lgas');
  const lgas = lgaList.items;
  const [filters, setFilters] = useState({ lgaId: '', minimumVehicles: '' });
  const [leads, setLeads] = useState<Leads | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [purpose, setPurpose] = useState<string>('');
  const [record, setRecord] = useState<Record_ | null>(null);
  const [recordError, setRecordError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  /*
   * The reason is a field on the page, not a browser prompt. A prompt loses
   * what was typed the moment it is dismissed, cannot be read back before
   * committing, and puts the most consequential thing on this screen — the
   * written justification for changing a record about a person — in the one
   * control the officer cannot review.
   */
  const [reason, setReason] = useState('');
  const [rebuilt, setRebuilt] = useState<string | null>(null);

  useEffect(() => {
  }, []);

  const loadLeads = useCallback(() => {
    setError(null);
    setLeads(null);
    const params = new URLSearchParams();
    if (filters.lgaId) params.set('lgaId', filters.lgaId);
    if (filters.minimumVehicles) params.set('minimumVehicles', filters.minimumVehicles);

    api
      .get<Leads>(`/government/intelligence/leads?${params.toString()}`)
      .then(setLeads)
      .catch((caught: unknown) => {
        setError(asApiError(caught));
        setLeads({ summary: { leads: 0, vehicles: 0, unmatchedVehicles: 0 }, rows: [] });
      });
  }, [filters]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  /*
   * Opening a record is a separate, deliberate act with its own purpose. It is
   * not fetched alongside the list: the list answers "where should we look",
   * and reading one person's file is the thing that gets logged against them.
   */
  const openRecord = (taxpayerId: string) => {
    /*
     * The second of two guards, and the weaker one. The button is disabled
     * without a purpose, so nothing in the interface reaches this line —
     * mutating it away leaves every screen test passing. It is kept because a
     * future caller may not come through that button, and the control that
     * actually holds is neither of these: the API refuses a read with no
     * purpose, which the API suite tests by calling the endpoint without one.
     */
    if (!purpose) return;
    setRecordError(null);
    setRecord(null);
    setOpenId(taxpayerId);
    api
      .get<Record_>(
        `/government/intelligence/taxpayers/${taxpayerId}?purpose=${encodeURIComponent(purpose)}`,
      )
      .then(setRecord)
      .catch((caught: unknown) => {
        setRecordError(asApiError(caught));
      });
  };

  const decide = async (connectionId: string, state: string) => {
    // As above: unreachable while the buttons are disabled, and backed by the
    // service, which refuses a decision with a blank reason.
    if (!reason.trim()) return;
    setBusy(true);
    setRecordError(null);
    try {
      await api.post(`/government/intelligence/connections/${connectionId}/decision`, {
        state,
        reason,
      });
      setReason('');
      if (openId) openRecord(openId);
    } catch (caught) {
      setRecordError(asApiError(caught));
    } finally {
      setBusy(false);
    }
  };

  const rebuild = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{
        asserted: number;
        fromRegistry: number;
        fromPhone: number;
        ambiguous: number;
      }>('/government/intelligence/rebuild', {});
      setRebuilt(
        t.ofcIgRebuilt
          .replace('{{asserted}}', String(result.asserted))
          .replace('{{registry}}', String(result.fromRegistry))
          .replace('{{phone}}', String(result.fromPhone))
          .replace('{{ambiguous}}', String(result.ambiguous)),
      );
      loadLeads();
    } catch (caught) {
      setError(asApiError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="card">
        <h2 className="card__title">{t.ofcIgTitle}</h2>
        <p className="card__hint">{t.ofcIgIntro}</p>

        <Alert kind="warning" title="ofcIgLimitsTitle">
          {t.ofcIgLimits}
        </Alert>

        <div className="filters">
          <div className="field">
            <label htmlFor="ig-lga">{t.pubVerifyLga}</label>
            <select
              id="ig-lga"
              value={filters.lgaId}
              onChange={(event) => setFilters({ ...filters, lgaId: event.target.value })}
            >
              <option value="">{t.ofcAllLgas}</option>
              {lgas.map((lga) => (
                <option key={lga.id} value={lga.id}>
                  {lga.name}
                </option>
              ))}
            </select>
            <ReferenceListFailure list={lgaList} />
          </div>

          <div className="field">
            <label htmlFor="ig-minimum">{t.ofcIgAtLeastVehicles}</label>
            <input
              id="ig-minimum"
              type="number"
              min="1"
              inputMode="numeric"
              value={filters.minimumVehicles}
              onChange={(event) => setFilters({ ...filters, minimumVehicles: event.target.value })}
            />
          </div>

          {canRebuild ? (
            <div className="field">
              <label htmlFor="ig-rebuild">{t.ofcIgRebuildLabel}</label>
              <button id="ig-rebuild" type="button" onClick={rebuild} disabled={busy}>
                {t.ofcIgRebuildAction}
              </button>
            </div>
          ) : null}
        </div>

        {rebuilt ? <Alert kind="success">{rebuilt}</Alert> : null}
        <ErrorAlert error={error} />
      </div>

      {leads === null ? (
        <Loading />
      ) : (
        <div className="card">
          <div className="stat-grid">
            <Stat label="ofcIgLeads" value={String(leads.summary.leads)} />
            <Stat label="ofcIgVehicles" value={String(leads.summary.vehicles)} />
            <Stat label="ofcIgUnmatched" value={String(leads.summary.unmatchedVehicles)} />
          </div>

          {/*
            * The denominator, stated. A lead count on its own reads as the
            * size of the problem; it is the size of the part of the problem
            * this query can see.
            */}
          {leads.summary.unmatchedVehicles > 0 ? (
            <Alert kind="info">
              {t.ofcIgUnmatchedExplained.replace(
                '{{n}}',
                String(leads.summary.unmatchedVehicles),
              )}
            </Alert>
          ) : null}

          <div className="field" style={{ maxWidth: 420 }}>
            <label htmlFor="ig-purpose">{t.ofcIgPurpose}</label>
            <select
              id="ig-purpose"
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
            >
              {/*
                * No default. The API refuses a read with no purpose, and a
                * pre-selected option here would put a reason on the record
                * that the officer never chose.
                */}
              <option value="">{t.ofcIgPurposeChoose}</option>
              {PURPOSES.map((value) => (
                <option key={value} value={value}>
                  {enumLabel(value, t)}
                </option>
              ))}
            </select>
          </div>

          <Table
            columns={[
              { key: 'name', label: 'colTaxpayerLabel' },
              { key: 'tin', label: 'tpStepTin' },
              { key: 'phone', label: 'tpPhone' },
              { key: 'lgaName', label: 'tpLgaShort' },
              { key: 'commercialVehicles', label: 'ofcIgVehicles', numeric: true },
              {
                key: 'registrations',
                label: 'ofcIgRegistrations',
                render: (row: Lead) => row.registrations.join(', '),
              },
              {
                key: 'lowestConfidence',
                label: 'ofcIgGrounds',
                /*
                 * Words, not the number. "Matched on a shared phone number" and
                 * "the register names them" are different grounds for going to
                 * somebody's premises, and 85 versus 100 says that only to
                 * someone who already knows the scale.
                 */
                render: (row: Lead) =>
                  row.lowestConfidence >= 100 ? t.ofcIgFromRegister : t.ofcIgFromPhone,
              },
              {
                key: 'chargedCommercialRate',
                label: 'ofcIgChargedCommercial',
                render: (row: Lead) => (row.chargedCommercialRate ? <Badge status="VERIFIED" /> : null),
              },
              {
                key: 'paidLastYearKobo',
                label: 'ofcIgPaidLastYear',
                numeric: true,
                render: (row: Lead) => <Money kobo={row.paidLastYearKobo} />,
              },
              {
                key: 'taxpayerId',
                label: 'ofcIgOpen',
                render: (row: Lead) => (
                  <button
                    type="button"
                    onClick={() => openRecord(row.taxpayerId)}
                    disabled={!purpose}
                    title={purpose ? undefined : t.ofcIgPurposeFirst}
                  >
                    {t.ofcIgOpen}
                  </button>
                ),
              },
            ]}
            rows={leads.rows}
            empty="ofcIgNoLeads"
          />
        </div>
      )}

      {openId ? (
        <div className="card">
          <h2 className="card__title">{t.ofcIgRecordTitle}</h2>
          <ErrorAlert error={recordError} />
          {record === null && recordError === null ? (
            <Loading />
          ) : record ? (
            <>
              <div className="stat-grid">
                <Stat label="colTaxpayerLabel" value={record.name} />
                <Stat label="ofcAgOutstanding" value={<Money kobo={record.totalOwedKobo} />} />
              </div>

              <h3 style={{ marginTop: 24, fontSize: 'var(--text-md)' }}>{t.ofcIgWhatWeClaim}</h3>

              {canDecide ? (
                <div className="field" style={{ maxWidth: 560 }}>
                  <label htmlFor="ig-reason">{t.ofcIgReasonLabel}</label>
                  <textarea
                    id="ig-reason"
                    rows={2}
                    value={reason}
                    placeholder={t.ofcIgReasonPrompt}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </div>
              ) : null}
              <Table
                columns={[
                  { key: 'subjectLabel', label: 'ofcIgThing' },
                  {
                    key: 'kind',
                    label: 'ofcIgRelationship',
                    render: (row: Connection) => enumLabel(row.kind, t),
                  },
                  {
                    key: 'source',
                    label: 'ofcIgSource',
                    render: (row: Connection) => enumLabel(row.source, t),
                  },
                  {
                    key: 'confidence',
                    label: 'ofcIgGrounds',
                    render: (row: Connection) =>
                      row.confidence >= 100 ? t.ofcIgFromRegister : t.ofcIgFromPhone,
                  },
                  {
                    key: 'state',
                    label: 'ofcOsState',
                    render: (row: Connection) => <Badge status={row.state} />,
                  },
                  {
                    key: 'obtainedAt',
                    label: 'ofcIgObtained',
                    render: (row: Connection) => formatDate(row.obtainedAt),
                  },
                  {
                    key: 'lawfulBasis',
                    label: 'ofcIgLawfulBasis',
                    render: (row: Connection) => (
                      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)' }}>
                        {row.lawfulBasis}
                      </span>
                    ),
                  },
                  {
                    key: 'id',
                    label: 'ofcIgDecide',
                    render: (row: Connection) =>
                      canDecide && row.state !== 'WITHDRAWN' ? (
                        <>
                          <button
                            type="button"
                            disabled={busy || !reason.trim()}
                            title={reason.trim() ? undefined : t.ofcIgReasonFirst}
                            onClick={() => decide(row.id, 'CONFIRMED_BY_TAXPAYER')}
                          >
                            {t.ofcIgConfirm}
                          </button>{' '}
                          <button
                            type="button"
                            disabled={busy || !reason.trim()}
                            title={reason.trim() ? undefined : t.ofcIgReasonFirst}
                            onClick={() => decide(row.id, 'DISPUTED')}
                          >
                            {t.ofcIgDispute}
                          </button>{' '}
                          <button
                            type="button"
                            disabled={busy || !reason.trim()}
                            title={reason.trim() ? undefined : t.ofcIgReasonFirst}
                            onClick={() => decide(row.id, 'WITHDRAWN')}
                          >
                            {t.ofcIgWithdraw}
                          </button>
                        </>
                      ) : null,
                  },
                ]}
                rows={record.connections}
                empty="ofcIgNothingClaimed"
              />

              <h3 style={{ marginTop: 24, fontSize: 'var(--text-md)' }}>{t.ofcIgWhatTheyOwe}</h3>
              <Table
                columns={[
                  { key: 'reference', label: 'ofcIgReference' },
                  { key: 'description', label: 'ofcLvLevy' },
                  {
                    key: 'amountKobo',
                    label: 'ofcAgOutstanding',
                    numeric: true,
                    render: (row: Liability) => <Money kobo={row.amountKobo} />,
                  },
                  {
                    key: 'since',
                    label: 'ofcIgSince',
                    render: (row: Liability) => formatDate(row.since),
                  },
                  {
                    key: 'payable',
                    label: 'ofcIgPayableNow',
                    render: (row: Liability) =>
                      row.payable ? t.ofcIgPayableYes : t.ofcIgPayableNeedsReassessment,
                  },
                ]}
                rows={record.liabilities}
                empty="ofcIgOwesNothing"
              />

              {canAudit && openId && <WhoHasLooked taxpayerId={openId} />}
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

// ===========================================================================
/**
 * Who has read this person's record, and under what claimed purpose.
 *
 * `GET /government/intelligence/taxpayers/:id/access-log` had no caller
 * anywhere in either front end — one of the reads recorded in
 * READ_WITHOUT_A_SCREEN — and its absence made the control above it hollow.
 *
 * This screen's own header calls itself "part of the control, not a window
 * onto it": the API refuses a read without a stated purpose, so an officer
 * must choose one, and every choice is written to
 * `taxpayer_connection_access_logs`. That is a data-protection safeguard
 * whose entire value is that somebody eventually reads it. Written and never
 * read, it is a table that costs disk and protects nobody — an officer
 * running coverage queries against a neighbour could pick any purpose from
 * the dropdown, knowing the record of it went where nothing looks.
 *
 * The service returns the officer's ROLE and not their name, and its own
 * comment says why: "naming the individual invites reprisal in a small LGA
 * and adds nothing to the accountability the log provides, which runs to the
 * auditor with the officer's identity intact." So this panel is safe to show
 * beside the record, and the auditor's fuller view is the audit log itself.
 */
interface AccessEntry {
  purpose: string;
  at: string;
  officerRole: string | null;
}

function WhoHasLooked({ taxpayerId }: { taxpayerId: string }) {
  const { t } = usePortalI18n();
  const [rows, setRows] = useState<AccessEntry[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .get<AccessEntry[]>(`/government/intelligence/taxpayers/${taxpayerId}/access-log`)
      /*
       * `Array.isArray`, not a truth test.
       *
       * A body this screen does not recognise must not white-screen it. That
       * is not hypothetical: the first version of this panel took whatever
       * came back and called `.map` on it, and the existing test for this
       * screen — which answers every `/intelligence/taxpayers/` path with the
       * record body — went red with "rows.map is not a function", taking the
       * connections, the liabilities and the dispute controls down with it.
       * An unreadable log is a missing section, never a missing screen.
       */
      .then((body) => setRows(Array.isArray(body) ? body : []))
      .catch((caught) => {
        setError(asApiError(caught));
        /*
         * "Nobody has opened this record" is the finding an investigation
         * would stop at. A refused read must not be able to produce it.
         */
        setRows(null);
      });
  }, [taxpayerId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <h3 style={{ marginTop: 24, fontSize: 'var(--text-md)' }}>{t.ofcIgWhoHasLooked}</h3>
      <p className="card__hint">{t.ofcIgWhoHasLookedBody}</p>
      {error ? (
        <div>
          <ErrorAlert error={error} />
          <button type="button" className="secondary" onClick={load}>
            {t.actionTryAgain}
          </button>
        </div>
      ) : !rows ? (
        <Loading rows={2} />
      ) : (
        <Table
          columns={[
            {
              key: 'at',
              label: 'ofcIgWhenRead',
              render: (row: AccessEntry) => formatDateTime(row.at),
            },
            {
              key: 'officerRole',
              label: 'ofcRhRole',
              render: (row: AccessEntry) =>
                row.officerRole ? enumLabel(row.officerRole, t) : t.ofcOvSystem,
            },
            { key: 'purpose', label: 'ofcIgPurpose' },
          ]}
          rows={rows}
          empty="ofcIgNobodyHasLooked"
        />
      )}
    </>
  );
}
