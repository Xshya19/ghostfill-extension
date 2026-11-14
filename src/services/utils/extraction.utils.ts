// ═══════════════════════════════════════════════════════════════════════
//  GHOSTFILL SHARED UTILITIES
//  Common utility functions for extraction modules
//  Zero dependencies on other service modules
// ═══════════════════════════════════════════════════════════════════════

import { truncate } from '../../utils/core';

// ───────────────────────────────────────────────────────────────────────
//  HTML PROCESSING UTILITIES
// ───────────────────────────────────────────────────────────────────────

/**
 * Strip quoted reply/forward history from email text (2026-11-12).
 *
 * Why: quoted history repeats OLD verification codes. The extractor then
 * preferred the quoted copy of a stale code over the fresh one (observed:
 * with the history placed above the fresh message, the OLD code was
 * returned at 49% instead of the new one).
 *
 * Design — a small state machine over the message lines:
 * - `>`-prefixed lines are quoted history, always removed;
 * - a history marker ("On <date> … wrote:", Outlook/Gmail forward
 *   separators) opens a quoted region;
 * - inside a quoted region, header lines (From:/Sent:/To:/Subject:) and
 *   the quoted body are removed;
 * - a quoted region RESUMES at a paragraph break followed by a line that
 *   carries its own code label — that is a fresh message continuing after
 *   the quote (common in threads where the quote is on top). Without this
 *   resume rule the fresh code would be deleted along with the quote.
 *
 * Everything the stripper cannot classify with confidence is left in
 * place, and callers should verify that the stripped text still contains
 * a code before trusting it (see `hasFreshCodeSignal`).
 */
export function stripQuotedHistory(text: string): string {
  if (!text) {
    return text;
  }

  const lines = text.split('\n');
  const kept: string[] = [];

  // "On Mar 3, 2026, Alice <a@b.c> wrote:" — reply quoting.
  const wroteMarker = /^\s*On\b.{0,160}\bwrote:\s*$/i;
  // "-----Original Message-----" / "---------- Forwarded message ----------"
  const forwardMarker = /^\s*-{3,}\s*(?:original message|forwarded message|forwarded)\s*-{3,}\s*$/i;
  // Quoted-message header lines (Outlook style).
  const quoteHeader = /^\s*(?:from|sent|to|cc|subject|date|reply-to)\s*:/i;
  // A line that mentions a code — used for the resume rule.
  const codeLabel = /(?:code|otp|pin|passcode|verification|one[-\s]?time|security)/i;

  let inQuote = false;
  let quoteHadCode = false;
  let pendingBlank = false;

  for (const line of lines) {
    // Quoted lines are history in every layout. The upstream text
    // sanitizer encodes ">" as "&gt;", so both spellings must match.
    if (/^\s*(?:>|&gt;){1,}/i.test(line)) {
      if (codeLabel.test(line)) {
        quoteHadCode = true;
      }
      continue;
    }

    if (inQuote) {
      if (quoteHeader.test(line)) {
        continue; // header of the quoted message
      }
      if (!line.trim()) {
        pendingBlank = true;
        continue; // blank line inside the quoted message
      }
      // Resume point: a fresh paragraph carrying its own code label,
      // separated from the quoted message by a blank line.
      if (pendingBlank && quoteHadCode && codeLabel.test(line)) {
        inQuote = false;
        pendingBlank = false;
        kept.push(line);
        continue;
      }
      if (codeLabel.test(line)) {
        quoteHadCode = true;
      }
      pendingBlank = false;
      continue; // still inside the quoted message
    }

    if (wroteMarker.test(line) || forwardMarker.test(line)) {
      inQuote = true;
      quoteHadCode = false;
      pendingBlank = false;
      continue; // the marker itself is not content
    }

    kept.push(line);
  }

  return kept.join('\n');
}

/**
 * True when the text still carries a code statement of its own
 * ("your code is 482913", "verification code: 482913", …).
 *
 * Used to decide whether the quote-stripped text may be trusted: if the
 * fresh part of a message has no code, stripping would delete the ONLY
 * code in the message, so the original text must be used instead.
 */
export function hasFreshCodeSignal(text: string): boolean {
  if (!text) {
    return false;
  }
  // A code statement looks like a label followed (on the same line) by a
  // short token that contains at least one digit: "code is 555666",
  // "verification code: 482913", "otp 1234". Requiring a digit keeps
  // prose like "code is below" from being mistaken for a code.
  const re = /\b(?:code|otp|pin|passcode)\b[^\n]{0,12}?([0-9A-Za-z]{4,10})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (/[0-9]/.test(m[1] ?? '')) {
      return true;
    }
  }
  return false;
}

