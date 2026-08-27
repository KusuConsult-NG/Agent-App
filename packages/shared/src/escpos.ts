/**
 * ESC/POS Thermal Printer Encoder.
 *
 * Provides pure TypeScript, zero-dependency ESC/POS command generation for
 * 58mm (32 columns) and 80mm (48 columns) mobile Bluetooth thermal receipt
 * printers used by field agents in remote locations.
 */

import { formatNaira, parseKobo, type Kobo } from './money';

export type PaperWidth = '58mm' | '80mm';

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
    // Convert string to ASCII/Latin-1 bytes (substituting Naira symbol ₦ with NGN for standard thermal character sets)
    const sanitized = str.replace(/₦/g, 'NGN ');
    for (let i = 0; i < sanitized.length; i++) {
      const code = sanitized.charCodeAt(i);
      this.buffer.push(code < 128 ? code : 0x3f); // replace non-ASCII with ?
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

  public keyValuePair(key: string, value: string): this {
    const sanitizedVal = value.replace(/₦/g, 'NGN ');
    if (key.length + sanitizedVal.length + 1 <= this.columns) {
      const spaces = this.columns - (key.length + sanitizedVal.length);
      this.textLine(`${key}${' '.repeat(spaces)}${sanitizedVal}`);
    } else {
      this.textLine(key);
      const indent = Math.max(0, this.columns - sanitizedVal.length);
      this.textLine(`${' '.repeat(indent)}${sanitizedVal}`);
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
export function encodeReceiptEscpos(data: ReceiptPrintData, paperWidth: PaperWidth = '58mm'): Uint8Array {
  const dateStr = typeof data.issuedAt === 'string' ? data.issuedAt : data.issuedAt.toISOString();
  const formattedDate = dateStr.replace('T', ' ').slice(0, 19);
  const formattedAmount = formatNaira(parseKobo(data.amountKobo));

  const builder = new EscposBuilder(paperWidth);

  builder
    .alignCenter()
    .setBold(true)
    .textLine('PLATEAU STATE GOVERNMENT')
    .textLine('INTERNAL REVENUE SERVICE')
    .setBold(false)
    .textLine('Digital Grassroots Platform')
    .doubleDivider()
    .setBold(true)
    .textLine('OFFICIAL REVENUE RECEIPT')
    .setBold(false)
    .divider()
    .alignLeft()
    .keyValuePair('Receipt No:', data.receiptNumber)
    .keyValuePair('Date / Time:', formattedDate)
    .keyValuePair('Reference:', data.paymentReference)
    .keyValuePair('LGA:', data.lgaName);

  if (data.wardName) {
    builder.keyValuePair('Ward:', data.wardName);
  }

  builder
    .divider()
    .keyValuePair('Taxpayer:', data.taxpayerName);

  if (data.taxpayerTin) {
    builder.keyValuePair('TIN:', data.taxpayerTin);
  }
  if (data.taxpayerPhone) {
    builder.keyValuePair('Phone:', data.taxpayerPhone);
  }

  builder
    .divider()
    .keyValuePair('Service:', data.revenueItemName)
    .keyValuePair('Category:', data.revenueCategoryName)
    .divider()
    .alignRight()
    .setBold(true)
    .keyValuePair('TOTAL PAID:', formattedAmount)
    .setBold(false)
    .alignLeft()
    .keyValuePair('Payment Mode:', data.paymentMethod)
    .keyValuePair('Agent ID:', data.agentCode)
    .keyValuePair('Agent Name:', data.agentName)
    .divider()
    .alignCenter()
    .setBold(true)
    .textLine('SCAN TO VERIFY AUTHENTICITY')
    .setBold(false);

  if (data.verificationCode) {
    builder.textLine(`Verification Code: ${data.verificationCode}`);
  }

  builder.feed(1);
  if (data.verificationUrl) {
    builder.qrCode(data.verificationUrl, paperWidth === '80mm' ? 5 : 4).textLine(data.verificationUrl);
  } else {
    // No site to send them to, so tell them what to do with the code instead.
    builder.textLine('Check this receipt at any PSIRS office');
    builder.textLine('or on the PSIRS website, using the code above.');
  }

  builder
    .feed(1)
    .textLine('Government Revenue Office')
    .textLine('Thank you for your civic duty')
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
): Uint8Array {
  const fromStr = typeof data.validFrom === 'string' ? data.validFrom : data.validFrom.toISOString().slice(0, 10);
  const untilStr = typeof data.validUntil === 'string' ? data.validUntil : data.validUntil.toISOString().slice(0, 10);
  const formattedAmount = formatNaira(parseKobo(data.amountKobo));

  const builder = new EscposBuilder(paperWidth);

  builder
    .alignCenter()
    .setBold(true)
    .textLine('PLATEAU STATE GOVERNMENT')
    .textLine('MOTOR VEHICLE ADMINISTRATION')
    .setBold(false)
    .textLine('Vehicle Licensing & Renewal')
    .doubleDivider()
    .setBold(true)
    .textLine('VEHICLE RENEWAL CLEARANCE')
    .setBold(false)
    .divider()
    .alignLeft()
    .keyValuePair('Plate No:', data.registrationNumber)
    .keyValuePair('Doc No:', data.documentNumber)
    .keyValuePair('Receipt No:', data.receiptNumber)
    .divider()
    .keyValuePair('Owner:', data.ownerName)
    .keyValuePair('Phone:', data.ownerPhone)
    .keyValuePair('Make/Model:', `${data.vehicleMake} ${data.vehicleModel}`)
    .keyValuePair('Year:', data.vehicleYear ? String(data.vehicleYear) : 'N/A');

  if (data.chassisNumber) {
    builder.keyValuePair('Chassis:', data.chassisNumber);
  }

  builder
    .divider()
    .keyValuePair('Valid From:', fromStr)
    .keyValuePair('Valid Until:', untilStr)
    .setBold(true)
    .keyValuePair('FEE PAID:', formattedAmount)
    .setBold(false)
    .divider()
    .alignCenter()
    .setBold(true)
    .textLine('OFFICIAL DIGITAL CLEARANCE')
    .setBold(false)
    .textLine(`Security Code: ${data.verificationCode}`)
    .feed(1);

  if (data.verificationUrl) {
    builder.qrCode(data.verificationUrl, paperWidth === '80mm' ? 5 : 4).textLine(data.verificationUrl);
  } else {
    builder.textLine('Check with the code above at any PSIRS office.');
  }

  builder.feed(2).cut();

  return builder.toUint8Array();
}
