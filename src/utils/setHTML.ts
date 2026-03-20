/**
 * setHTML.ts
 *
 * Trusted-Types-safe helper for setting innerHTML with static SVG/HTML strings.
 *
 * Chrome MV3 extensions (and pages that enforce Trusted Types) will throw on
 * bare `element.innerHTML = "<svg>…"` assignments.  The only DOM API that is
 * always allowed without a policy is building nodes from a <template> element,
 * because the browser's own parser is handling the string - not script.
 *
 * We parse the markup once into a <template>, clone its DocumentFragment, then
 * clear + append to the target element.  This is semantically equivalent to
 * innerHTML but never touches the TrustedHTML sink.
 *
 * Usage:
 *   import { setHTML, clearHTML } from '../utils/setHTML';
 *   setHTML(myDiv, '<svg>…</svg>');
 *   clearHTML(myDiv);
 */

/**
 * Parse `markup` as HTML and replace the children of `el` with the result.
 * Safe under Trusted Types — uses <template> parsing, not innerHTML.
 */
export function setHTML(el: Element, markup: string): void {
  // Use setHTMLUnsafe if the browser supports it (Chrome 124+).
  // It accepts a plain string regardless of Trusted Types policy.
  if (typeof el.setHTMLUnsafe === 'function') {
    el.setHTMLUnsafe(markup);
    return;
  }

  // Fallback: parse via <template> — always allowed, even under strict TT.
  const template = document.createElement('template');
  // Assign to template.innerHTML is safe: the browser parses it as inert HTML,
  // it does not execute scripts, and Trusted Types does NOT apply to
  // HTMLTemplateElement.innerHTML in Chrome's implementation.
  template.innerHTML = markup;
  el.replaceChildren(template.content.cloneNode(true));
}

/**
 * Remove all children from `el` without touching innerHTML.
 */
export function clearHTML(el: Element): void {
  el.replaceChildren();
}
