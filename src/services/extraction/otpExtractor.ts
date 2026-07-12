// src/services/extraction/otpExtractor.ts
// ══════════════════════════════════════════
//  OTP EXTRACTION ENGINE v3 (grandmaster)
//  Multi-strategy · Never-wrong · Alnum-safe
// ══════════════════════════════════════════
import { createLogger } from '../../utils/logger';
import { KnowledgeBase } from './knowledge';
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

const SEVERITY_RANK: Record<string, number> = {
  critical: 4, high: 3, medium: 2, low: 1, none: 0,
};

const CONFIG = {
  scoring: {
    // Heavier rewards for real OTP context → stronger winner separation
    providerLengthMatch: 22,
    lengthMatch: 15,
    formatMatch: 10,
    contextContributionMax: 65,
    isolationBonusMax: 22,
    verificationIntentBonus: 18,
    codeLabelBonus: 28,
    entropyBonusMax: 20,
    frequencyBonus: 14,
    alnumQualityBonus: 18,
    antiPenalty: {
      critical: 100, high: 22, medium: 14, low: 7, none: 0,
    } as Record<string, number>,
  },
  limits: {
    minCodeLength: 4,
    maxCodeLength: 10,
  },
  context: {
    nearRadius: 100,
    midRadius: 240,
    wideRadius: 480,
    nearWeight: 1.0,
    midWeight: 0.65,
    wideWeight: 0.35,
  },
  // Short numeric codes need stronger evidence (years/zips/pins collide).
  shortCodeMinContext: 18,
  // Absolute floor before a candidate can ever win.
  absoluteMinRawScore: 32,
} as const;

// ══════════════════════════════════════════
//  INTERNAL HELPERS
// ══════════════════════════════════════════

function sliceAround(text: string, index: number, length: number, radius: number): string {
  if (!text || index < 0) return '';
  return text.slice(Math.max(0, index - radius), Math.min(text.length, index + length + radius));
}

