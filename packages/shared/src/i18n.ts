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
    service: 'Nau\'in Haraji / Aiki',
    amount: 'Kudin Haraji',
    totalPaid: 'Jimlar Kudin da Aka Biya',
    receiptNumber: 'Lambar Rasit',
    verificationCode: 'Lambar Tabbatarwa',
    paymentMode: 'Hanyar Biyan Kudi',

    statusPaid: 'AN BIYA / AN TABBATAR',
    statusPending: 'ANA JIRA',
    statusFailed: 'BA TA YI BA',
    statusOffline: 'BA HANYAR SADARWA (OFFLINE)',
    statusOnline: 'AKWAI HANYAR SADARWA (ONLINE)',

    offlineMessage: 'Babu hanyar sadarwa a yanzu. Za a aika bayanan da zaran an samu netiwok.',
    offlineNotice: 'An ajiye a waya. Ba a karbi kudi a tsari ba har sai an tabbatar.',
    scanHelp: 'Sanya lambar QR ta rasit din a tsakiyar akwatin.',
    civicDutyThanks: 'Mungode da kuka sauke nauyin da ya rataya a wuyanku.',
    paymentSuccess: 'An Biyar da Kudi Cikin Nasara',
  },
};

export function getTranslation(lang: Language = 'en'): TranslationDictionary {
  return translations[lang] || translations.en;
}
