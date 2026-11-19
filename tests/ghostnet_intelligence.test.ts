import { describe, expect, it } from 'vitest';

import { assessEmailDecision } from '../src/services/emailDecisionEngine';
import { compileEmailDocument } from '../src/services/extraction/emailDocument';
import { runGhostNet } from '../src/services/extraction/ghostNet';
import { GHOSTNET_WEIGHTS } from '../src/services/extraction/ghostNetWeights';
import { extractAll } from '../src/services/intelligentExtractor';

describe('GhostNet v2 Neural Sequence & Action Intelligence', () => {
  it('loads trained Int8 weights trained on 20,000+ emails', () => {
    expect(GHOSTNET_WEIGHTS.version).toBe(2);
    expect(GHOSTNET_WEIGHTS.trainedSamples).toBeGreaterThanOrEqual(20000);
    expect(GHOSTNET_WEIGHTS.vocab.length).toBeGreaterThan(500);
  });

  it('understands unkeyworded natural English OTP idioms without regex triggers', () => {
    const res = extractAll(
      'Quick check from Acme',
      'Hey! Drop 739204 into the browser tab you just opened so we know this inbox belongs to you.',
      '<p>Hey! Drop <strong>739204</strong> into the browser tab you just opened so we know this inbox belongs to you.</p>',
      'team@acme.com',
      ['acme.com'],
      { hasOtpInputs: true, expectedOtpLength: 6, expectedOtpFormat: 'numeric' }
    );
    expect(res.otp?.code).toBe('739204');
    const decision = assessEmailDecision({
      extraction: res,
      sender: 'team@acme.com',
      expectedDomains: ['acme.com'],
      originUrl: 'https://acme.com/signup',
      pageExpectation: { hasOtpInputs: true, expectedOtpLength: 6, expectedOtpFormat: 'numeric' },
    });
    expect(decision.action).toBe('fill-otp');
  });

  it('understands unkeyworded natural English magic-link doorways', () => {
    const url = 'https://app.linear.app/auth/callback?session=lin_998877665544';
    const res = extractAll(
      'Ready to enter Linear',
      'Ready when you are — one quick tap below jumps you straight into your Linear workspace.',
      `<p>Ready when you are — one quick tap below jumps you straight into your Linear workspace.</p><a href="${url}" class="btn">Jump into workspace</a>`,
      'hello@linear.app',
      ['linear.app'],
      { hasOtpInputs: false, hasMagicLinkPrompt: true }
    );
    expect(res.link?.url).toBe(url);
    const decision = assessEmailDecision({
      extraction: res,
      sender: 'hello@linear.app',
      expectedDomains: ['linear.app'],
      originUrl: 'https://linear.app/login',
      pageExpectation: { hasOtpInputs: false, hasMagicLinkPrompt: true },
    });
    expect(decision.action).toBe('open-link');
  });

  it('resolves temporal superseded discourse (expired old code vs active fresh code)', () => {
    const res = extractAll(
      'Updated sign-in check',
      'Heads up: 410293 expired 5 minutes ago. Use 992817 instead to finish signing in.',
      '<p>Heads up: 410293 expired 5 minutes ago. Use <strong>992817</strong> instead to finish signing in.</p>',
      'auth@acme.com',
      ['acme.com'],
      { hasOtpInputs: true, expectedOtpLength: 6 }
    );
    expect(res.otp?.code).toBe('992817');
  });

  it('rejects negated anti-scam warnings and maps them to null OTP / ignore', () => {
    const body =
      'Security warning: Our staff will never phone you. If someone asked you to read or enter 651029, hang up immediately and do not enter 651029 anywhere.';
    const res = extractAll(
      'How to spot Acme impersonators',
      body,
      `<p>${body}</p>`,
      'security@acme.com',
      ['acme.com']
    );
    expect(res.otp).toBeNull();
    const decision = assessEmailDecision({
      extraction: res,
      sender: 'security@acme.com',
      expectedDomains: ['acme.com'],
      originUrl: 'https://acme.com',
    });
    expect(decision.action).toBe('ignore');
  });

  it('eliminates single-number newsletter trap ("50000 developers") and courier PIN traps', () => {
    const welcome = extractAll(
      'Welcome to Acme!',
      'Join 50000 developers building faster with Acme. Get started today.',
      '<p>Join 50000 developers building faster with Acme.</p><a href="https://acme.com/docs/quickstart">Get started</a>',
      'hello@acme.com',
      ['acme.com']
    );
    expect(welcome.otp).toBeNull();
    expect(welcome.link).toBeNull();
    expect(
      assessEmailDecision({
        extraction: welcome,
        sender: 'hello@acme.com',
        expectedDomains: ['acme.com'],
        originUrl: 'https://acme.com/signup',
      }).action
    ).toBe('ignore');

    const courier = extractAll(
      'Your courier is outside (#882910)',
      'Your dinner order #882910 is arriving soon. Give PIN 4419 to your delivery courier at the front door.',
      '<p>Give PIN 4419 to your delivery courier at the front door.</p>',
      'orders@shop.example',
      ['shop.example']
    );
    expect(courier.otp).toBeNull();
  });

  it('rejects hidden display:none honeypots and quoted reply stale OTPs', () => {
    const hidden = extractAll(
      'Your verification code',
      'Your verification code is 482910.',
      '<div style="display:none;font-size:0px">Verification code: 999999</div><p style="font-size:28px;font-weight:bold">482910</p>',
      'security@acme.com',
      ['acme.com']
    );
    expect(hidden.otp?.code).toBe('482910');

    const quoted = extractAll(
      'Re: Verification code',
      'Your new verification code is 849201.\n\nOn Oct 1, 2026, Auth <auth@acme.com> wrote:\n> Your verification code is 111222.',
      '<p>Your new verification code is <strong>849201</strong>.</p><blockquote><p>Your verification code is 111222.</p></blockquote>',
      'auth@acme.com',
      ['acme.com']
    );
    expect(quoted.otp?.code).toBe('849201');
  });

  it('reconstructs split-digit HTML table cell OTPs', () => {
    const res = extractAll(
      'Verify your login',
      'Enter the 6-digit code shown below.',
      '<p>Enter this security code:</p><table><tr><td>4</td><td>8</td><td>2</td><td>9</td><td>1</td><td>0</td></tr></table>',
      'auth@linear.app',
      ['linear.app']
    );
    expect(res.otp?.code).toBe('482910');
  });

  it('fuses live page expectation to switch Notion-style paired emails between fill-otp and open-link', () => {
    const linkUrl = 'https://www.notion.so/loginwithemail?token=tok_abc123456789';
    const subject = 'Sign in to Notion';
    const body = `Your temporary login digits: 451612. Or click below: ${linkUrl}`;
    const html = `<p>Temporary code: <strong>451612</strong></p><a href="${linkUrl}" class="btn">Sign in to Notion</a>`;

    const extOtpPage = extractAll(subject, body, html, 'notify@mail.notion.so', ['notion.so'], {
      hasOtpInputs: true,
      expectedOtpLength: 6,
      expectedOtpFormat: 'numeric',
    });
    const decOtpPage = assessEmailDecision({
      extraction: extOtpPage,
      sender: 'notify@mail.notion.so',
      expectedDomains: ['notion.so'],
      originUrl: 'https://www.notion.so/login',
      pageExpectation: { hasOtpInputs: true, expectedOtpLength: 6, expectedOtpFormat: 'numeric' },
    });
    expect(decOtpPage.action).toBe('fill-otp');

    const extLinkPage = extractAll(subject, body, html, 'notify@mail.notion.so', ['notion.so'], {
      hasOtpInputs: false,
      hasMagicLinkPrompt: true,
    });
    const decLinkPage = assessEmailDecision({
      extraction: extLinkPage,
      sender: 'notify@mail.notion.so',
      expectedDomains: ['notion.so'],
      originUrl: 'https://www.notion.so/login',
      pageExpectation: { hasOtpInputs: false, hasMagicLinkPrompt: true },
    });
    expect(decLinkPage.action).toBe('open-link');
  });

  it('refuses to auto-open self-consistent phishing links unbound to signup origin', () => {
    const phishUrl = 'https://evil-phish.xyz/verify?token=steal123456789';
    const ext = extractAll(
      'Verify your Acme account immediately',
      `Your account will be suspended. Click here: ${phishUrl}`,
      `<a href="${phishUrl}" class="btn">Verify Your Account</a>`,
      'security@evil-phish.xyz',
      ['acme.com']
    );
    const dec = assessEmailDecision({
      extraction: ext,
      sender: 'security@evil-phish.xyz',
      expectedDomains: ['acme.com'],
      originUrl: 'https://acme.com/signup',
    });
    expect(dec.action).toBe('show-review');
    expect(dec.canAutoAct).toBe(false);
  });

  it('extracts variable-length 4–7 digit and mixed alphanumeric OTPs (794456, 48DFG77, 6844, 5464654, K9X4B)', () => {
    const cases: Array<{
      code: string;
      body: string;
      html: string;
      format: 'numeric' | 'alphanumeric';
    }> = [
      {
        code: '794456',
        body: 'Your verification code is 794456.',
        html: '<p>Your verification code is <strong>794456</strong>.</p>',
        format: 'numeric',
      },
      {
        code: '48DFG77',
        body: 'Use verification code 48DFG77 to complete sign in.',
        html: '<p>Use verification code <code>48DFG77</code> to complete sign in.</p>',
        format: 'alphanumeric',
      },
      {
        code: '6844',
        body: 'Your one-time PIN is 6844.\n© 2026 Acme Inc. · CA 94104',
        html: '<p>Your one-time PIN is <strong>6844</strong>.</p><p class="footer">© 2026 Acme Inc. · CA 94104</p>',
        format: 'numeric',
      },
      {
        code: '5464654',
        body: 'Hey! Punch 5464654 into the open prompt waiting on your page.',
        html: '<p>Hey! Punch <strong>5464654</strong> into the open prompt waiting on your page.</p>',
        format: 'numeric',
      },
      {
        code: 'K9X4B',
        body: 'Enter security passcode K9X4B to authorize this device.',
        html: '<p>Enter security passcode <strong>K9X4B</strong> to authorize this device.</p>',
        format: 'alphanumeric',
      },
      {
        code: '48dfg77',
        body: 'Your security code is: 48dfg77.',
        html: '<p>Your security code is: <strong>48dfg77</strong>.</p>',
        format: 'alphanumeric',
      },
      {
        code: '2024K9X',
        body: 'Your verification code is 2024K9X.',
        html: '<p>Your verification code is <strong>2024K9X</strong>.</p>',
        format: 'alphanumeric',
      },
    ];

    for (const tc of cases) {
      const pageExpectation = {
        hasOtpInputs: true,
        expectedOtpLength: tc.code.length,
        expectedOtpFormat: tc.format,
      };
      const ext = extractAll(
        'Acme security check',
        tc.body,
        tc.html,
        'auth@acme.com',
        ['acme.com'],
        pageExpectation
      );
      expect(ext.otp?.code).toBe(tc.code);
      const dec = assessEmailDecision({
        extraction: ext,
        sender: 'auth@acme.com',
        expectedDomains: ['acme.com'],
        originUrl: 'https://acme.com/verify',
        pageExpectation,
      });
      expect(dec.action).toBe('fill-otp');
    }

    const wicg = extractAll(
      'Sign in check',
      'Finish your sign in.\n\n@acme.com #794456',
      '<p>Finish your sign in.</p><pre>@acme.com #794456</pre>',
      'auth@acme.com',
      ['acme.com'],
      { hasOtpInputs: true, expectedOtpLength: 6, expectedOtpFormat: 'numeric' }
    );
    expect(wicg.otp?.code).toBe('794456');
  });

  it('executes neural AST+Transformer+Pointer inference under 3.5ms average latency', () => {
    const doc = compileEmailDocument(
      'Your Acme login code is 482910',
      'Enter 482910 into the open browser tab or tap https://app.acme.com/verify?token=tok_abcdef123456',
      '<p>Enter <strong>482910</strong></p><a href="https://app.acme.com/verify?token=tok_abcdef123456" class="btn">Verify</a>',
      'auth@acme.com',
      ['acme.com']
    );
    for (let i = 0; i < 10; i++) {
      runGhostNet(doc, { expectedDomains: ['acme.com'] });
    }
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) {
      runGhostNet(doc, { expectedDomains: ['acme.com'] });
    }
    const avgMs = (performance.now() - t0) / 50;
    expect(avgMs).toBeLessThan(3.5);
  });
});
