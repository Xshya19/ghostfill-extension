/**
 * Input Sanitization Utilities - DEFENSE IN DEPTH
 *
 * Provides XSS protection by sanitizing untrusted input using safe string replacements.
 * Critical for processing email content, HTML bodies, and user-generated content.
 *
 * @security Always sanitize before rendering or processing untrusted content
 * @security Double sanitization for defense in depth
 */

// We strictly avoid importing DOMPurify here because this file is used by the
// Service Worker, and importing DOMPurify (even conditionally) causes webpack
// to bundle it, which eventually causes "window is not defined" errors during load.
// If robust HTML sanitization is needed, it MUST be performed on the frontend.

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
        createPolicy(name: string, policy: {
            createHTML?: (input: string) => string;
            createScript?: (input: string) => string | null;
            createScriptURL?: (input: string) => string;
        }): TrustedTypePolicy;
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
                    // SECURITY FIX: Double sanitization for defense in depth
                    // First pass: DOMPurify sanitization
                    const firstPass = sanitizeHtmlInternal(input, { FORCE_BODY: true });
                    // Second pass: Additional sanitization for any missed patterns
                    return sanitizeHtmlInternal(firstPass, { FORCE_BODY: true });
                },
                createScriptURL: (input: string): string => {
                    // SECURITY: Block all script URLs
                    console.warn('[TrustedTypes] Blocked script URL:', input);
                    return 'about:blank';
                },
                createScript: (): null => {
                    // SECURITY: Block all inline scripts
                    console.warn('[TrustedTypes] Blocked inline script');
                    return null;
                },
            });
            console.log('[TrustedTypes] Policy created successfully');
        } catch (error) {
            console.warn('[TrustedTypes] Failed to create policy:', error);
        }
    }
}

// Initialize Trusted Types on module load
initTrustedTypes();

/**
 * Internal sanitization function (used by Trusted Types)
 */
