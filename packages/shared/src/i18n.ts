/**
 * Plateau State Revenue Platform Localisation (i18n).
 *
 * Supports English ('en') and Hausa ('ha') for field agents and taxpayers
 * across Plateau State's 17 LGAs.
 */

import type { AgentBlocker } from './agent-lifecycle';
import type { DuplicateReason } from './identity';
import type { VerificationReason } from './verification';
import type { ChainVerdict } from './audit-chain';

export type Language = 'en' | 'ha';

export interface TranslationDictionary {
  appName: string;
  appTagline: string;
  home: string;
  collect: string;
  taxpayers: string;
  vehicles: string;
  receipts: string;
  more: string;
  search: string;
  verify: string;
  signOut: string;

  // Actions & Buttons
  payRevenue: string;
  confirmPayment: string;
  downloadReceipt: string;
  shareReceipt: string;
  printBluetooth: string;
  registerTaxpayer: string;
  renewVehicle: string;
  pairPrinter: string;
  testPrint: string;
  enablePush: string;

  // Key Fields
  taxpayerName: string;
  taxpayerTin: string;
  phone: string;
  lga: string;
  ward: string;
  service: string;
  amount: string;
  totalPaid: string;
  receiptNumber: string;
  verificationCode: string;
  paymentMode: string;

  // ---------------------------------------------------------------------
  // The strings it costs something to leave in English.
  //
  // The dictionary above is navigation and civic vocabulary. These are the
  // sentences that stop an agent from doing the wrong thing, or tell them
  // why they cannot go on. An agent who cannot read "Never collect cash" is
  // exactly the agent who collects cash.
  //
  // Selected rather than exhaustive: the application holds roughly 247
  // distinct pieces of user-visible English, and translating all of them on
  // the assumption they matter is as unreasoned as translating none. The
  // field trial establishes the rest (UAT-FIELD-TRIAL.md §3.1).
  // ---------------------------------------------------------------------

  // Money safety
  neverCollectCash: string;
  neverCollectCashBody: string;
  cashChannelReminder: string;
  /**
   * A nil liability, which the Fourth Schedule makes an ordinary outcome.
   *
   * The first ₦800,000 of annual income is exempt, so for a large share of
   * the traders this platform exists to reach the correct answer is that
   * nothing is owed. That answer has to be sayable in the language the agent
   * is working in — an exemption explained only in English is an exemption
   * the agent cannot pass on to the person in front of them.
   */
  noTaxPayable: string;
  noTaxPayableBody: string;
  /**
   * Tab-bar labels, kept separate from the prose terms they echo.
   *
   * A tab is about 52 logical pixels wide on a common handset. English gets
   * away with reusing its prose words because they are already short;
   * "Taxpayers" is one word. Hausa's term for the same thing is "Masu Biyan
   * Haraji", which renders as "Masu ..." and names nothing. Sharing one key
   * between a heading and a tab forces the longer language to choose between
   * reading correctly in prose and fitting in a tab, and it loses both.
   */
  navHome: string;
  navTaxpayers: string;
  navCollect: string;
  navReceipts: string;
  navCommission: string;
  navProfile: string;
  commissionAccountOnly: string;
  commissionAccountNote: string;

  // What happened to the money
  paymentFailed: string;
  paymentFailedBody: string;
  paymentUnconfirmed: string;
  paymentUnconfirmedBody: string;
  paymentAcknowledged: string;
  paymentAcknowledgedBody: string;
  acknowledgementLabel: string;

  // Attribution
  findTaxpayerFirst: string;
  noTaxpayerMatch: string;
  searchAnotherArea: string;
  languageForMessages: string;
  languageForMessagesHint: string;

  /**
   * What happened to the money, and the errors that decide it.
   *
   * `ErrorAlert` printed these in English regardless of the language the agent
   * had chosen, and the money line beneath every error was a hardcoded literal
   * no dictionary and no review could reach. An agent who misreads it either
   * collects a second time from somebody who has already paid, or walks away
   * from money the State is owed.
   *
   * Only codes with a fixed meaning are here. A validation message is generated
   * from the schema and names a field; guessing Hausa for a sentence we have
   * not seen would be worse than showing the English, because the agent cannot
   * tell a guess from a translation.
   */
  moneyNotDebited: string;
  moneyUnconfirmed: string;
  moneyReceived: string;
  errPaymentUnconfirmed: string;
  errPaymentPendingReconciliation: string;
  errPaymentFailed: string;
  errAgentNotCleared: string;
  errDeviceNotRegistered: string;
  errRateLimited: string;
  errUpdateRequired: string;
  errReference: string;

  /**
   * The evidence under a fraud flag, named.
   *
   * The detection code attaches a small object to each flag — how many, in
   * how many seconds, against what threshold — and the screen turned its JSON
   * keys into English words. An auditor deciding whether an agent kept money
   * is reading exactly this, so it is worth the nine lines.
   */
  ofcOvSignalCount: string;
  ofcOvSignalWindowSeconds: string;
  ofcOvSignalThreshold: string;
  ofcOvSignalReason: string;
  ofcOvSignalAgentsSupported: string;
  ofcOvSignalAgentAssignedTo: string;
  ofcOvSignalCollectedIn: string;
  ofcOvSignalAgentTerritory: string;
  ofcOvSignalTransactionArea: string;

  /**
   * What an officer reads after acting, and why the button will not move.
   *
   * These sat in `onSuccess:` and `tooShort:` fields — the shape the step-up
   * confirmation helper takes — which no pattern in the translation check
   * looked at. Fifteen messages about money moving, an agent's commission
   * being held, and a share being taken back, all in English on a screen an
   * officer had set to Hausa.
   */
  ofcFnResolveTooShort: string;
  ofcFnExceptionResolved: string;
  ofcFnApprovePayoutTooShort: string;
  ofcFnPayoutApproved: string;
  ofcFnTransferReferenceTooShort: string;
  ofcFnPayoutPaid: string;
  ofcFnPayoutFailedTooShort: string;
  ofcFnPayoutFailedRecorded: string;
  ofcFnDecisionTooShort: string;
  ofcFnRequestDecided: string;
  ofcOvFlagNoteTooShort: string;
  ofcOvFlagConfirmed: string;
  ofcOvFlagMarked: string;
  ofcAlForfeitTooShort: string;
  ofcAlReleased: string;

  /**
   * The three reasons the button that changes an officer's access stays
   * disabled. They were English literals inside a function, which is a shape
   * no pattern in the translation check looks at — and the middle one also
   * spelled the role out in English inside a Hausa sentence.
   */
  ofcUaChooseRoleFirst: string;
  ofcUaAlreadyHolds: string;
  ofcUaSayWhy: string;
  ofcUaNowRole: string;
  ofcUaSessionsEnded: string;
  ofcUaNoOpenSessions: string;
  ofcUaCanSignInAgain: string;
  ofcUaAccountIsNow: string;
  ofcUaSessionsEndedNow: string;

  /**
   * The instruction under a risk flag an officer is deciding on. It sat as a
   * literal beside the rule's name, which is how the rule's name came to be
   * rendered in English too.
   */
  ofcAgRecordWhatYouFound: string;

  /**
   * The fraud signals, which are a list in code rather than a constraint in
   * the database — and were therefore the ten this map missed on the first
   * pass. An officer deciding whether to uphold a flag reads the rule's name
   * as the first line of the reason, so it is the last place an untranslated
   * identifier belongs.
   */
  enumDeviceVelocity: string;
  enumSharedPhoneNumber: string;
  enumDuplicateTaxpayerDetails: string;
  enumOutOfTerritory: string;
  enumRepeatedFailedPayments: string;
  enumReversalPattern: string;
  enumUnusualVolume: string;
  enumFrequentManualIntervention: string;
  enumRepeatedReceiptRegeneration: string;
  enumUnusualOfficerActivity: string;
  enumUnusualTransactionTiming: string;
  enumUser: string;
  enumRapidSuccession: string;
  enumCommissionAnomaly: string;
  enumSettlementVariance: string;

  /**
   * WHAT THE DATABASE CALLS A THING, AND WHAT A PERSON CALLS IT.
   *
   * Every value the schema's CHECK constraints allow, in both languages.
   * They reached the screen as themselves — `PARTIALLY_PAID` with its
   * underscore taken out — which is English however the app is set, and in
   * several places is not even good English: an officer working in Hausa read
   * "partially paid", "revenue officer" and "farmers cooperative" in the
   * middle of Hausa sentences.
   *
   * Kept in one block and looked up by value through `enumLabel`, so a screen
   * cannot render one of these without going through the dictionary, and a
   * value added to the schema tomorrow fails the check that reads the
   * constraints rather than arriving on a screen in English.
   */
  enumAbandoned: string;
  enumAborted: string;
  enumAccepted: string;
  enumAccountTransfer: string;
  enumActionRequired: string;
  enumActivated: string;
  enumActive: string;
  enumAdditionalIdentification: string;
  enumAdditiveBenefit: string;
  enumAdmin: string;
  enumAgent: string;
  enumAgentActivation: string;
  enumAgentAssisted: string;
  enumAgentMisconduct: string;
  enumAgentOnboarding: string;
  enumAgentOverrideActivation: string;
  enumAgentPwa: string;
  enumAgentSuspension: string;
  enumAgreementAccepted: string;
  enumAgriculture: string;
  enumAgricultureProcessing: string;
  enumAmountMismatch: string;
  enumAnnual: string;
  enumApi: string;
  enumApplicationSubmitted: string;
  enumApproved: string;
  enumArchived: string;
  enumArtisanCraft: string;
  enumArtisanGuild: string;
  enumAssessment: string;
  enumAssessmentCreated: string;
  dowSun: string;
  dowMon: string;
  dowTue: string;
  dowWed: string;
  dowThu: string;
  dowFri: string;
  dowSat: string;
  monthJan: string;
  monthFeb: string;
  monthMar: string;
  monthApr: string;
  monthMay: string;
  monthJun: string;
  monthJul: string;
  monthAug: string;
  monthSep: string;
  monthOct: string;
  monthNov: string;
  monthDec: string;
  monJan: string;
  monFeb: string;
  monMar: string;
  monApr: string;
  monMay: string;
  monJun: string;
  monJul: string;
  monAug: string;
  monSep: string;
  monOct: string;
  monNov: string;
  monDec: string;
  enumAssigned: string;
  enumTinAssigned: string;
  enumAttested: string;
  enumAuditor: string;
  enumAuthorityLookup: string;
  enumAutoRecommendation: string;
  enumAwarded: string;
  enumBag25kg: string;
  enumBag50kg: string;
  enumBankAccountChange: string;
  enumBankChangeApplied: string;
  enumBankChangeRefused: string;
  enumBankChangeRequested: string;
  enumBankTransfer: string;
  enumBankVerified: string;
  enumBase: string;
  enumBlocked: string;
  enumBoth: string;
  enumBusiness: string;
  enumBvn: string;
  enumCamera: string;
  enumCancelled: string;
  enumCard: string;
  enumCivilServant: string;
  enumCleared: string;
  enumClosed: string;
  enumCollected: string;
  enumCommission: string;
  enumCommissionAdjustment: string;
  enumCommissionPayout: string;
  enumCommunityLeader: string;
  enumCompleted: string;
  enumConfirmed: string;
  enumConstruction: string;
  enumCritical: string;
  enumDaily: string;
  enumDelivered: string;
  enumDenied: string;
  enumDevice: string;
  enumDeviceRegistered: string;
  enumDismissed: string;
  enumDisputed: string;
  enumDocument: string;
  enumDocumentCapture: string;
  enumDownload: string;
  enumDraft: string;
  enumDriversLicence: string;
  enumDuplicate: string;
  enumDuplicatePayment: string;
  enumEducation: string;
  enumEligibilityGate: string;
  enumEligible: string;
  enumEmail: string;
  enumEmployer: string;
  enumEn: string;
  enumEntertainmentArts: string;
  enumExecuted: string;
  enumExisting: string;
  enumExpired: string;
  enumFailed: string;
  enumFailure: string;
  enumFarmersCooperative: string;
  enumFederal: string;
  enumFemale: string;
  enumFile: string;
  enumFinanceOfficer: string;
  enumFinancialServices: string;
  enumFisheriesGroup: string;
  enumFishing: string;
  enumFixed: string;
  enumFoodBeverage: string;
  enumForfeited: string;
  enumFormula: string;
  enumFortnightly: string;
  enumFound: string;
  enumFull: string;
  enumGamingBetting: string;
  enumGateway: string;
  enumGatewayWebhook: string;
  enumGovernment: string;
  enumGovernmentApproved: string;
  enumGovernmentRejected: string;
  enumHa: string;
  enumHealthcare: string;
  enumHigh: string;
  enumHotelHospitality: string;
  enumIctTelecoms: string;
  enumIdentityDocument: string;
  enumIgnored: string;
  enumInProgress: string;
  enumInactive: string;
  enumIncorrectAssessment: string;
  enumIndividual: string;
  enumInfoRequested: string;
  enumInformalWorker: string;
  enumInitiated: string;
  enumInvalid: string;
  enumInvited: string;
  enumInvoice: string;
  enumInvoiceGenerated: string;
  enumInvoiced: string;
  enumIssued: string;
  enumKilogram: string;
  enumKycCleared: string;
  enumKycFailed: string;
  enumKycInfoRequired: string;
  enumKycSubmitted: string;
  enumLeft: string;
  enumLimited: string;
  enumLinkedExisting: string;
  enumLitre: string;
  enumLivestock: string;
  enumLivestockAssociation: string;
  enumLocalGovernment: string;
  enumLogin: string;
  enumLow: string;
  enumMale: string;
  enumManualCorrection: string;
  enumManualEntry: string;
  enumManualReview: string;
  enumManufacturing: string;
  enumMarketAssociation: string;
  enumMatched: string;
  enumMedium: string;
  enumMerged: string;
  enumMigration: string;
  enumMining: string;
  enumMissingPayment: string;
  enumMissingPlatformTransaction: string;
  enumMonthly: string;
  enumMotorVehicle: string;
  enumNin: string;
  enumNormal: string;
  enumNotAttempted: string;
  enumNotFound: string;
  enumNotPerformed: string;
  enumNotRequested: string;
  enumNotStarted: string;
  enumOfficer: string;
  enumOfficerReview: string;
  enumOffline: string;
  enumOnHold: string;
  enumOneOff: string;
  enumOnline: string;
  enumOpen: string;
  enumOpened: string;
  enumOther: string;
  enumOverrideApplied: string;
  enumPaid: string;
  enumPartial: string;
  enumPartiallyPaid: string;
  enumPassed: string;
  enumPassport: string;
  enumPassportPhotograph: string;
  enumPasswordReset: string;
  enumPaymentAcknowledgement: string;
  enumPaymentEvidence: string;
  enumPaymentInitiated: string;
  enumPaymentIssue: string;
  enumPaymentPending: string;
  enumPaymentReversal: string;
  enumPaymentSuccessful: string;
  enumPaymentVerified: string;
  enumPending: string;
  enumPendingAttestation: string;
  enumPendingPayment: string;
  enumPendingSettlement: string;
  enumPendingSync: string;
  enumPercentage: string;
  enumPoll: string;
  enumPortal: string;
  enumPos: string;
  enumPrivateEmployee: string;
  enumProceeded: string;
  enumProcessed: string;
  enumProcessing: string;
  enumProfessionalServices: string;
  enumProofOfAddress: string;
  enumProposed: string;
  enumPsirsSync: string;
  enumPublicServant: string;
  enumPush: string;
  enumQuarterly: string;
  enumQueued: string;
  enumRead: string;
  enumReadyForReview: string;
  enumRealProperty: string;
  enumReceipt: string;
  enumReceiptGenerated: string;
  enumReceiptIssue: string;
  enumReceived: string;
  enumRecognisedProfessional: string;
  enumReconciled: string;
  enumReconciliation: string;
  enumReconciliationPending: string;
  enumReferee: string;
  enumRefereeCleared: string;
  enumRefereeFailed: string;
  enumRefereeInvited: string;
  enumRefereeReplaced: string;
  enumRefereeVerify: string;
  enumRefund: string;
  enumRefunded: string;
  enumRegistration: string;
  enumReinstated: string;
  enumRejected: string;
  enumReligiousLeader: string;
  enumReligiousNgo: string;
  enumReplaced: string;
  enumRequested: string;
  enumResolved: string;
  enumResponded: string;
  enumRetailTrade: string;
  enumRetired: string;
  enumRevenueOfficer: string;
  enumRevenueRateChange: string;
  enumReversal: string;
  enumReversed: string;
  enumReview: string;
  enumReviewed: string;
  enumRevoked: string;
  enumRunning: string;
  enumSeedling: string;
  enumSelfAssessment: string;
  enumSelfEmployed: string;
  enumSelfie: string;
  enumSent: string;
  enumServiceRequest: string;
  enumSettled: string;
  enumSettlement: string;
  enumShare: string;
  enumSms: string;
  enumStarted: string;
  enumState: string;
  enumStepUp: string;
  enumCitizenStatement: string;
  enumStudentUnemployed: string;
  enumSubmitted: string;
  enumSucceeded: string;
  enumSuccess: string;
  enumSuccessful: string;
  enumSuperseded: string;
  enumSupervisor: string;
  enumSupportingDocument: string;
  enumSuspended: string;
  enumSynced: string;
  enumSystem: string;
  enumTaxpayer: string;
  enumTaxpayerAdjustment: string;
  enumTaxpayerComplaint: string;
  enumTaxpayerRegistration: string;
  enumTechnicalIssue: string;
  enumTiered: string;
  enumTinConfirmation: string;
  enumTinIssue: string;
  enumTractorDay: string;
  enumTradersAssociation: string;
  enumTraditionalAuthority: string;
  enumTrainingCompleted: string;
  enumTransaction: string;
  enumTransportHaulage: string;
  enumTransportPassenger: string;
  enumTransportUnion: string;
  enumUnauthorisedCharge: string;
  enumUnavailable: string;
  enumUnchecked: string;
  enumUnderReview: string;
  enumUnit: string;
  enumUnknown: string;
  enumUnpaid: string;
  enumUnspecified: string;
  enumUnverified: string;
  enumUpload: string;
  enumUrgent: string;
  enumUssd: string;
  enumValid: string;
  enumVehicle: string;
  enumVehicleCapture: string;
  enumVehicleIssue: string;
  enumVehicleRenewal: string;
  enumVerificationRequired: string;
  enumVerified: string;
  enumVerify: string;
  enumView: string;
  enumVotersCard: string;
  enumWaived: string;
  enumWebhook: string;
  enumWeekly: string;
  enumWhatsapp: string;
  enumWholesaleTrade: string;

  /**
   * The sentence a referee reads once, with a subject.
   *
   * It was assembled as the applicant's Local Government Area, an em dash,
   * and a clause beginning "has applied" — so the page told a stranger
   * "Jos North — has applied to become an authorised revenue agent." Nobody
   * is named in the one sentence explaining what is being asked, and the
   * thing that appears to have applied is a place.
   */
  pubRefereeIntroOfLga: string;

  /**
   * The five role descriptions an administrator reads before changing
   * somebody's access, and the sentences around them. They sat in a
   * module-level object, which no pattern in the check looks at.
   */
  ofcUaSuspendOrCloseBody: string;
  ofcUaCoverNothingBody: string;
  ofcUaChangeAccessFor: string;
  ofcUaCurrentlyRole: string;
  ofcUaAccountFor: string;
  ofcUaCannotReopenBody: string;
  ofcUaTerritoriesFor: string;
  ofcUaRoleAdmin: string;
  ofcUaRoleSupervisor: string;
  ofcUaRoleRevenueOfficer: string;
  ofcUaRoleFinanceOfficer: string;
  ofcUaRoleAuditor: string;

  /**
   * Officer-portal strings the English guard could not see until it learned
   * to read text beside an interpolation. Most are card titles of the form
   * "Section — {{name}}", which is the portal's commonest heading shape and
   * was English on eleven screens.
   */
  ofcAgRiskFlagFor: string;
  ofcAlAwardsFor: string;
  ofcAlAwardsIntro: string;
  ofcCfRateHistoryFor: string;
  ofcCfChangeRateFor: string;
  ofcCfBeneficiariesFor: string;
  ofcFnRecordSettlementTitle: string;
  ofcFnRecordSettlementAction: string;
  ofcFnRecordPayment: string;
  ofcGpRecordDeparture: string;
  ofcGpAwardedNotCollected: string;
  ofcGpMembersFor: string;
  ofcGpEnoughForMore: string;
  ofcKycFileType: string;
  ofcLvIntroAll: string;
  ofcLvIntroNoRegister: string;
  ofcLvChooseOnce: string;
  ofcLvBroughtIn: string;
  ofcLvBehindOn: string;
  ofcLvRegisteredUnder: string;
  ofcLvShowingLargest: string;
  pubAttestProgress: string;
  ofcRhAdministrationFor: string;
  ofcRhSignedIn: string;
  ofcTrRegisterFor: string;
  ofcUsPrivacyBody: string;

  /**
   * Strings the English guard could not see until it learned to read text
   * beside an interpolation — a button label after a spinner, a sentence
   * wrapped around a bank account, the countdown under a step-up prompt.
   * Every one of them was rendering English to an agent working in Hausa.
   */
  actionSearch: string;
  colReceiptNumbered: string;
  pickNoTaxpayerMatch: string;
  grpNotActiveYet: string;
  grpLeaderMustConfirm: string;
  moreDraftCaptured: string;
  moreCommissionRateOf: string;
  moreBankChangeAsking: string;
  supYouAt: string;
  stepUpExpiresIn: string;
  pubRefereeNamedYou: string;

  /**
   * Correcting a taxpayer's record, and ending one — closure, suspension,
   * and what stays payable afterwards.
   */
  ofcTrTitle: string;
  ofcTrIntro: string;
  ofcTrNoMatch: string;
  ofcTrCorrectedDetails: string;
  ofcTrLeaveBlank: string;
  ofcTrIdentificationDocument: string;
  ofcTrDecidesWhichPerson: string;
  ofcTrUnchanged: string;
  ofcTrNumber: string;
  ofcTrNameOrDob: string;
  ofcTrWhatAndWhy: string;
  ofcTrLiableFor: string;
  ofcTrWaiveBody: string;
  ofcTrWaive: string;
  ofcTrVehiclesOnRecord: string;
  ofcTrVehiclesBody: string;
  ofcTrTakeOffRegister: string;
  ofcTrPutBackInService: string;
  ofcTrEndedBody: string;
  ofcTrWhatHappened: string;
  ofcTrClosedOption: string;
  ofcTrSuspendedOption: string;
  ofcTrActiveOption: string;
  ofcTrHowEstablished: string;
  ofcTrSearchPlaceholder: string;
  ofcTrNeedsAdministrator: string;
  ofcTrSampleCorrection: string;
  ofcTrSampleVehicle: string;
  ofcTrSampleClosure: string;
  ofcTrRecordedBy: string;

  /**
   * Settlement: reconciling the platform against the gateway against the
   * government account, and paying agents what they have earned.
   */
  ofcFnThreeWay: string;
  ofcFnThreeWayBody: string;
  ofcFnRunReconciliation: string;
  ofcFnRecoverMissed: string;
  ofcFnRecoverMissedBody: string;
  ofcFnStatementBody: string;
  ofcFnValueDate: string;
  ofcFnBankReference: string;
  ofcFnCredited: string;
  ofcFnGatewayReferences: string;
  ofcFnAwaitingSettlement: string;
  ofcFnAwaitingSettlementBody: string;
  ofcFnExceptionQueue: string;
  ofcFnExceptionQueueBody: string;
  ofcFnResolve: string;
  ofcFnSettlements: string;
  ofcFnCloseDispute: string;
  ofcFnDisputeBody: string;
  ofcFnCommissionPayouts: string;
  ofcFnCommissionBody: string;
  ofcFnPromoteEligible: string;
  ofcFnTransferFailed: string;
  ofcFnMakerChecker: string;
  ofcFnMakerCheckerBody: string;
  ofcFnApproved: string;
  ofcFnRejected: string;
  ofcFnExecuted: string;
  ofcFnYourRequest: string;
  ofcFnExecuteReversal: string;
  ofcFnNotYourRole: string;
  ofcFnTotalExpected: string;
  ofcFnTotalReceived: string;
  ofcFnVariance: string;
  ofcFnAsOnStatement: string;
  ofcFnOnePerLine: string;
  ofcFnException: string;
  ofcFnDate: string;
  ofcFnPayout: string;
  ofcFnEntries: string;
  ofcFnBankAccount: string;
  ofcFnRequestedBy: string;

  /**
   * The revenue catalogue — what a citizen may be charged and at what rate —
   * and the social programmes that add an entitlement on top of it.
   */
  ofcCfCatalogueIntro: string;
  ofcCfAddRevenueItem: string;
  ofcCfHistoricalAssessments: string;
  ofcCfChangeRate: string;
  ofcCfNewRevenueItem: string;
  ofcCfCreatedWithoutPrice: string;
  ofcCfChooseCategory: string;
  ofcCfHowOften: string;
  ofcCfWhatItIsFor: string;
  ofcCfWhoItApplies: string;
  ofcCfSelfAssessable: string;
  ofcCfCommissionable: string;
  ofcCfWhatIsHappening: string;
  ofcCfSuspendOption: string;
  ofcCfRetireOption: string;
  ofcCfRetireWarning: string;
  ofcCfCurrentVersionStays: string;
  ofcCfRateType: string;
  ofcCfFixedAmount: string;
  ofcCfPercentage: string;
  ofcCfNewAmount: string;
  ofcCfNewRate: string;
  ofcCfEffectiveFrom: string;
  ofcCfReasonForChange: string;
  ofcCfRate: string;
  ofcCfChangedBy: string;
  ofcCfFrequency: string;
  ofcCfCurrentRate: string;
  ofcCfOnSale: string;
  ofcCfSampleReason: string;
  ofcCfProgrammesTitle: string;
  ofcCfProgrammesIntro: string;
  ofcCfEssentialServiceLink: string;
  ofcCfBeneficiaries: string;
  ofcCfNoEligibleYet: string;
  ofcCfEssentialProtected: string;
  ofcCfBenefit: string;
  ofcCfMinScore: string;
  ofcCfRequiresNoArrears: string;
  ofcCfEligible: string;
  ofcCfEvaluated: string;
  ofcOvTransactionCount: string;
  ofcOvSettlementsOutstanding: string;
  ofcOvIntact: string;
  /*
   * The four answers chain verification can give, each carrying its number.
   *
   * `ofcOvChainIntact` takes {{count}}; the three breaks take {{sequence}}.
   * They are distinct sentences rather than one "tampered with" because what
   * an auditor does next depends on which of the three it is.
   */
  ofcOvChainIntact: string;
  ofcOvChainGenesisRemoved: string;
  ofcOvChainLinkMismatch: string;
  ofcOvChainContentModified: string;
  ofcOvSystem: string;
  ofcOvNoRows: string;

  /**
   * Fraud, leakage, and the hash-chained audit trail an auditor reads.
   */
  ofcOvLeakageTitle: string;
  ofcOvSignalsBody: string;
  ofcOvSweepBody: string;
  ofcOvAgentsWithFlags: string;
  ofcOvFraudSignals: string;
  ofcOvUnderReview: string;
  ofcOvDismissed: string;
  ofcOvConfirm: string;
  ofcOvDismiss: string;
  ofcOvUnattendedWork: string;
  ofcOvOpenFlags: string;
  ofcOvHighestSeverity: string;
  ofcOvAuditTrail: string;
  ofcOvChainBody: string;
  ofcOvVerifyChain: string;
  ofcOvStandardQuestions: string;
  ofcOvStandardQuestionsBody: string;
  ofcOvEntityType: string;
  ofcOvAction: string;
  ofcOvFindTheTaxpayer: string;
  ofcOvUnreconciled48h: string;
  ofcOvSettlementShortfall: string;
  ofcOvDuplicatePayments: string;
  ofcOvFailedVerifications: string;
  ofcOvNoValidReceipt: string;
  ofcOvEntityPlaceholder: string;
  ofcOvActionPlaceholder: string;
  ofcOvReversedAfterPayment: string;
  ofcOvAllRateChanges: string;
  ofcOvOneAgentCollected: string;
  ofcOvReceiptsOneItem: string;
  ofcOvWhoLookedAtRecord: string;
  ofcOvJob: string;
  ofcOvRuns: string;
  ofcOvLastSucceeded: string;
  ofcOvWhatThatMeans: string;
  ofcOvActor: string;
  ofcOvEntity: string;
  ofcOvResult: string;
  ofcOvHash: string;
  ofcOvTampered: string;
  ofcDbShowing: string;
  ofcDbCoversYourTerritory: string;
  ofcDbCoversYourTerritories: string;
  ofcDbNeedAttention: string;
  ofcDbExceptionsAnd: string;
  ofcDbNewThisMonth: string;
  ofcDbAwaitingReview: string;
  ofcDbFailedCount: string;
  ofcRvArea: string;

  /**
   * The collections dashboard, and the revenue intelligence behind it: whose
   * revenue each naira is, and where in the state it came from.
   */
  ofcDbNoTerritoryBody: string;
  ofcDbNoTerritoryTitle: string;
  ofcDbReviewReconciliation: string;
  ofcDbReviewFlags: string;
  ofcDbCollectionsLast30: string;
  ofcDbOnlyConfirmed: string;
  ofcDbRevenueByLga: string;
  ofcDbBelowPotential: string;
  ofcDbRevenueByCategory: string;
  ofcDbWhichHeads: string;
  ofcDbTopAgents: string;
  ofcDbTopAgentsBody: string;
  ofcDbRevenueByMda: string;
  ofcDbIntelligenceTitle: string;
  ofcDbDrill: string;
  ofcDbPlateauState: string;
  ofcDbPlatformKpis: string;
  ofcDbKpisUnreadable: string;
  ofcDbKpisUnreadableBody: string;
  ofcDbSinceBegan: string;
  ofcDbVerifiedOnly: string;
  ofcDbThisMonth: string;
  ofcDbYearToDate: string;
  ofcDbAccruedNotPaid: string;
  ofcDbRegisteredTaxpayers: string;
  ofcDbSuccessfulTransactions: string;
  ofcDbAwaitingReconciliation: string;
  ofcDbPaymentsVerified: string;
  ofcDbOfEveryAttempted: string;
  ofcDbReconciled: string;
  ofcDbMatchedAcross: string;
  ofcDbReceiptsIssued: string;
  ofcDbOfTransactions: string;
  ofcDbMda: string;
  ofcRvGroupedByAssessment: string;
  ofcRvWhoseRevenue: string;
  /*
   * One sentence, in one key, in both languages.
   *
   * It used to be two: this one ending mid-clause, and `ofcRvMdaNoItem`
   * BEGINNING with a full stop, with the word "for" rendered between them in
   * an <em> to italicise it. That made the sentence untranslatable rather
   * than merely untranslated — Hausa does not strand a preposition at the end
   * of a clause, so no translation of the first half could end where the
   * English did, and the reviewer of the second half was shown a fragment
   * opening with punctuation. The italics were not worth that.
   */
  ofcRvWhoseRevenueBody: string;
  ofcRvOwedToCouncils: string;
  ofcRvCouncilsBody: string;
  ofcRvWhereGenerated: string;
  ofcRvWhereGeneratedBody: string;
  ofcRvEachAgentGround: string;
  ofcRvGroundBody: string;
  ofcRvVerifiedLastYear: string;
  ofcRvGeneratingAreas: string;
  ofcRvWardsProduced: string;
  ofcRvArmsNoItem: string;
  ofcRvOwedCouncils: string;
  ofcRvCollectedOnBehalf: string;
  ofcRvPlacedOnMap: string;
  ofcRvWithRecordedPoint: string;
  ofcRvNoPointRecorded: string;
  ofcRvMinistryDepartment: string;
  ofcRvRevenueItems: string;
  ofcRvShare: string;
  ofcRvCouncil: string;
  ofcRvAgents: string;
  ofcRvMapped: string;
  ofcRvTerritory: string;
  ofcRvLgas: string;
  ofcRvWards: string;
  ofcRvCentreOfCollection: string;
  ofcOsCleared: string;
  ofcOsStillOutstanding: string;
  ofcUsStartedCount: string;
  ofcUsNoAttempts: string;
  ofcUsNoAbandonment: string;

  /**
   * What the platform is still carrying — refunds, missing TINs, renewals the
   * authority has not acknowledged — and what it observes about its own use.
   */
  ofcOsReadingNeeds: string;
  ofcOsNotYours: string;
  ofcOsRefundsOwed: string;
  ofcOsReversalBody: string;
  ofcOsWaitingTinTitle: string;
  ofcOsWaitingTinBody: string;
  ofcOsRenewalsUnackTitle: string;
  ofcOsRenewalsUnackBody: string;
  ofcOsVehiclesUncheckedTitle: string;
  ofcOsVehiclesUncheckedBody: string;
  ofcOsEndedOwingTitle: string;
  ofcOsEndedOwingBody: string;
  ofcOsNothingOutstanding: string;
  ofcOsOwedToTaxpayers: string;
  ofcOsRefundsNotMade: string;
  ofcOsWaitingForTin: string;
  ofcOsRenewalsUnacknowledged: string;
  ofcOsRefund: string;
  ofcOsAttempts: string;
  ofcOsWhyNotYet: string;
  ofcOsLastTried: string;
  ofcOsOwedSince: string;
  ofcOsValidUntil: string;
  ofcOsState: string;
  ofcOsOwed: string;
  ofcOsWhyEnded: string;
  ofcOsEnded: string;
  ofcUaTheirAccess: string;
  ofcUaAccessFor: string;
  ofcUaBackToMine: string;
  ofcRhAgentApproved: string;
  ofcAlRoundQuantity: string;
  ofcAlAwardedLeft: string;
  ofcPfWorkedOf: string;
  ofcFnSettlementClosed: string;
  ofcGrGroupSuspended: string;
  ofcGrQuantityPeople: string;
  supRepliesCount: string;
  ofcOsQueueUnreadable: string;
  ofcOsQueueUnreadableBody: string;
  ofcUaCoversNothing: string;
  ofcUaCoversTerritories: string;
  ofcFaMinimumNow: string;
  ofcFaNoneBelowIt: string;
  ofcFaCannotCollect: string;
  ofcTrVehicleBackInService: string;
  ofcTrVehicleSuspended: string;
  ofcTrVehicleArchived: string;
  colPayReceipted: string;
  colPayAwaitingSettlement: string;
  colPayStillPending: string;
  colPayFailed: string;
  ofcFnPromotedForPayout: string;
  ofcCfEvaluatedCount: string;
  ofcTrObligationsUpdated: string;
  ofcTrOneDetailCorrected: string;
  ofcTrDetailsCorrected: string;
  ofcTrOnRegisterAgain: string;
  ofcTrRecordEnded: string;
  ofcTrStillOwedAfterEnding: string;
  ofcTrNothingWasOutstanding: string;
  ofcOsRefundsReturned: string;
  ofcOsRefundsPartly: string;
  ofcOsTinsAssigned: string;
  ofcOsTinsPartly: string;
  ofcOsRenewalsAcked: string;
  ofcOsRenewalsPartly: string;
  ofcUsTitle: string;
  ofcUsReportsCollections: string;
  ofcUsIntro: string;
  ofcUsEveryFlow: string;
  ofcUsWhereGiveUp: string;
  ofcUsWhereGiveUpBody: string;
  ofcUsReachBeyondJos: string;
  ofcUsReachBody: string;
  ofcUsOfflineQueue: string;
  ofcUsScreensReached: string;
  ofcUsNothingReported: string;
  ofcUsRegistrationsCompleted: string;
  ofcUsCollectionsCompleted: string;
  ofcUsMedianRegistration: string;
  ofcUsStartToFinish: string;
  ofcUsMedianCollection: string;
  ofcUsUntilHandedOff: string;
  ofcUsFlow: string;
  ofcUsStarted: string;
  ofcUsCompleted: string;
  ofcUsCompletion: string;
  ofcUsGivenUp: string;
  ofcUsMedianTime: string;
  ofcUsLastStepReached: string;
  ofcUsZone: string;
  ofcUsCount: string;
  ofcUsMedianDelay: string;
  ofcUsEvents: string;
  ofcUsScreen: string;
  ofcUsViews: string;
  ofcGpConfirmationLinkFor: string;
  ofcSpOpenComplaints: string;

  /**
   * The support desk an agent's report lands in, and the groups and
   * distributions an officer approves.
   */
  ofcSpAboutRevenue: string;
  ofcSpSupportQueue: string;
  ofcSpQueueIntro: string;
  ofcSpAssigned: string;
  ofcSpInProgress: string;
  ofcSpResolved: string;
  ofcSpClosed: string;
  ofcSpBackToQueue: string;
  ofcSpNobodyReplied: string;
  ofcSpReadOnlyNote: string;
  ofcSpClosedKeepsHistory: string;
  ofcSpKeepInternal: string;
  ofcSpMoveTicket: string;
  ofcSpHowResolved: string;
  ofcSpResolutionRequired: string;
  ofcSpMarkResolved: string;
  ofcSpResolutionRecorded: string;
  ofcSpDone: string;
  ofcSpReadAccess: string;
  ofcSpTicketClosed: string;
  ofcSpTicket: string;
  ofcSpSubject: string;
  ofcSpPriority: string;
  ofcSpReportedBy: string;
  ofcSpReplies: string;
  ofcGpLeaderCodeOnce: string;
  ofcGpWaitingDecision: string;
  ofcGpWaitingIntro: string;
  ofcGpDistributions: string;
  ofcGpDistributionsIntro: string;
  ofcGpRegisteredGroups: string;
  ofcPhTitle: string;
  ofcPhIntro: string;
  ofcPhFrom: string;
  ofcPhTo: string;
  ofcPhPaid: string;
  ofcPhPayments: string;
  ofcPhReturned: string;
  ofcPhForWhat: string;
  ofcPhLevy: string;
  ofcPhEachPayment: string;
  ofcPhWhen: string;
  ofcPhPeriod: string;
  ofcPhAmount: string;
  ofcPhReceipt: string;
  ofcPhNothingPaid: string;
  ofcGpTaxRole: string;
  ofcGpTaxRoleNone: string;
  ofcGpTaxRoleNeedsReason: string;
  ofcGpGroupsIntro: string;
  ofcGpMembersIntro: string;
  ofcGpMembershipEnded: string;
  ofcGpMembers: string;
  ofcGpAskLeader: string;
  ofcGpTotal: string;
  ofcGpAwarded: string;
  ofcGpRemaining: string;
  ofcGpSampleNote: string;
  ofcGpSampleEnded: string;
  ofcGpMostNotCollected: string;
  ofcGpNote: string;
  ofcGpSector: string;
  ofcGpConfirmedMembers: string;
  ofcGpScoreAtAward: string;

  /**
   * Levies by category, and the distribution rounds a social programme runs
   * through — fertiliser, seed and the like.
   */
  ofcLvTitle: string;
  ofcLvTaxCategory: string;
  ofcLvAllCategories: string;
  ofcLvLevyOrItem: string;
  ofcLvAllItems: string;
  ofcLvCollectedFrom: string;
  ofcLvCollectedTo: string;
  ofcLvByIndividualLevy: string;
  ofcLvOnlyUnpaid: string;
  ofcLvChooseFilter: string;
  ofcLvSettledToState: string;
  ofcLvAwaitingSettlement: string;
  ofcLvTaxpayersInArrears: string;
  ofcLvTotalOutstanding: string;
  ofcLvCollections: string;
  ofcLvSettled: string;
  ofcLvLevy: string;
  ofcLvInvoices: string;
  ofcLvOldestDue: string;
  ofcNavArrears: string;
  ofcArTitle: string;
  enumAssessed: string;
  ofcEnRecorded: string;
  ofcEnRecordedIntro: string;
  ofcEnAttestation: string;
  ofcEnNotYetAssessed: string;
  ofcEnExempt: string;
  ofcEnAction: string;
  ofcEnSettleFirst: string;
  ofcEnLeaderAgrees: string;
  ofcEnAssess: string;
  ofcEnAlreadyObjected: string;
  ofcEnRecordObjection: string;
  ofcEnAttestedByName: string;
  ofcEnStatementFirst: string;
  ofcEnNothingRecorded: string;
  enumFactsWrong: string;
  enumHasRecords: string;
  enumNotTrading: string;
  enumEnumeration: string;
  enumBusinessObservation: string;
  enumAttestation: string;
  enumObjected: string;
  enumUpheld: string;
  enumAgreed: string;
  enumDisagreed: string;
  enumNotSought: string;
  ofcNavEnumeration: string;
  ofcEnTitle: string;
  ofcEnIntro: string;
  ofcEnDisagreements: string;
  ofcEnDisagreementsIntro: string;
  ofcEnGroup: string;
  ofcEnAgentSaw: string;
  ofcEnLeaderSays: string;
  ofcEnBandGap: string;
  ofcEnSameBand: string;
  ofcEnObservedOn: string;
  ofcEnAttestedBy: string;
  ofcEnNoDisagreements: string;
  ofcEnObjections: string;
  ofcEnOpenObjections: string;
  ofcEnUnderObjection: string;
  ofcEnWhileOpenTitle: string;
  ofcEnWhileOpen: string;
  ofcEnDecisionReason: string;
  ofcEnDecisionReasonHint: string;
  ofcEnGround: string;
  ofcEnWhatTheySay: string;
  ofcEnRaisedOn: string;
  ofcEnDecision: string;
  ofcEnYoursToPassOn: string;
  ofcEnUphold: string;
  ofcEnReject: string;
  ofcEnReasonFirst: string;
  ofcEnNoObjections: string;
  ofcPsPublish: string;
  ofcPsPublishClass: string;
  ofcPsPublishFigure: string;
  ofcPsChoose: string;
  ofcPsIndicators: string;
  ofcPsIndicatorsHint: string;
  ofcPsClassPublished: string;
  ofcPsFigurePublished: string;
  ofcPsAssumedTurnoverNaira: string;
  ofcPsAdoptExemption: string;
  ofcPsAdoptWarningTitle: string;
  ofcPsAdoptWarning: string;
  ofcPsConstruction: string;
  ofcPsCeiling: string;
  ofcPsLegalBasis: string;
  ofcPsExemptionAdopted: string;
  enumSmall: string;
  enumNano: string;
  enumPresumptive: string;
  enumBooks: string;
  enumClassA: string;
  enumClassB: string;
  enumClassC: string;
  enumClassD: string;
  enumMicro: string;
  enumConjunctive: string;
  enumTurnoverGoverned: string;
  enumNone: string;
  enumStall: string;
  enumKiosk: string;
  enumLockUpShop: string;
  enumBuilding: string;
  ofcNavPresumptive: string;
  ofcPsTitle: string;
  ofcPsIntro: string;
  ofcPsReadiness: string;
  ofcPsLgasClassified: string;
  ofcPsCells: string;
  ofcPsExemptionInForce: string;
  ofcPsConjunctive: string;
  ofcPsTurnoverGoverned: string;
  ofcPsNoExemptionAdopted: string;
  ofcPsNoExemptionExplained: string;
  ofcPsPartlyPublished: string;
  ofcPsPartlyPublishedExplained: string;
  ofcPsWhatItWouldCost: string;
  ofcPsCheckIntro: string;
  ofcPsPremises: string;
  ofcPsEquipment: string;
  ofcPsPeople: string;
  ofcPsWorkItOut: string;
  ofcPsBand: string;
  ofcPsClass: string;
  ofcPsAssumedTurnover: string;
  ofcPsAllAdoptedUnder: string;
  ofcPsAnnualTax: string;
  ofcPsMonthlyTax: string;
  ofcPsExempt: string;
  ofcPsExemptExplained: string;
  ofcPsHowWeGotThere: string;
  ofcPsStep: string;
  ofcPsDetail: string;
  ofcPsAmount: string;
  ofcPsNoWorking: string;
  ofcPsClasses: string;
  ofcPsClassesIntro: string;
  ofcPsIndexSource: string;
  ofcPsFrom: string;
  ofcPsUntil: string;
  ofcPsNoEndDate: string;
  ofcPsNoClasses: string;
  ofcPsTheTable: string;
  ofcPsInstrument: string;
  ofcPsVersion: string;
  ofcPsNoEntries: string;
  ofcPsHowToChange: string;
  enumFiled: string;
  ofcPrWithdraw: string;
  ofcPrWithdrawReason: string;
  ofcPrWithdrawFirst: string;
  ofcNavPayroll: string;
  ofcPrTitle: string;
  ofcPrIntro: string;
  ofcPrWhichList: string;
  ofcPrListPaye: string;
  ofcPrListConsumption: string;
  ofcPrNotFiling: string;
  ofcPrFiling: string;
  ofcPrSector: string;
  ofcPrNature: string;
  ofcPrOpen: string;
  ofcPrNoneNotFiling: string;
  ofcPrNoneNotPaying: string;
  ofcPrFiledBefore: string;
  ofcPrPeriod: string;
  ofcPrEmployees: string;
  ofcPrGross: string;
  ofcPrTax: string;
  ofcPrFiledOn: string;
  ofcPrWithdrawnBecause: string;
  ofcPrNeverFiled: string;
  ofcPrFileAReturn: string;
  ofcPrHowTheTaxIsWorkedOut: string;
  ofcPrHowExplained: string;
  ofcPrYear: string;
  ofcPrMonth: string;
  ofcPrEmployeeName: string;
  ofcPrMonthlyPay: string;
  ofcPrAddEmployee: string;
  ofcPrSubmit: string;
  ofcPrFiledTitle: string;
  ofcPrFiledExplained: string;
  ofcPrMissingTins: string;
  ofcIgReasonLabel: string;
  ofcIgReasonFirst: string;
  ofcNavConnections: string;
  ofcIgTitle: string;
  ofcIgIntro: string;
  ofcIgLimitsTitle: string;
  ofcIgLimits: string;
  ofcIgAtLeastVehicles: string;
  ofcIgRebuildLabel: string;
  ofcIgRebuildAction: string;
  ofcIgRebuilt: string;
  ofcIgLeads: string;
  ofcIgVehicles: string;
  ofcIgUnmatched: string;
  ofcIgUnmatchedExplained: string;
  ofcIgPurpose: string;
  ofcIgPurposeChoose: string;
  ofcIgPurposeFirst: string;
  ofcIgRegistrations: string;
  ofcIgGrounds: string;
  ofcIgFromRegister: string;
  ofcIgFromPhone: string;
  ofcIgChargedCommercial: string;
  ofcIgPaidLastYear: string;
  ofcIgOpen: string;
  ofcIgNoLeads: string;
  ofcIgRecordTitle: string;
  ofcIgWhatWeClaim: string;
  ofcIgWhatTheyOwe: string;
  ofcIgThing: string;
  ofcIgRelationship: string;
  ofcIgSource: string;
  ofcIgObtained: string;
  ofcIgLawfulBasis: string;
  ofcIgDecide: string;
  ofcIgConfirm: string;
  ofcIgDispute: string;
  ofcIgWithdraw: string;
  ofcIgReasonPrompt: string;
  ofcIgNothingClaimed: string;
  ofcIgReference: string;
  ofcIgSince: string;
  ofcIgPayableNow: string;
  ofcIgPayableYes: string;
  ofcIgPayableNeedsReassessment: string;
  ofcIgOwesNothing: string;
  enumAsserted: string;
  enumConfirmedByTaxpayer: string;
  enumConsistencyCheck: string;
  enumCoverageLead: string;
  enumTaxpayerRequest: string;
  enumWithdrawn: string;
  ofcArIntro: string;
  ofcArAtLeast: string;
  ofcArLapsingWithin: string;
  ofcArAnyDeadline: string;
  ofcArWithin7: string;
  ofcArWithin14: string;
  ofcArWithin30: string;
  ofcArCollectableNow: string;
  ofcArTaxpayers: string;
  ofcArNeedsReassessment: string;
  ofcArEndedElsewhere: string;
  ofcArWhoIsMissing: string;
  ofcArInFlightExplained: string;
  ofcArLapsedTitle: string;
  ofcArLapsedExplained: string;
  ofcArWhoToCall: string;
  ofcArShowingLargest: string;
  ofcArOwedFor: string;
  ofcArDaysLeft: string;
  ofcArNoDeadline: string;
  ofcArLastPaid: string;
  ofcArNeverPaid: string;
  ofcArPartPaid: string;
  ofcArNobodyOwes: string;
  ofcAlIntro: string;
  ofcAlNewRound: string;
  ofcAlProgramme: string;
  ofcAlSelectProgramme: string;
  ofcAlNoProgramme: string;
  ofcAlRoundName: string;
  ofcAlMeasuredIn: string;
  ofcAlTotalToDistribute: string;
  ofcAlEachReceives: string;
  ofcAlEnoughFor: string;
  ofcAlBeneficiariesWord: string;
  ofcAlCollectionPoint: string;
  ofcAlOpens: string;
  ofcAlClosesOptional: string;
  ofcAlRelease: string;
  ofcAlAwards: string;
  ofcAlSampleRound: string;
  ofcAlSamplePoint: string;
  ofcAlBeneficiary: string;
  ofcAlQuantity: string;
  ofcAlRound: string;
  ofcAlDistributing: string;
  ofcFaEveryHandsetCan: string;
  ofcFaSomeCannotCollect: string;
  ofcKycNotReviewed: string;
  ofcKycAlready: string;

  /**
   * Identity documents, the minimum app version held over every handset in
   * the field, and who may sign in to the portal.
   */
  ofcKycIdentityDocuments: string;
  ofcKycIntro: string;
  ofcKycNoDocuments: string;
  ofcKycApprovingBlind: string;
  ofcKycClose: string;
  ofcKycOpenNewTab: string;
  ofcKycChecksum: string;
  ofcKycSuperseded: string;
  ofcKycWhyRequired: string;
  ofcKycAccept: string;
  ofcKycNeedsPermission: string;
  ofcKycWhoLooked: string;
  ofcKycSupersededLabel: string;
  ofcKycDocument: string;
  ofcKycCaptured: string;
  ofcKycSize: string;
  ofcKycReviewed: string;
  ofcKycWho: string;
  ofcKycWhat: string;
  ofcFaIntro: string;
  ofcFaHandsetsInField: string;
  ofcFaPublishNewMinimum: string;
  ofcFaAppendsRecord: string;
  ofcFaMinimumVersion: string;
  ofcFaRecommendedVersion: string;
  ofcFaRecommendedHint: string;
  ofcFaWhyMoving: string;
  ofcFaTakesEffectOptional: string;
  ofcFaTakesEffectHint: string;
  ofcFaHistory: string;
  ofcFaMinimumInForce: string;
  ofcFaRecommended: string;
  ofcFaActiveHandsets: string;
  ofcFaBelowMinimum: string;
  ofcFaSampleReason: string;
  ofcFaBuild: string;
  ofcFaHandsets: string;
  ofcFaAgainstMinimum: string;
  ofcFaTakesEffect: string;
  ofcFaMinimum: string;
  ofcFaPublishedBy: string;
  ofcFaWhy: string;
  ofcUaRoleChangeIntro: string;
  ofcUaNewRole: string;
  ofcUaSelectRole: string;
  ofcUaWhyChanging: string;
  ofcUaNewAccountStatus: string;
  ofcUaSuspendedPending: string;
  ofcUaClosedLeft: string;
  ofcUaActiveLift: string;
  ofcUaTerritoryIntro: string;
  ofcUaTerritoriesCovered: string;
  ofcUaNoTerritory: string;
  ofcUaYourOwnAccess: string;
  ofcUaChangeAccess: string;
  ofcUaTerritories: string;
  ofcUaAccount: string;
  ofcUaSampleTransferred: string;
  ofcUaSampleLeft: string;
  ofcUaCannotBeUndone: string;
  ofcUaSampleTakingOver: string;
  ofcUaWillCoverNothing: string;
  ofcUaLastSignedIn: string;
  ofcPfFlagIsQuestion: string;
  ofcPfAgentsWithFlag: string;

  /**
   * Transaction and agent-performance reporting, and the filters both use.
   */
  ofcAllStatuses: string;
  ofcAllLgas: string;
  ofcFrom: string;
  ofcTo: string;
  ofcExportCsv: string;
  ofcRlExportLimit: string;
  ofcRlExportsNothing: string;
  ofcCwSave: string;
  enumIntegrationAlert: string;
  enumNeverCalled: string;
  enumHealthy: string;
  ofcNavPlatform: string;
  ofcPlTitle: string;
  ofcPlHint: string;
  ofcPlAllAnswering: string;
  ofcPlNeedingAttention: string;
  ofcPlService: string;
  ofcPlState: string;
  ofcPlLastAnswered: string;
  ofcPlInARow: string;
  ofcPlCalls: string;
  ofcPlNeverAnswered: string;
  ofcPlAdapter: string;
  ofcPlTin: string;
  ofcPlKyc: string;
  ofcPlVehicles: string;
  ofcPlBanks: string;
  ofcPlGateway: string;
  ofcPlNeverCalledBody: string;
  ofcPlDownBody: string;
  ofcPlDegradedBody: string;
  ofcPlAnsweringBody: string;
  ofcPlOutageHint: string;
  enumDegraded: string;
  enumDown: string;
  ofcOvChange: string;
  enumApprovalWaiting: string;
  enumCaseAssigned: string;
  enumCaseEscalated: string;
  enumCaseMention: string;
  enumSystemAlert: string;
  enumInfo: string;
  enumWarning: string;
  ofcNavInbox: string;
  ofcInHint: string;
  ofcInUnread: string;
  ofcInCritical: string;
  ofcInCriticalTitle: string;
  ofcInSeverity: string;
  ofcInKind: string;
  ofcInSubject: string;
  ofcInWhen: string;
  ofcInRead: string;
  ofcInMarkRead: string;
  ofcInReadAll: string;
  ofcInShowAll: string;
  ofcInShowUnread: string;
  ofcInToYourRole: string;
  ofcInNothing: string;
  ofcNavMyAccess: string;
  ofcAcSessions: string;
  ofcAcSessionsHint: string;
  ofcAcDevices: string;
  ofcAcActivity: string;
  ofcAcActivityHint: string;
  ofcAcActivityMine: string;
  ofcAcActedDays: string;
  ofcAcRefusedDays: string;
  ofcAcOnWhat: string;
  ofcAcOutcome: string;
  ofcAcNoActivity: string;
  ofcAcDevicesHint: string;
  ofcAcDevice: string;
  ofcAcUnknownDevice: string;
  ofcAcThisOne: string;
  ofcAcAddress: string;
  ofcAcSignedIn: string;
  ofcAcLastUsed: string;
  ofcAcFirstSeen: string;
  ofcAcLastSeen: string;
  ofcAcLiveSessions: string;
  ofcAcEnd: string;
  ofcAcEndThisOne: string;
  ofcAcEnded: string;
  ofcAcBlock: string;
  ofcAcUnblock: string;
  ofcAcBlockedBy: string;
  ofcAcNoSessions: string;
  ofcAcNoDevices: string;
  ofcCwUploadEvidence: string;
  ofcCwUploadHint: string;
  ofcCwUploadFile: string;
  ofcCwUploadWhat: string;
  ofcCwUploadWhere: string;
  ofcExportExcel: string;
  ofcExportPdf: string;
  ofcExportWorking: string;
  ofcDownloadCsv: string;
  ofcTxReceipt: string;
  ofcTxCreated: string;
  ofcPfIntro: string;
  ofcPfCollectedByAgents: string;
  ofcPfTaxpayersOnboarded: string;
  ofcPfAgentsWorked: string;
  ofcPfOpenFraudFlags: string;
  ofcPfFiguresUnreadable: string;
  ofcPfFiguresUnreadableBody: string;
  ofcPfCollected: string;
  ofcPfAverage: string;
  ofcPfOnboarded: string;
  ofcPfTins: string;
  ofcPfRenewals: string;
  ofcPfFailed: string;
  ofcPfReversed: string;
  ofcPfFlags: string;
  ofcPfDaysWorked: string;

  /**
   * Empty states. Every table in the portal has one, and an officer reads
   * more of these than of any other kind of string — a screen with nothing on
   * it is the normal case for most of the queues here.
   */
  ofcNoneConfirmedCollectionReachedGovernment: string;
  ofcNoneEveryoneTin: string;
  ofcNoneLgaEnoughActivityReport: string;
  ofcNoneMdaCollectionsRecorded: string;
  ofcNoneMdaConfigured: string;
  ofcNoneAccessRecorded: string;
  ofcNoneAgentCollectionsRecorded: string;
  ofcNoneAgentCollectedPeriod: string;
  ofcNoneAgentsCleared: string;
  ofcNoneAgentsMatchFilter: string;
  ofcNoneApplicationsWaitingReview: string;
  ofcNoneApprovalRequestsMatchFilter: string;
  ofcNoneAuditEntriesMatchThese: string;
  ofcNoneBackgroundJobsDeclared: string;
  ofcNoneBeneficiariesFound: string;
  ofcNoneClearanceEventsRecorded: string;
  ofcNoneCollectionsRecordedArea: string;
  ofcNoneDevicesRegistered: string;
  ofcNoneDistributionRoundCreated: string;
  ofcNoneDistributionsSetUp: string;
  ofcNoneDocuments: string;
  ofcNoneEndedRecordOwesAnything: string;
  ofcNoneFlowsAttemptedPeriod: string;
  ofcNoneFraudSignalsMatchFilter: string;
  ofcNoneGroupsRegistered: string;
  ofcNoneHandsetRegistered: string;
  ofcNoneIncentiveProgrammesCreated: string;
  ofcNoneIndividualLevyCollectedAnything: string;
  ofcNoneLanguageUseReported: string;
  ofcNoneLocalGovernmentRevenueCollected: string;
  ofcNoneObligationsRecordedAgainstTaxpayer: string;
  ofcNoneOfficersRecorded: string;
  ofcNoneOpenReconciliationExceptions: string;
  ofcNonePayoutRequests: string;
  ofcNoneRateHistory: string;
  ofcNoneRecordsMatchQuery: string;
  ofcNoneRefereeNominated: string;
  ofcNoneRefereeRiskFlagsOpen: string;
  ofcNoneRefereeSupportsMoreApplicant: string;
  ofcNoneRefundOutstanding: string;
  ofcNoneRevenueCollectedPeriod: string;
  ofcNoneRevenueItemsConfigured: string;
  ofcNoneScreensReported: string;
  ofcNoneSettlementsRecorded: string;
  ofcNoneTicketsMatchFilter: string;
  ofcNoneTrainingRecords: string;
  ofcNoneTransactionsMatchTheseFilters: string;
  ofcNoneVehiclesRecordedAgainstTaxpayer: string;
  ofcNoneNobodyAwardedRound: string;
  ofcNoneNobodyAwardedRound2: string;
  ofcNoneNobodyRecordedGroup: string;
  ofcNoneNobodyArrearsFilter: string;
  ofcNoneNobodyRegisteredFilter: string;
  ofcNoneNone: string;
  ofcNoneNothingCollectedFilter: string;
  ofcNoneNothingPublished: string;
  ofcNoneNothingWaiting: string;
  ofcNoneAuthorityAcknowledgedRenewal: string;
  ofcNoneOfflineQueueUsedPeriod: string;

  /**
   * Agent clearance: the queue, one agent's file, the six status axes, and
   * the decisions an officer records against their own name.
   */
  ofcAgAwaitingGovernmentReview: string;
  ofcAgApplicantsCompleted: string;
  ofcAgAllAgents: string;
  ofcAgSixAxes: string;
  ofcAgOperationalStatus: string;
  ofcAgAll: string;
  ofcAgActive: string;
  ofcAgInactive: string;
  ofcAgSuspendedStatus: string;
  ofcAgBackToAgents: string;
  ofcAgClearanceChecklist: string;
  ofcAgEveryItemSatisfied: string;
  ofcAgNoKycSubmitted: string;
  ofcAgRefereeHistoryKept: string;
  ofcAgClear: string;
  ofcAgReject: string;
  ofcAgDevices: string;
  ofcAgDevicesBody: string;
  ofcAgSuspend: string;
  ofcAgRestore: string;
  ofcAgRevoke: string;
  ofcAgDecision: string;
  ofcAgDecisionRecorded: string;
  ofcAgReasonMinimum: string;
  ofcAgApproveApplication: string;
  ofcAgRequestMoreInformation: string;
  ofcAgAssignTerritory: string;
  ofcAgSelectTerritory: string;
  ofcAgTerritoryRequired: string;
  ofcAgActivateAgent: string;
  ofcAgActivationBlocked: string;
  ofcAgMoveTerritory: string;
  ofcAgMoveTerritoryBody: string;
  ofcAgReassignTerritory: string;
  ofcAgSuspendAgent: string;
  ofcAgClearanceHistory: string;
  ofcAgRefereeRiskFlags: string;
  ofcAgRefereeRiskBody: string;
  ofcAgWhatYouFound: string;
  ofcAgLookingIntoIt: string;
  ofcAgUpheld: string;
  ofcAgDismissed: string;
  ofcAgRefereesMultiple: string;
  ofcAgBankAccountChanges: string;
  ofcAgBankChangeBody: string;
  ofcAgNoBankChanges: string;
  ofcAgAskBankAgain: string;
  ofcAgRefuse: string;
  ofcAgApplicationsReceived: string;
  ofcAgReadyForReview: string;
  ofcAgBothCleared: string;
  ofcAgActiveAgents: string;
  ofcAgKycPending: string;
  ofcAgAwaitingApplicant: string;
  ofcAgKycCleared: string;
  ofcAgRefereePending: string;
  ofcAgRefereeFailed: string;
  ofcAgApplicationState: string;
  ofcAgAccessStage: string;
  ofcAgMayCollectRevenue: string;
  ofcAgOutstanding: string;
  ofcAgTotalReferees: string;
  ofcAgPending: string;
  ofcAgCleared: string;
  ofcAgFailedRejected: string;
  ofcAgBankDifferentName: string;
  ofcAgApplicantsSupported: string;
  ofcAgApplication: string;
  ofcAgSubmitted: string;
  ofcAgCode: string;
  ofcAgKyc: string;
  ofcAgOperational: string;
  ofcAgCategory: string;
  ofcAgRelationship: string;
  ofcAgResponded: string;
  ofcAgModule: string;
  ofcAgTitleHeading: string;
  ofcAgScore: string;
  ofcAgVersion: string;
  ofcAgEvent: string;
  ofcAgReason: string;
  ofcAgSignal: string;
  ofcAgSeverity: string;
  ofcAgDetail: string;
  ofcAgSampleKycNote: string;
  ofcAgSampleRefereeNote: string;
  ofcRhBlockedCount: string;
  ofcRhInvoicesStillOpen: string;
  colShareTitle: string;
  colShareBody: string;
  ofcRhNothingWaiting: string;
  ofcNothingToShow: string;

  /**
   * The figures on the role home screen, and the queues an officer works
   * straight from it.
   */
  ofcRhActiveRecords: string;
  ofcRhRegisteredByBoth: string;
  ofcRhTinNoTracking: string;
  ofcRhCollectedForCouncils: string;
  ofcRhAccruedNotPaid: string;
  ofcRhExpectedLessReceived: string;
  ofcRhBankPlatformDisagree: string;
  ofcRhHashChainedShort: string;
  ofcRhEntriesSinceMidnight: string;
  ofcRhRaisedNotReviewed: string;
  ofcRhAgentsAwaitingClearance: string;
  ofcRhApplicationsComplete: string;
  ofcRhAgentsAskedForMore: string;
  ofcRhWaitingOnApplicant: string;
  ofcRhDevicesAwaitingApproval: string;
  ofcRhAgentNeedsHandset: string;
  ofcRhSupervisorsNoTerritory: string;
  ofcRhNoFiguresUntilTerritory: string;
  ofcRhItemsNoRate: string;
  ofcRhNotCollectableYet: string;
  ofcRhMdasCollectingNothing: string;
  ofcRhNoItemForMda: string;
  ofcRhOfficersWithAccess: string;
  ofcRhExcludingFieldAgents: string;
  ofcRhSupportTicketsOpen: string;
  ofcRhRaisedByAgents: string;
  ofcRhTinApplicationsFailed: string;
  ofcRhRegisterRefusedThese: string;
  ofcRhAppliedNotIssued: string;
  ofcRhCorrectionsAwaiting: string;
  ofcRhSomeoneAskedChange: string;
  ofcRhInvoicesUnpaid: string;
  ofcRhRaisedStillOpen: string;
  ofcRhInvoicesExpired: string;
  ofcRhNeverPaidOutOfTime: string;
  ofcRhRegisteredThisWeek: string;
  ofcRhNewTaxpayers: string;
  ofcRhTaxpayersOnRegister: string;
  ofcRhReconciliationExceptions: string;
  ofcRhDisagreeAboutThese: string;
  ofcRhSettlementsUnreconciled: string;
  ofcRhReceivedNotMatched: string;
  ofcRhPayoutsToApprove: string;
  ofcRhAgentsWaitingShort: string;
  ofcRhRefundsOwed: string;
  ofcRhMoneyStateShouldNotHave: string;
  ofcRhMoneyBackOutQuery: string;
  ofcRhActionsRefusedWeek: string;
  ofcRhSomeoneTriedNotPermitted: string;
  ofcRhRateChangesMonth: string;
  ofcRhEveryChangeCharged: string;
  ofcRhReceiptsCheckedPublic: string;
  ofcRhVerificationLookups: string;
  ofcRhAuditEntriesToday: string;
  ofcRhHashChainedLong: string;
  ofcRhAuditEntriesTotal: string;
  ofcRhSincePlatformStarted: string;
  ofcRhTaxpayersOnRecord: string;
  ofcRhWaiting: string;
  ofcRhAgent: string;
  ofcRhWaitingSince: string;
  ofcRhApprovedFromHome: string;
  ofcRhRegistered: string;
  ofcRhOfficer: string;
  ofcRhWhyFailed: string;
  ofcRhExpires: string;
  ofcRhKind: string;
  ofcRhExpected: string;
  ofcRhReceived: string;
  ofcRhRaisedHeading: string;
  ofcRhRequested: string;
  ofcRhWhen: string;
  ofcRhRole: string;
  ofcRhAttempted: string;
  ofcRhAgainst: string;
  ofcRhOutcome: string;

  /**
   * The home screen, which differs per role: what is waiting on this officer
   * and what their job is for.
   */
  ofcRhToday: string;
  ofcRhNewThisWeek: string;
  ofcRhOpen: string;
  ofcRhOpenFile: string;
  ofcRhApprove: string;
  ofcRhTaxpayers: string;
  ofcRhExceptions: string;
  ofcRhAuditEntries: string;
  ofcRhAgentsWaiting: string;
  ofcRhAgentsWaitingBody: string;
  ofcRhClearanceBody: string;
  ofcRhHandsetsWaiting: string;
  ofcRhHandsetsBody: string;
  ofcRhCommissionPayouts: string;
  ofcRhCommissionLiability: string;
  ofcRhAssessedUnpaid: string;
  ofcRhTinsOutstanding: string;
  ofcRhTinsBody: string;
  ofcRhTinRefused: string;
  ofcRhTheRegister: string;
  ofcRhRegisterBody: string;
  ofcRhMoneyInOut: string;
  ofcRhMoneyBody: string;
  ofcRhOwedToCouncils: string;
  ofcRhSettlementVariance: string;
  ofcRhBankDisagree: string;
  ofcRhReconciliationOpen: string;
  ofcRhReconciliationBody: string;
  ofcRhExceptionQueueBody: string;
  ofcRhWorkExceptionQueue: string;
  ofcRhReversedRefunded: string;
  ofcRhMoneyBackOut: string;
  ofcRhReversedBody: string;
  ofcRhFraudOpen: string;
  ofcRhInvoicesExpiring: string;
  ofcRhInvoicesBody: string;
  ofcRhRefusedActions: string;
  ofcRhRefusedBody: string;
  ofcRhSupervisorsNothing: string;
  ofcRhSupervisorsBody: string;
  ofcRhAssignTerritories: string;
  ofcRhWhatToExamine: string;
  ofcRhReadOnlyBody: string;
  ofcRhAdminBody: string;
  ofcRhAdminIntro: string;
  ofcRevenueAdministration: string;
  ofcDistributionRound: string;
  ofcLanguage: string;

  /**
   * The officer portal: its navigation, the frame around every screen, and
   * the sign-in that turns somebody away when they belong in the agent app.
   */
  ofcNavDashboard: string;
  ofcNavIntelligence: string;
  ofcNavRevenue: string;
  ofcNavLevies: string;
  ofcNavTransactions: string;
  ofcNavAgents: string;
  ofcNavReferees: string;
  ofcNavPerformance: string;
  ofcNavReconciliation: string;
  ofcNavCommissions: string;
  ofcNavApprovals: string;
  ofcNavFraud: string;
  ofcNavSupport: string;
  ofcNavOutstanding: string;
  ofcNavAudit: string;
  ofcNavUsage: string;
  ofcNavCatalogue: string;
  ofcNavProgrammes: string;
  ofcNavGroups: string;
  ofcNavTaxpayerRecords: string;
  ofcNavUsers: string;
  ofcNavFieldApp: string;
  ofcNavAllocations: string;

  // ---------------------------------------------------------------------
  // The command centre: one search box, one work queue, one transaction.
  //
  // Added with the officer command centre. These name three surfaces that
  // did not exist — a search that resolves any government reference, a case
  // that carries work between departments, and the whole story of one
  // collection on a single screen.
  // ---------------------------------------------------------------------
  ofcNavMyWork: string;
  ofcNavCases: string;
  ofcGroupYourDesk: string;
  ofcSearchLabel: string;
  ofcSearchPlaceholder: string;
  ofcSearchSearching: string;
  ofcSearchNoResults: string;
  ofcSearchHint: string;
  ofcSearchTransaction: string;
  ofcSearchTaxpayer: string;
  ofcSearchAgent: string;
  ofcSearchOfficer: string;
  ofcSearchInvoice: string;
  ofcSearchReceipt: string;
  ofcSearchPayment: string;
  ofcSearchAssessment: string;
  ofcSearchVehicle: string;
  ofcSearchRevenueItem: string;
  ofcSearchPlace: string;
  ofcSearchCase: string;
  ofcMwIntro: string;
  ofcMwAssigned: string;
  ofcMwAssignedBody: string;
  ofcMwOpened: string;
  ofcMwOpenedBody: string;
  ofcMwMentions: string;
  ofcMwMentionsBody: string;
  ofcMwDepartment: string;
  ofcMwDepartmentBody: string;
  ofcMwApprovals: string;
  ofcMwExceptions: string;
  ofcMwFlags: string;
  ofcMwOverdue: string;
  ofcMwNothing: string;
  ofcMwOpenQueue: string;
  ofcCwTitle: string;
  ofcCwIntro: string;
  ofcCwOpenCase: string;
  ofcCwStatus: string;
  ofcNavRoles: string;
  ofcRlTitle: string;
  ofcRlIntro: string;
  ofcRlCatalogueNote: string;
  ofcRlRole: string;
  ofcRlOfficers: string;
  ofcRlPermissions: string;
  ofcRlSystemRole: string;
  ofcRlPortalRole: string;
  ofcRlGrant: string;
  ofcRlRevoke: string;
  ofcRlGrantReason: string;
  ofcRlRevokeReason: string;
  ofcRlRevokeWarning: string;
  ofcRlNewRole: string;
  ofcRlRoleName: string;
  ofcRlRoleLabel: string;
  ofcRlCopyFrom: string;
  ofcRlCopyFromBody: string;
  ofcRlRetire: string;
  ofcRlRestore: string;
  ofcRlIsPortalRole: string;
  ofcRlSignedOut: string;
  ofcRlSearchPermission: string;
  ofcNoneRoles: string;
  enumClosing: string;
  ofcNavPeriods: string;
  enumClean: string;
  enumException: string;
  enumNotAvailable: string;
  enumRandom: string;
  enumSystematic: string;
  enumHighestValue: string;
  enumDrawn: string;
  enumInReview: string;
  enumGenerated: string;
  enumSigned: string;
  enumTransactionAudit: string;
  enumAgentActivity: string;
  enumRevenueCollection: string;
  enumLgaPerformance: string;
  enumPaymentReconciliation: string;
  enumUserActivity: string;
  enumAnomaly: string;
  enumAuditSample: string;
  enumRevenueTarget: string;
  enumPeriodClosing: string;
  enumDataChange: string;
  ofcNavWorkbench: string;
  ofcWbSamplesDrawn: string;
  ofcWbItemsOutstanding: string;
  ofcWbExceptionsFound: string;
  ofcWbReportsHeld: string;
  ofcWbSamples: string;
  ofcWbSamplesHint: string;
  ofcWbSampleNumber: string;
  ofcWbTitle: string;
  ofcWbMethod: string;
  ofcWbMethodRandom: string;
  ofcWbMethodSystematic: string;
  ofcWbMethodHighestValue: string;
  ofcWbDrawn: string;
  ofcWbPending: string;
  ofcWbExceptions: string;
  ofcWbDrawnAt: string;
  ofcWbDrawnBy: string;
  ofcWbNoSamples: string;
  ofcWbDraw: string;
  ofcWbDrawHint: string;
  ofcWbSize: string;
  ofcWbFrom: string;
  ofcWbTo: string;
  ofcWbMinimumNaira: string;
  ofcWbDrawIsFinal: string;
  ofcWbDrawnNotice: string;
  ofcWbSeed: string;
  ofcWbPopulation: string;
  ofcWbPosition: string;
  ofcWbOutcome: string;
  ofcWbFinding: string;
  ofcWbRecord: string;
  ofcWbNoItems: string;
  ofcWbCompleteHint: string;
  ofcWbComplete: string;
  ofcWbReports: string;
  ofcWbReportsHint: string;
  ofcWbReportNumber: string;
  ofcWbReportType: string;
  ofcWbRows: string;
  ofcWbPeriod: string;
  ofcWbGeneratedAt: string;
  ofcWbSignedBy: string;
  ofcWbChecksum: string;
  ofcWbOpenReport: string;
  ofcWbWhatWasFrozen: string;
  ofcWbRecomputed: string;
  ofcWbStored: string;
  ofcWbChecksumAgrees: string;
  ofcWbChecksumDiffers: string;
  ofcWbPayloadRows: string;
  ofcWbViewIsRecorded: string;
  ofcWbNoPayload: string;
  ofcWbAltered: string;
  ofcWbAlteredTitle: string;
  ofcWbAlteredBody: string;
  ofcWbNoReports: string;
  ofcWbGenerate: string;
  ofcWbGenerateHint: string;
  ofcWbGenerated: string;
  ofcWbSign: string;
  ofcWbWithdraw: string;
  ofcWbActions: string;
  ofcWbClose: string;
  ofcWbReference: string;
  ofcWbTaxpayer: string;
  ofcWbAmount: string;
  ofcPeTitle: string;
  ofcPeIntro: string;
  ofcPeOpenPeriod: string;
  ofcPePeriod: string;
  ofcPeCollected: string;
  ofcPeSettled: string;
  ofcPeCommission: string;
  ofcPeTransactions: string;
  ofcPeClose: string;
  ofcPeBeginClosing: string;
  ofcPeReopen: string;
  ofcPeClosedBy: string;
  ofcPeReopenedBy: string;
  ofcPeClosingNote: string;
  ofcPeReopenReason: string;
  ofcPeNotReady: string;
  ofcPeNotReadyBody: string;
  ofcPeOverride: string;
  ofcPeFiguresUnknown: string;
  ofcPeFiguresUnknownBody: string;
  ofcPeUnreconciled: string;
  ofcPePendingPayments: string;
  ofcPeFiguresNow: string;
  ofcPeFrozen: string;
  ofcPeReopenSeparate: string;
  ofcNonePeriods: string;
  enumSupervisorChange: string;
  enumRoleChange: string;
  ofcNavOrganisation: string;
  ofcOrTitle: string;
  ofcOrIntro: string;
  ofcOrDepartments: string;
  ofcOrOffices: string;
  ofcOrOfficesBody: string;
  ofcOrNewDepartment: string;
  ofcOrNewOffice: string;
  ofcOrCode: string;
  ofcOrFunction: string;
  ofcOrHead: string;
  ofcOrParent: string;
  ofcOrOfficers: string;
  ofcOrOpenCases: string;
  ofcOrCovers: string;
  ofcOrClose: string;
  ofcOrPosting: string;
  ofcOrPostingBody: string;
  ofcOrMoveOfficer: string;
  ofcOrDepartment: string;
  ofcListCouldNotLoad: string;
  ofcOrOffice: string;
  ofcOrSupervisor: string;
  ofcOrJobTitle: string;
  ofcOrStaffNumber: string;
  ofcOrWhyMoving: string;
  ofcOrEffectiveFrom: string;
  ofcOrHistory: string;
  ofcOrHistoryBody: string;
  ofcOrNobody: string;
  ofcOrUnposted: string;
  ofcCwEscalate: string;
  ofcCwEscalateBody: string;
  ofcCwEscalateReason: string;
  ofcCwEscalatedTo: string;
  ofcNoneDepartments: string;
  ofcNoneOffices: string;
  ofcNoneTransfers: string;
  enumCollection: string;
  enumFinance: string;
  enumAudit: string;
  enumEnforcement: string;
  enumTaxpayerServices: string;
  enumAdministration: string;
  enumTechnology: string;
  enumPosting: string;
  enumDepartment: string;
  enumOffice: string;
  enumTerritory: string;
  ofcDbByChannel: string;
  ofcDbByChannelBody: string;
  ofcDbByTaxpayerType: string;
  ofcDbByItem: string;
  ofcDbByItemBody: string;
  ofcDbReversed: string;
  ofcDbRefunded: string;
  ofcDbAgentsOnline: string;
  ofcDbAgentsOnlineHint: string;
  ofcDbAgentsSuspended: string;
  ofcDbExpectedRevenue: string;
  ofcDbExpectedRevenueHint: string;
  ofcNavTaxpayerAnalytics: string;
  ofcTaTitle: string;
  ofcTaIntro: string;
  ofcTaActive: string;
  ofcTaActiveHint: string;
  ofcTaInactive: string;
  ofcTaNeverPaid: string;
  ofcTaTotal: string;
  ofcTaNewThisMonth: string;
  ofcTaAverageLifetime: string;
  ofcTaFrequency: string;
  ofcTaFrequencyBody: string;
  ofcTaByLga: string;
  ofcTaByCategory: string;
  ofcTaTaxpayersAssessed: string;
  ofcTaTaxpayersPaid: string;
  ofcTaAveragePayment: string;
  ofcTaComplianceScore: string;
  ofcTaOutstanding: string;
  ofcCmByPlace: string;
  ofcCmByPeriod: string;
  ofcCmAccrued: string;
  ofcCmPaidOut: string;
  ofcCmOutstandingCommission: string;
  enumOnce: string;
  enumTwoToThree: string;
  enumFourToEleven: string;
  enumTwelveOrMore: string;
  ofcDbYesterday: string;
  ofcDbThisWeek: string;
  ofcDbVsYesterday: string;
  ofcDbVsLastWeek: string;
  ofcDbVsLastMonth: string;
  ofcDbVsLastYear: string;
  ofcDbNoComparison: string;
  ofcDbLastMonthWhole: string;
  ofcDbDeclining: string;
  ofcDbDecliningBody: string;
  ofcDbNoneDeclining: string;
  ofcDbChange: string;
  ofcDbShareOfMonth: string;
  ofcRvAverageTransaction: string;
  ofcRvCompliance: string;
  ofcRvComplianceHint: string;
  ofcPfGrowth: string;
  ofcPfCategories: string;
  enumCategory: string;
  enumItem: string;
  enumLga: string;
  ofcNavTargets: string;
  ofcTgTitle: string;
  ofcTgIntro: string;
  ofcTgSetTarget: string;
  ofcTgScope: string;
  ofcTgScopeState: string;
  ofcTgScopeLga: string;
  ofcTgScopeCategory: string;
  ofcTgScopeItem: string;
  ofcTgScopeAgent: string;
  ofcTgPeriod: string;
  ofcTgPeriodDaily: string;
  ofcTgPeriodWeekly: string;
  ofcTgPeriodMonthly: string;
  ofcTgPeriodQuarterly: string;
  ofcTgPeriodAnnual: string;
  ofcTgAmount: string;
  ofcTgNeedAmount: string;
  ofcTgNeedLga: string;
  ofcTgNeedCategory: string;
  ofcTgNote: string;
  ofcTgTarget: string;
  ofcTgCollected: string;
  ofcTgAchievement: string;
  ofcTgGap: string;
  ofcTgThroughPeriod: string;
  ofcTgRollup: string;
  ofcTgRollupBody: string;
  ofcTgStateTarget: string;
  ofcTgApportioned: string;
  ofcTgLgasWithout: string;
  ofcTgWithdraw: string;
  ofcTgWithdrawReason: string;
  ofcTgSuperseded: string;
  ofcTgSetBy: string;
  ofcTgShowSuperseded: string;
  ofcNoneTargetsSet: string;
  ofcFcTitle: string;
  ofcFcNotATarget: string;
  ofcFcProjected: string;
  ofcFcBasis: string;
  ofcFcConfidence: string;
  ofcFcSeasonalShare: string;
  ofcFcComparablePeriods: string;
  ofcFcProjectedAchievement: string;
  forecastSeasonal: string;
  forecastRunRate: string;
  forecastTooEarlyInCurve: string;
  forecastPeriodComplete: string;
  forecastNotStarted: string;
  enumSeasonal: string;
  enumRunRate: string;
  enumInsufficientHistory: string;
  enumAwaitingInformation: string;
  enumEscalated: string;
  enumInvestigating: string;
  enumAgentConduct: string;
  enumCommissionQuery: string;
  enumDataCorrection: string;
  enumFraudInvestigation: string;
  enumGeneral: string;
  enumReconciliationException: string;
  enumRevenueAnomaly: string;
  enumSystemIssue: string;
  enumTaxpayerDispute: string;
  enumApproval: string;
  enumFraudFlag: string;
  enumManual: string;
  enumSupportTicket: string;
  enumAssignment: string;
  enumComment: string;
  enumDueDateChange: string;
  enumEscalation: string;
  enumEvidence: string;
  enumNote: string;
  enumPriorityChange: string;
  enumResolution: string;
  enumRouted: string;
  enumStatusChange: string;
  ofcCwSubject: string;
  ofcCwDescription: string;
  ofcCwCategory: string;
  ofcCwRisk: string;
  ofcCwPriority: string;
  ofcCwDepartment: string;
  ofcCwAssignee: string;
  ofcCwNobody: string;
  ofcCwAnyDepartment: string;
  ofcCwDue: string;
  ofcCwOnlyOpen: string;
  ofcCwOnlyOverdue: string;
  ofcCwOpenedBy: string;
  ofcCwCaseNumber: string;
  ofcCwComments: string;
  ofcCwEvidence: string;
  ofcCwBackToQueue: string;
  ofcCwHistory: string;
  ofcCwAddComment: string;
  ofcCwInternalNote: string;
  ofcCwMention: string;
  ofcCwPost: string;
  ofcCwMoveCase: string;
  ofcCwChangeStatus: string;
  ofcCwResolution: string;
  ofcCwResolutionRequired: string;
  ofcCwSaved: string;
  ofcCwNotYours: string;
  ofcCwAbout: string;
  ofcCwWhy: string;
  ofcReasonAtLeastChars: string;
  ofcCwSubjectTooShort: string;
  ofcCwSampleSubject: string;
  ofcCwSampleDescription: string;
  ofcCwAppendOnly: string;
  ofcNoneCasesMatchFilter: string;
  ofcT3Title: string;
  ofcT3Intro: string;
  ofcT3Find: string;
  ofcT3FindBody: string;
  ofcT3Chain: string;
  ofcT3Assessment: string;
  ofcT3Invoice: string;
  ofcT3Payment: string;
  ofcT3Gateway: string;
  ofcT3Settlement: string;
  ofcT3Reconciliation: string;
  ofcT3Commission: string;
  ofcT3Refunds: string;
  ofcT3Timeline: string;
  ofcT3TimelineBody: string;
  ofcT3Platform: string;
  ofcT3OfficerAction: string;
  ofcT3Before: string;
  ofcT3After: string;
  ofcT3CasesAndFlags: string;
  ofcT3OpenCaseAbout: string;
  ofcT3Withheld: string;
  ofcT3WithheldBody: string;
  ofcT3NoPayment: string;
  ofcT3NoReceipt: string;
  ofcT3NoSettlement: string;
  ofcT3NoCommission: string;
  ofcT3NoReconciliation: string;
  ofcT3Channel: string;
  ofcT3Where: string;
  ofcT3ServiceCharge: string;
  ofcT3Verified: string;
  ofcT3NothingLinked: string;
  ofcGroupAdministration: string;
  ofcGroupAgentsProgrammes: string;
  ofcGroupAssessment: string;
  ofcGroupConfiguration: string;
  ofcGroupEverything: string;
  ofcGroupExamination: string;
  ofcGroupMyTerritory: string;
  ofcGroupOversight: string;
  ofcGroupRevenueHere: string;
  ofcGroupRevenue: string;
  ofcGroupSettlement: string;
  ofcGroupTheMoney: string;
  ofcGroupTheRegister: string;
  ofcGroupWhatCharged: string;
  ofcGroupWhoCollected: string;
  ofcGroupWhoDidIt: string;
  ofcPortalName: string;
  ofcStateGovernment: string;
  ofcReturnToDashboard: string;
  ofcSignOut: string;
  ofcPageNotFound: string;
  ofcReadOnly: string;
  ofcDailyTrend: string;
  ofcNoDataForPeriod: string;
  ofcLoginTitle: string;
  ofcLoginPhone: string;
  ofcLoginPassword: string;
  ofcLoginMonitored: string;
  ofcLoginWrongPlace: string;
  ofcLoginSignInWorked: string;
  ofcLoginUseAgentApp: string;
  shellSyncFailed: string;
  grpNameHint: string;
  grpCommunityHint: string;
  grpLeaderNameHint: string;
  grpLeaderPhoneHint: string;
  grpMemberCountHint: string;
  stepUpCodeFailed: string;
  stepUpAuthoriseFailed: string;

  /**
   * The verdict the public verification page prints in large type. Everything
   * under it was translated; the one word most readers actually take in was not.
   */
  pubVerdictValid: string;
  pubVerdictAcknowledgement: string;
  pubVerdictReversed: string;
  pubVerdictNotFound: string;
  pubVerdictInvalid: string;
  colChangeChoice: string;
  moreMonths: string;
  supGetHelpHint: string;
  authKeepItSafe: string;

  /**
   * The profile screen: vehicle renewal, commission, the printer, push, and
   * asking for a different commission account.
   */
  moreSearchVehicleFirst: string;
  moreVehicleSavedBody: string;
  moreVehicleCaptureBody: string;
  moreOwnerName: string;
  moreOwnerNameHint: string;
  moreOwnerPhone: string;
  moreMotorcycle: string;
  moreTricycle: string;
  moreRegistrationLabel: string;
  moreOwnerLabel: string;
  moreVehicleLabel: string;
  moreChassis: string;
  moreCurrentExpiry: string;
  moreAuthorityConfirmed: string;
  moreEnteredManually: string;
  moreChooseRenewal: string;
  moreFindPayingTaxpayer: string;
  moreReceiptsIssuedAfter: string;
  morePendingWord: string;
  morePaidWord: string;
  moreTransactionsWord: string;
  moreOwedBackBody: string;
  moreOwedBackDeducted: string;
  moreConfirmPayout: string;
  moreCommissionAvailableWhen: string;
  moreDeviceId: string;
  morePrinterHint: string;
  moreConnectedDevice: string;
  morePaperWidth: string;
  moreNone: string;
  morePaper58: string;
  morePaper80: string;
  morePrintTestSlip: string;
  morePairPrinter: string;
  moreNoWebBluetooth: string;
  morePrinterConnected: string;
  morePrinterConnectFailed: string;
  morePrinterTestSent: string;
  morePrinterPrintFailed: string;
  morePushHint: string;
  morePermission: string;
  morePushEngine: string;
  moreSupported: string;
  moreUnavailable: string;
  morePushDisabled: string;
  morePushActive: string;
  morePushNotGranted: string;
  morePushFailed: string;
  moreChangeBankHint: string;
  moreSupportHint: string;
  moreSavedRecordsHint: string;
  moreBack: string;
  moreCommissionOnlyVerified: string;
  moreBankMustConfirm: string;
  moreToldEitherWayBody: string;
  morePaidIntoNow: string;
  moreWouldChangeTo: string;
  moreNameOnNewAccount: string;
  moreBankCheck: string;
  moreBankCheckConfirmed: string;
  moreBankCheckConfirmedAs: string;
  moreBankCheckWaiting: string;
  moreBankCheckNotConfirmed: string;
  moreBankCheckNotConfirmedBecause: string;
  moreReasonYouGave: string;
  moreBankLabel: string;
  moreBankCodeHint: string;
  moreAccountNameHint: string;
  moreNeedBankName: string;
  moreNeedBankCode: string;
  moreNeedAccountName: string;
  moreNeedAccountNumber: string;
  moreNeedReason: string;

  /**
   * Taking one payment, and everything the agent is shown about it afterwards.
   */
  colNeedBaseAmount: string;
  colNoTin: string;
  colBasisAmountHint: string;
  colTaxpayerLabel: string;
  colRevenueLabel: string;
  colGovernmentRevenue: string;
  colServiceCharge: string;
  colTotalPayable: string;
  colInvoiceLabel: string;
  colPaymentStatus: string;
  colGatewayReference: string;
  colPrinting: string;
  colPrinted: string;
  colPrintFailed: string;
  colCheckPrinter: string;
  colPrintBluetooth: string;
  colReceiptCopied: string;
  colPreparingInvoice: string;
  colGiveInvoice: string;
  colInvoiceHint: string;
  colInvoiceValidUntil: string;
  colInvoiceGiveReference: string;
  colInvoiceNoReference: string;
  colCheckingPayment: string;
  colCheckPaymentStatus: string;
  colStartingPayment: string;
  colStartPayment: string;
  colChargeRaisedTitle: string;
  colChargeRaisedBody: string;
  colOpenCharge: string;
  colDevGateway: string;
  colDevGatewayHint: string;
  colSimulateSuccess: string;
  colSimulateFailure: string;
  grpConfirmedMembers: string;

  /**
   * The rest of the agent's screens: the home tiles, the support form, the
   * receipt check, allocations, groups, signing in, and the app shell.
   */
  homeQaRenewVehicle: string;
  homeQaFindTaxpayer: string;
  homeQaCheckReceipt: string;
  homeQaHandOut: string;
  homeQaGroups: string;
  homeGoodMorning: string;
  homeGoodAfternoon: string;
  homeGoodEvening: string;
  homeAccountSuspended: string;
  homeApplicationProcessing: string;
  homeTransactions: string;
  homeCommissionWord: string;
  homeRegisteredWord: string;
  homePendingTitle: string;
  homePendingBody: string;
  supNormal: string;
  supProblemCameBack: string;
  supReportItAgain: string;
  supKeepsHistory: string;
  supCatPayment: string;
  supCatReceipt: string;
  supCatAssessment: string;
  supCatTin: string;
  supCatVehicle: string;
  supCatTechnical: string;
  supCatComplaint: string;
  supCatUnauthorised: string;
  supCatUnauthorisedHint: string;
  supCatMisconduct: string;
  supCatMisconductHint: string;
  supWhatHappenedHint: string;
  supTransactionHint: string;
  supSending: string;
  supSendToPsirs: string;
  supSendWord: string;
  supReopenedNotice: string;
  supAbout: string;
  supTransactionLabel: string;
  supReported: string;
  verifyScanHint: string;
  verifyOfflineBody: string;
  verifyCouldNotReach: string;
  verifyNotAReceiptCode: string;
  verifyCameraFailed: string;
  verifyChecking: string;
  verifyCheckThisCode: string;
  verifyRevenueItem: string;
  verifyIssued: string;
  verifyFingerprint: string;
  verifyMatchesOriginal: string;
  verifyNotConfirmed: string;
  allocScanHint: string;
  allocOfflineBody: string;
  allocFailed: string;
  allocNotACode: string;
  allocCameraFailed: string;
  allocRecordCollection: string;
  allocGive: string;
  grpListHint: string;
  grpEmpty: string;
  grpRegisterHint: string;
  grpNoAssessmentBody: string;
  grpMemberHint: string;
  grpAskLeaderHint: string;
  grpRegisterGroup: string;
  grpRecordThisMember: string;
  grpSendLeaderLink: string;
  grpFarmers: string;
  grpMarket: string;
  grpTransport: string;
  grpArtisan: string;
  grpTraders: string;
  grpFisheries: string;
  grpLivestock: string;
  grpOther: string;
  grpLocalGovernment: string;
  grpLeader: string;
  grpMembersConfirmed: string;
  grpAwaitingLeader: string;
  authSigningIn: string;
  authPasswordHint: string;
  authPasswordPatternHint: string;
  authBankName: string;
  authAccountName: string;
  authAccountNumber: string;
  authTenDigits: string;
  authSubmitting: string;
  authSubmitApplication: string;
  authPsirsFull: string;
  authRevenueNeverToAgent: string;
  stepUpNoSms: string;
  shellMain: string;
  shellNothingLost: string;
  shellRestoring: string;
  shellAgentTitle: string;
  shellAgentBrand: string;
  uiLoading: string;

  /**
   * The taxpayer register: finding somebody, registering somebody, and the
   * profile an agent is allowed to see afterwards.
   */
  tpFindTaxpayer: string;
  tpSearchHint: string;
  tpSearchPlaceholder: string;
  tpSearchByNamePhoneTin: string;
  tpNoTinYet: string;
  tpRegisterNew: string;
  tpTaxpayerPaying: string;
  tpUnnamedTaxpayer: string;
  tpChooseSomeoneElse: string;
  tpStepTin: string;
  tpStepDetails: string;
  tpStepIdentification: string;
  tpStepAddress: string;
  tpStepActivity: string;
  tpStepReview: string;
  tpStepOf: string;
  tpSavedOnDevice: string;
  tpNotYetSent: string;
  tpSavedOfflineBody: string;
  tpBackToHome: string;
  tpTaxpayerRegistered: string;
  tpGiveTinToTaxpayer: string;
  tpTinRequested: string;
  tpTinPending: string;
  tpCollectRevenue: string;
  tpEnumerate: string;
  agEnTitle: string;
  agEnIntro: string;
  agEnWho: string;
  agEnPremises: string;
  agEnPremisesHint: string;
  agEnEquipment: string;
  agEnEquipmentHint: string;
  agEnPeople: string;
  agEnPeopleHint: string;
  agEnSector: string;
  agEnGroup: string;
  agEnGroupHint: string;
  agEnNoGroupChosen: string;
  agEnNoGroupsTitle: string;
  agEnNoGroups: string;
  agEnNoAmountTitle: string;
  agEnNoAmount: string;
  agEnChoose: string;
  agEnSave: string;
  agEnSaving: string;
  agEnRecordedTitle: string;
  agEnBand: string;
  agEnWhatHappensNextTitle: string;
  agEnNextWithLeader: string;
  agEnNextWithoutLeader: string;
  agEnBackToTaxpayer: string;
  agEnQueuedTitle: string;
  agEnQueuedNext: string;
  agEnBandSoFarTitle: string;
  agEnBandSoFar: string;
  tpViewProfile: string;
  verifyReceiptFingerprintMismatch: string;
  verifyReceiptReversed: string;
  verifyReceiptVoided: string;
  verifyReceiptGenuine: string;
  verifyReceiptGenuineUnchecked: string;
  verifyNotFound: string;
  verifyPaymentReversed: string;
  verifyDocumentRevoked: string;
  verifyDocumentFingerprintMismatch: string;
  verifyAcknowledgementNotReceipt: string;
  verifyDocumentExpired: string;
  verifyDocumentGenuine: string;
  verifyDocumentGenuineUnchecked: string;
  tpPossibleExisting: string;
  tpDupIdentityNumber: string;
  tpDupPhoneAndName: string;
  tpDupPhone: string;
  tpDupBusinessNameInLga: string;
  tpDupNameInLga: string;
  tpDupCouldNotList: string;
  tpDupCouldNotListBody: string;
  tpDupTryAgain: string;
  actionTryAgain: string;
  tpCheckSamePerson: string;
  tpNoneOfThese: string;
  tpHasTin: string;
  tpYes: string;
  tpNo: string;
  tpExistingTin: string;
  tpExistingTinHint: string;
  tpBasicInfo: string;
  tpRegisteringAs: string;
  tpAnIndividual: string;
  tpABusiness: string;
  tpBusinessName: string;
  tpTypeOfBusiness: string;
  tpFirstName: string;
  tpMiddleName: string;
  tpLastName: string;
  tpDateOfBirth: string;
  tpPhoneNumber: string;
  tpEmailAddress: string;
  tpNeedBusinessName: string;
  tpIdentificationHint: string;
  tpLga: string;
  tpSelectLga: string;
  tpWardHint: string;
  tpChooseLgaFirst: string;
  tpNoWardsListed: string;
  tpListCouldNotLoad: string;
  tpSelectWard: string;
  tpCommunity: string;
  tpBusinessOrActivity: string;
  tpEconomicSector: string;
  tpSelectSector: string;
  tpSuggestedObligations: string;
  tpConfirmWhichTaxes: string;
  tpOccupation: string;
  tpBusinessActivity: string;
  tpReviewConfirm: string;
  tpType: string;
  tpBusiness: string;
  tpIndividual: string;
  tpName: string;
  tpPhone: string;
  tpLgaShort: string;
  tpWard: string;
  tpWillBeRequested: string;
  tpConsent: string;
  tpDeclaration: string;
  tpBack: string;
  tpContinue: string;
  tpRegistering: string;
  tpRegisterTaxpayer: string;
  tpYouAreOffline: string;
  tpSaveOfflineBody: string;
  tpSaveOnDevice: string;
  tpNotYetAssigned: string;
  tpTransactionsYouFacilitated: string;
  tpNoTransactions: string;
  tpWhatYouCanSee: string;
  tpVehicles: string;
  tpExpires: string;
  tpNoRenewal: string;
  camCancel: string;

  /**
   * The agent's own application: the clearance steps, the documents PSIRS
   * asks for, and the three ways an application stops.
   */
  appStageSubmitted: string;
  appStageKyc: string;
  appStageReview: string;
  appStageApproved: string;
  appStageTraining: string;
  appStageDevice: string;
  appStageActive: string;
  appActionNeeded: string;
  appSuspended: string;
  appNotApproved: string;
  appContactSupervisor: string;
  appTakePhotograph: string;
  appTakeAgain: string;
  appSending: string;
  appDocumentNotSent: string;
  appIdDocument: string;
  appIdDocumentHint: string;
  appSelfie: string;
  appSelfieHint: string;
  appJustCaptured: string;
  appKycHint: string;
  appSubmitForVerification: string;
  appVerifying: string;
  appStillNeeded: string;
  appStatus: string;
  /**
   * Emptying a filter row, which is not the same act as clearing an agent.
   *
   * The Levies screen borrowed `ofcAgClear` for its filter reset. In English
   * that reads fine, because "Clear" happens to mean both things. In Hausa
   * `ofcAgClear` is "Ba da izini" -- grant permission -- so a Hausa-reading
   * officer was offered "Grant permission" beside their filters. One word, one
   * thing: the clearance decision keeps `ofcAgClear`, and resetting a form
   * gets this.
   */
  appClearFilters: string;
  appDocumentOnFile: string;
  appRefereeNoAccount: string;
  appRefereeShareLink: string;
  appRefereeConfirmedYour: string;
  appRefereeSentRequest: string;
  appRefereeLinkHere: string;
  appNominateReplacement: string;
  appSendVerification: string;
  appTrainingAllComplete: string;
  appTrainingRemaining: string;
  appPassMark: string;
  appNoAssessment: string;
  appBankHint: string;
  appBankVerifiedMsg: string;
  appBankCouldNotVerify: string;
  appAcceptAgreementText: string;
  appDeviceLabel: string;
  appAppVersion: string;
  appNotRegistered: string;
  appRegisteredDevice: string;
  errNetwork: string;

  /**
   * Becoming an agent, and the six things that must all be true first.
   *
   * The device sentence is the one the schema enforces and the screen has to
   * explain: revenue can only be collected from a handset PSIRS has registered
   * to this person. An agent who does not understand it reads a refusal as a
   * fault in the app.
   */
  appYourApplication: string;
  appBeingProcessed: string;
  appClearedToCollect: string;
  appAllRequirementsMet: string;
  appCannotCollectUntil: string;
  appStillOutstanding: string;
  appBlockerKyc: string;
  appBlockerReferee: string;
  appBlockerGovernmentApproval: string;
  appBlockerTraining: string;
  appBlockerBank: string;
  appBlockerAgreement: string;
  appBlockerDevice: string;
  appComplete: string;
  appGoToDashboard: string;
  appIdentityVerification: string;
  appIdentificationType: string;
  appIdentificationNumber: string;
  appEnterIdInFull: string;
  appPreviousAttemptRejected: string;
  appDocumentNotAccepted: string;
  appDocuments: string;
  appNotCaptured: string;
  appReferee: string;
  appRefereeFullName: string;
  appRefereePhone: string;
  appRefereeEmail: string;
  appHowDoTheyKnowYou: string;
  appWhoIsThisPerson: string;
  appRefereeConfirmed: string;
  appWaitingReferee: string;
  appVerificationSent: string;
  appTraining: string;
  appAgreement: string;
  appAcceptAgreement: string;
  appAgreementAccepted: string;
  appAgreementRecorded: string;
  appReadCarefully: string;
  appBankAccount: string;
  appVerifyBankAccount: string;
  appBankVerified: string;
  appCommissionPaidHere: string;
  appRegisterDevice: string;
  appOtherDevices: string;
  appDeviceOnlyRegistered: string;
  appDeviceAfterApproval: string;
  appRefereeWhoIs: string;
  idNin: string;
  idBvn: string;
  idPassport: string;
  idLicence: string;
  idVoters: string;
  refCivilServant: string;
  refCommunityLeader: string;
  refDistrictHead: string;
  refReligiousLeader: string;
  refTraditionalAuthority: string;
  refProfessional: string;
  refEmployer: string;

  /**
   * The screen an agent opens to look at their own money, their handset and
   * their vehicle work.
   *
   * The bank-account strings are the ones with a cost attached. "This is a
   * commission record, not a bank account" and "the bank has not confirmed
   * this account" both exist to stop an agent believing government revenue
   * passes through an account of theirs, which is the belief every
   * cash-in-pocket story starts from.
   */
  moreThisDevice: string;
  moreSignOut: string;
  moreSomethingWrong: string;
  moreGetHelp: string;
  moreViewApplication: string;
  moreWhereCommissionPaid: string;
  moreCommissionRecordNotAccount: string;
  moreChangeBankAccount: string;
  moreAskDifferentAccount: string;
  moreAuthoriseChange: string;
  moreAuthorisePayout: string;
  moreChangeWaiting: string;
  moreNothingChangesYet: string;
  moreToldEitherWay: string;
  moreBankNotConfirmed: string;
  moreWhyChanging: string;
  moreAccountName: string;
  moreAccountNumber: string;
  moreBankCode: string;
  moreCommissionHistory: string;
  moreNoCommission: string;
  moreAvailableForPayout: string;
  moreRequestPayout: string;
  moreRequestingPayout: string;
  moreSomeCommissionOwedBack: string;
  moreSomeCommissionOnHold: string;
  moreOnHoldBody: string;
  moreCommissionApproved: string;
  moreApprovedBody: string;
  moreSomeCommissionReversed: string;
  moreReversedBody: string;
  moreReceiptsFacilitated: string;
  moreNoReceipts: string;
  moreSavedRecords: string;
  moreNothingWaiting: string;
  moreSavedOnPhone: string;
  moreVehicleRenewal: string;
  moreSearchVehicle: string;
  moreRegistrationNumber: string;
  moreVehicleType: string;
  morePrivate: string;
  moreCommercial: string;
  moreRenewalService: string;
  moreSelectRenewalType: string;
  moreRenewalPeriod: string;
  moreCalculateProceed: string;
  moreSaveVehicleOnPhone: string;
  moreCaptureOffline: string;
  moreVehicleAuthorityUnreachable: string;
  moreTryVehicleAuthorityAgain: string;
  morePrinter: string;
  moreDisconnect: string;
  morePushTitle: string;
  moreContinue: string;

  /**
   * Registering a group, and becoming an agent.
   *
   * "This does not assess anybody" is the one that stops a misunderstanding
   * costing somebody money: registering a cooperative records that it exists
   * and charges nobody anything, and an agent who thinks otherwise will tell a
   * market association it owes tax.
   */
  grpTitle: string;
  grpRegister: string;
  grpName: string;
  grpKind: string;
  grpChooseOne: string;
  grpLeaderName: string;
  grpLeaderPhone: string;
  grpLga: string;
  grpCommunity: string;
  grpMemberCount: string;
  grpRecordMember: string;
  grpMember: string;
  grpRecorded: string;
  grpWaitingOfficer: string;
  grpAskLeaderConfirm: string;
  grpSendToLeader: string;
  grpNoAssessment: string;
  authSignInTitle: string;
  authSignIn: string;
  authPhoneHint: string;
  authPassword: string;
  authApply: string;
  authApplyTitle: string;
  authBackToSignIn: string;
  authYourDetails: string;
  authFullName: string;
  authPhone: string;
  authEmail: string;
  authDateOfBirth: string;
  authOccupation: string;
  authWhereYouLive: string;
  authAddress: string;
  authSelectLga: string;
  authNeedDocuments: string;
  authWhatNext: string;
  authNextSignIn: string;
  authNextReferee: string;
  authNextReview: string;
  authNextClearance: string;
  authApplicationReceived: string;
  authApplicationNumber: string;

  /**
   * Collecting revenue, and asking PSIRS for help.
   *
   * The offline notice is the one that matters here: an agent who reads it as
   * a temporary glitch waits, and an agent who does not understand it takes
   * cash instead. It says why there can be no receipt, not merely that there
   * is no signal.
   */
  colWhoIsPaying: string;
  colSearchTaxpayer: string;
  colNamePhoneTin: string;
  colChangeTaxpayer: string;
  colRegisterNew: string;
  colWhatPaying: string;
  colRevenueItem: string;
  colSelectItem: string;
  colBasisAmount: string;
  colCalculate: string;
  colHowCalculated: string;
  colAboutToCollect: string;
  colConfirmProceed: string;
  colDownloadReceipt: string;
  colShareReceipt: string;
  colHistory: string;
  colBackHome: string;
  colOfflineTitle: string;
  colOfflineBody: string;
  supGetHelp: string;
  supReportProblem: string;
  supMyReports: string;
  supNothingReported: string;
  supWhatProblem: string;
  supChooseOne: string;
  supShortSummary: string;
  supWhatHappened: string;
  supHowUrgent: string;
  supNotUrgent: string;
  supUrgent: string;
  supVeryUrgent: string;
  supTransactionRef: string;
  supBeforeYouSend: string;
  supConversation: string;
  supAddToReport: string;
  supReportClosed: string;
  supReopened: string;

  /**
   * Handing out an allocation, checking a receipt, the step-up prompt and the
   * application shell.
   *
   * Two of these decide something: that a collection code has been used and
   * cannot be presented again, and that a one-time code has expired. An agent
   * who misreads either hands out a second bag of fertiliser or refuses a
   * beneficiary who is entitled to one.
   */
  allocHandOut: string;
  allocScanCode: string;
  allocStopScanning: string;
  allocTypeCode: string;
  allocRecorded: string;
  allocCodeUsed: string;
  scanCamera: string;
  rcpGovernment: string;
  prnNoWritable: string;
  prnNotConnected: string;
  prnSendFailed: string;
  prnDisconnected: string;
  slipTestOk: string;
  slipWidth: string;
  slipStatus: string;
  slipConnected: string;
  slipReady: string;
  rcpThanks: string;
  rcpBureau: string;
  rcpPlatform: string;
  rcpTitle: string;
  rcpDateTime: string;
  rcpReference: string;
  rcpLga: string;
  rcpWard: string;
  rcpTaxpayer: string;
  rcpPhone: string;
  rcpItem: string;
  rcpCategory: string;
  rcpAgentCode: string;
  rcpAgentName: string;
  rcpScanToVerify: string;
  rcpCheckOffice: string;
  rcpCheckOfficeCont: string;
  rcpOffice: string;
  rcpVehAdmin: string;
  rcpVehLicensing: string;
  rcpVehTitle: string;
  rcpVehPlate: string;
  rcpVehDoc: string;
  rcpVehOwner: string;
  rcpVehMakeModel: string;
  rcpVehYear: string;
  rcpVehChassis: string;
  rcpVehFrom: string;
  rcpVehUntil: string;
  rcpVehFee: string;
  rcpVehOfficial: string;
  rcpVehCheck: string;
  connOnline: string;
  connOnlineDetail: string;
  connLimited: string;
  connLimitedDetail: string;
  connOffline: string;
  connOfflineDetail: string;
  appRecordsWaiting: string;
  stepUpSignInAgain: string;
  stepUpEnterCode: string;
  stepUpCodeRequired: string;
  morePushUnsupported: string;
  errUploadFailed: string;
  errUploadOffline: string;
  scanCameraDenied: string;
  scanCameraMissing: string;
  scanCameraUnsupported: string;
  colInvoiceReady: string;
  morePayoutRequested: string;
  morePayoutClawback: string;
  agStepCodeSentTo: string;
  appDraftsSynced: string;
  appDraftsSyncedRejected: string;
  errRequestFailed: string;
  ofcAgConfirmHowPrompt: string;
  ofcAgRefuseWhyPrompt: string;
  ofcAgAccountChanged: string;
  ofcAgChangeRefused: string;
  ofcAgNotConfirmed: string;
  ofcAgNotConfirmedBecause: string;
  ofcAgAnOfficer: string;
  ofcAgUnknownRole: string;
  ofcAgBankStillNotConfirmed: string;
  ofcAlForfeitWhy: string;
  ofcAlThisBeneficiary: string;
  ofcAlRoundOpened: string;
  ofcAlRoundClosed: string;
  ofcAlRoundCannotCloseBeforeOpen: string;
  ofcCfItemAdded: string;
  ofcCfNotAnAmount: string;
  ofcCfNotAPercentage: string;
  ofcCfRateRecorded: string;
  ofcCfProgrammeStatus: string;
  ofcCfRateCannotBeNegative: string;
  ofcCfPercentageCannotExceed100: string;
  ofcFaMinimumAboveRecommended: string;
  ofcFaNoHandsetBelow: string;
  ofcFaHandsetWouldStop: string;
  ofcFaHandsetsWouldStop: string;
  ofcFnSettlementRecorded: string;
  ofcFnSettlementDisputed: string;
  ofcFnTotalCreditedPrompt: string;
  ofcFnReconciliationAborted: string;
  ofcFnStatementUnavailable: string;
  ofcFnReconciliationComplete: string;
  ofcFnReconciliationUnchecked: string;
  ofcFnTotalsAgree: string;
  ofcFnTotalsDisagree: string;
  ofcFnRecoverChecked: string;
  ofcFnReversalExecuted: string;
  ofcGrApproved: string;
  ofcGrCollectedAt: string;
  ofcKycAccepted: string;
  ofcKycRejectedNotice: string;
  ofcKycSubmittedByApplicant: string;
  ofcKycReasonGiven: string;
  ofcOvSweepRaised: string;
  ofcOvJobsNeedAttention: string;
  ofcRhInvoiceDocumentReady: string;
  ofcRhPayoutApproved: string;
  ofcSpTicketMoved: string;
  verifyCheckReceipt: string;
  verifyScanQr: string;
  verifyTypeCode: string;
  verifyOffline: string;
  stepUpOneTimeCode: string;
  stepUpExpired: string;
  stepUpAskNew: string;
  stepUpSendNew: string;
  stepUpCouldNotContinue: string;
  stepUpDevelopmentBuild: string;
  appSignOut: string;
  appSwitchLanguage: string;
  appPageNotFound: string;
  appPageNotFoundBody: string;
  appReturnHome: string;
  appRecordsSynced: string;
  appRecordsNotSent: string;
  appUpdateRequired: string;

  /**
   * The home screen an agent opens on.
   *
   * Nine strings that were English literals in an application that has offered
   * Hausa since it was built — including the figure an agent checks against
   * what is in their hand at the end of a day.
   */
  homeViewApplication: string;
  homeCollectedToday: string;
  homeQuickActions: string;
  homeRecentTransactions: string;
  homeNoTransactions: string;
  homeLifetime: string;
  homeTaxpayersRegistered: string;
  homeCommissionEarned: string;
  homeAvailableForPayout: string;

  // Checking a receipt
  genuineReceipt: string;
  receiptNotValid: string;
  receiptNotValidBody: string;
  receiptCodeShape: string;

  // Why a step will not continue
  needFirstName: string;
  needLastName: string;
  needPhone: string;
  needAddress: string;
  needLga: string;
  needConsent: string;
  needDeclaration: string;
  needExistingTin: string;
  birthDateFuture: string;
  birthDateTooOld: string;
  birthDateMalformed: string;
  emailIncomplete: string;

  // Device and clearance
  deviceNotRegistered: string;
  deviceAfterApproval: string;

  // Status & Badges
  statusPaid: string;
  statusPending: string;
  statusFailed: string;
  statusOffline: string;
  statusOnline: string;

  // Messages & Alerts
  offlineMessage: string;
  offlineNotice: string;
  civicDutyThanks: string;
  paymentSuccess: string;

  /**
   * The account-free public portals.
   *
   * A referee, a cooperative chairman and a citizen checking their own standing
   * all reach this platform through a link with no session behind it, and all
   * three are being asked to do something with a consequence. The agent
   * application has carried Hausa since it was built; these screens did not,
   * which put the declarations a referee actually puts their name to in a
   * language they may not read by preference.
   *
   * The declaration strings below are the tier that must never be left in
   * English. `POST /referee/:token/respond` records four booleans; what the
   * referee understood themselves to be agreeing to is whatever this screen
   * showed them.
   */
  pubService: string;
  pubLanguage: string;
  pubEnglish: string;
  pubHausa: string;
  pubThankYou: string;
  pubVerifyTitle: string;
  pubVerifyField: string;
  pubVerifyAction: string;
  pubVerifyChecking: string;
  pubVerifyReceiptNumber: string;
  pubVerifyRevenueType: string;
  pubVerifyAmount: string;
  pubVerifyIssued: string;
  pubVerifyLga: string;
  pubVerifyFingerprint: string;
  pubVerifyMatches: string;
  pubVerifyNoMatch: string;
  pubVerifyPrivacy: string;
  pubRefereeTitle: string;
  pubRefereeIntro: string;
  pubRefereeApplicant: string;
  pubRefereeYouAre: string;
  pubRefereeRelationship: string;
  pubRefereeCategory: string;
  pubRefereeRespondBefore: string;
  pubRefereeConfirmEach: string;
  pubDeclarationKnows: string;
  pubDeclarationAccurate: string;
  pubDeclarationWilling: string;
  pubDeclarationConsequences: string;
  pubRefereeIdType: string;
  pubRefereeIdNumber: string;
  pubRefereeIdHint: string;
  pubRefereeOccupation: string;
  pubIdNin: string;
  pubIdBvn: string;
  pubIdPassport: string;
  pubIdLicence: string;
  pubIdVoters: string;
  pubRefereeSubmit: string;
  pubRefereeSubmitting: string;
  pubRefereeDecline: string;
  pubRefereeNoAccount: string;
  pubDeclineTitle: string;
  pubDeclineBody1a: string;
  pubDeclineBody1b: string;
  pubDeclineBody2: string;
  pubDeclineReason: string;
  pubDeclineReasonHint: string;
  pubDeclineYes: string;
  pubDeclineNo: string;
  pubDeclineSending: string;
  pubAttestTitle: string;
  pubAttestIntro: string;
  pubAttestGroup: string;
  pubAttestAlready: string;
  pubAttestNothingTitle: string;
  pubAttestNothingBody: string;
  pubAttestQuestion: string;
  pubAttestYes: string;
  pubAttestNo: string;
  pubAttestAnswerAll: string;
  pubAttestSubmit: string;
  pubCitizenTitle: string;
  pubCitizenModeTin: string;
  pubCitizenModePhone: string;
  pubCitizenModeName: string;
  pubCitizenCheck: string;
  pubCitizenSearching: string;
  pubCitizenExampleTin: string;
  pubCitizenExamplePhone: string;
  pubCitizenExampleName: string;
  pubCitizenByTin: string;
  pubCitizenByPhone: string;
  pubCitizenByName: string;
  pubCitizenTooMany: string;
  /*
   * Seven words the check could not see.
   *
   * `looksLikeCode` excused any single lowercase token, because that is what
   * an identifier looks like — and also what most short English words look
   * like. Most of these need the whole phrase rather than the word, because
   * Hausa does not put the number, the noun and the preposition where English
   * does, and a conjunction cannot be placed correctly by concatenation.
   */
  ofcDbOr: string;
  /** Carries {{from}} and {{to}}. */
  ofcDbDayRange: string;
  /** Carries {{count}}. */
  ofcGpBeneficiaryCount: string;
  /** Carries {{collected}}, {{awarded}} and {{rate}}. */
  ofcGpCollectedOfAwarded: string;
  /** Carries {{quantity}} and {{unit}}. */
  ofcGpEachBeneficiaryGets: string;
  ofcOvIdentifiers: string;
  /*
   * The half of an error that says what to do about it.
   *
   * `ApiError.nextStep` sits directly under a message both applications
   * already translate, and both printed it raw — so a Hausa reader got the
   * heading in Hausa, the explanation in Hausa, and the instruction in
   * English. It is the actionable half.
   *
   * Keyed by the error's own code, which has always travelled with it.
   * Only codes specific enough to imply one next step are listed: a
   * `VALIDATION_FAILED` or a caller-supplied `forbidden()` means something
   * different every time it is raised, and keeps the server's words.
   */
  nsStepUpRequired: string;
  nsDeviceNotRegistered: string;
  nsDeviceRevoked: string;
  nsDeviceSuspended: string;
  nsUpdateRequired: string;
  nsUpdateRequiredToEnumerate: string;
  nsTinServiceUnavailable: string;
  nsTinNotFound: string;
  nsKycProviderUnavailable: string;
  nsPaymentUnconfirmed: string;
  nsPaymentFailed: string;
  nsAgentNotCleared: string;
  /*
   * What the job monitor says about a job, and how often it runs.
   *
   * Both were English on a screen that offers Hausa, and both are composed
   * from values already on the wire: `state` is an enum the adjacent column
   * already renders as a translated badge, and the failure count and last
   * error travel with it. `ofcOvJobFailing` carries {{count}} and {{error}};
   * the three intervals carry {{n}}.
   */
  ofcOvJobHealthy: string;
  ofcOvJobRunning: string;
  ofcOvJobOverdue: string;
  ofcOvJobStalled: string;
  ofcOvJobFailing: string;
  ofcOvJobNeverRun: string;
  ofcOvJobNoReason: string;
  ofcOvEverySeconds: string;
  ofcOvEveryMinutes: string;
  ofcOvEveryHours: string;
  /*
   * Why a capture made on a phone would not go.
   *
   * Read standing in front of the person whose details were just taken, so
   * the wording has to be enough to decide what to do there and then.
   * `errDraftInvalid` carries {{detail}} — the failing fields, as
   * identifiers; `errDraftTypeUnsupported` carries {{type}} and
   * `errDraftNotProcessed` {{reference}}, both of which the phone already
   * knows about its own draft.
   */
  errDraftInvalid: string;
  errDraftTypeUnsupported: string;
  errDraftNotProcessed: string;
  /*
   * What an agent and an officer are told after an action succeeds.
   *
   * The last of the server-composed sentences, and like the public portal's
   * six, none of them needed anything new sent: the vehicle lookup's
   * `source` and `authorityConfirmed`, the device's `status`, the revenue
   * item's name and the status the screen itself chose were all already
   * beside the prose that was built from them.
   */
  agVehFoundConfirmed: string;
  agVehFoundUnconfirmed: string;
  agVehRegistryUnavailable: string;
  agVehNotFound: string;
  agVehFoundAtAuthority: string;
  /** Carries {{name}}. */
  agRefereeRequestSent: string;
  agDevicePendingApproval: string;
  agDeviceSuspended: string;
  agDeviceActive: string;
  agGroupMemberRecorded: string;
  /** Each carries {{name}}. */
  ofcItemBackInCatalogue: string;
  ofcItemSuspended: string;
  ofcItemRetired: string;
  /** Carries {{member}} and {{group}}. */
  ofcGpMemberLeft: string;
  /*
   * What a referee, a group leader and a citizen are told after they act.
   *
   * Each of these replaced a sentence the API composed and this portal
   * rendered as it arrived. In every case the value the sentence is built
   * from — the referee's resulting status, the confirmed and rejected
   * counts, the number of name matches — was already on the wire beside it,
   * so nothing new had to be sent; the screen was reaching past the data for
   * the prose.
   */
  pubRefereeThankYouCleared: string;
  pubRefereeCouldNotVerify: string;
  pubRefereeUnderReview: string;
  pubRefereeDeclineRecorded: string;
  /** Carries {{confirmed}}. */
  pubGroupAllConfirmed: string;
  /** Carries {{confirmed}} and {{rejected}}. */
  pubGroupSomeConfirmed: string;
  pubCitizenNoTinMatch: string;
  pubCitizenNoPhoneMatch: string;
  pubCitizenNoNameMatch: string;
  pubCitizenOneMatch: string;
  /** Carries {{count}}. */
  pubCitizenManyMatches: string;
  pubCitizenStatusHeading: string;
  pubCitizenCompliant: string;
  pubCitizenArrears: string;
  pubCitizenAttention: string;
  pubCitizenNotAssessed: string;
  pubCitizenMsgCompliant: string;
  pubCitizenMsgArrears: string;
  pubCitizenMsgAttention: string;
  pubCitizenMsgNotAssessed: string;
  pubCitizenDetail: string;
  pubCitizenTinStatus: string;
  pubCitizenOutstanding: string;
  pubCitizenOutstandingYes: string;
  pubCitizenNone: string;
  pubStmtFrom: string;
  pubStmtTo: string;
  pubStmtBackwards: string;
  pubStmtAnotherPeriod: string;
  pubStmtTitle: string;
  pubStmtIntro: string;
  pubStmtSendCode: string;
  pubStmtSending: string;
  pubStmtCodeSent: string;
  pubStmtCode: string;
  pubStmtShow: string;
  pubStmtChecking: string;
  pubStmtPeriod: string;
  pubStmtTotal: string;
  pubStmtCount: string;
  pubStmtReturned: string;
  pubStmtReturnedRow: string;
  pubStmtForWhat: string;
  pubStmtEach: string;
  pubStmtNothing: string;
  pubStmtFooter: string;
  pubCitizenFooter: string;
  pubCitizenAlso: string;
  pubCitizenVerifyLink: string;
  agSupYou: string;
  collAuthorizedFieldOfficer: string;
  moreDisablePushNotifications: string;
  moreSentToPsirsYour: string;
  moreUnknownOwner: string;
  ofcAgAgentActivated: string;
  ofcAgAgentAgreementAccepted: string;
  ofcAgAgentSuspendedTheirSessions: string;
  ofcAgApplicationApproved: string;
  ofcAgApplicationRejected: string;
  ofcAgAskedForBy: string;
  ofcAgCommissionBankAccountVerified: string;
  ofcAgConfirmedNoNameReturned: string;
  ofcAgDeviceApprovedTheAgent: string;
  ofcAgDeviceRestoredTheAgent: string;
  ofcAgDeviceRevokedAndIts: string;
  ofcAgDeviceSuspendedAndIts: string;
  ofcAgDocumentType: string;
  ofcAgFailureReason: string;
  ofcAgFlagDismissedTheReferee: string;
  ofcAgFlagMarkedAsUnder: string;
  ofcAgFlagUpheldThisReferee: string;
  ofcAgGiveAReasonOf: string;
  ofcAgGovernmentApproved: string;
  ofcAgIdentityVerifiedKyc: string;
  ofcAgLivenessCheck: string;
  ofcAgMandatoryTrainingCompleted: string;
  ofcAgMoreInformationRequestedFrom: string;
  ofcAgNameTheAgentGave: string;
  ofcAgNameTheBankReturned: string;
  ofcAgNumberOnFile: string;
  ofcAgReasonGiven: string;
  ofcAgRecordThis: string;
  ofcAgRefereeCleared: string;
  ofcAgRefereeRejected: string;
  ofcAgTerritoryReassignedFutureCollections: string;
  ofcAgTheAgent: string;
  ofcAgTheBankConfirmedThe: string;
  ofcAgTheBankCouldNot: string;
  ofcAgTheBankVerificationService: string;
  ofcAgThisAccountCannotBe: string;
  ofcAgUnnamed: string;
  ofcAlChooseTheProgrammeThis: string;
  ofcAlCreateARound: string;
  ofcAlCreateRound: string;
  ofcAlCreating: string;
  ofcAlGiveTheRoundA: string;
  ofcAlHowMuchDoesEach: string;
  ofcAlHowMuchIsThere: string;
  ofcAlNotYet: string;
  ofcAlOneBeneficiaryCannotReceive: string;
  ofcAlRoundCreatedItAwards: string;
  ofcAlWhenDoesCollectionOpen: string;
  ofcCfActivate: string;
  ofcCfAddToTheCatalogue: string;
  ofcCfAdding: string;
  ofcCfBusinesses: string;
  ofcCfCalculatedByFormula: string;
  ofcCfCurrent: string;
  ofcCfEnterTheNewAmount: string;
  ofcCfEnterTheNewRate: string;
  ofcCfEvaluateAll: string;
  ofcCfEvaluating: string;
  ofcCfExistingAssessmentsAreUnaffected: string;
  ofcCfForExampleRepealedBy: string;
  ofcCfGiveAReasonFor: string;
  ofcCfIndividuals: string;
  ofcCfNoApprovedRateIn: string;
  ofcCfNoNewAssessmentCan: string;
  ofcCfNotEligible: string;
  ofcCfOfAssessableAmount: string;
  ofcCfProgressiveBands: string;
  ofcCfRecordNewRateVersion: string;
  ofcCfRecording: string;
  ofcCfRestoreItem: string;
  ofcCfTheItemGoesBack: string;
  ofcCfWhatChangedForExample: string;
  ofcCfWithdrawItem: string;
  ofcDbAverageTimeToConfirm: string;
  ofcDbDuplicateRegistrationsOverridden: string;
  ofcDbNewTaxpayersThisMonth: string;
  ofcDbReversalsAndRefunds: string;
  ofcDbTaxpayersWithATin: string;
  ofcDbTotalCollected: string;
  ofcFaEnterTheMinimumVersion: string;
  ofcFaEnterTheRecommendedVersion: string;
  ofcFaNeverReportedAVersion: string;
  ofcFaPublishThisMinimum: string;
  ofcFaPublishing: string;
  ofcFaSayWhyTheMinimum: string;
  ofcFaShippedWithThePlatform: string;
  ofcFnBankReferenceForThe: string;
  ofcFnBankTransferReferenceAt: string;
  ofcFnEnterTheCreditedAmount: string;
  ofcFnBankReferenceRequired: string;
  ofcFnDisputeNoteTooShort: string;
  ofcFnItHasToAccount: string;
  ofcFnListTheGatewayReferences: string;
  ofcFnNothingWasComparedFor: string;
  ofcFnReRunThisPeriod: string;
  ofcFnReasonForApprovingThis: string;
  ofcFnReasonForThisDecision: string;
  ofcFnRecordHowThisException: string;
  ofcFnWhatDidTheBank: string;
  ofcFnWhatTheVarianceTurned: string;
  ofcGpConfirmationLinkCreated: string;
  ofcKyOpenAndReview: string;
  ofcKyReviewedOn: string;
  ofcKyTheAccessLogCould: string;
  ofcLgCouldNotReachThe: string;
  agStepSendingACode: string;
  agStepCodeSentToNumber: string;
  uiHide: string;
  uiHidePassword: string;
  uiShow: string;
  uiShowPassword: string;
  ofcOsAskTheGatewayAgain: string;
  ofcOsAskTheTinService: string;
  ofcOsAskingTheGateway: string;
  ofcOsAskingTheTinService: string;
  ofcOsEveryQueueYouCan: string;
  ofcOsEveryRefundHasBeen: string;
  ofcOsNotAttemptedYet: string;
  ofcOsSendToTheAuthority: string;
  ofcOsSendingToTheAuthority: string;
  ofcOvEveryScheduledJobHas: string;
  ofcOvId: string;
  ofcOvLoading: string;
  ofcOvNoTaxpayerMatchedThat: string;
  ofcOvNothingToChooseFrom: string;
  ofcOvRecordWhatYouFound: string;
  ofcOvRunAFraudSweep: string;
  ofcOvRunThisQuery: string;
  ofcOvRunning: string;
  ofcOvSearchForATaxpayer: string;
  ofcOvSelectOne: string;
  ofcOvSweepCompleteNothingNew: string;
  ofcOvSweeping: string;
  ofcOvTheAuditTrailCould: string;
  ofcOvWhichAgent: string;
  ofcOvWhichRevenueItem: string;
  ofcOvWhichTaxpayer: string;
  ofcRhAskTheRegisterAgain: string;
  ofcRhAsking: string;
  ofcRhDeviceApproved: string;
  ofcRhInvoiceDocument: string;
  ofcRhPreparing: string;
  ofcRhReAskedTheTin: string;
  ofcRhRemindersSentToTaxpayers: string;
  ofcRhSendPaymentReminders: string;
  ofcRvEveryFigureHereCovers: string;
  ofcRvNotMapped: string;
  ofcRvTheseFiguresAreEmpty: string;
  ofcSpAddAnInternalNote: string;
  ofcSpAssignedTo: string;
  ofcSpContact: string;
  ofcSpInternalNoteSavedThe: string;
  ofcSpNobodyYet: string;
  ofcSpOnlyStaffWithSupport: string;
  ofcSpReplySent: string;
  ofcSpReplyToTheReporter: string;
  ofcSpSaveInternalNote: string;
  ofcSpSendReply: string;
  ofcSpThisGoesToThe: string;
  ofcTrCorrecting: string;
  ofcTrEnterTheCorrectedValue: string;
  ofcTrNameTheTypeOf: string;
  ofcTrOnRecordNow: string;
  ofcTrPutBackOnThe: string;
  ofcTrRecordThisCorrection: string;
  ofcTrRecording: string;
  ofcTrSayWhatIsBeing: string;
  ofcTxDirect: string;
  ofcUaChangeAccessAndSign: string;
  ofcUaChanging: string;
  ofcUaLetThemSignIn: string;
  ofcUaSaveTerritories: string;
  ofcUaSignThemOutAnd: string;
  ofcUsApplyingToBecomeAn: string;
  ofcUsCapturingAVehicle: string;
  ofcUsRegisteringATaxpayer: string;
  ofcUsTakingACollection: string;
}

export const translations: Record<Language, TranslationDictionary> = {
  en: {
    appName: 'PSIRS Revenue Platform',
    appTagline: 'Plateau State Digital Grassroots Revenue & Taxpayer Services',
    home: 'Home',
    collect: 'Collect',
    taxpayers: 'Taxpayers',
    vehicles: 'Vehicles',
    receipts: 'Receipts',
    more: 'More',
    search: 'Search',
    verify: 'Verify Receipt',
    signOut: 'Sign Out',

    payRevenue: 'Pay Revenue',
    confirmPayment: 'Confirm Payment',
    downloadReceipt: 'Download Receipt',
    shareReceipt: 'Share Receipt',
    printBluetooth: 'Print (Bluetooth Thermal)',
    registerTaxpayer: 'Register Taxpayer',
    renewVehicle: 'Renew Vehicle',
    pairPrinter: 'Pair Bluetooth Printer',
    testPrint: 'Print Test Slip',
    enablePush: 'Enable Push Notifications',

    taxpayerName: 'Taxpayer Name',
    taxpayerTin: 'Tax Identification Number (TIN)',
    phone: 'Phone Number',
    lga: 'LGA (Local Government)',
    ward: 'Ward',
    service: 'Revenue Item / Service',
    amount: 'Amount',
    totalPaid: 'Total Paid',
    receiptNumber: 'Receipt Number',
    verificationCode: 'Verification Code',
    paymentMode: 'Payment Mode',
    neverCollectCash: 'Never collect cash',
    neverCollectCashBody:
      'Government revenue must always be paid by the taxpayer through an approved payment channel. Never accept cash into your own account.',
    cashChannelReminder:
      'The taxpayer must pay through the approved payment channel. Confirm the amount with them before you continue.',
    noTaxPayable: 'No tax is payable',
    noTaxPayableBody:
      'This taxpayer owes nothing on the amount declared. Do not increase it to make a payment go through — there is nothing to collect.',
    navHome: 'Home',
    navTaxpayers: 'Taxpayers',
    navCollect: 'Collect',
    navReceipts: 'Receipts',
    navCommission: 'Commission',
    navProfile: 'Profile',
    commissionAccountOnly: 'This account is for your commission only',
    commissionAccountNote:
      'Verified before any commission can be paid. Government revenue never enters this account.',

    paymentFailed: 'Payment did not go through',
    paymentFailedBody: 'No money has been taken from the taxpayer. You can start the payment again.',
    paymentUnconfirmed: 'Payment not yet confirmed',
    paymentUnconfirmedBody:
      'This payment has NOT been marked as received. Do not ask the taxpayer to pay again \u2014 check again in a moment.',
    paymentAcknowledged: 'Payment confirmed \u2014 receipt to follow',
    paymentAcknowledgedBody:
      'The payment system has confirmed this payment. Government has not yet received the money, so this is an acknowledgement and NOT a receipt. The receipt is issued automatically once the money reaches the government account. Do not ask the taxpayer to pay again.',
    acknowledgementLabel: 'Acknowledgement',

    findTaxpayerFirst: 'Find the taxpayer first. Every payment must be attributed.',
    noTaxpayerMatch:
      'No taxpayer matches that search. Register them below before taking a payment \u2014 every payment must be attributed to a taxpayer.',
    /*
     * A name search answers from the Local Government Area you work in. A
     * trader registered elsewhere and trading in your market is a real and
     * ordinary case, and an agent who is told only "no match" will register
     * them a second time. What they hand over reaches any area.
     */
    searchAnotherArea:
      'A name search covers your own Local Government Area. If they are registered elsewhere, search by their phone number, TIN, vehicle registration or a receipt number.',
    /*
     * The taxpayer holds no account here, so every message PSIRS ever sends
     * them — including the SMS that is the only copy of their receipt — is
     * chosen by this one answer. Ask them; do not assume from the market.
     */
    languageForMessages: 'Language for their messages',
    languageForMessagesHint:
      'Ask the taxpayer. Their receipt arrives by SMS and it is the only copy they will have.',

    moneyNotDebited: 'No money has been taken from the taxpayer.',
    moneyUnconfirmed: 'The payment has NOT been confirmed. Do not collect again.',
    moneyReceived: 'The money has been received.',
    errPaymentUnconfirmed:
      'The payment could not be confirmed yet. The money has NOT been marked as received. Do not ask the taxpayer to pay again — check this transaction again in a few minutes.',
    errPaymentPendingReconciliation:
      'The payment has been received but is waiting for settlement. Do not collect again. The receipt is issued as soon as the government account has the money.',
    errPaymentFailed:
      'The payment did not go through. No money has been taken from the taxpayer. You can start it again.',
    errAgentNotCleared:
      'You are not yet cleared to collect revenue. Your application must be completed and approved first.',
    errDeviceNotRegistered:
      'This device is not registered to your account. Register it before you collect anything.',
    errRateLimited: 'Too many attempts. Wait a moment and try again.',
    errUpdateRequired: 'This version of the app is too old to collect with. Update it first.',
    errReference: 'Reference',
    ofcOvSignalCount: "How many",
    ofcOvSignalWindowSeconds: "Within, in seconds",
    ofcOvSignalThreshold: "Threshold",
    ofcOvSignalReason: "Reason",
    ofcOvSignalAgentsSupported: "Agents supported",
    ofcOvSignalAgentAssignedTo: "Agent assigned to",
    ofcOvSignalCollectedIn: "Collected in",
    ofcOvSignalAgentTerritory: "The agent’s area",
    ofcOvSignalTransactionArea: "Where the collection happened",
    ofcFnResolveTooShort: "Say how the exception was resolved, in at least 10 characters. It is the only record of why this discrepancy was closed.",
    ofcFnExceptionResolved: "Exception recorded as resolved.",
    ofcFnApprovePayoutTooShort: "Give a reason for approving this payout, in at least 5 characters.",
    ofcFnPayoutApproved: "Payout approved.",
    ofcFnTransferReferenceTooShort: "Enter the bank transfer reference. It is what ties this payout to the money that actually left the account.",
    ofcFnPayoutPaid: "Payout recorded as paid.",
    ofcFnPayoutFailedTooShort: "Record what the bank said. The agent has to be told why they were not paid, and the next attempt depends on knowing.",
    ofcFnPayoutFailedRecorded: "Recorded as failed. The commission in it is payable again, and any clawback it had netted off is owed again.",
    ofcFnDecisionTooShort: "Give a reason for this decision, in at least 10 characters.",
    ofcFnRequestDecided: "Request {{decision}}.",
    ofcOvFlagNoteTooShort: "Record what you found, in at least 10 characters. It is the only record of why this flag was settled the way it was.",
    ofcOvFlagConfirmed: "Flag confirmed. The agent’s commission has been placed on hold pending resolution.",
    ofcOvFlagMarked: "Flag marked {{decision}}.",
    ofcAlForfeitTooShort: "Give at least ten characters saying why this share is being released.",
    ofcAlReleased: "Released. The {{quantity}} is back in {{round}} for another beneficiary.",
    ofcUaChooseRoleFirst: "Choose the role this officer should hold.",
    ofcUaAlreadyHolds: "{{name}} already holds the {{role}} role.",
    ofcUaSayWhy: "Say why this access is changing, in at least 10 characters. It is the only record of why.",
    ofcUaNowRole: "{{name}} is now {{role}}.",
    ofcUaSessionsEnded: "{{n}} open session(s) ended, so they must sign in again.",
    ofcUaNoOpenSessions: "They had no open sessions.",
    ofcUaCanSignInAgain: "{{name}} can sign in again.",
    ofcUaAccountIsNow: "{{name}}’s account is {{status}}.",
    ofcUaSessionsEndedNow: "{{n}} open session(s) ended immediately.",
    ofcAgRecordWhatYouFound: "Record what you found: it is the only record of why this flag was left open, upheld or set aside.",
    enumDeviceVelocity: "One handset, too many collections",
    enumSharedPhoneNumber: "One phone number on several taxpayers",
    enumDuplicateTaxpayerDetails: "Details already on another record",
    enumOutOfTerritory: "Collected outside the agent’s area",
    enumRepeatedFailedPayments: "Payments that keep failing",
    enumReversalPattern: "A pattern of reversals",
    enumUnusualVolume: "More collections than usual",
    enumFrequentManualIntervention: "Often changed by hand",
    enumRepeatedReceiptRegeneration: "Receipt issued or fetched again and again",
    enumUnusualOfficerActivity: "Busier than this officer's usual day",
    enumUnusualTransactionTiming: "Collections written late at night",
    enumUser: "Officer",
    enumRapidSuccession: "Collections one after another, too fast",
    enumCommissionAnomaly: "Commission that does not add up",
    enumSettlementVariance: "The gateway paid a different amount",
    enumAbandoned: "Abandoned",
    enumAborted: "Aborted",
    enumAccepted: "Accepted",
    enumAccountTransfer: "Account transfer",
    enumActionRequired: "Action required",
    enumActivated: "Activated",
    enumActive: "Active",
    enumAdditionalIdentification: "Additional identification",
    enumAdditiveBenefit: "Extra benefit",
    enumAdmin: "Administrator",
    enumAgent: "Agent",
    enumAgentActivation: "Activating an agent",
    enumAgentAssisted: "Agent-assisted",
    enumAgentMisconduct: "Agent misconduct",
    enumAgentOnboarding: "Agent onboarding",
    enumAgentOverrideActivation: "Activating an agent by override",
    enumAgentPwa: "Agent app",
    enumAgentSuspension: "Suspending an agent",
    enumAgreementAccepted: "Agreement accepted",
    enumAgriculture: "Farming",
    enumAgricultureProcessing: "Processing farm produce",
    enumAmountMismatch: "Amount does not match",
    enumAnnual: "Yearly",
    enumApi: "API",
    enumApplicationSubmitted: "Application submitted",
    enumApproved: "Approved",
    enumArchived: "Archived",
    enumArtisanCraft: "Craft and trade work",
    enumArtisanGuild: "Artisan guild",
    enumAssessment: "Assessment",
    enumAssessmentCreated: "Assessment made",
    dowSun: 'Sunday',
    dowMon: 'Monday',
    dowTue: 'Tuesday',
    dowWed: 'Wednesday',
    dowThu: 'Thursday',
    dowFri: 'Friday',
    dowSat: 'Saturday',
    monthJan: 'January',
    monthFeb: 'February',
    monthMar: 'March',
    monthApr: 'April',
    monthMay: 'May',
    monthJun: 'June',
    monthJul: 'July',
    monthAug: 'August',
    monthSep: 'September',
    monthOct: 'October',
    monthNov: 'November',
    monthDec: 'December',
    monJan: 'Jan',
    monFeb: 'Feb',
    monMar: 'Mar',
    monApr: 'Apr',
    monMay: 'May',
    monJun: 'Jun',
    monJul: 'Jul',
    monAug: 'Aug',
    monSep: 'Sept',
    monOct: 'Oct',
    monNov: 'Nov',
    monDec: 'Dec',
    enumAssigned: "Assigned",
    enumTinAssigned: "Assigned",
    enumAttested: "Attested",
    enumAuditor: "Auditor",
    enumAuthorityLookup: "Authority lookup",
    enumAutoRecommendation: "Suggested automatically",
    enumAwarded: "Awarded",
    enumBag25kg: "25kg bag",
    enumBag50kg: "50kg bag",
    enumBankAccountChange: "Changing a bank account",
    enumBankChangeApplied: "Bank account changed",
    enumBankChangeRefused: "Bank account change refused",
    enumBankChangeRequested: "Bank account change requested",
    enumBankTransfer: "Bank transfer",
    enumBankVerified: "Bank account verified",
    enumBase: "Base",
    enumBlocked: "Blocked",
    enumBoth: "Both",
    enumBusiness: "Business",
    enumBvn: "Bank Verification Number",
    enumCamera: "Camera",
    enumCancelled: "Cancelled",
    enumCard: "Card",
    enumCivilServant: "Civil servant",
    enumCleared: "Cleared",
    enumClosed: "Closed",
    enumCollected: "Collected",
    enumCommission: "Commission",
    enumCommissionAdjustment: "Adjusting commission",
    enumCommissionPayout: "Paying out commission",
    enumCommunityLeader: "Community leader",
    enumCompleted: "Completed",
    enumConfirmed: "Confirmed",
    enumConstruction: "Construction",
    enumCritical: "Critical",
    enumDaily: "Daily",
    enumDelivered: "Delivered",
    enumDenied: "Refused",
    enumDevice: "Device",
    enumDeviceRegistered: "Device registered",
    enumDismissed: "Dismissed",
    enumDisputed: "Disputed",
    enumDocument: "Document",
    enumDocumentCapture: "Document photograph",
    enumDownload: "Download",
    enumDraft: "Draft",
    enumDriversLicence: "Driver’s licence",
    enumDuplicate: "Duplicate",
    enumDuplicatePayment: "Duplicate payment",
    enumEducation: "Education",
    enumEligibilityGate: "Condition of eligibility",
    enumEligible: "Eligible",
    enumEmail: "Email",
    enumEmployer: "Employer",
    enumEn: "English",
    enumEntertainmentArts: "Entertainment and the arts",
    enumExecuted: "Executed",
    enumExisting: "Already held",
    enumExpired: "Expired",
    enumFailed: "Failed",
    enumFailure: "Failure",
    enumFarmersCooperative: "Farmers’ cooperative",
    enumFederal: "Federal",
    enumFemale: "Female",
    enumFile: "File",
    enumFinanceOfficer: "Finance officer",
    enumFinancialServices: "Financial services",
    enumFisheriesGroup: "Fisheries group",
    enumFishing: "Fishing",
    enumFixed: "Fixed amount",
    enumFoodBeverage: "Food and drink",
    enumForfeited: "Forfeited",
    enumFormula: "Formula",
    enumFortnightly: "Every two weeks",
    enumFound: "Found",
    enumFull: "Full",
    enumGamingBetting: "Gaming and betting",
    enumGateway: "Payment gateway",
    enumGatewayWebhook: "Gateway notice",
    enumGovernment: "Government",
    enumGovernmentApproved: "Approved by the government",
    enumGovernmentRejected: "Refused by the government",
    enumHa: "Hausa",
    enumHealthcare: "Healthcare",
    enumHigh: "High",
    enumHotelHospitality: "Hotels and hospitality",
    enumIctTelecoms: "ICT & Telecommunications",
    enumIdentityDocument: "Identity document",
    enumIgnored: "Ignored",
    enumInProgress: "In progress",
    enumInactive: "Inactive",
    enumIncorrectAssessment: "Incorrect assessment",
    enumIndividual: "Individual",
    enumInfoRequested: "Information requested",
    enumInformalWorker: "Informal worker",
    enumInitiated: "Started",
    enumInvalid: "Not valid",
    enumInvited: "Invited",
    enumInvoice: "Invoice",
    enumInvoiceGenerated: "Invoice issued",
    enumInvoiced: "Invoiced",
    enumIssued: "Issued",
    enumKilogram: "Kilogram",
    enumKycCleared: "Identity cleared",
    enumKycFailed: "Identity check failed",
    enumKycInfoRequired: "More identity information needed",
    enumKycSubmitted: "Identity submitted",
    enumLeft: "Left the group",
    enumLimited: "Limited connectivity",
    enumLinkedExisting: "Linked to an existing record",
    enumLitre: "Litre",
    enumLivestock: "Livestock",
    enumLivestockAssociation: "Livestock association",
    enumLocalGovernment: "Local government",
    enumLogin: "Sign in",
    enumLow: "Low",
    enumMale: "Male",
    enumManualCorrection: "Manual correction",
    enumManualEntry: "Entered by hand",
    enumManualReview: "Manual review",
    enumManufacturing: "Manufacturing",
    enumMarketAssociation: "Market association",
    enumMatched: "Matched",
    enumMedium: "Medium",
    enumMerged: "Merged",
    enumMigration: "Migration",
    enumMining: "Mining",
    enumMissingPayment: "Payment missing",
    enumMissingPlatformTransaction: "No record on the platform",
    enumMonthly: "Monthly",
    enumMotorVehicle: "Motor vehicles",
    enumNin: "National Identification Number",
    enumNormal: "Normal",
    enumNotAttempted: "Not attempted",
    enumNotFound: "Not found",
    enumNotPerformed: "Not performed",
    enumNotRequested: "Not requested",
    enumNotStarted: "Not started",
    enumOfficer: "Officer",
    enumOfficerReview: "Officer review",
    enumOffline: "Offline",
    enumOnHold: "On hold",
    enumOneOff: "One-off",
    enumOnline: "Online",
    enumOpen: "Open",
    enumOpened: "Opened",
    enumOther: "Other",
    enumOverrideApplied: "Override applied",
    enumPaid: "Paid",
    enumPartial: "Partial",
    enumPartiallyPaid: "Partially paid",
    enumPassed: "Passed",
    enumPassport: "Passport",
    enumPassportPhotograph: "Passport photograph",
    enumPasswordReset: "Password reset",
    enumPaymentAcknowledgement: "Acknowledgement of payment",
    enumPaymentEvidence: "Evidence of payment",
    enumPaymentInitiated: "Payment started",
    enumPaymentIssue: "Payment issue",
    enumPaymentPending: "Payment pending",
    enumPaymentReversal: "Reversing a payment",
    enumPaymentSuccessful: "Payment successful",
    enumPaymentVerified: "Payment verified",
    enumPending: "Pending",
    enumPendingAttestation: "Waiting for the leader to confirm",
    enumPendingPayment: "Waiting for payment",
    enumPendingSettlement: "Waiting for settlement",
    enumPendingSync: "Waiting to be sent",
    enumPercentage: "Percentage",
    enumPoll: "Gateway check",
    enumPortal: "Officer portal",
    enumPos: "POS",
    enumPrivateEmployee: "Private sector employee",
    enumProceeded: "Proceeded",
    enumProcessed: "Processed",
    enumProcessing: "Processing",
    enumProfessionalServices: "Professional services",
    enumProofOfAddress: "Proof of address",
    enumProposed: "Proposed",
    enumPsirsSync: "PSIRS records",
    enumPublicServant: "Public servant",
    enumPush: "App notification",
    enumQuarterly: "Quarterly",
    enumQueued: "Queued",
    enumRead: "Read",
    enumReadyForReview: "Ready for review",
    enumRealProperty: "Land and buildings",
    enumReceipt: "Receipt",
    enumReceiptGenerated: "Receipt issued",
    enumReceiptIssue: "Receipt issue",
    enumReceived: "Received",
    enumRecognisedProfessional: "Recognised professional",
    enumReconciled: "Reconciled",
    enumReconciliation: "Reconciliation",
    enumReconciliationPending: "Waiting for reconciliation",
    enumReferee: "Referee",
    enumRefereeCleared: "Referee cleared",
    enumRefereeFailed: "Referee did not clear",
    enumRefereeInvited: "Referee invited",
    enumRefereeReplaced: "Referee replaced",
    enumRefereeVerify: "Referee verification",
    enumRefund: "Refund",
    enumRefunded: "Refunded",
    enumRegistration: "Registration",
    enumReinstated: "Reinstated",
    enumRejected: "Rejected",
    enumReligiousLeader: "Religious leader",
    enumReligiousNgo: "Religious body or charity",
    enumReplaced: "Replaced",
    enumRequested: "Requested",
    enumResolved: "Resolved",
    enumResponded: "Responded",
    enumRetailTrade: "Retail trade",
    enumRetired: "Retired",
    enumRevenueOfficer: "Revenue officer",
    enumRevenueRateChange: "Changing a rate",
    enumReversal: "Reversal",
    enumReversed: "Reversed",
    enumReview: "Review",
    enumReviewed: "Reviewed",
    enumRevoked: "Revoked",
    enumRunning: "Running",
    enumSeedling: "Seedling",
    enumSelfAssessment: "Self-assessment",
    enumSelfEmployed: "Self-employed",
    enumSelfie: "Photograph of yourself",
    enumSent: "Sent",
    enumServiceRequest: "Service request",
    enumSettled: "Settled",
    enumSettlement: "Settlement",
    enumShare: "Share",
    enumSms: "SMS",
    enumStarted: "Started",
    enumState: "State",
    enumStepUp: "Extra confirmation",
    enumCitizenStatement: "Statement of payments",
    enumStudentUnemployed: "Student or not working",
    enumSubmitted: "Submitted",
    enumSucceeded: "Succeeded",
    enumSuccess: "Success",
    enumSuccessful: "Successful",
    enumSuperseded: "Superseded",
    enumSupervisor: "Supervisor",
    enumSupportingDocument: "Supporting document",
    enumSuspended: "Suspended",
    enumSynced: "Sent",
    enumSystem: "System",
    enumTaxpayer: "Taxpayer",
    enumTaxpayerAdjustment: "Adjusting a taxpayer record",
    enumTaxpayerComplaint: "Taxpayer complaint",
    enumTaxpayerRegistration: "Taxpayer registration",
    enumTechnicalIssue: "Technical issue",
    enumTiered: "Tiered",
    enumTinConfirmation: "TIN confirmation",
    enumTinIssue: "TIN issue",
    enumTractorDay: "Tractor day",
    enumTradersAssociation: "Traders’ association",
    enumTraditionalAuthority: "Traditional authority",
    enumTrainingCompleted: "Training completed",
    enumTransaction: "Transaction",
    enumTransportHaulage: "Carrying goods",
    enumTransportPassenger: "Carrying passengers",
    enumTransportUnion: "Transport union",
    enumUnauthorisedCharge: "Unauthorised charge",
    enumUnavailable: "Unavailable",
    enumUnchecked: "Not checked",
    enumUnderReview: "Under review",
    enumUnit: "Unit",
    enumUnknown: "Unknown",
    enumUnpaid: "Unpaid",
    enumUnspecified: "Not stated",
    enumUnverified: "Not verified",
    enumUpload: "Upload",
    enumUrgent: "Urgent",
    enumUssd: "USSD",
    enumValid: "Valid",
    enumVehicle: "Vehicle",
    enumVehicleCapture: "Vehicle details",
    enumVehicleIssue: "Vehicle issue",
    enumVehicleRenewal: "Vehicle renewal",
    enumVerificationRequired: "Verification required",
    enumVerified: "Verified",
    enumVerify: "Verify",
    enumView: "View",
    enumVotersCard: "Voter’s card",
    enumWaived: "Waived",
    enumWebhook: "Gateway notice",
    enumWeekly: "Weekly",
    enumWhatsapp: "WhatsApp",
    enumWholesaleTrade: "Wholesale trade",
    pubRefereeIntroOfLga: "{{name}}, of {{lga}}, has applied to become an authorised revenue agent. PSIRS needs somebody who knows them to confirm their identity and suitability.",
    ofcUaSuspendOrCloseBody: "Suspending or closing an account signs the officer out everywhere and stops them signing in again. Suspension is a pause pending an answer; closing is the end of the appointment and cannot be undone — create a new account if they return.",
    ofcUaCoverNothingBody: "{{name}} will see no revenue figures at all until a territory is assigned.",
    ofcUaChangeAccessFor: "Change access — {{name}}",
    ofcUaCurrentlyRole: "Currently {{role}}.",
    ofcUaAccountFor: "Account — {{name}}",
    ofcUaCannotReopenBody: "A closed account can never be reopened. If {{name}} returns to the service they will need a new account.",
    ofcUaTerritoriesFor: "Territories — {{name}}",
    ofcUaRoleAdmin: "Administers agents, users and the revenue catalogue. Cannot authorise payouts.",
    ofcUaRoleSupervisor: "Authorises approvals and oversees agents in their territory.",
    ofcUaRoleRevenueOfficer: "Registers and corrects taxpayer records, and reviews approvals.",
    ofcUaRoleFinanceOfficer: "Reconciles settlements and authorises commission payouts.",
    ofcUaRoleAuditor: "Reads everything and changes nothing.",
    ofcAgRiskFlagFor: "Risk flag — {{name}}",
    ofcAlAwardsFor: "Awards — {{name}}",
    ofcAlAwardsIntro: "Who has been awarded under this round, and who has collected.",
    ofcCfRateHistoryFor: "Rate history — {{name}}",
    ofcCfChangeRateFor: "Change rate — {{name}}",
    ofcCfBeneficiariesFor: "Beneficiaries — {{name}}",
    ofcFnRecordSettlementTitle: "Record a settlement",
    ofcFnRecordSettlementAction: "Record settlement",
    ofcFnRecordPayment: "Record payment",
    ofcGpRecordDeparture: "Record departure",
    ofcGpAwardedNotCollected: "{{n}} beneficiaries were awarded and have not turned up. That is either a distribution that is not reaching people, or names on a list that do not correspond to anybody — worth establishing which before the next round.",
    ofcGpMembersFor: "Members — {{name}}",
    ofcGpEnoughForMore: "enough for {{n}} more",
    ofcKycFileType: "This is a {{type}} file.",
    ofcLvIntroAll: "What each levy has brought in, who is registered under it, and who is behind.",
    ofcLvIntroNoRegister: "What each levy has brought in, and who is behind on it.",
    ofcLvChooseOnce: "Choose a category or an item once and every section below answers for it.",
    ofcLvBroughtIn: "What {{levy}} brought in",
    ofcLvBehindOn: "Who is behind on {{levy}}",
    ofcLvRegisteredUnder: "Who is registered under {{levy}}",
    ofcLvShowingLargest: "Showing the {{n}} largest debts. Narrow by category, levy or LGA to see the rest — the totals above cover only what is listed.",
    pubAttestProgress: "({{answered}} of {{total}} answered)",
    ofcRhAdministrationFor: "Administration — {{name}}",
    ofcRhSignedIn: "signed in",
    ofcTrRegisterFor: "The register — {{name}}",
    ofcUsPrivacyBody: "How the software is being used, not who is using it. These figures carry no identity: no officer, agent or taxpayer is named in them, and groups smaller than {{n}} are withheld rather than shown, because a small enough count singles somebody out even without a name. For an individual agent's work, see",
    actionSearch: "Search",
    colReceiptNumbered: "Receipt {{number}}",
    pickNoTaxpayerMatch: "No taxpayer matches that search. They must be registered before a payment can be attributed to them.",
    grpNotActiveYet: "This group is {{status}}. Members can be recorded once an officer has approved it — there is nothing more to do here until then.",
    grpLeaderMustConfirm: "{{name}} can open it on any phone. Until they confirm, the members you recorded are not counted.",
    moreDraftCaptured: "Captured {{when}}",
    moreCommissionRateOf: "{{rate}}% of",
    moreBankChangeAsking: "You are asking PSIRS to pay your commission into this account: {{destination}}.",
    supYouAt: "You · {{when}}",
    stepUpExpiresIn: "Expires in {{time}}",
    pubRefereeNamedYou: "{{name}} has named you as their referee",
    ofcTrTitle: "Correct a taxpayer record",
    ofcTrIntro: "Every correction is recorded against the officer who made it, with the reason given, and the taxpayer is sent a message telling them their record was changed. Only the fields you fill in are altered.",
    ofcTrNoMatch: "No taxpayer matches that search.",
    ofcTrCorrectedDetails: "Corrected details",
    ofcTrLeaveBlank: "Leave anything that is already right blank.",
    ofcTrIdentificationDocument: "Identification document",
    ofcTrDecidesWhichPerson: "This decides which person the record is about, so it is checked against every other active taxpayer before it is accepted.",
    ofcTrUnchanged: "Unchanged",
    ofcTrNumber: "Number",
    ofcTrNameOrDob: "A name or date of birth can be corrected here. The document the record is held under decides which person it is about, so an administrator has to make that change.",
    ofcTrWhatAndWhy: "What is being corrected, and why",
    ofcTrLiableFor: "What this taxpayer is liable for",
    ofcTrWaiveBody: "Waiving an obligation stops future assessments against it. Invoices already raised stay payable — cancelling those is a separate decision, invoice by invoice.",
    ofcTrWaive: "Waive",
    ofcTrVehiclesOnRecord: "Vehicles on this record",
    ofcTrVehiclesBody: "Particulars cannot be renewed for a vehicle that is suspended or off the register. Renewals already issued stay valid for the period they were paid for.",
    ofcTrTakeOffRegister: "Take off the register",
    ofcTrPutBackInService: "Put back in service",
    ofcTrEndedBody: "A record that is suspended or closed stops accruing new charges and stops receiving reminders. Nothing already owed is written off: it stays payable, stays in the revenue figures, and appears under ended records that still owe until it is settled.",
    ofcTrWhatHappened: "What has happened to this taxpayer",
    ofcTrClosedOption: "Closed — the business has shut or the person has died",
    ofcTrSuspendedOption: "Suspended — paused pending an enquiry",
    ofcTrActiveOption: "Active — put the record back on the register",
    ofcTrHowEstablished: "How this was established",
    ofcTrSearchPlaceholder: "Name, phone, TIN or receipt number",
    ofcTrNeedsAdministrator: "Changing the identification document needs an administrator",
    ofcTrSampleCorrection: "Surname was misspelt at registration; corrected against the NIN slip presented at the office.",
    ofcTrSampleVehicle: "Sold out of state and re-registered in Kaduna.",
    ofcTrSampleClosure: "Premises visited on 12 August: the shop has been empty since the market fire in March.",
    ofcTrRecordedBy: "Recorded by",
    ofcFnThreeWay: "Three-way reconciliation",
    ofcFnThreeWayBody: "Platform transaction against gateway transaction against government settlement. Anything that does not match becomes an exception below.",
    ofcFnRunReconciliation: "Run reconciliation",
    ofcFnRecoverMissed: "Recover missed confirmations",
    ofcFnRecoverMissedBody: "\"Recover missed confirmations\" re-checks payments the gateway completed but the platform never confirmed — normally a webhook that never arrived — and issues the receipts owed.",
    ofcFnStatementBody: "What the gateway paid into the government account, and the collections it covers. The platform adds up those collections itself; if the credit does not match, the batch is recorded as disputed and none of it is settled.",
    ofcFnValueDate: "Value date",
    ofcFnBankReference: "Bank reference",
    ofcFnCredited: "Credited (₦)",
    ofcFnGatewayReferences: "Gateway references",
    ofcFnAwaitingSettlement: "Awaiting settlement from the gateway",
    ofcFnAwaitingSettlementBody: "Confirmed by the gateway and not yet paid into the government account. Normal for a day or two; nobody has to do anything with these. Anything older than three days has moved to the exception queue below, because by then the money should have arrived.",
    ofcFnExceptionQueue: "Exception queue",
    ofcFnExceptionQueueBody: "Every exception is a finance officer’s task. Nothing here is written off automatically. Money still inside the gateway’s settlement window is above, not here.",
    ofcFnResolve: "Resolve",
    ofcFnSettlements: "Settlements to government accounts",
    ofcFnCloseDispute: "Close dispute",
    ofcFnDisputeBody: "A settlement whose credit does not match the collections it covers settles none of them: the money has not arrived, so the commission on it is not payable. Closing the dispute needs a second finance officer and a credit that accounts for the batch in full.",
    ofcFnCommissionPayouts: "Commission payouts",
    ofcFnCommissionBody: "Commission is calculated by the platform from verified government revenue. It is never deducted from what a taxpayer pays, and never payable on a reversed transaction.",
    ofcFnPromoteEligible: "Promote eligible commission",
    ofcFnTransferFailed: "Transfer failed",
    ofcFnMakerChecker: "Maker-checker approvals",
    ofcFnMakerCheckerBody: "The officer who raises a request can never review or authorise it. Reversals need a third officer to execute, with step-up authentication.",
    ofcFnApproved: "Approved",
    ofcFnRejected: "Rejected",
    ofcFnExecuted: "Executed",
    ofcFnYourRequest: "Your request",
    ofcFnExecuteReversal: "Execute reversal",
    ofcFnNotYourRole: "Settlement figures are not available to your role",
    ofcFnTotalExpected: "Total expected",
    ofcFnTotalReceived: "Total received",
    ofcFnVariance: "Variance",
    ofcFnAsOnStatement: "As it appears on the statement",
    ofcFnOnePerLine: "One per line, or separated by commas",
    ofcFnException: "Exception",
    ofcFnDate: "Date",
    ofcFnPayout: "Payout",
    ofcFnEntries: "Entries",
    ofcFnBankAccount: "Bank account",
    ofcFnRequestedBy: "Requested by",
    ofcCfCatalogueIntro: "Revenue items and their rates are government configuration, not code. Changing a rate creates a new version with an effective date — it never rewrites what was already assessed.",
    ofcCfAddRevenueItem: "Add a revenue item",
    ofcCfHistoricalAssessments: "Historical assessments remain attached to the version in force when they were raised.",
    ofcCfChangeRate: "Change rate",
    ofcCfNewRevenueItem: "New revenue item",
    ofcCfCreatedWithoutPrice: "The item is created without a price. Set its rate afterwards with “Change rate” — until you do, an agent cannot assess it in the field.",
    ofcCfChooseCategory: "Choose a category",
    ofcCfHowOften: "How often it is charged",
    ofcCfWhatItIsFor: "What it is for",
    ofcCfWhoItApplies: "Who it applies to",
    ofcCfSelfAssessable: "A taxpayer may assess this themselves",
    ofcCfCommissionable: "An agent earns commission on it",
    ofcCfWhatIsHappening: "What is happening to this item",
    ofcCfSuspendOption: "Suspend — pause collection while something is settled",
    ofcCfRetireOption: "Retire — the charge has ended, and cannot be brought back",
    ofcCfRetireWarning: "Retiring cannot be undone. If the charge is reintroduced later it needs a new revenue item, with its own code and rate.",
    ofcCfCurrentVersionStays: "The current version stays on record and keeps applying to assessments already raised.",
    ofcCfRateType: "Rate type",
    ofcCfFixedAmount: "Fixed amount",
    ofcCfPercentage: "Percentage",
    ofcCfNewAmount: "New amount (₦)",
    ofcCfNewRate: "New rate (%)",
    ofcCfEffectiveFrom: "Effective from",
    ofcCfReasonForChange: "Reason for the change (minimum 10 characters)",
    ofcCfRate: "Rate",
    ofcCfChangedBy: "Changed by",
    ofcCfFrequency: "Frequency",
    ofcCfCurrentRate: "Current rate",
    ofcCfOnSale: "On sale",
    ofcCfSampleReason: "Approved under the 2026 revenue review, Executive Council minute 14/2026.",
    ofcCfProgrammesTitle: "Social incentive programmes",
    ofcCfProgrammesIntro: "Programmes record who qualifies for a government benefit and why. They add entitlement — they never withdraw a service. Each citizen with a TIN who meets the criteria automatically qualifies when evaluated.",
    ofcCfEssentialServiceLink: "A programme that links an essential public service to tax compliance can only be created if the legal or policy authority for that linkage is recorded against it.",
    ofcCfBeneficiaries: "Beneficiaries",
    ofcCfNoEligibleYet: "No eligible taxpayers yet. Run \"Evaluate all\" to assess the active taxpayer population.",
    ofcCfEssentialProtected: "Essential services are protected",
    ofcCfBenefit: "Benefit",
    ofcCfMinScore: "Min. score",
    ofcCfRequiresNoArrears: "Requires no arrears",
    ofcCfEligible: "Eligible",
    ofcCfEvaluated: "Evaluated",
    ofcOvTransactionCount: "{{n}} transaction(s)",
    ofcOvSettlementsOutstanding: "{{n}} settlement(s) outstanding",
    ofcOvIntact: "Audit trail intact",
    ofcOvChainIntact: "Verified over {{count}} entries. No tampering detected.",
    ofcOvChainGenesisRemoved:
      "Broken at entry {{sequence}}: the oldest entry names a predecessor that is not there, so the beginning of the log has been removed.",
    ofcOvChainLinkMismatch:
      "Broken at entry {{sequence}}: an entry is missing, or was inserted out of order.",
    ofcOvChainContentModified:
      "Broken at entry {{sequence}}: the entry's content does not match its recorded hash, so the row was changed after it was written.",
    ofcOvSystem: "System",
    ofcOvNoRows: "No rows",
    ofcOvLeakageTitle: "Revenue leakage monitoring",
    ofcOvSignalsBody: "Signals are raised for review, never acted on automatically. No transaction is deleted or blocked by a heuristic.",
    ofcOvSweepBody: "The sweep re-runs every heuristic over the current data and raises what it finds. It raises flags for a person to judge and changes no transaction, so running it is safe — but it is a deliberate act rather than something that happens quietly, which is why it is a button.",
    ofcOvAgentsWithFlags: "Agents with open flags",
    ofcOvFraudSignals: "Fraud signals",
    ofcOvUnderReview: "Under review",
    ofcOvDismissed: "Dismissed",
    ofcOvConfirm: "Confirm",
    ofcOvDismiss: "Dismiss",
    ofcOvUnattendedWork: "Unattended work",
    ofcOvOpenFlags: "Open flags",
    ofcOvHighestSeverity: "Highest severity",
    ofcOvAuditTrail: "Audit trail",
    ofcOvChainBody: "Every entry is chained to the one before it. Editing or removing any historical entry breaks the chain and is detected by the check below.",
    ofcOvVerifyChain: "Verify chain integrity",
    ofcOvStandardQuestions: "Standard audit questions",
    ofcOvStandardQuestionsBody: "Answerable without querying production tables directly.",
    ofcOvEntityType: "Entity type",
    ofcOvAction: "Action",
    ofcOvFindTheTaxpayer: "Find the taxpayer",
    ofcOvUnreconciled48h: "Unreconciled over 48h",
    ofcOvSettlementShortfall: "Settlement shortfall",
    ofcOvDuplicatePayments: "Duplicate payments",
    ofcOvFailedVerifications: "Failed receipt verifications",
    ofcOvNoValidReceipt: "Public checks that found no valid receipt",
    ofcOvEntityPlaceholder: "payment, agent, taxpayer…",
    ofcOvActionPlaceholder: "payment.verified",
    ofcOvReversedAfterPayment: "Transactions reversed after successful payment",
    ofcOvAllRateChanges: "All changes made to revenue rates",
    ofcOvOneAgentCollected: "Everything one agent collected",
    ofcOvReceiptsOneItem: "Receipts issued under one revenue item",
    ofcOvWhoLookedAtRecord: "Who has looked at one taxpayer’s record",
    ofcOvJob: "Job",
    ofcOvRuns: "Runs",
    ofcOvLastSucceeded: "Last succeeded",
    ofcOvWhatThatMeans: "What that means",
    ofcOvActor: "Actor",
    ofcOvEntity: "Entity",
    ofcOvResult: "Result",
    ofcOvHash: "Hash",
    ofcOvTampered: "Audit trail has been tampered with",
    ofcDbShowing: "Showing {{territories}}",
    ofcDbCoversYourTerritory: "Every figure on this page covers your territory only, not the whole state.",
    ofcDbCoversYourTerritories: "Every figure on this page covers your territories only, not the whole state.",
    ofcDbNeedAttention: "{{n}} item(s) need attention",
    ofcDbExceptionsAnd: "{{exceptions}} reconciliation exception(s) and {{flags}} open fraud flag(s).",
    ofcDbNewThisMonth: "{{n}} new this month",
    ofcDbAwaitingReview: "{{n}} awaiting review",
    ofcDbFailedCount: "{{n}} failed",
    ofcRvArea: "Area",
    ofcDbNoTerritoryBody: "These figures are empty because your account covers no territory yet, not because nothing was collected. Ask an administrator to assign yours.",
    ofcDbNoTerritoryTitle: "No territory has been assigned to you",
    ofcDbReviewReconciliation: "Review reconciliation",
    ofcDbReviewFlags: "review flags",
    ofcDbCollectionsLast30: "Collections over the last 30 days",
    ofcDbOnlyConfirmed: "Only payments confirmed by the payment gateway are counted.",
    ofcDbRevenueByLga: "Revenue by Local Government Area",
    ofcDbBelowPotential: "Identifies areas where collection is below potential.",
    ofcDbRevenueByCategory: "Revenue by category",
    ofcDbWhichHeads: "Which heads of revenue are actually producing.",
    ofcDbTopAgents: "Top performing agents",
    ofcDbTopAgentsBody: "Ranked by verified collections. Personal details beyond name and code are not shown here.",
    ofcDbRevenueByMda: "Revenue by MDA",
    ofcDbIntelligenceTitle: "Geographic revenue intelligence",
    ofcDbDrill: "Drill from State to LGA to Ward to Community to see where revenue is and is not being collected.",
    ofcDbPlateauState: "Plateau State",
    ofcDbPlatformKpis: "Platform KPIs",
    ofcDbKpisUnreadable: "The platform's own numbers could not be read",
    ofcDbKpisUnreadableBody: "Payments verified, the reconciliation rate and the count still awaiting it are missing from this page rather than zero. Reload, and raise it if it does not clear.",
    ofcDbSinceBegan: "Since the platform began collecting.",
    ofcDbVerifiedOnly: "Verified revenue only",
    ofcDbThisMonth: "This month",
    ofcDbYearToDate: "Year to date",
    ofcDbAccruedNotPaid: "Accrued but not yet paid",
    ofcDbRegisteredTaxpayers: "Registered taxpayers",
    ofcDbSuccessfulTransactions: "Successful transactions",
    ofcDbAwaitingReconciliation: "Awaiting reconciliation",
    ofcDbPaymentsVerified: "Payments verified",
    ofcDbOfEveryAttempted: "Of every payment attempted",
    ofcDbReconciled: "Reconciled",
    ofcDbMatchedAcross: "Matched across platform, gateway and settlement",
    ofcDbReceiptsIssued: "Receipts issued",
    ofcDbOfTransactions: "Of transactions that counted as revenue",
    ofcDbMda: "MDA",
    ofcRvGroupedByAssessment: "Every figure below is grouped by the LGA and ward on the assessment, which is reliable. The map coordinates are separate and are captured by the agent application at the moment of collection — none has arrived yet, which usually means no version carrying that has been deployed, or agents have not granted location permission on their handsets.",
    ofcRvWhoseRevenue: "Whose revenue this is",
    ofcRvWhoseRevenueBody: "PSIRS collects the state’s revenue; this is the arm of government each naira is collected for. An MDA with no revenue item is listed rather than hidden — it means nothing is being collected on its behalf through this platform, which is a finding rather than an absence.",
    ofcRvOwedToCouncils: "Owed to the Local Government Councils",
    ofcRvCouncilsBody: "PSIRS collects this on the Councils’ behalf, so it is theirs rather than the State’s. Only items whose rate a Council sets are counted — a State levy collected in a Council’s area is the State’s. Every Council is listed, including those that collected nothing, because a remittance run has to account for all seventeen.",
    ofcRvWhereGenerated: "Where the revenue is generated",
    ofcRvWhereGeneratedBody: "By ward, with the agents working each one. \"Mapped\" counts the collections that recorded a point; a ward earning well with none mapped is unmapped, not suspicious.",
    ofcRvEachAgentGround: "Each agent, and the ground they cover",
    ofcRvGroundBody: "Agent performance reports how much. This reports where — an agent working one market and an agent covering forty kilometres of road are doing different jobs on the same commission.",
    ofcRvVerifiedLastYear: "Verified revenue in the last year",
    ofcRvGeneratingAreas: "Generating areas",
    ofcRvWardsProduced: "Wards that produced revenue",
    ofcRvArmsNoItem: "Arms of government with no catalogue item",
    ofcRvOwedCouncils: "Owed to Councils",
    ofcRvCollectedOnBehalf: "Collected on their behalf",
    ofcRvPlacedOnMap: "Placed on a map",
    ofcRvWithRecordedPoint: "Collections with a recorded point",
    ofcRvNoPointRecorded: "No collection has recorded where it happened",
    ofcRvMinistryDepartment: "Ministry, Department or Agency",
    ofcRvRevenueItems: "Revenue items",
    ofcRvShare: "Share",
    ofcRvCouncil: "Council",
    ofcRvAgents: "Agents",
    ofcRvMapped: "Mapped",
    ofcRvTerritory: "Territory",
    ofcRvLgas: "LGAs",
    ofcRvWards: "Wards",
    ofcRvCentreOfCollection: "Centre of collection",
    ofcOsCleared: "Cleared",
    ofcOsStillOutstanding: "Still outstanding",
    ofcUsStartedCount: "{{n}} started",
    ofcUsNoAttempts: "No attempts recorded",
    ofcUsNoAbandonment: "No abandonment point reached {{n}} attempts.",
    ofcOsReadingNeeds: "Reading this queue needs",
    ofcOsNotYours: ", which your role does not hold. It is not empty — it is not yours.",
    ofcOsRefundsOwed: "Refunds owed to taxpayers",
    ofcOsReversalBody: "A reversal voids the receipt immediately; the money comes back only when the gateway confirms it. Until then the taxpayer has not been refunded.",
    ofcOsWaitingTinTitle: "Taxpayers waiting for a TIN",
    ofcOsWaitingTinBody: "Registered while the PSIRS TIN service could not be reached. They can be assessed and can pay; only the number is missing.",
    ofcOsRenewalsUnackTitle: "Renewals the vehicle authority has not acknowledged",
    ofcOsRenewalsUnackBody: "The renewal itself is valid and paid for. What is outstanding is the authority recording it, which matters the first time the driver is stopped.",
    ofcOsVehiclesUncheckedTitle: "Vehicles captured without an authority check",
    ofcOsVehiclesUncheckedBody: "Recorded from what the owner presented because the authority could not be reached. The details have not been confirmed against the register.",
    ofcOsEndedOwingTitle: "Ended records that still owe",
    ofcOsEndedOwingBody: "Closed or suspended while money was outstanding. Nothing has been written off — the reminder sweep has stopped chasing these, so they are worked by hand until they are paid or the record goes back on the register.",
    ofcOsNothingOutstanding: "Nothing is outstanding",
    ofcOsOwedToTaxpayers: "Owed to taxpayers",
    ofcOsRefundsNotMade: "Refunds not yet made",
    ofcOsWaitingForTin: "Waiting for a TIN",
    ofcOsRenewalsUnacknowledged: "Renewals unacknowledged",
    ofcOsRefund: "Refund",
    ofcOsAttempts: "Attempts",
    ofcOsWhyNotYet: "Why not yet",
    ofcOsLastTried: "Last tried",
    ofcOsOwedSince: "Owed since",
    ofcOsValidUntil: "Valid until",
    ofcOsState: "State",
    ofcOsOwed: "Owed",
    ofcOsWhyEnded: "Why it ended",
    ofcOsEnded: "Ended",
    ofcUaTheirAccess: "Where they are signed in",
    ofcUaAccessFor: "Where {{name}} is signed in",
    ofcUaBackToMine: "Back to my own access",
    ofcRhAgentApproved: "{{name}} approved.",
    ofcAlRoundQuantity: "{{total}} {{unit}}, {{per}} each",
    ofcAlAwardedLeft: "{{awarded}} awarded, {{left}} left",
    ofcPfWorkedOf: "{{worked}} of {{total}}",
    ofcFnSettlementClosed: "{{reference}} closed. {{n}} collection(s) settled.",
    ofcGrGroupSuspended: "{{name}} suspended.",
    ofcGrQuantityPeople: "{{quantity}} ({{n}} people)",
    supRepliesCount: "{{n}} reply(s)",
    ofcOsQueueUnreadable: "A queue could not be read",
    ofcOsQueueUnreadableBody: "{{n}} of the queues on this page could not be loaded, so what is shown is not the whole picture. An empty section below does not mean that queue is empty — it means nobody can see it. Reload, and raise it if it does not clear.",
    ofcUaCoversNothing: "{{name}} now covers no territory and will see no revenue figures.",
    ofcUaCoversTerritories: "{{name}} now covers {{n}} territory(ies).",
    ofcFaMinimumNow: "Minimum version is now {{version}}.",
    ofcFaNoneBelowIt: "No active handset is below it.",
    ofcFaCannotCollect: "{{locked}} of {{total}} active handset(s) cannot collect until they update.",
    ofcTrVehicleBackInService: "{{plate}} is back in service and its particulars can be renewed.",
    ofcTrVehicleSuspended: "{{plate}} is suspended. Renewals are refused until it is lifted.",
    ofcTrVehicleArchived: "{{plate}} has been taken off the register. Renewals are refused.",
    colPayReceipted: "Payment confirmed. Receipt {{number}} has been issued.",
    colPayAwaitingSettlement: "The gateway has confirmed this payment. The government receipt is issued once the money reaches a government account.",
    colPayStillPending: "The gateway has not answered yet. Do not take this payment again — check back shortly.",
    colPayFailed: "The payment did not succeed. No money has been received and no receipt has been issued.",
    ofcFnPromotedForPayout: "{{n}} commission record(s) became eligible for payout.",
    ofcCfEvaluatedCount: "{{n}} citizen(s) evaluated against this programme.",
    ofcTrObligationsUpdated: "{{added}} obligation(s) added, {{waived}} waived.",
    ofcTrOneDetailCorrected: "One detail on this taxpayer record has been corrected. The change is on the audit trail.",
    ofcTrDetailsCorrected: "{{n}} details on this taxpayer record have been corrected. The change is on the audit trail.",
    ofcTrOnRegisterAgain: "{{name}} is on the register again and can be assessed.",
    ofcTrRecordEnded: "{{name}} is {{status}}. No new assessment can be raised and reminders stop.",
    ofcTrStillOwedAfterEnding: "What is already owed remains owed, and this record now appears in the queue of ended records with arrears.",
    ofcTrNothingWasOutstanding: "Nothing was outstanding.",
    ofcOsRefundsReturned: "{{n}} refund(s) returned to taxpayers.",
    ofcOsRefundsPartly: "{{done}} returned; {{left}} still owed. Those taxpayers have not had their money back yet.",
    ofcOsTinsAssigned: "{{n}} TIN(s) assigned.",
    ofcOsTinsPartly: "{{done}} assigned; {{left}} still outstanding. Those taxpayers remain registered and can still be assessed and pay.",
    ofcOsRenewalsAcked: "{{n}} renewal(s) acknowledged by the vehicle authority.",
    ofcOsRenewalsPartly: "{{done}} acknowledged; {{left}} still could not be sent. The renewals themselves remain valid — retry again later.",
    ofcUsTitle: "Product usage — last 30 days",
    ofcUsReportsCollections: ", which reports collections.",
    ofcUsIntro: "Usage is reported by the agent application and this portal as they are used. An empty page here means no version carrying the reporting has been deployed yet, or nobody has opened one since it was.",
    ofcUsEveryFlow: "Every flow",
    ofcUsWhereGiveUp: "Where people give up",
    ofcUsWhereGiveUpBody: "The last step an abandoned attempt reached. This is the screen to go and look at — an abandoned registration creates no taxpayer, so nothing else in the platform records that it happened.",
    ofcUsReachBeyondJos: "Reach beyond Jos",
    ofcUsReachBody: "Whether the platform works as well in the rural LGAs as in the capital. A completion rate that is fine statewide and poor here is the difference between serving the grassroots and serving Jos.",
    ofcUsOfflineQueue: "The offline queue",
    ofcUsScreensReached: "Screens reached",
    ofcUsNothingReported: "Nothing has been reported yet",
    ofcUsRegistrationsCompleted: "Registrations completed",
    ofcUsCollectionsCompleted: "Collections completed",
    ofcUsMedianRegistration: "Median registration",
    ofcUsStartToFinish: "Start to finish, on the device",
    ofcUsMedianCollection: "Median collection",
    ofcUsUntilHandedOff: "Until payment is handed off",
    ofcUsFlow: "Flow",
    ofcUsStarted: "Started",
    ofcUsCompleted: "Completed",
    ofcUsCompletion: "Completion",
    ofcUsGivenUp: "Given up",
    ofcUsMedianTime: "Median time",
    ofcUsLastStepReached: "Last step reached",
    ofcUsZone: "Zone",
    ofcUsCount: "Count",
    ofcUsMedianDelay: "Median delay",
    ofcUsEvents: "Events",
    ofcUsScreen: "Screen",
    ofcUsViews: "Views",
    ofcGpConfirmationLinkFor: "Confirmation link for {{group}}",
    ofcSpOpenComplaints: "{{n}} open complaint(s) about conduct or charges",
    ofcSpAboutRevenue: "These are reports about how revenue was collected, not about the platform. They are listed first below.",
    ofcSpSupportQueue: "Support queue",
    ofcSpQueueIntro: "Ordered by priority. A ticket is answered in its thread — a status change on its own tells the person who reported it nothing.",
    ofcSpAssigned: "Assigned",
    ofcSpInProgress: "In progress",
    ofcSpResolved: "Resolved",
    ofcSpClosed: "Closed",
    ofcSpBackToQueue: "Back to the queue",
    ofcSpNobodyReplied: "Nobody has replied yet.",
    ofcSpReadOnlyNote: "Replying and moving a ticket need support:manage. You can read everything here, including internal notes.",
    ofcSpClosedKeepsHistory: "A closed ticket keeps its history. New problems get new tickets.",
    ofcSpKeepInternal: "Keep this internal — do not show it to the reporter",
    ofcSpMoveTicket: "Move this ticket",
    ofcSpHowResolved: "How was it resolved?",
    ofcSpResolutionRequired: "A resolution is required before a ticket can be marked resolved, and it is shown to the person who reported it.",
    ofcSpMarkResolved: "Mark resolved",
    ofcSpResolutionRecorded: "Resolution recorded",
    ofcSpDone: "Done",
    ofcSpReadAccess: "You have read access to this ticket",
    ofcSpTicketClosed: "This ticket is closed",
    ofcSpTicket: "Ticket",
    ofcSpSubject: "Subject",
    ofcSpPriority: "Priority",
    ofcSpReportedBy: "Reported by",
    ofcSpReplies: "Replies",
    ofcGpLeaderCodeOnce: "Send this to the group leader. It is shown once — PSIRS stores only a hash of it, so it cannot be read back later. Request another if it is lost.",
    ofcGpWaitingDecision: "Waiting for a decision",
    ofcGpWaitingIntro: "An agent has recorded these groups in the field. Members cannot be added until a group is approved, so nothing else happens while they sit here.",
    ofcGpDistributions: "Distributions",
    ofcGpDistributionsIntro: "Fertiliser, seed and other allocations with a fixed quantity behind them. Open one to see who has been awarded and who has actually collected.",
    ofcGpRegisteredGroups: "Registered groups",
    ofcPhTitle: "What they have already paid",
    ofcPhIntro: "Every payment that reached a government account, and what it was for. A taxpayer asking what they have paid is entitled to an answer they can check against their receipts.",
    ofcPhFrom: "From",
    ofcPhTo: "To",
    ofcPhPaid: "Paid",
    ofcPhPayments: "Payments",
    ofcPhReturned: "Returned to them",
    ofcPhForWhat: "What it went to",
    ofcPhLevy: "Tax or levy",
    ofcPhEachPayment: "Each payment",
    ofcPhWhen: "When",
    ofcPhPeriod: "Period",
    ofcPhAmount: "Amount",
    ofcPhReceipt: "Receipt",
    ofcPhNothingPaid: "Nothing was paid in this period.",
    ofcGpTaxRole: "Part in enumeration",
    ofcGpTaxRoleNone: "No part",
    ofcGpTaxRoleNeedsReason: "Write down the reason first. Giving a leader standing over what a member is assessed on is recorded.",
    ofcGpGroupsIntro: "Cooperatives, market associations and unions. The member count is confirmed membership only — what an agent recorded but the leader has not yet confirmed does not count towards anything.",
    ofcGpMembersIntro: "Only confirmed members count towards allocations and group-based programmes. Somebody who has left stays on this list: they were a member when whatever they already collected was awarded.",
    ofcGpMembershipEnded: "Reason a membership ended",
    ofcGpMembers: "Members",
    ofcGpAskLeader: "Ask the leader",
    ofcGpTotal: "Total",
    ofcGpAwarded: "Awarded",
    ofcGpRemaining: "Remaining",
    ofcGpSampleNote: "Checked against the ministry register of cooperatives.",
    ofcGpSampleEnded: "Moved his stall to Bukuru market and left the association.",
    ofcGpMostNotCollected: "Most of this round has not been collected",
    ofcGpNote: "Note",
    ofcGpSector: "Sector",
    ofcGpConfirmedMembers: "Confirmed members",
    ofcGpScoreAtAward: "Score at award",
    ofcLvTitle: "Levies and tax categories",
    ofcLvTaxCategory: "Tax category",
    ofcLvAllCategories: "All categories",
    ofcLvLevyOrItem: "Levy or tax item",
    ofcLvAllItems: "All items",
    ofcLvCollectedFrom: "Collected from",
    ofcLvCollectedTo: "Collected to",
    ofcLvByIndividualLevy: "By individual levy",
    ofcLvOnlyUnpaid: "Only those with something unpaid",
    ofcLvChooseFilter: "Choose a category, a levy, an LGA, or \"only those with something unpaid\" to list the taxpayers it applies to.",
    ofcLvSettledToState: "Settled to the State",
    ofcLvAwaitingSettlement: "Awaiting settlement",
    ofcLvTaxpayersInArrears: "Taxpayers in arrears",
    ofcLvTotalOutstanding: "Total outstanding",
    ofcLvCollections: "Collections",
    ofcLvSettled: "Settled",
    ofcLvLevy: "Levy",
    ofcLvInvoices: "Invoices",
    ofcLvOldestDue: "Oldest due",
    ofcNavArrears: "Arrears worklist",
    ofcArTitle: "Who owes the State money",
    enumAssessed: "Assessed",
    ofcEnRecorded: "What has been recorded",
    ofcEnRecordedIntro: "Observations from the field and what became of each. An observation the association disputed cannot be assessed until somebody goes back and looks again.",
    ofcEnAttestation: "Attestation",
    ofcEnNotYetAssessed: "Not assessed yet",
    ofcEnExempt: "Exempt",
    ofcEnAction: "Next",
    ofcEnSettleFirst: "Disputed — settle it first",
    ofcEnLeaderAgrees: "Leader confirms",
    ofcEnAssess: "Assess",
    ofcEnAlreadyObjected: "Objection open",
    ofcEnRecordObjection: "Record an objection",
    ofcEnAttestedByName: "Attesting leader’s name",
    ofcEnStatementFirst: "Write what the taxpayer says first.",
    ofcEnNothingRecorded: "Nothing has been recorded yet.",
    enumFactsWrong: "The facts are wrong",
    enumHasRecords: "Has proper records",
    enumNotTrading: "No longer trading",
    enumEnumeration: "Enumeration only",
    enumBusinessObservation: "Business written down",
    enumAttestation: "Enumeration and attestation",
    enumObjected: "Under objection",
    enumUpheld: "Upheld",
    enumAgreed: "Leader agreed",
    enumDisagreed: "Leader disagreed",
    enumNotSought: "No attestation sought",
    ofcNavEnumeration: "Enumeration queues",
    ofcEnTitle: "What enumeration left for a person to decide",
    ofcEnIntro: "Two queues. Where an agent and an association leader described the same trader differently, and where a taxpayer has formally disputed an estimate. Both are decisions a machine should not make.",
    ofcEnDisagreements: "Where the agent and the leader differ",
    ofcEnDisagreementsIntro: "An agent recorded one thing and the association leader another. Both versions are shown, with the band each would produce — a difference that does not change the band is a phone call, one that does is a visit.",
    ofcEnGroup: "Association",
    ofcEnAgentSaw: "The agent recorded",
    ofcEnLeaderSays: "The leader disputes",
    ofcEnBandGap: "Effect on the band",
    ofcEnSameBand: "Same band either way",
    ofcEnObservedOn: "Recorded on",
    ofcEnAttestedBy: "Attested by",
    ofcEnNoDisagreements: "Nothing is in dispute.",
    ofcEnObjections: "Estimates under objection",
    ofcEnOpenObjections: "Open objections",
    ofcEnUnderObjection: "Tax under objection",
    ofcEnWhileOpenTitle: "While an objection is open",
    ofcEnWhileOpen: "The debt is not chased. It is off the arrears worklist until this is decided, so nobody will be called about it in the meantime.",
    ofcEnDecisionReason: "Why are you deciding this way?",
    ofcEnDecisionReasonHint: "The taxpayer will be shown this.",
    ofcEnGround: "Ground",
    ofcEnWhatTheySay: "What the taxpayer says",
    ofcEnRaisedOn: "Raised on",
    ofcEnDecision: "Decision",
    ofcEnYoursToPassOn: "You raised this assessment — another officer must decide",
    ofcEnUphold: "Uphold the objection",
    ofcEnReject: "Reject the objection",
    ofcEnReasonFirst: "Write the reason first.",
    ofcEnNoObjections: "No estimate is under objection.",
    ofcPsPublish: "Publishing",
    ofcPsPublishClass: "Publish a local government class",
    ofcPsPublishFigure: "Publish a schedule figure",
    ofcPsChoose: "Choose",
    ofcPsIndicators: "Indicators behind this class",
    ofcPsIndicatorsHint: "e.g. road access, electrification, poverty headcount",
    ofcPsClassPublished: "The classification has been published.",
    ofcPsFigurePublished: "The figure has been published.",
    ofcPsAssumedTurnoverNaira: "Assumed annual turnover (₦)",
    ofcPsAdoptExemption: "Adopt a reading of the exemption",
    ofcPsAdoptWarningTitle: "This decides who is taxed at all",
    ofcPsAdoptWarning: "Adopting a construction decides whether a trader with a shop is exempt, which moves the covered population enormously. Record it only on a written opinion, and cite that opinion below — it will be quoted back at PSIRS by the first person who disagrees.",
    ofcPsConstruction: "Which reading",
    ofcPsCeiling: "Turnover ceiling (₦)",
    ofcPsLegalBasis: "Opinion or instrument relied on",
    ofcPsExemptionAdopted: "The construction has been recorded.",
    enumSmall: "Small",
    enumNano: "Nano — exempt",
    enumPresumptive: "Presumptive — assessed off the schedule",
    enumBooks: "Books — assessed on records",
    enumClassA: "Class A — strongest local economy",
    enumClassB: "Class B",
    enumClassC: "Class C",
    enumClassD: "Class D — weakest local economy",
    enumMicro: "Micro",
    enumConjunctive: "All three limbs together",
    enumTurnoverGoverned: "Turnover governs alone",
    enumNone: "No fixed premises",
    enumStall: "Market stall or table",
    enumKiosk: "Kiosk or container",
    enumLockUpShop: "Lock-up shop",
    enumBuilding: "Building or yard",
    ofcNavPresumptive: "Presumptive schedule",
    ofcPsTitle: "The presumptive schedule",
    ofcPsIntro: "What a trade of a given size is assumed to turn over, by local government class. The rate is one per cent everywhere — what differs is the assumed turnover, because turnover really is lower in some places. Nobody grants a discount and no officer decides anything.",
    ofcPsReadiness: "Whether it can be used yet",
    ofcPsLgasClassified: "Local governments classified",
    ofcPsCells: "Figures published",
    ofcPsExemptionInForce: "The exemption as adopted",
    ofcPsConjunctive: "All three limbs must hold: no fixed premises, no employees, and turnover at or below the ceiling. A trader with a shop is therefore assessed even if their turnover is small.",
    ofcPsTurnoverGoverned: "Turnover governs alone: anyone at or below the ceiling is exempt, whether or not they have a shop or staff.",
    ofcPsNoExemptionAdopted: "No reading of the exemption has been adopted",
    ofcPsNoExemptionExplained: "Nobody can be assessed presumptively until PSIRS records which construction of the nano exemption applies, and on whose written opinion. The two readings differ on whether a trader with a shop is exempt, which is not a question this platform may answer by default.",
    ofcPsPartlyPublished: "The schedule is only partly published",
    ofcPsPartlyPublishedExplained: "{{done}} of {{total}} local governments have a published class. Anyone in the rest cannot be assessed, and quoting figures from this table for them would be quoting figures that do not apply.",
    ofcPsWhatItWouldCost: "What a given trade would pay",
    ofcPsCheckIntro: "Enter what an agent would see standing in the doorway. There is no field for a turnover or a band — those are worked out from what was observed, which is what stops the figure being negotiable.",
    ofcPsPremises: "Premises",
    ofcPsEquipment: "Machines or equipment",
    ofcPsPeople: "People working besides the operator",
    ofcPsWorkItOut: "Work it out",
    ofcPsBand: "Size band",
    ofcPsClass: "Class",
    ofcPsAssumedTurnover: "Assumed annual turnover",
    ofcPsAllAdoptedUnder: 'Every figure below was adopted under',
    ofcPsAnnualTax: "Tax a year",
    ofcPsMonthlyTax: "Tax a month",
    ofcPsExempt: "Exempt — nothing is payable",
    ofcPsExemptExplained: "This operator is a nano business under the construction of the exemption in force, so no presumptive tax is due at all. That is the law working, not a figure that came out small.",
    ofcPsHowWeGotThere: "How that figure was reached",
    ofcPsStep: "Step",
    ofcPsDetail: "What was used",
    ofcPsAmount: "Amount",
    ofcPsNoWorking: "No working to show.",
    ofcPsClasses: "How each local government is classified",
    ofcPsClassesIntro: "Classified on data PSIRS does not produce, and fixed for three years. Both are deliberate: a class drawn from an area’s own collection figures would pay it to under-collect, and one that can move next year is one that will be lobbied about.",
    ofcPsIndexSource: "Whose data",
    ofcPsFrom: "From",
    ofcPsUntil: "Until",
    ofcPsNoEndDate: "No end date set",
    ofcPsNoClasses: "No local government has a published class yet.",
    ofcPsTheTable: "The published figures",
    ofcPsInstrument: "Adopted under",
    ofcPsVersion: "Version",
    ofcPsNoEntries: "No figures have been published yet.",
    ofcPsHowToChange: "A published figure is never edited. Publishing a new one closes the old period and starts a new version, so an assessment made last year can still be checked against the figure it was made under.",
    enumFiled: "Filed",
    ofcPrWithdraw: "Withdraw",
    ofcPrWithdrawReason: "Why is this return being withdrawn?",
    ofcPrWithdrawFirst: "Write the reason first.",
    ofcNavPayroll: "Employers and premises",
    ofcPrTitle: "Employers who should be filing",
    ofcPrIntro: "Schools, clinics, hotels and haulage yards on the register with no PAYE return on record. One employer with forty staff is worth a hundred market visits, and this list costs no field work — it is built from what registration already recorded.",
    ofcPrWhichList: "Which list",
    ofcPrListPaye: "Employers with no PAYE return",
    ofcPrListConsumption: "Hospitality with no consumption tax",
    ofcPrNotFiling: "Not filing",
    ofcPrFiling: "Already filing",
    ofcPrSector: "Sector",
    ofcPrNature: "Nature of business",
    ofcPrOpen: "Open",
    ofcPrNoneNotFiling: "Every employer in these sectors has filed a return.",
    ofcPrNoneNotPaying: "Every hospitality premises here has paid consumption tax this year.",
    ofcPrFiledBefore: "Returns already filed",
    ofcPrPeriod: "Month",
    ofcPrEmployees: "Employees",
    ofcPrGross: "Total pay",
    ofcPrTax: "Tax due",
    ofcPrFiledOn: "Filed on",
    ofcPrWithdrawnBecause: "Withdrawn because",
    ofcPrNeverFiled: "This employer has never filed a return.",
    ofcPrFileAReturn: "File a return",
    ofcPrHowTheTaxIsWorkedOut: "How the tax is worked out",
    ofcPrHowExplained: "Enter what each person was paid for the month. The platform works out the tax on each of them separately, using the annual bands, and adds it up. There is no box for the tax because the tax is not something anybody types.",
    ofcPrYear: "Year",
    ofcPrMonth: "Month number",
    ofcPrEmployeeName: "Employee name",
    ofcPrMonthlyPay: "Paid this month (₦)",
    ofcPrAddEmployee: "Add another employee",
    ofcPrSubmit: "File this return ({{n}} employees)",
    ofcPrFiledTitle: "Return filed",
    ofcPrFiledExplained: "The return covers {{n}} employee(s) and invoice {{invoice}} has been raised for the tax.",
    ofcPrMissingTins: "{{n}} of them had no TIN — collect those and add them to the next return.",
    ofcIgReasonLabel: "Why are you changing this claim?",
    ofcIgReasonFirst: "Write the reason first.",
    ofcNavConnections: "Assets and leads",
    ofcIgTitle: "What is connected to a taxpayer",
    ofcIgIntro: "People running commercial vehicles the State has never assessed for income tax, drawn from the vehicle register PSIRS already keeps. Nothing here comes from outside the platform.",
    ofcIgLimitsTitle: "What this list is, and what it is not",
    ofcIgLimits: "Every line is a claim, not a finding. Read the grounds column before acting: a match on a shared phone number is a reason to ask, never a reason to assess. Opening a record is logged against that person with the purpose you choose.",
    ofcIgAtLeastVehicles: "With at least this many vehicles",
    ofcIgRebuildLabel: "From the register",
    ofcIgRebuildAction: "Rebuild connections",
    ofcIgRebuilt: "{{asserted}} connection(s) recorded: {{registry}} from the register, {{phone}} matched on a shared phone. {{ambiguous}} vehicle(s) matched more than one taxpayer and were left alone.",
    ofcIgLeads: "People to look at",
    ofcIgVehicles: "Commercial vehicles",
    ofcIgUnmatched: "Vehicles with no owner matched",
    ofcIgUnmatchedExplained: "{{n}} vehicle(s) on the register are connected to nobody, so they are not in the count above. That is the part of the problem this list cannot see.",
    ofcIgPurpose: "Why are you opening this record?",
    ofcIgPurposeChoose: "Choose a reason",
    ofcIgPurposeFirst: "Choose a reason first — every read of a record is logged with one.",
    ofcIgRegistrations: "Registrations",
    ofcIgGrounds: "Grounds",
    ofcIgFromRegister: "The register names them",
    ofcIgFromPhone: "Matched on a shared phone number",
    ofcIgChargedCommercial: "Charged the commercial rate",
    ofcIgPaidLastYear: "Paid in the last year",
    ofcIgOpen: "Open record",
    ofcIgNoLeads: "Nobody in this scope has a commercial vehicle and no income assessment.",
    ofcIgRecordTitle: "The record",
    ofcIgWhatWeClaim: "What the State claims about them",
    ofcIgWhatTheyOwe: "What they owe",
    ofcIgThing: "Thing",
    ofcIgRelationship: "Relationship",
    ofcIgSource: "Where it came from",
    ofcIgObtained: "Recorded on",
    ofcIgLawfulBasis: "Power relied on",
    ofcIgDecide: "Decision",
    ofcIgConfirm: "Taxpayer confirms",
    ofcIgDispute: "Taxpayer disputes",
    ofcIgWithdraw: "Withdraw claim",
    ofcIgReasonPrompt: "Say why. This is a record about a person, and a change nobody explained cannot be defended to them.",
    ofcIgNothingClaimed: "The State claims nothing about this person.",
    ofcIgReference: "Reference",
    ofcIgSince: "Since",
    ofcIgPayableNow: "Can be paid now",
    ofcIgPayableYes: "Yes",
    ofcIgPayableNeedsReassessment: "No — needs a fresh assessment",
    ofcIgOwesNothing: "They owe the State nothing.",
    enumAsserted: "Claimed",
    enumConfirmedByTaxpayer: "Confirmed by the taxpayer",
    enumConsistencyCheck: "Checking an assessment against assets",
    enumCoverageLead: "Looking for people not yet assessed",
    enumTaxpayerRequest: "The taxpayer asked to see it",
    enumWithdrawn: "Withdrawn",
    ofcArIntro: "Assessed, unpaid and still payable, largest debt first. These taxpayers are already on the register — this is money the State is owed today, not money it has to go and find.",
    ofcArAtLeast: "Owing at least (₦)",
    ofcArLapsingWithin: "Deadline closing within",
    ofcArAnyDeadline: "Any deadline",
    ofcArWithin7: "7 days",
    ofcArWithin14: "14 days",
    ofcArWithin30: "30 days",
    ofcArCollectableNow: "Collectable now",
    ofcArTaxpayers: "Taxpayers owing",
    ofcArNeedsReassessment: "Needs re-assessment",
    ofcArEndedElsewhere: "Owed by closed records",
    ofcArWhoIsMissing: "Who is not on this list",
    ofcArInFlightExplained: "Anyone part-way through paying is left off, so this list is safe to work as it stands: {{n}} invoice(s) are excluded because a payment is running against them right now. Nobody holding a receipt will be called.",
    ofcArLapsedTitle: "Debt that cannot be paid as it stands",
    ofcArLapsedExplained: "{{n}} invoice(s) have passed their payment deadline. The platform will refuse money against them, so they are counted above but kept off the call list — collecting means raising a fresh assessment first.",
    ofcArWhoToCall: "Who to call",
    ofcArShowingLargest: "Showing the {{n}} largest debts. Narrow by LGA or amount to see further down.",
    ofcArOwedFor: "Owed for",
    ofcArDaysLeft: "Days left to pay",
    ofcArNoDeadline: "No deadline",
    ofcArLastPaid: "Last paid",
    ofcArNeverPaid: "Never",
    ofcArPartPaid: "Part paid",
    ofcArNobodyOwes: "Nobody in this scope owes a collectable debt.",
    ofcAlIntro: "A programme decides who is eligible; a round is one actual distribution. Awards accrue only while a round is open, which is what stops a programme distributing on paper what is not at the collection point.",
    ofcAlNewRound: "New round",
    ofcAlProgramme: "Programme",
    ofcAlSelectProgramme: "Select a programme",
    ofcAlNoProgramme: "No programme exists yet. One has to be created under Social incentives before a round can distribute under it.",
    ofcAlRoundName: "What this round is called",
    ofcAlMeasuredIn: "Measured in",
    ofcAlTotalToDistribute: "Total to distribute",
    ofcAlEachReceives: "Each beneficiary receives",
    ofcAlEnoughFor: "Enough for",
    ofcAlBeneficiariesWord: "beneficiaries.",
    ofcAlCollectionPoint: "Collection point",
    ofcAlOpens: "Opens",
    ofcAlClosesOptional: "Closes (optional)",
    ofcAlRelease: "Release",
    ofcAlAwards: "Awards",
    ofcAlSampleRound: "Dry season fertiliser, Jos North",
    ofcAlSamplePoint: "Terminus Market store, Jos North",
    ofcAlBeneficiary: "Beneficiary",
    ofcAlQuantity: "Quantity",
    ofcAlRound: "Round",
    ofcAlDistributing: "Distributing",
    ofcFaEveryHandsetCan: "Every handset can collect.",
    ofcFaSomeCannotCollect: "These agents cannot collect until they update.",
    ofcKycNotReviewed: "{{n}} document(s) not yet reviewed",
    ofcKycAlready: "Already {{status}}",
    ofcKycIdentityDocuments: "Identity documents",
    ofcKycIntro: "What the applicant submitted. Opening one is recorded against your name.",
    ofcKycNoDocuments: "This applicant has not submitted any documents.",
    ofcKycApprovingBlind: "Approving this applicant without opening them means the identity check rests on the provider’s automated answer alone.",
    ofcKycClose: "Close",
    ofcKycOpenNewTab: "Open it in a new tab",
    ofcKycChecksum: "Checksum",
    ofcKycSuperseded: "A newer capture of this document has been submitted. Review that one instead.",
    ofcKycWhyRequired: "Why? Required either way, and shown to the applicant on a rejection",
    ofcKycAccept: "Accept",
    ofcKycNeedsPermission: "Deciding on a document needs agent:approve.",
    ofcKycWhoLooked: "Who has looked at this?",
    ofcKycSupersededLabel: "Superseded",
    ofcKycDocument: "Document",
    ofcKycCaptured: "Captured",
    ofcKycSize: "Size",
    ofcKycReviewed: "Reviewed",
    ofcKycWho: "Who",
    ofcKycWhat: "What",
    ofcFaIntro: "A handset below the minimum version cannot start a payment or renew a vehicle. It is refused before any money moves, and the agent is told to update. Raise the minimum when a release is getting something wrong in the field; every agent still on that build stops collecting the moment it is published.",
    ofcFaHandsetsInField: "Handsets in the field",
    ofcFaPublishNewMinimum: "Publish a new minimum",
    ofcFaAppendsRecord: "This appends to the record rather than replacing it, so what was required when — and who decided — stays readable. It cannot be edited afterwards.",
    ofcFaMinimumVersion: "Minimum version",
    ofcFaRecommendedVersion: "Recommended version",
    ofcFaRecommendedHint: "What an agent is asked to update to. It cannot be below the minimum.",
    ofcFaWhyMoving: "Why the minimum is moving",
    ofcFaTakesEffectOptional: "Takes effect (optional)",
    ofcFaTakesEffectHint: "Leave empty to take effect immediately. A date in the future announces the change without enforcing it yet; a date at or before the version currently in force is refused, because the gate would never read it.",
    ofcFaHistory: "What has been required, and when",
    ofcFaMinimumInForce: "Minimum version in force",
    ofcFaRecommended: "Recommended",
    ofcFaActiveHandsets: "Active handsets",
    ofcFaBelowMinimum: "Below the minimum now",
    ofcFaSampleReason: "Build 1.3.2 rounds the service charge down; no collection from below 1.4.0.",
    ofcFaBuild: "Build",
    ofcFaHandsets: "Handsets",
    ofcFaAgainstMinimum: "Against the minimum",
    ofcFaTakesEffect: "Takes effect",
    ofcFaMinimum: "Minimum",
    ofcFaPublishedBy: "Published by",
    ofcFaWhy: "Why",
    ofcUaRoleChangeIntro: "Changing a role signs the officer out of every device immediately, because their current access travels in the session they are holding. They sign in again with the new role. Agents are not listed: their access follows the clearance pipeline, not a role.",
    ofcUaNewRole: "New role",
    ofcUaSelectRole: "Select a role",
    ofcUaWhyChanging: "Why this is changing",
    ofcUaNewAccountStatus: "New account status",
    ofcUaSuspendedPending: "Suspended — pending an enquiry",
    ofcUaClosedLeft: "Closed — they have left the service",
    ofcUaActiveLift: "Active — lift a suspension",
    ofcUaTerritoryIntro: "A supervisor sees revenue for the territories assigned here and no others. With none assigned they see nothing at all — which is deliberate, so an account nobody has finished setting up is the least revealing one rather than the most.",
    ofcUaTerritoriesCovered: "Territories covered",
    ofcUaNoTerritory: "No active territory has been created yet.",
    ofcUaYourOwnAccess: "Your own access",
    ofcUaChangeAccess: "Change access",
    ofcUaTerritories: "Territories",
    ofcUaAccount: "Account",
    ofcUaSampleTransferred: "Transferred to the audit office from 1 September.",
    ofcUaSampleLeft: "Left the service at the end of the quarter.",
    ofcUaCannotBeUndone: "This cannot be undone",
    ofcUaSampleTakingOver: "Taking over the Jos North market round from 1 September.",
    ofcUaWillCoverNothing: "This will leave them covering nothing",
    ofcUaLastSignedIn: "Last signed in",
    ofcPfFlagIsQuestion: "A flag is a question, not a finding. Their figures are shown here unchanged —",
    ofcPfAgentsWithFlag: "{{n}} agent(s) with an open fraud flag",
    ofcAllStatuses: "All statuses",
    ofcAllLgas: "All LGAs",
    ofcFrom: "From",
    ofcTo: "To",
    ofcExportCsv: "Export CSV",
    ofcRlExportLimit: "Rows it may export",
    ofcRlExportsNothing: "Exports nothing",
    ofcCwSave: "Save",
    enumIntegrationAlert: "An outside service is not answering",
    enumNeverCalled: "Not called yet",
    enumHealthy: "Answering",
    ofcNavPlatform: "Outside services",
    ofcPlTitle: "Services this platform depends on",
    ofcPlHint: "Measured from the platform's own traffic, not from test calls. Only a service that could not be reached counts against it — an answer nobody likes is still an answer.",
    ofcPlAllAnswering: "All answering",
    ofcPlNeedingAttention: "Needing attention",
    ofcPlService: "Service",
    ofcPlState: "State",
    ofcPlLastAnswered: "Last answered",
    ofcPlInARow: "Unanswered in a row",
    ofcPlCalls: "Calls",
    ofcPlNeverAnswered: "Never",
    ofcPlAdapter: "Configured as",
    ofcPlTin: "The PSIRS TIN service",
    ofcPlKyc: "The government identity service",
    ofcPlVehicles: "The vehicle registration authority",
    ofcPlBanks: "Bank name enquiry",
    ofcPlGateway: "The payment gateway",
    ofcPlNeverCalledBody: "Has not been called once since this database was created.",
    ofcPlDownBody: "{{n}} call(s) in a row could not be answered.",
    ofcPlDegradedBody: "A recent call could not be answered, and the one after it was.",
    ofcPlAnsweringBody: "Answering.",
    ofcPlOutageHint: "Until this screen existed, an outage was discovered by noticing a queue had stopped moving.",
    enumDegraded: "A call went unanswered",
    enumDown: "Not answering",
    ofcOvChange: "What changed",
    enumApprovalWaiting: "An approval is waiting for you",
    enumCaseAssigned: "A case was assigned to you",
    enumCaseEscalated: "A case was escalated to you",
    enumCaseMention: "You were named on a case",
    enumSystemAlert: "Something on the platform has stopped",
    enumInfo: "For information",
    enumWarning: "Worth looking at",
    ofcNavInbox: "Inbox",
    ofcInHint: "What you have been told, and what the platform is saying about itself. Mark a row read once you have dealt with it.",
    ofcInUnread: "Not yet read",
    ofcInCritical: "Needing attention now",
    ofcInCriticalTitle: "The platform needs attention",
    ofcInSeverity: "How urgent",
    ofcInKind: "What it is",
    ofcInSubject: "What happened",
    ofcInWhen: "When",
    ofcInRead: "Read",
    ofcInMarkRead: "Mark read",
    ofcInReadAll: "Mark all read",
    ofcInShowAll: "Show everything",
    ofcInShowUnread: "Show unread only",
    ofcInToYourRole: "to your role",
    ofcInNothing: "Nothing has been raised for you.",
    ofcNavMyAccess: "Where I am signed in",
    ofcAcSessions: "Sessions",
    ofcAcSessionsHint: "Every browser this account is signed in on. End any you do not recognise, then change your password.",
    ofcAcDevices: "Machines",
    ofcAcActivity: "What they have done",
    ofcAcActivityHint: "The last twenty-five things recorded against this account, newest first. A refusal is kept as well as a success — what somebody was stopped from doing is part of the record.",
    ofcAcActivityMine: "What I have done",
    ofcAcActedDays: "Actions in the last {{n}} days",
    ofcAcRefusedDays: "Refused in the last {{n}} days",
    ofcAcOnWhat: "On what",
    ofcAcOutcome: "Outcome",
    ofcAcNoActivity: "Nothing has been recorded against this account.",
    ofcAcDevicesHint: "Recorded the first time this account signs in from a machine. Blocking one ends every session it holds and stops it opening another.",
    ofcAcDevice: "Machine",
    ofcAcUnknownDevice: "Unknown machine",
    ofcAcThisOne: "this one",
    ofcAcAddress: "Address",
    ofcAcSignedIn: "Signed in",
    ofcAcLastUsed: "Last used",
    ofcAcFirstSeen: "First seen",
    ofcAcLastSeen: "Last seen",
    ofcAcLiveSessions: "Open sessions",
    ofcAcEnd: "End",
    ofcAcEndThisOne: "End and sign out",
    ofcAcEnded: "Ended",
    ofcAcBlock: "Block",
    ofcAcUnblock: "Unblock",
    ofcAcBlockedBy: "Blocked by",
    ofcAcNoSessions: "This account has never been signed in.",
    ofcAcNoDevices: "No machine has been recorded yet.",
    ofcCwUploadEvidence: "Upload evidence",
    ofcCwUploadHint: "For a document this platform did not issue: a bank advice, a letter, a photograph. Images and PDFs, up to 15 MB.",
    ofcCwUploadFile: "The file",
    ofcCwUploadWhat: "What it is",
    ofcCwUploadWhere: "Where it came from",
    ofcExportExcel: "Spreadsheet",
    ofcExportPdf: "Document to file",
    ofcExportWorking: "Preparing...",
    ofcDownloadCsv: "Download CSV",
    ofcTxReceipt: "Receipt",
    ofcTxCreated: "Created",
    ofcPfIntro: "Collections, reach and trouble side by side. An agent in a commercial ward will out-collect the best agent in a rural one, so read the columns together rather than sorting by naira.",
    ofcPfCollectedByAgents: "Collected by agents",
    ofcPfTaxpayersOnboarded: "Taxpayers onboarded",
    ofcPfAgentsWorked: "Agents who worked",
    ofcPfOpenFraudFlags: "Open fraud flags",
    ofcPfFiguresUnreadable: "These figures could not be read",
    ofcPfFiguresUnreadableBody: "The totals and the list below are missing, not zero. Nothing on this page is a count of anything — in particular, no claim is being made here about open fraud flags. Reload, and raise it if it does not clear.",
    ofcPfCollected: "Collected",
    ofcPfAverage: "Average",
    ofcPfOnboarded: "Onboarded",
    ofcPfTins: "TINs",
    ofcPfRenewals: "Renewals",
    ofcPfFailed: "Failed",
    ofcPfReversed: "Reversed",
    ofcPfFlags: "Flags",
    ofcPfDaysWorked: "Days worked",
    ofcNoneConfirmedCollectionReachedGovernment: "Every confirmed collection has reached the government account.",
    ofcNoneEveryoneTin: "Everyone has their TIN.",
    ofcNoneLgaEnoughActivityReport: "No LGA has enough activity to report without singling somebody out.",
    ofcNoneMdaCollectionsRecorded: "No MDA collections recorded yet.",
    ofcNoneMdaConfigured: "No MDA is configured.",
    ofcNoneAccessRecorded: "No access recorded.",
    ofcNoneAgentCollectionsRecorded: "No agent collections recorded yet.",
    ofcNoneAgentCollectedPeriod: "No agent has collected in this period.",
    ofcNoneAgentsCleared: "No agents have been cleared yet.",
    ofcNoneAgentsMatchFilter: "No agents match this filter.",
    ofcNoneApplicationsWaitingReview: "No applications are waiting for review.",
    ofcNoneApprovalRequestsMatchFilter: "No approval requests match this filter.",
    ofcNoneAuditEntriesMatchThese: "No audit entries match these filters.",
    ofcNoneBackgroundJobsDeclared: "No background jobs are declared.",
    ofcNoneBeneficiariesFound: "No beneficiaries found.",
    ofcNoneClearanceEventsRecorded: "No clearance events recorded.",
    ofcNoneCollectionsRecordedArea: "No collections recorded for this area.",
    ofcNoneDevicesRegistered: "No devices registered.",
    ofcNoneDistributionRoundCreated: "No distribution round has been created.",
    ofcNoneDistributionsSetUp: "No distributions have been set up yet.",
    ofcNoneDocuments: "No documents.",
    ofcNoneEndedRecordOwesAnything: "No ended record owes anything.",
    ofcNoneFlowsAttemptedPeriod: "No flows have been attempted in this period.",
    ofcNoneFraudSignalsMatchFilter: "No fraud signals match this filter.",
    ofcNoneGroupsRegistered: "No groups have been registered yet.",
    ofcNoneHandsetRegistered: "No handset has been registered yet.",
    ofcNoneIncentiveProgrammesCreated: "No incentive programmes have been created.",
    ofcNoneIndividualLevyCollectedAnything: "No individual levy has collected anything under this filter.",
    ofcNoneLanguageUseReported: "No language use has been reported.",
    ofcNoneLocalGovernmentRevenueCollected: "No local government revenue has been collected in this period.",
    ofcNoneObligationsRecordedAgainstTaxpayer: "No obligations are recorded against this taxpayer.",
    ofcNoneOfficersRecorded: "No officers are recorded.",
    ofcNoneOpenReconciliationExceptions: "No open reconciliation exceptions.",
    ofcNonePayoutRequests: "No payout requests.",
    ofcNoneRateHistory: "No rate history.",
    ofcNoneRecordsMatchQuery: "No records match this query.",
    ofcNoneRefereeNominated: "No referee has been nominated.",
    ofcNoneRefereeRiskFlagsOpen: "No referee risk flags are open.",
    ofcNoneRefereeSupportsMoreApplicant: "No referee supports more than one applicant.",
    ofcNoneRefundOutstanding: "No refund is outstanding.",
    ofcNoneRevenueCollectedPeriod: "No revenue has been collected in this period.",
    ofcNoneRevenueItemsConfigured: "No revenue items configured.",
    ofcNoneScreensReported: "No screens have been reported.",
    ofcNoneSettlementsRecorded: "No settlements recorded.",
    ofcNoneTicketsMatchFilter: "No tickets match this filter.",
    ofcNoneTrainingRecords: "No training records.",
    ofcNoneTransactionsMatchTheseFilters: "No transactions match these filters.",
    ofcNoneVehiclesRecordedAgainstTaxpayer: "No vehicles are recorded against this taxpayer.",
    ofcNoneNobodyAwardedRound: "Nobody has been awarded from this round yet.",
    ofcNoneNobodyAwardedRound2: "Nobody has been awarded under this round yet.",
    ofcNoneNobodyRecordedGroup: "Nobody has been recorded in this group yet.",
    ofcNoneNobodyArrearsFilter: "Nobody is in arrears under this filter.",
    ofcNoneNobodyRegisteredFilter: "Nobody is registered under this filter.",
    ofcNoneNone: "None.",
    ofcNoneNothingCollectedFilter: "Nothing has been collected under this filter.",
    ofcNoneNothingPublished: "Nothing has been published yet.",
    ofcNoneNothingWaiting: "Nothing waiting.",
    ofcNoneAuthorityAcknowledgedRenewal: "The authority has acknowledged every renewal.",
    ofcNoneOfflineQueueUsedPeriod: "The offline queue has not been used in this period.",
    ofcAgAwaitingGovernmentReview: "Awaiting government review",
    ofcAgApplicantsCompleted: "These applicants have completed identity verification and referee clearance.",
    ofcAgAllAgents: "All agents",
    ofcAgSixAxes: "Six independent status axes: an agent is only operational when every one is satisfied.",
    ofcAgOperationalStatus: "Operational status",
    ofcAgAll: "All",
    ofcAgActive: "Active",
    ofcAgInactive: "Inactive",
    ofcAgSuspendedStatus: "Suspended",
    ofcAgBackToAgents: "← Back to agents",
    ofcAgClearanceChecklist: "Clearance checklist",
    ofcAgEveryItemSatisfied: "Every item must be satisfied before activation.",
    ofcAgNoKycSubmitted: "The applicant has not submitted identity verification.",
    ofcAgRefereeHistoryKept: "A replaced referee stays on the record — the history is never overwritten.",
    ofcAgClear: "Clear",
    ofcAgReject: "Reject",
    ofcAgDevices: "Devices",
    ofcAgDevicesBody: "A phone an agent has just registered waits here as PENDING and cannot be used to collect until it is approved. Revoking a device ends its sessions immediately.",
    ofcAgSuspend: "Suspend",
    ofcAgRestore: "Restore",
    ofcAgRevoke: "Revoke",
    ofcAgDecision: "Decision",
    ofcAgDecisionRecorded: "Every decision is recorded against your name in the audit log and requires a reason.",
    ofcAgReasonMinimum: "Reason (minimum 10 characters)",
    ofcAgApproveApplication: "Approve application",
    ofcAgRequestMoreInformation: "Request more information",
    ofcAgAssignTerritory: "Assign territory",
    ofcAgSelectTerritory: "Select a territory",
    ofcAgTerritoryRequired: "Every transaction is attributed to a territory, so one must be assigned before activation.",
    ofcAgActivateAgent: "Activate agent",
    ofcAgActivationBlocked: "Activation is blocked until every clearance item is satisfied. An exception requires an approved government override.",
    ofcAgMoveTerritory: "Move to another territory",
    ofcAgMoveTerritoryBody: "Collections already made keep the territory they were collected under. This decides where the next ones are attributed.",
    ofcAgReassignTerritory: "Reassign territory",
    ofcAgSuspendAgent: "Suspend agent",
    ofcAgClearanceHistory: "Clearance history",
    ofcAgRefereeRiskFlags: "Referee risk flags",
    ofcAgRefereeRiskBody: "Patterns that suggest a referee relationship is not genuine. Nothing is blocked while a flag is merely open — but a flag you uphold stops that referee being cleared until somebody dismisses it with their findings.",
    ofcAgWhatYouFound: "What you found",
    ofcAgLookingIntoIt: "Looking into it",
    ofcAgUpheld: "Upheld — this referee cannot be relied on",
    ofcAgDismissed: "Dismissed — the pattern is innocent",
    ofcAgRefereesMultiple: "Referees supporting more than one applicant",
    ofcAgBankAccountChanges: "Bank account changes",
    ofcAgBankChangeBody: "Where an agent’s commission is paid. Nothing moves until the bank confirms the new account and an officer other than the one who asked approves it. The account in use keeps being used until then.",
    ofcAgNoBankChanges: "No bank account changes are waiting.",
    ofcAgAskBankAgain: "Ask the bank again",
    ofcAgRefuse: "Refuse",
    ofcAgApplicationsReceived: "Applications received",
    ofcAgReadyForReview: "Ready for review",
    ofcAgBothCleared: "KYC and referee both cleared",
    ofcAgActiveAgents: "Active agents",
    ofcAgKycPending: "KYC pending",
    ofcAgAwaitingApplicant: "Awaiting applicant",
    ofcAgKycCleared: "KYC cleared",
    ofcAgRefereePending: "Referee pending",
    ofcAgRefereeFailed: "Referee failed",
    ofcAgApplicationState: "Application state",
    ofcAgAccessStage: "Access stage",
    ofcAgMayCollectRevenue: "May collect revenue",
    ofcAgOutstanding: "Outstanding",
    ofcAgTotalReferees: "Total referees",
    ofcAgPending: "Pending",
    ofcAgCleared: "Cleared",
    ofcAgFailedRejected: "Failed or rejected",
    ofcAgBankDifferentName: "The bank returned a different name",
    ofcAgApplicantsSupported: "Applicants supported",
    ofcAgApplication: "Application",
    ofcAgSubmitted: "Submitted",
    ofcAgCode: "Code",
    ofcAgKyc: "KYC",
    ofcAgOperational: "Operational",
    ofcAgCategory: "Category",
    ofcAgRelationship: "Relationship",
    ofcAgResponded: "Responded",
    ofcAgModule: "Module",
    ofcAgTitleHeading: "Title",
    ofcAgScore: "Score",
    ofcAgVersion: "Version",
    ofcAgEvent: "Event",
    ofcAgReason: "Reason",
    ofcAgSignal: "Signal",
    ofcAgSeverity: "Severity",
    ofcAgDetail: "Detail",
    ofcAgSampleKycNote: "Identity verified against NIN; referee confirmed by district head; records in order.",
    ofcAgSampleRefereeNote: "Called all six applicants; four have never met him.",
    ofcRhBlockedCount: "{{n}} thing(s) are stopping somebody working",
    ofcRhInvoicesStillOpen: "{{n}} invoice(s) still open",
    colShareTitle: "PSIRS receipt",
    colShareBody: "PSIRS receipt {{number}} for {{name}}. Verify with code {{code}}.",
    ofcRhNothingWaiting: "Nothing is waiting.",
    ofcNothingToShow: "Nothing to show.",
    ofcRhActiveRecords: "Active records",
    ofcRhRegisteredByBoth: "Registered by agents and officers",
    ofcRhTinNoTracking: "A taxpayer without one cannot be tracked across years",
    ofcRhCollectedForCouncils: "Collected on their behalf, not the state’s own",
    ofcRhAccruedNotPaid: "Accrued and not yet paid",
    ofcRhExpectedLessReceived: "Expected less received, on unreconciled settlements",
    ofcRhBankPlatformDisagree: "The bank and the platform disagree",
    ofcRhHashChainedShort: "Hash-chained, append-only",
    ofcRhEntriesSinceMidnight: "Entries since midnight",
    ofcRhRaisedNotReviewed: "Raised and not yet reviewed",
    ofcRhAgentsAwaitingClearance: "Agents awaiting clearance",
    ofcRhApplicationsComplete: "Applications complete and waiting on a decision",
    ofcRhAgentsAskedForMore: "Agents asked for more",
    ofcRhWaitingOnApplicant: "Waiting on the applicant, not on you",
    ofcRhDevicesAwaitingApproval: "Devices awaiting approval",
    ofcRhAgentNeedsHandset: "An agent cannot collect until their handset is approved",
    ofcRhSupervisorsNoTerritory: "Supervisors with no territory",
    ofcRhNoFiguresUntilTerritory: "They see no revenue figures at all until one is assigned",
    ofcRhItemsNoRate: "Revenue items with no rate",
    ofcRhNotCollectableYet: "Catalogued and not collectable until government sets the amount",
    ofcRhMdasCollectingNothing: "MDAs collecting nothing",
    ofcRhNoItemForMda: "No revenue item exists for them in this platform",
    ofcRhOfficersWithAccess: "Officers with access",
    ofcRhExcludingFieldAgents: "Excluding field agents",
    ofcRhSupportTicketsOpen: "Support tickets open",
    ofcRhRaisedByAgents: "Raised by agents in the field",
    ofcRhTinApplicationsFailed: "TIN applications failed",
    ofcRhRegisterRefusedThese: "The register refused these — they need a person",
    ofcRhAppliedNotIssued: "Applied for and not yet issued",
    ofcRhCorrectionsAwaiting: "Corrections awaiting review",
    ofcRhSomeoneAskedChange: "Someone has asked to change who a record says they are",
    ofcRhInvoicesUnpaid: "Invoices unpaid",
    ofcRhRaisedStillOpen: "Raised and still open",
    ofcRhInvoicesExpired: "Invoices expired",
    ofcRhNeverPaidOutOfTime: "Never paid and now out of time",
    ofcRhRegisteredThisWeek: "Registered this week",
    ofcRhNewTaxpayers: "New taxpayers on the register",
    ofcRhTaxpayersOnRegister: "Taxpayers on the register",
    ofcRhReconciliationExceptions: "Reconciliation exceptions",
    ofcRhDisagreeAboutThese: "The bank and the platform disagree about these",
    ofcRhSettlementsUnreconciled: "Settlements unreconciled",
    ofcRhReceivedNotMatched: "Money received and not yet matched",
    ofcRhPayoutsToApprove: "Commission payouts to approve",
    ofcRhAgentsWaitingShort: "Agents are waiting on these",
    ofcRhRefundsOwed: "Refunds a taxpayer is still owed",
    ofcRhMoneyStateShouldNotHave: "Money the state has and should not",
    ofcRhMoneyBackOutQuery: "Money that came back out — the query worth running first",
    ofcRhActionsRefusedWeek: "Actions refused this week",
    ofcRhSomeoneTriedNotPermitted: "Someone tried something their role does not permit",
    ofcRhRateChangesMonth: "Rate changes this month",
    ofcRhEveryChangeCharged: "Every change to what a citizen is charged",
    ofcRhReceiptsCheckedPublic: "Receipts checked by the public",
    ofcRhVerificationLookups: "Verification page lookups",
    ofcRhAuditEntriesToday: "Audit entries today",
    ofcRhHashChainedLong: "Hash-chained and append-only",
    ofcRhAuditEntriesTotal: "Audit entries in total",
    ofcRhSincePlatformStarted: "Since the platform started",
    ofcRhTaxpayersOnRecord: "Taxpayers on record",
    ofcRhWaiting: "Waiting",
    ofcRhAgent: "Agent",
    ofcRhWaitingSince: "Waiting since",
    ofcRhApprovedFromHome: "Approved from the administrator home screen.",
    ofcRhRegistered: "Registered",
    ofcRhOfficer: "Officer",
    ofcRhWhyFailed: "Why it failed",
    ofcRhExpires: "Expires",
    ofcRhKind: "Kind",
    ofcRhExpected: "Expected",
    ofcRhReceived: "Received",
    ofcRhRaisedHeading: "Raised",
    ofcRhRequested: "Requested",
    ofcRhWhen: "When",
    ofcRhRole: "Role",
    ofcRhAttempted: "Attempted",
    ofcRhAgainst: "Against",
    ofcRhOutcome: "Outcome",
    ofcRhToday: "Today",
    ofcRhNewThisWeek: "New this week",
    ofcRhOpen: "Open",
    ofcRhOpenFile: "Open file",
    ofcRhApprove: "Approve",
    ofcRhTaxpayers: "Taxpayers",
    ofcRhExceptions: "Exceptions",
    ofcRhAuditEntries: "Audit entries",
    ofcRhAgentsWaiting: "Agents waiting on a decision",
    ofcRhAgentsWaitingBody: "Agents are waiting on these. Approving needs a fresh code, because it is the action that moves money out.",
    ofcRhClearanceBody: "Approving here does what the clearance screen does — same endpoint, same audit entry. Asking for more information needs a reason, so that one opens the file.",
    ofcRhHandsetsWaiting: "Handsets waiting for approval",
    ofcRhHandsetsBody: "A cleared agent still cannot collect until the device in their hand is approved.",
    ofcRhCommissionPayouts: "Commission payouts requested",
    ofcRhCommissionLiability: "Commission liability",
    ofcRhAssessedUnpaid: "Assessed and unpaid",
    ofcRhTinsOutstanding: "TINs outstanding",
    ofcRhTinsBody: "These taxpayers exist and have no TIN, so nothing can follow them across years. Re-asking is safe: the platform sends the same application, and a TIN already issued comes back rather than a second one being made.",
    ofcRhTinRefused: "TIN applications the register refused",
    ofcRhTheRegister: "The taxpayer register",
    ofcRhRegisterBody: "Who is on it, who is missing a TIN, and what has been assessed and not paid.",
    ofcRhMoneyInOut: "Money in, money out, money held",
    ofcRhMoneyBody: "Reconciliation, settlement and what the state owes — to its agents, to taxpayers owed a refund, and to the Councils it collects for.",
    ofcRhOwedToCouncils: "Owed to the Councils",
    ofcRhSettlementVariance: "Settlement variance",
    ofcRhBankDisagree: "Where the bank and the platform disagree",
    ofcRhReconciliationOpen: "Reconciliation exceptions are open",
    ofcRhReconciliationBody: "Until these are resolved the platform’s figures and the bank’s do not agree, and commission on the affected collections stays held.",
    ofcRhExceptionQueueBody: "Resolving an exception is a judgement with a note attached, so it happens on the reconciliation screen where there is room to write one. This is what is waiting.",
    ofcRhWorkExceptionQueue: "Work the exception queue",
    ofcRhReversedRefunded: "Reversed or refunded",
    ofcRhMoneyBackOut: "Money that came back out",
    ofcRhReversedBody: "Reversed or refunded after the fact. The first query worth running on any revenue platform.",
    ofcRhFraudOpen: "Fraud flags open",
    ofcRhInvoicesExpiring: "Invoices about to expire",
    ofcRhInvoicesBody: "Raised, unpaid, and out of time within the week. After that the assessment has to be raised again.",
    ofcRhRefusedActions: "Actions the platform refused",
    ofcRhRefusedBody: "Somebody attempted something their role does not permit. Each is an audit entry in its own right.",
    ofcRhSupervisorsNothing: "Supervisors covering nothing",
    ofcRhSupervisorsBody: "They see no revenue figures at all until a territory is assigned. Choosing which needs the picker, so this one opens Officer access.",
    ofcRhAssignTerritories: "Assign territories",
    ofcRhWhatToExamine: "What there is to examine",
    ofcRhReadOnlyBody: "Read-only, by role and by design. Nothing on this screen changes a record — every figure is a starting point for a query, and the audit log itself is hash-chained and append-only.",
    ofcRhAdminBody: "An agent without clearance or an approved device cannot collect, and a supervisor with no territory sees no figures at all.",
    ofcRhAdminIntro: "What is waiting on an administrator. Collections and revenue analysis are on the dashboard and the revenue summary; this screen is the platform itself.",
    ofcRevenueAdministration: "Revenue administration",
    ofcDistributionRound: "Distribution round",
    ofcLanguage: "Language",
    ofcNavDashboard: "Collections dashboard",
    ofcNavIntelligence: "Revenue intelligence",
    ofcNavRevenue: "Revenue summary",
    ofcNavLevies: "Levies & categories",
    ofcNavTransactions: "Transactions",
    ofcNavAgents: "Agents & clearance",
    ofcNavReferees: "Referees",
    ofcNavPerformance: "Agent performance",
    ofcNavReconciliation: "Reconciliation",
    ofcNavCommissions: "Commissions",
    ofcNavApprovals: "Approvals",
    ofcNavFraud: "Fraud & leakage",
    ofcNavSupport: "Support desk",
    ofcNavOutstanding: "Outstanding work",
    ofcNavAudit: "Audit log",
    ofcNavUsage: "Product usage",
    ofcNavCatalogue: "Revenue catalogue",
    ofcNavProgrammes: "Social incentives",
    ofcNavGroups: "Groups & cooperatives",
    ofcNavTaxpayerRecords: "Taxpayer corrections",
    ofcNavUsers: "Officer access",
    ofcNavFieldApp: "Field application",
    ofcNavAllocations: "Distribution rounds",
    ofcNavMyWork: "My work",
    ofcNavCases: "Cases",
    ofcGroupYourDesk: "Your desk",
    ofcSearchLabel: "Search government records",
    ofcSearchPlaceholder: "Reference, TIN, name or receipt number",
    ofcSearchSearching: "Searching…",
    ofcSearchNoResults: "Nothing matches that.",
    ofcSearchHint: "Two characters or more.",
    ofcSearchTransaction: "Transaction",
    ofcSearchTaxpayer: "Taxpayer",
    ofcSearchAgent: "Agent",
    ofcSearchOfficer: "Officer",
    ofcSearchInvoice: "Invoice",
    ofcSearchReceipt: "Receipt",
    ofcSearchPayment: "Payment",
    ofcSearchAssessment: "Assessment",
    ofcSearchVehicle: "Vehicle",
    ofcSearchRevenueItem: "Revenue item",
    ofcSearchPlace: "Local Government Area",
    ofcSearchCase: "Case",
    ofcMwIntro: "Everything waiting for you, wherever on the platform it came from.",
    ofcMwAssigned: "Assigned to you",
    ofcMwAssignedBody: "Cases somebody has put in your hands.",
    ofcMwOpened: "Cases you opened",
    ofcMwOpenedBody: "Now somebody else’s to work, and still yours to follow.",
    ofcMwMentions: "Where you were named",
    ofcMwMentionsBody: "An officer wrote your name on a case.",
    ofcMwDepartment: "Waiting for your department",
    ofcMwDepartmentBody: "Sent to your role and picked up by nobody yet.",
    ofcMwApprovals: "Approvals awaiting a decision",
    ofcMwExceptions: "Reconciliation exceptions",
    ofcMwFlags: "Risk flags",
    ofcMwOverdue: "Overdue",
    ofcMwNothing: "Nothing is waiting for you.",
    ofcMwOpenQueue: "Open the whole queue",
    ofcCwTitle: "Government work queue",
    ofcCwIntro: "A case carries work between departments, and keeps every step of it.",
    ofcCwOpenCase: "Open a case",
    ofcCwStatus: "Status",
    ofcNavRoles: "Roles & permissions",
    ofcRlTitle: "Roles and permissions",
    ofcRlIntro: "Who may do what. This is data now, so a change in the Service's delegation of authority does not wait for a release.",
    ofcRlCatalogueNote: "The list of permissions that exist stays in code, because a permission is a name the routes check. A grant naming something no route checks would look like a control and be none.",
    ofcRlRole: "Role",
    ofcRlOfficers: "Officers holding it",
    ofcRlPermissions: "Permissions",
    ofcRlSystemRole: "Ships with the platform",
    ofcRlPortalRole: "Signs in to this portal",
    ofcRlGrant: "Grant",
    ofcRlRevoke: "Take away",
    ofcRlGrantReason: "Why this authority is being given",
    ofcRlRevokeReason: "Why this authority is being taken away",
    ofcRlRevokeWarning: "Everybody holding this role will be signed out. That is deliberate: the map is cached, and thirty seconds is a long time for somebody whose authority has just been withdrawn to keep exercising it.",
    ofcRlNewRole: "Add a role",
    ofcRlRoleName: "Name used in code",
    ofcRlRoleLabel: "What officers see",
    ofcRlCopyFrom: "Start from",
    ofcRlCopyFromBody: "Starting from the nearest existing role and taking things away is safer than starting from nothing, which is how a role ends up with everything a week later, one emergency at a time.",
    ofcRlRetire: "Retire",
    ofcRlRestore: "Bring back",
    ofcRlIsPortalRole: "This role signs in to the officer portal",
    ofcRlSignedOut: "Officers signed out",
    ofcRlSearchPermission: "Find a permission",
    ofcNoneRoles: "No role is configured.",
    enumClosing: "Being closed",
    ofcNavPeriods: "Financial periods",
    enumClean: "Clean",
    enumException: "Exception",
    enumNotAvailable: "Could not be examined",
    enumRandom: "Random",
    enumSystematic: "Every nth",
    enumHighestValue: "Largest amounts",
    enumDrawn: "Drawn",
    enumInReview: "Being examined",
    enumGenerated: "Generated",
    enumSigned: "Signed",
    enumTransactionAudit: "Transaction audit",
    enumAgentActivity: "Agent activity",
    enumRevenueCollection: "Revenue collected",
    enumLgaPerformance: "Council performance",
    enumPaymentReconciliation: "Payment reconciliation",
    enumUserActivity: "Officer activity",
    enumAnomaly: "Anomalies",
    enumAuditSample: "Audit samples",
    enumRevenueTarget: "Revenue targets",
    enumPeriodClosing: "Period closing",
    enumDataChange: "Record changes",
    ofcNavWorkbench: "Audit workbench",
    ofcWbSamplesDrawn: "Samples drawn",
    ofcWbItemsOutstanding: "Items still to examine",
    ofcWbExceptionsFound: "Exceptions found",
    ofcWbReportsHeld: "Reports on file",
    ofcWbSamples: "Samples",
    ofcWbSamplesHint: "Each row records a draw that already happened. The criteria, the method and the seed cannot be changed afterwards, which is what lets somebody else reproduce it.",
    ofcWbSampleNumber: "Sample",
    ofcWbTitle: "What this is about",
    ofcWbMethod: "How it was drawn",
    ofcWbMethodRandom: "At random, from a stored seed",
    ofcWbMethodSystematic: "Every nth, in date order",
    ofcWbMethodHighestValue: "The largest amounts (not a sample)",
    ofcWbDrawn: "Drawn of population",
    ofcWbPending: "Not yet examined",
    ofcWbExceptions: "Exceptions",
    ofcWbDrawnAt: "Drawn on",
    ofcWbDrawnBy: "Drawn by",
    ofcWbNoSamples: "No sample has been drawn yet.",
    ofcWbDraw: "Draw a sample",
    ofcWbDrawHint: "Say what the sample is for and how wide to look. Leaving a field empty means it does not narrow anything.",
    ofcWbSize: "How many to draw",
    ofcWbFrom: "From",
    ofcWbTo: "To",
    ofcWbMinimumNaira: "Smallest amount (naira)",
    ofcWbDrawIsFinal: "A draw cannot be taken back or redrawn. Draw a fresh sample if these criteria are wrong.",
    ofcWbDrawnNotice: "{{number}} drawn, {{n}} transactions to examine.",
    ofcWbSeed: "Seed",
    ofcWbPopulation: "Drawn from",
    ofcWbPosition: "Item",
    ofcWbOutcome: "Finding",
    ofcWbFinding: "What was found",
    ofcWbRecord: "Record",
    ofcWbNoItems: "This sample selected nothing.",
    ofcWbCompleteHint: "A sample can only be completed once every item has a finding. Half-finished work reported as complete is worse than no sample.",
    ofcWbComplete: "Complete this sample",
    ofcWbReports: "Audit reports",
    ofcWbReportsHint: "Each report holds the rows as they stood when it was generated, with a checksum a reader can recompute.",
    ofcWbReportNumber: "Report",
    ofcWbReportType: "Question it answers",
    ofcWbRows: "Rows",
    ofcWbPeriod: "Period",
    ofcWbGeneratedAt: "Generated on",
    ofcWbSignedBy: "Signed by",
    ofcWbChecksum: "Checksum",
    ofcWbOpenReport: "Open",
    ofcWbWhatWasFrozen: "What was frozen",
    ofcWbRecomputed: "Recomputed now",
    ofcWbStored: "Stored when signed",
    ofcWbChecksumAgrees: "The stored rows still hash to the checksum recorded with them.",
    ofcWbChecksumDiffers: "The stored rows no longer hash to the checksum recorded with them. Read the rows below against a printed copy before relying on either.",
    ofcWbPayloadRows: "Rows as they were frozen",
    ofcWbViewIsRecorded: "Opening a signed report is itself recorded against your name.",
    ofcWbNoPayload: "This report was frozen with no rows in it.",
    ofcWbAltered: "Altered",
    ofcWbAlteredTitle: "A report on this page no longer matches its checksum",
    ofcWbAlteredBody: "{{n}} report(s) below hold figures that no longer hash to the checksum recorded when they were generated. A signature on such a report does not cover what it now shows. This is a change made in the database rather than through the platform — do not rely on those figures, and raise it.",
    ofcWbNoReports: "No report has been generated yet.",
    ofcWbGenerate: "Generate a report",
    ofcWbGenerateHint: "Generating freezes the figures. Signing is a separate step, and often a different officer.",
    ofcWbGenerated: "{{number}} generated, {{n}} rows.",
    ofcWbSign: "Sign",
    ofcWbWithdraw: "Withdraw",
    ofcWbActions: "Actions",
    ofcWbClose: "Close",
    ofcWbReference: "Reference",
    ofcWbTaxpayer: "Taxpayer",
    ofcWbAmount: "Amount",
    ofcPeTitle: "Financial periods",
    ofcPeIntro: "Closing a month freezes what the State says it collected in it. After a close the database itself refuses to write into the month — this is a control, not a report.",
    ofcPeOpenPeriod: "Open a period",
    ofcPePeriod: "Period",
    ofcPeCollected: "Collected",
    ofcPeSettled: "Settled to government",
    ofcPeCommission: "Commission",
    ofcPeTransactions: "Transactions",
    ofcPeClose: "Close the month",
    ofcPeBeginClosing: "Begin closing",
    ofcPeReopen: "Reopen",
    ofcPeClosedBy: "Closed by",
    ofcPeReopenedBy: "Reopened by",
    ofcPeClosingNote: "What is being certified",
    ofcPeReopenReason: "Why it is being reopened",
    ofcPeNotReady: "Not ready to close",
    ofcPeNotReadyBody: "Closing over an unresolved exception or a pending payment freezes a figure already known to be wrong. It is sometimes the right call, and it is never a silent one.",
    ofcPeOverride: "Why you are closing over them",
    ofcPeFiguresUnknown: "What this month still holds could not be read",
    ofcPeFiguresUnknownBody: "The platform could not count this month's unresolved exceptions or pending payments, so it cannot tell you whether the figure is settled. It may be. Closing is still possible, and it needs a reason in writing, because a month closed without knowing is a month closed over whatever was there.",
    ofcPeUnreconciled: "Unresolved exceptions",
    ofcPePendingPayments: "Payments still pending",
    ofcPeFiguresNow: "What the month holds now",
    ofcPeFrozen: "Frozen at close",
    ofcPeReopenSeparate: "Reopening is the administrator's, not the closer's. The officer who closes the books also being able to unclose them removes most of what a period lock is for.",
    ofcNonePeriods: "No financial period has been opened yet.",
    enumSupervisorChange: "Reporting line",
    enumRoleChange: "Role",
    ofcNavOrganisation: "Departments & offices",
    ofcOrTitle: "The organisation",
    ofcOrIntro: "Who works with whom, who answers for them, and where they sit. A department is a body; a role is what somebody may do. Both are needed and neither replaces the other.",
    ofcOrDepartments: "Departments",
    ofcOrOffices: "Revenue offices",
    ofcOrOfficesBody: "Where officers sit, which is not the territory they cover. The Jos North office administers three LGAs.",
    ofcOrNewDepartment: "Add a department",
    ofcOrNewOffice: "Add an office",
    ofcOrCode: "Code",
    ofcOrFunction: "Work it does",
    ofcOrHead: "Answers for it",
    ofcOrParent: "Sits under",
    ofcOrOfficers: "Officers",
    ofcOrOpenCases: "Open cases",
    ofcOrCovers: "Administers",
    ofcOrClose: "Close",
    ofcOrPosting: "Posting",
    ofcOrPostingBody: "Each part that moves is recorded as its own dated transfer, so a move to Finance and a change of supervisor have separate answers.",
    ofcOrMoveOfficer: "Move this officer",
    ofcOrDepartment: "Department",
    ofcListCouldNotLoad: "This list could not be loaded.",
    ofcOrOffice: "Office",
    ofcOrSupervisor: "Reports to",
    ofcOrJobTitle: "Job title",
    ofcOrStaffNumber: "Staff number",
    ofcOrWhyMoving: "Why they are moving",
    ofcOrEffectiveFrom: "From",
    ofcOrHistory: "Posting history",
    ofcOrHistoryBody: "Append-only. Who was responsible for an area in a given month is asked in revenue disputes, and an answer that can be adjusted afterwards is not one.",
    ofcOrNobody: "Nobody",
    ofcOrUnposted: "Not posted",
    ofcCwEscalate: "Escalate",
    ofcCwEscalateBody: "Sends the case to the officer above, with its whole history attached. If nobody is above, it says so rather than marking the case escalated and leaving it here.",
    ofcCwEscalateReason: "Why it needs somebody above",
    ofcCwEscalatedTo: "Escalated to",
    ofcNoneDepartments: "No department has been created yet.",
    ofcNoneOffices: "No revenue office has been created yet.",
    ofcNoneTransfers: "No posting has been recorded for this officer.",
    enumCollection: "Collection",
    enumFinance: "Finance",
    enumAudit: "Audit",
    enumEnforcement: "Enforcement",
    enumTaxpayerServices: "Taxpayer services",
    enumAdministration: "Administration",
    enumTechnology: "Technology",
    enumPosting: "Posting",
    enumDepartment: "Department",
    enumOffice: "Office",
    enumTerritory: "Territory",
    ofcDbByChannel: "How the money arrived",
    ofcDbByChannelBody: "Recorded on every transaction since the platform started, and never grouped until now. It is the figure behind every decision about where to put agents.",
    ofcDbByTaxpayerType: "Individuals and businesses",
    ofcDbByItem: "Revenue by levy",
    ofcDbByItemBody: "One level below the category, which is where somebody's responsibility sits.",
    ofcDbReversed: "Reversed",
    ofcDbRefunded: "Refunded",
    ofcDbAgentsOnline: "Agents working now",
    ofcDbAgentsOnlineHint: "Active in the last fifteen minutes",
    ofcDbAgentsSuspended: "Agents suspended",
    ofcDbExpectedRevenue: "Assessed and unpaid",
    ofcDbExpectedRevenueHint: "Money already invoiced and owed. Not a projection.",
    ofcNavTaxpayerAnalytics: "Taxpayer base",
    ofcTaTitle: "The taxpayer base",
    ofcTaIntro: "Not how many people are on the register, but how many are still paying, how often, and where the ones who stopped are.",
    ofcTaActive: "Paying",
    ofcTaActiveHint: "Paid something in the last ninety days",
    ofcTaInactive: "Stopped paying",
    ofcTaNeverPaid: "Never paid",
    ofcTaTotal: "On the register",
    ofcTaNewThisMonth: "Registered this month",
    ofcTaAverageLifetime: "Average paid, each",
    ofcTaFrequency: "How often somebody who pays, pays",
    ofcTaFrequencyBody: "Banded rather than averaged. A mean over a population where most paid once and a few paid twelve times describes nobody in it.",
    ofcTaByLga: "The register by Local Government Area",
    ofcTaByCategory: "Which levies the register is engaged with",
    ofcTaTaxpayersAssessed: "Assessed",
    ofcTaTaxpayersPaid: "Paid",
    ofcTaAveragePayment: "Average payment",
    ofcTaComplianceScore: "Average compliance score",
    ofcTaOutstanding: "Outstanding",
    ofcCmByPlace: "Commission by Local Government Area",
    ofcCmByPeriod: "Commission by month",
    ofcCmAccrued: "Accrued",
    ofcCmPaidOut: "Paid",
    ofcCmOutstandingCommission: "Outstanding",
    enumOnce: "Once",
    enumTwoToThree: "Two or three times",
    enumFourToEleven: "Four to eleven times",
    enumTwelveOrMore: "Twelve times or more",
    ofcDbYesterday: "Yesterday",
    ofcDbThisWeek: "This week",
    ofcDbVsYesterday: "against yesterday",
    ofcDbVsLastWeek: "against the same days last week",
    ofcDbVsLastMonth: "against the same days last month",
    ofcDbVsLastYear: "against the same period last year",
    ofcDbNoComparison: "nothing collected then, so no comparison",
    ofcDbLastMonthWhole: "The whole of last month",
    ofcDbDeclining: "Categories collecting less than last month",
    ofcDbDecliningBody: "Ranked by size, a category that halved still sits near the top and looks healthy. This is the same data ranked by direction.",
    ofcDbNoneDeclining: "Nothing is collecting less than it did last month.",
    ofcDbChange: "Change",
    ofcDbShareOfMonth: "Share of the month",
    ofcRvAverageTransaction: "Average transaction",
    ofcRvCompliance: "Register paying",
    ofcRvComplianceHint: "The share of taxpayers registered here who paid anything in the period.",
    ofcPfGrowth: "Against last month",
    ofcPfCategories: "Levies worked",
    enumCategory: "Category",
    enumItem: "Revenue item",
    enumLga: "Local Government Area",
    ofcNavTargets: "Targets & forecast",
    ofcTgTitle: "Revenue targets",
    ofcTgIntro: "What the Service expects to raise, and what has come in against it.",
    ofcTgSetTarget: "Set a target",
    ofcTgScope: "Set against",
    ofcTgScopeState: "The whole State",
    ofcTgScopeLga: "One Local Government Area",
    ofcTgScopeCategory: "One revenue category",
    ofcTgScopeItem: "One revenue item",
    ofcTgScopeAgent: "One agent",
    ofcTgPeriod: "Period",
    ofcTgPeriodDaily: "Daily",
    ofcTgPeriodWeekly: "Weekly",
    ofcTgPeriodMonthly: "Monthly",
    ofcTgPeriodQuarterly: "Quarterly",
    ofcTgPeriodAnnual: "Annual",
    ofcTgAmount: "Target amount",
    ofcTgNeedAmount: "Enter the amount to be collected in this period.",
    ofcTgNeedLga: "Choose the Local Government Area this target is for.",
    ofcTgNeedCategory: "Choose the revenue category this target is for.",
    ofcTgNote: "Why this figure",
    ofcTgTarget: "Target",
    ofcTgCollected: "Collected",
    ofcTgAchievement: "Achievement",
    ofcTgGap: "Gap",
    ofcTgThroughPeriod: "Through the period",
    ofcTgRollup: "State target and what was apportioned below it",
    ofcTgRollupBody: "These do not have to agree. The State figure normally carries headroom, and an LGA with no target of its own is the more useful thing to notice.",
    ofcTgStateTarget: "State target",
    ofcTgApportioned: "Apportioned to LGAs",
    ofcTgLgasWithout: "LGAs with no target",
    ofcTgWithdraw: "Withdraw",
    ofcTgWithdrawReason: "Why it is being withdrawn",
    ofcTgSuperseded: "This replaces an earlier target for the same period.",
    ofcTgSetBy: "Set by",
    ofcTgShowSuperseded: "Include revised and withdrawn",
    ofcNoneTargetsSet: "No target has been set for this period.",
    ofcFcTitle: "Forecast",
    ofcFcNotATarget: "This is a forecast, not a target and not guaranteed revenue. It is arithmetic on what has been collected so far and what previous years did by this point.",
    ofcFcProjected: "Projected for the period",
    ofcFcBasis: "Worked out from",
    ofcFcConfidence: "Confidence",
    ofcFcSeasonalShare: "Usually collected by this point",
    ofcFcComparablePeriods: "Comparable periods used",
    ofcFcProjectedAchievement: "Projected against target",
    forecastSeasonal: "Shaped by the collection curve: previous years are used to say what share of a period is usually in by now.",
    forecastRunRate: "A straight run rate. There is not enough history to know the collection curve, so this is likely to be wrong early and late in the period.",
    forecastTooEarlyInCurve: "Previous years had collected almost nothing by this point, so the curve cannot be used yet. A straight run rate is shown instead.",
    forecastPeriodComplete: "The period has finished. This is the actual figure, not a projection.",
    forecastNotStarted: "The period has not started. There is nothing to project from yet.",
    enumSeasonal: "Collection curve",
    enumRunRate: "Run rate",
    enumInsufficientHistory: "Not enough history",
    enumAwaitingInformation: "Awaiting information",
    enumEscalated: "Escalated",
    enumInvestigating: "Investigating",
    enumAgentConduct: "Agent conduct",
    enumCommissionQuery: "Commission query",
    enumDataCorrection: "Data correction",
    enumFraudInvestigation: "Fraud investigation",
    enumGeneral: "General",
    enumReconciliationException: "Reconciliation exception",
    enumRevenueAnomaly: "Revenue anomaly",
    enumSystemIssue: "System issue",
    enumTaxpayerDispute: "Taxpayer dispute",
    enumApproval: "Approval",
    enumFraudFlag: "Risk flag",
    enumManual: "Raised by an officer",
    enumSupportTicket: "Support ticket",
    enumAssignment: "Assigned",
    enumComment: "Comment",
    enumDueDateChange: "Due date changed",
    enumEscalation: "Escalated",
    enumEvidence: "Evidence attached",
    enumNote: "Internal note",
    enumPriorityChange: "Priority changed",
    enumResolution: "Resolution",
    enumRouted: "Routed",
    enumStatusChange: "Status changed",
    ofcCwSubject: "Subject",
    ofcCwDescription: "What happened",
    ofcCwCategory: "Category",
    ofcCwRisk: "Risk",
    ofcCwPriority: "Priority",
    ofcCwDepartment: "Send to",
    ofcCwAssignee: "Assign to",
    ofcCwNobody: "Nobody yet",
    ofcCwAnyDepartment: "No department",
    ofcCwDue: "Due",
    ofcCwOnlyOpen: "Only open cases",
    ofcCwOnlyOverdue: "Only overdue",
    ofcCwOpenedBy: "Opened by",
    ofcCwCaseNumber: "Case",
    ofcCwComments: "Comments",
    ofcCwEvidence: "Evidence",
    ofcCwBackToQueue: "Back to the queue",
    ofcCwHistory: "History",
    ofcCwAddComment: "Add a comment",
    ofcCwInternalNote: "Keep this as an internal note",
    ofcCwMention: "Name an officer",
    ofcCwPost: "Post",
    ofcCwMoveCase: "Move this case",
    ofcCwChangeStatus: "Change the status",
    ofcCwResolution: "What it concluded",
    ofcCwResolutionRequired: "Say what the case concluded before resolving it.",
    ofcCwSaved: "Saved.",
    ofcCwNotYours: "This case is not assigned to you and you did not open it, so you may comment and nothing more.",
    ofcCwAbout: "About",
    ofcCwWhy: "Why",
    ofcReasonAtLeastChars: "At least {{n}} characters.",
    ofcCwSubjectTooShort: "Give the case a subject of at least five characters.",
    ofcCwSampleSubject: "Collections trebled with no new taxpayers",
    ofcCwSampleDescription: "Say what you saw, where, and what you would like the other department to check.",
    ofcCwAppendOnly: "Nothing here can be edited or removed. A correction is another entry.",
    ofcNoneCasesMatchFilter: "No cases match these filters.",
    ofcT3Title: "Transaction file",
    ofcT3Intro: "The whole story of one collection, from the taxpayer to the government account.",
    ofcT3Find: "Find a transaction",
    ofcT3FindBody: "A transaction reference, or a receipt number off a citizen’s message.",
    ofcT3Chain: "The chain",
    ofcT3Assessment: "Assessment",
    ofcT3Invoice: "Invoice",
    ofcT3Payment: "Payment",
    ofcT3Gateway: "Gateway",
    ofcT3Settlement: "Settlement",
    ofcT3Reconciliation: "Reconciliation",
    ofcT3Commission: "Commission",
    ofcT3Refunds: "Refunds",
    ofcT3Timeline: "What happened, in order",
    ofcT3TimelineBody: "The platform’s own record and the officers’ actions, on one clock.",
    ofcT3Platform: "Platform",
    ofcT3OfficerAction: "Officer action",
    ofcT3Before: "Before",
    ofcT3After: "After",
    ofcT3CasesAndFlags: "Cases and risk flags",
    ofcT3OpenCaseAbout: "Open a case about this transaction",
    ofcT3Withheld: "Not shown to your role",
    ofcT3WithheldBody: "These parts exist and your permissions do not reach them. They are named so an empty section is never mistaken for an empty record.",
    ofcT3NoPayment: "No payment has been attempted.",
    ofcT3NoReceipt: "No receipt has been issued.",
    ofcT3NoSettlement: "The money has not reached the government account yet.",
    ofcT3NoCommission: "No commission was earned.",
    ofcT3NoReconciliation: "This has not been through a reconciliation run.",
    ofcT3Channel: "Channel",
    ofcT3Where: "Where",
    ofcT3ServiceCharge: "Service charge",
    ofcT3Verified: "Verified",
    ofcT3NothingLinked: "No case or flag is linked to this transaction.",
    ofcGroupAdministration: "Administration",
    ofcGroupAgentsProgrammes: "Agents and programmes",
    ofcGroupAssessment: "Assessment",
    ofcGroupConfiguration: "Configuration",
    ofcGroupEverything: "Everything you may open",
    ofcGroupExamination: "Examination",
    ofcGroupMyTerritory: "My territory",
    ofcGroupOversight: "Oversight",
    ofcGroupRevenueHere: "Revenue here",
    ofcGroupRevenue: "Revenue",
    ofcGroupSettlement: "Settlement",
    ofcGroupTheMoney: "The money",
    ofcGroupTheRegister: "The register",
    ofcGroupWhatCharged: "What was charged",
    ofcGroupWhoCollected: "Who collected it",
    ofcGroupWhoDidIt: "Who did it",
    ofcPortalName: "PSIRS Portal",
    ofcStateGovernment: "Plateau State Government",
    ofcReturnToDashboard: "Return to the dashboard",
    ofcSignOut: "Sign out",
    ofcPageNotFound: "That page does not exist.",
    ofcReadOnly: "read-only",
    ofcDailyTrend: "Daily collection trend",
    ofcNoDataForPeriod: "No data for this period.",
    ofcLoginTitle: "PSIRS Revenue Portal",
    ofcLoginPhone: "Phone number",
    ofcLoginPassword: "Password",
    ofcLoginMonitored: "Access is monitored. Every action you take is recorded in the audit log.",
    ofcLoginWrongPlace: "Your account belongs to the agent app",
    ofcLoginSignInWorked: "Your sign-in worked — you are simply in the wrong place.",
    ofcLoginUseAgentApp: "Field agents collect revenue in the PSIRS agent app, which works offline and holds your taxpayers, assessments and commission. This portal is for revenue, finance and oversight officers.",
    shellSyncFailed: "Your saved records could not be sent to PSIRS. They are still on this phone.",
    grpNameHint: "As the group itself gives it",
    grpCommunityHint: "Where the group meets. Optional.",
    grpLeaderNameHint: "The person who can confirm who belongs",
    grpLeaderPhoneHint: "They are sent a link to confirm the membership list",
    grpMemberCountHint: "An estimate is fine. Optional.",
    stepUpCodeFailed: "Could not send a code.",
    stepUpAuthoriseFailed: "Could not authorise this.",
    pubVerdictValid: "VALID",
    pubVerdictAcknowledgement: "VALID — NOT A RECEIPT",
    pubVerdictReversed: "REVERSED",
    pubVerdictNotFound: "NOT FOUND",
    pubVerdictInvalid: "INVALID",
    colChangeChoice: "Change",
    moreMonths: "{{n}} months",
    supGetHelpHint: "Report a problem to PSIRS. You will get a reply here, and a message when there is something to read.",
    authKeepItSafe: ". Keep it safe.",
    moreSearchVehicleFirst: "Search the vehicle first. Records confirmed by the vehicle authority are marked as such.",
    moreVehicleSavedBody: "This vehicle is stored on your phone and will be sent to PSIRS automatically when you are back online. The vehicle authority has not been checked yet, and no renewal or payment can be started until it is sent.",
    moreVehicleCaptureBody: "Record what you can see on the vehicle. It will be sent — and checked against the authority — as soon as you are online. You cannot take a payment for a renewal until then.",
    moreOwnerName: "Owner’s name",
    moreOwnerNameHint: "As written on the papers",
    moreOwnerPhone: "Owner’s phone",
    moreMotorcycle: "Motorcycle / Okada",
    moreTricycle: "Tricycle / Keke",
    moreRegistrationLabel: "Registration",
    moreOwnerLabel: "Owner",
    moreVehicleLabel: "Vehicle",
    moreChassis: "Chassis",
    moreCurrentExpiry: "Current expiry",
    moreAuthorityConfirmed: "Authority confirmed",
    moreEnteredManually: "No — entered manually",
    moreChooseRenewal: "Choose which renewal is being paid for.",
    moreFindPayingTaxpayer: "Find the taxpayer paying for this renewal. Every payment must be attributed to somebody.",
    moreReceiptsIssuedAfter: "Every receipt here was issued by government after the payment was independently confirmed.",
    morePendingWord: "pending",
    morePaidWord: "paid",
    moreTransactionsWord: "transactions",
    moreOwedBackBody: "was paid on transactions that were later reversed. It is taken off your next payout, so you will receive that much less than the amount above.",
    moreOwedBackDeducted: "owed back will be deducted.",
    moreConfirmPayout: "Confirm payout",
    moreCommissionAvailableWhen: "Commission becomes available once the transaction has been settled to the government account and the hold period has passed. You will be sent a one-time code to confirm the request.",
    moreDeviceId: "Device ID",
    morePrinterHint: "Pair a 58mm or 80mm Bluetooth ESC/POS mobile belt printer to issue instant paper receipts to taxpayers in remote field locations.",
    moreConnectedDevice: "Connected device",
    morePaperWidth: "Paper width",
    moreNone: "None",
    morePaper58: "58mm (standard)",
    morePaper80: "80mm (wide)",
    morePrintTestSlip: "Print test slip",
    morePairPrinter: "Pair Bluetooth printer",
    moreNoWebBluetooth: "Web Bluetooth is not supported on this browser (use Chrome on Android or desktop).",
    morePrinterConnected: "Connected to Bluetooth printer.",
    morePrinterConnectFailed: "Connection failed.",
    morePrinterTestSent: "Test receipt sent to printer!",
    morePrinterPrintFailed: "Print failed.",
    morePushHint: "Receive real-time alerts when your KYC clears, referee responds, or commissions settle.",
    morePermission: "Permission",
    morePushEngine: "Push engine",
    moreSupported: "Supported",
    moreUnavailable: "Unavailable",
    morePushDisabled: "Push notifications disabled.",
    morePushActive: "Push notifications active!",
    morePushNotGranted: "Permission was not granted.",
    morePushFailed: "Could not configure push notifications.",
    moreChangeBankHint: "Change the bank account PSIRS pays your commission into. It takes a one-time code, the bank’s confirmation and an officer’s approval, so your existing account keeps being used until all three are done.",
    moreSupportHint: "Report a problem to PSIRS — a payment that has not confirmed, a receipt that looks wrong, or anything a taxpayer has complained about.",
    moreSavedRecordsHint: "Captures made offline. They are sent to PSIRS automatically when you have a connection.",
    moreBack: "Back",
    moreCommissionOnlyVerified: "Commission is paid only into an account PSIRS has confirmed with the bank, and only after an officer approves the change. Your existing account keeps being used until then.",
    moreBankMustConfirm: "PSIRS cannot approve a change until the bank confirms the account belongs to you. If the details are wrong, ask your supervisor to refuse this request so you can send the right ones.",
    moreToldEitherWayBody: "A message goes to your phone when this is approved or refused. Only one change can be waiting at a time.",
    morePaidIntoNow: "Paid into now",
    moreWouldChangeTo: "Would change to",
    moreNameOnNewAccount: "Name on the new account",
    moreBankCheck: "Bank check",
    moreBankCheckConfirmed: "Confirmed",
    moreBankCheckConfirmedAs: "Confirmed as {{name}}",
    moreBankCheckWaiting: "Waiting — the bank could not be reached",
    moreBankCheckNotConfirmed: "Not confirmed",
    moreBankCheckNotConfirmedBecause: "Not confirmed: {{reason}}",
    moreReasonYouGave: "Reason you gave",
    moreBankLabel: "Bank",
    moreBankCodeHint: "The 3 to 6 digit code the bank uses",
    moreAccountNameHint: "Exactly as the bank has it",
    moreNeedBankName: "Choose the bank the new account is with.",
    moreNeedBankCode: "Enter the bank code. It is the 3 to 6 digit number the bank uses, not your account number.",
    moreNeedAccountName: "Enter the name the account is held in, exactly as the bank has it.",
    moreNeedAccountNumber: "A Nigerian account number is 10 digits.",
    moreNeedReason: "Say why the account is changing, in at least 10 characters.",
    colNeedBaseAmount: "Enter the amount the assessment is based on, in naira.",
    colNoTin: "No TIN",
    colBasisAmountHint: "For example turnover, income or contract value. The charge itself is set by government.",
    colTaxpayerLabel: "Taxpayer",
    colRevenueLabel: "Revenue",
    colGovernmentRevenue: "Government revenue",
    colServiceCharge: "Approved service charge",
    colTotalPayable: "Total payable",
    colInvoiceLabel: "Invoice",
    colPaymentStatus: "Payment status",
    colGatewayReference: "Gateway reference",
    colPrinting: "Transmitting receipt to Bluetooth printer...",
    colPrinted: "Receipt printed successfully on Bluetooth printer!",
    colPrintFailed: "Bluetooth printing failed: {{reason}}",
    colCheckPrinter: "Check printer connection",
    colPrintBluetooth: "Print (Bluetooth)",
    colReceiptCopied: "Receipt details copied. You can paste them into a message.",
    colPreparingInvoice: "Preparing the invoice…",
    colGiveInvoice: "Give the taxpayer an invoice",
    colInvoiceHint: "A printable demand notice with the invoice number, what it is for and how the amount was worked out",
    colInvoiceValidUntil: ", valid until {{date}}",
    colInvoiceGiveReference: "Give them the payment reference {{reference}} as well — that is what a bank or USSD channel asks for.",
    colInvoiceNoReference: "Start the payment first if they want to pay at a bank: the reference a bank asks for is issued then, and the invoice does not carry it.",
    colCheckingPayment: "Checking with the payment system…",
    colCheckPaymentStatus: "Check payment status",
    colStartingPayment: "Starting the payment…",
    colStartPayment: "Start the payment",
    colChargeRaisedTitle: "The charge was raised. The payment was not.",
    colChargeRaisedBody:
      "Transaction {{reference}} now exists and the taxpayer owes it. Do not work this out again — a second attempt raises a second charge for the same thing, and both would have to be paid. Open the transaction to give them the invoice or to start the payment again.",
    colOpenCharge: "Open this transaction",
    colDevGateway: "Development gateway",
    colDevGatewayHint: "This platform is running against a test payment gateway. Use these controls to simulate what a real gateway would report.",
    colSimulateSuccess: "Simulate success",
    colSimulateFailure: "Simulate failure",
    grpConfirmedMembers: "{{n}} confirmed member(s)",
    homeQaRenewVehicle: "Renew vehicle",
    homeQaFindTaxpayer: "Find taxpayer",
    homeQaCheckReceipt: "Check a receipt",
    homeQaHandOut: "Hand out allocation",
    homeQaGroups: "Groups",
    homeGoodMorning: "Good morning",
    homeGoodAfternoon: "Good afternoon",
    homeGoodEvening: "Good evening",
    homeAccountSuspended: "Your agent account is suspended",
    homeApplicationProcessing: "Your application is still being processed",
    homeTransactions: "transactions",
    homeCommissionWord: "commission",
    homeRegisteredWord: "registered",
    homePendingTitle: "{{n}} payment(s) awaiting confirmation",
    homePendingBody: "These are not yet confirmed. Do not ask the taxpayer to pay again — open the transaction to check its status.",
    supNormal: "Normal",
    supProblemCameBack: "If the problem has come back,",
    supReportItAgain: "report it again",
    supKeepsHistory: "so it keeps its own history.",
    supCatPayment: "A payment has not gone through",
    supCatReceipt: "A receipt is wrong or missing",
    supCatAssessment: "The amount charged looks wrong",
    supCatTin: "A taxpayer has no TIN yet",
    supCatVehicle: "A vehicle renewal problem",
    supCatTechnical: "The app is not working",
    supCatComplaint: "A taxpayer has a complaint",
    supCatUnauthorised: "Someone was charged money they should not have been",
    supCatUnauthorisedHint: "Use this if a taxpayer was asked for money outside an official assessment.",
    supCatMisconduct: "Report the conduct of an agent",
    supCatMisconductHint: "This goes to PSIRS oversight, not to the agent concerned.",
    supWhatHappenedHint: "Include anything PSIRS would need to look it up.",
    supTransactionHint: "If this is about one payment, the reference lets PSIRS find it without asking you.",
    supSending: "Sending…",
    supSendToPsirs: "Send to PSIRS",
    supSendWord: "Send",
    supReopenedNotice: "This report has been opened again for PSIRS to look at.",
    supAbout: "About",
    supTransactionLabel: "Transaction",
    supReported: "Reported",
    verifyScanHint: "Scan the square on the receipt, or type the code printed beneath it. PSIRS confirms whether the receipt was issued — reading the code only tells you what is on the paper.",
    verifyOfflineBody: "A receipt can only be checked against PSIRS, so this needs a connection. You can still scan the code and check it when you are back online.",
    verifyCouldNotReach: "PSIRS could not be reached, so this receipt could not be checked.",
    verifyNotAReceiptCode: "That QR code is not a PSIRS verification code. Keep the receipt in frame.",
    verifyCameraFailed: "The camera could not be opened. Type the code printed under the QR square instead.",
    verifyChecking: "Checking with PSIRS…",
    verifyCheckThisCode: "Check this code",
    verifyRevenueItem: "Revenue item",
    verifyIssued: "Issued",
    verifyFingerprint: "Document fingerprint",
    verifyMatchesOriginal: "Matches the original",
    verifyNotConfirmed: "Could not be confirmed",
    allocScanHint: "Scan or type the collection code the beneficiary was given. Record it before you hand anything over — a code can only be used once, and this is what stops the same allocation being collected twice.",
    allocOfflineBody: "PSIRS could not be reached, so this collection has not been recorded. Do not hand anything over until it has been.",
    allocFailed: "The collection could not be recorded. Try again.",
    allocNotACode: "That code is not a PSIRS collection code. Keep it in frame.",
    allocCameraFailed: "The camera could not be opened. Type the code instead.",
    allocRecordCollection: "Record this collection",
    allocGive: "Give",
    grpListHint: "The groups you registered, and any an officer recorded for you to work. Another agent’s cooperatives are not listed here.",
    grpEmpty: "No groups yet. When you meet a cooperative, a market association or a union, register it here so its members can be brought onto the register together.",
    grpRegisterHint: "Record the body itself, and who leads it. Members are added after an officer has approved the group.",
    grpNoAssessmentBody: "Registering a group records that it exists. Nobody is charged anything, and no member is added, until an officer has approved it.",
    grpMemberHint: "The person has to be registered as a taxpayer first. Search for them by name, phone or TIN.",
    grpAskLeaderHint: "You are paid commission on what these members pay, so your word that somebody belongs is not enough on its own. The group’s own leader confirms the list.",
    grpRegisterGroup: "Register group",
    grpRecordThisMember: "Record this member",
    grpSendLeaderLink: "Send the leader a confirmation link",
    grpFarmers: "Farmers’ cooperative",
    grpMarket: "Market association",
    grpTransport: "Transport union",
    grpArtisan: "Artisan guild",
    grpTraders: "Traders’ association",
    grpFisheries: "Fisheries group",
    grpLivestock: "Livestock association",
    grpOther: "Other",
    grpLocalGovernment: "Local Government",
    grpLeader: "Leader",
    grpMembersConfirmed: "Members confirmed",
    grpAwaitingLeader: "Awaiting the leader",
    authSigningIn: "Signing in…",
    authPasswordHint: "At least 8 characters, including a letter and a number",
    authPasswordPatternHint: "At least 8 characters, including at least one letter and at least one number.",
    authBankName: "Bank name",
    authAccountName: "Account name",
    authAccountNumber: "Account number",
    authTenDigits: "10 digits",
    authSubmitting: "Submitting…",
    authSubmitApplication: "Submit application",
    authPsirsFull: "Plateau State Internal Revenue Service",
    authRevenueNeverToAgent: "Government revenue is never paid into an agent’s account. This account is used only to pay the commission you earn.",
    stepUpNoSms: "No real SMS is configured, so the code is shown here:",
    shellMain: "Main",
    shellNothingLost: "Nothing has been lost — the records are still on this phone and will be sent once this is put right.",
    shellRestoring: "Restoring your session…",
    shellAgentTitle: "PSIRS Revenue Agent",
    shellAgentBrand: "Plateau State Revenue Agent",
    uiLoading: "Loading",
    tpFindTaxpayer: "Find a taxpayer",
    tpSearchHint: "Search by name, business name, phone number, TIN, receipt number or vehicle registration.",
    tpSearchPlaceholder: "Name, phone or TIN",
    tpSearchByNamePhoneTin: "Search by name, phone number or TIN",
    tpNoTinYet: "No TIN yet",
    tpRegisterNew: "Register a new taxpayer",
    tpTaxpayerPaying: "Taxpayer paying",
    tpUnnamedTaxpayer: "Unnamed taxpayer",
    tpChooseSomeoneElse: "Choose someone else",
    tpStepTin: "TIN",
    tpStepDetails: "Details",
    tpStepIdentification: "Identification",
    tpStepAddress: "Address",
    tpStepActivity: "Activity",
    tpStepReview: "Review",
    tpStepOf: "Step {{n}} of {{total}}",
    tpSavedOnDevice: "Saved on this device",
    tpNotYetSent: "Not yet sent to PSIRS",
    tpSavedOfflineBody: "This registration is stored on your phone and will be sent automatically when you are back online. No TIN has been issued yet, and no payment can be taken until it is sent.",
    tpBackToHome: "Back to home",
    tpTaxpayerRegistered: "Taxpayer registered",
    tpGiveTinToTaxpayer: "Give this number to the taxpayer. They will need it for every government payment.",
    tpTinRequested: "TIN request submitted",
    tpTinPending: "The TIN service has not returned a number yet. It will appear on the taxpayer’s profile once assigned.",
    tpCollectRevenue: "Collect revenue",
    tpEnumerate: "Write down the business",
    agEnTitle: "What the business looks like",
    agEnIntro: "Write down what you can see. You are not setting a price — the office works out the band from what you record, and the taxpayer is told by notice.",
    agEnWho: "Who",
    agEnPremises: "Where they trade from",
    agEnPremisesHint: "What you can see today, not what they say they are building.",
    agEnEquipment: "Machines or equipment",
    agEnEquipmentHint: "Count what is being used for the business. Write 0 if there is none.",
    agEnPeople: "People working besides the owner",
    agEnPeopleHint: "Including apprentices and family who work there. Write 0 if the owner works alone.",
    agEnSector: "Trade",
    agEnGroup: "Market association",
    agEnGroupHint: "If they belong to one, the leader will be asked to confirm what you wrote.",
    agEnNoGroupChosen: "Not through an association",
    agEnNoGroupsTitle: "No association to record this through",
    agEnNoGroups: "None of your groups has been given a part in enumeration yet. Record it anyway — an officer can ask the leader later.",
    agEnNoAmountTitle: "You are not setting the tax",
    agEnNoAmount: "There is no amount on this form and there will not be one. If the trader asks what it will cost, tell them the office will send a notice, and that they can object to it.",
    agEnChoose: "Choose",
    agEnSave: "Save what you saw",
    agEnSaving: "Saving…",
    agEnRecordedTitle: "Written down",
    agEnBand: "Size recorded",
    agEnWhatHappensNextTitle: "What happens next",
    agEnNextWithLeader: "The association leader will be asked to confirm this. Nothing is charged until an officer looks at it.",
    agEnNextWithoutLeader: "An officer will look at this. Nothing is charged yet, and the taxpayer can object once they receive the notice.",
    agEnBackToTaxpayer: "Back to the taxpayer",
    agEnQueuedTitle: "Held on this phone",
    agEnQueuedNext: "There is no signal, so this has not reached the office yet. It will be sent on its own when the phone is back online — do not write it down a second time. The office checks the size again when it arrives.",
    agEnBandSoFarTitle: "Size from what you have written",
    agEnBandSoFar: "This is a {{band}} business on what you have entered. If the trader asks, that is what has been written down. It is not the amount — the office works that out and sends a notice.",
    tpViewProfile: "View profile",
    verifyReceiptFingerprintMismatch: "A receipt with this number exists, but the stored document does not match its original fingerprint. Treat the document you were given as unverified and report it to PSIRS.",
    verifyReceiptReversed: "This receipt was issued but the payment has since been reversed or refunded. It is no longer valid evidence of payment.",
    verifyReceiptVoided: "This receipt has been voided and is not valid.",
    verifyReceiptGenuine: "This is a genuine government receipt issued by PSIRS.",
    verifyReceiptGenuineUnchecked: "This is a genuine government receipt issued by PSIRS. The stored copy could not be checked just now, so its fingerprint has not been confirmed on this attempt.",
    verifyNotFound: "No government document matches that number or code. If you were given a receipt bearing this number, it was not issued by PSIRS.",
    verifyPaymentReversed: "This payment was reversed and the money is being returned to the payer, so no government receipt was issued for it. The document is no longer valid evidence of payment. If you have not received the money, contact PSIRS with this number.",
    verifyDocumentRevoked: "This document has been revoked and is no longer valid.",
    verifyDocumentFingerprintMismatch: "The stored document does not match its original fingerprint. Report this to PSIRS.",
    verifyAcknowledgementNotReceipt: "This is a genuine PSIRS acknowledgement of payment, and it is NOT a government receipt. The payment system has confirmed the payment; the money has not yet reached the government account. A receipt is issued automatically once it does, and can be checked here in the same way.",
    verifyDocumentExpired: "This document expired on {{date}}.",
    verifyDocumentGenuine: "This is a genuine government document issued by PSIRS.",
    verifyDocumentGenuineUnchecked: "This is a genuine government document issued by PSIRS. The stored copy could not be checked just now, so its fingerprint has not been confirmed on this attempt.",
    tpPossibleExisting: "Possible existing taxpayer",
    tpDupIdentityNumber: "The same identification number is already registered",
    tpDupPhoneAndName: "Same phone number and same name",
    tpDupPhone: "This phone number is already registered to another taxpayer",
    tpDupBusinessNameInLga: "A business with this name is already registered in this LGA",
    tpDupNameInLga: "A taxpayer with this name is already registered in this LGA",
    tpDupCouldNotList: "The matching records could not be shown",
    tpDupCouldNotListBody: "PSIRS has flagged this as a possible duplicate, but the records it matched could not be loaded, so you cannot check them here. Try again. If it will not load, look the person up by phone number before you register them again.",
    tpDupTryAgain: "Try showing them again",
    actionTryAgain: "Try again",
    tpCheckSamePerson: "Check whether any of these is the same person before creating a new record.",
    tpNoneOfThese: "None of these — register as a new taxpayer",
    tpHasTin: "Does the taxpayer already have a TIN?",
    tpYes: "Yes",
    tpNo: "No",
    tpExistingTin: "Existing TIN",
    tpExistingTinHint: "We will confirm it with the PSIRS TIN service",
    tpBasicInfo: "Basic information",
    tpRegisteringAs: "Registering as",
    tpAnIndividual: "An individual",
    tpABusiness: "A business",
    tpBusinessName: "Business name",
    tpTypeOfBusiness: "Type of business",
    tpFirstName: "First name",
    tpMiddleName: "Middle name",
    tpLastName: "Last name",
    tpDateOfBirth: "Date of birth",
    tpPhoneNumber: "Phone number",
    tpEmailAddress: "Email address",
    tpNeedBusinessName: "Enter the name of the business.",
    tpIdentificationHint: "Optional, but it helps prevent duplicate records. The number is stored securely and never shown in full.",
    tpLga: "Local Government Area",
    tpSelectLga: "Select LGA",
    tpWardHint: "Where revenue is reported from. Without it this collection cannot be counted below LGA level.",
    tpChooseLgaFirst: "Choose an LGA first",
    tpNoWardsListed: "No wards listed",
    tpListCouldNotLoad: "This list could not be loaded.",
    tpSelectWard: "Select ward",
    tpCommunity: "Community",
    tpBusinessOrActivity: "Business or activity",
    tpEconomicSector: "Economic sector",
    tpSelectSector: "— Select sector —",
    tpSuggestedObligations: "Suggested tax obligations for {{sector}}",
    tpConfirmWhichTaxes: "Confirm which taxes apply to this taxpayer. You can add more later.",
    tpOccupation: "Occupation (optional)",
    tpBusinessActivity: "Business activity (optional)",
    tpReviewConfirm: "Review and confirm",
    tpType: "Type",
    tpBusiness: "Business",
    tpIndividual: "Individual",
    tpName: "Name",
    tpPhone: "Phone",
    tpLgaShort: "LGA",
    tpWard: "Ward",
    tpWillBeRequested: "Will be requested",
    tpConsent: "The taxpayer consents to their information being used by PSIRS for revenue administration.",
    tpDeclaration: "The taxpayer declares that the information given is true and correct.",
    tpBack: "Back",
    tpContinue: "Continue",
    tpRegistering: "Registering…",
    tpRegisterTaxpayer: "Register taxpayer",
    tpYouAreOffline: "You are offline",
    tpSaveOfflineBody: "Save this registration on the device. It will be sent to PSIRS automatically when you are back online, and a TIN will be requested then.",
    tpSaveOnDevice: "Save on this device",
    tpNotYetAssigned: "Not yet assigned",
    tpTransactionsYouFacilitated: "Transactions you facilitated",
    tpNoTransactions: "You have not processed any transaction for this taxpayer.",
    tpWhatYouCanSee: "What you can see here",
    tpVehicles: "Vehicles",
    tpExpires: "Expires {{date}}",
    tpNoRenewal: "No renewal on record",
    camCancel: "Cancel",
    appStageSubmitted: "Application submitted",
    appStageKyc: "Identity verified",
    appStageReview: "Ready for government review",
    appStageApproved: "Approved by PSIRS",
    appStageTraining: "Training completed",
    appStageDevice: "Device registered",
    appStageActive: "Active agent",
    appActionNeeded: "Action needed",
    appSuspended: "Your account is suspended",
    appNotApproved: "Application not approved",
    appContactSupervisor: "Contact your supervisor or PSIRS support for details of what to do next.",
    appTakePhotograph: "Take photograph",
    appTakeAgain: "Take again",
    appSending: "Sending...",
    appDocumentNotSent: "The document could not be sent.",
    appIdDocument: "Your identification document",
    appIdDocumentHint: "Photograph the card itself, flat and in focus, with all four corners visible.",
    appSelfie: "A photograph of you",
    appSelfieHint: "Taken now, holding the same document, so PSIRS can see that they match.",
    appJustCaptured: "just captured",
    appKycHint: "PSIRS checks your identity against the national record. Your identity number is stored securely and is never shown in full.",
    appSubmitForVerification: "Submit for verification",
    appVerifying: "Verifying…",
    appStillNeeded: "Still needed before this can be submitted:",
    appStatus: "Status",
    appClearFilters: "Clear",
    appDocumentOnFile: "Document on file",
    appRefereeNoAccount: "They do not need an account — they receive a secure link.",
    appRefereeShareLink: "If your referee did not receive the message, share this link with them directly:",
    appRefereeConfirmedYour: "has confirmed your application.",
    appRefereeSentRequest: "has been sent a verification request. You can nominate a replacement if they cannot respond.",
    appRefereeLinkHere: "They will receive the verification link here",
    appNominateReplacement: "Nominate a replacement referee",
    appSendVerification: "Send verification request",
    appTrainingAllComplete: "All mandatory training is complete.",
    appTrainingRemaining: "{{done}} of {{total}} modules still to complete.",
    appPassMark: "pass mark",
    appNoAssessment: "no assessment",
    appBankHint: "Verified before any commission can be paid. Government revenue never enters this account.",
    appBankVerifiedMsg: "Your bank account has been verified.",
    appBankCouldNotVerify: "The account could not be verified.",
    appAcceptAgreementText: "I have read and accept the {{title}} (version {{version}}).",
    appDeviceLabel: "Device",
    appAppVersion: "App version",
    appNotRegistered: "Not registered",
    appRegisteredDevice: "Registered device",
    errNetwork: "Could not reach PSIRS. Try again.",
    appYourApplication: "Your application",
    appBeingProcessed: "Your application is being processed",
    appClearedToCollect: "You are cleared to collect revenue",
    appAllRequirementsMet: "All clearance requirements have been met.",
    appCannotCollectUntil: "You cannot collect revenue until every requirement below is complete.",
    appStillOutstanding: "Still outstanding",
    appBlockerKyc: "Your identity has not been checked yet",
    appBlockerReferee: "No referee has confirmed you yet",
    appBlockerGovernmentApproval: "PSIRS has not approved your application yet",
    appBlockerTraining: "You have not finished the required training",
    appBlockerBank: "Your commission bank account has not been verified",
    appBlockerAgreement: "You have not accepted the agent agreement",
    appBlockerDevice: "No device has been registered to you",
    appComplete: "Complete",
    appGoToDashboard: "Go to my dashboard",
    appIdentityVerification: "Identity verification",
    appIdentificationType: "Identification type",
    appIdentificationNumber: "Identification number",
    appEnterIdInFull: "Enter your identification number in full before submitting.",
    appPreviousAttemptRejected: "Previous attempt was not accepted",
    appDocumentNotAccepted: "This document was not accepted",
    appDocuments: "Documents",
    appNotCaptured: "Not captured",
    appReferee: "Referee",
    appRefereeFullName: "Referee full name",
    appRefereePhone: "Referee phone number",
    appRefereeEmail: "Referee email",
    appHowDoTheyKnowYou: "How do they know you?",
    appWhoIsThisPerson: "Who is this person?",
    appRefereeConfirmed: "Referee confirmed",
    appWaitingReferee: "Waiting for your referee",
    appVerificationSent: "Verification request sent",
    appTraining: "Training",
    appAgreement: "Agent agreement",
    appAcceptAgreement: "Accept agreement",
    appAgreementAccepted: "Agreement accepted",
    appAgreementRecorded: "Your acceptance has been recorded.",
    appReadCarefully: "Read this carefully. It sets out what you may and may not do.",
    appBankAccount: "Commission bank account",
    appVerifyBankAccount: "Verify my bank account",
    appBankVerified: "Bank account verified",
    appCommissionPaidHere: "Your commission will be paid to this account.",
    appRegisterDevice: "Register this device",
    appOtherDevices: "Other devices",
    appDeviceOnlyRegistered: "Revenue can only be collected from a device that PSIRS has registered to you.",
    appDeviceAfterApproval: "You can register a device once PSIRS has approved your application.",
    appRefereeWhoIs: "A referee is someone who knows you and can confirm your identity to PSIRS.",
    idNin: "National Identification Number",
    idBvn: "Bank Verification Number",
    idPassport: "International passport",
    idLicence: "Driver’s licence",
    idVoters: "Voter’s card",
    refCivilServant: "Civil or public servant",
    refCommunityLeader: "Community leader",
    refDistrictHead: "District head of my community",
    refReligiousLeader: "Religious leader",
    refTraditionalAuthority: "Traditional authority",
    refProfessional: "Recognised professional",
    refEmployer: "Employer",
    moreThisDevice: "This device",
    moreSignOut: "Sign out",
    moreSomethingWrong: "Something wrong?",
    moreGetHelp: "Get help",
    moreViewApplication: "View my application and clearance",
    moreWhereCommissionPaid: "Where your commission is paid",
    moreCommissionRecordNotAccount: "This is a commission record, not a bank account",
    moreChangeBankAccount: "Change my bank account",
    moreAskDifferentAccount: "Ask for a different account",
    moreAuthoriseChange: "Authorise this change",
    moreAuthorisePayout: "Authorise this payout",
    moreChangeWaiting: "A change is waiting for PSIRS",
    moreNothingChangesYet: "Nothing changes until an officer approves it.",
    moreToldEitherWay: "You will be told either way",
    moreBankNotConfirmed: "The bank has not confirmed this account",
    moreWhyChanging: "Why it is changing",
    moreAccountName: "Name on the account",
    moreAccountNumber: "Account number",
    moreBankCode: "Bank code",
    moreCommissionHistory: "Commission history",
    moreNoCommission: "No commission recorded yet.",
    moreAvailableForPayout: "Available for payout",
    moreRequestPayout: "Request payout",
    moreRequestingPayout: "You are requesting a payout of",
    moreSomeCommissionOwedBack: "Some commission is owed back",
    moreSomeCommissionOnHold: "Some commission is on hold",
    moreOnHoldBody: "is on hold and is not counted in any of the figures above. It is held while something about those collections is checked. Ask your supervisor what is outstanding.",
    moreCommissionApproved: "Some commission is approved for payment",
    moreApprovedBody: "has been approved and is waiting to be paid. It is no longer available to request, and it has not reached your account yet.",
    moreSomeCommissionReversed: "Some commission was reversed",
    moreReversedBody: "was earned on collections that were later reversed, and was never paid. You will not receive it. This is separate from anything owed back.",
    moreReceiptsFacilitated: "Receipts you facilitated",
    moreNoReceipts: "No receipts yet.",
    moreSavedRecords: "Saved records on this device",
    moreNothingWaiting: "Nothing is waiting to be sent.",
    moreSavedOnPhone: "Saved on this phone",
    moreVehicleRenewal: "Vehicle particulars renewal",
    moreSearchVehicle: "Search vehicle",
    moreRegistrationNumber: "Registration number",
    moreVehicleType: "Vehicle type",
    morePrivate: "Private",
    moreCommercial: "Commercial",
    moreRenewalService: "Renewal service",
    moreSelectRenewalType: "Select renewal type",
    moreRenewalPeriod: "Renewal period",
    moreCalculateProceed: "Calculate and proceed to payment",
    moreSaveVehicleOnPhone: "Save vehicle on this phone",
    moreCaptureOffline: "Capture without a connection",
    moreVehicleAuthorityUnreachable: "The vehicle authority cannot be reached",
    moreTryVehicleAuthorityAgain: "Try the vehicle authority again",
    morePrinter: "Field Thermal Printer",
    moreDisconnect: "Disconnect",
    morePushTitle: "Instant Push Notifications",
    moreContinue: "Continue",
    grpTitle: "Groups and cooperatives",
    grpRegister: "Register a group",
    grpName: "Group name",
    grpKind: "What kind of group",
    grpChooseOne: "Choose one",
    grpLeaderName: "Leader’s name",
    grpLeaderPhone: "Leader’s phone number",
    grpLga: "Local Government Area",
    grpCommunity: "Community",
    grpMemberCount: "Roughly how many members",
    grpRecordMember: "Record a member",
    grpMember: "Member",
    grpRecorded: "Recorded",
    grpWaitingOfficer: "Waiting for an officer",
    grpAskLeaderConfirm: "Ask the leader to confirm",
    grpSendToLeader: "Send this to the leader",
    grpNoAssessment: "This does not assess anybody",
    authSignInTitle: "Sign in to continue",
    authSignIn: "Sign in",
    authPhoneHint: "Use the phone number you registered with PSIRS.",
    authPassword: "Password",
    authApply: "Apply to become an agent",
    authApplyTitle: "Apply to become a revenue agent",
    authBackToSignIn: "Back to sign in",
    authYourDetails: "Your details",
    authFullName: "Full name",
    authPhone: "Phone number",
    authEmail: "Email address",
    authDateOfBirth: "Date of birth",
    authOccupation: "Occupation",
    authWhereYouLive: "Where you live",
    authAddress: "Residential address",
    authSelectLga: "Select your LGA",
    authNeedDocuments: "You will need identity documents, bank details and a referee.",
    authWhatNext: "What happens next",
    authNextSignIn: "Sign in and complete identity verification.",
    authNextReferee: "Nominate a referee who can confirm who you are.",
    authNextReview: "PSIRS reviews your application.",
    authNextClearance: "Complete training, bank verification and device registration.",
    authApplicationReceived: "Application received",
    authApplicationNumber: "Your application number is",
    colWhoIsPaying: "Who is paying?",
    colSearchTaxpayer: "Search taxpayer",
    colNamePhoneTin: "Name, phone or TIN",
    colChangeTaxpayer: "Change taxpayer",
    colRegisterNew: "Register a new taxpayer",
    colWhatPaying: "What are they paying?",
    colRevenueItem: "Revenue item",
    colSelectItem: "Select a revenue item",
    colBasisAmount: "Amount the charge is calculated on (₦)",
    colCalculate: "Calculate amount",
    colHowCalculated: "How this amount was calculated",
    colAboutToCollect: "You are about to collect",
    colConfirmProceed: "Confirm and proceed to payment",
    colDownloadReceipt: "Download receipt",
    colShareReceipt: "Share receipt",
    colHistory: "History",
    colBackHome: "Back to home",
    colOfflineTitle: "You are offline",
    colOfflineBody: "Revenue cannot be collected without a connection. Government payments must be confirmed by the payment system before a receipt exists.",
    supGetHelp: "Get help",
    supReportProblem: "Report a problem",
    supMyReports: "My reports",
    supNothingReported: "You have not reported anything yet.",
    supWhatProblem: "What is the problem?",
    supChooseOne: "Choose one",
    supShortSummary: "Short summary",
    supWhatHappened: "What happened?",
    supHowUrgent: "How urgent is it?",
    supNotUrgent: "Not urgent",
    supUrgent: "Urgent — a taxpayer is waiting",
    supVeryUrgent: "Very urgent — money may be at risk",
    supTransactionRef: "Transaction reference",
    supBeforeYouSend: "Before you send this",
    supConversation: "Conversation",
    supAddToReport: "Add to this report",
    supReportClosed: "This report is closed",
    supReopened: "Reopened",
    allocHandOut: "Hand out an allocation",
    allocScanCode: "Scan the code",
    allocStopScanning: "Stop scanning",
    allocTypeCode: "Or type the collection code",
    allocRecorded: "Recorded",
    allocCodeUsed: "This code is now used. If the beneficiary comes back with it, PSIRS will refuse it.",
    scanCamera: "Camera",
    rcpGovernment: "PLATEAU STATE GOVERNMENT",
    prnNoWritable: "No writable printer service was found on this device.",
    prnNotConnected: "No printer is connected. Connect one first.",
    prnSendFailed: "The printer did not accept the data. Try again.",
    prnDisconnected: "The printer disconnected.",
    slipTestOk: "PRINTER TEST OK",
    slipWidth: "Width",
    slipStatus: "Status",
    slipConnected: "Connected (BLE)",
    slipReady: "Mobile POS Terminal Ready",
    rcpThanks: "Thank you for your civic duty",
    rcpBureau: "INTERNAL REVENUE SERVICE",
    rcpPlatform: "Digital Grassroots Platform",
    rcpTitle: "OFFICIAL REVENUE RECEIPT",
    rcpDateTime: "Date / Time",
    rcpReference: "Reference",
    rcpLga: "LGA",
    rcpWard: "Ward",
    rcpTaxpayer: "Taxpayer",
    rcpPhone: "Phone",
    rcpItem: "Service",
    rcpCategory: "Category",
    rcpAgentCode: "Agent ID",
    rcpAgentName: "Agent Name",
    rcpScanToVerify: "SCAN TO VERIFY AUTHENTICITY",
    rcpCheckOffice: "Check this receipt at any",
    rcpCheckOfficeCont: "PSIRS office with the code.",
    rcpOffice: "Government Revenue Office",
    rcpVehAdmin: "MOTOR VEHICLE ADMINISTRATION",
    rcpVehLicensing: "Vehicle Licensing & Renewal",
    rcpVehTitle: "VEHICLE RENEWAL CLEARANCE",
    rcpVehPlate: "Plate Number",
    rcpVehDoc: "Document Number",
    rcpVehOwner: "Owner",
    rcpVehMakeModel: "Make/Model",
    rcpVehYear: "Year",
    rcpVehChassis: "Chassis",
    rcpVehFrom: "Valid From",
    rcpVehUntil: "Valid Until",
    rcpVehFee: "FEE PAID",
    rcpVehOfficial: "OFFICIAL DIGITAL CLEARANCE",
    rcpVehCheck: "Check the code at PSIRS.",
    connOnline: "Online",
    connOnlineDetail: "All services are available.",
    connLimited: "Poor connection",
    connLimitedDetail: "Your connection is weak. Payments may take longer to confirm — do not start a payment twice.",
    connOffline: "Offline",
    connOfflineDetail: "You can register a taxpayer and write down a business, and both will be sent when you are back online. Payments are not possible while offline.",
    appRecordsWaiting: "saved records waiting to send",
    stepUpSignInAgain: "Sign in again to request a code.",
    stepUpEnterCode: "Enter the one-time code sent to your phone to authorise this action:",
    stepUpCodeRequired: "A one-time code is required to continue.",
    morePushUnsupported: "Push notifications are not supported on this device or browser.",
    errUploadFailed: "The document could not be sent. Try again.",
    errUploadOffline: "You are offline. An identity document is sent to PSIRS as it is captured and is not stored on this device — take the photograph again when you have a connection.",
    scanCameraDenied: "PSIRS does not have permission to use the camera. Allow it in your browser settings, or type the code instead.",
    scanCameraMissing: "No camera was found on this device. Type the code instead.",
    scanCameraUnsupported: "This browser cannot open the camera. Type the code instead.",
    colInvoiceReady: "Invoice {{number}} is ready to print or send.",
    morePayoutRequested: "Payout requested. It will be paid after finance approval. Reference {{reference}}.",
    morePayoutClawback: "Payout requested for {{amount}}. {{gross}} of commission was eligible and {{clawback}} was deducted for transactions that were reversed after their commission had been paid. It will be paid after finance approval. Reference {{reference}}.",
    agStepCodeSentTo: "We sent a code to {{phone}}. It is only for this one action.",
    appDraftsSynced: "{{count}} saved record(s) sent to PSIRS.",
    appDraftsSyncedRejected: "{{count}} saved record(s) sent to PSIRS, {{rejected}} need correction.",
    errRequestFailed: "The request failed. Try again, or contact support.",
    ofcAgConfirmHowPrompt: "Say how you confirmed this change with {{name}} (at least 10 characters):",
    ofcAgRefuseWhyPrompt: "Say why this change is being refused (at least 10 characters):",
    ofcAgAccountChanged: "{{name}}’s commission account has been changed.",
    ofcAgChangeRefused: "The change for {{name}} was refused. Their existing account is unchanged.",
    ofcAgNotConfirmed: "Not confirmed",
    ofcAgNotConfirmedBecause: "Not confirmed: {{reason}}",
    ofcAgAnOfficer: "An officer ({{role}})",
    ofcAgUnknownRole: "unknown role",
    ofcAgBankStillNotConfirmed: "The bank still did not confirm it ({{outcome}}).",
    ofcAlForfeitWhy: "Why is {{name}}’s {{quantity}} forfeited?",
    ofcAlThisBeneficiary: "this beneficiary",
    ofcAlRoundOpened: "{{name}} is open. Awards can now be made.",
    ofcAlRoundClosed: "{{name}} is closed. No further awards.",
    ofcAlRoundCannotCloseBeforeOpen: "A round cannot close before it opens.",
    ofcCfItemAdded: "{{name}} has been added to the catalogue. It has no rate yet, so it cannot be assessed until you set one.",
    ofcCfNotAnAmount: "“{{amount}}” is not an amount in naira. Enter it as 15000 or 15000.00.",
    ofcCfNotAPercentage: "“{{value}}” is not a percentage. Enter it as 5 or 5.00.",
    ofcCfRateRecorded: "A new rate version for “{{name}}” has been recorded, effective {{date}}. ",
    ofcCfProgrammeStatus: "Programme “{{name}}” is now {{status}}.",
    ofcCfRateCannotBeNegative: "A rate cannot be negative.",
    ofcCfPercentageCannotExceed100: "A percentage rate cannot be more than 100%.",
    ofcFaMinimumAboveRecommended: "A minimum of {{minimum}} is above the recommended {{recommended}}, so even a handset on the newest build would be refused.",
    ofcFaNoHandsetBelow: "No active handset is below {{version}}.",
    ofcFaHandsetWouldStop: "{{count}} of {{total}} active handset would stop collecting until it is updated.",
    ofcFaHandsetsWouldStop: "{{count}} of {{total}} active handsets would stop collecting until they update.",
    ofcFnSettlementRecorded: "{{reference}} recorded. {{count}} collection(s) settled.",
    ofcFnSettlementDisputed: "{{reference}} recorded and disputed: the credit does not match the collections it covers, so none of them have been settled. Close the dispute once the rest of the money is accounted for.",
    ofcFnTotalCreditedPrompt: "Total now credited against {{reference}}, in naira. ",
    ofcFnReconciliationAborted: "Reconciliation did not run: {{reason}} ",
    ofcFnStatementUnavailable: "the gateway statement could not be retrieved.",
    ofcFnReconciliationComplete: "Reconciliation complete: {{matched}} matched, {{exceptions}} exception(s)",
    ofcFnReconciliationUnchecked: ", {{count}} reference(s) the gateway could not be asked about",
    ofcFnTotalsAgree: ". Platform total and gateway total agree.",
    ofcFnTotalsDisagree: ". Platform total and gateway total DO NOT agree.",
    ofcFnRecoverChecked: "Checked {{attempted}} unconfirmed payment(s) against the gateway; {{verified}} were confirmed and have now been receipted.",
    ofcFnReversalExecuted: "Reversal executed as {{reference}}. {{count}} commission record(s) reversed.",
    ofcGrApproved: "{{name}} approved. Members can now be recorded.",
    ofcGrCollectedAt: " · collected at {{place}}",
    ofcKycAccepted: "{{document}} accepted.",
    ofcKycRejectedNotice: "{{document}} rejected. The applicant can see the reason and submit a replacement.",
    ofcKycSubmittedByApplicant: "{{document}} submitted by the applicant",
    ofcKycReasonGiven: "Reason given: {{reason}}",
    ofcOvSweepRaised: "Sweep complete. {{count}} flag(s) raised for review.",
    ofcOvJobsNeedAttention: "{{count}} of {{total}} scheduled jobs need attention. A job that is not running produces nothing to look at, so this is the only place it shows.",
    ofcRhInvoiceDocumentReady: "Invoice document ready for {{number}}.",
    ofcRhPayoutApproved: "Payout {{reference}} approved.",
    ofcSpTicketMoved: "Ticket moved to {{status}}.",
    verifyCheckReceipt: "Check a receipt",
    verifyScanQr: "Scan the QR code",
    verifyTypeCode: "Or type the verification code",
    verifyOffline: "You are offline",
    stepUpOneTimeCode: "One-time code",
    stepUpExpired: "That code has expired",
    stepUpAskNew: "Ask for a new one to continue.",
    stepUpSendNew: "Send a new code",
    stepUpCouldNotContinue: "Could not continue",
    stepUpDevelopmentBuild: "Development build",
    appSignOut: "Sign out",
    appSwitchLanguage: "Switch language",
    appPageNotFound: "Page not found",
    appPageNotFoundBody: "That screen does not exist.",
    appReturnHome: "Return to the home screen",
    appRecordsSynced: "Records synchronised",
    appRecordsNotSent: "Saved records could not be sent",
    appUpdateRequired: "Update required",
    homeViewApplication: "View my application",
    homeCollectedToday: "Collected today",
    homeQuickActions: "Quick actions",
    homeRecentTransactions: "Recent transactions",
    homeNoTransactions: "No transactions yet. Start by registering or finding a taxpayer.",
    homeLifetime: "Lifetime",
    homeTaxpayersRegistered: "Taxpayers registered",
    homeCommissionEarned: "Commission earned",
    homeAvailableForPayout: "Available for payout",

    genuineReceipt: 'Genuine receipt',
    receiptNotValid: 'Not a valid receipt',
    receiptNotValidBody:
      'No government document matches that number or code. If you were given a receipt bearing this number, it was not issued by PSIRS.',
    receiptCodeShape: 'A verification code looks like T7C72-QTUDN. Check the code and try again.',

    needFirstName: 'Enter the taxpayer\u2019s first name.',
    needLastName: 'Enter the taxpayer\u2019s last name.',
    needPhone: 'Enter the taxpayer\u2019s phone number in full, for example 08012345678.',
    needAddress: 'Enter the taxpayer\u2019s address.',
    needLga: 'Choose the Local Government Area.',
    needConsent: 'The taxpayer must agree before you can register them.',
    needDeclaration: 'Confirm the declaration before you register the taxpayer.',
    needExistingTin:
      'Enter the taxpayer\u2019s existing TIN, or choose \u201cNo\u201d if they do not have one yet.',
    birthDateFuture: 'That date of birth is in the future. Check the year.',
    birthDateTooOld: 'That date of birth is before 1900. Check the year.',
    birthDateMalformed: 'Enter the date of birth as a day, month and year.',
    emailIncomplete: 'That email address does not look complete. Correct it, or leave it blank.',

    deviceNotRegistered:
      'This device is not registered to your agent account. Register it before collecting revenue.',
    deviceAfterApproval: 'You can register a device once PSIRS has approved your application.',

    statusPaid: 'PAID / VERIFIED',
    statusPending: 'PENDING',
    statusFailed: 'FAILED',
    statusOffline: 'OFFLINE',
    statusOnline: 'ONLINE',

    offlineMessage: 'You are offline. Saved records will sync when signal returns.',
    offlineNotice: 'Captured offline. No money has been marked as received until confirmed.',
    civicDutyThanks: 'Thank you for fulfilling your civic duty.',
    paymentSuccess: 'Payment Successful',
    pubService: 'Plateau State Internal Revenue Service',
    pubLanguage: 'Language',
    pubEnglish: 'English',
    pubHausa: 'Hausa',
    pubThankYou: 'THANK YOU',
    pubVerifyTitle: 'Verify a government receipt',
    pubVerifyField: 'Receipt number or verification code',
    pubVerifyAction: 'Verify',
    pubVerifyChecking: 'Checking…',
    pubVerifyReceiptNumber: 'Receipt number',
    pubVerifyRevenueType: 'Revenue type',
    pubVerifyAmount: 'Amount',
    pubVerifyIssued: 'Issued',
    pubVerifyLga: 'Local Government Area',
    pubVerifyFingerprint: 'Document fingerprint',
    pubVerifyMatches: 'Matches the original',
    pubVerifyNoMatch: 'Does not match the original',
    pubVerifyPrivacy: 'For privacy, taxpayer names, phone numbers and TINs are never shown on this page.',
    pubRefereeTitle: 'Agent verification request',
    pubRefereeIntro:
      '{{name}} has applied to become an authorised revenue agent. PSIRS needs somebody who knows them to confirm their identity and suitability.',
    pubRefereeApplicant: 'Applicant',
    pubRefereeYouAre: 'You are recorded as',
    pubRefereeRelationship: 'Stated relationship',
    pubRefereeCategory: 'Referee category',
    pubRefereeRespondBefore: 'Respond before',
    pubRefereeConfirmEach: 'Please confirm each of the following:',
    pubDeclarationKnows: 'I know this person.',
    pubDeclarationAccurate: 'The information presented is reasonably accurate.',
    pubDeclarationWilling: 'I am willing to act as referee.',
    pubDeclarationConsequences: 'I understand that providing false information may have consequences.',
    pubRefereeIdType: 'Your identification type',
    pubRefereeIdNumber: 'Your identification number',
    pubRefereeIdHint: 'Stored securely and never shown in full. If you leave this blank, a PSIRS officer will review your response manually.',
    pubRefereeOccupation: 'Your occupation',
    pubIdNin: 'National Identification Number',
    pubIdBvn: 'Bank Verification Number',
    pubIdPassport: 'International passport',
    pubIdLicence: 'Driver’s licence',
    pubIdVoters: 'Voter’s card',
    pubRefereeSubmit: 'Confirm and submit',
    pubRefereeSubmitting: 'Submitting…',
    pubRefereeDecline: 'I cannot act as referee',
    pubRefereeNoAccount: 'You do not need an account. This link can be used once and expires on',
    pubDeclineTitle: 'Decline to act as referee?',
    pubDeclineBody1a: 'You are about to tell PSIRS that you cannot vouch for',
    pubDeclineBody1b: 'Their application to collect government revenue will not go forward on your word.',
    pubDeclineBody2: 'This cannot be undone from this page, and the link cannot be used again.',
    pubDeclineReason: 'Reason (optional)',
    pubDeclineReasonHint: 'If you simply do not know this person well enough, saying so is enough.',
    pubDeclineYes: 'Yes, decline',
    pubDeclineNo: 'No, go back',
    pubDeclineSending: 'Sending…',
    pubAttestTitle: 'Group membership check',
    pubAttestIntro: 'PSIRS needs you to confirm which of these people really are members. Government support is offered to members, so confirming somebody who is not one takes it from somebody who is.',
    pubAttestGroup: 'Group',
    pubAttestAlready: 'Already confirmed',
    pubAttestNothingTitle: 'Nothing waiting',
    pubAttestNothingBody: 'Every member on this list has already been confirmed. There is nothing for you to do.',
    pubAttestQuestion: 'Is each of these people a member of your group?',
    pubAttestYes: 'Member',
    pubAttestNo: 'Not a member',
    pubAttestAnswerAll: 'Please answer for every person before sending.',
    pubAttestSubmit: 'Send my answers',
    pubCitizenTitle: 'Check your tax status',
    pubCitizenModeTin: 'By TIN',
    pubCitizenModePhone: 'By phone',
    pubCitizenModeName: 'By name',
    pubCitizenCheck: 'Check status',
    pubCitizenSearching: 'Searching…',
    pubCitizenExampleTin: 'e.g. PL-000001234',
    pubCitizenExamplePhone: 'e.g. 08012345678',
    pubCitizenExampleName: 'e.g. Aminu Ibrahim',
    pubCitizenByTin: 'Tax Identification Number (TIN)',
    pubCitizenByPhone: 'Registered phone number',
    pubCitizenByName: 'Full name or business name',
    pubCitizenTooMany: 'Use your TIN or exact phone number for a precise result.',
    ofcDbOr: 'or',
    ofcDbDayRange: '{{from}} to {{to}}',
    ofcGpBeneficiaryCount: '{{count}} beneficiaries',
    ofcGpCollectedOfAwarded: '{{collected}} of {{awarded}} ({{rate}}%)',
    ofcGpEachBeneficiaryGets: '{{quantity}} {{unit}} each',
    ofcOvIdentifiers: 'identifiers',
    nsStepUpRequired: 'Confirm this with the one-time code, then try again.',
    nsDeviceNotRegistered:
      'Open Profile, then "View my application and clearance", to register it.',
    nsDeviceRevoked:
      'A revoked handset cannot be registered again. Register the replacement handset and ask your supervisor to approve it.',
    nsDeviceSuspended: 'Your supervisor can tell you why, and restore it.',
    nsUpdateRequired: 'Close and reopen the app to install the latest version.',
    nsUpdateRequiredToEnumerate:
      'Close and reopen the app to install the latest version. Anything already saved on this phone will still be sent.',
    nsTinServiceUnavailable:
      'Try again in a few minutes. Do NOT register this taxpayer as a new TIN applicant — that would create a second TIN for someone who already has one.',
    nsTinNotFound:
      'Check the number against the taxpayer’s own document first — a mistyped digit is the usual cause. Only if they have never had a TIN, go back and register them without one; the platform will apply for a new TIN for them.',
    nsKycProviderUnavailable: 'Try again in a few minutes. Your application is unchanged.',
    nsPaymentUnconfirmed: 'Open the transaction from your history to see its current status.',
    nsPaymentFailed: 'Start the payment again, or choose a different payment method.',
    nsAgentNotCleared: 'Open "My Application" to see what is still outstanding.',
    ofcOvJobHealthy: 'Running on schedule.',
    ofcOvJobRunning: 'Running now.',
    ofcOvJobOverdue: 'Has not started when it should have. The schedule itself may have stopped.',
    ofcOvJobStalled:
      'Started and never finished. Whichever instance was running it did not come back.',
    ofcOvJobFailing: 'Failed {{count}} times in a row: {{error}}',
    ofcOvJobNeverRun: 'Has not run once since this database was created.',
    ofcOvJobNoReason: 'no reason recorded',
    ofcOvEverySeconds: 'every {{n}}s',
    ofcOvEveryMinutes: 'every {{n}} min',
    ofcOvEveryHours: 'every {{n}} h',
    errDraftInvalid:
      'PSIRS could not accept this capture: {{detail}}. It is still on your phone — correct it and send it again.',
    errDraftTypeUnsupported:
      'This version of the app made a "{{type}}" capture that PSIRS cannot process yet. It has not been lost — update the app, or quote this reference to support.',
    errDraftNotProcessed:
      'PSIRS could not process this capture. It is still on your phone — quote reference {{reference}} to support.',
    agVehFoundConfirmed: 'Vehicle found and confirmed against the vehicle authority record.',
    agVehFoundUnconfirmed:
      'Vehicle found on the platform. It has not been confirmed against the vehicle authority.',
    agVehRegistryUnavailable:
      'The vehicle authority could not be reached, so we cannot say whether this vehicle is registered. Try again shortly. If the renewal cannot wait, capture the details manually — the record will be flagged for checking once the authority is back.',
    agVehNotFound:
      'No record of this vehicle was found on the platform or at the vehicle authority. Capture the vehicle details manually — the record will be marked as unverified.',
    agVehFoundAtAuthority:
      'Vehicle found at the vehicle authority. Confirm the owner before proceeding.',
    agRefereeRequestSent: 'A verification request has been sent to {{name}}.',
    agDevicePendingApproval: 'Device registered and awaiting approval by your supervisor.',
    agDeviceSuspended: 'This device is registered but suspended. Your supervisor can restore it.',
    agDeviceActive: 'Device registered and active.',
    agGroupMemberRecorded:
      'Recorded. The membership counts only once the group leader has confirmed it.',
    ofcItemBackInCatalogue: '{{name}} is back in the catalogue and can be assessed again.',
    ofcItemSuspended:
      '{{name}} is suspended. No new assessment can be raised against it; invoices already issued stay payable.',
    ofcItemRetired:
      '{{name}} has been retired. Invoices already issued stay payable, and the item cannot be brought back.',
    ofcGpMemberLeft:
      '{{member}} is recorded as having left {{group}}. They keep what they already collected and will not be counted in future allocations.',
    pubRefereeThankYouCleared: 'Thank you. Your verification has been completed and recorded.',
    pubRefereeCouldNotVerify:
      'Your identity could not be verified. PSIRS may contact you for more information.',
    pubRefereeUnderReview:
      'Thank you. Your response has been recorded and is now being reviewed by PSIRS.',
    pubRefereeDeclineRecorded:
      'Your decision has been recorded. The applicant will be told they need a different referee.',
    pubGroupAllConfirmed: 'Thank you. You confirmed {{confirmed}} membership(s).',
    pubGroupSomeConfirmed:
      'Thank you. You confirmed {{confirmed}} membership(s) and did not confirm {{rejected}}.',
    pubCitizenNoTinMatch: 'No taxpayer record found for that TIN.',
    pubCitizenNoPhoneMatch: 'No taxpayer record found for that phone number.',
    pubCitizenNoNameMatch: 'No record found with that name.',
    pubCitizenOneMatch: 'One matching record found.',
    pubCitizenManyMatches: '{{count}} records found with a similar name.',
    pubCitizenStatusHeading: 'Tax compliance status',
    pubCitizenCompliant: 'Compliant',
    pubCitizenArrears: 'Has arrears',
    pubCitizenAttention: 'Needs attention',
    pubCitizenNotAssessed: 'Not yet assessed',
    pubCitizenMsgCompliant: 'Your tax records are up to date. Keep paying on time to maintain your status.',
    pubCitizenMsgArrears: 'You have outstanding tax obligations. Please contact your nearest PSIRS office or a revenue agent to pay.',
    pubCitizenMsgAttention: 'Your compliance score needs improvement. Paying your obligations on time will raise it.',
    pubCitizenMsgNotAssessed: 'Nothing has been assessed against you yet, so there is no compliance score to report. This will update after your first assessment.',
    pubCitizenDetail: 'For your TIN, your compliance score, what you owe and which support programmes you qualify for, visit any PSIRS office or an authorised revenue agent. They will confirm who you are first, which is why those details are not shown here.',
    pubCitizenTinStatus: 'TIN status',
    pubCitizenOutstanding: 'Outstanding obligations',
    pubCitizenOutstandingYes: 'Yes — please contact PSIRS',
    pubCitizenNone: 'None',
    pubStmtFrom: "From",
    pubStmtTo: "To",
    pubStmtBackwards: "The start of the period is after its end.",
    pubStmtAnotherPeriod: "Look at a different period (sends a new code)",
    pubStmtTitle: "What you have already paid",
    pubStmtIntro: "To see your payments we send a code to the phone number on your record. It is never sent to a number typed here.",
    pubStmtSendCode: "Send me a code",
    pubStmtSending: "Sending…",
    pubStmtCodeSent: "If a record matches, a code has gone to the phone number on it. Enter it below.",
    pubStmtCode: "Code from the SMS",
    pubStmtShow: "Show my payments",
    pubStmtChecking: "Checking…",
    pubStmtPeriod: "Payments from {{from}} to {{to}}.",
    pubStmtTotal: "Total paid",
    pubStmtCount: "Payments",
    pubStmtReturned: "Returned to you",
    pubStmtReturnedRow: "returned to you",
    pubStmtForWhat: "What it went to",
    pubStmtEach: "Each payment",
    pubStmtNothing: "Nothing was paid in this period.",
    pubStmtFooter: "Keep your receipts. If this list and your receipts disagree, take them to a PSIRS office — the receipt is the proof, this is the record.",
    pubCitizenFooter: 'For questions about your account, visit any PSIRS office or contact an authorised revenue agent.',
    pubCitizenAlso: 'Also available:',
    pubCitizenVerifyLink: 'Verify a payment receipt',
    agSupYou: 'You',
    collAuthorizedFieldOfficer: 'Authorized Field Officer',
    moreDisablePushNotifications: 'Disable Push Notifications',
    moreSentToPsirsYour: 'Sent to PSIRS. Your commission still goes to your existing account until an officer approves the change.',
    moreUnknownOwner: 'Unknown owner',
    ofcAgAgentActivated: 'Agent activated.',
    ofcAgAgentAgreementAccepted: 'Agent agreement accepted',
    ofcAgAgentSuspendedTheirSessions: 'Agent suspended. Their sessions and devices have been disabled.',
    ofcAgApplicationApproved: 'Application approved.',
    ofcAgApplicationRejected: 'Application rejected.',
    ofcAgAskedForBy: 'Asked for by',
    ofcAgCommissionBankAccountVerified: 'Commission bank account verified',
    ofcAgConfirmedNoNameReturned: 'Confirmed, no name returned',
    ofcAgDeviceApprovedTheAgent: 'Device approved. The agent can now collect from it.',
    ofcAgDeviceRestoredTheAgent: 'Device restored. The agent can collect from it again.',
    ofcAgDeviceRevokedAndIts: 'Device revoked and its sessions ended.',
    ofcAgDeviceSuspendedAndIts: 'Device suspended and its sessions ended. It can be restored.',
    ofcAgDocumentType: 'Document type',
    ofcAgFailureReason: 'Failure reason',
    ofcAgFlagDismissedTheReferee: 'Flag dismissed. The referee can be cleared as normal.',
    ofcAgFlagMarkedAsUnder: 'Flag marked as under review.',
    ofcAgFlagUpheldThisReferee: 'Flag upheld. This referee cannot be cleared until it is dismissed.',
    ofcAgGiveAReasonOf: 'Give a reason of at least 10 characters. It is the only record of why the account somebody is paid into was moved.',
    ofcAgGovernmentApproved: 'Government approved',
    ofcAgIdentityVerifiedKyc: 'Identity verified (KYC)',
    ofcAgLivenessCheck: 'Liveness check',
    ofcAgMandatoryTrainingCompleted: 'Mandatory training completed',
    ofcAgMoreInformationRequestedFrom: 'More information requested from the applicant.',
    ofcAgNameTheAgentGave: 'Name the agent gave',
    ofcAgNameTheBankReturned: 'Name the bank returned',
    ofcAgNumberOnFile: 'Number on file',
    ofcAgReasonGiven: 'Reason given',
    ofcAgRecordThis: 'Record this',
    ofcAgRefereeCleared: 'Referee cleared.',
    ofcAgRefereeRejected: 'Referee rejected.',
    ofcAgTerritoryReassignedFutureCollections: 'Territory reassigned. Future collections are attributed to it.',
    ofcAgTheAgent: 'The agent',
    ofcAgTheBankConfirmedThe: 'The bank confirmed the account.',
    ofcAgTheBankCouldNot: 'The bank could not be reached',
    ofcAgTheBankVerificationService: 'The bank verification service could not be reached. Try again before deciding — an unconfirmed account cannot be approved.',
    ofcAgThisAccountCannotBe: 'This account cannot be approved while the bank does not confirm it. Refuse the request so the agent can send the right details.',
    ofcAgUnnamed: 'Unnamed',
    ofcAlChooseTheProgrammeThis: 'Choose the programme this round distributes under.',
    ofcAlCreateARound: 'Create a round',
    ofcAlCreateRound: 'Create round',
    ofcAlCreating: 'Creating…',
    ofcAlGiveTheRoundA: 'Give the round a name people will recognise.',
    ofcAlHowMuchDoesEach: 'How much does each beneficiary receive?',
    ofcAlHowMuchIsThere: 'How much is there to distribute in total?',
    ofcAlNotYet: 'Not yet',
    ofcAlOneBeneficiaryCannotReceive: 'One beneficiary cannot receive more than the whole round holds.',
    ofcAlRoundCreatedItAwards: 'Round created. It awards nothing until you open it.',
    ofcAlWhenDoesCollectionOpen: 'When does collection open?',
    ofcCfActivate: 'Activate',
    ofcCfAddToTheCatalogue: 'Add to the catalogue',
    ofcCfAdding: 'Adding…',
    ofcCfBusinesses: 'Businesses',
    ofcCfCalculatedByFormula: 'Calculated by formula',
    ofcCfCurrent: 'Current',
    ofcCfEnterTheNewAmount: 'Enter the new amount. Leave nothing to chance \\u2014 type 0 if the levy is being suspended.',
    ofcCfEnterTheNewRate: 'Enter the new rate as a percentage. Type 0 if the levy is being suspended.',
    ofcCfEvaluateAll: 'Evaluate all',
    ofcCfEvaluating: 'Evaluating…',
    ofcCfExistingAssessmentsAreUnaffected: 'Existing assessments are unaffected.',
    ofcCfForExampleRepealedBy: 'For example: repealed by the Plateau State Finance Law amendment.',
    ofcCfGiveAReasonFor: 'Give a reason for the rate change, in at least 10 characters.',
    ofcCfIndividuals: 'Individuals',
    ofcCfNoApprovedRateIn: 'No approved rate in force',
    ofcCfNoNewAssessmentCan: 'No new assessment can be raised against a withdrawn item. Invoices already issued stay payable — withdrawing an item is not a decision to write off arrears.',
    ofcCfNotEligible: 'Not eligible',
    ofcCfOfAssessableAmount: '% of assessable amount',
    ofcCfProgressiveBands: 'Progressive bands',
    ofcCfRecordNewRateVersion: 'Record new rate version',
    ofcCfRecording: 'Recording…',
    ofcCfRestoreItem: 'Restore item',
    ofcCfTheItemGoesBack: 'The item goes back into the catalogue and can be assessed against again.',
    ofcCfWhatChangedForExample: 'What changed — for example, the tariff was confirmed against the gazette.',
    ofcCfWithdrawItem: 'Withdraw item',
    ofcDbAverageTimeToConfirm: 'Average time to confirm a payment',
    ofcDbDuplicateRegistrationsOverridden: 'Duplicate registrations overridden',
    ofcDbNewTaxpayersThisMonth: 'New taxpayers this month',
    ofcDbReversalsAndRefunds: 'Reversals and refunds',
    ofcDbTaxpayersWithATin: 'Taxpayers with a TIN',
    ofcDbTotalCollected: 'Total collected',
    ofcFaEnterTheMinimumVersion: 'Enter the minimum version as digits and dots, like 1.4.0.',
    ofcFaEnterTheRecommendedVersion: 'Enter the recommended version as digits and dots, like 1.4.0.',
    ofcFaNeverReportedAVersion: 'Never reported a version',
    ofcFaPublishThisMinimum: 'Publish this minimum',
    ofcFaPublishing: 'Publishing…',
    ofcFaSayWhyTheMinimum: 'Say why the minimum is moving, in at least 10 characters. It is what an agent who is locked out will be shown.',
    ofcFaShippedWithThePlatform: 'Shipped with the platform',
    ofcFnBankReferenceForThe: 'Bank reference for the credit that settles it',
    ofcFnBankTransferReferenceAt: 'Bank transfer reference (at least 3 characters):',
    ofcFnEnterTheCreditedAmount: 'Enter the credited amount in naira, for example 1250000.00.',
    ofcFnBankReferenceRequired:
      'Enter the bank reference for the credit that settles this. It is what ties the settlement to the money that actually arrived.',
    ofcFnDisputeNoteTooShort:
      'Say what the variance turned out to be, in at least 10 characters. It is the only record of why this settlement was closed.',
    ofcFnItHasToAccount: 'It has to account for the collections in the batch in full.',
    ofcFnListTheGatewayReferences: 'List the gateway references this credit covers.',
    ofcFnNothingWasComparedFor: 'Nothing was compared for this period, so nothing about it has been confirmed. Try again once the gateway is reachable.',
    ofcFnReRunThisPeriod: 'Re-run this period once the gateway is reachable.',
    ofcFnReasonForApprovingThis: 'Reason for approving this payout (at least 5 characters):',
    ofcFnReasonForThisDecision: 'Reason for this decision (at least 10 characters):',
    ofcFnRecordHowThisException: 'Record how this exception was resolved (at least 10 characters):',
    ofcFnWhatDidTheBank: 'What did the bank say? (at least 10 characters)',
    ofcFnWhatTheVarianceTurned: 'What the variance turned out to be',
    ofcGpConfirmationLinkCreated: 'Confirmation link created.',
    ofcKyOpenAndReview: 'Open and review',
    ofcKyReviewedOn: 'Reviewed on',
    ofcKyTheAccessLogCould: 'The access log could not be read.',
    ofcLgCouldNotReachThe: 'Could not reach the revenue platform. Check your connection.',
    agStepSendingACode: 'Sending a one-time code…',
    agStepCodeSentToNumber: 'We sent a code to your registered number.',
    uiHide: 'Hide',
    uiHidePassword: 'Hide password',
    uiShow: 'Show',
    uiShowPassword: 'Show password',
    ofcOsAskTheGatewayAgain: 'Ask the gateway again',
    ofcOsAskTheTinService: 'Ask the TIN service again',
    ofcOsAskingTheGateway: 'Asking the gateway…',
    ofcOsAskingTheTinService: 'Asking the TIN service…',
    ofcOsEveryQueueYouCan: 'Every queue you can see is empty. Others are guarded by permissions your role does not hold.',
    ofcOsEveryRefundHasBeen: 'Every refund has been returned, every taxpayer has their TIN, and the vehicle authority has acknowledged every renewal.',
    ofcOsNotAttemptedYet: 'Not attempted yet',
    ofcOsSendToTheAuthority: 'Send to the authority again',
    ofcOsSendingToTheAuthority: 'Sending to the authority…',
    ofcOvEveryScheduledJobHas: 'Every scheduled job has run recently and succeeded.',
    ofcOvId: 'Id',
    ofcOvLoading: 'Loading…',
    ofcOvNoTaxpayerMatchedThat: 'No taxpayer matched that search',
    ofcOvNothingToChooseFrom: 'Nothing to choose from',
    ofcOvRecordWhatYouFound: 'Record what you found (at least 10 characters):',
    ofcOvRunAFraudSweep: 'Run a fraud sweep now',
    ofcOvRunThisQuery: 'Run this query',
    ofcOvRunning: 'Running…',
    ofcOvSearchForATaxpayer: 'Search for a taxpayer first',
    ofcOvSelectOne: 'Select one',
    ofcOvSweepCompleteNothingNew: 'Sweep complete. Nothing new was flagged.',
    ofcOvSweeping: 'Sweeping…',
    ofcOvTheAuditTrailCould: 'The audit trail could not be checked just now. This is not a finding about the trail — try again, and tell support if it persists.',
    ofcOvWhichAgent: 'Which agent?',
    ofcOvWhichRevenueItem: 'Which revenue item?',
    ofcOvWhichTaxpayer: 'Which taxpayer?',
    ofcRhAskTheRegisterAgain: 'Ask the register again',
    ofcRhAsking: 'Asking…',
    ofcRhDeviceApproved: 'Device approved.',
    ofcRhInvoiceDocument: 'Invoice document',
    ofcRhPreparing: 'Preparing…',
    ofcRhReAskedTheTin: 'Re-asked the TIN register for everyone still waiting.',
    ofcRhRemindersSentToTaxpayers: 'Reminders sent to taxpayers with something due.',
    ofcRhSendPaymentReminders: 'Send payment reminders',
    ofcRvEveryFigureHereCovers: 'Every figure here covers your territories only, not the whole state.',
    ofcRvNotMapped: 'Not mapped',
    ofcRvTheseFiguresAreEmpty: 'These figures are empty because your account covers no territory yet.',
    ofcSpAddAnInternalNote: 'Add an internal note',
    ofcSpAssignedTo: 'Assigned to',
    ofcSpContact: 'Contact',
    ofcSpInternalNoteSavedThe: 'Internal note saved. The reporter cannot see it.',
    ofcSpNobodyYet: 'Nobody yet',
    ofcSpOnlyStaffWithSupport: 'Only staff with support access can read this. The reporter never sees it.',
    ofcSpReplySent: 'Reply sent.',
    ofcSpReplyToTheReporter: 'Reply to the reporter',
    ofcSpSaveInternalNote: 'Save internal note',
    ofcSpSendReply: 'Send reply',
    ofcSpThisGoesToThe: 'This goes to the person who raised the ticket, and they are notified.',
    ofcTrCorrecting: 'Correcting…',
    ofcTrEnterTheCorrectedValue: 'Enter the corrected value in whichever field is wrong.',
    ofcTrNameTheTypeOf: 'Name the type of identification when changing the number.',
    ofcTrOnRecordNow: 'On record now',
    ofcTrPutBackOnThe: 'Put back on the register',
    ofcTrRecordThisCorrection: 'Record this correction',
    ofcTrRecording: 'Recording…',
    ofcTrSayWhatIsBeing: 'Say what is being corrected and why, in at least 10 characters. It is the only record of why.',
    ofcTxDirect: 'Direct',
    ofcUaChangeAccessAndSign: 'Change access and sign them out',
    ofcUaChanging: 'Changing…',
    ofcUaLetThemSignIn: 'Let them sign in again',
    ofcUaSaveTerritories: 'Save territories',
    ofcUaSignThemOutAnd: 'Sign them out and stop the account',
    ofcUsApplyingToBecomeAn: 'Applying to become an agent',
    ofcUsCapturingAVehicle: 'Capturing a vehicle',
    ofcUsRegisteringATaxpayer: 'Registering a taxpayer',
    ofcUsTakingACollection: 'Taking a collection',
  },
  ha: {
    appName: 'Hukumar Haraji ta Jihar Filato (PSIRS)',
    appTagline: 'Tsarin Karbar Haraji da Hidimar Masu Biyan Haraji a Jihar Filato',
    home: 'Gida',
    collect: 'Karbi Haraji',
    taxpayers: 'Masu Biyan Haraji',
    vehicles: 'Motoci',
    receipts: 'Takardun Rasit',
    more: 'Karin Bayani',
    search: 'Bincika',
    verify: 'Tabbatar da Rasit',
    signOut: 'Fita Daga Tsarin',

    payRevenue: 'Biyan Haraji',
    confirmPayment: 'Tabbatar da Biyan Kudi',
    downloadReceipt: 'Sauke Rasit (PDF)',
    shareReceipt: 'Tura Rasit',
    printBluetooth: 'Buga Rasit a Inji (Bluetooth)',
    registerTaxpayer: 'Yi Rajistar Mai Biyan Haraji',
    renewVehicle: 'Sabunta Lasisin Mota',
    pairPrinter: 'Hada Injin Buga Rasit',
    testPrint: 'Buga Gwaji',
    enablePush: 'Kunna Sanarwa ta Wayar Salula',

    taxpayerName: 'Sunan Mai Biyan Haraji',
    taxpayerTin: 'Lambar Shaida ta Haraji (TIN)',
    phone: 'Lambar Waya',
    lga: 'Karamar Hukuma (LGA)',
    ward: 'Gunduma (Ward)',
    service: 'Nau’in Haraji / Aiki',
    amount: 'Kudin Haraji',
    totalPaid: 'Jimlar Kudin da Aka Biya',
    receiptNumber: 'Lambar Rasit',
    verificationCode: 'Lambar Tantancewa',
    paymentMode: 'Hanyar Biyan Kudi',
    neverCollectCash: 'Kada ka karbi kudi a hannu',
    neverCollectCashBody:
      'Dole mai biyan haraji ya biya kudin gwamnati ta hanyar biyan kudi da aka amince da ita. Kada ka taba karbar kudi a asusunka.',
    cashChannelReminder:
      'Dole mai biyan haraji ya biya ta hanyar da aka amince da ita. Ka tabbatar da adadin kudin tare da shi kafin ka ci gaba.',
    noTaxPayable: 'Babu harajin da za a biya',
    noTaxPayableBody:
      'Wannan mai biyan haraji ba shi da abin biya a kan adadin da aka shigar. Kada ka kara adadin domin a sami biyan kudi — babu abin karba.',
    // The four below are the existing prose terms, unchanged. They do not fit
    // a tab and are listed in HAUSA-REVIEW.md with the width they have to fit
    // in, because shortening them is a translation decision and not ours.
    navHome: 'Gida',
    navTaxpayers: 'Masu Biyan Haraji',
    navCollect: 'Karbi Haraji',
    navReceipts: 'Takardun Rasit',
    // `kwamishan` is the glossary's agreed word, applied here rather than
    // chosen here. It also fits.
    navCommission: 'Kwamishan',
    // Awaiting the review. It was an English literal in the tab bar before,
    // which was the same gap with nothing recording it.
    navProfile: 'Profile',
    commissionAccountOnly: 'Wannan asusu na kwamishan ka ne kawai',
    commissionAccountNote:
      'Ana tabbatar da shi kafin a biya kowane kwamishan. Kudin gwamnati ba ya shiga wannan asusu ko kadan.',

    paymentFailed: 'Biyan kudin bai yi nasara ba',
    paymentFailedBody: 'Ba a karbi kudi daga mai biyan haraji ba. Kana iya sake fara biyan.',
    paymentUnconfirmed: 'Ba a tabbatar da biyan kudin ba tukuna',
    paymentUnconfirmedBody:
      'BA A nuna an karbi wannan kudin ba. Kada ka ce wa mai biyan haraji ya sake biya \u2014 ka sake dubawa nan da dan lokaci.',
    paymentAcknowledged: 'An tabbatar da biyan kudin \u2014 rasit zai biyo baya',
    paymentAcknowledgedBody:
      'Na’urar biyan kudi ta tabbatar da wannan biyan. Gwamnati ba ta riga ta karbi kudin ba, don haka wannan shaidar karbar kudi ce, BA rasit ba. Za a fitar da rasit ta atomatik da zarar kudin ya isa asusun gwamnati. Kada ka ce wa mai biyan haraji ya sake biya.',
    acknowledgementLabel: 'Shaidar karbar kudi',

    findTaxpayerFirst: 'Ka nemo mai biyan haraji tukuna. Dole a danganta kowane biyan kudi ga wani.',
    noTaxpayerMatch:
      'Babu mai biyan haraji da ya dace da wannan bincike. Ka yi masa rajista a kasa kafin ka karbi kudi \u2014 dole a danganta kowane biyan kudi ga mai biyan haraji.',
    searchAnotherArea:
      'Binciken suna yana rufe Karamar Hukumar da kake aiki a ciki kadai. Idan an yi masa rajista a wata Karamar Hukuma, ka nemo shi da lambar wayarsa, TIN, lambar mota ko lambar rasit.',
    languageForMessages: 'Harshen sakonnin sa',
    languageForMessagesHint:
      'Ka tambayi mai biyan haraji. Rasit dinsa yana zuwa ta SMS, kuma shi ne kwafin da zai samu kadai.',

    moneyNotDebited: 'Ba a karbi kudi daga mai biyan haraji ba.',
    moneyUnconfirmed: 'BA a tabbatar da biyan kudin ba. Kada ka sake karba.',
    moneyReceived: 'An karbi kudin.',
    errPaymentUnconfirmed:
      'Ba a iya tabbatar da biyan kudin ba tukuna. BA a rubuta cewa an karbi kudin ba. Kada ka ce wa mai biyan haraji ya sake biya — ka sake duba wannan ma’amala bayan wasu mintuna.',
    errPaymentPendingReconciliation:
      'An karbi kudin amma ana jiran a sasanta shi. Kada ka sake karba. Za a bayar da rasit da zarar kudin ya isa asusun gwamnati.',
    errPaymentFailed:
      'Biyan kudin bai yi nasara ba. Ba a karbi kudi daga mai biyan haraji ba. Kana iya sake farawa.',
    errAgentNotCleared:
      'Ba a ba ka izinin karbar haraji ba tukuna. Dole a kammala bukatarka a kuma amince da ita.',
    errDeviceNotRegistered:
      'Ba a yi rajistar wannan na’ura a asusunka ba. Ka yi rajistarta kafin ka karbi komai.',
    errRateLimited: 'Yunkuri sun yi yawa. Ka dan jira sannan ka sake gwadawa.',
    errUpdateRequired: 'Wannan manhajar ta tsufa, ba za ka iya karba da ita ba. Ka sabunta ta tukuna.',
    errReference: 'Lamba',
    ofcOvSignalCount: "Nawa",
    ofcOvSignalWindowSeconds: "A cikin, da dakiku",
    ofcOvSignalThreshold: "Iyaka",
    ofcOvSignalReason: "Dalili",
    ofcOvSignalAgentsSupported: "Wakilan da aka goyi baya",
    ofcOvSignalAgentAssignedTo: "Wakilin da aka ba",
    ofcOvSignalCollectedIn: "An karba a",
    ofcOvSignalAgentTerritory: "Yankin wakili",
    ofcOvSignalTransactionArea: "Inda aka karbi kudin",
    ofcFnResolveTooShort: "Ka fada yadda aka warware matsalar, da akalla haruffa 10. Shi ne kadai bayanin dalilin rufe wannan bambancin.",
    ofcFnExceptionResolved: "An rubuta cewa an warware matsalar.",
    ofcFnApprovePayoutTooShort: "Ka ba da dalilin amincewa da wannan fitar da kudi, da akalla haruffa 5.",
    ofcFnPayoutApproved: "An amince da fitar da kudin.",
    ofcFnTransferReferenceTooShort: "Ka shigar da lambar turawar banki. Ita ce ke hada wannan biyan da kudin da suka fita daga asusun da gaske.",
    ofcFnPayoutPaid: "An rubuta cewa an biya kudin.",
    ofcFnPayoutFailedTooShort: "Ka rubuta abin da banki ya ce. Dole a gaya wa wakili dalilin da ya sa ba a biya shi ba, kuma yunkuri na gaba ya dogara da sanin hakan.",
    ofcFnPayoutFailedRecorded: "An rubuta cewa ya gaza. Kwamishan da ke cikinsa ya sake zama abin biya, kuma duk wani cirewa da aka yi a ciki ya sake zama bashi.",
    ofcFnDecisionTooShort: "Ka ba da dalilin wannan shawarar, da akalla haruffa 10.",
    ofcFnRequestDecided: "An {{decision}} bukatar.",
    ofcOvFlagNoteTooShort: "Ka rubuta abin da ka gano, da akalla haruffa 10. Shi ne kadai bayanin dalilin da ya sa aka warware wannan alamar haka.",
    ofcOvFlagConfirmed: "An tabbatar da alamar. An dakatar da kwamishan wakilin har sai an warware.",
    ofcOvFlagMarked: "An sanya wa alamar {{decision}}.",
    ofcAlForfeitTooShort: "Ka ba da akalla haruffa goma da ke fadin dalilin sakin wannan rabon.",
    ofcAlReleased: "An sake shi. {{quantity}} ya koma cikin {{round}} domin wani mai amfana.",
    ofcUaChooseRoleFirst: "Ka zabi matsayin da wannan jami’in zai rike.",
    ofcUaAlreadyHolds: "{{name}} ya riga ya rike matsayin {{role}}.",
    ofcUaSayWhy: "Ka fada dalilin canja wannan izini, da akalla haruffa 10. Shi ne kadai bayanin dalilin.",
    ofcUaNowRole: "{{name}} yanzu {{role}} ne.",
    ofcUaSessionsEnded: "An kawo karshen zaman da aka bude {{n}}, don haka sai sun sake shiga.",
    ofcUaNoOpenSessions: "Ba su da wani zaman a bude.",
    ofcUaCanSignInAgain: "{{name}} na iya sake shiga.",
    ofcUaAccountIsNow: "Asusun {{name}} yanzu {{status}} ne.",
    ofcUaSessionsEndedNow: "An kawo karshen zaman da aka bude {{n}} nan take.",
    ofcAgRecordWhatYouFound: "Ka rubuta abin da ka gano: shi ne kadai bayanin dalilin da ya sa aka bar wannan alamar a bude, aka tabbatar da ita, ko aka yi watsi da ita.",
    enumDeviceVelocity: "Na’ura daya, karbar kudi da yawa",
    enumSharedPhoneNumber: "Lambar waya daya a kan masu biyan haraji da yawa",
    enumDuplicateTaxpayerDetails: "Bayanan da suke a wani bayanin",
    enumOutOfTerritory: "An karba a wajen yankin wakili",
    enumRepeatedFailedPayments: "Biyan kudi da ke ci gaba da gazawa",
    enumReversalPattern: "Yanayin mayar da kudi akai-akai",
    enumUnusualVolume: "Karbar kudi fiye da yadda aka saba",
    enumFrequentManualIntervention: "Ana yawan canza shi da hannu",
    enumRepeatedReceiptRegeneration: "An sake fitar da rasit ko saukar da shi sau da yawa",
    enumUnusualOfficerActivity: "Aiki ya fi na yau da kullun na wannan jami’in",
    enumUnusualTransactionTiming: "An rubuta karbar kudi da tsakar dare",
    enumUser: "Jami’i",
    enumRapidSuccession: "Karbar kudi a jere, da sauri sosai",
    enumCommissionAnomaly: "Kwamishan da bai yi daidai ba",
    enumSettlementVariance: "Hanyar biya ta biya wani adadi daban",
    enumAbandoned: "An yashe",
    enumAborted: "An dakatar da shi",
    enumAccepted: "An karba",
    enumAccountTransfer: "Tura kudi daga asusu",
    enumActionRequired: "Ana bukatar mataki",
    enumActivated: "An kunna",
    enumActive: "Mai aiki",
    enumAdditionalIdentification: "Karin shaida",
    enumAdditiveBenefit: "Karin amfani",
    enumAdmin: "Mai gudanarwa",
    enumAgent: "Wakili",
    enumAgentActivation: "Kunna wakili",
    enumAgentAssisted: "Taimakon wakili",
    enumAgentMisconduct: "Rashin da’a na wakili",
    enumAgentOnboarding: "Shigar da sabon wakili",
    enumAgentOverrideActivation: "Kunna wakili ta hanyar kebewa",
    enumAgentPwa: "Manhajar wakili",
    enumAgentSuspension: "Dakatar da wakili",
    enumAgreementAccepted: "An karbi yarjejeniya",
    enumAgriculture: "Noma",
    enumAgricultureProcessing: "Sarrafa amfanin gona",
    enumAmountMismatch: "Adadin bai dace ba",
    enumAnnual: "Kowace shekara",
    enumApi: "API",
    enumApplicationSubmitted: "An tura takardar neman aiki",
    enumApproved: "An amince",
    enumArchived: "An ajiye",
    enumArtisanCraft: "Sana’ar hannu",
    enumArtisanGuild: "Kungiyar masu sana’a",
    enumAssessment: "Kimantawa",
    enumAssessmentCreated: "An yi kimantawa",
    dowSun: 'Lahadi',
    dowMon: 'Litinin',
    dowTue: 'Talata',
    dowWed: 'Laraba',
    dowThu: 'Alhamis',
    dowFri: 'Jumma’a',
    dowSat: 'Asabar',
    monthJan: 'Janairu',
    monthFeb: 'Faburairu',
    monthMar: 'Maris',
    monthApr: 'Afirilu',
    monthMay: 'Mayu',
    monthJun: 'Yuni',
    monthJul: 'Yuli',
    monthAug: 'Agusta',
    monthSep: 'Satumba',
    monthOct: 'Oktoba',
    monthNov: 'Nuwamba',
    monthDec: 'Disamba',
    monJan: 'Jan',
    monFeb: 'Fab',
    monMar: 'Mar',
    monApr: 'Afi',
    monMay: 'May',
    monJun: 'Yun',
    monJul: 'Yul',
    monAug: 'Agu',
    monSep: 'Sat',
    monOct: 'Okt',
    monNov: 'Nuw',
    monDec: 'Dis',
    enumAssigned: "An ba wa wani",
    enumTinAssigned: "An bayar",
    enumAttested: "An shaida",
    enumAuditor: "Mai binciken lissafi",
    enumAuthorityLookup: "Binciken hukuma",
    enumAutoRecommendation: "An ba da shawara ta atomatik",
    enumAwarded: "An ba da kyauta",
    enumBag25kg: "Buhu 25kg",
    enumBag50kg: "Buhu 50kg",
    enumBankAccountChange: "Canja asusun banki",
    enumBankChangeApplied: "An canja asusun banki",
    enumBankChangeRefused: "An ki canja asusun banki",
    enumBankChangeRequested: "An nemi canja asusun banki",
    enumBankTransfer: "Tura kudi ta banki",
    enumBankVerified: "An tabbatar da asusun banki",
    enumBase: "Tushe",
    enumBlocked: "An hana",
    enumBoth: "Duka biyu",
    enumBusiness: "Kasuwanci",
    enumBvn: "Lambar Tabbatar da Banki",
    enumCamera: "Kamara",
    enumCancelled: "An soke",
    enumCard: "Katin banki",
    enumCivilServant: "Ma’aikacin gwamnati",
    enumCleared: "An tantance",
    enumClosed: "An rufe",
    enumCollected: "An karba",
    enumCommission: "Kwamishan",
    enumCommissionAdjustment: "Gyara kwamishan",
    enumCommissionPayout: "Fitar da kwamishan",
    enumCommunityLeader: "Shugaban al’umma",
    enumCompleted: "An kammala",
    enumConfirmed: "An tabbatar",
    enumConstruction: "Gine-gine",
    enumCritical: "Mai matukar hatsari",
    enumDaily: "Kullum",
    enumDelivered: "An isar",
    enumDenied: "An hana",
    enumDevice: "Na’ura",
    enumDeviceRegistered: "An yi rajistar na’ura",
    enumDismissed: "An yi watsi da shi",
    enumDisputed: "Ana jayayya",
    enumDocument: "Takarda",
    enumDocumentCapture: "Hoton takarda",
    enumDownload: "Sauke",
    enumDraft: "Daftari",
    enumDriversLicence: "Lasisin tuki",
    enumDuplicate: "Kwafi",
    enumDuplicatePayment: "Biyan kudi sau biyu",
    enumEducation: "Ilimi",
    enumEligibilityGate: "Sharadin cancanta",
    enumEligible: "Ya cancanta",
    enumEmail: "Imel",
    enumEmployer: "Ma’aikaci",
    enumEn: "Turanci",
    enumEntertainmentArts: "Nishadi da fasaha",
    enumExecuted: "An zartar",
    enumExisting: "Ana da shi",
    enumExpired: "Ya kare",
    enumFailed: "Ya gaza",
    enumFailure: "Gazawa",
    enumFarmersCooperative: "Kungiyar manoma",
    enumFederal: "Tarayya",
    enumFemale: "Mace",
    enumFile: "Fayil",
    enumFinanceOfficer: "Jami’in kudi",
    enumFinancialServices: "Ayyukan kudi",
    enumFisheriesGroup: "Kungiyar masunta",
    enumFishing: "Kamun kifi",
    enumFixed: "Adadi kayyadadde",
    enumFoodBeverage: "Abinci da abin sha",
    enumForfeited: "An rasa",
    enumFormula: "Tsari na lissafi",
    enumFortnightly: "Kowane mako biyu",
    enumFound: "An samu",
    enumFull: "Cikakke",
    enumGamingBetting: "Caca",
    enumGateway: "Hanyar biyan kudi",
    enumGatewayWebhook: "Sanarwar hanyar biya",
    enumGovernment: "Gwamnati",
    enumGovernmentApproved: "Gwamnati ta amince",
    enumGovernmentRejected: "Gwamnati ta ki",
    enumHa: "Hausa",
    enumHealthcare: "Kiwon lafiya",
    enumHigh: "Mai yawa",
    enumHotelHospitality: "Otal da masauki",
    enumIctTelecoms: "Fasahar sadarwa da na’ura",
    enumIdentityDocument: "Takardar shaida",
    enumIgnored: "An yi watsi da shi",
    enumInProgress: "Ana ci gaba",
    enumInactive: "Ba ya aiki",
    enumIncorrectAssessment: "Kimantawa mara daidai",
    enumIndividual: "Mutum",
    enumInfoRequested: "An nemi karin bayani",
    enumInformalWorker: "Mai aiki ba bisa ka’ida ba",
    enumInitiated: "An fara",
    enumInvalid: "Ba sahihi ba",
    enumInvited: "An gayyata",
    enumInvoice: "Takardar biya",
    enumInvoiceGenerated: "An fitar da takardar biya",
    enumInvoiced: "An fitar da takardar biya",
    enumIssued: "An bayar",
    enumKilogram: "Kilogiram",
    enumKycCleared: "An tantance shaida",
    enumKycFailed: "Tantance shaida ya gaza",
    enumKycInfoRequired: "Ana bukatar karin shaida",
    enumKycSubmitted: "An tura shaida",
    enumLeft: "Ya bar kungiyar",
    enumLimited: "Hanyar sadarwa mai iyaka",
    enumLinkedExisting: "An hade da bayanin da ake da shi",
    enumLitre: "Lita",
    enumLivestock: "Kiwon dabbobi",
    enumLivestockAssociation: "Kungiyar masu dabbobi",
    enumLocalGovernment: "Karamar hukuma",
    enumLogin: "Shiga",
    enumLow: "Kadan",
    enumMale: "Namiji",
    enumManualCorrection: "Gyara da hannu",
    enumManualEntry: "An shigar da hannu",
    enumManualReview: "Bitar hannu",
    enumManufacturing: "Masana’antu",
    enumMarketAssociation: "Kungiyar kasuwa",
    enumMatched: "Ya dace",
    enumMedium: "Matsakaici",
    enumMerged: "An hade",
    enumMigration: "Canja bayanai",
    enumMining: "Hakar ma’adinai",
    enumMissingPayment: "Babu biyan kudi",
    enumMissingPlatformTransaction: "Babu bayani a dandalin",
    enumMonthly: "Kowane wata",
    enumMotorVehicle: "Motoci",
    enumNin: "Lambar Shaidar Kasa",
    enumNormal: "Na yau da kullum",
    enumNotAttempted: "Ba a gwada ba",
    enumNotFound: "Ba a samu ba",
    enumNotPerformed: "Ba a yi ba",
    enumNotRequested: "Ba a nema ba",
    enumNotStarted: "Ba a fara ba",
    enumOfficer: "Jami’i",
    enumOfficerReview: "Dubawar jami’i",
    enumOffline: "Babu layi",
    enumOnHold: "An dakatar na dan lokaci",
    enumOneOff: "Sau daya",
    enumOnline: "Yana kan layi",
    enumOpen: "A bude",
    enumOpened: "An bude",
    enumOther: "Wani",
    enumOverrideApplied: "An yi amfani da kebewa",
    enumPaid: "An biya",
    enumPartial: "Bangare",
    enumPartiallyPaid: "An biya wani bangare",
    enumPassed: "Ya wuce",
    enumPassport: "Fasfo",
    enumPassportPhotograph: "Hoton fasfo",
    enumPasswordReset: "Sauya kalmar sirri",
    enumPaymentAcknowledgement: "Sanarwar karbar biyan kudi",
    enumPaymentEvidence: "Shaidar biyan kudi",
    enumPaymentInitiated: "An fara biyan kudi",
    enumPaymentIssue: "Matsalar biyan kudi",
    enumPaymentPending: "Ana jiran biyan kudi",
    enumPaymentReversal: "Mayar da biyan kudi",
    enumPaymentSuccessful: "Biyan kudi ya yi nasara",
    enumPaymentVerified: "An tabbatar da biyan kudi",
    enumPending: "Ana jira",
    enumPendingAttestation: "Ana jiran shugaba ya tabbatar",
    enumPendingPayment: "Ana jiran biyan kudi",
    enumPendingSettlement: "Ana jiran biya",
    enumPendingSync: "Ana jiran a tura",
    enumPercentage: "Kaso",
    enumPoll: "Duba hanyar biya",
    enumPortal: "Tashar jami’i",
    enumPos: "POS",
    enumPrivateEmployee: "Ma’aikacin kamfani mai zaman kansa",
    enumProceeded: "An ci gaba",
    enumProcessed: "An sarrafa",
    enumProcessing: "Ana aiwatarwa",
    enumProfessionalServices: "Ayyukan kwararru",
    enumProofOfAddress: "Shaidar adireshi",
    enumProposed: "An gabatar",
    enumPsirsSync: "Bayanan PSIRS",
    enumPublicServant: "Ma’aikacin gwamnati",
    enumPush: "Sanarwar manhaja",
    enumQuarterly: "Kowane wata uku",
    enumQueued: "Yana layi",
    enumRead: "An karanta",
    enumReadyForReview: "A shirye don dubawa",
    enumRealProperty: "Filaye da gine-gine",
    enumReceipt: "Rasit",
    enumReceiptGenerated: "An fitar da rasit",
    enumReceiptIssue: "Matsalar rasit",
    enumReceived: "An karba",
    enumRecognisedProfessional: "Kwararre da aka amince da shi",
    enumReconciled: "An daidaita lissafi",
    enumReconciliation: "Daidaita lissafi",
    enumReconciliationPending: "Ana jiran daidaita lissafi",
    enumReferee: "Mai shaida",
    enumRefereeCleared: "Mai shaida ya tabbatar",
    enumRefereeFailed: "Mai shaida bai tabbatar ba",
    enumRefereeInvited: "An gayyaci mai shaida",
    enumRefereeReplaced: "An maye gurbin mai shaida",
    enumRefereeVerify: "Tabbatar da mai shaida",
    enumRefund: "Mayar da kudi",
    enumRefunded: "An mayar da kudi",
    enumRegistration: "Rajista",
    enumReinstated: "An mayar da shi aiki",
    enumRejected: "An ki",
    enumReligiousLeader: "Shugaban addini",
    enumReligiousNgo: "Kungiyar addini ko agaji",
    enumReplaced: "An maye gurbinsa",
    enumRequested: "An nema",
    enumResolved: "An warware",
    enumResponded: "An amsa",
    enumRetailTrade: "Sayarwa kanana",
    enumRetired: "An janye",
    enumRevenueOfficer: "Jami’in kudaden shiga",
    enumRevenueRateChange: "Canja kudin haraji",
    enumReversal: "Mayarwa",
    enumReversed: "An mayar da shi",
    enumReview: "Dubawa",
    enumReviewed: "An duba",
    enumRevoked: "An janye izini",
    enumRunning: "Yana gudana",
    enumSeedling: "Tsiro",
    enumSelfAssessment: "Kimanta kai",
    enumSelfEmployed: "Mai aikin kansa",
    enumSelfie: "Hoton kanka",
    enumSent: "An aika",
    enumServiceRequest: "Neman hidima",
    enumSettled: "An daidaita",
    enumSettlement: "Biyan kudi",
    enumShare: "Rabawa",
    enumSms: "SMS",
    enumStarted: "An fara",
    enumState: "Jiha",
    enumStepUp: "Karin tabbatarwa",
    enumCitizenStatement: "Bayanin biyayya",
    enumStudentUnemployed: "Dalibi ko marar aikin yi",
    enumSubmitted: "An tura",
    enumSucceeded: "Ya yi nasara",
    enumSuccess: "Nasara",
    enumSuccessful: "Ya yi nasara",
    enumSuperseded: "An maye gurbinsa",
    enumSupervisor: "Shugaba",
    enumSupportingDocument: "Takardar tallafi",
    enumSuspended: "An dakatar",
    enumSynced: "An tura",
    enumSystem: "Tsarin",
    enumTaxpayer: "Mai biyan haraji",
    enumTaxpayerAdjustment: "Gyara bayanin mai biyan haraji",
    enumTaxpayerComplaint: "Korafin mai biyan haraji",
    enumTaxpayerRegistration: "Rajistar mai biyan haraji",
    enumTechnicalIssue: "Matsalar manhaja",
    enumTiered: "Matakai",
    enumTinConfirmation: "Tabbatar da TIN",
    enumTinIssue: "Matsalar TIN",
    enumTractorDay: "Ranar tarakta",
    enumTradersAssociation: "Kungiyar ’yan kasuwa",
    enumTraditionalAuthority: "Sarauta",
    enumTrainingCompleted: "An kammala horo",
    enumTransaction: "Ciniki",
    enumTransportHaulage: "Daukar kaya",
    enumTransportPassenger: "Daukar fasinja",
    enumTransportUnion: "Kungiyar masu sufuri",
    enumUnauthorisedCharge: "Kudin da ba a ba da izini ba",
    enumUnavailable: "Ba ya samuwa",
    enumUnchecked: "Ba a duba ba",
    enumUnderReview: "Ana dubawa",
    enumUnit: "Guda",
    enumUnknown: "Ba a sani ba",
    enumUnpaid: "Ba a biya ba",
    enumUnspecified: "Ba a fada ba",
    enumUnverified: "Ba a tabbatar ba",
    enumUpload: "Tura",
    enumUrgent: "Na gaggawa",
    enumUssd: "USSD",
    enumValid: "Sahihi",
    enumVehicle: "Mota",
    enumVehicleCapture: "Bayanin mota",
    enumVehicleIssue: "Matsalar mota",
    enumVehicleRenewal: "Sabunta takardun mota",
    enumVerificationRequired: "Ana bukatar tabbatarwa",
    enumVerified: "An tabbatar",
    enumVerify: "Tabbatar",
    enumView: "Duba",
    enumVotersCard: "Katin zabe",
    enumWaived: "An yafe",
    enumWebhook: "Sanarwar hanyar biya",
    enumWeekly: "Kowane mako",
    enumWhatsapp: "WhatsApp",
    enumWholesaleTrade: "Sayarwa da yawa",
    pubRefereeIntroOfLga: "{{name}}, na {{lga}}, ya nemi ya zama wakilin karbar haraji da izini. PSIRS na bukatar wanda ya san shi don tabbatar da ko wanene shi da cancantarsa.",
    ofcUaSuspendOrCloseBody: "Dakatarwa ko rufe asusu yana fitar da jami’in daga ko’ina kuma yana hana shi sake shiga. Dakatarwa hutu ne har sai an sami amsa; rufewa shi ne karshen aikin kuma ba a iya warwarewa — sai an bude sabon asusu idan ya dawo.",
    ofcUaCoverNothingBody: "{{name}} ba zai ga wata lambar kudaden shiga ba ko kadan har sai an ba shi yanki.",
    ofcUaChangeAccessFor: "Canja izini — {{name}}",
    ofcUaCurrentlyRole: "A halin yanzu {{role}}.",
    ofcUaAccountFor: "Asusu — {{name}}",
    ofcUaCannotReopenBody: "Ba a taba sake bude asusun da aka rufe ba. Idan {{name}} ya dawo aiki zai bukaci sabon asusu.",
    ofcUaTerritoriesFor: "Yankuna — {{name}}",
    ofcUaRoleAdmin: "Yana gudanar da wakilai, masu amfani da kundin kudaden shiga. Ba zai iya ba da izinin fitar da kudi ba.",
    ofcUaRoleSupervisor: "Yana ba da izinin amincewa kuma yana kula da wakilai a yankinsa.",
    ofcUaRoleRevenueOfficer: "Yana yin rajista da gyara bayanan mai biyan haraji, kuma yana duba amincewa.",
    ofcUaRoleFinanceOfficer: "Yana daidaita biyan kudi kuma yana ba da izinin fitar da kwamishan.",
    ofcUaRoleAuditor: "Yana karanta komai kuma ba ya canja komai.",
    ofcAgRiskFlagFor: "Alamar hadari — {{name}}",
    ofcAlAwardsFor: "Kyautuka — {{name}}",
    ofcAlAwardsIntro: "Wa aka ba kyauta a wannan zagayen, kuma wa ya karba.",
    ofcCfRateHistoryFor: "Tarihin kudin — {{name}}",
    ofcCfChangeRateFor: "Canja kudin — {{name}}",
    ofcCfBeneficiariesFor: "Masu amfana — {{name}}",
    ofcFnRecordSettlementTitle: "Rubuta biyan kudi",
    ofcFnRecordSettlementAction: "Rubuta biya",
    ofcFnRecordPayment: "Rubuta biyan kudi",
    ofcGpRecordDeparture: "Rubuta ficewa",
    ofcGpAwardedNotCollected: "An ba {{n}} masu amfana kyauta amma ba su zo ba. Ko dai rabon bai isa ga mutane ba, ko kuma sunaye ne a jerin da ba su dace da kowa ba — ya kamata a tabbatar da wanne kafin zagaye na gaba.",
    ofcGpMembersFor: "Mambobi — {{name}}",
    ofcGpEnoughForMore: "ya isa ga wasu {{n}}",
    ofcKycFileType: "Wannan fayil na {{type}} ne.",
    ofcLvIntroAll: "Abin da kowane haraji ya shigar, wa aka yi wa rajista karkashinsa, da wa ke baya.",
    ofcLvIntroNoRegister: "Abin da kowane haraji ya shigar, da wa ke baya a kansa.",
    ofcLvChooseOnce: "Zabi rukuni ko abu sau daya kuma kowane sashe a kasa zai amsa a kansa.",
    ofcLvBroughtIn: "Abin da {{levy}} ya shigar",
    ofcLvBehindOn: "Wa ke baya a kan {{levy}}",
    ofcLvRegisteredUnder: "Wa aka yi wa rajista karkashin {{levy}}",
    ofcLvShowingLargest: "Ana nuna manyan bashi {{n}}. Ka tace da rukuni, haraji ko Karamar Hukuma domin ganin sauran — jimillar da ke sama ta kunshi abin da aka lissafa kadai.",
    pubAttestProgress: "(an amsa {{answered}} daga {{total}})",
    ofcRhAdministrationFor: "Gudanarwa — {{name}}",
    ofcRhSignedIn: "wanda ya shiga",
    ofcTrRegisterFor: "Rajistar — {{name}}",
    ofcUsPrivacyBody: "Yadda ake amfani da manhajar, ba wanda ke amfani da ita ba. Wadannan lambobi ba su dauke da shaidar kowa: ba a ambaci sunan wani jami’i, wakili ko mai biyan haraji a cikinsu ba, kuma ana boye kungiyoyi kasa da {{n}} maimakon nuna su, domin kidaya karama tana bayyana mutum ko da ba a ambaci sunansa ba. Domin aikin wakili daya, duba",
    actionSearch: "Nema",
    colReceiptNumbered: "Rasit {{number}}",
    pickNoTaxpayerMatch: "Babu mai biyan haraji da ya dace da wannan binciken. Sai an yi masa rajista kafin a iya danganta biyan kudi da shi.",
    grpNotActiveYet: "Wannan kungiya tana {{status}}. Za a iya rubuta mambobi bayan jami’i ya amince da ita — babu sauran abin yi a nan har sai lokacin.",
    grpLeaderMustConfirm: "{{name}} zai iya budewa a kowace waya. Har sai ya tabbatar, ba a kirga mambobin da ka rubuta ba.",
    moreDraftCaptured: "An dauka {{when}}",
    moreCommissionRateOf: "{{rate}}% na",
    moreBankChangeAsking: "Kana neman PSIRS ta biya kwamishanka cikin wannan asusun: {{destination}}.",
    supYouAt: "Kai · {{when}}",
    stepUpExpiresIn: "Zai kare cikin {{time}}",
    pubRefereeNamedYou: "{{name}} ya sanya ka a matsayin mai shaidarsa",
    ofcTrTitle: "Gyara rikodin mai biyan haraji",
    ofcTrIntro: "Ana rubuta kowane gyara da sunan jami’in da ya yi shi, tare da dalilin, kuma ana tura wa mai biyan haraji sako yana gaya masa an canza rikodinsa. Filayen da ka cika kawai ake canzawa.",
    ofcTrNoMatch: "Babu mai biyan haraji da ya dace da wannan binciken.",
    ofcTrCorrectedDetails: "Bayanan da aka gyara",
    ofcTrLeaveBlank: "Ka bar duk abin da ya riga ya yi daidai babu komai.",
    ofcTrIdentificationDocument: "Takardar shaida",
    ofcTrDecidesWhichPerson: "Wannan yana yanke wanne mutum rikodin ya shafa, don haka ana duba shi da kowane mai biyan haraji mai aiki kafin a karba.",
    ofcTrUnchanged: "Ba a canza ba",
    ofcTrNumber: "Lamba",
    ofcTrNameOrDob: "Ana iya gyara suna ko ranar haihuwa a nan. Takardar da aka rike rikodin a kanta ce ke yanke wanne mutum ya shafa, don haka mai gudanarwa ne ya kamata ya yi wannan canjin.",
    ofcTrWhatAndWhy: "Abin da ake gyarawa, da dalilin",
    ofcTrLiableFor: "Abin da wannan mai biyan haraji ke bin sa",
    ofcTrWaiveBody: "Yafe wajibi yana tsayar da kima na gaba a kansa. Takardun biya da aka riga aka yi suna nan a biya — soke su shawara ce daban, takarda bayan takarda.",
    ofcTrWaive: "Yafe",
    ofcTrVehiclesOnRecord: "Motoci a wannan rikodin",
    ofcTrVehiclesBody: "Ba za a iya sabunta takardun mota da aka dakatar ko da aka cire daga rajistar ba. Sabuntawar da aka riga aka bayar tana nan da inganci na tsawon lokacin da aka biya.",
    ofcTrTakeOffRegister: "Cire daga rajistar",
    ofcTrPutBackInService: "Mayar da aiki",
    ofcTrEndedBody: "Rikodin da aka dakatar ko aka rufe yana daina tara sabbin caji kuma yana daina samun tunatarwa. Ba a share abin da ake bin sa ba: yana nan a biya, yana nan a adadin haraji, kuma yana bayyana a karkashin rikodin da aka rufe da ake bin su har sai an biya.",
    ofcTrWhatHappened: "Me ya faru da wannan mai biyan haraji",
    ofcTrClosedOption: "An rufe — kasuwancin ya rufe ko mutumin ya rasu",
    ofcTrSuspendedOption: "An dakatar — an tsayar ana jiran bincike",
    ofcTrActiveOption: "Yana aiki — a mayar da rikodin cikin rajistar",
    ofcTrHowEstablished: "Yadda aka tabbatar da wannan",
    ofcTrSearchPlaceholder: "Suna, waya, TIN ko lambar rasit",
    ofcTrNeedsAdministrator: "Canza takardar shaida yana bukatar mai gudanarwa",
    ofcTrSampleCorrection: "An rubuta sunan mahaifi ba daidai ba a lokacin rajista; an gyara shi da takardar NIN da aka gabatar a ofis.",
    ofcTrSampleVehicle: "An sayar da ita a wajen jihar kuma an sake yi mata rajista a Kaduna.",
    ofcTrSampleClosure: "An ziyarci wurin a 12 ga Agusta: shagon babu kowa tun gobarar kasuwa a watan Maris.",
    ofcTrRecordedBy: "Wanda ya rubuta",
    ofcFnThreeWay: "Daidaita lissafi ta hanyoyi uku",
    ofcFnThreeWayBody: "Ma’amalar dandali a kan ma’amalar tashar biya a kan turawar gwamnati. Duk abin da bai dace ba yana zama kuskure a kasa.",
    ofcFnRunReconciliation: "Gudanar da daidaita lissafi",
    ofcFnRecoverMissed: "Dawo da tabbatarwar da aka rasa",
    ofcFnRecoverMissedBody: "“Dawo da tabbatarwar da aka rasa” yana sake duba biyan kudin da tashar ta kammala amma dandalin bai taba tabbatarwa ba — yawanci sakon da bai iso ba — kuma yana bayar da rasit din da ake bin sa.",
    ofcFnStatementBody: "Abin da tashar ta biya cikin asusun gwamnati, da karban da ya shafa. Dandalin da kansa yana hada wadannan karban; idan kudin bai dace ba, ana rubuta rukunin a matsayin mai takaddama kuma ba a tura komai daga cikinsa.",
    ofcFnValueDate: "Ranar darajar kudi",
    ofcFnBankReference: "Lambar banki",
    ofcFnCredited: "An shigar (₦)",
    ofcFnGatewayReferences: "Lambobin tashar biya",
    ofcFnAwaitingSettlement: "Ana jiran turawa daga tashar biya",
    ofcFnAwaitingSettlementBody: "Tashar ta tabbatar kuma ba a biya cikin asusun gwamnati ba tukuna. Abu ne na yau da kullum na kwana daya ko biyu; babu wanda ya kamata ya yi wani abu da wadannan. Duk abin da ya wuce kwana uku ya koma jerin kura-kurai a kasa, saboda a lokacin kudin ya kamata ya iso.",
    ofcFnExceptionQueue: "Jerin kura-kurai",
    ofcFnExceptionQueueBody: "Kowane kuskure aikin jami’in kudi ne. Ba a share komai a nan ta atomatik ba. Kudin da har yanzu yake cikin lokacin turawa na tashar yana sama, ba nan ba.",
    ofcFnResolve: "Warware",
    ofcFnSettlements: "Turawa zuwa asusun gwamnati",
    ofcFnCloseDispute: "Rufe takaddama",
    ofcFnDisputeBody: "Turawar da kudinta bai dace da karban da ta shafa ba, ba ta tura ko daya daga cikinsu: kudin bai iso ba, don haka ba a biyan kwamishan a kansa. Rufe takaddamar yana bukatar jami’in kudi na biyu da kudin da ya yi lissafin rukunin gaba daya.",
    ofcFnCommissionPayouts: "Biyan kwamishan",
    ofcFnCommissionBody: "Dandalin ne ke lissafa kwamishan daga harajin gwamnati da aka tabbatar. Ba a taba cire shi daga abin da mai biyan haraji ya biya ba, kuma ba a taba biyan sa a kan ma’amalar da aka juyar ba.",
    ofcFnPromoteEligible: "Daga kwamishan da ya cancanta",
    ofcFnTransferFailed: "Turawa ta gaza",
    ofcFnMakerChecker: "Amincewar mai yi da mai duba",
    ofcFnMakerCheckerBody: "Jami’in da ya daga bukata ba zai taba duba ta ko ba ta izini ba. Juyarwa tana bukatar jami’i na uku ya aiwatar, tare da karin tantancewa.",
    ofcFnApproved: "An amince",
    ofcFnRejected: "An ki",
    ofcFnExecuted: "An aiwatar",
    ofcFnYourRequest: "Bukatarka",
    ofcFnExecuteReversal: "Aiwatar da juyarwa",
    ofcFnNotYourRole: "Adadin turawa ba ya samuwa ga matsayinka",
    ofcFnTotalExpected: "Jimlar da ake tsammani",
    ofcFnTotalReceived: "Jimlar da aka karba",
    ofcFnVariance: "Bambanci",
    ofcFnAsOnStatement: "Kamar yadda yake a takardar banki",
    ofcFnOnePerLine: "Daya a kowane layi, ko a raba da wakafi",
    ofcFnException: "Kuskure",
    ofcFnDate: "Rana",
    ofcFnPayout: "Biya",
    ofcFnEntries: "Shigarwa",
    ofcFnBankAccount: "Asusun banki",
    ofcFnRequestedBy: "Wanda ya nema",
    ofcCfCatalogueIntro: "Nau’ikan haraji da kudinsu saitin gwamnati ne, ba lambar kwamfuta ba. Canza kudi yana samar da sabuwar siga da ranar fara aiki — ba ya taba sake rubuta abin da aka riga aka kima.",
    ofcCfAddRevenueItem: "Kara nau’in haraji",
    ofcCfHistoricalAssessments: "Kimar tarihi tana nan a hade da sigar da ke aiki a lokacin da aka yi su.",
    ofcCfChangeRate: "Canza kudi",
    ofcCfNewRevenueItem: "Sabon nau’in haraji",
    ofcCfCreatedWithoutPrice: "Ana samar da nau’in ba tare da kudi ba. Ka saita kudinsa daga baya da “Canza kudi” — har sai ka yi, wakili ba zai iya kima da shi a filin aiki ba.",
    ofcCfChooseCategory: "Zabi rukuni",
    ofcCfHowOften: "Sau nawa ake caji",
    ofcCfWhatItIsFor: "Don me ne shi",
    ofcCfWhoItApplies: "Wa ya shafa",
    ofcCfSelfAssessable: "Mai biyan haraji zai iya kima wannan da kansa",
    ofcCfCommissionable: "Wakili yana samun kwamishan a kansa",
    ofcCfWhatIsHappening: "Me ke faruwa da wannan nau’in",
    ofcCfSuspendOption: "Dakatar — a tsayar da karba yayin da ake sasanta wani abu",
    ofcCfRetireOption: "Yi ritaya — cajin ya kare, kuma ba za a iya mayar da shi ba",
    ofcCfRetireWarning: "Ba za a iya soke ritaya ba. Idan aka sake kawo cajin daga baya yana bukatar sabon nau’in haraji, da lambarsa da kudinsa.",
    ofcCfCurrentVersionStays: "Sigar yanzu tana nan a rikodi kuma tana ci gaba da shafar kimar da aka riga aka yi.",
    ofcCfRateType: "Nau’in kudi",
    ofcCfFixedAmount: "Adadi tsayayye",
    ofcCfPercentage: "Kaso cikin dari",
    ofcCfNewAmount: "Sabon adadi (₦)",
    ofcCfNewRate: "Sabon kudi (%)",
    ofcCfEffectiveFrom: "Zai fara aiki daga",
    ofcCfReasonForChange: "Dalilin canjin (akalla haruffa 10)",
    ofcCfRate: "Kudi",
    ofcCfChangedBy: "Wanda ya canza",
    ofcCfFrequency: "Yawan lokaci",
    ofcCfCurrentRate: "Kudin yanzu",
    ofcCfOnSale: "A kan sayarwa",
    ofcCfSampleReason: "An amince a karkashin nazarin harajin 2026, rubutun Majalisar Zartaswa 14/2026.",
    ofcCfProgrammesTitle: "Shirye-shiryen tallafin jama’a",
    ofcCfProgrammesIntro: "Shirye-shirye suna rubuta wanda ya cancanci tallafin gwamnati da dalilin haka. Suna kara hakki — ba sa taba janye hidima. Kowane dan kasa mai TIN da ya cika sharuda yana cancanta ta atomatik idan aka duba.",
    ofcCfEssentialServiceLink: "Ana iya samar da shirin da ke hada muhimmiyar hidimar jama’a da biyan haraji ne kawai idan an rubuta ikon doka ko manufa na wannan hadin a kansa.",
    ofcCfBeneficiaries: "Masu amfana",
    ofcCfNoEligibleYet: "Babu masu biyan haraji da suka cancanta tukuna. Ka gudanar da “Duba duka” domin auna masu biyan harajin da ke aiki.",
    ofcCfEssentialProtected: "An kare muhimman hidimomi",
    ofcCfBenefit: "Tallafi",
    ofcCfMinScore: "Mafi karancin maki",
    ofcCfRequiresNoArrears: "Yana bukatar babu bashi",
    ofcCfEligible: "Ya cancanta",
    ofcCfEvaluated: "An duba",
    ofcOvTransactionCount: "Ma’amaloli {{n}}",
    ofcOvSettlementsOutstanding: "Turawar kudi {{n}} da ta rage",
    ofcOvIntact: "Rajistar bincike ba ta lalace ba",
    ofcOvChainIntact: "An tantance shigarwa {{count}}. Ba a sami wata alamar taba ba.",
    ofcOvChainGenesisRemoved:
      "An karye a shigarwa {{sequence}}: shigarwa mafi tsufa tana nuni da wanda ya gabace ta amma ba ya nan, don haka an cire farkon rajistar.",
    ofcOvChainLinkMismatch:
      "An karye a shigarwa {{sequence}}: akwai shigarwa da ta bata, ko kuma an sanya ta ba bisa tsari ba.",
    ofcOvChainContentModified:
      "An karye a shigarwa {{sequence}}: abin da ke cikin shigarwar bai yi daidai da hash da aka ajiye ba, don haka an canza layin bayan an rubuta shi.",
    ofcOvSystem: "Tsarin",
    ofcOvNoRows: "Babu layuka",
    ofcOvLeakageTitle: "Sa ido kan yoyon haraji",
    ofcOvSignalsBody: "Ana daga alamu domin a duba su, ba a taba aiki da su ta atomatik ba. Babu ma’amalar da ake sharewa ko hanawa ta hanyar kiyasi.",
    ofcOvSweepBody: "Sharewar tana sake gudanar da kowane kiyasi a kan bayanan yanzu kuma tana daga abin da ta gano. Tana daga alamu domin mutum ya yanke hukunci kuma ba ta canza wata ma’amala ba, don haka gudanar da ita ba shi da hadari — amma aiki ne na gangan maimakon abin da ke faruwa a shiru, shi ya sa maballi ne.",
    ofcOvAgentsWithFlags: "Wakilan da ke da alamu a bude",
    ofcOvFraudSignals: "Alamun zamba",
    ofcOvUnderReview: "Ana dubawa",
    ofcOvDismissed: "An soke",
    ofcOvConfirm: "Tabbatar",
    ofcOvDismiss: "Soke",
    ofcOvUnattendedWork: "Aikin da babu mai kula",
    ofcOvOpenFlags: "Alamu a bude",
    ofcOvHighestSeverity: "Mafi girman hadari",
    ofcOvAuditTrail: "Rajistar bincike",
    ofcOvChainBody: "An sarkafa kowace shigarwa da wadda ta gabace ta. Gyara ko cire wata shigarwar tarihi yana karya sarkar kuma duban da ke kasa yana gano hakan.",
    ofcOvVerifyChain: "Tantance ingancin sarkar",
    ofcOvStandardQuestions: "Tambayoyin bincike na yau da kullum",
    ofcOvStandardQuestionsBody: "Ana iya amsa su ba tare da bincika teburan aiki kai tsaye ba.",
    ofcOvEntityType: "Nau’in abu",
    ofcOvAction: "Aiki",
    ofcOvFindTheTaxpayer: "Nemo mai biyan haraji",
    ofcOvUnreconciled48h: "Ba a daidaita ba sama da awa 48",
    ofcOvSettlementShortfall: "Karancin turawa",
    ofcOvDuplicatePayments: "Biyan kudi sau biyu",
    ofcOvFailedVerifications: "Tantance rasit da suka gaza",
    ofcOvNoValidReceipt: "Duban jama’a da bai samu rasit mai inganci ba",
    ofcOvEntityPlaceholder: "biyan kudi, wakili, mai biyan haraji…",
    ofcOvActionPlaceholder: "payment.verified",
    ofcOvReversedAfterPayment: "Ma’amalolin da aka juyar bayan biyan kudi ya yi nasara",
    ofcOvAllRateChanges: "Dukkan canje-canjen kudin haraji",
    ofcOvOneAgentCollected: "Duk abin da wakili daya ya karba",
    ofcOvReceiptsOneItem: "Rasit din da aka bayar a karkashin nau’in haraji daya",
    ofcOvWhoLookedAtRecord: "Wa ya duba rikodin mai biyan haraji daya",
    ofcOvJob: "Aiki",
    ofcOvRuns: "Gudanarwa",
    ofcOvLastSucceeded: "Nasara ta karshe",
    ofcOvWhatThatMeans: "Abin da hakan ke nufi",
    ofcOvActor: "Mai aikatawa",
    ofcOvEntity: "Abu",
    ofcOvResult: "Sakamako",
    ofcOvHash: "Sa hannu",
    ofcOvTampered: "An taba rajistar bincike",
    ofcDbShowing: "Ana nuna {{territories}}",
    ofcDbCoversYourTerritory: "Kowane adadi a wannan shafin ya shafi yankinka kadai, ba dukkan jihar ba.",
    ofcDbCoversYourTerritories: "Kowane adadi a wannan shafin ya shafi yankunanka kadai, ba dukkan jihar ba.",
    ofcDbNeedAttention: "Abubuwa {{n}} na bukatar kulawa",
    ofcDbExceptionsAnd: "Kura-kuran daidaita lissafi {{exceptions}} da alamun zamba {{flags}} a bude.",
    ofcDbNewThisMonth: "Sabbi {{n}} wannan watan",
    ofcDbAwaitingReview: "{{n}} na jiran dubawa",
    ofcDbFailedCount: "{{n}} sun gaza",
    ofcRvArea: "Yanki",
    ofcDbNoTerritoryBody: "Wadannan adadi babu komai saboda asusunka bai rufe wani yanki ba tukuna, ba don ba a karbi komai ba. Ka nemi mai gudanarwa ya ba ka naka.",
    ofcDbNoTerritoryTitle: "Ba a ba ka wani yanki ba",
    ofcDbReviewReconciliation: "Duba daidaita lissafi",
    ofcDbReviewFlags: "duba alamu",
    ofcDbCollectionsLast30: "Karba a cikin kwanaki 30 na karshe",
    ofcDbOnlyConfirmed: "Biyan kudin da tashar biyan kudi ta tabbatar kawai ake kirgawa.",
    ofcDbRevenueByLga: "Haraji bisa ga Karamar Hukuma",
    ofcDbBelowPotential: "Yana nuna yankunan da karba ke kasa da abin da ake tsammani.",
    ofcDbRevenueByCategory: "Haraji bisa ga rukuni",
    ofcDbWhichHeads: "Wadanne nau’ikan haraji ne ke bayar da amfani a hakika.",
    ofcDbTopAgents: "Wakilai mafi kyawun aiki",
    ofcDbTopAgentsBody: "An jera bisa karban da aka tabbatar. Ba a nuna bayanan mutum banda suna da lamba a nan ba.",
    ofcDbRevenueByMda: "Haraji bisa ga ma’aikata",
    ofcDbIntelligenceTitle: "Nazarin harajin yankuna",
    ofcDbDrill: "Ka sauka daga Jiha zuwa Karamar Hukuma zuwa Unguwa zuwa Al’umma domin ganin inda ake karbar haraji da inda ba a karba ba.",
    ofcDbPlateauState: "Jihar Filato",
    ofcDbPlatformKpis: "Ma’aunan aikin dandali",
    ofcDbKpisUnreadable: "Ba a iya karanta alkaluman dandalin kansa ba",
    ofcDbKpisUnreadableBody: "Biyan da aka tabbatar, adadin daidaitawa, da adadin da ke jiran daidaitawa ba sa nan a wannan shafi — ba sifili ba ne. Ka sake lodi, kuma ka daga kara idan bai warware ba.",
    ofcDbSinceBegan: "Tun lokacin da dandalin ya fara karba.",
    ofcDbVerifiedOnly: "Harajin da aka tabbatar kawai",
    ofcDbThisMonth: "Wannan watan",
    ofcDbYearToDate: "Daga farkon shekara",
    ofcDbAccruedNotPaid: "An tara amma ba a biya ba tukuna",
    ofcDbRegisteredTaxpayers: "Masu biyan haraji da aka yi wa rajista",
    ofcDbSuccessfulTransactions: "Ma’amalolin da suka yi nasara",
    ofcDbAwaitingReconciliation: "Ana jiran daidaita lissafi",
    ofcDbPaymentsVerified: "Biyan kudin da aka tabbatar",
    ofcDbOfEveryAttempted: "Cikin kowane biyan kudi da aka gwada",
    ofcDbReconciled: "An daidaita",
    ofcDbMatchedAcross: "An dace a dandali, tashar biya da turawa",
    ofcDbReceiptsIssued: "Rasit din da aka bayar",
    ofcDbOfTransactions: "Cikin ma’amalolin da aka kirga a matsayin haraji",
    ofcDbMda: "Ma’aikata",
    ofcRvGroupedByAssessment: "An hada kowane adadi a kasa bisa ga Karamar Hukuma da unguwar da ke kan kimar, wanda abin dogaro ne. Wurin taswira daban ne kuma manhajar wakilai ce ke daukar sa a lokacin karba — babu wanda ya iso tukuna, wanda yawanci yana nufin ba a tura sigar da ke dauke da shi ba, ko wakilai ba su ba da izinin wuri a wayoyinsu ba.",
    ofcRvWhoseRevenue: "Harajin wa ne wannan",
    ofcRvWhoseRevenueBody: "PSIRS na karbar harajin jiha; wannan shi ne bangaren gwamnatin da ake karbar kowace naira dominsa. Ana jera ma’aikatar da babu nau’in haraji maimakon a boye ta — yana nufin ba a karbar komai a madadinta ta wannan dandalin, wanda binciken ne ba rashin komai ba.",
    ofcRvOwedToCouncils: "Ana bin Kananan Hukumomi",
    ofcRvCouncilsBody: "PSIRS na karbar wannan a madadin Kananan Hukumomi, don haka nasu ne ba na Jiha ba. Nau’ikan da Karamar Hukuma ke sanya kudinsu kawai ake kirgawa — harajin Jiha da aka karba a yankin Karamar Hukuma na Jiha ne. Ana jera kowace Karamar Hukuma, hade da wadanda ba su karbi komai ba, saboda turawar kudi dole ta yi lissafin dukkan goma sha bakwai.",
    ofcRvWhereGenerated: "Inda ake samar da harajin",
    ofcRvWhereGeneratedBody: "Bisa ga unguwa, tare da wakilan da ke aiki a kowace. “An sanya a taswira” yana kirga karban da ya rubuta wuri; unguwar da ke samun kudi da kyau ba tare da an sanya ta a taswira ba, ba a taswira take ba, ba abin tuhuma ba.",
    ofcRvEachAgentGround: "Kowane wakili, da yankin da yake rufewa",
    ofcRvGroundBody: "Aikin wakilai yana bayar da rahoton nawa. Wannan yana bayar da rahoton ina — wakili da ke aiki a kasuwa daya da wakili da ke rufe kilomita arba’in na hanya suna aiki daban a kan kwamishan iri daya.",
    ofcRvVerifiedLastYear: "Harajin da aka tabbatar a shekarar da ta gabata",
    ofcRvGeneratingAreas: "Yankunan da ke samarwa",
    ofcRvWardsProduced: "Unguwannin da suka samar da haraji",
    ofcRvArmsNoItem: "Bangarorin gwamnati da babu nau’in haraji",
    ofcRvOwedCouncils: "Ana bin Kananan Hukumomi",
    ofcRvCollectedOnBehalf: "An karba a madadinsu",
    ofcRvPlacedOnMap: "An sanya a taswira",
    ofcRvWithRecordedPoint: "Karban da aka rubuta wurinsa",
    ofcRvNoPointRecorded: "Babu karban da ya rubuta inda ya faru",
    ofcRvMinistryDepartment: "Ma’aikata, Sashe ko Hukuma",
    ofcRvRevenueItems: "Nau’ikan haraji",
    ofcRvShare: "Rabo",
    ofcRvCouncil: "Karamar Hukuma",
    ofcRvAgents: "Wakilai",
    ofcRvMapped: "An sanya a taswira",
    ofcRvTerritory: "Yanki",
    ofcRvLgas: "Kananan Hukumomi",
    ofcRvWards: "Unguwanni",
    ofcRvCentreOfCollection: "Tsakiyar karba",
    ofcOsCleared: "An share",
    ofcOsStillOutstanding: "Har yanzu ya rage",
    ofcUsStartedCount: "An fara {{n}}",
    ofcUsNoAttempts: "Ba a rubuta wani yunkuri ba",
    ofcUsNoAbandonment: "Babu wurin watsarwa da ya kai yunkuri {{n}}.",
    ofcOsReadingNeeds: "Karanta wannan jerin yana bukatar",
    ofcOsNotYours: ", wanda matsayinka bai rike ba. Ba fanko ba ne — ba naka ba ne.",
    ofcOsRefundsOwed: "Mayarwar da ake bin masu biyan haraji",
    ofcOsReversalBody: "Juyarwa tana soke rasit nan take; kudin yana dawowa ne kawai idan tashar ta tabbatar. Har lokacin ba a mayar wa mai biyan haraji ba.",
    ofcOsWaitingTinTitle: "Masu biyan haraji da ke jiran TIN",
    ofcOsWaitingTinBody: "An yi musu rajista yayin da ba a iya samun sashen TIN na PSIRS ba. Za a iya yi musu kima kuma za su iya biya; lambar kadai ce babu.",
    ofcOsRenewalsUnackTitle: "Sabuntawar da hukumar motoci ba ta amince da ita ba",
    ofcOsRenewalsUnackBody: "Sabuntawar da kanta tana da inganci kuma an biya ta. Abin da ya rage shi ne hukumar ta rubuta ta, wanda ke da muhimmanci a karo na farko da aka tsayar da direba.",
    ofcOsVehiclesUncheckedTitle: "Motocin da aka rubuta ba tare da duban hukuma ba",
    ofcOsVehiclesUncheckedBody: "An rubuta daga abin da mai motar ya gabatar saboda ba a iya samun hukumar ba. Ba a tabbatar da bayanan da rajistar ba.",
    ofcOsEndedOwingTitle: "Rikodin da aka rufe da ake bin su",
    ofcOsEndedOwingBody: "An rufe ko an dakatar yayin da ake bin kudi. Ba a share komai ba — tunatarwa ta daina bin wadannan, don haka ana yin su da hannu har sai an biya ko rikodin ya koma rajistar.",
    ofcOsNothingOutstanding: "Babu abin da ya rage",
    ofcOsOwedToTaxpayers: "Ana bin masu biyan haraji",
    ofcOsRefundsNotMade: "Mayarwar da ba a yi ba tukuna",
    ofcOsWaitingForTin: "Ana jiran TIN",
    ofcOsRenewalsUnacknowledged: "Sabuntawar da ba a amince da ita ba",
    ofcOsRefund: "Mayarwa",
    ofcOsAttempts: "Yunkuri",
    ofcOsWhyNotYet: "Dalilin da bai riga ba",
    ofcOsLastTried: "Gwadawa na karshe",
    ofcOsOwedSince: "Ana bin tun",
    ofcOsValidUntil: "Yana aiki har",
    ofcOsState: "Matsayi",
    ofcOsOwed: "Ana bin",
    ofcOsWhyEnded: "Dalilin da ya sa ya kare",
    ofcOsEnded: "Ya kare",
    ofcUaTheirAccess: "Inda ya shiga",
    ofcUaAccessFor: "Inda {{name}} ya shiga",
    ofcUaBackToMine: "Koma ga nawa",
    ofcRhAgentApproved: "An amince da {{name}}.",
    ofcAlRoundQuantity: "{{total}} {{unit}}, {{per}} ga kowanne",
    ofcAlAwardedLeft: "An bayar {{awarded}}, {{left}} ya rage",
    ofcPfWorkedOf: "{{worked}} cikin {{total}}",
    ofcFnSettlementClosed: "An rufe {{reference}}. An daidaita tarin kudi {{n}}.",
    ofcGrGroupSuspended: "An dakatar da {{name}}.",
    ofcGrQuantityPeople: "{{quantity}} (mutane {{n}})",
    supRepliesCount: "amsa {{n}}",
    ofcOsQueueUnreadable: "Ba a iya karanta wani jeri ba",
    ofcOsQueueUnreadableBody: "Ba a iya lodin jeri {{n}} a wannan shafi ba, don haka abin da ake nunawa ba shi ne cikakken hoto ba. Sashe mara komai a kasa ba yana nufin jerin babu komai ba — yana nufin babu wanda ke iya ganin sa. Ka sake lodi, kuma ka daga kara idan bai warware ba.",
    ofcUaCoversNothing: "{{name}} yanzu ba shi da wani yanki kuma ba zai ga lambobin kudaden shiga ba.",
    ofcUaCoversTerritories: "{{name}} yanzu yana rufe yankuna {{n}}.",
    ofcFaMinimumNow: "Mafi karancin sigar yanzu {{version}} ce.",
    ofcFaNoneBelowIt: "Babu wata na’ura mai aiki da ke kasa da ita.",
    ofcFaCannotCollect: "Na’urori {{locked}} cikin {{total}} masu aiki ba za su iya karbar kudi ba sai sun sabunta.",
    ofcTrVehicleBackInService: "An maido da {{plate}} aiki kuma za a iya sabunta takardunta.",
    ofcTrVehicleSuspended: "An dakatar da {{plate}}. Ba za a karbi sabuntawa ba sai an dage dakatarwar.",
    ofcTrVehicleArchived: "An cire {{plate}} daga rajista. Ba za a karbi sabuntawa ba.",
    colPayReceipted: "An tabbatar da biyan kudi. An fitar da rasit {{number}}.",
    colPayAwaitingSettlement: "Tashar ta tabbatar da wannan biyan kudi. Za a fitar da rasit na gwamnati sai kudin ya isa asusun gwamnati.",
    colPayStillPending: "Tashar ba ta ba da amsa ba tukuna. Kada ka sake karbar wannan kudin — ka sake dubawa nan ba da jimawa ba.",
    colPayFailed: "Biyan kudin bai yi nasara ba. Ba a karbi kudi ba kuma ba a fitar da rasit ba.",
    ofcFnPromotedForPayout: "Rikodin kwamishan {{n}} sun cancanci a biya su.",
    ofcCfEvaluatedCount: "An auna ’yan kasa {{n}} bisa wannan shirin.",
    ofcTrObligationsUpdated: "An kara wajibai {{added}}, an yafe {{waived}}.",
    ofcTrOneDetailCorrected: "An gyara bayani daya a wannan rikodin mai biyan haraji. Sauyin yana kan tarihin bincike.",
    ofcTrDetailsCorrected: "An gyara bayanai {{n}} a wannan rikodin mai biyan haraji. Sauyin yana kan tarihin bincike.",
    ofcTrOnRegisterAgain: "{{name}} ya koma kan rajista kuma za a iya yi masa kima.",
    ofcTrRecordEnded: "{{name}} yanzu {{status}} ne. Ba za a iya yin sabuwar kima ba kuma tunatarwa za ta tsaya.",
    ofcTrStillOwedAfterEnding: "Abin da ake bin sa yana nan, kuma wannan rikodin yanzu yana cikin jerin rikodin da aka rufe da ake bin su.",
    ofcTrNothingWasOutstanding: "Babu abin da ya rage.",
    ofcOsRefundsReturned: "An mayar da kudi {{n}} ga masu biyan haraji.",
    ofcOsRefundsPartly: "An mayar {{done}}; {{left}} har yanzu ana bin su. Wadannan masu biyan haraji ba su samu kudinsu ba tukuna.",
    ofcOsTinsAssigned: "An ba da TIN {{n}}.",
    ofcOsTinsPartly: "An ba da {{done}}; {{left}} har yanzu ya rage. Wadannan masu biyan haraji na kan rajista kuma za a iya yi musu kima kuma za su iya biya.",
    ofcOsRenewalsAcked: "Hukumar motoci ta amince da sabuntawa {{n}}.",
    ofcOsRenewalsPartly: "An amince da {{done}}; {{left}} har yanzu ba a iya aikawa ba. Sabuntawar da kansu suna da inganci — ka sake gwadawa daga baya.",
    ofcUsTitle: "Amfani da manhaja — kwanaki 30 na karshe",
    ofcUsReportsCollections: ", wanda ke bayar da rahoton karba.",
    ofcUsIntro: "Manhajar wakilai da wannan shafin suna bayar da rahoton amfani yayin da ake amfani da su. Shafi mara komai a nan yana nufin ba a tura sigar da ke dauke da rahoton ba tukuna, ko babu wanda ya bude daya tun lokacin.",
    ofcUsEveryFlow: "Kowane mataki",
    ofcUsWhereGiveUp: "Inda mutane ke daina",
    ofcUsWhereGiveUpBody: "Matakin karshe da yunkurin da aka watsar ya kai. Wannan shi ne shafin da za a je a duba — rajistar da aka watsar ba ta samar da mai biyan haraji ba, don haka babu wani abu a dandalin da ke rubuta cewa ya faru.",
    ofcUsReachBeyondJos: "Isa bayan Jos",
    ofcUsReachBody: "Ko dandalin yana aiki a Kananan Hukumomin karkara kamar yadda yake a babban birni. Adadin kammalawa mai kyau a fadin jiha amma mara kyau a nan shi ne bambanci tsakanin yi wa talakawa hidima da yi wa Jos hidima.",
    ofcUsOfflineQueue: "Jerin gwanon ba tare da layi ba",
    ofcUsScreensReached: "Shafukan da aka kai",
    ofcUsNothingReported: "Ba a bayar da rahoton komai ba tukuna",
    ofcUsRegistrationsCompleted: "Rajistar da aka kammala",
    ofcUsCollectionsCompleted: "Karban da aka kammala",
    ofcUsMedianRegistration: "Matsakaicin rajista",
    ofcUsStartToFinish: "Daga fara zuwa karshe, a kan na’ura",
    ofcUsMedianCollection: "Matsakaicin karba",
    ofcUsUntilHandedOff: "Har sai an mika biyan kudi",
    ofcUsFlow: "Mataki",
    ofcUsStarted: "An fara",
    ofcUsCompleted: "An kammala",
    ofcUsCompletion: "Kammalawa",
    ofcUsGivenUp: "An daina",
    ofcUsMedianTime: "Matsakaicin lokaci",
    ofcUsLastStepReached: "Matakin karshe da aka kai",
    ofcUsZone: "Yanki",
    ofcUsCount: "Adadi",
    ofcUsMedianDelay: "Matsakaicin jinkiri",
    ofcUsEvents: "Abubuwan da suka faru",
    ofcUsScreen: "Shafi",
    ofcUsViews: "Kallo",
    ofcGpConfirmationLinkFor: "Hanyar tabbatarwa ta {{group}}",
    ofcSpOpenComplaints: "Korafe-korafe {{n}} a bude kan hali ko kudi",
    ofcSpAboutRevenue: "Wadannan rahotanni ne kan yadda aka karbi haraji, ba kan dandalin ba. An jera su a farko a kasa.",
    ofcSpSupportQueue: "Jerin gwanon taimako",
    ofcSpQueueIntro: "An jera bisa muhimmanci. Ana amsa rahoto a cikin zaren sa — canza matsayi kadai ba ya gaya wa wanda ya kai rahoton komai.",
    ofcSpAssigned: "An ba da",
    ofcSpInProgress: "Ana kan aiki",
    ofcSpResolved: "An warware",
    ofcSpClosed: "An rufe",
    ofcSpBackToQueue: "Koma ga jerin gwanon",
    ofcSpNobodyReplied: "Babu wanda ya amsa tukuna.",
    ofcSpReadOnlyNote: "Amsawa da matsar da rahoto suna bukatar support:manage. Za ka iya karanta komai a nan, hade da bayanan cikin gida.",
    ofcSpClosedKeepsHistory: "Rahoton da aka rufe yana rike da tarihinsa. Sabbin matsaloli suna samun sabbin rahotanni.",
    ofcSpKeepInternal: "Ka rike wannan a cikin gida — kada ka nuna wa wanda ya kai rahoton",
    ofcSpMoveTicket: "Matsar da wannan rahoton",
    ofcSpHowResolved: "Yaya aka warware shi?",
    ofcSpResolutionRequired: "Ana bukatar warwarewa kafin a sanya rahoto a matsayin warware, kuma ana nuna ta ga wanda ya kai rahoton.",
    ofcSpMarkResolved: "Sanya a matsayin warware",
    ofcSpResolutionRecorded: "An rubuta warwarewa",
    ofcSpDone: "An gama",
    ofcSpReadAccess: "Kana da izinin karanta wannan rahoton",
    ofcSpTicketClosed: "An rufe wannan rahoton",
    ofcSpTicket: "Rahoto",
    ofcSpSubject: "Batu",
    ofcSpPriority: "Muhimmanci",
    ofcSpReportedBy: "Wanda ya kai rahoto",
    ofcSpReplies: "Amsoshi",
    ofcGpLeaderCodeOnce: "Ka tura wannan ga shugaban kungiyar. Ana nuna shi sau daya — PSIRS na adana sa hannunsa kawai, don haka ba za a iya sake karanta shi ba. Ka nemi wani idan ya bata.",
    ofcGpWaitingDecision: "Ana jiran shawara",
    ofcGpWaitingIntro: "Wakili ya rubuta wadannan kungiyoyi a filin aiki. Ba za a iya kara mambobi ba sai an amince da kungiya, don haka babu abin da ke faruwa yayin da suke nan.",
    ofcGpDistributions: "Rabo",
    ofcGpDistributionsIntro: "Taki, iri da sauran rabon da ke da adadi tsayayye a bayansu. Ka bude daya don ganin wanda aka ba da wanda ya karba a hakika.",
    ofcGpRegisteredGroups: "Kungiyoyin da aka yi wa rajista",
    ofcPhTitle: "Abin da suka riga suka biya",
    ofcPhIntro: "Kowane biyan da ya isa asusun gwamnati, da abin da aka biya shi. Mai biyan haraji da ya tambayi abin da ya biya yana da hakkin samun amsar da zai iya duba ta da rasitunsa.",
    ofcPhFrom: "Daga",
    ofcPhTo: "Zuwa",
    ofcPhPaid: "An biya",
    ofcPhPayments: "Biyayya",
    ofcPhReturned: "An mayar musu",
    ofcPhForWhat: "Abin da aka biya",
    ofcPhLevy: "Haraji ko kudin shiga",
    ofcPhEachPayment: "Kowane biya",
    ofcPhWhen: "Yaushe",
    ofcPhPeriod: "Lokaci",
    ofcPhAmount: "Adadi",
    ofcPhReceipt: "Rasit",
    ofcPhNothingPaid: "Ba a biya komai a wannan lokacin ba.",
    ofcGpTaxRole: "Rawar da take takawa a kidaya",
    ofcGpTaxRoleNone: "Babu rawar da take takawa",
    ofcGpTaxRoleNeedsReason: "Ka rubuta dalili tukuna. Ba shugaba iko a kan abin da za a kimanta wa dan kungiya ana ajiye shi a rubuce.",
    ofcGpGroupsIntro: "Kungiyoyin hadin kai, kungiyoyin kasuwa da kungiyoyin sana’a. Adadin mambobi shi ne wanda aka tabbatar kawai — abin da wakili ya rubuta amma shugaba bai tabbatar ba tukuna ba ya kirguwa a komai.",
    ofcGpMembersIntro: "Mambobin da aka tabbatar kawai ne ke kirguwa ga rabo da shirye-shiryen kungiya. Wanda ya fita yana nan a jerin: mamba ne a lokacin da aka ba shi abin da ya riga ya karba.",
    ofcGpMembershipEnded: "Dalilin da ya sa mamba ta kare",
    ofcGpMembers: "Mambobi",
    ofcGpAskLeader: "Tambayi shugaba",
    ofcGpTotal: "Jimla",
    ofcGpAwarded: "An ba da",
    ofcGpRemaining: "Da ya rage",
    ofcGpSampleNote: "An duba shi da rajistar kungiyoyin hadin kai ta ma’aikatar.",
    ofcGpSampleEnded: "Ya matsar da shagonsa zuwa kasuwar Bukuru kuma ya bar kungiyar.",
    ofcGpMostNotCollected: "Ba a karbi mafi yawan wannan zagayen ba",
    ofcGpNote: "Bayani",
    ofcGpSector: "Bangare",
    ofcGpConfirmedMembers: "Mambobin da aka tabbatar",
    ofcGpScoreAtAward: "Maki a lokacin bayarwa",
    ofcLvTitle: "Haraji da rukunonin haraji",
    ofcLvTaxCategory: "Rukunin haraji",
    ofcLvAllCategories: "Dukkan rukunoni",
    ofcLvLevyOrItem: "Haraji ko nau’in haraji",
    ofcLvAllItems: "Dukkan nau’ika",
    ofcLvCollectedFrom: "An karba daga",
    ofcLvCollectedTo: "An karba zuwa",
    ofcLvByIndividualLevy: "Bisa ga kowane haraji",
    ofcLvOnlyUnpaid: "Wadanda kawai suke da abin da ba a biya ba",
    ofcLvChooseFilter: "Ka zabi rukuni, haraji, Karamar Hukuma, ko “wadanda kawai suke da abin da ba a biya ba” domin jera masu biyan harajin da ya shafa.",
    ofcLvSettledToState: "An tura wa Jiha",
    ofcLvAwaitingSettlement: "Ana jiran turawa",
    ofcLvTaxpayersInArrears: "Masu biyan haraji da ke bin bashi",
    ofcLvTotalOutstanding: "Jimlar da ta rage",
    ofcLvCollections: "Karba",
    ofcLvSettled: "An tura",
    ofcLvLevy: "Haraji",
    ofcLvInvoices: "Takardun biya",
    ofcLvOldestDue: "Mafi tsufa da ya kamata a biya",
    ofcNavArrears: "Jerin bashin da ake bin jiha",
    ofcArTitle: "Wanda ke bin jiha bashi",
    enumAssessed: "An kimanta",
    ofcEnRecorded: "Abin da aka rubuta",
    ofcEnRecordedIntro: "Abubuwan da aka lura da su daga fili da abin da ya faru da kowanne. Ba za a iya kimanta abin da kungiya ta ki amincewa da shi ba sai wani ya sake dawowa ya duba.",
    ofcEnAttestation: "Tabbatarwa",
    ofcEnNotYetAssessed: "Ba a kimanta ba tukuna",
    ofcEnExempt: "An kebe",
    ofcEnAction: "Na gaba",
    ofcEnSettleFirst: "Ana takaddama — a fara warwarewa",
    ofcEnLeaderAgrees: "Shugaba ya tabbatar",
    ofcEnAssess: "Kimanta",
    ofcEnAlreadyObjected: "Ana kalubalanta",
    ofcEnRecordObjection: "Rubuta kalubale",
    ofcEnAttestedByName: "Sunan shugaban da ke tabbatarwa",
    ofcEnStatementFirst: "Ka fara rubuta abin da mai biyan haraji ya ce.",
    ofcEnNothingRecorded: "Ba a rubuta komai ba tukuna.",
    enumFactsWrong: "Bayanan ba daidai ba",
    enumHasRecords: "Yana da rikodi na gaskiya",
    enumNotTrading: "Ba ya kasuwanci kuma",
    enumEnumeration: "Kidaya kadai",
    enumBusinessObservation: "An rubuta kasuwanci",
    enumAttestation: "Kidaya da tabbatarwa",
    enumObjected: "Ana kalubalanta",
    enumUpheld: "An amince",
    enumAgreed: "Shugaba ya amince",
    enumDisagreed: "Shugaba bai amince ba",
    enumNotSought: "Ba a nemi tabbatarwa ba",
    ofcNavEnumeration: "Jerin aikin kidayar",
    ofcEnTitle: "Abin da kidayar ta bar wa mutum ya yanke",
    ofcEnIntro: "Jeri biyu. Inda wakili da shugaban kungiya suka bayyana mai sana’a daban, da kuma inda mai biyan haraji ya ki amincewa da kiyasi a hukumance. Duka biyu shawarwari ne da bai kamata na’ura ta yanke ba.",
    ofcEnDisagreements: "Inda bayanan suka bambanta",
    ofcEnDisagreementsIntro: "Wakili ya rubuta abu daya shugaban kungiya kuma ya rubuta wani. An nuna bayanan biyu, tare da matakin da kowanne zai haifar — bambancin da bai canza mataki ba kiran waya ne, wanda ya canza kuwa ziyara ce.",
    ofcEnGroup: "Kungiya",
    ofcEnAgentSaw: "Wakili ya rubuta",
    ofcEnLeaderSays: "Shugaba ya ki amincewa",
    ofcEnBandGap: "Tasiri a kan mataki",
    ofcEnSameBand: "Mataki daya ko ta yaya",
    ofcEnObservedOn: "An rubuta a",
    ofcEnAttestedBy: "Wanda ya tabbatar",
    ofcEnNoDisagreements: "Babu bayanin da ake takaddama a kai.",
    ofcEnObjections: "Kiyasin da ake kalubalanta",
    ofcEnOpenObjections: "Kalubalen da ba a warware ba",
    ofcEnUnderObjection: "Harajin da ake kalubalanta",
    ofcEnWhileOpenTitle: "Yayin da ake kalubalanta",
    ofcEnWhileOpen: "Ba a bin bashin. An cire shi daga jerin bashin da ake bi har sai an yanke shawara, don haka ba za a kira kowa a kansa ba a wannan lokacin.",
    ofcEnDecisionReason: "Me ya sa kake yanke haka?",
    ofcEnDecisionReasonHint: "Za a nuna wa mai biyan haraji wannan.",
    ofcEnGround: "Dalili",
    ofcEnWhatTheySay: "Abin da mai biyan haraji ya ce",
    ofcEnRaisedOn: "An gabatar a",
    ofcEnDecision: "Shawara",
    ofcEnYoursToPassOn: "Kai ka yi wannan kimantawa — wani jami’i ne zai yanke",
    ofcEnUphold: "Amince da kalubalen",
    ofcEnReject: "Ki kalubalen",
    ofcEnReasonFirst: "Ka fara rubuta dalili.",
    ofcEnNoObjections: "Babu kiyasin da ake kalubalanta.",
    ofcPsPublish: "Wallafawa",
    ofcPsPublishClass: "Wallafa matakin karamar hukuma",
    ofcPsPublishFigure: "Wallafa adadin jadawali",
    ofcPsChoose: "Zaba",
    ofcPsIndicators: "Alamomin da suka haifar da wannan mataki",
    ofcPsIndicatorsHint: "misali hanya, wutar lantarki, adadin talauci",
    ofcPsClassPublished: "An wallafa rarrabuwar.",
    ofcPsFigurePublished: "An wallafa adadin.",
    ofcPsAssumedTurnoverNaira: "Kudin shigar shekara da ake zato (₦)",
    ofcPsAdoptExemption: "Amince da fassarar kebewa",
    ofcPsAdoptWarningTitle: "Wannan yana yanke wanda za a biya haraji",
    ofcPsAdoptWarning: "Amince da fassara yana yanke ko an kebe mai shago, wanda ke canza adadin mutanen da abin ya shafa sosai. Ka rubuta shi ne kawai bisa ra’ayin da aka rubuta, kuma ka ambaci wannan ra’ayin a kasa — mutum na farko da bai yarda ba zai maido da shi ga PSIRS.",
    ofcPsConstruction: "Wace fassara",
    ofcPsCeiling: "Iyakar kudin shiga (₦)",
    ofcPsLegalBasis: "Ra’ayi ko dokar da aka dogara a kai",
    ofcPsExemptionAdopted: "An rubuta fassarar.",
    enumSmall: "Karami",
    enumNano: "Nano — an kebe",
    enumPresumptive: "Kimantawa — bisa jadawali",
    enumBooks: "Littattafai — bisa rikodin",
    enumClassA: "Mataki A — tattalin arziki mafi karfi",
    enumClassB: "Mataki B",
    enumClassC: "Mataki C",
    enumClassD: "Mataki D — tattalin arziki mafi rauni",
    enumMicro: "Karami sosai",
    enumConjunctive: "Dukkan sharudda uku tare",
    enumTurnoverGoverned: "Kudin shiga kadai ke yanke hukunci",
    enumNone: "Babu wurin dindindin",
    enumStall: "Rumfa ko tebur a kasuwa",
    enumKiosk: "Kanti ko kwantena",
    enumLockUpShop: "Shago mai kulle",
    enumBuilding: "Gini ko fili",
    ofcNavPresumptive: "Jadawalin haraji na kimantawa",
    ofcPsTitle: "Jadawalin haraji na kimantawa",
    ofcPsIntro: "Abin da ake ganin sana’a mai wani girma take samu, bisa matakin karamar hukuma. Adadin haraji kashi daya ne a ko’ina — abin da ya bambanta shi ne kudin shigar da ake zato, domin hakika samu ya fi kankanta a wasu wurare. Babu wanda ke bayar da ragi kuma babu jami’in da ke yanke shawara.",
    ofcPsReadiness: "Ko ana iya amfani da shi tukuna",
    ofcPsLgasClassified: "Kananan hukumomin da aka rarraba",
    ofcPsCells: "Adadin da aka wallafa",
    ofcPsExemptionInForce: "Kebewar kamar yadda aka amince da ita",
    ofcPsConjunctive: "Dole ne dukkan sharudda uku su cika: babu wurin kasuwanci na dindindin, babu ma’aikata, kuma kudin shiga bai wuce iyaka ba. Don haka ana kimanta mai shago ko da kudin shigarsa kadan ne.",
    ofcPsTurnoverGoverned: "Kudin shiga kadai ke yanke hukunci: duk wanda bai wuce iyaka ba an kebe shi, ko yana da shago ko ma’aikata ko babu.",
    ofcPsNoExemptionAdopted: "Ba a amince da wata fassarar kebewa ba",
    ofcPsNoExemptionExplained: "Ba za a iya kimanta kowa ba har sai PSIRS ta rubuta wace fassarar kebewar nano ce ta shafi, kuma bisa ra’ayin wa aka rubuta. Fassarorin biyu sun bambanta kan ko an kebe mai shago, kuma wannan ba tambaya ce da wannan tsarin zai amsa da kansa ba.",
    ofcPsPartlyPublished: "An wallafa jadawalin bangare kadai",
    ofcPsPartlyPublishedExplained: "Kananan hukumomi {{done}} daga {{total}} ne ke da matakin da aka wallafa. Ba za a iya kimanta wadanda ke sauran ba, kuma ambaton adadi daga wannan jadawalin gare su zai zama ambaton abin da bai shafe su ba.",
    ofcPsWhatItWouldCost: "Abin da wata sana’a za ta biya",
    ofcPsCheckIntro: "Ka shigar da abin da wakili zai gani yana tsaye a bakin kofa. Babu wurin shigar da kudin shiga ko mataki — ana lissafa su daga abin da aka gani, wanda shi ne ke hana a yi ciniki a kan adadin.",
    ofcPsPremises: "Wurin sana’a",
    ofcPsEquipment: "Injuna ko kayan aiki",
    ofcPsPeople: "Mutanen da ke aiki ban da mai sana’a",
    ofcPsWorkItOut: "Yi lissafi",
    ofcPsBand: "Matakin girma",
    ofcPsClass: "Mataki",
    ofcPsAssumedTurnover: "Kudin shigar shekara da ake zato",
    ofcPsAllAdoptedUnder: 'An amince da kowace lamba a kasa a karkashin',
    ofcPsAnnualTax: "Harajin shekara",
    ofcPsMonthlyTax: "Harajin wata",
    ofcPsExempt: "An kebe — babu abin biya",
    ofcPsExemptExplained: "Wannan mai sana’a kanana ne bisa fassarar kebewar da ke aiki, don haka babu wani harajin kimantawa da ya kamata. Wannan doka ce ke aiki, ba adadi ne da ya fito kankani ba.",
    ofcPsHowWeGotThere: "Yadda aka kai ga wannan adadin",
    ofcPsStep: "Mataki",
    ofcPsDetail: "Abin da aka yi amfani da shi",
    ofcPsAmount: "Adadi",
    ofcPsNoWorking: "Babu lissafin da za a nuna.",
    ofcPsClasses: "Yadda aka rarraba kowace karamar hukuma",
    ofcPsClassesIntro: "An rarraba bisa bayanan da PSIRS ba ta samar ba, kuma an daidaita shi na shekara uku. Duka biyu da gangan ne: mataki da aka samo daga kudin da yankin ya tara zai sa a rage tarawa, kuma wanda za a iya canzawa badi zai jawo matsin lamba.",
    ofcPsIndexSource: "Bayanan wa",
    ofcPsFrom: "Daga",
    ofcPsUntil: "Har zuwa",
    ofcPsNoEndDate: "Ba a saita ranar karshe ba",
    ofcPsNoClasses: "Babu karamar hukumar da ke da matakin da aka wallafa tukuna.",
    ofcPsTheTable: "Adadin da aka wallafa",
    ofcPsInstrument: "An amince da shi karkashin",
    ofcPsVersion: "Sigar",
    ofcPsNoEntries: "Ba a wallafa wani adadi ba tukuna.",
    ofcPsHowToChange: "Ba a taba gyara adadin da aka wallafa. Wallafa sabo yana rufe tsohon lokaci ya fara sabuwar siga, don haka ana iya duba kimantawar bara bisa adadin da aka yi ta a kansa.",
    enumFiled: "An kai",
    ofcPrWithdraw: "Janye",
    ofcPrWithdrawReason: "Me ya sa ake janye wannan rahoto?",
    ofcPrWithdrawFirst: "Ka fara rubuta dalili.",
    ofcNavPayroll: "Masu daukar ma’aikata da wurare",
    ofcPrTitle: "Masu daukar ma’aikata da ya kamata su kai rahoto",
    ofcPrIntro: "Makarantu, asibitoci, otal-otal da wuraren jigilar kaya da ke cikin rajista amma ba su kai rahoton PAYE ba. Mai daukar ma’aikata 40 ya fi ziyarar kasuwa dari daraja, kuma wannan jerin bai bukaci aikin fili ba — an gina shi daga abin da rajista ta riga ta rubuta.",
    ofcPrWhichList: "Wanne jeri",
    ofcPrListPaye: "Masu daukar ma’aikata da ba su kai rahoton PAYE ba",
    ofcPrListConsumption: "Wuraren baki da ba su biya harajin amfani ba",
    ofcPrNotFiling: "Ba sa kai rahoto",
    ofcPrFiling: "Suna kai rahoto",
    ofcPrSector: "Bangare",
    ofcPrNature: "Irin kasuwanci",
    ofcPrOpen: "Bude",
    ofcPrNoneNotFiling: "Kowane mai daukar ma’aikata a wadannan bangarori ya kai rahoto.",
    ofcPrNoneNotPaying: "Kowane wurin baki a nan ya biya harajin amfani a wannan shekara.",
    ofcPrFiledBefore: "Rahotannin da aka riga aka kai",
    ofcPrPeriod: "Wata",
    ofcPrEmployees: "Ma’aikata",
    ofcPrGross: "Jimlar albashi",
    ofcPrTax: "Harajin da ya kamata",
    ofcPrFiledOn: "An kai a",
    ofcPrWithdrawnBecause: "An janye saboda",
    ofcPrNeverFiled: "Wannan mai daukar ma’aikata bai taba kai rahoto ba.",
    ofcPrFileAReturn: "Kai rahoto",
    ofcPrHowTheTaxIsWorkedOut: "Yadda ake lissafin haraji",
    ofcPrHowExplained: "Ka shigar da abin da aka biya kowane mutum a wannan wata. Tsarin zai lissafa harajin kowannensu daban, ta amfani da matakan shekara, sannan ya hada su. Babu wurin shigar da haraji domin haraji ba abin da kowa ke rubutawa ba ne.",
    ofcPrYear: "Shekara",
    ofcPrMonth: "Lambar wata",
    ofcPrEmployeeName: "Sunan ma’aikaci",
    ofcPrMonthlyPay: "An biya wannan wata (₦)",
    ofcPrAddEmployee: "Kara wani ma’aikaci",
    ofcPrSubmit: "Kai wannan rahoto (ma’aikata {{n}})",
    ofcPrFiledTitle: "An kai rahoto",
    ofcPrFiledExplained: "Rahoton ya shafi ma’aikata {{n}} kuma an fitar da daftari {{invoice}} na haraji.",
    ofcPrMissingTins: "{{n}} daga cikinsu ba su da TIN — ka tattara su ka kara su a rahoto na gaba.",
    ofcIgReasonLabel: "Me ya sa kake canza wannan ikirari?",
    ofcIgReasonFirst: "Ka fara rubuta dalili.",
    ofcNavConnections: "Dukiya da alamu",
    ofcIgTitle: "Abin da ke da alaka da mai biyan haraji",
    ofcIgIntro: "Mutanen da ke tafiyar da motocin kasuwanci wadanda jiha ba ta taba kimanta harajin kudin shiga a kansu ba, daga rajistar motoci da PSIRS ke rike da ita. Babu abin da ya fito daga wajen tsarin.",
    ofcIgLimitsTitle: "Menene wannan jerin, kuma menene ba shi ba",
    ofcIgLimits: "Kowane layi ikirari ne, ba binciken karshe ba. Ka karanta ginshikin dalili kafin ka yi aiki: daidaituwa ta lambar waya daya dalili ne na tambaya, ba na kimantawa ba. Ana rubuta bude rikodi a kan mutumin tare da dalilin da ka zaba.",
    ofcIgAtLeastVehicles: "Da akalla motoci masu yawa haka",
    ofcIgRebuildLabel: "Daga rajista",
    ofcIgRebuildAction: "Sake gina alakoki",
    ofcIgRebuilt: "An rubuta alaka {{asserted}}: {{registry}} daga rajista, {{phone}} sun dace ta lambar waya daya. Motoci {{ambiguous}} sun dace da fiye da mai biyan haraji daya kuma an bar su.",
    ofcIgLeads: "Mutanen da za a duba",
    ofcIgVehicles: "Motocin kasuwanci",
    ofcIgUnmatched: "Motocin da ba a gano mai su ba",
    ofcIgUnmatchedExplained: "Motoci {{n}} a rajista ba su da alaka da kowa, don haka ba sa cikin kidayar da ke sama. Wannan shi ne bangaren matsalar da wannan jerin ba zai iya gani ba.",
    ofcIgPurpose: "Me ya sa kake bude wannan rikodin?",
    ofcIgPurposeChoose: "Zabi dalili",
    ofcIgPurposeFirst: "Ka fara zabar dalili — ana rubuta kowace karatun rikodi da dalili.",
    ofcIgRegistrations: "Lambobin rajista",
    ofcIgGrounds: "Dalili",
    ofcIgFromRegister: "Rajista ta ambace su",
    ofcIgFromPhone: "An dace ta lambar waya daya",
    ofcIgChargedCommercial: "An caje kudin kasuwanci",
    ofcIgPaidLastYear: "An biya a shekarar da ta gabata",
    ofcIgOpen: "Bude rikodi",
    ofcIgNoLeads: "Babu wanda ke da motar kasuwanci kuma ba a kimanta harajin kudin shiga a kansa ba a wannan yanki.",
    ofcIgRecordTitle: "Rikodin",
    ofcIgWhatWeClaim: "Abin da jiha ke ikirari a kansu",
    ofcIgWhatTheyOwe: "Abin da suke bin bashi",
    ofcIgThing: "Abu",
    ofcIgRelationship: "Alaka",
    ofcIgSource: "Inda ya fito",
    ofcIgObtained: "An rubuta a",
    ofcIgLawfulBasis: "Ikon da aka dogara a kai",
    ofcIgDecide: "Shawara",
    ofcIgConfirm: "Mai biyan haraji ya tabbatar",
    ofcIgDispute: "Mai biyan haraji ya ki amincewa",
    ofcIgWithdraw: "Janye ikirari",
    ofcIgReasonPrompt: "Ka fadi dalili. Wannan rikodi ne game da mutum, kuma canjin da babu wanda ya bayyana ba za a iya kare shi a gaban sa ba.",
    ofcIgNothingClaimed: "Jiha ba ta ikirari komai a kan wannan mutumin.",
    ofcIgReference: "Lamba",
    ofcIgSince: "Tun",
    ofcIgPayableNow: "Ana iya biya yanzu",
    ofcIgPayableYes: "Eh",
    ofcIgPayableNeedsReassessment: "A’a — yana bukatar sabon kimantawa",
    ofcIgOwesNothing: "Ba sa bin jiha komai.",
    enumAsserted: "An yi ikirari",
    enumConfirmedByTaxpayer: "Mai biyan haraji ya tabbatar",
    enumConsistencyCheck: "Duba kimantawa da dukiya",
    enumCoverageLead: "Neman wadanda ba a kimanta ba tukuna",
    enumTaxpayerRequest: "Mai biyan haraji ya nemi ganin sa",
    enumWithdrawn: "An janye",
    ofcArIntro: "An kimanta, ba a biya ba, kuma har yanzu ana iya biya, mafi girman bashi da farko. Wadannan masu biyan haraji suna cikin rajista — wannan kudi ne da ake bin jiha yau, ba kudin da za ta fita nema ba.",
    ofcArAtLeast: "Yana bin akalla (₦)",
    ofcArLapsingWithin: "Ranar karshe na zuwa cikin",
    ofcArAnyDeadline: "Kowace ranar karshe",
    ofcArWithin7: "Kwana 7",
    ofcArWithin14: "Kwana 14",
    ofcArWithin30: "Kwana 30",
    ofcArCollectableNow: "Ana iya karba yanzu",
    ofcArTaxpayers: "Masu biyan haraji da ke bin bashi",
    ofcArNeedsReassessment: "Yana bukatar sake kimantawa",
    ofcArEndedElsewhere: "Bashin rikodin da aka rufe",
    ofcArWhoIsMissing: "Wanda ba ya cikin wannan jerin",
    ofcArInFlightExplained: "An bar duk wanda ke tsakiyar biya, don haka ana iya aiki da wannan jerin kamar yadda yake: an cire daftari {{n}} saboda ana biya a kansu yanzu. Ba za a kira wanda ke rike da rasit ba.",
    ofcArLapsedTitle: "Bashin da ba a iya biya kamar yadda yake",
    ofcArLapsedExplained: "Daftari {{n}} sun wuce ranar karshen biya. Tsarin zai ki karbar kudi a kansu, don haka an kidaya su a sama amma ba a sa su cikin jerin kira ba — karba yana nufin fara sabon kimantawa.",
    ofcArWhoToCall: "Wanda za a kira",
    ofcArShowingLargest: "Ana nuna manyan bashi {{n}}. Ka rage ta LGA ko adadi domin ganin kasa.",
    ofcArOwedFor: "Bashin",
    ofcArDaysLeft: "Kwanakin da suka rage a biya",
    ofcArNoDeadline: "Babu ranar karshe",
    ofcArLastPaid: "Biya na karshe",
    ofcArNeverPaid: "Bai taba ba",
    ofcArPartPaid: "An biya wani sashe",
    ofcArNobodyOwes: "Babu wanda ke bin bashin da ake iya karba a wannan yanki.",
    ofcAlIntro: "Shiri yana yanke wanda ya cancanta; zagaye kuwa rabo daya ne na hakika. Ana tara bayarwa ne kawai yayin da zagayen yake a bude, wannan ne ke hana shiri raba a takarda abin da babu shi a wurin karba.",
    ofcAlNewRound: "Sabon zagaye",
    ofcAlProgramme: "Shiri",
    ofcAlSelectProgramme: "Zabi shiri",
    ofcAlNoProgramme: "Babu shirin da ke nan tukuna. Dole a kirkiri daya a karkashin Tallafin jama’a kafin zagaye ya iya rabawa a karkashinsa.",
    ofcAlRoundName: "Sunan wannan zagayen",
    ofcAlMeasuredIn: "Ana aunawa da",
    ofcAlTotalToDistribute: "Jimlar da za a raba",
    ofcAlEachReceives: "Kowane mai amfana zai karba",
    ofcAlEnoughFor: "Ya isa ga",
    ofcAlBeneficiariesWord: "masu amfana.",
    ofcAlCollectionPoint: "Wurin karba",
    ofcAlOpens: "Zai bude",
    ofcAlClosesOptional: "Zai rufe (ba dole ba)",
    ofcAlRelease: "Saki",
    ofcAlAwards: "Bayarwa",
    ofcAlSampleRound: "Takin damina, Jos ta Arewa",
    ofcAlSamplePoint: "Shagon Kasuwar Terminus, Jos ta Arewa",
    ofcAlBeneficiary: "Mai amfana",
    ofcAlQuantity: "Yawa",
    ofcAlRound: "Zagaye",
    ofcAlDistributing: "Ana rabawa",
    ofcFaEveryHandsetCan: "Kowace waya na iya karba.",
    ofcFaSomeCannotCollect: "Wadannan wakilai ba za su iya karba ba sai sun sabunta.",
    ofcKycNotReviewed: "Takardu {{n}} ba a duba ba tukuna",
    ofcKycAlready: "An riga an {{status}}",
    ofcKycIdentityDocuments: "Takardun shaida",
    ofcKycIntro: "Abin da mai nema ya tura. Ana rubuta budewa da sunanka.",
    ofcKycNoDocuments: "Wannan mai nema bai tura wata takarda ba.",
    ofcKycApprovingBlind: "Amincewa da wannan mai nema ba tare da bude su ba yana nufin duban shaidar ya dogara ne kawai a kan amsar na’urar mai bayarwa.",
    ofcKycClose: "Rufe",
    ofcKycOpenNewTab: "Bude shi a sabon shafi",
    ofcKycChecksum: "Lambar tantancewa",
    ofcKycSuperseded: "An tura sabon hoton wannan takardar. Ka duba wancan maimakon haka.",
    ofcKycWhyRequired: "Me ya sa? Ana bukatarsa ko ta yaya, kuma ana nuna wa mai nema idan an ki",
    ofcKycAccept: "Amince",
    ofcKycNeedsPermission: "Yanke shawara kan takarda yana bukatar agent:approve.",
    ofcKycWhoLooked: "Wa ya duba wannan?",
    ofcKycSupersededLabel: "An maye gurbinsa",
    ofcKycDocument: "Takarda",
    ofcKycCaptured: "An dauka",
    ofcKycSize: "Girma",
    ofcKycReviewed: "An duba",
    ofcKycWho: "Wa",
    ofcKycWhat: "Me",
    ofcFaIntro: "Wayar da ke kasa da mafi karancin siga ba za ta iya fara biyan kudi ko sabunta mota ba. Ana ki ta kafin kudi ya motsa, kuma ana gaya wa wakilin ya sabunta. Ka daga mafi karanci idan wani saki yana kuskure a filin aiki; duk wakilin da ke kan wannan sigar zai daina karba nan take idan aka buga shi.",
    ofcFaHandsetsInField: "Wayoyi a filin aiki",
    ofcFaPublishNewMinimum: "Buga sabon mafi karanci",
    ofcFaAppendsRecord: "Wannan yana kara a rikodi maimakon maye gurbinsa, don haka abin da aka bukata a lokacin — da wanda ya yanke shawara — yana nan a karanta. Ba za a iya gyara shi daga baya ba.",
    ofcFaMinimumVersion: "Mafi karancin siga",
    ofcFaRecommendedVersion: "Sigar da aka ba da shawara",
    ofcFaRecommendedHint: "Abin da ake nema wakili ya sabunta zuwa gare shi. Ba zai iya zama kasa da mafi karanci ba.",
    ofcFaWhyMoving: "Dalilin da ya sa mafi karanci ke motsi",
    ofcFaTakesEffectOptional: "Zai fara aiki (ba dole ba)",
    ofcFaTakesEffectHint: "Ka bar shi babu komai domin ya fara aiki nan take. Ranar da ke gaba tana sanar da canjin ba tare da tilasta shi ba tukuna; ranar da ta yi daidai ko ta gabaci sigar da ke aiki yanzu ana ki ta, saboda kofar ba za ta taba karanta ta ba.",
    ofcFaHistory: "Abin da aka bukata, da yaushe",
    ofcFaMinimumInForce: "Mafi karancin siga da ke aiki",
    ofcFaRecommended: "An ba da shawara",
    ofcFaActiveHandsets: "Wayoyin da ke aiki",
    ofcFaBelowMinimum: "Kasa da mafi karanci yanzu",
    ofcFaSampleReason: "Sigar 1.3.2 tana rage kudin hidima; babu karba daga kasa da 1.4.0.",
    ofcFaBuild: "Siga",
    ofcFaHandsets: "Wayoyi",
    ofcFaAgainstMinimum: "Idan aka kwatanta da mafi karanci",
    ofcFaTakesEffect: "Zai fara aiki",
    ofcFaMinimum: "Mafi karanci",
    ofcFaPublishedBy: "Wanda ya buga",
    ofcFaWhy: "Dalili",
    ofcUaRoleChangeIntro: "Canza matsayi yana fitar da jami’i daga kowace na’ura nan take, saboda izininsa na yanzu yana tafiya cikin zaman da yake rike da shi. Zai sake shiga da sabon matsayin. Ba a jera wakilai: izininsu yana bin tsarin izini, ba matsayi ba.",
    ofcUaNewRole: "Sabon matsayi",
    ofcUaSelectRole: "Zabi matsayi",
    ofcUaWhyChanging: "Dalilin wannan canjin",
    ofcUaNewAccountStatus: "Sabon matsayin asusu",
    ofcUaSuspendedPending: "An dakatar — ana jiran bincike",
    ofcUaClosedLeft: "An rufe — ya bar aikin",
    ofcUaActiveLift: "Yana aiki — a dage dakatarwa",
    ofcUaTerritoryIntro: "Mai kula yana ganin harajin yankunan da aka ba shi a nan kuma babu wasu. Idan babu wanda aka ba shi, ba ya ganin komai — da gangan ne, don asusun da ba a gama saitin sa ba shi ne mafi karancin bayyanawa ba mafi yawa ba.",
    ofcUaTerritoriesCovered: "Yankunan da ake kula da su",
    ofcUaNoTerritory: "Ba a kirkiri yankin da ke aiki ba tukuna.",
    ofcUaYourOwnAccess: "Izininka na kanka",
    ofcUaChangeAccess: "Canza izini",
    ofcUaTerritories: "Yankuna",
    ofcUaAccount: "Asusu",
    ofcUaSampleTransferred: "An mayar da shi ofishin bincike daga 1 ga Satumba.",
    ofcUaSampleLeft: "Ya bar aikin a karshen kwata.",
    ofcUaCannotBeUndone: "Ba za a iya soke wannan ba",
    ofcUaSampleTakingOver: "Zai karbi zagayen kasuwar Jos ta Arewa daga 1 ga Satumba.",
    ofcUaWillCoverNothing: "Wannan zai bar shi ba tare da yankin da zai kula ba",
    ofcUaLastSignedIn: "Shiga na karshe",
    ofcPfFlagIsQuestion: "Alama tambaya ce, ba hukunci ba. An nuna adadinsu a nan ba tare da canji ba —",
    ofcPfAgentsWithFlag: "Wakilai {{n}} da ke da alamar zamba a bude",
    ofcAllStatuses: "Dukkan matsayi",
    ofcAllLgas: "Dukkan Kananan Hukumomi",
    ofcFrom: "Daga",
    ofcTo: "Zuwa",
    ofcExportCsv: "Fitar da CSV",
    ofcRlExportLimit: "Layukan da zai iya fitarwa",
    ofcRlExportsNothing: "Ba ya fitar da komai",
    ofcCwSave: "Ajiye",
    enumIntegrationAlert: "Wata hidimar waje ba ta amsawa",
    enumNeverCalled: "Ba a kira ba tukuna",
    enumHealthy: "Yana amsawa",
    ofcNavPlatform: "Hidimomin waje",
    ofcPlTitle: "Hidimomin da wannan dandali ya dogara da su",
    ofcPlHint: "An auna daga zirga-zirgar dandalin kansa, ba daga kiran gwaji ba. Hidimar da ba a iya isa gare ta kadai ake lissafawa a kanta — amsar da ba a so ita ma amsa ce.",
    ofcPlAllAnswering: "Duk suna amsawa",
    ofcPlNeedingAttention: "Suna bukatar kulawa",
    ofcPlService: "Hidima",
    ofcPlState: "Yanayi",
    ofcPlLastAnswered: "Amsa ta karshe",
    ofcPlInARow: "Wadanda ba a amsa ba a jere",
    ofcPlCalls: "Kiraye-kiraye",
    ofcPlNeverAnswered: "Bai taba ba",
    ofcPlAdapter: "An saita a matsayin",
    ofcPlTin: "Hidimar lambar haraji ta PSIRS",
    ofcPlKyc: "Hidimar tantance shaidar gwamnati",
    ofcPlVehicles: "Hukumar rajistar ababen hawa",
    ofcPlBanks: "Tambayar sunan asusun banki",
    ofcPlGateway: "Kofar biyan kudi",
    ofcPlNeverCalledBody: "Ba a taba kiran ta ba tun lokacin da aka kirkiri wannan bayanan.",
    ofcPlDownBody: "Kiraye-kiraye {{n}} a jere ba a iya amsa su ba.",
    ofcPlDegradedBody: "An yi kira kwanan nan ba a amsa ba, sannan aka amsa na gaba.",
    ofcPlAnsweringBody: "Yana amsawa.",
    ofcPlOutageHint: "Kafin wannan allon ya kasance, ana gano tsayawar hidima ne ta hanyar lura cewa jerin aiki ya tsaya.",
    enumDegraded: "An yi kira ba a amsa ba",
    enumDown: "Ba ya amsawa",
    ofcOvChange: "Abin da ya canza",
    enumApprovalWaiting: "Amincewa na jiran ka",
    enumCaseAssigned: "An ba ka wani shari\u2019a",
    enumCaseEscalated: "An daga shari\u2019a zuwa gare ka",
    enumCaseMention: "An ambaci sunanka a shari\u2019a",
    enumSystemAlert: "Wani abu a tsarin ya tsaya",
    enumInfo: "Don sanarwa",
    enumWarning: "Ya cancanci duba",
    ofcNavInbox: "Akwatin sako",
    ofcInHint: "Abin da aka gaya maka, da abin da tsarin ke fada game da kansa. Ka yi wa layi alama a matsayin an karanta bayan ka magance shi.",
    ofcInUnread: "Ba a karanta ba tukuna",
    ofcInCritical: "Na bukatar kulawa yanzu",
    ofcInCriticalTitle: "Tsarin na bukatar kulawa",
    ofcInSeverity: "Yadda yake da gaggawa",
    ofcInKind: "Menene shi",
    ofcInSubject: "Abin da ya faru",
    ofcInWhen: "Yaushe",
    ofcInRead: "An karanta",
    ofcInMarkRead: "Yi masa alamar an karanta",
    ofcInReadAll: "Yi wa duka alamar an karanta",
    ofcInShowAll: "Nuna komai",
    ofcInShowUnread: "Nuna wanda ba a karanta ba kadai",
    ofcInToYourRole: "ga matsayinka",
    ofcInNothing: "Ba a tayar da komai a gare ka ba.",
    ofcNavMyAccess: "Inda na shiga",
    ofcAcSessions: "Zaman shiga",
    ofcAcSessionsHint: "Kowane burauza da wannan asusun ya shiga a ciki. Ka kawo karshen duk wanda ba ka gane ba, sannan ka canza kalmar sirri.",
    ofcAcDevices: "Na\u2019urori",
    ofcAcActivity: "Abin da suka yi",
    ofcAcActivityHint: "Abubuwa ashirin da biyar na karshe da aka rubuta a kan wannan asusun, sabo tukuna. Ana ajiye kin amincewa kamar yadda ake ajiye nasara \u2014 abin da aka hana wani yi wani bangare ne na tarihin.",
    ofcAcActivityMine: "Abin da na yi",
    ofcAcActedDays: "Ayyuka a cikin kwanaki {{n}} da suka gabata",
    ofcAcRefusedDays: "Wadanda aka ki a cikin kwanaki {{n}} da suka gabata",
    ofcAcOnWhat: "A kan me",
    ofcAcOutcome: "Sakamako",
    ofcAcNoActivity: "Ba a rubuta komai a kan wannan asusun ba.",
    ofcAcDevicesHint: "Ana rubuta shi lokacin da asusun ya fara shiga daga na\u2019ura. Toshe daya yana kawo karshen kowane zaman da yake rike da shi kuma yana hana shi bude wani.",
    ofcAcDevice: "Na\u2019ura",
    ofcAcUnknownDevice: "Na\u2019urar da ba a sani ba",
    ofcAcThisOne: "wannan",
    ofcAcAddress: "Adireshi",
    ofcAcSignedIn: "An shiga",
    ofcAcLastUsed: "An yi amfani da shi ta karshe",
    ofcAcFirstSeen: "An fara ganin sa",
    ofcAcLastSeen: "An gan shi ta karshe",
    ofcAcLiveSessions: "Zaman da ke bude",
    ofcAcEnd: "Kawo karshe",
    ofcAcEndThisOne: "Kawo karshe ka fita",
    ofcAcEnded: "An kawo karshe",
    ofcAcBlock: "Toshe",
    ofcAcUnblock: "Cire toshewa",
    ofcAcBlockedBy: "Wanda ya toshe",
    ofcAcNoSessions: "Wannan asusun bai taba shiga ba.",
    ofcAcNoDevices: "Ba a rubuta wata na\u2019ura ba tukuna.",
    ofcCwUploadEvidence: "Loda shaida",
    ofcCwUploadHint: "Don takardar da wannan tsarin bai fitar ba: sanarwar banki, wasika, hoto. Hotuna da PDF, har zuwa 15 MB.",
    ofcCwUploadFile: "Fayil",
    ofcCwUploadWhat: "Menene shi",
    ofcCwUploadWhere: "Daga ina ya zo",
    ofcExportExcel: "Takardar lissafi",
    ofcExportPdf: "Takarda don ajiyewa",
    ofcExportWorking: "Ana shirya...",
    ofcDownloadCsv: "Sauke CSV",
    ofcTxReceipt: "Rasit",
    ofcTxCreated: "An kirkira",
    ofcPfIntro: "Karba, isa da matsala gefe da gefe. Wakili a unguwar kasuwanci zai fi karbar mafi kyawun wakili a unguwar karkara, don haka ka karanta ginshikan tare maimakon jera su da naira.",
    ofcPfCollectedByAgents: "Abin da wakilai suka karba",
    ofcPfTaxpayersOnboarded: "Masu biyan haraji da aka shigar",
    ofcPfAgentsWorked: "Wakilan da suka yi aiki",
    ofcPfOpenFraudFlags: "Alamun zamba a bude",
    ofcPfFiguresUnreadable: "Ba a iya karanta wadannan alkaluma ba",
    ofcPfFiguresUnreadableBody: "Jimillar da jerin da ke kasa ba sa nan — ba sifili ba ne. Babu wata lamba a wannan shafi da ke nufin komai, musamman ba a ce komai game da alamun zamba da ke bude ba. Ka sake lodi, kuma ka daga kara idan bai warware ba.",
    ofcPfCollected: "An karba",
    ofcPfAverage: "Matsakaici",
    ofcPfOnboarded: "An shigar",
    ofcPfTins: "TIN",
    ofcPfRenewals: "Sabuntawa",
    ofcPfFailed: "Ya gaza",
    ofcPfReversed: "An juyar",
    ofcPfFlags: "Alamu",
    ofcPfDaysWorked: "Kwanakin aiki",
    ofcNoneConfirmedCollectionReachedGovernment: "Duk karban da aka tabbatar ya isa asusun gwamnati.",
    ofcNoneEveryoneTin: "Kowa yana da TIN dinsa.",
    ofcNoneLgaEnoughActivityReport: "Babu Karamar Hukuma da ke da isasshen aiki da za a bayar da rahoto ba tare da nuna wani ba.",
    ofcNoneMdaCollectionsRecorded: "Ba a rubuta karban ma’aikatu ba tukuna.",
    ofcNoneMdaConfigured: "Babu ma’aikatar da aka saita.",
    ofcNoneAccessRecorded: "Ba a rubuta shiga ba.",
    ofcNoneAgentCollectionsRecorded: "Ba a rubuta karban wakilai ba tukuna.",
    ofcNoneAgentCollectedPeriod: "Babu wakilin da ya karba a wannan lokacin.",
    ofcNoneAgentsCleared: "Ba a ba wa wakilai izini ba tukuna.",
    ofcNoneAgentsMatchFilter: "Babu wakilin da ya dace da wannan tacewar.",
    ofcNoneApplicationsWaitingReview: "Babu bukatun da ke jiran dubawa.",
    ofcNoneApprovalRequestsMatchFilter: "Babu bukatun amincewa da suka dace da wannan tacewar.",
    ofcNoneAuditEntriesMatchThese: "Babu shigarwar bincike da ta dace da wadannan tacewar.",
    ofcNoneBackgroundJobsDeclared: "Ba a bayyana wani aikin baya ba.",
    ofcNoneBeneficiariesFound: "Ba a samu masu amfana ba.",
    ofcNoneClearanceEventsRecorded: "Ba a rubuta abin da ya faru kan izini ba.",
    ofcNoneCollectionsRecordedArea: "Ba a rubuta karba ga wannan yankin ba.",
    ofcNoneDevicesRegistered: "Ba a yi rajistar na’ura ba.",
    ofcNoneDistributionRoundCreated: "Ba a bude zagayen rabo ba.",
    ofcNoneDistributionsSetUp: "Ba a shirya rabo ba tukuna.",
    ofcNoneDocuments: "Babu takardu.",
    ofcNoneEndedRecordOwesAnything: "Babu rikodin da aka rufe da ake bin sa komai.",
    ofcNoneFlowsAttemptedPeriod: "Ba a gwada wani mataki ba a wannan lokacin.",
    ofcNoneFraudSignalsMatchFilter: "Babu alamun zamba da suka dace da wannan tacewar.",
    ofcNoneGroupsRegistered: "Ba a yi rajistar kungiya ba tukuna.",
    ofcNoneHandsetRegistered: "Ba a yi rajistar waya ba tukuna.",
    ofcNoneIncentiveProgrammesCreated: "Ba a kirkiri shirin tallafi ba.",
    ofcNoneIndividualLevyCollectedAnything: "Babu harajin da ya karbi komai a karkashin wannan tacewar.",
    ofcNoneLanguageUseReported: "Ba a bayar da rahoton amfani da harshe ba.",
    ofcNoneLocalGovernmentRevenueCollected: "Ba a karbi harajin karamar hukuma ba a wannan lokacin.",
    ofcNoneObligationsRecordedAgainstTaxpayer: "Ba a rubuta wani wajibi a kan wannan mai biyan haraji ba.",
    ofcNoneOfficersRecorded: "Ba a rubuta jami’ai ba.",
    ofcNoneOpenReconciliationExceptions: "Babu kura-kuran daidaita lissafi a bude.",
    ofcNonePayoutRequests: "Babu bukatun biyan kudi.",
    ofcNoneRateHistory: "Babu tarihin kudin haraji.",
    ofcNoneRecordsMatchQuery: "Babu rikodin da ya dace da wannan binciken.",
    ofcNoneRefereeNominated: "Ba a zabi mai shaida ba.",
    ofcNoneRefereeRiskFlagsOpen: "Babu alamun hadarin mai shaida a bude.",
    ofcNoneRefereeSupportsMoreApplicant: "Babu mai shaida da ke goyon bayan mai nema fiye da daya.",
    ofcNoneRefundOutstanding: "Babu mayarwar da ta rage.",
    ofcNoneRevenueCollectedPeriod: "Ba a karbi haraji ba a wannan lokacin.",
    ofcNoneRevenueItemsConfigured: "Ba a saita nau’in haraji ba.",
    ofcNoneScreensReported: "Ba a bayar da rahoton shafuka ba.",
    ofcNoneSettlementsRecorded: "Ba a rubuta turawar kudi ba.",
    ofcNoneTicketsMatchFilter: "Babu rahotannin da suka dace da wannan tacewar.",
    ofcNoneTrainingRecords: "Babu rikodin horo.",
    ofcNoneTransactionsMatchTheseFilters: "Babu ma’amalolin da suka dace da wadannan tacewar.",
    ofcNoneVehiclesRecordedAgainstTaxpayer: "Ba a rubuta motoci a kan wannan mai biyan haraji ba.",
    ofcNoneNobodyAwardedRound: "Ba a ba wa kowa daga wannan zagayen ba tukuna.",
    ofcNoneNobodyAwardedRound2: "Ba a ba wa kowa a karkashin wannan zagayen ba tukuna.",
    ofcNoneNobodyRecordedGroup: "Ba a rubuta kowa a wannan kungiyar ba tukuna.",
    ofcNoneNobodyArrearsFilter: "Babu wanda ke bin bashi a karkashin wannan tacewar.",
    ofcNoneNobodyRegisteredFilter: "Babu wanda aka yi wa rajista a karkashin wannan tacewar.",
    ofcNoneNone: "Babu.",
    ofcNoneNothingCollectedFilter: "Ba a karbi komai a karkashin wannan tacewar ba.",
    ofcNoneNothingPublished: "Ba a buga komai ba tukuna.",
    ofcNoneNothingWaiting: "Babu abin da ke jira.",
    ofcNoneAuthorityAcknowledgedRenewal: "Hukumar ta amince da kowace sabuntawa.",
    ofcNoneOfflineQueueUsedPeriod: "Ba a yi amfani da jerin gwanon ba tare da layi ba a wannan lokacin.",
    ofcAgAwaitingGovernmentReview: "Na jiran nazarin gwamnati",
    ofcAgApplicantsCompleted: "Wadannan masu nema sun kammala tabbatar da shaida da izinin mai shaida.",
    ofcAgAllAgents: "Dukkan wakilai",
    ofcAgSixAxes: "Matakan matsayi shida masu zaman kansu: wakili yana aiki ne kawai idan an cika kowanne.",
    ofcAgOperationalStatus: "Matsayin aiki",
    ofcAgAll: "Duka",
    ofcAgActive: "Yana aiki",
    ofcAgInactive: "Ba ya aiki",
    ofcAgSuspendedStatus: "An dakatar",
    ofcAgBackToAgents: "← Koma ga wakilai",
    ofcAgClearanceChecklist: "Jerin sharudan izini",
    ofcAgEveryItemSatisfied: "Dole a cika kowane sharadi kafin a kunna.",
    ofcAgNoKycSubmitted: "Mai nema bai tura tabbatar da shaida ba.",
    ofcAgRefereeHistoryKept: "Mai shaida da aka maye gurbinsa yana nan a rikodi — ba a taba share tarihin ba.",
    ofcAgClear: "Ba da izini",
    ofcAgReject: "Ki",
    ofcAgDevices: "Na’urori",
    ofcAgDevicesBody: "Wayar da wakili ya yi wa rajista tana jira a nan a matsayin ANA JIRA kuma ba za a iya karba da ita ba sai an amince da ita. Janye na’ura yana kawo karshen zamanta nan take.",
    ofcAgSuspend: "Dakatar",
    ofcAgRestore: "Mayar",
    ofcAgRevoke: "Janye",
    ofcAgDecision: "Shawara",
    ofcAgDecisionRecorded: "Ana rubuta kowace shawara da sunanka a rajistar bincike kuma tana bukatar dalili.",
    ofcAgReasonMinimum: "Dalili (akalla haruffa 10)",
    ofcAgApproveApplication: "Amince da bukata",
    ofcAgRequestMoreInformation: "Nemi karin bayani",
    ofcAgAssignTerritory: "Ba da yanki",
    ofcAgSelectTerritory: "Zabi yanki",
    ofcAgTerritoryRequired: "Ana danganta kowace ma’amala ga yanki, don haka dole a ba da daya kafin a kunna.",
    ofcAgActivateAgent: "Kunna wakili",
    ofcAgActivationBlocked: "An hana kunnawa har sai an cika kowane sharadin izini. Kebancewa yana bukatar izinin gwamnati na musamman.",
    ofcAgMoveTerritory: "Matsar zuwa wani yanki",
    ofcAgMoveTerritoryBody: "Karban da aka riga aka yi yana rike da yankin da aka karba a ciki. Wannan yana yanke inda za a danganta na gaba.",
    ofcAgReassignTerritory: "Sake ba da yanki",
    ofcAgSuspendAgent: "Dakatar da wakili",
    ofcAgClearanceHistory: "Tarihin izini",
    ofcAgRefereeRiskFlags: "Alamun hadarin mai shaida",
    ofcAgRefereeRiskBody: "Alamun da ke nuna dangantakar mai shaida ba ta gaskiya ba ce. Ba a hana komai yayin da alama take a bude kawai — amma alamar da ka tabbatar tana hana a ba wa mai shaidan izini har sai wani ya soke ta da abin da ya gano.",
    ofcAgWhatYouFound: "Abin da ka gano",
    ofcAgLookingIntoIt: "Ana bincike",
    ofcAgUpheld: "An tabbatar — ba za a iya dogara da wannan mai shaida ba",
    ofcAgDismissed: "An soke — alamar ba ta da laifi",
    ofcAgRefereesMultiple: "Masu shaida da ke goyon bayan mai nema fiye da daya",
    ofcAgBankAccountChanges: "Canjin asusun banki",
    ofcAgBankChangeBody: "Inda ake biyan kwamishan wakili. Babu abin da zai motsa sai banki ya tabbatar da sabon asusun kuma wani jami’i ban da wanda ya nema ya amince da shi. Za a ci gaba da amfani da asusun da ake amfani da shi har lokacin.",
    ofcAgNoBankChanges: "Babu canjin asusun banki da ke jira.",
    ofcAgAskBankAgain: "Sake tambayar banki",
    ofcAgRefuse: "Ki",
    ofcAgApplicationsReceived: "Bukatun da aka karba",
    ofcAgReadyForReview: "A shirye don dubawa",
    ofcAgBothCleared: "An ba da izinin shaida da mai shaida",
    ofcAgActiveAgents: "Wakilan da ke aiki",
    ofcAgKycPending: "Ana jiran shaida",
    ofcAgAwaitingApplicant: "Ana jiran mai nema",
    ofcAgKycCleared: "An ba da izinin shaida",
    ofcAgRefereePending: "Ana jiran mai shaida",
    ofcAgRefereeFailed: "Mai shaida ya gaza",
    ofcAgApplicationState: "Matsayin bukata",
    ofcAgAccessStage: "Matakin izini",
    ofcAgMayCollectRevenue: "Zai iya karbar haraji",
    ofcAgOutstanding: "Da ya rage",
    ofcAgTotalReferees: "Jimlar masu shaida",
    ofcAgPending: "Ana jira",
    ofcAgCleared: "An ba da izini",
    ofcAgFailedRejected: "Ya gaza ko an ki",
    ofcAgBankDifferentName: "Banki ya dawo da wani suna daban",
    ofcAgApplicantsSupported: "Masu nema da aka goyi baya",
    ofcAgApplication: "Bukata",
    ofcAgSubmitted: "An tura",
    ofcAgCode: "Lamba",
    ofcAgKyc: "Shaida",
    ofcAgOperational: "Yana aiki",
    ofcAgCategory: "Rukuni",
    ofcAgRelationship: "Dangantaka",
    ofcAgResponded: "Ya amsa",
    ofcAgModule: "Darasi",
    ofcAgTitleHeading: "Take",
    ofcAgScore: "Maki",
    ofcAgVersion: "Siga",
    ofcAgEvent: "Abin da ya faru",
    ofcAgReason: "Dalili",
    ofcAgSignal: "Alama",
    ofcAgSeverity: "Girman hadari",
    ofcAgDetail: "Bayani",
    ofcAgSampleKycNote: "An tabbatar da shaida da NIN; hakimin unguwa ya tabbatar da mai shaida; rikodin sun daidaita.",
    ofcAgSampleRefereeNote: "An kira dukkan masu nema shida; hudu ba su taba haduwa da shi ba.",
    ofcRhBlockedCount: "Abubuwa {{n}} na hana wani yin aiki",
    ofcRhInvoicesStillOpen: "Takardun biya {{n}} na nan a bude",
    colShareTitle: "Rasit na PSIRS",
    colShareBody: "Rasit na PSIRS {{number}} na {{name}}. Ka tantance da lambar {{code}}.",
    ofcRhNothingWaiting: "Babu abin da ke jira.",
    ofcNothingToShow: "Babu abin da za a nuna.",
    ofcRhActiveRecords: "Rikodin da ke aiki",
    ofcRhRegisteredByBoth: "Wakilai da jami’ai suka yi wa rajista",
    ofcRhTinNoTracking: "Ba za a iya bin diddigin mai biyan haraji da babu shi ba tsawon shekaru",
    ofcRhCollectedForCouncils: "An karba a madadinsu, ba na jihar kanta ba",
    ofcRhAccruedNotPaid: "An tara kuma ba a biya ba tukuna",
    ofcRhExpectedLessReceived: "Abin da ake tsammani ban da abin da aka karba, kan turawar da ba a daidaita ba",
    ofcRhBankPlatformDisagree: "Banki da dandalin sun sabawa juna",
    ofcRhHashChainedShort: "An sarkafa, ba a share komai",
    ofcRhEntriesSinceMidnight: "Shigarwa tun tsakar dare",
    ofcRhRaisedNotReviewed: "An daga kuma ba a duba ba tukuna",
    ofcRhAgentsAwaitingClearance: "Wakilan da ke jiran izini",
    ofcRhApplicationsComplete: "Bukatun sun cika kuma suna jiran shawara",
    ofcRhAgentsAskedForMore: "An nemi wakilai karin bayani",
    ofcRhWaitingOnApplicant: "Ana jiran mai nema, ba kai ba",
    ofcRhDevicesAwaitingApproval: "Na’urorin da ke jiran amincewa",
    ofcRhAgentNeedsHandset: "Wakili ba zai iya karba ba sai an amince da wayarsa",
    ofcRhSupervisorsNoTerritory: "Masu kula da babu yanki",
    ofcRhNoFiguresUntilTerritory: "Ba sa ganin adadin haraji ko kadan sai an ba su yanki",
    ofcRhItemsNoRate: "Nau’in harajin da babu kudinsu",
    ofcRhNotCollectableYet: "An jera su kuma ba a iya karbarsu ba sai gwamnati ta sanya adadin",
    ofcRhMdasCollectingNothing: "Ma’aikatun da ba sa karban komai",
    ofcRhNoItemForMda: "Babu wani nau’in haraji a gare su a wannan dandalin",
    ofcRhOfficersWithAccess: "Jami’an da ke da izinin shiga",
    ofcRhExcludingFieldAgents: "Ban da wakilan filin aiki",
    ofcRhSupportTicketsOpen: "Rahotannin taimako a bude",
    ofcRhRaisedByAgents: "Wakilai a filin aiki suka kai su",
    ofcRhTinApplicationsFailed: "Bukatun TIN da suka gaza",
    ofcRhRegisterRefusedThese: "Rajistar ta ki wadannan — suna bukatar mutum",
    ofcRhAppliedNotIssued: "An nema kuma ba a bayar ba tukuna",
    ofcRhCorrectionsAwaiting: "Gyare-gyaren da ke jiran dubawa",
    ofcRhSomeoneAskedChange: "Wani ya nemi a canza wanda rikodin ya ce shi ne",
    ofcRhInvoicesUnpaid: "Takardun biya da ba a biya ba",
    ofcRhRaisedStillOpen: "An yi su kuma suna nan a bude",
    ofcRhInvoicesExpired: "Takardun biya da suka kare",
    ofcRhNeverPaidOutOfTime: "Ba a taba biyan su ba kuma lokacinsu ya kare",
    ofcRhRegisteredThisWeek: "An yi rajista wannan makon",
    ofcRhNewTaxpayers: "Sabbin masu biyan haraji a rajistar",
    ofcRhTaxpayersOnRegister: "Masu biyan haraji a rajistar",
    ofcRhReconciliationExceptions: "Kura-kuran daidaita lissafi",
    ofcRhDisagreeAboutThese: "Banki da dandalin sun sabawa juna kan wadannan",
    ofcRhSettlementsUnreconciled: "Turawar da ba a daidaita ba",
    ofcRhReceivedNotMatched: "An karbi kudi kuma ba a dace da shi ba tukuna",
    ofcRhPayoutsToApprove: "Biyan kwamishan da za a amince da su",
    ofcRhAgentsWaitingShort: "Wakilai na jiran wadannan",
    ofcRhRefundsOwed: "Mayarwar da ake bin mai biyan haraji",
    ofcRhMoneyStateShouldNotHave: "Kudin da jiha ke da shi kuma bai kamata ba",
    ofcRhMoneyBackOutQuery: "Kudin da ya sake fita — tambayar da ta cancanci a fara yi",
    ofcRhActionsRefusedWeek: "Ayyukan da aka ki wannan makon",
    ofcRhSomeoneTriedNotPermitted: "Wani ya gwada abin da matsayinsa bai ba shi izini ba",
    ofcRhRateChangesMonth: "Canjin kudin haraji wannan watan",
    ofcRhEveryChangeCharged: "Kowane canji ga abin da ake caji dan kasa",
    ofcRhReceiptsCheckedPublic: "Rasit din da jama’a suka duba",
    ofcRhVerificationLookups: "Binciken shafin tantancewa",
    ofcRhAuditEntriesToday: "Shigarwar bincike na yau",
    ofcRhHashChainedLong: "An sarkafa kuma ba a share komai",
    ofcRhAuditEntriesTotal: "Jimlar shigarwar bincike",
    ofcRhSincePlatformStarted: "Tun lokacin da dandalin ya fara",
    ofcRhTaxpayersOnRecord: "Masu biyan haraji a rikodi",
    ofcRhWaiting: "Ana jira",
    ofcRhAgent: "Wakili",
    ofcRhWaitingSince: "Yana jira tun",
    ofcRhApprovedFromHome: "An amince daga shafin farko na mai gudanarwa.",
    ofcRhRegistered: "An yi rajista",
    ofcRhOfficer: "Jami’i",
    ofcRhWhyFailed: "Dalilin da ya sa ya gaza",
    ofcRhExpires: "Zai kare",
    ofcRhKind: "Nau’i",
    ofcRhExpected: "Ana tsammani",
    ofcRhReceived: "An karba",
    ofcRhRaisedHeading: "An daga",
    ofcRhRequested: "An nema",
    ofcRhWhen: "Yaushe",
    ofcRhRole: "Matsayi",
    ofcRhAttempted: "An yi kokari",
    ofcRhAgainst: "A kan",
    ofcRhOutcome: "Sakamako",
    ofcRhToday: "Yau",
    ofcRhNewThisWeek: "Sabbin wannan makon",
    ofcRhOpen: "A bude",
    ofcRhOpenFile: "Bude fayil",
    ofcRhApprove: "Amince",
    ofcRhTaxpayers: "Masu biyan haraji",
    ofcRhExceptions: "Kura-kurai",
    ofcRhAuditEntries: "Shigarwar bincike",
    ofcRhAgentsWaiting: "Wakilan da ke jiran shawara",
    ofcRhAgentsWaitingBody: "Wakilai na jiran wadannan. Amincewa yana bukatar sabuwar lamba, domin shi ne aikin da ke fitar da kudi.",
    ofcRhClearanceBody: "Amincewa a nan yana yin abin da shafin izini ke yi — hanya daya, shigarwar bincike daya. Neman karin bayani yana bukatar dalili, don haka wannan yana bude fayil.",
    ofcRhHandsetsWaiting: "Na’urorin da ke jiran amincewa",
    ofcRhHandsetsBody: "Wakilin da aka bai wa izini ba zai iya karba ba sai an amince da na’urar da ke hannunsa.",
    ofcRhCommissionPayouts: "Bukatun biyan kwamishan",
    ofcRhCommissionLiability: "Bashin kwamishan",
    ofcRhAssessedUnpaid: "An kima kuma ba a biya ba",
    ofcRhTinsOutstanding: "TIN da suka rage",
    ofcRhTinsBody: "Wadannan masu biyan haraji suna nan kuma babu TIN, don haka ba abin da zai bi su tsawon shekaru. Sake nema ba shi da hadari: dandalin yana tura bukata iri daya, kuma TIN da aka riga aka bayar shi ke dawowa maimakon a yi na biyu.",
    ofcRhTinRefused: "Bukatun TIN da rajistar ta ki",
    ofcRhTheRegister: "Rajistar masu biyan haraji",
    ofcRhRegisterBody: "Wanda ke cikinta, wanda babu TIN, da abin da aka kima kuma ba a biya ba.",
    ofcRhMoneyInOut: "Kudin shiga, kudin fita, kudin da aka rike",
    ofcRhMoneyBody: "Daidaita lissafi, tura kudi da abin da jiha ke bin bashi — ga wakilanta, ga masu biyan haraji da ake bin su mayarwa, da ga Kananan Hukumomin da take karbar haraji domin su.",
    ofcRhOwedToCouncils: "Ana bin Kananan Hukumomi",
    ofcRhSettlementVariance: "Bambancin tura kudi",
    ofcRhBankDisagree: "Inda banki da dandalin suka sabawa juna",
    ofcRhReconciliationOpen: "Akwai kura-kuran daidaita lissafi a bude",
    ofcRhReconciliationBody: "Har sai an warware wadannan, adadin dandalin da na banki ba za su yi daidai ba, kuma ana rike kwamishan kan karbar da abin ya shafa.",
    ofcRhExceptionQueueBody: "Warware kuskure shawara ce mai dauke da bayani, don haka ana yin sa a shafin daidaita lissafi inda akwai wurin rubutu. Wannan shi ne abin da ke jira.",
    ofcRhWorkExceptionQueue: "Yi aiki kan jerin kura-kurai",
    ofcRhReversedRefunded: "An juyar ko an mayar",
    ofcRhMoneyBackOut: "Kudin da ya sake fita",
    ofcRhReversedBody: "An juyar ko an mayar bayan an gama. Tambaya ta farko da ta cancanci yi a kowane dandalin haraji.",
    ofcRhFraudOpen: "Alamun zamba a bude",
    ofcRhInvoicesExpiring: "Takardun biya da za su kare",
    ofcRhInvoicesBody: "An yi su, ba a biya ba, kuma lokacinsu zai kare cikin makon. Bayan haka sai an sake yin kimar.",
    ofcRhRefusedActions: "Ayyukan da dandalin ya ki",
    ofcRhRefusedBody: "Wani ya yi kokarin abin da matsayinsa bai ba shi izini ba. Kowanne shigarwar bincike ce a kanta.",
    ofcRhSupervisorsNothing: "Masu kula da babu yankin da suke kula",
    ofcRhSupervisorsBody: "Ba sa ganin adadin haraji ko kadan sai an ba su yanki. Zabar wanne yana bukatar mai zabi, don haka wannan yana bude Izinin jami’ai.",
    ofcRhAssignTerritories: "Ba da yankuna",
    ofcRhWhatToExamine: "Abin da ake da shi don bincike",
    ofcRhReadOnlyBody: "Karatu kawai, ta matsayi kuma da gangan. Babu abin da ke kan wannan shafin da ke canza rikodi — kowane adadi mafarin bincike ne, kuma rajistar bincike da kanta an sarkafa ta kuma ba a share komai a cikinta.",
    ofcRhAdminBody: "Wakilin da babu izini ko na’urar da aka amince da ita ba zai iya karba ba, kuma mai kula da babu yanki ba ya ganin komai.",
    ofcRhAdminIntro: "Abin da ke jiran mai gudanarwa. Karban kudi da nazarin haraji suna kan allon aiki da takaitaccen haraji; wannan shafin dandalin da kansa ne.",
    ofcRevenueAdministration: "Gudanar da haraji",
    ofcDistributionRound: "Zagayen rabo",
    ofcLanguage: "Harshe",
    ofcNavDashboard: "Allon karban haraji",
    ofcNavIntelligence: "Nazarin haraji",
    ofcNavRevenue: "Takaitaccen haraji",
    ofcNavLevies: "Haraji da rukunoni",
    ofcNavTransactions: "Ma’amaloli",
    ofcNavAgents: "Wakilai da izini",
    ofcNavReferees: "Masu shaida",
    ofcNavPerformance: "Aikin wakilai",
    ofcNavReconciliation: "Daidaita lissafi",
    ofcNavCommissions: "Kwamishan",
    ofcNavApprovals: "Amincewa",
    ofcNavFraud: "Zamba da yoyon kudi",
    ofcNavSupport: "Sashen taimako",
    ofcNavOutstanding: "Aikin da ya rage",
    ofcNavAudit: "Rajistar bincike",
    ofcNavUsage: "Amfani da manhaja",
    ofcNavCatalogue: "Jerin harajin",
    ofcNavProgrammes: "Tallafin jama’a",
    ofcNavGroups: "Kungiyoyi da hadin kai",
    ofcNavTaxpayerRecords: "Gyaran bayanan mai biyan haraji",
    ofcNavUsers: "Izinin jami’ai",
    ofcNavFieldApp: "Manhajar filin aiki",
    ofcNavAllocations: "Zagayen rabon kaya",
    ofcNavMyWork: "Aikina",
    ofcNavCases: "Kararraki",
    ofcGroupYourDesk: "Teburinka",
    ofcSearchLabel: "Nemi bayanan gwamnati",
    ofcSearchPlaceholder: "Lamba, TIN, suna ko lambar rasit",
    ofcSearchSearching: "Ana nema…",
    ofcSearchNoResults: "Babu abin da ya dace da haka.",
    ofcSearchHint: "Haruffa biyu ko fiye.",
    ofcSearchTransaction: "Ma’amala",
    ofcSearchTaxpayer: "Mai biyan haraji",
    ofcSearchAgent: "Wakili",
    ofcSearchOfficer: "Jami’i",
    ofcSearchInvoice: "Takardar biya",
    ofcSearchReceipt: "Rasit",
    ofcSearchPayment: "Biyan kudi",
    ofcSearchAssessment: "Kima",
    ofcSearchVehicle: "Abin hawa",
    ofcSearchRevenueItem: "Nau’in haraji",
    ofcSearchPlace: "Karamar hukuma",
    ofcSearchCase: "Kara",
    ofcMwIntro: "Duk abin da ke jiranka, ko daga ina ya zo a manhajar.",
    ofcMwAssigned: "An ba ka",
    ofcMwAssignedBody: "Kararrakin da wani ya sa a hannunka.",
    ofcMwOpened: "Kararrakin da ka bude",
    ofcMwOpenedBody: "Yanzu na wani ne ya yi, amma har yanzu naka ne ka bi.",
    ofcMwMentions: "Inda aka ambace ka",
    ofcMwMentionsBody: "Wani jami’i ya rubuta sunanka a kan kara.",
    ofcMwDepartment: "Yana jiran sashenka",
    ofcMwDepartmentBody: "An aika wa matsayinka kuma babu wanda ya karba tukuna.",
    ofcMwApprovals: "Amincewa da ke jiran hukunci",
    ofcMwExceptions: "Bambancin lissafi",
    ofcMwFlags: "Alamun hadari",
    ofcMwOverdue: "Ya wuce lokaci",
    ofcMwNothing: "Babu abin da ke jiranka.",
    ofcMwOpenQueue: "Bude dukkan jerin aikin",
    ofcCwTitle: "Jerin aikin gwamnati",
    ofcCwIntro: "Kara na daukar aiki tsakanin sassa, kuma yana rike da kowane matakinsa.",
    ofcCwOpenCase: "Bude kara",
    ofcCwStatus: "Matsayi",
    ofcNavRoles: "Matsayi da izini",
    ofcRlTitle: "Matsayi da izini",
    ofcRlIntro: "Wa zai iya yin me. Wannan bayanai ne yanzu, don haka sauya wa wanda Hukumar ta ba iko ba ya jiran sabon fitarwa.",
    ofcRlCatalogueNote: "Jerin izinin da suke nan ya kasance a cikin lambar, saboda izini suna ne da hanyoyin ke duba. Bayar da izinin da babu hanyar da ke duba shi zai yi kama da iko amma ba iko ba ne.",
    ofcRlRole: "Matsayi",
    ofcRlOfficers: "Jami’an da ke rike da shi",
    ofcRlPermissions: "Izini",
    ofcRlSystemRole: "Yana zuwa da manhajar",
    ofcRlPortalRole: "Yana shiga wannan tashar",
    ofcRlGrant: "Bayar",
    ofcRlRevoke: "Cire",
    ofcRlGrantReason: "Dalilin bayar da wannan iko",
    ofcRlRevokeReason: "Dalilin cire wannan iko",
    ofcRlRevokeWarning: "Duk wanda ke rike da wannan matsayi za a fitar da shi. An yi haka da gangan: ana ajiye taswirar, kuma dakika talatin lokaci ne mai tsawo ga wanda aka cire wa iko ya ci gaba da amfani da shi.",
    ofcRlNewRole: "Kara matsayi",
    ofcRlRoleName: "Sunan da ake amfani da shi a lambar",
    ofcRlRoleLabel: "Abin da jami’ai ke gani",
    ofcRlCopyFrom: "Fara daga",
    ofcRlCopyFromBody: "Farawa daga matsayin da ya fi kusa sannan a cire abubuwa ya fi aminci fiye da farawa ba tare da komai ba, wanda shi ne yadda matsayi ke samun komai bayan mako guda, gaggawa daya bayan daya.",
    ofcRlRetire: "Yi ritaya",
    ofcRlRestore: "Mayar da shi aiki",
    ofcRlIsPortalRole: "Wannan matsayi yana shiga tashar jami’ai",
    ofcRlSignedOut: "Jami’an da aka fitar",
    ofcRlSearchPermission: "Nemo izini",
    ofcNoneRoles: "Ba a saita wani matsayi ba.",
    enumClosing: "Ana rufewa",
    ofcNavPeriods: "Lokutan kudi",
    enumClean: "Babu matsala",
    enumException: "Matsala",
    enumNotAvailable: "Ba a iya duba shi ba",
    enumRandom: "Bazuwa",
    enumSystematic: "Kowane na n",
    enumHighestValue: "Mafi girman kudi",
    enumDrawn: "An zana",
    enumInReview: "Ana duba shi",
    enumGenerated: "An samar da shi",
    enumSigned: "An sa hannu",
    enumTransactionAudit: "Binciken cinikayya",
    enumAgentActivity: "Ayyukan wakili",
    enumRevenueCollection: "Kudin da aka karba",
    enumLgaPerformance: "Aikin karamar hukuma",
    enumPaymentReconciliation: "Daidaita biyan kudi",
    enumUserActivity: "Ayyukan jami’i",
    enumAnomaly: "Abubuwan da ba a saba gani ba",
    enumAuditSample: "Samfuran bincike",
    enumRevenueTarget: "Burin kudin shiga",
    enumPeriodClosing: "Rufe lokaci",
    enumDataChange: "Canje-canjen bayanai",
    ofcNavWorkbench: "Teburin bincike",
    ofcWbSamplesDrawn: "Samfuran da aka zana",
    ofcWbItemsOutstanding: "Abubuwan da suka rage a duba",
    ofcWbExceptionsFound: "Matsalolin da aka samu",
    ofcWbReportsHeld: "Rahotannin da ke fayil",
    ofcWbSamples: "Samfura",
    ofcWbSamplesHint: "Kowane layi yana rubuta zanen da ya riga ya faru. Ba za a iya canza sharudda, hanya ko iri ba bayan haka, wanda shi ne abin da ke ba wani damar maimaita shi.",
    ofcWbSampleNumber: "Samfur",
    ofcWbTitle: "Abin da ya shafa",
    ofcWbMethod: "Yadda aka zana shi",
    ofcWbMethodRandom: "Bazuwa, daga iri da aka ajiye",
    ofcWbMethodSystematic: "Kowane na n, bisa tsarin kwanan wata",
    ofcWbMethodHighestValue: "Mafi girman kudi (ba samfur ba ne)",
    ofcWbDrawn: "An zana daga jimla",
    ofcWbPending: "Ba a duba ba tukuna",
    ofcWbExceptions: "Matsaloli",
    ofcWbDrawnAt: "An zana a",
    ofcWbDrawnBy: "Wanda ya zana",
    ofcWbNoSamples: "Ba a zana samfur ba tukuna.",
    ofcWbDraw: "Zana samfur",
    ofcWbDrawHint: "Ka fada me ake bukatar samfurin da kuma yadda za a duba. Barin fili babu komai yana nufin ba ya rage komai.",
    ofcWbSize: "Nawa za a zana",
    ofcWbFrom: "Daga",
    ofcWbTo: "Zuwa",
    ofcWbMinimumNaira: "Mafi karancin kudi (naira)",
    ofcWbDrawIsFinal: "Ba za a iya soke zane ko sake zana shi ba. Ka zana sabon samfur idan wadannan sharuddan ba daidai ba ne.",
    ofcWbDrawnNotice: "An zana {{number}}, cinikayya {{n}} za a duba.",
    ofcWbSeed: "Iri",
    ofcWbPopulation: "An zana daga",
    ofcWbPosition: "Abu",
    ofcWbOutcome: "Sakamako",
    ofcWbFinding: "Abin da aka samu",
    ofcWbRecord: "Rubuta",
    ofcWbNoItems: "Wannan samfurin bai zabi komai ba.",
    ofcWbCompleteHint: "Ba za a iya kammala samfur ba sai kowane abu ya sami sakamako. Aikin da ba a gama ba amma aka ce an gama ya fi rashin samfur muni.",
    ofcWbComplete: "Kammala wannan samfurin",
    ofcWbReports: "Rahotannin bincike",
    ofcWbReportsHint: "Kowane rahoto yana rike da bayanan yadda suke a lokacin da aka samar da shi, tare da lambar tantancewa da mai karatu zai iya sake lissafawa.",
    ofcWbReportNumber: "Rahoto",
    ofcWbReportType: "Tambayar da yake amsawa",
    ofcWbRows: "Layuka",
    ofcWbPeriod: "Lokaci",
    ofcWbGeneratedAt: "An samar a",
    ofcWbSignedBy: "Wanda ya sa hannu",
    ofcWbChecksum: "Lambar tantancewa",
    ofcWbOpenReport: "Bude",
    ofcWbWhatWasFrozen: "Abin da aka daskarar",
    ofcWbRecomputed: "An sake lissafawa yanzu",
    ofcWbStored: "An ajiye lokacin sa hannu",
    ofcWbChecksumAgrees: "Layukan da aka ajiye har yanzu suna bayar da lambar tantancewar da aka rubuta tare da su.",
    ofcWbChecksumDiffers: "Layukan da aka ajiye ba sa kara bayar da lambar tantancewar da aka rubuta tare da su. Ka karanta layukan da ke kasa tare da kwafin da aka buga kafin ka dogara da ko wanne.",
    ofcWbPayloadRows: "Layuka kamar yadda aka daskarar da su",
    ofcWbViewIsRecorded: "Budewar rahoton da aka sa wa hannu ana rubuta ta a kan sunanka.",
    ofcWbNoPayload: "An daskarar da wannan rahoton ba tare da wani layi a ciki ba.",
    ofcWbAltered: "An sauya",
    ofcWbAlteredTitle: "Wani rahoto a wannan shafi bai sake dacewa da lambar tantancewarsa ba",
    ofcWbAlteredBody: "Rahotanni {{n}} da ke kasa suna dauke da lambobin da ba su sake dacewa da lambar tantancewar da aka rubuta lokacin da aka kirkire su ba. Sa hannu a kan irin wannan rahoto bai shafi abin da yake nunawa yanzu ba. Wannan sauyi ne da aka yi a cikin bayanan kai tsaye, ba ta hanyar dandalin ba — kada ka dogara da wadannan lambobin, kuma ka daga kara.",
    ofcWbNoReports: "Ba a samar da rahoto ba tukuna.",
    ofcWbGenerate: "Samar da rahoto",
    ofcWbGenerateHint: "Samar da rahoto yana daskarar da lambobin. Sa hannu mataki ne daban, kuma sau da yawa jami’i ne daban.",
    ofcWbGenerated: "An samar da {{number}}, layuka {{n}}.",
    ofcWbSign: "Sa hannu",
    ofcWbWithdraw: "Janye",
    ofcWbActions: "Ayyuka",
    ofcWbClose: "Rufe",
    ofcWbReference: "Lamba",
    ofcWbTaxpayer: "Mai biyan haraji",
    ofcWbAmount: "Kudi",
    ofcPeTitle: "Lokutan kudi",
    ofcPeIntro: "Rufe wata yana daskarar da abin da Jihar ta ce ta tara a cikinsa. Bayan rufewa, bayanan kansu suna hana rubutu cikin watan — wannan iko ne, ba rahoto ba.",
    ofcPeOpenPeriod: "Bude lokaci",
    ofcPePeriod: "Lokaci",
    ofcPeCollected: "An tara",
    ofcPeSettled: "An tura wa gwamnati",
    ofcPeCommission: "Kwamishan",
    ofcPeTransactions: "Ma’amaloli",
    ofcPeClose: "Rufe watan",
    ofcPeBeginClosing: "Fara rufewa",
    ofcPeReopen: "Sake budewa",
    ofcPeClosedBy: "Wanda ya rufe",
    ofcPeReopenedBy: "Wanda ya sake budewa",
    ofcPeClosingNote: "Abin da ake tabbatarwa",
    ofcPeReopenReason: "Dalilin sake budewa",
    ofcPeNotReady: "Bai shirya rufewa ba",
    ofcPeNotReadyBody: "Rufewa a kan bambancin da ba a warware ba ko biyan da ke jira yana daskarar da adadin da aka riga aka san ba daidai ba ne. Wani lokaci shi ne daidai, kuma ba a taba yin sa a boye ba.",
    ofcPeOverride: "Dalilin rufewa duk da haka",
    ofcPeFiguresUnknown: "Ba a iya karanta abin da wannan wata ke rike da shi ba",
    ofcPeFiguresUnknownBody: "Dandalin bai iya kirga sauran matsalolin da ba a warware ba ko biyan da ke jira na wannan wata ba, don haka ba zai iya gaya maka ko lambar ta tabbata ba. Watakila ta tabbata. Har yanzu ana iya rufewa, kuma yana bukatar dalili a rubuce, domin wata da aka rufe ba tare da sani ba, an rufe shi ne a kan duk abin da ke ciki.",
    ofcPeUnreconciled: "Bambancin da ba a warware ba",
    ofcPePendingPayments: "Biyan da ke jira",
    ofcPeFiguresNow: "Abin da watan ke da shi yanzu",
    ofcPeFrozen: "An daskare a rufewa",
    ofcPeReopenSeparate: "Sake budewa na mai gudanarwa ne, ba na wanda ya rufe ba. Idan jami’in da ya rufe littattafan zai iya sake budewa, hakan na kawar da yawancin dalilin kulle lokacin.",
    ofcNonePeriods: "Ba a bude wani lokacin kudi ba tukuna.",
    enumSupervisorChange: "Layin rahoto",
    enumRoleChange: "Matsayi",
    ofcNavOrganisation: "Sassa da ofisoshi",
    ofcOrTitle: "Kungiyar",
    ofcOrIntro: "Wanda ke aiki da wa, wanda ke da alhakinsu, da inda suke zaune. Sashe jiki ne; matsayi shi ne abin da mutum zai iya yi. Ana bukatar dukansu kuma babu wanda ya maye gurbin dayan.",
    ofcOrDepartments: "Sassa",
    ofcOrOffices: "Ofisoshin haraji",
    ofcOrOfficesBody: "Inda jami’ai ke zaune, wanda ba yankin da suke rufewa ba ne. Ofishin Jos North yana kula da kananan hukumomi uku.",
    ofcOrNewDepartment: "Kara sashe",
    ofcOrNewOffice: "Kara ofishi",
    ofcOrCode: "Lamba",
    ofcOrFunction: "Aikin da yake yi",
    ofcOrHead: "Wanda ke da alhakinsa",
    ofcOrParent: "Yana karkashin",
    ofcOrOfficers: "Jami’ai",
    ofcOrOpenCases: "Kararrakin da ba a rufe ba",
    ofcOrCovers: "Yana kula da",
    ofcOrClose: "Rufe",
    ofcOrPosting: "Matsayi",
    ofcOrPostingBody: "Ana rubuta kowane bangare da ya motsa a matsayin canjin kansa mai kwanan wata, don haka matsawa zuwa Kudi da sauya wanda ake bayar da rahoto gare shi suna da amsoshi daban.",
    ofcOrMoveOfficer: "Matsar da wannan jami’i",
    ofcOrDepartment: "Sashe",
    ofcListCouldNotLoad: "Ba a iya loda wannan jerin ba.",
    ofcOrOffice: "Ofishi",
    ofcOrSupervisor: "Yana bayar da rahoto ga",
    ofcOrJobTitle: "Mukami",
    ofcOrStaffNumber: "Lambar ma’aikaci",
    ofcOrWhyMoving: "Dalilin matsawa",
    ofcOrEffectiveFrom: "Daga",
    ofcOrHistory: "Tarihin matsayi",
    ofcOrHistoryBody: "Ana kara kawai. Ana tambayar wa ke da alhakin wani yanki a wani wata a jayayyar haraji, kuma amsar da za a iya gyarawa daga baya ba amsa ba ce.",
    ofcOrNobody: "Babu kowa",
    ofcOrUnposted: "Ba a saka ba",
    ofcCwEscalate: "Daukaka",
    ofcCwEscalateBody: "Yana aika karar ga jami’in da ke sama, tare da duk tarihinta. Idan babu kowa a sama, zai fada maimakon a sa alamar daukaka a bar ta a nan.",
    ofcCwEscalateReason: "Dalilin bukatar wani a sama",
    ofcCwEscalatedTo: "An daukaka zuwa",
    ofcNoneDepartments: "Ba a kirkiri wani sashe ba tukuna.",
    ofcNoneOffices: "Ba a kirkiri ofishin haraji ba tukuna.",
    ofcNoneTransfers: "Ba a rubuta wani matsayi ga wannan jami’i ba.",
    enumCollection: "Karbar kudi",
    enumFinance: "Kudi",
    enumAudit: "Bincike",
    enumEnforcement: "Aiwatarwa",
    enumTaxpayerServices: "Hidimar masu biyan haraji",
    enumAdministration: "Gudanarwa",
    enumTechnology: "Fasaha",
    enumPosting: "Matsayi",
    enumDepartment: "Sashe",
    enumOffice: "Ofishi",
    enumTerritory: "Yanki",
    ofcDbByChannel: "Yadda kudin ya shigo",
    ofcDbByChannelBody: "An rubuta shi a kan kowace ma’amala tun farkon manhajar, kuma ba a taba tarawa ba har yanzu. Shi ne adadin da ke bayan kowane shawara kan inda za a sanya wakilai.",
    ofcDbByTaxpayerType: "Mutane da kasuwanci",
    ofcDbByItem: "Haraji bisa kowane nau’i",
    ofcDbByItemBody: "Mataki daya kasa da nau’in, inda alhakin wani yake.",
    ofcDbReversed: "An soke",
    ofcDbRefunded: "An mayar",
    ofcDbAgentsOnline: "Wakilan da ke aiki yanzu",
    ofcDbAgentsOnlineHint: "Sun yi aiki cikin mintuna goma sha biyar da suka wuce",
    ofcDbAgentsSuspended: "Wakilan da aka dakatar",
    ofcDbExpectedRevenue: "An kima kuma ba a biya ba",
    ofcDbExpectedRevenueHint: "Kudin da aka riga aka fitar da takardar biya kuma ana bin sa. Ba hasashe ba.",
    ofcNavTaxpayerAnalytics: "Masu biyan haraji",
    ofcTaTitle: "Masu biyan haraji",
    ofcTaIntro: "Ba yawan mutanen da ke rajista ba, sai dai nawa ne har yanzu ke biya, sau nawa, da kuma inda wadanda suka daina suke.",
    ofcTaActive: "Suna biya",
    ofcTaActiveHint: "Sun biya wani abu cikin kwanaki casa’in da suka wuce",
    ofcTaInactive: "Sun daina biya",
    ofcTaNeverPaid: "Ba su taba biya ba",
    ofcTaTotal: "A rajista",
    ofcTaNewThisMonth: "An yi rajista wannan watan",
    ofcTaAverageLifetime: "Matsakaicin abin da kowa ya biya",
    ofcTaFrequency: "Sau nawa mai biya yake biya",
    ofcTaFrequencyBody: "An rarraba maimakon a dauki matsakaici. Matsakaici a cikin jama’a inda mafi yawa suka biya sau daya kuma kadan suka biya sau goma sha biyu ba ya siffanta kowa a cikinsu.",
    ofcTaByLga: "Rajista bisa karamar hukuma",
    ofcTaByCategory: "Harajin da masu rajista ke da alaka da su",
    ofcTaTaxpayersAssessed: "An kima",
    ofcTaTaxpayersPaid: "Sun biya",
    ofcTaAveragePayment: "Matsakaicin biya",
    ofcTaComplianceScore: "Matsakaicin makin bin doka",
    ofcTaOutstanding: "Abin da ake bin su",
    ofcCmByPlace: "Kwamishan bisa karamar hukuma",
    ofcCmByPeriod: "Kwamishan bisa wata",
    ofcCmAccrued: "An tara",
    ofcCmPaidOut: "An biya",
    ofcCmOutstandingCommission: "Bai biya ba",
    enumOnce: "Sau daya",
    enumTwoToThree: "Sau biyu ko uku",
    enumFourToEleven: "Sau hudu zuwa goma sha daya",
    enumTwelveOrMore: "Sau goma sha biyu ko fiye",
    ofcDbYesterday: "Jiya",
    ofcDbThisWeek: "Wannan makon",
    ofcDbVsYesterday: "kan jiya",
    ofcDbVsLastWeek: "kan kwanakin makon jiya",
    ofcDbVsLastMonth: "kan kwanakin watan jiya",
    ofcDbVsLastYear: "kan wannan lokaci na bara",
    ofcDbNoComparison: "ba a tara komai a lokacin ba, don haka babu kwatanci",
    ofcDbLastMonthWhole: "Duk watan jiya",
    ofcDbDeclining: "Nau’ikan da suka tara kasa da watan jiya",
    ofcDbDecliningBody: "Idan aka jera bisa girma, nau’in da ya ragu da rabi zai kasance a saman kuma zai yi kama da lafiya. Wannan bayanai iri daya ne aka jera bisa hanya.",
    ofcDbNoneDeclining: "Babu abin da ke tarawa kasa da watan jiya.",
    ofcDbChange: "Canji",
    ofcDbShareOfMonth: "Kason watan",
    ofcRvAverageTransaction: "Matsakaicin ma’amala",
    ofcRvCompliance: "Rajistar da ke biya",
    ofcRvComplianceHint: "Kason masu biyan haraji da aka yi rajista a nan da suka biya wani abu a lokacin.",
    ofcPfGrowth: "Kan watan jiya",
    ofcPfCategories: "Harajin da ake aiki da su",
    enumCategory: "Nau’i",
    enumItem: "Harajin guda",
    enumLga: "Karamar hukuma",
    ofcNavTargets: "Manufura da hasashe",
    ofcTgTitle: "Manufofin haraji",
    ofcTgIntro: "Abin da Hukumar ke tsammanin tarawa, da abin da ya shigo a kansa.",
    ofcTgSetTarget: "Sanya manufa",
    ofcTgScope: "An sanya wa",
    ofcTgScopeState: "Duk Jihar",
    ofcTgScopeLga: "Karamar hukuma daya",
    ofcTgScopeCategory: "Nau’in haraji daya",
    ofcTgScopeItem: "Harajin guda daya",
    ofcTgScopeAgent: "Wakili daya",
    ofcTgPeriod: "Lokaci",
    ofcTgPeriodDaily: "Kullum",
    ofcTgPeriodWeekly: "Mako-mako",
    ofcTgPeriodMonthly: "Wata-wata",
    ofcTgPeriodQuarterly: "Kwata-kwata",
    ofcTgPeriodAnnual: "Shekara-shekara",
    ofcTgAmount: "Adadin manufa",
    ofcTgNeedAmount: "Ka shigar da adadin da za a karba a wannan lokaci.",
    ofcTgNeedLga: "Ka zabi Karamar Hukumar da wannan manufa ta shafa.",
    ofcTgNeedCategory: "Ka zabi rukunin haraji da wannan manufa ta shafa.",
    ofcTgNote: "Dalilin wannan adadi",
    ofcTgTarget: "Manufa",
    ofcTgCollected: "An tara",
    ofcTgAchievement: "Cimma buri",
    ofcTgGap: "Rata",
    ofcTgThroughPeriod: "Cikin lokacin",
    ofcTgRollup: "Manufar jiha da abin da aka raba a karkashinta",
    ofcTgRollupBody: "Ba lallai su daidaita ba. Adadin Jihar yakan dauki karin sarari, kuma karamar hukuma da ba ta da manufa ita ce abin lura mafi amfani.",
    ofcTgStateTarget: "Manufar jiha",
    ofcTgApportioned: "An raba wa kananan hukumomi",
    ofcTgLgasWithout: "Kananan hukumomin da ba su da manufa",
    ofcTgWithdraw: "Janye",
    ofcTgWithdrawReason: "Dalilin janyewa",
    ofcTgSuperseded: "Wannan ya maye gurbin manufar da ta gabata na wannan lokaci.",
    ofcTgSetBy: "Wanda ya sanya",
    ofcTgShowSuperseded: "Hada da wadanda aka sauya ko janye",
    ofcNoneTargetsSet: "Ba a sanya manufa don wannan lokaci ba.",
    ofcFcTitle: "Hasashe",
    ofcFcNotATarget: "Wannan hasashe ne, ba manufa ba kuma ba tabbataccen kudin shiga ba. Lissafi ne kan abin da aka tara ya zuwa yanzu da abin da shekarun baya suka yi a wannan lokaci.",
    ofcFcProjected: "Hasashen lokacin",
    ofcFcBasis: "An lissafa daga",
    ofcFcConfidence: "Tabbaci",
    ofcFcSeasonalShare: "Yawanci ana tarawa ya zuwa yanzu",
    ofcFcComparablePeriods: "Lokutan da aka kwatanta",
    ofcFcProjectedAchievement: "Hasashe kan manufa",
    forecastSeasonal: "An tsara shi bisa yadda ake tarawa: an yi amfani da shekarun baya don sanin kaso nawa ake tarawa ya zuwa yanzu.",
    forecastRunRate: "Kai tsaye bisa saurin tarawa. Babu isasshen tarihi don sanin yadda ake tarawa, don haka watakila ba daidai ba ne a farko da karshen lokacin.",
    forecastTooEarlyInCurve: "Shekarun baya kusan ba su tara komai ba ya zuwa yanzu, don haka ba za a iya amfani da yadda ake tarawa ba tukuna. An nuna saurin tarawa kai tsaye.",
    forecastPeriodComplete: "Lokacin ya kare. Wannan shi ne ainihin adadin, ba hasashe ba.",
    forecastNotStarted: "Lokacin bai fara ba. Babu abin da za a yi hasashe daga gare shi tukuna.",
    enumSeasonal: "Yadda ake tarawa",
    enumRunRate: "Saurin tarawa",
    enumInsufficientHistory: "Babu isasshen tarihi",
    enumAwaitingInformation: "Ana jiran bayani",
    enumEscalated: "An daukaka",
    enumInvestigating: "Ana bincike",
    enumAgentConduct: "Halin wakili",
    enumCommissionQuery: "Tambaya kan kwamishan",
    enumDataCorrection: "Gyaran bayanai",
    enumFraudInvestigation: "Binciken zamba",
    enumGeneral: "Na gama-gari",
    enumReconciliationException: "Bambancin lissafi",
    enumRevenueAnomaly: "Rashin daidaito a haraji",
    enumSystemIssue: "Matsalar manhaja",
    enumTaxpayerDispute: "Takaddamar mai biyan haraji",
    enumApproval: "Amincewa",
    enumFraudFlag: "Alamar hadari",
    enumManual: "Jami’i ya bude",
    enumSupportTicket: "Takardar taimako",
    enumAssignment: "An ba wa",
    enumComment: "Sharhi",
    enumDueDateChange: "An sauya ranar karshe",
    enumEscalation: "An daukaka",
    enumEvidence: "An hada hujja",
    enumNote: "Bayanin cikin gida",
    enumPriorityChange: "An sauya muhimmanci",
    enumResolution: "Warware",
    enumRouted: "An tura",
    enumStatusChange: "An sauya matsayi",
    ofcCwSubject: "Batu",
    ofcCwDescription: "Abin da ya faru",
    ofcCwCategory: "Nau’i",
    ofcCwRisk: "Hadari",
    ofcCwPriority: "Muhimmanci",
    ofcCwDepartment: "Aika wa",
    ofcCwAssignee: "Ba wa",
    ofcCwNobody: "Babu kowa tukuna",
    ofcCwAnyDepartment: "Babu sashe",
    ofcCwDue: "Ranar karshe",
    ofcCwOnlyOpen: "Kararrakin da ba a rufe ba kadai",
    ofcCwOnlyOverdue: "Wadanda suka wuce lokaci kadai",
    ofcCwOpenedBy: "Wanda ya bude",
    ofcCwCaseNumber: "Kara",
    ofcCwComments: "Sharhi",
    ofcCwEvidence: "Hujja",
    ofcCwBackToQueue: "Koma jerin aikin",
    ofcCwHistory: "Tarihi",
    ofcCwAddComment: "Kara sharhi",
    ofcCwInternalNote: "Ajiye wannan a matsayin bayanin cikin gida",
    ofcCwMention: "Ambaci jami’i",
    ofcCwPost: "Aika",
    ofcCwMoveCase: "Matsar da wannan kara",
    ofcCwChangeStatus: "Sauya matsayi",
    ofcCwResolution: "Abin da ya kammala",
    ofcCwResolutionRequired: "Fada abin da karar ta kammala kafin ka warware ta.",
    ofcCwSaved: "An adana.",
    ofcCwNotYours: "Ba a ba ka wannan kara ba kuma ba kai ka bude ta ba, don haka za ka iya yin sharhi kadai.",
    ofcCwAbout: "Game da",
    ofcCwWhy: "Dalili",
    ofcReasonAtLeastChars: "Akalla haruffa {{n}}.",
    ofcCwSubjectTooShort: "Ba karar batu na akalla haruffa biyar.",
    ofcCwSampleSubject: "Karbar kudi ta ninka sau uku ba tare da sabbin masu biyan haraji ba",
    ofcCwSampleDescription: "Fada abin da ka gani, a ina, da abin da kake so dayan sashen ya duba.",
    ofcCwAppendOnly: "Ba za a iya gyara ko cire komai a nan ba. Gyara wani shigarwa ne.",
    ofcNoneCasesMatchFilter: "Babu kara da ya dace da wadannan tacewa.",
    ofcT3Title: "Fayil din ma’amala",
    ofcT3Intro: "Cikakken labarin karbar kudi guda, daga mai biyan haraji zuwa asusun gwamnati.",
    ofcT3Find: "Nemo ma’amala",
    ofcT3FindBody: "Lambar ma’amala, ko lambar rasit daga sakon dan kasa.",
    ofcT3Chain: "Sarkar",
    ofcT3Assessment: "Kima",
    ofcT3Invoice: "Takardar biya",
    ofcT3Payment: "Biyan kudi",
    ofcT3Gateway: "Kofar biyan kudi",
    ofcT3Settlement: "Turawar kudi",
    ofcT3Reconciliation: "Daidaita lissafi",
    ofcT3Commission: "Kwamishan",
    ofcT3Refunds: "Mayar da kudi",
    ofcT3Timeline: "Abin da ya faru, bi da bi",
    ofcT3TimelineBody: "Rijistar manhajar da ayyukan jami’ai, a agogo guda.",
    ofcT3Platform: "Manhaja",
    ofcT3OfficerAction: "Aikin jami’i",
    ofcT3Before: "Kafin",
    ofcT3After: "Bayan",
    ofcT3CasesAndFlags: "Kararraki da alamun hadari",
    ofcT3OpenCaseAbout: "Bude kara game da wannan ma’amala",
    ofcT3Withheld: "Ba a nuna wa matsayinka ba",
    ofcT3WithheldBody: "Wadannan sassan suna nan amma izininka bai kai gare su ba. An ambace su domin kada a dauki sashe mara komai a matsayin rijista mara komai.",
    ofcT3NoPayment: "Ba a yi yunkurin biyan kudi ba.",
    ofcT3NoReceipt: "Ba a bayar da rasit ba.",
    ofcT3NoSettlement: "Kudin bai isa asusun gwamnati ba tukuna.",
    ofcT3NoCommission: "Ba a samu kwamishan ba.",
    ofcT3NoReconciliation: "Wannan bai wuce ta zagayen daidaita lissafi ba.",
    ofcT3Channel: "Hanya",
    ofcT3Where: "Ina",
    ofcT3ServiceCharge: "Kudin hidima",
    ofcT3Verified: "An tabbatar",
    ofcT3NothingLinked: "Babu kara ko alamar hadari da ke da nasaba da wannan ma’amala.",
    ofcGroupAdministration: "Gudanarwa",
    ofcGroupAgentsProgrammes: "Wakilai da shirye-shirye",
    ofcGroupAssessment: "Kima",
    ofcGroupConfiguration: "Saituna",
    ofcGroupEverything: "Duk abin da za ka iya budewa",
    ofcGroupExamination: "Bincike",
    ofcGroupMyTerritory: "Yankina",
    ofcGroupOversight: "Sa ido",
    ofcGroupRevenueHere: "Harajin nan",
    ofcGroupRevenue: "Haraji",
    ofcGroupSettlement: "Tura kudi",
    ofcGroupTheMoney: "Kudin",
    ofcGroupTheRegister: "Rajistar",
    ofcGroupWhatCharged: "Abin da aka caje",
    ofcGroupWhoCollected: "Wanda ya karba",
    ofcGroupWhoDidIt: "Wanda ya yi",
    ofcPortalName: "Shafin PSIRS",
    ofcStateGovernment: "Gwamnatin Jihar Filato",
    ofcReturnToDashboard: "Koma allon aiki",
    ofcSignOut: "Fita",
    ofcPageNotFound: "Wannan shafin babu shi.",
    ofcReadOnly: "karatu kawai",
    ofcDailyTrend: "Yanayin karban kudi na kullum",
    ofcNoDataForPeriod: "Babu bayanai na wannan lokacin.",
    ofcLoginTitle: "Shafin Harajin PSIRS",
    ofcLoginPhone: "Lambar waya",
    ofcLoginPassword: "Kalmar sirri",
    ofcLoginMonitored: "Ana sa ido kan shiga. Ana rubuta duk abin da ka yi a rajistar bincike.",
    ofcLoginWrongPlace: "Asusunka na manhajar wakilai ne",
    ofcLoginSignInWorked: "Shigarka ta yi aiki — kawai ba wurin da ya dace ba ne.",
    ofcLoginUseAgentApp: "Wakilan filin aiki suna karbar haraji a manhajar wakilai ta PSIRS, wadda ke aiki ba tare da layi ba kuma tana rike da masu biyan harajinka, kimarka da kwamishan dinka. Wannan shafin na jami’an haraji, kudi da sa ido ne.",
    shellSyncFailed: "Ba a iya tura rikodin da ka adana zuwa PSIRS ba. Suna nan a wannan wayar.",
    grpNameHint: "Kamar yadda kungiyar da kanta ta bayar",
    grpCommunityHint: "Inda kungiyar ke haduwa. Ba dole ba.",
    grpLeaderNameHint: "Mutumin da zai iya tabbatar da wanda ke cikinta",
    grpLeaderPhoneHint: "Ana tura masa hanyar tabbatar da jerin mambobi",
    grpMemberCountHint: "Kiyasi ya isa. Ba dole ba.",
    stepUpCodeFailed: "Ba a iya tura lamba ba.",
    stepUpAuthoriseFailed: "Ba a iya bada izinin wannan ba.",
    pubVerdictValid: "INGANTACCE",
    pubVerdictAcknowledgement: "INGANTACCE — BA RASIT BA NE",
    pubVerdictReversed: "AN JUYAR DA SHI",
    pubVerdictNotFound: "BA A SAMU BA",
    pubVerdictInvalid: "BA INGANTACCE BA",
    colChangeChoice: "Canza",
    moreMonths: "Watanni {{n}}",
    supGetHelpHint: "Ka kai rahoton matsala ga PSIRS. Za ka samu amsa a nan, da sako idan akwai abin karantawa.",
    authKeepItSafe: ". Ka adana ta lafiya.",
    moreSearchVehicleFirst: "Ka fara neman motar. An yiwa rikodin da hukumar motoci ta tabbatar alama.",
    moreVehicleSavedBody: "An adana wannan motar a wayarka kuma za a tura ta zuwa PSIRS ta atomatik idan ka dawo kan layi. Ba a duba hukumar motoci ba tukuna, kuma ba za a iya fara sabuntawa ko biyan kudi ba sai an tura ta.",
    moreVehicleCaptureBody: "Ka rubuta abin da ka gani a kan motar. Za a tura shi — a kuma duba shi da hukumar — da zarar ka dawo kan layi. Ba za ka iya karbar kudin sabuntawa ba sai lokacin.",
    moreOwnerName: "Sunan mai motar",
    moreOwnerNameHint: "Kamar yadda aka rubuta a takardun",
    moreOwnerPhone: "Wayar mai motar",
    moreMotorcycle: "Babur / Acaba",
    moreTricycle: "Keke napep",
    moreRegistrationLabel: "Lambar rajista",
    moreOwnerLabel: "Mai motar",
    moreVehicleLabel: "Mota",
    moreChassis: "Lambar jiki",
    moreCurrentExpiry: "Karewar yanzu",
    moreAuthorityConfirmed: "Hukuma ta tabbatar",
    moreEnteredManually: "A’a — an shigar da hannu",
    moreChooseRenewal: "Ka zabi wace sabuntawa ake biya.",
    moreFindPayingTaxpayer: "Ka nemo mai biyan haraji da ke biyan wannan sabuntawar. Dole a danganta kowane biyan kudi ga wani.",
    moreReceiptsIssuedAfter: "Gwamnati ce ta bayar da kowanne rasit a nan bayan an tabbatar da biyan kudin da kansa.",
    morePendingWord: "ana jira",
    morePaidWord: "an biya",
    moreTransactionsWord: "ma’amaloli",
    moreOwedBackBody: "an biya shi a kan ma’amalolin da aka juyar da su daga baya. Ana cire shi daga biyan ka na gaba, don haka za ka karbi kasa da adadin da ke sama.",
    moreOwedBackDeducted: "da ake bin ka za a cire shi.",
    moreConfirmPayout: "Tabbatar da biyan kwamishan",
    moreCommissionAvailableWhen: "Kwamishan yana samuwa ne bayan an tura ma’amalar zuwa asusun gwamnati kuma lokacin rikewa ya wuce. Za a tura maka lamba ta sau daya domin tabbatar da bukatar.",
    moreDeviceId: "Lambar na’ura",
    morePrinterHint: "Ka hada na’urar buga takarda ta Bluetooth ta 58mm ko 80mm domin bayar da rasit na takarda nan take ga masu biyan haraji a wurare masu nisa.",
    moreConnectedDevice: "Na’urar da aka hada",
    morePaperWidth: "Fadin takarda",
    moreNone: "Babu",
    morePaper58: "58mm (na kowa)",
    morePaper80: "80mm (mai fadi)",
    morePrintTestSlip: "Buga takardar gwaji",
    morePairPrinter: "Hada na’urar buga takarda ta Bluetooth",
    moreNoWebBluetooth: "Wannan burauzar ba ta goyon bayan Web Bluetooth ba (ka yi amfani da Chrome a Android ko kwamfuta).",
    morePrinterConnected: "An hada da na’urar buga takarda ta Bluetooth.",
    morePrinterConnectFailed: "Hadin ya gagara.",
    morePrinterTestSent: "An tura rasit na gwaji zuwa na’urar buga takarda!",
    morePrinterPrintFailed: "Buga takarda ya gagara.",
    morePushHint: "Ka karbi sanarwa nan take idan shaidarka ta wuce, mai shaida ya amsa, ko an sasanta kwamishan.",
    morePermission: "Izini",
    morePushEngine: "Na’urar tura sanarwa",
    moreSupported: "Ana goyon baya",
    moreUnavailable: "Babu",
    morePushDisabled: "An kashe sanarwar turawa.",
    morePushActive: "Sanarwar turawa tana aiki!",
    morePushNotGranted: "Ba a bayar da izini ba.",
    morePushFailed: "Ba a iya saita sanarwar turawa ba.",
    moreChangeBankHint: "Canza asusun bankin da PSIRS ke biyan kwamishan dinka. Yana bukatar lamba ta sau daya, tabbatarwa daga banki da amincewar jami’i, don haka za a ci gaba da amfani da asusunka na yanzu sai an cika ukun.",
    moreSupportHint: "Ka kai rahoton matsala ga PSIRS — biyan kudi da ba a tabbatar ba, rasit da ba ya kama da daidai, ko duk abin da mai biyan haraji ya yi korafi a kai.",
    moreSavedRecordsHint: "Abubuwan da aka rubuta ba tare da layi ba. Ana tura su zuwa PSIRS ta atomatik idan ka samu hanyar sadarwa.",
    moreBack: "Koma baya",
    moreCommissionOnlyVerified: "Ana biyan kwamishan ne kawai cikin asusun da PSIRS ta tabbatar da banki, kuma bayan jami’i ya amince da canjin. Za a ci gaba da amfani da asusunka na yanzu har lokacin.",
    moreBankMustConfirm: "PSIRS ba za ta iya amincewa da canji ba sai banki ya tabbatar cewa asusun naka ne. Idan bayanan ba daidai ba ne, ka nemi shugabanka ya ki wannan bukatar domin ka tura wadanda suka dace.",
    moreToldEitherWayBody: "Sako zai zo wayarka idan an amince ko an ki wannan. Canji daya ne kawai zai iya jira a lokaci guda.",
    morePaidIntoNow: "Ana biya a nan yanzu",
    moreWouldChangeTo: "Zai canza zuwa",
    moreNameOnNewAccount: "Sunan da ke sabon asusun",
    moreBankCheck: "Dubawar banki",
    moreBankCheckConfirmed: "An tabbatar",
    moreBankCheckConfirmedAs: "An tabbatar a matsayin {{name}}",
    moreBankCheckWaiting: "Ana jira — ba a iya samun banki ba",
    moreBankCheckNotConfirmed: "Ba a tabbatar ba",
    moreBankCheckNotConfirmedBecause: "Ba a tabbatar ba: {{reason}}",
    moreReasonYouGave: "Dalilin da ka bayar",
    moreBankLabel: "Banki",
    moreBankCodeHint: "Lambar lambobi 3 zuwa 6 da banki ke amfani da ita",
    moreAccountNameHint: "Daidai yadda banki yake da shi",
    moreNeedBankName: "Ka zabi bankin da sabon asusun yake.",
    moreNeedBankCode: "Ka shigar da lambar banki. Lamba ce ta lambobi 3 zuwa 6 da banki ke amfani da ita, ba lambar asusunka ba.",
    moreNeedAccountName: "Ka shigar da sunan da asusun yake a kansa, daidai yadda banki yake da shi.",
    moreNeedAccountNumber: "Lambar asusu ta Najeriya lambobi 10 ce.",
    moreNeedReason: "Ka fadi dalilin canza asusun, da akalla haruffa 10.",
    colNeedBaseAmount: "Ka shigar da kudin da aka gina kimar a kansa, da naira.",
    colNoTin: "Babu TIN",
    colBasisAmountHint: "Misali kudin shiga, riba ko darajar kwangila. Gwamnati ce ke saita kudin da kansa.",
    colTaxpayerLabel: "Mai biyan haraji",
    colRevenueLabel: "Haraji",
    colGovernmentRevenue: "Harajin gwamnati",
    colServiceCharge: "Kudin hidima da aka amince da shi",
    colTotalPayable: "Jimlar da za a biya",
    colInvoiceLabel: "Takardar biya",
    colPaymentStatus: "Matsayin biyan kudi",
    colGatewayReference: "Lambar tashar biya",
    colPrinting: "Ana tura rasit zuwa na’urar buga takarda ta Bluetooth...",
    colPrinted: "An buga rasit cikin nasara a na’urar Bluetooth!",
    colPrintFailed: "Buga takarda ta Bluetooth ya gagara: {{reason}}",
    colCheckPrinter: "Ka duba hadin na’urar buga takarda",
    colPrintBluetooth: "Buga (Bluetooth)",
    colReceiptCopied: "An kwafi bayanan rasit. Za ka iya liko su cikin sako.",
    colPreparingInvoice: "Ana shirya takardar biya…",
    colGiveInvoice: "Ba mai biyan haraji takardar biya",
    colInvoiceHint: "Sanarwar biya da za a iya bugawa, dauke da lambar takardar biya, abin da ake biya da yadda aka lissafa kudin",
    colInvoiceValidUntil: ", yana aiki har {{date}}",
    colInvoiceGiveReference: "Ka ba su lambar biyan kudi {{reference}} shi ma — wannan ne abin da banki ko tashar USSD ke nema.",
    colInvoiceNoReference: "Ka fara biyan kudin idan suna son biya a banki: lambar da banki ke nema ana bayar da ita a lokacin, kuma takardar biya ba ta dauke da ita ba.",
    colCheckingPayment: "Ana dubawa tare da tsarin biyan kudi…",
    colCheckPaymentStatus: "Duba matsayin biyan kudi",
    colStartingPayment: "Ana fara biyan kudi…",
    colStartPayment: "Fara biyan kudi",
    colChargeRaisedTitle: "An yi kimantawa, amma ba a fara biyan kudi ba.",
    colChargeRaisedBody:
      "Ma’amala {{reference}} ta wanzu yanzu kuma mai biyan haraji na bin ta. Kada ka sake lissafa wannan — sake gwadawa zai haifar da kimantawa ta biyu a kan abu daya, kuma za a bukaci a biya dukansu. Ka bude ma’amalar domin ba shi takardar biya ko ka sake fara biyan kudin.",
    colOpenCharge: "Bude wannan ma’amala",
    colDevGateway: "Tashar gwaji",
    colDevGatewayHint: "Wannan dandalin yana aiki da tashar biyan kudi ta gwaji. Ka yi amfani da wadannan don kwaikwayon abin da tashar gaske za ta bayar.",
    colSimulateSuccess: "Kwaikwayon nasara",
    colSimulateFailure: "Kwaikwayon gazawa",
    grpConfirmedMembers: "Mambobin da aka tabbatar: {{n}}",
    homeQaRenewVehicle: "Sabunta mota",
    homeQaFindTaxpayer: "Nemo mai biyan haraji",
    homeQaCheckReceipt: "Duba rasit",
    homeQaHandOut: "Bayar da rabo",
    homeQaGroups: "Kungiyoyi",
    homeGoodMorning: "Barka da safiya",
    homeGoodAfternoon: "Barka da rana",
    homeGoodEvening: "Barka da yamma",
    homeAccountSuspended: "An dakatar da asusun wakilcinka",
    homeApplicationProcessing: "Ana ci gaba da sarrafa bukatarka",
    homeTransactions: "ma’amaloli",
    homeCommissionWord: "kwamishan",
    homeRegisteredWord: "an yi rajista",
    homePendingTitle: "Biyan kudi {{n}} na jiran tabbatarwa",
    homePendingBody: "Ba a tabbatar da wadannan ba tukuna. Kada ka sake ce wa mai biyan haraji ya biya — ka bude ma’amalar don duba matsayinta.",
    supNormal: "Na yau da kullum",
    supProblemCameBack: "Idan matsalar ta dawo,",
    supReportItAgain: "ka sake bayar da rahoto",
    supKeepsHistory: "domin ya ci gaba da tarihinsa.",
    supCatPayment: "Biyan kudi bai wuce ba",
    supCatReceipt: "Rasit ba daidai ba ne ko ya bata",
    supCatAssessment: "Kudin da aka caje ba daidai ba ne",
    supCatTin: "Mai biyan haraji babu TIN tukuna",
    supCatVehicle: "Matsalar sabunta mota",
    supCatTechnical: "Manhajar ba ta aiki",
    supCatComplaint: "Mai biyan haraji yana da korafi",
    supCatUnauthorised: "An caji wani kudi da bai kamata ba",
    supCatUnauthorisedHint: "Ka yi amfani da wannan idan an nemi mai biyan haraji kudi ba tare da kima ta hukuma ba.",
    supCatMisconduct: "Kai rahoton halin wani wakili",
    supCatMisconductHint: "Wannan zai je sashen sa ido na PSIRS, ba ga wakilin da abin ya shafa ba.",
    supWhatHappenedHint: "Ka hada duk abin da PSIRS za ta bukata don nemo shi.",
    supTransactionHint: "Idan wannan game da biyan kudi daya ne, lambar tana taimaka wa PSIRS ta same shi ba tare da tambayar ka ba.",
    supSending: "Ana turawa…",
    supSendToPsirs: "Tura zuwa PSIRS",
    supSendWord: "Tura",
    supReopenedNotice: "An sake bude wannan rahoton domin PSIRS ta duba.",
    supAbout: "Game da",
    supTransactionLabel: "Ma’amala",
    supReported: "An bayar da rahoto",
    verifyScanHint: "Ka duba murabba’in da ke kan rasit, ko ka rubuta lambar da ke kasansa. PSIRS na tabbatar ko an bayar da rasit — karanta lambar kawai yana gaya maka abin da ke kan takardar.",
    verifyOfflineBody: "Ba za a iya duba rasit ba sai ta PSIRS, don haka wannan yana bukatar hanyar sadarwa. Za ka iya duba lambar sannan ka tantance ta idan ka dawo kan layi.",
    verifyCouldNotReach: "Ba a iya samun PSIRS ba, don haka ba a iya duba wannan rasit ba.",
    verifyNotAReceiptCode: "Wannan QR code ba lambar tantancewa ta PSIRS ba ce. Ka rike rasit a cikin firam.",
    verifyCameraFailed: "Ba a iya bude kyamara ba. Maimakon haka ka rubuta lambar da aka buga karkashin murabba’in QR.",
    verifyChecking: "Ana dubawa tare da PSIRS…",
    verifyCheckThisCode: "Duba wannan lambar",
    verifyRevenueItem: "Nau’in haraji",
    verifyIssued: "An bayar",
    verifyFingerprint: "Sa hannun takardar",
    verifyMatchesOriginal: "Ya yi daidai da na asali",
    verifyNotConfirmed: "Ba a iya tabbatarwa ba",
    allocScanHint: "Ka duba ko ka rubuta lambar karban da aka ba mai amfana. Ka rubuta ta kafin ka mika komai — ana amfani da lamba sau daya kawai, wannan ne ke hana a karbi rabo iri daya sau biyu.",
    allocOfflineBody: "Ba a iya samun PSIRS ba, don haka ba a rubuta wannan karban ba. Kada ka mika komai sai an rubuta shi.",
    allocFailed: "Ba a iya rubuta karban ba. Ka sake gwadawa.",
    allocNotACode: "Wannan lambar ba lambar karba ta PSIRS ba ce. Ka rike ta a cikin firam.",
    allocCameraFailed: "Ba a iya bude kyamara ba. Maimakon haka ka rubuta lambar.",
    allocRecordCollection: "Rubuta wannan karban",
    allocGive: "Ka ba",
    grpListHint: "Kungiyoyin da ka yi wa rajista, da duk wanda jami’i ya rubuta domin ka yi aiki da su. Ba a jera kungiyoyin wani wakili a nan ba.",
    grpEmpty: "Babu kungiyoyi tukuna. Idan ka hadu da kungiyar hadin kai, kungiyar kasuwa ko kungiyar sana’a, ka yi mata rajista a nan domin a shigar da mambobinta tare.",
    grpRegisterHint: "Ka rubuta kungiyar da kanta, da wanda ke shugabanta. Ana kara mambobi bayan jami’i ya amince da kungiyar.",
    grpNoAssessmentBody: "Yin rajistar kungiya yana nuna cewa tana nan. Ba a caji kowa komai ba, kuma ba a kara wani mamba ba, sai jami’i ya amince da ita.",
    grpMemberHint: "Dole ne a fara yi wa mutumin rajista a matsayin mai biyan haraji. Ka neme shi da suna, waya ko TIN.",
    grpAskLeaderHint: "Ana biyan ka kwamishan a kan abin da wadannan mambobin suka biya, don haka maganarka kadai cewa wani na cikinsu ba ta isa ba. Shugaban kungiyar da kansa ne ke tabbatar da jerin.",
    grpRegisterGroup: "Yi rajistar kungiya",
    grpRecordThisMember: "Rubuta wannan mamba",
    grpSendLeaderLink: "Tura wa shugaba hanyar tabbatarwa",
    grpFarmers: "Kungiyar hadin kan manoma",
    grpMarket: "Kungiyar kasuwa",
    grpTransport: "Kungiyar masu sufuri",
    grpArtisan: "Kungiyar masu sana’a",
    grpTraders: "Kungiyar ’yan kasuwa",
    grpFisheries: "Kungiyar masunta",
    grpLivestock: "Kungiyar masu dabbobi",
    grpOther: "Wani",
    grpLocalGovernment: "Karamar Hukuma",
    grpLeader: "Shugaba",
    grpMembersConfirmed: "Mambobin da aka tabbatar",
    grpAwaitingLeader: "Ana jiran shugaba",
    authSigningIn: "Ana shiga…",
    authPasswordHint: "Akalla haruffa 8, tare da harafi da lamba",
    authPasswordPatternHint: "Akalla haruffa 8, tare da akalla harafi daya da akalla lamba daya.",
    authBankName: "Sunan banki",
    authAccountName: "Sunan asusu",
    authAccountNumber: "Lambar asusu",
    authTenDigits: "Lambobi 10",
    authSubmitting: "Ana turawa…",
    authSubmitApplication: "Tura bukata",
    authPsirsFull: "Hukumar Karbar Haraji ta Cikin Gida ta Jihar Filato",
    authRevenueNeverToAgent: "Ba a taba biyan kudin gwamnati cikin asusun wakili ba. Ana amfani da wannan asusun ne kawai domin biyan kwamishan da ka samu.",
    stepUpNoSms: "Ba a saita SMS na gaske ba, don haka an nuna lambar a nan:",
    shellMain: "Babban",
    shellNothingLost: "Ba a rasa komai ba — rikodin na nan a wayar kuma za a tura su idan an gyara wannan.",
    shellRestoring: "Ana dawo da zamanka…",
    shellAgentTitle: "Wakilin Haraji na PSIRS",
    shellAgentBrand: "Wakilin Haraji na Jihar Filato",
    uiLoading: "Ana lodi",
    tpFindTaxpayer: "Nemo mai biyan haraji",
    tpSearchHint: "Ka bincika da suna, sunan kasuwanci, lambar waya, TIN, lambar rasit ko lambar mota.",
    tpSearchPlaceholder: "Suna, waya ko TIN",
    tpSearchByNamePhoneTin: "Ka bincika da suna, lambar waya ko TIN",
    tpNoTinYet: "Babu TIN tukuna",
    tpRegisterNew: "Yi rajistar sabon mai biyan haraji",
    tpTaxpayerPaying: "Mai biyan haraji",
    tpUnnamedTaxpayer: "Mai biyan haraji marar suna",
    tpChooseSomeoneElse: "Zabi wani",
    tpStepTin: "Lambar TIN",
    tpStepDetails: "Bayanai",
    tpStepIdentification: "Shaida",
    tpStepAddress: "Adireshi",
    tpStepActivity: "Sana’a",
    tpStepReview: "Duba",
    tpStepOf: "Mataki {{n}} na {{total}}",
    tpSavedOnDevice: "An adana a wannan na’ura",
    tpNotYetSent: "Ba a tura zuwa PSIRS ba tukuna",
    tpSavedOfflineBody: "An adana wannan rajistar a wayarka kuma za a tura ta ta atomatik idan ka dawo kan layi. Ba a bayar da TIN ba tukuna, kuma ba za a iya karbar kudi ba sai an tura ta.",
    tpBackToHome: "Koma shafin farko",
    tpTaxpayerRegistered: "An yi wa mai biyan haraji rajista",
    tpGiveTinToTaxpayer: "Ka ba mai biyan haraji wannan lambar. Za su bukace ta a duk biyan kudi na gwamnati.",
    tpTinRequested: "An tura bukatar TIN",
    tpTinPending: "Sashen TIN bai dawo da lamba ba tukuna. Za ta bayyana a bayanan mai biyan haraji da zarar an ba shi.",
    tpCollectRevenue: "Karbi haraji",
    tpEnumerate: "Rubuta yadda kasuwancin yake",
    agEnTitle: "Yadda kasuwancin yake",
    agEnIntro: "Ka rubuta abin da kake gani. Ba kai ne kake sanya farashi ba — ofis shi ke fitar da mataki daga abin da ka rubuta, kuma za a sanar da mai biyan haraji da takarda.",
    agEnWho: "Wane ne",
    agEnPremises: "Inda yake kasuwanci",
    agEnPremisesHint: "Abin da kake gani yau, ba abin da ya ce zai gina ba.",
    agEnEquipment: "Injuna ko kayan aiki",
    agEnEquipmentHint: "Ka kirga abin da ake amfani da shi don kasuwanci. Ka rubuta 0 idan babu.",
    agEnPeople: "Mutanen da ke aiki banda mai shi",
    agEnPeopleHint: "Har da almajirai da ’yan uwa da ke aiki a wurin. Ka rubuta 0 idan mai shi kadai ke aiki.",
    agEnSector: "Sana’a",
    agEnGroup: "Kungiyar kasuwa",
    agEnGroupHint: "Idan yana cikin daya, za a tambayi shugaba ya tabbatar da abin da ka rubuta.",
    agEnNoGroupChosen: "Ba ta hannun kungiya ba",
    agEnNoGroupsTitle: "Babu kungiyar da za a bi",
    agEnNoGroups: "Babu wata kungiyarka da aka ba ta rawa a kidaya har yanzu. Ka rubuta duk da haka — jami’i na iya tambayar shugaba daga baya.",
    agEnNoAmountTitle: "Ba kai ne kake sanya harajin ba",
    agEnNoAmount: "Babu adadi a wannan takarda kuma ba za a sa ba. Idan mai kasuwanci ya tambaya nawa ne, ka ce masa ofis zai aika da sanarwa, kuma yana da damar kalubalantar ta.",
    agEnChoose: "Zaba",
    agEnSave: "Ajiye abin da ka gani",
    agEnSaving: "Ana ajiyewa…",
    agEnRecordedTitle: "An rubuta",
    agEnBand: "Girman da aka rubuta",
    agEnWhatHappensNextTitle: "Abin da zai biyo baya",
    agEnNextWithLeader: "Za a tambayi shugaban kungiya ya tabbatar da wannan. Ba a caji komai ba sai jami’i ya duba shi.",
    agEnNextWithoutLeader: "Jami’i zai duba wannan. Ba a caji komai ba tukuna, kuma mai biyan haraji na iya kalubalanta idan ya karbi sanarwa.",
    agEnBackToTaxpayer: "Koma ga mai biyan haraji",
    agEnQueuedTitle: "Yana kan wannan wayar",
    agEnQueuedNext: "Babu sigina, don haka wannan bai kai ofis ba tukuna. Za a aika da shi da kansa idan wayar ta koma kan layi — kada ka sake rubuta shi. Ofis zai sake duba girman idan ya iso.",
    agEnBandSoFarTitle: "Girma daga abin da ka rubuta",
    agEnBandSoFar: "Wannan kasuwanci na {{band}} ne bisa abin da ka shigar. Idan mai kasuwanci ya tambaya, wannan shi ne abin da aka rubuta. Ba shi ne adadin kudi ba — ofis zai fitar da shi ya aika da sanarwa.",
    tpViewProfile: "Duba bayanai",
    verifyReceiptFingerprintMismatch: "Akwai rasit mai wannan lamba, amma takardar da aka adana ba ta yi daidai da asalin sa ba. Ka dauki takardar da aka ba ka a matsayin wadda ba a tabbatar ba, kuma ka sanar da PSIRS.",
    verifyReceiptReversed: "An bayar da wannan rasit amma an juyar da biyan kudin ko an mayar da shi tun daga nan. Ba ya kara zama shaidar biya.",
    verifyReceiptVoided: "An soke wannan rasit kuma ba ya aiki.",
    verifyReceiptGenuine: "Wannan rasit na gwamnati ne na gaskiya wanda PSIRS ta bayar.",
    verifyReceiptGenuineUnchecked: "Wannan rasit na gwamnati ne na gaskiya wanda PSIRS ta bayar. Ba a iya duba kwafin da aka adana a yanzu ba, don haka ba a tabbatar da asalin sa a wannan yunkurin ba.",
    verifyNotFound: "Babu takardar gwamnati da ta yi daidai da wannan lamba ko lambar tabbatarwa. Idan an ba ka rasit mai wannan lamba, ba PSIRS ce ta bayar da shi ba.",
    verifyPaymentReversed: "An juyar da wannan biyan kudin kuma ana mayar da kudin ga wanda ya biya, don haka ba a bayar da rasitin gwamnati a kansa ba. Takardar ba ta kara zama shaidar biya. Idan ba ka karbi kudin ba, ka tuntubi PSIRS da wannan lamba.",
    verifyDocumentRevoked: "An soke wannan takardar kuma ba ta kara aiki.",
    verifyDocumentFingerprintMismatch: "Takardar da aka adana ba ta yi daidai da asalin sa ba. Ka sanar da PSIRS.",
    verifyAcknowledgementNotReceipt: "Wannan tabbacin karbar kudi ne na gaskiya daga PSIRS, kuma BA rasitin gwamnati ba ne. Tsarin biyan kudi ya tabbatar da biyan; kudin bai kai asusun gwamnati ba tukuna. Ana bayar da rasit ta atomatik da zarar ya kai, kuma ana iya duba shi a nan haka nan.",
    verifyDocumentExpired: "Wannan takardar ta kare a {{date}}.",
    verifyDocumentGenuine: "Wannan takardar gwamnati ce ta gaskiya wadda PSIRS ta bayar.",
    verifyDocumentGenuineUnchecked: "Wannan takardar gwamnati ce ta gaskiya wadda PSIRS ta bayar. Ba a iya duba kwafin da aka adana a yanzu ba, don haka ba a tabbatar da asalin sa a wannan yunkurin ba.",
    tpPossibleExisting: "Mai biyan haraji da watakila yana nan",
    tpDupIdentityNumber: "An riga an yi rajistar wannan lambar shaida",
    tpDupPhoneAndName: "Lambar waya daya da suna daya",
    tpDupPhone: "An riga an yi rajistar wannan lambar waya ga wani mai biyan haraji",
    tpDupBusinessNameInLga: "An riga an yi rajistar wani kasuwanci mai wannan suna a wannan karamar hukuma",
    tpDupNameInLga: "An riga an yi rajistar wani mai biyan haraji mai wannan suna a wannan karamar hukuma",
    tpDupCouldNotList: "Ba a iya nuna bayanan da suka yi daidai ba",
    tpDupCouldNotListBody: "PSIRS ta ce watakila wannan kwafi ne, amma ba a iya lodin bayanan da ta samu ba, don haka ba za ka iya duba su a nan ba. Ka sake gwadawa. Idan bai lodi ba, ka nemi mutumin da lambar waya kafin ka sake yi masa rajista.",
    tpDupTryAgain: "Sake gwada nuna su",
    actionTryAgain: "Sake gwadawa",
    tpCheckSamePerson: "Ka duba ko daya daga cikin wadannan shi ne mutumin kafin ka bude sabuwar rajista.",
    tpNoneOfThese: "Babu daya daga cikinsu — yi rajistar sabon mai biyan haraji",
    tpHasTin: "Mai biyan haraji yana da TIN kuwa?",
    tpYes: "Eh",
    tpNo: "A’a",
    tpExistingTin: "TIN da yake da shi",
    tpExistingTinHint: "Za mu tabbatar da shi ta sashen TIN na PSIRS",
    tpBasicInfo: "Bayanai na asali",
    tpRegisteringAs: "Ana yin rajista a matsayin",
    tpAnIndividual: "Mutum daya",
    tpABusiness: "Kasuwanci",
    tpBusinessName: "Sunan kasuwanci",
    tpTypeOfBusiness: "Nau’in kasuwanci",
    tpFirstName: "Sunan farko",
    tpMiddleName: "Sunan tsakiya",
    tpLastName: "Sunan karshe",
    tpDateOfBirth: "Ranar haihuwa",
    tpPhoneNumber: "Lambar waya",
    tpEmailAddress: "Adireshin imel",
    tpNeedBusinessName: "Ka rubuta sunan kasuwancin.",
    tpIdentificationHint: "Ba dole ba ne, amma yana taimakawa wajen hana maimaita rajista. Ana adana lambar cikin tsaro kuma ba a taba nuna ta gaba daya ba.",
    tpLga: "Karamar Hukuma",
    tpSelectLga: "Zabi Karamar Hukuma",
    tpWardHint: "Inda ake bayar da rahoton haraji. Ba tare da shi ba, ba za a iya kirga wannan karban a kasa da matakin Karamar Hukuma ba.",
    tpChooseLgaFirst: "Ka zabi Karamar Hukuma tukuna",
    tpNoWardsListed: "Babu unguwannin da aka jera",
    tpListCouldNotLoad: "Ba a iya loda wannan jerin ba.",
    tpSelectWard: "Zabi unguwa",
    tpCommunity: "Al’umma",
    tpBusinessOrActivity: "Kasuwanci ko sana’a",
    tpEconomicSector: "Bangaren tattalin arziki",
    tpSelectSector: "— Zabi bangare —",
    tpSuggestedObligations: "Harajin da aka ba da shawara ga {{sector}}",
    tpConfirmWhichTaxes: "Ka tabbatar da harajin da ya shafi wannan mai biyan haraji. Za ka iya kara wasu daga baya.",
    tpOccupation: "Sana’a (ba dole ba)",
    tpBusinessActivity: "Sana’ar kasuwanci (ba dole ba)",
    tpReviewConfirm: "Duba ka tabbatar",
    tpType: "Nau’i",
    tpBusiness: "Kasuwanci",
    tpIndividual: "Mutum",
    tpName: "Suna",
    tpPhone: "Waya",
    tpLgaShort: "Karamar Hukuma",
    tpWard: "Unguwa",
    tpWillBeRequested: "Za a nema",
    tpConsent: "Mai biyan haraji ya yarda a yi amfani da bayanansa ta PSIRS domin gudanar da harkokin haraji.",
    tpDeclaration: "Mai biyan haraji ya bayyana cewa bayanan da aka bayar gaskiya ne kuma daidai.",
    tpBack: "Koma baya",
    tpContinue: "Ci gaba",
    tpRegistering: "Ana yin rajista…",
    tpRegisterTaxpayer: "Yi rajistar mai biyan haraji",
    tpYouAreOffline: "Ba ka kan layi",
    tpSaveOfflineBody: "Ka adana wannan rajistar a na’ura. Za a tura ta zuwa PSIRS ta atomatik idan ka dawo kan layi, sannan a nemi TIN.",
    tpSaveOnDevice: "Adana a wannan na’ura",
    tpNotYetAssigned: "Ba a ba da shi ba tukuna",
    tpTransactionsYouFacilitated: "Ma’amalolin da ka gudanar",
    tpNoTransactions: "Ba ka gudanar da wata ma’amala ga wannan mai biyan haraji ba.",
    tpWhatYouCanSee: "Abin da za ka iya gani a nan",
    tpVehicles: "Motoci",
    tpExpires: "Zai kare {{date}}",
    tpNoRenewal: "Babu sabuntawa a rajista",
    camCancel: "Soke",
    appStageSubmitted: "An mika bukata",
    appStageKyc: "An tabbatar da shaida",
    appStageReview: "A shirye don nazarin gwamnati",
    appStageApproved: "PSIRS ta amince",
    appStageTraining: "An kammala horo",
    appStageDevice: "An yi rajistar na’ura",
    appStageActive: "Wakili mai aiki",
    appActionNeeded: "Ana bukatar mataki",
    appSuspended: "An dakatar da asusunka",
    appNotApproved: "Ba a amince da bukatar ba",
    appContactSupervisor: "Ka tuntubi shugabanka ko sashen taimako na PSIRS domin sanin abin da za ka yi na gaba.",
    appTakePhotograph: "Dauki hoto",
    appTakeAgain: "Sake daukar hoto",
    appSending: "Ana turawa...",
    appDocumentNotSent: "Ba a iya tura takardar ba.",
    appIdDocument: "Takardar shaidarka",
    appIdDocumentHint: "Ka dauki hoton katin da kansa, a shimfide kuma a bayyane, kusurwoyi hudu duka suna bayyana.",
    appSelfie: "Hotonka",
    appSelfieHint: "A dauka yanzu, kana rike da takardar guda, domin PSIRS ta ga sun yi daidai.",
    appJustCaptured: "an dauka yanzu",
    appKycHint: "PSIRS na duba shaidarka a rajistar kasa. Ana adana lambar shaidarka cikin tsaro kuma ba a taba nuna ta gaba daya ba.",
    appSubmitForVerification: "Tura don tabbatarwa",
    appVerifying: "Ana tabbatarwa…",
    appStillNeeded: "Abin da ya rage kafin a iya turawa:",
    appStatus: "Matsayi",
    appClearFilters: "Sake saita",
    appDocumentOnFile: "Takardar da ke rijista",
    appRefereeNoAccount: "Ba sa bukatar asusu — za su karbi hanyar sadarwa mai tsaro.",
    appRefereeShareLink: "Idan mai shaidarka bai karbi sakon ba, ka aika masa da wannan hanyar kai tsaye:",
    appRefereeConfirmedYour: "ya tabbatar da bukatarka.",
    appRefereeSentRequest: "an tura masa bukatar tabbatarwa. Za ka iya zabar wani idan ba zai iya amsawa ba.",
    appRefereeLinkHere: "Za su karbi hanyar tabbatarwa a nan",
    appNominateReplacement: "Zabi wani mai shaida",
    appSendVerification: "Tura bukatar tabbatarwa",
    appTrainingAllComplete: "An kammala dukkan horon wajibi.",
    appTrainingRemaining: "Sauran darussa {{done}} cikin {{total}} da za a kammala.",
    appPassMark: "matakin cin jarabawa",
    appNoAssessment: "babu jarabawa",
    appBankHint: "An tabbatar kafin a biya kowane kwamishan. Kudin gwamnati ba ya shiga wannan asusun ko kadan.",
    appBankVerifiedMsg: "An tabbatar da asusun bankinka.",
    appBankCouldNotVerify: "Ba a iya tabbatar da asusun ba.",
    appAcceptAgreementText: "Na karanta kuma na amince da {{title}} (sigar {{version}}).",
    appDeviceLabel: "Na’ura",
    appAppVersion: "Sigar manhaja",
    appNotRegistered: "Ba a yi rajista ba",
    appRegisteredDevice: "Na’urar da aka yi wa rajista",
    errNetwork: "Ba a iya samun PSIRS ba. Ka sake gwadawa.",
    appYourApplication: "Bukatarka",
    appBeingProcessed: "Ana sarrafa bukatarka",
    appClearedToCollect: "An ba ka izinin karbar haraji",
    appAllRequirementsMet: "An cika dukkan sharudan izinin.",
    appCannotCollectUntil: "Ba za ka iya karbar haraji ba sai an kammala dukkan sharudan da ke kasa.",
    appStillOutstanding: "Sauran da ba a kammala ba",
    appBlockerKyc: "Ba a duba shaidarka ba tukuna",
    appBlockerReferee: "Babu mai shaida da ya tabbatar da kai tukuna",
    appBlockerGovernmentApproval: "PSIRS ba ta amince da bukatarka ba tukuna",
    appBlockerTraining: "Ba ka kammala horon da ake bukata ba",
    appBlockerBank: "Ba a tabbatar da asusun bankin kwamishan dinka ba",
    appBlockerAgreement: "Ba ka amince da yarjejeniyar wakili ba",
    appBlockerDevice: "Ba a yi rajistar wata na’ura da sunanka ba",
    appComplete: "An kammala",
    appGoToDashboard: "Je shafin aikina",
    appIdentityVerification: "Tabbatar da shaida",
    appIdentificationType: "Nau’in shaida",
    appIdentificationNumber: "Lambar shaida",
    appEnterIdInFull: "Ka shigar da lambar shaidarka gaba daya kafin ka tura.",
    appPreviousAttemptRejected: "Ba a karbi yunkurin da ya gabata ba",
    appDocumentNotAccepted: "Ba a karbi wannan takardar ba",
    appDocuments: "Takardu",
    appNotCaptured: "Ba a dauka ba",
    appReferee: "Mai shaida",
    appRefereeFullName: "Cikakken sunan mai shaida",
    appRefereePhone: "Lambar wayar mai shaida",
    appRefereeEmail: "Imel na mai shaida",
    appHowDoTheyKnowYou: "Ta yaya ya san ka?",
    appWhoIsThisPerson: "Wanene wannan mutumin?",
    appRefereeConfirmed: "Mai shaida ya tabbatar",
    appWaitingReferee: "Ana jiran mai shaidarka",
    appVerificationSent: "An tura bukatar tabbatarwa",
    appTraining: "Horo",
    appAgreement: "Yarjejeniyar wakili",
    appAcceptAgreement: "Amince da yarjejeniya",
    appAgreementAccepted: "An amince da yarjejeniya",
    appAgreementRecorded: "An rubuta amincewarka.",
    appReadCarefully: "Ka karanta wannan sosai. Yana bayyana abin da za ka iya yi da abin da ba za ka iya yi ba.",
    appBankAccount: "Asusun bankin kwamishan",
    appVerifyBankAccount: "Tabbatar da asusun bankina",
    appBankVerified: "An tabbatar da asusun banki",
    appCommissionPaidHere: "Za a biya kwamishan dinka a wannan asusun.",
    appRegisterDevice: "Yi rajistar wannan na’ura",
    appOtherDevices: "Sauran na’urori",
    appDeviceOnlyRegistered: "Ba za a iya karbar haraji ba sai daga na’urar da PSIRS ta yi wa rajista da sunanka.",
    appDeviceAfterApproval: "Za ka iya yin rajistar na’ura da zarar PSIRS ta amince da bukatarka.",
    appRefereeWhoIs: "Mai shaida shi ne wanda ya san ka kuma zai iya tabbatar da kai ga PSIRS.",
    idNin: "Lambar Shaidar Kasa",
    idBvn: "Lambar Tabbatar da Banki",
    idPassport: "Fasfo na kasa da kasa",
    idLicence: "Lasisin tuki",
    idVoters: "Katin zabe",
    refCivilServant: "Ma’aikacin gwamnati",
    refCommunityLeader: "Shugaban unguwa",
    refDistrictHead: "Hakimin unguwata",
    refReligiousLeader: "Shugaban addini",
    refTraditionalAuthority: "Sarauta",
    refProfessional: "Kwararre da aka sani",
    refEmployer: "Ma’aikaci",
    moreThisDevice: "Wannan na’ura",
    moreSignOut: "Fita",
    moreSomethingWrong: "Akwai matsala?",
    moreGetHelp: "Nemi taimako",
    moreViewApplication: "Duba bukatata da izinina",
    moreWhereCommissionPaid: "Inda ake biyan kwamishan dinka",
    moreCommissionRecordNotAccount: "Wannan bayanin kwamishan ne, ba asusun banki ba",
    moreChangeBankAccount: "Canza asusun bankina",
    moreAskDifferentAccount: "Nemi wani asusun daban",
    moreAuthoriseChange: "Ba da izinin wannan canjin",
    moreAuthorisePayout: "Ba da izinin wannan biyan",
    moreChangeWaiting: "Ana jiran PSIRS ta duba canjin",
    moreNothingChangesYet: "Babu abin da zai canza sai jami’i ya amince.",
    moreToldEitherWay: "Za a sanar da kai ko ta yaya",
    moreBankNotConfirmed: "Banki bai tabbatar da wannan asusun ba",
    moreWhyChanging: "Dalilin canjin",
    moreAccountName: "Sunan da ke kan asusun",
    moreAccountNumber: "Lambar asusu",
    moreBankCode: "Lambar banki",
    moreCommissionHistory: "Tarihin kwamishan",
    moreNoCommission: "Ba a rubuta kwamishan ba tukuna.",
    moreAvailableForPayout: "Wanda ake iya biya",
    moreRequestPayout: "Nemi a biya ka",
    moreRequestingPayout: "Kana neman a biya ka",
    moreSomeCommissionOwedBack: "Ana bin ka wasu kwamishan",
    moreSomeCommissionOnHold: "An dakatar da wasu kwamishan",
    moreOnHoldBody: "an dakatar da shi kuma ba a kirga shi cikin ko daya daga cikin alkaluman da ke sama ba. Ana rike shi yayin da ake duba wani abu game da wadannan karbe-karben. Ka tambayi shugabanka abin da ya rage.",
    moreCommissionApproved: "An amince a biya wasu kwamishan",
    moreApprovedBody: "an amince da shi kuma yana jiran a biya. Ba za ka iya sake neman sa ba, kuma bai kai asusunka ba tukuna.",
    moreSomeCommissionReversed: "An juyar da wasu kwamishan",
    moreReversedBody: "an same shi a kan karbe-karben da aka juyar da su daga baya, kuma ba a taba biyan sa ba. Ba za ka karbe shi ba. Wannan ya bambanta da abin da ake bin ka.",
    moreReceiptsFacilitated: "Rasit da ka taimaka a bayar",
    moreNoReceipts: "Babu rasit tukuna.",
    moreSavedRecords: "Bayanan da aka ajiye a wannan na’ura",
    moreNothingWaiting: "Babu abin da ke jiran a aika.",
    moreSavedOnPhone: "An ajiye a wannan wayar",
    moreVehicleRenewal: "Sabunta takardun mota",
    moreSearchVehicle: "Nemo mota",
    moreRegistrationNumber: "Lambar rajista",
    moreVehicleType: "Nau’in mota",
    morePrivate: "Na kaina",
    moreCommercial: "Na kasuwanci",
    moreRenewalService: "Sabis na sabuntawa",
    moreSelectRenewalType: "Zabi nau’in sabuntawa",
    moreRenewalPeriod: "Tsawon sabuntawa",
    moreCalculateProceed: "Lissafa ka ci gaba zuwa biyan kudi",
    moreSaveVehicleOnPhone: "Ajiye motar a wannan wayar",
    moreCaptureOffline: "Rubuta ba tare da intanet ba",
    moreVehicleAuthorityUnreachable: "Ba a iya isa ga hukumar motoci ba",
    moreTryVehicleAuthorityAgain: "Sake gwada hukumar motoci",
    morePrinter: "Na’urar buga rasit",
    moreDisconnect: "Cire hadi",
    morePushTitle: "Sakonnin gargadi kai tsaye",
    moreContinue: "Ci gaba",
    grpTitle: "Kungiyoyi da hadin gwiwa",
    grpRegister: "Yi rajistar kungiya",
    grpName: "Sunan kungiya",
    grpKind: "Wace irin kungiya",
    grpChooseOne: "Zabi daya",
    grpLeaderName: "Sunan shugaba",
    grpLeaderPhone: "Lambar wayar shugaba",
    grpLga: "Karamar Hukuma",
    grpCommunity: "Unguwa",
    grpMemberCount: "Kimanin adadin mambobi",
    grpRecordMember: "Rubuta mamba",
    grpMember: "Mamba",
    grpRecorded: "An rubuta",
    grpWaitingOfficer: "Ana jiran jami’i",
    grpAskLeaderConfirm: "Ka nemi shugaba ya tabbatar",
    grpSendToLeader: "Tura wannan ga shugaba",
    grpNoAssessment: "Wannan ba ya sanya wa kowa haraji",
    authSignInTitle: "Shiga domin ci gaba",
    authSignIn: "Shiga",
    authPhoneHint: "Ka yi amfani da lambar wayar da ka yi rajista da ita a PSIRS.",
    authPassword: "Kalmar sirri",
    authApply: "Nemi zama wakili",
    authApplyTitle: "Nemi zama wakilin karbar haraji",
    authBackToSignIn: "Koma shiga",
    authYourDetails: "Bayananka",
    authFullName: "Cikakken suna",
    authPhone: "Lambar waya",
    authEmail: "Adireshin imel",
    authDateOfBirth: "Ranar haihuwa",
    authOccupation: "Sana’a",
    authWhereYouLive: "Inda kake zama",
    authAddress: "Adireshin gida",
    authSelectLga: "Zabi Karamar Hukumarka",
    authNeedDocuments: "Za ka bukaci takardun shaida, bayanan banki da mai shaida.",
    authWhatNext: "Abin da zai biyo baya",
    authNextSignIn: "Ka shiga ka kammala tabbatar da shaidarka.",
    authNextReferee: "Ka gabatar da mai shaida wanda zai iya tabbatar da kai.",
    authNextReview: "PSIRS za ta duba bukatarka.",
    authNextClearance: "Ka kammala horo, tabbatar da banki da rajistar na’ura.",
    authApplicationReceived: "An karbi bukatar",
    authApplicationNumber: "Lambar bukatarka ita ce",
    colWhoIsPaying: "Wa ke biya?",
    colSearchTaxpayer: "Nemo mai biyan haraji",
    colNamePhoneTin: "Suna, waya ko TIN",
    colChangeTaxpayer: "Canza mai biyan haraji",
    colRegisterNew: "Yi rajistar sabon mai biyan haraji",
    colWhatPaying: "Me suke biya?",
    colRevenueItem: "Nau’in haraji",
    colSelectItem: "Zabi nau’in haraji",
    colBasisAmount: "Adadin da ake lissafin haraji a kai (₦)",
    colCalculate: "Lissafa adadi",
    colHowCalculated: "Yadda aka lissafa wannan adadin",
    colAboutToCollect: "Za ka karba",
    colConfirmProceed: "Tabbatar ka ci gaba zuwa biyan kudi",
    colDownloadReceipt: "Sauke rasit",
    colShareReceipt: "Raba rasit",
    colHistory: "Tarihi",
    colBackHome: "Koma shafin farko",
    colOfflineTitle: "Ba ka da intanet",
    colOfflineBody: "Ba za a iya karbar haraji ba tare da intanet ba. Dole tsarin biyan kudi ya tabbatar da kudin gwamnati kafin a sami rasit.",
    supGetHelp: "Nemi taimako",
    supReportProblem: "Kai korafi",
    supMyReports: "Korafina",
    supNothingReported: "Ba ka kai wani korafi ba tukuna.",
    supWhatProblem: "Menene matsalar?",
    supChooseOne: "Zabi daya",
    supShortSummary: "Takaitaccen bayani",
    supWhatHappened: "Me ya faru?",
    supHowUrgent: "Yaya gaggawarsa?",
    supNotUrgent: "Ba gaggawa ba",
    supUrgent: "Gaggawa — mai biyan haraji na jira",
    supVeryUrgent: "Gaggawa kwarai — kudi na iya cikin hadari",
    supTransactionRef: "Lambar ma’amala",
    supBeforeYouSend: "Kafin ka tura wannan",
    supConversation: "Tattaunawa",
    supAddToReport: "Kara a kan wannan korafin",
    supReportClosed: "An rufe wannan korafin",
    supReopened: "An sake budewa",
    allocHandOut: "Bayar da kason taimako",
    allocScanCode: "Duba lambar",
    allocStopScanning: "Daina duba",
    allocTypeCode: "Ko rubuta lambar karba",
    allocRecorded: "An rubuta",
    allocCodeUsed: "An riga an yi amfani da wannan lambar. Idan mai amfana ya dawo da ita, PSIRS ba za ta karba ba.",
    scanCamera: "Kyamara",
    rcpGovernment: "GWAMNATIN JIHAR FILATO",
    prnNoWritable: "Ba a samu hanyar bugawa a wannan na’ura ba.",
    prnNotConnected: "Ba a hada da na’urar bugawa ba. Ka hada da daya tukuna.",
    prnSendFailed: "Na’urar bugawa ba ta karbi bayanan ba. Ka sake gwadawa.",
    prnDisconnected: "Na’urar bugawa ta katse.",
    slipTestOk: "GWAJIN NA’URAR BUGAWA YA YI",
    slipWidth: "Fadi",
    slipStatus: "Matsayi",
    slipConnected: "An hada (BLE)",
    slipReady: "Na’urar POS a shirye take",
    rcpThanks: "Mun gode da sauke nauyin ku",
    rcpBureau: "HUKUMAR KARBAR HARAJI",
    rcpPlatform: "Tsarin Karbar Haraji na Dijital",
    rcpTitle: "RASIT NA HARAJI NA HUKUMA",
    rcpDateTime: "Kwanan Wata / Lokaci",
    rcpReference: "Lambar Tunani",
    rcpLga: "Karamar Hukuma",
    rcpWard: "Gunduma",
    rcpTaxpayer: "Mai Biyan Haraji",
    rcpPhone: "Lambar Waya",
    rcpItem: "Hidima",
    rcpCategory: "Rukuni",
    rcpAgentCode: "Lambar Wakili",
    rcpAgentName: "Sunan Wakili",
    rcpScanToVerify: "DUBA DOMIN TANTANCE SAHIHANCI",
    rcpCheckOffice: "Ka duba wannan rasit a",
    rcpCheckOfficeCont: "kowane ofishin PSIRS.",
    rcpOffice: "Ofishin Karbar Harajin Gwamnati",
    rcpVehAdmin: "HUKUMAR KULA DA MOTOCI",
    rcpVehLicensing: "Lasisi da Sabunta Takardun Mota",
    rcpVehTitle: "TAKARDAR SABUNTA MOTA",
    rcpVehPlate: "Lambar Mota",
    rcpVehDoc: "Lambar Takarda",
    rcpVehOwner: "Mai Mota",
    rcpVehMakeModel: "Nau’i/Samfuri",
    rcpVehYear: "Shekara",
    rcpVehChassis: "Lambar Chassis",
    rcpVehFrom: "Yana aiki daga",
    rcpVehUntil: "Yana aiki har",
    rcpVehFee: "KUDIN DA AKA BIYA",
    rcpVehOfficial: "TAKARDAR HUKUMA TA DIJITAL",
    rcpVehCheck: "Ka duba lambar a PSIRS.",
    connOnline: "Akwai hanyar sadarwa",
    connOnlineDetail: "Duk ayyukan suna aiki.",
    connLimited: "Hanyar sadarwa mai rauni",
    connLimitedDetail: "Hanyar sadarwarka tana da rauni. Tabbatar da biyan kudi na iya daukar lokaci — kada ka fara biyan kudi sau biyu.",
    connOffline: "Babu hanyar sadarwa",
    connOfflineDetail: "Za ka iya yin rajistar mai biyan haraji ka kuma rubuta sana’a, za a aika dukansu idan ka dawo kan layi. Ba a iya biyan kudi ba yayin da babu hanyar sadarwa.",
    appRecordsWaiting: "bayanan da aka ajiye suna jiran aikawa",
    stepUpSignInAgain: "Ka sake shiga don neman lamba.",
    stepUpEnterCode: "Ka shigar da lambar sirri da aka aika zuwa wayarka domin amincewa da wannan aikin:",
    stepUpCodeRequired: "Ana bukatar lambar sirri kafin a ci gaba.",
    morePushUnsupported: "Wannan na’ura ko burauza ba ta goyon bayan sanarwar turawa ba.",
    errUploadFailed: "Ba a iya aika takardar ba. Ka sake gwadawa.",
    errUploadOffline: "Babu hanyar sadarwa. Ana aika takardar shaida zuwa PSIRS yayin daukarta, ba a ajiye ta a wannan na’ura ba — ka sake daukar hoton idan ka samu hanyar sadarwa.",
    scanCameraDenied: "PSIRS ba ta da izinin amfani da kyamara. Ka ba da izini a saitin burauzarka, ko ka rubuta lambar.",
    scanCameraMissing: "Ba a samu kyamara a wannan na’ura ba. Maimakon haka ka rubuta lambar.",
    scanCameraUnsupported: "Wannan burauzar ba ta iya bude kyamara ba. Maimakon haka ka rubuta lambar.",
    colInvoiceReady: "Takardar biyan kudi {{number}} tana shirye don bugawa ko aikawa.",
    morePayoutRequested: "An nemi biyan kudi. Za a biya bayan amincewar sashen kudi. Lamba: {{reference}}.",
    morePayoutClawback: "An nemi biyan {{amount}}. {{gross}} na kwamishan ya cancanta, an kuma cire {{clawback}} saboda ma’amalolin da aka juyar bayan an biya kwamishansu. Za a biya bayan amincewar sashen kudi. Lamba: {{reference}}.",
    agStepCodeSentTo: "Mun aika lamba zuwa {{phone}}. Don wannan aiki daya kadai ne.",
    appDraftsSynced: "An aika bayanai {{count}} da aka ajiye zuwa PSIRS.",
    appDraftsSyncedRejected: "An aika bayanai {{count}} da aka ajiye zuwa PSIRS, {{rejected}} na bukatar gyara.",
    errRequestFailed: "Bukatar ba ta yi nasara ba. Ka sake gwadawa, ko ka tuntubi tallafi.",
    ofcAgConfirmHowPrompt: "Ka bayyana yadda ka tabbatar da wannan canji tare da {{name}} (akalla haruffa 10):",
    ofcAgRefuseWhyPrompt: "Ka bayyana dalilin da ya sa ake ki wannan canji (akalla haruffa 10):",
    ofcAgAccountChanged: "An canza asusun kwamishan na {{name}}.",
    ofcAgChangeRefused: "An ki canjin {{name}}. Asusunsu na yanzu bai canza ba.",
    ofcAgNotConfirmed: "Ba a tabbatar ba",
    ofcAgNotConfirmedBecause: "Ba a tabbatar ba: {{reason}}",
    ofcAgAnOfficer: "Wani jami’i ({{role}})",
    ofcAgUnknownRole: "matsayin da ba a sani ba",
    ofcAgBankStillNotConfirmed: "Banki bai tabbatar da shi ba har yanzu ({{outcome}}).",
    ofcAlForfeitWhy: "Me ya sa aka kwace {{quantity}} na {{name}}?",
    ofcAlThisBeneficiary: "wannan mai amfana",
    ofcAlRoundOpened: "{{name}} a bude yake. Yanzu za a iya yin rabo.",
    ofcAlRoundClosed: "An rufe {{name}}. Babu sauran rabo.",
    ofcAlRoundCannotCloseBeforeOpen: "Zagaye ba zai iya rufewa kafin ya bude ba.",
    ofcCfItemAdded: "An kara {{name}} a cikin jerin. Ba shi da adadin kudi tukuna, don haka ba za a iya yin kima ba sai ka saita daya.",
    ofcCfNotAnAmount: "“{{amount}}” ba adadi ne a naira ba. Ka shigar da shi kamar 15000 ko 15000.00.",
    ofcCfNotAPercentage: "“{{value}}” ba kaso ne ba. Ka shigar da shi kamar 5 ko 5.00.",
    ofcCfRateRecorded: "An yi rijistar sabon adadin kudi na “{{name}}”, mai aiki daga {{date}}. ",
    ofcCfProgrammeStatus: "Shirin “{{name}}” yanzu {{status}}.",
    ofcCfRateCannotBeNegative: "Adadin kudi ba zai iya zama kasa da sifili ba.",
    ofcCfPercentageCannotExceed100: "Kaso ba zai iya wuce 100% ba.",
    ofcFaMinimumAboveRecommended: "Mafi karancin {{minimum}} ya wuce {{recommended}} da aka ba da shawara, don haka za a ki ko na’urar da ke da sabon salo.",
    ofcFaNoHandsetBelow: "Babu na’urar da ke aiki da ke kasa da {{version}}.",
    ofcFaHandsetWouldStop: "Na’ura {{count}} daga cikin {{total}} da ke aiki za ta daina karbar kudi har sai an sabunta ta.",
    ofcFaHandsetsWouldStop: "Na’urori {{count}} daga cikin {{total}} da ke aiki za su daina karbar kudi har sai an sabunta su.",
    ofcFnSettlementRecorded: "An yi rijistar {{reference}}. An daidaita tarin kudi {{count}}.",
    ofcFnSettlementDisputed: "An yi rijistar {{reference}} kuma an yi takaddama: kudin da aka shigar bai yi daidai da tarin kudin da ya shafa ba, don haka ba a daidaita ko daya daga cikinsu ba. Ka rufe takaddamar idan an gano sauran kudin.",
    ofcFnTotalCreditedPrompt: "Jimlar kudin da aka shigar kan {{reference}}, a naira. ",
    ofcFnReconciliationAborted: "Ba a gudanar da daidaitawa ba: {{reason}} ",
    ofcFnStatementUnavailable: "ba a iya samun bayanin kudi na kofar biyan kudi ba.",
    ofcFnReconciliationComplete: "An kammala daidaitawa: {{matched}} sun yi daidai, {{exceptions}} ba su yi daidai ba",
    ofcFnReconciliationUnchecked: ", lambobi {{count}} da ba a iya tambayar kofar biyan kudi a kansu ba",
    ofcFnTotalsAgree: ". Jimlar dandali da jimlar kofar biyan kudi sun yi daidai.",
    ofcFnTotalsDisagree: ". Jimlar dandali da jimlar kofar biyan kudi BA SU YI daidai BA.",
    ofcFnRecoverChecked: "An duba biyan kudi {{attempted}} da ba a tabbatar ba a kofar biyan kudi; an tabbatar da {{verified}} kuma an ba su rasit yanzu.",
    ofcFnReversalExecuted: "An zartar da juyawa a matsayin {{reference}}. An juyar da bayanan kwamishan {{count}}.",
    ofcGrApproved: "An amince da {{name}}. Yanzu za a iya rubuta mambobi.",
    ofcGrCollectedAt: " · ana karba a {{place}}",
    ofcKycAccepted: "An karbi {{document}}.",
    ofcKycRejectedNotice: "An ki {{document}}. Mai nema zai iya ganin dalili ya kuma sake tura wata.",
    ofcKycSubmittedByApplicant: "{{document}} da mai nema ya tura",
    ofcKycReasonGiven: "Dalilin da aka bayar: {{reason}}",
    ofcOvSweepRaised: "An kammala bincike. An daga tuta {{count}} domin dubawa.",
    ofcOvJobsNeedAttention: "Ayyuka {{count}} daga cikin {{total}} da aka tsara suna bukatar kulawa. Aikin da ba ya gudana ba ya haifar da abin dubawa, don haka nan kadai yake bayyana.",
    ofcRhInvoiceDocumentReady: "Takardar biyan kudi {{number}} tana shirye.",
    ofcRhPayoutApproved: "An amince da biyan {{reference}}.",
    ofcSpTicketMoved: "An mayar da takardar zuwa {{status}}.",
    verifyCheckReceipt: "Duba rasit",
    verifyScanQr: "Duba lambar QR",
    verifyTypeCode: "Ko rubuta lambar tantancewa",
    verifyOffline: "Ba ka da intanet",
    stepUpOneTimeCode: "Lambar amfani sau daya",
    stepUpExpired: "Lambar ta kare",
    stepUpAskNew: "Ka nemi sabuwa domin ci gaba.",
    stepUpSendNew: "Tura sabuwar lamba",
    stepUpCouldNotContinue: "Ba a iya ci gaba ba",
    stepUpDevelopmentBuild: "Sigar gwaji",
    appSignOut: "Fita",
    appSwitchLanguage: "Canza harshe",
    appPageNotFound: "Ba a sami shafin ba",
    appPageNotFoundBody: "Wannan shafin babu shi.",
    appReturnHome: "Koma shafin farko",
    appRecordsSynced: "An aika bayanan",
    appRecordsNotSent: "Ba a iya aika bayanan da aka ajiye ba",
    appUpdateRequired: "Ana bukatar sabuntawa",
    homeViewApplication: "Duba bukatata",
    homeCollectedToday: "An karba yau",
    homeQuickActions: "Ayyuka masu sauri",
    homeRecentTransactions: "Ma’amalolin baya-bayan nan",
    homeNoTransactions: "Babu ma’amala tukuna. Fara da yin rajista ko neman mai biyan haraji.",
    homeLifetime: "Jimla gaba daya",
    homeTaxpayersRegistered: "Masu biyan haraji da aka yi wa rajista",
    homeCommissionEarned: "Kwamishan da aka samu",
    homeAvailableForPayout: "Wanda ake iya biya",

    genuineReceipt: 'Rasit na gaskiya',
    receiptNotValid: 'Rasit din ba na gaskiya ba ne',
    receiptNotValidBody:
      'Babu takardar gwamnati da ta dace da wannan lamba ko code. Idan an ba ka rasit mai wannan lamba, ba PSIRS ce ta fitar da shi ba.',
    receiptCodeShape: 'Lambar tantancewa tana kama da T7C72-QTUDN. Ka duba lambar ka sake gwadawa.',

    needFirstName: 'Ka rubuta sunan farko na mai biyan haraji.',
    needLastName: 'Ka rubuta sunan karshe na mai biyan haraji.',
    needPhone: 'Ka rubuta cikakkiyar lambar wayar mai biyan haraji, misali 08012345678.',
    needAddress: 'Ka rubuta adireshin mai biyan haraji.',
    needLga: 'Ka zabi Karamar Hukuma.',
    needConsent: 'Dole mai biyan haraji ya yarda kafin ka yi masa rajista.',
    needDeclaration: 'Ka tabbatar da sanarwar kafin ka yi wa mai biyan haraji rajista.',
    needExistingTin:
      'Ka rubuta TIN din mai biyan haraji, ko ka zabi \u201cA\u2019a\u201d idan ba shi da shi tukuna.',
    birthDateFuture: 'Ranar haihuwar tana gaba a lokaci. Ka duba shekarar.',
    birthDateTooOld: 'Ranar haihuwar kafin shekarar 1900 ce. Ka duba shekarar.',
    birthDateMalformed: 'Ka rubuta ranar haihuwa da rana, wata da shekara.',
    emailIncomplete: 'Adireshin imel din bai cika ba. Ka gyara shi, ko ka bar shi babu komai.',

    deviceNotRegistered:
      'Ba a yi rajistar wannan na\u2019ura ga asusun wakilcin ka ba. Ka yi rajistar ta kafin ka karbi haraji.',
    deviceAfterApproval: 'Za ka iya yin rajistar na\u2019ura bayan PSIRS ta amince da bukatarka.',

    statusPaid: 'AN BIYA / AN TABBATAR',
    statusPending: 'ANA JIRA',
    statusFailed: 'BA TA YI BA',
    statusOffline: 'BA HANYAR SADARWA (OFFLINE)',
    statusOnline: 'AKWAI HANYAR SADARWA (ONLINE)',

    offlineMessage: 'Babu hanyar sadarwa a yanzu. Za a aika bayanan da zaran an samu netiwok.',
    offlineNotice: 'An ajiye a waya. Ba a karbi kudi a tsari ba har sai an tabbatar.',
    civicDutyThanks: 'Mun gode da kuka sauke nauyin da ya rataya a wuyanku.',
    paymentSuccess: 'An Biyar da Kudi Cikin Nasara',
    pubService: 'Hukumar Karbar Haraji ta Jihar Filato',
    pubLanguage: 'Harshe',
    pubEnglish: 'Turanci',
    pubHausa: 'Hausa',
    pubThankYou: 'NA GODE',
    pubVerifyTitle: 'Tantance rasitin gwamnati',
    pubVerifyField: 'Lambar rasit ko lambar tantancewa',
    pubVerifyAction: 'Tantance',
    pubVerifyChecking: 'Ana bincike…',
    pubVerifyReceiptNumber: 'Lambar rasit',
    pubVerifyRevenueType: 'Nau’in haraji',
    pubVerifyAmount: 'Adadi',
    pubVerifyIssued: 'Ranar bayarwa',
    pubVerifyLga: 'Karamar Hukuma',
    pubVerifyFingerprint: 'Hatimin takardar',
    pubVerifyMatches: 'Ya yi daidai da na asali',
    pubVerifyNoMatch: 'Bai yi daidai da na asali ba',
    pubVerifyPrivacy: 'Domin sirri, ba a taba nuna sunan mai biyan haraji, lambar waya ko TIN a wannan shafi ba.',
    pubRefereeTitle: 'Bukatar tantance wakili',
    pubRefereeIntro:
      '{{name}} ya nemi ya zama wakilin karbar haraji da izini. PSIRS na bukatar wanda ya san shi don tabbatar da ko wanene shi da cancantarsa.',
    pubRefereeApplicant: 'Mai neman',
    pubRefereeYouAre: 'An rubuta ka a matsayin',
    pubRefereeRelationship: 'Alakar da aka bayyana',
    pubRefereeCategory: 'Nau’in mai shaida',
    pubRefereeRespondBefore: 'Ka amsa kafin',
    pubRefereeConfirmEach: 'Da fatan za ka tabbatar da kowanne daga cikin wadannan:',
    pubDeclarationKnows: 'Na san wannan mutumin.',
    pubDeclarationAccurate: 'Bayanan da aka gabatar daidai ne gwargwadon saninna.',
    pubDeclarationWilling: 'Na yarda in tsaya masa a matsayin mai shaida.',
    pubDeclarationConsequences: 'Na fahimci cewa bayar da bayanan karya na iya haifar da hukunci.',
    pubRefereeIdType: 'Nau’in shaidarka',
    pubRefereeIdNumber: 'Lambar shaidarka',
    pubRefereeIdHint: 'Ana adana ta cikin tsaro kuma ba a taba nuna ta gaba daya ba. Idan ka bar wannan a fade, jami’in PSIRS zai duba amsarka da hannu.',
    pubRefereeOccupation: 'Sana’arka',
    pubIdNin: 'Lambar Shaidar Kasa (NIN)',
    pubIdBvn: 'Lambar Tantancewar Banki (BVN)',
    pubIdPassport: 'Fasfo na kasashen waje',
    pubIdLicence: 'Lasisin tuki',
    pubIdVoters: 'Katin zabe',
    pubRefereeSubmit: 'Tabbatar da aikawa',
    pubRefereeSubmitting: 'Ana aikawa…',
    pubRefereeDecline: 'Ba zan iya tsayawa a matsayin mai shaida ba',
    pubRefereeNoAccount: 'Ba ka bukatar asusu. Ana amfani da wannan mahadin sau daya kuma zai kare a',
    pubDeclineTitle: 'Ka ki tsayawa a matsayin mai shaida?',
    pubDeclineBody1a: 'Za ka gaya wa PSIRS cewa ba za ka iya tsayawa wa',
    pubDeclineBody1b: 'ba. Bukatarsa ta karbar harajin gwamnati ba za ta ci gaba ba bisa maganarka.',
    pubDeclineBody2: 'Ba za a iya soke wannan daga wannan shafi ba, kuma ba za a sake amfani da mahadin ba.',
    pubDeclineReason: 'Dalili (na zabi)',
    pubDeclineReasonHint: 'Idan kawai ba ka san wannan mutumin sosai ba, fadin haka ya isa.',
    pubDeclineYes: 'Eh, na ki',
    pubDeclineNo: 'A’a, kada a ci gaba',
    pubDeclineSending: 'Ana aikawa…',
    pubAttestTitle: 'Tantance mambobin kungiya',
    pubAttestIntro: 'PSIRS na bukatar ka tabbatar da wadanne daga cikin wadannan mutane ne mambobi da gaske. Ana ba mambobi tallafin gwamnati, don haka tabbatar da wanda ba mamba ba yana kwace shi daga wanda yake mamba.',
    pubAttestGroup: 'Kungiya',
    pubAttestAlready: 'An riga an tabbatar',
    pubAttestNothingTitle: 'Babu abin da ake jira',
    pubAttestNothingBody: 'An riga an tabbatar da kowane mamba a wannan jerin. Babu abin da za ka yi.',
    pubAttestQuestion: 'Shin kowane daya daga cikin wadannan mutane mamba ne a kungiyarka?',
    pubAttestYes: 'Mamba',
    pubAttestNo: 'Ba mamba ba',
    pubAttestAnswerAll: 'Da fatan za ka amsa game da kowane mutum kafin aikawa.',
    pubAttestSubmit: 'Aika amsoshina',
    pubCitizenTitle: 'Duba matsayin harajinka',
    pubCitizenModeTin: 'Ta TIN',
    pubCitizenModePhone: 'Ta waya',
    pubCitizenModeName: 'Ta suna',
    pubCitizenCheck: 'Duba matsayi',
    pubCitizenSearching: 'Ana dubawa…',
    pubCitizenExampleTin: 'misali PL-000001234',
    pubCitizenExamplePhone: 'misali 08012345678',
    pubCitizenExampleName: 'misali Aminu Ibrahim',
    pubCitizenByTin: 'Lambar Shaidar Haraji (TIN)',
    pubCitizenByPhone: 'Lambar wayar da aka yi rijista',
    pubCitizenByName: 'Cikakken suna ko sunan kasuwanci',
    pubCitizenTooMany: 'Yi amfani da TIN dinka ko ainihin lambar wayarka don sakamako madaidaici.',
    ofcDbOr: 'ko',
    ofcDbDayRange: 'daga {{from}} zuwa {{to}}',
    ofcGpBeneficiaryCount: 'masu cin gajiya {{count}}',
    ofcGpCollectedOfAwarded: '{{collected}} daga cikin {{awarded}} ({{rate}}%)',
    ofcGpEachBeneficiaryGets: '{{quantity}} {{unit}} kowanne',
    ofcOvIdentifiers: 'Lambobin ganewa',
    nsStepUpRequired: 'Ka tabbatar da wannan da lambar amfani sau daya, sannan ka sake gwadawa.',
    nsDeviceNotRegistered:
      'Ka bude Bayanan Kaina, sannan "Duba nemana da izinina", domin ka yi rajistarta.',
    nsDeviceRevoked:
      'Ba za a iya sake yin rajistar na’urar da aka soke ba. Ka yi rajistar na’ura ta maye gurbi ka nemi shugabanka ya amince da ita.',
    nsDeviceSuspended: 'Shugabanka na iya gaya maka dalili, kuma ya mayar da ita.',
    nsUpdateRequired: 'Ka rufe manhajar ka sake budewa domin shigar da sabuwar siga.',
    nsUpdateRequiredToEnumerate:
      'Ka rufe manhajar ka sake budewa domin shigar da sabuwar siga. Duk abin da aka riga aka ajiye a wannan waya za a aika shi.',
    nsTinServiceUnavailable:
      'Ka sake gwadawa nan da mintuna kadan. KADA ka yi rajistar wannan mai biyan haraji a matsayin sabon mai neman TIN — hakan zai kirkiri TIN na biyu ga wanda ya riga ya mallaki daya.',
    nsTinNotFound:
      'Da farko ka duba lambar da takardar mai biyan harajin kansa — yawanci kuskuren buga lamba ne sanadi. Sai kawai idan bai taba mallakar TIN ba, ka koma ka yi rajistarsa ba tare da TIN ba; dandalin zai nema masa sabuwar TIN.',
    nsKycProviderUnavailable: 'Ka sake gwadawa nan da mintuna kadan. Nemanka bai canza ba.',
    nsPaymentUnconfirmed: 'Ka bude cinikin daga tarihinka domin ka ga halin da yake ciki yanzu.',
    nsPaymentFailed: 'Ka sake fara biyan, ko ka zabi wata hanyar biya.',
    nsAgentNotCleared: 'Ka bude "Nemana" domin ka ga abin da ya rage.',
    ofcOvJobHealthy: 'Yana gudana bisa tsarin lokaci.',
    ofcOvJobRunning: 'Yana gudana yanzu.',
    ofcOvJobOverdue:
      'Bai fara a lokacin da ya kamata ba. Wataran tsarin lokacin kansa ya tsaya.',
    ofcOvJobStalled:
      'Ya fara amma bai kammala ba. Wurin da yake gudana bai dawo ba.',
    ofcOvJobFailing: 'Ya gaza sau {{count}} a jere: {{error}}',
    ofcOvJobNeverRun: 'Bai taba gudana ba tun lokacin da aka kirkiri wannan ma’ajiyar bayanai.',
    ofcOvJobNoReason: 'ba a rubuta dalili ba',
    ofcOvEverySeconds: 'kowane dakika {{n}}',
    ofcOvEveryMinutes: 'kowane minti {{n}}',
    ofcOvEveryHours: 'kowane awa {{n}}',
    errDraftInvalid:
      'PSIRS ba ta iya karbar wannan shigarwa ba: {{detail}}. Tana nan a wayarka — ka gyara ta ka sake aikawa.',
    errDraftTypeUnsupported:
      'Wannan sigar manhajar ta yi shigarwa irin "{{type}}" wadda PSIRS ba ta iya sarrafawa tukuna. Ba a rasa ta ba — ka sabunta manhajar, ko ka ba da wannan lamba ga tallafi.',
    errDraftNotProcessed:
      'PSIRS ba ta iya sarrafa wannan shigarwa ba. Tana nan a wayarka — ka ba da lamba {{reference}} ga tallafi.',
    agVehFoundConfirmed: 'An sami motar kuma an tabbatar da ita a rajistar hukumar motoci.',
    agVehFoundUnconfirmed:
      'An sami motar a dandalin. Ba a tabbatar da ita a hukumar motoci ba tukuna.',
    agVehRegistryUnavailable:
      'Ba a iya tuntubar hukumar motoci ba, don haka ba za mu iya cewa an yi rajistar wannan mota ba. Ka sake gwadawa nan ba da dadewa ba. Idan sabuntawar ba za ta iya jira ba, ka shigar da bayanan da hannu — za a yi wa rajistar alama domin a duba ta idan hukumar ta dawo.',
    agVehNotFound:
      'Ba a sami rajistar wannan mota a dandalin ko a hukumar motoci ba. Ka shigar da bayanan motar da hannu — za a yi wa rajistar alama a matsayin wadda ba a tabbatar da ita ba.',
    agVehFoundAtAuthority:
      'An sami motar a hukumar motoci. Ka tabbatar da mai ita kafin ka ci gaba.',
    agRefereeRequestSent: 'An aika bukatar tantancewa zuwa ga {{name}}.',
    agDevicePendingApproval: 'An yi rajistar na’urar kuma tana jiran amincewar shugabanka.',
    agDeviceSuspended: 'An yi rajistar wannan na’ura amma an dakatar da ita. Shugabanka na iya mayar da ita.',
    agDeviceActive: 'An yi rajistar na’urar kuma tana aiki.',
    agGroupMemberRecorded:
      'An rubuta. Mambancin zai kirgu ne kawai bayan shugaban kungiyar ya tabbatar da shi.',
    ofcItemBackInCatalogue: '{{name}} ya dawo cikin lissafin kuma ana iya kimanta shi kuma.',
    ofcItemSuspended:
      'An dakatar da {{name}}. Ba za a iya kada wani sabon kimantawa a kansa ba; takardun biya da aka riga aka fitar sun ci gaba da zama abin biya.',
    ofcItemRetired:
      'An yi ritayar {{name}}. Takardun biya da aka riga aka fitar sun ci gaba da zama abin biya, kuma ba za a iya mayar da abun ba.',
    ofcGpMemberLeft:
      'An rubuta cewa {{member}} ya bar {{group}}. Yana rike da abin da ya riga ya karba kuma ba za a kirga shi a rabon nan gaba ba.',
    pubRefereeThankYouCleared: 'Na gode. An kammala tantancewarka kuma an rubuta ta.',
    pubRefereeCouldNotVerify:
      'Ba a iya tantance wanene kai ba. PSIRS na iya tuntubarka domin karin bayani.',
    pubRefereeUnderReview:
      'Na gode. An rubuta amsarka kuma yanzu PSIRS na duba ta.',
    pubRefereeDeclineRecorded:
      'An rubuta shawararka. Za a gaya wa mai nema cewa yana bukatar wani mai shaida.',
    pubGroupAllConfirmed: 'Na gode. Ka tabbatar da mambobi {{confirmed}}.',
    pubGroupSomeConfirmed:
      'Na gode. Ka tabbatar da mambobi {{confirmed}} kuma ba ka tabbatar da {{rejected}} ba.',
    pubCitizenNoTinMatch: 'Ba a sami rajistar mai biyan haraji da wannan TIN ba.',
    pubCitizenNoPhoneMatch: 'Ba a sami rajistar mai biyan haraji da wannan lambar waya ba.',
    pubCitizenNoNameMatch: 'Ba a sami rajista da wannan suna ba.',
    pubCitizenOneMatch: 'An sami rajista guda daya da ta yi daidai.',
    pubCitizenManyMatches: 'An sami rajista {{count}} masu kama da wannan suna.',
    pubCitizenStatusHeading: 'Matsayin bin ka’idar haraji',
    pubCitizenCompliant: 'Ya bi ka’ida',
    pubCitizenArrears: 'Yana da bashin haraji',
    pubCitizenAttention: 'Yana bukatar kulawa',
    pubCitizenNotAssessed: 'Ba a kimanta ba tukuna',
    pubCitizenMsgCompliant: 'Bayanan harajinka sun cika. Ka ci gaba da biya a kan lokaci domin ka rike wannan matsayi.',
    pubCitizenMsgArrears: 'Kana da harajin da ake bin ka. Da fatan za ka tuntubi ofishin PSIRS mafi kusa da kai ko wakilin karbar haraji domin ka biya.',
    pubCitizenMsgAttention: 'Makin bin ka’idar harajinka yana bukatar gyara. Biyan harajin da ake bin ka a kan lokaci zai daga shi.',
    pubCitizenMsgNotAssessed: 'Ba a kimanta maka komai ba tukuna, don haka babu makin bin ka’ida da za a nuna. Wannan zai sabunta bayan kimantawarka ta farko.',
    pubCitizenDetail: 'Domin sanin TIN dinka, makin bin ka’idarka, abin da ake bin ka da kuma shirye-shiryen tallafi da ka cancanta, ka ziyarci kowane ofishin PSIRS ko wakilin karbar haraji da izini. Za su fara tabbatar da ko wane ne kai, shi ya sa ba a nuna wadannan bayanai a nan ba.',
    pubCitizenTinStatus: 'Matsayin TIN',
    pubCitizenOutstanding: 'Harajin da ake bin ka',
    pubCitizenOutstandingYes: 'Eh — da fatan za ka tuntubi PSIRS',
    pubCitizenNone: 'Babu',
    pubStmtFrom: "Daga",
    pubStmtTo: "Zuwa",
    pubStmtBackwards: "Farkon lokacin ya zo bayan karshensa.",
    pubStmtAnotherPeriod: "Duba wani lokaci dabam (za a aika sabuwar lamba)",
    pubStmtTitle: "Abin da ka riga ka biya",
    pubStmtIntro: "Domin ganin biyayyarka muna aika lamba zuwa lambar wayar da ke rubuce a bayananka. Ba a taba aika ta zuwa lambar da aka rubuta a nan ba.",
    pubStmtSendCode: "Aiko min da lamba",
    pubStmtSending: "Ana aikawa…",
    pubStmtCodeSent: "Idan akwai bayanan da suka dace, an aika lamba zuwa wayar da ke kansu. Ka shigar da ita a kasa.",
    pubStmtCode: "Lambar da ke cikin sakon",
    pubStmtShow: "Nuna min biyayyata",
    pubStmtChecking: "Ana duba…",
    pubStmtPeriod: "Biyayya daga {{from}} zuwa {{to}}.",
    pubStmtTotal: "Jimlar da aka biya",
    pubStmtCount: "Biyayya",
    pubStmtReturned: "An mayar maka",
    pubStmtReturnedRow: "an mayar maka",
    pubStmtForWhat: "Abin da aka biya",
    pubStmtEach: "Kowane biya",
    pubStmtNothing: "Ba a biya komai a wannan lokacin ba.",
    pubStmtFooter: "Ka ajiye rasitunka. Idan wannan jerin da rasitunka ba su dace ba, ka kai su ofishin PSIRS — rasit shi ne hujja, wannan kuwa rikodi ne.",
    pubCitizenFooter: 'Don tambaya game da asusunka, ka ziyarci kowane ofishin PSIRS ko ka tuntubi wakilin karbar haraji da izini.',
    pubCitizenAlso: 'Akwai kuma:',
    pubCitizenVerifyLink: 'Tantance rasitin biyan kudi',
    agSupYou: 'Kai',
    collAuthorizedFieldOfficer: 'Jami’in fili mai izini',
    moreDisablePushNotifications: 'Kashe sanarwar turawa',
    moreSentToPsirsYour: 'An tura wa PSIRS. Kwamishan naka zai ci gaba da zuwa asusunka na yanzu har sai wani jami’i ya amince da canjin.',
    moreUnknownOwner: 'Ba a san mai shi ba',
    ofcAgAgentActivated: 'An kunna wakilin.',
    ofcAgAgentAgreementAccepted: 'An amince da yarjejeniyar wakili',
    ofcAgAgentSuspendedTheirSessions: 'An dakatar da wakilin. An kashe zamansa da na’urorinsa.',
    ofcAgApplicationApproved: 'An amince da bukatar.',
    ofcAgApplicationRejected: 'An ki bukatar.',
    ofcAgAskedForBy: 'Wanda ya nema',
    ofcAgCommissionBankAccountVerified: 'An tabbatar da asusun bankin kwamishan',
    ofcAgConfirmedNoNameReturned: 'An tabbatar, amma ba a mayar da suna ba',
    ofcAgDeviceApprovedTheAgent: 'An amince da na’urar. Yanzu wakili zai iya karba da ita.',
    ofcAgDeviceRestoredTheAgent: 'An mayar da na’urar. Wakili zai iya sake karba da ita.',
    ofcAgDeviceRevokedAndIts: 'An janye na’urar kuma an kawo karshen zamanta.',
    ofcAgDeviceSuspendedAndIts: 'An dakatar da na’urar kuma an kawo karshen zamanta. Ana iya mayar da ita.',
    ofcAgDocumentType: 'Nau’in takarda',
    ofcAgFailureReason: 'Dalilin gazawa',
    ofcAgFlagDismissedTheReferee: 'An soke gargadin. Ana iya tabbatar da mai shaida kamar yadda aka saba.',
    ofcAgFlagMarkedAsUnder: 'An sanya gargadin a matsayin ana bincike.',
    ofcAgFlagUpheldThisReferee: 'An tabbatar da gargadin. Ba za a iya tabbatar da wannan mai shaida ba sai an soke shi.',
    ofcAgGiveAReasonOf: 'Ka bayar da dalili na akalla haruffa 10. Shi ne kadai rikodin dalilin da ya sa aka sauya asusun da ake biyan wani a ciki.',
    ofcAgGovernmentApproved: 'Gwamnati ta amince',
    ofcAgIdentityVerifiedKyc: 'An tabbatar da shaida (KYC)',
    ofcAgLivenessCheck: 'Tabbatar da mutum na gaske',
    ofcAgMandatoryTrainingCompleted: 'An kammala horon wajibi',
    ofcAgMoreInformationRequestedFrom: 'An nemi karin bayani daga mai nema.',
    ofcAgNameTheAgentGave: 'Sunan da wakili ya bayar',
    ofcAgNameTheBankReturned: 'Sunan da banki ya mayar',
    ofcAgNumberOnFile: 'Lambar da ke rubuce',
    ofcAgReasonGiven: 'Dalilin da aka bayar',
    ofcAgRecordThis: 'Rubuta wannan',
    ofcAgRefereeCleared: 'An tabbatar da mai shaida.',
    ofcAgRefereeRejected: 'An ki mai shaida.',
    ofcAgTerritoryReassignedFutureCollections: 'An sauya yankin. Za a danganta karbar kudi ta gaba da shi.',
    ofcAgTheAgent: 'Wakilin',
    ofcAgTheBankConfirmedThe: 'Banki ya tabbatar da asusun.',
    ofcAgTheBankCouldNot: 'Ba a samu banki ba',
    ofcAgTheBankVerificationService: 'Ba a samu sabis din tabbatar da banki ba. Ka sake gwadawa kafin ka yanke shawara — ba za a iya amincewa da asusun da ba a tabbatar ba.',
    ofcAgThisAccountCannotBe: 'Ba za a iya amincewa da wannan asusu ba matukar banki bai tabbatar da shi ba. Ka ki bukatar domin wakili ya aiko da bayanan da suka dace.',
    ofcAgUnnamed: 'Ba shi da suna',
    ofcAlChooseTheProgrammeThis: 'Ka zabi shirin da wannan zagaye zai rarraba a karkashinsa.',
    ofcAlCreateARound: 'Kirkiri zagaye',
    ofcAlCreateRound: 'Kirkiri zagaye',
    ofcAlCreating: 'Ana kirkira…',
    ofcAlGiveTheRoundA: 'Ka ba zagayen suna da mutane za su gane.',
    ofcAlHowMuchDoesEach: 'Nawa kowane mai amfana zai samu?',
    ofcAlHowMuchIsThere: 'Nawa ne za a rarraba gaba daya?',
    ofcAlNotYet: 'Ba tukuna',
    ofcAlOneBeneficiaryCannotReceive: 'Mai amfana daya ba zai iya samun fiye da abin da zagayen ya kunsa ba.',
    ofcAlRoundCreatedItAwards: 'An kirkiri zagayen. Ba ya bayar da komai sai ka bude shi.',
    ofcAlWhenDoesCollectionOpen: 'Yaushe karbar za ta bude?',
    ofcCfActivate: 'Kunna',
    ofcCfAddToTheCatalogue: 'Kara a cikin kundin',
    ofcCfAdding: 'Ana karawa…',
    ofcCfBusinesses: 'Kasuwanci',
    ofcCfCalculatedByFormula: 'An kirga ta hanyar tsari',
    ofcCfCurrent: 'Na yanzu',
    ofcCfEnterTheNewAmount: 'Ka shigar da sabon adadin. Kada ka bar komai a zato — ka rubuta 0 idan ana dakatar da harajin.',
    ofcCfEnterTheNewRate: 'Ka shigar da sabon farashin a matsayin kaso. Ka rubuta 0 idan ana dakatar da harajin.',
    ofcCfEvaluateAll: 'Auna duka',
    ofcCfEvaluating: 'Ana auna…',
    ofcCfExistingAssessmentsAreUnaffected: 'Kimantawar da ake da ita ba za ta shafu ba.',
    ofcCfForExampleRepealedBy: 'Misali: an soke shi ta gyaran Dokar Kudi ta Jihar Filato.',
    ofcCfGiveAReasonFor: 'Ka bayar da dalilin canjin farashin, a cikin akalla haruffa 10.',
    ofcCfIndividuals: 'Mutane',
    ofcCfNoApprovedRateIn: 'Babu farashin da aka amince da shi a aiki',
    ofcCfNoNewAssessmentCan: 'Ba za a iya yin sabon kimantawa a kan nau’in da aka janye ba. Takardun da aka riga aka bayar suna nan a biya — janye nau’i ba shawara ba ce ta yafe bashin da ake bin mutane.',
    ofcCfNotEligible: 'Bai cancanta ba',
    ofcCfOfAssessableAmount: '% na adadin da ake kimantawa',
    ofcCfProgressiveBands: 'Matakan haraji masu hawa',
    ofcCfRecordNewRateVersion: 'Rubuta sabon salon farashi',
    ofcCfRecording: 'Ana rubutawa…',
    ofcCfRestoreItem: 'Mayar da nau’in',
    ofcCfTheItemGoesBack: 'Nau’in yana komawa cikin kundin kuma ana iya sake kimanta shi.',
    ofcCfWhatChangedForExample: 'Me ya canza — misali, an tabbatar da kudin a kan jaridar gwamnati.',
    ofcCfWithdrawItem: 'Janye nau’in',
    ofcDbAverageTimeToConfirm: 'Matsakaicin lokacin tabbatar da biya',
    ofcDbDuplicateRegistrationsOverridden: 'Rijistar da aka maimaita da aka wuce',
    ofcDbNewTaxpayersThisMonth: 'Sabbin masu biyan haraji a wannan wata',
    ofcDbReversalsAndRefunds: 'Mayarwa da dawo da kudi',
    ofcDbTaxpayersWithATin: 'Masu biyan haraji da ke da TIN',
    ofcDbTotalCollected: 'Jimlar abin da aka karba',
    ofcFaEnterTheMinimumVersion: 'Ka shigar da mafi karancin salo da lambobi da digo, kamar 1.4.0.',
    ofcFaEnterTheRecommendedVersion: 'Ka shigar da salon da ake ba da shawara da lambobi da digo, kamar 1.4.0.',
    ofcFaNeverReportedAVersion: 'Bai taba bayar da rahoton salo ba',
    ofcFaPublishThisMinimum: 'Buga wannan mafi karanci',
    ofcFaPublishing: 'Ana bugawa…',
    ofcFaSayWhyTheMinimum: 'Ka fadi dalilin da ya sa ake motsa mafi karanci, a cikin akalla haruffa 10. Shi ne abin da wakilin da aka killace zai gani.',
    ofcFaShippedWithThePlatform: 'An aiko shi tare da dandalin',
    ofcFnBankReferenceForThe: 'Lambar banki na kudin da ya kammala shi',
    ofcFnBankTransferReferenceAt: 'Lambar tura kudi ta banki (akalla haruffa 3):',
    ofcFnEnterTheCreditedAmount: 'Ka shigar da adadin da aka shigar a naira, misali 1250000.00.',
    ofcFnBankReferenceRequired:
      'Ka shigar da lambar banki na kudin da ya kammala wannan. Ita ce ke hada turawar da kudin da suka iso da gaske.',
    ofcFnDisputeNoteTooShort:
      'Ka fada abin da bambancin ya zamo, da akalla haruffa 10. Shi ne kadai bayanin dalilin rufe wannan turawa.',
    ofcFnItHasToAccount: 'Dole ne ya biya karbar da ke cikin rukunin gaba daya.',
    ofcFnListTheGatewayReferences: 'Ka jera lambobin shigarwar da wannan kudi ya kunsa.',
    ofcFnNothingWasComparedFor: 'Ba a kwatanta komai a wannan lokaci ba, don haka ba a tabbatar da komai game da shi ba. Ka sake gwadawa idan an samu shigarwar.',
    ofcFnReRunThisPeriod: 'Ka sake gudanar da wannan lokaci idan an samu shigarwar.',
    ofcFnReasonForApprovingThis: 'Dalilin amincewa da wannan fitar da kudi (akalla haruffa 5):',
    ofcFnReasonForThisDecision: 'Dalilin wannan shawara (akalla haruffa 10):',
    ofcFnRecordHowThisException: 'Ka rubuta yadda aka warware wannan matsala (akalla haruffa 10):',
    ofcFnWhatDidTheBank: 'Me banki ya ce? (akalla haruffa 10)',
    ofcFnWhatTheVarianceTurned: 'Abin da bambancin ya zamo',
    ofcGpConfirmationLinkCreated: 'An kirkiri hanyar tabbatarwa.',
    ofcKyOpenAndReview: 'Bude ka duba',
    ofcKyReviewedOn: 'An duba a ranar',
    ofcKyTheAccessLogCould: 'Ba a iya karanta rikodin shiga ba.',
    ofcLgCouldNotReachThe: 'Ba a iya isa ga dandalin haraji ba. Ka duba haduwarka da yanar gizo.',
    agStepSendingACode: 'Ana aika lamba ta lokaci daya…',
    agStepCodeSentToNumber: 'Mun aika lamba zuwa lambarka da aka yi rijista.',
    uiHide: 'Boye',
    uiHidePassword: 'Boye kalmar sirri',
    uiShow: 'Nuna',
    uiShowPassword: 'Nuna kalmar sirri',
    ofcOsAskTheGatewayAgain: 'Sake tambayar shigarwar',
    ofcOsAskTheTinService: 'Sake tambayar sabis din TIN',
    ofcOsAskingTheGateway: 'Ana tambayar shigarwar…',
    ofcOsAskingTheTinService: 'Ana tambayar sabis din TIN…',
    ofcOsEveryQueueYouCan: 'Duk jerin da za ka iya gani babu komai a ciki. Sauran suna karkashin izinin da matsayinka bai kunsa ba.',
    ofcOsEveryRefundHasBeen: 'An mayar da kowane kudi, kowane mai biyan haraji yana da TIN dinsa, kuma hukumar ababen hawa ta amsa kowane sabuntawa.',
    ofcOsNotAttemptedYet: 'Ba a gwada ba tukuna',
    ofcOsSendToTheAuthority: 'Sake turawa hukumar',
    ofcOsSendingToTheAuthority: 'Ana turawa hukumar…',
    ofcOvEveryScheduledJobHas: 'Kowane aikin da aka tsara ya gudana kwanan nan kuma ya yi nasara.',
    ofcOvId: 'Lamba',
    ofcOvLoading: 'Ana lodi…',
    ofcOvNoTaxpayerMatchedThat: 'Babu mai biyan haraji da ya dace da wannan bincike',
    ofcOvNothingToChooseFrom: 'Babu abin da za a zaba',
    ofcOvRecordWhatYouFound: 'Ka rubuta abin da ka gano (akalla haruffa 10):',
    ofcOvRunAFraudSweep: 'Gudanar da sharewar zamba yanzu',
    ofcOvRunThisQuery: 'Gudanar da wannan tambaya',
    ofcOvRunning: 'Ana gudanarwa…',
    ofcOvSearchForATaxpayer: 'Ka fara neman mai biyan haraji',
    ofcOvSelectOne: 'Ka zabi daya',
    ofcOvSweepCompleteNothingNew: 'An kammala sharewar. Ba a sami sabon abin gargadi ba.',
    ofcOvSweeping: 'Ana sharewa…',
    ofcOvTheAuditTrailCould: 'Ba a iya duba tarihin binciken a yanzu ba. Wannan ba bincike ba ne a kan tarihin — ka sake gwadawa, ka kuma sanar da tallafi idan ya ci gaba.',
    ofcOvWhichAgent: 'Wane wakili?',
    ofcOvWhichRevenueItem: 'Wane nau’in haraji?',
    ofcOvWhichTaxpayer: 'Wane mai biyan haraji?',
    ofcRhAskTheRegisterAgain: 'Sake tambayar rijistar',
    ofcRhAsking: 'Ana tambaya…',
    ofcRhDeviceApproved: 'An amince da na’urar.',
    ofcRhInvoiceDocument: 'Takardar biyan kudi',
    ofcRhPreparing: 'Ana shirya…',
    ofcRhReAskedTheTin: 'An sake tambayar rijistar TIN game da duk wanda ke jira.',
    ofcRhRemindersSentToTaxpayers: 'An aika tunatarwa ga masu biyan haraji da ke da abin biya.',
    ofcRhSendPaymentReminders: 'Aika tunatarwar biya',
    ofcRvEveryFigureHereCovers: 'Kowace lamba a nan ta shafi yankunanka ne kadai, ba dukan jihar ba.',
    ofcRvNotMapped: 'Ba a danganta ba',
    ofcRvTheseFiguresAreEmpty: 'Wadannan lambobi babu komai a cikinsu domin asusunka bai kunshi wani yanki ba tukuna.',
    ofcSpAddAnInternalNote: 'Kara bayanin cikin gida',
    ofcSpAssignedTo: 'An ba wa',
    ofcSpContact: 'Hanyar tuntuba',
    ofcSpInternalNoteSavedThe: 'An ajiye bayanin cikin gida. Wanda ya kawo korafin ba zai gan shi ba.',
    ofcSpNobodyYet: 'Ba wanda ya karba tukuna',
    ofcSpOnlyStaffWithSupport: 'Ma’aikatan da ke da izinin tallafi ne kadai za su iya karanta wannan. Wanda ya kawo korafin ba ya ganin sa ko kadan.',
    ofcSpReplySent: 'An aika amsar.',
    ofcSpReplyToTheReporter: 'Amsa wa wanda ya kawo korafin',
    ofcSpSaveInternalNote: 'Ajiye bayanin cikin gida',
    ofcSpSendReply: 'Aika amsar',
    ofcSpThisGoesToThe: 'Wannan zai je wa wanda ya kawo korafin, kuma za a sanar da shi.',
    ofcTrCorrecting: 'Ana gyarawa…',
    ofcTrEnterTheCorrectedValue: 'Ka shigar da darajar da aka gyara a duk filin da ba daidai ba ne.',
    ofcTrNameTheTypeOf: 'Ka fadi nau’in shaidar mutum idan kana canza lambar.',
    ofcTrOnRecordNow: 'Abin da ke rubuce yanzu',
    ofcTrPutBackOnThe: 'Mayar da shi cikin rijistar',
    ofcTrRecordThisCorrection: 'Rubuta wannan gyara',
    ofcTrRecording: 'Ana rubutawa…',
    ofcTrSayWhatIsBeing: 'Ka fadi abin da ake gyarawa da dalili, a cikin akalla haruffa 10. Shi ne kadai rikodin dalilin.',
    ofcTxDirect: 'Kai tsaye',
    ofcUaChangeAccessAndSign: 'Canza izini ka fitar da su',
    ofcUaChanging: 'Ana canzawa…',
    ofcUaLetThemSignIn: 'Bar su su sake shiga',
    ofcUaSaveTerritories: 'Ajiye yankunan',
    ofcUaSignThemOutAnd: 'Fitar da su ka dakatar da asusun',
    ofcUsApplyingToBecomeAn: 'Nema domin zama wakili',
    ofcUsCapturingAVehicle: 'Daukar bayanan mota',
    ofcUsRegisteringATaxpayer: 'Yin rijistar mai biyan haraji',
    ofcUsTakingACollection: 'Karbar kudi',
  },
};

/**
 * The seven clearance blockers, as dictionary keys.
 *
 * `activationBlockers` returns codes so that the applicant's own screen — and
 * the 403 they get if they try to collect anyway — can be read in the language
 * they chose. This table is the join between the two, and it lives here rather
 * than in either client because both of them need it and neither owns it.
 *
 * Typed against `AgentBlocker`, so adding a gate to the lifecycle without
 * writing the sentence somebody has to read fails the build.
 */
export const BLOCKER_TEXT: Record<AgentBlocker, keyof TranslationDictionary> = {
  KYC: 'appBlockerKyc',
  REFEREE: 'appBlockerReferee',
  GOVERNMENT_APPROVAL: 'appBlockerGovernmentApproval',
  TRAINING: 'appBlockerTraining',
  BANK: 'appBlockerBank',
  AGREEMENT: 'appBlockerAgreement',
  DEVICE: 'appBlockerDevice',
};

/**
 * The five duplicate-match reasons, as dictionary keys.
 *
 * Same join as `BLOCKER_TEXT`, for the same reason: the sentence is composed
 * on the server and read by somebody who may not read English. Typed against
 * `DuplicateReason`, so a new reason without a string fails the build.
 */
export const DUPLICATE_REASON_TEXT: Record<DuplicateReason, keyof TranslationDictionary> = {
  IDENTITY_NUMBER: 'tpDupIdentityNumber',
  PHONE_AND_NAME: 'tpDupPhoneAndName',
  PHONE: 'tpDupPhone',
  BUSINESS_NAME_IN_LGA: 'tpDupBusinessNameInLga',
  NAME_IN_LGA: 'tpDupNameInLga',
};

/**
 * The eleven verification answers, as dictionary keys.
 *
 * The third such table, after `BLOCKER_TEXT` and `DUPLICATE_REASON_TEXT`, and
 * the one where being wrong costs the most: these sentences tell somebody
 * whether the State has their money. Typed against `VerificationReason`, so a
 * new answer without a string fails the build.
 */
export const VERIFICATION_TEXT: Record<VerificationReason, keyof TranslationDictionary> = {
  RECEIPT_FINGERPRINT_MISMATCH: 'verifyReceiptFingerprintMismatch',
  RECEIPT_REVERSED: 'verifyReceiptReversed',
  RECEIPT_VOIDED: 'verifyReceiptVoided',
  RECEIPT_GENUINE: 'verifyReceiptGenuine',
  RECEIPT_GENUINE_UNCHECKED: 'verifyReceiptGenuineUnchecked',
  NOT_FOUND: 'verifyNotFound',
  PAYMENT_REVERSED: 'verifyPaymentReversed',
  DOCUMENT_REVOKED: 'verifyDocumentRevoked',
  DOCUMENT_FINGERPRINT_MISMATCH: 'verifyDocumentFingerprintMismatch',
  ACKNOWLEDGEMENT_NOT_RECEIPT: 'verifyAcknowledgementNotReceipt',
  DOCUMENT_EXPIRED: 'verifyDocumentExpired',
  DOCUMENT_GENUINE: 'verifyDocumentGenuine',
  DOCUMENT_GENUINE_UNCHECKED: 'verifyDocumentGenuineUnchecked',
};

/**
 * Which dictionary key says each chain verdict.
 *
 * Typed against the verdict union, so a fifth outcome added to
 * `audit-chain.ts` without a sentence here fails the build rather than
 * rendering `undefined` at the one place government checks the log.
 */
export const CHAIN_TEXT: Record<ChainVerdict, keyof TranslationDictionary> = {
  INTACT: 'ofcOvChainIntact',
  GENESIS_REMOVED: 'ofcOvChainGenesisRemoved',
  LINK_MISMATCH: 'ofcOvChainLinkMismatch',
  CONTENT_MODIFIED: 'ofcOvChainContentModified',
};

export function getTranslation(lang: Language = 'en'): TranslationDictionary {
  return translations[lang] || translations.en;
}

/**
 * Pick the Hausa name when the UI language is Hausa, falling back to English.
 *
 * Every reference-data row now carries `name` (English) and `name_ha`
 * (Hausa, nullable). This helper keeps the fallback in one place so
 * thirty rendering sites don't each re-implement it.
 */
export function localName(lang: Language, name: string, nameHa: string | null | undefined): string {
  return lang === 'ha' && nameHa ? nameHa : name;
}
