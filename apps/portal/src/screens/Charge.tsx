/**
 * One invoice, one assessment, and how the figure on it was arrived at.
 *
 * `GET /revenue/invoices/:id` and `GET /revenue/assessments/:id` were both
 * built, both permissioned on two tiers, and neither had a caller anywhere in
 * either front end. Two of the reads recorded in READ_WITHOUT_A_SCREEN.
 *
 * WHERE THAT WAS ACTUALLY FELT
 *
 * The global search knows about invoices and assessments — an officer holding
 * a number off a citizen's SMS or a bank statement can type it and the hit
 * comes back. Where the hit SENT them was:
 *
 *   COALESCE('/transaction/' || t.id, '/outstanding')
 *
 * A transaction if one exists, and otherwise the outstanding worklist: a list
 * of everybody's unpaid invoices, filtered by nothing, with no mention of the
 * one that was searched for. An invoice with no transaction is an invoice
 * raised and never paid — which is precisely the invoice somebody is holding
 * a number for and asking about. The one case where the officer most needs to
 * look at the record is the case the search could not show them.
 *
 * WHAT THIS SCREEN IS FOR, BEYOND EXISTING
 *
 * `computation_trace` is frozen on the assessment at the moment it is raised,
 * and the schema says why: "Retained so an auditor can re-run the calculation
 * years later." It is the answer to "why do I owe this", and until now it was
 * answerable only by somebody with a database client. A citizen disputing a
 * figure at a counter is disputing the steps in that trace, so the officer in
 * front of them should be able to read them out.
 *
 * The steps are stored English, written when the assessment was raised. They
 * are not translated here and must not be: they are a record of what the
 * platform computed on a particular day, and rewriting a historical record
 * into another language is not translation. Everything the SCREEN says is in
 * the dictionary; what the RECORD says is quoted.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api, asApiError, type ApiError } from '../lib/api';
import {
  Alert,
  Badge,
  Empty,
  ErrorAlert,
  KeyValue,
  Loading,
  Money,
  Stat,
  Table,
  formatDate,
  formatDateTime,
} from '../ui';
import { usePortalI18n } from '../lib/i18n';
import { enumLabel, localName } from '@psirs/shared';

/** One line of the frozen calculation. `amount` is optional on a step. */
interface TraceStep {
  step: string;
  detail: string;
  amount?: string;
}

interface InvoiceRecord {
  id: string;
  invoice_number: string;
  assessment_id: string;
  amount_kobo: string;
  service_charge_kobo: string;
  total_amount_kobo: string;
  amount_paid_kobo: string;
  verification_code: string;
  issued_at: string;
  expires_at: string | null;
  status: string;
  assessment_number: string;
  period_label: string | null;
  computation_trace: unknown;
  revenue_item: string;
  revenue_item_ha: string | null;
  revenue_category: string;
  revenue_category_ha: string | null;
  transaction_reference: string | null;
  transaction_status: string | null;
}

interface AssessmentRecord {
  id: string;
  assessment_number: string;
  assessment_type: string;
  base_amount_kobo: string;
  discount_kobo: string;
  service_charge_kobo: string;
  amount_kobo: string;
  period_start: string | null;
  period_end: string | null;
  period_label: string | null;
  status: string;
  created_at: string;
  computation_trace: unknown;
  computation_inputs: unknown;
  revenue_item: string;
  revenue_item_ha: string | null;
  revenue_category: string;
  revenue_category_ha: string | null;
  invoice_number: string | null;
  invoice_status: string | null;
  expires_at: string | null;
}

/**
 * One read, kept apart from the emptiness it would otherwise produce.
 *
 * `null` while it is in flight or after it failed; the caller draws the error
 * and a way to ask again rather than a record with no fields in it.
 */
function useRecord<T>(path: string) {
  const [record, setRecord] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(() => {
    setError(null);
    setRecord(null);
    api
      .get<T>(path)
      .then(setRecord)
      .catch((caught) => {
        setError(asApiError(caught));
      });
  }, [path]);

  useEffect(load, [load]);
  return { record, error, reload: load };
}

