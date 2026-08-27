/**
 * Device identity and connection awareness (Addendum §20, §24).
 *
 * The device identifier is the one value that legitimately persists in
 * localStorage: it is not a credential and carries no taxpayer data, and it
 * must survive app restarts so government can bind, approve and revoke a
 * specific handset (Addendum §21).
 */

const DEVICE_KEY = 'psirs.device.id';

/**
 * The identifier the server will accept: 8 to 128 characters.
 *
 * Checked here rather than trusted, because storing something the server will
 * reject leaves the app permanently unable to collect with no way back except
 * clearing site data.
 */
const ACCEPTABLE = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * A handset named on the address bar, honoured only by a development build.
 *
 * An agent's first handset is auto-approved so onboarding can finish; every one
 * after that waits for an officer, because revoking a stolen phone would be
 * worth nothing if the thief could register another and carry on. The seeded
 * demonstration agent already has a handset — the seed registered one so it
 * could create the demonstration data through the real API — so a presenter
 * opening this app in their own browser arrives as that agent's *second*
 * handset and is refused. The control is right; the fixture simply cannot know
 * which browser will turn up.
 *
 * `?device=uat-agent-device-000001` lets that browser say it is the handset the
 * seed already approved. It is not a way past any check: the server still
 * requires the handset to be registered and approved against the signed-in
 * agent's own account, so naming somebody else's identifier gains nothing.
 *
 * A production build ignores it. Honouring it there would let one approved
 * identifier be shared across any number of phones by passing a link around,
 * and binding a collection to a specific handset would mean nothing.
 */
function requestedDevice(): string | null {
  if (!import.meta.env.DEV) return null;
  try {
    const asked = new URLSearchParams(window.location.search).get('device');
    return asked && ACCEPTABLE.test(asked) ? asked : null;
  } catch {
    return null;
  }
}

export function getDeviceIdentifier(): string {
  const asked = requestedDevice();
  if (asked) {
    // Deliberately overwrites a stored identifier: pointing the browser at a
    // different handset is the whole purpose, and a demonstration run twice
    // would otherwise keep whichever one the first run minted.
    localStorage.setItem(DEVICE_KEY, asked);
    return asked;
  }

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
