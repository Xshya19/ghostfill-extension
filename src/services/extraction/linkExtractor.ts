// src/services/extraction/linkExtractor.ts
// ═══════════════════════════════════════════════════════════════════════
//  LINK EXTRACTION ENGINE
//  Multi-signal verification link extraction and scoring
// ═══════════════════════════════════════════════════════════════════════

import { createLogger } from '../../utils/logger';
import { KnowledgeBase } from '../knowledgeBase';

import type {
  ProviderKnowledge,
  EmailZone,
  LinkCandidate,
  EmailIntent,
  IntentResult,
  ExtractedLink,
} from '../types/extraction.types';
import {
  normalizeUrl,
  analyzeUrlParams,
  calculateUrlComplexity,
  unwrapTrackingUrl,
} from './urlExtractor';
import {
  decodeHtmlEntities,
  stripHtml,
  stripHtmlPreserveStructure,
  getZoneForPosition,
  getContextAround,
} from './zoneAnalyzer'; // eslint-disable-line @typescript-eslint/no-unused-vars

const log = createLogger('LinkExtractor');

// ═══════════════════════════════════════════════════════════════════════
//  CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════

const CONFIG = {
  scoring: {
    linkCtaBonus: 20,
    linkAnchorKeyword: 15,
    linkParamToken: 15, // was 12 — auth tokens are strong signal
    linkParamCode: 10, // was 8
    linkParamSignature: 10, // was 8
    linkParamExpiry: 6, // was 5
    linkLongToken: 8, // was 5 — long tokens are very reliable signal
    linkContextBonusMax: 20, // was 15
    linkComplexityBonus: 8,
    linkDomainTrustMax: 12, // was 10
    oauthFlowBonus: 20, // new: oauth/sso/flow patterns
    authParamBonus: 18, // new: auth= param in url
    longPathTokenBonus: 12, // new: long hex/uuid in path
  },
} as const;

const ACTIVATION_URL_KEYWORD =
  /verify|verification|activate|activation|confirm|confirmation|registration|signup|sign[-_]?up|email[-_]?verify|verify[-_]?email|confirm[-_]?email|magic(?:[-_]?link)?|passwordless|signin[-_]?link|sign[-_]?in|login[-_]?link|accept[-_]?invite|invitation|invite|join|onboard|welcome|complete|finish|authorize|authorise|approve|authenticate|device/i;

const PASSWORD_RESET_URL_KEYWORD = /reset|recover|password|forgot|change[-_]?password/i;

const ACTIVATION_ANCHOR_KEYWORD =
  /\b(?:verify|confirm|activate|active|complete|finish|get started|click here|tap here|continue|proceed|open|access|launch|start using|sign in|log in|login|magic link|secure link|passwordless|accept invite|accept invitation|join workspace|join team|join organization|join organisation|join|authorize|authorise|approve|authenticate|trust this device|confirm account|confirm email|verify email|verify account|activate account|active mail|active email|active account)\b/i;

const PASSWORD_RESET_ANCHOR_KEYWORD =
  /\b(?:reset|change|recover|restore|set(?: up)?(?: a)? new password|forgot password)\b/i;

const ACTIVATION_CONTEXT_KEYWORDS = [
  'verify',
  'confirm',
  'activate',
  'activation',
  'active your mail',
  'active your email',
  'active account',
  'click here',
  'click the button',
  'click the link',
  'tap here',
  'tap the button',
  'get started',
  'complete registration',
  'complete signup',
  'finish setup',
  'finish signing up',
  'confirm email',
  'confirm your email',
  'verify email',
  'verify your email',
  'confirm account',
  'verify account',
  'activate account',
  'sign in',
  'sign in securely',
  'log in',
  'login',
  'magic link',
  'passwordless',
  'open link',
  'secure link',
  'access account',
  'continue',
  'proceed',
  'launch',
  'start using',
  'accept invite',
  'accept invitation',
  'join workspace',
  'join team',
  'join organization',
  'join organisation',
  'authorize',
  'authorise',
  'approve',
  'authenticate',
  'trust this device',
  'email verified',
  'account verification',
  'please click',
  'follow this link',
  'use this link',
] as const;

