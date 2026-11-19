import { createLogger } from '../utils/logger';
import {
  sanitizeEmailBody,
  sanitizeEmailSubject,
  sanitizeEmailFrom,
  sanitizeOTP,
} from '../utils/sanitization.core';
import {
  pickBestActivationLink,
  scoreActivationLink,
  SELECT_MIN_QUALITY,
} from './extraction/activationLinkGuard';
import { extractLinkCognitive } from './extraction/cognitiveLinkExtractor';
import { extractOTPCognitive } from './extraction/cognitiveOtpExtractor';
import { normalizeForExtraction } from './extraction/domEngine';
import { compileEmailDocument } from './extraction/emailDocument';
import { extractExplicitVerificationCode, isSubjectDomainToken } from './extraction/explicitCode';
import { runGhostNet } from './extraction/ghostNet';
import { GHOSTNET_WEIGHTS } from './extraction/ghostNetWeights';
import { extractLink, getAnchorInfo } from './extraction/linkExtractor';
import {
  extractOTP,
  isCodeEmbeddedInEmail,
  hasIsolatedOtpContext,
} from './extraction/otpExtractor';
import { detectProvider } from './extraction/providerDetector';
import { extractUrls, unwrapEspTrackingUrl } from './extraction/urlExtractor';
import { analyzeEmailZones, stripHtmlPreserveStructure } from './extraction/zoneAnalyzer';
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
  LinkType,
  PageVerificationExpectation,
} from './types/extraction.types';
import { stripQuotedHistory, hasFreshCodeSignal } from './utils/extraction.utils';

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
  /activate(?: your| my| the)?(?:\s+[\w.-]+)?\s+account/i,
  /active(?: your| my| the)?(?:\s+[\w.-]+)?\s+(?:mail|email|account)/i,
  /activation link/i,
  /validate(?: your| my| the)?(?:\s+[\w.-]+)?\s+email(?: address)?/i,
  /verify(?: your| my| the)?(?:\s+[\w.-]+)?\s+email(?: address)?/i,
  /email verification/i,
  /confirm(?: your| my| the)?(?:\s+[\w.-]+)?\s+email(?: address)?/i,
  /confirm(?: your| my| the)?(?:\s+[\w.-]+)?\s+account/i,
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

