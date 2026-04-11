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
import { normalizeUrl, analyzeUrlParams, calculateUrlComplexity } from './urlExtractor';
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
  /(?:facebook|twitter|instagram|linkedin|youtube|tiktok|pinterest)\.com/i,
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
  if (/class\s*=\s*["'][^"']*(?:btn|button|cta|action|primary)[^"']*["']/i.test(l)) {
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
      anchorText: stripHtml(strict[1] ?? '').trim(),
      anchorHtml: strict[0],
      isCTA: isCTAButton(strict[0]),
    };
  }

  // Fallback to loose match
  const loose = /<a([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = loose.exec(html)) !== null) {
    if (m[0].includes(url) || (m[1] ?? '').includes(url)) {
      return {
        anchorText: stripHtml(m[2] ?? '').trim(),
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
      // Strong: verify/activate/confirm/signup in path
      if (/verify|activate|confirm|registration|signup/i.test(url)) {
        confidence = 75;
        detectedType = 'activation';
        patternName = 'url-kw-activation';
      } else if (/reset|recover|password|forgot/i.test(url)) {
        confidence = 75;
        detectedType = 'password-reset';
        patternName = 'url-kw-reset';
      } else if (/magic(?:-link)?|passwordless|signin[-_]?link/i.test(url)) {
        confidence = 72;
        detectedType = 'activation';
        patternName = 'url-kw-magic';
      } else {
        // OAuth / SSO / Auth-flow detection
        // Catches: ?auth=...&flow=..., /oauth/..., /sso/..., /auth/...
        const oauthFlow = /[?&](?:flow|state|nonce|grant_type|response_type)=/i.test(url);
        const authParam = /[?&](?:auth|token|access_token|id_token|code)=[A-Za-z0-9%._-]{8,}/i.test(
          url
        );
        const authPath =
          /\/(?:auth|oauth|sso|login|signin|oidc|saml|callback|authorize)(?:\/|\?|$)/i.test(url);
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

    if (isCTA) {
      confidence += CONFIG.scoring.linkCtaBonus;
      const ctaLower = anchorText.toLowerCase();
      if (
        /verify|confirm|activate|complete|get started|click here|continue|proceed|open|access/i.test(
          ctaLower
        )
      ) {
        confidence += CONFIG.scoring.linkAnchorKeyword;
        if (detectedType === 'other') {
          detectedType = 'activation';
        }
      }
      if (/reset|change|set.*password/i.test(ctaLower)) {
        confidence += CONFIG.scoring.linkAnchorKeyword;
        if (detectedType === 'other') {
          detectedType = 'password-reset';
        }
      }
    } else if (
      anchorText &&
      /verify|confirm|activate|click here|get started|complete|continue|open|access|proceed/i.test(
        anchorText.toLowerCase()
      )
    ) {
      confidence += 12;
      if (detectedType === 'other') {
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

    // Strategy 5: Intent alignment
    if (detectedType === intent.intent) {
      confidence += 18;
    } // was 15
    else if (
      detectedType === 'other' &&
      intent.intent === 'activation' &&
      (paramAn.hasToken || paramAn.hasCode)
    ) {
      confidence += 12;
      detectedType = 'activation';
    } else if (
      detectedType === 'other' &&
      (intent.intent === 'activation' || intent.intent === 'verification')
    ) {
      // Email is clearly auth-intent but URL didn't match pattern — give small boost
      confidence += 5;
    }

    // Strategy 6: Context validation
    const ctxResult = validateContext(url, plainText, 'activation', zones);
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
  if (!best) {return null;}

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
  zones: EmailZone[]
): { isValid: boolean; score: number; semanticDistance: number } {
  const lower = fullText.toLowerCase();
  const urlIdx = lower.indexOf(url.toLowerCase());

  let score = 0;

  // Check for activation keywords near URL
  const activationKeywords = [
    'verify',
    'confirm',
    'activate',
    'click here',
    'click the button',
    'get started',
    'complete registration',
    'confirm email',
    'sign in',
    'log in',
    'open link',
    'access account',
    'continue',
    'proceed',
    'enter',
    'email verified',
    'account verification',
    'authentication',
    'please click',
    'tap here',
    'follow this link',
    'use this link',
  ];

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
  const actionTerms = ['click', 'tap', 'press', 'select', 'follow'];
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
  if (urlIdx !== -1) {
    const zone = getZoneForPosition(zones, urlIdx);
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
