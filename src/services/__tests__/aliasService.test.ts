import { describe, expect, it } from 'vitest';
import {
  getAliasPlusSuffix,
  getDeterministicCombinedAlias,
  getDotVariation,
  normalizeAliasDomain,
  normalizeGmailUsername,
  getRandomizedGmailAlias,
} from '../gmailConnectionService';

describe('aliasService combined Gmail aliases', () => {
  it('always combines a dot variation with a plus suffix', () => {
    const alias = getDeterministicCombinedAlias('johndoe@gmail.com', 'netflix.com');

    expect(alias).toContain('+netflix@gmail.com');
    expect(alias.split('@')[0]).toContain('.');
  });

  it('normalizes existing dots and plus suffixes from the base Gmail username', () => {
    expect(normalizeGmailUsername('john.doe+old')).toBe('johndoe');
    expect(getDotVariation('john.doe', 8)).not.toContain('..');
    expect(getDeterministicCombinedAlias('john.doe+old@gmail.com', 'example.com')).not.toContain(
      '..'
    );
  });

  it('normalizes domains consistently for deterministic labels', () => {
    expect(normalizeAliasDomain('https://www.shop.example.co.uk/path?q=1')).toBe(
      'shop.example.co.uk'
    );
    expect(getAliasPlusSuffix('https://www.shop.example.co.uk/path?q=1')).toBe('example');
  });

  it('creates dotted plus-trick Gmail aliases for site tracking', () => {
    const alias = getDeterministicCombinedAlias('t.aayush515@gmail.com', 'twitter.com');

    expect(alias).toMatch(/^[a-z0-9.]+\+twitter@gmail\.com$/);
    expect(normalizeGmailUsername(alias.split('@')[0] || '')).toBe('taayush515');
  });

  it('returns non-Gmail addresses unchanged', () => {
    expect(getDeterministicCombinedAlias('user@example.com', 'netflix.com')).toBe(
      'user@example.com'
    );
  });

  it('produces unique aliases for 1,000 runs of getRandomizedGmailAlias on the same domain', () => {
    const email = 'taayush515@gmail.com';
    const domain = 'netflix.com';
    const generated = new Set<string>();

    for (let i = 0; i < 1000; i++) {
      generated.add(getRandomizedGmailAlias(email, domain));
    }

    expect(generated.size).toBe(1000);
  });
});
