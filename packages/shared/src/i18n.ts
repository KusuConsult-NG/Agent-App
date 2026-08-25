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

  // Attribution
  findTaxpayerFirst: string;
  noTaxpayerMatch: string;

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

    findTaxpayerFirst: 'Find the taxpayer first. Every payment must be attributed.',
    noTaxpayerMatch:
      'No taxpayer matches that search. Register them below before taking a payment \u2014 every payment must be attributed to a taxpayer.',

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

    findTaxpayerFirst: 'Ka nemo mai biyan haraji tukuna. Dole a danganta kowane biyan kudi ga wani.',
    noTaxpayerMatch:
      'Babu mai biyan haraji da ya dace da wannan bincike. Ka yi masa rajista a kasa kafin ka karbi kudi \u2014 dole a danganta kowane biyan kudi ga mai biyan haraji.',

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