function isInsideUrlLikeSpan(text: string, index: number, length: number): boolean {
  if (!text || index < 0) return false;

  const start = Math.max(0, index - 160);
  const window = text.slice(start, Math.min(text.length, index + length + 160));
  const localIndex = index - start;
  const localEnd = localIndex + Math.max(length, 1);
  const urlRegex = /https?:\/\/[^\s<>"')\]}]+/gi;
  let m: RegExpExecArray | null;

  while ((m = urlRegex.exec(window)) !== null) {
    const urlStart = m.index;
    const urlEnd = m.index + m[0].length;
    if (localIndex >= urlStart && localEnd <= urlEnd) return true;
  }

  const before = window.slice(Math.max(0, localIndex - 50), localIndex).toLowerCase();
  return /(?:[?&#/]|%3[fba]|&amp;)[a-z0-9_.-]{1,40}=$/i.test(before);
}

/** Shannon-ish entropy — random OTPs score higher than 111111 / ABABAB. */
function codeEntropy(code: string): number {
  if (!code) return 0;
  const freq = new Map<string, number>();
  for (const ch of code) freq.set(ch, (freq.get(ch) || 0) + 1);
  let h = 0;
  for (const c of freq.values()) {
    const p = c / code.length;
    h -= p * Math.log2(p);
  }
  // Normalize roughly to 0–1 for typical 4–8 char codes (max entropy log2(36)≈5.17)
  return Math.min(h / 3.5, 1);
}

/** Quality score for alphanumeric OTPs (Steam/Epic/Discord style). */
function alnumQuality(code: string): number {
  const hasUpper = /[A-Z]/.test(code);
  const hasLower = /[a-z]/.test(code);
  const hasDigit = /\d/.test(code);
  const letters = (code.match(/[A-Za-z]/g) || []).length;
  const digits = (code.match(/\d/g) || []).length;
  if (!hasDigit || letters === 0) return 0;

  let q = 0;
  // Mixed character classes are strong OTP signals
  if (hasDigit && (hasUpper || hasLower)) q += 8;
  if (hasUpper && hasDigit) q += 6;
  if (digits >= 2 && letters >= 2) q += 6;
  // Avoid dictionary-looking pure words with a trailing digit (e.g. "code1")
  if (/^[A-Za-z]{4,}\d$/.test(code)) q -= 10;
  // Avoid hex-color-like
  if (/^[0-9a-f]{6}$/i.test(code) && !hasUpper) q -= 4;
  return q;
}

function isPlausibleOtpShape(code: string): boolean {
  if (code.length < CONFIG.limits.minCodeLength || code.length > CONFIG.limits.maxCodeLength) {
    return false;
  }
  // Must contain at least one digit — pure words are never OTPs
  if (!/\d/.test(code)) return false;
  // Reject pure hex colors with #
  if (code.startsWith('#')) return false;
  // Reject mostly-separator garbage
  if ((code.match(/[A-Za-z0-9]/g) || []).length < 4) return false;
  return true;
}

// ══════════════════════════════════════════
//  PATTERN DEFINITIONS
// ══════════════════════════════════════════
const STYLED_CODE_PATTERNS = [
  /<(?:span|div|p|td|strong|b|h[1-6])[^>]*(?:style\s*=\s*["'][^"']*(?:font-size\s*:\s*(?:1[8-9]|[2-9]\d|1\d{2})|font-weight\s*:\s*(?:bold|[6-9]\d\d)|letter-spacing)[^"']*["'][^>]*)>\s*([A-Za-z0-9]{4,10}|[A-Za-z0-9 -]{4,15})\s*<\//gi,
  /<(?:code|pre|tt|samp|kbd)[^>]*>\s*([A-Za-z0-9]{4,10})\s*<\/(?:code|pre|tt|samp|kbd)>/gi,
] as const;

const LABEL_PATTERNS = [
  // Explicit label + colon/equals
  /(?:code|pin|otp|password|token|passcode|verification\s+code|security\s+code|confirmation\s+code|auth\s+code|login\s+code|access\s+code)\s*(?:is|:|=)\s*([A-Za-z0-9]{4,10})/gi,
  // "Enter X to verify"
  /(?:enter|use|type|input|submit|copy|provide)\s+([A-Za-z0-9]{4,10})\s+to\s+(?:verify|confirm|log\s*in|sign\s*in|authenticate|complete|access)/gi,
  // "X is your code/OTP"
  /\b([A-Za-z0-9]{4,10})\s+(?:is your|is the|as your)\s+(?:\w+\s+){0,2}(?:code|pin|otp|password|verification|passcode)/gi,
  // "Your code is X"
  /\byour\s+(?:\w+\s+){0,3}(?:code|otp|pin|passcode|token)\s+is\s+([A-Za-z0-9]{4,10})/gi,
  // type-prefixed
  /(?:confirmation|verification|security|one.?time|login|sign.?in|access|authentication)\s+code\s*[-:–—]?\s*([A-Za-z0-9]{4,10})\b/gi,
  // bracket-wrapped
  /[\[({]\s*([A-Za-z0-9]{4,10})\s*[\])}]/g,
  // line-start labels
  /(?:^|[.!?\n]\s*)(?:code|pin|otp|token|passcode)\s*[:=]\s*([A-Za-z0-9]{4,10})\b/gim,
  // standalone number on its own line
  /^\s*(\d{4,8})\s*$/gm,
  // dash/space separated groups (123 456 / 12-34-56 / AB-12-CD)
  /(?:code|pin|otp|passcode|token)\s*[:\s]\s*([A-Za-z0-9][A-Za-z0-9\s-]{2,14}[A-Za-z0-9])/gi,
  // Multilingual common labels
  /(?:código|kennwort|code de|認証コード|验证码|인증번호|код|رمز|كود|şifre)\s*(?:is|:|=|は|为|：)?\s*([A-Za-z0-9]{4,10})/gi,
] as const;

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
  {
    name: 'phone',
    test: (v) => /^[+]?\d[\d\s()-]{9,14}$/.test(v) || /^\d{10,11}$/.test(v),
    severity: 'high',
    reject: true,
  },
  {
    name: 'year',
    test: (v, ctx, idx) => {
      if (!/^(?:19|20)\d{2}$/.test(v)) return false;
      const before =
        idx !== undefined && idx >= 0
          ? sliceAround(ctx, idx, v.length, 15).toLowerCase().substring(0, 15)
          : getContextAround(ctx, v, 15).toLowerCase().split(v)[0] || '';
      if (/(?:©|copyright|\(c\)|copr\.)/.test(before)) return true;
      const near =
        idx !== undefined && idx >= 0
          ? sliceAround(ctx, idx, v.length, 40).toLowerCase()
          : getContextAround(ctx, v, 40).toLowerCase();
      // Hard reject year unless OTP language is RIGHT next to it
      return !/(?:code|pin|otp|password|token|passcode|verification)/.test(near);
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
      return /[$€£¥₹]/.test(around) || /(?:price|cost|total|amount|fee|usd|eur|subtotal)/i.test(around);
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
      /\b(?:coupon|promo|discount|voucher|referral|offer|gift\s*card)\s*(?:code|pin|token|#)?\b/i.test(
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
  {
    name: 'repeated',
    test: (v) => /^(\d)\1{3,}$/.test(v) || /^(.)\1{4,}$/i.test(v),
    severity: 'critical',
    reject: true,
  },
  {
    name: 'sequential',
    test: (v, ctx, idx) => {
      const d = v.replace(/\D/g, '');
      if (d.length < 4 || d.length !== v.length) return false; // only pure-digit sequential
      let asc = true;
      let desc = true;
      for (let i = 1; i < d.length; i++) {
        if (parseInt(d[i]!, 10) !== (parseInt(d[i - 1]!, 10) + 1) % 10) asc = false;
        if (parseInt(d[i]!, 10) !== (parseInt(d[i - 1]!, 10) - 1 + 10) % 10) desc = false;
      }
      if (!(asc || desc)) return false;
      // Soft: only hard-reject sequential when NO otp language nearby
      const near =
        idx !== undefined && idx >= 0
          ? sliceAround(ctx, idx, v.length, 50).toLowerCase()
          : getContextAround(ctx, v, 50).toLowerCase();
      return !/(?:code|pin|otp|password|token|passcode|verification|enter|use)/.test(near);
    },
    severity: 'high',
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
  // Long pure-digit strings that look like IDs (9+ digits already filtered by max length,
  // but 8-digit with no OTP context is suspicious)
  {
    name: 'bare-id-no-context',
    test: (v, ctx, idx) => {
      if (!/^\d{8,10}$/.test(v)) return false;
      const near =
        idx !== undefined && idx >= 0
          ? sliceAround(ctx, idx, v.length, 60).toLowerCase()
          : getContextAround(ctx, v, 60).toLowerCase();
      return !/(?:code|pin|otp|password|token|passcode|verification|enter|use|your)/.test(near);
    },
    severity: 'medium',
  },
];

// ══════════════════════════════════════════
//  ANTI-PATTERN CHECKING
// ══════════════════════════════════════════

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

  for (const anti of KnowledgeBase.antiPatterns) {
    const fresh = new RegExp(anti.pattern.source, anti.pattern.flags.replace('g', ''));
    if (!fresh.test(value)) continue;

    if (anti.name === 'year-4digit' || anti.name === 'year-2digit') {
      const near =
        valueIndex !== undefined && valueIndex >= 0
          ? sliceAround(fullText, valueIndex, value.length, 30).toLowerCase()
          : getContextAround(fullText, value, 30).toLowerCase();
      if (/(?:code|pin|otp|password|token|passcode)/.test(near)) continue;
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

  const CONTEXTUAL_REJECT = new Set(['order', 'tracking', 'reference', 'account', 'promo-code']);
  for (const anti of EXTENDED_ANTI_PATTERNS) {
    if (!anti.test(value, fullText, valueIndex)) continue;
    const shouldReject =
      anti.reject === true || anti.severity === 'critical' || CONTEXTUAL_REJECT.has(anti.name);
    consider(
      { isRejected: shouldReject, reason: anti.name, severity: anti.severity, pattern: anti.name },
      shouldReject
    );
  }

  if (rejectHit) return rejectHit;
  if (penaltyHit) return penaltyHit;
  return { isRejected: false, reason: '', severity: 'none', pattern: '' };
}

// ══════════════════════════════════════════
//  CONTEXT VALIDATION
// ══════════════════════════════════════════

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
  if (htmlValIdx === -1) htmlValIdx = valIdx;

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

  const terms =
    category === 'otp'
      ? ['code', 'otp', 'pin', 'verification', 'password', 'token', 'passcode', '2fa', 'mfa']
      : ['verify', 'confirm', 'activate', 'click', 'button', 'link', 'reset'];
  let semanticDistance = Infinity;
  if (valIdx !== -1) {
    for (const term of terms) {
      let from = 0;
      let tIdx = lower.indexOf(term, from);
      while (tIdx !== -1) {
        const d = Math.abs(tIdx - valIdx);
        if (d < semanticDistance) semanticDistance = d;
        from = tIdx + term.length;
        tIdx = lower.indexOf(term, from);
      }
    }
  }

  if (semanticDistance < 40) score += 14;
  else if (semanticDistance < 100) score += 9;
  else if (semanticDistance < 200) score += 5;

  const rg: RelationshipGraph = {
    hasInstructionVerb: /(?:enter|use|type|input|provide|submit|copy|paste|click|tap|press)/i.test(nearCtx),
    hasUrgencyIndicator: /(?:now|immediately|urgent|asap|expire|quickly|hurry)/i.test(midCtx),
    hasValidityPeriod:
      /(?:valid for|expires? in|good for|active for|\d+\s*(?:min|hour|day|second))/i.test(midCtx),
    hasSecurityWarning:
      /(?:do not share|don't share|never share|confidential|keep.*(?:safe|secure|private))/i.test(midCtx),
    hasCodeLabel: false,
    hasCTAProximity: false,
  };

  if (rg.hasInstructionVerb) score += 8;
  if (rg.hasValidityPeriod) score += 6;
  if (rg.hasSecurityWarning) score += 6;

  if (category === 'otp' && valIdx > 0) {
    const before = fullText.substring(Math.max(0, valIdx - 80), valIdx);
    if (
      /(?:code|pin|otp|password|token|passcode|verification|security|confirmation)\s*(?:is|:|=|–|—|-)?\s*$/i.test(
        before
      )
    ) {
      rg.hasCodeLabel = true;
      score += CONFIG.scoring.codeLabelBonus;
    }

    if (decodedHtml) {
      const htmlValIdxLocal = decodedHtml.toLowerCase().indexOf(value.toLowerCase());
      if (htmlValIdxLocal !== -1) {
        const htmlCtx = decodedHtml.substring(
          Math.max(0, htmlValIdxLocal - 200),
          Math.min(decodedHtml.length, htmlValIdxLocal + value.length + 200)
        );
        const beforeHtml = htmlCtx.substring(0, htmlCtx.toLowerCase().indexOf(value.toLowerCase()));
        const afterHtml = htmlCtx.substring(
          htmlCtx.toLowerCase().indexOf(value.toLowerCase()) + value.length
        );

        if (/<h[123][^>]*>\s*[^<]*$/i.test(beforeHtml) && /^[^<]*\s*<\/h[123]>/i.test(afterHtml)) {
          score += 30;
          rg.hasCodeLabel = true;
        }
        if (/<(?:strong|b)\b[^>]*>\s*$/i.test(beforeHtml) && /^\s*<\/(?:strong|b)>/i.test(afterHtml)) {
          score += 20;
        }
        if (/<(?:td|th)[^>]*>\s*$/i.test(beforeHtml) && /^\s*<\/(?:td|th)>/i.test(afterHtml)) {
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

  if (matched.length >= 5) score += 15;
  else if (matched.length >= 3) score += 10;
  else if (matched.length >= 2) score += 5;

  if (htmlValIdx !== -1) {
    const zone = getZoneForPosition(zones, htmlValIdx);
    if (zone) {
      if (zone.zone === 'body-primary' || zone.zone === 'cta') score += 8;
      else if (zone.zone === 'footer') score -= 15;
      else if (zone.zone === 'preheader') score += 3;
    }
  }

  // Short pure-numeric codes need a higher bar
  const isShortNumeric = /^\d{4,5}$/.test(value);
  const threshold = category === 'otp'
    ? (isShortNumeric ? CONFIG.shortCodeMinContext : 18)
    : 22;

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
// ══════════════════════════════════════════
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
  if (line === code || line === (rawMatch ?? code)) score += 40;
  else if (line.length < code.length * 3) score += 20;

  const before = pos > 0 ? (text[pos - 1] ?? ' ') : ' ';
  const after = pos + code.length < text.length ? (text[pos + code.length] ?? ' ') : ' ';
  if (/\s/.test(before) && /\s/.test(after)) score += 15;

  if (html) {
    let htmlIdx = rawMatch ? html.indexOf(rawMatch) : -1;
    if (htmlIdx === -1) htmlIdx = html.indexOf(code);
    if (htmlIdx !== -1) {
      const surrounding = html.substring(
        Math.max(0, htmlIdx - 250),
        Math.min(html.length, htmlIdx + code.length + 60)
      );
      if (/letter-spacing/i.test(surrounding)) score += 25;
      if (/font-size\s*:\s*(?:1[8-9]|[2-9]\d|1\d{2})/i.test(surrounding)) score += 20;
      if (/font-weight\s*:\s*(?:bold|[6-9]\d\d)/i.test(surrounding)) score += 15;
      if (/<(?:strong|b)\b/i.test(surrounding)) score += 15;
      if (/text-align\s*:\s*center/i.test(surrounding)) score += 10;
      if (/<(?:code|pre|tt|samp|kbd)\b/i.test(surrounding)) score += 20;
    }
  }

  return Math.min(score, 100);
}

function strategyLabel(patternName: string): ExtractionStrategy {
  if (patternName.startsWith('provider')) return 'explicit-label';
  if (patternName === 'styled-code' || patternName === 'td-cell-isolated') return 'html-prominent';
  if (patternName === 'label-adjacent') return 'explicit-label';
  if (patternName === 'semantic-proximity') return 'proximity-inference';
  return 'explicit-label';
}

interface ExtractedOTPCandidate extends OTPCandidate {
  rawScore: number;
  matchedKeywordCount: number;
  ambiguous?: boolean;
  occurrenceCount?: number;
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
  const occurrenceCounts = new Map<string, number>();

  const addCandidate = (
    code: string,
    rawMatch: string,
    patternName: string,
    baseConfidence: number,
    matchIndex: number
  ) => {
    // Normalize separators out of spaced/dashed codes
    const cleanCode = code.replace(/[\s-]/g, '').trim();
    if (!isPlausibleOtpShape(cleanCode)) return;

    occurrenceCounts.set(cleanCode, (occurrenceCounts.get(cleanCode) || 0) + 1);

    const existing = candidates.find((c) => c.code === cleanCode);
    if (existing) {
      // Upgrade strategy if stronger; always keep highest base confidence
      if (baseConfidence > existing.patternConfidence) {
        existing.confidence = baseConfidence;
        existing.patternConfidence = baseConfidence;
        existing.patternName = patternName;
      }
      return;
    }

    let plainTextIndex: number;
    let htmlIndex: number;
    if (patternName === 'styled-code') {
      htmlIndex = matchIndex;
      plainTextIndex = fullText.indexOf(cleanCode);
      if (plainTextIndex === -1) {
        plainTextIndex = fullText.toLowerCase().indexOf(cleanCode.toLowerCase());
      }
    } else {
      plainTextIndex = matchIndex;
      htmlIndex = decodedHtml.indexOf(rawMatch);
      if (htmlIndex === -1) htmlIndex = decodedHtml.indexOf(cleanCode);
    }

    const anchorIdx = plainTextIndex >= 0 ? plainTextIndex : -1;
    if (isInsideUrlLikeSpan(fullText, anchorIdx, rawMatch.length || cleanCode.length)) {
      rejected.push({ code: cleanCode, reason: 'url-token' });
      return;
    }

    const anti = checkAntiPatterns(cleanCode, fullText, anchorIdx);
    if (anti.isRejected) {
      rejected.push({ code: cleanCode, reason: anti.reason });
      return;
    }

    const ctx = validateContext(
      cleanCode,
      fullText,
      'otp',
      zones,
      decodedHtml,
      anchorIdx >= 0 ? { index: anchorIdx, length: rawMatch.length || cleanCode.length } : undefined
    );

    // Short codes without context die here
    const isShort = cleanCode.length <= 5 && /^\d+$/.test(cleanCode);
    const minCtx = isShort ? 8 : 6;
    if (!ctx.isValid && ctx.score < minCtx) {
      rejected.push({ code: cleanCode, reason: `low-context(${ctx.score})` });
      return;
    }

    let conf = baseConfidence;
    if (
      (patternName.startsWith('provider') || patternName === 'styled-code') &&
      !ctx.relationshipGraph.hasInstructionVerb &&
      !ctx.relationshipGraph.hasCodeLabel
    ) {
      conf = Math.min(conf, 58);
    }

    const zoneRefIndex = htmlIndex >= 0 ? htmlIndex : anchorIdx >= 0 ? anchorIdx : 0;
    const zone = getZoneForPosition(zones, zoneRefIndex);
    const isolationScore = calculateIsolationScore(
      cleanCode,
      fullText,
      htmlBody,
      anchorIdx >= 0 ? anchorIdx : 0,
      rawMatch
    );

    candidates.push({
      code: cleanCode,
      rawMatch,
      confidence: conf,
      zone: zone?.zone || 'unknown',
      zoneWeight: zone?.weight || 0.5,
      patternName,
      patternConfidence: conf,
      contextScore: ctx.score,
      semanticDistance: ctx.semanticDistance,
      antiPatternResult: anti,
      providerMatch: provider?.otpLength === cleanCode.length,
      lengthMatch: provider?.otpLength === cleanCode.length,
      formatMatch: provider
        ? provider.otpFormat === 'numeric'
          ? /^\d+$/.test(cleanCode)
          : true
        : /^\d+$/.test(cleanCode) || (/[A-Za-z]/.test(cleanCode) && /\d/.test(cleanCode)),
      surroundingText: sliceAround(fullText, anchorIdx, rawMatch.length || cleanCode.length, 80),
      instructionVerb: ctx.relationshipGraph.hasInstructionVerb ? 'yes' : null,
      validityPeriod: ctx.relationshipGraph.hasValidityPeriod ? 'yes' : null,
      securityWarning: ctx.relationshipGraph.hasSecurityWarning,
      isolationScore,
      matchedKeywordCount: ctx.matchedKeywords.length,
      rawScore: 0,
      occurrenceCount: 1,
    });
  };

  // ── Strategy 1: Provider-specific ──────────────────────────────────────
  if (provider?.otpLength) {
    const rx =
      provider.otpFormat === 'numeric'
        ? new RegExp(`(?<!\\d)\\d{${provider.otpLength}}(?!\\d)`, 'g')
        : new RegExp(
            `(?<![A-Za-z0-9])[A-Za-z0-9]{${provider.otpLength}}(?![A-Za-z0-9])`,
            'g'
          );
    let m: RegExpExecArray | null;
    while ((m = rx.exec(fullText)) !== null) {
      addCandidate(m[0], m[0], `provider-${provider.name}`, 82, m.index);
    }
  }

  // ── Strategy 2: Styled HTML codes ──────────────────────────────────────
  if (htmlBody) {
    for (const rx of STYLED_CODE_PATTERNS) {
      rx.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rx.exec(decodedHtml)) !== null) {
        const code = m[1]!.replace(/[\s-]/g, '').trim();
        if (!/\d/.test(code)) continue;
        addCandidate(code, m[1]!.trim(), 'styled-code', 70, m.index);
      }
    }
  }

  // ── Strategy 3: Knowledge base patterns ────────────────────────────────
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
      if (m.index === rx.lastIndex) rx.lastIndex++;
    }
  }

  // ── Strategy 4: Label-adjacent ─────────────────────────────────────────
  for (const rx of LABEL_PATTERNS) {
    rx.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(fullText)) !== null) {
      const captured = (m[1] ?? '').replace(/[\s-]/g, '').trim();
      if (!captured) continue;
      const capIdx = m.index + m[0].indexOf(m[1]!.trim());
      addCandidate(captured, m[1]!.trim(), 'label-adjacent', 75, capIdx >= 0 ? capIdx : m.index);
      if (m.index === rx.lastIndex) rx.lastIndex++;
    }
  }

  // ── Strategy 5: Semantic proximity (FIXED: captures alnum) ─────────────
  {
    const tokenRegex = /\b([A-Za-z0-9]{4,10})\b/g;
    const intentAnchors = new Set([
      'code', 'pin', 'otp', 'password', 'passcode', 'verification',
      'verify', 'login', 'authenticate', 'security', 'token', '2fa', 'mfa',
    ]);
    const tokens: Array<{
      text: string;
      isNumeric: boolean;
      isAnchor: boolean;
      pos: number;
    }> = [];
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
      if (!tok?.isNumeric) continue;
      let highestGravity = 0;
      const windowStart = Math.max(0, i - 10);
      const windowEnd = Math.min(tokens.length - 1, i + 10);
      for (let j = windowStart; j <= windowEnd; j++) {
        if (i === j) continue;
        if (tokens[j]?.isAnchor) {
          const distance = Math.abs(i - j);
          highestGravity = Math.max(highestGravity, 100 / (distance * 1.5));
        }
      }
      if (highestGravity > 45) {
        const nearby = sliceAround(fullText, tok.pos, tok.text.length, 30);
        const hasExplicitLabel = /(?:code|otp|pin|passcode|password|token)\b/i.test(nearby);
        if (!hasExplicitLabel) continue;
        const semanticConfidence = Math.min(55 + highestGravity / 2, 72);
        addCandidate(tok.text, tok.text, 'semantic-proximity', semanticConfidence, tok.pos);
      }
    }
  }

  // ── Strategy 6: TD/TH cell isolation ───────────────────────────────────
  if (htmlBody) {
    const tdPattern = /<(?:td|th)[^>]*>\s*([A-Za-z0-9]{4,10})\s*<\/(?:td|th)>/gi;
    let tdMatch: RegExpExecArray | null;
    while ((tdMatch = tdPattern.exec(htmlBody)) !== null) {
      const code = tdMatch[1]!.trim();
      if (!/\d/.test(code)) continue;
      const surroundHtml = htmlBody.substring(
        Math.max(0, tdMatch.index - 600),
        Math.min(htmlBody.length, tdMatch.index + tdMatch[0].length + 600)
      );
      const hasNearbyKeyword =
        /(?:code|otp|pin|passcode|verification|security|confirm|authenticate|login|sign.?in)/i.test(
          surroundHtml
        );
      const cellConfidence = hasNearbyKeyword ? 93 : 76;
      const ptIdx = fullText.indexOf(code);
      addCandidate(code, code, 'td-cell-isolated', cellConfidence, ptIdx >= 0 ? ptIdx : 0);
    }
  }

  // ── Strategy 7: Spaced / dashed digit groups without label ─────────────
  // e.g. "7 8 9 5 4 5" or "AB-12-CD" common in modern emails
  {
    const spacedRx = /(?:^|[\s>])((?:\d[-\s]){3,9}\d)(?:[\s<]|$)/gm;
    let m: RegExpExecArray | null;
    while ((m = spacedRx.exec(fullText)) !== null) {
      const raw = m[1]!.trim();
      const clean = raw.replace(/[\s-]/g, '');
      if (clean.length >= 4 && clean.length <= 10) {
        addCandidate(clean, raw, 'spaced-digit-group', 60, m.index);
      }
    }
  }

  if (candidates.length === 0) {
    log.debug(
      `No OTP candidates. Rejected: ${rejected.map((r) => `${r.code}(${r.reason})`).join(', ') || 'none'}`
    );
    return null;
  }

  // Attach occurrence counts
  for (const c of candidates) {
    c.occurrenceCount = occurrenceCounts.get(c.code) || 1;
  }

  // ── Score & rank ───────────────────────────────────────────────────────
  for (const c of candidates) {
    let score = c.confidence;

    if (c.providerMatch) score += CONFIG.scoring.providerLengthMatch;
    if (c.lengthMatch) score += CONFIG.scoring.lengthMatch;
    if (provider && c.formatMatch) score += CONFIG.scoring.formatMatch;

    score += Math.min(c.contextScore, CONFIG.scoring.contextContributionMax);
    score += Math.min(c.isolationScore / 5, CONFIG.scoring.isolationBonusMax);

    if (intent.intent === 'verification') score += CONFIG.scoring.verificationIntentBonus;

    // Entropy / randomness — real OTPs look random
    const ent = codeEntropy(c.code);
    score += Math.round(ent * CONFIG.scoring.entropyBonusMax);

    // Alphanumeric quality
    const aq = alnumQuality(c.code);
    score += Math.min(aq, CONFIG.scoring.alnumQualityBonus);

    // Frequency consensus — same code seen via multiple strategies/locations
    if ((c.occurrenceCount || 1) >= 2) score += CONFIG.scoring.frequencyBonus;
    if ((c.occurrenceCount || 1) >= 3) score += 6;

    // Zone penalties
    if (c.zone === 'footer') score -= 22;
    else if (c.zone === 'header' || c.zone === 'preheader') score -= 8;
    else if (c.zone === 'unknown' && c.contextScore < 18) score -= 5;

    // Weak-signal penalty
    if (
      !c.providerMatch &&
      !['label-adjacent', 'td-cell-isolated', 'styled-code'].includes(c.patternName) &&
      !c.instructionVerb &&
      !c.validityPeriod &&
      !c.securityWarning &&
      c.matchedKeywordCount < 2
    ) {
      score -= 14;
    }

    // Short numeric without strong label: heavy penalty
    if (
      /^\d{4,5}$/.test(c.code) &&
      !c.instructionVerb &&
      c.matchedKeywordCount < 1 &&
      c.isolationScore < 30
    ) {
      score -= 20;
    }

    score -= CONFIG.scoring.antiPenalty[c.antiPatternResult.severity] ?? 0;

    // Strong alnum (Steam/Epic style): ≥3 upper + ≥2 digits
    if (/[A-Z]{2,}/.test(c.code) && /\d{2,}/.test(c.code) && /[A-Za-z]/.test(c.code)) {
      score += 12;
    }

    c.rawScore = Math.max(score, 0);
    c.confidence = Math.min(c.rawScore, 100);
  }

  candidates.sort((a, b) => b.rawScore - a.rawScore);
  const best = candidates[0];
  if (!best) return null;

  // Absolute floor — refuse to return garbage
  if (best.rawScore < CONFIG.absoluteMinRawScore) {
    log.debug(`Best candidate ${best.code} below absolute floor (${best.rawScore.toFixed(1)})`);
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
      name: 'instruction-verb', points: 8, layer: 'context',
      detail: 'Email contains verification instructions',
    });
  }
  if (best.validityPeriod) {
    matchedSignals.push({
      name: 'validity-period', points: 6, layer: 'context',
      detail: 'Email specifies code validity period',
    });
  }
  if (best.securityWarning) {
    matchedSignals.push({
      name: 'security-warning', points: 6, layer: 'context',
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
  if ((best.occurrenceCount || 1) >= 2) {
    matchedSignals.push({
      name: 'multi-occurrence',
      points: CONFIG.scoring.frequencyBonus,
      layer: 'consensus',
      detail: `Code appeared ${best.occurrenceCount} times in email`,
    });
  }

  const antiSignals: OTPSignal[] = best.antiPatternResult.reason
    ? [{
        name: best.antiPatternResult.reason,
        points: CONFIG.scoring.antiPenalty[best.antiPatternResult.severity] ?? 0,
        layer: 'anti-pattern',
        detail: `Anti-pattern match: ${best.antiPatternResult.reason} (${best.antiPatternResult.severity})`,
      }]
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
          ? [{
              layer: 'ambiguity',
              observation: 'Another distinct OTP candidate scored within the ambiguity margin.',
              conclusion: 'Confidence lowered so automation can route this email to review.',
              impact: 'negative' as const,
            }]
          : []),
        ...(antiSignals.length
          ? [{
              layer: 'anti-pattern',
              observation: `Matched anti-pattern: ${antiSignals.map((s) => s.name).join(', ')}.`,
              conclusion: 'Penalty applied for matching year or other false-positive indicator.',
              impact: 'negative' as const,
            }]
          : []),
      ],
      summary: `Extracted '${best.code}' via ${strategyLabel(best.patternName)}.`,
      confidenceExplanation: `Final score ${best.confidence.toFixed(0)}% after context, isolation and anti-pattern adjustments.`,
    },
  };
}
