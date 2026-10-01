import { expect, it } from 'vitest';
import { OTPCodeExtractor } from '../src/background/pollingManager';

it('does not recover a discarded OTP from a link-only email URL', () => {
  const link = 'https://app.notion.com/loginwithemail?state=abc-170585-xyz';
  const detection = { type: 'link', link };
  const email = {
    subject: 'Sign in to Notion',
    body: `Use the sign-in link to continue: ${link}`,
  };

  expect(OTPCodeExtractor.extract(detection, email)).toBeNull();
});

it('can still recover a separately labeled code next to a link', () => {
  const link = 'https://example.com/activate?token=abc123';
  const detection = { type: 'link', link };
  const email = {
    subject: 'Verify your account',
    body: `Your verification code is 582914. Or open ${link}`,
  };

  expect(OTPCodeExtractor.extract(detection, email)).toBe('582914');
});
