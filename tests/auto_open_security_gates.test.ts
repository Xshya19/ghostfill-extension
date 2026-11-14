/**
 * auto_open_security_gates.test.ts
 *
 * Regression coverage for the confirmed CRITICAL phishing defect:
 * a self-consistent phishing email (sender domain == link domain) was
 * auto-opened by the extension with zero warnings.
 *
 * The chain that allowed it:
 *  1. intelligentExtractor.calculateSecurityScore() returned a perfect
 *     score for every message ("bypass all security checks").
 *  2. cognitiveLinkExtractor floored the domain trust of unknown domains at
 *     40, so the decision engine's trust penalties could never fire.
 *  3. activationLinkGuard.canAutoOpen was purely structural (path keyword +
 *     token + https) and never bound the destination to the sender/site.
 *  4. emailServices/privacy.canAutoOpenVerificationLink() fell back to
 *     senderMatchesSite(sender, linkUrl) for accounts without a captured
 *     signup origin, which a self-consistent phishing mail passes.
 *
 * Every test below fails on the pre-fix code and passes after the fix.
 */
import { describe, expect, it } from 'vitest';

import { assessEmailDecision } from '../src/services/emailDecisionEngine';
import {
  isAutoOpenableActivationLink,
  isAutoOpenableActivationLinkForHosts,
  scoreActivationLink,
} from '../src/services/extraction/activationLinkGuard';
import { extractLinkCognitive } from '../src/services/extraction/cognitiveLinkExtractor';
import { canAutoOpenVerificationLink } from '../src/services/emailServices/privacy';
import { extractAll } from '../src/services/intelligentExtractor';
import type { EmailAccount, EmailService } from '../src/types';

function account(service: EmailService, fields: Partial<EmailAccount> = {}): EmailAccount {
  return {
    id: 'test-inbox',
    domain: 'example.test',
    fullEmail: 'test@example.test',
    createdAt: 1,
    expiresAt: 2,
    service,
    ...fields,
  };
}

const PHISHING_SENDER = 'security@evil-phish.example';
const PHISHING_URL = 'https://evil-phish.example/verify?token=abc123456';

function phishingEmail() {
  const body = `Please verify your account immediately\n${PHISHING_URL}`;
  const html = `<p>Please verify your account immediately</p><p><a href="${PHISHING_URL}">Verify email</a></p>`;
  return { body, html };
}

const LEGIT_SENDER = 'no-reply@acme.com';
const LEGIT_URL = 'https://acme.com/verify?token=abc123456';

function legitEmail() {
  const body = `Please verify your account\n${LEGIT_URL}`;
  const html = `<p>Please verify your account</p><p><a href="${LEGIT_URL}">Verify email</a></p>`;
  return { body, html };
}

describe('auto-open security gates — self-consistent phishing email', () => {
  it('does not auto-open a phishing mail that is consistent with itself', () => {
    const { body, html } = phishingEmail();
    const extraction = extractAll('Verify your account', body, html, PHISHING_SENDER, []);
    const decision = assessEmailDecision({
      extraction,
      sender: PHISHING_SENDER,
    });

    expect(decision.action).not.toBe('open-link');
    expect(decision.action).not.toBe('fill-otp-and-open-link');
    expect(decision.canAutoAct).toBe(false);
    expect(decision.warnings.length).toBeGreaterThan(0);
    expect(decision.warnings).toContain('auto-open-requires-site-context');
  });

  it('does not auto-open the phishing mail even when another site is expected', () => {
    const { body, html } = phishingEmail();
    const extraction = extractAll('Verify your account', body, html, PHISHING_SENDER, [
      'signup.acme.com',
    ]);
    const decision = assessEmailDecision({
      extraction,
      sender: PHISHING_SENDER,
      expectedDomains: ['signup.acme.com'],
    });

    expect(decision.action).not.toBe('open-link');
    expect(decision.canAutoAct).toBe(false);
    expect(decision.warnings).toContain('link-not-bound-to-site-context');
  });

  it('never opens the phishing destination for an account without a signup origin', () => {
    // Pre-fix this returned true: the fallback compared the sender with the
    // link only, and both were written by the attacker.
    expect(canAutoOpenVerificationLink(account('mailtm'), PHISHING_SENDER, PHISHING_URL)).toBe(
      false
    );
    expect(
      canAutoOpenVerificationLink(
        account('mailtm', { originUrl: 'https://signup.acme.com' }),
        PHISHING_SENDER,
        PHISHING_URL
      )
    ).toBe(false);
    expect(
      canAutoOpenVerificationLink(
        account('mailtm', { originUrl: 'https://evil-phish.example' }),
        PHISHING_SENDER,
        PHISHING_URL
      )
    ).toBe(true);
  });
});

