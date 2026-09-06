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
  /*
   * The command centre's own state.
   *
   * All six are written during a run and none is reference data, so they belong
   * here — and `departments` in particular has to be, because it holds a
   * `head_user_id` and `resetDatabase` deletes the officers those rows point
   * at. A department left behind by one file breaks every later file's reset
   * with a foreign key violation, in a shard database that outlives the run.
   * That is the same failure `app_versions` was added for, below.
   */
  'case_events',
  'cases',
  /*
   * The auditor's workpapers.
   *
   * Items before samples: the cascade would do it, but naming both keeps the
   * order explicit and stops a later reader wondering whether the cascade is
   * load-bearing. Both hold user references the reset deletes, and both are
   * protected against row-level DELETE by migration 062 -- which TRUNCATE does
   * not fire, so emptying them between files leaves that guarantee intact.
   */
  'audit_sample_items',
  'audit_samples',
  'audit_reports',
  /*
   * The officer's own machines and the files they put on a case.
   *
   * `officer_devices` holds a `user_id` the reset deletes and a `blocked_by`
   * pointing at another officer, so a row left behind by one file breaks the
   * next file's reset with a foreign key violation. `case_evidence_files` is
   * referenced by `case_events`, which is emptied above -- both are protected
   * against row-level DELETE by migration 063, and TRUNCATE does not fire that
   * trigger, so emptying them between files leaves the guarantee intact.
   */
  'case_evidence_files',
  'officer_devices',
  /*
   * The inbox, which holds a `user_id` and a `read_by` the reset deletes, and
   * is protected against row-level DELETE by migration 064 -- TRUNCATE does
   * not fire that trigger, so emptying it between files leaves the guarantee
   * intact. It also has to be emptied for a reason the other tables do not
   * share: an unread system alert left behind by one file would satisfy the
   * "one unread per subject" index and silence the next file's sweep.
   */
  'officer_notifications',
  /*
   * And the period lock.
   *
   * It has to be emptied between files for two reasons. It holds a `closed_by`
   * pointing at an officer the reset deletes, like `departments` above — and a
   * closed period left behind would refuse the *next* file's collections at the
   * database, which is the lock working exactly as designed against a fixture
   * that has no idea it exists. TRUNCATE does not fire the row-level DELETE
   * trigger, so the "never deleted" guarantee is unaffected.
   */
  'financial_periods',
  /*
   * The delegation of authority, which is reference data a test can change.
   *
   * Migration 059 moved the role-to-permission map into the database, so a test
   * that grants `catalogue:configure` to finance officers changes it for every
   * file that runs afterwards in the same shard — and the parity test that
   * compares the table against the compiled map would then fail on somebody
   * else's grant. Emptied between files and restored by `seedRoles`, which
   * re-applies the compiled map only to a role that has no grants at all.
   *
   * `role_permissions` before `roles`: the first references the second.
   */
  'role_permissions',
  'revenue_targets',
  'officer_transfers',
  'departments',
  'revenue_offices',
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
