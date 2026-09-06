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

import type { TranslationDictionary } from '@psirs/shared';

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
 * Every permission that changes the record.
 *
 * "The record" is what the platform holds about somebody else: what a taxpayer
 * owes, what an agent earned, what a rate is, what a receipt says, what
 * reconciliation concluded. Holding none of these is what makes a role
 * read-only in the sense an external reviewer cares about.
 *
 * It is not the same as "every permission that writes a row" — see
 * `CASEWORK_PERMISSIONS` below, which write and do not belong here. Every
 * permission is in exactly one of the three lists, and a test says so by name.
 *
 * Kept as a list rather than derived by pattern-matching the name, because
 * `payment:reconcile` and `taxpayer:tin_sync` do not look like writes and are,
 * while `report:financial` looks like it might be and is not.
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
  'vehicle:manage',
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
  /*
   * Setting a revenue target is a decision about what the State expects to
   * raise, and it changes how every collection figure below it is judged. It
   * belongs with the writes rather than with casework: a target quietly lowered
   * makes a shortfall disappear from every screen that reports against it,
   * which is a change to the record in the sense that matters.
   */
  'target:manage',
  /*
   * Closing a month freezes what the State says it collected in it; reopening
   * one unfreezes a figure that has already been reported to the
   * Accountant-General. Both change the record in the strongest sense the word
   * has here — after a close, the database itself refuses to write into the
   * month, and after a reopen it stops refusing.
   */
  'period:close',
  'period:reopen',
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
  /*
   * Exporting is here, and it is the least comfortable member of the list.
   *
   * It changes nothing about the record, which is the test this class applies,
   * and an auditor who cannot take a copy of what they examined cannot produce
   * a working paper. But it is not the same as reading: a row on screen is
   * governed by the session, the territory scope and the audit trail, and the
   * same row in a spreadsheet on somebody's laptop is governed by nothing this
   * platform can see.
   *
   * What makes it safe to file as a read is that it is not free. `data:export`
   * is its own permission, so it can be taken away from a role without taking
   * their reports away; every export is capped by role and written to the
   * audit log with the filters and the row count. Those are the controls doing
   * the work -- not this classification, which only says the record is
   * unchanged.
   */
  'data:export',
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
  'case:read:all',
  'target:read:all',
  'period:read',
] as const;

/**
 * Every permission that writes only the officer's own investigative record.
 *
 * A third class, and it exists because of the auditor.
 *
 * The brief this was built to asks that auditors open cases, assign them, take
 * evidence and record findings. That is writing. It is also the opposite of
 * what `MUTATING_PERMISSIONS` is about: none of it changes what a taxpayer
 * owes, what an agent earned, what a rate is, or what a receipt says. An
 * auditor who cannot write a case down is not read-only, they are mute — the
 * finding leaves in an email and the investigation has no file.
 *
 * So the honest statement is not "the auditor writes nothing" but "the auditor
 * writes nothing except the audit". Splitting the list is how that gets said
 * in a form a test can check, instead of quietly filing four writes under
 * reads and letting the read-only marker mean less than it did.
 *
 * The line to hold when classifying a future permission: if an outside party's
 * money, liability or standing changes because of it, it is mutating, however
 * investigative it sounds. `fraud:manage` closes a flag against an agent and is
 * mutating for exactly that reason.
 */
export const CASEWORK_PERMISSIONS = [
  'case:create',
  'case:contribute',
  'case:manage',
  /*
   * The workbench is in this class for the same reason casework is.
   *
   * Drawing a sample writes down which transactions an auditor examined;
   * generating a report freezes figures that were already readable and signing
   * one puts a name on them. Not one of the three changes what a taxpayer
   * owes, what an agent earned, or what a receipt says -- which is the line
   * stated above, applied.
   *
   * `audit:sign` is the closest call, because a signature carries weight
   * outside the audit file. It stays here: what it commits is the auditor's
   * own opinion, and an examiner who cannot sign their own report has not been
   * kept independent, only kept quiet.
   */
  'audit:sample',
  'audit:report',
  'audit:sign',
] as const;

/**
 * True when this officer cannot change the record, anywhere in the portal.
 *
 * Today that is exactly the auditor. Stated as a property of the permission set
 * rather than a check for `role === 'auditor'`, so a role that is later granted
 * a mutating permission stops being described as read-only automatically.
 *
 * Casework is deliberately not counted; see `CASEWORK_PERMISSIONS`. What the
 * portal shows a read-only officer is not "you may click nothing" — it is that
 * nothing they do alters the revenue record, which is the property the role
 * exists to have.
 */
export function isReadOnly(user: Principal | null): boolean {
  return !!user && !can(user, MUTATING_PERMISSIONS);
}

