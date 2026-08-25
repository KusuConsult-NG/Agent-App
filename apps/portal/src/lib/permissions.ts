/**
 * What this officer may see, and what they may do.
 *
 * The navigation table lives here rather than in `App.tsx` so it can be tested
 * without a DOM. What it encodes is worth guarding: two bugs of the same shape
 * have already been found in it — a link offered to a role whose screen then
 * answered 403 (reconciliation for an admin), and a screen hidden from the role
 * it was written for (performance for a supervisor). Both were invisible until
 * somebody signed in as that role and looked.
 *
 * Two suites cover it, and the division matters:
 *
 *   * `apps/api/src/tests/portal-navigation.test.ts` checks each gate against
 *     the permissions the route actually enforces, reading both this table and
 *     the route definitions from source so neither side can drift. It is the
 *     authority on gate-versus-endpoint, because only the API suite can see
 *     the routes.
 *   * `permissions.test.ts`, beside this file, pins the resulting menus per
 *     role, and the two properties with no home in the API suite: that the
 *     auditor holds nothing that mutates, and that a field agent is turned
 *     away at the door.
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
  /*
   * Added 25 August 2026. All six were treated as read-only by omission.
   *
   * `taxpayer:obligation:waive` is the serious one: it is the authority to
   * cancel obligations already on file, so it decides what a taxpayer stops
   * owing. `taxpayer:correct` amends the register. The group and allocation
   * pair register cooperatives, run distribution rounds, and record what was
   * handed out.
   *
   * No role was described wrongly at the time — the auditor holds none of them
   * — but `isReadOnly` is meant to be a property of the permission set, and it
   * was reading from a set that had six writes missing from it.
   */
  'taxpayer:correct',
  'taxpayer:obligation:waive',
  'group:register',
  'group:manage',
  'allocation:manage',
  'allocation:collect',
] as const;

/**
 * Every permission that only ever looks.
 *
 * Stated rather than derived as "whatever is not mutating", and that is the
 * whole point. The test guarding this pair used to build the read-only set by
 * subtracting the mutating one and then assert nothing fell outside both — a
 * condition that is false for every permission, so it could never fail. Six
 * writes had accumulated behind that guard, including
 * `taxpayer:obligation:waive`, which cancels obligations already on file: the
 * authority to forgive what somebody owes the State, counted as a read.
 *
 * With both lists stated, a new permission belongs to neither until somebody
 * puts it in one, and the test says so by name.
 */
