// src/services/intelligentExtractor.ts
// GHOSTFILL INTELLIGENT EXTRACTOR - ORCHESTRATOR
// Coordinates extraction pipeline across specialized modules
// Version 2.0: Three-Layer Hybrid Intelligence


import { createLogger } from '../utils/logger';
import {
  sanitizeEmailBody,
  sanitizeEmailSubject,
  sanitizeEmail,
  sanitizeOTP,
  sanitizeActivationLink,
} from '../utils/sanitization.core';

import {
  extractUrls,
  analyzeEmailZones,
  detectProvider,
  extractOTP,
  extractLink,
  stripHtmlPreserveStructure,
  type ExtractionResult,
  type EmailIntent,
  type ProviderKnowledge,
  type IntentResult,
  type EmailZone,
  type CrossValidationResult,
  type ExtractedOTP,
  type ExtractedLink,
  type IntentSignal,
} from './extraction';
import { IntentClassifier } from './extraction/intentClassifier';

const log = createLogger('IntelligentExtractor');

const CONFIG = {
  thresholds: {
    baseOtp: 75,
    baseLink: 65,
    minOtp: 50,
    minLink: 30,
    providerReduction: 10,
    highConfidenceReduction: 5,
    verificationOtpReduction: 5,
    activationLinkReduction: 25,
    highSignalReduction: 5,
  },
  performance: { slowThresholdMs: 200 },
} as const;

function crossValidate(
  otp: ExtractedOTP | null,
  link: ExtractedLink | null,
  intent: IntentResult,
  provider: ProviderKnowledge | null
): CrossValidationResult {
  const result: CrossValidationResult = {
    otpAndLinkCoexist: otp !== null && link !== null,
    preferOTP: false,
    preferLink: false,
    reason: '',
    otpInLinkUrl: false,
    linkContainsOTP: false,
  };

  if (!result.otpAndLinkCoexist) {
    if (otp) {
      result.preferOTP = true;
      result.reason = 'only-otp';
    }
    if (link) {
      result.preferLink = true;
      result.reason = 'only-link';
    }
    return result;
  }

  if (link && otp && link.url.toLowerCase().includes(otp.code.toLowerCase())) {
    result.otpInLinkUrl = true;
    result.linkContainsOTP = true;
    result.preferLink = true;
    result.reason = 'otp-is-url-token';
    log.info('OTP appears inside link URL — preferring link');
    return result;
  }

  if (intent.intent === 'verification') {
    result.preferOTP = true;
    result.reason = 'intent-verification-prefers-otp';
  } else if (intent.intent === 'activation' || intent.intent === 'password-reset') {
    result.preferLink = true;
    result.reason = `intent-${intent.intent}-prefers-link`;
  } else if (otp && link) {
    if (otp.confidence > link.confidence + 10) {
      result.preferOTP = true;
      result.reason = `otp-higher(${otp.confidence.toFixed(0)}>${link.confidence.toFixed(0)})`;
    } else {
      result.preferLink = true;
      result.reason = `link-higher-or-equal(${link.confidence.toFixed(0)}>=${otp.confidence.toFixed(0)})`;
    }
  }

  if (provider) {
    if (provider.emailIntent === 'verification' && otp) {
      result.preferOTP = true;
      result.preferLink = false;
      result.reason = `provider-${provider.name}-prefers-otp`;
    } else if (provider.emailIntent === 'activation' && link) {
      result.preferLink = true;
      result.preferOTP = false;
      result.reason = `provider-${provider.name}-prefers-link`;
    }
  }

  log.info(`Cross-validation: ${result.reason}`);
  return result;
}

function calculateAdaptiveThresholds(
  intent: IntentResult,
  provider: ProviderKnowledge | null,
  signalDensity: number
): { otp: number; link: number } {
  let otp = CONFIG.thresholds.baseOtp;
  let link = CONFIG.thresholds.baseLink;

  if (provider) {
    otp -= CONFIG.thresholds.providerReduction;
    link -= CONFIG.thresholds.providerReduction;
  }
  if (intent.confidence > 0.7) {
    otp -= CONFIG.thresholds.highConfidenceReduction;
    link -= CONFIG.thresholds.highConfidenceReduction;
  }
  if (intent.intent === 'verification') {
    otp -= CONFIG.thresholds.verificationOtpReduction;
  }
  if (intent.intent === 'activation' || intent.intent === 'password-reset') {
    link -= CONFIG.thresholds.activationLinkReduction;
  }
  // NEW: Ultra-high intent reduction to ensure 4-digit OTPs and links are captured in verified contexts
  if (intent.confidence > 0.9) {
    otp -= 20; // Lower floor to ~40-50% for high-intent activation
    link -= 20;
  }
  if (signalDensity > 5) {
    otp -= CONFIG.thresholds.highSignalReduction;
    link -= CONFIG.thresholds.highSignalReduction;
  }

  return {
    otp: Math.max(otp, CONFIG.thresholds.minOtp),
    link: Math.max(link, CONFIG.thresholds.minLink),
  };
}

