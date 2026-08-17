/**
 * Device identity and connection awareness (Addendum §20, §24).
 *
 * The device identifier is the one value that legitimately persists in
 * localStorage: it is not a credential and carries no taxpayer data, and it
 * must survive app restarts so government can bind, approve and revoke a
 * specific handset (Addendum §21).
 */

const DEVICE_KEY = 'psirs.device.id';

export function getDeviceIdentifier(): string {
  let identifier = localStorage.getItem(DEVICE_KEY);
  if (!identifier) {
    identifier = `pwa-${crypto.randomUUID()}`;
    localStorage.setItem(DEVICE_KEY, identifier);
  }
  return identifier;
}

export interface DeviceProfile {
  deviceIdentifier: string;
  browser: string;
  operatingSystem: string;
  pwaVersion: string;
  deviceName: string;
}

export function describeDevice(appVersion: string): DeviceProfile {
  const ua = navigator.userAgent;

  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Unknown browser';

  const operatingSystem =
    /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : 'Unknown';

  return {
    deviceIdentifier: getDeviceIdentifier(),
    browser,
    operatingSystem,
    pwaVersion: appVersion,
    deviceName: `${browser} on ${operatingSystem}`,
  };
}

/** Addendum §24 — the three states the interface must distinguish. */
export type ConnectionState = 'ONLINE' | 'LIMITED' | 'OFFLINE';

interface NetworkInformation {
  effectiveType?: string;
  downlink?: number;
  saveData?: boolean;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

function connection(): NetworkInformation | undefined {
  return (navigator as Navigator & { connection?: NetworkInformation }).connection;
}

/**
 * Classify the connection.
 *
 * "LIMITED" matters in the field: on a 2G edge-of-coverage link the browser
 * still reports `navigator.onLine === true`, and an agent who believes they are
 * fully online will start a payment that then hangs. Telling them the link is
 * weak is the difference between a delayed payment and a taxpayer being asked
 * to pay twice.
 */
export function detectConnectionState(): ConnectionState {
  if (!navigator.onLine) return 'OFFLINE';

  const info = connection();
  if (info?.effectiveType && ['slow-2g', '2g'].includes(info.effectiveType)) return 'LIMITED';
  if (typeof info?.downlink === 'number' && info.downlink > 0 && info.downlink < 0.15) {
    return 'LIMITED';
  }
  return 'ONLINE';
}

export function watchConnection(onChange: (state: ConnectionState) => void): () => void {
  const emit = () => onChange(detectConnectionState());

  window.addEventListener('online', emit);
  window.addEventListener('offline', emit);
  const info = connection();
  info?.addEventListener?.('change', emit);

  // A periodic re-check catches the case the events miss: a connection that is
  // nominally up but is not actually carrying traffic.
  const timer = window.setInterval(emit, 15_000);

  return () => {
    window.removeEventListener('online', emit);
    window.removeEventListener('offline', emit);
    info?.removeEventListener?.('change', emit);
    window.clearInterval(timer);
  };
}

export const CONNECTION_COPY: Record<ConnectionState, { label: string; detail: string }> = {
  ONLINE: {
    label: 'Online',
    detail: 'All services are available.',
  },
  LIMITED: {
    label: 'Poor connection',
    detail:
      'Your connection is weak. Payments may take longer to confirm — do not start a payment twice.',
  },
  OFFLINE: {
    label: 'Offline',
    detail:
      'You can capture taxpayer details, which will be sent when you are back online. ' +
      'Payments are not possible while offline.',
  },
};
