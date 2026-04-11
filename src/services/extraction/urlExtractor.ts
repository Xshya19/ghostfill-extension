// src/services/extraction/urlExtractor.ts
// ═══════════════════════════════════════════════════════════════════════
//  URL EXTRACTION ENGINE
//  8-Layer Deep URL Unwrapping & Validation
// ═══════════════════════════════════════════════════════════════════════

import { createLogger } from '../../utils/logger';

import type { LimitConfig } from '../types/extraction.types';

const log = createLogger('URLExtractor');

// ═══════════════════════════════════════════════════════════════════════
//  CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════

const CONFIG = {
  limits: {
    minUrlLength: 10,
    maxRedirectDepth: 5,
    minBase64Length: 20,
  },
} as const satisfies { limits: LimitConfig };

// ═══════════════════════════════════════════════════════════════════════
//  URL PATTERN CONSTANTS
// ═══════════════════════════════════════════════════════════════════════

/** HTML attribute patterns for URL extraction */
const ATTR_URL_PATTERNS = [
  /href\s*=\s*["']([^"']{10,})["']/gi,
  /href\s*=\s*([^\s>"']{10,})/gi,
  /src\s*=\s*["']([^"']{10,})["']/gi,
  /action\s*=\s*["']([^"']{10,})["']/gi,
  /data-(?:href|url|link|redirect|target|action)\s*=\s*["']([^"']{10,})["']/gi,
  /content\s*=\s*["']\d+;\s*url=([^"']{10,})["']/gi,
] as const;

/** Tracking domain patterns that typically wrap destination URLs */
const TRACKING_DOMAIN_PATTERNS = [
  /^click\./i,
  /^links?\./i,
  /^track(?:ing)?\./i,
  /^go\./i,
  /^redirect\./i,
  /^email\./i,
  /^e\./i,
  /^t\./i,
  /^r\./i,
  /^cl\./i,
  /^lnk\./i,
  /^trk\./i,
] as const;

/** Common redirect parameter names */
const REDIRECT_PARAMS = [
  'url',
  'redirect',
  'redirect_uri',
  'redirect_url',
  'target',
  'dest',
] as const;

/** Static resource extensions to exclude */
const STATIC_RESOURCE_PATTERN =
  /\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|css|webp|avif|bmp|tiff?|js)(\?|$)/i;

/** Invalid URL schemes to exclude */
const INVALID_URL_SCHEMES =
  /^(mailto:|tel:|sms:|#|javascript:|data:|blob:|file:|chrome:|about:|cid:|ftp:)/i;

/** HTML entity map for decoding */
const HTML_ENTITY_MAP: Record<string, string> = {
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
} as const;

/** Zero-width and invisible characters */
const ZERO_WIDTH_CHARS = /[\u00AD\u200B-\u200D\uFEFF]/g;

// ═══════════════════════════════════════════════════════════════════════
//  HTML DECODING UTILITIES
// ═══════════════════════════════════════════════════════════════════════

/**
 * Decodes HTML entities in a string
 * @param html - The HTML string to decode
 * @returns The decoded plain text string
 */
export function decodeHtmlEntities(html: string): string {
  if (!html) {
    return '';
  }

  let result = html;

  // Named entities
  for (const [entity, char] of Object.entries(HTML_ENTITY_MAP)) {
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
  return result.replace(ZERO_WIDTH_CHARS, '');
}

// ═══════════════════════════════════════════════════════════════════════
//  URL VALIDATION
// ═══════════════════════════════════════════════════════════════════════

/**
 * Validates if a string is a valid HTTP(S) URL
 * @param url - The URL string to validate
 * @returns True if valid, false otherwise
 */
export function isValidUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }
  if (url.length < CONFIG.limits.minUrlLength) {
    return false;
  }
  if (INVALID_URL_SCHEMES.test(url)) {
    return false;
  }
  if (!/^https?:\/\//i.test(url)) {
    return false;
  }

  try {
    const parsed = new URL(url);
    if (
      parsed.hostname !== 'localhost' &&
      (!parsed.hostname.includes('.') || parsed.hostname.split('.').pop()!.length < 2)
    ) {
      return false;
    }
    if (STATIC_RESOURCE_PATTERN.test(parsed.pathname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes a URL by removing tracking parameters
 * @param url - The URL to normalize
 * @returns The normalized URL
 */
export function normalizeUrl(url: string): string {
  const JUNK_PARAMS = [
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
    JUNK_PARAMS.forEach((p) => u.searchParams.delete(p));
    return u.toString();
  } catch {
    return url;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  TRACKING URL UNWRAPPING
// ═══════════════════════════════════════════════════════════════════════

/**
 * Unwraps tracking URLs to find the final destination
 * @param url - The tracking URL to unwrap
 * @param depth - Current recursion depth
 * @returns The unwrapped URL or null if not a tracking URL
 */
export function unwrapTrackingUrl(url: string, depth: number = 0): string | null {
  if (depth > CONFIG.limits.maxRedirectDepth) {
    log.warn(`URL unwrap exceeded max depth: ${url.substring(0, 80)}...`);
    return null;
  }

  try {
    const u = new URL(url);

    // Check redirect params
    for (const param of REDIRECT_PARAMS) {
      const value = u.searchParams.get(param);
      if (value) {
        if (/^https?:\/\//i.test(value)) {
          return value;
        }
        try {
          const decoded = decodeURIComponent(value);
          if (/^https?:\/\//i.test(decoded)) {
            return decoded;
          }
        } catch {
          // Skip invalid encoded values
        }
      }
    }

    // Check for base64-encoded URLs
    for (const value of Array.from(u.searchParams.values())) {
      if (/^[A-Za-z0-9+/=]{20,}$/.test(value)) {
        try {
          const decoded = atob(value);
          if (/^https?:\/\//i.test(decoded) && isValidUrl(decoded)) {
            return decoded;
          }
        } catch {
          // Not base64
        }
      }
    }
  } catch {
    // Invalid URL
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════
//  URL EXTRACTION (8-LAYER DEEP)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Extracts all URLs from HTML content using 8-layer deep analysis
 * @param html - The HTML content to extract URLs from
 * @returns Array of unique, validated URLs
 */
export function extractUrls(html: string): string[] {
  if (!html || typeof html !== 'string') {
    log.debug('extractUrls: Invalid input');
    return [];
  }

  const urls = new Set<string>();
  const decoded = decodeHtmlEntities(html);

  // Layer 1: Attribute extraction
  for (const regex of ATTR_URL_PATTERNS) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(decoded)) !== null) {
      processUrl(decodeHtmlEntities(match[1]?.trim() ?? ''), urls);
    }
  }

  // Layer 2: Plain text URLs
  const textUrlRegex = /https?:\/\/[^\s<>"'\])}]+/gi;
  let match;
  while ((match = textUrlRegex.exec(decoded)) !== null) {
    const url = match[0].replace(/[.,;!?\])}>]+$/, '');
    processUrl(url, urls);
  }

  // Layer 3: JSON-escaped URLs
  const escapedRegex = /https?:\\\/\\\/(?:[^\s"'\\]|\\\/)+/gi;
  while ((match = escapedRegex.exec(decoded)) !== null) {
    processUrl(match[0].replace(/\\\//g, '/').trim(), urls);
  }

  // Layer 4: Outlook SafeLinks
  const safeRegex = /safelinks\.protection\.outlook\.com[^"'\s]*[?&]url=([^&"'\s]+)/gi;
  while ((match = safeRegex.exec(decoded)) !== null) {
    try {
      processUrl(decodeURIComponent(match[1] ?? ''), urls);
    } catch {
      // Skip invalid URLs
    }
  }

  // Layer 5: Google redirects
  const googlePatterns = [
    /google\.com\/url\?[^"'\s]*?[?&](?:url|q)=([^&"'\s]+)/gi,
    /google\.com\/amp\/s\/([^"'\s&]+)/gi,
  ];
  for (const regex of googlePatterns) {
    while ((match = regex.exec(decoded)) !== null) {
      try {
        let url = decodeURIComponent(match[1] ?? '');
        if (!/^https?:\/\//i.test(url)) {
          url = 'https://' + url;
        }
        processUrl(url, urls);
      } catch {
        // Skip invalid URLs
      }
    }
  }

  // Layer 6: Deep unwrap tracking URLs
  for (const url of [...urls]) {
    try {
      const u = new URL(url);
      if (TRACKING_DOMAIN_PATTERNS.some((p) => p.test(u.hostname))) {
        const inner = unwrapTrackingUrl(url, 0);
        if (inner && inner !== url) {
          urls.add(inner);
        }

        // Check path for encoded URLs
        const pathDecoded = decodeURIComponent(u.pathname + u.search);
        const found = pathDecoded.match(/https?:\/\/[^\s"']+/gi);
        if (found) {
          for (const f of found) {
            if (isValidUrl(f)) {
              urls.add(f);
            }
          }
        }
      }
    } catch {
      // Skip invalid URLs
    }
  }

  // Layer 7: Line-broken URLs
  const brokenRegex = /https?:\/\/[^\s<"']*[\r\n]+[^\s<"']*/gi;
  while ((match = brokenRegex.exec(decoded)) !== null) {
    processUrl(match[0].replace(/[\r\n\s]+/g, '').trim(), urls);
  }

  // Layer 8: URL fragments and hash-based routing
  for (const url of [...urls]) {
    try {
      const u = new URL(url);
      if (u.hash && u.hash.length > 10) {
        const hashContent = u.hash.substring(1);
        if (/^[A-Za-z0-9_-]{20,}$/.test(hashContent)) {
          // Likely a token in hash - keep the URL as-is
          continue;
        }
        // Check for URL in hash
        if (/^https?:\/\//i.test(hashContent)) {
          processUrl(hashContent, urls);
        }
      }
    } catch {
      // Skip invalid URLs
    }
  }

  if (urls.size === 0) {
    log.warn(
      'Extracted 0 unique URLs. RAW HTML START:\n' + html.substring(0, 1500) + '\nRAW HTML END'
    );
  } else {
    log.debug(`Extracted ${urls.size} unique URLs`);
  }
  return Array.from(urls);
}

/**
 * Processes a URL and adds it to the set if valid
 * @param url - The URL to process
 * @param set - The set to add the URL to
 */
function processUrl(url: string, set: Set<string>): void {
  if (!isValidUrl(url)) {
    return;
  }
  set.add(url);

  const inner = unwrapTrackingUrl(url, 0);
  if (inner && inner !== url && isValidUrl(inner)) {
    set.add(inner);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  URL PARAMETER ANALYSIS
// ═══════════════════════════════════════════════════════════════════════

const TOKEN_PARAMS = [
  'token',
  'auth_token',
  'access_token',
  'jwt',
  'session',
  'hash',
  'key',
  'secret',
  'nonce',
  'bearer',
  'auth',
  'id_token',
  'state',
  'flow',
];
const CODE_PARAMS = [
  'code',
  'confirmation_code',
  'verify_code',
  'auth_code',
  'otp',
  'response_code',
  'activation_code',
  'link_code',
];
const EXPIRY_PARAMS = ['expires', 'expiry', 'exp', 'ttl', 'valid_until', 'timestamp'];
const SIG_PARAMS = ['signature', 'sig', 'sign', 'hmac', 'hash', 'checksum', 'digest'];
const USER_PARAMS = ['user', 'user_id', 'uid', 'email', 'account', 'username'];

/**
 * Analyzes URL parameters for authentication tokens and codes
 * @param url - The URL to analyze
 * @returns Analysis result with parameter flags
 */
export function analyzeUrlParams(url: string): {
  hasToken: boolean;
  hasCode: boolean;
  hasExpiry: boolean;
  hasSignature: boolean;
  hasUserId: boolean;
  tokenLength: number;
  totalParams: number;
  suspiciousParams: string[];
} {
  try {
    const u = new URL(url);
    let hasToken = false;
    let hasCode = false;
    let hasExpiry = false;
    let hasSignature = false;
    let hasUserId = false;
    let tokenLength = 0;

    for (const [k, v] of u.searchParams) {
      const lk = k.toLowerCase();
      if (TOKEN_PARAMS.some((t) => lk.includes(t))) {
        hasToken = true;
        tokenLength = Math.max(tokenLength, v.length);
      }
      if (CODE_PARAMS.some((c) => lk.includes(c))) {
        hasCode = true;
      }
      if (EXPIRY_PARAMS.some((e) => lk.includes(e))) {
        hasExpiry = true;
      }
      if (SIG_PARAMS.some((s) => lk.includes(s))) {
        hasSignature = true;
      }
      if (USER_PARAMS.some((up) => lk.includes(up))) {
        hasUserId = true;
      }
    }

    // Check path segments for tokens
    for (const seg of u.pathname.split('/').filter(Boolean)) {
      if (/^[A-Za-z0-9_-]{20,}$/.test(seg)) {
        hasToken = true;
        tokenLength = Math.max(tokenLength, seg.length);
      }
    }

    return {
      hasToken,
      hasCode,
      hasExpiry,
      hasSignature,
      hasUserId,
      tokenLength,
      totalParams: [...u.searchParams].length,
      suspiciousParams: [],
    };
  } catch {
    return {
      hasToken: false,
      hasCode: false,
      hasExpiry: false,
      hasSignature: false,
      hasUserId: false,
      tokenLength: 0,
      totalParams: 0,
      suspiciousParams: [],
    };
  }
}

/**
 * Calculates URL complexity score based on structure
 * @param url - The URL to analyze
 * @returns Complexity score (0-100)
 */
export function calculateUrlComplexity(url: string): number {
  let complexity = 0;
  try {
    const u = new URL(url);
    complexity += u.pathname.split('/').filter(Boolean).length * 5;
    complexity += Math.min(u.search.length / 5, 30);
    complexity += u.searchParams.toString().split('&').length * 3;
    for (const seg of u.pathname.split('/')) {
      if (/^[A-Za-z0-9_-]{15,}$/.test(seg)) {
        complexity += 15;
      }
    }
    if (u.hash.length > 1) {
      complexity += 10;
    }
  } catch {
    // Skip invalid URLs
  }
  return Math.min(complexity, 100);
}
