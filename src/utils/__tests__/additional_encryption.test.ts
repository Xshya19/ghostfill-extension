import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateSecurePassword,
  hashPassword,
  verifyPassword,
  deriveKey,
  encrypt,
  decrypt
} from '../../utils/encryption';

describe('Encryption Utilities (Additional Tests)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateSecurePassword (bias-check)', () => {
    it('should generate a password of the correct length', () => {
      const pwd = generateSecurePassword(12);
      expect(pwd.length).toBe(12);
    });

    it('should never repeat the same 32-char password twice across 50 runs', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 50; i++) {
        seen.add(generateSecurePassword(32));
      }
      expect(seen.size).toBe(50); // All unique — randomness is working
    });
  });

  describe('hashPassword / verifyPassword (PBKDF2)', () => {
    it('should produce a 64-char hex digest', async () => {
      const hash = await hashPassword('pass123');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should verify the correct password', async () => {
      const password = 'correct-horse-battery-staple';
      const hash = await hashPassword(password);
      expect(await verifyPassword(password, hash)).toBe(true);
    });

    it('should reject an incorrect password', async () => {
      const hash = await hashPassword('correct');
      expect(await verifyPassword('wrong', hash)).toBe(false);
    });

    it('should be deterministic — same password → same hash', async () => {
      expect(await hashPassword('foo')).toBe(await hashPassword('foo'));
    });
  });

  describe('encrypt / decrypt with CryptoKey (no Chrome APIs needed)', () => {
    it('should round-trip an object correctly', async () => {
      const salt = crypto.getRandomValues(new Uint8Array(32));
      const key = await deriveKey('unit-test-key', salt);
      const data = { message: 'hello', value: 42 };
      const ciphertext = await encrypt(data, key);
      const result = await decrypt<typeof data>(ciphertext, key);
      expect(result.message).toBe(data.message);
      expect(result.value).toBe(data.value);
    });

    it('should fail to decrypt with the wrong key', async () => {
      const salt = crypto.getRandomValues(new Uint8Array(32));
      const key1 = await deriveKey('key-one', salt);
      const key2 = await deriveKey('key-two', salt);
      const ciphertext = await encrypt({ secret: 'data' }, key1);
      await expect(decrypt(ciphertext, key2)).rejects.toThrow();
    });

    it('should produce different ciphertext each call due to random IV', async () => {
      const salt = crypto.getRandomValues(new Uint8Array(32));
      const key = await deriveKey('iv-test', salt);
      const c1 = await encrypt({ v: 1 }, key);
      const c2 = await encrypt({ v: 1 }, key);
      expect(c1).not.toBe(c2);
    });
  });
});
