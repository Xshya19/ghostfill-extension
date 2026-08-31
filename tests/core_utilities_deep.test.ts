/**
 * core_utilities_deep.test.ts
 * Extremely deep test suite for src/utils/core.ts
 * Covers every exported function with boundary, adversarial, and edge-case inputs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  secureMathRandom,
  generateId,
  generateRandomString,
  safeParseDate,
  deepClone,
  deepMerge,
  sleep,
  retry,
  withRetry,
  withTimeout,
  formatRelativeTime,
  formatDate,
  formatTime,
  formatDateTime,
  formatFileSize,
  formatEmailDisplay,
  formatOTP,
  formatDomain,
  maskPassword,
  formatEntropy,
  formatPasswordStrength,
  formatCrackTime,
  pluralize,
  truncate,
  escapeHtml,
  stripHtml,
  contentToString,
  rootDomain,
  isSubdomainOf,
  sameRootDomain,
  isIpLiteral,
  extractEmailAddress,
  emailHost,
  getDomain,
  parseEmail,
  isValidEmail,
  isValidUrl,
  isObject,
  isNonEmptyString,
  isNumberInRange,
  isStringArray,
  isEmailAccount,
  isSuccessResponse,
  isErrorResponse,
  isStorageChange,
  AppError,
  NetworkError,
  StorageError,
  ValidationError,
  PermissionError,
  handleError,
  tryCatch,
  safeJsonParse,
  assert,
  assertDefined,
  getErrorMessage,
  toErrorResponse,
  toSuccessResponse,
  hasProperty,
  LRUCache,
  extractOTP,
  extractActivationLink,
} from '../src/utils/core';

// ═══════════════════════════════════════════════════════════════
// Cryptographic & Randomness
// ═══════════════════════════════════════════════════════════════

describe('secureMathRandom()', () => {
  it('returns values in [0, 1)', () => {
    for (let i = 0; i < 500; i++) {
      const v = secureMathRandom();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('produces non-identical consecutive values', () => {
    const values = new Set<number>();
    for (let i = 0; i < 100; i++) values.add(secureMathRandom());
    expect(values.size).toBeGreaterThan(90);
  });
});

describe('generateId()', () => {
  it('produces unique IDs across 500 rapid calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 500; i++) ids.add(generateId());
    expect(ids.size).toBe(500);
  });

  it('contains a timestamp prefix', () => {
    const before = Date.now();
    const id = generateId();
    const after = Date.now();
    const ts = parseInt(id.split('-')[0]!, 10);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('has format timestamp-randomPart', () => {
    expect(generateId()).toMatch(/^\d+-[a-z0-9]+$/);
  });
});

describe('generateRandomString()', () => {
  it('produces correct length', () => {
    expect(generateRandomString(32, 'abc')).toHaveLength(32);
  });

  it('respects empty charset by returning empty repeat', () => {
    expect(generateRandomString(5, '')).toBe('');
  });

  it('handles single-char charset', () => {
    const s = generateRandomString(10, 'X');
    expect(s).toBe('XXXXXXXXXX');
  });

  it('handles length=0', () => {
    expect(generateRandomString(0, 'abc')).toBe('');
  });

  it('only uses characters from the charset', () => {
    const charset = 'ABCDEF';
    const result = generateRandomString(100, charset);
    for (const ch of result) {
      expect(charset).toContain(ch);
    }
  });

  it('produces roughly uniform distribution', () => {
    const charset = 'AB';
    const result = generateRandomString(10000, charset);
    const countA = [...result].filter(c => c === 'A').length;
    // Expect roughly 50% ± 5%
    expect(countA).toBeGreaterThan(4500);
    expect(countA).toBeLessThan(5500);
  });
});

// ═══════════════════════════════════════════════════════════════
// Date & Timestamp Utilities
// ═══════════════════════════════════════════════════════════════

describe('safeParseDate()', () => {
  it('returns number directly for valid finite numbers', () => {
    expect(safeParseDate(1234567890000)).toBe(1234567890000);
  });

  it('returns fallback for NaN', () => {
    const fb = 999;
    expect(safeParseDate(NaN, fb)).toBe(fb);
  });

  it('returns fallback for Infinity', () => {
    expect(safeParseDate(Infinity, 42)).toBe(42);
  });

  it('returns fallback for -Infinity', () => {
    expect(safeParseDate(-Infinity, 42)).toBe(42);
  });

  it('parses valid date strings', () => {
    const ts = safeParseDate('2023-01-15T00:00:00Z');
    expect(ts).toBeGreaterThan(0);
  });

  it('returns fallback for invalid date string', () => {
    expect(safeParseDate('not-a-date', 0)).toBe(0);
  });

  it('returns fallback for null', () => {
    const before = Date.now();
    const result = safeParseDate(null);
    expect(result).toBeGreaterThanOrEqual(before);
  });

  it('returns fallback for undefined', () => {
    const result = safeParseDate(undefined, 123);
    expect(result).toBe(123);
  });

  it('handles Date objects', () => {
    const d = new Date('2023-06-15');
    expect(safeParseDate(d)).toBe(d.getTime());
  });

  it('returns fallback for booleans', () => {
    expect(safeParseDate(true as any, 0)).toBe(0);
  });

  it('returns fallback for objects', () => {
    expect(safeParseDate({} as any, 0)).toBe(0);
  });

  it('handles negative timestamps (before epoch)', () => {
    expect(safeParseDate(-1000)).toBe(-1000);
  });

  it('handles zero', () => {
    expect(safeParseDate(0)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Object & Data Utilities
// ═══════════════════════════════════════════════════════════════

describe('deepClone()', () => {
  it('clones nested objects', () => {
    const obj = { a: { b: { c: 42 } } };
    const clone = deepClone(obj);
    expect(clone).toEqual(obj);
    clone.a.b.c = 99;
    expect(obj.a.b.c).toBe(42); // original unchanged
  });

  it('clones arrays', () => {
    const arr = [1, [2, [3]]];
    const clone = deepClone(arr);
    expect(clone).toEqual(arr);
    (clone[1] as number[])[0] = 99;
    expect((arr[1] as number[])[0]).toBe(2);
  });

  it('clones primitives', () => {
    expect(deepClone(42)).toBe(42);
    expect(deepClone('hello')).toBe('hello');
    expect(deepClone(null)).toBe(null);
  });

  it('clones objects with Date strings (JSON round-trip)', () => {
    const obj = { d: new Date('2023-01-01').toISOString() };
    const clone = deepClone(obj);
    expect(clone.d).toBe(obj.d);
  });
});

describe('deepMerge()', () => {
  it('merges nested objects', () => {
    const target = { a: { x: 1, y: 2 }, b: 3 };
    const source = { a: { y: 99 }, c: 4 };
    const result = deepMerge(target, source as any);
    expect(result).toEqual({ a: { x: 1, y: 99 }, b: 3, c: 4 });
  });

  it('blocks __proto__ pollution', () => {
    const target = { a: 1 };
    const source = JSON.parse('{"__proto__": {"polluted": true}}');
    deepMerge(target, source);
    expect(({} as any).polluted).toBeUndefined();
  });

  it('blocks constructor pollution', () => {
    const target = { a: 1 };
    const source = { constructor: { bad: true } } as any;
    const result = deepMerge(target, source);
    expect(result.constructor).not.toEqual({ bad: true });
  });

  it('blocks prototype pollution', () => {
    const target = { a: 1 };
    const source = { prototype: { bad: true } } as any;
    const result = deepMerge(target, source);
    expect((result as any).prototype).toBeUndefined();
  });

  it('preserves target when source value is undefined', () => {
    const target = { a: 1 };
    const source = { a: undefined } as any;
    const result = deepMerge(target, source);
    expect(result.a).toBe(1);
  });

  it('does not mutate original target', () => {
    const target = { a: { b: 1 } };
    const source = { a: { b: 2 } };
    deepMerge(target, source);
    expect(target.a.b).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// Promise & Timing
// ═══════════════════════════════════════════════════════════════

describe('sleep()', () => {
  it('resolves after approximate delay', async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });

  it('resolves immediately for 0ms', async () => {
    const start = Date.now();
    await sleep(0);
    expect(Date.now() - start).toBeLessThan(50);
  });
});

describe('retry()', () => {
  it('returns immediately on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retry(fn, 3, 10);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValue('ok');
    const result = await retry(fn, 3, 10);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after max retries exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always-fail'));
    await expect(retry(fn, 2, 10)).rejects.toThrow('always-fail');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('withRetry()', () => {
  it('does not retry on null return (non-throwing)', async () => {
    const fn = vi.fn().mockResolvedValue(null);
    const result = await withRetry(fn, 3, 10);
    expect(result).toBeNull();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on thrown error', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('oops'))
      .mockResolvedValue('recovered');
    const result = await withRetry(fn, 3, 10);
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('wraps non-Error throws', async () => {
    const fn = vi.fn().mockRejectedValue('string-error');
    await expect(withRetry(fn, 1, 10)).rejects.toThrow('string-error');
  });
});

describe('withTimeout()', () => {
  it('resolves if promise completes before timeout', async () => {
    const result = await withTimeout(Promise.resolve('fast'), 1000);
    expect(result).toBe('fast');
  });

  it('rejects if promise exceeds timeout', async () => {
    const slow = new Promise(r => setTimeout(r, 5000));
    await expect(withTimeout(slow, 50)).rejects.toThrow('Timeout');
  });

  it('cleans up timer on success', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    await withTimeout(Promise.resolve('ok'), 1000);
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════
// Formatters & Strings
// ═══════════════════════════════════════════════════════════════

describe('formatRelativeTime()', () => {
  it('returns "just now" for timestamps <= 0', () => {
    expect(formatRelativeTime(0)).toBe('just now');
    expect(formatRelativeTime(-1)).toBe('just now');
  });

  it('returns "just now" for recent timestamps (< 10s)', () => {
    expect(formatRelativeTime(Date.now() - 5000)).toBe('just now');
  });

  it('returns seconds format', () => {
    expect(formatRelativeTime(Date.now() - 30_000)).toBe('30s ago');
  });

  it('returns minutes format', () => {
    expect(formatRelativeTime(Date.now() - 5 * 60_000)).toBe('5m ago');
  });

  it('returns hours format', () => {
    expect(formatRelativeTime(Date.now() - 3 * 3600_000)).toBe('3h ago');
  });

  it('returns days format', () => {
    expect(formatRelativeTime(Date.now() - 3 * 86400_000)).toBe('3d ago');
  });

  it('returns formatted date for > 7 days', () => {
    const result = formatRelativeTime(Date.now() - 10 * 86400_000);
    expect(result).not.toContain('ago');
  });

  it('returns "just now" for future timestamps', () => {
    expect(formatRelativeTime(Date.now() + 60_000)).toBe('just now');
  });
});

describe('formatFileSize()', () => {
  it('returns "0 B" for 0', () => {
    expect(formatFileSize(0)).toBe('0 B');
  });

  it('returns "0 B" for negative', () => {
    expect(formatFileSize(-100)).toBe('0 B');
  });

  it('returns "0 B" for NaN', () => {
    expect(formatFileSize(NaN)).toBe('0 B');
  });

  it('returns "0 B" for Infinity', () => {
    expect(formatFileSize(Infinity)).toBe('0 B');
  });

  it('formats bytes correctly', () => {
    expect(formatFileSize(500)).toBe('500 B');
  });

  it('formats KB correctly', () => {
    expect(formatFileSize(1024)).toBe('1 KB');
  });

  it('formats MB correctly', () => {
    expect(formatFileSize(1048576)).toBe('1 MB');
  });

  it('formats GB correctly', () => {
    expect(formatFileSize(1073741824)).toBe('1 GB');
  });

  it('handles fractional values', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });
});

describe('formatEmailDisplay()', () => {
  it('returns short email unchanged', () => {
    expect(formatEmailDisplay('a@b.com')).toBe('a@b.com');
  });

  it('truncates long local part', () => {
    const email = 'verylonglocalpart@domain.com';
    const result = formatEmailDisplay(email, 20);
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result).toContain('@domain.com');
  });

  it('handles email without @', () => {
    expect(formatEmailDisplay('nodomain', 5)).toBe('nodom...');
  });

  it('handles very small maxLength', () => {
    const result = formatEmailDisplay('test@verylongdomain.com', 5);
    expect(result.length).toBeLessThanOrEqual(8); // may end with ...
  });
});

describe('formatOTP()', () => {
  it('formats 6-digit OTP with space', () => {
    expect(formatOTP('123456')).toBe('123 456');
  });

  it('formats 8-digit OTP with space', () => {
    expect(formatOTP('12345678')).toBe('1234 5678');
  });

  it('returns non-standard OTP as-is', () => {
    expect(formatOTP('ABC123')).toBe('ABC123');
    expect(formatOTP('12345')).toBe('12345');
  });
});

describe('pluralize()', () => {
  it('returns singular for 1', () => {
    expect(pluralize(1, 'item')).toBe('item');
  });

  it('adds s for > 1', () => {
    expect(pluralize(2, 'item')).toBe('items');
  });

  it('uses custom plural', () => {
    expect(pluralize(2, 'child', 'children')).toBe('children');
  });

  it('returns plural for 0', () => {
    expect(pluralize(0, 'item')).toBe('items');
  });
});

describe('truncate()', () => {
  it('returns short strings unchanged', () => {
    expect(truncate('hi', 10)).toBe('hi');
  });

  it('truncates with ...', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
  });

  it('handles empty string', () => {
    expect(truncate('', 10)).toBe('');
  });

  it('handles null-ish input', () => {
    expect(truncate(null as any, 10)).toBe('');
  });
});

describe('escapeHtml()', () => {
  it('escapes all dangerous characters', () => {
    expect(escapeHtml('<script>alert("xss")&</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&amp;&lt;/script&gt;'
    );
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });
});

describe('stripHtml()', () => {
  it('removes HTML tags', () => {
    expect(stripHtml('<p>Hello <b>World</b></p>')).toBe('Hello World');
  });

  it('handles self-closing tags', () => {
    expect(stripHtml('text<br/>more')).toBe('textmore');
  });
});

describe('contentToString()', () => {
  it('returns string directly', () => {
    expect(contentToString('hello')).toBe('hello');
  });

  it('returns fallback for null', () => {
    expect(contentToString(null, 'fb')).toBe('fb');
  });

  it('returns fallback for undefined', () => {
    expect(contentToString(undefined, 'fb')).toBe('fb');
  });

  it('extracts text field from object', () => {
    expect(contentToString({ text: 'extracted' })).toBe('extracted');
  });

  it('prefers text over html', () => {
    expect(contentToString({ text: 'txt', html: '<p>html</p>' })).toBe('txt');
  });

  it('falls back to html if text not string', () => {
    expect(contentToString({ text: 42, html: '<p>html</p>' })).toBe('<p>html</p>');
  });

  it('serializes arbitrary objects', () => {
    expect(contentToString({ foo: 'bar' })).toBe('{"foo":"bar"}');
  });

  it('handles number input', () => {
    expect(contentToString(42)).toBe('42');
  });

  it('handles boolean input', () => {
    expect(contentToString(true)).toBe('true');
  });
});

describe('maskPassword()', () => {
  it('masks long password correctly', () => {
    const result = maskPassword('abcdefgh', 2, 2);
    expect(result).toBe('ab••••gh');
  });

  it('masks entire short password', () => {
    const result = maskPassword('abc', 2, 2);
    expect(result).toBe('•••');
  });

  it('handles empty password', () => {
    expect(maskPassword('')).toBe('');
  });

  it('handles single char', () => {
    expect(maskPassword('x', 2, 2)).toBe('•');
  });
});

describe('formatPasswordStrength()', () => {
  it('classifies scores correctly', () => {
    expect(formatPasswordStrength(10)).toBe('Very Weak');
    expect(formatPasswordStrength(25)).toBe('Weak');
    expect(formatPasswordStrength(50)).toBe('Fair');
    expect(formatPasswordStrength(70)).toBe('Strong');
    expect(formatPasswordStrength(90)).toBe('Very Strong');
  });
});

describe('formatCrackTime()', () => {
  it('instant for < 1s', () => {
    expect(formatCrackTime(0.5)).toBe('instant');
  });

  it('seconds', () => {
    expect(formatCrackTime(30)).toBe('30 seconds');
  });

  it('minutes', () => {
    expect(formatCrackTime(120)).toBe('2 minutes');
  });

  it('hours', () => {
    expect(formatCrackTime(7200)).toBe('2 hours');
  });

  it('days', () => {
    expect(formatCrackTime(172800)).toBe('2 days');
  });

  it('forever for very large', () => {
    expect(formatCrackTime(1e15)).toBe('forever');
  });
});

describe('formatEntropy()', () => {
  it('rounds to integer', () => {
    expect(formatEntropy(77.8)).toBe('78 bits');
  });
});

// ═══════════════════════════════════════════════════════════════
// Domain & URL Utilities
// ═══════════════════════════════════════════════════════════════

describe('isIpLiteral()', () => {
  it('detects IPv4', () => {
    expect(isIpLiteral('192.168.1.1')).toBe(true);
  });

  it('detects bracketed IPv6', () => {
    expect(isIpLiteral('[::1]')).toBe(true);
  });

  it('rejects hostnames', () => {
    expect(isIpLiteral('example.com')).toBe(false);
  });
});

describe('rootDomain()', () => {
  it('extracts root from subdomain', () => {
    expect(rootDomain('sub.example.com')).toBe('example.com');
  });

  it('handles ccTLD (co.uk)', () => {
    expect(rootDomain('app.company.co.uk')).toBe('company.co.uk');
  });

  it('returns single-label domains', () => {
    expect(rootDomain('localhost')).toBe('localhost');
  });

  it('returns two-part domains unchanged', () => {
    expect(rootDomain('example.com')).toBe('example.com');
  });

  it('handles trailing dot', () => {
    expect(rootDomain('example.com.')).toBe('example.com');
  });

  it('returns IP literals unchanged', () => {
    expect(rootDomain('192.168.1.1')).toBe('192.168.1.1');
  });

  it('is case-insensitive', () => {
    expect(rootDomain('Sub.Example.COM')).toBe('example.com');
  });

  it('handles empty string', () => {
    expect(rootDomain('')).toBe('');
  });

  it('handles deep subdomains', () => {
    expect(rootDomain('a.b.c.d.example.com')).toBe('example.com');
  });
});

describe('isSubdomainOf()', () => {
  it('returns true for exact match', () => {
    expect(isSubdomainOf('example.com', 'example.com')).toBe(true);
  });

  it('returns true for subdomain', () => {
    expect(isSubdomainOf('sub.example.com', 'example.com')).toBe(true);
  });

  it('returns false for different domains', () => {
    expect(isSubdomainOf('other.com', 'example.com')).toBe(false);
  });

  it('returns false for empty inputs', () => {
    expect(isSubdomainOf('', 'example.com')).toBe(false);
    expect(isSubdomainOf('example.com', '')).toBe(false);
  });
});

describe('sameRootDomain()', () => {
  it('detects same root domain', () => {
    expect(sameRootDomain('sub.example.com', 'other.example.com')).toBe(true);
  });

  it('returns false for different roots', () => {
    expect(sameRootDomain('example.com', 'other.com')).toBe(false);
  });

  it('handles empty inputs', () => {
    expect(sameRootDomain('', 'example.com')).toBe(false);
  });
});

describe('extractEmailAddress()', () => {
  it('extracts from angle brackets', () => {
    expect(extractEmailAddress('John <john@example.com>')).toBe('john@example.com');
  });

  it('extracts bare email', () => {
    expect(extractEmailAddress('user@domain.org')).toBe('user@domain.org');
  });

  it('returns empty for no match', () => {
    expect(extractEmailAddress('no email here')).toBe('');
  });

  it('returns empty for null/undefined', () => {
    expect(extractEmailAddress('')).toBe('');
    expect(extractEmailAddress(null as any)).toBe('');
  });

  it('lowercases extracted email', () => {
    expect(extractEmailAddress('User@DOMAIN.COM')).toBe('user@domain.com');
  });
});

describe('emailHost()', () => {
  it('extracts domain part', () => {
    expect(emailHost('user@example.com')).toBe('example.com');
  });

  it('returns empty for no @', () => {
    expect(emailHost('noemail')).toBe('');
  });

  it('uses last @ for multiple @', () => {
    expect(emailHost('a@b@c.com')).toBe('c.com');
  });
});

describe('getDomain()', () => {
  it('extracts hostname from URL', () => {
    expect(getDomain('https://www.example.com/path')).toBe('www.example.com');
  });

  it('returns empty for invalid URL', () => {
    expect(getDomain('not-a-url')).toBe('');
  });
});

describe('parseEmail()', () => {
  it('parses valid email', () => {
    expect(parseEmail('user@domain.com')).toEqual({ login: 'user', domain: 'domain.com' });
  });

  it('returns null for invalid', () => {
    expect(parseEmail('noemail')).toBeNull();
  });
});

describe('isValidEmail()', () => {
  it('validates standard emails', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
  });

  it('rejects missing @', () => {
    expect(isValidEmail('userexample.com')).toBe(false);
  });

  it('rejects spaces', () => {
    expect(isValidEmail('user @example.com')).toBe(false);
  });
});

describe('isValidUrl()', () => {
  it('validates http URLs', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
  });

  it('rejects invalid', () => {
    expect(isValidUrl('not-url')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Type Guards
// ═══════════════════════════════════════════════════════════════

describe('isObject()', () => {
  it('true for plain objects', () => expect(isObject({})).toBe(true));
  it('false for null', () => expect(isObject(null)).toBe(false));
  it('false for arrays', () => expect(isObject([])).toBe(false));
  it('false for primitives', () => expect(isObject(42)).toBe(false));
  it('false for strings', () => expect(isObject('str')).toBe(false));
});

describe('isNonEmptyString()', () => {
  it('true for non-empty', () => expect(isNonEmptyString('hi')).toBe(true));
  it('false for empty', () => expect(isNonEmptyString('')).toBe(false));
  it('false for whitespace-only', () => expect(isNonEmptyString('   ')).toBe(false));
  it('false for number', () => expect(isNonEmptyString(42 as any)).toBe(false));
});

describe('isNumberInRange()', () => {
  it('true for in-range', () => expect(isNumberInRange(5, 1, 10)).toBe(true));
  it('true for boundary min', () => expect(isNumberInRange(1, 1, 10)).toBe(true));
  it('true for boundary max', () => expect(isNumberInRange(10, 1, 10)).toBe(true));
  it('false for out-of-range', () => expect(isNumberInRange(11, 1, 10)).toBe(false));
  it('false for NaN', () => expect(isNumberInRange(NaN, 1, 10)).toBe(false));
  it('false for string', () => expect(isNumberInRange('5' as any, 1, 10)).toBe(false));
});

describe('isStringArray()', () => {
  it('true for string array', () => expect(isStringArray(['a', 'b'])).toBe(true));
  it('false for mixed array', () => expect(isStringArray(['a', 1])).toBe(false));
  it('true for empty array', () => expect(isStringArray([])).toBe(true));
  it('false for non-array', () => expect(isStringArray('str' as any)).toBe(false));
});

describe('isEmailAccount()', () => {
  it('validates complete account', () => {
    expect(isEmailAccount({
      fullEmail: 'user@example.com',
      domain: 'example.com',
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      service: 'catchmail',
    })).toBe(true);
  });

  it('rejects missing fields', () => {
    expect(isEmailAccount({ fullEmail: 'user@example.com' })).toBe(false);
  });

  it('rejects non-email fullEmail', () => {
    expect(isEmailAccount({
      fullEmail: 'notemail',
      domain: 'x',
      createdAt: 1,
      expiresAt: 2,
      service: 's',
    })).toBe(false);
  });
});

describe('isSuccessResponse() / isErrorResponse()', () => {
  it('detects success', () => {
    expect(isSuccessResponse({ success: true })).toBe(true);
    expect(isSuccessResponse({ success: false })).toBe(false);
  });

  it('detects error', () => {
    expect(isErrorResponse({ success: false, error: 'msg' })).toBe(true);
    expect(isErrorResponse({ success: true })).toBe(false);
  });
});

describe('isStorageChange()', () => {
  it('detects newValue', () => {
    expect(isStorageChange({ newValue: 42 })).toBe(true);
  });

  it('detects oldValue', () => {
    expect(isStorageChange({ oldValue: 'x' })).toBe(true);
  });

  it('rejects empty objects', () => {
    expect(isStorageChange({})).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Error Handling
// ═══════════════════════════════════════════════════════════════

describe('Error classes', () => {
  it('AppError has correct properties', () => {
    const e = new AppError('msg', 'CODE', { detail: true });
    expect(e.message).toBe('msg');
    expect(e.code).toBe('CODE');
    expect(e.details).toEqual({ detail: true });
    expect(e.name).toBe('AppError');
    expect(e instanceof Error).toBe(true);
  });

  it('NetworkError extends AppError', () => {
    const e = new NetworkError('net fail');
    expect(e.code).toBe('NETWORK_ERROR');
    expect(e.name).toBe('NetworkError');
    expect(e instanceof AppError).toBe(true);
  });

  it('StorageError extends AppError', () => {
    const e = new StorageError('storage fail');
    expect(e.code).toBe('STORAGE_ERROR');
  });

  it('ValidationError extends AppError', () => {
    const e = new ValidationError('bad input');
    expect(e.code).toBe('VALIDATION_ERROR');
  });

  it('PermissionError extends AppError', () => {
    const e = new PermissionError('denied');
    expect(e.code).toBe('PERMISSION_ERROR');
  });
});

describe('handleError()', () => {
  it('returns AppError directly', () => {
    const err = new AppError('test', 'CODE');
    expect(handleError(err)).toBe(err);
  });

  it('wraps Error instances', () => {
    const result = handleError(new Error('std error'));
    expect(result).toBeInstanceOf(AppError);
    expect(result.code).toBe('UNKNOWN_ERROR');
  });

  it('wraps unknown values', () => {
    const result = handleError('string error');
    expect(result).toBeInstanceOf(AppError);
  });
});

describe('tryCatch()', () => {
  it('returns function result on success', () => {
    expect(tryCatch(() => 42, -1)).toBe(42);
  });

  it('returns fallback on error', () => {
    expect(tryCatch(() => { throw new Error('oops'); }, -1)).toBe(-1);
  });
});

describe('safeJsonParse()', () => {
  it('parses valid JSON', () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns null for invalid JSON', () => {
    expect(safeJsonParse('not json')).toBeNull();
  });

  it('returns fallback for invalid JSON', () => {
    expect(safeJsonParse('bad', { default: true })).toEqual({ default: true });
  });
});

describe('assert()', () => {
  it('passes for true condition', () => {
    expect(() => assert(true, 'ok')).not.toThrow();
  });

  it('throws AppError for false condition', () => {
    expect(() => assert(false, 'fail')).toThrow(AppError);
  });
});

describe('assertDefined()', () => {
  it('passes for defined values', () => {
    expect(() => assertDefined(42)).not.toThrow();
    expect(() => assertDefined('')).not.toThrow();
    expect(() => assertDefined(0)).not.toThrow();
  });

  it('throws for null', () => {
    expect(() => assertDefined(null)).toThrow(AppError);
  });

  it('throws for undefined', () => {
    expect(() => assertDefined(undefined)).toThrow(AppError);
  });
});

describe('getErrorMessage()', () => {
  it('extracts from AppError', () => {
    expect(getErrorMessage(new AppError('app', 'CODE'))).toBe('app');
  });

  it('extracts from Error', () => {
    expect(getErrorMessage(new Error('std'))).toBe('std');
  });

  it('returns string directly', () => {
    expect(getErrorMessage('plain string')).toBe('plain string');
  });

  it('returns default for unknown', () => {
    expect(getErrorMessage(42)).toBe('An unknown error occurred');
  });
});

describe('toErrorResponse() / toSuccessResponse()', () => {
  it('creates error response', () => {
    const r = toErrorResponse(new Error('fail'));
    expect(r).toEqual({ success: false, error: 'fail' });
  });

  it('creates success response without data', () => {
    expect(toSuccessResponse()).toEqual({ success: true });
  });

  it('creates success response with data', () => {
    expect(toSuccessResponse({ count: 5 })).toEqual({ success: true, count: 5 });
  });
});

describe('hasProperty()', () => {
  it('returns true when property exists', () => {
    expect(hasProperty({ foo: 1 }, 'foo')).toBe(true);
  });

  it('returns false when missing', () => {
    expect(hasProperty({ foo: 1 }, 'bar')).toBe(false);
  });

  it('returns false for non-objects', () => {
    expect(hasProperty(42, 'toString')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// LRU Cache
// ═══════════════════════════════════════════════════════════════

describe('LRUCache', () => {
  let cache: LRUCache<string, number>;

  beforeEach(() => {
    cache = new LRUCache<string, number>(3, 60000);
  });

  it('stores and retrieves values', () => {
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
  });

  it('evicts oldest when capacity exceeded', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4); // should evict 'a'
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('d')).toBe(4);
  });

  it('promotes accessed items (LRU order)', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.get('a'); // promote 'a' — now 'b' is oldest
    cache.set('d', 4); // should evict 'b'
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
  });

  it('expires entries based on TTL', () => {
    const shortCache = new LRUCache<string, number>(10, 50);
    shortCache.set('x', 42);
    expect(shortCache.get('x')).toBe(42);

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(shortCache.get('x')).toBeUndefined();
        resolve();
      }, 100);
    });
  });

  it('delete removes entries', () => {
    cache.set('a', 1);
    expect(cache.delete('a')).toBe(true);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.delete('nonexistent')).toBe(false);
  });

  it('has() respects TTL', () => {
    const shortCache = new LRUCache<string, number>(10, 50);
    shortCache.set('x', 1);
    expect(shortCache.has('x')).toBe(true);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(shortCache.has('x')).toBe(false);
        resolve();
      }, 100);
    });
  });

  it('clear() empties the cache', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('keys() returns all keys', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.keys().sort()).toEqual(['a', 'b']);
  });

  it('getStats() reports correctly', () => {
    cache.set('a', 1);
    const stats = cache.getStats();
    expect(stats.size).toBe(1);
    expect(stats.maxSize).toBe(3);
    expect(stats.utilization).toBeCloseTo(1 / 3);
  });

  it('cleanup() removes expired entries', () => {
    const shortCache = new LRUCache<string, number>(10, 50);
    shortCache.set('x', 1);
    shortCache.set('y', 2);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const removed = shortCache.cleanup();
        expect(removed).toBe(2);
        expect(shortCache.size).toBe(0);
        resolve();
      }, 100);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// OTP Extraction
// ═══════════════════════════════════════════════════════════════

describe('extractOTP()', () => {
  it('extracts 6-digit OTP from verification email', () => {
    const text = 'Your verification code is 482910. Enter it to continue.';
    expect(extractOTP(text)).toBe('482910');
  });

  it('extracts OTP near keyword', () => {
    const text = 'One-time passcode: 739281. Valid for 5 minutes.';
    expect(extractOTP(text)).toBe('739281');
  });

  it('returns null when no OTP keywords present', () => {
    expect(extractOTP('Hello world, nothing here 123456')).toBeNull();
  });

  it('rejects year-like numbers', () => {
    const text = 'Your verification code was sent in 2024.';
    expect(extractOTP(text)).toBeNull();
  });

  it('rejects price-context numbers', () => {
    const text = 'Your verification code: amount $12345 charged.';
    // The 12345 should be rejected due to $ context
    const result = extractOTP(text);
    expect(result).toBeNull();
  });

  it('rejects tracking numbers', () => {
    const text = 'Your verification code: order tracking number 12345678.';
    expect(extractOTP(text)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(extractOTP('')).toBeNull();
    expect(extractOTP(null as any)).toBeNull();
  });

  it('prefers 6-digit codes (higher score)', () => {
    const text = 'Your security code is 123456. Reference: 87654321.';
    expect(extractOTP(text)).toBe('123456');
  });

  it('handles "do not share" context boost', () => {
    const text = 'Your code is 998877. Do not share this with anyone.';
    expect(extractOTP(text)).toBe('998877');
  });

  it('rejects all-zeros', () => {
    const text = 'Your verification code is 000000.';
    expect(extractOTP(text)).toBeNull();
  });

  it('rejects repeated digits', () => {
    const text = 'Your verification code is 111111.';
    expect(extractOTP(text)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// Activation Link Extraction
// ═══════════════════════════════════════════════════════════════

describe('extractActivationLink()', () => {
  it('extracts verification link', () => {
    const text = 'Click to verify your account: https://example.com/verify?token=abc123';
    const link = extractActivationLink(text);
    expect(link).toContain('https://example.com/verify');
  });

  it('prefers activation URLs over plain URLs', () => {
    const text = `
      Visit https://example.com/home for more info.
      Click https://example.com/confirm?token=xyz to activate your account.
    `;
    const link = extractActivationLink(text);
    expect(link).toContain('/confirm');
  });

  it('rejects image URLs', () => {
    const text = 'Verify: https://example.com/images/logo.png Click here to activate.';
    const link = extractActivationLink(text);
    // Should not pick the image URL
    if (link) {
      expect(link).not.toContain('.png');
    }
  });

  it('prefers activation link over tracking link', () => {
    const text = 'Click https://example.com/analytics/tracking?id=123 or https://example.com/verify?token=abc to activate your account.';
    const link = extractActivationLink(text);
    expect(link).toContain('/verify');
  });

  it('returns null for no URLs', () => {
    expect(extractActivationLink('No links here at all')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(extractActivationLink('')).toBeNull();
  });

  it('handles known provider domains', () => {
    const text = 'Verify your account at https://accounts.google.com/verify?token=abc123';
    const link = extractActivationLink(text);
    expect(link).toContain('accounts.google.com');
  });
});
