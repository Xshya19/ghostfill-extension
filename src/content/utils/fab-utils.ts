/**
 * fab-utils.ts — Shared utility functions for the FAB system
 *
 * Extracted from floatingButton.ts §1.1 to avoid duplication across
 * floatingButton, fieldAnalyzer, otpPageDetector, and autofill utils.
 */

export function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeCSS(value: string): string {
  try {
    return CSS.escape(value);
  } catch {
    return value.replace(/([^\w-])/g, '\\$1');
  }
}

export function safeQuerySelector<T extends Element>(root: ParentNode, selector: string): T | null {
  try {
    return root.querySelector<T>(selector);
  } catch {
    return null;
  }
}

export function isFormInputElement(el: unknown): el is HTMLElement {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return true;
  }
  if (el instanceof HTMLElement) {
    return el.isContentEditable || el.getAttribute('role') === 'textbox';
  }
  return false;
}
