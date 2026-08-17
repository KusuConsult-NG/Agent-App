/**
 * Agent trust model (PRD Addendum §2, §5, §13, §31, §40, §50).
 *
 * The addendum's central instruction is that an agent's lifecycle must not
 * be driven by one generic `status` column (§31). It is therefore modelled
 * as six *independent* status axes plus one derived application state:
 *
 *   account_status      — can this person sign in at all?
 *   kyc_status          — has their identity been verified?
 *   referee_status      — has an independent person vouched for them?
 *   training_status     — have they completed mandatory training?
 *   clearance_status    — has government reviewed and approved them?
 *   operational_status  — may they transact right now?
 *
 * `deriveApplicationState` is the single function that folds those axes into
 * the §40 progression. Nothing writes the application state directly; it is
 * always recomputed from the axes, so the state shown to an applicant
 * (§27) can never disagree with the gate that actually guards collection.
 */

export const ACCOUNT_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** §5 — agent identity verification states. */
export const KYC_STATUSES = [
  'NOT_STARTED',
  'SUBMITTED',
  'UNDER_REVIEW',
  'VERIFICATION_REQUIRED',
  'FAILED',
  'CLEARED',
  'SUSPENDED',
] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

/** §13 — referee clearance states, tracked separately from the agent's own KYC. */
export const REFEREE_STATUSES = [
  'INVITED',
  'ACCEPTED',
  'SUBMITTED',
  'UNDER_REVIEW',
  'CLEARED',
  'FAILED',
  'REJECTED',
  'EXPIRED',
  'REPLACED',
] as const;
export type RefereeStatus = (typeof REFEREE_STATUSES)[number];

/** Roll-up of an agent's referee set: cleared only if a cleared referee exists. */
export const AGENT_REFEREE_STATUSES = ['PENDING', 'CLEARED', 'FAILED'] as const;
export type AgentRefereeStatus = (typeof AGENT_REFEREE_STATUSES)[number];

export const TRAINING_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED'] as const;
export type TrainingStatus = (typeof TRAINING_STATUSES)[number];

export const CLEARANCE_STATUSES = [
  'PENDING',
  'READY_FOR_REVIEW',
  'APPROVED',
  'REJECTED',
  'ACTION_REQUIRED',
] as const;
export type ClearanceStatus = (typeof CLEARANCE_STATUSES)[number];

export const OPERATIONAL_STATUSES = ['INACTIVE', 'ACTIVE', 'SUSPENDED'] as const;
export type OperationalStatus = (typeof OPERATIONAL_STATUSES)[number];

/** §40 — the progression a government reviewer and the applicant both see. */
export const APPLICATION_STATES = [
  'APPLICATION_STARTED',
  'APPLICATION_SUBMITTED',
  'KYC_PENDING',
  'KYC_CLEARED',
  'REFEREE_PENDING',
  'REFEREE_CLEARED',
  'READY_FOR_REVIEW',
  'GOVERNMENT_APPROVED',
  'TRAINING_COMPLETED',
  'BANK_VERIFIED',
  'DEVICE_REGISTERED',
  'ACTIVE',
  'ACTION_REQUIRED',
  'REJECTED',
  'SUSPENDED',
] as const;
export type ApplicationState = (typeof APPLICATION_STATES)[number];

