/**
 * ESC/POS Thermal Printer Encoder.
 *
 * Provides pure TypeScript, zero-dependency ESC/POS command generation for
 * 58mm (32 columns) and 80mm (48 columns) mobile Bluetooth thermal receipt
 * printers used by field agents in remote locations.
 */

import { formatNaira, parseKobo, type Kobo } from './money';
import { translations, type Language } from './i18n';

/**
 * Whose language a printed receipt is in.
 *
 * The citizen's, not the agent's. A taxpayer holds no account here — the paper
 * and an SMS are the only copies of this they ever get — so migration 047 gave
 * `taxpayers` a `preferred_language`, set by the agent standing in front of
 * them at registration, and the message queue has honoured it since. The
 * printed receipt was the one thing that did not: it was hardcoded English,
 * and two of its fields were being filled from the *agent's* dictionary, so a
 * Hausa-reading agent and an English-reading citizen produced a receipt in
 * neither language consistently.
 *
 * The rule is the one `a-receipt-in-a-language-they-read.test.ts` already
 * states: a receipt they cannot read is a receipt they cannot check.
 */
function labels(language: Language) {
  return translations[language] ?? translations.en;
}

export type PaperWidth = '58mm' | '80mm';

/**
 * Everything this encoder can put on paper, and how it gets there.
 *
 * A thermal printer prints bytes, not text. Every byte above 127 means
 * whatever the printer's currently selected code page says it means, and that
 * page is a manufacturer's choice — the no-name Bluetooth units an agent buys
 * in a market default to CP437, some to CP850, and several ignore the command
 * that changes it. So this encoder sent ASCII and replaced everything else
 * with `?`.
 *
 * WHAT THAT ACTUALLY DID, which is worse than the Hausa problem it was found
 * under. A taxpayer called **Sa’idu Dan’azumi** was handed a receipt reading
 * `Sa?idu Dan?azumi`. The apostrophe in a Nigerian name is ordinary — Sa’idu,
 * Sa’adu, Dan’azumi, Bala’u — and the name on a receipt comes from the
 * taxpayer record, so this has been corrupting citizens' own names on printed
 * government receipts in English, with no Hausa involved at all.
 *
 * WHY THIS IS NOT A CODE PAGE. Reaching for `ESC t n` would be the obvious
 * move and it is the wrong one. Measured against the dictionary, everything
 * non-ASCII in it is *punctuation* — `’` 332 times, `—` 219, `…` 70, curly
 * quotes 16, and the Naira sign — and not one letter. Hausa here is written
 * without hooked letters by an explicit decision recorded in the review sheet,
 * so `ka`, `na’ura` and `sana’a` need exactly one character ASCII lacks: an
 * apostrophe, which ASCII has. CP437 does not contain `’` or `—` either, so
 * selecting it would fix nothing while making the output depend on a command
 * some printers drop.
 *
 * So: fold to the nearest ASCII, deterministically, on every printer.
 *
 *   1. Named punctuation goes to its ASCII equivalent.
 *   2. Anything else decomposes (NFD) and loses its combining marks, so `é`
 *      prints as `e` rather than `?`.
 *   3. Whatever survives both is genuinely unrepresentable and still becomes
 *      `?` — but it is now a narrow residue rather than every apostrophe.
 *
 * A fold is lossy and says so. `Sa'idu` is not spelled the way the record
 * spells it. It is, however, the citizen's name, which `Sa?idu` is not.
 */
