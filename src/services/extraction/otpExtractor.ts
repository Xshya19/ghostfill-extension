// src/services/extraction/otpExtractor.ts
// ═══════════════════════════════════════════════════════════════════════
//  OTP EXTRACTION ENGINE
//  Multi-strategy OTP/Verification Code Extraction
// ═══════════════════════════════════════════════════════════════════════

import { createLogger } from '../../utils/logger';
import { KnowledgeBase } from '../knowledgeBase';

import type {
  ProviderKnowledge,
  EmailZone,
  OTPCandidate,
  AntiPatternResult,
  ContextValidation,
  RelationshipGraph,
  ExtractedOTP,
  IntentResult,
} from '../types/extraction.types';
import {
  decodeHtmlEntities,
  getZoneForPosition,
  getContextAround,
} from './zoneAnalyzer';

const log = createLogger('OTPExtractor');

// ═══════════════════════════════════════════════════════════════════════
//  CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════

const CONFIG = {
  scoring: {
    providerLengthMatch: 15,
    lengthMatch: 10,
    formatMatch: 5,
    contextBonusMax: 20,
    instructionVerb: 8,
    validityPeriod: 6,
    securityWarning: 6,
    semanticClose: 12,
    semanticMedium: 8,
    semanticFar: 4,
    isolationBonusMax: 15,
    footerPenalty: 20,
    verificationIntentBonus: 10,
    codeLabelBonus: 20,
  },
  limits: {
    minCodeLength: 4,
    maxCodeLength: 10,
  },
  context: {
    nearRadius: 80,
    midRadius: 200,
    wideRadius: 400,
    nearWeight: 1.0,
    midWeight: 0.6,
    wideWeight: 0.3,
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════
//  PATTERN DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Patterns for detecting styled/visually prominent codes
 * These match HTML elements with styling that indicates importance
 */
const STYLED_CODE_PATTERNS = [
  /<(?:span|div|p|td|strong|b|h[1-6])[^>]*(?:style\s*=\s*["'][^"']*(?:font-size\s*:\s*(?:1[8-9]|[2-9]\d|1\d{2})|font-weight\s*:\s*(?:bold|[6-9]\d\d)|letter-spacing)[^"']*["'][^>]*)>\s*([A-Za-z0-9]{4,10}|[A-Za-z0-9 -]{4,15})\s*<\//gi,
  /<(?:code|pre|tt|samp|kbd)[^>]*>\s*([A-Za-z0-9]{4,10})\s*<\/(?:code|pre|tt|samp|kbd)>/gi,
] as const;

/**
 * Patterns for detecting codes with explicit labels
 * e.g., "Your code is: 123456" or "Enter 123456 to verify"
 */
const LABEL_PATTERNS = [
  // "code is: 123456" / "your pin: 123456" / "OTP = 123456"
  /(?:code|pin|otp|password|token|passcode)\s*(?:is|:|=)\s*([A-Za-z0-9]{4,10})/gi,
  // "enter 123456" / "use 123456" / "type 123456"
  /(?:enter|use|type|input)\s+([A-Za-z0-9]{4,10})\b/gi,
  // "123456 is your code" / "123456 as your verification"
  /\b([A-Za-z0-9]{4,10})\s+(?:is your|as your)\s+(?:code|pin|otp|password|verification)/gi,
  // "confirmation code 123456" / "verification code 123456" / "security code 123456"
  /(?:confirmation|verification|security|login|sign[- ]?in|access)\s+code\s*:?\s*([A-Za-z0-9]{4,10})\b/gi,
  // "your code is 123456" / "your verification code is 123456"
  /your\s+(?:verification\s+|confirmation\s+|security\s+|login\s+)?(?:code|pin|otp|password|token)\s*(?:is|:)\s*([A-Za-z0-9]{4,10})/gi,
  // "code: 123456" at start of line or after a period
  /(?:^|[.!?]\s*)(?:code|pin|otp)\s*[:=]\s*([A-Za-z0-9]{4,10})\b/gim,
  // Generic strong: standalone 4-8 digit number on its own line (visually prominent)
  /^\s*(\d{4,8})\s*$/gm,
] as const;

/**
 * Extended anti-patterns for rejecting false positives
 */
const EXTENDED_ANTI_PATTERNS: Array<{
  name: string;
  test: (v: string, ctx: string) => boolean;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'none';
}> = [
  {
    name: 'ip-address',
    test: (v) => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v),
    severity: 'critical',
  },
  { name: 'css-hex', test: (v) => /^#[0-9a-f]{3,8}$/i.test(v), severity: 'critical' },
  { name: 'css-value', test: (v) => /^\d+(?:px|em|rem|pt|%)$/.test(v), severity: 'critical' },
  { name: 'rgb-value', test: (v) => /^rgba?\(/i.test(v), severity: 'critical' },
  { name: 'html-entity', test: (v) => /^&#?\w+;$/.test(v), severity: 'critical' },
  { name: 'date', test: (v) => /^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$/.test(v), severity: 'high' },
  { name: 'time', test: (v) => /^\d{1,2}:\d{2}(:\d{2})?(\s*[ap]m)?$/i.test(v), severity: 'high' },
  { name: 'phone', test: (v) => /^[+]?\d[\d\s()-]{9,14}$/.test(v), severity: 'high' },
  {
    name: 'year',
    test: (v, ctx) => {
      if (/^(?:19|20)\d{2}$/.test(v)) {
        const near = getContextAround(ctx, v, 30).toLowerCase();
        // If it's clearly labeled as an OTP, it's not just a year
        if (/(?:code|pin|otp|password|token)/.test(near)) {
          return false;
        }
        // Otherwise, it might be a year
        return true;
      }
      return false;
    },
    severity: 'medium',
  },
  {
    name: 'zip',
    test: (v, ctx) => /(?:zip|postal|area)\s*(?:code)?/i.test(getContextAround(ctx, v, 40)),
    severity: 'high',
  },
  {
    name: 'price',
    test: (v, ctx) => {
      const around = getContextAround(ctx, v, 25);
      return /[$€£¥₹]/.test(around) || /(?:price|cost|total|amount|fee|usd|eur)/i.test(around);
    },
    severity: 'high',
  },
  {
    name: 'tracking',
    test: (v, ctx) =>
      /(?:tracking|shipment|package|order|delivery|fedex|ups|usps|dhl)\s*(?:#|number|no)/i.test(
        getContextAround(ctx, v, 60)
      ),
    severity: 'high',
  },
  {
    name: 'reference',
    test: (v, ctx) =>
      /(?:reference|ref|ticket|case|incident|invoice|receipt)\s*(?:#|number|no|id)/i.test(
        getContextAround(ctx, v, 50)
      ),
    severity: 'high',
  },
  {
    name: 'order',
    test: (v, ctx) =>
      /(?:order|transaction|payment)\s*(?:#|number|no|id)/i.test(getContextAround(ctx, v, 50)),
    severity: 'high',
  },
  { name: 'repeated', test: (v) => /^(\d)\1{3,}$/.test(v), severity: 'medium' },
  {
    name: 'sequential',
    test: (v) => {
      const d = v.replace(/\D/g, '');
      if (d.length < 4) {
        return false;
      }
      let asc = true;
      let desc = true;
      for (let i = 1; i < d.length; i++) {
        if (parseInt(d[i], 10) !== (parseInt(d[i - 1], 10) + 1) % 10) {
          asc = false;
        }
        if (parseInt(d[i], 10) !== (parseInt(d[i - 1], 10) - 1 + 10) % 10) {
          desc = false;
        }
      }
      return asc || desc;
    },
    severity: 'medium',
  },
  { name: 'all-zeros', test: (v) => /^0+$/.test(v), severity: 'medium' },
  {
    name: 'account',
    test: (v, ctx) => /(?:account|acct|a\/c)\s*(?:#|number|no)/i.test(getContextAround(ctx, v, 50)),
    severity: 'high',
  },
  {
    name: 'member',
    test: (v, ctx) =>
      /(?:member|customer|user|client)\s*(?:#|number|no|id)/i.test(getContextAround(ctx, v, 50)),
    severity: 'medium',
  },
];

// ═══════════════════════════════════════════════════════════════════════
//  ANTI-PATTERN CHECKING
// ═══════════════════════════════════════════════════════════════════════

/**
 * Checks a value against anti-patterns to reject false positives
 * @param value - The value to check
 * @param fullText - The full email text for context
 * @returns Anti-pattern result
 */
export function checkAntiPatterns(value: string, fullText: string): AntiPatternResult {
  // Check knowledge base patterns first
  for (const anti of KnowledgeBase.antiPatterns) {
    // Use fresh regex to avoid shared lastIndex mutation on global regexes
    const fresh = new RegExp(anti.pattern.source, anti.pattern.flags.replace('g', ''));
    if (!fresh.test(value)) {
      continue;
    }

    // Context-aware year override: if OTP label is nearby, don't penalize
    if (anti.name === 'year-4digit' || anti.name === 'year-2digit') {
      const near = getContextAround(fullText, value, 30).toLowerCase();
      if (/(?:code|pin|otp|password|token|passcode|verification|verify)/.test(near)) {
        continue; // OTP context — skip year rejection entirely
      }
    }

    // Only 'critical' and 'high' KB patterns actually reject
    const shouldReject = anti.reject && (anti.severity === 'critical' || anti.severity === 'high');
    return {
      isRejected: shouldReject,
      reason: anti.name,
      severity: anti.severity,
      pattern: anti.pattern.source,
    };
  }

  // Check extended patterns
  for (const anti of EXTENDED_ANTI_PATTERNS) {
    if (anti.test(value, fullText)) {
      const reject = anti.severity === 'critical' || anti.severity === 'high';
      return {
        isRejected: reject,
        reason: anti.name,
        severity: anti.severity,
        pattern: anti.name,
      };
    }
  }

  return { isRejected: false, reason: '', severity: 'none', pattern: '' };
}

// ═══════════════════════════════════════════════════════════════════════
//  CONTEXT VALIDATION
// ═══════════════════════════════════════════════════════════════════════

/**
 * Validates context around a potential OTP to determine legitimacy
 * @param value - The potential OTP value
 * @param fullText - The full email text
 * @param category - The category ('otp' or 'activation')
 * @param zones - Email zones for structural context
 * @returns Context validation result
 */
export function validateContext(
  value: string,
  fullText: string,
  category: 'otp' | 'activation',
  zones: EmailZone[]
): ContextValidation {
  const lower = fullText.toLowerCase();
  const valIdx = lower.indexOf(value.toLowerCase());

  const nearCtx = getContextAround(fullText, value, CONFIG.context.nearRadius).toLowerCase();
  const midCtx = getContextAround(fullText, value, CONFIG.context.midRadius).toLowerCase();
  const wideCtx = getContextAround(fullText, value, CONFIG.context.wideRadius).toLowerCase();

  let score = 0;
  const matched: ContextValidation['matchedKeywords'] = [];

  const keywords =
    category === 'otp'
      ? KnowledgeBase.contextKeywords.otp
      : KnowledgeBase.contextKeywords.activation;

  for (const { keyword, weight, strength } of keywords) {
    if (nearCtx.includes(keyword)) {
      score += weight;
      matched.push({ keyword, weight, strength });
    } else if (midCtx.includes(keyword)) {
      const adj = Math.ceil(weight * CONFIG.context.midWeight);
      score += adj;
      matched.push({ keyword, weight: adj, strength });
    } else if (wideCtx.includes(keyword)) {
      const adj = Math.ceil(weight * CONFIG.context.wideWeight);
      score += adj;
      matched.push({ keyword, weight: adj, strength });
    }
  }

  // Semantic distance calculation
  const terms =
    category === 'otp'
      ? ['code', 'otp', 'pin', 'verification', 'password', 'token', 'passcode']
      : ['verify', 'confirm', 'activate', 'click', 'button', 'link', 'reset'];

  let semanticDistance = Infinity;
  for (const term of terms) {
    const tIdx = lower.indexOf(term);
    if (tIdx !== -1 && valIdx !== -1) {
      const d = Math.abs(tIdx - valIdx);
      if (d < semanticDistance) {
        semanticDistance = d;
      }
    }
  }

  if (semanticDistance < 25) {
    score += CONFIG.scoring.semanticClose;
  } else if (semanticDistance < 60) {
    score += CONFIG.scoring.semanticMedium;
  } else if (semanticDistance < 120) {
    score += CONFIG.scoring.semanticFar;
  }

  // Build relationship graph
  const rg: RelationshipGraph = {
    hasInstructionVerb: /(?:enter|use|type|input|provide|submit|copy|paste|click|tap|press)/i.test(
      nearCtx
    ),
    hasUrgencyIndicator: /(?:now|immediately|urgent|asap|expire|quickly|hurry)/i.test(midCtx),
    hasValidityPeriod:
      /(?:valid for|expires? in|good for|active for|\d+\s*(?:min|hour|day|second))/i.test(midCtx),
    hasSecurityWarning:
      /(?:do not share|don't share|never share|confidential|keep.*(?:safe|secure|private))/i.test(
        midCtx
      ),
    hasCodeLabel: false,
    hasCTAProximity: false,
  };

  if (rg.hasInstructionVerb) {
    score += CONFIG.scoring.instructionVerb;
  }
  if (rg.hasValidityPeriod) {
    score += CONFIG.scoring.validityPeriod;
  }
  if (rg.hasSecurityWarning) {
    score += CONFIG.scoring.securityWarning;
  }

  // Code label detection
  if (category === 'otp' && valIdx > 0) {
    const before = fullText.substring(Math.max(0, valIdx - 45), valIdx);
    if (/(?:code|pin|otp|password|token|passcode)\s*(?:is|:|=)\s*$/i.test(before)) {
      rg.hasCodeLabel = true;
      score += CONFIG.scoring.codeLabelBonus;
    }
  }

  // CTA proximity check
  if (category === 'activation') {
    for (const z of zones.filter((z) => z.zone === 'cta')) {
      if (valIdx >= z.startIndex - 150 && valIdx <= z.endIndex + 150) {
        rg.hasCTAProximity = true;
        score += 15;
        break;
      }
    }
  }

  // Density bonus
  if (matched.length >= 5) {
    score += 15;
  } else if (matched.length >= 3) {
    score += 10;
  } else if (matched.length >= 2) {
    score += 5;
  }

  // Zone scoring
  if (valIdx !== -1) {
    const zone = getZoneForPosition(zones, valIdx);
    if (zone) {
      if (zone.zone === 'body-primary' || zone.zone === 'cta') {
        score += 8;
      } else if (zone.zone === 'footer') {
        score -= 15;
      } else if (zone.zone === 'preheader') {
        score += 3;
      }
    }
  }

  const threshold = category === 'otp' ? 18 : 22;

  return {
    isValid: score >= threshold,
    score: Math.min(score, 100),
    matchedKeywords: matched,
    semanticDistance,
    relationshipGraph: rg,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  ISOLATION SCORE CALCULATION
// ═══════════════════════════════════════════════════════════════════════

/**
 * Calculates how isolated/prominent a code is in the email
 * @param code - The code value
 * @param text - Plain text content
 * @param html - HTML content
 * @param pos - Position of code in text
 * @returns Isolation score (0-100)
 */
export function calculateIsolationScore(
  code: string,
  text: string,
  html: string,
  pos: number
): number {
  let score = 0;

  // Line isolation check
  const lineStart = text.lastIndexOf('\n', pos);
  const lineEnd = text.indexOf('\n', pos + code.length);
  const line = text.substring(lineStart + 1, lineEnd === -1 ? text.length : lineEnd).trim();

  if (line === code) {
    score += 40;
  } else if (line.length < code.length * 3) {
    score += 20;
  }

  // Whitespace isolation
  const before = pos > 0 ? text[pos - 1] : ' ';
  const after = pos + code.length < text.length ? text[pos + code.length] : ' ';
  if (/\s/.test(before) && /\s/.test(after)) {
    score += 15;
  }

  // HTML styling checks
  if (html) {
    const htmlIdx = html.indexOf(code);
    if (htmlIdx !== -1) {
      const surrounding = html.substring(
        Math.max(0, htmlIdx - 250),
        Math.min(html.length, htmlIdx + code.length + 60)
      );
      if (/letter-spacing/i.test(surrounding)) {
        score += 25;
      }
      if (/font-size\s*:\s*(?:1[8-9]|[2-9]\d|1\d{2})/i.test(surrounding)) {
        score += 20;
      }
      if (/font-weight\s*:\s*(?:bold|[6-9]\d\d)/i.test(surrounding)) {
        score += 15;
      }
      if (/<(?:strong|b)\b/i.test(surrounding)) {
        score += 15;
      }
      if (/text-align\s*:\s*center/i.test(surrounding)) {
        score += 10;
      }
      if (/<(?:code|pre|tt|samp|kbd)\b/i.test(surrounding)) {
        score += 20;
      }
    }
  }

  return Math.min(score, 100);
}

// ═══════════════════════════════════════════════════════════════════════
//  MAIN OTP EXTRACTION
// ═══════════════════════════════════════════════════════════════════════

/**
 * 4. Label-adjacent codes
 * 5. Semantic Token Proximity (Algorithmic true intelligence)
 *
 * @param fullText - Plain text email content
 * @param htmlBody - HTML email content
 * @param provider - Detected provider knowledge (optional)
 * @param zones - Email zone analysis
 * @param intent - Classified email intent
 * @returns Extracted OTP or null if none found
 */
export function extractOTP(
  fullText: string,
  htmlBody: string,
  provider: ProviderKnowledge | null,
  zones: EmailZone[],
  intent: IntentResult
): ExtractedOTP | null {
  const candidates: OTPCandidate[] = [];
  const rejected: Array<{ code: string; reason: string }> = [];

  const addCandidate = (
    code: string,
    rawMatch: string,
    patternName: string,
    baseConfidence: number,
    matchIndex: number
  ) => {
    if (candidates.some((c) => c.code === code)) {
      return;
    }
    if (code.length < CONFIG.limits.minCodeLength || code.length > CONFIG.limits.maxCodeLength) {
      return;
    }

    const anti = checkAntiPatterns(code, fullText);
    if (anti.isRejected) {
      rejected.push({ code, reason: anti.reason });
      return;
    }

    const ctx = validateContext(code, fullText, 'otp', zones);
    if (!ctx.isValid && ctx.score < 8) {
      rejected.push({ code, reason: `low-context(${ctx.score})` });
      return;
    }

    const zone = getZoneForPosition(zones, matchIndex);
    const isolationScore = calculateIsolationScore(code, fullText, htmlBody, matchIndex);

    candidates.push({
      code,
      rawMatch,
      confidence: baseConfidence,
      zone: zone?.zone || 'unknown',
      zoneWeight: zone?.weight || 0.5,
      patternName,
      patternConfidence: baseConfidence,
      contextScore: ctx.score,
      semanticDistance: ctx.semanticDistance,
      antiPatternResult: anti,
      providerMatch: provider?.otpLength === code.length,
      lengthMatch: provider?.otpLength === code.length,
      formatMatch: provider?.otpFormat === 'numeric' ? /^\d+$/.test(code) : true,
      surroundingText: getContextAround(fullText, code, 80),
      instructionVerb: ctx.relationshipGraph.hasInstructionVerb ? 'yes' : null,
      validityPeriod: ctx.relationshipGraph.hasValidityPeriod ? 'yes' : null,
      securityWarning: ctx.relationshipGraph.hasSecurityWarning,
      isolationScore,
    });
  };

  // Strategy 1: Provider-specific patterns
  if (provider?.otpLength) {
    const rx =
      provider.otpFormat === 'numeric'
        ? new RegExp(`(?<!\\d)\\d{${provider.otpLength}}(?!\\d)`, 'g')
        : new RegExp(`(?<![A-Za-z0-9])[A-Za-z0-9]{${provider.otpLength}}(?![A-Za-z0-9])`, 'g');

    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(fullText)) !== null) {
      addCandidate(m[0], m[0], `provider-${provider.name}`, 80, m.index);
    }
  }

  // Strategy 2: Styled codes in HTML
  if (htmlBody) {
    const decoded = decodeHtmlEntities(htmlBody);
    for (const rx of STYLED_CODE_PATTERNS) {
      rx.lastIndex = 0;
      let m;
      while ((m = rx.exec(decoded)) !== null) {
        const code = m[1].replace(/[\s-]/g, '').trim();
        if (!/\d/.test(code)) {
          continue;
        }
        addCandidate(code, m[1].trim(), 'styled-code', 68, m.index);
      }
    }
  }

  // Strategy 3: Knowledge base patterns
  for (const pattern of KnowledgeBase.otpPatterns) {
    pattern.pattern.lastIndex = 0;
    let m;
    while ((m = pattern.pattern.exec(fullText)) !== null) {
      const raw = m[0];
      const clean = raw.replace(/[-\s]/g, '');
      addCandidate(clean, raw, pattern.name, pattern.baseConfidence, m.index);
    }
  }

  // Strategy 4: Label-adjacent codes
  for (const rx of LABEL_PATTERNS) {
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(fullText)) !== null) {
      addCandidate(m[1].trim(), m[0], 'label-adjacent', 72, m.index);
    }
  }

  // Strategy 5: Semantic Token Proximity Engine (Zero-Shot Algorithmic Intelligence)
  // Instead of fixed regex, calculates inverse geometric distance between numeric clusters and verification intent words
  {
    const tokenRegex = /\b([a-zA-Z]+|\d{4,10})\b/g;
    const intentAnchors = new Set([
      'code',
      'pin',
      'otp',
      'password',
      'passcode',
      'verification',
      'verify',
      'login',
      'authenticate',
      'security',
    ]);

    const tokens: Array<{ text: string; isNumeric: boolean; isAnchor: boolean; pos: number }> = [];

    let m;
    tokenRegex.lastIndex = 0;
    while ((m = tokenRegex.exec(fullText)) !== null) {
      const text = m[1].toLowerCase();
      tokens.push({
        text: m[1],
        isNumeric: /^\d{4,10}$/.test(text) || /^[A-Z0-9]{5,8}$/.test(m[1]), // Allow alphanumeric like Epic Games
        isAnchor: intentAnchors.has(text),
        pos: m.index,
      });
    }

    // Score numeric tokens by semantic proximity
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!tok.isNumeric) {
        continue;
      }

      let highestGravity = 0;

      // Search surrounding tokens window (-10 to +10 words)
      const windowStart = Math.max(0, i - 10);
      const windowEnd = Math.min(tokens.length - 1, i + 10);

      for (let j = windowStart; j <= windowEnd; j++) {
        if (i === j) {
          continue;
        }
        const neighbor = tokens[j];
        if (neighbor.isAnchor) {
          // Inverse distance algorithm (closer = exponentially higher gravity)
          const distance = Math.abs(i - j);
          const gravity = 100 / (distance * 1.5);
          highestGravity = Math.max(highestGravity, gravity);
        }
      }

      // If gravitational pull > threshold, we found an OTP intelligently
      if (highestGravity > 30) {
        // Determine confidence dynamically based on gravity density
        const semanticConfidence = Math.min(65 + highestGravity, 95);
        addCandidate(tok.text, tok.text, 'semantic-proximity', semanticConfidence, tok.pos);
      }
    }
  }

  if (candidates.length === 0) {
    log.debug(
      `No OTP candidates. Rejected: ${rejected.map((r) => `${r.code}(${r.reason})`).join(', ') || 'none'}`
    );
    return null;
  }

  // Score and rank candidates
  for (const c of candidates) {
    let score = c.confidence;

    if (c.providerMatch) {
      score += CONFIG.scoring.providerLengthMatch;
    }
    if (c.lengthMatch) {
      score += CONFIG.scoring.lengthMatch;
    }
    if (c.formatMatch) {
      score += CONFIG.scoring.formatMatch;
    }

    score += Math.min(c.contextScore / 3.5, CONFIG.scoring.contextBonusMax);
    if (c.instructionVerb) {
      score += CONFIG.scoring.instructionVerb;
    }
    if (c.validityPeriod) {
      score += CONFIG.scoring.validityPeriod;
    }
    if (c.securityWarning) {
      score += CONFIG.scoring.securityWarning;
    }

    if (c.semanticDistance < 25) {
      score += CONFIG.scoring.semanticClose;
    } else if (c.semanticDistance < 60) {
      score += CONFIG.scoring.semanticMedium;
    } else if (c.semanticDistance < 120) {
      score += CONFIG.scoring.semanticFar;
    }

    score += Math.min(c.isolationScore / 5, CONFIG.scoring.isolationBonusMax);
    score *= 0.5 + c.zoneWeight * 0.5;
    if (c.zone === 'footer') {
      score -= CONFIG.scoring.footerPenalty;
    }

    if (intent.intent === 'verification') {
      score += CONFIG.scoring.verificationIntentBonus;
    }

    if (c.antiPatternResult.severity === 'medium') {
      score -= 12;
    }
    if (c.antiPatternResult.severity === 'low') {
      score -= 6;
    }

    c.confidence = Math.min(Math.max(score, 0), 100);
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  const best = candidates[0];

  log.info(
    `OTP: ${best.code} (${best.confidence.toFixed(0)}%) via ${best.patternName} in ${best.zone}`
  );

  return {
    code: best.code,
    rawCode: best.rawMatch,
    score: best.confidence,
    confidence: best.confidence / 100,
    type: 'verification-code',
    length: best.code.length,
    format: /^\d+$/.test(best.code) ? 'numeric' : 'alphanumeric',
    strategy: 'explicit-label',
    context: best.surroundingText,
    label: null,
    fromUrl: false,
    urlParam: null,
    sourceUrl: null,
    visualProminence: best.zoneWeight * 100,
    providerMatch: null,
    matchedSignals: [],
    antiSignals: [],
    reasoning: {
      steps: [],
      summary: `Extracted via ${best.patternName}`,
      confidenceExplanation: `Score: ${best.confidence.toFixed(0)}%`,
    },
  };
}
