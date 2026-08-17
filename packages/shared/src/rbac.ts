/**
 * Roles and permissions (PRD §7, §36).
 *
 * The permission set is deliberately verb:resource shaped and exhaustive:
 * a route that needs authorisation names a permission, never a role. That
 * keeps §36's access matrix a single source of truth instead of a table in
 * a document that drifts from the code.
 */

export const ROLES = [
  'taxpayer',
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
  'taxpayer:read:own',
  'taxpayer:read:assigned',
  'taxpayer:read:all',
  'taxpayer:create',
  'taxpayer:update',
  'taxpayer:manage',

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
  'vehicle:read:own',
  'vehicle:read:all',
  'vehicle:renew',

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
  'incentive:read:own',
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
  taxpayer: [
    'taxpayer:read:own',
    'catalogue:read',
    'assessment:create',
    'assessment:read:own',
    'invoice:create',
    'invoice:read:own',
    'payment:initiate',
    'payment:read:own',
    'receipt:read:own',
    'document:read:own',
    'vehicle:read:own',
    'vehicle:renew',
    'report:read:own',
    'incentive:read:own',
    'support:read:own',
  ],
  agent: [
    'taxpayer:read:assigned',
    'taxpayer:create',
    'taxpayer:update',
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
    'taxpayer:read:all',
    'taxpayer:update',
    'catalogue:read',
    'catalogue:configure',
    'assessment:read:all',
    'invoice:read:all',
    'payment:read:all',
    'payment:reverse:request',
    'receipt:read:all',
    'document:read:all',
    'vehicle:read:all',
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
    'taxpayer:read:all',
    'taxpayer:manage',
    'catalogue:read',
    'catalogue:configure',
    'assessment:read:all',
    'invoice:read:all',
    'payment:read:all',
    'receipt:read:all',
    'document:read:all',
    'vehicle:read:all',
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
