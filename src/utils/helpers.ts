// Utility Helpers

import {
  secureMathRandom,
  deepClone,
  deepMerge,
  isObject,
  generateId,
  generateRandomString,
  sleep,
  retry,
  formatRelativeTime,
  formatDateTime,
  truncate,
  parseEmail,
  isValidEmail,
  getDomain,
  escapeHtml,
  stripHtml,
} from './core';
import { createLogger } from './logger';

const log = createLogger('Helpers');

export {
  secureMathRandom,
  deepClone,
  deepMerge,
  isObject,
  generateId,
  generateRandomString,
  sleep,
  retry,
  formatRelativeTime,
  formatDateTime,
  truncate,
  parseEmail,
  isValidEmail,
  getDomain,
  escapeHtml,
  stripHtml,
};

/**
 * Copy text to clipboard using the modern Clipboard API
 * Fallback to execCommand('copy') for older browsers/environments or visible contexts
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) {
    return false;
  }

  // In popup context, prefer execCommand because it's synchronous
  // and won't be interrupted if the popup closes immediately.
  if (document.visibilityState === 'visible' && typeof document.execCommand === 'function') {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      textArea.style.top = '-9999px';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      if (successful) {
        return true;
      }
    } catch (e) {
      log.warn('Fallback copy failed, trying async API', e);
    }
  }

  try {
    // Try modern API
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    return false;
  } catch (err) {
    log.error('Failed to copy to clipboard', err);
    return false;
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
  if (!element) {
    return '';
  }

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
    /^_?[a-z]{1,3}[0-9a-f]{4,}$/i, // Hash-like: _css1234, abc1234
    /^[a-z]{1,2}-[0-9a-f]{4,}$/i, // Hash with dash: a-1234abcd
    /^css-[0-9a-f]+$/i, // CSS modules: css-1a2b3c
    /^_?jsx?-?/i, // React/JSX generated
    /^_?emotion-/i, // Emotion styled
    /^sc-/i, // Styled components
    /^v-/i, // Vue generated
    /^ng-/i, // Angular generated
    /^svelte-[a-z0-9]+$/i, // Svelte generated
    /^chakra-/i, // Chakra UI
    /^Mui/i, // Material UI
    /^ant-/i, // Ant Design
    /^el-/i, // Element UI
    /^_?radix-/i, // Radix UI
  ];

  const isDynamicClass = (className: string): boolean => {
    return dynamicClassPatterns.some((pattern) => pattern.test(className));
  };

  while (current && current !== document.body && current.parentElement) {
    let part = current.tagName.toLowerCase();

    // Only use stable, semantic classes (skip dynamic ones)
    if (current.className && typeof current.className === 'string') {
      const classes = current.className
        .split(/\s+/)
        .filter(Boolean)
        .filter((c) => !isDynamicClass(c)) // FIX: Filter out dynamic classes
        .slice(0, 2);

      if (classes.length > 0) {
        part += classes.map((c) => `.${CSS.escape(c)}`).join('');
      }
    }

    // Add nth-child for disambiguation when siblings exist
    const siblings = current.parentElement?.children;
    if (siblings && siblings.length > 1) {
      // Count siblings with same tag name for more specific selector
      const sameTagSiblings = Array.from(siblings).filter(
        (sib) => sib.tagName === current!.tagName
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
    try {
      const label = document.querySelector(
        `label[for="${CSS.escape(input.id).replace(/"/g, '\\"')}"]`
      );
      if (label) {
        return label.textContent?.trim() || '';
      }
    } catch {
      // Ignore syntax errors from invalid selectors
    }
  }

  // Check for implicit label (wrapped)
  const parentLabel = input.closest('label');
  if (parentLabel) {
    return parentLabel.textContent?.replace(input.value, '').trim() || '';
  }

  // Check for aria-label
  if (input.ariaLabel) {
    return input.ariaLabel;
  }

  // Check for aria-labelledby
  const labelledBy = input.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelElement = document.getElementById(labelledBy);
    if (labelElement) {
      return labelElement.textContent?.trim() || '';
    }
  }

  // Check for placeholder
  if (input.placeholder) {
    return input.placeholder;
  }

  // Check for nearby text
  const prevSibling = input.previousElementSibling;
  if (prevSibling && prevSibling.textContent) {
    return prevSibling.textContent.trim();
  }

  return '';
}

/** Maximum shadow DOM recursion depth */
const MAX_SHADOW_DEPTH = 10;

