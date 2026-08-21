/**
 * Web Bluetooth Thermal Printer Manager.
 *
 * Provides connection management and raw ESC/POS byte streaming for mobile
 * thermal belt printers (58mm and 80mm) over Web Bluetooth (navigator.bluetooth).
 */

import {
  encodeReceiptEscpos,
  encodeVehicleRenewalEscpos,
  EscposBuilder,
  type PaperWidth,
  type ReceiptPrintData,
  type VehicleRenewalPrintData,
} from '@psirs/shared';

// Common Bluetooth GATT Services for ESC/POS Mobile Thermal Printers
const BLUETOOTH_PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', // Standard ESC/POS Service
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Posiflex / Star / Rongta
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC / Microchip Transparent
  '0000ff00-0000-1000-8000-00805f9b34fb', // Common generic thermal printer
  '0000fee7-0000-1000-8000-00805f9b34fb', // Tencent / Xunyou POS
];

export type PrinterStatus = 'disconnected' | 'connecting' | 'connected' | 'printing' | 'error';

export interface PrinterDeviceState {
  name: string | null;
  id: string;
  status: PrinterStatus;
  paperWidth: PaperWidth;
  errorMessage?: string;
}

class BluetoothPrinterManager {
  private device: any | null = null;
  private server: any | null = null;
  private characteristic: any | null = null;
  private status: PrinterStatus = 'disconnected';
  private paperWidth: PaperWidth = (localStorage.getItem('psirs_printer_width') as PaperWidth) || '58mm';
  private listeners: Set<(state: PrinterDeviceState) => void> = new Set();

  public isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  public getPaperWidth(): PaperWidth {
    return this.paperWidth;
  }

  public setPaperWidth(width: PaperWidth): void {
    this.paperWidth = width;
    localStorage.setItem('psirs_printer_width', width);
    this.notifyState();
  }

  public getState(): PrinterDeviceState {
    return {
      name: this.device?.name || null,
      id: this.device?.id || '',
      status: this.status,
      paperWidth: this.paperWidth,
    };
  }

  public subscribe(listener: (state: PrinterDeviceState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyState(errorMessage?: string): void {
    const state = {
      ...this.getState(),
      errorMessage,
    };
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (err) {
        console.error('[bluetooth-printer] listener error', err);
      }
    }
  }

  public async connect(): Promise<boolean> {
    if (!this.isSupported()) {
      throw new Error('Web Bluetooth is not supported on this browser or device.');
    }

    try {
      this.status = 'connecting';
      this.notifyState();

      // Request Bluetooth device with print services or accept all devices
      const nav = navigator as any;
      this.device = await nav.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: BLUETOOTH_PRINTER_SERVICES,
      });

      this.device.addEventListener('gattserverdisconnected', () => {
        this.status = 'disconnected';
        this.server = null;
        this.characteristic = null;
        this.notifyState('Printer disconnected.');
      });

      this.server = await this.device.gatt.connect();

      // Find writable characteristic across common printer services
      this.characteristic = await this.findWriteCharacteristic(this.server);
      if (!this.characteristic) {
        throw new Error('No writable printer service found on this Bluetooth device.');
      }

      this.status = 'connected';
      this.notifyState();
      return true;
    } catch (error: any) {
      this.status = 'error';
      const msg = error?.message || 'Failed to connect to Bluetooth printer';
      this.notifyState(msg);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    try {
      if (this.device?.gatt?.connected) {
        await this.device.gatt.disconnect();
      }
    } finally {
      this.device = null;
      this.server = null;
      this.characteristic = null;
      this.status = 'disconnected';
      this.notifyState();
    }
  }

  private async findWriteCharacteristic(server: any): Promise<any> {
    // Try known services first
    for (const serviceUuid of BLUETOOTH_PRINTER_SERVICES) {
      try {
        const service = await server.getPrimaryService(serviceUuid);
        const characteristics = await service.getCharacteristics();
        for (const char of characteristics) {
          if (char.properties.write || char.properties.writeWithoutResponse) {
            return char;
          }
        }
      } catch {
        // Continue searching other services
      }
    }

    // Try scanning all primary services as fallback
    try {
      const services = await server.getPrimaryServices();
      for (const service of services) {
        try {
          const chars = await service.getCharacteristics();
          for (const char of chars) {
            if (char.properties.write || char.properties.writeWithoutResponse) {
              return char;
            }
          }
        } catch {
          // ignore service error
        }
      }
    } catch {
      // ignore
    }

    return null;
  }

  /**
   * Writes raw bytes to the Bluetooth printer with chunking and MTU throttling.
   */
  public async writeRawBytes(bytes: Uint8Array): Promise<void> {
    if (!this.characteristic || !this.device?.gatt?.connected) {
      // Attempt auto-reconnect if device exists
      if (this.device) {
        await this.connect();
      } else {
        throw new Error('No Bluetooth printer connected. Please connect a printer first.');
      }
    }

    this.status = 'printing';
    this.notifyState();

    try {
      const CHUNK_SIZE = 64; // Standard BLE MTU safe payload
      for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
        const chunk = bytes.slice(offset, offset + CHUNK_SIZE);
        if (this.characteristic.writeValueWithoutResponse) {
          await this.characteristic.writeValueWithoutResponse(chunk);
        } else {
          await this.characteristic.writeValue(chunk);
        }
        // Small delay to allow the printer buffer to process
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      this.status = 'connected';
      this.notifyState();
    } catch (error: any) {
      this.status = 'error';
      const msg = error?.message || 'Failed while transmitting data to printer';
      this.notifyState(msg);
      throw error;
    }
  }

  public async printReceipt(data: ReceiptPrintData): Promise<void> {
    const bytes = encodeReceiptEscpos(data, this.paperWidth);
    await this.writeRawBytes(bytes);
  }

  public async printVehicleRenewal(data: VehicleRenewalPrintData): Promise<void> {
    const bytes = encodeVehicleRenewalEscpos(data, this.paperWidth);
    await this.writeRawBytes(bytes);
  }

  public async printTestSlip(): Promise<void> {
    const builder = new EscposBuilder(this.paperWidth);
    builder
      .alignCenter()
      .setBold(true)
      .textLine('PLATEAU STATE GOVERNMENT')
      .textLine('INTERNAL REVENUE SERVICE')
      .setBold(false)
      .textLine('Digital Grassroots Platform')
      .doubleDivider()
      .textLine('PRINTER TEST OK')
      .keyValuePair('Width:', this.paperWidth)
      .keyValuePair('Status:', 'Connected (BLE)')
      .keyValuePair('Date:', new Date().toLocaleString('en-GB'))
      .divider()
      .textLine('Mobile POS Terminal Ready')
      .feed(2)
      .cut();

    await this.writeRawBytes(builder.toUint8Array());
  }
}

export const bluetoothPrinter = new BluetoothPrinterManager();