const PRINTABLE: [RegExp, string][] = [
  // The Naira sign has no ASCII form; the currency's own abbreviation is the
  // convention on Nigerian printed receipts.
  [/₦/g, 'NGN '],
  // Apostrophes. U+2019 is this dictionary's convention; U+2018 and U+02BB are
  // here because a name arrives from a database rather than from the
  // dictionary, and a phone keyboard produces all three.
  [/[\u2018\u2019\u02BB\u02BC\u00B4`]/g, "'"],
  [/[\u201C\u201D]/g, '"'],
  // Dashes. An em dash between clauses reads correctly as a hyphen with the
  // spaces the source already has around it.
  [/[\u2013\u2014\u2212]/g, '-'],
  [/\u2026/g, '...'],
  [/\u00B7/g, '-'],
  [/\u2190/g, '<-'],
  [/\u2192/g, '->'],
  // A non-breaking space is a space, and prints as a `?` if left alone.
  [/[\u00A0\u2007\u202F]/g, ' '],
  /*
   * The hooked consonants, which are how a great many Nigerian names are
   * spelled.
   *
   * The apostrophe rule above says why this belongs here — "a name arrives
   * from a database rather than from the dictionary, and a phone keyboard
   * produces all three" — and then stopped at apostrophes. A Hausa keyboard
   * produces these too, and an agent registering somebody types the name they
   * are given: Ɗanjuma, Ɓello, Ƙasimu, Ƴaro.
   *
   * The dictionary's decision to write Hausa without hooked letters is a
   * decision about interface text. It has never been a decision about
   * somebody's name, and reading it as one is what left `Ɗanjuma Ɓello`
   * printing as `?anjuma ?ello` — the same defect as `Sa?idu Dan?azumi`, on
   * the same receipt, for the characters most likely to appear in a name.
   *
   * They are precomposed letters rather than a base plus a combining mark, so
   * the NFD pass below does not touch them. The dotted letters of Yoruba and
   * Igbo — ẹ, ọ, ụ, ṣ, ṅ — do decompose, and are already handled there.
   */
  [/[\u0181]/g, 'B'],
  [/[\u0253]/g, 'b'],
  [/[\u018A]/g, 'D'],
  [/[\u0257]/g, 'd'],
  [/[\u0198]/g, 'K'],
  [/[\u0199]/g, 'k'],
  [/[\u01B3]/g, 'Y'],
  [/[\u01B4]/g, 'y'],
];

/**
 * Fold text to what a thermal printer can be relied on to render.
 *
 * Exported because the property is worth asserting directly, and because a
 * caller building a line width-aware needs the length the printer will see
 * rather than the length the string has — `…` is one character and three
 * columns.
 */
export function toPrintableAscii(str: string): string {
  let out = str;
  for (const [pattern, replacement] of PRINTABLE) out = out.replace(pattern, replacement);
  // Strip combining marks so accented Latin letters fold to their base letter.
  return out.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}



export interface ReceiptPrintData {
  receiptNumber: string;
  paymentReference: string;
  taxpayerName: string;
  taxpayerTin: string | null;
  taxpayerPhone: string | null;
  revenueItemName: string;
  revenueCategoryName: string;
  amountKobo: Kobo | string | number;
  paymentMethod: string;
  channel: string;
  lgaName: string;
  wardName: string | null;
  agentName: string;
  agentCode: string;
  issuedAt: string | Date;
  /**
   * The public address a citizen can scan, when there is one to print.
   *
   * Optional because omitting it is a legitimate outcome: a deployment with no
   * public verification site configured must print the code alone rather than a
   * link that looks official and reaches nothing. This was a required string,
   * so the only way to satisfy it was to make one up — which is how every
   * receipt came to carry a developer's localhost address.
   */
  verificationUrl?: string;
  verificationCode?: string;
}

export interface VehicleRenewalPrintData {
  registrationNumber: string;
  documentNumber: string;
  receiptNumber: string;
  ownerName: string;
  ownerPhone: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: number | null;
  chassisNumber: string | null;
  amountKobo: Kobo | string | number;
  validFrom: string | Date;
  validUntil: string | Date;
  issuedAt: string | Date;
  /**
   * The public address a citizen can scan, when there is one to print.
   *
   * Optional because omitting it is a legitimate outcome: a deployment with no
   * public verification site configured must print the code alone rather than a
   * link that looks official and reaches nothing. This was a required string,
   * so the only way to satisfy it was to make one up — which is how every
   * receipt came to carry a developer's localhost address.
   */
  verificationUrl?: string;
  verificationCode: string;
}

// ESC/POS Command Constants
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export class EscposBuilder {
  private buffer: number[] = [];
  private readonly columns: number;

  constructor(public readonly paperWidth: PaperWidth = '58mm') {
    this.columns = paperWidth === '80mm' ? 48 : 32;
    this.initialize();
  }

  public initialize(): this {
    this.buffer.push(ESC, 0x40); // ESC @ - Initialize printer
    return this;
  }

  public alignLeft(): this {
    this.buffer.push(ESC, 0x61, 0x00); // ESC a 0
    return this;
  }

  public alignCenter(): this {
    this.buffer.push(ESC, 0x61, 0x01); // ESC a 1
    return this;
  }

  public alignRight(): this {
    this.buffer.push(ESC, 0x61, 0x02); // ESC a 2
    return this;
  }

  public setBold(enabled: boolean): this {
    this.buffer.push(ESC, 0x45, enabled ? 0x01 : 0x00); // ESC E n
    return this;
  }

  public setDoubleSize(enabled: boolean): this {
    this.buffer.push(GS, 0x21, enabled ? 0x11 : 0x00); // GS ! n (double width + double height)
    return this;
  }

  public setDoubleHeight(enabled: boolean): this {
    this.buffer.push(GS, 0x21, enabled ? 0x01 : 0x00); // GS ! n
    return this;
  }

  public feed(lines: number = 1): this {
    for (let i = 0; i < lines; i++) {
      this.buffer.push(LF);
    }
    return this;
  }

  public cut(): this {
    this.feed(3);
    this.buffer.push(GS, 0x56, 0x41, 0x00); // GS V A 0 - Full cut
    return this;
  }

  public text(str: string): this {
    const sanitized = toPrintableAscii(str);
    for (let i = 0; i < sanitized.length; i++) {
      const code = sanitized.charCodeAt(i);
      this.buffer.push(code < 128 ? code : 0x3f);
    }
    return this;
  }

  public textLine(str: string): this {
    this.text(str);
    this.buffer.push(LF);
    return this;
  }

  public divider(char: string = '-'): this {
    this.textLine(char.repeat(this.columns));
    return this;
  }

  public doubleDivider(): this {
    this.textLine('='.repeat(this.columns));
    return this;
  }

  /**
   * A label and its value, on one line where they fit and two where they do
   * not.
   *
   * Both sides are measured *after* folding, which is the only length the
   * printer will agree with. Most of the fold is one character for one — `’`
   * to `'` — but `…` becomes three and `₦` becomes four, so measuring the
   * source would pad a line to a width the paper does not have. That matters
   * more now than it did: a Hausa label is routinely longer than its English,
   * and `Jimlar Kudin da Aka Biya` against `NGN 5,000.00` is already past 32
   * columns before any of this.
   */
  public keyValuePair(key: string, value: string): this {
    const printedKey = toPrintableAscii(key);
    const printedValue = toPrintableAscii(value);
    if (printedKey.length + printedValue.length + 1 <= this.columns) {
      const spaces = this.columns - (printedKey.length + printedValue.length);
      this.textLine(`${printedKey}${' '.repeat(spaces)}${printedValue}`);
    } else {
      this.textLine(printedKey);
      const indent = Math.max(0, this.columns - printedValue.length);
      this.textLine(`${' '.repeat(indent)}${printedValue}`);
    }
    return this;
  }

  /**
   * Encodes a standard Model 2 QR code in ESC/POS format (GS ( k).
   */
  public qrCode(content: string, size: number = 4): this {
    const data = Array.from(content).map((c) => c.charCodeAt(0));
    const len = data.length + 3;
    const pL = len % 256;
    const pH = Math.floor(len / 256);

    // 1. QR Code: Select Model (Model 2)
    this.buffer.push(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
    // 2. QR Code: Set Module Size
    this.buffer.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, Math.min(Math.max(size, 1), 8));
    // 3. QR Code: Set Error Correction Level (Level M = 49)
    this.buffer.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31);
    // 4. QR Code: Store Data in Symbol Storage Area
    this.buffer.push(GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30, ...data);
    // 5. QR Code: Print Symbol Area
    this.buffer.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);
    this.feed(1);
    return this;
  }

  public toUint8Array(): Uint8Array {
    return new Uint8Array(this.buffer);
  }
}

