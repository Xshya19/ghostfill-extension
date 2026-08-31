import { describe, it, expect, beforeEach } from 'vitest';
import { safeParseDate, deepClone, deepMerge } from '../src/utils/core';
import { passwordService } from '../src/services/passwordService';
import { sanitizeUrl, sanitizeActivationLink, sanitizeText } from '../src/utils/sanitization.core';
import { storageService } from '../src/services/storageService';

describe('Hardening & Edge Cases Test Suite', () => {
  describe('safeParseDate', () => {
    it('returns exact numeric timestamp when valid finite number is passed', () => {
      const now = 1718000000000;
      expect(safeParseDate(now)).toBe(now);
      expect(safeParseDate(0)).toBe(0);
    });

    it('returns fallback for NaN, Infinity, and -Infinity numbers', () => {
      const fallback = 123456789;
      expect(safeParseDate(Number.NaN, fallback)).toBe(fallback);
      expect(safeParseDate(Number.POSITIVE_INFINITY, fallback)).toBe(fallback);
      expect(safeParseDate(Number.NEGATIVE_INFINITY, fallback)).toBe(fallback);
    });

    it('parses valid ISO and standard date strings', () => {
      const isoStr = '2026-05-15T12:00:00.000Z';
      const expected = new Date(isoStr).getTime();
      expect(safeParseDate(isoStr)).toBe(expected);
    });

    it('handles Date objects safely', () => {
      const dateObj = new Date('2026-01-01T00:00:00Z');
      expect(safeParseDate(dateObj)).toBe(dateObj.getTime());
    });

    it('returns fallback for null, undefined, and non-parseable inputs', () => {
      const fallback = 999999;
      expect(safeParseDate(null, fallback)).toBe(fallback);
      expect(safeParseDate(undefined, fallback)).toBe(fallback);
      expect(safeParseDate('', fallback)).toBe(fallback);
      expect(safeParseDate('not-a-real-date', fallback)).toBe(fallback);
      expect(safeParseDate({}, fallback)).toBe(fallback);
      expect(safeParseDate([], fallback)).toBe(fallback);
      expect(safeParseDate(true, fallback)).toBe(fallback);
    });

    it('defaults to current timestamp if fallback is not provided', () => {
      const before = Date.now();
      const result = safeParseDate('invalid');
      const after = Date.now();
      expect(result).toBeGreaterThanOrEqual(before);
      expect(result).toBeLessThanOrEqual(after);
    });
  });

  describe('PasswordService Edge Cases', () => {
    it('generates a strong password with default options', () => {
      const result = passwordService.generate();
      expect(result.password).toBeDefined();
      expect(result.password.length).toBeGreaterThanOrEqual(16);
      expect(result.strength.score).toBeGreaterThan(0);
    });

    it('excludes ambiguous characters when requested', () => {
      for (let i = 0; i < 20; i++) {
        const result = passwordService.generate({
          length: 32,
          uppercase: true,
          lowercase: true,
          numbers: true,
          symbols: false,
          excludeAmbiguous: true,
        });
        expect(result.password).not.toMatch(/[OI01ol]/);
      }
    });

    it('handles custom charset overrides cleanly', () => {
      const custom = 'ABC';
      const result = passwordService.generate({
        length: 10,
        customCharset: custom,
      });
      expect(result.password.length).toBe(10);
      expect(/^[ABC]+$/.test(result.password)).toBe(true);
    });

    it('generates memorable passphrases with custom separators and word counts', () => {
      const phrase = passwordService.generatePassphrase(5, '_');
      const parts = phrase.split('_');
      // 5 words + 1 random trailing 2-digit number = 6 parts
      expect(parts.length).toBe(6);
      expect(/^\d+$/.test(parts[parts.length - 1]!)).toBe(true);
    });

    it('correctly scores repetitive passwords as weak', () => {
      const repetitive = 'aaaaaaaaaaaaaaaa';
      const strength = passwordService.calculateStrength(repetitive);
      expect(strength.level).toBe('weak');
      expect(strength.score).toBeLessThan(40);
    });

    it('correctly scores diverse high-entropy passwords', () => {
      const strong = 'kX9#mQ2$vL8!wZ5@jP4*';
      const strength = passwordService.calculateStrength(strong);
      expect(strength.score).toBeGreaterThanOrEqual(70);
      expect(['strong', 'very-strong']).toContain(strength.level);
    });
  });

  describe('Sanitization & Security Edge Cases', () => {
    it('blocks dangerous URL protocols and allows http/https', () => {
      expect(sanitizeUrl('javascript:alert(1)')).toBe('');
      expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
      expect(sanitizeUrl('vbscript:msgbox(1)')).toBe('');
      expect(sanitizeUrl('https://example.com/verify?token=abc')).toBe('https://example.com/verify?token=abc');
      expect(sanitizeUrl('http://localhost:3000/confirm')).toBe('http://localhost:3000/confirm');
      expect(sanitizeUrl('mailto:support@example.com')).toBe('mailto:support@example.com');
    });

    it('sanitizes activation links with security checks', () => {
      expect(sanitizeActivationLink('https://example.com/auth/verify?code=123')).toBe(
        'https://example.com/auth/verify?code=123'
      );
      expect(sanitizeActivationLink('javascript:void(0)')).toBe('');
      expect(sanitizeActivationLink('   ')).toBe('');
    });

    it('strips script and html tags in sanitizeText', () => {
      const dirty = '<script>alert("xss")</script><b>Hello</b> World!';
      const clean = sanitizeText(dirty);
      expect(clean).not.toContain('<script>');
      expect(clean).not.toContain('<b>');
      expect(clean).toContain('Hello');
      expect(clean).toContain('World!');
    });
  });

  describe('Storage Service Session Secrets Management', () => {
    beforeEach(() => {
      storageService.clearSessionSecret('llmApiKey');
      storageService.clearSessionSecret('customDomainKey');
    });

    it('stores and retrieves session secrets in memory without error', async () => {
      await storageService.setSessionSecret('llmApiKey', 'test_key_1234567890');
      expect(storageService.getSessionSecret('llmApiKey')).toBe('test_key_1234567890');

      await storageService.clearSessionSecret('llmApiKey');
      expect(storageService.getSessionSecret('llmApiKey')).toBeUndefined();
    });

    it('handles non-existent session secrets gracefully', () => {
      expect(storageService.getSessionSecret('customDomainKey')).toBeUndefined();
    });
  });

  describe('Deep Merge & Prototype Pollution Protection', () => {
    it('safely merges objects without mutating polluted prototype keys', () => {
      const base = { a: 1, nested: { b: 2 } };
      const malicious = JSON.parse('{"__proto__": {"polluted": true}, "nested": {"c": 3}}');
      const merged = deepMerge(base, malicious);

      expect(merged.nested.b).toBe(2);
      expect((merged.nested as any).c).toBe(3);
      expect(({} as any).polluted).toBeUndefined();
    });

    it('deep clones complex structures cleanly', () => {
      const original = { arr: [1, 2, { deep: true }], str: 'hello', num: 42 };
      const cloned = deepClone(original);

      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
      expect(cloned.arr).not.toBe(original.arr);
      expect(cloned.arr[2]).not.toBe(original.arr[2]);
    });
  });
});
