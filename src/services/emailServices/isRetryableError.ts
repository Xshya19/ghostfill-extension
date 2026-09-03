// ─────────────────────────────────────────────────────────────────────
// Shared error classification & throttled logging for email providers
// ─────────────────────────────────────────────────────────────────────
//
// Problem (2026-09-02): Every provider's getMessages() caught ALL errors
// (including network/timeout) and returned []. This made the aggregator
// think the inbox was successfully checked (just empty), so:
//   • CircuitBreaker.recordSuccess() was called instead of recordFailure()
//   • ProviderHealthManager never tripped
//   • PollingEngine kept firing every 5 s with zero backoff
//   • Console was flooded with 12+ identical WARN lines per minute
//
// Fix: Providers must re-throw retryable errors so the aggregator's
// catch block can engage the circuit breaker and health manager.
// Only genuinely non-retryable situations (404 "empty inbox", malformed
// API response) should return [].

/**
 * Throw on retryable HTTP statuses so circuit breakers engage.
 *
 * Contract for provider getMessages/getMessage implementations:
 * - 2xx → proceed normally.
 * - 404 → "empty inbox": return [] (do NOT throw; not an outage).
 * - anything else (429/5xx/…) → throw `HTTP error: <status>`. The message
 *   carries the status code so `isRetryableError` (and the aggregator's
 *   catch in EmailServiceAggregator.checkInbox) classifies 429/5xx as
 *   retryable → recordFailure + backoff — instead of caching a fake empty
 *   inbox and hammering a dead provider at fast-poll cadence.
 */
// ─────────────────────────────────────────────────────────────────────
// Throttled warning logger
// ─────────────────────────────────────────────────────────────────────
//
// During sustained outages the polling engine fires every 5 s, so
// un-throttled log.warn() produces 12+ identical lines per minute.
// This helper ensures at most one WARN per 30 s per service.

import type { ChildLogger } from '../../utils/logger';

export function throwIfRetryableStatus(response: Response, context: string): void {
  if (response.ok || response.status === 404) {
    return;
  }
  throw new Error(`${context}: HTTP error ${response.status}`);
}

/**
 * Returns true when the error represents a transient condition that the
 * caller should propagate (so circuit breakers / health managers react).
 *
 * Returns false for errors that are "expected empty" — e.g. 404, bad
 * JSON shape — where returning [] is the correct provider behaviour.
 */
export function isRetryableError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  // Handle DOMException or Error or custom error objects across realms
  const name = typeof (error as any)?.name === 'string' ? (error as any).name : '';
  const message =
    typeof (error as any)?.message === 'string'
      ? (error as any).message
      : typeof error === 'string'
      ? error
      : String(error);

  // AbortError / DOMException AbortError — always propagate so the polling engine can respect
  // cancellation signals properly.
  if (name === 'AbortError' || (name === 'DOMException' && message.toLowerCase().includes('abort'))) {
    return true;
  }

  const msg = message.toLowerCase();

  // Network-level failures (service worker wake-up, Wi-Fi drop, DNS)
  if (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('fetch error') ||
    msg.includes('load failed') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('dns') ||
    name === 'TypeError' // fetch() throws TypeError for network errors
  ) {
    return true;
  }

  // Timeout or abort in message
  if (
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('aborted') ||
    msg.includes('user aborted')
  ) {
    return true;
  }

  // Server errors (5xx) — the server is broken, not the request
  if (/\bhttp\s*error[:\s]*5\d\d\b/i.test(msg) || /\b5\d\d\b/.test(msg)) {
    return true;
  }

  // Rate limiting — should propagate so health manager counts it
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) {
    return true;
  }

  // Everything else (404, 400, malformed data, missing fields, etc.)
  // is non-retryable — the provider should return [] or a default.
  return false;
}

const lastWarnTime = new Map<string, number>();
const THROTTLE_MS = 30_000;

export type ThrottledLogger =
  | ChildLogger
  | {
      warn: (message: string, data?: unknown) => void;
      debug: (message: string, data?: unknown) => void;
    };

/**
 * Log a warning at most once per 30 seconds for a given key.
 * Subsequent calls within the window are silently dropped.
 *
 * @param logger  Any object with .warn() and .debug() (our createLogger result)
 * @param key     Dedup key — typically the service name
 * @param message Human-readable summary
 * @param error   The underlying error (logged in the warn payload)
 */
export function throttledWarn(
  logger: ThrottledLogger,
  key: string,
  message: string,
  error?: unknown
): void {
  const now = Date.now();
  const last = lastWarnTime.get(key) || 0;

  if (now - last >= THROTTLE_MS) {
    lastWarnTime.set(key, now);
    logger.warn(message, error);
  } else {
    // Still log at debug so full diagnostics are available if needed
    logger.debug(`(throttled) ${message}`, error);
  }
}
