// src/services/extraction/otpExtractor.ts
// ══════════════════════════════════════════
//  OTP EXTRACTION ENGINE (hardened)
//  Multi-strategy OTP/Verification Code Extraction
// ══════════════════════════════════════════
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
  ExtractionStrategy,
  OTPSignal,
} from '../types/extraction.types';
import { decodeHtmlEntities, getZoneForPosition, getContextAround } from './zoneAnalyzer';

const log = createLogger('OTPExtractor');

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, none: 0 };

const CONFIG = {
  scoring: {
    providerLengthMatch: 15,
    lengthMatch: 10,
    formatMatch: 5,
    contextContributionMax: 50,
    isolationBonusMax: 15,
    verificationIntentBonus: 10,
    codeLabelBonus: 20,
    antiPenalty: { critical: 100, high: 14, medium: 12, low: 6, none: 0 } as Record<string, number>,
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

// ══════════════════════════════════════════
//  INTERNAL HELPERS
// ══════════════════════════════════════════

// FIX: position-aware context slice. Avoids the original bug where context was
// always taken from the FIRST indexOf() occurrence (and broke entirely when a
// cleaned code with separators removed could not be found in the text at all).
function sliceAround(text: string, index: number, length: number, radius: number): string {
  if (!text || index < 0) {
    return '';
  }
  return text.slice(Math.max(0, index - radius), Math.min(text.length, index + length + radius));
}

function isInsideUrlLikeSpan(text: string, index: number, length: number): boolean {
  if (!text || index < 0) {
    return false;
  }

  const start = Math.max(0, index - 160);
  const window = text.slice(start, Math.min(text.length, index + length + 160));
  const localIndex = index - start;
  const localEnd = localIndex + Math.max(length, 1);
  const urlRegex = /https?:\/\/[^\s<>"')\]}]+/gi;
  let m: RegExpExecArray | null;

  while ((m = urlRegex.exec(window)) !== null) {
    const urlStart = m.index;
    const urlEnd = m.index + m[0].length;
    if (localIndex >= urlStart && localEnd <= urlEnd) {
      return true;
    }
  }

  const before = window.slice(Math.max(0, localIndex - 50), localIndex).toLowerCase();
  return /(?:[?&#/]|%3[fba]|&amp;)[a-z0-9_.-]{1,40}=$/i.test(before);
}

// ══════════════════════════════════════════
//  PATTERN DEFINITIONS
// ══════════════════════════════════════════
const STYLED_CODE_PATTERNS = [
  /<(?:span|div|p|td|strong|b|h[1-6])[^>]*(?:style\s*=\s*["'][^"']*(?:font-size\s*:\s*(?:1[8-9]|[2-9]\d|1\d{2})|font-weight\s*:\s*(?:bold|[6-9]\d\d)|letter-spacing)[^"']*["'][^>]*)>\s*([A-Za-z0-9]{4,10}|[A-Za-z0-9 -]{4,15})\s*<\//gi,
  /<(?:code|pre|tt|samp|kbd)[^>]*>\s*([A-Za-z0-9]{4,10})\s*<\/(?:code|pre|tt|samp|kbd)>/gi,
] as const;

const LABEL_PATTERNS = [
  // Tier 1: Explicit label + colon/equals (highest precision)
  /(?:code|pin|otp|password|token|passcode|verification\s+code|security\s+code|confirmation\s+code|auth\s+code)\s*(?:is|:|=)\s*([A-Za-z0-9]{4,10})/gi,
  // Tier 1: "Enter X to verify"
  /(?:enter|use|type|input|submit|copy|provide)\s+([A-Za-z0-9]{4,10})\s+to\s+(?:verify|confirm|log\s*in|sign\s*in|authenticate|complete|access)/gi,
  // Tier 1: "X is your code/OTP"
  /\b([A-Za-z0-9]{4,10})\s+(?:is your|is the|as your)\s+(?:\w+\s+){0,2}(?:code|pin|otp|password|verification|passcode)/gi,
  // Tier 1: "Your code is X" / "Your OTP is X"
  /\byour\s+(?:\w+\s+){0,3}(?:code|otp|pin|passcode|token)\s+is\s+([A-Za-z0-9]{4,10})/gi,
  // Tier 1: type-prefixed (verification code: X, security code - X)
  /(?:confirmation|verification|security|one.?time|login|sign.?in|access)\s+code\s*[-:–—]?\s*([A-Za-z0-9]{4,10})\b/gi,
  // Tier 2: bracket-wrapped codes [X], (X), {X}
  /[\[({]\s*([A-Za-z0-9]{4,10})\s*[\])}]/g,
  // Tier 2: line-start code labels
  /(?:^|[.!?\n]\s*)(?:code|pin|otp|token)\s*[:=]\s*([A-Za-z0-9]{4,10})\b/gim,
  // Tier 2: standalone number on its own line
  /^\s*(\d{4,8})\s*$/gm,
  // Tier 2: dash-separated digit groups as codes (123 456 / 12 34 56)
  /(?:code|pin|otp|passcode)\s*[:\s]\s*([A-Za-z0-9][A-Za-z0-9\s-]{3,12}[A-Za-z0-9])/gi,
] as const;

// Extended anti-patterns for rejecting false positives.
// FIX: full-value structural matches (date/time/phone) now hard-reject
// (reject:true) instead of being merely flagged — if the candidate IS entirely
// a date/time/phone there is no reason to keep it.
const EXTENDED_ANTI_PATTERNS: Array<{
  name: string;
  test: (v: string, ctx: string, idx?: number) => boolean;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'none';
  reject?: boolean;
}> = [
  {
    name: 'ip-address',
    test: (v) => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v),
    severity: 'critical',
    reject: true,
  },
  { name: 'css-hex', test: (v) => /^#[0-9a-f]{3,8}$/i.test(v), severity: 'critical', reject: true },
  {
    name: 'css-value',
    test: (v) => /^\d+(?:px|em|rem|pt|%)$/.test(v),
    severity: 'critical',
    reject: true,
  },
  { name: 'rgb-value', test: (v) => /^rgba?\(/i.test(v), severity: 'critical', reject: true },
  { name: 'html-entity', test: (v) => /^&#?\w+;$/.test(v), severity: 'critical', reject: true },
  {
    name: 'date',
    test: (v) => /^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$/.test(v),
    severity: 'high',
    reject: true,
  },
  {
    name: 'time',
    test: (v) => /^\d{1,2}:\d{2}(:\d{2})?(\s*[ap]m)?$/i.test(v),
    severity: 'high',
    reject: true,
  },
  { name: 'phone', test: (v) => /^[+]?\d[\d\s()-]{9,14}$/.test(v), severity: 'high', reject: true },
  {
    name: 'year',
    test: (v, ctx, idx) => {
      if (!/^(?:19|20)\d{2}$/.test(v)) {
        return false;
      }
      // If it is explicitly preceded by copyright indicators, reject it immediately!
      const before =
        idx !== undefined && idx >= 0
          ? sliceAround(ctx, idx, v.length, 15).toLowerCase().substring(0, 15)
          : getContextAround(ctx, v, 15).toLowerCase().split(v)[0] || '';
      if (/(?:©|copyright|\(c\)|copr\.)/.test(before)) {
        return true;
      }
      // FIX: look around the ACTUAL occurrence when we know it, instead of the
      // first indexOf hit.
      const near =
        idx !== undefined && idx >= 0
          ? sliceAround(ctx, idx, v.length, 30).toLowerCase()
          : getContextAround(ctx, v, 30).toLowerCase();
      return !/(?:code|pin|otp|password|token|passcode)/.test(near);
    },
    severity: 'high',
    reject: true,
  },
  {
    name: 'zip',
    test: (v, ctx, idx) =>
      /(?:zip|postal|area)\s*(?:code)?/i.test(
        idx !== undefined && idx >= 0
          ? sliceAround(ctx, idx, v.length, 40)
          : getContextAround(ctx, v, 40)
      ),
    severity: 'medium',
  },
  {
    name: 'price',
    test: (v, ctx, idx) => {
      const around =
        idx !== undefined && idx >= 0
          ? sliceAround(ctx, idx, v.length, 25)
          : getContextAround(ctx, v, 25);
      return /[$€£¥₹]/.test(around) || /(?:price|cost|total|amount|fee|usd|eur)/i.test(around);
    },
    severity: 'high',
  },
  {
    name: 'tracking',
    test: (v, ctx, idx) =>
      /(?:tracking|shipment|package|order|delivery|fedex|ups|usps|dhl)\s*(?:#|number|no)/i.test(
        idx !== undefined && idx >= 0
          ? sliceAround(ctx, idx, v.length, 60)
          : getContextAround(ctx, v, 60)
      ),
    severity: 'high',
  },
  {
    name: 'reference',
    test: (v, ctx, idx) =>
      /(?:reference|ref|ticket|case|incident|invoice|receipt)\s*(?:#|number|no|id)/i.test(
        idx !== undefined && idx >= 0
          ? sliceAround(ctx, idx, v.length, 50)
          : getContextAround(ctx, v, 50)
      ),
    severity: 'high',
  },
  {
    name: 'order',
    test: (v, ctx, idx) =>
      /(?:order|transaction|payment)\s*(?:#|number|no|id)/i.test(
        idx !== undefined && idx >= 0
          ? sliceAround(ctx, idx, v.length, 50)
          : getContextAround(ctx, v, 50)
      ),
    severity: 'high',
  },
  {
    name: 'promo-code',
    test: (v, ctx, idx) =>
      /\b(?:coupon|promo|promotion|discount|voucher|referral|offer|gift\s*card)\s*(?:code|pin|token|#)?\b/i.test(
        idx !== undefined && idx >= 0
          ? sliceAround(ctx, idx, v.length, 70)
          : getContextAround(ctx, v, 70)
      ) ||
      /\b(?:code|pin|token)\s+(?:for|at checkout|to save|to get)\b/i.test(
        idx !== undefined && idx >= 0
          ? sliceAround(ctx, idx, v.length, 70)
          : getContextAround(ctx, v, 70)
      ),
    severity: 'high',
    reject: true,
  },
  { name: 'repeated', test: (v) => /^(\d)\1{3,}$/.test(v), severity: 'critical', reject: true },
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
        if (parseInt(d[i]!, 10) !== (parseInt(d[i - 1]!, 10) + 1) % 10) {
          asc = false;
        }
        if (parseInt(d[i]!, 10) !== (parseInt(d[i - 1]!, 10) - 1 + 10) % 10) {
          desc = false;
        }
      }
      return asc || desc;
    },
    severity: 'critical',
    reject: true,
  },
  { name: 'all-zeros', test: (v) => /^0+$/.test(v), severity: 'critical', reject: true },
  {
    name: 'account',
    test: (v, ctx, idx) =>
      /(?:account|acct|a\/c)\s*(?:#|number|no)/i.test(
        idx !== undefined && idx >= 0
          ? sliceAround(ctx, idx, v.length, 50)
          : getContextAround(ctx, v, 50)
      ),
    severity: 'high',
  },
  {
    name: 'member',
    test: (v, ctx, idx) =>
      /(?:member|customer|user|client)\s*(?:#|number|no|id)/i.test(
        idx !== undefined && idx >= 0
          ? sliceAround(ctx, idx, v.length, 50)
          : getContextAround(ctx, v, 50)
      ),
    severity: 'medium',
  },
];

// ══════════════════════════════════════════
//  ANTI-PATTERN CHECKING
// ══════════════════════════════════════════

// FIX: the original returned on the FIRST matching anti-pattern. A value that
// matched a benign low-severity pattern early in the list (e.g. zip-code) would
// short-circuit and never be tested against a later CRITICAL pattern. We now
// evaluate ALL patterns and resolve to the strongest signal: any hard-reject
// wins; otherwise the highest-severity match is returned for a scoring penalty.
export function checkAntiPatterns(
  value: string,
  fullText: string,
  valueIndex?: number
): AntiPatternResult {
  let rejectHit: AntiPatternResult | null = null;
  let penaltyHit: AntiPatternResult | null = null;

  const consider = (hit: AntiPatternResult, shouldReject: boolean) => {
    if (shouldReject) {
      if (!rejectHit || SEVERITY_RANK[hit.severity]! > SEVERITY_RANK[rejectHit.severity]!) {
        rejectHit = hit;
      }
    } else if (hit.severity !== 'none') {
      if (!penaltyHit || SEVERITY_RANK[hit.severity]! > SEVERITY_RANK[penaltyHit.severity]!) {
        penaltyHit = hit;
      }
    }
  };

  // Knowledge base patterns
  for (const anti of KnowledgeBase.antiPatterns) {
    // Fresh, non-global regex avoids shared lastIndex mutation across calls.
    const fresh = new RegExp(anti.pattern.source, anti.pattern.flags.replace('g', ''));
    if (!fresh.test(value)) {
      continue;
    }

    // Context-aware year override: skip entirely when an OTP label is nearby.
    if (anti.name === 'year-4digit' || anti.name === 'year-2digit') {
      const near =
        valueIndex !== undefined && valueIndex >= 0
          ? sliceAround(fullText, valueIndex, value.length, 30).toLowerCase()
          : getContextAround(fullText, value, 30).toLowerCase();
      if (/(?:code|pin|otp|password|token|passcode)/.test(near)) {
        continue;
      }
    }

    const shouldReject =
      !!anti.reject && (anti.severity === 'critical' || anti.severity === 'high');
    consider(
      {
        isRejected: shouldReject,
        reason: anti.name,
        severity: anti.severity,
        pattern: anti.pattern.source,
      },
      shouldReject
    );
  }

  // Extended patterns. Strong contextual identifiers ("order #", "tracking no",
  // "reference #", "account no") hard-reject: a number explicitly introduced as
  // one of these is never an OTP.
  const CONTEXTUAL_REJECT = new Set(['order', 'tracking', 'reference', 'account']);
  for (const anti of EXTENDED_ANTI_PATTERNS) {
    if (!anti.test(value, fullText, valueIndex)) {
      continue;
    }
    const shouldReject =
      anti.reject === true || anti.severity === 'critical' || CONTEXTUAL_REJECT.has(anti.name);
    consider(
      { isRejected: shouldReject, reason: anti.name, severity: anti.severity, pattern: anti.name },
      shouldReject
    );
  }

  if (rejectHit) {
    return rejectHit;
  }
  if (penaltyHit) {
    return penaltyHit;
  }
  return { isRejected: false, reason: '', severity: 'none', pattern: '' };
}

// ══════════════════════════════════════════
//  CONTEXT VALIDATION
// ══════════════════════════════════════════

// FIX: accepts an optional `anchor` describing the ACTUAL match location so the
// context window is centered on the real occurrence (and works for cleaned
// codes whose stripped form no longer appears verbatim in the text).
export function validateContext(
  value: string,
  fullText: string,
  category: 'otp' | 'activation',
  zones: EmailZone[],
  decodedHtml?: string,
  anchor?: { index: number; length: number }
): ContextValidation {
  const lower = fullText.toLowerCase();
  const valIdx = anchor && anchor.index >= 0 ? anchor.index : lower.indexOf(value.toLowerCase());
  const anchorLen = anchor && anchor.length > 0 ? anchor.length : value.length;

  let htmlValIdx = -1;
  if (decodedHtml) {
    htmlValIdx = decodedHtml.toLowerCase().indexOf(value.toLowerCase());
  }
  if (htmlValIdx === -1) {
    htmlValIdx = valIdx;
  }

  const nearCtx = sliceAround(fullText, valIdx, anchorLen, CONFIG.context.nearRadius).toLowerCase();
  const midCtx = sliceAround(fullText, valIdx, anchorLen, CONFIG.context.midRadius).toLowerCase();
  const wideCtx = sliceAround(fullText, valIdx, anchorLen, CONFIG.context.wideRadius).toLowerCase();

  let score = 0;
  const matched: ContextValidation['matchedKeywords'] = [];

  const keywords =
    category === 'otp'
      ? KnowledgeBase.contextKeywords.otp
      : KnowledgeBase.contextKeywords.activation;

  for (const { keyword, weight, strength } of keywords ?? []) {
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

  // Semantic distance from the actual occurrence to the nearest intent term.
  const terms =
    category === 'otp'
      ? ['code', 'otp', 'pin', 'verification', 'password', 'token', 'passcode']
      : ['verify', 'confirm', 'activate', 'click', 'button', 'link', 'reset'];
  let semanticDistance = Infinity;
  if (valIdx !== -1) {
    for (const term of terms) {
      let from = 0;
      let tIdx = lower.indexOf(term, from);
      while (tIdx !== -1) {
        const d = Math.abs(tIdx - valIdx);
        if (d < semanticDistance) {
          semanticDistance = d;
        }
        from = tIdx + term.length;
        tIdx = lower.indexOf(term, from);
      }
    }
  }

  // WIDER WINDOWS: Table-layout emails place labels far from codes in DOM/plaintext.
  // Extended from <25/<60/<120 to <40/<100/<200 to handle real-world transactional emails.
  if (semanticDistance < 40) {
    score += 14;
  } else if (semanticDistance < 100) {
    score += 9;
  } else if (semanticDistance < 200) {
    score += 5;
  }

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
    score += 8;
  }
  if (rg.hasValidityPeriod) {
    score += 6;
  }
  if (rg.hasSecurityWarning) {
    score += 6;
  }

  // Code label immediately preceding the actual occurrence.
  if (category === 'otp' && valIdx > 0) {
    const before = fullText.substring(Math.max(0, valIdx - 80), valIdx);
    if (/(?:code|pin|otp|password|token|passcode|verification|security|confirmation)\s*(?:is|:|=|–|—|-)?\s*$/i.test(before)) {
      rg.hasCodeLabel = true;
      score += CONFIG.scoring.codeLabelBonus;
    }
    // NEW: check if the code is in a heading or standalone in the HTML
    if (decodedHtml) {
      const htmlValIdxLocal = decodedHtml.toLowerCase().indexOf(value.toLowerCase());
      if (htmlValIdxLocal !== -1) {
        const htmlCtx = decodedHtml.substring(
          Math.max(0, htmlValIdxLocal - 200),
          Math.min(decodedHtml.length, htmlValIdxLocal + value.length + 200)
        );
        // Heading tag proximity — very strong visual signal in emails
        if (/<h[123][^>]*>\s*[^<]*$/i.test(htmlCtx.substring(0, htmlCtx.indexOf(value))) &&
            /^[^<]*\s*<\/h[123]>/i.test(htmlCtx.substring(htmlCtx.indexOf(value) + value.length))) {
          score += 30;
          rg.hasCodeLabel = true;
        }
        // Strong/bold tag wrapping the code
        if (/<(?:strong|b)\b[^>]*>\s*$/.test(htmlCtx.substring(0, htmlCtx.indexOf(value))) &&
            /^\s*<\/(?:strong|b)>/.test(htmlCtx.substring(htmlCtx.indexOf(value) + value.length))) {
          score += 20;
        }
        // TD cell containing only the number
        if (/<(?:td|th)[^>]*>\s*$/.test(htmlCtx.substring(0, htmlCtx.indexOf(value))) &&
            /^\s*<\/(?:td|th)>/.test(htmlCtx.substring(htmlCtx.indexOf(value) + value.length))) {
          score += 25;
          rg.hasCodeLabel = true;
        }
      }
    }
  }

  if (category === 'activation') {
    for (const z of zones.filter((z) => z.zone === 'cta')) {
      if (valIdx >= z.startIndex - 150 && valIdx <= z.endIndex + 150) {
        rg.hasCTAProximity = true;
        score += 15;
        break;
      }
    }
  }

  if (matched.length >= 5) {
    score += 15;
  } else if (matched.length >= 3) {
    score += 10;
  } else if (matched.length >= 2) {
    score += 5;
  }

  if (htmlValIdx !== -1) {
    const zone = getZoneForPosition(zones, htmlValIdx);
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

// ══════════════════════════════════════════
//  ISOLATION SCORE
// ════════════�����═════════════════════════════
export function calculateIsolationScore(
  code: string,
  text: string,
  html: string,
  pos: number,
  rawMatch?: string
): number {
  let score = 0;

  const lineStart = text.lastIndexOf('\n', pos);
  const lineEnd = text.indexOf('\n', pos + code.length);
  const line = text.substring(lineStart + 1, lineEnd === -1 ? text.length : lineEnd).trim();
  if (line === code || line === (rawMatch ?? code)) {
    score += 40;
  } else if (line.length < code.length * 3) {
    score += 20;
  }

  const before = pos > 0 ? (text[pos - 1] ?? ' ') : ' ';
  const after = pos + code.length < text.length ? (text[pos + code.length] ?? ' ') : ' ';
  if (/\s/.test(before) && /\s/.test(after)) {
    score += 15;
  }

  if (html) {
    // FIX: search for the raw (possibly separated) match in HTML first; the
    // cleaned code often does not appear verbatim inside markup.
    let htmlIdx = rawMatch ? html.indexOf(rawMatch) : -1;
    if (htmlIdx === -1) {
      htmlIdx = html.indexOf(code);
    }
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

function strategyLabel(patternName: string): ExtractionStrategy {
  if (patternName.startsWith('provider')) {
    return 'explicit-label';
  }
  if (patternName === 'styled-code') {
    return 'html-prominent';
  }
  if (patternName === 'label-adjacent') {
    return 'explicit-label';
  }
  if (patternName === 'semantic-proximity') {
    return 'proximity-inference';
  }
  return 'explicit-label';
}

interface ExtractedOTPCandidate extends OTPCandidate {
  rawScore: number;
  matchedKeywordCount: number;
  ambiguous?: boolean;
}

// ══════════════════════════════════════════
//  MAIN OTP EXTRACTION
// ══════════════════════════════════════════
export function extractOTP(
  fullText: string,
  htmlBody: string,
  provider: ProviderKnowledge | null,
  zones: EmailZone[],
  intent: IntentResult
): ExtractedOTP | null {
  const candidates: ExtractedOTPCandidate[] = [];
  const rejected: Array<{ code: string; reason: string }> = [];
  const decodedHtml = decodeHtmlEntities(htmlBody);

  const addCandidate = (
    code: string,
    rawMatch: string,
    patternName: string,
    baseConfidence: number,
    matchIndex: number
  ) => {
    if (!code) {
      return;
    }
    if (code.length < CONFIG.limits.minCodeLength || code.length > CONFIG.limits.maxCodeLength) {
      return;
    }
    // FIX: an OTP always contains at least one digit. This rejects pure-alphabetic
    // captures such as the word that follows "verification code ___" (e.g. "code
    // below", "code here", "code now"), which the label patterns would otherwise
    // grab and — being pure text — could even outrank the real code.
    if (!/\d/.test(code)) {
      return;
    }
    // FIX: if a stronger strategy re-discovers an existing code, upgrade its base
    // confidence/patternName instead of discarding it. The original kept whichever
    // strategy ran FIRST, so the generic numeric pass robbed label/styled matches
    // of their higher confidence (and could let a phone fragment outrank the OTP).
    const existing = candidates.find((c) => c.code === code);
    if (existing) {
      if (baseConfidence > existing.patternConfidence) {
        existing.confidence = baseConfidence;
        existing.patternConfidence = baseConfidence;
        existing.patternName = patternName;
      }
      return;
    }

    // Resolve plaintext / html anchor positions for THIS occurrence.
    let plainTextIndex: number;
    let htmlIndex: number;
    if (patternName === 'styled-code') {
      htmlIndex = matchIndex;
      plainTextIndex = fullText.indexOf(code);
      if (plainTextIndex === -1) {
        plainTextIndex = fullText.toLowerCase().indexOf(code.toLowerCase());
      }
    } else {
      plainTextIndex = matchIndex;
      htmlIndex = decodedHtml.indexOf(rawMatch);
      if (htmlIndex === -1) {
        htmlIndex = decodedHtml.indexOf(code);
      }
    }

    const anchorIdx = plainTextIndex >= 0 ? plainTextIndex : -1;
    if (isInsideUrlLikeSpan(fullText, anchorIdx, rawMatch.length)) {
      rejected.push({ code, reason: 'url-token' });
      return;
    }

    const anti = checkAntiPatterns(code, fullText, anchorIdx);
    if (anti.isRejected) {
      rejected.push({ code, reason: anti.reason });
      return;
    }

    const ctx = validateContext(
      code,
      fullText,
      'otp',
      zones,
      decodedHtml,
      anchorIdx >= 0 ? { index: anchorIdx, length: rawMatch.length } : undefined
    );
    if (!ctx.isValid && ctx.score < 8) {
      rejected.push({ code, reason: `low-context(${ctx.score})` });
      return;
    }

    if (
      (patternName.startsWith('provider') || patternName === 'styled-code') &&
      !ctx.relationshipGraph.hasInstructionVerb &&
      !ctx.relationshipGraph.hasCodeLabel
    ) {
      baseConfidence = Math.min(baseConfidence, 58);
    }

    const zoneRefIndex = htmlIndex >= 0 ? htmlIndex : anchorIdx >= 0 ? anchorIdx : 0;
    const zone = getZoneForPosition(zones, zoneRefIndex);
    const isolationScore = calculateIsolationScore(
      code,
      fullText,
      htmlBody,
      anchorIdx >= 0 ? anchorIdx : 0,
      rawMatch
    );

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
      formatMatch: provider
        ? provider.otpFormat === 'numeric'
          ? /^\d+$/.test(code)
          : true
        : /^\d+$/.test(code),
      surroundingText: sliceAround(fullText, anchorIdx, rawMatch.length, 80),
      instructionVerb: ctx.relationshipGraph.hasInstructionVerb ? 'yes' : null,
      validityPeriod: ctx.relationshipGraph.hasValidityPeriod ? 'yes' : null,
      securityWarning: ctx.relationshipGraph.hasSecurityWarning,
      isolationScore,
      matchedKeywordCount: ctx.matchedKeywords.length,
      rawScore: 0,
    });
  };

  // Strategy 1: Provider-specific patterns
  if (provider?.otpLength) {
    const rx =
      provider.otpFormat === 'numeric'
        ? new RegExp(`(?<!\\d)\\d{${provider.otpLength}}(?!\\d)`, 'g')
        : new RegExp(`(?<![A-Za-z0-9])[A-Za-z0-9]{${provider.otpLength}}(?![A-Za-z0-9])`, 'g');
    let m: RegExpExecArray | null;
    while ((m = rx.exec(fullText)) !== null) {
      addCandidate(m[0], m[0], `provider-${provider.name}`, 80, m.index);
    }
  }

  // Strategy 2: Styled codes in HTML
  if (htmlBody) {
    for (const rx of STYLED_CODE_PATTERNS) {
      rx.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rx.exec(decodedHtml)) !== null) {
        const code = m[1]!.replace(/[\s-]/g, '').trim();
        if (!/\d/.test(code)) {
          continue;
        }
        addCandidate(code, m[1]!.trim(), 'styled-code', 68, m.index);
      }
    }
  }

  // Strategy 3: Knowledge base patterns
  for (const pattern of KnowledgeBase.otpPatterns) {
    const rx = new RegExp(
      pattern.pattern.source,
      pattern.pattern.flags.includes('g') ? pattern.pattern.flags : pattern.pattern.flags + 'g'
    );
    let m: RegExpExecArray | null;
    while ((m = rx.exec(fullText)) !== null) {
      const raw = m[0];
      const clean = raw.replace(/[-\s]/g, '');
      addCandidate(clean, raw, pattern.name, pattern.baseConfidence, m.index);
      if (m.index === rx.lastIndex) {
        rx.lastIndex++;
      }
    }
  }

  // Strategy 4: Label-adjacent codes
  for (const rx of LABEL_PATTERNS) {
    rx.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(fullText)) !== null) {
      // matchIndex points at the captured code, not the whole match, so context
      // anchoring stays accurate.
      const captured = m[1]?.trim() ?? '';
      const capIdx = captured ? m.index + m[0].indexOf(captured) : m.index;
      addCandidate(captured, captured, 'label-adjacent', 72, capIdx);
      if (m.index === rx.lastIndex) {
        rx.lastIndex++;
      }
    }
  }

  // Strategy 5: Semantic token proximity
  // FIX: the old token regex was /\b([a-zA-Z]+|\d{4,10})\b/ which can NEVER
  // capture an alphanumeric token, so the "allow alphanumeric like Epic Games"
  // branch was dead code. We now capture mixed tokens and classify them.
  {
    const tokenRegex = /\b([A-Za-z0-9]{4,10})\b/g;
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
    let m: RegExpExecArray | null;
    while ((m = tokenRegex.exec(fullText)) !== null) {
      const raw = m[1] ?? '';
      const lowered = raw.toLowerCase();
      const isPureDigits = /^\d{4,10}$/.test(raw);
      const isAlnumCode = /[A-Za-z]/.test(raw) && /\d/.test(raw);
      tokens.push({
        text: raw,
        isNumeric: isPureDigits || isAlnumCode,
        isAnchor: intentAnchors.has(lowered),
        pos: m.index,
      });
    }

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!tok?.isNumeric) {
        continue;
      }
      let highestGravity = 0;
      const windowStart = Math.max(0, i - 10);
      const windowEnd = Math.min(tokens.length - 1, i + 10);
      for (let j = windowStart; j <= windowEnd; j++) {
        if (i === j) {
          continue;
        }
        if (tokens[j]?.isAnchor) {
          const distance = Math.abs(i - j);
          highestGravity = Math.max(highestGravity, 100 / (distance * 1.5));
        }
      }
      if (highestGravity > 45) {
        const nearby = sliceAround(fullText, tok.pos, tok.text.length, 30);
        const hasExplicitLabel = /(?:code|otp|pin|passcode|password)\b/i.test(nearby);
        if (!hasExplicitLabel) {
          continue;
        }
        const semanticConfidence = Math.min(55 + highestGravity / 2, 70);
        addCandidate(tok.text, tok.text, 'semantic-proximity', semanticConfidence, tok.pos);
      }
    }
  }

  // ══════════════════════════════════════════
  //  Strategy 6: HTML <td>/<th> Cell-Isolated Number Detection
  //  Finds numbers that appear alone inside a table cell — the dominant
  //  pattern used by Stripe, Auth0, Notion, Twilio, and many other SaaS
  //  transactional email templates.
  // ══════════════════════════════════════════
  if (htmlBody) {
    // Pattern: <td ...>   123456   </td> (with optional whitespace/entities)
    const tdPattern = /<(?:td|th)[^>]*>\s*([\d]{4,8})\s*<\/(?:td|th)>/gi;
    let tdMatch: RegExpExecArray | null;
    while ((tdMatch = tdPattern.exec(htmlBody)) !== null) {
      const code = tdMatch[1]!.trim();
      // Check sibling / surrounding rows contain an OTP keyword
      const surroundHtml = htmlBody.substring(
        Math.max(0, tdMatch.index - 600),
        Math.min(htmlBody.length, tdMatch.index + tdMatch[0].length + 600)
      );
      const hasNearbyKeyword = /(?:code|otp|pin|passcode|verification|security|confirm|authenticate|login|sign.?in)/i.test(
        surroundHtml
      );
      const cellConfidence = hasNearbyKeyword ? 92 : 75;
      // Plain text position for context scoring
      const ptIdx = fullText.indexOf(code);
      addCandidate(code, code, 'td-cell-isolated', cellConfidence, ptIdx >= 0 ? ptIdx : 0);
    }
  }

  if (candidates.length === 0) {
    log.debug(
      `No OTP candidates. Rejected: ${rejected.map((r) => `${r.code}(${r.reason})`).join(', ') || 'none'}`
    );
    return null;
  }

  // Score and rank candidates.
  // FIX: context signals (instruction verb, validity, security, semantic
  // distance, zone, footer) are folded into ctx.score exactly ONCE here via a
  // single capped contribution, instead of being added a second (and for zones,
  // third) time as in the original.
  for (const c of candidates) {
    let score = c.confidence;
    if (c.providerMatch) {
      score += CONFIG.scoring.providerLengthMatch;
    }
    if (c.lengthMatch) {
      score += CONFIG.scoring.lengthMatch;
    }
    if (provider && c.formatMatch) {
      score += CONFIG.scoring.formatMatch;
    }

    score += Math.min(c.contextScore, CONFIG.scoring.contextContributionMax);
    score += Math.min(c.isolationScore / 5, CONFIG.scoring.isolationBonusMax);

    if (intent.intent === 'verification') {
      score += CONFIG.scoring.verificationIntentBonus;
    }

    if (c.zone === 'footer') {
      score -= 22;
    } else if (c.zone === 'header' || c.zone === 'preheader') {
      score -= 8;
    } else if (c.zone === 'unknown' && c.contextScore < 18) {
      score -= 5;
    }

    if (
      !c.providerMatch &&
      !['label-adjacent', 'td-cell-isolated', 'td-isolated-number', 'heading-isolated-number', 'centered-paragraph-number'].includes(c.patternName) &&
      !c.instructionVerb &&
      !c.validityPeriod &&
      !c.securityWarning &&
      c.matchedKeywordCount < 2
    ) {
      score -= 14;
    }

    score -= CONFIG.scoring.antiPenalty[c.antiPatternResult.severity] ?? 0;

    // Bonus for strong alphanumeric OTPs (Steam, Epic Games, etc.)
    // Must have >= 3 uppercase letters AND >= 3 digits to qualify
    const hasAlnumBonus = /[A-Z]{3,}/.test(c.code) && /\d{3,}/.test(c.code);
    if (hasAlnumBonus) {
      score += 15;
    }

    // FIX: rank by the UNCLAMPED score. The original clamped every candidate to
    // 100 BEFORE sorting, so two strong candidates (a real OTP and, e.g., a phone
    // fragment that also sits near OTP keywords) both saturated at 100 and the tie
    // silently fell to whichever pattern happened to run first.
    c.rawScore = Math.max(score, 0);
    c.confidence = Math.min(c.rawScore, 100);
  }

  candidates.sort((a, b) => b.rawScore - a.rawScore);
  const best = candidates[0];
  if (!best) {
    return null;
  }

  const runnerUp = candidates[1];
  if (runnerUp && best.code !== runnerUp.code) {
    const margin = best.rawScore - runnerUp.rawScore;
    if (margin < 12) {
      best.ambiguous = true;
      best.rawScore = Math.min(best.rawScore, 49);
      best.confidence = Math.min(best.confidence, 49);
      log.warn('OTP ambiguous; lowering confidence for review', {
        best: `${best.code}(${best.rawScore.toFixed(1)})`,
        runnerUp: `${runnerUp.code}(${runnerUp.rawScore.toFixed(1)})`,
        margin: margin.toFixed(1),
      });
    }
  }

  const matchedSignals: OTPSignal[] = [];
  if (best.instructionVerb) {
    matchedSignals.push({
      name: 'instruction-verb',
      points: 8,
      layer: 'context',
      detail: 'Email contains verification instructions',
    });
  }
  if (best.validityPeriod) {
    matchedSignals.push({
      name: 'validity-period',
      points: 6,
      layer: 'context',
      detail: 'Email specifies code validity period',
    });
  }
  if (best.securityWarning) {
    matchedSignals.push({
      name: 'security-warning',
      points: 6,
      layer: 'context',
      detail: 'Email warning not to share code',
    });
  }
  if (best.matchedKeywordCount > 0) {
    matchedSignals.push({
      name: 'context-keywords',
      points: Math.min(best.contextScore, CONFIG.scoring.contextContributionMax),
      layer: 'context',
      detail: `Matched context keywords: ${best.matchedKeywordCount}`,
    });
  }
  if (best.isolationScore >= 40) {
    matchedSignals.push({
      name: 'visually-isolated',
      points: Math.min(best.isolationScore / 5, CONFIG.scoring.isolationBonusMax),
      layer: 'isolation',
      detail: 'Code is visually isolated or formatted prominent',
    });
  }
  if (best.providerMatch) {
    matchedSignals.push({
      name: 'provider-length-match',
      points: CONFIG.scoring.providerLengthMatch,
      layer: 'provider',
      detail: 'Length matches expectations for provider',
    });
  }

  const antiSignals: OTPSignal[] = best.antiPatternResult.reason
    ? [
        {
          name: best.antiPatternResult.reason,
          points: CONFIG.scoring.antiPenalty[best.antiPatternResult.severity] ?? 0,
          layer: 'anti-pattern',
          detail: `Anti-pattern match: ${best.antiPatternResult.reason} (${best.antiPatternResult.severity})`,
        },
      ]
    : [];

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
    strategy: strategyLabel(best.patternName),
    context: best.surroundingText,
    label: best.antiPatternResult.reason || null,
    fromUrl: false,
    urlParam: null,
    sourceUrl: null,
    visualProminence: best.zoneWeight * 100,
    providerMatch:
      provider && best.providerMatch
        ? {
            name: provider.name,
            expectedLength: provider.otpLength || 0,
            expectedFormat: provider.otpFormat || 'numeric',
            confidence: provider.confidence,
          }
        : null,
    matchedSignals,
    antiSignals,
    reasoning: {
      steps: [
        {
          layer: 'pattern-matching',
          observation: `Matched via ${best.patternName} strategy.`,
          conclusion: `Pattern confidence set to ${best.patternConfidence}%.`,
          impact: 'positive',
        },
        {
          layer: 'context-analysis',
          observation: `Context score is ${best.contextScore}, isolation is ${best.isolationScore}, semantic distance is ${best.semanticDistance === Infinity ? 'n/a' : best.semanticDistance}.`,
          conclusion: 'Overall context and visual isolation indicate a valid verification code.',
          impact: 'positive',
        },
        ...(best.ambiguous
          ? [
              {
                layer: 'ambiguity',
                observation: 'Another distinct OTP candidate scored within the ambiguity margin.',
                conclusion: 'Confidence lowered so automation can route this email to review.',
                impact: 'negative' as const,
              },
            ]
          : []),
        ...(antiSignals.length
          ? [
              {
                layer: 'anti-pattern',
                observation: `Matched anti-pattern: ${antiSignals.map((s) => s.name).join(', ')}.`,
                conclusion: 'Penalty applied for matching year or other false-positive indicator.',
                impact: 'negative' as const,
              },
            ]
          : []),
      ],
      summary: `Extracted '${best.code}' via ${strategyLabel(best.patternName)}.`,
      confidenceExplanation: `Final score ${best.confidence.toFixed(0)}% after context, isolation and anti-pattern adjustments.`,
    },
  };
}