export interface NavItem {
  path: string;
  /**
   * A dictionary key, not a label.
   *
   * This catalogue is module-level and cannot reach a hook, so the menu
   * resolves `t[label]` where it renders. Typing it as `keyof
   * TranslationDictionary` is what stops a screen being added with an English
   * label that no dictionary and no reviewer could reach.
   */
  label: keyof TranslationDictionary;
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
  home: { path: '/', label: 'home', permission: ['report:read:all', 'report:read:territory'] },
  /*
   * The two screens that are the same for every role, and first for all of
   * them.
   *
   * `myWork` is what is waiting for this officer; `cases` is the queue it is
   * drawn from. Both are gated on `case:read:all`, which all five portal roles
   * hold — a case is how work crosses a department, and a department that
   * could not see the queue could not be sent anything.
   */
  myWork: { path: '/my-work', label: 'ofcNavMyWork', permission: 'case:read:all' },
  cases: { path: '/cases', label: 'ofcNavCases', permission: 'case:read:all' },
  /*
   * Targets and the forecast beside them.
   *
   * `target:read:all`, which every reporting role holds: an achievement
   * percentage is meaningless to a finance officer who can see the actual and
   * not the number it is measured against. Setting one is `target:manage` and
   * is gated inside the screen.
   */
  targets: { path: '/targets', label: 'ofcNavTargets', permission: 'target:read:all' },
  /*
   * The register as a population.
   *
   * `taxpayer:read:all` rather than a reporting permission: these are cohorts
   * of real people and the counts are drawn from the register itself, so the
   * gate is the one that opens the register.
   */
  taxpayerBase: {
    path: '/taxpayer-base',
    label: 'ofcNavTaxpayerAnalytics',
    permission: 'taxpayer:read:all',
  },
  dashboard: {
    path: '/dashboard',
    label: 'ofcNavDashboard',
    permission: ['report:read:all', 'report:read:territory'],
  },
  intelligence: {
    path: '/intelligence',
    label: 'ofcNavIntelligence',
    permission: ['report:read:all', 'report:read:territory'],
  },
  revenue: {
    path: '/revenue',
    label: 'ofcNavRevenue',
    permission: ['report:read:all', 'report:read:territory'],
  },
  /*
   * The levy view of the same money the revenue summary reports by place.
   *
   * Gated on the reporting permissions rather than on `taxpayer:read:all`,
   * because the collections half is the part every reporting role needs and
   * the taxpayer list below it is fetched only by officers who hold the
   * permission for it. An auditor is offered this and sees the money and the
   * arrears, which is their job.
   */
  levies: {
    path: '/levies',
    label: 'ofcNavLevies',
    permission: ['report:read:all', 'report:read:territory'],
  },
  transactions: { path: '/transactions', label: 'ofcNavTransactions', permission: 'payment:read:all' },
  agents: { path: '/agents', label: 'ofcNavAgents', permission: 'agent:read:all' },
  referees: { path: '/referees', label: 'ofcNavReferees', permission: 'agent:read:all' },
  performance: {
    path: '/performance',
    label: 'ofcNavPerformance',
    permission: ['report:read:all', 'report:read:territory'],
  },
  reconciliation: { path: '/reconciliation', label: 'ofcNavReconciliation', permission: 'report:financial' },
  /*
   * The period lock, readable by every reporting role.
   *
   * An officer looking at a March figure needs to know whether March can still
   * move, and that is not a privileged fact. Closing is `period:close` and
   * reopening `period:reopen`, both gated inside the screen and again on the
   * API.
   */
  periods: { path: '/periods', label: 'ofcNavPeriods', permission: 'period:read' },
  commissions: { path: '/commissions', label: 'ofcNavCommissions', permission: 'commission:read:all' },
  approvals: { path: '/approvals', label: 'ofcNavApprovals', permission: 'approval:review' },
  fraud: { path: '/fraud', label: 'ofcNavFraud', permission: 'fraud:read' },
  support: { path: '/support', label: 'ofcNavSupport', permission: 'support:read:all' },
  outstanding: { path: '/outstanding', label: 'ofcNavOutstanding', permission: 'payment:read:all' },
  audit: { path: '/audit', label: 'ofcNavAudit', permission: 'audit:read' },
  /*
   * The workbench sits behind `audit:sample`, not `audit:read`.
   *
   * Every officer with `audit:read` can read the log; drawing a sample and
   * signing a report are the examiner's own work, and offering the screen to
   * everybody who can read an audit trail would put a "draw a sample" button
   * in front of officers whose every click on it would 403.
   */
  workbench: { path: '/workbench', label: 'ofcNavWorkbench', permission: 'audit:sample' },
  /*
   * No permission, deliberately.
   *
   * The answer is about the officer asking. Gating it would mean an officer
   * whose role somebody narrowed could no longer see that their old laptop is
   * still signed in -- which is exactly the officer most likely to need to
   * look. `permission` is optional on a `NavItem` for exactly this: a screen
   * every authenticated officer may open.
   */
  myAccess: { path: '/my-access', label: 'ofcNavMyAccess' },
  // Same reasoning: reading what you were told is not a privilege.
  inbox: { path: '/inbox', label: 'ofcNavInbox' },
  usage: { path: '/usage', label: 'ofcNavUsage', permission: 'report:read:all' },
  catalogue: { path: '/catalogue', label: 'ofcNavCatalogue', permission: 'catalogue:read' },
  programmes: { path: '/programmes', label: 'ofcNavProgrammes', permission: 'incentive:read:all' },
  // group:manage, not group:read:all. Agents hold the read permission because
  // they register groups in the field; managing them is an officer's job.
  groups: { path: '/groups', label: 'ofcNavGroups', permission: 'group:manage' },
  taxpayerRecords: {
    path: '/taxpayer-records',
    label: 'ofcNavTaxpayerRecords',
    permission: 'taxpayer:correct',
  },
  users: { path: '/users', label: 'ofcNavUsers', permission: 'user:manage' },
  /*
   * The delegation of authority itself, which is data now.
   *
   * `user:manage` — the same permission that already governs who holds which
   * role. Who may do what is not something every officer needs to browse.
   */
  roles: { path: '/roles', label: 'ofcNavRoles', permission: 'user:manage' },
  /*
   * The structure, readable by every portal role and by nobody else.
   *
   * `case:read:all` is held by exactly those five and by no field agent, which
   * is the boundary that matters here. Not the reporting pair: a route that
   * accepts `report:read:territory` promises to narrow its answer to the
   * caller's territories, and an organisation chart is not territory data —
   * see the note on the endpoint. Creating or closing a department is
   * `user:manage`, gated inside the screen.
   */
  organisation: {
    path: '/organisation',
    label: 'ofcNavOrganisation',
    permission: 'case:read:all',
  },
  /*
   * `system:configure`, held by administrators alone. Raising the minimum app
   * version stops every agent still on an older build from collecting; that is
   * a different size of decision from suspending one agent, and it is not on a
   * revenue officer's menu.
   */
  fieldApp: { path: '/field-app', label: 'ofcNavFieldApp', permission: 'system:configure' },
  /*
   * `allocation:manage`, held by administrators and revenue officers only. A
   * finance officer settles money; they do not decide who gets fertiliser, and
   * offering them a screen the API would refuse is worse than not offering it.
   */
  allocations: {
    path: '/allocations',
    label: 'ofcNavAllocations',
    permission: 'allocation:manage',
  },
};

