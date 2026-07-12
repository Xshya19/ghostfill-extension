import { describe, expect, it } from 'vitest';

import {
  isAutoOpenableActivationLink,
  isSelectableActivationLink,
  pickBestActivationLink,
  scoreActivationLink,
} from '../src/services/extraction/activationLinkGuard';
import { extractAll } from '../src/services/intelligentExtractor';

/**
 * Brand-agnostic tests. No hardcoded product domains (e.g. qwen) — the system
 * must win by path + anchor + body context + token structure, not by script.
 */
describe('activationLinkGuard — semantic (not brand-scripted)', () => {
  it('scores path+token+action anchor as high-quality activation', () => {
    const v = scoreActivationLink(
      'https://any-service.example/verify?token=struct_token_abcdef123456',
      'Verify Email',
      'please click to active your mail'
    );
    expect(v.hardReject).toBe(false);
    expect(v.cls).toBe('activation');
    expect(v.quality).toBeGreaterThanOrEqual(86);
    expect(v.canAutoOpen).toBe(true);
  });

  it('accepts many activation wording synonyms without brand lists', () => {
    const cases: Array<[string, string]> = [
      ['https://a.test/validate?token=tok_validate_12345678', 'Validate your email'],
      ['https://b.test/claim-account?token=tok_claim_12345678', 'Claim your account'],
      ['https://c.test/enable/account?code=enabl3cod3xyz', 'Enable your account'],
      ['https://d.test/device/confirm?token=devtok12345678', 'Yes, this was me'],
      ['https://e.test/email/action?mode=verifyEmail&oobCode=ABC123456789', 'Continue'],
      ['https://f.test/auth/action?oobCode=XYZ9876543210', 'Click to verify'],
      ['https://g.test/unlock?token=unlocktok12345678', 'Unlock your account'],
    ];
    for (const [url, anchor] of cases) {
      expect(isSelectableActivationLink(url, anchor, ''), `${url} should be selectable`).toBe(true);
    }
  });

  it('hard-rejects marketing and footer links', () => {
    const rejects = [
      ['https://shop.example.com/sale?token=track123456789', 'Shop now'],
      ['https://app.example.com/unsubscribe?u=1', 'Unsubscribe'],
      ['https://app.example.com/dashboard', 'Open dashboard'],
      ['https://app.example.com/pricing', 'Learn more'],
      ['https://facebook.com/ourpage', 'Follow us'],
    ] as const;
    for (const [url, anchor] of rejects) {
      const v = scoreActivationLink(url, anchor, '');
      expect(v.hardReject || v.cls === 'reject' || v.quality < 62).toBe(true);
      expect(isAutoOpenableActivationLink(url, anchor, '')).toBe(false);
    }
  });

  it('rejects bare tracking token without action proof', () => {
    expect(
      isSelectableActivationLink(
        'https://click.track.example.com/c/abc?token=trackingtoken12345678',
        'View details',
        ''
      )
    ).toBe(false);
  });

  it('pickBestActivationLink prefers structural activation over marketing', () => {
    const good = {
      url: 'https://host-a.example/verify?token=goodtoken12345678',
      anchorText: 'Verify email',
      confidence: 80,
    };
    const bad = {
      url: 'https://host-b.example/dashboard?token=badtoken12345678',
      anchorText: 'Open dashboard',
      confidence: 95,
    };
    const best = pickBestActivationLink(bad, good);
    expect(best?.url).toBe(good.url);
  });
});

