/**
 * Distribution rounds: the arm of a social incentive programme that hands
 * something out.
 *
 * A programme decides who is eligible. A round is one actual distribution —
 * this many bags of fertiliser, this much each, at this collection point,
 * opening then and closing then — and the awards under it are the people who
 * got some.
 *
 * The API has had `createRound`, `setRoundStatus`, `listRounds`, `roundSummary`
 * and `listAwards` since allocations were built, and no officer could reach any
 * of them. A distribution could be created only by a request nobody could make
 * from a screen, so in practice none could be created at all.
 *
 * WHO SEES THIS. `allocation:manage` is held by administrators and revenue
 * officers, and by nobody else. A finance officer settles money and does not
 * hand out fertiliser; the menu offers this to the two roles that do it.
 *
 * WHY OPENING A ROUND IS A DELIBERATE ACT. A round in DRAFT awards nothing. It
 * opens when somebody decides the goods are actually at the collection point,
 * which is a fact about the world that no query can establish — so it is a
 * button, and closing it again is another. Awards accrue only while it is
 * open, which is what stops a programme distributing on paper what is not
 * there.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api, type ApiError } from '../lib/api';
import { withJustification } from '../lib/justify';
import { Alert, Badge, ErrorAlert, Loading, Table, formatDateTime } from '../ui';
import { usePortalI18n } from '../lib/i18n';

interface Round {
  id: string;
  name: string;
  unit: string;
  total_quantity: string;
  quantity_per_beneficiary: string;
  collection_point: string | null;
  status: string;
  opens_at: string;
  closes_at: string | null;
  programme_name?: string;
  awarded_count?: string;
}

interface Award {
  id: string;
  status: string;
  quantity: string;
  taxpayer_name?: string;
  collected_at: string | null;
}

/** The units a round can be measured in, as the API accepts them. */
const UNITS = [
  ['BAG_50KG', '50kg bag'],
  ['BAG_25KG', '25kg bag'],
  ['LITRE', 'Litre'],
  ['KILOGRAM', 'Kilogram'],
  ['TRACTOR_DAY', 'Tractor day'],
  ['SEEDLING', 'Seedling'],
  ['UNIT', 'Unit'],
] as const;

const UNIT_LABEL = Object.fromEntries(UNITS) as Record<string, string>;

