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
    name: 'does not treat copyright years as OTPs; picks activation via context wording',
    subject: 'active mail',
    sender: 'noreply@mail-host.example',
    body: 'Please click the following link to active your mail: https://mail-host.example/verify?token=context_token_xyz78901. Copyright 2026 Brand.',
    htmlBody:
      '<p>Please click the following link to active your mail:</p><a href="https://mail-host.example/verify?token=context_token_xyz78901">Verify Email</a><p>Copyright 2026 Brand.</p>',
    expectedIntent: 'activation',
    expectedCode: null,
    expectedLink: 'https://mail-host.example/verify?token=context_token_xyz78901',
  },
  {
    name: 'extracts validate synonym activation link',
    subject: 'Please validate your email',
    sender: 'accounts@example.com',
    body: 'Validate your email: https://accounts.example.com/validate?token=val_8cfa45677890abcdef',
    htmlBody:
      '<p>Almost done.</p><a href="https://accounts.example.com/validate?token=val_8cfa45677890abcdef">Validate your email</a>',
    expectedIntent: 'activation',
    expectedCode: null,
    expectedLink: 'https://accounts.example.com/validate?token=val_8cfa45677890abcdef',
  },
  {
    name: 'extracts verify link when marketing links compete',
    subject: 'Confirm your Example account',
    sender: 'hello@example.com',
    body: 'Confirm your account. Also check our sale.',
    htmlBody:
      '<a href="https://example.com/sale">Shop now</a><a href="https://app.example.com/verify?token=only_correct_token_xyz">Confirm my account</a><a href="https://example.com/unsubscribe">Unsubscribe</a>',
    expectedIntent: 'activation',
    expectedCode: null,
    expectedLink: 'https://app.example.com/verify?token=only_correct_token_xyz',
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
