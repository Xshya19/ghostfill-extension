/**
 * otp-detection-utils.ts — OTP Detection Utility Classes
 *
 * Extracted from otpPageDetector.ts to enforce single responsibility.
 * Contains all pure utility classes (§4–§9) that perform no I/O
 * and have no side effects — purely DOM-query utilities.
 *
 * The main OTPPageDetector orchestrator remains in otpPageDetector.ts
 * and imports from here.
 */

// ── Types (inlined for zero-import-overhead) ──────────────────────────────────

export interface OTPGroupInfo {
  readonly groupId: string;
  readonly groupIndex: number;
  readonly groupSize: number;
}

export interface OTPFieldEntry {
  element: HTMLInputElement;
  selector: string;
  source: string;
  score: number;
  groupId: string | null;
  groupIndex: number;
  groupSize: number;
  maxLength: number;
  inputMode: string;
  visible: boolean;
}

export interface SignalScore {
  readonly signal: string;
  readonly weight: number;
  readonly matched: boolean;
  readonly detail?: string | undefined;
}

// ── Config (consumed by utility classes only) ─────────────────────────────────

export const OTP_DETECTION_CONFIG = {
  VISIBILITY_MAX_DEPTH: 10,
  SPLIT_DIGIT_MIN: 4,
  SPLIT_DIGIT_MAX: 8,
  SMALL_INPUT_MAX_WIDTH: 65,
  SMALL_INPUT_MIN_WIDTH: 18,
  SIZE_VARIANCE_PX: 20,
  CONTIGUITY_H_GAP_PX: 80,
  CONTIGUITY_V_DELTA_PX: 20,
  CONTIGUITY_MAX_DEPTH: 3,
  MAX_CLASS_SELECTOR_COUNT: 2,
  MAX_LABEL_TEXT_LENGTH: 200,
} as const;

// ── Keyword Sets ──────────────────────────────────────────────────────────────

export const OTP_KEYWORDS: ReadonlySet<string> = new Set([
  'otp',
  'code',
  'verify',
  'verification',
  'token',
  'pin',
  '2fa',
  'mfa',
  'totp',
  'passcode',
  'one-time',
  'onetime',
  'auth-code',
  'authcode',
  'security-code',
  'securitycode',
  'confirmation',
  'confirm-code',
  'sms-code',
  'smscode',
  'twofa',
  'twofactor',
  'authenticator',
]);

export const OTP_CONTEXT_PHRASES: readonly string[] = [
  'verification code',
  'verify code',
  'enter code',
  'enter the code',
  'one-time password',
  'one time password',
  'otp',
  'authentication code',
  'security code',
  'confirmation code',
  'sms code',
  'two-factor',
  'two factor',
  '2fa',
  'mfa',
  'we sent',
  "we've sent",
  'code sent',
  'code was sent',
  'digit code',
  'check your phone',
  'check your email',
  'verify your identity',
  'verify your account',
  'enter verification',
  'enter your code',
  'enter otp',
];

export const SEARCH_INDICATORS: ReadonlySet<string> = new Set([
  'search',
  'query',
  'q',
  'keyword',
  'find',
  'lookup',
]);

// ── Pure Utility Functions ────────────────────────────────────────────────────

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
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

export function generateGroupId(prefix: string, hint?: string): string {
  const suffix = hint ?? Math.random().toString(36).slice(2, 8);
  return `${prefix}-${suffix}`;
}

// ── §4  VisibilityEngine ──────────────────────────────────────────────────────

/**
 * Checks DOM element visibility considering ancestor chain.
 */
export class VisibilityEngine {
  static isVisible(el: HTMLElement): boolean {
    if (!el.isConnected) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    let current: HTMLElement | null = el;
    let depth = 0;

    while (current && depth < OTP_DETECTION_CONFIG.VISIBILITY_MAX_DEPTH) {
      const style = window.getComputedStyle(current);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        parseFloat(style.opacity || '1') < 0.05
      ) {
        return false;
      }
      current = current.parentElement;
      depth++;
    }
    return true;
  }
}

// ── §5  KeywordMatcher ────────────────────────────────────────────────────────

/**
 * Matches OTP keywords and context phrases in text strings.
 */
