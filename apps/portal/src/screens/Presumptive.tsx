/**
 * The presumptive schedule: the table PSIRS has to defend in a room full of
 * traders.
 *
 * Phase 4's acceptance criterion is not that this renders. It is whether a
 * tailor in Wase can look at it, find her own trade, and see why her bill is
 * lower than the same tailor's in Jos North without having to trust anybody.
 * So the schedule is shown whole rather than paginated — she needs the rows
 * above and below hers to see the figures rise in an order that makes sense —
 * and the classification is shown with the evidence behind it rather than as
 * a bare letter.
 *
 * WHAT THE PAGE SAYS BEFORE IT SAYS ANYTHING ELSE.
 *
 * Whether the schedule is usable at all. A half-published schedule assesses
 * some people and refuses others for reasons neither of them can see, and the
 * officer looking at a table with eleven of seventeen LGAs classified needs to
 * know that before they start quoting figures from it.
 *
 * The nano construction is stated in words, not as a code. Which reading is in
 * force decides whether a shop-based tailor pays anything at all — it is the
 * single most consequential setting on this page, and "CONJUNCTIVE" tells
 * nobody what it means.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api, asApiError, can, type ApiError } from '../lib/api';
import { Alert, ErrorAlert, Loading, Money, Stat, Table, formatDate } from '../ui';
import { usePortalI18n } from '../lib/i18n';
import { enumLabel } from '@psirs/shared';

type SizeBand = 'MICRO' | 'SMALL' | 'MEDIUM';
type LgaClass = 'A' | 'B' | 'C' | 'D';

interface ClassRow {
  lgaId: string;
  lgaName: string;
  classCode: LgaClass;
  indexSource: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

interface Entry {
  id: string;
  economicSector: string;
  sizeBand: SizeBand;
  lgaClass: LgaClass;
  assumedAnnualTurnoverKobo: string;
  instrumentReference: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

interface Schedule {
  readiness: {
    nanoPolicyAdopted: boolean;
    nanoConstruction: 'CONJUNCTIVE' | 'TURNOVER_GOVERNED' | null;
    lgasClassified: number;
    lgasTotal: number;
    scheduleCells: number;
  };
  classes: ClassRow[];
  entries: Entry[];
}

interface Preview {
  tier: 'NANO' | 'PRESUMPTIVE' | 'BOOKS';
  sizeBand: SizeBand;
  lgaClass: LgaClass;
  assumedAnnualTurnoverKobo: string;
  annualTaxKobo: string;
  monthlyTaxKobo: string;
  instrumentReference: string;
  trace: { step: string; detail: string; amountKobo?: string }[];
}

const PREMISES = ['NONE', 'STALL', 'KIOSK', 'LOCK_UP_SHOP', 'BUILDING'] as const;

export function PresumptiveScreen() {
  const { t } = usePortalI18n();
  const canConfigure = can('catalogue:configure');
  /*
   * Adopting a construction decides who is inside the tax net at all,
   * which is a different size of decision from setting a figure in a
   * table — so it sits with the administrator, matching the route.
   */
  const canAdoptNano = can('system:configure');

  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const [lgas, setLgas] = useState<{ id: string; name: string }[]>([]);
  const [check, setCheck] = useState({
    economicSector: 'ARTISAN_CRAFT',
    lgaId: '',
    premises: 'LOCK_UP_SHOP' as (typeof PREMISES)[number],
    equipmentCount: '2',
    peopleWorking: '1',
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<ApiError | null>(null);
  /*
   * The band, held separately from the preview.
   *
   * The preview refuses when nothing has been published yet, which is exactly
   * the state PSIRS is in while drafting the table — and "what band is a
   * tailor with a lock-up shop and two machines" is the question being argued
   * about at that point. So the band is asked for on its own and shown even
   * when the rest of the answer is a refusal.
   */
  const [band, setBand] = useState<SizeBand | null>(null);
  const [busy, setBusy] = useState(false);

  const [publishError, setPublishError] = useState<ApiError | null>(null);
  const [publishNote, setPublishNote] = useState<string | null>(null);
  const [newClass, setNewClass] = useState({
    lgaId: '',
    classCode: 'C' as LgaClass,
    indexSource: '',
    indexInputs: '',
    effectiveFrom: '',
    effectiveTo: '',
  });
  const [newEntry, setNewEntry] = useState({
    economicSector: 'ARTISAN_CRAFT',
    sizeBand: 'SMALL' as SizeBand,
    lgaClass: 'C' as LgaClass,
    assumedAnnualNaira: '',
    instrumentReference: '',
    effectiveFrom: '',
  });
  const [nano, setNano] = useState({
    construction: 'CONJUNCTIVE' as 'CONJUNCTIVE' | 'TURNOVER_GOVERNED',
    ceilingNaira: '12000000',
    legalBasis: '',
    effectiveFrom: '',
  });

  const load = useCallback(() => {
    setError(null);
    setSchedule(null);
    api
      .get<Schedule>('/government/presumptive/schedule')
      .then(setSchedule)
      .catch((caught: unknown) => {
        setError(asApiError(caught));
      });
  }, []);

  useEffect(() => {
    load();
    api
      .get<{ id: string; name: string }[]>('/reference/lgas')
      .then((rows) => {
        setLgas(rows);
        setCheck((current) => ({ ...current, lgaId: current.lgaId || (rows[0]?.id ?? '') }));
      })
      .catch(() => setLgas([]));
  }, [load]);

  const runPreview = async () => {
    if (!check.lgaId) return;
    setBusy(true);
    setPreviewError(null);
    setPreview(null);
    setBand(null);
    try {
      const observations = {
        premises: check.premises,
        equipmentCount: Number(check.equipmentCount) || 0,
        peopleWorking: Number(check.peopleWorking) || 0,
      };
      // The band first, because it can be answered before anything is
      // published and is the thing being argued about while drafting.
      const banded = await api.post<{ sizeBand: SizeBand }>(
        '/government/presumptive/band',
        observations,
      );
      setBand(banded.sizeBand);

      setPreview(
        await api.post<Preview>('/government/presumptive/preview', {
          economicSector: check.economicSector,
          lgaId: check.lgaId,
          observations,
        }),
      );
    } catch (caught) {
      setPreviewError(asApiError(caught));
    } finally {
      setBusy(false);
    }
  };

  const sectors = schedule
    ? [...new Set(schedule.entries.map((entry) => entry.economicSector))]
    : [];

  /**
   * The instrument, when the whole schedule was adopted under one.
   *
   * `null` when the rows differ, and then the table keeps its column — a row
   * adopted under a different regulation is exactly the thing an officer needs
   * to see, and hiding it to tidy the table would hide the finding.
   */
  const instruments = new Set((schedule?.entries ?? []).map((entry) => entry.instrumentReference));
  const oneInstrument =
    instruments.size === 1 ? ([...instruments][0] ?? null) : null;

  return (
    <>
      <div className="card">
        <h2 className="card__title">{t.ofcPsTitle}</h2>
        <p className="card__hint">{t.ofcPsIntro}</p>
        <ErrorAlert error={error} />
      </div>

      {schedule === null ? (
        <Loading />
      ) : (
        <>
          <div className="card">
            <h2 className="card__title">{t.ofcPsReadiness}</h2>
            <div className="stat-grid">
              <Stat
                label="ofcPsLgasClassified"
                value={`${schedule.readiness.lgasClassified} / ${schedule.readiness.lgasTotal}`}
              />
              <Stat label="ofcPsCells" value={String(schedule.readiness.scheduleCells)} />
            </div>

            {/*
              * The most consequential setting on the page, in words. Which
              * reading is in force decides whether a shop-based trader pays
              * anything at all, and the code name for it tells nobody that.
              */}
            {schedule.readiness.nanoPolicyAdopted ? (
              <Alert kind="info" title="ofcPsExemptionInForce">
                {schedule.readiness.nanoConstruction === 'CONJUNCTIVE'
                  ? t.ofcPsConjunctive
                  : t.ofcPsTurnoverGoverned}
              </Alert>
            ) : (
              <Alert kind="warning" title="ofcPsNoExemptionAdopted">
                {t.ofcPsNoExemptionExplained}
              </Alert>
            )}

            {schedule.readiness.lgasClassified < schedule.readiness.lgasTotal ? (
              <Alert kind="warning" title="ofcPsPartlyPublished">
                {t.ofcPsPartlyPublishedExplained
                  .replace('{{done}}', String(schedule.readiness.lgasClassified))
                  .replace('{{total}}', String(schedule.readiness.lgasTotal))}
              </Alert>
            ) : null}
          </div>

          <div className="card">
            <h2 className="card__title">{t.ofcPsWhatItWouldCost}</h2>
            <p className="card__hint">
              {t.ofcPsCheckIntro}
            </p>

            <div className="filters">
              <div className="field">
                <label htmlFor="ps-sector">{t.ofcPrSector}</label>
                <select
                  id="ps-sector"
                  value={check.economicSector}
                  onChange={(event) =>
                    setCheck({ ...check, economicSector: event.target.value })
                  }
                >
                  {(sectors.length > 0 ? sectors : ['ARTISAN_CRAFT']).map((sector) => (
                    <option key={sector} value={sector}>
                      {enumLabel(sector, t)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="ps-lga">{t.pubVerifyLga}</label>
                <select
                  id="ps-lga"
                  value={check.lgaId}
                  onChange={(event) => setCheck({ ...check, lgaId: event.target.value })}
                >
                  {lgas.map((lga) => (
                    <option key={lga.id} value={lga.id}>
                      {lga.name}
                    </option>
                  ))}
                </select>
              </div>

              {/*
                * Observations only. There is no field for a turnover and none
                * for a band: those are the server's, and a form that offered
                * either would make the assessment negotiable at the counter.
                */}
              <div className="field">
                <label htmlFor="ps-premises">{t.ofcPsPremises}</label>
                <select
                  id="ps-premises"
                  value={check.premises}
                  onChange={(event) =>
                    setCheck({ ...check, premises: event.target.value as (typeof PREMISES)[number] })
                  }
                >
                  {PREMISES.map((value) => (
                    <option key={value} value={value}>
                      {enumLabel(value, t)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="ps-equipment">{t.ofcPsEquipment}</label>
                <input
                  id="ps-equipment"
                  type="number"
                  min="0"
                  value={check.equipmentCount}
                  onChange={(event) => setCheck({ ...check, equipmentCount: event.target.value })}
                />
              </div>

              <div className="field">
                <label htmlFor="ps-people">{t.ofcPsPeople}</label>
                <input
                  id="ps-people"
                  type="number"
                  min="0"
                  value={check.peopleWorking}
                  onChange={(event) => setCheck({ ...check, peopleWorking: event.target.value })}
                />
              </div>
            </div>

            <p>
              <button type="button" onClick={runPreview} disabled={busy || !check.lgaId}>
                {t.ofcPsWorkItOut}
              </button>
            </p>

            {/*
              * Shown whether or not the rest of the answer came back. While
              * the schedule is being drafted the preview refuses, and the band
              * is the half that can still be answered.
              */}
            {band !== null ? (
              <div className="stat-grid">
                <Stat label="ofcPsBand" value={enumLabel(band, t)} />
              </div>
            ) : null}

            <ErrorAlert error={previewError} />

            {preview ? (
              <>
                <div className="stat-grid">
                  <Stat label="ofcPsBand" value={preview.sizeBand} />
                  <Stat label="ofcPsClass" value={preview.lgaClass} />
                  <Stat
                    label="ofcPsAssumedTurnover"
                    value={<Money kobo={preview.assumedAnnualTurnoverKobo} />}
                  />
                  <Stat label="ofcPsAnnualTax" value={<Money kobo={preview.annualTaxKobo} />} />
                  <Stat label="ofcPsMonthlyTax" value={<Money kobo={preview.monthlyTaxKobo} />} />
                </div>

                {preview.tier === 'NANO' ? (
                  <Alert kind="success" title="ofcPsExempt">
                    {t.ofcPsExemptExplained}
                  </Alert>
                ) : null}

                {/*
                  * The working, in the order a person would explain it at a
                  * stall. This is the whole point of the screen: an officer who
                  * can only show a figure is asking to be believed, and an
                  * estimate nobody can follow is one nobody can contest.
                  */}
                <h3 style={{ marginTop: 24, fontSize: 'var(--text-md)' }}>{t.ofcPsHowWeGotThere}</h3>
                <Table
                  columns={[
                    { key: 'step', label: 'ofcPsStep' },
                    { key: 'detail', label: 'ofcPsDetail' },
                    {
                      key: 'amountKobo',
                      label: 'ofcPsAmount',
                      numeric: true,
                      render: (row: Preview['trace'][number]) =>
                        row.amountKobo === undefined ? null : <Money kobo={row.amountKobo} />,
                    },
                  ]}
                  rows={preview.trace}
                  empty="ofcPsNoWorking"
                />
              </>
            ) : null}
          </div>

          <div className="card">
            <h2 className="card__title">{t.ofcPsClasses}</h2>
            <p className="card__hint">
              {t.ofcPsClassesIntro}
            </p>
            <Table
              columns={[
                { key: 'lgaName', label: 'pubVerifyLga' },
                { key: 'classCode', label: 'ofcPsClass' },
                { key: 'indexSource', label: 'ofcPsIndexSource' },
                {
                  key: 'effectiveFrom',
                  label: 'ofcPsFrom',
                  render: (row: ClassRow) => formatDate(row.effectiveFrom),
                },
                {
                  key: 'effectiveTo',
                  label: 'ofcPsUntil',
                  render: (row: ClassRow) =>
                    row.effectiveTo ? formatDate(row.effectiveTo) : t.ofcPsNoEndDate,
                },
              ]}
              rows={schedule.classes}
              empty="ofcPsNoClasses"
            />
          </div>

          <div className="card">
            <h2 className="card__title">{t.ofcPsTheTable}</h2>
            {oneInstrument ? (
              <p className="card__hint">
                {t.ofcPsAllAdoptedUnder} {oneInstrument}
              </p>
            ) : null}
            <Table
              columns={[
                {
                  key: 'economicSector',
                  label: 'ofcPrSector',
                  render: (row: Entry) => enumLabel(row.economicSector, t),
                },
                { key: 'sizeBand', label: 'ofcPsBand' },
                { key: 'lgaClass', label: 'ofcPsClass' },
                {
                  key: 'assumedAnnualTurnoverKobo',
                  label: 'ofcPsAssumedTurnover',
                  numeric: true,
                  render: (row: Entry) => <Money kobo={row.assumedAnnualTurnoverKobo} />,
                },
                {
                  key: 'id',
                  label: 'ofcPsAnnualTax',
                  numeric: true,
                  /*
                   * Shown alongside the assumed turnover rather than left to
                   * the reader. One per cent of ₦4,800,000 is not a sum every
                   * trader will do in their head, and the figure they care
                   * about is the bill.
                   */
                  render: (row: Entry) => (
                    <Money kobo={(BigInt(row.assumedAnnualTurnoverKobo) / 100n).toString()} />
                  ),
                },
                /*
                  * Quiet, and only when it varies.
                  *
                  * The instrument is the same regulation on every row of a
                  * schedule published in one go — thirty-six repetitions of a
                  * seventy-character citation, crowding out the figures the
                  * table exists to show. Where it is one instrument it is
                  * stated once above the table instead; where a row was
                  * adopted under something else the column comes back, because
                  * then the difference is the interesting part.
                  */
                ...(oneInstrument
                  ? []
                  : [{ key: 'instrumentReference', label: 'ofcPsInstrument' as const, meta: true }]),
                { key: 'version', label: 'ofcPsVersion', numeric: true },
              ]}
              rows={schedule.entries}
              empty="ofcPsNoEntries"
              tall
            />

            {canConfigure ? (
              <Alert kind="info">{t.ofcPsHowToChange}</Alert>
            ) : null}
          </div>

          {canConfigure ? (
            <div className="card">
              <h2 className="card__title">{t.ofcPsPublish}</h2>
              <ErrorAlert error={publishError} />
              {publishNote ? <Alert kind="success">{publishNote}</Alert> : null}

              <div className="card__section">
              <h3 className="card__section-title">{t.ofcPsPublishClass}</h3>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="ps-new-lga">{t.pubVerifyLga}</label>
                  <select
                    id="ps-new-lga"
                    value={newClass.lgaId}
                    onChange={(event) => setNewClass({ ...newClass, lgaId: event.target.value })}
                  >
                    <option value="">{t.ofcPsChoose}</option>
                    {lgas.map((lga) => (
                      <option key={lga.id} value={lga.id}>
                        {lga.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="ps-new-class">{t.ofcPsClass}</label>
                  <select
                    id="ps-new-class"
                    value={newClass.classCode}
                    onChange={(event) =>
                      setNewClass({ ...newClass, classCode: event.target.value as LgaClass })
                    }
                  >
                    {(['A', 'B', 'C', 'D'] as LgaClass[]).map((code) => (
                      <option key={code} value={code}>
                        {enumLabel(code, t)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="ps-new-source">{t.ofcPsIndexSource}</label>
                  <input
                    id="ps-new-source"
                    value={newClass.indexSource}
                    onChange={(event) =>
                      setNewClass({ ...newClass, indexSource: event.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="ps-new-inputs">{t.ofcPsIndicators}</label>
                  <input
                    id="ps-new-inputs"
                    placeholder={t.ofcPsIndicatorsHint}
                    value={newClass.indexInputs}
                    onChange={(event) =>
                      setNewClass({ ...newClass, indexInputs: event.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="ps-new-from">{t.ofcPsFrom}</label>
                  <input
                    id="ps-new-from"
                    type="date"
                    value={newClass.effectiveFrom}
                    onChange={(event) =>
                      setNewClass({ ...newClass, effectiveFrom: event.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="ps-new-to">{t.ofcPsUntil}</label>
                  <input
                    id="ps-new-to"
                    type="date"
                    value={newClass.effectiveTo}
                    onChange={(event) =>
                      setNewClass({ ...newClass, effectiveTo: event.target.value })
                    }
                  />
                </div>
              </div>
              <p>
                <button
                  type="button"
                  disabled={
                    busy ||
                    !newClass.lgaId ||
                    !newClass.indexSource.trim() ||
                    !newClass.indexInputs.trim() ||
                    !newClass.effectiveFrom
                  }
                  onClick={async () => {
                    setBusy(true);
                    setPublishError(null);
                    setPublishNote(null);
                    try {
                      await api.post('/government/presumptive/lga-classes', {
                        lgaId: newClass.lgaId,
                        classCode: newClass.classCode,
                        /*
                         * Free text turned into the recorded indicators. Kept
                         * loose on purpose: the indicators differ between
                         * reviews, and a fixed set of fields would make the
                         * next index a schema change.
                         */
                        indexInputs: { note: newClass.indexInputs.trim() },
                        indexSource: newClass.indexSource.trim(),
                        effectiveFrom: newClass.effectiveFrom,
                        ...(newClass.effectiveTo ? { effectiveTo: newClass.effectiveTo } : {}),
                      });
                      setPublishNote(t.ofcPsClassPublished);
                      load();
                    } catch (caught) {
                      setPublishError(asApiError(caught));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t.ofcPsPublishClass}
                </button>
              </p>

              </div>

              <div className="card__section">
              <h3 className="card__section-title">{t.ofcPsPublishFigure}</h3>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="ps-fig-band">{t.ofcPsBand}</label>
                  <select
                    id="ps-fig-band"
                    value={newEntry.sizeBand}
                    onChange={(event) =>
                      setNewEntry({ ...newEntry, sizeBand: event.target.value as SizeBand })
                    }
                  >
                    {(['MICRO', 'SMALL', 'MEDIUM'] as SizeBand[]).map((value) => (
                      <option key={value} value={value}>
                        {enumLabel(value, t)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="ps-fig-class">{t.ofcPsClass}</label>
                  <select
                    id="ps-fig-class"
                    value={newEntry.lgaClass}
                    onChange={(event) =>
                      setNewEntry({ ...newEntry, lgaClass: event.target.value as LgaClass })
                    }
                  >
                    {(['A', 'B', 'C', 'D'] as LgaClass[]).map((code) => (
                      <option key={code} value={code}>
                        {enumLabel(code, t)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="ps-fig-turnover">{t.ofcPsAssumedTurnoverNaira}</label>
                  <input
                    id="ps-fig-turnover"
                    inputMode="numeric"
                    value={newEntry.assumedAnnualNaira}
                    onChange={(event) =>
                      setNewEntry({ ...newEntry, assumedAnnualNaira: event.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="ps-fig-instrument">{t.ofcPsInstrument}</label>
                  <input
                    id="ps-fig-instrument"
                    value={newEntry.instrumentReference}
                    onChange={(event) =>
                      setNewEntry({ ...newEntry, instrumentReference: event.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="ps-fig-from">{t.ofcPsFrom}</label>
                  <input
                    id="ps-fig-from"
                    type="date"
                    value={newEntry.effectiveFrom}
                    onChange={(event) =>
                      setNewEntry({ ...newEntry, effectiveFrom: event.target.value })
                    }
                  />
                </div>
              </div>
              <p>
                <button
                  type="button"
                  disabled={
                    busy ||
                    !newEntry.assumedAnnualNaira.trim() ||
                    !newEntry.instrumentReference.trim() ||
                    !newEntry.effectiveFrom
                  }
                  onClick={async () => {
                    setBusy(true);
                    setPublishError(null);
                    setPublishNote(null);
                    try {
                      await api.post('/government/presumptive/schedule', {
                        economicSector: newEntry.economicSector,
                        sizeBand: newEntry.sizeBand,
                        lgaClass: newEntry.lgaClass,
                        assumedAnnualTurnoverKobo: (
                          BigInt(newEntry.assumedAnnualNaira.replace(/\D/g, '') || '0') * 100n
                        ).toString(),
                        instrumentReference: newEntry.instrumentReference.trim(),
                        effectiveFrom: newEntry.effectiveFrom,
                      });
                      setPublishNote(t.ofcPsFigurePublished);
                      load();
                    } catch (caught) {
                      setPublishError(asApiError(caught));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t.ofcPsPublishFigure}
                </button>
              </p>

              </div>

              {canAdoptNano ? (
                <div className="card__section">
                  <h3 className="card__section-title">{t.ofcPsAdoptExemption}</h3>
                  <Alert kind="warning" title="ofcPsAdoptWarningTitle">
                    {t.ofcPsAdoptWarning}
                  </Alert>
                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor="ps-nano-construction">{t.ofcPsConstruction}</label>
                      <select
                        id="ps-nano-construction"
                        value={nano.construction}
                        onChange={(event) =>
                          setNano({
                            ...nano,
                            construction: event.target.value as typeof nano.construction,
                          })
                        }
                      >
                        <option value="CONJUNCTIVE">{t.enumConjunctive}</option>
                        <option value="TURNOVER_GOVERNED">{t.enumTurnoverGoverned}</option>
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="ps-nano-ceiling">{t.ofcPsCeiling}</label>
                      <input
                        id="ps-nano-ceiling"
                        inputMode="numeric"
                        value={nano.ceilingNaira}
                        onChange={(event) => setNano({ ...nano, ceilingNaira: event.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="ps-nano-basis">{t.ofcPsLegalBasis}</label>
                      <input
                        id="ps-nano-basis"
                        value={nano.legalBasis}
                        onChange={(event) => setNano({ ...nano, legalBasis: event.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="ps-nano-from">{t.ofcPsFrom}</label>
                      <input
                        id="ps-nano-from"
                        type="date"
                        value={nano.effectiveFrom}
                        onChange={(event) => setNano({ ...nano, effectiveFrom: event.target.value })}
                      />
                    </div>
                  </div>
                  <p>
                    <button
                      type="button"
                      disabled={busy || !nano.legalBasis.trim() || !nano.effectiveFrom}
                      onClick={async () => {
                        setBusy(true);
                        setPublishError(null);
                        setPublishNote(null);
                        try {
                          await api.post('/government/presumptive/nano-policy', {
                            construction: nano.construction,
                            turnoverCeilingKobo: (
                              BigInt(nano.ceilingNaira.replace(/\D/g, '') || '0') * 100n
                            ).toString(),
                            legalBasis: nano.legalBasis.trim(),
                            effectiveFrom: nano.effectiveFrom,
                          });
                          setPublishNote(t.ofcPsExemptionAdopted);
                          load();
                        } catch (caught) {
                          setPublishError(asApiError(caught));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {t.ofcPsAdoptExemption}
                    </button>
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