describe('auto-open security gates — legitimate verification mail still works', () => {
  it('auto-opens a verification link that belongs to the site the user signs up for', () => {
    const { body, html } = legitEmail();
    const extraction = extractAll('Verify your account', body, html, LEGIT_SENDER, [
      'signup.acme.com',
    ]);
    const decision = assessEmailDecision({
      extraction,
      sender: LEGIT_SENDER,
      expectedDomains: ['signup.acme.com'],
    });

    expect(decision.action).toBe('open-link');
    expect(decision.risk).toBe('low');
    expect(decision.canAutoAct).toBe(true);
    expect(decision.warnings).not.toContain('link-requires-review');
  });

  it('binds the account signup origin to the destination', () => {
    const { body, html } = legitEmail();
    const extraction = extractAll('Verify your account', body, html, LEGIT_SENDER, []);
    const decision = assessEmailDecision({
      extraction,
      sender: LEGIT_SENDER,
      originUrl: 'https://signup.acme.com',
    });

    expect(decision.action).toBe('open-link');
    expect(decision.canAutoAct).toBe(true);
    expect(
      canAutoOpenVerificationLink(
        account('mailtm', { originUrl: 'https://signup.acme.com' }),
        LEGIT_SENDER,
        LEGIT_URL
      )
    ).toBe(true);
  });

  it('auto-opens the canonical github verification mail while the user waits on github', () => {
    // Canonical over-blocking regression from the defect report:
    // no-reply@github.com + https://github.com/sessions/verify?token=…
    // The site context (the waiting signup tab) is what makes the
    // sender-domain == link-domain match meaningful — production callers
    // (messageHandler/otpService) always pass it from the waiting tabs.
    const sender = 'no-reply@github.com';
    const url = 'https://github.com/sessions/verify?token=abc123456';
    const body = `Please verify your account\n${url}`;
    const html = `<p>Please verify your account</p><p><a href="${url}">Verify email</a></p>`;
    const extraction = extractAll('Verify your account', body, html, sender, ['github.com']);
    const decision = assessEmailDecision({
      extraction,
      sender,
      expectedDomains: ['github.com'],
    });

    expect(decision.action).toBe('open-link');
    expect(decision.risk).toBe('low');
    expect(decision.canAutoAct).toBe(true);
  });

  it('fails closed when no site context exists, even for a well-formed github mail', () => {
    // The scratch repro (zz_scratch_repro.test.ts) auto-opened this exact
    // mail with no expected domains. A sender that matches its own link
    // proves nothing — both fields are attacker-writable — so with no
    // waiting-tab/origin context the open is refused, never guessed.
    const sender = 'no-reply@github.com';
    const url = 'https://github.com/sessions/verify?token=abc123456';
    const body = `Please verify your account\n${url}`;
    const html = `<p>Please verify your account</p><p><a href="${url}">Verify email</a></p>`;
    const extraction = extractAll('Verify your account', body, html, sender, []);
    const decision = assessEmailDecision({ extraction, sender });

    expect(decision.action).not.toBe('open-link');
    expect(decision.canAutoAct).toBe(false);
    expect(decision.warnings).toContain('auto-open-requires-site-context');
  });

  it('still fills an OTP when the companion link cannot be opened', () => {
    const { body, html } = legitEmail();
    const extraction = extractAll(
      'Your verification code',
      `Your code is 483920\n${LEGIT_URL}`,
      `<p>Your code is <b>483920</b></p><p><a href="${LEGIT_URL}">Verify email</a></p>`,
      LEGIT_SENDER,
      []
    );
    const decision = assessEmailDecision({
      extraction,
      sender: LEGIT_SENDER,
    });

    expect(decision.action).toBe('fill-otp');
    expect(decision.canAutoAct).toBe(true);
  });
});

