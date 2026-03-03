// Utility Helpers

import { createLogger } from './logger';

const log = createLogger('Helpers');

/**
 * Generate a unique ID
 */
export function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate a random string of specified length
 */
export function generateRandomString(length: number, charset: string): string {
    const array = new Uint32Array(length);
    crypto.getRandomValues(array);

    let result = '';
    for (let i = 0; i < length; i++) {
        result += charset[array[i] % charset.length];
    }
    return result;
}

/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
}

/**
 * Merge objects deeply
 */
export function deepMerge<T extends object>(target: T, source: Partial<T>): T {
    const result = { ...target };

    for (const key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
            const targetValue = result[key as keyof T];
            const sourceValue = source[key as keyof T];

            if (isObject(targetValue) && isObject(sourceValue)) {
                result[key as keyof T] = deepMerge(targetValue as object, sourceValue as object) as T[keyof T];
            } else if (sourceValue !== undefined) {
                result[key as keyof T] = sourceValue as T[keyof T];
            }
        }
    }

    return result;
}

/**
 * Check if value is a plain object
 */
export function isObject(value: unknown): value is object {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
    fn: () => Promise<T>,
    maxAttempts: number = 3,
    baseDelay: number = 1000
): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error as Error;
            if (attempt < maxAttempts - 1) {
                await sleep(baseDelay * Math.pow(2, attempt));
            }
        }
    }

    throw lastError;
}

/**
 * Format relative time
 */
export function formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {return `${days}d ago`;}
    if (hours > 0) {return `${hours}h ago`;}
    if (minutes > 0) {return `${minutes}m ago`;}
    if (seconds > 10) {return `${seconds}s ago`;}
    return 'just now';
}

/**
 * Format date/time
 */
export function formatDateTime(timestamp: number | string): string {
    const date = new Date(timestamp);
    return date.toLocaleString();
}

/**
 * Truncate string with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) {return str;}
    return str.substring(0, maxLength - 3) + '...';
}

/**
 * Escape HTML special characters
 */
export function escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Strip HTML tags from string
 */
export function stripHtml(html: string): string {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || div.innerText || '';
}

/**
 * Copy text to clipboard with permission check and auto-clear
 * SECURITY FIX: Auto-clears clipboard after delay to prevent credential exposure
 */
const CLIPBOARD_CLEAR_DELAY_MS = 90000; // 90 seconds - balance between usability and security
let clipboardClearTimeout: ReturnType<typeof setTimeout> | null = null;

