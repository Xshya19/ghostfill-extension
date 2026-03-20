// ─────────────────────────────────────────────────────────────────────
// OTP Page Detector v2 — Intelligent Verification Page Engine
//
// ┌──────────────────────────────────────────────────────────────────┐
// │  Architecture                                                   │
// │                                                                 │
// │  ┌─────────────┐   DOM mutation / URL change / focus            │
// │  │  Scheduler   │◄──────────────────────────────────────────    │
// │  │  (debounced) │                                               │
// │  └──────┬──────┘                                                │
// │         ▼                                                       │
// │  ┌─────────────┐   weighted signals → composite score           │
// │  │  Scoring     │──► confidence ≥ threshold?                    │
// │  │  Engine      │        │ YES               │ NO               │
// │  └─────────────┘        ▼                    ▼                  │
// │               ┌──────────────┐      AI fallback (once)          │
// │               │  Field Map   │                                  │
// │               │  (verified   │                                  │
// │               │   selectors) │                                  │
// │               └──────┬──────┘                                   │
// │                      ▼                                          │
// │               Notify background → start fast OTP polling        │
// │               Listen for AUTO_FILL_OTP → fill → feedback        │
// └──────────────────────────────────────────────────────────────────┘
// ─────────────────────────────────────────────────────────────────────

import { ExtensionMessage } from '../types';
import { createLogger } from '../utils/logger';
import { safeSendMessage } from '../utils/messaging';
import { setHTML } from '../utils/setHTML';
import { AutoFiller } from './autoFiller';
import { FormDetector } from './formDetector';

const log = createLogger('OTPDetector');

// ═══════════════════════════════════════════════════════════════
//  §0  T Y P E S
// ═══════════════════════════════════════════════════════════════

interface OTPField {
  element: HTMLInputElement;
  selector: string;
  source: DetectionSource;
  score: number;
  groupId: string | null;
  groupIndex: number;
  groupSize: number;
  maxLength: number;
  inputMode: string;
  visible: boolean;
}

type DetectionSource =
  | 'autocomplete-attr'
  | 'name-attr'
  | 'id-attr'
  | 'placeholder-attr'
  | 'aria-label-attr'
  | 'label-association'
  | 'maxlength-heuristic'
  | 'split-digit-group'
  | 'small-input-cluster'
  | 'form-detector'
  | 'ai-container-analysis'
  | 'ai-background';

type PageVerdict = 'otp-page' | 'possible-otp' | 'not-otp';

interface DetectionResult {
  readonly verdict: PageVerdict;
  readonly confidence: number;
  readonly fields: OTPField[];
  readonly signalBreakdown: SignalScore[];
  readonly detectedAt: number;
  readonly durationMs: number;
}

interface SignalScore {
  readonly signal: string;
  readonly weight: number;
  readonly matched: boolean;
  readonly detail?: string;
}

interface DetectionMetrics {
  runsTotal: number;
  runsPositive: number;
  avgDurationMs: number;
  lastVerdict: PageVerdict;
  lastConfidence: number;
  fieldsFound: number;
  otpsFilled: number;
  otpsFillFailed: number;
  aiRequested: boolean;
  aiResponded: boolean;
}

interface AutoFillPayload {
  readonly otp: string;
  readonly source: string;
  readonly confidence: number;
}

interface AIAnalysisResponse {
  success: boolean;
  result?: { confidence?: number };
}

interface OTPGroupInfo {
  readonly groupId: string;
  readonly groupIndex: number;
  readonly groupSize: number;
}

interface AIContainerResult {
  readonly input: HTMLInputElement;
  readonly groupId: string;
  readonly groupIndex: number;
  readonly groupSize: number;
}

// ═══════════════════════════════════════════════════════════════
//  §1  C O N S T A N T S
// ═══════════════════════════════════════════════════════════════

/** Signal weights for composite scoring */
const SIGNAL_WEIGHTS = {
  // ── Category 1: HTML attributes (strongest) ──
  AUTOCOMPLETE_OTC: 0.35,
  INPUT_MODE_NUMERIC: 0.08,

  // ── Category 2: Name / ID / placeholder keywords ──
  NAME_OTP_KEYWORD: 0.2,
  ID_OTP_KEYWORD: 0.18,
  PLACEHOLDER_KEYWORD: 0.15,
  ARIA_LABEL_KEYWORD: 0.14,
  LABEL_KEYWORD: 0.14,

  // ── Category 3: Structural patterns ──
  SPLIT_DIGIT_GROUP: 0.3,
  SMALL_CLUSTER: 0.22,
  MAXLENGTH_4_TO_8: 0.1,

  // ── Category 4: Page context ──
  PAGE_TITLE_KEYWORD: 0.1,
  BODY_TEXT_KEYWORD: 0.12,
  URL_KEYWORD: 0.08,

  // ── Category 5: Form detector agreement ──
  FORM_DETECTOR_2FA: 0.25,

  // ── Negative signals (subtracted) ──
  LOGIN_FORM_PRESENT: -0.15,
  SEARCH_BAR_LIKELY: -0.2,
} as const;

/** Standalone OTP field from FormDetector gets 60% of 2FA weight */
const STANDALONE_OTP_WEIGHT_RATIO = 0.6;

const CONFIDENCE_THRESHOLD = 0.4;
const HIGH_CONFIDENCE = 0.7;
const AI_FALLBACK_THRESHOLD = 0.25;
const AI_CONFIRM_THRESHOLD = 0.7;

/** Configuration constants */
const CONFIG = {
  DEBOUNCE_MS: 300,
  INITIAL_DELAY_MS: 150,
  OBSERVER_THROTTLE_MS: 500,
  TOAST_DURATION_MS: 3_500,
  TOAST_ANIMATION_MS: 300,
  MAX_BODY_SCAN_CHARS: 3_000,
  MAX_DOM_SNAPSHOT_CHARS: 5_000,
  MAX_FORM_SNAPSHOT_CHARS: 2_000,
  SPLIT_DIGIT_MIN: 4,
  SPLIT_DIGIT_MAX: 8,
  SMALL_INPUT_MAX_WIDTH: 65,
  SMALL_INPUT_MIN_WIDTH: 18,
  SIZE_VARIANCE_PX: 20,
  CONTIGUITY_H_GAP_PX: 80,
  CONTIGUITY_V_DELTA_PX: 20,
  CONTIGUITY_MAX_DEPTH: 3,
  VISIBILITY_MAX_DEPTH: 10,
  CONTEXT_SCORE_MIN: -0.3,
  CONTEXT_SCORE_MAX: 0.3,
  EMA_ALPHA: 0.2,
  MAX_CLASS_SELECTOR_COUNT: 2,
  MAX_LABEL_TEXT_LENGTH: 200,
} as const;

