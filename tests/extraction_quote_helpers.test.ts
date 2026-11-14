/**
 * Quote-history stripping helpers (2026-11-12).
 *
 * Unit-level contract for the extraction text sanitizer:
 * - quoted reply/forward history must be removed,
 * - a fresh message continuing after a quote must survive,
 * - the "does the fresh part still carry a code?" signal must not fire on
 *   ordinary prose (it decides whether the stripped text may be trusted).
 */
import { describe, it, expect } from 'vitest';

import { stripQuotedHistory, hasFreshCodeSignal } from '../src/services/utils/extraction.utils';

describe('stripQuotedHistory', () => {
  it('drops quoted lines but keeps the fresh message', () => {
    const text = [
      'Your verification code is 555666.',
      '> Your verification code is 111222',
      '> Please use 111222 to sign in.',
    ].join('\n');
    const stripped = stripQuotedHistory(text);
    expect(stripped).toContain('555666');
    expect(stripped).not.toContain('111222');
  });

  it('drops quoted lines written with the sanitized "&gt;" marker', () => {
    const text = [
      '&gt; Your verification code is 111222',
      '',
      'Your verification code is 555666.',
    ].join('\n');
    const stripped = stripQuotedHistory(text);
    expect(stripped).not.toContain('111222');
    expect(stripped).toContain('555666');
  });

  it('opens a quoted region at a reply marker and keeps a fresh code after it', () => {
    const text = [
      'On Mar 3, 2026, Support <support@example.com> wrote:',
      'Your verification code is 111222',
      '',
      'Your verification code is 555666.',
    ].join('\n');
    const stripped = stripQuotedHistory(text);
    expect(stripped).not.toContain('111222');
    expect(stripped).toContain('555666');
  });

  it('opens a quoted region at forward separators', () => {
    const outlook = [
      '-----Original Message-----',
      'From: support@example.com',
      'Your verification code is 111222',
    ].join('\n');
    expect(stripQuotedHistory(outlook)).not.toContain('111222');

    const gmail = [
      '---------- Forwarded message ----------',
      'Your verification code is 111222',
    ].join('\n');
    expect(stripQuotedHistory(gmail)).not.toContain('111222');
  });

  it('leaves ordinary messages untouched', () => {
    const text = 'Welcome! Your verification code is 555666. Thanks for signing up.';
    expect(stripQuotedHistory(text)).toBe(text);
  });
});

describe('hasFreshCodeSignal', () => {
  it('detects a code statement', () => {
    expect(hasFreshCodeSignal('Your verification code is 555666.')).toBe(true);
    expect(hasFreshCodeSignal('Verification code: 482913')).toBe(true);
    expect(hasFreshCodeSignal('otp 123456')).toBe(true);
  });

  it('does not fire on prose that merely mentions a code', () => {
    expect(hasFreshCodeSignal('The code is below in the next section')).toBe(false);
    expect(hasFreshCodeSignal('Click the button to get started')).toBe(false);
    expect(hasFreshCodeSignal('')).toBe(false);
  });
});
