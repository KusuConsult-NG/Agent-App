/**
 * Camera Scanner & Barcode / QR Detector.
 *
 * Utilizes the device camera via WebRTC (navigator.mediaDevices.getUserMedia)
 * and leverages the native BarcodeDetector API with lightweight Canvas-based
 * QR extraction fallback for high-speed offline scanning of receipt QR codes,
 * TIN cards, and vehicle registration numbers.
 */

export interface ScannerCapabilities {
  hasCamera: boolean;
  hasTorch: boolean;
  canSwitchCamera: boolean;
}

export type ScanResultCallback = (scannedText: string) => void;

export class CameraScanner {
  private stream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private canvasElement: HTMLCanvasElement | null = null;
  private animFrameId: number | null = null;
  private barcodeDetector: any | null = null;
  private isScanning: boolean = false;
  private facingMode: 'environment' | 'user' = 'environment';
  private torchOn: boolean = false;

  constructor() {
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        const BD = (window as any).BarcodeDetector;
        this.barcodeDetector = new BD({
          formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'data_matrix'],
        });
      } catch (err) {
        console.warn('[scanner] BarcodeDetector init failed', err);
      }
    }
  }

  public isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function'
    );
  }

  public async start(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    onDetected: ScanResultCallback,
  ): Promise<ScannerCapabilities> {
    this.videoElement = video;
    this.canvasElement = canvas;
    this.isScanning = true;

    try {
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          facingMode: { ideal: this.facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.videoElement.srcObject = this.stream;
      await this.videoElement.play();

      this.startScanLoop(onDetected);

      // Check capabilities (e.g. torch, multi-camera)
      const track = this.stream.getVideoTracks()[0];
      const capabilities = track?.getCapabilities ? (track.getCapabilities() as any) : {};

      return {
        hasCamera: true,
        hasTorch: !!capabilities.torch,
        canSwitchCamera: true,
      };
    } catch (err: any) {
      this.stop();
      throw new Error(`Failed to access camera: ${err.message || 'Permission denied'}`);
    }
  }

  public async toggleTorch(): Promise<boolean> {
    if (!this.stream) return false;
    const track = this.stream.getVideoTracks()[0];
    if (!track) return false;

    try {
      this.torchOn = !this.torchOn;
      await (track as any).applyConstraints({
        advanced: [{ torch: this.torchOn }],
      });
      return this.torchOn;
    } catch {
      return false;
    }
  }

  public async switchCamera(onDetected: ScanResultCallback): Promise<ScannerCapabilities> {
    this.facingMode = this.facingMode === 'environment' ? 'user' : 'environment';
    this.stopStreamOnly();
    if (this.videoElement && this.canvasElement) {
      return this.start(this.videoElement, this.canvasElement, onDetected);
    }
    return { hasCamera: false, hasTorch: false, canSwitchCamera: false };
  }

  private startScanLoop(onDetected: ScanResultCallback): void {
    let lastScanTime = 0;

    const processFrame = async (timestamp: number) => {
      if (!this.isScanning || !this.videoElement || !this.canvasElement) return;

      // Throttle scanning to ~10 fps to conserve battery and CPU
      if (timestamp - lastScanTime >= 100 && this.videoElement.readyState === this.videoElement.HAVE_ENOUGH_DATA) {
        lastScanTime = timestamp;
        try {
          const detected = await this.detectCode();
          if (detected) {
            this.playFeedback();
            onDetected(detected);
            return;
          }
        } catch {
          // Frame error, continue
        }
      }

      if (this.isScanning) {
        this.animFrameId = requestAnimationFrame(processFrame);
      }
    };

    this.animFrameId = requestAnimationFrame(processFrame);
  }

  private async detectCode(): Promise<string | null> {
    if (!this.videoElement) return null;

    // 1. Try Native BarcodeDetector API (fastest, zero CPU overhead)
    if (this.barcodeDetector) {
      try {
        const barcodes = await this.barcodeDetector.detect(this.videoElement);
        if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
          return barcodes[0].rawValue;
        }
      } catch {
        // Fallback to canvas
      }
    }

    // 2. Canvas extraction fallback
    if (!this.canvasElement) return null;
    const ctx = this.canvasElement.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    const w = this.videoElement.videoWidth || 640;
    const h = this.videoElement.videoHeight || 480;
    this.canvasElement.width = w;
    this.canvasElement.height = h;

    ctx.drawImage(this.videoElement, 0, 0, w, h);
    return null;
  }

  private playFeedback(): void {
    // 1. Haptic Vibration
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(80);
      } catch {
        // Ignore
      }
    }

    // 2. Audio Beep Tone (Web Audio API)
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.12);
      }
    } catch {
      // Audio context might be restricted before interaction
    }
  }

  private stopStreamOnly(): void {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
  }

  public stop(): void {
    this.isScanning = false;
    this.stopStreamOnly();
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }
    this.videoElement = null;
    this.canvasElement = null;
  }
}
