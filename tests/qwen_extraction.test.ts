import { describe, it, expect } from 'vitest';
import { extractAll } from '../src/services/intelligentExtractor';

describe('Qwen Email Extraction', () => {
  it('should not extract 2025/2026 as an OTP, and should extract the correct verification link', () => {
    const subject = 'qwen.ai active mail.';
    const sender = 'noreply@qwen.ai';
    const body = `
      Hi there,
      Please click the following link to active your mail:
      https://chat.qwen.ai/verify?token=abc123xyz789

      If the button above does not work, copy and paste this URL into your browser.

      © 2025 Qwen. All rights reserved.
    `;
    const htmlBody = `
      <p>Hi there,</p>
      <p>Please click the following link to active your mail:</p>
      <a href="https://chat.qwen.ai/verify?token=abc123xyz789" style="background: #ff5500; padding: 10px; border-radius: 5px; color: white; display: inline-block;">Verify Email</a>
      <p>If the button above does not work, copy and paste this URL into your browser.</p>
      <p>© 2025 Qwen. All rights reserved.</p>
    `;

    const result = extractAll(subject, body, htmlBody, sender);

    console.log('Result:', {
      intent: result.intent,
      otp: result.otp,
      link: result.link,
      debug: result.debugInfo,
    });

    // We expect NO OTP (2025 should be rejected as a year, not extracted)
    expect(result.otp).toBeNull();

    // We expect the verification link to be extracted
    expect(result.link).not.toBeNull();
    expect(result.link?.url).toBe('https://chat.qwen.ai/verify?token=abc123xyz789');
  });

  it('should reject year 2025 even if it is close to verification words (but not labeled as code)', () => {
    const subject = 'active mail';
    const sender = 'noreply@qwen.ai';
    const body = 'Please click the link to verify your account in 2025.';
    const htmlBody = '<p>Please click the link to verify your account in 2025.</p>';

    const result = extractAll(subject, body, htmlBody, sender);

    console.log('Gravity test result:', {
      otp: result.otp,
      reason: result.otp?.reasoning,
    });

    expect(result.otp).toBeNull();
  });

  it('should reject year 2026 even if it is close to a copyright label that follows a passcode mention', () => {
    const subject = 'Verify your email';
    const sender = 'noreply@qwen.ai';
    const body =
      'Please verify your account by clicking the link: https://chat.qwen.ai/verify. Your security passcode has expired. © 2026 Qwen.';
    const htmlBody =
      '<p>Please verify your account by clicking the link: https://chat.qwen.ai/verify. Your security passcode has expired. © 2026 Qwen.</p>';

    const result = extractAll(subject, body, htmlBody, sender);

    console.log('Passcode-copyright test result:', {
      otp: result.otp,
    });

    expect(result.otp).toBeNull();
  });
});

describe('Activation Link Intelligence', () => {
  it('prefers an expected-domain verification link over an unrelated styled button', () => {
    const verifyUrl =
      'https://app.targetsite.com/verify-email?token=target_1234567890abcdef1234567890';
    const promoUrl = 'https://partner.example.net/dashboard?token=promo_1234567890abcdef';
    const subject = 'Verify your TargetSite account';
    const sender = 'noreply@targetsite.com';
    const body = `Verify your email: ${verifyUrl}\nOpen your dashboard: ${promoUrl}`;
    const htmlBody = `
      <p>Please verify your TargetSite account.</p>
      <a href="${promoUrl}" style="background:#111;padding:14px 18px;border-radius:4px;color:#fff">Open dashboard</a>
      <a href="${verifyUrl}">Verify email</a>
    `;

    const result = extractAll(subject, body, htmlBody, sender, ['targetsite.com']);

    expect(result.link?.url).toBe(verifyUrl);
    expect(result.link?.originBound).toBe(true);
  });

  it('does not treat a generic styled marketing button as an activation CTA', () => {
    const promoUrl = 'https://shop.example.com/sale?token=promo_1234567890abcdef';
    const verifyUrl =
      'https://accounts.example.com/email/verify?token=confirm_8cfa45677890abcdef1234567890';
    const subject = 'Confirm your account';
    const sender = 'accounts@example.com';
    const body = `Confirm your account here: ${verifyUrl}\nShop now: ${promoUrl}`;
    const htmlBody = `
      <p>Confirm your account here: <a href="${verifyUrl}">Verify account</a></p>
      <a href="${promoUrl}" style="background:#111;padding:14px 18px;border-radius:4px;color:#fff">Shop now</a>
    `;

    const result = extractAll(subject, body, htmlBody, sender, ['accounts.example.com']);

    expect(result.link?.url).toBe(verifyUrl);
    expect(result.link?.anchorText).toBe('Verify account');
  });

  it('unwraps a tracked invite CTA and extracts the real activation URL', () => {
    const finalUrl =
      'https://app.example.com/invitations/accept?invite_token=inv_4f7dfc8b0f0a4b9892a6';
    const trackedUrl = `https://click.mail.example.com/redirect?u=${encodeURIComponent(finalUrl)}`;
    const subject = 'You have been invited to Example';
    const sender = 'invites@example.com';
    const body = `Accept your invitation to join the workspace: ${trackedUrl}`;
    const htmlBody = `
      <p>You have been invited to join the Example workspace.</p>
      <a href="${trackedUrl}" role="button" style="background:#111;padding:12px 18px;color:#fff;text-decoration:none">
        Accept invitation
      </a>
    `;

    const result = extractAll(subject, body, htmlBody, sender);

    expect(result.intent).toBe('activation');
    expect(result.otp).toBeNull();
    expect(result.link).not.toBeNull();
    expect(result.link?.url).toBe(finalUrl);
    expect(result.link?.type).toBe('activation');
  });

  it('classifies generic token URLs as activation when the CTA confirms an account', () => {
    const url =
      'https://accounts.example.com/email/action?token=confirm_8cfa45677890abcdef1234567890&email=a%40example.com';
    const subject = 'Confirm your account';
    const sender = 'accounts@example.com';
    const body = `Confirm your account by opening this link: ${url}`;
    const htmlBody = `
      <p>Your account is almost ready.</p>
      <a href="${url}" class="primary-action">Confirm my account</a>
    `;

    const result = extractAll(subject, body, htmlBody, sender);

    expect(result.intent).toBe('activation');
    expect(result.link?.url).toBe(url);
    expect(result.link?.type).toBe('activation');
    expect(result.otp).toBeNull();
  });

  it('recognizes passwordless magic login links as activation links', () => {
    const url = 'https://app.example.com/login?token=magic_1234567890abcdef1234567890';
    const subject = 'Your secure sign-in link';
    const sender = 'login@example.com';
    const body = `Use this magic link to sign in securely: ${url}`;
    const htmlBody = `
      <p>Use this magic link to sign in securely.</p>
      <a href="${url}" aria-label="Sign in securely">Launch app</a>
    `;

    const result = extractAll(subject, body, htmlBody, sender);

    expect(result.intent).toBe('activation');
    expect(result.link?.url).toBe(url);
    expect(result.link?.type).toBe('activation');
    expect(result.otp).toBeNull();
  });
});