function Failed({ error, retry }: { error: ApiError; retry: () => void }) {
  const { t } = usePortalI18n();
  return (
    <div className="card">
      <ErrorAlert error={error} />
      <button type="button" className="secondary" onClick={retry}>
        {t.actionTryAgain}
      </button>
    </div>
  );
}

/**
 * The calculation as it was recorded, not as it would be computed today.
 *
 * The column default for `computation_trace` is `'{}'` and what is written is
 * an array, so a row from before a trace was kept — or any row the platform
 * has not touched — arrives as an object. `Array.isArray` rather than a truth
 * test: `{}` is truthy and `.map` on it throws, which would take the whole
 * screen down over a field that is merely absent.
 */
function Calculation({ trace }: { trace: unknown }) {
  const { t } = usePortalI18n();
  const steps = Array.isArray(trace) ? (trace as TraceStep[]) : [];

  return (
    <div className="card card--flush">
      <div className="card__pad">
        <h3 className="card__title">{t.ofcChHowComputed}</h3>
        <p className="card__hint">{t.ofcChTraceFrozen}</p>
      </div>
      {steps.length === 0 ? (
        <div className="card__pad" style={{ paddingBottom: 18 }}>
          <Empty>{t.ofcChNoTrace}</Empty>
        </div>
      ) : (
        <Table
          columns={[
            { key: 'step', label: 'ofcChStep', render: (row: TraceStep) => row.step },
            { key: 'detail', label: 'ofcChDetail', render: (row: TraceStep) => row.detail },
            {
              key: 'amount',
              label: 'ofcChAmount',
              numeric: true,
              render: (row: TraceStep) =>
                row.amount === undefined ? '—' : <Money kobo={row.amount} />,
            },
          ]}
          rows={steps}
          empty="ofcChNoTrace"
        />
      )}
    </div>
  );
}

export function InvoiceScreen({
  id,
  navigate,
}: {
  id: string;
  navigate: (path: string) => void;
}) {
  const { lang, t } = usePortalI18n();
  const { record, error, reload } = useRecord<InvoiceRecord>(
    `/revenue/invoices/${encodeURIComponent(id)}`,
  );

  if (error) return <Failed error={error} retry={reload} />;
  if (!record) return <div className="card"><Loading rows={6} /></div>;

  const owed = BigInt(record.total_amount_kobo) - BigInt(record.amount_paid_kobo);
  const lapsed = record.status === 'EXPIRED';

  return (
    <>
      <div className="card">
        <h2>{record.invoice_number}</h2>
        <p className="muted">{t.ofcChInvoiceIntro}</p>

        <div className="stat-grid">
          <Stat label="ofcChDemanded" value={<Money kobo={record.total_amount_kobo} />} />
          <Stat label="ofcChPaidSoFar" value={<Money kobo={record.amount_paid_kobo} />} />
          <Stat
            label="ofcChStillOwed"
            value={<Money kobo={owed.toString()} />}
            variant={owed > 0n ? 'alert' : undefined}
          />
          <Stat label="ofcCwStatus" value={<Badge status={record.status} />} />
        </div>

        {lapsed && (
          /*
           * Not a styling choice. Past its deadline the platform refuses money
           * against an invoice, so an officer who rings the taxpayer and asks
           * them to pay is sending them to a counter that will turn them away.
           */
          <Alert kind="warning" title="ofcChLapsedTitle">
            <p style={{ margin: 0 }}>
              {record.expires_at
                ? t.ofcChLapsed.replace('{{date}}', formatDate(record.expires_at))
                : t.ofcChLapsedNoDate}
            </p>
          </Alert>
        )}

        <KeyValue
          items={[
            [
              t.ofcSearchRevenueItem,
              `${localName(lang, record.revenue_item, record.revenue_item_ha)} · ${localName(
                lang,
                record.revenue_category,
                record.revenue_category_ha,
              )}`,
            ],
            [t.ofcT3ServiceCharge, <Money kobo={record.service_charge_kobo} />],
            [t.ofcChPeriod, record.period_label ?? '—'],
            [t.ofcChIssued, formatDateTime(record.issued_at)],
            [
              t.ofcChPayableUntil,
              record.expires_at ? formatDate(record.expires_at) : t.ofcArNoDeadline,
            ],
            [t.ofcChVerificationCode, record.verification_code],
          ]}
        />

        <div className="button-row">
          <button
            type="button"
            className="secondary"
            onClick={() => navigate(`/assessment/${record.assessment_id}`)}
          >
            {t.ofcChOpenAssessment.replace('{{number}}', record.assessment_number)}
          </button>
          {record.transaction_reference ? (
            <button
              type="button"
              className="secondary"
              onClick={() => navigate(`/transaction/${record.transaction_reference}`)}
            >
              {t.ofcChOpenTransaction.replace('{{reference}}', record.transaction_reference)}
            </button>
          ) : (
            /*
             * Said rather than left blank. An invoice with no transaction is
             * one nobody has tried to pay, and that is the answer to the
             * question the officer opened this screen with.
             */
            <p className="card__hint" style={{ margin: 0, alignSelf: 'center' }}>
              {t.ofcChNoTransaction}
            </p>
          )}
        </div>
      </div>

      <Calculation trace={record.computation_trace} />
    </>
  );
}