type NavGroup = { group: keyof TranslationDictionary; items: readonly NavItem[] };

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
      group: 'ofcGroupYourDesk',
      items: [SCREEN.myWork!, SCREEN.inbox!, SCREEN.cases!, SCREEN.myAccess!],
    },
    {
      group: 'ofcGroupAdministration',
      items: [SCREEN.home!, SCREEN.users!, SCREEN.roles!, SCREEN.organisation!,
              SCREEN.agents!, SCREEN.referees!],
    },
    {
      group: 'ofcGroupConfiguration',
      items: [SCREEN.catalogue!, SCREEN.programmes!, SCREEN.allocations!, SCREEN.groups!,
              SCREEN.fieldApp!],
    },
    {
      group: 'ofcGroupOversight',
      items: [SCREEN.audit!, SCREEN.usage!, SCREEN.support!, SCREEN.fraud!, SCREEN.periods!],
    },
    {
      group: 'ofcGroupRevenue',
      items: [SCREEN.dashboard!, SCREEN.revenue!, SCREEN.targets!, SCREEN.levies!,
              SCREEN.intelligence!, SCREEN.taxpayerBase!, SCREEN.transactions!,
              SCREEN.performance!],
    },
  ],

  revenue_officer: [
    {
      group: 'ofcGroupYourDesk',
      items: [SCREEN.myWork!, SCREEN.inbox!, SCREEN.cases!, SCREEN.myAccess!],
    },
    {
      group: 'ofcGroupTheRegister',
      items: [SCREEN.home!, SCREEN.taxpayerRecords!, SCREEN.taxpayerBase!,
              SCREEN.outstanding!, SCREEN.approvals!],
    },
    {
      group: 'ofcGroupAssessment',
      items: [SCREEN.catalogue!, SCREEN.levies!, SCREEN.transactions!],
    },
    {
      group: 'ofcGroupRevenue',
      items: [SCREEN.dashboard!, SCREEN.revenue!, SCREEN.targets!, SCREEN.intelligence!],
    },
    {
      group: 'ofcGroupAgentsProgrammes',
      items: [SCREEN.agents!, SCREEN.referees!, SCREEN.performance!, SCREEN.programmes!,
              SCREEN.allocations!, SCREEN.groups!],
    },
    {
      group: 'ofcGroupOversight',
      items: [SCREEN.fraud!, SCREEN.support!, SCREEN.audit!, SCREEN.usage!],
    },
  ],

  finance_officer: [
    {
      group: 'ofcGroupYourDesk',
      items: [SCREEN.myWork!, SCREEN.inbox!, SCREEN.cases!, SCREEN.myAccess!],
    },
    {
      group: 'ofcGroupSettlement',
      items: [SCREEN.home!, SCREEN.reconciliation!, SCREEN.periods!, SCREEN.commissions!,
              SCREEN.outstanding!, SCREEN.approvals!],
    },
    {
      group: 'ofcGroupRevenue',
      items: [SCREEN.dashboard!, SCREEN.revenue!, SCREEN.targets!, SCREEN.levies!,
              SCREEN.transactions!, SCREEN.intelligence!],
    },
    {
      group: 'ofcGroupWhoCollected',
      items: [SCREEN.performance!, SCREEN.agents!, SCREEN.referees!],
    },
    {
      group: 'ofcGroupOversight',
      items: [SCREEN.fraud!, SCREEN.audit!, SCREEN.usage!, SCREEN.catalogue!],
    },
  ],

  auditor: [
    {
      group: 'ofcGroupYourDesk',
      items: [SCREEN.myWork!, SCREEN.inbox!, SCREEN.cases!, SCREEN.myAccess!],
    },
    {
      group: 'ofcGroupExamination',
      items: [SCREEN.home!, SCREEN.audit!, SCREEN.workbench!, SCREEN.fraud!,
              SCREEN.transactions!],
    },
    {
      group: 'ofcGroupTheMoney',
      items: [SCREEN.reconciliation!, SCREEN.commissions!, SCREEN.periods!,
              SCREEN.outstanding!],
    },
    {
      group: 'ofcGroupWhatCharged',
      items: [SCREEN.catalogue!, SCREEN.levies!, SCREEN.revenue!, SCREEN.targets!,
              SCREEN.dashboard!, SCREEN.intelligence!, SCREEN.taxpayerBase!],
    },
    {
      group: 'ofcGroupWhoDidIt',
      items: [SCREEN.agents!, SCREEN.referees!, SCREEN.performance!, SCREEN.usage!,
              SCREEN.support!, SCREEN.programmes!],
    },
  ],

  supervisor: [
    {
      group: 'ofcGroupYourDesk',
      items: [SCREEN.myWork!, SCREEN.inbox!, SCREEN.cases!, SCREEN.myAccess!],
    },
    {
      group: 'ofcGroupMyTerritory',
      items: [SCREEN.home!, SCREEN.performance!, SCREEN.approvals!, SCREEN.outstanding!],
    },
    {
      group: 'ofcGroupRevenueHere',
      items: [SCREEN.revenue!, SCREEN.targets!, SCREEN.levies!, SCREEN.intelligence!,
              SCREEN.transactions!, SCREEN.commissions!],
    },
    {
      group: 'ofcGroupOversight',
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
  {
    group: 'ofcGroupEverything',
    /*
     * Everything except the screens that open on authentication alone.
     *
     * The filter below drops an item whose permission the role does not hold,
     * which is what makes a fallback menu safe. A screen with no permission
     * survives that filter for *every* role -- including the field agent, who
     * has no menu here because they belong in the agent application and are
     * turned away at the door. Offering them "where I am signed in", a screen
     * about officer machines they will never have, is the one way this list
     * can be wrong.
     *
     * A role PSIRS creates therefore reaches these screens by their path and
     * not from this menu, until somebody arranges a menu for it. That is the
     * cost, and it is smaller than the alternative.
     */
    items: Object.values(SCREEN).filter((item) => item.permission !== undefined),
  },
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
export function availableGroups(
  user: Principal | null,
): { group: keyof TranslationDictionary; items: NavItem[] }[] {
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
  const items = availableItems(user);
  /*
   * The role home when they can open it, not simply the first menu item.
   *
   * The menus now open with "Your desk" — my work, and the case queue it is
   * drawn from — which is the right first *group* and the wrong first *screen*.
   * `/` is the briefing an officer wants on arriving: what the platform is
   * waiting on, in their own terms. My work is what is waiting on them
   * personally, and it is one click away at the top of the menu.
   *
   * Taking the first item would have moved every role's landing page as a side
   * effect of adding a menu group, which is the kind of change nobody decides
   * and everybody notices.
   */
  return items.find((item) => item.path === '/')?.path ?? items[0]?.path ?? null;
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