/** Input selector for candidate discovery */
const CANDIDATE_INPUT_SELECTOR = [
  'input:not([type="hidden"])',
  ':not([type="submit"])',
  ':not([type="button"])',
  ':not([type="checkbox"])',
  ':not([type="radio"])',
  ':not([type="file"])',
  ':not([type="image"])',
  ':not([type="reset"])',
  ':not([type="range"])',
  ':not([type="color"])',
].join('');

/** Valid input types for OTP fields */
const VALID_OTP_INPUT_TYPES = new Set(['text', 'tel', 'number', '']);

// ═══════════════════════════════════════════════════════════════
//  §2  K E Y W O R D   S E T S
// ═══════════════════════════════════════════════════════════════

const OTP_KEYWORDS: ReadonlySet<string> = new Set([
  'otp', 'code', 'verify', 'verification', 'token', 'pin',
  '2fa', 'mfa', 'totp', 'passcode', 'one-time', 'onetime',
  'auth-code', 'authcode', 'security-code', 'securitycode',
  'confirmation', 'confirm-code', 'sms-code', 'smscode',
  'twofa', 'twofactor', 'authenticator',
]);

const OTP_CONTEXT_PHRASES: readonly string[] = [
  'verification code', 'verify code', 'enter code', 'enter the code',
  'one-time password', 'one time password', 'otp', 'authentication code',
  'security code', 'confirmation code', 'sms code', 'two-factor',
  'two factor', '2fa', 'mfa', 'we sent', "we've sent", 'code sent',
  'code was sent', 'digit code', 'check your phone', 'check your email',
  'verify your identity', 'verify your account', 'enter verification',
  'enter your code', 'enter otp',
];

const SEARCH_INDICATORS: ReadonlySet<string> = new Set([
  'search', 'query', 'q', 'keyword', 'find', 'lookup',
]);

/** MutationObserver attribute filter */
const OBSERVED_ATTRIBUTES: readonly string[] = [
  'type', 'name', 'id', 'placeholder', 'maxlength', 'autocomplete',
  'inputmode', 'aria-label', 'style', 'class', 'hidden', 'disabled',
];

// ═══════════════════════════════════════════════════════════════
//  §3  U T I L I T Y   F U N C T I O N S
// ═══════════════════════════════════════════════════════════════

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function truncate(s: string | undefined | null, max: number): string {
  if (!s) {return '';}
  return s.length > max ? s.substring(0, max) + '…' : s;
}

function escapeCSS(value: string): string {
  try {
    return CSS.escape(value);
  } catch {
    return value.replace(/([^\w-])/g, '\\$1');
  }
}

function safeQuerySelector<T extends Element>(
  root: ParentNode,
  selector: string
): T | null {
  try {
    return root.querySelector<T>(selector);
  } catch {
    return null;
  }
}

function generateGroupId(prefix: string, hint?: string): string {
  const suffix = hint || Math.random().toString(36).slice(2, 8);
  return `${prefix}-${suffix}`;
}

// ═══════════════════════════════════════════════════════════════
//  §4  V I S I B I L I T Y   E N G I N E
// ═══════════════════════════════════════════════════════════════

class VisibilityEngine {
  /**
   * Check if element is visible: non-zero dimensions + no CSS hiding
   * up to CONFIG.VISIBILITY_MAX_DEPTH ancestor levels.
   */
  static isVisible(el: HTMLElement): boolean {
    if (!el.isConnected) {return false;}

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {return false;}

    let current: HTMLElement | null = el;
    let depth = 0;

    while (current && depth < CONFIG.VISIBILITY_MAX_DEPTH) {
      const style = window.getComputedStyle(current);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0'
      ) {
        return false;
      }
      current = current.parentElement;
      depth++;
    }

    return true;
  }
}

// ═══════════════════════════════════════════════════════════════
//  §5  K E Y W O R D   M A T C H E R
// ═══════════════════════════════════════════════════════════════

class KeywordMatcher {
  /**
   * Check if text contains any OTP keyword as a discrete token.
   */
  static matchesKeyword(text: string): boolean {
    const lower = text.toLowerCase();
    const tokens = lower.split(/[^a-z0-9]+/);
    return tokens.some((t) => t.length > 0 && OTP_KEYWORDS.has(t));
  }

  /**
   * Check if text contains any OTP context phrase.
   */
  static matchesContextPhrase(text: string): boolean {
    const lower = text.toLowerCase();
    return OTP_CONTEXT_PHRASES.some((p) => lower.includes(p));
  }

  /**
   * Check if input looks like a search field.
   */
  static isSearchInput(input: HTMLInputElement): boolean {
    if (input.type === 'search') {return true;}

    const combined = [
      input.name ?? '',
      input.id ?? '',
      input.placeholder ?? '',
      input.getAttribute('aria-label') ?? '',
    ].join(' ').toLowerCase();

    const tokens = combined.split(/[^a-z0-9]+/);
    return tokens.some((t) => t.length > 0 && SEARCH_INDICATORS.has(t));
  }
}

// ═══════════════════════════════════════════════════════════════
//  §6  L A B E L   R E S O L V E R
// ═══════════════════════════════════════════════════════════════

class LabelResolver {
  /**
   * Get associated label text for an input element.
   * Strategies: label[for] → wrapping label → aria-labelledby
   */
  static getAssociatedLabelText(input: HTMLInputElement): string {
    // 1. Explicit label[for]
    if (input.id) {
      const label = safeQuerySelector<HTMLLabelElement>(
        document,
        `label[for="${escapeCSS(input.id)}"]`
      );
      if (label?.textContent) {
        const text = label.textContent.trim();
        if (text.length <= CONFIG.MAX_LABEL_TEXT_LENGTH) {
          return text.toLowerCase();
        }
      }
    }

    // 2. Wrapping <label>
    const wrapping = input.closest('label');
    if (wrapping?.textContent) {
      const text = wrapping.textContent.trim();
      if (text.length <= CONFIG.MAX_LABEL_TEXT_LENGTH) {
        return text.toLowerCase();
      }
    }

    // 3. aria-labelledby (supports multiple IDs)
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
        if (combined.length <= CONFIG.MAX_LABEL_TEXT_LENGTH) {
          return combined.toLowerCase();
        }
      }
    }

    return '';
  }
}

// ═══════════════════════════════════════════════════════════════
//  §7  S E L E C T O R   G E N E R A T O R
// ═══════════════════════════════════════════════════════════════

