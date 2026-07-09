/**
 * Consolidated Sanitization Utilities - DEFENSE IN DEPTH
 * Safe for use in both Chrome MV3 Service Workers (regex-only fallback)
 * and DOM contexts (DOMPurify-powered).
 *
 * @security Always sanitize before rendering or processing untrusted content
 * @security Double sanitization for defense in depth
 */

import DOMPurify from 'dompurify';
import { createLogger } from './logger';

const log = createLogger('Sanitization');

// ═══════════════════════════════════════════════════════════════════
// TypeScript declarations for Trusted Types API
// ═══════════════════════════════════════════════════════════════════

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
// SECURITY: Trusted Types Policy (initialization)
// ═══════════════════════════════════════════════════════════════════

let trustedTypesPolicy: TrustedTypePolicy | null = null;
export type SanitizerConfig = Record<string, unknown>;

function initTrustedTypes(): void {
  if (typeof window !== 'undefined' && 'trustedTypes' in window) {
    try {
      const tt = (window as unknown as { trustedTypes: TrustedTypePolicyFactory }).trustedTypes;
      trustedTypesPolicy = tt.createPolicy('ghostfill', {
        createHTML: (input: string): string => {
          return input;
        },
        createScriptURL: (_input: string): string => {
          log.warn('TrustedTypes blocked script URL (redacted)');
          return 'about:blank';
        },
        createScript: (): null => {
          log.warn('TrustedTypes blocked inline script');
          return null;
        },
      });
    } catch (error) {
      log.warn('TrustedTypes: Failed to create policy', error);
    }
  }
}

// Initialize Trusted Types on module load (if in browser window)
if (typeof window !== 'undefined') {
  initTrustedTypes();
}

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
 * Sanitize the "from" field of an email for safe display and domain matching. Preserves @.
 */