/**
 * Layer 3: Security Guard — Calculates trust score based on phishing markers
 */
function calculateSecurityScore(allUrls: string[], body: string): { score: number; risk: 'low' | 'medium' | 'high' } {
    let riskPoints = 0;
    
    // URL Density (Insight from 100k Dataset)
    if (allUrls.length > 5) {riskPoints += 20;}
    if (allUrls.length > 15) {riskPoints += 40;}
    
    // Tracking tokens (Insight from 100k Dataset)
    if (body.includes('click.email') || body.includes('tracking') || body.includes('utm_source')) {
        riskPoints += 15;
    }

    // High URL-to-Text ratio (Phishing commonality)
    const urlTextLength = allUrls.join('').length;
    if (urlTextLength > body.length * 0.5) {riskPoints += 30;}

    const score = Math.max(0, 100 - riskPoints);
    let risk: 'low' | 'medium' | 'high' = 'low';
    if (score < 40) {risk = 'high';}
    else if (score < 75) {risk = 'medium';}

    return { score, risk };
}

function refineIntent(
  subject: string,
  body: string,
  currentIntent: EmailIntent
): IntentResult {
  // Tier 1: Fast Path (High-confidence regex rules)
  if (
    /verify.*email/i.test(subject) || 
    /activate.*account/i.test(subject) ||
    /confirm.*registration/i.test(subject) ||
    /welcome.*verify/i.test(subject)
  ) {
    return { 
      intent: 'activation', 
      confidence: 1.0, 
      signals: [{ type: 'regex', source: 'subject', detail: 'high-confidence-activation', weight: 1.0 }], 
      scores: { 'activation': 1.0 },
      secondaryIntent: null
    };
  }

  if (
    /security.*code/i.test(subject) || 
    /verification.*code/i.test(subject) ||
    /one-time.*password/i.test(subject) ||
    /your.*otp/i.test(subject)
  ) {
    return { 
      intent: 'verification', 
      confidence: 1.0, 
      signals: [{ type: 'regex', source: 'subject', detail: 'high-confidence-verification', weight: 1.0 }], 
      scores: { 'verification': 1.0 },
      secondaryIntent: null
    };
  }

  // Tier 2: Smart Path (Naive Bayes ML Model)
  const mlResult = IntentClassifier.classify(subject, body);
  
  if (mlResult.confidence > 0.6) {
      log.info(`ML Intent match: ${mlResult.intent} (conf=${mlResult.confidence.toFixed(2)})`);
      return {
          intent: mlResult.intent as EmailIntent,
          confidence: mlResult.confidence,
          signals: [{ type: 'ml', source: 'naive-bayes', detail: `predicted-${mlResult.intent}`, weight: mlResult.confidence }],
          scores: { [mlResult.intent]: mlResult.confidence },
          secondaryIntent: null
      };
  }

  return { intent: currentIntent, confidence: 0.5, signals: [], scores: {}, secondaryIntent: null };
}

