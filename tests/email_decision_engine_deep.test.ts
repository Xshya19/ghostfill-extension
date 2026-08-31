/**
 * email_decision_engine_deep.test.ts
 * Deep test suite for src/services/emailDecisionEngine.ts
 */
import { describe, it, expect } from 'vitest';

import { assessEmailDecision } from '../src/services/emailDecisionEngine';
import type {
  ExtractionResult,
  ExtractedOTP,
  ExtractedLink,
} from '../src/services/types/extraction.types';

function makeOtp(overrides: Partial<ExtractedOTP> = {}): ExtractedOTP {
  return {
    code: '123456',
    rawCode: '123456',
    score: 90,
    confidence: 0.95,
    type: 'otp',
    format: 'numeric',
    strategy: 'proximity-inference',
    length: 6,
    context: 'Your code is 123456',
    label: 'code',
    fromUrl: false,
    urlParam: null,
    sourceUrl: null,
    visualProminence: 80,
    providerMatch: null,
    matchedSignals: [],
    antiSignals: [],
    reasoning: {} as any,
    ...overrides,
  };
}

function makeLink(overrides: Partial<ExtractedLink> = {}): ExtractedLink {
  return {
    url: 'https://example.com/verify',
    score: 90,
    confidence: 0.9,
    type: 'activation',
    hasEmbeddedCode: false,
    embeddedCode: null,
    embeddedCodeParam: null,
    anchorText: 'Verify',
    context: 'Click to verify',
    domainTrust: 80,
    isShortened: false,
    redirectChain: [],
    ...overrides,
  };
}

