/**
 * Extraction reliability fixes (2026-11-12) — pipeline level.
 *
 * Regression suite for defects that made GhostFill deliver the WRONG
 * code or reject the RIGHT link:
 *
 * - B2: quoted reply/forward history kept OLD verification codes in the
 *       extraction text, so the stale code was returned instead of the
 *       fresh one (reproduced for every quote layout, not just the
 *       "fresh message first" one).
 * - B5: when a message carried both a plain body and an HTML body, the
 *       extraction text embedded the content twice, doubling occurrence
 *       counts and inflating a 49% candidate to 100%.
 * - B3: dashed phone numbers ("555-867-5309", "1-800-555-0199") were
 *       extracted as high-confidence OTPs and auto-filled.
 *
 * These tests deliberately avoid importing the stripping helper so the
 * suite can be executed against the pre-fix extractor to prove it bites.
 */
import { describe, it, expect } from 'vitest';

import { extractAll } from '../src/services/intelligentExtractor';

const FRESH = '555666';
const STALE = '111222';

describe('extraction — quoted history must never outrank the fresh code (B2)', () => {
  const layouts: Array<[string, string]> = [
    [
      'quote-prefixed history on top',
      [`> Your verification code is ${STALE}`, '', `Your verification code is ${FRESH}.`].join(
        '\n'
      ),
    ],
    [
      'reply marker with quoted history on top',
      [
        'On Mar 3, 2026, Support <support@example.com> wrote:',
        `> Your verification code is ${STALE}`,
        '',
        `Your verification code is ${FRESH}.`,
      ].join('\n'),
    ],
    [
      'reply marker with unquoted history on top',
      [
        'On Mar 3, 2026, Support <support@example.com> wrote:',
        `Your verification code is ${STALE}`,
        '',
        `Your verification code is ${FRESH}.`,
      ].join('\n'),
    ],
    [
      'forward separator with history on top',
      [
        '-----Original Message-----',
        'From: support@example.com',
        `Your verification code is ${STALE}`,
        '',
        `Your verification code is ${FRESH}.`,
      ].join('\n'),
    ],
    [
      'fresh message first, quoted history below',
      [
        `Your verification code is ${FRESH}.`,
        '',
        'On Mar 3, 2026, Support wrote:',
        `> Your verification code is ${STALE}`,
      ].join('\n'),
    ],
    [
      'fresh message first, unquoted history below',
      [
        `Your verification code is ${FRESH}.`,
        '',
        '-----Original Message-----',
        'From: support@example.com',
        `Your verification code is ${STALE}`,
      ].join('\n'),
    ],
    [
      'fresh message first, stale code repeated in the quote',
      [
        `Your verification code is ${FRESH}.`,
        '',
        '-----Original Message-----',
        'From: support@example.com',
        `Your verification code is ${STALE}`,
        `> Your verification code is ${STALE}`,
      ].join('\n'),
    ],
  ];

  for (const [name, body] of layouts) {
    it(`returns the fresh code — ${name}`, () => {
      const result = extractAll('Your verification code', body, '', 'noreply@example.com');
      expect(result.otp?.code).toBe(FRESH);
    });
  }

  it('keeps the fresh code when the quote is carried in the HTML body', () => {
    const html = [
      `<p>Your verification code is ${FRESH}.</p>`,
      '<blockquote>',
      '<p>On Mar 3, 2026, Support wrote:</p>',
      `<p>Your verification code is ${STALE}</p>`,
      '</blockquote>',
    ].join('\n');

    const result = extractAll('Your verification code', '', html, 'noreply@example.com');
    expect(result.otp?.code).toBe(FRESH);
  });

  it('still extracts the code when the whole message is one quoted block (no fresh code)', () => {
    // Nothing to strip down to: the quoted code is the only code present.
    const body = [
      '-----Original Message-----',
      'From: support@example.com',
      `Your verification code is ${STALE}`,
    ].join('\n');

    const result = extractAll('Your verification code', body, '', 'noreply@example.com');
    expect(result.otp?.code).toBe(STALE);
  });
});

describe('extraction — duplicated body/html must not inflate confidence (B5)', () => {
  it('gives the same confidence for body-only and body+identical-html', () => {
    const body = 'Your verification code is 482913.';
    const html = '<p>Your verification code is 482913.</p>';

    const bodyOnly = extractAll('Verification', body, '', 'noreply@example.com');
    const duplicated = extractAll('Verification', body, html, 'noreply@example.com');

    expect(bodyOnly.otp?.code).toBe('482913');
    expect(duplicated.otp?.code).toBe('482913');
    // Pre-fix the duplicated body scored far higher (occurrence counts
    // doubled); the single-source text must keep them level.
    const delta = (duplicated.otp?.confidence ?? 0) - (bodyOnly.otp?.confidence ?? 0);
    expect(delta).toBeLessThan(5);
  });
});

describe('extraction — dashed phone numbers are not OTPs (B3)', () => {
  it('does not extract a code from a dashed US phone number', () => {
    const body = [
      'Questions? Call us at 555-867-5309 Monday to Friday, 9am to 5pm.',
      'We are happy to help you get started.',
    ].join('\n');

    const result = extractAll('Get in touch', body, '', 'hello@example.com');
    expect(result.otp?.code).not.toBe('555867');
    expect(result.otp?.code).not.toBe('8675309');
  });

  it('does not extract a code from a toll-free number in a newsletter', () => {
    const body = [
      'Deal of the week! Save big today only.',
      'Questions? Call 1-800-555-0199 for details.',
      'Unsubscribe anytime from our weekly newsletter.',
    ].join('\n');

    const result = extractAll('Weekly newsletter', body, '', 'news@example.com');
    expect(result.otp?.code).not.toBe('800555');
    expect(result.otp?.code).not.toBe('5550199');
  });

  it('keeps a labeled dashed code (the escape hatch)', () => {
    const result = extractAll(
      'Your verification code',
      'Your verification code is 482-913 for this sign-in.',
      '',
      'noreply@example.com'
    );
    expect(result.otp?.code).toBe('482913');
  });
});
