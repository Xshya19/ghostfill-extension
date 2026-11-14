// ─────────────────────────────────────────────────────────────────────
// Payload-shape validation for provider inbox responses
// ─────────────────────────────────────────────────────────────────────
//
// Problem: providers mapped an unknown/malformed payload onto an empty
// inbox (`data['hydra:member'] || []`). The aggregator scores an empty
// array as a SUCCESS, so an upstream API change (drift) silently looked
// like "this mailbox has no mail" forever:
//
//   • CircuitBreaker.recordSuccess() instead of recordFailure()
//   • ProviderHealthManager never marked the provider unhealthy
//   • no fallback to another provider
//   • the user simply never received the verification mail
//
// Fix: validate the payload shape. A clearly malformed payload must THROW
// so the failure becomes visible and the circuit breaker engages, while a
// legitimately empty inbox (an empty array, or a known key holding an
// empty array) must keep returning [].

export interface MessageListShapeOptions {
  /**
   * Payload keys that may hold the message array, in priority order.
   * A payload that contains none of these keys is treated as drift.
   */
  keys: string[];
  /**
   * Accept a bare array payload as the message list (providers whose API
   * returns the collection directly instead of wrapping it in an object).
   */
  allowBareArray?: boolean;
}

/**
 * Error raised when a provider answered with a payload that does not match
 * any known inbox shape (upstream API drift).
 *
 * The marker property lets the shared classifier (`isRetryableError`) treat
 * it as a provider failure instead of a benign "empty inbox", so the error
 * propagates to the aggregator: the failure becomes visible, the circuit
 * breaker opens and the user is moved to another provider.
 */
export class MalformedProviderResponseError extends Error {
  readonly isMalformedProviderResponse = true;

  constructor(message: string) {
    super(message);
    this.name = 'MalformedProviderResponseError';
  }
}

/**
 * Duck-typed check so any module can recognise the marker without importing
 * the class (avoids a dependency cycle with the shared classifier).
 */
export function isMalformedProviderResponse(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { isMalformedProviderResponse?: unknown }).isMalformedProviderResponse === true
  );
}

function describeType(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'an array';
  }
  return `a ${typeof value}`;
}

/**
 * Extract the message list from a provider payload.
 *
 * @throws MalformedProviderResponseError when the payload is clearly
 *   malformed (not an array and not one of the known object shapes). Callers
 *   must let the error propagate so the aggregator records a provider
 *   failure instead of caching a fake empty inbox.
 */
export function extractMessageList(
  payload: unknown,
  context: string,
  options: MessageListShapeOptions
): unknown[] {
  const { keys, allowBareArray = false } = options;

  if (Array.isArray(payload)) {
    if (allowBareArray) {
      return payload;
    }
    throw new MalformedProviderResponseError(
      `${context}: malformed response — expected an object with one of [${keys.join(', ')}] but received an array`
    );
  }

  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    let sawKnownKey = false;

    for (const key of keys) {
      if (!(key in record)) {
        continue;
      }
      sawKnownKey = true;
      const value = record[key];
      if (value === null || value === undefined) {
        // A known key without a value behaves like an empty list.
        continue;
      }
      if (!Array.isArray(value)) {
        throw new MalformedProviderResponseError(
          `${context}: malformed response — "${key}" is ${describeType(value)}, expected an array`
        );
      }
      return value;
    }

    if (sawKnownKey) {
      // Known key(s) present but empty → a legitimately empty inbox.
      return [];
    }

    throw new MalformedProviderResponseError(
      `${context}: malformed response — expected one of [${keys.join(', ')}] but received ${describeType(payload)}`
    );
  }

  throw new MalformedProviderResponseError(
    `${context}: malformed response — expected an object with one of [${keys.join(', ')}] but received ${describeType(payload)}`
  );
}