export function sanitizeEmailFrom(from: string): string {
  if (!from || typeof from !== 'string') {
    return '';
  }

  // Try to extract email address from "Name <email@domain>" format
  const angleMatch = from.match(/<([^>]+@[^>]+)>/);
  if (angleMatch?.[1]) {
    return angleMatch[1].trim().substring(0, 254);
  }

  const stripped = from
    .replace(
      /<\/?(?:script|style|div|span|p|br|a|b|i|em|strong|img|table|tr|td|th|ul|ol|li|h[1-6])[^>]*>/gi,
      ''
    )
    .trim();

  return stripped.substring(0, 254);
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

// ═══════════════════════════════════════════════════════════════════
// HTML and DOM Context-aware Sanitizers
// ═══════════════════════════════════════════════════════════════════

function sanitizeHtmlInternal(dirty: string, options?: SanitizerConfig): string {
  if (!dirty || typeof dirty !== 'string') {
    return '';
  }

  const defaultOptions: SanitizerConfig = {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'u', 'b', 'i', 'a', 'title',
      'ul', 'ol', 'li', 'div', 'span', 'h1', 'h2', 'h3', 'h4',
      'h5', 'h6', 'blockquote', 'pre', 'code', 'table', 'thead',
      'tbody', 'tr', 'th', 'td',
    ],
    ALLOWED_ATTR: ['href', 'alt', 'title', 'target', 'rel'],
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
    ADD_ATTR: ['rel'],
    ADD_DATA_URI_TAGS: [],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
    SANITIZE_DOM: true,
  };

  const config = { ...defaultOptions, ...options };

  try {
    let cleaned = DOMPurify.sanitize(dirty, config) as string;
    cleaned = cleaned.replace(/\bon[a-z]+\s*=\s*(['"])(?:(?!\1).)*?\1/gi, '');
    return cleaned;
  } catch {
    return dirty.replace(/<[^>]*>?/gm, '');
  }
}

function secondaryValidation(html: string): string {
  if (!html) {
    return '';
  }

  const dangerousPatterns = [
    /j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:/gi,
    /d\s*a\s*t\s*a\s*:\s*text\/html/gi,
    /v\s*b\s*s\s*c\s*r\s*i\s*p\s*t\s*:/gi,
    /e\s*x\s*p\s*r\s*e\s*s\s*s\s*i\s*o\s*n\s*\(/gi,
    /\bon\w+\s*=\s*["'][^"']*["']/gi,
    /&#(x)?[0-9a-f]+;/gi,
  ];

  let sanitized = html;
  for (const pattern of dangerousPatterns) {
    if (pattern.test(sanitized)) {
      log.warn('SecondaryValidation blocked dangerous pattern');
      sanitized = sanitized.replace(pattern, '');
    }
  }

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

  if (/<script/i.test(decoded) || /javascript:/i.test(decoded) || /on\w+\s*=/i.test(decoded)) {
    log.warn('SecondaryValidation blocked encoded dangerous content');
    return '';
  }

  return sanitized;
}

/**
 * Unified sanitizeHtml: Uses DOMPurify in DOM contexts, and regex-only fallback in SW context.
 */
export function sanitizeHtml(dirty: string, options?: SanitizerConfig): string {
  if (!dirty || typeof dirty !== 'string') {
    return '';
  }

  // Use DOMPurify in DOM contexts (browser window, content scripts, popup)
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    try {
      let basicClean = sanitizeHtmlInternal(dirty, options);
      basicClean = basicClean.replace(/href\s*=\s*(['"])javascript:(?:(?!\1).)*?\1/gi, `href=$1#$1`);
      basicClean = secondaryValidation(basicClean);
      if (trustedTypesPolicy) {
        return trustedTypesPolicy.createHTML(basicClean);
      }
      return basicClean;
    } catch (error) {
      log.error('DOMPurify failed, falling back to regex sanitizer', error);
    }
  }

  // Regex-only fallback for Service Worker environment
  let cleaned = dirty;
  cleaned = cleaned.replace(/<\s*script[\s>][\s\S]*?<\s*\/\s*script\s*>/gi, '');
  cleaned = cleaned.replace(/<\s*iframe[\s>][\s\S]*?<\s*\/\s*iframe\s*>/gi, '');
  cleaned = cleaned.replace(/<\s*object[\s>][\s\S]*?<\s*\/\s*object\s*>/gi, '');
  cleaned = cleaned.replace(/<\s*embed[\s>][\s\S]*?<\s*\/\s*embed\s*>/gi, '');
  cleaned = cleaned.replace(/<\s*form[\s>][\s\S]*?<\s*\/\s*form\s*>/gi, '');
  cleaned = cleaned.replace(/<\s*style[\s>][\s\S]*?<\s*\/\s*style\s*>/gi, '');
  cleaned = cleaned.replace(/<\s*link\b[^>]*>/gi, '');
  cleaned = cleaned.replace(/<\s*meta\b[^>]*>/gi, '');
  cleaned = cleaned.replace(/<\s*svg[\s>][\s\S]*?<\s*\/\s*svg\s*>/gi, '');
  cleaned = cleaned.replace(/<\s*(script|iframe|object|embed|form|style|link|meta|svg)\b[^>]*\/?>/gi, '');
  cleaned = cleaned.replace(/\bon[a-z]+\s*=\s*(['"])(?:(?!\1).)*?\1/gi, '');
  cleaned = cleaned.replace(/\bon[a-z]+\s*=\s*[^\s>]*/gi, '');
  cleaned = cleaned.replace(/href\s*=\s*(['"])javascript:(?:(?!\1).)*?\1/gi, `href=$1#$1`);
  cleaned = cleaned.replace(/src\s*=\s*(['"])javascript:(?:(?!\1).)*?\1/gi, `src=$1#$1`);
  cleaned = cleaned.replace(/href\s*=\s*(['"])vbscript:(?:(?!\1).)*?\1/gi, `href=$1#$1`);
  return cleaned;
}

/**
 * Sanitize email body (HTML content).
 */
export function sanitizeEmailBody(htmlBody: string, textBody?: string): string {
  if (htmlBody) {
    return sanitizeHtml(htmlBody, {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'em', 'u', 'b', 'i', 'a', 'title',
        'ul', 'ol', 'li', 'div', 'span', 'h1', 'h2', 'h3', 'h4',
        'h5', 'h6', 'blockquote', 'pre', 'code', 'table', 'thead',
        'tbody', 'tr', 'th', 'td', 'hr', 'sub', 'sup',
      ],
      ADD_ATTR: ['target', 'rel'],
    });
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

// ─── Trusted Types default policy (web contexts) ─────────────────────────────
interface GlobalWithTrustedTypes {
  trustedTypes?: {
    createPolicy: (
      name: string,
      rules: {
        createHTML: (s: string) => string;
        createScriptURL: (s: string) => string;
        createScript: (s: string) => string;
      }
    ) => void;
  };
}

{
  const g = globalThis as typeof globalThis & GlobalWithTrustedTypes;
  if (typeof g.trustedTypes !== 'undefined') {
    try {
      g.trustedTypes.createPolicy('default', {
        createHTML: (s: string): string => s.replace(/</g, '&lt;').replace(/>/g, '&gt;'),
        createScriptURL: (s: string): string => {
          if (s.startsWith('chrome-extension://') || s.startsWith('/')) {
            return s;
          }
          log.warn('Blocked uncontrolled script URL');
          return '';
        },
        createScript: (s: string): string => {
          const safe = s.trim();
          if (safe === '' || safe === 'return this') {
            return s;
          }
          log.warn('Blocked uncontrolled script string via Trusted Types');
          return '';
        },
      });
    } catch {
      // Policy may already exist
    }
  }
}

/**
 * Parse `markup` as HTML and replace the children of `el` with the result.
 * Safe under Trusted Types — uses <template> parsing, not innerHTML.
 */
export function setHTML(el: Element, markup: string): void {
  const sanitized = DOMPurify.sanitize(markup, {
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'style', 'link', 'meta'],
    SANITIZE_DOM: true,
    RETURN_TRUSTED_TYPE: true,
  }) as unknown as string;

  const template = document.createElement('template');
  template.innerHTML = sanitized;
  el.replaceChildren(template.content.cloneNode(true));
}

/**
 * Remove all children from `el` without touching innerHTML.
 */
export function clearHTML(el: Element): void {
  el.replaceChildren();
}

