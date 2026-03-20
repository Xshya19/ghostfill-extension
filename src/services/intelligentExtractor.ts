// src/services/intelligentExtractor.ts
// GHOSTFILL INTELLIGENT EXTRACTOR - ORCHESTRATOR
// Coordinates extraction pipeline across specialized modules

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
} from './extraction';

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
  if (signalDensity > 5) {
    otp -= CONFIG.thresholds.highSignalReduction;
    link -= CONFIG.thresholds.highSignalReduction;
  }

  return {
    otp: Math.max(otp, CONFIG.thresholds.minOtp),
    link: Math.max(link, CONFIG.thresholds.minLink),
  };
}

export function extractAll(
  subject: string,
  body: string,
  htmlBody: string = '',
  senderEmail: string = ''
): ExtractionResult {
  const startTime = performance.now();
  const timings: Record<string, number> = {};

  const sanitizedSubject = sanitizeEmailSubject(subject);
  const sanitizedBody = sanitizeEmailBody(htmlBody, body);
  const sanitizedHtmlBody = sanitizeEmailBody(htmlBody, body);
  const sanitizedSenderEmail = sanitizeEmail(senderEmail);
  const sourceHtml = htmlBody || body; // Use RAW html to extract URLs since Service Worker fallback sanitization strips ALL tags including <a href>!
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
    allUrls
  );
  timings.provider = performance.now() - t;

  t = performance.now();
  const intentResult: IntentResult = {
    intent: provider?.emailIntent || 'other',
    confidence: providerConfidence / 100,
    signals: [],
    scores: {},
    secondaryIntent: null,
  };
  timings.intent = performance.now() - t;

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
      intentSignals: intentResult.signals.map((s) => `${s.type}:${s.source}(w=${s.weight})`),
      contextValidated: otp !== null || link !== null,
      crossValidation: crossResult.reason,
      zones: zones.map((z) => z.zone),
      thresholds,
      timings,
      urlsFound: allUrls.length,
      providerConfidence,
      intentScores: intentResult.scores,
      secondaryIntent: intentResult.secondaryIntent,
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