describe('auto-open security gates — unknown destinations get no free pass', () => {
  it('refuses to auto-open a strong activation link on an unknown domain', () => {
    const verdict = scoreActivationLink(
      'https://unknown-domain.example/verify?token=abc123456',
      'Verify email',
      'Verify your account'
    );

    // The structural proof still passes …
    expect(verdict.structuralAutoOpen).toBe(true);
    // … but there is no domain binding, so the automatic open is refused.
    expect(verdict.domainBound).toBe(false);
    expect(verdict.canAutoOpen).toBe(false);
    expect(verdict.reasons).toContain('no-domain-expectation');
  });

  it('only auto-opens when the destination is one of the expected hosts', () => {
    const url = 'https://unknown-domain.example/verify?token=abc123456';
    expect(isAutoOpenableActivationLinkForHosts(url, 'Verify email', '', ['acme.com'])).toBe(false);
    expect(
      isAutoOpenableActivationLinkForHosts(url, 'Verify email', '', ['unknown-domain.example'])
    ).toBe(true);
  });

  it('does not auto-open an off-site link for a matching sender', () => {
    const url = 'https://unknown-domain.example/verify?token=abc123456';
    const body = `Verify your address\n${url}`;
    const html = `<p>Verify your address</p><p><a href="${url}">Verify email</a></p>`;
    const extraction = extractAll('Verify your account', body, html, LEGIT_SENDER, ['acme.com']);
    const decision = assessEmailDecision({
      extraction,
      sender: LEGIT_SENDER,
      expectedDomains: ['acme.com'],
    });

    expect(decision.action).not.toBe('open-link');
    expect(decision.canAutoAct).toBe(false);
  });

  it('keeps the structural predicate available for callers that bind the destination', () => {
    // The link service evaluates the structural proof and binds the
    // destination separately (canAutoOpenVerificationLink).
    expect(isAutoOpenableActivationLink('https://acme.com/verify?token=abc123456')).toBe(true);
    expect(
      isAutoOpenableActivationLink('https://acme.com/verify?token=abc123456', '', '', {
        trustedHosts: ['acme.com'],
      })
    ).toBe(true);
    expect(
      isAutoOpenableActivationLink('https://acme.com/verify?token=abc123456', '', '', {
        trustedHosts: ['other.example'],
      })
    ).toBe(false);
  });
});

describe('auto-open security gates — the security score is real again', () => {
  it('scores a benign https link on an ordinary domain as low risk', () => {
    const { body, html } = legitEmail();
    const extraction = extractAll('Verify your account', body, html, LEGIT_SENDER, []);

    expect(extraction.debugInfo.securityRisk).toBe('low');
    expect(extraction.debugInfo.securityScore).toBe(100);
  });

  it('raises the risk for a hostile destination', () => {
    const url = 'https://xn--80ak6aa92e.com/verify?token=abc123456';
    const body = `Verify your account\n${url}`;
    const html = `<p>Verify your account</p><p><a href="${url}">Verify email</a></p>`;
    const extraction = extractAll(
      'Verify your account',
      body,
      html,
      'security@evil-phish.example',
      []
    );

    expect(extraction.debugInfo.securityRisk).not.toBe('low');
    expect(extraction.debugInfo.securityScore).toBeLessThan(100);
  });

  it('raises the risk for raw-IP, localhost and plain-http destinations', () => {
    // Pre-fix every URL scored 100/low because calculateSecurityScore was a
    // stub; each hostile destination below must now move the needle.
    const cases: Array<[string, 'medium' | 'high']> = [
      // Raw IP host: +45 → score 55 → medium.
      ['https://203.0.113.66/verify?token=abc123456', 'medium'],
      // Localhost destinations are never legitimate verification targets: +60 → high.
      ['https://localhost/verify?token=abc123456', 'high'],
      // Plain http + raw IP: 18 + 45 → high.
      ['http://203.0.113.66/verify?token=abc123456', 'high'],
      // Plain http composes with a suspicious TLD: 18 + 25 = 43 → medium.
      ['http://phishy-site.tk/verify?token=abc123456', 'medium'],
    ];
    for (const [url, expectedRisk] of cases) {
      const body = `Verify your account\n${url}`;
      const html = `<p>Verify your account</p><p><a href="${url}">Verify email</a></p>`;
      const extraction = extractAll('Verify your account', body, html, PHISHING_SENDER, []);
      expect(extraction.debugInfo.securityScore, url).toBeLessThan(100);
      expect(extraction.debugInfo.securityRisk, url).toBe(expectedRisk);
    }
    // A lone plain-http link on an ordinary domain records the signal
    // (score drops below 100) without inflating the severity bucket — the
    // decision engine adds its own non-https points and the activation
    // guard refuses non-https destinations outright.
    const plainHttp = 'http://ordinary-site.example/verify?token=abc123456';
    const html = `<p>Verify your account</p><p><a href="${plainHttp}">Verify email</a></p>`;
    const extraction = extractAll(
      'Verify your account',
      `Verify your account\n${plainHttp}`,
      html,
      PHISHING_SENDER,
      []
    );
    expect(extraction.debugInfo.securityScore).toBeLessThan(100);
  });

  it('raises the risk for credential-takeover wording', () => {
    const body =
      'Your account has been suspended. Confirm your password immediately to restore access.';
    const extraction = extractAll('Account alert', body, '', 'security@evil-phish.example', []);

    expect(extraction.debugInfo.securityRisk).not.toBe('low');
  });
});

