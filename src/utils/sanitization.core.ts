/**
 * Service-Worker-Safe Sanitization Utilities
 *
 * This module provides regex-only sanitization functions that can safely run
 * inside a Chrome MV3 service worker (no DOM, no `window`).
 *
 * For full DOMPurify-powered sanitization (content scripts / popup), import
 * from `./sanitization` instead — it re-exports everything here AND adds
 * DOMPurify-enhanced versions of `sanitizeHtml` / `sanitizeEmailBody`.
 *
 * @security Regex-based — adequate for pre-processing; the UI layer should
 *           still run DOMPurify before rendering untrusted HTML.
 */

import { createLogger } from './logger';

const log = createLogger('Sanitization');

// ═══════════════════════════════════════════════════════════════════
// Plain-text / regex sanitizers (zero DOM dependency)
// ═══════════════════════════════════════════════════════════════════

/**
 * Sanitize text content (strip all HTML)
 */
export function sanitizeText(dirty: string): string {
  if (!dirty || typeof dirty !== 'string') {
    return '';
  }

  return dirty
    .replace(/<[^>]*>?/gm, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sanitize email subject line
 */
export function sanitizeEmailSubject(subject: string): string {
  const sanitized = sanitizeText(subject);
  return sanitized.substring(0, 500);
}

/**
 * Sanitize sender email address
 */
export function sanitizeEmail(email: string): string {
  if (!email || typeof email !== 'string') {
    return '';
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const sanitized = sanitizeText(email.trim());

  if (!emailRegex.test(sanitized)) {
    log.warn('Invalid email format (redacted for security)');
    return '';
  }

  return sanitized;
}

/**
 * Sanitize OTP code (alphanumeric only)
 */
export function sanitizeOTP(otp: string): string {
  if (!otp || typeof otp !== 'string') {
    return '';
  }

  return otp.replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
}

/**
 * Sanitize URL for links
 */
export function sanitizeUrl(url: string): string {
  if (!url || typeof url !== 'string') {
    return '';
  }

  try {
    const parsedUrl = new URL(url.trim());

    const allowedProtocols = ['http:', 'https:', 'mailto:'];
    if (!allowedProtocols.includes(parsedUrl.protocol)) {
      log.warn('Blocked unsafe protocol', parsedUrl.protocol);
      return '';
    }

    return parsedUrl.href;
  } catch {
    log.warn('Invalid URL (redacted for security)');
    return '';
  }
}

/**
 * Sanitize activation link
 */
export function sanitizeActivationLink(link: string): string {
  const sanitized = sanitizeUrl(link);

  if (!sanitized) {
    return '';
  }

  const dangerousPatterns = ['javascript:', 'data:', 'vbscript:', 'file:'];

  const lowerLink = sanitized.toLowerCase();
  for (const pattern of dangerousPatterns) {
    if (lowerLink.includes(pattern)) {
      log.warn('Blocked dangerous link pattern', pattern);
      return '';
    }
  }

  return sanitized;
}

/**
 * Regex-only HTML sanitizer for service-worker context.
 *
 * Strips dangerous tags (`<script>`, `<iframe>`, etc.), event-handler
 * attributes (`on*=`), and `javascript:` URIs.  This is NOT as robust as
 * DOMPurify — the UI layer must re-sanitize before rendering.
 */
export function sanitizeHtml(dirty: string): string {
  if (!dirty || typeof dirty !== 'string') {
    return '';
  }

  let cleaned = dirty;

  // Remove dangerous tags entirely (including content)
  cleaned = cleaned.replace(/<\s*script[\s>][\s\S]*?<\s*\/\s*script\s*>/gi, '');
  cleaned = cleaned.replace(/<\s*iframe[\s>][\s\S]*?<\s*\/\s*iframe\s*>/gi, '');
  cleaned = cleaned.replace(/<\s*object[\s>][\s\S]*?<\s*\/\s*object\s*>/gi, '');
  cleaned = cleaned.replace(/<\s*embed[\s>][\s\S]*?<\s*\/\s*embed\s*>/gi, '');
  cleaned = cleaned.replace(/<\s*form[\s>][\s\S]*?<\s*\/\s*form\s*>/gi, '');

  cleaned = cleaned.replace(/<\s*style[\s>][\s\S]*?<\s*\/\s*style\s*>/gi, '');
  cleaned = cleaned.replace(/<\s*link\b[^>]*>/gi, '');
  cleaned = cleaned.replace(/<\s*meta\b[^>]*>/gi, '');
  cleaned = cleaned.replace(/<\s*svg[\s>][\s\S]*?<\s*\/\s*svg\s*>/gi, '');

  // Remove self-closing dangerous tags
  cleaned = cleaned.replace(
    /<\s*(script|iframe|object|embed|form|style|link|meta|svg)\b[^>]*\/?>/gi,
    ''
  );

  // Strip on* event-handler attributes
  cleaned = cleaned.replace(/\bon[a-z]+\s*=\s*(['"])(?:(?!\1).)*?\1/gi, '');
  cleaned = cleaned.replace(/\bon[a-z]+\s*=\s*[^\s>]*/gi, '');

  // Strip javascript: / vbscript: URIs in href/src/action attributes
  cleaned = cleaned.replace(/href\s*=\s*(['"])javascript:(?:(?!\1).)*?\1/gi, `href=$1#$1`);
  cleaned = cleaned.replace(/src\s*=\s*(['"])javascript:(?:(?!\1).)*?\1/gi, `src=$1#$1`);
  cleaned = cleaned.replace(/href\s*=\s*(['"])vbscript:(?:(?!\1).)*?\1/gi, `href=$1#$1`);

  return cleaned;
}

/**
 * Sanitize email body — regex-only fallback for service-worker context.
 *
 * Strips dangerous tags/attributes via regex.  For DOM contexts the full
 * DOMPurify version in `sanitization.ts` should be preferred.
 */
export function sanitizeEmailBody(htmlBody: string, textBody?: string): string {
  if (htmlBody) {
    return sanitizeHtml(htmlBody);
  }

  return textBody ? sanitizeText(textBody) : '';
}

/**
 * Batch sanitize array of strings
 */
export function sanitizeBatch<T extends string>(
  items: T[],
  sanitizer: (item: T) => string
): string[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item) => sanitizer(item));
}

/**
 * Check if content appears to be sanitized (heuristic)
 */
export function isLikelySafe(content: string): boolean {
  if (!content || typeof content !== 'string') {
    return true;
  }

  const dangerousPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i,
    /<iframe/i,
    /<object/i,
    /<embed/i,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(content)) {
      return false;
    }
  }

  return true;
}