export class KeywordMatcher {
  static matchesKeyword(text: string): boolean {
    const lower = text.toLowerCase();
    const tokens = lower.split(/[^a-z0-9]+/);
    return tokens.some((t) => t.length > 0 && OTP_KEYWORDS.has(t));
  }

  static matchesContextPhrase(text: string): boolean {
    const lower = text.toLowerCase();
    return OTP_CONTEXT_PHRASES.some((p) => lower.includes(p));
  }

  static isSearchInput(input: HTMLInputElement): boolean {
    if (input.type === 'search') {
      return true;
    }
    const combined = [
      input.name ?? '',
      input.id ?? '',
      input.placeholder ?? '',
      input.getAttribute('aria-label') ?? '',
    ]
      .join(' ')
      .toLowerCase();
    const tokens = combined.split(/[^a-z0-9]+/);
    return tokens.some((t) => t.length > 0 && SEARCH_INDICATORS.has(t));
  }
}

// ── §6  LabelResolver ────────────────────────────────────────────────────────

/**
 * Resolves label text for input elements via label[for], wrapping label,
 * aria-labelledby.
 */
export class LabelResolver {
  static getAssociatedLabelText(input: HTMLInputElement): string {
    if (input.id) {
      const label = safeQuerySelector<HTMLLabelElement>(
        document,
        `label[for="${escapeCSS(input.id)}"]`
      );
      if (label?.textContent) {
        const text = label.textContent.trim();
        if (text.length <= OTP_DETECTION_CONFIG.MAX_LABEL_TEXT_LENGTH) {
          return text.toLowerCase();
        }
      }
    }

    const wrapping = input.closest('label');
    if (wrapping?.textContent) {
      const text = wrapping.textContent.trim();
      if (text.length <= OTP_DETECTION_CONFIG.MAX_LABEL_TEXT_LENGTH) {
        return text.toLowerCase();
      }
    }

    const labelledBy = input.getAttribute('aria-labelledby');
    if (labelledBy) {
      const texts: string[] = [];
      for (const id of labelledBy.split(/\s+/)) {
        const el = document.getElementById(id.trim());
        if (el?.textContent) {
          texts.push(el.textContent.trim());
        }
      }
      if (texts.length > 0) {
        const combined = texts.join(' ');
        if (combined.length <= OTP_DETECTION_CONFIG.MAX_LABEL_TEXT_LENGTH) {
          return combined.toLowerCase();
        }
      }
    }

    return '';
  }
}

// ── §7  SelectorGenerator ────────────────────────────────────────────────────

/**
 * Generates verified, minimal CSS selectors for input elements.
 * Tries 7 strategies in priority order, falling back to DOM path.
 */
export class SelectorGenerator {
  static generate(el: HTMLInputElement): string {
    const strategies: Array<() => string | null> = [
      () => {
        if (!el.id) {
          return null;
        }
        const sel = `#${escapeCSS(el.id)}`;
        return this.verify(sel, el) ? sel : null;
      },
      () => {
        if (!el.name) {
          return null;
        }
        const sel = `input[name="${escapeCSS(el.name)}"]`;
        return this.verify(sel, el) ? sel : null;
      },
      () => {
        if (el.autocomplete !== 'one-time-code') {
          return null;
        }
        const sel = 'input[autocomplete="one-time-code"]';
        return this.verify(sel, el) ? sel : null;
      },
      () => {
        for (const attr of el.attributes) {
          if (attr.name.startsWith('data-') && attr.value) {
            const sel = `input[${attr.name}="${escapeCSS(attr.value)}"]`;
            if (this.verify(sel, el)) {
              return sel;
            }
          }
        }
        return null;
      },
      () => {
        if (!el.className || typeof el.className !== 'string') {
          return null;
        }
        const valid = el.className
          .split(/\s+/)
          .filter((c) => c.length > 1 && /^[a-zA-Z_-][\w-]*$/.test(c))
          .slice(0, OTP_DETECTION_CONFIG.MAX_CLASS_SELECTOR_COUNT);
        if (valid.length === 0) {
          return null;
        }
        const sel = `input.${valid.map(escapeCSS).join('.')}`;
        return this.verify(sel, el) ? sel : null;
      },
      () => {
        const parent = el.parentElement;
        if (!parent) {
          return null;
        }
        const siblings = Array.from(parent.querySelectorAll(':scope > input'));
        const idx = siblings.indexOf(el);
        if (idx < 0) {
          return null;
        }
        let parentSel = '';
        if (parent.id) {
          parentSel = `#${escapeCSS(parent.id)}`;
        } else if (parent.className && typeof parent.className === 'string') {
          const cls = parent.className
            .split(/\s+/)
            .filter((c) => /^[a-zA-Z_-][\w-]*$/.test(c))
            .slice(0, 1);
          if (cls.length > 0 && cls[0]) {
            parentSel = `.${escapeCSS(cls[0])}`;
          }
        }
        const sel = parentSel
          ? `${parentSel} > input:nth-of-type(${idx + 1})`
          : `input:nth-of-type(${idx + 1})`;
        return this.verify(sel, el) ? sel : null;
      },
      () => this.buildDomPath(el),
    ];

    for (const strategy of strategies) {
      try {
        const sel = strategy();
        if (sel) {
          return sel;
        }
      } catch {
        /* next strategy */
      }
    }

    return `input[type="${escapeCSS(el.type || 'text')}"]`;
  }