export const READ_ONLY_PERMISSIONS = [
  'taxpayer:read:assigned',
  'taxpayer:read:all',
  'group:read:all',
  'group:read:own',
  'allocation:read:all',
  'catalogue:read',
  'assessment:read:own',
  'assessment:read:all',
  'invoice:read:own',
  'invoice:read:all',
  'payment:read:own',
  'payment:read:all',
  'receipt:read:own',
  'receipt:read:all',
  'document:read:own',
  'document:read:all',
  'vehicle:read:all',
  'agent:read:own',
  'agent:read:assigned',
  'agent:read:all',
  'commission:read:own',
  'commission:read:all',
  'report:read:own',
  'report:read:territory',
  'report:read:all',
  'report:financial',
  'dashboard:executive',
  'fraud:read',
  'audit:read',
  'support:read:own',
  'support:read:all',
  'incentive:read:all',
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

/**
 * One catalogue of screens, so a path and a label are defined once.
 *
 * The menus below arrange these; they do not redefine them. A screen that
 * changed its label in four places and not the fifth is the failure this
 * avoids.
 */
const SCREEN: Record<string, NavItem> = {
  home: { path: '/', label: 'Home', permission: ['report:read:all', 'report:read:territory'] },
  dashboard: {
    path: '/dashboard',
    label: 'Collections dashboard',
    permission: ['report:read:all', 'report:read:territory'],
  },
  intelligence: {
    path: '/intelligence',
    label: 'Revenue intelligence',
    permission: ['report:read:all', 'report:read:territory'],
  },
  revenue: {
    path: '/revenue',
    label: 'Revenue summary',
    permission: ['report:read:all', 'report:read:territory'],
  },
  transactions: { path: '/transactions', label: 'Transactions', permission: 'payment:read:all' },
  agents: { path: '/agents', label: 'Agents & clearance', permission: 'agent:read:all' },
  referees: { path: '/referees', label: 'Referees', permission: 'agent:read:all' },
  performance: {
    path: '/performance',
    label: 'Agent performance',
    permission: ['report:read:all', 'report:read:territory'],
  },
  reconciliation: { path: '/reconciliation', label: 'Reconciliation', permission: 'report:financial' },
  commissions: { path: '/commissions', label: 'Commissions', permission: 'commission:read:all' },
  approvals: { path: '/approvals', label: 'Approvals', permission: 'approval:review' },
  fraud: { path: '/fraud', label: 'Fraud & leakage', permission: 'fraud:read' },
  support: { path: '/support', label: 'Support desk', permission: 'support:read:all' },
  outstanding: { path: '/outstanding', label: 'Outstanding work', permission: 'payment:read:all' },
  audit: { path: '/audit', label: 'Audit log', permission: 'audit:read' },
  usage: { path: '/usage', label: 'Product usage', permission: 'report:read:all' },
  catalogue: { path: '/catalogue', label: 'Revenue catalogue', permission: 'catalogue:read' },
  programmes: { path: '/programmes', label: 'Social incentives', permission: 'incentive:read:all' },
  // group:manage, not group:read:all. Agents hold the read permission because
  // they register groups in the field; managing them is an officer's job.
  groups: { path: '/groups', label: 'Groups & cooperatives', permission: 'group:manage' },
  taxpayerRecords: {
    path: '/taxpayer-records',
    label: 'Taxpayer corrections',
    permission: 'taxpayer:correct',
  },
  users: { path: '/users', label: 'Officer access', permission: 'user:manage' },
  /*
   * `allocation:manage`, held by administrators and revenue officers only. A
   * finance officer settles money; they do not decide who gets fertiliser, and
   * offering them a screen the API would refuse is worse than not offering it.
   */
  allocations: {
    path: '/allocations',
    label: 'Distribution rounds',
    permission: 'allocation:manage',
  },
};

type NavGroup = { group: string; items: readonly NavItem[] };

/**
 * A menu per role, not one menu with things taken out.
 *
 * Filtering a common menu by permission gives every officer the same shape
 * with gaps in it — the same groups in the same order, headed "Overview",
 * "Agents", "Finance", "Oversight", "Configuration", whichever of those the
 * officer actually works in. A finance officer opened a menu that led with
 * agent clearance and an auditor opened one that led with collections.
 *
 * These are arranged around the job instead. The first group is what the role
 * does; the ones below are what it consults. The same screens appear in
 * several menus and that is correct — an auditor reads reconciliation and a
 * finance officer works it, and the difference is where it sits, not whether
 * it is there.
 *
 * Permissions still filter the result. The arrangement decides what to offer
 * and the permission decides what may be offered, so a menu can never promise
 * a screen the API would refuse.
 */
const NAV_BY_ROLE: Record<string, readonly NavGroup[]> = {
  admin: [
    {
      group: 'Administration',
      items: [SCREEN.home!, SCREEN.users!, SCREEN.agents!, SCREEN.referees!],
    },
    {
      group: 'Configuration',
      items: [SCREEN.catalogue!, SCREEN.programmes!, SCREEN.allocations!, SCREEN.groups!],
    },
    {
      group: 'Oversight',
      items: [SCREEN.audit!, SCREEN.usage!, SCREEN.support!, SCREEN.fraud!],
    },
    {
      group: 'Revenue',
      items: [SCREEN.dashboard!, SCREEN.revenue!, SCREEN.intelligence!, SCREEN.transactions!,
              SCREEN.performance!],
    },
  ],

  revenue_officer: [
    {
      group: 'The register',
      items: [SCREEN.home!, SCREEN.taxpayerRecords!, SCREEN.outstanding!, SCREEN.approvals!],
    },
    {
      group: 'Assessment',
      items: [SCREEN.catalogue!, SCREEN.transactions!],
    },
    {
      group: 'Revenue',
      items: [SCREEN.dashboard!, SCREEN.revenue!, SCREEN.intelligence!],
    },
    {
      group: 'Agents and programmes',
      items: [SCREEN.agents!, SCREEN.referees!, SCREEN.performance!, SCREEN.programmes!,
              SCREEN.allocations!, SCREEN.groups!],
    },
    {
      group: 'Oversight',
      items: [SCREEN.fraud!, SCREEN.support!, SCREEN.audit!, SCREEN.usage!],
    },
  ],

  finance_officer: [
    {
      group: 'Settlement',
      items: [SCREEN.home!, SCREEN.reconciliation!, SCREEN.commissions!, SCREEN.outstanding!,
              SCREEN.approvals!],
    },
    {
      group: 'Revenue',
      items: [SCREEN.dashboard!, SCREEN.revenue!, SCREEN.transactions!, SCREEN.intelligence!],
    },
    {
      group: 'Who collected it',
      items: [SCREEN.performance!, SCREEN.agents!, SCREEN.referees!],
    },
    {
      group: 'Oversight',
      items: [SCREEN.fraud!, SCREEN.audit!, SCREEN.usage!, SCREEN.catalogue!],
    },
  ],

  auditor: [
    {
      group: 'Examination',
      items: [SCREEN.home!, SCREEN.audit!, SCREEN.fraud!, SCREEN.transactions!],
    },
    {
      group: 'The money',
      items: [SCREEN.reconciliation!, SCREEN.commissions!, SCREEN.outstanding!],
    },
    {
      group: 'What was charged',
      items: [SCREEN.catalogue!, SCREEN.revenue!, SCREEN.dashboard!, SCREEN.intelligence!],
    },
    {
      group: 'Who did it',
      items: [SCREEN.agents!, SCREEN.referees!, SCREEN.performance!, SCREEN.usage!,
              SCREEN.support!, SCREEN.programmes!],
    },
  ],

  supervisor: [
    {
      group: 'My territory',
      items: [SCREEN.home!, SCREEN.performance!, SCREEN.approvals!, SCREEN.outstanding!],
    },
    {
      group: 'Revenue here',
      items: [SCREEN.revenue!, SCREEN.intelligence!, SCREEN.transactions!, SCREEN.commissions!],
    },
    {
      group: 'Oversight',
      items: [SCREEN.fraud!, SCREEN.support!, SCREEN.catalogue!],
    },
  ],
};

/**
 * Every screen, for a role with no arrangement of its own.
 *
 * A role added to the RBAC table and not to the menus above should still be
 * able to work — permission-filtered and ungrouped is a worse menu than a
 * designed one and a much better outcome than an empty portal.
 */
const NAV_FALLBACK: readonly NavGroup[] = [
  { group: 'Everything you may open', items: Object.values(SCREEN) },
];

export function navFor(role: string | undefined): readonly NavGroup[] {
  return (role && NAV_BY_ROLE[role]) || NAV_FALLBACK;
}

/** Kept for anything that wants the flat catalogue rather than an arrangement. */
export const NAV: readonly NavGroup[] = NAV_FALLBACK;

export function availableItems(user: Principal | null): NavItem[] {
  if (!user) return [];
  return navFor(user?.role).flatMap((group) => group.items).filter(
    (item) => !item.permission || can(user, item.permission),
  );
}

/** The nav groups this officer may open, with empty groups dropped. */
export function availableGroups(user: Principal | null): { group: string; items: NavItem[] }[] {
  if (!user) return [];
  return navFor(user.role).map((group) => ({
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