/**
 * Decode HTML entities to their character equivalents
 */
export function decodeHtmlEntities(html: string): string {
  if (!html) {
    return '';
  }

  const entityMap: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&rsquo;': "'",
    '&lsquo;': "'",
    '&rdquo;': '"',
    '&ldquo;': '"',
    '&mdash;': '—',
    '&ndash;': '–',
    '&hellip;': '…',
    '&trade;': '™',
    '&copy;': '©',
    '&reg;': '®',
    '&bull;': '•',
    '&middot;': '·',
    '&shy;': '',
  };

  let result = html;
  for (const [entity, char] of Object.entries(entityMap)) {
    const regex = new RegExp(entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    result = result.replace(regex, char);
  }

  // Hex entities
  result = result.replace(/&#x([0-9a-fA-F]+);/gi, (_, hex) => {
    const val = parseInt(hex, 16);
    return val >= 32 || val === 9 || val === 10 || val === 13 ? String.fromCharCode(val) : '';
  });

  // Decimal entities
  result = result.replace(/&#(\d+);/gi, (_, dec) => {
    const val = parseInt(dec, 10);
    return val >= 32 || val === 9 || val === 10 || val === 13 ? String.fromCharCode(val) : '';
  });

  // Strip zero-width characters
  return result.replace(/[\u00AD\u200B-\u200D\uFEFF]/g, '');
}

/**
 * Strip HTML tags and return plain text
 */
export function stripHtml(html: string): string {
  if (!html) {
    return '';
  }

  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, ' ')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strip HTML but preserve structure (newlines for block elements)
 */
export function stripHtmlPreserveStructure(html: string): string {
  if (!html) {
    return '';
  }

  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, '  ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<hr[^>]*>/gi, '\n---\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n /g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Get context window around a term in text
 */
export function getContextWindow(text: string, termIndex: number, radius: number = 150): string {
  if (!text || text.length === 0) {
    return '';
  }

  const start = Math.max(0, termIndex - radius);
  const end = Math.min(text.length, termIndex + radius);
  return text.substring(start, end);
}

/**
 * Get context around a search term
 */
export function getContextAround(text: string, term: string, radius: number = 150): string {
  if (!text || !term) {
    return '';
  }

  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) {
    return text.substring(0, radius * 2);
  }

  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + term.length + radius);
  return text.substring(start, end);
}

// ───────────────────────────────────────────────────────────────────────
//  STRING PROCESSING UTILITIES
// ───────────────────────────────────────────────────────────────────────

/**
 * Normalize a code by removing dashes and spaces
 */
export function normalizeCode(code: string): string {
  return code.replace(/[-\s]/g, '');
}

/**
 * Check if a string is primarily numeric
 */
export function isNumeric(str: string): boolean {
  return /^\d+$/.test(str.replace(/[-\s]/g, ''));
}

/**
 * Check if a string contains both letters and numbers
 */
export function isAlphanumeric(str: string): boolean {
  const cleaned = str.replace(/[-\s]/g, '');
  return /\d/.test(cleaned) && /[A-Za-z]/.test(cleaned);
}

/**
 * Escape special regex characters in a string
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export { truncate };

// ───────────────────────────────────────────────────────────────────────
//  URL UTILITIES
// ───────────────────────────────────────────────────────────────────────

/**
 * Check if a string is a valid HTTP/HTTPS URL
 */
export function isValidUrl(url: string, explicitLink = false): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }
  if (url.length < 10) {
    return false;
  }

  const invalidSchemes =
    /^(mailto:|tel:|sms:|#|javascript:|data:|blob:|file:|chrome:|about:|cid:|ftp:)/i;
  if (invalidSchemes.test(url)) {
    return false;
  }
  if (!/^https?:\/\//i.test(url)) {
    return false;
  }

  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost') {
      return false;
    }
    if (
      !explicitLink &&
      /\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|css|webp|avif|bmp|tiff?|js)(\?|$)/i.test(
        parsed.pathname
      )
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract domain from a URL
 */
export function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return null;
  }
}

/**
 * Get URL parameter value by name
 */
export function getUrlParam(url: string, paramName: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get(paramName);
  } catch {
    return null;
  }
}

/**
 * Check if URL contains any of the given parameters
 */
export function hasUrlParams(url: string, paramNames: string[]): string | null {
  for (const param of paramNames) {
    const value = getUrlParam(url, param);
    if (value) {
      return param;
    }
  }
  return null;
}