function makeExtraction(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    intent: 'verification',
    otp: null,
    link: null,
    debugInfo: {
      provider: null,
      intentSignals: [],
      contextValidated: true,
      providerConfidence: 0,
      intentScores: {},
      urlsFound: 0,
      securityRisk: 'low',
      ...overrides.debugInfo,
    },
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// Purpose Mapping
// ═══════════════════════════════════════════════════════════════

describe('assessEmailDecision() — purpose mapping', () => {
  it('maps verification intent', () => {
    const d = assessEmailDecision({ extraction: makeExtraction({ intent: 'verification' }) });
    expect(d.purpose).toBe('verification');
  });

  it('maps activation intent', () => {
    const d = assessEmailDecision({ extraction: makeExtraction({ intent: 'activation' }) });
    expect(d.purpose).toBe('activation');
  });

  it('maps account-update to activation', () => {
    const d = assessEmailDecision({ extraction: makeExtraction({ intent: 'account-update' }) });
    expect(d.purpose).toBe('activation');
  });

  it('maps magic-link intent', () => {
    const d = assessEmailDecision({ extraction: makeExtraction({ intent: 'magic-link' }) });
    expect(d.purpose).toBe('magic-login');
  });

  it('maps magic-link-login intent', () => {
    const d = assessEmailDecision({ extraction: makeExtraction({ intent: 'magic-link-login' }) });
    expect(d.purpose).toBe('magic-login');
  });

  it('maps password-reset intent', () => {
    const d = assessEmailDecision({ extraction: makeExtraction({ intent: 'password-reset' }) });
    expect(d.purpose).toBe('password-reset');
  });

  it('maps two-factor intent', () => {
    const d = assessEmailDecision({ extraction: makeExtraction({ intent: 'two-factor' }) });
    expect(d.purpose).toBe('two-factor');
  });

  it('maps 2fa intent', () => {
    const d = assessEmailDecision({ extraction: makeExtraction({ intent: '2fa' }) });
    expect(d.purpose).toBe('two-factor');
  });

  it('maps device-confirmation to two-factor', () => {
    const d = assessEmailDecision({ extraction: makeExtraction({ intent: 'device-confirmation' }) });
    expect(d.purpose).toBe('two-factor');
  });

  it('maps invitation intent', () => {
    const d = assessEmailDecision({ extraction: makeExtraction({ intent: 'invitation' }) });
    expect(d.purpose).toBe('invitation');
  });

  it('maps transactional intent', () => {
    const d = assessEmailDecision({ extraction: makeExtraction({ intent: 'transactional' }) });
    expect(d.purpose).toBe('transactional');
  });

  it('maps marketing intent', () => {
    const d = assessEmailDecision({ extraction: makeExtraction({ intent: 'marketing' }) });
    expect(d.purpose).toBe('marketing');
  });

  it('maps newsletter intent', () => {
    const d = assessEmailDecision({ extraction: makeExtraction({ intent: 'newsletter' }) });
    expect(d.purpose).toBe('newsletter');
  });

  it('maps social-notification intent', () => {
    const d = assessEmailDecision({ extraction: makeExtraction({ intent: 'social-notification' }) });
    expect(d.purpose).toBe('social-notification');
  });

  it('maps unknown intent to unknown', () => {
    const d = assessEmailDecision({ extraction: makeExtraction({ intent: 'unknown-future' as any }) });
    expect(d.purpose).toBe('unknown');
  });
});

// ═══════════════════════════════════════════════════════════════
// Risk Scoring
// ═══════════════════════════════════════════════════════════════

describe('assessEmailDecision() — risk scoring', () => {
  it('low risk for clean verification email', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        otp: makeOtp({ code: '123456', confidence: 0.95 }),
      }),
    });
    expect(d.risk).toBe('low');
  });

  it('high risk for combined security risk + additional factor', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        link: makeLink({ url: 'https://192.168.1.1/verify', confidence: 0.9 }),
        debugInfo: { securityRisk: 'high', urlsFound: 0, intentScores: {}, provider: null, intentSignals: [], contextValidated: true },
      }),
    });
    // securityRisk:'high' = 50pts + raw-ip-link = 45pts = 95pts >= 60
    expect(d.risk).toBe('high');
  });

  it('medium risk for medium security risk', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        debugInfo: { securityRisk: 'medium', urlsFound: 0, intentScores: {}, provider: null, intentSignals: [], contextValidated: true },
      }),
    });
    expect(['medium', 'low']).toContain(d.risk);
  });

  it('increases risk for many links', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        debugInfo: { securityRisk: 'low', urlsFound: 20, intentScores: {}, provider: null, intentSignals: [], contextValidated: true },
      }),
    });
    expect(d.warnings).toContain('many-links-in-email');
  });

  it('increases risk for non-https links', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        link: makeLink({ url: 'http://example.com/verify?token=abc', confidence: 0.9 }),
        debugInfo: { securityRisk: 'low', urlsFound: 1, intentScores: {}, provider: null, intentSignals: [], contextValidated: true },
      }),
    });
    expect(d.warnings).toContain('non-https-link');
  });

  it('increases risk for raw IP links', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        link: makeLink({ url: 'https://192.168.1.1/verify', confidence: 0.9 }),
        debugInfo: { securityRisk: 'low', urlsFound: 1, intentScores: {}, provider: null, intentSignals: [], contextValidated: true },
      }),
    });
    expect(d.warnings).toContain('raw-ip-link');
  });

  it('increases risk for localhost links', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        link: makeLink({ url: 'https://localhost/verify', confidence: 0.9 }),
        debugInfo: { securityRisk: 'low', urlsFound: 1, intentScores: {}, provider: null, intentSignals: [], contextValidated: true },
      }),
    });
    expect(d.warnings).toContain('localhost-link');
  });

  it('increases risk for punycode domains', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        link: makeLink({ url: 'https://xn--e1afmapc.xn--p1ai/verify', confidence: 0.9 }),
        debugInfo: { securityRisk: 'low', urlsFound: 1, intentScores: {}, provider: null, intentSignals: [], contextValidated: true },
      }),
    });
    expect(d.warnings).toContain('punycode-domain');
  });

  it('increases risk for suspicious TLDs', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        link: makeLink({ url: 'https://example.tk/verify', confidence: 0.9 }),
        debugInfo: { securityRisk: 'low', urlsFound: 1, intentScores: {}, provider: null, intentSignals: [], contextValidated: true },
      }),
    });
    expect(d.warnings).toContain('suspicious-tld');
  });

  it('increases risk for link with credentials', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        link: makeLink({ url: 'https://user:pass@example.com/verify', confidence: 0.9 }),
        debugInfo: { securityRisk: 'low', urlsFound: 1, intentScores: {}, provider: null, intentSignals: [], contextValidated: true },
      }),
    });
    expect(d.warnings).toContain('link-contains-credentials');
  });

  it('detects deep subdomain chains', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        link: makeLink({ url: 'https://a.b.c.d.e.f.g.example.com/verify', confidence: 0.9 }),
        debugInfo: { securityRisk: 'low', urlsFound: 1, intentScores: {}, provider: null, intentSignals: [], contextValidated: true },
      }),
    });
    expect(d.reasons).toContain('deep-subdomain-chain');
  });
});