export const DEVICE_STATUSES = ['PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'REVOKED'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

/** §26 — progressive access stages. Each stage strictly contains the last. */
export const ACCESS_STAGES = ['APPLICANT', 'KYC_CLEARED', 'APPROVED', 'ACTIVE'] as const;
export type AccessStage = (typeof ACCESS_STAGES)[number];

/**
 * The clearance checklist of §16/§38. Every box must be ticked before an
 * agent may be activated, and each is owned by a different actor — which is
 * precisely why activation cannot be a single button.
 */
export interface AgentClearanceFlags {
  kycCleared: boolean;
  refereeCleared: boolean;
  trainingCompleted: boolean;
  bankVerified: boolean;
  agreementAccepted: boolean;
  deviceRegistered: boolean;
  governmentApproved: boolean;
}

export interface AgentStatusAxes {
  accountStatus: AccountStatus;
  kycStatus: KycStatus;
  refereeStatus: AgentRefereeStatus;
  trainingStatus: TrainingStatus;
  clearanceStatus: ClearanceStatus;
  operationalStatus: OperationalStatus;
  applicationSubmitted: boolean;
  flags: AgentClearanceFlags;
}

/**
 * Fold the status axes into the §40 application state.
 *
 * Order matters: terminal and adverse outcomes are tested before progress,
 * so an agent whose KYC later fails cannot keep a flattering state derived
 * from a checklist item that is still ticked.
 */
export function deriveApplicationState(axes: AgentStatusAxes): ApplicationState {
  const { flags } = axes;

  if (axes.accountStatus === 'CLOSED' || axes.clearanceStatus === 'REJECTED') return 'REJECTED';
  if (axes.operationalStatus === 'SUSPENDED' || axes.accountStatus === 'SUSPENDED') return 'SUSPENDED';
  if (axes.kycStatus === 'FAILED' || axes.refereeStatus === 'FAILED') return 'ACTION_REQUIRED';
  if (axes.kycStatus === 'VERIFICATION_REQUIRED' || axes.clearanceStatus === 'ACTION_REQUIRED') {
    return 'ACTION_REQUIRED';
  }

  if (axes.operationalStatus === 'ACTIVE') return 'ACTIVE';

  if (flags.governmentApproved) {
    if (!flags.trainingCompleted) return 'GOVERNMENT_APPROVED';
    if (!flags.bankVerified) return 'TRAINING_COMPLETED';
    if (!flags.deviceRegistered) return 'BANK_VERIFIED';
    return 'DEVICE_REGISTERED';
  }

  if (flags.kycCleared && flags.refereeCleared) return 'READY_FOR_REVIEW';
  if (flags.kycCleared) return axes.refereeStatus === 'PENDING' ? 'REFEREE_PENDING' : 'KYC_CLEARED';
  if (!axes.applicationSubmitted) return 'APPLICATION_STARTED';
  if (axes.kycStatus === 'NOT_STARTED') return 'APPLICATION_SUBMITTED';
  return 'KYC_PENDING';
}

/** §26 — what the agent may do right now. */
export function deriveAccessStage(axes: AgentStatusAxes): AccessStage {
  if (axes.operationalStatus === 'ACTIVE' && axes.accountStatus === 'ACTIVE') return 'ACTIVE';
  if (axes.flags.governmentApproved && axes.clearanceStatus === 'APPROVED') return 'APPROVED';
  if (axes.flags.kycCleared) return 'KYC_CLEARED';
  return 'APPLICANT';
}

/**
 * §14 / §50 — the activation gate, enforced in the backend.
 *
 * Returns the list of unmet requirements. An empty list is the only thing
 * that permits activation; callers must not activate on a truthy check of
 * some other field. A government override (§41) does not bypass this
 * function — it records an approved exception alongside the unmet items, so
 * the reason an agent was activated early stays visible forever.
 */
export function activationBlockers(flags: AgentClearanceFlags): string[] {
  const blockers: string[] = [];
  if (!flags.kycCleared) blockers.push('KYC clearance is not complete');
  if (!flags.refereeCleared) blockers.push('No referee has been cleared for this applicant');
  if (!flags.governmentApproved) blockers.push('Government review has not approved this application');
  if (!flags.trainingCompleted) blockers.push('Mandatory training is not complete');
  if (!flags.bankVerified) blockers.push('Commission bank account has not been verified');
  if (!flags.agreementAccepted) blockers.push('The agent agreement has not been accepted');
  if (!flags.deviceRegistered) blockers.push('No approved device has been registered');
  return blockers;
}

export function canActivate(flags: AgentClearanceFlags): boolean {
  return activationBlockers(flags).length === 0;
}

/** §18 — mandatory training curriculum. */
export const TRAINING_MODULES = [
  { code: 'TRN-01', title: 'Revenue collection process', assessed: true, passMark: 70 },
  { code: 'TRN-02', title: 'Taxpayer registration', assessed: true, passMark: 70 },
  { code: 'TRN-03', title: 'TIN process', assessed: true, passMark: 70 },
  { code: 'TRN-04', title: 'Payment process', assessed: true, passMark: 80 },
  { code: 'TRN-05', title: 'Receipt verification', assessed: true, passMark: 80 },
  { code: 'TRN-06', title: 'Vehicle renewal', assessed: false, passMark: 0 },
  { code: 'TRN-07', title: 'Agent commission', assessed: false, passMark: 0 },
  { code: 'TRN-08', title: 'Fraud prevention', assessed: true, passMark: 80 },
  { code: 'TRN-09', title: 'Data protection', assessed: true, passMark: 80 },
  { code: 'TRN-10', title: 'Customer service', assessed: false, passMark: 0 },
  { code: 'TRN-11', title: 'Government ethics', assessed: true, passMark: 80 },
  { code: 'TRN-12', title: 'Escalation procedures', assessed: false, passMark: 0 },
] as const;

/** §8 — referee categories; configurable by PSIRS, seeded with these defaults. */
export const REFEREE_CATEGORIES = [
  'COMMUNITY_LEADER',
  'EMPLOYER',
  'PUBLIC_SERVANT',
  'RECOGNISED_PROFESSIONAL',
  'TRADITIONAL_AUTHORITY',
  'RELIGIOUS_LEADER',
] as const;
export type RefereeCategory = (typeof REFEREE_CATEGORIES)[number];

/** §24 — connection states the PWA must distinguish and display. */
export const CONNECTION_STATES = ['ONLINE', 'LIMITED', 'OFFLINE'] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];