export async function copyToClipboard(text: string, options?: { autoClear?: boolean; clearDelayMs?: number }): Promise<boolean> {
    const autoClear = options?.autoClear ?? true;  // Auto-clear by default for security
    const clearDelayMs = options?.clearDelayMs ?? CLIPBOARD_CLEAR_DELAY_MS;
    
    try {
        // Check if clipboard API is available and permitted
        if (navigator.clipboard && navigator.clipboard.writeText) {
            // Check permissions if available
            try {
                if ('permissions' in navigator) {
                    const permissionStatus = await navigator.permissions.query({ name: 'clipboard-write' as PermissionName });
                    if (permissionStatus.state === 'denied') {
                        throw new Error('Clipboard permission denied');
                    }
                }
            } catch {
                // Permission API not available or failed, proceed anyway
            }

            await navigator.clipboard.writeText(text);
            
            // SECURITY FIX: Auto-clear clipboard after delay to prevent credential exposure
            if (autoClear) {
                // Clear any existing timeout
                if (clipboardClearTimeout) {
                    clearTimeout(clipboardClearTimeout);
                }
                
                // Set new timeout to clear clipboard
                clipboardClearTimeout = setTimeout(async () => {
                    try {
                        // Check if we can read clipboard (user may have copied something else)
                        const currentClipboard = await navigator.clipboard.readText().catch(() => null);
                        // Only clear if it still contains our text (user hasn't overwritten it)
                        if (currentClipboard === text) {
                            await navigator.clipboard.writeText('');
                            log.debug('[GhostFill] Clipboard auto-cleared for security');
                        }
                    } catch (clearError) {
                        // Silently fail - clipboard may have been cleared by user or OS
                        log.debug('[GhostFill] Clipboard auto-clear skipped:', clearError);
                    } finally {
                        clipboardClearTimeout = null;
                    }
                }, clearDelayMs);
            }
            
            return true;
        }

        // Fallback for content scripts or restricted contexts
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.setAttribute('aria-hidden', 'true');
        document.body.appendChild(textArea);
        textArea.select();
        try {
            const successful = document.execCommand('copy');
            
            // SECURITY FIX: Auto-clear for fallback method too
            if (autoClear && successful) {
                if (clipboardClearTimeout) {
                    clearTimeout(clipboardClearTimeout);
                }
                
                clipboardClearTimeout = setTimeout(() => {
                    try {
                        const tempArea = document.createElement('textarea');
                        tempArea.value = '';
                        tempArea.style.position = 'fixed';
                        tempArea.style.left = '-9999px';
                        document.body.appendChild(tempArea);
                        tempArea.select();
                        document.execCommand('copy');
                        document.body.removeChild(tempArea);
                        log.debug('[GhostFill] Clipboard auto-cleared (fallback)');
                    } catch {
                        // Silently fail
                    } finally {
                        clipboardClearTimeout = null;
                    }
                }, clearDelayMs);
            }
            
            return successful;
        } catch {
            return false;
        } finally {
            document.body.removeChild(textArea);
        }
    } catch (error) {
        log.error('Failed to copy to clipboard:', error);
        return false;
    }
}

/**
 * Parse email address
 */
export function parseEmail(email: string): { login: string; domain: string } | null {
    const match = email.match(/^([^@]+)@(.+)$/);
    if (!match) {return null;}
    return { login: match[1], domain: match[2] };
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Get domain from URL
 */
export function getDomain(url: string): string {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname;
    } catch {
        return '';
    }
}

/**
 * Generate unique CSS selector for element
 * FIX: Improved selector uniqueness by:
 * - Skipping dynamic/framework-generated classes
 * - Prioritizing stable attributes (data-testid, name, role)
 * - Using more specific nth-child selectors when needed
 */
