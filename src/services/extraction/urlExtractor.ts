// src/services/extraction/urlExtractor.ts
// ═══════════════════════════════════════════════════════════════════════
//  URL EXTRACTION ENGINE
//  8-Layer Deep URL Unwrapping & Validation
// ═══════════════════════════════════════════════════════════════════════

import { createLogger } from '../../utils/logger';
import type { LimitConfig } from '../types/extraction.types';
import { decodeHtmlEntities, isValidUrl, normalizeUrl } from '../utils/extraction.utils';

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

// Hard cap on how many URLs we will collect from a single email. Protects
// against adversarial/huge messages exploding memory and downstream work.
const MAX_URLS = 500;

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
  'u',
  'uri',
  'href',
  'link',
  'to',
  'r',
  'next',
  'continue',
  'continueurl',
  'continue_url',
  'return',
  'returnto',
  'returnurl',
  'return_to',
  'return_url',
  'redirect',
  'redirectto',
  'redirect_to',
  'redirecturl',
  'redirect_uri',
  'redirect_url',
  'target',
  'target_url',
  'dest',
  'destination',
] as const;

export { decodeHtmlEntities, isValidUrl, normalizeUrl };

// ═══════════════════════════════════════════════════════════════════════
//  TRACKING URL UNWRAPPING
// ═══════════════════════════════════════════════════════════════════════

/**
 * Unwraps tracking URLs to find the final destination.
 *
 * IMPROVEMENT: now genuinely recursive. Previously this function accepted a
 * `depth` parameter and `CONFIG.limits.maxRedirectDepth` existed, but it never
 * called itself — so nested wrappers (e.g. click.x?url=redirect.y?target=final)
 * were only unwrapped one hop and the depth guard was dead code. It now recurses
 * up to maxRedirectDepth, returning the deepest resolved destination.
 *
 * @param url - The tracking URL to unwrap
 * @param depth - Current recursion depth
 * @returns The unwrapped URL or null if not a tracking URL
 */
export function unwrapTrackingUrl(url: string, depth: number = 0): string | null {
  if (depth > CONFIG.limits.maxRedirectDepth) {
    log.warn(`URL unwrap exceeded max depth: ${url.substring(0, 80)}...`);
    return null;
  }

  let candidate: string | null = null;

  try {
    const u = new URL(url);

    // Check redirect params. URLSearchParams is case-sensitive, so compare
    // lowercased keys to catch real-world variants such as redirectTo/returnUrl.
    for (const [key, value] of u.searchParams) {
      const normalizedKey = key.toLowerCase().replace(/[-\s]/g, '_');
      if (!REDIRECT_PARAMS.some((param) => normalizedKey === param.toLowerCase())) {
        continue;
      }
      if (value) {
        if (/^https?:\/\//i.test(value)) {
          candidate = value;
          break;
        }
        try {
          const decoded = decodeURIComponent(value);
          if (/^https?:\/\//i.test(decoded)) {
            candidate = decoded;
            break;
          }
        } catch {
          // Skip invalid encoded values
        }
      }
    }

    // Check for base64-encoded URLs
    if (!candidate) {
      for (const value of Array.from(u.searchParams.values())) {
        if (/^[A-Za-z0-9+/_=-]{20,}$/.test(value)) {
          try {
            const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
            const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
            const decoded = atob(padded);
            if (/^https?:\/\//i.test(decoded) && isValidUrl(decoded)) {
              candidate = decoded;
              break;
            }
          } catch {
            // Not base64
          }
        }
      }
    }
  } catch {
    // Invalid URL
    return null;
  }

  if (!candidate) {
    return null;
  }

  // Recursively unwrap nested tracking wrappers. Guard against self-reference
  // so we never loop on a URL that "unwraps" to itself.
  if (candidate !== url) {
    const deeper = unwrapTrackingUrl(candidate, depth + 1);
    if (deeper && deeper !== candidate) {
      return deeper;
    }
  }

  return candidate;
}

/**
 * ESP-aware tracking URL unwrapper.
 * Handles major Email Service Provider (ESP) click-tracking redirect patterns.
 * Returns the embedded real destination URL, or null if the URL is not a known
 * ESP tracker. Unlike unwrapTrackingUrl (which handles generic redirect params),
 * this function understands ESP-specific hostname and parameter patterns for
 * SendGrid, Mailchimp, Mailgun, Postmark, HubSpot, Campaign Monitor,
 * Constant Contact, Klaviyo, Brevo/Sendinblue, and ActiveCampaign.
 */