export function extractAll(
  subject: string,
  body: string,
  htmlBody: string = '',
  senderEmail: string = '',
  expectedDomains: string[] = []
): ExtractionResult {
  const startTime = performance.now();
  const timings: Record<string, number> = {};

  const sanitizedSubject = sanitizeEmailSubject(subject);
  const sanitizedBody = sanitizeEmailBody(htmlBody, body);
  const sanitizedHtmlBody = sanitizeEmailBody(htmlBody, body);
  const sanitizedSenderEmail = sanitizeEmail(senderEmail);
  const sourceHtml = htmlBody || body; // Use RAW html to extract URLs
  
  const plainText = `${sanitizedSubject}\n\n${stripHtmlPreserveStructure(sanitizedHtmlBody || sanitizedBody)}`;

  log.info('═══ GhostFill Intelligent Extractor ═══');

  let t = performance.now();
  const zones: EmailZone[] = analyzeEmailZones(sanitizedHtmlBody, plainText);
  timings.zones = performance.now() - t;

  t = performance.now();
  const allUrls = extractUrls(sourceHtml);
  timings.urls = performance.now() - t;

  t = performance.now();
  const { provider, confidence: providerConfidence } = detectProvider(
    sanitizedSenderEmail,
    sanitizedSubject,
    sanitizedBody,
    allUrls,
    expectedDomains
  );
  timings.provider = performance.now() - t;

  t = performance.now();
  const security = calculateSecurityScore(allUrls, sanitizedBody);
  const intentResult = refineIntent(sanitizedSubject, sanitizedBody, provider?.emailIntent || 'other');
  
  // Link intent result into result object
  intentResult.secondaryIntent = null; 
  timings.security = performance.now() - t;

  t = performance.now();
  let otp = extractOTP(plainText, sanitizedHtmlBody, provider, zones, intentResult);
  if (otp) {
    otp.code = sanitizeOTP(otp.code);
  }
  timings.otp = performance.now() - t;

  t = performance.now();
  let link = extractLink(
    sourceHtml,
    sanitizedSubject,
    sanitizedBody,
    intentResult,
    provider,
    zones,
    allUrls
  );
  if (link && link.url) {
    link.url = sanitizeActivationLink(link.url);
  }
  timings.link = performance.now() - t;

  t = performance.now();
  const crossResult = crossValidate(otp, link, intentResult, provider);
  timings.crossValidation = performance.now() - t;

  // Save originals before cross-validation discards either
  const otpBeforeCross = otp;

  if (crossResult.otpAndLinkCoexist) {
    if (crossResult.preferOTP && !crossResult.preferLink) {
      log.info('Cross-validation: discarding link, keeping OTP');
      link = null;
    } else if (crossResult.preferLink && !crossResult.preferOTP) {
      log.info('Cross-validation: discarding OTP, keeping link');
      otp = null;
    }
  }

  const thresholds = calculateAdaptiveThresholds(
    intentResult,
    provider,
    intentResult.signals.length
  );
  if (otp && otp.confidence * 100 < thresholds.otp) {
    log.info(`OTP rejected: ${(otp.confidence * 100).toFixed(0)}% < ${thresholds.otp}%`);
    otp = null;
  }
  if (link && link.confidence * 100 < thresholds.link) {
    log.info(`Link rejected: ${(link.confidence * 100).toFixed(0)}% < ${thresholds.link}%`);
    link = null;
    // If link was preferred in cross-validation (OTP was discarded for it) but link is now
    // also rejected, restore the original OTP so we don't lose both.
    if (crossResult.preferLink && !crossResult.preferOTP && otpBeforeCross && !otp) {
      otp = otpBeforeCross;
      log.info(`Link rejected after OTP was discarded for it — restoring OTP: ${otp.code}`);
    }
  }

  const extractionTimeMs = performance.now() - startTime;
  timings.total = extractionTimeMs;
  if (extractionTimeMs > CONFIG.performance.slowThresholdMs) {
    log.warn(`Slow extraction: ${extractionTimeMs.toFixed(1)}ms`);
  }

  log.info(`Done in ${extractionTimeMs.toFixed(1)}ms`, {
    intent: intentResult.intent,
    provider: provider?.name || 'unknown',
    otp: otp ? `${otp.code}(${otp.confidence.toFixed(0)}%)` : '—',
    link: link ? `${link.type}(${link.confidence.toFixed(0)}%)` : '—',
    crossValidation: crossResult.reason,
  });

  return {
    intent: intentResult.intent,
    otp,
    link,
    debugInfo: {
      provider: provider?.name || null,
      intentSignals: intentResult.signals.map((s: IntentSignal) => `${s.type}:${s.source}(w=${s.weight})`),
      contextValidated: otp !== null || link !== null,
      crossValidation: crossResult.reason,
      zones: zones.map((z) => z.zone),
      thresholds,
      timings,
      urlsFound: allUrls.length,
      providerConfidence,
      intentScores: intentResult.scores,
      secondaryIntent: intentResult.secondaryIntent,
      securityScore: security.score,
      securityRisk: security.risk,
    },
  };
}

export function extractOTPStandalone(
  emailHtml: string,
  subject: string = '',
  senderEmail: string = ''
): { best: { code: string; confidence: number } | null; allCandidates?: ExtractedOTP[] } {
  const result = extractAll(subject, '', emailHtml, senderEmail);
  return {
    best: result.otp ? { code: result.otp.code, confidence: result.otp.confidence / 100 } : null,
  };
}

export function extractLinkStandalone(
  emailHtml: string,
  subject: string = '',
  senderEmail: string = ''
): { best: ExtractedLink | null } {
  const result = extractAll(subject, '', emailHtml, senderEmail);
  return { best: result.link as ExtractedLink | null };
}

export type { ExtractedOTP, ExtractedLink, ExtractionResult, EmailIntent };
