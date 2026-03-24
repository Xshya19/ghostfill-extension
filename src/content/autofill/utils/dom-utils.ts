/**
 * DOM Utilities for GhostFill Autofill Engine
 */

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function safeQuerySelector<T extends Element>(root: ParentNode, selector: string): T | null {
  try {
    return root.querySelector<T>(selector);
  } catch {
    return null;
  }
}

export function safeQuerySelectorAll<T extends Element>(root: ParentNode, selector: string): T[] {
  try {
    return Array.from(root.querySelectorAll<T>(selector));
  } catch {
    return [];
  }
}

export function escapeCSS(value: string): string {
  try {
    return CSS.escape(value);
  } catch {
    return value.replace(/([^\w-])/g, '\\$1');
  }
}

export function combineStrings(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ').toLowerCase();
}

export class VisibilityEngine {
  /**
   * Strict visibility check: element must have non-zero dimensions,
   * not be display:none, not be visibility:hidden, and not be opacity:0.
   */
  static isVisible(element: HTMLElement): boolean {
    if (!element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  /**
   * Relaxed visibility: allows opacity:0 and tiny elements.
   */
  static isVisibleRelaxed(element: HTMLElement): boolean {
    if (!element.isConnected) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none';
  }

  /**
   * Check if an input is fillable (visible + enabled + writable).
   */
  static isFillable(element: HTMLInputElement | HTMLTextAreaElement): boolean {
    return this.isVisible(element) && !element.disabled && !element.readOnly;
  }

  /**
   * Check if an input is fillable with relaxed visibility.
   */
  static isFillableRelaxed(element: HTMLInputElement | HTMLTextAreaElement): boolean {
    return this.isVisibleRelaxed(element) && !element.disabled && !element.readOnly;
  }
}