  private static verify(selector: string, expected: HTMLInputElement): boolean {
    try {
      const all = document.querySelectorAll<HTMLInputElement>(selector);
      return all.length === 1 && all[0] === expected;
    } catch {
      return false;
    }
  }

  private static buildDomPath(el: HTMLElement): string {
    const parts: string[] = [];
    let current: HTMLElement | null = el;
    while (current && current !== document.body && current !== document.documentElement) {
      const parentElement: HTMLElement | null = current.parentElement;
      if (!parentElement) {
        break;
      }
      const tag = current.tagName.toLowerCase();
      const siblings = Array.from(parentElement.children);
      const index = siblings.indexOf(current) + 1;
      parts.unshift(`${tag}:nth-child(${index})`);
      current = parentElement;
    }
    parts.unshift('body');
    return parts.join(' > ');
  }
}

// ── §8  SignalCollector ────────────────────────────────────────────────────────

/**
 * Accumulates weighted detection signals for confidence scoring.
 */
export class SignalCollector {
  private readonly signals: SignalScore[] = [];

  push(signal: string, weight: number, matched: boolean, detail?: string): void {
    this.signals.push(Object.freeze({ signal, weight, matched, detail }));
  }

  getAll(): SignalScore[] {
    return [...this.signals];
  }
}

// ── §9  FieldRegistry ─────────────────────────────────────────────────────────

/**
 * Maintains a deduplicated map of detected OTP fields, keeping
 * the highest confidence entry per element.
 */
export class FieldRegistry {
  private readonly map = new Map<HTMLInputElement, OTPFieldEntry>();

  get size(): number {
    return this.map.size;
  }
  get(input: HTMLInputElement): OTPFieldEntry | undefined {
    return this.map.get(input);
  }
  has(input: HTMLInputElement): boolean {
    return this.map.has(input);
  }

  register(input: HTMLInputElement, source: string, score: number, group?: OTPGroupInfo): void {
    const existing = this.map.get(input);
    if (existing) {
      if (score > existing.score) {
        existing.score = clamp(score, 0, 1);
        existing.source = source;
      }
      if (group && !existing.groupId) {
        existing.groupId = group.groupId;
        existing.groupIndex = group.groupIndex;
        existing.groupSize = group.groupSize;
      }
      return;
    }

    const selector = SelectorGenerator.generate(input);
    this.map.set(input, {
      element: input,
      selector,
      source,
      score: clamp(score, 0, 1),
      groupId: group?.groupId ?? null,
      groupIndex: group?.groupIndex ?? 0,
      groupSize: group?.groupSize ?? 1,
      maxLength: input.maxLength > 0 ? input.maxLength : -1,
      inputMode: input.inputMode || input.getAttribute('inputmode') || '',
      visible: true,
    });
  }

  getSorted(): OTPFieldEntry[] {
    return Array.from(this.map.values()).sort((a, b) => b.score - a.score);
  }

  getMaxScore(): number {
    let max = 0;
    for (const field of this.map.values()) {
      if (field.score > max) {
        max = field.score;
      }
    }
    return max;
  }
}