class SelectorGenerator {
  /**
   * Generate a verified CSS selector for an input element.
   * Tries multiple strategies in priority order, each verified
   * by round-tripping through querySelector.
   */
  static generate(el: HTMLInputElement): string {
    const strategies: Array<() => string | null> = [
      // Strategy 1: ID
      () => {
        if (!el.id) {return null;}
        const sel = `#${escapeCSS(el.id)}`;
        return this.verify(sel, el) ? sel : null;
      },

      // Strategy 2: name
      () => {
        if (!el.name) {return null;}
        const sel = `input[name="${escapeCSS(el.name)}"]`;
        return this.verify(sel, el) ? sel : null;
      },

      // Strategy 3: autocomplete=one-time-code
      () => {
        if (el.autocomplete !== 'one-time-code') {return null;}
        const sel = 'input[autocomplete="one-time-code"]';
        return this.verify(sel, el) ? sel : null;
      },

      // Strategy 4: data attributes
      () => {
        for (const attr of el.attributes) {
          if (attr.name.startsWith('data-') && attr.value) {
            const sel = `input[${attr.name}="${escapeCSS(attr.value)}"]`;
            if (this.verify(sel, el)) {return sel;}
          }
        }
        return null;
      },

      // Strategy 5: class names (max 2)
      () => {
        if (!el.className || typeof el.className !== 'string') {return null;}
        const valid = el.className
          .split(/\s+/)
          .filter((c) => c.length > 1 && /^[a-zA-Z_-][\w-]*$/.test(c))
          .slice(0, CONFIG.MAX_CLASS_SELECTOR_COUNT);
        if (valid.length === 0) {return null;}
        const sel = `input.${valid.map(escapeCSS).join('.')}`;
        return this.verify(sel, el) ? sel : null;
      },

      // Strategy 6: nth-of-type scoped to parent
      () => {
        const parent = el.parentElement;
        if (!parent) {return null;}

        const siblings = Array.from(parent.querySelectorAll(':scope > input'));
        const idx = siblings.indexOf(el);
        if (idx < 0) {return null;}

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

      // Strategy 7: DOM path (absolute fallback)
      () => this.buildDomPath(el),
    ];

    for (const strategy of strategies) {
      try {
        const sel = strategy();
        if (sel) {return sel;}
      } catch {
        /* next strategy */
      }
    }

    // Should never reach here
    return `input[type="${escapeCSS(el.type || 'text')}"]`;
  }

  private static verify(selector: string, expected: HTMLInputElement): boolean {
    const found = safeQuerySelector<HTMLInputElement>(document, selector);
    return found === expected;
  }

  private static buildDomPath(el: HTMLElement): string {
    const parts: string[] = [];
    let current: HTMLElement | null = el;

    while (current && current !== document.body && current !== document.documentElement) {
      const parentElement: HTMLElement | null = current.parentElement;
      if (!parentElement) {break;}

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

// ═══════════════════════════════════════════════════════════════
//  §8  S I G N A L   C O L L E C T O R
// ═══════════════════════════════════════════════════════════════

class SignalCollector {
  private readonly signals: SignalScore[] = [];

  push(signal: string, weight: number, matched: boolean, detail?: string): void {
    this.signals.push(Object.freeze({ signal, weight, matched, detail }));
  }

  getAll(): SignalScore[] {
    return [...this.signals];
  }
}

// ═══════════════════════════════════════════════════════════════
//  §9  F I E L D   R E G I S T R Y
// ═══════════════════════════════════════════════════════════════

class FieldRegistry {
  private readonly map = new Map<HTMLInputElement, OTPField>();

  get size(): number {
    return this.map.size;
  }

  get(input: HTMLInputElement): OTPField | undefined {
    return this.map.get(input);
  }

  has(input: HTMLInputElement): boolean {
    return this.map.has(input);
  }

  /**
   * Register or update an OTP field. Keeps the highest score and
   * best source. Merges group info if not already set.
   */
  register(
    input: HTMLInputElement,
    source: DetectionSource,
    score: number,
    group?: OTPGroupInfo
  ): void {
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

  /**
   * Get all fields sorted by score descending.
   */
  getSorted(): OTPField[] {
    return Array.from(this.map.values()).sort((a, b) => b.score - a.score);
  }

  /**
   * Get the highest individual field score.
   */
  getMaxScore(): number {
    let max = 0;
    for (const field of this.map.values()) {
      if (field.score > max) {max = field.score;}
    }
    return max;
  }
}

// ═══════════════════════════════════════════════════════════════
//  §10  S P L I T   D I G I T   D E T E C T O R
// ═══════════════════════════════════════════════════════════════

class SplitDigitDetector {
  /**
   * Find groups of contiguous maxlength=1 inputs (split-digit OTP).
   */
  static detect(inputs: HTMLInputElement[]): HTMLInputElement[][] {
    const candidates = inputs.filter(
      (i) => i.maxLength === 1 && !KeywordMatcher.isSearchInput(i)
    );

    if (candidates.length < CONFIG.SPLIT_DIGIT_MIN) {return [];}

    const groups: HTMLInputElement[][] = [];
    let currentGroup: HTMLInputElement[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i]!;

      if (currentGroup.length === 0) {
        currentGroup.push(el);
        continue;
      }

      const prev = currentGroup[currentGroup.length - 1]!;

      if (this.areContiguous(prev, el)) {
        currentGroup.push(el);
      } else {
        if (this.isValidGroupSize(currentGroup.length)) {
          groups.push([...currentGroup]);
        }
        currentGroup = [el];
      }
    }

    // Flush last group
    if (this.isValidGroupSize(currentGroup.length)) {
      groups.push(currentGroup);
    }

    return groups;
  }

  /**
   * Two inputs are contiguous if:
   * 1. Horizontally within CONFIG.CONTIGUITY_H_GAP_PX
   * 2. Vertically within CONFIG.CONTIGUITY_V_DELTA_PX
   * 3. Share a common ancestor within CONFIG.CONTIGUITY_MAX_DEPTH levels
   */
  private static areContiguous(a: HTMLElement, b: HTMLElement): boolean {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();

    if (
      Math.abs(rb.left - ra.right) > CONFIG.CONTIGUITY_H_GAP_PX ||
      Math.abs(rb.top - ra.top) > CONFIG.CONTIGUITY_V_DELTA_PX
    ) {
      return false;
    }

    for (let depth = 1; depth <= CONFIG.CONTIGUITY_MAX_DEPTH; depth++) {
      const ancestorA = this.nthAncestor(a, depth);
      const ancestorB = this.nthAncestor(b, depth);
      if (ancestorA && ancestorA === ancestorB) {return true;}
    }

    return false;
  }

  private static nthAncestor(el: HTMLElement, n: number): HTMLElement | null {
    let current: HTMLElement | null = el;
    for (let i = 0; i < n && current; i++) {
      current = current.parentElement;
    }
    return current;
  }

  private static isValidGroupSize(size: number): boolean {
    return size >= CONFIG.SPLIT_DIGIT_MIN && size <= CONFIG.SPLIT_DIGIT_MAX;
  }
}

// ═══════════════════════════════════════════════════════════════
//  §11  S M A L L   I N P U T   C L U S T E R   D E T E C T O R
// ═══════════════════════════════════════════════════════════════

class SmallInputClusterDetector {
  /**
   * Find clusters of small, equal-width inputs grouped by parent container.
   */
  static detect(inputs: HTMLInputElement[]): HTMLInputElement[][] {
    const small = inputs.filter((i) => {
      const r = i.getBoundingClientRect();
      return (
        r.width >= CONFIG.SMALL_INPUT_MIN_WIDTH &&
        r.width <= CONFIG.SMALL_INPUT_MAX_WIDTH &&
        !KeywordMatcher.isSearchInput(i)
      );
    });

    if (small.length < CONFIG.SPLIT_DIGIT_MIN) {return [];}

    // Group by shared ancestor (up to 2 levels)
    const parentMap = new Map<Element, HTMLInputElement[]>();

    for (const el of small) {
      const parent = el.parentElement?.parentElement ?? el.parentElement;
      if (!parent) {continue;}

      let list = parentMap.get(parent);
      if (!list) {
        list = [];
        parentMap.set(parent, list);
      }
      list.push(el);
    }

    const clusters: HTMLInputElement[][] = [];

    for (const group of parentMap.values()) {
      if (
        group.length < CONFIG.SPLIT_DIGIT_MIN ||
        group.length > CONFIG.SPLIT_DIGIT_MAX
      ) {
        continue;
      }

      if (this.hasUniformWidth(group)) {
        clusters.push(group);
      }
    }

    return clusters;
  }

  private static hasUniformWidth(group: HTMLInputElement[]): boolean {
    const widths = group.map((i) => i.getBoundingClientRect().width);
    const avg = widths.reduce((a, b) => a + b, 0) / widths.length;
    return widths.every((w) => Math.abs(w - avg) <= CONFIG.SIZE_VARIANCE_PX);
  }
}

// ═══════════════════════════════════════════════════════════════
//  §12  A I   C O N T A I N E R   A N A L Y Z E R
// ═══════════════════════════════════════════════════════════════

class AIContainerAnalyzer {
  /**
   * Local, synchronous analysis: find containers with 4-8 visually
   * similar inputs of valid OTP types. Used as last-resort fallback
   * when no other signals matched.
   */
  static analyze(inputs: HTMLInputElement[]): AIContainerResult[] {
    const results: AIContainerResult[] = [];
    const containerMap = new Map<Element, HTMLInputElement[]>();

    for (const input of inputs) {
      let container: Element | null = input;
      for (let d = 0; d < 3 && container; d++) {
        container = container.parentElement;
      }
      if (!container) {continue;}

      let list = containerMap.get(container);
      if (!list) {
        list = [];
        containerMap.set(container, list);
      }
      list.push(input);
    }

    for (const group of containerMap.values()) {
      if (
        group.length < CONFIG.SPLIT_DIGIT_MIN ||
        group.length > CONFIG.SPLIT_DIGIT_MAX
      ) {
        continue;
      }

      // Verify visual similarity
      const widths = group.map((i) => i.getBoundingClientRect().width);
      const avg = widths.reduce((a, b) => a + b, 0) / widths.length;
      if (!widths.every((w) => Math.abs(w - avg) <= CONFIG.SIZE_VARIANCE_PX)) {continue;}

      // Verify valid input types only
      if (!group.every((i) => VALID_OTP_INPUT_TYPES.has(i.type))) {continue;}

      const groupId = generateGroupId('ai');
      group.forEach((input, idx) => {
        results.push({
          input,
          groupId,
          groupIndex: idx,
          groupSize: group.length,
        });
      });
    }

    return results;
  }
}

// ═══════════════════════════════════════════════════════════════
//  §13  T O A S T   F E E D B A C K
// ═══════════════════════════════════════════════════════════════

class ToastFeedback {
  private static readonly TOAST_ID = 'ghostfill-otp-toast';

  /**
   * Show a brief success toast after OTP auto-fill.
   * Uses Shadow DOM for style isolation.
   */
  static show(otp: string, source: string): void {
    // Remove any existing toast
    document.getElementById(this.TOAST_ID)?.remove();

    const masked = this.maskOTP(otp);
    const sourceLabel = source === 'url-extracted' ? 'from link' : 'from email';

    const container = document.createElement('div');
    container.id = this.TOAST_ID;
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');

    const shadow = container.attachShadow({ mode: 'closed' });
    const styles = this.getStyles();

    const toast = document.createElement('div');
    toast.className = 'toast';
    setHTML(
      toast,
      `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2.5" aria-hidden="true">
        <path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/>
      </svg>
      <div>
        <div class="title">OTP Auto-Filled ✓</div>
        <div class="sub"></div>
      </div>`
    );

    // Set text content safely (not innerHTML) to prevent XSS
    const subEl = toast.querySelector('.sub');
    if (subEl) {
      subEl.textContent = `${masked} · ${sourceLabel}`;
    }

    // Apply styles
    if (typeof CSSStyleSheet !== 'undefined' && 'replaceSync' in CSSStyleSheet.prototype) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(styles);
      shadow.adoptedStyleSheets = [sheet];
      shadow.appendChild(toast);
    } else {
      const styleEl = document.createElement('style');
      styleEl.textContent = styles;
      shadow.appendChild(styleEl);
      shadow.appendChild(toast);
    }

    document.body.appendChild(container);

    // Animate out then remove
    setTimeout(() => {
      toast.classList.add('out');
      setTimeout(() => {
        if (container.isConnected) {container.remove();}
      }, CONFIG.TOAST_ANIMATION_MS);
    }, CONFIG.TOAST_DURATION_MS);
  }

  static remove(): void {
    document.getElementById(this.TOAST_ID)?.remove();
  }

  private static maskOTP(otp: string): string {
    if (otp.length <= 2) {return '●'.repeat(otp.length);}
    return '●'.repeat(otp.length - 2) + otp.slice(-2);
  }

  private static getStyles(): string {
    return `
      :host {
        position: fixed; top: 20px; right: 20px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        pointer-events: none;
      }
      .toast {
        background: linear-gradient(135deg, #6366F1, #8B5CF6);
        color: #fff; padding: 14px 20px; border-radius: 12px;
        box-shadow: 0 10px 40px rgba(99, 102, 241, 0.4);
        font-size: 14px; display: flex; align-items: center;
        gap: 10px; max-width: 300px;
        animation: slideIn ${CONFIG.TOAST_ANIMATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1);
      }
      .toast.out {
        animation: slideOut ${CONFIG.TOAST_ANIMATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
      }
      .title { font-weight: 600; font-size: 13px; }
      .sub { opacity: 0.85; font-size: 11px; font-family: monospace; margin-top: 2px; }
      svg { flex-shrink: 0; }
      @keyframes slideIn {
        from { transform: translateX(120%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(120%); opacity: 0; }
      }
      @media (prefers-reduced-motion: reduce) {
        .toast, .toast.out {
          animation-duration: 0.01ms !important;
        }
      }
    `;
  }
}

// ═══════════════════════════════════════════════════════════════
//  §14  S C O R I N G   E N G I N E
// ═══════════════════════════════════════════════════════════════

class ScoringEngine {
  /**
   * Core detection: score all visible inputs, detect groups,
   * gather page context, and compute composite confidence.
   */
  static score(
    formDetector: FormDetector,
    cachedTitle: boolean | null,
    cachedBody: boolean | null,
    cachedUrl: boolean | null
  ): {
    result: DetectionResult;
    titleMatch: boolean;
    bodyMatch: boolean;
    urlMatch: boolean;
  } {
    const t0 = Date.now();
    const signals = new SignalCollector();
    const fields = new FieldRegistry();

    // ── 1. Gather candidate inputs ────────────────────────
    const allInputs = document.querySelectorAll<HTMLInputElement>(CANDIDATE_INPUT_SELECTOR);
    const visibleInputs = Array.from(allInputs).filter((el) => VisibilityEngine.isVisible(el));

    if (visibleInputs.length === 0) {
      return {
        result: this.buildResult('not-otp', 0, [], signals.getAll(), t0),
        titleMatch: cachedTitle ?? false,
        bodyMatch: cachedBody ?? false,
        urlMatch: cachedUrl ?? false,
      };
    }

    // ── 2. Per-input attribute scoring ────────────────────
    for (const input of visibleInputs) {
      this.scoreInput(input, fields, signals);
    }

    // ── 3. Split-digit group detection ────────────────────
    const splitGroups = SplitDigitDetector.detect(visibleInputs);
    for (const group of splitGroups) {
      const groupId = generateGroupId('split', group[0]?.name || group[0]?.id);
      signals.push(
        `split-digit-group (${group.length} inputs)`,
        SIGNAL_WEIGHTS.SPLIT_DIGIT_GROUP,
        true
      );

      group.forEach((input, idx) => {
        const existing = fields.get(input);
        const score = (existing?.score ?? 0) + SIGNAL_WEIGHTS.SPLIT_DIGIT_GROUP;
        fields.register(input, 'split-digit-group', score, {
          groupId,
          groupIndex: idx,
          groupSize: group.length,
        });
      });
    }

    // ── 4. Small-input cluster detection ──────────────────
    const clusters = SmallInputClusterDetector.detect(visibleInputs);
    for (const cluster of clusters) {
      // Don't double-count fields already found as split-digit
      const alreadyCounted = cluster.every((el) => {
        const f = fields.get(el);
        return f?.source === 'split-digit-group';
      });
      if (alreadyCounted) {continue;}

      signals.push(
        `small-cluster (${cluster.length} inputs)`,
        SIGNAL_WEIGHTS.SMALL_CLUSTER,
        true
      );

      const groupId = generateGroupId('cluster');
      cluster.forEach((input, idx) => {
        const existing = fields.get(input);
        const score = (existing?.score ?? 0) + SIGNAL_WEIGHTS.SMALL_CLUSTER;
        fields.register(input, 'small-input-cluster', score, {
          groupId,
          groupIndex: idx,
          groupSize: cluster.length,
        });
      });
    }

    // ── 5. FormDetector agreement ─────────────────────────
    this.scoreFormDetector(formDetector, fields, signals);

    // ── 6. AI container analysis (local fallback) ─────────
    if (fields.size === 0) {
      const aiResults = AIContainerAnalyzer.analyze(visibleInputs);
      for (const { input, groupId, groupIndex, groupSize } of aiResults) {
        signals.push('ai-container-analysis', SIGNAL_WEIGHTS.SMALL_CLUSTER, true);
        fields.register(input, 'ai-container-analysis', SIGNAL_WEIGHTS.SMALL_CLUSTER, {
          groupId,
          groupIndex,
          groupSize,
        });
      }
    }

    // ── 7. Page-level context signals ─────────────────────
    const titleMatch = cachedTitle ?? this.pageTitleHasKeyword();
    const bodyMatch = cachedBody ?? this.pageBodyHasKeyword();
    const urlMatch = cachedUrl ?? this.pageUrlHasKeyword();

    signals.push('page-title-keyword', SIGNAL_WEIGHTS.PAGE_TITLE_KEYWORD, titleMatch);
    signals.push('page-body-keyword', SIGNAL_WEIGHTS.BODY_TEXT_KEYWORD, bodyMatch);
    signals.push('url-keyword', SIGNAL_WEIGHTS.URL_KEYWORD, urlMatch);

    // Negative: password field present
    const hasPassword = visibleInputs.some((i) => i.type === 'password');
    if (hasPassword) {
      signals.push('password-field-negative', SIGNAL_WEIGHTS.LOGIN_FORM_PRESENT, true);
    }

    // ── 8. Composite confidence ───────────────────────────
    const fieldConfidence = clamp(fields.getMaxScore(), 0, 1);

    let contextScore = 0;
    if (titleMatch) {contextScore += SIGNAL_WEIGHTS.PAGE_TITLE_KEYWORD;}
    if (bodyMatch) {contextScore += SIGNAL_WEIGHTS.BODY_TEXT_KEYWORD;}
    if (urlMatch) {contextScore += SIGNAL_WEIGHTS.URL_KEYWORD;}
    if (hasPassword) {contextScore += SIGNAL_WEIGHTS.LOGIN_FORM_PRESENT;}
    contextScore = clamp(contextScore, CONFIG.CONTEXT_SCORE_MIN, CONFIG.CONTEXT_SCORE_MAX);

    const composite = clamp(fieldConfidence + contextScore, 0, 1);

    // ── Verdict ───────────────────────────────────────────
    const sortedFields = fields.getSorted();
    let verdict: PageVerdict;

    if (sortedFields.length > 0 && composite >= HIGH_CONFIDENCE) {
      verdict = 'otp-page';
    } else if (sortedFields.length > 0 && composite >= CONFIDENCE_THRESHOLD) {
      verdict = 'possible-otp';
    } else if (composite >= AI_FALLBACK_THRESHOLD && contextScore > 0) {
      verdict = 'possible-otp';
    } else {
      verdict = 'not-otp';
    }

    return {
      result: this.buildResult(verdict, composite, sortedFields, signals.getAll(), t0),
      titleMatch,
      bodyMatch,
      urlMatch,
    };
  }

  // ── Per-input scoring ───────────────────────────────────

  private static scoreInput(
    input: HTMLInputElement,
    fields: FieldRegistry,
    signals: SignalCollector
  ): void {
    let inputScore = 0;
    let bestSource: DetectionSource = 'maxlength-heuristic';

    // autocomplete="one-time-code"
    if (input.autocomplete === 'one-time-code') {
      inputScore += SIGNAL_WEIGHTS.AUTOCOMPLETE_OTC;
      bestSource = 'autocomplete-attr';
      signals.push(
        'autocomplete=one-time-code',
        SIGNAL_WEIGHTS.AUTOCOMPLETE_OTC,
        true,
        this.selectorHint(input)
      );
    }

    // inputmode="numeric"
    if (input.inputMode === 'numeric' || input.getAttribute('inputmode') === 'numeric') {
      inputScore += SIGNAL_WEIGHTS.INPUT_MODE_NUMERIC;
    }

    // name attribute
    if (input.name && KeywordMatcher.matchesKeyword(input.name)) {
      inputScore += SIGNAL_WEIGHTS.NAME_OTP_KEYWORD;
      bestSource = this.selectBestSource(bestSource, 'name-attr', inputScore, fields.get(input));
      signals.push(`name="${input.name}"`, SIGNAL_WEIGHTS.NAME_OTP_KEYWORD, true);
    }

    // id attribute
    if (input.id && KeywordMatcher.matchesKeyword(input.id)) {
      inputScore += SIGNAL_WEIGHTS.ID_OTP_KEYWORD;
      bestSource = this.selectBestSource(bestSource, 'id-attr', inputScore, fields.get(input));
      signals.push(`id="${input.id}"`, SIGNAL_WEIGHTS.ID_OTP_KEYWORD, true);
    }

    // placeholder
    const ph = (input.placeholder ?? '').toLowerCase();
    if (ph && (KeywordMatcher.matchesContextPhrase(ph) || KeywordMatcher.matchesKeyword(ph))) {
      inputScore += SIGNAL_WEIGHTS.PLACEHOLDER_KEYWORD;
      bestSource = this.selectBestSource(bestSource, 'placeholder-attr', inputScore, fields.get(input));
      signals.push(
        `placeholder="${truncate(input.placeholder, 30)}"`,
        SIGNAL_WEIGHTS.PLACEHOLDER_KEYWORD,
        true
      );
    }

    // aria-label
    const aria = (input.getAttribute('aria-label') ?? '').toLowerCase();
    if (aria && KeywordMatcher.matchesKeyword(aria)) {
      inputScore += SIGNAL_WEIGHTS.ARIA_LABEL_KEYWORD;
      bestSource = this.selectBestSource(bestSource, 'aria-label-attr', inputScore, fields.get(input));
      signals.push('aria-label match', SIGNAL_WEIGHTS.ARIA_LABEL_KEYWORD, true);
    }

    // Associated label
    const labelText = LabelResolver.getAssociatedLabelText(input);
    if (labelText && KeywordMatcher.matchesKeyword(labelText)) {
      inputScore += SIGNAL_WEIGHTS.LABEL_KEYWORD;
      bestSource = this.selectBestSource(bestSource, 'label-association', inputScore, fields.get(input));
      signals.push(
        `label="${truncate(labelText, 30)}"`,
        SIGNAL_WEIGHTS.LABEL_KEYWORD,
        true
      );
    }

    // maxlength 4-8
    const ml = input.maxLength;
    if (ml >= 4 && ml <= 8) {
      inputScore += SIGNAL_WEIGHTS.MAXLENGTH_4_TO_8;
      signals.push(`maxlength=${ml}`, SIGNAL_WEIGHTS.MAXLENGTH_4_TO_8, true);
    }

    // Negative: search bar
    if (KeywordMatcher.isSearchInput(input)) {
      inputScore += SIGNAL_WEIGHTS.SEARCH_BAR_LIKELY;
      signals.push('search-input-negative', SIGNAL_WEIGHTS.SEARCH_BAR_LIKELY, true);
    }

    if (inputScore > 0) {
      fields.register(input, bestSource, inputScore);
    }
  }

  private static selectBestSource(
    current: DetectionSource,
    candidate: DetectionSource,
    currentScore: number,
    existing: OTPField | undefined
  ): DetectionSource {
    return currentScore > (existing?.score ?? 0) ? candidate : current;
  }

  private static selectorHint(el: HTMLInputElement): string {
    if (el.id) {return `#${el.id}`;}
    if (el.name) {return `[name=${el.name}]`;}
    return el.tagName;
  }

  // ── FormDetector agreement ──────────────────────────────

  private static scoreFormDetector(
    formDetector: FormDetector,
    fields: FieldRegistry,
    signals: SignalCollector
  ): void {
    try {
      const formAnalysis = formDetector.detectForms();

      for (const form of formAnalysis.forms) {
        if (form.formType === 'two-factor') {
          signals.push('FormDetector: 2FA form', SIGNAL_WEIGHTS.FORM_DETECTOR_2FA, true);

          for (const field of form.fields) {
            if (field.fieldType === 'otp') {
              const el = safeQuerySelector<HTMLInputElement>(document, field.selector);
              if (el && VisibilityEngine.isVisible(el)) {
                const existing = fields.get(el);
                const score = (existing?.score ?? 0) + SIGNAL_WEIGHTS.FORM_DETECTOR_2FA;
                fields.register(el, 'form-detector', score);
              }
            }
          }
        }
      }

      for (const field of formAnalysis.standaloneFields) {
        if (field.fieldType === 'otp') {
          const el = safeQuerySelector<HTMLInputElement>(document, field.selector);
          if (el && VisibilityEngine.isVisible(el)) {
            const existing = fields.get(el);
            const score =
              (existing?.score ?? 0) +
              SIGNAL_WEIGHTS.FORM_DETECTOR_2FA * STANDALONE_OTP_WEIGHT_RATIO;
            fields.register(el, 'form-detector', score);
          }
        }
      }
    } catch (e) {
      log.debug('FormDetector error (non-fatal)', e);
    }
  }

  // ── Page context ────────────────────────────────────────

  private static pageTitleHasKeyword(): boolean {
    const title = document.title.toLowerCase();
    return KeywordMatcher.matchesContextPhrase(title) || KeywordMatcher.matchesKeyword(title);
  }

  private static pageBodyHasKeyword(): boolean {
    const text = (document.body?.innerText ?? '')
      .toLowerCase()
      .substring(0, CONFIG.MAX_BODY_SCAN_CHARS);
    return KeywordMatcher.matchesContextPhrase(text);
  }

  private static pageUrlHasKeyword(): boolean {
    const url = location.href.toLowerCase();
    return KeywordMatcher.matchesKeyword(url);
  }

  // ── Result builder ──────────────────────────────────────

  private static buildResult(
    verdict: PageVerdict,
    confidence: number,
    fields: OTPField[],
    signals: SignalScore[],
    t0: number
  ): DetectionResult {
    return Object.freeze({
      verdict,
      confidence,
      fields,
      signalBreakdown: signals,
      detectedAt: Date.now(),
      durationMs: Date.now() - t0,
    });
  }
}

// ═══════════════════════════════════════════════════════════════
//  §15  M A I N   O T P   P A G E   D E T E C T O R
// ═══════════════════════════════════════════════════════════════

export class OTPPageDetector {
  // ── Dependencies ──
  private readonly autoFiller: AutoFiller;
  private readonly formDetector: FormDetector;

  // ── State ──
  private verdict: PageVerdict = 'not-otp';
  private confidence = 0;
  private fields: OTPField[] = [];
  private lastUrl = '';
  private destroyed = false;

  // ── AI fallback guards ──
  private aiRequested = false;
  private aiResponded = false;

  // ── Scheduling ──
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRunTime = 0;

  // ── Observers & listeners ──
  private mutationObserver: MutationObserver | null = null;
  private focusHandler: ((e: FocusEvent) => void) | null = null;
  private popstateHandler: (() => void) | null = null;

  // ── History patch management ──
  private originalPushState: typeof history.pushState | null = null;
  private originalReplaceState: typeof history.replaceState | null = null;
  private isHistoryPatched = false;

  // ── Metrics ──
  private readonly metrics: DetectionMetrics = {
    runsTotal: 0,
    runsPositive: 0,
    avgDurationMs: 0,
    lastVerdict: 'not-otp',
    lastConfidence: 0,
    fieldsFound: 0,
    otpsFilled: 0,
    otpsFillFailed: 0,
    aiRequested: false,
    aiResponded: false,
  };

  // ── Context caches (invalidated on navigation/mutation) ──
  private cachedBodyKeyword: boolean | null = null;
  private cachedTitleKeyword: boolean | null = null;
  private cachedUrlKeyword: boolean | null = null;

  constructor(autoFiller: AutoFiller, formDetector: FormDetector) {
    this.autoFiller = autoFiller;
    this.formDetector = formDetector;
  }

  // ═══════════════════════════════════════════════════════════
  //  LIFECYCLE
  // ═══════════════════════════════════════════════════════════

  init(): void {
    if (this.destroyed) {return;}

    this.lastUrl = location.href;

    this.installMutationObserver();
    this.installFocusListener();
    this.installNavigationWatcher();

    // Initial detection (slight delay for DOM hydration)
    setTimeout(() => {
      if (!this.destroyed) {
        this.scheduleDetection('init');
      }
    }, CONFIG.INITIAL_DELAY_MS);

    log.debug('OTP Detector initialized');
  }

  destroy(): void {
    if (this.destroyed) {return;}
    this.destroyed = true;

    // Cancel pending detection
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Mutation observer
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }

    // Focus listener
    if (this.focusHandler) {
      document.removeEventListener('focusin', this.focusHandler, true);
      this.focusHandler = null;
    }

    // Navigation
    if (this.popstateHandler) {
      window.removeEventListener('popstate', this.popstateHandler);
      this.popstateHandler = null;
    }

    // Restore history patch
    this.restoreHistoryMethods();

    // Remove toast
    ToastFeedback.remove();

    // Notify background if we were on an OTP page
    if (this.verdict !== 'not-otp') {
      void this.notifyBackground('OTP_PAGE_LEFT');
    }

    log.debug('OTP Detector destroyed', this.getMetrics());
  }

  // ═══════════════════════════════════════════════════════════
  //  LISTENER INSTALLATION
  // ═══════════════════════════════════════════════════════════

  private installMutationObserver(): void {
    if (!document.body) {return;}

    this.mutationObserver = new MutationObserver((mutations) => {
      if (this.destroyed) {return;}

      const relevant = mutations.some((m) => {
        if (m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0)) {
          return true;
        }
        return m.type === 'attributes' && m.target instanceof HTMLInputElement;
      });

      if (relevant) {
        this.invalidateContextCaches();
        this.scheduleDetection('mutation');
      }
    });

    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [...OBSERVED_ATTRIBUTES],
    });
  }

  private installFocusListener(): void {
    this.focusHandler = (e: FocusEvent) => {
      if (this.destroyed) {return;}
      if (e.target instanceof HTMLInputElement) {
        this.scheduleDetection('focus');
      }
    };
    document.addEventListener('focusin', this.focusHandler, true);
  }

  private installNavigationWatcher(): void {
    if (!this.isHistoryPatched) {
      this.originalPushState = history.pushState.bind(history);
      this.originalReplaceState = history.replaceState.bind(history);

      history.pushState = (...args: Parameters<typeof history.pushState>) => {
        this.originalPushState!(...args);
        this.onNavigate();
      };

      history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
        this.originalReplaceState!(...args);
        this.onNavigate();
      };

      this.isHistoryPatched = true;
    }

    this.popstateHandler = () => this.onNavigate();
    window.addEventListener('popstate', this.popstateHandler);
  }

  private restoreHistoryMethods(): void {
    if (!this.isHistoryPatched) {return;}

    if (this.originalPushState) {
      history.pushState = this.originalPushState;
      this.originalPushState = null;
    }
    if (this.originalReplaceState) {
      history.replaceState = this.originalReplaceState;
      this.originalReplaceState = null;
    }
    this.isHistoryPatched = false;
  }

  private onNavigate(): void {
    if (this.destroyed) {return;}
    const newUrl = location.href;
    if (newUrl === this.lastUrl) {return;}

    log.debug('Navigation detected', { to: newUrl });
    this.lastUrl = newUrl;
    this.resetForNavigation();
    this.scheduleDetection('navigation');
  }

  private resetForNavigation(): void {
    this.aiRequested = false;
    this.aiResponded = false;
    this.invalidateContextCaches();

    if (this.verdict !== 'not-otp') {
      this.verdict = 'not-otp';
      this.confidence = 0;
      this.fields = [];
      void this.notifyBackground('OTP_PAGE_LEFT');
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  DETECTION SCHEDULER
  // ═══════════════════════════════════════════════════════════

  private scheduleDetection(trigger: string): void {
    if (this.destroyed) {return;}

    // Throttle mutation-triggered runs
    if (trigger === 'mutation') {
      const gap = Date.now() - this.lastRunTime;
      if (gap < CONFIG.OBSERVER_THROTTLE_MS) {
        if (this.debounceTimer !== null) {clearTimeout(this.debounceTimer);}
        this.debounceTimer = setTimeout(
          () => this.runDetection(trigger),
          CONFIG.OBSERVER_THROTTLE_MS - gap
        );
        return;
      }
    }

    // Debounce everything else
    if (this.debounceTimer !== null) {clearTimeout(this.debounceTimer);}
    this.debounceTimer = setTimeout(
      () => this.runDetection(trigger),
      CONFIG.DEBOUNCE_MS
    );
  }

  // ═══════════════════════════════════════════════════════════
  //  CORE DETECTION RUN
  // ═══════════════════════════════════════════════════════════

  private runDetection(trigger: string): void {
    if (this.destroyed) {return;}

    const t0 = performance.now();
    const { result, titleMatch, bodyMatch, urlMatch } = ScoringEngine.score(
      this.formDetector,
      this.cachedTitleKeyword,
      this.cachedBodyKeyword,
      this.cachedUrlKeyword
    );
    const ms = Math.round(performance.now() - t0);

    // Update caches
    this.cachedTitleKeyword = titleMatch;
    this.cachedBodyKeyword = bodyMatch;
    this.cachedUrlKeyword = urlMatch;

    this.lastRunTime = Date.now();
    this.updateMetrics(result, ms);

    const prevVerdict = this.verdict;
    this.verdict = result.verdict;
    this.confidence = result.confidence;
    this.fields = result.fields;

    // ── State transitions ─────────────────────────────────
    if (this.verdict !== 'not-otp' && prevVerdict === 'not-otp') {
      log.info('✅ OTP page detected', {
        trigger,
        verdict: this.verdict,
        confidence: pct(this.confidence),
        fields: this.fields.length,
        ms,
      });
      void this.notifyBackground('OTP_PAGE_DETECTED');
    } else if (this.verdict === 'not-otp' && prevVerdict !== 'not-otp') {
      log.info('OTP page status cleared', { trigger });
      void this.notifyBackground('OTP_PAGE_LEFT');
    }

    // ── AI fallback ───────────────────────────────────────
    if (
      !this.aiRequested &&
      this.verdict === 'not-otp' &&
      this.confidence >= AI_FALLBACK_THRESHOLD &&
      this.confidence < HIGH_CONFIDENCE
    ) {
      void this.requestAIFallback();
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  AI FALLBACK (async, network)
  // ═══════════════════════════════════════════════════════════

  private async requestAIFallback(): Promise<void> {
    if (this.destroyed) {return;}

    this.aiRequested = true;
    this.metrics.aiRequested = true;

    log.info('🤖 Requesting AI OTP detection', {
      confidence: pct(this.confidence),
    });

    try {
      const snapshot = this.buildDOMSnapshot();
      const response = (await safeSendMessage({
        action: 'ANALYZE_DOM',
        payload: { simplifiedDOM: snapshot },
      })) as AIAnalysisResponse | undefined;

      if (this.destroyed) {return;}

      this.aiResponded = true;
      this.metrics.aiResponded = true;

      if (
        response?.success &&
        response.result?.confidence !== undefined &&
        response.result.confidence !== null &&
        response.result.confidence >= AI_CONFIRM_THRESHOLD
      ) {
        log.info('✅ AI confirmed OTP page', { confidence: response.result.confidence });
        this.scheduleDetection('ai-response');
      } else {
        log.debug('AI did not confirm OTP page');
      }
    } catch (error) {
      log.warn('AI fallback failed', error);
    }
  }

  private buildDOMSnapshot(): string {
    const parts: string[] = [];

    const forms = document.querySelectorAll('form');
    for (const form of forms) {
      parts.push(form.outerHTML.substring(0, CONFIG.MAX_FORM_SNAPSHOT_CHARS));
    }

    const orphanInputs = document.querySelectorAll<HTMLInputElement>('input:not([type="hidden"])');
    for (const input of orphanInputs) {
      if (!input.closest('form')) {
        parts.push(input.outerHTML);
      }
    }

    return parts.join('\n').substring(0, CONFIG.MAX_DOM_SNAPSHOT_CHARS);
  }

  // ═══════════════════════════════════════════════════════════
  //  AUTO-FILL HANDLER
  // ═══════════════════════════════════════════════════════════

  async handleAutoFill(payload: AutoFillPayload): Promise<boolean> {
    if (this.destroyed) {return false;}

    const { otp, source, confidence } = payload;

    log.info('📥 AUTO_FILL_OTP received', {
      source,
      confidence: pct(confidence),
      hasFields: this.fields.length > 0,
    });

    // Run detection if no fields known yet
    if (this.fields.length === 0) {
      this.runDetection('auto-fill-trigger');
      
      // Retry if DOM takes a moment to settle
      if (this.fields.length === 0) {
        log.info('⏳ No fields found initially, waiting 500ms for DOM to settle...');
        await new Promise(r => setTimeout(r, 500));
        this.runDetection('auto-fill-trigger-retry');
      }
    }

    const selectors = this.fields.map((f) => f.selector);
    const success = await this.autoFiller.fillOTP(otp, selectors);

    if (this.destroyed) {return false;}

    if (success) {
      this.metrics.otpsFilled++;
      log.info('✅ OTP filled successfully');
      ToastFeedback.show(otp, source);
      return true;
    } else {
      this.metrics.otpsFillFailed++;
      log.warn('❌ OTP fill failed — no matching inputs');
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  BACKGROUND NOTIFICATION
  // ═══════════════════════════════════════════════════════════

  private async notifyBackground(
    action: 'OTP_PAGE_DETECTED' | 'OTP_PAGE_LEFT'
  ): Promise<void> {
    if (this.destroyed && action !== 'OTP_PAGE_LEFT') {return;}

    const message: ExtensionMessage =
      action === 'OTP_PAGE_DETECTED'
        ? ({
          action,
          payload: {
            url: location.href,
            fieldCount: this.fields.length,
            fieldSelectors: this.fields.map((f) => f.selector),
            confidence: this.confidence,
            verdict: this.verdict,
          },
        } as ExtensionMessage)
        : ({ action } as ExtensionMessage);

    try {
      await safeSendMessage(message);
    } catch (error) {
      log.warn('Background notification failed', { action, error });
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  METRICS
  // ═══════════════════════════════════════════════════════════

  private updateMetrics(result: DetectionResult, ms: number): void {
    this.metrics.runsTotal++;
    if (result.verdict !== 'not-otp') {
      this.metrics.runsPositive++;
    }
    this.metrics.lastVerdict = result.verdict;
    this.metrics.lastConfidence = result.confidence;
    this.metrics.fieldsFound = result.fields.length;

    // Exponential moving average
    this.metrics.avgDurationMs =
      this.metrics.avgDurationMs === 0
        ? ms
        : this.metrics.avgDurationMs * (1 - CONFIG.EMA_ALPHA) + ms * CONFIG.EMA_ALPHA;
  }

  private invalidateContextCaches(): void {
    this.cachedBodyKeyword = null;
    this.cachedTitleKeyword = null;
    this.cachedUrlKeyword = null;
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC STATUS & DIAGNOSTICS
  // ═══════════════════════════════════════════════════════════

  getStatus(): {
    isOTPPage: boolean;
    verdict: PageVerdict;
    confidence: number;
    fieldCount: number;
    selectors: string[];
    fields: ReadonlyArray<Omit<OTPField, 'element'>>;
  } {
    return {
      isOTPPage: this.verdict !== 'not-otp',
      verdict: this.verdict,
      confidence: this.confidence,
      fieldCount: this.fields.length,
      selectors: this.fields.map((f) => f.selector),
      fields: this.fields.map((f) => ({
        selector: f.selector,
        source: f.source,
        score: f.score,
        groupId: f.groupId,
        groupIndex: f.groupIndex,
        groupSize: f.groupSize,
        maxLength: f.maxLength,
        inputMode: f.inputMode,
        visible: f.visible,
      })),
    };
  }

  getMetrics(): Readonly<DetectionMetrics> {
    return { ...this.metrics };
  }
}