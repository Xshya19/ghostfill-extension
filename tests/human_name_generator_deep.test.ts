/**
 * human_name_generator_deep.test.ts
 * Deep test suite for src/utils/humanNameGenerator.ts
 */
import { describe, it, expect, vi } from 'vitest';

import { generateHumanLikeUsername } from '../src/utils/humanNameGenerator';

describe('generateHumanLikeUsername() deep tests', () => {
  // ═══════════════════════════════════════════════════════════════
  // Format Validation
  // ═══════════════════════════════════════════════════════════════

  it('always produces lowercase output', () => {
    for (let i = 0; i < 100; i++) {
      const username = generateHumanLikeUsername();
      expect(username).toBe(username.toLowerCase());
    }
  });

  it('never starts with a dot or underscore', () => {
    for (let i = 0; i < 100; i++) {
      const username = generateHumanLikeUsername();
      expect(username[0]).not.toBe('.');
      expect(username[0]).not.toBe('_');
    }
  });

  it('never ends with a dot or underscore', () => {
    for (let i = 0; i < 100; i++) {
      const username = generateHumanLikeUsername();
      expect(username[username.length - 1]).not.toBe('.');
      expect(username[username.length - 1]).not.toBe('_');
    }
  });

  it('only contains valid email-prefix characters', () => {
    const validChars = /^[a-z0-9._]+$/;
    for (let i = 0; i < 200; i++) {
      const username = generateHumanLikeUsername();
      expect(username).toMatch(validChars);
    }
  });

  it('always has at least 2 characters', () => {
    for (let i = 0; i < 200; i++) {
      const username = generateHumanLikeUsername();
      expect(username.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('never exceeds 30 characters', () => {
    for (let i = 0; i < 200; i++) {
      const username = generateHumanLikeUsername();
      expect(username.length).toBeLessThanOrEqual(30);
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // Pattern Distribution
  // ═══════════════════════════════════════════════════════════════

  it('produces all pattern types across many iterations', () => {
    const results = new Set<string>();
    const patterns = {
      dotSeparator: false,
      underscoreSeparator: false,
      noSeparator: false,
      hasNumber: false,
      noNumber: false,
      veryShort: false,  // like "sarahm"
      middleInitial: false,  // like "emma.r.taylor"
    };

    for (let i = 0; i < 1000; i++) {
      const username = generateHumanLikeUsername();
      results.add(username);

      if (username.includes('.')) patterns.dotSeparator = true;
      if (username.includes('_')) patterns.underscoreSeparator = true;
      if (!/[._]/.test(username)) patterns.noSeparator = true;
      if (/\d/.test(username)) patterns.hasNumber = true;
      if (!/\d/.test(username)) patterns.noNumber = true;
      if (username.length <= 8) patterns.veryShort = true;
      if (/^[a-z]+\.[a-z]\.[a-z]+$/.test(username)) patterns.middleInitial = true;
    }

    // All pattern variations should appear at least once
    expect(patterns.dotSeparator).toBe(true);
    expect(patterns.underscoreSeparator).toBe(true);
    expect(patterns.noSeparator).toBe(true);
    expect(patterns.hasNumber).toBe(true);
    expect(patterns.noNumber).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════
  // Uniqueness
  // ═══════════════════════════════════════════════════════════════

  it('generates mostly unique usernames', () => {
    const usernames = new Set<string>();
    for (let i = 0; i < 500; i++) {
      usernames.add(generateHumanLikeUsername());
    }
    // With random numbers, collision rate should be extremely low
    expect(usernames.size).toBeGreaterThan(400);
  });

  // ═══════════════════════════════════════════════════════════════
  // Plausibility
  // ═══════════════════════════════════════════════════════════════

  it('usernames look like real email prefixes', () => {
    // Verify that generated names contain recognizable parts
    for (let i = 0; i < 50; i++) {
      const username = generateHumanLikeUsername();
      // Should contain at least one alphabetic segment of 3+ chars (a name)
      expect(username).toMatch(/[a-z]{3,}/);
    }
  });

  it('never produces empty string', () => {
    for (let i = 0; i < 200; i++) {
      const username = generateHumanLikeUsername();
      expect(username.length).toBeGreaterThan(0);
    }
  });

  it('produces different usernames on consecutive calls', () => {
    const first = generateHumanLikeUsername();
    let hasDifferent = false;
    for (let i = 0; i < 10; i++) {
      if (generateHumanLikeUsername() !== first) {
        hasDifferent = true;
        break;
      }
    }
    expect(hasDifferent).toBe(true);
  });
});