/*
 * No `navigate` here, unlike the invoice screen: the assessment row carries
 * its invoice's NUMBER and not its id, so there is nothing to route to. A
 * button that looked like a link and went nowhere would be worse than the
 * number printed plainly.
 */
export function AssessmentScreen({ id }: { id: string }) {
  const { lang, t } = usePortalI18n();
  const { record, error, reload } = useRecord<AssessmentRecord>(
    `/revenue/assessments/${encodeURIComponent(id)}`,
  );

  if (error) return <Failed error={error} retry={reload} />;
  if (!record) return <div className="card"><Loading rows={6} /></div>;

  return (
    <>
      <div className="card">
        <h2>{record.assessment_number}</h2>
        <p className="muted">{t.ofcChAssessmentIntro}</p>

        <div className="stat-grid">
          <Stat label="ofcChBaseAmount" value={<Money kobo={record.base_amount_kobo} />} />
          <Stat label="ofcChDiscount" value={<Money kobo={record.discount_kobo} />} />
          <Stat label="ofcT3ServiceCharge" value={<Money kobo={record.service_charge_kobo} />} />
          <Stat label="ofcChPayable" value={<Money kobo={record.amount_kobo} />} />
        </div>

        <KeyValue
          items={[
            [
              t.ofcSearchRevenueItem,
              `${localName(lang, record.revenue_item, record.revenue_item_ha)} · ${localName(
                lang,
                record.revenue_category,
                record.revenue_category_ha,
              )}`,
            ],
            [t.ofcCwStatus, <Badge status={record.status} />],
            [t.ofcChRaisedBy, enumLabel(record.assessment_type, t)],
            [t.ofcChPeriod, record.period_label ?? '—'],
            [t.ofcChRaisedOn, formatDateTime(record.created_at)],
          ]}
        />

        {record.invoice_number ? (
          <p style={{ marginBottom: 0 }}>
            {t.ofcT3Invoice}: <strong>{record.invoice_number}</strong>{' '}
            <Badge status={record.invoice_status} />
          </p>
        ) : (
          /*
           * An assessment with no invoice has been computed and never
           * demanded. Nothing is owed yet, and saying so is the difference
           * between "not billed" and "billed and ignored".
           */
          <Alert kind="info" title="ofcChNoInvoiceTitle">
            <p style={{ margin: 0 }}>{t.ofcChNoInvoiceYet}</p>
          </Alert>
        )}
      </div>

      <Calculation trace={record.computation_trace} />
    </>
  );
}