const ANTI_SCAM_NEGATION_RE =
  /\b(?:never\s+(?:phone|call|ask|share|enter|type)|do\s+not\s+(?:enter|share|type)|don't\s+(?:enter|share|type)|hang\s+up|impersonat\w*|scam\w*|retired\s+\d+[- ]?digit|only\s+as\s+an\s+example|example\s+numbers?)\b/i;

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
  provider: ProviderKnowledge | null,
  hasIndependentOTP: boolean
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

  // Extraction retains both alternatives; page routing chooses one action.
  result.preferOTP = true;
  result.preferLink = true;

  if (link && otp && link.url.toLowerCase().includes(otp.code.toLowerCase())) {
    result.otpInLinkUrl = true;
    result.linkContainsOTP = true;
    result.reason = hasIndependentOTP ? 'independent-otp-also-in-link' : 'otp-is-url-token';
    result.preferOTP = hasIndependentOTP;
    log.info(
      hasIndependentOTP
        ? 'Code appears in the visible message and link; keeping both alternatives'
        : 'Code appears only in the link URL; keeping the link'
    );
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
 *
 * SECURITY (2026-11-12): this used to be a stub that returned a perfect
 * score ("bypass all security checks"), so every phishing signal the
 * extractor can see was discarded before the decision engine ran. The score
 * is now derived from the links the message actually carries (same signals
 * the decision engine re-checks) plus a few conservative body markers.
 *
 * A benign HTTPS link on an ordinary domain still scores 100 / "low", so the
 * normal verification flow is unaffected.
 */

/** Cheap-to-evaluate hosts that are never a legitimate verification target. */
const SECURITY_SUSPICIOUS_TLDS = new Set(['tk', 'ml', 'ga', 'cf', 'gq', 'buzz', 'top', 'xyz']);

/**
 * Body markers that only appear in credential/account-takeover phishing.
 * Deliberately narrow: a normal verification mail never asks the reader to
 * re-enter a password or threatens to delete the account.
 */
const SECURITY_BODY_MARKERS: RegExp[] = [
  /(?:confirm|verify|re-?enter|update)\s+(?:your\s+)?(?:password|passcode|credentials?|credit\s+card|bank\s+(?:details|account))/i,
  /your\s+(?:account|access)\s+(?:has\s+been|was|will\s+be)\s+(?:suspended|locked|deactivated|disabled|terminated|closed|deleted)/i,
  /(?:unusual|suspicious|unrecogni[sz]ed)\s+activity\s+(?:was\s+|has\s+been\s+)?(?:detected|noticed)/i,
  /failure\s+to\s+(?:comply|verify|confirm)\s+(?:within|by)/i,
  /(?:verify|confirm|update)\s+(?:your\s+)?account\s+(?:immediately|right\s+away)\s+to\s+avoid/i,
  /(?:password|account)\s+(?:will\s+be|is)\s+(?:expire[d]?|deleted|closed)\s+(?:in|within)\s+\d+\s*(?:hours?|days?)/i,
];

function securityUrlPoints(rawUrl: string): number {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return 40; // Malformed destination
  }

  let points = 0;
  const host = parsed.hostname.toLowerCase();
  const labels = host.split('.');

  if (parsed.protocol !== 'https:') {
    points += parsed.protocol === 'http:' ? 18 : 45;
  }
  if (parsed.username || parsed.password) {
    points += 45;
  }
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host.endsWith('.localhost')
  ) {
    points += 60;
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    points += 45;
  }
  if (labels.some((label) => label.startsWith('xn--'))) {
    points += 45;
  }
  const tld = labels[labels.length - 1] ?? '';
  if (SECURITY_SUSPICIOUS_TLDS.has(tld)) {
    points += 25;
  }
  if (labels.length > 6) {
    points += 10;
  }

  return points;
}

function calculateSecurityScore(
  allUrls: string[],
  body: string
): { score: number; risk: 'low' | 'medium' | 'high' } {
  let points = 0;

  const urls = (allUrls ?? []).filter((url) => typeof url === 'string' && url.length > 0);
  for (const url of urls) {
    points += securityUrlPoints(url);
  }
  if (urls.length > 10) {
    points += 15;
  }

  const text = (body ?? '').slice(0, 8000);
  let markerPoints = 0;
  for (const marker of SECURITY_BODY_MARKERS) {
    if (marker.test(text)) {
      markerPoints += 15;
    }
  }
  points += Math.min(markerPoints, 30);

  const score = Math.max(0, Math.min(100, 100 - points));
  const risk: 'low' | 'medium' | 'high' = points >= 60 ? 'high' : points >= 30 ? 'medium' : 'low';

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
    /validate.*email/i.test(subject) ||
    /confirm.*account/i.test(subject) ||
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

  return { intent: currentIntent, confidence: 0.5, signals: [], scores: {}, secondaryIntent: null };
}

function mapGateClsToLinkType(cls: string): LinkType {
  switch (cls) {
    case 'magic-login':
      return 'magic-link';
    case 'password-reset':
      return 'password-reset';
    case 'invite':
      return 'invite-acceptance';
    case 'activation':
      return 'email-verification';
    default:
      return 'unknown-verification';
  }
}

/**
 * Checks if a numeric code appears standalone in the email body (not as part of
 * an email address). This handles the case where the OTP is the same as the
 * numeric part of a disposable email address (e.g. OTP 2952 sent to
 * jesse.duncan.2952@catchmail.io).
 */
