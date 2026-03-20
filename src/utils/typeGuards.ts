/**
 * Type Guards Utility
 *
 * Centralized type guards for runtime type checking
 * Used throughout the extension for safe type assertions
 */

/**
 * Checks if a value is a non-null object
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Checks if a value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Checks if a value is a valid number within range
 */
export function isNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && !Number.isNaN(value) && value >= min && value <= max;
}

/**
 * Checks if an array contains only strings
 */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Type guard for EmailAccount type
 */
export function isEmailAccount(value: unknown): value is {
  fullEmail: string;
  domain: string;
  createdAt: number;
  expiresAt: number;
  service: string;
} {
  return (
    isObject(value) &&
    isNonEmptyString(value.fullEmail) &&
    value.fullEmail.includes('@') &&
    typeof value.domain === 'string' &&
    typeof value.createdAt === 'number' &&
    typeof value.expiresAt === 'number' &&
    typeof value.service === 'string'
  );
}

/**
 * Type guard for API response with success flag
 */
export function isSuccessResponse(
  value: unknown
): value is { success: true; [key: string]: unknown } {
  return isObject(value) && value.success === true;
}

/**
 * Type guard for API response with error
 */
export function isErrorResponse(value: unknown): value is { success: false; error?: string } {
  return isObject(value) && value.success === false;
}

/**
 * Type guard for Chrome storage change object
 */
export function isStorageChange(
  value: unknown
): value is { newValue?: unknown; oldValue?: unknown } {
  return isObject(value) && ('newValue' in value || 'oldValue' in value);
}

/**
 * Safe JSON parse with type guard
 */
export function safeJsonParse<T>(json: string): T | null {
  try {
    const result = JSON.parse(json);
    return result as T;
  } catch {
    return null;
  }
}

/**
 * Asserts that a condition is true, throws error if not
 * Useful for runtime validation
 */
export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

/**
 * Asserts that a value is defined (not null or undefined)
 */
export function assertDefined<T>(
  value: T | null | undefined,
  message = 'Value is null or undefined'
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
}

/**
 * Safely accesses a property of an object with type guard
 */
export function hasProperty<K extends string>(obj: unknown, key: K): obj is Record<K, unknown> {
  return isObject(obj) && key in obj;
}

/**
 * Validates an email address format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validates a URL format
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
