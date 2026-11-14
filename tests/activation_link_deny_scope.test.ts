/**
 * Activation-link deny-list scoping (2026-11-12).
 *
 * Regression suite for B4: the hard-reject deny list was matched against
 * the RAW URL string, including query values. Two failures followed:
 *
 * 1. Legitimate verification links were dropped — e.g.
 *    `https://github.com/settings/verify?token=…` matched the deny
 *    pattern `/settings`, and `?redirect=/settings` matched it too.
 * 2. Verdicts flipped on incidental encoding — the same destination
 *    passed as `?redirect=%2Fsettings` but was rejected as
 *    `?redirect=/settings`.
 *
 * The deny list is now evaluated against the hostname and the decoded
 * pathname only, with an escape hatch for paths that carry an explicit
 * action segment AND auth evidence (`/settings/verify?token=…`).
 */
import { describe, it, expect } from 'vitest';

import { scoreActivationLink } from '../src/services/extraction/activationLinkGuard';

describe('activation link deny-list scope', () => {
  it('gives identical verdicts for encoded and decoded query values', () => {
    // The deny list used to be matched against the raw URL, where the
    // trailing "/settings" of an unencoded query value matched the
    // "/settings" deny pattern — the percent-encoded twin did not, so
    // the verdict flipped on encoding alone.
    const decoded = scoreActivationLink(
      'https://app.example.com/confirm?token=abcdef123456&redirect=/settings',
      'Confirm your email',
      'Please confirm your email address.'
    );
    const encoded = scoreActivationLink(
      'https://app.example.com/confirm?token=abcdef123456&redirect=%2Fsettings',
      'Confirm your email',
      'Please confirm your email address.'
    );

    expect(decoded.hardReject).toBe(encoded.hardReject);
    expect(decoded.cls).toBe(encoded.cls);
    expect(decoded.quality).toBe(encoded.quality);
    expect(decoded.reasons).toEqual(encoded.reasons);
    expect(decoded.hardReject).toBe(false);
  });

  it('does not hard-reject a verification route inside a deny-named section', () => {
    const verdict = scoreActivationLink(
      'https://github.com/settings/verify?token=verify_token_abc123456',
      'Verify your email',
      'Please verify your email to activate your account.'
    );
    expect(verdict.hardReject).toBe(false);
    expect(verdict.cls).not.toBe('reject');
  });

  it('still hard-rejects a plain navigation link in a deny-named section', () => {
    const verdict = scoreActivationLink(
      'https://app.example.com/settings?ref=email',
      'Manage settings',
      'Change your notification preferences.'
    );
    expect(verdict.hardReject).toBe(true);
    expect(verdict.reasons).toContain('hard-reject-marketing-or-footer');
  });

  it('still hard-rejects footer, unsubscribe and social destinations', () => {
    for (const url of [
      'https://app.example.com/unsubscribe?u=1',
      'https://app.example.com/privacy-policy',
      'https://cdn.example.com/assets/logo.png',
      'https://www.facebook.com/somepage',
    ]) {
      const verdict = scoreActivationLink(url, 'Click here', 'Visit our website today.');
      expect(verdict.hardReject).toBe(true);
    }
  });

  it('keeps a genuine verification link selectable', () => {
    const verdict = scoreActivationLink(
      'https://accounts.example.com/verify?token=confirm_me_please_9001',
      'Verify email',
      'Click to verify your email address and activate the account.',
      // The automatic open additionally needs a domain binding (2026-11-12):
      // the destination has to be a host the caller vouches for.
      { trustedHosts: ['accounts.example.com'] }
    );
    expect(verdict.hardReject).toBe(false);
    expect(verdict.domainBound).toBe(true);
    expect(verdict.canAutoOpen).toBe(true);
  });

  it('does not auto-open the same link when the destination is not expected', () => {
    const verdict = scoreActivationLink(
      'https://accounts.example.com/verify?token=confirm_me_please_9001',
      'Verify email',
      'Click to verify your email address and activate the account.',
      { trustedHosts: ['other-site.example'] }
    );
    expect(verdict.hardReject).toBe(false);
    expect(verdict.structuralAutoOpen).toBe(true);
    expect(verdict.domainBound).toBe(false);
    expect(verdict.canAutoOpen).toBe(false);
  });
});
