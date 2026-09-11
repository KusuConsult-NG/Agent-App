/**
 * Roles and permissions (PRD §7, §36).
 *
 * The permission set is deliberately verb:resource shaped and exhaustive:
 * a route that needs authorisation names a permission, never a role. That
 * keeps §36's access matrix a single source of truth instead of a table in
 * a document that drifts from the code.
 *
 * There is no `taxpayer` role, and that is a product decision rather than an
 * omission. Revenue services reach the citizen through an authorised agent who
 * approaches them — to onboard them, or to help them remit a tax or levy. A
 * citizen never signs in, so there is no credential to phish, no self-service
 * session to hijack, and no account whose compromise could raise an assessment.
 *
 * The citizen is not left without recourse: they receive their receipt by SMS,
 * and they can verify it against government records at any time through the
 * public verification page, which requires no account at all (PRD §43).
 */

export const ROLES = [
  'agent',
  'supervisor',
  'revenue_officer',
  'finance_officer',
  'auditor',
  'admin',
] as const;

export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  // Taxpayers
  'taxpayer:read:assigned',
  'taxpayer:read:all',
  'taxpayer:create',
  'taxpayer:update',
  'taxpayer:manage',
  /**
   * Correcting what a taxpayer record says about somebody.
   *
   * Separate from `taxpayer:update`, which agents hold so they can maintain
   * the records they register in the field. A correction is decided by
   * somebody who did not capture the record — an agent who notices a
   * misspelling raises it through support — so this is an officer permission
   * and the distinction is enforced by the permission rather than by a check
   * inside the handler.
   */
  'taxpayer:correct',
  /*
   * Cancelling an obligation is not the same authority as correcting a record.
   * `taxpayer:update` covers fixing a phone number during onboarding and is
   * held by agents; removing what a citizen owes government is a revenue
   * decision. Without a permission that separates them, any agent could zero
   * out the liabilities of a taxpayer they had registered.
   */
  'taxpayer:obligation:waive',
  /*
   * Informal-sector groups and the allocation of physical benefits.
   *
   * `group:register` is an agent's job — they meet the cooperative in the
   * field. `group:manage` is the officer's decision that a group is real, and
   * `allocation:manage` opens a round and awards from it, which is spending a
   * finite public resource and belongs with the officers who answer for it.
   * `allocation:collect` only records that somebody turned up and took theirs,
   * so it can sit with the agent at the collection point.
   */
  'group:register',
  'group:read:all',
  'group:read:own',
  'group:manage',
  'allocation:read:all',
  'allocation:manage',
  'allocation:collect',
  /**
   * Chase TINs the PSIRS TIN service has not issued yet, and see who is still
   * waiting. Back-office data-quality work: an agent registers taxpayers, but
   * deciding to re-ask the TIN service in bulk is not field work.
   */
  'taxpayer:tin_sync',

  // Revenue catalogue
  'catalogue:read',
  'catalogue:configure',

  // Assessment / invoice
  'assessment:create',
  'assessment:read:own',
  'assessment:read:all',
  /*
   * Filing a PAYE return on behalf of an employer.
   *
   * Separate from `assessment:create`, which agents hold because raising an
   * assessment in front of a taxpayer is their job. A payroll return is a
   * different act: it comes off a document, covers dozens of named people, and
   * produces a liability far larger than anything an agent raises at a stall.
   * Putting it behind the field permission would let any cleared agent file a
   * school's payroll, which is neither their work nor something the school
   * would know had happened.
   */
  'paye:file',
  'invoice:create',
  'invoice:read:own',
  'invoice:read:all',

  // Payments
  'payment:initiate',
  'payment:read:own',
  'payment:read:all',
  'payment:reconcile',
  'payment:reverse:request',
  'payment:reverse:approve',

  // Receipts and documents
  'receipt:read:own',
  'receipt:read:all',
  'document:read:own',
  'document:read:all',

  // Vehicles
  'vehicle:read:all',
  'vehicle:renew',
  /**
   * Re-send renewals the vehicle authority never acknowledged, and see which
   * vehicles were captured while it was unreachable. Back-office work, not
   * field work: an agent must not be able to decide the authority has been
   * told.
   */
  'vehicle:authority_sync',
  /**
   * Take a vehicle out of service and put it back. Separate from
   * `vehicle:renew`, which an agent holds: an agent sells particulars, and
   * deciding a vehicle has been scrapped or that its plate is under
   * investigation is not a decision made at the point of sale.
   */
  'vehicle:manage',

  // Agents
  'agent:read:own',
  'agent:read:assigned',
  'agent:read:all',
  'agent:manage',
  'agent:approve',
  'agent:suspend',
  'agent:assign_territory',
  'device:manage',

  // Commission
  'commission:read:own',
  'commission:read:all',
  'commission:manage',
  'commission:payout:request',
  'commission:payout:approve',

  // Reports and dashboards
  'report:read:own',
  'report:read:territory',
  'report:read:all',
  'report:financial',
  'dashboard:executive',

  // Fraud, audit, support
  'fraud:read',
  'fraud:manage',
  'audit:read',
  /*
   * The auditor's own instruments.
   *
   * Both write, and both write only into the auditor's workpapers: a sample
   * records which transactions were drawn for examination, a report freezes
   * figures that were already readable and puts a name and a date on them.
   * Neither can change what a taxpayer owes, what an agent earned, or what a
   * receipt says -- the same test `case:*` has to pass to sit in a role that
   * exists to be read-only about the record.
   *
   * `audit:sign` is separate from `audit:report` because generating figures
   * and standing behind them are different acts, and PSIRS may well want them
   * to be different people.
   */
  'audit:sample',
  'audit:report',
  'audit:sign',
  /*
   * Taking a copy out of the platform.
   *
   * Separate from the permission that lets an officer read the same rows on
   * screen, because they are not the same act. A row on screen is governed by
   * everything around it -- the audit trail, the territory scope, the officer's
   * session; the same row in a spreadsheet on a laptop is governed by nothing
   * this platform can see. Every role that reads a report holds this today, so
   * nothing narrows on the day it ships; what it buys is the ability to take
   * it away from one role without taking their reports away, which was
   * impossible while the two were the same permission.
   */
  'data:export',
  'support:read:own',
  'support:read:all',
  'support:manage',

  // Incentives
  'incentive:read:all',
  'incentive:configure',

  /*
   * Casework.
   *
   * These write, and they write only the officer's own investigative record —
   * a case, its comments, its evidence, its assignment. Nothing here changes
   * what a taxpayer owes, what an agent earned, or what a receipt says. That
   * distinction is the reason the auditor holds all four of them and is still
   * read-only in the sense the role exists for; see `MUTATING_PERMISSIONS` and
   * `CASEWORK_PERMISSIONS` in `apps/portal/src/lib/permissions.ts`.
   *
   * `case:manage` is the authority over *any* case: reassign it, route it to
   * another department, escalate it, resolve it, close it. An officer who does
   * not hold it can still do all of that to a case they opened or a case
   * assigned to them, which is enforced in `services/cases.ts` rather than by
   * a permission, because "mine" is a fact about the row and not about the
   * role.
   */
  'case:read:all',
  'case:create',
  'case:contribute',
  'case:manage',

  /*
   * Revenue targets.
   *
   * `target:read:all` is held by every reporting role, because an achievement
   * percentage is meaningless to a finance officer who can see the actual and
   * not the target it is measured against — the §36 matrix gives Finance and
   * Audit sight of targets and not the setting of them.
   *
   * `target:manage` sets and withdraws. Planning revenue is the Service's own
   * decision about what it expects to raise, so it sits with the administrator
   * and the revenue officer and nowhere else. A finance officer who could
   * lower a target could make a shortfall disappear.
   */
  'target:read:all',
  'target:manage',

  /*
   * Financial periods.
   *
   * Closing a month freezes what the State says it collected in it, and
   * reopening one unfreezes a figure that has already been reported. They are
   * separate permissions on purpose: the officer who closes the books and the
   * officer who can unclose them being the same person removes most of what a
   * period lock is for. Finance closes; only an administrator reopens.
   *
   * `period:read` is held by every reporting role — an officer looking at a
   * March figure needs to know whether March is closed, and that is not a
   * privileged fact.
   */
  'period:read',
  'period:close',
  'period:reopen',

  // Approvals (maker-checker)
  'approval:request',
  'approval:review',
  'approval:authorise',

  // System
  'system:configure',
  'user:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * PRD §36 access matrix, expressed as code.
 *
 * Note what is absent as much as what is present. No role — including
 * `admin` — holds a permission to delete a financial record or to mark a
 * payment successful; there is no such permission to grant. Payment
 * success originates only from verified gateway confirmation (PRD §95).
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  agent: [
    'taxpayer:read:assigned',
    'taxpayer:create',
    'taxpayer:update',
    'group:register',
    'group:read:own',
    'allocation:collect',
    'catalogue:read',
    'assessment:create',
    'assessment:read:own',
    'invoice:create',
    'invoice:read:own',
    'payment:initiate',
    'payment:read:own',
    'receipt:read:own',
    'document:read:own',
    'vehicle:read:all',
    'vehicle:renew',
    'agent:read:own',
    'commission:read:own',
    'commission:payout:request',
    'report:read:own',
    'support:read:own',
    'approval:request',
  ],
  supervisor: [
    'taxpayer:read:assigned',
    'catalogue:read',
    'assessment:read:all',
    'invoice:read:all',
    'payment:read:all',
    'receipt:read:all',
    'document:read:all',
    'vehicle:read:all',
    'agent:read:assigned',
    'agent:assign_territory',
    'agent:suspend',
    'commission:read:all',
    'report:read:territory',
    'data:export',
    'fraud:read',
    'support:read:all',
    'support:manage',
    'approval:review',
    'approval:authorise',
    'case:read:all',
    'case:create',
    'case:contribute',
    'target:read:all',
    'period:read',
  ],
  revenue_officer: [
    'taxpayer:correct',
    'paye:file',
    'taxpayer:read:all',
    'taxpayer:tin_sync',
    'taxpayer:update',
    'taxpayer:obligation:waive',
    'group:read:all',
    'group:manage',
    'allocation:read:all',
    'allocation:manage',
    'catalogue:read',
    'catalogue:configure',
    'assessment:read:all',
    'invoice:read:all',
    'payment:read:all',
    'payment:reverse:request',
    'receipt:read:all',
    'document:read:all',
    'vehicle:read:all',
    'vehicle:authority_sync',
    'vehicle:manage',
    'agent:read:all',
    'agent:suspend',
    'commission:read:all',
    'report:read:all',
    'data:export',
    'dashboard:executive',
    'fraud:read',
    'fraud:manage',
    'audit:read',
    'support:read:all',
    'support:manage',
    'incentive:read:all',
    'approval:request',
    'approval:review',
    'case:read:all',
    'case:create',
    'case:contribute',
    'target:read:all',
    'target:manage',
    'period:read',
  ],
  finance_officer: [
    'taxpayer:read:all',
    'catalogue:read',
    'assessment:read:all',
    'invoice:read:all',
    'payment:read:all',
    'payment:reconcile',
    'payment:reverse:request',
    'payment:reverse:approve',
    'receipt:read:all',
    'document:read:all',
    'vehicle:read:all',
    'vehicle:authority_sync',
    'agent:read:all',
    'commission:read:all',
    'commission:manage',
    'commission:payout:approve',
    'report:read:all',
    'data:export',
    'report:financial',
    'dashboard:executive',
    'fraud:read',
    'audit:read',
    'approval:review',
    'approval:authorise',
    'case:read:all',
    'case:create',
    'case:contribute',
    'target:read:all',
    'period:read',
    'period:close',
  ],
  auditor: [
    'taxpayer:read:all',
    'catalogue:read',
    'assessment:read:all',
    'invoice:read:all',
    'payment:read:all',
    'receipt:read:all',
    'document:read:all',
    'vehicle:read:all',
    'agent:read:all',
    'commission:read:all',
    'report:read:all',
    'data:export',
    'report:financial',
    'fraud:read',
    'audit:read',
    'incentive:read:all',
    'support:read:all',
    /*
     * The auditor writes cases and nothing else.
     *
     * An auditor who cannot record what they found is not independent, they
     * are mute — the finding leaves the platform in an email and the
     * investigation has no file. `case:manage` is here because an audit case
     * is the auditor's own instrument: they decide what it is about, who is
     * asked for information, and when it is resolved.
     *
     * It does not cost the role its standing. None of these four can change a
     * taxpayer's liability, an agent's commission, a rate, a receipt, or a
     * reconciliation outcome. See the note above the casework block.
     */
    'case:read:all',
    'case:create',
    'case:contribute',
    'case:manage',
    'audit:sample',
    'audit:report',
    'audit:sign',
    'target:read:all',
    'period:read',
  ],
  admin: [
    'taxpayer:correct',
    'paye:file',
    'taxpayer:read:all',
    'taxpayer:tin_sync',
    'taxpayer:manage',
    'taxpayer:obligation:waive',
    'group:read:all',
    'group:manage',
    'allocation:read:all',
    'allocation:manage',
    'catalogue:read',
    'catalogue:configure',
    'assessment:read:all',
    'invoice:read:all',
    'payment:read:all',
    'receipt:read:all',
    'document:read:all',
    'vehicle:read:all',
    'vehicle:authority_sync',
    'vehicle:manage',
    'agent:read:all',
    'agent:manage',
    'agent:approve',
    'agent:suspend',
    'agent:assign_territory',
    'device:manage',
    'commission:read:all',
    'commission:manage',
    'report:read:all',
    'data:export',
    'dashboard:executive',
    'fraud:read',
    'fraud:manage',
    'audit:read',
    'support:read:all',
    'support:manage',
    'incentive:read:all',
    'incentive:configure',
    'approval:request',
    'system:configure',
    'user:manage',
    'case:read:all',
    'case:create',
    'case:contribute',
    'case:manage',
    'target:read:all',
    'target:manage',
    'period:read',
    'period:reopen',
  ],
};

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}

/**
 * Actions that require step-up authentication (PRD §35) — a fresh OTP within
 * the step-up window, regardless of how recently the user logged in.
 */
export const STEP_UP_ACTIONS = [
  'commission.payout.request',
  'agent.bank_account.change',
  'taxpayer.identity.change',
  'catalogue.rate.change',
  'payment.reversal.approve',
  'agent.suspend',
  'user.role.change',
  /*
   * Closing a month, and unclosing one.
   *
   * After a close the database itself refuses to write into the period, and
   * after a reopen it stops refusing — so both change what is possible rather
   * than merely what is recorded. That is the size of decision this list is
   * for.
   */
  'financial.period.close',
  'financial.period.reopen',
  /*
   * Putting a name to figures, and taking a report out of circulation.
   *
   * A signed audit report is read as settled by everyone downstream of it, and
   * the signature cannot be edited off the row afterwards -- migration 062
   * refuses that. Withdrawal is the other half of the same authority. Neither
   * should be one click from a session left open on a desk.
   */
  'audit.report.sign',
] as const;

export type StepUpAction = (typeof STEP_UP_ACTIONS)[number];
