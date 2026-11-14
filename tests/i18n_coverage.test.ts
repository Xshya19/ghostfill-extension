import { describe, expect, it } from 'vitest';

import englishMessages from '../public/_locales/en/messages.json';
import spanishMessages from '../public/_locales/es/messages.json';

/**
 * Locale parity guards for the two translation surfaces of this extension.
 *
 * Surfaces (reality check vs. the audit that spawned this test):
 * - src/frontend/i18n.ts holds NO per-locale dictionary. It only bundles the EN
 *   messages.json as a browser-preview fallback for `t()`; in production Chrome
 *   serves every locale via chrome.i18n from public/_locales/<lang>/messages.json.
 * - Therefore the Spanish surface that must reach parity with English is
 *   public/_locales/es/messages.json, and the i18n.ts contract is that its bundled
 *   EN fallback stays non-empty (otherwise `t()` silently degrades to derived text).
 *
 * NOTE: this suite is intentionally expected to FAIL before the es locale is
 * completed: the audit measured es at 89 keys vs en's 194 (105 keys missing),
 * so 'es locale defines every en key' fails until those translations land.
 */

type ChromeMessageEntry = { message?: string; description?: string };

const en = englishMessages as Record<string, ChromeMessageEntry>;
const es = spanishMessages as Record<string, ChromeMessageEntry>;

const enKeys = Object.keys(en);
const esKeys = Object.keys(es);

// Tokens that must survive translation: chrome.i18n-style $NAME$ placeholders,
// .NET-style {0}/{n}, printf-style %s/%d/%@, and template-literal {{name}}.
const PLACEHOLDER_PATTERN = /\{[^{}\s][^{}]*\}|%[sd@]|\{\{[^{}]+\}\}|\$[A-Za-z0-9_]+\$/g;

describe('i18n locale coverage (en vs es)', () => {
  it('es locale defines every en key', () => {
    const missing = enKeys.filter((key) => !(key in es));
    const preview = missing.slice(0, 15).join(', ');
    const more = missing.length > 15 ? ` … +${missing.length - 15} more` : '';
    expect(
      missing,
      `${missing.length} key(s) missing from public/_locales/es/messages.json: ${preview}${more}`
    ).toEqual([]);
  });

  it('es locale defines no keys absent from en', () => {
    const extra = esKeys.filter((key) => !(key in en));
    expect(
      extra,
      `Key(s) present in es but missing from en (invented or renamed): ${extra.join(', ')}`
    ).toEqual([]);
  });

  it('es messages are non-empty', () => {
    const empty = esKeys.filter((key) => {
      const message = es[key]?.message;
      return typeof message !== 'string' || message.trim().length === 0;
    });
    expect(
      empty,
      `Empty es message(s) — every entry needs a non-empty "message": ${empty.join(', ')}`
    ).toEqual([]);
  });

  it('en messages are non-empty (i18n.ts fallback contract)', () => {
    // t() treats a falsy bundled message as "no fallback" and degrades to a
    // camel-case-derived string, so empty en values would silently change UI copy.
    const empty = enKeys.filter((key) => {
      const message = en[key]?.message;
      return typeof message !== 'string' || message.trim().length === 0;
    });
    expect(empty, `Empty en message(s): ${empty.join(', ')}`).toEqual([]);
  });

  it('every entry exposes a string message', () => {
    for (const [name, table] of [
      ['en', en],
      ['es', es],
    ] as const) {
      const invalid = Object.keys(table).filter((key) => typeof table[key]?.message !== 'string');
      expect(
        invalid,
        `Entries without a string "message" in ${name}: ${invalid.join(', ')}`
      ).toEqual([]);
    }
  });

  it('placeholders used in en appear in es', () => {
    const mismatches: string[] = [];
    for (const key of enKeys) {
      const enTokens = en[key]?.message?.match(PLACEHOLDER_PATTERN) ?? [];
      if (enTokens.length === 0) {
        continue;
      }
      const esTokens = es[key]?.message?.match(PLACEHOLDER_PATTERN) ?? [];
      const lost = enTokens.filter((token) => !esTokens.includes(token));
      if (lost.length > 0) {
        mismatches.push(`${key}: missing ${lost.join(', ')}`);
      }
    }
    expect(mismatches, `Placeholder tokens dropped in es: ${mismatches.join('; ')}`).toEqual([]);
  });
});
