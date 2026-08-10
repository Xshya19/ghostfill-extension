import { describe, it, expect } from 'vitest';
import {
  extractOTP,
  isCodeEmbeddedInEmail,
  hasIsolatedOtpContext,
} from '../otpExtractor';
import type { IntentResult, EmailIntent } from '../../types/extraction.types';

// Regression for a reported false positive: an account-activation email whose
// body contained "mark.kennedy.5561@mail.com" had the 4-digit address segment
// "5561" extracted as an OTP and boosted to 100% by dual-engine consensus.
const ACTIVATION_ONLY_EMAIL = `
Activate your account

Hi, mark.kennedy.5561@catchmail.io ,

Please activate your account by clicking the button below before you can enjoy the services.

Note: This link is valid for 7.0 days only, accounts not activated in time will be deleted.

Activate My Account ( https://chat.qwen.ai/api/v1/auths/activate?id=e0f5e0b2-1120-49a3-af60-b4fc5279ca8e&token=3dafe480 )

This is an automatically generated email, please do not reply. 2025. Alibaba Cloud (Singapore).
`;

function intentOf(intent: EmailIntent): IntentResult {
  return {
    intent,
    confidence: 1,
    signals: [],
    scores: { [intent]: 1 },
    secondaryIntent: null,
  };
}

describe('isCodeEmbeddedInEmail', () => {
  it('detects a numeric segment of an email local part', () => {
    expect(isCodeEmbeddedInEmail('5561', 'Hi, mark.kennedy.5561@catchmail.io')).toBe(true);
    expect(isCodeEmbeddedInEmail('482913', 'user_482913@x.io please verify')).toBe(true);
  });

  it('does NOT flag a standalone number that is a real OTP', () => {
    expect(isCodeEmbeddedInEmail('5561', 'Your verification code is 5561.')).toBe(false);
  });
});

describe('hasIsolatedOtpContext', () => {
  it('returns true when the code also appears standalone with OTP language', () => {
    const text = 'Hi mark.kennedy.5561@mail.com, your security code is 5561. Enter it now.';
    // The code appears both inside the address AND as a labeled standalone value.
    expect(hasIsolatedOtpContext('5561', text)).toBe(true);
  });

  it('returns false for an address-only occurrence', () => {
    const text = 'Hi, mark.kennedy.5561@catchmail.io, please activate your account.';
    expect(hasIsolatedOtpContext('5561', text)).toBe(false);
  });
});

describe('extractOTP — email-address segment false positive (reported bug)', () => {
  it('does NOT extract an address-segment number from an activation-only email', () => {
    const otp = extractOTP(
      ACTIVATION_ONLY_EMAIL,
      '',
      null,
      [],
      intentOf('activation')
    );
    expect(otp).toBeNull();
  });

  it('still extracts a genuine standalone OTP', () => {
    const body = 'Your verification code is 482913. It expires in 10 minutes.';
    const otp = extractOTP(body, '', null, [], intentOf('verification'));
    expect(otp?.code).toBe('482913');
  });

  it('still extracts the real code when the address also contains a numeric segment', () => {
    const body =
      'Hi mark.kennedy.5561@mail.com, your security code is 482913. Enter it now.';
    const otp = extractOTP(body, '', null, [], intentOf('verification'));
    expect(otp?.code).toBe('482913');
  });
});