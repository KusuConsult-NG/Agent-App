/**
 * Plateau State Revenue Platform Localisation (i18n).
 *
 * Supports English ('en') and Hausa ('ha') for field agents and taxpayers
 * across Plateau State's 17 LGAs.
 */

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
  scanQr: string;
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
  tpViewProfile: string;
  tpPossibleExisting: string;
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
  camAlign: string;
  camCancel: string;
  camClose: string;
  camFlip: string;
  camInitializing: string;
  camTryAgain: string;
  camFlashOn: string;
  camFlashOff: string;
  camNoAccess: string;
  camSwitchFailed: string;

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
  scanHelp: string;
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
  pubCitizenByTin: string;
  pubCitizenByPhone: string;
  pubCitizenByName: string;
  pubCitizenTooMany: string;
  pubCitizenStatusHeading: string;
  pubCitizenCompliant: string;
  pubCitizenArrears: string;
  pubCitizenAttention: string;
  pubCitizenNotAssessed: string;
  pubCitizenTinStatus: string;
  pubCitizenOutstanding: string;
  pubCitizenOutstandingYes: string;
  pubCitizenNone: string;
  pubCitizenFooter: string;
  pubCitizenAlso: string;
  pubCitizenVerifyLink: string;
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
    scanQr: 'Scan QR / Barcode',
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
    verifyNotAReceiptCode: "That QR code is not a PSIRS receipt code. Keep the receipt in frame.",
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
    tpViewProfile: "View profile",
    tpPossibleExisting: "Possible existing taxpayer",
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
    camAlign: "Align QR code or barcode inside frame",
    camCancel: "Cancel",
    camClose: "Close scanner",
    camFlip: "Flip camera",
    camInitializing: "Initializing camera...",
    camTryAgain: "Try again",
    camFlashOn: "Flash: ON",
    camFlashOff: "Flash: OFF",
    camNoAccess: "Could not access the device camera.",
    camSwitchFailed: "The camera could not be switched.",
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
    verifyCheckReceipt: "Check a receipt",
    verifyScanQr: "Scan the QR code",
    verifyTypeCode: "Or type the receipt code",
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
    receiptCodeShape: 'A receipt code looks like T7C72-QTUDN. Check the code and try again.',

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
    scanHelp: 'Align the receipt QR code or vehicle license inside the frame.',
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
    pubRefereeIntro: 'has applied to become an authorised revenue agent. PSIRS needs someone who knows them to confirm their identity and suitability.',
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
    pubCitizenByTin: 'Tax Identification Number (TIN)',
    pubCitizenByPhone: 'Registered phone number',
    pubCitizenByName: 'Full name or business name',
    pubCitizenTooMany: 'Use your TIN or exact phone number for a precise result.',
    pubCitizenStatusHeading: 'Tax compliance status',
    pubCitizenCompliant: 'Compliant',
    pubCitizenArrears: 'Has arrears',
    pubCitizenAttention: 'Needs attention',
    pubCitizenNotAssessed: 'Not yet assessed',
    pubCitizenTinStatus: 'TIN status',
    pubCitizenOutstanding: 'Outstanding obligations',
    pubCitizenOutstandingYes: 'Yes — please contact PSIRS',
    pubCitizenNone: 'None',
    pubCitizenFooter: 'For questions about your account, visit any PSIRS office or contact an authorised revenue agent.',
    pubCitizenAlso: 'Also available:',
    pubCitizenVerifyLink: 'Verify a payment receipt',
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
    scanQr: 'Duba Lambar QR',
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
    verificationCode: 'Lambar Tabbatarwa',
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
      'Na\u02bburar biyan kudi ta tabbatar da wannan biyan. Gwamnati ba ta riga ta karbi kudin ba, don haka wannan shaidar karbar kudi ce, BA rasit ba. Za a fitar da rasit ta atomatik da zarar kudin ya isa asusun gwamnati. Kada ka ce wa mai biyan haraji ya sake biya.',
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
    verifyNotAReceiptCode: "Wannan QR code ba lambar rasit ta PSIRS ba ce. Ka rike rasit a cikin firam.",
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
    tpViewProfile: "Duba bayanai",
    tpPossibleExisting: "Mai biyan haraji da watakila yana nan",
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
    camAlign: "Ka daidaita QR code ko barcode cikin firam",
    camCancel: "Soke",
    camClose: "Rufe na’urar dubawa",
    camFlip: "Juya kyamara",
    camInitializing: "Ana shirya kyamara...",
    camTryAgain: "Sake gwadawa",
    camFlashOn: "Fitila: A KUNNE",
    camFlashOff: "Fitila: A KASHE",
    camNoAccess: "Ba a iya samun kyamarar na’ura ba.",
    camSwitchFailed: "Ba a iya canza kyamara ba.",
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
    verifyCheckReceipt: "Duba rasit",
    verifyScanQr: "Duba lambar QR",
    verifyTypeCode: "Ko rubuta lambar rasit",
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
    receiptCodeShape: 'Lambar rasit tana kama da T7C72-QTUDN. Ka duba lambar ka sake gwadawa.',

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
    scanHelp: 'Sanya lambar QR ta rasit din a tsakiyar akwatin.',
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
    pubRefereeIntro: 'ya nemi ya zama wakilin karbar haraji da izini. PSIRS na bukatar wanda ya san shi don tabbatar da ko wanene shi da cancantarsa.',
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
    pubCitizenByTin: 'Lambar Shaidar Haraji (TIN)',
    pubCitizenByPhone: 'Lambar wayar da aka yi rijista',
    pubCitizenByName: 'Cikakken suna ko sunan kasuwanci',
    pubCitizenTooMany: 'Yi amfani da TIN dinka ko ainihin lambar wayarka don sakamako madaidaici.',
    pubCitizenStatusHeading: 'Matsayin bin ka’idar haraji',
    pubCitizenCompliant: 'Ya bi ka’ida',
    pubCitizenArrears: 'Yana da bashin haraji',
    pubCitizenAttention: 'Yana bukatar kulawa',
    pubCitizenNotAssessed: 'Ba a kimanta ba tukuna',
    pubCitizenTinStatus: 'Matsayin TIN',
    pubCitizenOutstanding: 'Harajin da ake bin ka',
    pubCitizenOutstandingYes: 'Eh — da fatan za ka tuntubi PSIRS',
    pubCitizenNone: 'Babu',
    pubCitizenFooter: 'Don tambaya game da asusunka, ka ziyarci kowane ofishin PSIRS ko ka tuntubi wakilin karbar haraji da izini.',
    pubCitizenAlso: 'Akwai kuma:',
    pubCitizenVerifyLink: 'Tantance rasitin biyan kudi',
  },
};

export function getTranslation(lang: Language = 'en'): TranslationDictionary {
  return translations[lang] || translations.en;
}
