import { describe, expect, it } from 'vitest';

import { assessEmailDecision } from '../src/services/emailDecisionEngine';
import type { ExtractionResult } from '../src/services/types/extraction.types';

type ExtractionOverrides = {
  intent?: ExtractionResult['intent'];
  otp?: ExtractionResult['otp'];
  link?: ExtractionResult['link'];
  debugInfo?: Partial<ExtractionResult['debugInfo']>;
};

function extraction(overrides: ExtractionOverrides = {}): ExtractionResult {
  return {
    intent: overrides.intent ?? 'unknown',
    otp: overrides.otp ?? null,
    link: overrides.link ?? null,
    debugInfo: {
      provider: null,
      intentSignals: [],
      contextValidated: true,
      urlsFound: overrides.link ? 1 : 0,
      intentScores: {},
      providerConfidence: 0,
      securityRisk: 'low',
      ...overrides.debugInfo,
    },
  };
}

function otp(code = '483920'): NonNullable<ExtractionResult['otp']> {
  return {
    code,
    rawCode: code,
    score: 96,
    confidence: 0.96,
    type: 'verification-code',
    format: 'numeric',
    strategy: 'explicit-label',
    length: code.length,
    context: 'Your verification code is 483920',
    label: 'verification code',
    fromUrl: false,
    urlParam: null,
    sourceUrl: null,
    visualProminence: 85,
    providerMatch: null,
    matchedSignals: [],
    antiSignals: [],
    reasoning: {
      steps: [],
      finalScore: 96,
      threshold: 70,
      accepted: true,
      rejectionReason: null,
    },
  } as NonNullable<ExtractionResult['otp']>;
}

function link(url: string, domainTrust = 82): NonNullable<ExtractionResult['link']> {
  return {
    url,
    score: 92,
    confidence: 92,
    type: 'email-verification',
    hasEmbeddedCode: false,
    embeddedCode: null,
    embeddedCodeParam: null,
    anchorText: 'Verify email',
    context: 'Verify your email address',
    domainTrust,
    isShortened: false,
    redirectChain: [],
  };
}

describe('Email decision engine', () => {
  it('auto-fills a confident verification OTP', () => {
    const decision = assessEmailDecision({
      extraction: extraction({
        intent: 'verification',
        otp: otp(),
        debugInfo: {
          intentScores: { verification: 0.9 },
          providerConfidence: 0.9,
        },
      }),
      sender: 'noreply@example.com',
    });

    expect(decision.purpose).toBe('verification');
    expect(decision.action).toBe('fill-otp');
    expect(decision.risk).toBe('low');
    expect(decision.canAutoAct).toBe(true);
  });

  it('auto-opens a trusted verification link that matches sender and site context', () => {
    const decision = assessEmailDecision({
      extraction: extraction({
        intent: 'activation',
        link: link('https://app.example.com/verify?token=abc123'),
        debugInfo: {
          intentScores: { activation: 0.88 },
          providerConfidence: 0.86,
        },
      }),
      sender: 'accounts@example.com',
      expectedDomains: ['app.example.com'],
    });

    expect(decision.purpose).toBe('activation');
    expect(decision.action).toBe('open-link');
    expect(decision.risk).toBe('low');
    expect(decision.canAutoAct).toBe(true);
    expect(decision.reasons).toContain('link-matches-current-site-context');
  });

  it('holds a suspicious standalone link for review', () => {
    const decision = assessEmailDecision({
      extraction: extraction({
        intent: 'activation',
        link: link('http://198.51.100.7/verify?token=abc123', 10),
        debugInfo: {
          intentScores: { activation: 0.9 },
          providerConfidence: 0.8,
          securityRisk: 'medium',
        },
      }),
      sender: 'security@example.com',
      expectedDomains: ['example.com'],
    });

    expect(decision.action).toBe('show-review');
    expect(decision.risk).toBe('high');
    expect(decision.canAutoAct).toBe(false);
    expect(decision.warnings).toContain('raw-ip-link');
    expect(decision.warnings).toContain('non-https-link');
  });

  it('fills the OTP but does not recommend opening a risky companion link', () => {
    const decision = assessEmailDecision({
      extraction: extraction({
        intent: 'verification',
        otp: otp('739104'),
        link: link('https://login.example.xyz/verify?token=abc123', 15),
        debugInfo: {
          intentScores: { verification: 0.92 },
          providerConfidence: 0.82,
        },
      }),
      sender: 'noreply@example.com',
      expectedDomains: ['example.com'],
    });

    expect(decision.action).toBe('fill-otp');
    expect(decision.risk).not.toBe('low');
    expect(decision.canAutoAct).toBe(true);
    expect(decision.warnings).toContain('suspicious-tld');
  });

  it('normalizes percentage link confidence into the decision confidence range', () => {
    const decision = assessEmailDecision({
      extraction: extraction({
        intent: 'activation',
        link: link('https://app.example.com/verify?token=abc123'),
        debugInfo: {
          intentScores: { activation: 0.84 },
          providerConfidence: 0.7,
        },
      }),
      sender: 'accounts@example.com',
      expectedDomains: ['app.example.com'],
    });

    expect(decision.action).toBe('open-link');
    expect(decision.confidence).toBeGreaterThan(0.9);
    expect(decision.confidence).toBeLessThanOrEqual(1);
  });

  it('ignores marketing emails even when classification confidence is high', () => {
    const decision = assessEmailDecision({
      extraction: extraction({
        intent: 'marketing',
        debugInfo: {
          intentScores: { marketing: 0.98 },
          providerConfidence: 0.95,
        },
      }),
      sender: 'news@example.com',
    });

    expect(decision.purpose).toBe('marketing');
    expect(decision.action).toBe('ignore');
    expect(decision.canAutoAct).toBe(false);
  });

  it('treats the 30-point risk boundary as medium risk', () => {
    const decision = assessEmailDecision({
      extraction: extraction({
        intent: 'activation',
        link: link('https://app.example.com/verify?token=abc123', 35),
        debugInfo: {
          intentScores: { activation: 0.86 },
          providerConfidence: 0.8,
        },
      }),
      sender: 'accounts@example.com',
      expectedDomains: ['safe.example.net'],
    });

    expect(decision.risk).toBe('medium');
    expect(decision.action).toBe('show-review');
    expect(decision.canAutoAct).toBe(false);
    expect(decision.warnings).toContain('link-domain-trust-low');
    expect(decision.warnings).toContain('link-does-not-match-current-site-context');
  });

  it('holds high link-density activation emails for review', () => {
    const decision = assessEmailDecision({
      extraction: extraction({
        intent: 'activation',
        link: link('https://app.example.com/verify?token=abc123'),
        debugInfo: {
          urlsFound: 16,
          intentScores: { activation: 0.9 },
          providerConfidence: 0.84,
        },
      }),
      sender: 'accounts@example.com',
      expectedDomains: ['safe.example.net'],
    });

    expect(decision.risk).toBe('medium');
    expect(decision.action).toBe('show-review');
    expect(decision.canAutoAct).toBe(false);
    expect(decision.warnings).toContain('many-links-in-email');
  });
});
