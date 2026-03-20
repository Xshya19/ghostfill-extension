// Core Utilities (Environment Agnostic)
// Safe for use in Service Workers, Node.js, and Browser

/**
 * Generate a cryptographically secure random number between 0 (inclusive) and 1 (exclusive)
 */
export function secureMathRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${secureMathRandom().toString(36).substring(2, 11)}`;
}

/**
 * Generate a random string of specified length
 */
export function generateRandomString(length: number, charset: string): string {
  const array = new Uint32Array(length);
  crypto.getRandomValues(array);

  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset[array[i] % charset.length];
  }
  return result;
}

/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
  return typeof structuredClone === 'function' ? structuredClone(obj) : JSON.parse(JSON.stringify(obj));
}

/**
 * Merge objects deeply with prototype pollution protection
 *
 * @security Blocks __proto__, constructor, and prototype keys to prevent pollution
 */
export function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target };

  // Keys that could lead to prototype pollution
  const dangerousKeys = ['__proto__', 'constructor', 'prototype'];

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      // 🛡️ SECURITY: Block prototype pollution attempts
      if (dangerousKeys.includes(key)) {
        console.warn('[deepMerge] Blocked prototype pollution attempt:', key);
        continue;
      }

      const targetValue = result[key as keyof T];
      const sourceValue = source[key as keyof T];

      if (isObject(targetValue) && isObject(sourceValue)) {
        result[key as keyof T] = deepMerge(
          targetValue as object,
          sourceValue as object
        ) as T[keyof T];
      } else if (sourceValue !== undefined) {
        result[key as keyof T] = sourceValue as T[keyof T];
      }
    }
  }

  return result;
}

/**
 * Check if value is a plain object
 */
export function isObject(value: unknown): value is object {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxAttempts - 1) {
        await sleep(baseDelay * Math.pow(2, attempt));
      }
    }
  }

  throw lastError;
}

/**
 * Format relative time
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ago`;
  }
  if (hours > 0) {
    return `${hours}h ago`;
  }
  if (minutes > 0) {
    return `${minutes}m ago`;
  }
  if (seconds > 10) {
    return `${seconds}s ago`;
  }
  return 'just now';
}

/**
 * Format date/time
 */
export function formatDateTime(timestamp: number | string): string {
  const date = new Date(timestamp);
  return date.toLocaleString();
}

/**
 * Fetch wrapper with a built-in timeout to prevent hanging connections
 * @param resource URL or RequestInfo
 * @param options Fetch options including timeout duration
 */
export async function fetchWithTimeout(
  resource: RequestInfo | URL,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = 15000 } = options;

  // Create an AbortController to cancel the request if it exceeds timeout
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  // Compose signals for older browsers (since AbortSignal.any is modern only)
  if (options.signal) {
    if (options.signal.aborted) {
      clearTimeout(id);
      throw new Error('AbortError');
    }
    options.signal.addEventListener('abort', () => controller.abort());
  }

  try {
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error(`Request timed out after ${timeout}ms`);
    }
    throw error;
  } finally {
    clearTimeout(id);
  }
}

/**
 * Truncate string with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Parse email address
 */
export function parseEmail(email: string): { login: string; domain: string } | null {
  const match = email.match(/^([^@]+)@(.+)$/);
  if (!match) {
    return null;
  }
  return { login: match[1], domain: match[2] };
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Get domain from URL
 */
export function getDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return '';
  }
}
