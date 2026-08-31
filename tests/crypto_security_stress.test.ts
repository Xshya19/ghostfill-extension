import { describe, it, expect } from 'vitest';
import {
  encrypt,
  decrypt,
  getRandomInt,
  getRandomString,
  generateUUID,
  secureShuffleArray,
} from '../src/utils/encryption';
import { sanitizeUrl, sanitizeText } from '../src/utils/sanitization.core';

describe('Crypto & Security Stress Suite', () => {
  describe('AES-GCM 256-bit Encryption & Tamper Resilience', () => {
    it('encrypts and decrypts 50 distinct payloads with zero loss using password derivation', async () => {
      const password = 'test-master-password-123';

      for (let i = 0; i < 50; i++) {
        const payload = `payload_secret_${i}_${getRandomString(32, 'abcdef0123456789')}`;
        const ciphertext = await encrypt(payload, password);

        expect(typeof ciphertext).toBe('string');
        expect(ciphertext.length).toBeGreaterThan(20);

        const decrypted = await decrypt<string>(ciphertext, password);
        expect(decrypted).toBe(payload);
      }
    });

    it('fails safely when ciphertext is corrupted or tampered', async () => {
      const password = 'tamper-test-password';
      const ciphertext = await encrypt('super-secret-password-1234', password);

      // Corrupt the ciphertext by replacing characters in the payload/tag
      const corrupted = ciphertext.slice(0, 10) + 'XXXX' + ciphertext.slice(14);

      await expect(decrypt(corrupted, password)).rejects.toThrow();
    });

    it('fails safely when decrypting with an incorrect password', async () => {
      const ciphertext = await encrypt('classified-user-identity', 'correct-password');
      await expect(decrypt(ciphertext, 'wrong-password')).rejects.toThrow();
    });

    it('generates unique UUIDs with compliant version 4 format', () => {
      const uuids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const id = generateUUID();
        expect(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
        ).toBe(true);
        uuids.add(id);
      }
      expect(uuids.size).toBe(100);
    });

    it('securely shuffles arrays without loss or duplication of elements', () => {
      const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const shuffled = secureShuffleArray(original);

      expect(shuffled.length).toBe(original.length);
      expect(new Set(shuffled).size).toBe(original.length);
      expect(shuffled.sort((a, b) => a - b)).toEqual(original);
    });
  });

  describe('ReDoS / Catastrophic Backtracking Resilience', () => {
    it('handles repetitive adversarial strings in sanitizeText without freezing (O(n))', () => {
      const malicious = 'a'.repeat(20000) + '<script>' + 'b'.repeat(20000);
      const t0 = Date.now();
      const result = sanitizeText(malicious);
      const elapsed = Date.now() - t0;

      expect(elapsed).toBeLessThan(1000); // Must execute in under 1 second
      expect(result).not.toContain('<script>');
    });

    it('handles long nested URL strings in sanitizeUrl without freezing', () => {
      const longUrl = 'https://example.com/' + 'sub/'.repeat(2000) + '?query=' + 'x'.repeat(5000);
      const t0 = Date.now();
      const result = sanitizeUrl(longUrl);
      const elapsed = Date.now() - t0;

      expect(elapsed).toBeLessThan(1000);
      expect(result).toBeDefined();
    });
  });

  describe('Random Number Distribution', () => {
    it('generates uniform random integers within specified range', () => {
      const min = 10;
      const max = 20;
      const counts: Record<number, number> = {};

      for (let i = 0; i < 500; i++) {
        const val = getRandomInt(min, max);
        expect(val).toBeGreaterThanOrEqual(min);
        expect(val).toBeLessThanOrEqual(max);
        counts[val] = (counts[val] || 0) + 1;
      }

      // Ensure all numbers in range were hit at least once across 500 trials
      for (let num = min; num <= max; num++) {
        expect(counts[num]).toBeGreaterThan(0);
      }
    });
  });
});