/**
 * Builds an official PSIRS ESC/POS thermal receipt byte array.
 */
export function encodeReceiptEscpos(
  data: ReceiptPrintData,
  paperWidth: PaperWidth = '58mm',
  language: Language = 'en',
): Uint8Array {
  const t = labels(language);
  const dateStr = typeof data.issuedAt === 'string' ? data.issuedAt : data.issuedAt.toISOString();
  const formattedDate = dateStr.replace('T', ' ').slice(0, 19);
  const formattedAmount = formatNaira(parseKobo(data.amountKobo));

  const builder = new EscposBuilder(paperWidth);

  builder
    .alignCenter()
    .setBold(true)
    .textLine(t.rcpGovernment)
    .textLine(t.rcpBureau)
    .setBold(false)
    .textLine(t.rcpPlatform)
    .doubleDivider()
    .setBold(true)
    .textLine(t.rcpTitle)
    .setBold(false)
    .divider()
    .alignLeft()
    .keyValuePair(`${t.receiptNumber}:`, data.receiptNumber)
    .keyValuePair(`${t.rcpDateTime}:`, formattedDate)
    .keyValuePair(`${t.rcpReference}:`, data.paymentReference)
    .keyValuePair(`${t.rcpLga}:`, data.lgaName);

  if (data.wardName) {
    builder.keyValuePair(`${t.rcpWard}:`, data.wardName);
  }

  builder
    .divider()
    .keyValuePair(`${t.rcpTaxpayer}:`, data.taxpayerName);

  if (data.taxpayerTin) {
    // Not translated, deliberately. `TIN` is the acronym in both languages,
    // and the dictionary's long form — `Lambar Shaida ta Haraji (TIN)` — is
    // thirty of a 58mm receipt's thirty-two columns, which would push every
    // TIN onto its own line to say nothing extra.
    builder.keyValuePair('TIN:', data.taxpayerTin);
  }
  if (data.taxpayerPhone) {
    builder.keyValuePair(`${t.rcpPhone}:`, data.taxpayerPhone);
  }

  builder
    .divider()
    .keyValuePair(`${t.rcpItem}:`, data.revenueItemName)
    .keyValuePair(`${t.rcpCategory}:`, data.revenueCategoryName)
    .divider()
    .alignRight()
    .setBold(true)
    .keyValuePair(`${t.totalPaid.toUpperCase()}:`, formattedAmount)
    .setBold(false)
    .alignLeft()
    .keyValuePair(`${t.paymentMode}:`, data.paymentMethod)
    .keyValuePair(`${t.rcpAgentCode}:`, data.agentCode)
    .keyValuePair(`${t.rcpAgentName}:`, data.agentName)
    .divider()
    .alignCenter()
    .setBold(true)
    .textLine(t.rcpScanToVerify)
    .setBold(false);

  if (data.verificationCode) {
    builder.textLine(`${t.verificationCode}: ${data.verificationCode}`);
  }

  builder.feed(1);
  if (data.verificationUrl) {
    builder.qrCode(data.verificationUrl, paperWidth === '80mm' ? 5 : 4).textLine(data.verificationUrl);
  } else {
    // No site to send them to, so tell them what to do with the code instead.
    builder.textLine(t.rcpCheckOffice);
    builder.textLine(t.rcpCheckOfficeCont);
  }

  builder
    .feed(1)
    .textLine(t.rcpOffice)
    .textLine(t.rcpThanks)
    .feed(2)
    .cut();

  return builder.toUint8Array();
}