function isActivationIntent(intent: EmailIntent): boolean {
  return [
    'activation',
    'magic-link',
    'magic-link-login',
    'invitation',
    'device-confirmation',
    'account-update',
  ].includes(intent);
}

function isGenericTokenPattern(patternName: string | null): boolean {
  return Boolean(
    patternName &&
    ['token-param', 'code-param', 'action-verify-param', 'url-oauth-flow'].includes(patternName)
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  URL FILTER PATTERNS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Patterns for URLs that should be excluded from extraction
 * These are typically non-action links like unsubscribe, social media, etc.
 */
const NON_TARGET_URL_PATTERNS = [
  /unsubscribe/i,
  /opt[-_]?out/i,
  /email[-_]?(?:preferences|settings)/i,
  /privacy[-_]?(?:policy|notice|statement)/i,
  /terms[-_]?(?:of|and)[-_]?(?:service|use|conditions)/i,
  /legal/i,
  /(?:facebook|twitter|x|linkedin|pinterest)\.com\/(?:share|sharer|intent|company|in\/|profile|pub|posts?)(?:\/|\?|$)/i,
  /(?:youtube|tiktok|instagram)\.com\/(?:channel|user|watch|reel|p|shorts|@)(?:\/|\?|$)/i,
  /play\.google\.com/i,
  /apps\.apple\.com/i,
  /itunes\.apple\.com/i,
  /help\.[a-z0-9.-]+\.com/i,
  /support\.[a-z0-9.-]+\.com/i,
  /blog\.[a-z0-9.-]+\.com/i,
  /cdn\./i,
  /static\./i,
  /images?\./i,
  /img\./i,
  /assets?\./i,
  /fonts?\./i,
  /beacon/i,
  /pixel/i,
  /tracking/i,
  /analytics/i,
  /open\.[a-z0-9.-]+\.com.*\/o\//i,
  /view[-_]?(?:in|this)[-_]?(?:browser|email)/i,
  /web[-_]?version/i,
  /contact[-_]?us/i,
  /about[-_]?us/i,
  /faq/i,
  /list-manage\.com/i,
  /social[-_]?media/i,
] as const;

// ═══════════════════════════════════════════════════════════════════════
//  CTA DETECTION
// ═══════════════════════════════════════════════════════════════════════

/**
 * Determines if an anchor element is a CTA button
 * @param anchorHtml - The HTML of the anchor element
 * @returns True if it's a CTA button
 */
export function isCTAButton(anchorHtml: string): boolean {
  const l = anchorHtml.toLowerCase();
  if (/\brole\s*=\s*["']button["']/i.test(l)) {
    return true;
  }
  if (/class\s*=\s*["'][^"']*(?:btn|button|cta|action|primary)[^"']*["']/i.test(l)) {
    return true;
  }
  if (
    /\bdata-(?:testid|qa|role|cy)\s*=\s*["'][^"']*(?:button|cta|confirm|verify|activate|invite)[^"']*["']/i.test(
      l
    )
  ) {
    return true;
  }
  if (/style\s*=\s*["'][^"']*background(?:-color)?\s*:/i.test(l) && /padding/i.test(l)) {
    return true;
  }
  if (/bgcolor\s*=/i.test(l)) {
    return true;
  }
  if (/display\s*:\s*(?:inline-)?block/i.test(l) && /text-align\s*:\s*center/i.test(l)) {
    return true;
  }
  if (/border-radius/i.test(l) && /padding/i.test(l)) {
    return true;
  }
  return false;
}

function extractAnchorHref(anchorHtml: string): string {
  const quoted = anchorHtml.match(/\bhref\s*=\s*["']([^"']+)["']/i);
  if (quoted?.[1]) {
    return decodeHtmlEntities(quoted[1].trim());
  }

  const unquoted = anchorHtml.match(/\bhref\s*=\s*([^\s>]+)/i);
  return decodeHtmlEntities(unquoted?.[1]?.trim() ?? '');
}

function urlsReferToSameTarget(anchorHref: string, targetUrl: string): boolean {
  if (!anchorHref || !targetUrl) {
    return false;
  }

  const variants = new Set<string>();
  const addVariant = (value: string | null | undefined) => {
    if (!value) {
      return;
    }
    variants.add(value);
    try {
      variants.add(decodeURIComponent(value));
    } catch {
      // Keep the original value only.
    }
    try {
      variants.add(normalizeUrl(value));
    } catch {
      // Invalid or relative URLs are ignored here.
    }
  };

  addVariant(anchorHref);
  addVariant(unwrapTrackingUrl(anchorHref));

  for (const variant of variants) {
    if (variant === targetUrl || variant.includes(targetUrl)) {
      return true;
    }
    try {
      if (normalizeUrl(variant) === normalizeUrl(targetUrl)) {
        return true;
      }
    } catch {
      // Compare best-effort variants only.
    }
  }

  return false;
}

function getReadableAnchorText(anchorInnerHtml: string, anchorHtml: string): string {
  const text = stripHtml(anchorInnerHtml).trim();
  if (text) {
    return text;
  }

  const labelled =
    anchorHtml.match(/\baria-label\s*=\s*["']([^"']+)["']/i)?.[1] ??
    anchorHtml.match(/\btitle\s*=\s*["']([^"']+)["']/i)?.[1] ??
    anchorHtml.match(/\balt\s*=\s*["']([^"']+)["']/i)?.[1] ??
    '';

  return stripHtml(decodeHtmlEntities(labelled)).trim();
}

/**
 * Extracts anchor text and HTML for a given URL
 * @param html - The HTML content
 * @param url - The URL to find anchor for
 * @returns Anchor text, HTML, and CTA status
 */
export function getAnchorInfo(
  html: string,
  url: string
): {
  anchorText: string;
  anchorHtml: string;
  isCTA: boolean;
} {
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Try strict match first
  const strict = html.match(
    new RegExp(`<a[^>]*href\\s*=\\s*["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/a>`, 'i')
  );
  if (strict) {
    return {
      anchorText: getReadableAnchorText(strict[1] ?? '', strict[0]),
      anchorHtml: strict[0],
      isCTA: isCTAButton(strict[0]),
    };
  }

  // Fallback to loose match
  const loose = /<a([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = loose.exec(html)) !== null) {
    const href = extractAnchorHref(m[0]);
    if (m[0].includes(url) || (m[1] ?? '').includes(url) || urlsReferToSameTarget(href, url)) {
      return {
        anchorText: getReadableAnchorText(m[2] ?? '', m[0]),
        anchorHtml: m[0],
        isCTA: isCTAButton(m[0]),
      };
    }
  }

  return { anchorText: '', anchorHtml: '', isCTA: false };
}

// ═══════════════════════════════════════════════════════════════════════
//  DOMAIN TRUST CALCULATION
// ═══════════════════════════════════════════════════════════════════════

/**
 * Calculates trust score for a URL domain
 * @param url - The URL to analyze
 * @param provider - Known provider (optional)
 * @returns Trust score (0-100)
 */
export function calculateDomainTrust(url: string, provider: ProviderKnowledge | null): number {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    let trust = 30;

    if (provider?.domains.some((d: string) => h.includes(d))) {
      trust += 40;
    }
    if (u.protocol === 'https:') {
      trust += 10;
    }
    if (/\.(com|org|net|io|dev|app|co|us|uk|de|fr|ca|au)$/i.test(h)) {
      trust += 5;
    }
    if (/\.(xyz|top|click|link|site|online|live|work|fun|buzz|icu)$/i.test(h)) {
      trust -= 15;
    }
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) {
      trust -= 30;
    }
    if (h.split('.').length > 4) {
      trust -= 10;
    }

    return Math.max(trust, 0);
  } catch {
    return 0;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  MAIN LINK EXTRACTION
// ═══════════════════════════════════════════════════════════════════════

/**
 * Extracts the primary verification/action link from email content
 *
 * Uses multiple signals:
 * - Knowledge base URL patterns
 * - URL keyword analysis
 * - Anchor text/CTA analysis
 * - URL parameter analysis
 * - Intent alignment
 * - Context validation
 * - Domain trust scoring
 *
 * @param html - The email HTML content
 * @param subject - The email subject
 * @param body - The email body text
 * @param intent - Classified email intent
 * @param provider - Detected provider knowledge
 * @param zones - Email zone analysis
 * @param urls - Pre-extracted URLs
 * @returns Extracted link or null if none found
 */
export function extractLink(
  html: string,
  subject: string,
  body: string,
  intent: IntentResult,
  provider: ProviderKnowledge | null,
  zones: EmailZone[],
  urls: string[]
): ExtractedLink | null {
  const plainText = stripHtmlPreserveStructure(html);
  const decoded = decodeHtmlEntities(html);
  const candidates: LinkCandidate[] = [];

  for (const url of urls) {
    // Filter out non-target URLs
    if (NON_TARGET_URL_PATTERNS.some((p: RegExp) => p.test(url))) {
      continue;
    }

    let confidence = 40;
    let detectedType: EmailIntent = 'other';
    let patternName: string | null = null;

    // Strategy 1: Knowledge base patterns
    for (const pat of KnowledgeBase.linkPatterns) {
      pat.pattern.lastIndex = 0;
      if (pat.pattern.test(url)) {
        confidence = pat.baseConfidence;
        detectedType = pat.type;
        patternName = pat.name;
        break;
      }
    }

    // Strategy 2: URL keyword + OAuth/auth-flow detection
    if (!patternName) {
      if (PASSWORD_RESET_URL_KEYWORD.test(url)) {
        confidence = 75;
        detectedType = 'password-reset';
        patternName = 'url-kw-reset';
      } else if (ACTIVATION_URL_KEYWORD.test(url)) {
        confidence = 76;
        detectedType = 'activation';
        patternName = 'url-kw-activation';
      } else {
        // OAuth / SSO / Auth-flow detection
        // Catches: ?auth=...&flow=..., /oauth/..., /sso/..., /auth/..., /login/...
        const oauthFlow = /[?&](?:flow|state|nonce|grant_type|response_type)=/i.test(url);
        const authParam = /[?&](?:auth|token|access_token|id_token|code)=[A-Za-z0-9%._-]{8,}/i.test(
          url
        );
        const authPath =
          /\/(?:auth|oauth|sso|login|signin|sign-in|magic|passwordless|email-login|oidc|saml|callback|authorize|approve|invite|invitation|join)(?:\/|\?|$)/i.test(
            url
          );
        const longPathToken = /\/[A-Za-z0-9_-]{20,}(?:\/|$|\?)/.test(url);
        const uuidInPath =
          /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/|$)/i.test(url);

        if (oauthFlow || authParam || authPath) {
          confidence = 68;
          detectedType = 'activation';
          patternName = 'url-oauth-flow';
          if (oauthFlow && authParam) {
            confidence = 78;
          } // both signals = very strong
        }
        if (longPathToken || uuidInPath) {
          confidence = Math.max(confidence, 65);
          if (detectedType === 'other') {
            detectedType = 'activation';
          }
          patternName = patternName || 'url-long-path-token';
        }
      }
    }

    // Strategy 3: Anchor analysis
    const { anchorText, anchorHtml, isCTA } = getAnchorInfo(decoded, url);
    const anchorLooksActivation = ACTIVATION_ANCHOR_KEYWORD.test(anchorText);
    const anchorLooksReset = PASSWORD_RESET_ANCHOR_KEYWORD.test(anchorText);

    if (isCTA) {
      confidence += CONFIG.scoring.linkCtaBonus;
      if (anchorLooksReset) {
        confidence += CONFIG.scoring.linkAnchorKeyword;
        if (detectedType === 'other' || isGenericTokenPattern(patternName)) {
          detectedType = 'password-reset';
        }
      } else if (anchorLooksActivation) {
        confidence += CONFIG.scoring.linkAnchorKeyword;
        if (
          detectedType === 'other' ||
          detectedType === 'verification' ||
          isGenericTokenPattern(patternName)
        ) {
          detectedType = 'activation';
        }
      }
    } else if (anchorText && (anchorLooksActivation || anchorLooksReset)) {
      confidence += 12;
      if (anchorLooksReset && (detectedType === 'other' || isGenericTokenPattern(patternName))) {
        detectedType = 'password-reset';
      } else if (
        anchorLooksActivation &&
        (detectedType === 'other' ||
          detectedType === 'verification' ||
          isGenericTokenPattern(patternName))
      ) {
        detectedType = 'activation';
      }
    }

    // Strategy 4: URL parameter analysis
    const paramAn = analyzeUrlParams(url);
    if (paramAn.hasToken) {
      confidence += CONFIG.scoring.linkParamToken;
    }
    if (paramAn.hasCode) {
      confidence += CONFIG.scoring.linkParamCode;
    }
    if (paramAn.hasSignature) {
      confidence += CONFIG.scoring.linkParamSignature;
    }
    if (paramAn.hasExpiry) {
      confidence += CONFIG.scoring.linkParamExpiry;
    }
    if (paramAn.tokenLength > 20) {
      confidence += CONFIG.scoring.linkLongToken;
    }
    // Extra: very long tokens are extremely reliable (like JWT, signed tokens)
    if (paramAn.tokenLength > 50) {
      confidence += CONFIG.scoring.linkLongToken;
    }
    if (paramAn.hasToken && paramAn.hasUserId) {
      confidence += 8; /* token+user = auth flow */
    }
    if (
      (paramAn.hasToken || paramAn.hasCode) &&
      (anchorLooksActivation || isActivationIntent(intent.intent)) &&
      detectedType !== 'password-reset'
    ) {
      confidence += 10;
      detectedType = 'activation';
    }

    // Strategy 5: Intent alignment
    if (
      detectedType === intent.intent ||
      (detectedType === 'activation' && isActivationIntent(intent.intent))
    ) {
      confidence += 18;
    } // was 15
    else if (
      detectedType === 'other' &&
      isActivationIntent(intent.intent) &&
      (paramAn.hasToken || paramAn.hasCode)
    ) {
      confidence += 12;
      detectedType = 'activation';
    } else if (
      detectedType === 'other' &&
      (isActivationIntent(intent.intent) || intent.intent === 'verification')
    ) {
      // Email is clearly auth-intent but URL didn't match pattern — give small boost
      confidence += 5;
    }

    // Strategy 6: Context validation
    const ctxResult = validateContext(url, plainText, 'activation', zones, decoded);
    if (ctxResult.isValid) {
      confidence += Math.min(ctxResult.score / 4, CONFIG.scoring.linkContextBonusMax);
    }
    // Even if not fully valid, give small context contribution
    else if (ctxResult.score > 5) {
      confidence += Math.min(ctxResult.score / 8, 8);
    }

    // Strategy 7: Domain trust
    const domainTrust = calculateDomainTrust(url, provider);
    confidence += Math.min(domainTrust / 5, CONFIG.scoring.linkDomainTrustMax);

    // Strategy 8: Provider link pattern match
    if (
      provider?.linkPatterns?.some((p: RegExp) => {
        p.lastIndex = 0;
        return p.test(url);
      })
    ) {
      confidence += 25; // was 20 — provider match is very reliable
    }

    // Zone scoring — use higher floor (0.65) so zone weight can't crush good signals
    const urlPos = decoded.indexOf(url);
    const zone = urlPos !== -1 ? getZoneForPosition(zones, urlPos) : null;
    if (zone?.zone === 'cta') {
      confidence += 18;
    } // was 15
    if (zone?.zone === 'footer') {
      confidence -= 15;
    } // was 18 — less aggressive penalty
    const zw = zone?.weight ?? 0.7; // default 0.7 (was 0.5) — unknown zones assumed mid-body
    confidence *= 0.65 + zw * 0.35; // was 0.55+0.45 — raises the floor significantly

    candidates.push({
      url: normalizeUrl(url),
      originalUrl: url,
      confidence: Math.min(Math.max(confidence, 0), 100),
      zone: zone?.zone || 'unknown',
      zoneWeight: zw,
      type: detectedType,
      anchorText,
      anchorHtml,
      isCTA,
      isInline: !isCTA && Boolean(anchorText),
      patternName,
      contextScore: ctxResult.score,
      semanticDistance: ctxResult.semanticDistance,
      urlComplexity: calculateUrlComplexity(url),
      hasAuthToken: paramAn.hasToken || paramAn.hasCode,
      paramAnalysis: paramAn,
      domainTrust,
      surroundingText: getContextAround(plainText, url, 100),
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  // Sort candidates by confidence and other factors
  candidates.sort((a, b) => {
    if (Math.abs(a.confidence - b.confidence) > 5) {
      return b.confidence - a.confidence;
    }
    if (a.isCTA !== b.isCTA) {
      return a.isCTA ? -1 : 1;
    }
    if (a.hasAuthToken !== b.hasAuthToken) {
      return a.hasAuthToken ? -1 : 1;
    }
    return b.domainTrust - a.domainTrust;
  });

  const best = candidates[0];
  if (!best) {
    return null;
  }

  log.info(
    `Link: ${best.url.substring(0, 70)}... (${best.confidence.toFixed(0)}%) [${best.type}] CTA=${best.isCTA}`
  );

  return {
    url: best.url,
    score: best.confidence,
    confidence: best.confidence,
    type: best.type,
    hasEmbeddedCode: false,
    embeddedCode: null,
    embeddedCodeParam: null,
    anchorText: best.anchorText,
    context: best.surroundingText,
    domainTrust: best.domainTrust,
    isShortened: false,
    redirectChain: [],
  };
}

/**
 * Validates context around a URL for activation intent
 * @param url - The URL
 * @param fullText - Full email text
 * @param category - Category ('activation')
 * @param zones - Email zones
 * @returns Context validation result
 */
function validateContext(
  url: string,
  fullText: string,
  category: 'activation',
  zones: EmailZone[],
  decodedHtml?: string
): { isValid: boolean; score: number; semanticDistance: number } {
  const lower = fullText.toLowerCase();
  const urlIdx = lower.indexOf(url.toLowerCase());

  let score = 0;

  // Check for activation keywords near URL
  const activationKeywords = ACTIVATION_CONTEXT_KEYWORDS;

  const radius = 150;
  const start = Math.max(0, urlIdx - radius);
  const end = Math.min(fullText.length, urlIdx + url.length + radius);
  const context = lower.substring(start, end);

  for (const keyword of activationKeywords) {
    if (context.includes(keyword)) {
      score += 8;
    }
  }

  // Semantic distance to action verbs
  const actionTerms = [
    'click',
    'tap',
    'press',
    'select',
    'follow',
    'verify',
    'confirm',
    'activate',
    'accept',
    'join',
    'authorize',
    'approve',
    'authenticate',
    'continue',
    'launch',
  ];
  let semanticDistance = Infinity;
  for (const term of actionTerms) {
    const tIdx = lower.indexOf(term);
    if (tIdx !== -1 && urlIdx !== -1) {
      const d = Math.abs(tIdx - urlIdx);
      if (d < semanticDistance) {
        semanticDistance = d;
      }
    }
  }

  if (semanticDistance < 30) {
    score += 12;
  } else if (semanticDistance < 80) {
    score += 6;
  }

  // Zone bonus
  let htmlUrlIdx = -1;
  if (decodedHtml) {
    htmlUrlIdx = decodedHtml.toLowerCase().indexOf(url.toLowerCase());
  } else {
    htmlUrlIdx = urlIdx;
  }

  if (htmlUrlIdx !== -1) {
    const zone = getZoneForPosition(zones, htmlUrlIdx);
    if (zone?.zone === 'cta') {
      score += 15;
    } else if (zone?.zone === 'body-primary') {
      score += 8;
    } else if (zone?.zone === 'footer') {
      score -= 10;
    }
  }

  return {
    isValid: score >= 10, // was 15 — less aggressive
    score: Math.min(score, 100),
    semanticDistance,
  };
}