export function unwrapEspTrackingUrl(url: string): string | null {
  if (!url || !url.startsWith('http')) {
    return null;
  }

  // First try the generic redirect param approach (covers most cases already)
  const generic = unwrapTrackingUrl(url, 0);
  if (generic && generic !== url) {
    return generic;
  }

  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();

    // SendGrid: click.sendgrid.net/wf/click?upn=... (base64) or ?l=url
    if (host.includes('sendgrid.net') || host.includes('.u.nr')) {
      const upn = u.searchParams.get('upn');
      if (upn) {
        try {
          const decoded = atob(upn.replace(/-/g, '+').replace(/_/g, '/'));
          if (decoded.startsWith('http')) return decoded;
        } catch { /* not base64 */ }
      }
      const dest = u.searchParams.get('l') || u.searchParams.get('url') || u.searchParams.get('redirectTo');
      if (dest?.startsWith('http')) return decodeURIComponent(dest);
    }

    // Mailchimp / Mandrill
    if (host.includes('list-manage.com') || host.includes('mailchi.mp') || host.includes('mc.sendgrid.net')) {
      const dest = u.searchParams.get('url') || u.searchParams.get('u');
      if (dest) {
        const decoded = decodeURIComponent(dest);
        if (decoded.startsWith('http')) return decoded;
      }
    }

    // Mailgun: email.mg.*, click.em.*
    if (/(?:^|\.)(?:mg\.[^.]+\.[^.]+|email\.mg\.|click\.em\.)/.test(host)) {
      const pathParts = u.pathname.split('/').filter(Boolean);
      for (const part of pathParts) {
        if (part.length > 30) {
          try {
            const decoded = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
            if (decoded.startsWith('http')) return decoded;
          } catch { /* not base64 */ }
        }
      }
      const dest = u.searchParams.get('p') || u.searchParams.get('url') || u.searchParams.get('redirect');
      if (dest?.startsWith('http')) return decodeURIComponent(dest);
    }

    // Postmark
    if (host.includes('postmarkapp.com') || host.includes('pm.mtasv.net')) {
      const dest = u.searchParams.get('url') || u.searchParams.get('p');
      if (dest?.startsWith('http')) return decodeURIComponent(dest);
    }

    // HubSpot
    if (host.includes('hubspot') || host.includes('hs-email') || host.includes('hubspotemail')) {
      const dest = u.searchParams.get('url') || u.searchParams.get('redirect') || u.searchParams.get('q');
      if (dest?.startsWith('http')) return decodeURIComponent(dest);
    }

    // Campaign Monitor
    if (host.includes('campaignmonitor') || host.includes('cmail') || host.includes('createsend')) {
      const dest = u.searchParams.get('url') || u.searchParams.get('l');
      if (dest?.startsWith('http')) return decodeURIComponent(dest);
    }

    // Klaviyo
    if (host.includes('klaviyo')) {
      const dest = u.searchParams.get('url') || u.searchParams.get('cl');
      if (dest?.startsWith('http')) return decodeURIComponent(dest);
    }

    // Brevo / Sendinblue
    if (host.includes('brevo.com') || host.includes('sendinblue.com') || host.includes('sibpages.com')) {
      const dest = u.searchParams.get('url') || u.searchParams.get('d') || u.searchParams.get('l');
      if (dest?.startsWith('http')) return decodeURIComponent(dest);
    }

    // Constant Contact
    if (host.includes('constantcontact') || host.includes('click.cc.email')) {
      const dest = u.searchParams.get('url') || u.searchParams.get('d');
      if (dest?.startsWith('http')) return decodeURIComponent(dest);
    }

    // ActiveCampaign
    if (host.includes('activecampaign') || host.includes('lt.ac-email')) {
      const dest = u.searchParams.get('url') || u.searchParams.get('l');
      if (dest?.startsWith('http')) return decodeURIComponent(dest);
    }
  } catch {
    // Invalid URL — ignore
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
          // Route through processUrl so the inner URL is validated AND itself
          // unwrapped (previously it was added raw via urls.add, bypassing both).
          processUrl(inner, urls);
        }
        // Check path for encoded URLs
        const pathDecoded = decodeURIComponent(u.pathname + u.search);
        const found = pathDecoded.match(/https?:\/\/[^\s"']+/gi);
        if (found) {
          for (const f of found) {
            processUrl(f, urls);
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
    log.debug(
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
  if (set.size >= MAX_URLS) {
    return;
  }
  if (!isValidUrl(url)) {
    return;
  }
  set.add(url);
  const inner = unwrapTrackingUrl(url, 0);
  if (inner && inner !== url && isValidUrl(inner) && set.size < MAX_URLS) {
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
    // IMPROVEMENT: count params via the iterator. Previously this used
    // `u.searchParams.toString().split('&').length`, which returns 1 even when
    // there are zero params (''.split('&') === ['']), over-counting complexity
    // by 3 for every param-less URL.
    const paramCount = [...u.searchParams].length;

    complexity += u.pathname.split('/').filter(Boolean).length * 5;
    complexity += Math.min(u.search.length / 5, 30);
    complexity += paramCount * 3;
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