describe('auto-open security gates — unknown domains can score a low trust', () => {
  it('no longer floors the domain trust of an unknown destination at 40', () => {
    const url = 'https://unknown-domain.example/r/9f8e7d6c?ref=mail';
    const body = `Verify your email\n${url}`;
    const html = `<p>Verify your email</p><p><a href="${url}">Verify your email</a></p>`;
    const cognitive = extractLinkCognitive(
      html,
      body,
      {
        intent: 'activation',
        confidence: 0.9,
        signals: [],
        scores: { activation: 0.9 },
        secondaryIntent: null,
      },
      null,
      [],
      [url],
      []
    );

    // Pre-fix this was Math.max(40, quality * 0.7) = 40, which silently
    // immunised unknown destinations against the decision engine's
    // "trust < 40" penalty.
    expect(cognitive).not.toBeNull();
    expect(cognitive?.domainTrust).toBeLessThan(40);
  });

  it('lets the decision engine penalise a low-trust destination', () => {
    const decision = assessEmailDecision({
      extraction: {
        intent: 'activation',
        otp: null,
        link: {
          url: 'https://unknown-domain.example/verify?token=abc123456',
          score: 90,
          confidence: 0.9,
          type: 'activation',
          hasEmbeddedCode: false,
          embeddedCode: null,
          embeddedCodeParam: null,
          anchorText: 'Verify email',
          context: 'Verify your account',
          domainTrust: 30,
          isShortened: false,
          redirectChain: [],
        },
        debugInfo: {
          provider: null,
          intentSignals: [],
          contextValidated: true,
          urlsFound: 1,
          intentScores: { activation: 0.9 },
          providerConfidence: 0.8,
          securityRisk: 'low',
        },
      },
      sender: 'no-reply@acme.com',
      expectedDomains: ['acme.com'],
    });

    expect(decision.risk).not.toBe('low');
    expect(decision.warnings).toContain('link-domain-trust-low');
    expect(decision.canAutoAct).toBe(false);
  });
});

describe('auto-open security gates — hostile destination signals enforced downstream', () => {
  it('refuses an auto-open for a credential-bearing destination', () => {
    // calculateSecurityScore flags userinfo URLs (+45), and the decision
    // engine independently re-checks the selected link (45 pts +
    // 'link-contains-credentials'). Pre-fix the stub score let a mail like
    // this sail through as open-link/low.
    const decision = assessEmailDecision({
      extraction: {
        intent: 'activation',
        otp: null,
        link: {
          url: 'https://user:pass@evil-phish.example/verify?token=abc123456',
          score: 90,
          confidence: 0.9,
          type: 'activation',
          hasEmbeddedCode: false,
          embeddedCode: null,
          embeddedCodeParam: null,
          anchorText: 'Verify email',
          context: 'Verify your account',
          domainTrust: 90,
          isShortened: false,
          redirectChain: [],
        },
        debugInfo: {
          provider: null,
          intentSignals: [],
          contextValidated: true,
          urlsFound: 1,
          intentScores: { activation: 0.9 },
          providerConfidence: 0.8,
          securityRisk: 'low',
        },
      },
      sender: PHISHING_SENDER,
      expectedDomains: ['evil-phish.example'],
    });

    expect(decision.warnings).toContain('link-contains-credentials');
    expect(decision.risk).not.toBe('low');
    expect(decision.canAutoAct).toBe(false);
  });
});