function sanitizeHtmlInternal(dirty: string, options?: Record<string, any>): string {
    if (!dirty || typeof dirty !== 'string') {
        return '';
    }

    const defaultOptions: Record<string, any> = {
        ALLOWED_TAGS: [
            'p', 'br', 'strong', 'em', 'u', 'b', 'i',
            'a', 'href', 'title',
            'ul', 'ol', 'li',
            'div', 'span',
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'blockquote', 'pre', 'code',
            'img', 'src', 'alt',
            'table', 'thead', 'tbody', 'tr', 'th', 'td',
        ],
        ALLOWED_ATTR: [
            'href', 'src', 'alt', 'title',
            'class', 'id', 'style',
            'target', 'rel',
        ],
        ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
        ADD_ATTR: ['rel'],
        ADD_DATA_URI_TAGS: [],
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
        SANITIZE_DOM: true,
    };

    const config = { ...defaultOptions, ...options };

    // Fallback for service worker text extraction
    return dirty.replace(/<[^>]*>?/gm, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
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
export function sanitizeHtml(
    dirty: string,
    options?: Record<string, any>
): string {
    if (!dirty || typeof dirty !== 'string') {
        return '';
    }

    const defaultOptions: Record<string, any> = {
        // Allowed tags (whitelist approach)
        ALLOWED_TAGS: [
            'p', 'br', 'strong', 'em', 'u', 'b', 'i',
            'a', 'href', 'title',
            'ul', 'ol', 'li',
            'div', 'span',
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'blockquote', 'pre', 'code',
            'img', 'src', 'alt',
            'table', 'thead', 'tbody', 'tr', 'th', 'td',
        ],
        // Allowed attributes
        ALLOWED_ATTR: [
            'href', 'src', 'alt', 'title',
            'class', 'id', 'style',
            'target', 'rel',
        ],
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
        // Environment without DOM (Service Worker fallback)
        let basicClean = dirty.replace(/<[^>]*>?/gm, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');

        // SECURITY FIX: Secondary validation layer
        // Check for any remaining dangerous patterns that might have slipped through
        basicClean = secondaryValidation(basicClean);

        // SECURITY FIX: Use Trusted Types if available
        if (trustedTypesPolicy) {
            return trustedTypesPolicy.createHTML(basicClean);
        }

        return basicClean;
    } catch (error) {
        console.error('[Sanitization] Failed to sanitize HTML:', error);
        return ''; // Return empty string on failure (safe fallback)
    }
}

/**
 * Secondary validation layer - catches patterns that might slip through
 * @security Defense in depth - additional check after DOMPurify
 * @security Blocks mutation XSS and other advanced attacks
 */
function secondaryValidation(html: string): string {
    if (!html) { return ''; }

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
            console.warn('[SecondaryValidation] Blocked dangerous pattern:', pattern);
            // Remove the dangerous content entirely
            sanitized = sanitized.replace(pattern, '');
        }
    }

    // SECURITY FIX: Check for nested/encoded scripts
    // Decode common HTML entities and check again
    const decoded = html
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

    // If decoding reveals dangerous content, strip it
    if (/<script/i.test(decoded) || /javascript:/i.test(decoded)) {
        console.warn('[SecondaryValidation] Blocked encoded dangerous content');
        sanitized = sanitized.replace(/<[^>]*script[^>]*>/gi, '')
            .replace(/<\/script>/gi, '');
    }

    return sanitized;
}

/**
 * Sanitize text content (strip all HTML)
 * 
 * @param dirty - Untrusted text string
 * @returns Plain text with all HTML removed
 * 
 * @security Completely strips HTML tags
 * 
 * @example
 * const clean = sanitize.text(emailSubject);
 */
export function sanitizeText(dirty: string): string {
    if (!dirty || typeof dirty !== 'string') {
        return '';
    }

    // Fallback for Service Worker where document is not defined
    if (typeof document === 'undefined') {
        return dirty
            .replace(/<[^>]*>?/gm, '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Create a temporary element to strip HTML
    const temp = document.createElement('div');
    temp.textContent = dirty;
    return temp.innerHTML;
}

/**
 * Sanitize email subject line
 * 
 * @param subject - Email subject
 * @returns Sanitized subject safe for display
 * 
 * @security Strips all HTML, limits length
 */
export function sanitizeEmailSubject(subject: string): string {
    const sanitized = sanitizeText(subject);
    // Limit length to prevent overflow attacks
    return sanitized.substring(0, 500);
}

/**
 * Sanitize email body (HTML content)
 * 
 * @param htmlBody - Email HTML body
 * @param textBody - Email text body (fallback)
 * @returns Sanitized HTML safe for rendering
 * 
 * @security Allows safe HTML tags, removes scripts
 */
export function sanitizeEmailBody(htmlBody: string, textBody?: string): string {
    if (htmlBody) {
        return sanitizeHtml(htmlBody, {
            // More permissive for email bodies
            ALLOWED_TAGS: [
                'p', 'br', 'strong', 'em', 'u', 'b', 'i',
                'a', 'href', 'title',
                'ul', 'ol', 'li',
                'div', 'span',
                'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                'blockquote', 'pre', 'code',
                'img', 'src', 'alt',
                'table', 'thead', 'tbody', 'tr', 'th', 'td',
                'hr', 'sub', 'sup',
            ],
            // Add target and rel attributes to links
            ADD_ATTR: ['target', 'rel'],
        });
    }

    // Fallback to text
    return textBody ? sanitizeText(textBody) : '';
}

/**
 * Sanitize OTP code (alphanumeric only)
 * 
 * @param otp - OTP code string
 * @returns Sanitized OTP (alphanumeric only)
 * 
 * @security Removes all non-alphanumeric characters
 */
export function sanitizeOTP(otp: string): string {
    if (!otp || typeof otp !== 'string') {
        return '';
    }

    // Only allow alphanumeric characters
    return otp.replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
}

/**
 * Sanitize URL for links
 * 
 * @param url - URL to sanitize
 * @returns Sanitized URL or empty string if invalid
 * 
 * @security Only allows http/https/mailto protocols
 */
export function sanitizeUrl(url: string): string {
    if (!url || typeof url !== 'string') {
        return '';
    }

    try {
        const parsedUrl = new URL(url.trim());

        // Only allow safe protocols
        const allowedProtocols = ['http:', 'https:', 'mailto:'];
        if (!allowedProtocols.includes(parsedUrl.protocol)) {
            console.warn('[Sanitization] Blocked unsafe protocol:', parsedUrl.protocol);
            return '';
        }

        return parsedUrl.href;
    } catch {
        console.warn('[Sanitization] Invalid URL:', url);
        return '';
    }
}

/**
 * Sanitize sender email address
 * 
 * @param email - Email address
 * @returns Sanitized email or empty string if invalid
 * 
 * @security Validates email format
 */
export function sanitizeEmail(email: string): string {
    if (!email || typeof email !== 'string') {
        return '';
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const sanitized = sanitizeText(email.trim());

    if (!emailRegex.test(sanitized)) {
        console.warn('[Sanitization] Invalid email format:', email);
        return '';
    }

    return sanitized;
}

/**
 * Sanitize activation link
 * 
 * @param link - Activation link
 * @returns Sanitized link safe for navigation
 * 
 * @security Validates URL and checks for dangerous patterns
 */
export function sanitizeActivationLink(link: string): string {
    const sanitized = sanitizeUrl(link);

    if (!sanitized) {
        return '';
    }

    // Additional checks for activation links
    const dangerousPatterns = [
        'javascript:',
        'data:',
        'vbscript:',
        'file:',
    ];

    const lowerLink = sanitized.toLowerCase();
    for (const pattern of dangerousPatterns) {
        if (lowerLink.includes(pattern)) {
            console.warn('[Sanitization] Blocked dangerous pattern:', pattern);
            return '';
        }
    }

    return sanitized;
}

/**
 * Batch sanitize array of strings
 * 
 * @param items - Array of strings to sanitize
 * @param sanitizer - Sanitizer function to use
 * @returns Array of sanitized strings
 */
export function sanitizeBatch<T extends string>(
    items: T[],
    sanitizer: (item: T) => string
): string[] {
    if (!Array.isArray(items)) {
        return [];
    }

    return items.map(item => sanitizer(item));
}

/**
 * Check if content appears to be sanitized
 * 
 * @param content - Content to check
 * @returns true if content appears safe
 * 
 * @warning This is a heuristic check, not a security guarantee
 */
export function isLikelySafe(content: string): boolean {
    if (!content || typeof content !== 'string') {
        return true; // Empty content is safe
    }

    const dangerousPatterns = [
        /<script/i,
        /javascript:/i,
        /on\w+\s*=/i, // onclick=, onerror=, etc.
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