describe('end-to-end extractAll — smart multi-link discrimination', () => {
  it('picks the activation CTA among competing marketing links', () => {
    const correct = 'https://app.example.com/verify?token=correct_verify_token_99';
    const html = `
      <p>Welcome! Please verify your email.</p>
      <a href="https://cdn.example.com/assets/logo.png">Logo</a>
      <a href="https://app.example.com/pricing">Learn more</a>
      <a href="https://app.example.com/dashboard">Dashboard</a>
      <a href="${correct}">Verify Email</a>
      <a href="https://app.example.com/unsubscribe?u=1">Unsubscribe</a>
      <a href="https://shop.example.com/sale?ref=email">Shop now</a>
    `;
    const result = extractAll(
      'Verify your account',
      'Please verify your email to continue.',
      html,
      'noreply@example.com'
    );
    expect(result.link?.url).toBe(correct);
  });

  it('handles awkward "active your mail" wording via context, not brand script', () => {
    // Same failure mode users hit: odd English CTA, multiple non-action links
    const correct = 'https://mail-host.example/verify?token=context_token_xyz78901';
    const html = `
      <p>Please click the following link to active your mail:</p>
      <a href="https://mail-host.example/pricing">Plans</a>
      <a href="${correct}">Active Email</a>
      <a href="https://mail-host.example/unsubscribe">Unsubscribe</a>
      <p>Copyright 2026 SomeBrand.</p>
    `;
    const result = extractAll(
      'active mail',
      `Please click the following link to active your mail: ${correct}. Copyright 2026.`,
      html,
      'noreply@mail-host.example'
    );
    expect(result.link?.url).toBe(correct);
    expect(result.otp).toBeNull();
  });

  it('handles validate synonym CTA', () => {
    const correct = 'https://secure.example.com/validate?token=val_token_abcdef123456';
    const html = `<p>Please validate your email address.</p><a href="${correct}">Validate your email</a>`;
    const result = extractAll(
      'Validate your email',
      'Please validate your email address.',
      html,
      'hello@example.com'
    );
    expect(result.link?.url).toBe(correct);
  });

  it('handles this-was-me device confirm', () => {
    const correct = 'https://auth.example.com/device/confirm?token=dev_confirm_tok_12345';
    const html = `<p>Was this you signing in?</p><a href="${correct}">Yes, this was me</a>`;
    const result = extractAll(
      'New sign-in attempt',
      'Was this you? Confirm below.',
      html,
      'security@example.com'
    );
    expect(result.link?.url).toBe(correct);
  });

  it('handles Firebase-style email action structure (mode+oobCode), any host', () => {
    const correct =
      'https://project-xyz.example/__/auth/action?mode=verifyEmail&oobCode=AbCdEfGhIjKlMnOp123456';
    const html = `<a href="${correct}">Verify your email</a>`;
    const result = extractAll(
      'Verify your email for MyApp',
      'Follow this link to verify your email.',
      html,
      'noreply@project-xyz.example'
    );
    expect(result.link?.url).toContain('oobCode=AbCdEfGhIjKlMnOp123456');
    expect(result.link?.url).toContain('mode=verifyEmail');
  });

  it('does not invent activation from pure marketing email', () => {
    const html = `
      <p>Big sale this weekend!</p>
      <a href="https://shop.example.com/deals?utm=email">Shop now</a>
      <a href="https://shop.example.com/unsubscribe">Unsubscribe</a>
    `;
    const result = extractAll(
      '50% off everything',
      'Big sale this weekend! Shop now.',
      html,
      'promo@shop.example.com'
    );
    expect(result.link).toBeNull();
  });

  it('still wins when wrong link has higher "popularity" tokens', () => {
    // Tracking links often look "juicier" (long tokens) — system must not fall for that
    const correct = 'https://app.example.com/confirm?token=short_but_real_token_99';
    const tracking =
      'https://click.esp.example.com/ls/click?upn=very_long_tracking_blob_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const html = `
      <p>Confirm your email address to finish signup.</p>
      <a href="${tracking}">View in browser</a>
      <a href="${correct}">Confirm my email</a>
      <a href="https://app.example.com/blog/new-feature">Read more</a>
    `;
    const result = extractAll(
      'Confirm your email',
      'Confirm your email address to finish signup.',
      html,
      'accounts@example.com'
    );
    expect(result.link?.url).toBe(correct);
  });
});
