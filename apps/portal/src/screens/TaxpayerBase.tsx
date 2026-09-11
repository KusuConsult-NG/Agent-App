/**
 * The taxpayer base as a population, not as a count.
 *
 * The dashboard reported two things about taxpayers — how many, and how many
 * registered this month — and a revenue officer plans against neither. The
 * questions they actually ask are: how many of these people are still paying,
 * how often, how much, and where are the ones who have stopped.
 *
 * ONE DISTINCTION RUNS THROUGH THIS SCREEN
 *
 * "Active" here means *paying*, not `status = 'ACTIVE'`. The register's own
 * status says whether a record is live; it says nothing about whether the
 * person is paying, so a register full of people who last paid two years ago
 * reports 100% active under that reading — which is the reading every figure on
 * this platform had until now. The hint under the figure says so, because an
 * officer arriving from the old dashboard will otherwise read the same word and
 * assume the same thing.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api, asApiError, type ApiError } from '../lib/api';
import { BarList, ErrorAlert, Loading, Money, Stat, Table } from '../ui';
import { usePortalI18n } from '../lib/i18n';
import { enumLabel, localName } from '@psirs/shared';

interface Analytics {
  cohorts: {
    total: string;
    individuals: string;
    businesses: string;
    new_this_month: string;
    new_last_month: string;
    active: string;
    inactive: string;
    never_paid: string;
    average_lifetime_kobo: string;
    average_payments_each: string;
    lifetime_kobo: string;
  };
  byLga: {
    lga: string;
    taxpayers: string;
    new_this_month: string;
    active: string;
    outstanding_kobo: string;
    average_compliance_score: string;
  }[];
  byCategory: {
    category: string;
    category_ha: string | null;
    taxpayers: string;
    taxpayers_paid: string;
  }[];
  paymentFrequency: { band: string; taxpayers: string; average_payment_kobo: string }[];
}

export function TaxpayerBaseScreen() {
  const { t, lang } = usePortalI18n();
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [lgas, setLgas] = useState<{ id: string; name: string }[]>([]);
  const [lgaId, setLgaId] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = lgaId ? `?lgaId=${lgaId}` : '';
      setData(await api.get<Analytics>(`/government/taxpayers/analytics${params}`));
    } catch (caught) {
      setError(asApiError(caught));
    }
  }, [lgaId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .get<{ id: string; name: string }[]>('/reference/lgas')
      .then(setLgas)
      .catch(() => setLgas([]));
  }, []);

  return (
    <>
      <div className="card">
        <h2>{t.ofcTaTitle}</h2>
        <p className="muted">{t.ofcTaIntro}</p>
        <div className="filters">
          <label>
            {t.tpLgaShort}
            <select value={lgaId} onChange={(event) => setLgaId(event.target.value)}>
              <option value="">{t.ofcAllLgas}</option>
              {lgas.map((lga) => (
                <option key={lga.id} value={lga.id}>
                  {lga.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ErrorAlert error={error} />
      </div>

      {/*
        A skeleton means "still working", and a read that has already failed
        is not still working. The reason is in the card above; without this
        the rest of the screen sat under six grey bars that never resolve, and
        an officer waiting for a taxpayer register has no way to tell a slow
        answer from no answer at all.
      */}
      {!data && error ? null : !data ? (
        <div className="card">
          <Loading rows={6} />
        </div>
      ) : (
        <>
          <div className="card">
            <div className="stat-grid">
              <Stat
                label="ofcTaTotal"
                value={Number(data.cohorts.total).toLocaleString()}
                hint={{
                  text: `${Number(data.cohorts.individuals).toLocaleString()} · ${Number(
                    data.cohorts.businesses,
                  ).toLocaleString()}`,
                }}
              />
              <Stat
                label="ofcTaActive"
                value={Number(data.cohorts.active).toLocaleString()}
                variant="accent"
                hint="ofcTaActiveHint"
              />
              <Stat
                label="ofcTaInactive"
                value={Number(data.cohorts.inactive).toLocaleString()}
                variant={Number(data.cohorts.inactive) > Number(data.cohorts.active) ? 'alert' : undefined}
              />
              <Stat
                label="ofcTaNeverPaid"
                value={Number(data.cohorts.never_paid).toLocaleString()}
              />
            </div>
            <div className="stat-grid">
              <Stat
                label="ofcTaNewThisMonth"
                value={Number(data.cohorts.new_this_month).toLocaleString()}
                hint={{ text: Number(data.cohorts.new_last_month).toLocaleString() }}
              />
              <Stat
                label="ofcTaAverageLifetime"
                value={<Money kobo={data.cohorts.average_lifetime_kobo} />}
              />
              <Stat label="ofcTaAveragePayment" value={data.cohorts.average_payments_each} />
              <Stat label="ofcPfCollected" value={<Money kobo={data.cohorts.lifetime_kobo} />} />
            </div>
          </div>

          <div className="card">
            <h3>{t.ofcTaFrequency}</h3>
            <p className="muted">{t.ofcTaFrequencyBody}</p>
            <Table
              rows={data.paymentFrequency}
              columns={[
                {
                  key: 'band',
                  label: 'ofcTaFrequency',
                  render: (row) => enumLabel(row.band, t),
                },
                { key: 'taxpayers', label: 'ofcRhTaxpayers', numeric: true },
                {
                  key: 'average_payment_kobo',
                  label: 'ofcTaAveragePayment',
                  numeric: true,
                  render: (row) => <Money kobo={row.average_payment_kobo} />,
                },
              ]}
            />
          </div>

          <div className="grid-2">
            <div className="card">
              <h3>{t.ofcTaByCategory}</h3>
              <BarList
                items={data.byCategory.slice(0, 12).map((row) => ({
                  label: { text: localName(lang, row.category, row.category_ha) },
                  sublabel: `${row.taxpayers_paid} / ${row.taxpayers}`,
                  value: Number(row.taxpayers),
                }))}
                formatValue={(value) => value.toLocaleString()}
              />
            </div>

            <div className="card card--flush">
              <div style={{ padding: '18px 18px 0' }}>
                <h3 className="card__title">{t.ofcTaByLga}</h3>
              </div>
              <Table
                rows={data.byLga}
                columns={[
                  { key: 'lga', label: 'tpLgaShort' },
                  { key: 'taxpayers', label: 'ofcTaTotal', numeric: true },
                  {
                    key: 'active',
                    label: 'ofcTaActive',
                    numeric: true,
                    render: (row) => {
                      const total = Number(row.taxpayers);
                      const active = Number(row.active);
                      return total === 0 ? (
                        '—'
                      ) : (
                        <>
                          {active.toLocaleString()}
                          <br />
                          <span className="muted">
                            {Math.round((active / total) * 100)}%
                          </span>
                        </>
                      );
                    },
                  },
                  {
                    key: 'outstanding_kobo',
                    label: 'ofcTaOutstanding',
                    numeric: true,
                    render: (row) => <Money kobo={row.outstanding_kobo} />,
                  },
                  {
                    key: 'average_compliance_score',
                    label: 'ofcTaComplianceScore',
                    numeric: true,
                  },
                ]}
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}
