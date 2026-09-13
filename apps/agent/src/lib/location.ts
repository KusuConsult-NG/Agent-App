/**
 * Where a collection happened.
 *
 * `transactions` has carried `latitude` and `longitude` since the schema was
 * written, the assessment endpoint has always accepted them, and the service
 * has always written them. No client ever sent one — every transaction in the
 * platform has null coordinates. The column, the route and the service were
 * all built and never wired together.
 *
 * WHAT THIS IS FOR, AND WHAT IT IS NOT. This is revenue mapping: which
 * markets, wards and communities the state's revenue actually comes from, so
 * government can see where it collects and where it does not. It is not
 * surveillance of the agent. The coordinate is attached to the collection, not
 * to a person's movements: nothing here runs when no collection is being
 * taken, nothing tracks an agent between transactions, and there is no
 * background watcher.
 *
 * IT MUST NEVER BLOCK A COLLECTION. A trader is standing at the stall. If the
 * handset has no fix, the agent has denied permission, or the browser has no
 * geolocation at all, the collection proceeds without a coordinate — the
 * transaction still records the LGA and ward, which is what the assessment is
 * priced on. A platform that refused to take money because a satellite was
 * behind a roof would be worse at its job in exactly the places it is most
 * needed.
 */

export interface CollectionPoint {
  latitude: number;
  longitude: number;
  /** Metres of uncertainty the device reported, for judging a stray point. */
  accuracyMetres: number | null;
}

/** How long to wait for a fix before giving up and collecting without one. */
const FIX_TIMEOUT_MS = 6000;

/**
 * A fix good enough to say which market this is, or nothing.
 *
 * Never rejects. The caller has a trader waiting and no useful branch to take
 * on failure, so the only two outcomes are a coordinate and null.
 */
export async function whereAmI(): Promise<CollectionPoint | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: CollectionPoint | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    // Belt and braces: some browsers honour neither the timeout option nor
    // the error callback when permission is in an odd state, and a promise
    // that never settles would hang the collection this is forbidden to
    // delay.
    const timer = setTimeout(() => finish(null), FIX_TIMEOUT_MS + 500);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timer);
        finish({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMetres: Number.isFinite(position.coords.accuracy)
            ? Math.round(position.coords.accuracy)
            : null,
        });
      },
      () => {
        // Denied, unavailable, or timed out. All the same to the caller.
        clearTimeout(timer);
        finish(null);
      },
      {
        // A market stall and the next market are hundreds of metres apart, so
        // the coarse fix is enough and costs far less battery and time than
        // waiting on GPS. `maximumAge` lets two collections at the same stall
        // reuse one fix rather than waking the radio twice.
        enableHighAccuracy: false,
        timeout: FIX_TIMEOUT_MS,
        maximumAge: 120_000,
      },
    );
  });
}
