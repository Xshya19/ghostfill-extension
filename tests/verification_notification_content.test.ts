import { describe, expect, it } from 'vitest';
import { extractAll } from '../src/services/intelligentExtractor';
import { assessEmailDecision } from '../src/services/emailDecisionEngine';
import { OTPCodeExtractor } from '../src/background/pollingManager';

describe('verification evidence in welcome and marketing emails', () => {
  it.each([
    [
      'A helpful teammate, built into Notion',
      'Explore your workspace. San Francisco, CA 94105',
      '<p>Explore your workspace.</p><footer>San Francisco, CA <span>94105</span></footer>',
    ],
    [
      'Welcome to Claude. Let’s get you set up.',
      'Connect your tools and customize your work. &#8203; &#8203; &#8203;',
      '<h1>Consider your busywork handled</h1><p>&#8203; &#8203; &#8203;</p><a href="https://example.com/download?utm_content=inline_link">Download the app</a>',
    ],
    [
      'Your setup checklist',
      'Import memory https://support.example.com/articles/12123587-import-memory. Anthropic PBC, 548 Market St, PMB 90375, San Francisco, CA 94104',
      '<p>Connect your tools, including Microsoft 365.</p><p>San Francisco, CA 94104</p>',
    ],
    [
      'Welcome to your account',
      'Your customer number is 583917. Get started with our app.',
      '<h1>Welcome</h1><p>Customer number: <strong>583917</strong></p>',
    ],
  ])('does not turn incidental numbers into OTPs: %s', (subject, body, html) => {
    const result = extractAll(subject, body, html, 'team@example.com');
    expect(result.otp).toBeNull();
    expect(result.link).toBeNull();
    expect(assessEmailDecision({ extraction: result }).canAutoAct).toBe(false);
  });

  it.each(['94105', '8203', '009165', 'A7B9C2'])(
    'retains a real labeled code even when its value resembles metadata: %s',
    (code) => {
      const subject = 'Your sign-in code';
      const body = `Enter this code to sign in: ${code}. It expires in 10 minutes.`;
      const result = extractAll(
        subject,
        body,
        `<h1>${subject}</h1><p>${body}</p><strong>${code}</strong>`
      );
      expect(result.otp?.code).toBe(code);
      expect(assessEmailDecision({ extraction: result }).action).toBe('fill-otp');
    }
  );

  it('does not resurrect rejected order numbers or URL parameters in the polling fallback', () => {
    expect(
      OTPCodeExtractor.extract(
        { type: 'none' },
        { subject: 'Receipt', body: 'Your order number is 583917.' }
      )
    ).toBeNull();
    expect(
      OTPCodeExtractor.extract(
        { type: 'none' },
        { subject: 'Get started', body: 'https://example.com/welcome?code=583917' }
      )
    ).toBeNull();
  });
});
