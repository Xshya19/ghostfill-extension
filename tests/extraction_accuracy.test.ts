import { describe, expect, it } from 'vitest';

import { extractAll } from '../src/services/intelligentExtractor';
import type { EmailIntent } from '../src/services/types/extraction.types';

type ExtractionFixture = {
  name: string;
  subject: string;
  sender: string;
  body: string;
  htmlBody: string;
  expectedIntent: EmailIntent;
  expectedCode: string | null;
  expectedLink: string | null;
};

const fixtures: ExtractionFixture[] = [
  {
    name: 'extracts a standard verification OTP',
    subject: 'Your Example verification code',
    sender: 'security@example.com',
    body: 'Use verification code 483920 to finish signing in. It expires in 10 minutes.',
    htmlBody: '<p>Use verification code <strong>483920</strong> to finish signing in.</p>',
    expectedIntent: 'verification',
    expectedCode: '483920',
    expectedLink: null,
  },
  {
    name: 'extracts an account activation link without inventing an OTP',
    subject: 'Confirm your account',
    sender: 'accounts@example.com',
    body: 'Confirm your account by opening this link: https://accounts.example.com/email/action?token=confirm_8cfa45677890abcdef1234567890',
    htmlBody:
      '<p>Your account is almost ready.</p><a href="https://accounts.example.com/email/action?token=confirm_8cfa45677890abcdef1234567890">Confirm my account</a>',
    expectedIntent: 'activation',
    expectedCode: null,
    expectedLink:
      'https://accounts.example.com/email/action?token=confirm_8cfa45677890abcdef1234567890',
  },
  {
    name: 'does not treat copyright years as OTPs in activation emails',
    subject: 'qwen.ai active mail.',
    sender: 'noreply@qwen.ai',
    body: 'Please click the following link to active your mail: https://chat.qwen.ai/verify?token=abc123xyz789. Copyright 2026 Qwen.',
    htmlBody:
      '<p>Please click the following link to active your mail:</p><a href="https://chat.qwen.ai/verify?token=abc123xyz789">Verify Email</a><p>Copyright 2026 Qwen.</p>',
    expectedIntent: 'activation',
    expectedCode: null,
    expectedLink: 'https://chat.qwen.ai/verify?token=abc123xyz789',
  },
];

describe('Email extraction accuracy - inline fixtures', () => {
  it.each(fixtures)('$name', (fixture) => {
    const result = extractAll(fixture.subject, fixture.body, fixture.htmlBody, fixture.sender);

    expect(result.intent).toBe(fixture.expectedIntent);

    if (fixture.expectedCode) {
      expect(result.otp?.code).toBe(fixture.expectedCode);
    } else {
      expect(result.otp).toBeNull();
    }

    if (fixture.expectedLink) {
      expect(result.link?.url).toBe(fixture.expectedLink);
    } else {
      expect(result.link).toBeNull();
    }
  });
});
