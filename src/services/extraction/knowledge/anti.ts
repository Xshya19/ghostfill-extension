// src/services/extraction/data/antiPatternDatabase.ts
// ═══════════════════════════════════════════════════════════════════════
//  ANTI-PATTERN DATABASE  —  OTP false-positive rejection
// ═══════════════════════════════════════════════════════════════════════
//
// These patterns describe number-like strings that LOOK like OTPs but aren't
// (dates, phones, money, IDs, …). `reject: true` is a HARD reject; `reject:
// false` is a context-aware penalty handled in otpExtractor.checkAntiPatterns.
//
// ⚠️ CRITICAL USAGE NOTE: every `pattern` here is a shared, module-level RegExp
// and many carry the `g` flag. A raw `pattern.test(x)` / `pattern.exec(x)` on a
// `g`-flag regex mutates `lastIndex`, so repeated calls on the SAME object
// return alternating true/false. ALWAYS test through `matchesAntiPattern()`
// (below), which resets `lastIndex` first.

import type { AntiPattern } from '../../types/extraction.types';

export const ANTI_PATTERN_DATABASE: AntiPattern[] = [
  // ── YEARS — context-aware ONLY (never hard-reject; "2024"/"1999" are valid OTPs) ──
  {
    pattern: /\b(?:19|20)\d{2}\b/g,
    name: 'year-4digit',
    reject: false, // FIX: was true → hard-rejected every 4-digit code in 1900–2099
    description: '4-digit year (1900–2099) — context-aware penalty, not a hard reject',
    severity: 'medium',
  },
  {
    pattern: /\b\d{2}\b(?![-\d])/g,
    name: 'year-2digit',
    reject: false,
    description: '2-digit year — context-aware penalty only',
    severity: 'low',
  },

  // ── DATES (all formats) ──
  {
    pattern: /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g,
    name: 'date-us',
    reject: true,
    description: 'Numeric date (US/EU; - / . separators)',
    severity: 'critical',
  },
  {
    pattern: /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/g,
    name: 'date-iso',
    reject: true,
    description: 'ISO date (YYYY-MM-DD)',
    severity: 'critical',
  },
  {
    pattern:
      /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?,?\s+\d{2,4}\b/gi,
    name: 'date-text-month',
    reject: true,
    description: 'Date with trailing text month (e.g. "5 Jan 2024")',
    severity: 'critical',
  },
  {
    pattern:
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{2,4}\b/gi,
    name: 'date-month-first',
    reject: true,
    description: 'Date with leading text month (e.g. "Jan 5, 2024")',
    severity: 'critical',
  },
  {
    pattern: /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?\b/g,
    name: 'datetime-iso',
    reject: true,
    description: 'ISO datetime / timestamp',
    severity: 'high',
  },

  // ── PHONE NUMBERS ──
  {
    pattern: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    name: 'phone-us',
    reject: true,
    description: 'US phone format',
    severity: 'critical',
  },
  {
    pattern: /\(\d{3}\)\s?\d{3}[-.\s]?\d{4}\b/g,
    name: 'phone-us-paren',
    reject: true,
    description: 'US phone with area-code parentheses',
    severity: 'critical',
  },
  {
    pattern: /(?:\+|\b00)\d[\d\s().-]{7,16}\d\b/g,
    name: 'phone-intl',
    reject: true,
    description: 'International phone (E.164-ish, 10–15 digits)',
    severity: 'critical',
  },

  // ── CURRENCY / FINANCIAL ──
  {
    pattern: /\$\s?[\d,]+(?:\.\d{1,2})?/g,
    name: 'money-usd',
    reject: true,
    description: 'USD amount',
    severity: 'critical',
  },
  {
    pattern: /€\s?[\d,]+(?:\.\d{1,2})?/g,
    name: 'money-eur',
    reject: true,
    description: 'Euro amount',
    severity: 'critical',
  },
  {
    pattern: /£\s?[\d,]+(?:\.\d{1,2})?/g,
    name: 'money-gbp',
    reject: true,
    description: 'GBP amount',
    severity: 'critical',
  },
  {
    pattern: /[¥₹]\s?[\d,]+(?:\.\d{1,2})?/g,
    name: 'money-other',
    reject: true,
    description: 'JPY / INR amount',
    severity: 'critical',
  },
  {
    pattern: /\b[\d,]+(?:\.\d{1,2})?\s?(?:USD|EUR|GBP|JPY|INR|CAD|AUD|dollars?|euros?|pounds?)\b/gi,
    name: 'money-suffix',
    reject: true,
    description: 'Amount with trailing currency code/word (e.g. "100 USD")',
    severity: 'critical',
  },
  {
    pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{1,4}\b/g,
    name: 'credit-card',
    reject: true,
    description: 'Credit/debit card (13–16 digits, incl. Amex/Diners)',
    severity: 'critical',
  },

  // ── IDENTIFIERS ──
  {
    pattern: /\b[A-Z0-9]{32,}\b/gi,
    name: 'hash-uuid',
    reject: true,
    description: 'Long hash / opaque token (≥32 chars, case-insensitive)',
    severity: 'high',
  },
  {
    pattern: /\b[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}\b/gi,
    name: 'uuid-standard',
    reject: true,
    description: 'Standard UUID',
    severity: 'high',
  },
  {
    pattern: /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g,
    name: 'ssn-us',
    reject: true,
    description: 'US SSN (separated, so it cannot swallow a 9-digit code)',
    severity: 'critical',
  },

  // ── OTHER FALSE POSITIVES ──
  {
    pattern: /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g,
    name: 'ip-address',
    reject: true,
    description: 'IPv4 address (octet-validated 0–255)',
    severity: 'high',
  },
  {
    pattern: /\b\d+(?:\.\d+)?\s?%/g,
    name: 'percentage',
    reject: true,
    description: 'Percentage',
    severity: 'medium',
  },
  {
    pattern: /\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:[AP]M)?\b/gi,
    name: 'time-format',
    reject: true,
    description: 'Clock time (HH:MM[:SS] [AM/PM])',
    severity: 'medium',
  },
  {
    pattern: /\b\d+(?:\.\d+)?\s?(?:bytes?|[KMGT]B|[KMGT]iB)\b/gi,
    name: 'file-size',
    reject: true,
    description: 'File size',
    severity: 'medium',
  },
  {
    pattern: /\b\d{5}(?:[-\s]\d{4})?\b/g,
    name: 'zip-code',
    reject: false, // FIX: was true → hard-rejected EVERY standalone 5-digit OTP
    description: 'US ZIP / ZIP+4 — context-aware penalty only (5-digit OTPs are common)',
    severity: 'low',
  },
];

// ═══════════════════════════════════════════════════════════════════════
//  SAFE MATCH HELPERS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Safely tests a value against an anti-pattern, resetting `lastIndex` first so
 * the shared `g`-flag RegExp objects can't leak state between calls.
 */
export function matchesAntiPattern(value: string, p: AntiPattern): boolean {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }
  p.pattern.lastIndex = 0;
  return p.pattern.test(value);
}

/**
 * Returns the first HARD-reject (`reject: true`) anti-pattern that matches the
 * value, or null. Use this for the definitive "is this definitely not an OTP"
 * check; `reject: false` patterns are intentionally ignored here and should be
 * applied as soft penalties by the caller.
 */
export function isHardRejected(value: string): AntiPattern | null {
  for (const p of ANTI_PATTERN_DATABASE) {
    if (p.reject && matchesAntiPattern(value, p)) {
      return p;
    }
  }
  return null;
}

/** Returns every anti-pattern (hard or soft) that matches the value. */
export function findAntiPatterns(value: string): AntiPattern[] {
  return ANTI_PATTERN_DATABASE.filter((p) => matchesAntiPattern(value, p));
}