export function AllocationsScreen() {
  const { t } = usePortalI18n();
  const [rounds, setRounds] = useState<Round[] | null>(null);
  const [programmes, setProgrammes] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [awardsFor, setAwardsFor] = useState<Round | null>(null);
  const [awards, setAwards] = useState<Award[] | null>(null);

  const [form, setForm] = useState({
    programmeId: '',
    name: '',
    unit: 'BAG_50KG',
    totalQuantity: '',
    quantityPerBeneficiary: '',
    collectionPoint: '',
    opensAt: '',
    closesAt: '',
  });

  const load = useCallback(() => {
    api
      .get<{ rounds: Round[] }>('/allocations/rounds?limit=100')
      .then((data) => setRounds(data.rounds))
      .catch((caught) => {
        setRounds([]);
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
    api
      .get<any[]>('/government/programmes')
      .then((data) => setProgrammes(data.map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => setProgrammes([]));
  }, []);

  useEffect(load, [load]);

  async function act(key: string, run: () => Promise<unknown>, said: string) {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      await run();
      setMessage(said);
      load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(null);
    }
  }

  async function openAwards(round: Round) {
    setAwardsFor(round);
    setAwards(null);
    try {
      const data = await api.get<{ awards: Award[] }>(`/allocations/rounds/${round.id}/awards`);
      setAwards(data.awards);
    } catch (caught) {
      setAwards([]);
      if (caught instanceof ApiRequestError) setError(caught.error);
    }
  }

  /**
   * Release a share nobody came for, back into the round.
   *
   * A reason is required and recorded: this is public property being taken off
   * one person's name and put back on the shelf for somebody else, and the
   * round's arithmetic changes as a result. Refusals — an award already
   * collected, most of all — reach the officer rather than dying silently,
   * which is what `withJustification` exists for.
   */
  async function release(round: Round, awardRow: Award) {
    await withJustification({
      question: `Why is ${awardRow.taxpayer_name ?? 'this beneficiary'}'s ${awardRow.quantity} forfeited?`,
      minimum: 10,
      tooShort: 'Give at least ten characters saying why this share is being released.',
      run: async (reason) => {
        await api.post(`/allocations/awards/${awardRow.id}/forfeit`, { reason });
      },
      onSuccess: `Released. The ${awardRow.quantity} is back in ${round.name} for another beneficiary.`,
      setError,
      setMessage,
    });
    await openAwards(round);
    load();
  }

  /** What is stopping this being created, in the words the officer needs. */
  const blockedBecause = ((): string | null => {
    if (!form.programmeId) return 'Choose the programme this round distributes under.';
    if (form.name.trim().length < 3) return 'Give the round a name people will recognise.';
    const total = Number(form.totalQuantity);
    const each = Number(form.quantityPerBeneficiary);
    if (!Number.isFinite(total) || total <= 0) return 'How much is there to distribute in total?';
    if (!Number.isFinite(each) || each <= 0) return 'How much does each beneficiary receive?';
    if (each > total) return 'One beneficiary cannot receive more than the whole round holds.';
    if (!form.opensAt) return 'When does collection open?';
    if (form.closesAt && form.closesAt <= form.opensAt) {
      return 'A round cannot close before it opens.';
    }
    return null;
  })();

  const beneficiaries =
    Number(form.totalQuantity) > 0 && Number(form.quantityPerBeneficiary) > 0
      ? Math.floor(Number(form.totalQuantity) / Number(form.quantityPerBeneficiary))
      : null;

  if (!rounds) return <Loading rows={5} />;

  return (
    <>
      <div className="card">
        <h2 className="card__title">{t.ofcNavAllocations}</h2>
        <p className="card__hint">{t.ofcAlIntro}</p>
        <button type="button" onClick={() => setCreating((c) => !c)}>
          {creating ? 'Cancel' : 'Create a round'}
        </button>
      </div>

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      {creating && (
        <div className="card">
          <h2 className="card__title">{t.ofcAlNewRound}</h2>

          <div className="field">
            <label htmlFor="programme">{t.ofcAlProgramme}</label>
            <select
              id="programme"
              value={form.programmeId}
              onChange={(e) => setForm({ ...form, programmeId: e.target.value })}
            >
              <option value="">{t.ofcAlSelectProgramme}</option>
              {programmes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {programmes.length === 0 && (
              <p className="field__hint">{t.ofcAlNoProgramme}</p>
            )}
          </div>

          <div className="field">
            <label htmlFor="round-name">{t.ofcAlRoundName}</label>
            <input
              id="round-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t.ofcAlSampleRound}
            />
          </div>

          <div className="field">
            <label htmlFor="unit">{t.ofcAlMeasuredIn}</label>
            <select
              id="unit"
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
            >
              {UNITS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="total">{t.ofcAlTotalToDistribute}</label>
            <input
              id="total"
              inputMode="numeric"
              value={form.totalQuantity}
              onChange={(e) => setForm({ ...form, totalQuantity: e.target.value })}
              placeholder="500"
            />
          </div>

          <div className="field">
            <label htmlFor="each">{t.ofcAlEachReceives}</label>
            <input
              id="each"
              inputMode="numeric"
              value={form.quantityPerBeneficiary}
              onChange={(e) => setForm({ ...form, quantityPerBeneficiary: e.target.value })}
              placeholder="2"
            />
            {beneficiaries !== null && (
              <p className="field__hint">{t.ofcAlEnoughFor}<strong>{beneficiaries}</strong>{t.ofcAlBeneficiariesWord}</p>
            )}
          </div>

          <div className="field">
            <label htmlFor="point">{t.ofcAlCollectionPoint}</label>
            <input
              id="point"
              value={form.collectionPoint}
              onChange={(e) => setForm({ ...form, collectionPoint: e.target.value })}
              placeholder={t.ofcAlSamplePoint}
            />
          </div>

          <div className="field">
            <label htmlFor="opens">{t.ofcAlOpens}</label>
            <input
              id="opens"
              type="datetime-local"
              value={form.opensAt}
              onChange={(e) => setForm({ ...form, opensAt: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="closes">{t.ofcAlClosesOptional}</label>
            <input
              id="closes"
              type="datetime-local"
              value={form.closesAt}
              onChange={(e) => setForm({ ...form, closesAt: e.target.value })}
            />
          </div>

          {blockedBecause && (
            <p className="card__hint" role="status" style={{ marginBottom: 0 }}>
              {blockedBecause}
            </p>
          )}

          <div className="button-row">
            <button
              type="button"
              disabled={busy !== null || blockedBecause !== null}
              onClick={() =>
                act(
                  'create',
                  async () => {
                    await api.post('/allocations/rounds', {
                      programmeId: form.programmeId,
                      name: form.name.trim(),
                      unit: form.unit,
                      totalQuantity: Number(form.totalQuantity),
                      quantityPerBeneficiary: Number(form.quantityPerBeneficiary),
                      collectionPoint: form.collectionPoint.trim() || undefined,
                      opensAt: new Date(form.opensAt).toISOString(),
                      closesAt: form.closesAt ? new Date(form.closesAt).toISOString() : undefined,
                    });
                    setCreating(false);
                    setForm({ ...form, name: '', totalQuantity: '', quantityPerBeneficiary: '' });
                  },
                  'Round created. It awards nothing until you open it.',
                )
              }
            >
              {busy === 'create' ? 'Creating…' : 'Create round'}
            </button>
          </div>
        </div>
      )}

      {awardsFor && (
        <div className="card card--flush">
          <h2 className="card__title" style={{ padding: '14px 18px 0' }}>
            Awards — {awardsFor.name}
          </h2>
          <p className="card__hint" style={{ padding: '0 18px' }}>
            Who has been awarded under this round, and who has collected.{' '}
            <button type="button" className="link" onClick={() => setAwardsFor(null)}>{t.ofcKycClose}</button>
          </p>
          {!awards ? (
            <div style={{ padding: 18 }}>
              <Loading rows={3} />
            </div>
          ) : (
            <Table
              columns={[
                { key: 'taxpayer_name', label: 'ofcAlBeneficiary' },
                { key: 'quantity', label: 'ofcAlQuantity' },
                {
                  key: 'status',
                  label: 'appStatus',
                  render: (row: Award) => <Badge status={row.status} />,
                },
                {
                  key: 'collected_at',
                  label: 'ofcPfCollected',
                  render: (row: Award) =>
                    row.collected_at ? formatDateTime(row.collected_at) : 'Not yet',
                },
                {
                  key: 'release',
                  label: { text: '' },
                  render: (row: Award) =>
                    row.status === 'AWARDED' ? (
                      <button
                        type="button"
                        className="link"
                        onClick={() => release(awardsFor, row)}
                      >{t.ofcAlRelease}</button>
                    ) : null,
                },
              ]}
              rows={awards}
              empty="ofcNoneNobodyAwardedRound2"
            />
          )}
        </div>
      )}

      <div className="card card--flush">
        <Table
          columns={[
            { key: 'name', label: 'ofcAlRound' },
            { key: 'programme_name', label: 'ofcAlProgramme' },
            {
              key: 'quantity',
              label: 'ofcAlDistributing',
              render: (row: Round) =>
                `${row.total_quantity} × ${UNIT_LABEL[row.unit] ?? row.unit}, ${row.quantity_per_beneficiary} each`,
            },
            { key: 'collection_point', label: 'ofcAlCollectionPoint' },
            {
              key: 'opens_at',
              label: 'ofcAlOpens',
              render: (row: Round) => formatDateTime(row.opens_at),
            },
            { key: 'status', label: 'appStatus', render: (row: Round) => <Badge status={row.status} /> },
            {
              key: 'act',
              label: { text: '' },
              render: (row: Round) => (
                <>
                  {row.status === 'DRAFT' && (
                    <button
                      type="button"
                      className="small"
                      disabled={busy !== null}
                      onClick={() =>
                        act(
                          row.id,
                          () => api.post(`/allocations/rounds/${row.id}/status`, { status: 'OPEN' }),
                          `${row.name} is open. Awards can now be made.`,
                        )
                      }
                    >{t.ofcRhOpen}</button>
                  )}
                  {row.status === 'OPEN' && (
                    <button
                      type="button"
                      className="small secondary"
                      disabled={busy !== null}
                      onClick={() =>
                        act(
                          row.id,
                          () =>
                            api.post(`/allocations/rounds/${row.id}/status`, { status: 'CLOSED' }),
                          `${row.name} is closed. No further awards.`,
                        )
                      }
                    >{t.ofcKycClose}</button>
                  )}{' '}
                  <button type="button" className="small secondary" onClick={() => openAwards(row)}>{t.ofcAlAwards}</button>
                </>
              ),
            },
          ]}
          rows={rounds}
          empty="ofcNoneDistributionRoundCreated"
        />
      </div>
    </>
  );
}