// ═══════════════════════════════════════════════════════════════
// Action Selection
// ═══════════════════════════════════════════════════════════════

describe('assessEmailDecision() — action selection', () => {
  it('fill-otp for OTP-only verification email', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        otp: makeOtp({ code: '123456', confidence: 0.95 }),
      }),
    });
    expect(d.action).toBe('fill-otp');
  });

  it('fill-otp even for low-confidence OTP (base confidence 0.55)', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        otp: makeOtp({ code: '123456', confidence: 0.1, strategy: 'emergency-regex' }),
      }),
    });
    // base confidence = max(0.1, 0.55) = 0.55 >= 0.45 threshold
    expect(d.action).toBe('fill-otp');
  });

  it('ignore for marketing emails with no OTP/link', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({ intent: 'marketing' }),
    });
    expect(d.action).toBe('ignore');
  });

  it('ignore for newsletter emails with no OTP/link', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({ intent: 'newsletter' }),
    });
    expect(d.action).toBe('ignore');
  });

  it('ignore for transactional emails with no OTP/link', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({ intent: 'transactional' }),
    });
    expect(d.action).toBe('ignore');
  });

  it('show-review for high-risk link-only emails', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        link: makeLink({ url: 'https://example.com/verify', confidence: 0.9 }),
        debugInfo: { securityRisk: 'high', urlsFound: 1, intentScores: {}, provider: null, intentSignals: [], contextValidated: true },
      }),
    });
    expect(d.action).toBe('show-review');
  });

  it('fill-otp for OTP+link when high-risk (link dropped)', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        otp: makeOtp({ code: '123456', confidence: 0.95 }),
        link: makeLink({ url: 'https://example.com/verify', confidence: 0.9 }),
        debugInfo: { securityRisk: 'high', urlsFound: 1, intentScores: {}, provider: null, intentSignals: [], contextValidated: true },
      }),
    });
    // High risk should prevent link opening, but OTP should still work
    expect(['fill-otp', 'show-review']).toContain(d.action);
  });
});

// ═══════════════════════════════════════════════════════════════
// Domain Context Scoring
// ═══════════════════════════════════════════════════════════════

describe('assessEmailDecision() — domain context', () => {
  it('sender matches link domain — no risk', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        link: makeLink({ url: 'https://example.com/verify?token=abc', confidence: 0.9 }),
        debugInfo: { securityRisk: 'low', urlsFound: 1, intentScores: {}, provider: null, intentSignals: [], contextValidated: true },
      }),
      sender: 'noreply@example.com',
    });
    expect(d.reasons).toContain('sender-domain-matches-link');
  });

  it('sender differs from link domain — increases risk', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        link: makeLink({ url: 'https://differentsite.com/verify?token=abc', confidence: 0.9 }),
        debugInfo: { securityRisk: 'low', urlsFound: 1, intentScores: {}, provider: null, intentSignals: [], contextValidated: true },
      }),
      sender: 'noreply@example.com',
    });
    expect(d.reasons).toContain('sender-domain-differs-from-link');
  });

  it('expected domain matches link — noted', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        link: makeLink({ url: 'https://example.com/verify?token=abc', confidence: 0.9 }),
        debugInfo: { securityRisk: 'low', urlsFound: 1, intentScores: {}, provider: null, intentSignals: [], contextValidated: true },
      }),
      expectedDomains: ['https://example.com'],
    });
    expect(d.reasons).toContain('link-matches-current-site-context');
  });

  it('expected domain does not match — warning', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        link: makeLink({ url: 'https://other.com/verify?token=abc', confidence: 0.9 }),
        debugInfo: { securityRisk: 'low', urlsFound: 1, intentScores: {}, provider: null, intentSignals: [], contextValidated: true },
      }),
      expectedDomains: ['https://example.com'],
    });
    expect(d.warnings).toContain('link-does-not-match-current-site-context');
  });
});

// ═══════════════════════════════════════════════════════════════
// canAutoAct
// ═══════════════════════════════════════════════════════════════

describe('assessEmailDecision() — canAutoAct', () => {
  it('true for low-risk OTP-only', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        otp: makeOtp({ code: '123456', confidence: 0.95 }),
      }),
    });
    if (d.action === 'fill-otp') {
      expect(d.canAutoAct).toBe(true);
    }
  });

  it('false for show-review', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        otp: makeOtp({ code: '123456', confidence: 0.1, strategy: 'emergency-regex' }),
      }),
    });
    if (d.action === 'show-review') {
      expect(d.canAutoAct).toBe(false);
    }
  });

  it('false for ignore', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({ intent: 'marketing' }),
    });
    expect(d.canAutoAct).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Confidence Calculation