/**
 * Normalize URL by removing tracking parameters
 */
export function normalizeUrl(url: string): string {
  const junkParams = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'fbclid',
    'gclid',
    'mc_cid',
    'mc_eid',
    'ref',
    '_hsenc',
    '_hsmi',
    'trk',
    'trkCampaign',
    'sc_channel',
    'sc_campaign',
    'sc_content',
    'mkt_tok',
    'vero_id',
    'oly_enc_id',
    'oly_anon_id',
  ];

  try {
    const u = new URL(url);
    junkParams.forEach((p) => u.searchParams.delete(p));
    return u.toString();
  } catch {
    return url;
  }
}

// ───────────────────────────────────────────────────────────────────────
//  SCORING UTILITIES
// ───────────────────────────────────────────────────────────────────────

/**
 * Clamp a number between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Normalize a score to 0-1 range
 */
export function normalizeScore(score: number, minScore: number, maxScore: number): number {
  if (maxScore === minScore) {
    return 0.5;
  }
  return clamp((score - minScore) / (maxScore - minScore), 0, 1);
}

/**
 * Convert score to confidence (0-1)
 */
export function scoreToConfidence(score: number, threshold: number = 100): number {
  return clamp(score / threshold, 0, 1);
}

// ───────────────────────────────────────────────────────────────────────
//  EMAIL STRUCTURE UTILITIES
// ───────────────────────────────────────────────────────────────────────

const FOOTER_SIGNALS = [
  /unsubscribe/i,
  /email preferences/i,
  /privacy policy/i,
  /©\s*\d{4}/i,
  /all rights reserved/i,
  /no longer wish to receive/i,
  /manage.*(?:preferences|subscription)/i,
  /this email was sent/i,
  /you are receiving this/i,
  /update your preferences/i,
  /view in browser/i,
  /view this email/i,
  /<footer/i,
  /class\s*=\s*["'][^"']*footer[^"']*["']/i,
];

/**
 * Find the start position of email footer
 */
export function findFooterStart(html: string): number {
  const lower = html.toLowerCase();
  let earliest = -1;

  for (const signal of FOOTER_SIGNALS) {
    const m = lower.match(signal);
    if (m?.index !== undefined && m.index > lower.length * 0.6) {
      const blockStart = findBlockStart(lower, m.index);
      if (earliest === -1 || blockStart < earliest) {
        earliest = blockStart;
      }
    }
  }

  return earliest;
}

/**
 * Find the end position of email header
 */
export function findHeaderEnd(html: string): number {
  const signals = [/<h[12][^>]*>/i, /class\s*=\s*["'][^"']*(?:content|main|body)[^"']*["']/i];

  for (const signal of signals) {
    const m = html.match(signal);
    if (m?.index !== undefined && m.index < html.length * 0.3) {
      return m.index;
    }
  }

  return -1;
}

/**
 * Find the start of an HTML block element
 */
export function findBlockStart(html: string, idx: number): number {
  const tags = ['<table', '<div', '<tr', '<section', '<footer'];
  let best = idx;
  const searchStart = Math.max(0, idx - 500);

  for (const tag of tags) {
    const pos = html.lastIndexOf(tag, idx);
    if (pos >= searchStart && pos < best) {
      best = pos;
    }
  }

  return best;
}

// ───────────────────────────────────────────────────────────────────────
//  PERFORMANCE UTILITIES
// ───────────────────────────────────────────────────────────────────────

/**
 * Measure execution time of a function
 */
export function measureTime<T>(fn: () => T): { result: T; durationMs: number } {
  const start = performance.now();
  const result = fn();
  const durationMs = performance.now() - start;
  return { result, durationMs };
}

/**
 * Async version of measureTime
 */
export async function measureTimeAsync<T>(
  fn: () => Promise<T>
): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await fn();
  const durationMs = performance.now() - start;
  return { result, durationMs };
}

// ───────────────────────────────────────────────────────────────────────
//  DEDUPLICATION UTILITIES
// ───────────────────────────────────────────────────────────────────────

/**
 * Deduplicate an array using a key function
 */
export function deduplicateByKey<T>(array: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  return array.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Deduplicate strings (case-insensitive)
 */
export function deduplicateStrings(strings: string[]): string[] {
  const seen = new Set<string>();
  return strings.filter((s) => {
    const lower = s.toLowerCase();
    if (seen.has(lower)) {
      return false;
    }
    seen.add(lower);
    return true;
  });
}
