/**
 * What this officer may see, and what they may do.
 *
 * The navigation table lives here rather than in `App.tsx` so it can be tested
 * without a DOM. That matters because of what the table encodes: two bugs of
 * the same shape have already been found in it — a link offered to a role whose
 * screen then answered 403 (reconciliation for an admin), and a screen hidden
 * from the role it was written for (performance for a supervisor). Both were
 * invisible until somebody signed in as that role and looked. `permissions.test.ts`
 * now checks every gate against the permission the screen's own endpoint
 * requires, so the next one fails a test instead.
 *
 * WHY THE BACK-OFFICE MENUS RESEMBLE EACH OTHER
 *
 * Eleven of the fifteen items are common to revenue_officer, finance_officer,
 * auditor and admin, and that is mostly deliberate. These are oversight and
 * administration roles; they are all supposed to be able to *see* the whole
 * revenue picture. What separates them is what they may change, and that is
 * enforced inside each screen — every mutating control is already wrapped in
 * `can()`.
 *
 * The gap was that a role could not tell. An auditor holds no mutating
 * permission at all, which is the entire point of the role, and the portal gave
 * them no indication of it: same shell, same screens, controls simply absent
 * with nothing saying why. A government auditor's read-only standing is part of
 * the control environment and an external reviewer should be able to observe
 * it, not infer it from an absence. `isReadOnly` exists for that.
 *
 * Hiding a link or a control is a convenience. The API is the control.
 */

export interface Principal {
  role: string;
  permissions: readonly string[];
}

/**
 * Does this officer hold the permission — or, given several, any of them?
 *
 * "Any of them" rather than "all of them" because that is what
 * `requirePermission` does on the API side. Modelling it differently here would
 * hide a control the server would have allowed.
 *
 * `lib/api.can()` is the same test against the current session, and is what
 * screens use. This form takes the principal explicitly so the nav can be
 * evaluated for any role in a test.
 */
export function can(user: Principal | null, permission: string | readonly string[]): boolean {
  if (!user) return false;
  const wanted = typeof permission === 'string' ? [permission] : permission;
  return wanted.some((name) => user.permissions.includes(name));
}

/**
 * Every permission in the system that changes something.
 *
 * Kept as a list rather than derived by pattern-matching the name, because
 * `payment:reconcile` and `taxpayer:tin_sync` do not look like writes and are,
 * while `report:financial` looks like it might be and is not. A test asserts
 * this stays exhaustive against the shared permission list, so a new permission
 * has to be classified rather than silently counted as read-only.
 */
export const MUTATING_PERMISSIONS = [
  'taxpayer:create',
  'taxpayer:update',
  'taxpayer:manage',
  'taxpayer:tin_sync',
  'catalogue:configure',
  'assessment:create',
  'invoice:create',
  'payment:initiate',
  'payment:reconcile',
  'payment:reverse:request',
  'payment:reverse:approve',
  'vehicle:renew',
  'vehicle:authority_sync',
  'agent:manage',
  'agent:approve',
  'agent:suspend',
  'agent:assign_territory',
  'device:manage',
  'commission:manage',
  'commission:payout:request',
  'commission:payout:approve',
  'fraud:manage',
  'support:manage',
  'incentive:configure',
  'approval:request',
  'approval:review',
  'approval:authorise',
  'system:configure',
  'user:manage',
] as const;

/**
 * True when this officer cannot change anything, anywhere in the portal.
 *
 * Today that is exactly the auditor. Stated as a property of the permission set
 * rather than a check for `role === 'auditor'`, so a role that is later granted
 * a mutating permission stops being described as read-only automatically.
 */
export function isReadOnly(user: Principal | null): boolean {
  return !!user && !can(user, MUTATING_PERMISSIONS);
}

export interface NavItem {
  path: string;
  label: string;
  /**
   * The permission that opens this item, or any one of several.
   *
   * `requirePermission` on the API grants when the role holds *any* of the
   * permissions it names, and the menu has to model the same thing or it
   * cannot describe a screen like agent performance — which the API opens to
   * report:read:all or report:read:territory, and no single one of those is
   * held by every role that should see it.
   */
  permission?: string | readonly string[];
}