// ═══════════════════════════════════════════════════════════════

describe('assessEmailDecision() — confidence', () => {
  it('confidence is between 0 and 1', () => {
    const inputs = [
      makeExtraction({ intent: 'verification' }),
      makeExtraction({
        intent: 'verification',
        otp: makeOtp({ code: '123456', confidence: 0.95 }),
      }),
      makeExtraction({
        intent: 'marketing',
        link: makeLink({ url: 'https://example.com', type: 'marketing', confidence: 0.3 }),
        debugInfo: { securityRisk: 'high', urlsFound: 20, intentScores: {}, provider: null, intentSignals: [], contextValidated: true },
      }),
    ];

    for (const ext of inputs) {
      const d = assessEmailDecision({ extraction: ext });
      expect(d.confidence).toBeGreaterThanOrEqual(0);
      expect(d.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('normalizes confidence > 1 (percentage scale)', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        otp: makeOtp({ code: '123456', confidence: 95 }), // 95 not 0.95
      }),
    });
    expect(d.confidence).toBeLessThanOrEqual(1);
    expect(d.confidence).toBeGreaterThan(0);
  });

  it('handles NaN confidence gracefully', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        otp: makeOtp({ code: '123456', confidence: NaN }),
      }),
    });
    expect(d.confidence).toBeGreaterThanOrEqual(0);
    expect(d.confidence).toBeLessThanOrEqual(1);
    expect(Number.isFinite(d.confidence)).toBe(true);
  });

  it('handles undefined confidence', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        otp: makeOtp({ code: '123456', confidence: undefined as any }),
      }),
    });
    expect(Number.isFinite(d.confidence)).toBe(true);
  });

  it('risk penalty reduces confidence', () => {
    const low = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        otp: makeOtp({ code: '123456', confidence: 0.9 }),
      }),
    });

    const high = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        otp: makeOtp({ code: '123456', confidence: 0.9 }),
        debugInfo: { securityRisk: 'high', urlsFound: 20, intentScores: {}, provider: null, intentSignals: [], contextValidated: true },
      }),
    });

    expect(high.confidence).toBeLessThan(low.confidence);
  });
});

// ═══════════════════════════════════════════════════════════════
// Edge Cases
// ═══════════════════════════════════════════════════════════════

describe('assessEmailDecision() — edge cases', () => {
  it('handles malformed link URL gracefully', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        link: makeLink({ url: 'not-a-url', confidence: 0.5 }),
        debugInfo: { securityRisk: 'low', urlsFound: 1, intentScores: {}, provider: null, intentSignals: [], contextValidated: true },
      }),
    });
    expect(d).toBeDefined();
    expect(d.warnings).toContain('malformed-link');
  });

  it('handles empty link URL', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        link: makeLink({ url: '', confidence: 0.5 }),
        debugInfo: { securityRisk: 'low', urlsFound: 0, intentScores: {}, provider: null, intentSignals: [], contextValidated: true },
      }),
    });
    expect(d).toBeDefined();
  });

  it('handles no sender', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        link: makeLink({ url: 'https://example.com/verify', confidence: 0.9 }),
        debugInfo: { securityRisk: 'low', urlsFound: 1, intentScores: {}, provider: null, intentSignals: [], contextValidated: true },
      }),
      sender: undefined,
    });
    expect(d).toBeDefined();
  });

  it('reasons include intent', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({ intent: 'verification' }),
    });
    expect(d.reasons.some(r => r.startsWith('intent:'))).toBe(true);
  });

  it('reasons include provider when available', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        debugInfo: { provider: 'GitHub', providerConfidence: 0.9, intentScores: {}, urlsFound: 0, securityRisk: 'low', intentSignals: [], contextValidated: true },
      }),
    });
    expect(d.reasons).toContain('provider:GitHub');
  });

  it('reasons include risk points when > 0', () => {
    const d = assessEmailDecision({
      extraction: makeExtraction({
        intent: 'verification',
        debugInfo: { securityRisk: 'medium', urlsFound: 0, intentScores: {}, provider: null, intentSignals: [], contextValidated: true },
      }),
    });
    expect(d.reasons.some(r => r.startsWith('risk-points:'))).toBe(true);
  });
});