function appearsAsStandaloneCode(code: string, plainText: string, sanitizedBody: string): boolean {
  const escaped = code
    .replace(/[-\s]/g, '')
    .split('')
    .map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[-\\s]?');
  const regex = new RegExp(`(?:^|[\\s>])(${escaped})(?=$|[\\s<,;!?.])`, 'gim');

  const checkText = (text: string): boolean => {
    if (!text) {
      return false;
    }
    // URL parameters and HTML attributes are not independent code evidence.
    const visibleText = text
      .replace(/<[^>]*>/g, ' ')
      .replace(/(?:https?:\/\/|www\.)[^\s<>"']+/gi, ' ');
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(visibleText)) !== null) {
      const afterMatch = visibleText[match.index + match[0].length] || '';
      if (
        afterMatch !== '@' &&
        !visibleText.substring(match.index, match.index + match[0].length + 1).includes('@')
      ) {
        return true;
      }
    }
    return false;
  };

  return checkText(plainText) || checkText(sanitizedBody);
}

// GRANDMASTER FIX: Hoisted to module scope. Zero allocation overhead during execution.
const EMERGENCY_PATTERNS = [
  /(?:code|pin|otp|token|passcode|código|clave|kennwort|sécurité|vérification|कोड|ओटीपी|コード|認証|验证码|密码|인증|senha|kod|şifre|رمز|كود)\s*(?:is|:|:?\s*ist|:?\s*est|:?\s*है|:?\s*です|:?\s*为|:?\s*是|:?\s*equals?|=)\s*\b([A-Z0-9]{4,10})\b/i,
  /(?:confirmation|verification|security|login|access|verificación|sécurité|authentication)\s+(?:code|pin|otp|código|clave|passcode|رمز|كود)\s*:?\s*\b([A-Z0-9]{4,10})\b/i,
  /(?:your|su|ihr|votre|आपका|あなたの|您的|귀하의|seu|senin)\s+(?:\w+\s+)?(?:code|pin|otp|código|clave|kennwort|passcode|رمز|كود)\s*(?:is|:|:?\s*ist|:?\s*est|:?\s*है|:?\s*です|:?\s*为|:?\s*是|=)\s*\b([A-Z0-9]{4,10})\b/i,
  /\b([A-Z0-9]{4,10})\s+(?:is|ist|est|है|です|为|是)\s+(?:your|su|ihr|votre|आपका|あなたの|您的|귀하의|seu|senin)\s+(?:\w+\s+)?(?:code|pin|otp|código|clave|passcode|رمز|كود)/i,
] as const;

