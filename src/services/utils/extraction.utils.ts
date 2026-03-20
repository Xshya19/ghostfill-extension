// ═══════════════════════════════════════════════════════════════════════
//  GHOSTFILL SHARED UTILITIES
//  Common utility functions for extraction modules
//  Zero dependencies on other service modules
// ═══════════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────────
//  HTML PROCESSING UTILITIES
// ───────────────────────────────────────────────────────────────────────

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
  result = result.replace(/&#x([0-9a-fA-F]+);/gi, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );

  // Decimal entities
  result = result.replace(/&#(\d+);/gi, (_, dec) => String.fromCharCode(parseInt(dec, 10)));

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

/**
 * Truncate text to a maximum length with ellipsis
 */
export function truncate(text: string, maxLength: number, suffix: string = '...'): string {
  if (!text || text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - suffix.length) + suffix;
}

// ───────────────────────────────────────────────────────────────────────
//  URL UTILITIES
// ───────────────────────────────────────────────────────────────────────

/**
 * Check if a string is a valid HTTP/HTTPS URL
 */
export function isValidUrl(url: string): boolean {
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
