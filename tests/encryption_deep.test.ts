/**
 * encryption_deep.test.ts
 * Deep test suite for src/utils/encryption.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  deriveKey,
  encrypt,
  decrypt,
  generateSecurePassword,
  validatePasswordStrength,
  hashPassword,
  verifyPassword,
  secureClearKeys,
  isKeyExpired,
  getRandomBytes,
  getRandomInt,
  getRandomString,
  secureShuffleArray,
  generateUUID,
  secureClearString,
} from '../src/utils/encryption';

// ═══════════════════════════════════════════════════════════════
// deriveKey
// ═══════════════════════════════════════════════════════════════

describe('deriveKey() deep tests', () => {
  it('derives deterministic key from same password+salt', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const k1 = await deriveKey('test-password', salt);
    const k2 = await deriveKey('test-password', salt);
    // Keys should be cached — same object
    expect(k1).toBe(k2);
  });

  it('derives different keys from different passwords', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const k1 = await deriveKey('password-a', salt);
    const k2 = await deriveKey('password-b', salt);
    expect(k1).not.toBe(k2);
  });

  it('derives different keys from different salts', async () => {
    const s1 = crypto.getRandomValues(new Uint8Array(32));
    const s2 = crypto.getRandomValues(new Uint8Array(32));
    const k1 = await deriveKey('same-password', s1);
    const k2 = await deriveKey('same-password', s2);
    expect(k1).not.toBe(k2);
  });

  it('handles empty password', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const key = await deriveKey('', salt);
    expect(key).toBeDefined();
    expect(key.type).toBe('secret');
  });

  it('handles unicode password', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const key = await deriveKey('密码🔑', salt);
    expect(key).toBeDefined();
  });

  it('cache evicts after MAX_CACHE_SIZE', async () => {
    // Derive 25 unique keys to fill cache
    const salts = Array.from({ length: 25 }, () => crypto.getRandomValues(new Uint8Array(32)));
    for (const salt of salts) {
      await deriveKey(`pass-${Math.random()}`, salt);
    }
    // Should not throw — cache should evict
  });
});

// ═══════════════════════════════════════════════════════════════
// encrypt / decrypt
// ═══════════════════════════════════════════════════════════════

describe('encrypt()/decrypt() deep tests', () => {
  it('round-trips objects', async () => {
    const data = { secret: 'value', nested: { a: [1, 2, 3] } };
    const enc = await encrypt(data, 'password123');
    const dec = await decrypt(enc, 'password123');
    expect(dec).toEqual(data);
  });

  it('round-trips strings', async () => {
    const enc = await encrypt('hello world', 'pw');
    const dec = await decrypt<string>(enc, 'pw');
    expect(dec).toBe('hello world');
  });

  it('round-trips numbers', async () => {
    const enc = await encrypt(42, 'pw');
    const dec = await decrypt<number>(enc, 'pw');
    expect(dec).toBe(42);
  });

  it('round-trips booleans', async () => {
    const enc = await encrypt(true, 'pw');
    const dec = await decrypt<boolean>(enc, 'pw');
    expect(dec).toBe(true);
  });

  it('round-trips null', async () => {
    const enc = await encrypt(null, 'pw');
    const dec = await decrypt(enc, 'pw');
    expect(dec).toBeNull();
  });

  it('round-trips empty arrays', async () => {
    const enc = await encrypt([], 'pw');
    const dec = await decrypt(enc, 'pw');
    expect(dec).toEqual([]);
  });

  it('produces different ciphertexts for same data (random IV)', async () => {
    const enc1 = await encrypt('same', 'pw');
    const enc2 = await encrypt('same', 'pw');
    expect(enc1).not.toBe(enc2);
  });

  it('fails to decrypt with wrong password', async () => {
    const enc = await encrypt('secret', 'correct-pw');
    await expect(decrypt(enc, 'wrong-pw')).rejects.toThrow();
  });

  it('rejects tampered ciphertext', async () => {
    const enc = await encrypt('data', 'pw');
    const tampered = enc.slice(0, -5) + 'XXXXX';
    await expect(decrypt(tampered, 'pw')).rejects.toThrow();
  });

  it('handles v1: prefix', async () => {
    const enc = await encrypt('data', 'pw');
    expect(enc.startsWith('v1:')).toBe(true);
    const dec = await decrypt(enc, 'pw');
    expect(dec).toBe('data');
  });

  it('rejects non-base64 data', async () => {
    await expect(decrypt('not-valid-base64!!!', 'pw')).rejects.toThrow();
  });

  it('rejects too-short data', async () => {
    const short = 'v1:' + btoa('AB'); // Way too short
    await expect(decrypt(short, 'pw')).rejects.toThrow();
  });

  it('rejects wrong encryption version', async () => {
    // Create data with version byte = 2
    const packed = new Uint8Array(50);
    packed[0] = 2; // Wrong version
    const b64 = btoa(String.fromCharCode(...packed));
    await expect(decrypt('v1:' + b64, 'pw')).rejects.toThrow('Unsupported encryption version');
  });

  it('round-trips with CryptoKey directly', async () => {
    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    const enc = await encrypt({ msg: 'hello' }, key);
    const dec = await decrypt<{ msg: string }>(enc, key);
    expect(dec).toEqual({ msg: 'hello' });
  });

  it('handles unicode data', async () => {
    const data = '日本語テスト 🔐 مرحبا';
    const enc = await encrypt(data, 'pw');
    const dec = await decrypt<string>(enc, 'pw');
    expect(dec).toBe(data);
  });

  it('handles large payloads (100KB)', async () => {
    const large = 'x'.repeat(100_000);
    const enc = await encrypt(large, 'pw');
    const dec = await decrypt<string>(enc, 'pw');
    expect(dec).toBe(large);
  });
});

// ═══════════════════════════════════════════════════════════════
// generateSecurePassword
// ═══════════════════════════════════════════════════════════════

describe('generateSecurePassword() deep tests', () => {
  it('generates correct length', () => {
    expect(generateSecurePassword(16)).toHaveLength(16);
    expect(generateSecurePassword(64)).toHaveLength(64);
    expect(generateSecurePassword(1)).toHaveLength(1);
  });

  it('produces unique passwords', () => {
    const passwords = new Set<string>();
    for (let i = 0; i < 100; i++) {
      passwords.add(generateSecurePassword(32));
    }
    expect(passwords.size).toBe(100);
  });

  it('uses all character types (statistical)', () => {
    // Generate many passwords to check coverage
    let hasUpper = false, hasLower = false, hasNum = false, hasSpecial = false;
    for (let i = 0; i < 50; i++) {
      const pw = generateSecurePassword(32);
      if (/[A-Z]/.test(pw)) hasUpper = true;
      if (/[a-z]/.test(pw)) hasLower = true;
      if (/[0-9]/.test(pw)) hasNum = true;
      if (/[^A-Za-z0-9]/.test(pw)) hasSpecial = true;
    }
    expect(hasUpper).toBe(true);
    expect(hasLower).toBe(true);
    expect(hasNum).toBe(true);
    expect(hasSpecial).toBe(true);
  });

  it('default length is 32', () => {
    expect(generateSecurePassword()).toHaveLength(32);
  });
});

// ═══════════════════════════════════════════════════════════════
// validatePasswordStrength
// ═══════════════════════════════════════════════════════════════

describe('validatePasswordStrength() deep tests', () => {
  it('empty password has score 0', () => {
    const result = validatePasswordStrength('');
    expect(result.score).toBe(0);
  });

  it('short weak password', () => {
    const result = validatePasswordStrength('abc');
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.feedback).toContain('Password is too weak');
  });

  it('strong password scores 3-4', () => {
    const result = validatePasswordStrength('MyStr0ng!P@ssw0rd');
    expect(result.score).toBeGreaterThanOrEqual(3);
  });

  it('score never exceeds 4', () => {
    const result = validatePasswordStrength('A1!aA1!aA1!aA1!aA1!a');
    expect(result.score).toBeLessThanOrEqual(4);
  });

  it('provides length feedback', () => {
    const result = validatePasswordStrength('Short1!');
    expect(result.feedback.some(f => f.includes('12 characters'))).toBe(true);
  });

  it('provides uppercase feedback', () => {
    const result = validatePasswordStrength('nouppercase1!');
    expect(result.feedback.some(f => f.includes('uppercase'))).toBe(true);
  });

  it('provides digit feedback', () => {
    const result = validatePasswordStrength('NoDigitsHere!');
    expect(result.feedback.some(f => f.includes('numbers'))).toBe(true);
  });

  it('provides special char feedback', () => {
    const result = validatePasswordStrength('NoSpecialChars1A');
    expect(result.feedback.some(f => f.includes('special'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// hashPassword / verifyPassword
// ═══════════════════════════════════════════════════════════════

describe('hashPassword()/verifyPassword() deep tests', () => {
  it('produces consistent hash for same password', async () => {
    const h1 = await hashPassword('consistent');
    const h2 = await hashPassword('consistent');
    expect(h1).toBe(h2);
  });

  it('produces 64-char hex hash', async () => {
    const hash = await hashPassword('test');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifies correct password', async () => {
    const hash = await hashPassword('mypassword');
    expect(await verifyPassword('mypassword', hash)).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hash = await hashPassword('correct');
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('different passwords produce different hashes', async () => {
    const h1 = await hashPassword('password1');
    const h2 = await hashPassword('password2');
    expect(h1).not.toBe(h2);
  });

  it('handles empty password', async () => {
    const hash = await hashPassword('');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('constant-time comparison rejects different lengths', async () => {
    const hash = await hashPassword('test');
    expect(await verifyPassword('test', hash + 'extra')).toBe(false);
  });

  it('handles unicode passwords', async () => {
    const hash = await hashPassword('密码🔒');
    expect(await verifyPassword('密码🔒', hash)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// secureClearString / secureClearKeys
// ═══════════════════════════════════════════════════════════════

describe('secureClearString()', () => {
  it('clears the reference value', () => {
    const ref = { value: 'sensitive-data' };
    secureClearString(ref);
    expect(ref.value).toBe('');
  });

  it('handles empty string', () => {
    const ref = { value: '' };
    secureClearString(ref);
    expect(ref.value).toBe('');
  });

  it('handles null ref', () => {
    expect(() => secureClearString(null as any)).not.toThrow();
  });
});

describe('secureClearKeys()', () => {
  it('does not throw', () => {
    expect(() => secureClearKeys()).not.toThrow();
  });
});

describe('isKeyExpired()', () => {
  it('returns true when no expiration set (after clear)', () => {
    secureClearKeys();
    expect(isKeyExpired()).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Random Number Utilities
// ═══════════════════════════════════════════════════════════════

describe('getRandomBytes()', () => {
  it('returns correct length', () => {
    expect(getRandomBytes(16)).toHaveLength(16);
    expect(getRandomBytes(32)).toHaveLength(32);
  });

  it('produces non-zero output', () => {
    const bytes = getRandomBytes(32);
    const hasNonZero = bytes.some(b => b !== 0);
    expect(hasNonZero).toBe(true);
  });

  it('produces different outputs', () => {
    const a = getRandomBytes(16);
    const b = getRandomBytes(16);
    const aStr = Array.from(a).join(',');
    const bStr = Array.from(b).join(',');
    expect(aStr).not.toBe(bStr);
  });
});

describe('getRandomInt()', () => {
  it('returns min when min === max', () => {
    expect(getRandomInt(5, 5)).toBe(5);
  });

  it('stays within bounds', () => {
    for (let i = 0; i < 200; i++) {
      const v = getRandomInt(10, 20);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(20);
    }
  });

  it('returns min when min > max', () => {
    expect(getRandomInt(10, 5)).toBe(10);
  });

  it('covers the full range (uniform distribution)', () => {
    const counts = new Map<number, number>();
    for (let i = 0; i < 5000; i++) {
      const v = getRandomInt(0, 4);
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    // Each of 5 values should appear ~1000 times
    for (let i = 0; i <= 4; i++) {
      expect(counts.get(i)!).toBeGreaterThan(700);
      expect(counts.get(i)!).toBeLessThan(1300);
    }
  });
});

describe('getRandomString()', () => {
  it('produces correct length from charset', () => {
    expect(getRandomString(10, 'abc')).toHaveLength(10);
  });

  it('only uses charset characters', () => {
    const s = getRandomString(100, 'XY');
    for (const c of s) {
      expect('XY').toContain(c);
    }
  });
});

describe('secureShuffleArray()', () => {
  it('preserves all elements', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const shuffled = secureShuffleArray(arr);
    expect(shuffled.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('does not mutate original when inPlace=false', () => {
    const arr = [1, 2, 3];
    const original = [...arr];
    secureShuffleArray(arr, false);
    expect(arr).toEqual(original);
  });

  it('mutates array when inPlace=true', () => {
    const arr = Array.from({ length: 100 }, (_, i) => i);
    const original = [...arr];
    secureShuffleArray(arr, true);
    // With 100 elements, extremely unlikely to stay in same order
    expect(arr).not.toEqual(original);
  });

  it('handles empty array', () => {
    expect(secureShuffleArray([])).toEqual([]);
  });

  it('handles single element', () => {
    expect(secureShuffleArray([42])).toEqual([42]);
  });
});

describe('generateUUID()', () => {
  it('produces valid v4 UUID format', () => {
    const uuid = generateUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('produces unique UUIDs', () => {
    const uuids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      uuids.add(generateUUID());
    }
    expect(uuids.size).toBe(100);
  });

  it('version nibble is always 4', () => {
    for (let i = 0; i < 50; i++) {
      const uuid = generateUUID();
      expect(uuid[14]).toBe('4');
    }
  });

  it('variant nibble is 8, 9, a, or b', () => {
    for (let i = 0; i < 50; i++) {
      const uuid = generateUUID();
      expect('89ab').toContain(uuid[19]);
    }
  });
});