export function getUniqueSelector(element: Element): string {
    if (!element) {return '';}

    // Priority 1: Use element ID if available (most stable)
    if (element.id) {
        return `#${CSS.escape(element.id)}`;
    }

    // Priority 2: Use data-testid or data-cy for test selectors (stable)
    const testId = element.getAttribute('data-testid') || element.getAttribute('data-cy');
    if (testId) {
        return `[data-testid="${CSS.escape(testId)}"]`;
    }

    // Priority 3: Use name attribute for form elements
    if (element.hasAttribute('name')) {
        const name = element.getAttribute('name');
        if (name) {
            return `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
        }
    }

    // Priority 4: Use role attribute for accessibility
    if (element.hasAttribute('role')) {
        const role = element.getAttribute('role');
        if (role) {
            return `${element.tagName.toLowerCase()}[role="${CSS.escape(role)}"]`;
        }
    }

    // Priority 5: Build path-based selector
    const parts: string[] = [];
    let current: Element | null = element;

    // Patterns that indicate dynamic/framework-generated classes
    const dynamicClassPatterns = [
        /^_?[a-z]{1,3}[0-9a-f]{4,}$/i,      // Hash-like: _css1234, abc1234
        /^[a-z]{1,2}-[0-9a-f]{4,}$/i,       // Hash with dash: a-1234abcd
        /^css-[0-9a-f]+$/i,                  // CSS modules: css-1a2b3c
        /^_?jsx?-?/i,                        // React/JSX generated
        /^_?emotion-/i,                      // Emotion styled
        /^sc-/i,                             // Styled components
        /^v-/i,                              // Vue generated
        /^ng-/i,                             // Angular generated
        /^svelte-[a-z0-9]+$/i,               // Svelte generated
        /^chakra-/i,                         // Chakra UI
        /^Mui/i,                             // Material UI
        /^ant-/i,                            // Ant Design
        /^el-/i,                             // Element UI
        /^_? radix-/i,                       // Radix UI
    ];

    const isDynamicClass = (className: string): boolean => {
        return dynamicClassPatterns.some(pattern => pattern.test(className));
    };

    while (current && current !== document.body && current.parentElement) {
        let part = current.tagName.toLowerCase();

        // Only use stable, semantic classes (skip dynamic ones)
        if (current.className && typeof current.className === 'string') {
            const classes = current.className
                .split(/\s+/)
                .filter(Boolean)
                .filter(c => !isDynamicClass(c))  // FIX: Filter out dynamic classes
                .slice(0, 2);

            if (classes.length > 0) {
                part += classes.map(c => `.${CSS.escape(c)}`).join('');
            }
        }

        // Add nth-child for disambiguation when siblings exist
        const siblings = current.parentElement?.children;
        if (siblings && siblings.length > 1) {
            // Count siblings with same tag name for more specific selector
            const sameTagSiblings = Array.from(siblings).filter(
                sib => sib.tagName === current!.tagName
            );
            if (sameTagSiblings.length > 1) {
                const index = sameTagSiblings.indexOf(current) + 1;
                part += `:nth-of-type(${index})`;
            } else {
                // Fall back to nth-child if tag names differ
                const index = Array.from(siblings).indexOf(current) + 1;
                part += `:nth-child(${index})`;
            }
        }

        parts.unshift(part);
        current = current.parentElement;
    }

    // If we couldn't build a meaningful selector, use a path-based fallback
    if (parts.length === 0 || (parts.length === 1 && parts[0] === element.tagName.toLowerCase())) {
        // Use absolute path as last resort
        return buildAbsolutePathSelector(element);
    }

    return parts.join(' > ');
}

/**
 * Build an absolute path selector as fallback
 */
function buildAbsolutePathSelector(element: Element): string {
    const parts: string[] = [];
    let current: Element | null = element;

    while (current && current !== document.body && current.parentElement) {
        const tag = current.tagName.toLowerCase();
        const siblings = current.parentElement?.children;
        
        if (siblings && siblings.length > 1) {
            const index = Array.from(siblings).indexOf(current) + 1;
            parts.unshift(`${tag}:nth-child(${index})`);
        } else {
            parts.unshift(tag);
        }
        
        current = current.parentElement;
    }

    return parts.join(' > ');
}

/**
 * Check if element is visible
 */
export function isElementVisible(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0'
    );
}

/**
 * Get element's computed label
 */
export function getElementLabel(input: HTMLInputElement | HTMLTextAreaElement): string {
    // Check for explicit label
    if (input.id) {
        const label = document.querySelector(`label[for="${input.id}"]`);
        if (label) {return label.textContent?.trim() || '';}
    }

    // Check for implicit label (wrapped)
    const parentLabel = input.closest('label');
    if (parentLabel) {
        return parentLabel.textContent?.replace(input.value, '').trim() || '';
    }

    // Check for aria-label
    if (input.ariaLabel) {return input.ariaLabel;}

    // Check for aria-labelledby
    const labelledBy = input.getAttribute('aria-labelledby');
    if (labelledBy) {
        const labelElement = document.getElementById(labelledBy);
        if (labelElement) {return labelElement.textContent?.trim() || '';}
    }

    // Check for placeholder
    if (input.placeholder) {return input.placeholder;}

    // Check for nearby text
    const prevSibling = input.previousElementSibling;
    if (prevSibling && prevSibling.textContent) {
        return prevSibling.textContent.trim();
    }

    return '';
}
