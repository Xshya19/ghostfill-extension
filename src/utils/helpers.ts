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
 * Fallback to execCommand('copy') for older browsers/environments
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) {
    return false;
  }

  try {
    // 1. Try modern API
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    // 2. Fallback to execCommand
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
    return successful;
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
    /^_? radix-/i, // Radix UI
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

  const results: T[] = [];

  try {
    results.push(...Array.from(root.querySelectorAll<T>(selector)));
  } catch {
    return results;
  }

  try {
    const allElements = root.querySelectorAll('*');
    const scanLimit = Math.min(allElements.length, MAX_SHADOW_SCAN_ELEMENTS);

    for (let i = 0; i < scanLimit; i++) {
      const el = allElements[i];
      if (el?.shadowRoot) {
        try {
          results.push(...deepQuerySelectorAll<T>(selector, el.shadowRoot, depth + 1));
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
