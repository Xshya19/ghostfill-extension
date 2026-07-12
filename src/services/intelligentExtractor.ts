import { createLogger } from '../utils/logger';
import {
  sanitizeEmailBody,
  sanitizeEmailSubject,
  sanitizeEmailFrom,
  sanitizeOTP,
  sanitizeActivationLink,
} from '../utils/sanitization.core';
import { extractUrls } from './extraction/urlExtractor';
import { analyzeEmailZones, stripHtmlPreserveStructure } from './extraction/zoneAnalyzer';
import { detectProvider } from './extraction/providerDetector';
import { extractOTP } from './extraction/otpExtractor';
import { extractLink } from './extraction/linkExtractor';
import { normalizeForExtraction } from './extraction/domEngine';
import { extractOTPCognitive } from './extraction/cognitiveOtpExtractor';
import { extractLinkCognitive } from './extraction/cognitiveLinkExtractor';
import type {
  ExtractionResult,
  EmailIntent,
  ProviderKnowledge,
  IntentResult,
  EmailZone,
  CrossValidationResult,
  ExtractedOTP,
  ExtractedLink,
  IntentSignal,
} from './types/extraction.types';

import intentModel from './extraction/knowledge/intent_model.json';

interface ModelData {
  priors: Record<string, number>;
  likelihoods: Record<string, Record<string, number>>;
  vocabSize: number;
}

const model = intentModel as unknown as ModelData;

export class IntentClassifier {
  private static tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);
  }

  static classify(subject: string, body: string): { intent: string; confidence: number } {
    const tokens = this.tokenize(`${subject} ${body}`);
    const results: Record<string, number> = {};

    for (const label in model.priors) {
      let logProb = Math.log(model.priors[label] || 1e-10);

      tokens.forEach((token) => {
        const likelihood = model.likelihoods[label]?.[token];
        if (likelihood) {
          logProb += Math.log(likelihood);
        } else {
          logProb += Math.log(1 / (model.vocabSize * 10));
        }
      });

      results[label] = logProb;
    }

    const maxLogProb = Math.max(...Object.values(results));
    const expProbs = Object.fromEntries(
      Object.entries(results).map(([label, logProb]) => [label, Math.exp(logProb - maxLogProb)])
    );

    const sumExpProbs = Object.values(expProbs).reduce((a, b) => a + b, 0);
    const finalProbs = Object.fromEntries(
      Object.entries(expProbs).map(([label, prob]) => [label, prob / sumExpProbs])
    );

    const sorted = Object.entries(finalProbs).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) {
      return { intent: 'unknown', confidence: 0 };
    }
    const [bestIntent, confidence] = sorted[0]!;

    return {
      intent: bestIntent,
      confidence,
    };
  }
}

const log = createLogger('IntelligentExtractor');

const CONFIG = {
  thresholds: {
    // Powerful adaptive gates: catch real OTPs/links without spam floods.
    // Dual-engine consensus still boosts winners to near-100.
    baseOtp: 65,
    baseLink: 55,
    minOtp: 40,
    minLink: 25,
    providerReduction: 14,
    highConfidenceReduction: 8,
    verificationOtpReduction: 10,
    activationLinkReduction: 25,
    highSignalReduction: 5,
  },
  performance: { slowThresholdMs: 200 },
} as const;

const ACTIVATION_INTENT_PATTERNS = [
  /activate(?: your| my| the)? account/i,
  /active(?: your| my| the)? (?:mail|email|account)/i,
  /activation link/i,
  /verify(?: your| my| the)? email(?: address)?/i,
  /email verification/i,
  /confirm(?: your| my| the)? email(?: address)?/i,
  /confirm(?: your| my| the)? account/i,
  /complete(?: your)? (?:registration|signup|sign-up|account setup|setup)/i,
  /finish(?: creating)?(?: your)? account/i,
  /finish(?: signing| sign) up/i,
  /accept(?: the| your| my)? (?:invite|invitation)/i,
  /join(?: the)? (?:workspace|team|organization|organisation|project)/i,
  /magic link|passwordless|secure sign[- ]?in link|sign[- ]?in link|login link/i,
  /authorize(?: this)? (?:device|sign[- ]?in|login)/i,
  /approve(?: this)? (?:device|sign[- ]?in|login)/i,
  /trust this device/i,
  /welcome to[\s\S]{0,80}(?:verify|confirm|activate|get started)/i,
] as const;

