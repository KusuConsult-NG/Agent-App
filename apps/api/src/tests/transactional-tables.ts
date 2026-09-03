/**
 * Tables holding transactional state, cleared between suites.
 *
 * Everything not named here is reference data: geography, the revenue
 * catalogue, notification templates, the roles and permissions. Those rows are
 * seeded once into a shard database that outlives the run, and
 * `resetDatabase` deliberately leaves them alone.
 *
 * Lives in its own module because two things need the distinction and neither
 * should import the other. `helpers.ts` truncates this list between files, and
 * `scripts/check-enum-coverage.ts` uses its complement to know which states
 * are held in standing reference data rather than written during a run.
 */
export const TRANSACTIONAL_TABLES = [
  /*
   * Operational state, not reference data.
   *
   * One row per background job, written by whichever instance ran it. A row
   * left behind makes the next file's health assertions read a run from
   * somebody else's test — and because the shard databases outlive a run, it
   * would read one from yesterday.
   */
  'background_jobs',
  'document_access_logs',
  'verification_attempts',
  'reconciliation_records',
  'reconciliation_runs',
  'gateway_statement_lines',
  'refunds',
  'commission_payouts',
  'commissions',
  'receipts',
  'payment_webhook_events',
  'payments',
  'transaction_events',
  'transactions',
  'invoices',
  'assessments',
  'vehicle_renewals',
  'vehicles',
  'settlements',
  'fraud_flags',
  'referee_risk_flags',
  'offline_drafts',
  'programme_eligibility',
  'incentive_programmes',
  'taxpayer_compliance',
  'taxpayer_duplicate_checks',
  'taxpayers',
  'documents',
  'notifications',
  'support_tickets',
  'ticket_messages',
  'agent_clearance_events',
  'agent_clearance',
  'agent_training_progress',
  'agent_agreements',
  'agent_devices',
  'referee_invitations',
  'referee_kyc',
  'referees',
  'kyc_documents',
  'agent_kyc',
  'approvals',
  'agents',
  'bank_accounts',
  'sessions',
  'step_up_grants',
  'otp_codes',
  'idempotency_keys',
  'audit_logs',
  'mock_gateway_transactions',
  /*
   * Reference data until an officer could add to it.
   *
   * `app_versions` was seeded once and never written again, so it sat outside
   * this list with the geography and the catalogue. Publishing a new minimum
   * version makes it operational state: the row carries `created_by`, and
   * `resetDatabase` deletes exactly those users below — so a single published
   * version left behind by one file broke every later file's reset with a
   * foreign key violation, in a shard database that outlives the run. It is
   * emptied here and the default row comes back with the rest of the seed.
   */
  'app_versions',
];
