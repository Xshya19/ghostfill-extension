// ─────────────────────────────────────────────────────────────────────
// Shared connectivity detection (service worker, pages, content scripts)
// ─────────────────────────────────────────────────────────────────────
//
// Why this exists (2026-11-12): when the machine loses internet access,
// provider calls previously failed with generic "Failed to fetch" /
// timeout warnings indistinguishable from a provider outage. The polling
// ladder kept burning retries, the circuit breaker counted transport
// failures, and no UI surface could say "you are offline".
//
// Design constraints:
// - `navigator.onLine` is a cheap, synchronous first signal available in
//   service workers, extension pages, and content scripts. It is NOT
//   reliable on its own (true behind captive portals / dead DNS), so it
//   is combined with fetch-level error classification.
// - `watchConnectivity()` only works where `window` exists (popup,
//   options, content scripts). The service worker has no window events;
//   it reacts at each alarm tick instead (see pollingManager).
// - `probeConnectivity()` deliberately targets an already-permitted
//   provider origin via `mode: 'no-cors'` so no new host permissions or
//   CSP entries are needed and no request leaves the existing trust
//   boundary. The opaque response only proves that the network stack is
//   reachable — no data is disclosed beyond the connection attempt.
// - Nothing here logs URL payloads; a boolean and a coarse state string
//   are the entire output surface.

/** Coarse connectivity classification used by UI and diagnostics. */
export type ConnectivityState = 'online' | 'offline' | 'degraded-network';

/** Origins already covered by the manifest's host_permissions + CSP. */
const PROBE_TARGETS = ['https://api.mail.tm/', 'https://api.maildrop.cc/'] as const;

/**
 * True when the browser believes the machine has no network access.
 * Safe in every runtime: service workers expose `navigator.onLine`, and
 * Node/jsdom test environments either provide it or fail closed to
 * "online" so callers never skip checks in tests by accident.
 */
export function isNavigatorOffline(): boolean {
  try {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  } catch {
    return false;
  }
}

/**
 * Watch window-level online/offline transitions (popup/options/content).
 * Returns an unsubscribe function; a no-op in windowless runtimes.
 */
export function watchConnectivity(handler: (online: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }
  const online = () => handler(true);
  const offline = () => handler(false);
  window.addEventListener('online', online);
  window.addEventListener('offline', offline);
  return () => {
    window.removeEventListener('online', online);
    window.removeEventListener('offline', offline);
  };
}

/**
 * True when the error looks like a network-stack failure (DNS, routing,
 * radio off, captive portal) rather than an application/HTTP failure.
 * Deliberately narrower than `isRetryableError`, which treats these as
 * retryable: classification here drives user-facing state, not backoff.
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  const name =
    typeof (error as { name?: unknown })?.name === 'string'
      ? String((error as { name?: unknown }).name)
      : '';
  const message =
    typeof (error as { message?: unknown })?.message === 'string'
      ? String((error as { message?: unknown }).message)
      : typeof error === 'string'
        ? error
        : '';

  if (name === 'TypeError') {
    // fetch() rejects with TypeError for every network-level failure.
    return true;
  }
  const msg = message.toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('fetch failed') ||
    msg.includes('err_internet_disconnected') ||
    msg.includes('err_name_not_resolved') ||
    msg.includes('err_connection') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('enotfound') ||
    msg.includes('dns')
  );
}

/**
 * Network-level reachability probe against an already-permitted origin.
 * A resolved (opaque) response proves the network stack works; a TypeError
 * or timeout means the machine likely cannot reach the internet at all.
 *
 * Returns true when reachable. Never throws.
 */
export async function probeConnectivity(timeoutMs = 5000): Promise<boolean> {
  for (const target of PROBE_TARGETS) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer =
      controller && typeof setTimeout === 'function'
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;
    try {
      await fetch(target, {
        method: 'HEAD',
        mode: 'no-cors',
        cache: 'no-store',
        ...(controller ? { signal: controller.signal } : {}),
      });
      return true;
    } catch {
      // Try the next permitted origin before concluding offline.
    } finally {
      if (timer && typeof clearTimeout === 'function') {
        clearTimeout(timer);
      }
    }
  }
  return false;
}

/**
 * Combine the navigator signal with an error to produce the state the UI
 * should present:
 * - 'offline': the browser says there is no network (and the error is
 *   consistent with that).
 * - 'degraded-network': fetch fails at the network level while the browser
 *   still claims to be online — captive portal, DNS failure, proxy trouble.
 * - 'online': everything else (provider-side or application errors).
 */
export function classifyConnectivity(error: unknown): ConnectivityState {
  if (isNavigatorOffline() && isNetworkError(error)) {
    return 'offline';
  }
  if (isNetworkError(error)) {
    return 'degraded-network';
  }
  return 'online';
}

/** Map a connectivity state to the user-facing summary copy. */
export function connectivitySummary(state: ConnectivityState): string {
  switch (state) {
    case 'offline':
      return 'No internet connection';
    case 'degraded-network':
      return 'Network connection is unstable';
    case 'online':
    default:
      return 'Connected';
  }
}
