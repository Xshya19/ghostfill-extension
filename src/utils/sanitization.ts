/**
 * Input Sanitization Utilities - DEFENSE IN DEPTH (DOM context)
 *
 * This module uses DOMPurify for robust HTML sanitization.
 * It requires a DOM environment (content scripts, popup) — do NOT import
 * this module from the service worker / background script.
 *
 * For service-worker-safe sanitization use `./sanitization.core` instead.
 * All regex-only helpers are re-exported from the core module below so that
 * existing `from './sanitization'` imports in DOM contexts keep working.
 *
 * @security Always sanitize before rendering or processing untrusted content
 * @security Double sanitization for defense in depth
 */

import DOMPurify from 'dompurify';
import { createLogger } from './logger';
import { sanitizeText } from './sanitization.core';

const log = createLogger('Sanitization');

// Re-export all service-worker-safe (regex-only) sanitizers so that existing
// consumers in DOM contexts can keep importing from this module.
export {
  sanitizeText,
  sanitizeEmailSubject,
  sanitizeEmail,
  sanitizeOTP,
  sanitizeUrl,
  sanitizeActivationLink,
  sanitizeBatch,
  isLikelySafe,
} from './sanitization.core';

// ═══════════════════════════════════════════════════════════════════
// TypeScript declarations for Trusted Types API
// ═══════════════════════════════════════════════════════════════════

// Declare Trusted Types types for TypeScript
declare global {
  interface TrustedTypePolicy {
    createHTML(input: string): string;
    createScript(input: string): string | null;
    createScriptURL(input: string): string;
  }

  interface TrustedTypePolicyFactory {
    createPolicy(
      name: string,
      policy: {
        createHTML?: (input: string) => string;
        createScript?: (input: string) => string | null;
        createScriptURL?: (input: string) => string;
      }
    ): TrustedTypePolicy;
  }
}

// ═══════════════════════════════════════════════════════════════════
// SECURITY: Trusted Types Policy
// Creates a Trusted Types policy for additional XSS protection
// ═══════════════════════════════════════════════════════════════════

/**
 * Trusted Types policy for GhostFill
 * @security Provides an additional layer of XSS protection
 * @security Only available in browsers that support Trusted Types
 */
let trustedTypesPolicy: TrustedTypePolicy | null = null;
type SanitizerConfig = Record<string, unknown>;

/**
 * Initialize Trusted Types policy
 * @security Called once at module load
 * @security Falls back gracefully if Trusted Types not supported
 */
function initTrustedTypes(): void {
  // Check if Trusted Types are supported
  if (typeof window !== 'undefined' && 'trustedTypes' in window) {
    try {
      const tt = (window as unknown as { trustedTypes: TrustedTypePolicyFactory }).trustedTypes;
      trustedTypesPolicy = tt.createPolicy('ghostfill', {
        createHTML: (input: string): string => {
          // Passed through since `sanitizeHtml` already uses DOMPurify and calls this
          return input;
        },
        createScriptURL: (_input: string): string => {
          // SECURITY: Block all script URLs
          log.warn('TrustedTypes blocked script URL (redacted)');
          return 'about:blank';
        },
        createScript: (): null => {
          // SECURITY: Block all inline scripts
          log.warn('TrustedTypes blocked inline script');
          return null;
        },
      });
    } catch (error) {
      log.warn('TrustedTypes: Failed to create policy', error);
    }
  }
}

// Initialize Trusted Types on module load
initTrustedTypes();

/**
 * Internal sanitization function (used by Trusted Types)
 */
