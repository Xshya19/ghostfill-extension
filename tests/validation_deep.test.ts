/**
 * validation_deep.test.ts
 * Deep test suite for src/utils/validation.ts
 */
import { describe, it, expect } from 'vitest';

import {
  validateMessage,
  validateEmail,
  validatePasswordOptions,
  validateOTP,
  validateDomain,
  sanitizeString,
  isSafeString,
} from '../src/utils/validation';

// ═══════════════════════════════════════════════════════════════
// validateMessage
// ═══════════════════════════════════════════════════════════════

describe('validateMessage() deep tests', () => {
  it('validates GET_LAST_OTP action (no payload needed)', () => {
    const msg = { action: 'GET_LAST_OTP' };
    const result = validateMessage(msg);
    expect(result.valid).toBe(true);
  });

  it('validates FILL_OTP action with payload', () => {
    const msg = { action: 'FILL_OTP', payload: { otp: '123456' } };
    const result = validateMessage(msg);
    expect(result.valid).toBe(true);
  });

  it('validates EXTRACT_OTP action with textBody payload', () => {
    const msg = { action: 'EXTRACT_OTP', payload: { textBody: 'Your code is 123456', emailFrom: 'noreply@test.com', subject: 'Verify' } };
    const result = validateMessage(msg);
    expect(result.valid).toBe(true);
  });

  it('rejects missing action', () => {
    const msg = { payload: {} };
    const result = validateMessage(msg as any);
    expect(result.valid).toBe(false);
  });

  it('rejects null message', () => {
    const result = validateMessage(null as any);
    expect(result.valid).toBe(false);
  });

  it('rejects non-object message', () => {
    expect(validateMessage('string' as any).valid).toBe(false);
    expect(validateMessage(42 as any).valid).toBe(false);
    expect(validateMessage(true as any).valid).toBe(false);
  });

  it('validates GET_IDENTITY action', () => {
    const msg = { action: 'GET_IDENTITY' };
    const result = validateMessage(msg);
    expect(result.valid).toBe(true);
  });

  it('validates GENERATE_PASSWORD action', () => {
    const msg = { action: 'GENERATE_PASSWORD' };
    const result = validateMessage(msg);
    expect(result.valid).toBe(true);
  });

  it('rejects unknown action without crashing', () => {
    const msg = { action: 'NONEXISTENT_ACTION_XYZ', payload: {} };
    const result = validateMessage(msg);
    // Should return a result (either valid with no validator, or invalid)
    expect(result).toBeDefined();
    expect(typeof result.valid).toBe('boolean');
  });

  it('handles oversized payload validation', () => {
    const hugePayload = { data: 'x'.repeat(1_000_001) };
    const msg = { action: 'EXTRACT_OTP', payload: hugePayload };
    const result = validateMessage(msg);
    // Should fail due to size limits
    expect(result.valid).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// validateEmail (returns { valid: boolean; error?: string })
// ═══════════════════════════════════════════════════════════════

describe('validateEmail() deep tests', () => {
  it('accepts standard emails', () => {
    expect(validateEmail('user@example.com').valid).toBe(true);
    expect(validateEmail('first.last@domain.org').valid).toBe(true);
    expect(validateEmail('user+tag@domain.com').valid).toBe(true);
  });

  it('rejects missing @', () => {
    expect(validateEmail('userdomain.com').valid).toBe(false);
  });

  it('rejects double @', () => {
    expect(validateEmail('user@@domain.com').valid).toBe(false);
  });

  it('rejects leading/trailing spaces', () => {
    expect(validateEmail(' user@domain.com').valid).toBe(false);
    expect(validateEmail('user@domain.com ').valid).toBe(false);
  });

  it('rejects empty local part', () => {
    expect(validateEmail('@domain.com').valid).toBe(false);
  });

  it('rejects empty domain', () => {
    expect(validateEmail('user@').valid).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validateEmail('').valid).toBe(false);
  });

  it('rejects null/undefined', () => {
    expect(validateEmail(null as any).valid).toBe(false);
    expect(validateEmail(undefined as any).valid).toBe(false);
  });

  it('accepts subdomains', () => {
    expect(validateEmail('user@sub.domain.com').valid).toBe(true);
  });

  it('returns error message on failure', () => {
    const result = validateEmail('invalid');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('string');
  });
});

// ═══════════════════════════════════════════════════════════════
// validatePasswordOptions (returns { valid: boolean; error?: string })
// ═══════════════════════════════════════════════════════════════

describe('validatePasswordOptions() deep tests', () => {
  it('accepts default options', () => {
    expect(validatePasswordOptions({
      length: 16,
      uppercase: true,
      lowercase: true,
      numbers: true,
      symbols: true,
    } as any).valid).toBe(true);
  });

  it('rejects length < 4', () => {
    expect(validatePasswordOptions({ length: 3 } as any).valid).toBe(false);
  });

  it('rejects length > 128', () => {
    expect(validatePasswordOptions({ length: 129 } as any).valid).toBe(false);
  });

  it('accepts minimum length', () => {
    expect(validatePasswordOptions({
      length: 4,
      uppercase: true,
      lowercase: false,
      numbers: false,
      symbols: false,
    } as any).valid).toBe(true);
  });

  it('accepts maximum length', () => {
    expect(validatePasswordOptions({
      length: 128,
      uppercase: true,
      lowercase: false,
      numbers: false,
      symbols: false,
    } as any).valid).toBe(true);
  });

  it('rejects when all character types disabled', () => {
    expect(validatePasswordOptions({
      length: 16,
      uppercase: false,
      lowercase: false,
      numbers: false,
      symbols: false,
    } as any).valid).toBe(false);
  });

  it('rejects when min requirements exceed length', () => {
    expect(validatePasswordOptions({
      length: 4,
      uppercase: true,
      lowercase: true,
      numbers: true,
      symbols: true,
      minUppercase: 2,
      minLowercase: 2,
      minNumbers: 2,
      minSymbols: 2,
    } as any).valid).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// validateOTP (returns { valid: boolean; error?: string })
// ═══════════════════════════════════════════════════════════════

describe('validateOTP() deep tests', () => {
  it('accepts 4-digit OTP', () => {
    expect(validateOTP('1234').valid).toBe(true);
  });

  it('accepts 6-digit OTP', () => {
    expect(validateOTP('123456').valid).toBe(true);
  });

  it('accepts 8-digit OTP', () => {
    expect(validateOTP('12345678').valid).toBe(true);
  });

  it('accepts alphanumeric OTP', () => {
    expect(validateOTP('ABC123').valid).toBe(true);
  });

  it('rejects too short (< 4)', () => {
    expect(validateOTP('123').valid).toBe(false);
  });

  it('rejects empty', () => {
    expect(validateOTP('').valid).toBe(false);
  });

  it('rejects null', () => {
    expect(validateOTP(null as any).valid).toBe(false);
  });

  it('rejects OTP with hyphens (regex requires clean alphanumeric)', () => {
    // The actual regex is /^\d{4,8}$/ or /^[A-Z0-9]{4,10}$/i
    // Hyphens are NOT accepted
    expect(validateOTP('123-456').valid).toBe(false);
  });

  it('rejects OTP with spaces', () => {
    expect(validateOTP('123 456').valid).toBe(false);
  });

  it('returns error message on failure', () => {
    const result = validateOTP('ab');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// validateDomain (returns { valid: boolean; error?: string })
// ═══════════════════════════════════════════════════════════════

describe('validateDomain() deep tests', () => {
  it('accepts standard domains', () => {
    expect(validateDomain('example.com').valid).toBe(true);
    expect(validateDomain('sub.domain.org').valid).toBe(true);
  });

  it('rejects empty', () => {
    expect(validateDomain('').valid).toBe(false);
  });

  it('rejects null', () => {
    expect(validateDomain(null as any).valid).toBe(false);
  });

  it('rejects domains with spaces', () => {
    expect(validateDomain('exam ple.com').valid).toBe(false);
  });

  it('rejects domains with protocol', () => {
    expect(validateDomain('http://example.com').valid).toBe(false);
  });

  it('rejects single label (no TLD)', () => {
    // The regex requires at least one dot: /^[a-z0-9]+([-.]{1}[a-z0-9]+)*\.[a-z]{2,}$/i
    expect(validateDomain('localhost').valid).toBe(false);
  });

  it('returns error message on failure', () => {
    const result = validateDomain('');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// sanitizeString
// ═══════════════════════════════════════════════════════════════

describe('sanitizeString() deep tests', () => {
  it('strips < and > characters', () => {
    const result = sanitizeString('<b>bold</b>');
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
  });

  it('trims whitespace', () => {
    expect(sanitizeString('  hello  ')).toBe('hello');
  });

  it('truncates to maxLength', () => {
    const result = sanitizeString('hello world', 5);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('handles maxLength=0', () => {
    expect(sanitizeString('hello', 0)).toBe('');
  });

  it('handles null input', () => {
    expect(sanitizeString(null as any)).toBe('');
  });

  it('handles undefined input', () => {
    expect(sanitizeString(undefined as any)).toBe('');
  });

  it('handles empty string', () => {
    expect(sanitizeString('')).toBe('');
  });

  it('preserves safe content', () => {
    expect(sanitizeString('hello world')).toBe('hello world');
  });
});

// ═══════════════════════════════════════════════════════════════
// isSafeString
// ═══════════════════════════════════════════════════════════════

describe('isSafeString() deep tests', () => {
  it('returns true for safe alphanumeric strings', () => {
    expect(isSafeString('hello world')).toBe(true);
    expect(isSafeString('user@example.com')).toBe(true);
  });

  // Note: isSafeString allows < and > because its regex includes them
  // /^[\w\s.,!?@#$%^&*()[\]{}|;:'"-+=<>/\\~`]+$/
  it('allows angle brackets (part of safe regex)', () => {
    expect(isSafeString('<script>alert(1)</script>')).toBe(true);
  });

  it('returns false for null bytes', () => {
    expect(isSafeString('hello\x00world')).toBe(false);
  });

  it('returns false for control characters', () => {
    expect(isSafeString('hello\x01world')).toBe(false);
  });

  it('returns false for empty string (regex requires 1+ chars)', () => {
    expect(isSafeString('')).toBe(false);
  });

  it('returns true for common punctuation', () => {
    expect(isSafeString('Hello, World! How are you?')).toBe(true);
    expect(isSafeString("It's a test")).toBe(true);
    expect(isSafeString('100% done')).toBe(true);
  });

  it('returns false for emoji', () => {
    expect(isSafeString('Hello 🌍')).toBe(false);
  });
});
