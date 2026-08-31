/**
 * password_service_deep.test.ts
 * Deep test suite for src/services/passwordService.ts
 */
import { describe, it, expect, vi } from 'vitest';

import { passwordService } from '../src/services/passwordService';
import { CHARACTER_SETS, DEFAULT_PASSWORD_OPTIONS } from '../src/types';

describe('PasswordService deep tests', () => {
  // ═══════════════════════════════════════════════════════════════
  // generate()
  // ═══════════════════════════════════════════════════════════════

  describe('generate()', () => {
    it('generates correct length', () => {
      expect(passwordService.generate({ length: 16 }).password).toHaveLength(16);
      expect(passwordService.generate({ length: 64 }).password).toHaveLength(64);
      expect(passwordService.generate({ length: 128 }).password).toHaveLength(128);
    });

    it('generates unique passwords', () => {
      const passwords = new Set<string>();
      for (let i = 0; i < 100; i++) {
        passwords.add(passwordService.generate().password);
      }
      expect(passwords.size).toBe(100);
    });

    it('respects uppercase flag', () => {
      const result = passwordService.generate({ length: 100, uppercase: true, lowercase: false, numbers: false, symbols: false });
      expect(result.password).toMatch(/^[A-Z]+$/);
    });

    it('respects lowercase flag', () => {
      const result = passwordService.generate({ length: 100, uppercase: false, lowercase: true, numbers: false, symbols: false });
      expect(result.password).toMatch(/^[a-z]+$/);
    });

    it('respects numbers flag', () => {
      const result = passwordService.generate({ length: 100, uppercase: false, lowercase: false, numbers: true, symbols: false });
      expect(result.password).toMatch(/^[0-9]+$/);
    });

    it('respects symbols flag', () => {
      const result = passwordService.generate({ length: 100, uppercase: false, lowercase: false, numbers: false, symbols: true });
      expect(result.password).toMatch(/^[^A-Za-z0-9]+$/);
    });

    it('includes all enabled character types (statistical)', () => {
      let hasUpper = false, hasLower = false, hasNum = false, hasSymbol = false;
      for (let i = 0; i < 20; i++) {
        const pw = passwordService.generate({ length: 32 }).password;
        if (/[A-Z]/.test(pw)) hasUpper = true;
        if (/[a-z]/.test(pw)) hasLower = true;
        if (/[0-9]/.test(pw)) hasNum = true;
        if (/[^A-Za-z0-9]/.test(pw)) hasSymbol = true;
      }
      expect(hasUpper).toBe(true);
      expect(hasLower).toBe(true);
      expect(hasNum).toBe(true);
      expect(hasSymbol).toBe(true);
    });

    it('respects minimum character requirements', () => {
      const result = passwordService.generate({
        length: 20,
        minUppercase: 3,
        minLowercase: 3,
        minNumbers: 3,
        minSymbols: 3,
      });
      const pw = result.password;
      const upCount = (pw.match(/[A-Z]/g) || []).length;
      const loCount = (pw.match(/[a-z]/g) || []).length;
      const numCount = (pw.match(/[0-9]/g) || []).length;
      const symCount = (pw.match(/[^A-Za-z0-9]/g) || []).length;
      expect(upCount).toBeGreaterThanOrEqual(3);
      expect(loCount).toBeGreaterThanOrEqual(3);
      expect(numCount).toBeGreaterThanOrEqual(3);
      expect(symCount).toBeGreaterThanOrEqual(3);
    });

    it('uses custom charset when provided', () => {
      const result = passwordService.generate({ length: 20, customCharset: 'ABCD1234' });
      for (const ch of result.password) {
        expect('ABCD1234').toContain(ch);
      }
    });

    it('excludeAmbiguous removes O, I, l, o, 0, 1', () => {
      const ambiguous = 'OIlo01';
      let found = false;
      for (let i = 0; i < 50; i++) {
        const pw = passwordService.generate({ length: 64, excludeAmbiguous: true }).password;
        for (const ch of ambiguous) {
          if (pw.includes(ch)) found = true;
        }
      }
      expect(found).toBe(false);
    });

    it('falls back to full charset when all flags are disabled', () => {
      const result = passwordService.generate({
        length: 16,
        uppercase: false,
        lowercase: false,
        numbers: false,
        symbols: false,
      });
      expect(result.password).toHaveLength(16);
      // Fallback charset includes everything
    });

    it('returns strength analysis', () => {
      const result = passwordService.generate({ length: 32 });
      expect(result.strength).toBeDefined();
      expect(result.strength.score).toBeGreaterThanOrEqual(0);
      expect(result.strength.level).toBeDefined();
      expect(result.strength.entropy).toBeGreaterThan(0);
      expect(result.strength.crackTime).toBeDefined();
    });

    it('returns generatedAt timestamp', () => {
      const before = Date.now();
      const result = passwordService.generate();
      expect(result.generatedAt).toBeGreaterThanOrEqual(before);
    });

    it('modulo bias prevention — no crashes with edge charsets', () => {
      // Charset length that's a power of 2 (should have no bias)
      const result = passwordService.generate({ length: 32, customCharset: 'AB' }); // 2 chars
      expect(result.password).toHaveLength(32);

      // Charset length that's prime (maximizes bias potential)
      const result2 = passwordService.generate({ length: 32, customCharset: 'ABCDEFGHIJKLM' }); // 13 chars
      expect(result2.password).toHaveLength(32);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // generatePassphrase()
  // ═══════════════════════════════════════════════════════════════

  describe('generatePassphrase()', () => {
    it('generates with default 4 words', () => {
      const passphrase = passwordService.generatePassphrase();
      const parts = passphrase.split('-');
      expect(parts.length).toBe(5); // 4 words + 1 number
    });

    it('respects custom word count', () => {
      const passphrase = passwordService.generatePassphrase(6, '-');
      const parts = passphrase.split('-');
      expect(parts.length).toBe(7); // 6 words + 1 number
    });

    it('uses custom separator', () => {
      const passphrase = passwordService.generatePassphrase(4, '_');
      expect(passphrase).toContain('_');
    });

    it('ends with a 2-digit number', () => {
      const passphrase = passwordService.generatePassphrase();
      const parts = passphrase.split('-');
      const lastPart = parts[parts.length - 1]!;
      expect(lastPart).toMatch(/^\d{2}$/);
    });

    it('generates unique passphrases', () => {
      const passphrases = new Set<string>();
      for (let i = 0; i < 50; i++) {
        passphrases.add(passwordService.generatePassphrase());
      }
      expect(passphrases.size).toBe(50);
    });

    it('has random capitalization', () => {
      let hasCapitalized = false;
      let hasLowercase = false;
      for (let i = 0; i < 50; i++) {
        const passphrase = passwordService.generatePassphrase(1);
        const word = passphrase.split('-')[0]!;
        if (word[0] === word[0].toUpperCase()) hasCapitalized = true;
        if (word[0] === word[0].toLowerCase()) hasLowercase = true;
      }
      expect(hasCapitalized).toBe(true);
      expect(hasLowercase).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // calculateStrength()
  // ═══════════════════════════════════════════════════════════════

  describe('calculateStrength()', () => {
    it('empty password scores 0', () => {
      const s = passwordService.calculateStrength('');
      expect(s.score).toBe(0);
      expect(s.level).toBe('weak');
    });

    it('single character password', () => {
      const s = passwordService.calculateStrength('a');
      expect(s.score).toBeLessThan(20);
      expect(s.level).toBe('weak');
    });

    it('numeric-only password', () => {
      const s = passwordService.calculateStrength('123456');
      expect(s.score).toBeLessThan(40);
    });

    it('all character types boost score', () => {
      const lowScore = passwordService.calculateStrength('aaaaaaa');
      const highScore = passwordService.calculateStrength('aA1!aA1!');
      expect(highScore.score).toBeGreaterThan(lowScore.score);
    });

    it('penalizes repetitive patterns', () => {
      const noRepeat = passwordService.calculateStrength('abcdefgh');
      const withRepeat = passwordService.calculateStrength('aaaaefgh');
      expect(withRepeat.score).toBeLessThan(noRepeat.score);
    });

    it('penalizes sequential characters', () => {
      const seq = passwordService.calculateStrength('abcdefgh');
      const noSeq = passwordService.calculateStrength('hdgfbeat');
      expect(seq.score).toBeLessThanOrEqual(noSeq.score);
    });

    it('penalizes sequential numbers', () => {
      const s = passwordService.calculateStrength('pass123456');
      expect(s.suggestions).toBeDefined();
    });

    it('long diverse password is very strong', () => {
      const s = passwordService.calculateStrength('Xk9!mP2@qR7#wL4$');
      expect(s.level === 'strong' || s.level === 'very-strong').toBe(true);
    });

    it('returns crack time string', () => {
      const s = passwordService.calculateStrength('test');
      expect(typeof s.crackTime).toBe('string');
      expect(s.crackTime.length).toBeGreaterThan(0);
    });

    it('returns entropy value', () => {
      const s = passwordService.calculateStrength('Test1!');
      expect(s.entropy).toBeGreaterThan(0);
    });

    it('returns suggestions array', () => {
      const s = passwordService.calculateStrength('abc');
      expect(Array.isArray(s.suggestions)).toBe(true);
      expect(s.suggestions.length).toBeGreaterThan(0);
    });

    it('score is clamped between 0 and 100', () => {
      for (const pw of ['', 'a', 'aaaa', 'AaBbCc11!!', 'Xk9!mP2@qR7#wL4$bNz']) {
        const s = passwordService.calculateStrength(pw);
        expect(s.score).toBeGreaterThanOrEqual(0);
        expect(s.score).toBeLessThanOrEqual(100);
      }
    });

    it('strength levels are correctly ordered', () => {
      const levelOrder: Record<string, number> = {
        'weak': 0,
        'fair': 1,
        'good': 2,
        'strong': 3,
        'very-strong': 4,
      };

      const weak = passwordService.calculateStrength('aa');
      const strong = passwordService.calculateStrength('MyStr0ng!P@ssw0rd');
      expect(levelOrder[strong.level]!).toBeGreaterThanOrEqual(levelOrder[weak.level]!);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // Fisher-Yates Shuffle (via generate)
  // ═══════════════════════════════════════════════════════════════

  describe('Fisher-Yates shuffle verification', () => {
    it('preserves all required characters', () => {
      for (let i = 0; i < 20; i++) {
        const result = passwordService.generate({
          length: 20,
          minUppercase: 5,
          minLowercase: 5,
          minNumbers: 5,
          minSymbols: 5,
        });
        const pw = result.password;
        expect(pw).toHaveLength(20);
        expect((pw.match(/[A-Z]/g) || []).length).toBeGreaterThanOrEqual(5);
        expect((pw.match(/[a-z]/g) || []).length).toBeGreaterThanOrEqual(5);
        expect((pw.match(/[0-9]/g) || []).length).toBeGreaterThanOrEqual(5);
        expect((pw.match(/[^A-Za-z0-9]/g) || []).length).toBeGreaterThanOrEqual(5);
      }
    });

    it('distributes required chars throughout password (not clustered)', () => {
      let frontHeavyCount = 0;
      for (let i = 0; i < 50; i++) {
        const result = passwordService.generate({
          length: 20,
          minUppercase: 3,
          minLowercase: 3,
          minNumbers: 3,
          minSymbols: 3,
        });
        const front = result.password.slice(0, 5);
        const back = result.password.slice(-5);
        // Count how many uppercase are in the front half
        const frontUpper = (front.match(/[A-Z]/g) || []).length;
        if (frontUpper >= 3) frontHeavyCount++;
      }
      // If shuffle is working, required chars should not always cluster in front
      expect(frontHeavyCount).toBeLessThan(40); // < 80%
    });
  });
});