export const NAV: readonly { group: string; items: readonly NavItem[] }[] = [
  {
    group: 'Overview',
    items: [
      { path: '/', label: 'Dashboard', permission: 'report:read:all' },
      { path: '/intelligence', label: 'Revenue intelligence', permission: 'report:read:all' },
      { path: '/transactions', label: 'Transactions', permission: 'payment:read:all' },
    ],
  },
  {
    group: 'Agents',
    items: [
      { path: '/agents', label: 'Agents & clearance', permission: 'agent:read:all' },
      { path: '/referees', label: 'Referees', permission: 'agent:read:all' },
      // Either report permission, matching what GET /agents/performance
      // accepts. A supervisor holds only report:read:territory and is the
      // role this screen is most for, so gating on report:read:all alone
      // would hide it from them.
      {
        path: '/performance',
        label: 'Agent performance',
        permission: ['report:read:all', 'report:read:territory'],
      },
    ],
  },
  {
    group: 'Finance',
    items: [
      // report:financial, not payment:read:all. The screen is the settlement
      // dashboard, and GET /government/settlements requires report:financial or
      // payment:reconcile — neither of which an admin holds, because settlement
      // figures are a finance and audit responsibility rather than an
      // administrative one. Gating on the wider permission put the item in the
      // admin's menu and then answered a 403 when they opened it.
      { path: '/reconciliation', label: 'Reconciliation', permission: 'report:financial' },
      { path: '/commissions', label: 'Commissions', permission: 'commission:read:all' },
      { path: '/approvals', label: 'Approvals', permission: 'approval:review' },
    ],
  },
  {
    group: 'Oversight',
    items: [
      { path: '/fraud', label: 'Fraud & leakage', permission: 'fraud:read' },
      // support:read:all, not support:manage. An auditor holds the first and
      // not the second, and reading the support queue is exactly the kind of
      // thing an auditor is for — the screen hides the reply and status
      // controls from anyone who cannot use them.
      { path: '/support', label: 'Support desk', permission: 'support:read:all' },
      // payment:read:all, which every portal role holds, because the refund
      // queue is the part of this screen everyone should be able to see. The
      // TIN and vehicle-authority queues are guarded separately and the screen
      // shows only the sections the officer may read, rather than the page
      // answering 403 for whoever holds two of the three permissions.
      { path: '/outstanding', label: 'Outstanding work', permission: 'payment:read:all' },
      { path: '/audit', label: 'Audit log', permission: 'audit:read' },
    ],
  },
  {
    group: 'Configuration',
    items: [
      { path: '/catalogue', label: 'Revenue catalogue', permission: 'catalogue:read' },
      { path: '/programmes', label: 'Social incentives', permission: 'incentive:read:all' },
    ],
  },
];

/** The nav items this officer may open, in menu order. */
export function availableItems(user: Principal | null): NavItem[] {
  if (!user) return [];
  return NAV.flatMap((group) => group.items).filter(
    (item) => !item.permission || can(user, item.permission),
  );
}

/** The nav groups this officer may open, with empty groups dropped. */
export function availableGroups(user: Principal | null): { group: string; items: NavItem[] }[] {
  if (!user) return [];
  return NAV.map((group) => ({
    group: group.group,
    items: group.items.filter((item) => !item.permission || can(user, item.permission)),
  })).filter((group) => group.items.length > 0);
}

/**
 * Where this officer lands after signing in.
 *
 * '/' renders the executive dashboard, which needs report:read:all. A
 * supervisor does not hold it, so signing in put them on "Your role
 * (supervisor) is not permitted to perform this action" — their first and only
 * impression of the portal, on a screen the menu had already decided not to
 * offer them.
 *
 * The menu is the authority on what a role may open, so the landing page comes
 * from the same filter rather than being assumed.
 */
export function landingPath(user: Principal | null): string | null {
  return availableItems(user)[0]?.path ?? null;
}

/**
 * Roles that belong in this portal at all.
 *
 * A field agent holds `catalogue:read` and almost nothing else a government
 * screen is gated on, so signing in here gave them a shell with one item in it
 * — the revenue catalogue — and no way to do their job. Their tools are the
 * agent PWA: offline capture, assessment, collection, their own commission.
 *
 * Turning them away at the door with somewhere to go is kinder than a working
 * session that contains nothing, and it is not a security boundary: every
 * screen behind it is permission-gated on the API regardless of which
 * application the request came from.
 */
export const PORTAL_ROLES = [
  'supervisor',
  'revenue_officer',
  'finance_officer',
  'auditor',
  'admin',
] as const;

export function belongsInPortal(role: string): boolean {
  return (PORTAL_ROLES as readonly string[]).includes(role);
}