/**
 * Builds an official PSIRS Vehicle Registration / Renewal thermal slip.
 */
export function encodeVehicleRenewalEscpos(
  data: VehicleRenewalPrintData,
  paperWidth: PaperWidth = '58mm',
  language: Language = 'en',
): Uint8Array {
  const t = labels(language);
  const fromStr = typeof data.validFrom === 'string' ? data.validFrom : data.validFrom.toISOString().slice(0, 10);
  const untilStr = typeof data.validUntil === 'string' ? data.validUntil : data.validUntil.toISOString().slice(0, 10);
  const formattedAmount = formatNaira(parseKobo(data.amountKobo));

  const builder = new EscposBuilder(paperWidth);

  builder
    .alignCenter()
    .setBold(true)
    .textLine(t.rcpGovernment)
    .textLine(t.rcpVehAdmin)
    .setBold(false)
    .textLine(t.rcpVehLicensing)
    .doubleDivider()
    .setBold(true)
    .textLine(t.rcpVehTitle)
    .setBold(false)
    .divider()
    .alignLeft()
    .keyValuePair(`${t.rcpVehPlate}:`, data.registrationNumber)
    .keyValuePair(`${t.rcpVehDoc}:`, data.documentNumber)
    .keyValuePair(`${t.receiptNumber}:`, data.receiptNumber)
    .divider()
    .keyValuePair(`${t.rcpVehOwner}:`, data.ownerName)
    .keyValuePair(`${t.rcpPhone}:`, data.ownerPhone)
    .keyValuePair(`${t.rcpVehMakeModel}:`, `${data.vehicleMake} ${data.vehicleModel}`)
    .keyValuePair(`${t.rcpVehYear}:`, data.vehicleYear ? String(data.vehicleYear) : 'N/A');

  if (data.chassisNumber) {
    builder.keyValuePair(`${t.rcpVehChassis}:`, data.chassisNumber);
  }

  builder
    .divider()
    .keyValuePair(`${t.rcpVehFrom}:`, fromStr)
    .keyValuePair(`${t.rcpVehUntil}:`, untilStr)
    .setBold(true)
    .keyValuePair(`${t.rcpVehFee}:`, formattedAmount)
    .setBold(false)
    .divider()
    .alignCenter()
    .setBold(true)
    .textLine(t.rcpVehOfficial)
    .setBold(false)
    .textLine(`Security Code: ${data.verificationCode}`)
    .feed(1);

  if (data.verificationUrl) {
    builder.qrCode(data.verificationUrl, paperWidth === '80mm' ? 5 : 4).textLine(data.verificationUrl);
  } else {
    builder.textLine(t.rcpVehCheck);
  }

  builder.feed(2).cut();

  return builder.toUint8Array();
}