export function extractAll(
  subject: string,
  body: string,
  htmlBody: string = '',
  senderEmail: string = '',
  expectedDomains: string[] = [],
  pageExpectation?: PageVerificationExpectation
): ExtractionResult {
  const startTime = performance.now();
  const timings: Record<string, number> = {};

  const normSubject = normalizeForExtraction(subject);
  const normBody = normalizeForExtraction(body);
  const normHtmlBody = normalizeForExtraction(htmlBody);

  // GRANDMASTER FIX: Unified Sanitization. Eliminate redundant CPU cycles.
  const sanitizedSubject = sanitizeEmailSubject(normSubject);

  let sanitizedHtmlBody = '';
  let sanitizedBody = '';

  if (normHtmlBody) {
    // Sanitize HTML ONCE.
    sanitizedHtmlBody = sanitizeEmailBody(normHtmlBody, normHtmlBody);
    // If your sanitizer requires the raw plain text as a fallback reference, pass it.
    // But do NOT re-run the HTML parser.
    sanitizedBody = sanitizeEmailBody('', normBody);
  } else {
    sanitizedBody = sanitizeEmailBody('', normBody);
  }

  const sanitizedSenderEmail = sanitizeEmailFrom(senderEmail);

  const sourceHtml = normHtmlBody || normBody; // Use normalized html to extract URLs
  const htmlText = sanitizedHtmlBody ? stripHtmlPreserveStructure(sanitizedHtmlBody) : '';
  // B5 fix (2026-11-12): the previous template embedded body AND html
  // text simultaneously when both existed, so every code/subject token
  // was counted twice — a 49% code jumped to 100% purely from
  // duplication. Build the extraction text from ONE source: the plain
  // body when present, otherwise the HTML-stripped text.
  //
  // B2 fix: quoted reply/forward history is stripped before extraction
  // so a stale code in the quoted part cannot outrank (or be re-counted
  // against) the fresh code. The stripped text is only trusted when the
  // fresh part still carries a code of its own — otherwise stripping
  // would delete the ONLY code in the message.
  const strippedBody = stripQuotedHistory(sanitizedBody);
  const strippedHtmlText = htmlText ? stripQuotedHistory(htmlText) : '';
  const freshHasCode = hasFreshCodeSignal(strippedBody) || hasFreshCodeSignal(strippedHtmlText);
  const effectiveBody = freshHasCode ? strippedBody : sanitizedBody;
  const effectiveHtmlText = freshHasCode ? strippedHtmlText : htmlText;
  const preferHtmlBody = Boolean(
    effectiveHtmlText &&
    (!effectiveBody ||
      (!/\d/.test(effectiveBody) && effectiveHtmlText.length > effectiveBody.length * 2))
  );
  const bodyText = preferHtmlBody ? effectiveHtmlText : effectiveBody;
  const plainText = `${sanitizedSubject}\n\n${bodyText}`;
  const explicitBodyCode =
    extractExplicitVerificationCode(effectiveBody) ||
    extractExplicitVerificationCode(effectiveHtmlText);

  log.info('═══ GhostFill Intelligent Extractor ═══');

  let t = performance.now();
  const zones: EmailZone[] = analyzeEmailZones(sanitizedHtmlBody, plainText);
  timings.zones = performance.now() - t;

  t = performance.now();
  const allUrls = extractUrls(`${sourceHtml}\n${normBody}`);
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
  const compiledDoc = compileEmailDocument(
    sanitizedSubject,
    normBody,
    normHtmlBody,
    sanitizedSenderEmail,
    expectedDomains
  );
  const ghostActive = GHOSTNET_WEIGHTS.trainedSamples >= 1000;
  const ghostRes = runGhostNet(compiledDoc, {
    ...(provider?.otpLength !== undefined ? { providerOtpLength: provider.otpLength } : {}),
    securityScore: security.score,
    securityRisk: security.risk,
    expectedDomains,
    ...(pageExpectation !== undefined ? { pageExpectation } : {}),
  });

  const intentResult = refineIntent(sanitizedSubject, bodyText, provider?.emailIntent || 'other');
  const hasAntiScamNegation = ANTI_SCAM_NEGATION_RE.test(bodyText);

  if (ghostActive) {
    const sortedIntents = Object.entries(ghostRes.intentProbs).sort((a, b) => b[1] - a[1]);
    const topNeural = sortedIntents[0]?.[0] as EmailIntent | undefined;
    const secondNeural = sortedIntents[1];
    const heuristicStrong = intentResult.signals.length > 0 && intentResult.confidence >= 0.88;
    if (!heuristicStrong && topNeural && ghostRes.intentConfidence >= 0.55) {
      intentResult.intent = topNeural;
      intentResult.confidence = ghostRes.intentConfidence;
      intentResult.signals.push({
        type: 'ml',
        source: 'ghostnet',
        detail: `ghostnet-${topNeural}`,
        weight: ghostRes.intentConfidence,
      });
    } else if (
      topNeural &&
      (topNeural === 'marketing' || topNeural === 'transactional') &&
      ghostRes.intentConfidence >= 0.78 &&
      ghostRes.action === 'ignore' &&
      ghostRes.actionConfidence >= 0.78 &&
      (!heuristicStrong || hasAntiScamNegation)
    ) {
      intentResult.intent = topNeural;
      intentResult.confidence = ghostRes.intentConfidence;
    }
    intentResult.scores = { ...ghostRes.intentProbs, ...intentResult.scores };
    if (
      secondNeural &&
      secondNeural[1] >= 0.22 &&
      secondNeural[0] !== intentResult.intent &&
      !intentResult.secondaryIntent
    ) {
      intentResult.secondaryIntent = secondNeural[0] as EmailIntent;
    }
  }
  timings.security = performance.now() - t;

  t = performance.now();
  // Dual engines for accuracy (cognitive + traditional). Prefer consensus.
  const cogOtp = extractOTPCognitive(
    plainText,
    sanitizedHtmlBody,
    provider,
    zones,
    intentResult,
    sanitizedSubject
  );
  const tradOtp = extractOTP(plainText, sanitizedHtmlBody, provider, zones, intentResult);

  if (cogOtp) {
    cogOtp.code = sanitizeOTP(cogOtp.code);
  }
  if (tradOtp) {
    tradOtp.code = sanitizeOTP(tradOtp.code);
  }

  let otp: typeof cogOtp = null;

  if (cogOtp && tradOtp) {
    if (cogOtp.code === tradOtp.code) {
      // 🤝 Consensus: both engines agreed on the same code — max confidence
      otp = cogOtp;
      otp.score = Math.min(100, Math.max(cogOtp.score, tradOtp.score) + 35);
      otp.confidence = otp.score / 100;
      otp.reasoning.steps.push({
        layer: 'consensus',
        observation:
          'Dual engines (Cognitive & Traditional Heuristics) reached agreement consensus on the code.',
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
  // SECURITY GATE: reject numbers that are ONLY segments of an email address / user
  // handle (e.g. the "5561" in mark.kennedy.5561@mail.com) AND never appear standalone.
  // FIX: Don't reject if the code also appears standalone in the body — it may be both
  // part of the disposable email address AND the real OTP (e.g. Qwen emails to
  // jesse.duncan.2952@catchmail.io with OTP 2952).
  if (otp && /^\d{2,12}$/.test(otp.code)) {
    const embedded =
      isCodeEmbeddedInEmail(otp.code, plainText) || isCodeEmbeddedInEmail(otp.code, sanitizedBody);
    const hasIsolatedContext = hasIsolatedOtpContext(otp.code, plainText);
    const appearsStandalone = appearsAsStandaloneCode(otp.code, plainText, sanitizedBody);
    if (embedded && !hasIsolatedContext && !appearsStandalone) {
      log.info(
        `OTP rejected: '${otp.code}' is embedded in an email address, not a real verification code`
      );
      otp = null;
    }
  }

  if (
    otp &&
    sanitizedSubject.includes(otp.code) &&
    !otp.matchedSignals?.some((s) => s.name === 'subject-body-agreement')
  ) {
    otp.score = Math.min(100, otp.score + 35);
    otp.confidence = otp.score / 100;
  }
  if (otp && isSubjectDomainToken(otp.code, sanitizedSubject)) {
    otp = null;
  }
  // An explicitly labeled code in the message body outranks a brand token
  // from the subject (for example LLM7.io versus "Your verification code is: 382804"),
  // unless GhostNet strongly resolves temporal superseding / negation in favor of another visible code.
  const ghostOtpCode =
    ghostActive && ghostRes.bestOtp ? sanitizeOTP(ghostRes.bestOtp.candidate.code) : null;
  const ghostSupersedesExplicit = Boolean(
    ghostActive &&
    ghostRes.bestOtp &&
    ghostOtpCode &&
    explicitBodyCode &&
    ghostOtpCode !== explicitBodyCode &&
    ghostRes.bestOtp.probability >= 0.75 &&
    !ghostRes.bestOtp.candidate.fromQuotedRegion &&
    !ghostRes.bestOtp.candidate.embeddedInEmailHandle
  );
  const ghostSuppressesAllOtps = Boolean(
    ghostActive &&
    ghostRes.action === 'ignore' &&
    ghostRes.actionConfidence >= 0.85 &&
    ghostRes.nullOtpProb >= 0.78 &&
    (!explicitBodyCode || hasAntiScamNegation)
  );

  if (
    explicitBodyCode &&
    otp?.code !== explicitBodyCode &&
    !ghostSupersedesExplicit &&
    !ghostSuppressesAllOtps
  ) {
    otp = {
      code: explicitBodyCode,
      rawCode: explicitBodyCode,
      score: 94,
      confidence: 0.94,
      type: 'otp',
      format: /^\d+$/.test(explicitBodyCode) ? 'numeric' : 'alphanumeric',
      strategy: 'explicit-label',
      length: explicitBodyCode.length,
      context: 'Explicit verification code label in the email body',
      label: 'Verification code',
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
            layer: 'explicit-label',
            observation: 'The email body labels this number as a verification code.',
            conclusion: 'Prefer the labeled body code over an unrelated subject token.',
            impact: 'strong-positive',
          },
        ],
        summary: 'explicit-body-code',
        confidenceExplanation: 'The message directly identifies this numeric code.',
      },
    };
  }

  if (ghostActive && ghostRes.bestOtp && ghostOtpCode && !ghostSuppressesAllOtps) {
    const gnProb = ghostRes.bestOtp.probability;
    const cand = ghostRes.bestOtp.candidate;
    const isUnsafeHandleOnly = cand.embeddedInEmailHandle && !cand.inVisibleBodyOutsideUrls;
    const isDomBrandToken = isSubjectDomainToken(ghostOtpCode, sanitizedSubject);
    if (!isUnsafeHandleOnly && !isDomBrandToken) {
      if (otp && otp.code === ghostOtpCode) {
        otp.score = Math.min(100, Math.max(otp.score, Math.round(58 + gnProb * 40)));
        otp.confidence = otp.score / 100;
      } else if ((!otp && gnProb >= 0.55) || (gnProb >= 0.75 && !cand.fromQuotedRegion)) {
        const gnScore = Math.min(98, Math.round(56 + gnProb * 42));
        otp = {
          code: ghostOtpCode,
          rawCode: cand.rawCode,
          score: gnScore,
          confidence: gnScore / 100,
          type: 'otp',
          format: cand.format,
          strategy: 'proximity-inference',
          length: ghostOtpCode.length,
          context: cand.tightBlockText || cand.rowText,
          label: null,
          fromUrl: cand.insideUrlOnly,
          urlParam: null,
          sourceUrl: null,
          visualProminence: cand.domProminence.fontSizePx,
          providerMatch: provider
            ? {
                name: provider.name,
                expectedLength: provider.otpLength ?? ghostOtpCode.length,
                expectedFormat: provider.otpFormat ?? 'numeric',
                confidence: providerConfidence,
              }
            : null,
          matchedSignals: [],
          antiSignals: [],
          reasoning: {
            steps: [
              {
                layer: 'ghostnet-pointer',
                observation: `GhostNet sequence pointer selected '${ghostOtpCode}' (p=${gnProb.toFixed(2)}).`,
                conclusion: 'Selected active verification token in discourse context.',
                impact: 'strong-positive',
              },
            ],
            summary: 'ghostnet-span-pointer',
            confidenceExplanation: 'Selected by GhostNet contextual span pointer.',
          },
        };
      }
    }
  }

  timings.otp = performance.now() - t;

  t = performance.now();
  // Both engines must pass the shared activation gate before a link is surfaced.
  const cogLink = extractLinkCognitive(
    sanitizedHtmlBody,
    plainText,
    intentResult,
    provider,
    zones,
    allUrls,
    expectedDomains
  );
  const tradLink = extractLink(
    sourceHtml,
    sanitizedSubject,
    sanitizedBody,
    intentResult,
    provider,
    zones,
    allUrls,
    expectedDomains
  );

  let link = pickBestActivationLink(cogLink, tradLink);
  if (ghostActive && !link && ghostRes.bestLink && ghostRes.bestLink.probability >= 0.55) {
    const gl = ghostRes.bestLink.candidate;
    const glGate = scoreActivationLink(gl.url, gl.anchorText || '', gl.surroundingText || '');
    if (!glGate.hardReject && glGate.cls !== 'unknown' && glGate.quality >= SELECT_MIN_QUALITY) {
      const conf = Math.min(0.98, Math.max(ghostRes.bestLink.probability, glGate.quality / 100));
      link = {
        url: gl.url,
        score: Math.round(conf * 100),
        confidence: conf,
        type: mapGateClsToLinkType(glGate.cls),
        hasEmbeddedCode: Boolean(otp && gl.url.toLowerCase().includes(otp.code.toLowerCase())),
        embeddedCode: null,
        embeddedCodeParam: null,
        anchorText: gl.anchorText,
        context: gl.surroundingText,
        domainTrust: gl.hostMatchesExpected ? 90 : gl.hostMatchesSender ? 75 : 50,
        originBound: gl.hostMatchesExpected,
        isShortened: false,
        redirectChain: [],
      };
    }
  }
  const credible = [...new Set(allUrls.map((url) => unwrapEspTrackingUrl(url) || url))]
    .map((url) => ({
      url,
      gate: scoreActivationLink(url, getAnchorInfo(sourceHtml, url).anchorText),
    }))
    .filter(
      ({ gate }) => !gate.hardReject && gate.cls !== 'unknown' && gate.quality >= SELECT_MIN_QUALITY
    )
    .sort((a, b) => b.gate.quality - a.gate.quality);
  // Two equally credible, distinct actions are ambiguous: ask for review.
  if (
    (ghostActive && ghostRes.ambiguousDualLinks) ||
    (credible.length > 1 &&
      credible[0]!.gate.quality >= 80 &&
      credible[1]!.gate.quality >= credible[0]!.gate.quality - 8)
  ) {
    link = null;
  }
  if (
    ghostActive &&
    link &&
    (ghostRes.intent === 'marketing' || ghostRes.intent === 'transactional') &&
    ghostRes.nullLinkProb >= 0.72 &&
    scoreActivationLink(link.url, link.anchorText || '').cls === 'unknown'
  ) {
    link = null;
  }
  if (link && link.url) {
    link.url = new URL(link.url).href;
    // Both link engines report percentage confidence; the shared result uses 0–1.
    if (link.confidence > 1) {
      link.confidence /= 100;
    }
    const gate = scoreActivationLink(link.url, link.anchorText || '', link.context || '');
    if (gate.cls === 'magic-login') {
      link.type = 'magic-link-login';
    }
    if (
      (intentResult.intent === 'marketing' ||
        intentResult.intent === 'transactional' ||
        intentResult.intent === 'other') &&
      gate.quality >= SELECT_MIN_QUALITY &&
      (gate.cls === 'activation' ||
        gate.cls === 'magic-login' ||
        gate.cls === 'invitation' ||
        gate.cls === 'password-reset')
    ) {
      intentResult.intent =
        gate.cls === 'magic-login' ? 'magic-link-login' : gate.cls;
    }
    if (cogLink?.url && tradLink?.url && cogLink.url !== tradLink.url) {
      log.info(
        `Link dual-engine: cog=${cogLink.url.substring(0, 50)} trad=${tradLink.url.substring(0, 50)} → ${link.url.substring(0, 50)}`
      );
    }
  }
  timings.link = performance.now() - t;

  t = performance.now();
  const hasOtpRegexSignal =
    (intentResult.intent === 'verification' || intentResult.secondaryIntent === 'verification') &&
    intentResult.signals.some((s) => s.type === 'regex');
  const hasDualEngineAuthConsensus = Boolean(
    cogOtp && tradOtp && cogOtp.code === tradOtp.code && (hasOtpRegexSignal || Boolean(link))
  );
  if (
    ghostActive &&
    otp &&
    ghostRes.action !== 'fill-otp' &&
    ghostRes.action !== 'fill-otp-and-open-link' &&
    (hasAntiScamNegation || (!explicitBodyCode && !hasDualEngineAuthConsensus)) &&
    ((ghostRes.action === 'ignore' && ghostRes.actionConfidence >= 0.75) ||
      (ghostRes.nullOtpProb >= 0.75 && !explicitBodyCode)) &&
    !otp.matchedSignals?.some((s) => s.name === 'subject-body-agreement')
  ) {
    otp = null;
  }
  if (
    ghostActive &&
    !otp &&
    !link &&
    ghostRes.action === 'ignore' &&
    ghostRes.actionConfidence >= 0.78 &&
    (intentResult.signals.every((s) => s.type === 'ml') || !hasOtpRegexSignal)
  ) {
    intentResult.intent =
      (ghostRes.intentProbs.marketing ?? 0) >= (ghostRes.intentProbs.transactional ?? 0)
        ? 'marketing'
        : 'transactional';
  }
  // A strong link must not turn a weak footer number into a second sign-in action.
  if (otp && link && otp.confidence < 0.7 && !explicitBodyCode) {
    log.info('Discarding weak code candidate from a verification-link email');
    otp = null;
  }
  const hasIndependentOTP = Boolean(
    otp && appearsAsStandaloneCode(otp.code, sanitizedBody, htmlText)
  );
  const crossResult = crossValidate(otp, link, intentResult, provider, hasIndependentOTP);
  timings.crossValidation = performance.now() - t;

  if (crossResult.otpAndLinkCoexist) {
    if (crossResult.preferOTP && !crossResult.preferLink) {
      log.info('Cross-validation prefers OTP; retaining the detected link for activation');
    } else if (crossResult.preferLink && !crossResult.preferOTP && !explicitBodyCode) {
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

  // H6: Emergency fallback — if both OTP and link are null, try emergency regex patterns
  // (skipped when GhostNet classifies email as safe non-auth 'ignore')
  if (!otp && !link && !ghostSuppressesAllOtps) {
    // GRANDMASTER FIX: Moved EMERGENCY_PATTERNS to module scope. Zero allocation overhead here.
    // Strip zero-width characters and RTL/LTR marks
    const textToSearch = `${subject} ${body}`
      .replace(/[\u200B-\u200D\uFEFF\u200E\u200F]/g, '')
      .substring(0, 5000);

    const currentYear = new Date().getFullYear();

    for (const pattern of EMERGENCY_PATTERNS) {
      const match = textToSearch.match(pattern);
      if (match?.[1]) {
        const code = match[1].replace(/[-\s]/g, '');
        const numVal = parseInt(code, 10);
        const isYear = /^\d{4}$/.test(code) && numVal >= 1970 && numVal <= currentYear + 2;
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
          format: (/^\d+$/.test(sanitizedCode) ? 'numeric' : 'alphanumeric') as
            | 'numeric'
            | 'alphanumeric',
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
      ghostNet: {
        modelVersion: GHOSTNET_WEIGHTS.version,
        intent: ghostRes.intent,
        intentConfidence: ghostRes.intentConfidence,
        intentProbs: { ...ghostRes.intentProbs },
        nullOtpProb: ghostRes.nullOtpProb,
        nullLinkProb: ghostRes.nullLinkProb,
        action: ghostRes.action,
        actionConfidence: ghostRes.actionConfidence,
        actionProbs: { ...ghostRes.actionProbs },
        inferenceMs: ghostRes.inferenceMs,
      },
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
