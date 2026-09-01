/** Transaction monitoring and export (PRD §48, §49). */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api, downloadCsv, type ApiError } from '../lib/api';
import { Badge, ErrorAlert, Loading, Money, Table, formatDateTime } from '../ui';
import { usePortalI18n } from '../lib/i18n';
import { enumLabel } from '@psirs/shared';

interface TransactionRow {
  transaction_reference: string;
  amount_kobo: string;
  status: string;
  created_at: string;
  verified_at: string | null;
  revenue_item: string;
  revenue_category: string;
  lga: string;
  agent_code: string | null;
  taxpayer_name: string;
  tin: string | null;
  receipt_number: string | null;
  gateway_reference: string | null;
  payment_method: string | null;
}

const STATUSES = [
  'INVOICE_GENERATED',
  'PAYMENT_PENDING',
  'PAYMENT_VERIFIED',
  'RECEIPT_GENERATED',
  'RECONCILIATION_PENDING',
  'SETTLED',
  'FAILED',
  'REVERSED',
  'REFUNDED',
  'UNDER_REVIEW',
];

export function TransactionsScreen() {
  const { t } = usePortalI18n();
  const [rows, setRows] = useState<TransactionRow[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [lgas, setLgas] = useState<{ id: string; name: string }[]>([]);
  const [filters, setFilters] = useState({ status: '', lgaId: '', from: '', to: '' });

  const buildQuery = useCallback(() => {
    const params = new URLSearchParams({ limit: '200' });
    if (filters.status) params.set('status', filters.status);
    if (filters.lgaId) params.set('lgaId', filters.lgaId);
    if (filters.from) params.set('from', new Date(filters.from).toISOString());
    if (filters.to) params.set('to', new Date(`${filters.to}T23:59:59`).toISOString());
    return params;
  }, [filters]);

  useEffect(() => {
    api
      .get<{ id: string; name: string }[]>('/reference/lgas')
      .then(setLgas)
      .catch(() => setLgas([]));
  }, []);

  useEffect(() => {
    setRows(null);
    api
      .get<TransactionRow[]>(`/government/transactions?${buildQuery().toString()}`)
      .then(setRows)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
  }, [buildQuery]);

  async function exportCsv() {
    const params = buildQuery();
    params.set('format', 'csv');
    const csv = await api.get<string>(`/government/transactions?${params.toString()}`);
    downloadCsv(`plateau-transactions-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  return (
    <>
      <div className="card">
        <div className="filters">
          <div className="field">
            <label htmlFor="status">{t.appStatus}</label>
            <select
              id="status"
              value={filters.status}
              onChange={(event) => setFilters({ ...filters, status: event.target.value })}
            >
              <option value="">{t.ofcAllStatuses}</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {enumLabel(status, t)}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="lga">{t.pubVerifyLga}</label>
            <select
              id="lga"
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
          </div>

          <div className="field">
            <label htmlFor="from">{t.ofcFrom}</label>
            <input
              id="from"
              type="date"
              value={filters.from}
              onChange={(event) => setFilters({ ...filters, from: event.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="to">{t.ofcTo}</label>
            <input
              id="to"
              type="date"
              value={filters.to}
              onChange={(event) => setFilters({ ...filters, to: event.target.value })}
            />
          </div>

          <button type="button" className="secondary" onClick={exportCsv}>{t.ofcExportCsv}</button>
        </div>
      </div>

      <ErrorAlert error={error} />

      <div className="card card--flush">
        {!rows ? (
          <div style={{ padding: 18 }}>
            <Loading rows={6} />
          </div>
        ) : (
          <Table
            columns={[
              {
                key: 'transaction_reference',
                label: 'errReference',
                render: (row) => <span className="mono">{row.transaction_reference}</span>,
              },
              { key: 'taxpayer_name', label: 'colTaxpayerLabel' },
              { key: 'revenue_item', label: 'colRevenueItem' },
              { key: 'lga', label: 'tpLgaShort' },
              { key: 'agent_code', label: 'ofcRhAgent', render: (row) => row.agent_code ?? 'Direct' },
              {
                key: 'amount_kobo',
                label: 'pubVerifyAmount',
                numeric: true,
                render: (row) => <Money kobo={row.amount_kobo} />,
              },
              { key: 'status', label: 'appStatus', render: (row) => <Badge status={row.status} /> },
              {
                key: 'receipt_number',
                label: 'ofcTxReceipt',
                render: (row) =>
                  row.receipt_number ? <span className="mono">{row.receipt_number}</span> : '—',
              },
              {
                key: 'created_at',
                label: 'ofcTxCreated',
                render: (row) => formatDateTime(row.created_at),
              },
            ]}
            rows={rows}
            empty="ofcNoneTransactionsMatchTheseFilters"
          />
        )}
      </div>
    </>
  );
}