function sanitizeHtmlInternal(dirty: string, options?: SanitizerConfig): string {
  if (!dirty || typeof dirty !== 'string') {
    return '';
  }

  const defaultOptions: SanitizerConfig = {
    ALLOWED_TAGS: [
      'p',
      'br',
      'strong',
      'em',
      'u',
      'b',
      'i',
      'a',
      'title',
      'ul',
      'ol',
      'li',
      'div',
      'span',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'blockquote',
      'pre',
      'code',
      'img',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'style', 'target', 'rel'],
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
    ADD_ATTR: ['rel'],
    ADD_DATA_URI_TAGS: [],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
    SANITIZE_DOM: true,
  };

  const config = { ...defaultOptions, ...options };

  try {
    let cleaned = DOMPurify.sanitize(dirty, config) as string;
    // Also remove on* attributes to prevent execution if injected
    cleaned = cleaned.replace(/\bon[a-z]+\s*=\s*(['"])(?:(?!\1).)*?\1/gi, '');
    return cleaned;
  } catch {
    return dirty.replace(/<[^>]*>?/gm, '');
  }
}

/**
 * Sanitize HTML content to prevent XSS attacks - DEFENSE IN DEPTH
 *
 * @param dirty - Untrusted HTML string
 * @param options - Sanitization options
 * @returns Sanitized HTML string safe for rendering
 *
 * @security Removes all dangerous tags and attributes
 * @security Double sanitization for defense in depth
 * @security Uses Trusted Types API when available
 *
 * @example
 * const clean = sanitize.html(emailBody);
 */
export function sanitizeHtml(dirty: string, options?: SanitizerConfig): string {
  if (!dirty || typeof dirty !== 'string') {
    return '';
  }

  const defaultOptions: SanitizerConfig = {
    // Allowed tags (whitelist approach)
    ALLOWED_TAGS: [
      'p',
      'br',
      'strong',
      'em',
      'u',
      'b',
      'i',
      'a',
      'title',
      'ul',
      'ol',
      'li',
      'div',
      'span',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'blockquote',
      'pre',
      'code',
      'img',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
    ],
    // Allowed attributes
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'style', 'target', 'rel'],
    // Force safe protocols
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
    // Add rel="noopener" to links
    ADD_ATTR: ['rel'],
    ADD_DATA_URI_TAGS: [],
    // Prevent media execution
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
    // Sanitize styles
    SANITIZE_DOM: true,
    // SECURITY FIX: Additional hardening options
    USE_PROFILES: { html: true },
    ALLOW_ARIA_ATTR: false, // Block ARIA attributes that could be exploited
    ALLOW_DATA_ATTR: false, // Block data attributes that could be exploited
  };

  const config = { ...defaultOptions, ...options };

  try {
    // SECURITY FIX: Use DOMPurify for robust HTML sanitation
    let basicClean = sanitizeHtmlInternal(dirty, config);

    // Strip javascript URLs as defense-in-depth
    basicClean = basicClean.replace(/href\s*=\s*(['"])javascript:(?:(?!\1).)*?\1/gi, `href=$1#$1`);

    // SECURITY FIX: Secondary validation layer
    // Check for any remaining dangerous patterns that might have slipped through
    basicClean = secondaryValidation(basicClean);

    // SECURITY FIX: Use Trusted Types if available
    if (trustedTypesPolicy) {
      return trustedTypesPolicy.createHTML(basicClean);
    }

    return basicClean;
  } catch (error) {
    log.error('Failed to sanitize HTML', error);
    return ''; // Return empty string on failure (safe fallback)
  }
}

/**
 * Secondary validation layer - catches patterns that might slip through
 * @security Defense in depth - additional check after DOMPurify
 * @security Blocks mutation XSS and other advanced attacks
 */
function secondaryValidation(html: string): string {
  if (!html) {
    return '';
  }

  // SECURITY FIX: Block any remaining dangerous patterns
  const dangerousPatterns = [
    // JavaScript protocol (case-insensitive, with possible encoding)
    /j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:/gi,
    // Data URI with script content
    /d\s*a\s*t\s*a\s*:\s*text\/html/gi,
    // VBScript protocol
    /v\s*b\s*s\s*c\s*r\s*i\s*p\s*t\s*:/gi,
    // Expression (IE-specific but still dangerous)
    /e\s*x\s*p\s*r\s*e\s*s\s*s\s*i\s*o\s*n\s*\(/gi,
    // Event handlers with various encodings
    /\bon\w+\s*=\s*["'][^"']*["']/gi,
    // HTML entities that could decode to dangerous content
    /&#(x)?[0-9a-f]+;/gi,
  ];

  let sanitized = html;
  for (const pattern of dangerousPatterns) {
    if (pattern.test(sanitized)) {
      log.warn('SecondaryValidation blocked dangerous pattern');
      // Remove the dangerous content entirely
      sanitized = sanitized.replace(pattern, '');
    }
  }

  // SECURITY FIX: Check for nested/encoded scripts
  // Decode common HTML entities recursively up to 5 times
  let decoded = html;
  let previous = '';
  let iter = 0;

  while (decoded !== previous && iter < 5) {
    previous = decoded;
    decoded = decoded
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&#x2F;/gi, '/')
      .replace(/&#x60;/gi, '`')
      .replace(/&#x3D;/gi, '=');

    // Decode hex/decimal entities
    decoded = decoded.replace(/&#([0-9]+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
    decoded = decoded.replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );

    try {
      const newDecoded = decodeURIComponent(decoded);
      if (newDecoded !== decoded) {
        decoded = newDecoded;
      }
    } catch {
      /* Suppress decode errors */
    }
    iter++;
  }

  // If decoding reveals dangerous content, strip it entirely
  if (/<script/i.test(decoded) || /javascript:/i.test(decoded) || /on\w+\s*=/i.test(decoded)) {
    log.warn('SecondaryValidation blocked encoded dangerous content');
    return '';
  }

  return sanitized;
}

/**
 * Sanitize email body (HTML content) — DOMPurify-enhanced version.
 *
 * This version uses DOMPurify for robust tag-level sanitization and should only
 * be called from DOM contexts (content scripts, popup).
 * The service-worker-safe fallback lives in `sanitization.core.ts`.
 */
export function sanitizeEmailBody(htmlBody: string, textBody?: string): string {
  if (htmlBody) {
    return sanitizeHtml(htmlBody, {
      ALLOWED_TAGS: [
        'p',
        'br',
        'strong',
        'em',
        'u',
        'b',
        'i',
        'a',
        'title',
        'ul',
        'ol',
        'li',
        'div',
        'span',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'blockquote',
        'pre',
        'code',
        'img',
        'table',
        'thead',
        'tbody',
        'tr',
        'th',
        'td',
        'hr',
        'sub',
        'sup',
      ],
      ADD_ATTR: ['target', 'rel'],
    });
  }

  // Fallback to text — use the re-exported sanitizeText from the core module
  return textBody ? sanitizeText(textBody) : '';
}