const ACTIVATION_ACTION_PATTERNS = [
  /click(?: the| this)? (?:button|link)/i,
  /tap(?: the| this)? (?:button|link)/i,
  /follow this link/i,
  /use this link/i,
  /open (?:the|this)? ?link/i,
  /continue(?: to| with)?/i,
  /proceed/i,
  /launch/i,
  /access(?: your)? account/i,
  /get started/i,
] as const;

const VERIFICATION_CODE_INTENT_PATTERNS = [
  /verification code/i,
  /security code/i,
  /confirmation code/i,
  /authentication code/i,
  /one[- ]?time (?:password|code|pin)/i,
  /\botp\b/i,
  /\b2fa\b/i,
  /\bpasscode\b/i,
  /(?:your|the) code (?:is|:)/i,
] as const;

const PASSWORD_RESET_INTENT_PATTERNS = [
  /reset(?: your| my| the)? password/i,
  /password reset/i,
  /forgot(?: your| my)? password/i,
  /recover(?: your| my| the)? account/i,
  /change(?: your| my| the)? password/i,
  /create (?:a )?new password/i,
] as const;

function countMatches(patterns: readonly RegExp[], text: string): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function makeIntentResult(
  intent: EmailIntent,
  confidence: number,
  detail: string,
  secondaryIntent: EmailIntent | null = null
): IntentResult {
  const signal: IntentSignal = {
    type: 'regex',
    source: 'deterministic',
    detail,
    weight: confidence,
  };
  return {
    intent,
    confidence,
    signals: [signal],
    scores: secondaryIntent
      ? { [intent]: confidence, [secondaryIntent]: Math.max(0.45, confidence - 0.18) }
      : { [intent]: confidence },
    secondaryIntent,
  };
}

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

  // When both coexist, keep BOTH to allow simultaneous OTP autofill
  // and magic link activation.
  result.preferOTP = true;
  result.preferLink = true;

  if (link && otp && link.url.toLowerCase().includes(otp.code.toLowerCase())) {
    result.otpInLinkUrl = true;
    result.linkContainsOTP = true;
    result.reason = 'otp-is-url-token';
    log.info('OTP appears inside link URL — keeping both');
    return result;
  }

  if (intent.intent === 'verification') {
    result.reason = 'intent-verification-keeps-both';
  } else if (intent.intent === 'activation' || intent.intent === 'password-reset') {
    result.reason = `intent-${intent.intent}-keeps-both`;
  } else if (otp && link) {
    // FIX: confidence is on a 0-1 scale (see otp.confidence * 100 below), so a
    // ~10 percentage-point lead is 0.1, not 10. The previous `+ 10` made this
    // branch unreachable. Render the numbers as real percentages too.
    if (otp.confidence > link.confidence + 0.1) {
      result.reason = `coexist-otp-higher-keeps-both(${(otp.confidence * 100).toFixed(0)}>${(link.confidence * 100).toFixed(0)})`;
    } else {
      result.reason = `coexist-link-higher-keeps-both(${(link.confidence * 100).toFixed(0)}>=${(otp.confidence * 100).toFixed(0)})`;
    }
  }

  if (provider) {
    if (provider.emailIntent === 'verification' && otp) {
      result.reason = `provider-${provider.name}-verification-keeps-both`;
    } else if (provider.emailIntent === 'activation' && link) {
      result.reason = `provider-${provider.name}-activation-keeps-both`;
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
function calculateSecurityScore(
  allUrls: string[],
  body: string
): { score: number; risk: 'low' | 'medium' | 'high' } {
  let riskPoints = 0;

  // URL Density (Insight from 100k Dataset)
  if (allUrls.length > 5) {
    riskPoints += 20;
  }
  if (allUrls.length > 15) {
    riskPoints += 40;
  }

  // Tracking tokens (Insight from 100k Dataset)
  if (body.includes('click.email') || body.includes('tracking') || body.includes('utm_source')) {
    riskPoints += 15;
  }

  // High URL-to-Text ratio (Phishing commonality)
  const urlTextLength = allUrls.join('').length;
  if (urlTextLength > body.length * 0.5) {
    riskPoints += 30;
  }

  const score = Math.max(0, 100 - riskPoints);
  let risk: 'low' | 'medium' | 'high' = 'low';
  if (score < 40) {
    risk = 'high';
  } else if (score < 75) {
    risk = 'medium';
  }

  return { score, risk };
}

function refineIntent(subject: string, body: string, currentIntent: EmailIntent): IntentResult {
  const combined = `${subject}\n${body}`;
  const activationMatches = countMatches(ACTIVATION_INTENT_PATTERNS, combined);
  const activationActionMatches = countMatches(ACTIVATION_ACTION_PATTERNS, combined);
  const verificationMatches = countMatches(VERIFICATION_CODE_INTENT_PATTERNS, combined);
  const passwordResetMatches = countMatches(PASSWORD_RESET_INTENT_PATTERNS, combined);
  const hasUrl = /https?:\/\//i.test(body);

  if (passwordResetMatches > 0) {
    return makeIntentResult(
      'password-reset',
      Math.min(0.98, 0.82 + passwordResetMatches * 0.06),
      'deterministic-password-reset'
    );
  }

  if (activationMatches > 0 && (hasUrl || activationActionMatches > 0)) {
    return makeIntentResult(
      'activation',
      Math.min(0.99, 0.82 + activationMatches * 0.05 + activationActionMatches * 0.03),
      'deterministic-activation',
      verificationMatches > 0 ? 'verification' : null
    );
  }

  if (verificationMatches > 0) {
    return makeIntentResult(
      'verification',
      Math.min(0.98, 0.82 + verificationMatches * 0.05),
      'deterministic-verification-code'
    );
  }

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
      signals: [
        { type: 'regex', source: 'subject', detail: 'high-confidence-activation', weight: 1.0 },
      ],
      scores: { activation: 1.0 },
      secondaryIntent: null,
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
      signals: [
        { type: 'regex', source: 'subject', detail: 'high-confidence-verification', weight: 1.0 },
      ],
      scores: { verification: 1.0 },
      secondaryIntent: null,
    };
  }

  // Tier 2: Smart Path (Naive Bayes ML Model)
  const mlResult = IntentClassifier.classify(subject, body);
  if (mlResult.confidence > 0.6) {
    log.info(`ML Intent match: ${mlResult.intent} (conf=${mlResult.confidence.toFixed(2)})`);
    return {
      intent: mlResult.intent as EmailIntent,
      confidence: mlResult.confidence,
      signals: [
        {
          type: 'ml',
          source: 'naive-bayes',
          detail: `predicted-${mlResult.intent}`,
          weight: mlResult.confidence,
        },
      ],
      scores: { [mlResult.intent]: mlResult.confidence },
      secondaryIntent: null,
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

  const normSubject = normalizeForExtraction(subject);
  const normBody = normalizeForExtraction(body);
  const normHtmlBody = normalizeForExtraction(htmlBody);

  const sanitizedSubject = sanitizeEmailSubject(normSubject);
  const sanitizedBody = sanitizeEmailBody(normHtmlBody, normBody);
  const sanitizedHtmlBody = sanitizeEmailBody(normHtmlBody, normHtmlBody || normBody);
  const sanitizedSenderEmail = sanitizeEmailFrom(senderEmail);

  const sourceHtml = normHtmlBody || normBody; // Use normalized html to extract URLs
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
  const intentResult = refineIntent(
    sanitizedSubject,
    sanitizedBody,
    provider?.emailIntent || 'other'
  );
  // Link intent result into result object
  intentResult.secondaryIntent = null;
  timings.security = performance.now() - t;

  t = performance.now();
  // Dual engines for accuracy (cognitive + traditional). Prefer consensus.
  const cogOtp = extractOTPCognitive(plainText, sanitizedHtmlBody, provider, zones, intentResult, sanitizedSubject);
  const tradOtp = extractOTP(plainText, sanitizedHtmlBody, provider, zones, intentResult);

  if (cogOtp) cogOtp.code = sanitizeOTP(cogOtp.code);
  if (tradOtp) tradOtp.code = sanitizeOTP(tradOtp.code);

  let otp: typeof cogOtp = null;

  if (cogOtp && tradOtp) {
    if (cogOtp.code === tradOtp.code) {
      // 🤝 Consensus: both engines agreed on the same code — max confidence
      otp = cogOtp;
      otp.score = Math.min(100, Math.max(cogOtp.score, tradOtp.score) + 35);
      otp.confidence = otp.score / 100;
      otp.reasoning.steps.push({
        layer: 'consensus',
        observation: 'Dual engines (Cognitive & Traditional Heuristics) reached agreement consensus on the code.',
        conclusion: 'Confidence boosted to maximum agreement consensus.',
        impact: 'positive',
      });
      if (cogOtp.matchedSignals && tradOtp.matchedSignals) {
        const seenSignals = new Set(cogOtp.matchedSignals.map((s) => s.name));
        for (const s of tradOtp.matchedSignals) {
          if (!seenSignals.has(s.name)) {
            otp.matchedSignals.push(s);
          }
        }
      }
      log.info(
        `🤝 Dual-engine consensus on ${otp.code}. Boosted confidence to ${(otp.confidence * 100).toFixed(0)}%`
      );
    } else {
      // Disagreement: prefer code that also appears in subject / near intent keywords
      const subject = sanitizedSubject.toLowerCase();
      const cogInSubject = subject.includes(cogOtp.code.toLowerCase());
      const tradInSubject = subject.includes(tradOtp.code.toLowerCase());
      const margin = Math.abs(cogOtp.score - tradOtp.score);

      if (cogInSubject && !tradInSubject) {
        otp = cogOtp;
        otp.score = Math.min(100, otp.score + 10);
      } else if (tradInSubject && !cogInSubject) {
        otp = tradOtp;
        otp.score = Math.min(100, otp.score + 10);
      } else if (margin >= 8) {
        otp = cogOtp.score >= tradOtp.score ? cogOtp : tradOtp;
      } else {
        // Near-tie: cognitive tends to be better on modern email layouts
        otp = cogOtp.score >= tradOtp.score - 3 ? cogOtp : tradOtp;
        // Soft-penalize non-consensus so weak fills don't auto-act as aggressively
        otp.score = Math.max(0, otp.score - 8);
      }
      otp.confidence = otp.score / 100;
      log.info(
        `Engine disagreement: Cognitive=${cogOtp.code}(${cogOtp.score.toFixed(0)}%) vs Traditional=${tradOtp.code}(${tradOtp.score.toFixed(0)}%). Selected: ${otp.code}`
      );
    }
  } else {
    otp = cogOtp || tradOtp;
  }

  // Cross-validation: subject-body cross-validation boost (if not already applied in cognitive)
  if (otp && sanitizedSubject.includes(otp.code) && !otp.matchedSignals?.some(s => s.name === 'subject-body-agreement')) {
    otp.score = Math.min(100, otp.score + 35);
    otp.confidence = otp.score / 100;
  }
  timings.otp = performance.now() - t;

  t = performance.now();
  // 🧠 Try Cognitive Link extraction first
  let link = extractLinkCognitive(
    sanitizedHtmlBody,
    plainText,
    intentResult,
    provider,
    zones,
    allUrls,
    expectedDomains
  );
  if (link && link.url) {
    link.url = sanitizeActivationLink(link.url);
  } else {
    // Fallback to traditional extractLink
    link = extractLink(
      sourceHtml,
      sanitizedSubject,
      sanitizedBody,
      intentResult,
      provider,
      zones,
      allUrls,
      expectedDomains
    );
    if (link && link.url) {
      link.url = sanitizeActivationLink(link.url);
    }
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

  // H6: Emergency fallback — if both OTP and link are null, try emergency regex patterns
  if (!otp && !link) {
    const emergencyPatterns = [
      /(?:code|pin|otp|token|passcode|código|clave|kennwort|sécurité|vérification|कोड|ओटीपी|コード|認証|验证码|密码|인증|senha|kod|şifre|رمز|كود)\s*(?:is|:|:?\s*ist|:?\s*est|:?\s*है|:?\s*です|:?\s*为|:?\s*是|:?\s*equals?|=)\s*\b([A-Z0-9]{4,10})\b/i,
      /(?:confirmation|verification|security|login|access|verificación|sécurité|authentication)\s+(?:code|pin|otp|código|clave|passcode|رمز|كود)\s*:?\s*\b([A-Z0-9]{4,10})\b/i,
      /(?:your|su|ihr|votre|आपका|あなたの|您的|귀하의|seu|senin)\s+(?:\w+\s+)?(?:code|pin|otp|código|clave|kennwort|passcode|رمز|كود)\s*(?:is|:|:?\s*ist|:?\s*est|:?\s*है|:?\s*です|:?\s*为|:?\s*是|=)\s*\b([A-Z0-9]{4,10})\b/i,
      /\b([A-Z0-9]{4,10})\s+(?:is|ist|est|है|です|为|是)\s+(?:your|su|ihr|votre|आपका|あなたの|您的|귀하의|seu|senin)\s+(?:\w+\s+)?(?:code|pin|otp|código|clave|passcode|رمز|كود)/i,
    ];
    // Strip zero-width characters and RTL/LTR marks
    const textToSearch = `${subject} ${body}`
      .replace(/[\u200B-\u200D\uFEFF\u200E\u200F]/g, '')
      .substring(0, 5000);
      
    const currentYear = new Date().getFullYear();

    for (const pattern of emergencyPatterns) {
      const match = textToSearch.match(pattern);
      if (match?.[1]) {
        const code = match[1].replace(/[-\s]/g, '');
        const numVal = parseInt(code, 10);
        const isYear = !isNaN(numVal) && numVal >= 1970 && numVal <= currentYear + 2;
        if (isYear) {
          continue; // Skip year-like matches
        }

        const sanitizedCode = sanitizeOTP(code);
        otp = {
          code: sanitizedCode,
          rawCode: match[1],
          score: 50,
          confidence: 0.5,
          type: 'otp' as const,
          format: 'numeric' as const,
          strategy: 'emergency-regex' as const,
          length: code.length,
          context: '',
          label: null,
          fromUrl: false,
          urlParam: null,
          sourceUrl: null,
          visualProminence: 0,
          providerMatch: null,
          matchedSignals: [],
          antiSignals: [],
          reasoning: {
            steps: [
              {
                layer: 'emergency-regex',
                observation: 'Standard extraction strategies failed; emergency patterns attempted.',
                conclusion: `Code '${sanitizedCode}' matched an emergency regex pattern.`,
                impact: 'positive' as const,
              },
            ],
            summary: 'emergency-regex-fallback',
            confidenceExplanation: 'Low confidence — recovered via last-resort regex.',
          },
        };
        log.info(`🚨 OTP recovered via emergency regex fallback: ${sanitizedCode}`);
        break;
      }
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
    otp: otp ? `${otp.code}(${(otp.confidence * 100).toFixed(0)}%)` : '—',
    link: link ? `${link.type}(${(link.confidence * 100).toFixed(0)}%)` : '—',
    crossValidation: crossResult.reason,
  });

  return {
    intent: intentResult.intent,
    otp,
    link,
    debugInfo: {
      provider: provider?.name || null,
      intentSignals: intentResult.signals.map(
        (s: IntentSignal) => `${s.type}:${s.source}(w=${s.weight})`
      ),
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
    best: result.otp ? { code: result.otp.code, confidence: result.otp.confidence } : null,
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