/** Maximum elements to scan for shadow roots */
const MAX_SHADOW_SCAN_ELEMENTS = 5000;

const shadowRootCache = new WeakMap<Element, ShadowRoot>();
let shadowObserver: MutationObserver | null = null;

function initShadowObserver(): void {
  if (shadowObserver || typeof MutationObserver === 'undefined' || !document.body) {
    return;
  }
  shadowObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (let i = 0; i < m.addedNodes.length; i++) {
        const node = m.addedNodes[i];
        if (node instanceof HTMLElement && node.shadowRoot) {
          shadowRootCache.set(node, node.shadowRoot);
        }
      }
    }
  });
  shadowObserver.observe(document.body, { childList: true, subtree: true });
}

/**
 * Deep query selector that pierces through shadow DOM boundaries.
 * Required for finding elements encapsulated entirely within web components.
 */
export function deepQuerySelectorAll<T extends Element>(
  selector: string,
  root: Document | Element | ShadowRoot = document,
  depth: number = 0
): T[] {
  if (depth > MAX_SHADOW_DEPTH) {
    return [];
  }
  initShadowObserver();

  const results: T[] = [];

  try {
    results.push(...Array.from(root.querySelectorAll<T>(selector)));
  } catch {
    // Ignore invalid selector errors
  }

  // ── Zero-allocation TreeWalker shadow root discovery ─────────────────────
  // TreeWalker visits only nodes that pass the filter — unlike querySelectorAll('*')
  // which allocates a full NodeList of EVERY element in the subtree before iteration.
  // We filter to only accept elements that host a shadow root, so traversal is O(shadow-hosts).
  try {
    const treeRoot =
      root instanceof Document ? root.documentElement : (root as Element | ShadowRoot);

    if (!treeRoot) {
      return results;
    }

    const walker = document.createTreeWalker(treeRoot, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node: Node): number {
        return (node as Element).shadowRoot ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });

    let node: Node | null;
    let count = 0;
    while ((node = walker.nextNode()) && count < MAX_SHADOW_SCAN_ELEMENTS) {
      count++;
      const el = node as Element;
      let shadow = shadowRootCache.get(el);
      if (!shadow && el.shadowRoot) {
        shadow = el.shadowRoot;
        shadowRootCache.set(el, shadow);
      }
      if (shadow) {
        try {
          results.push(...deepQuerySelectorAll<T>(selector, shadow, depth + 1));
        } catch {
          // Shadow root access denied or detached
        }
      }
    }
  } catch {
    // Root detached during iteration
  }

  return results;
}

/**
 * Wraps a promise with a timeout.
 * Rejects with a TimeoutError if the promise takes too long.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Timeout')), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

/**
 * Retries a function with exponential backoff.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fn();
      if (res === null) {
        throw new Error('Operation returned null');
      }
      if (res && typeof res === 'object' && 'error' in res) {
        throw new Error(String((res as any).error));
      }
      return res;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      const delay = baseDelay * Math.pow(2, i);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError || new Error('Max retries reached');
}

/**
 * Safely opens a URL with strict http/https scheme validation.
 */
export function openSafeUrl(url: string): void {
  if (!url) {return;}
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      log.warn(`Blocked unsafe URL protocol attempt: ${parsed.protocol}`);
      return;
    }
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      void chrome.tabs.create({ url: parsed.toString(), active: true });
    } else {
      window.open(parsed.toString(), '_blank', 'noopener,noreferrer');
    }
  } catch (e) {
    log.error('Invalid URL passed to openSafeUrl', e);
  }
}
