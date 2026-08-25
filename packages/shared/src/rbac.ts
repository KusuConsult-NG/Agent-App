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
  'support:read:own',
  'support:read:all',
  'support:manage',

  // Incentives
  'incentive:read:all',
  'incentive:configure',

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
    'fraud:read',
    'support:read:all',
    'support:manage',
    'approval:review',
    'approval:authorise',
  ],
  revenue_officer: [
    'taxpayer:correct',
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
    'agent:read:all',
    'agent:suspend',
    'commission:read:all',
    'report:read:all',
    'dashboard:executive',
    'fraud:read',
    'fraud:manage',
    'audit:read',
    'support:read:all',
    'support:manage',
    'incentive:read:all',
    'approval:request',
    'approval:review',
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
    'report:financial',
    'dashboard:executive',
    'fraud:read',
    'audit:read',
    'approval:review',
    'approval:authorise',
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
    'report:financial',
    'fraud:read',
    'audit:read',
    'incentive:read:all',
    'support:read:all',
  ],
  admin: [
    'taxpayer:correct',
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
    'agent:read:all',
    'agent:manage',
    'agent:approve',
    'agent:suspend',
    'agent:assign_territory',
    'device:manage',
    'commission:read:all',
    'commission:manage',
    'report:read:all',
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
] as const;

export type StepUpAction = (typeof STEP_UP_ACTIONS)[number];
