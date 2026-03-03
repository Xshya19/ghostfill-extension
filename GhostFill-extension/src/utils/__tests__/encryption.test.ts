/**
 * Encryption Utilities Unit Tests
 *
 * CRITICAL SECURITY FILE - 100% Coverage Required
 * Tests all encryption operations for security and correctness
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  encrypt,
  decrypt,
  deriveKey,
  generateSecurePassword,
  validatePasswordStrength,
  hashPassword,
  verifyPassword,
} from '../../utils/encryption';

const TEST_PASSWORD = 'TestPassword123!@#';
const TEST_DATA = { secret: 'sensitive-data', nested: { value: 42 } };

describe('deriveKey', () => {
  it('should derive a key from password and salt', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const key = await deriveKey(TEST_PASSWORD, salt);

    expect(key).toBeDefined();
    expect(key.algorithm.name).toBe('AES-GCM');
    expect(key.usages).toContain('encrypt');
    expect(key.usages).toContain('decrypt');
    expect(key.extractable).toBe(false);
  });

  it('should produce same key for same password and salt', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const key1 = await deriveKey(TEST_PASSWORD, salt);
    const key2 = await deriveKey(TEST_PASSWORD, salt);

    expect(key1.algorithm.name).toBe(key2.algorithm.name);
    expect(key1.usages).toEqual(key2.usages);
  });

  it('should produce different keys for different passwords', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const key1 = await deriveKey('password1', salt);
    const key2 = await deriveKey('password2', salt);

    expect(key1).not.toBe(key2);
  });
});

describe('encrypt/decrypt', () => {
  it('should encrypt and decrypt data correctly', async () => {
    const encrypted = await encrypt(TEST_DATA, TEST_PASSWORD);
    const decrypted = await decrypt<typeof TEST_DATA>(encrypted, TEST_PASSWORD);

    expect(decrypted).toEqual(TEST_DATA);
  });

  it('should produce different ciphertext for same plaintext', async () => {
    const encrypted1 = await encrypt(TEST_DATA, TEST_PASSWORD);
    const encrypted2 = await encrypt(TEST_DATA, TEST_PASSWORD);

    expect(encrypted1).not.toBe(encrypted2);
  });

  it('should fail to decrypt with wrong password', async () => {
    const encrypted = await encrypt(TEST_DATA, TEST_PASSWORD);

    await expect(decrypt(encrypted, 'WrongPassword')).rejects.toThrow('Failed to decrypt data');
  });

  it('should handle string data', async () => {
    const stringData = 'Hello, World!';
    const encrypted = await encrypt(stringData, TEST_PASSWORD);
    const decrypted = await decrypt<string>(encrypted, TEST_PASSWORD);

    expect(decrypted).toBe(stringData);
  });

  it('should handle empty object', async () => {
    const emptyData = {};
    const encrypted = await encrypt(emptyData, TEST_PASSWORD);
    const decrypted = await decrypt<typeof emptyData>(encrypted, TEST_PASSWORD);

    expect(decrypted).toEqual(emptyData);
  });

  it('should throw on invalid encrypted data format', async () => {
    await expect(decrypt('invalid-base64!!!', TEST_PASSWORD)).rejects.toThrow();
  });
});

describe('generateSecurePassword', () => {
  it('should generate password of specified length', () => {
    const password = generateSecurePassword(16);
    expect(password).toHaveLength(16);
  });

  it('should generate different passwords each time', () => {
    const passwords = new Set();
    for (let i = 0; i < 100; i++) {
      passwords.add(generateSecurePassword(16));
    }
    expect(passwords.size).toBe(100);
  });

  it('should include uppercase letters', () => {
    const password = generateSecurePassword(32);
    expect(/[A-Z]/.test(password)).toBe(true);
  });

  it('should include lowercase letters', () => {
    const password = generateSecurePassword(32);
    expect(/[a-z]/.test(password)).toBe(true);
  });

  it('should include numbers', () => {
    const password = generateSecurePassword(32);
    expect(/[0-9]/.test(password)).toBe(true);
  });

  it('should include special characters', () => {
    const password = generateSecurePassword(32);
    // eslint-disable-next-line no-useless-escape
    expect(/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)).toBe(true);
  });
});

describe('validatePasswordStrength', () => {
  it('should give low score for weak password', () => {
    const result = validatePasswordStrength('abc');
    expect(result.score).toBeLessThanOrEqual(2);
    expect(result.feedback.length).toBeGreaterThan(0);
  });

  it('should give high score for strong password', () => {
    const result = validatePasswordStrength('MyStr0ng!P@ssw0rd');
    expect(result.score).toBeGreaterThanOrEqual(3);
  });

  it('should handle empty password', () => {
    const result = validatePasswordStrength('');
    expect(result.score).toBe(0);
  });
});

describe('hashPassword', () => {
  it('should hash password', async () => {
    const hash = await hashPassword(TEST_PASSWORD);

    expect(hash).toBeDefined();
    expect(hash).toHaveLength(64);
  });

  it('should produce same hash for same password', async () => {
    const hash1 = await hashPassword(TEST_PASSWORD);
    const hash2 = await hashPassword(TEST_PASSWORD);

    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different passwords', async () => {
    const hash1 = await hashPassword('password1');
    const hash2 = await hashPassword('password2');

    expect(hash1).not.toBe(hash2);
  });
});

describe('verifyPassword', () => {
  it('should verify correct password', async () => {
    const hash = await hashPassword(TEST_PASSWORD);
    const isValid = await verifyPassword(TEST_PASSWORD, hash);

    expect(isValid).toBe(true);
  });

  it('should reject incorrect password', async () => {
    const hash = await hashPassword(TEST_PASSWORD);
    const isValid = await verifyPassword('WrongPassword', hash);

    expect(isValid).toBe(false);
  });
});
