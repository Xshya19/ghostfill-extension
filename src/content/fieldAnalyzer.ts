// ═══════════════════════════════════════════════════════════════════════════════
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  🧠  G H O S T F I L L   —   F I E L D   A N A L Y Z E R            ║
// ║  Heuristic-first field classification with shadow DOM penetration     ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// Architecture:
// ┌────────────────────────────────────────────────────────────────────────┐
// │  VisibilityCheck  — Shared element visibility logic                   │
// │  LabelResolver    — Multi-strategy label text discovery               │
// │  OTPDetector      — Specialized OTP field scoring engine              │
// │  FieldClassifier  — Main heuristic classification engine              │
// │  DOMTraversal     — Shadow-DOM-piercing query engine                  │
// │  FieldAnalyzer    — Public API: analyze, discover, classify           │
// └────────────────────────────────────────────────────────────────────────┘
// ═══════════════════════════════════════════════════════════════════════════════

import { SentinelBrain } from '../intelligence/SentinelBrain';
import { FieldType, DetectedField, FIELD_HEURISTICS, FormType, GhostContainer, FORM_INDICATORS, ClassifyFieldResponse, FormInputElement } from '../types';
import { getUniqueSelector, getElementLabel, deepQuerySelectorAll } from '../utils/helpers';
import { createLogger } from '../utils/logger';
import { safeSendMessage } from '../utils/messaging';
import { HistoryManager } from './utils/intelligenceCore';

const log = createLogger('FieldAnalyzer');

// ═══════════════════════════════════════════════════════════════
//  §0  C O N S T A N T S
// ═══════════════════════════════════════════════════════════════

/** Maximum characters for simplified DOM extraction */
const DOM_EXTRACTION_CHAR_LIMIT = 2000;

/** Maximum label text length to accept from proximity scan */
const MAX_LABEL_TEXT_LENGTH = 120;

/** OTP field length boundaries */
const OTP_MIN_LENGTH = 4;
const OTP_MAX_LENGTH = 8;

/** Minimum confidence threshold for aggressive email fallback */
const MIN_CONFIDENCE_THRESHOLD = 0.3;

/** Maximum shadow DOM recursion depth to prevent infinite loops */
const MAX_SHADOW_DEPTH = 10;

/** Maximum elements to scan for shadow roots (performance guard) */
const MAX_SHADOW_SCAN_ELEMENTS = 5000;

/** Confidence scores for heuristic signals */
const CONFIDENCE = {
  TYPE_MATCH: 0.4,
  AUTOCOMPLETE_MATCH: 0.3,
  PATTERN_MATCH: 0.2,
  KEYWORD_MATCH: 0.1,
  EMAIL_TYPE_ATTR: 0.9,
  EMAIL_PLACEHOLDER_AT: 0.7,
  EMAIL_FIRST_INPUT: 0.4,
  OTP_SINGLE_CHAR: 0.95,
  OTP_NUMERIC_LENGTH: 0.2,
  OTP_INPUTMODE_NUMERIC: 0.2,
  OTP_AUTOCOMPLETE: 0.4,
  OTP_TYPE_TEL_NUMBER: 0.1,
  OTP_NAME_OTP: 0.4,
  OTP_NAME_CODE: 0.3,
  OTP_NAME_VERIFY: 0.3,
  AI_OVERRIDE: 0.95,
} as const;

// ═══════════════════════════════════════════════════════════════
//  §1  T Y P E S
// ═══════════════════════════════════════════════════════════════

interface FieldAnalysisResult {
  fields: DetectedField[];
}

interface AICacheEntry {
  prediction: { label: string; confidence: number };
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
//  §2  U T I L I T I E S
// ═══════════════════════════════════════════════════════════════

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

function clampConfidence(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function combineTextSignals(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ').toLowerCase();
}

// ─── Visibility Check ──────────────────────────────────────────────────────

class VisibilityCheck {
  /**
   * Returns true if the element has non-zero dimensions and is not
   * hidden via CSS display/visibility. Does NOT check opacity
   * (some frameworks animate opacity for transitions).
   */
  static isVisible(element: HTMLElement): boolean {
    if (!element.isConnected) {return false;}

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {return false;}

    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }
}

// ═══════════════════════════════════════════════════════════════
//  §4  L A B E L   R E S O L V E R
// ═══════════════════════════════════════════════════════════════

class LabelResolver {
  /**
   * Multi-strategy label text discovery:
   * 1. Explicit <label for="...">
   * 2. Ancestor <label>
   * 3. aria-labelledby
   * 4. aria-label
   * 5. Previous sibling text
   * 6. Parent's previous sibling text
   */
  static resolve(element: HTMLElement): string {
    // 1. Explicit label via `for` attribute
    if (element.id) {
      const label = safeQuerySelector<HTMLLabelElement>(
        document,
        `label[for="${escapeCSS(element.id)}"]`
      );
      if (label?.textContent) {
        const text = label.textContent.trim();
        if (text.length <= MAX_LABEL_TEXT_LENGTH) {return text;}
      }
    }

    // 2. Ancestor <label>
    const parentLabel = element.closest('label');
    if (parentLabel?.textContent) {
      const text = parentLabel.textContent.trim();
      if (text.length <= MAX_LABEL_TEXT_LENGTH) {return text;}
    }

    // 3. aria-labelledby
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      // aria-labelledby can reference multiple IDs
      const texts: string[] = [];
      for (const id of labelledBy.split(/\s+/)) {
        const labelEl = document.getElementById(id.trim());
        if (labelEl?.textContent) {
          texts.push(labelEl.textContent.trim());
        }
      }
      if (texts.length > 0) {
        const combined = texts.join(' ');
        if (combined.length <= MAX_LABEL_TEXT_LENGTH) {return combined;}
      }
    }

    // 4. aria-label
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) {
      const text = ariaLabel.trim();
      if (text.length <= MAX_LABEL_TEXT_LENGTH) {return text;}
    }

    // 5. Previous sibling
    try {
      const prev = element.previousElementSibling;
      if (
        prev &&
        prev.tagName !== 'INPUT' &&
        prev.tagName !== 'TEXTAREA' &&
        prev.textContent
      ) {
        const text = prev.textContent.trim();
        if (text.length > 0 && text.length <= MAX_LABEL_TEXT_LENGTH) {return text;}
      }

      // 6. Parent's previous sibling
      const parent = element.parentElement;
      if (parent) {
        const pPrev = parent.previousElementSibling;
        if (
          pPrev &&
          pPrev.tagName !== 'INPUT' &&
          pPrev.tagName !== 'TEXTAREA' &&
          pPrev.textContent
        ) {
          const text = pPrev.textContent.trim();
          if (text.length > 0 && text.length <= MAX_LABEL_TEXT_LENGTH) {return text;}
        }
      }
    } catch {
      /* cross-origin or detached element */
    }

    return '';
  }
}

// ═══════════════════════════════════════════════════════════════
//  §5  O T P   D E T E C T O R
// ═══════════════════════════════════════════════════════════════

class OTPDetector {
  private static readonly OTP_TEXT_PATTERN = /otp|code|verify|token|pin|2fa|mfa/i;
  private static readonly DIGIT_PATTERN_REGEX = /^\^?\\?d/;

  /**
   * Determines if a field is likely an OTP input.
   * Returns true for high-probability OTP fields.
   */
  static isLikelyOTP(element: FormInputElement): boolean {
    const textToCheck = combineTextSignals(
      element.name,
      element.id,
      element.placeholder,
      getElementLabel(element),
      element.getAttribute('aria-label')
    );

    const hasExplicitSignal = this.OTP_TEXT_PATTERN.test(textToCheck);

    // Single digit fields are only high-probability OTPs when they appear
    // as part of a clustered verification widget or carry explicit OTP hints.
    if (element.maxLength === 1) {
      return (
        this.hasSplitCluster(element) ||
        hasExplicitSignal ||
        element.autocomplete === 'one-time-code' ||
        element.getAttribute('inputmode') === 'numeric'
      );
    }

    // Full OTP field with numeric inputmode
    if (
      element.maxLength >= OTP_MIN_LENGTH &&
      element.maxLength <= OTP_MAX_LENGTH &&
      element.getAttribute('inputmode') === 'numeric'
    ) {
      return true;
    }

    // Explicit autocomplete
    if (element.autocomplete === 'one-time-code') {return true;}

    // Pattern attribute for digits only (HTMLInputElement only)
    if (
      element instanceof HTMLInputElement &&
      element.pattern &&
      this.DIGIT_PATTERN_REGEX.test(element.pattern)
    ) {
      return true;
    }

    // Name/ID/placeholder/label text signals
    return this.OTP_TEXT_PATTERN.test(textToCheck);
  }

  /**
   * Calculate a confidence score for how likely this is an OTP field.
   * Score components are additive and clamped to [0, 1].
   */
  static calculateConfidence(element: FormInputElement): number {
    let confidence = 0;

    // ── Structural signals ────────────────────────────────
    if (element.maxLength === 1) {
      confidence += this.hasSplitCluster(element)
        ? CONFIDENCE.OTP_SINGLE_CHAR
        : CONFIDENCE.OTP_SINGLE_CHAR * 0.25;
    } else if (
      element.maxLength >= OTP_MIN_LENGTH &&
      element.maxLength <= OTP_MAX_LENGTH
    ) {
      confidence += CONFIDENCE.OTP_NUMERIC_LENGTH;
    }

    if (element.getAttribute('inputmode') === 'numeric') {
      confidence += CONFIDENCE.OTP_INPUTMODE_NUMERIC;
    }

    if (element.autocomplete === 'one-time-code') {
      confidence += CONFIDENCE.OTP_AUTOCOMPLETE;
    }

    const type = (element.type ?? '').toLowerCase();
    if (type === 'tel' || type === 'number') {
      confidence += CONFIDENCE.OTP_TYPE_TEL_NUMBER;
    }

    // ── Text signals ──────────────────────────────────────
    const textToCheck = combineTextSignals(
      element.name,
      element.id,
      element.placeholder,
      getElementLabel(element),
      element.getAttribute('aria-label')
    );

    if (/otp/i.test(textToCheck)) {confidence += CONFIDENCE.OTP_NAME_OTP;}
    if (/code/i.test(textToCheck)) {confidence += CONFIDENCE.OTP_NAME_CODE;}
    if (/verify/i.test(textToCheck)) {confidence += CONFIDENCE.OTP_NAME_VERIFY;}

    return clampConfidence(confidence);
  }

  private static hasSplitCluster(element: FormInputElement): boolean {
    const parent = element.parentElement;
    if (!parent) {return false;}

    const siblings = Array.from(parent.querySelectorAll<HTMLInputElement>('input')).filter(
      (input) =>
        input !== element &&
        input.maxLength === 1 &&
        VisibilityCheck.isVisible(input)
    );

    return siblings.length >= 3;
  }
}

// ═══════════════════════════════════════════════════════════════
//  §6  D O M   T R A V E R S A L  (Shadow DOM Piercing)
// ═══════════════════════════════════════════════════════════════

// (Removed duplicate DOMTraversal class)
// ═══════════════════════════════════════════════════════════════

class FieldClassifier {
  /**
   * Identity field types that should NOT match if the label
   * mentions "code", "otp", or "#" (which indicate OTP/token fields).
   */
  private static readonly IDENTITY_FIELD_TYPES = new Set<string>([
    'name', 'first-name', 'last-name', 'username',
  ]);

  private static readonly IDENTITY_NEGATION_PATTERN = /code|otp|#/i;

  private static readonly CONFIRM_PASSWORD_PATTERN = /confirm|repeat|retype|verify|re[-_\s]?enter|again/i;

  /**
   * Classify a single field using the heuristic scoring engine.
   * Returns the best-matching FieldType and confidence score.
   */
  static classify(
    element: FormInputElement,
    isFirstVisible: boolean
  ): { fieldType: FieldType; confidence: number } {
    const type = (element.type ?? 'text').toLowerCase();
    const name = (element.name ?? '').toLowerCase();
    const id = (element.id ?? '').toLowerCase();
    const placeholder = (element.placeholder ?? '').toLowerCase();
    const autocomplete = (element.autocomplete ?? '').toLowerCase();
    const ariaLabel = (element.getAttribute('aria-label') ?? '').toLowerCase();
    const ariaLabelledBy = (element.getAttribute('aria-labelledby') ?? '').toLowerCase();
    const label = getElementLabel(element).toLowerCase();

    const allText = combineTextSignals(name, id, placeholder, label, ariaLabel, ariaLabelledBy);

    let bestType: FieldType = 'unknown';
    let bestConfidence = 0;

    // ── Phase 1: Heuristic scoring against FIELD_HEURISTICS ──
    for (const [fType, heuristics] of Object.entries(FIELD_HEURISTICS)) {
      if (fType === 'unknown') {continue;}

      // Negation: identity fields should not match OTP-like labels
      if (
        this.IDENTITY_FIELD_TYPES.has(fType) &&
        this.IDENTITY_NEGATION_PATTERN.test(allText)
      ) {
        continue;
      }

      let confidence = 0;
      let matchCount = 0;

      // Type attribute
      if (heuristics.types.includes(type)) {
        confidence += CONFIDENCE.TYPE_MATCH;
        matchCount++;
      }

      // Autocomplete attribute
      if (heuristics.autocomplete.includes(autocomplete)) {
        confidence += CONFIDENCE.AUTOCOMPLETE_MATCH;
        matchCount++;
      }

      // Regex patterns
      if (heuristics.patterns.some((p: RegExp) => p.test(allText))) {
        confidence += CONFIDENCE.PATTERN_MATCH;
        matchCount++;
      }

      // Keywords
      if (heuristics.keywords.some((k: string) => allText.includes(k))) {
        confidence += CONFIDENCE.KEYWORD_MATCH;
        matchCount++;
      }

      // Must have at least one match to be considered
      if (matchCount >= 1 && confidence > bestConfidence) {
        bestConfidence = confidence;
        bestType = fType as FieldType;
      }
    }

    // ── Phase 2: Aggressive email fallback ────────────────
    if (bestType === 'unknown' || bestConfidence < MIN_CONFIDENCE_THRESHOLD) {
      if (type === 'email') {
        bestType = 'email';
        bestConfidence = CONFIDENCE.EMAIL_TYPE_ATTR;
      } else if (placeholder.includes('@') || placeholder.includes('example.com')) {
        bestType = 'email';
        bestConfidence = CONFIDENCE.EMAIL_PLACEHOLDER_AT;
      }
    }

    // ── Phase 3: OTP override ─────────────────────────────
    const otpConfidence = OTPDetector.calculateConfidence(element);
    if (OTPDetector.isLikelyOTP(element) && otpConfidence > bestConfidence) {
      bestType = 'otp';
      bestConfidence = otpConfidence;
    }

    // ── Phase 4: Confirm password detection ───────────────
    if (bestType === 'password') {
      const confirmText = combineTextSignals(name, id, placeholder, label);
      if (this.CONFIRM_PASSWORD_PATTERN.test(confirmText)) {
        bestType = 'confirm-password';
      }
    }

    return {
      fieldType: bestType,
      confidence: clampConfidence(bestConfidence),
    };
  }
}

// ═══════════════════════════════════════════════════════════════
//  §8  M A I N   F I E L D   A N A L Y Z E R   C L A S S
// ═══════════════════════════════════════════════════════════════

export class FieldAnalyzer {
  private static instance: FieldAnalyzer;
  
  public static getInstance(): FieldAnalyzer {
    if (!FieldAnalyzer.instance) {
      FieldAnalyzer.instance = new FieldAnalyzer();
    }
    return FieldAnalyzer.instance;
  }

  // ── Context Check ───────────────────
  private isContextValid(): boolean {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
  }

  // ── Static AI response cache (bounded to prevent memory leak) ──
  private static aiCache = new Map<string, AICacheEntry>();
  private static readonly MAX_CACHE_SIZE = 50;

  // Intelligence 2.0: Attentive ML (Spatial Focus)
  private attentiveRegion: { x: number; y: number; radius: number } | null = null;
  
  public setAttentiveRegion(x: number, y: number, radius: number = 300): void {
    this.attentiveRegion = { x, y, radius };
    // Auto-clear after 10 seconds to save performance
    setTimeout(() => {
      if (this.attentiveRegion?.x === x && this.attentiveRegion?.y === y) {
        this.attentiveRegion = null;
      }
    }, 10000);
  }
  
  private static pruneCache(): void {
    if (FieldAnalyzer.aiCache.size >= FieldAnalyzer.MAX_CACHE_SIZE) {
      // Evict the oldest entry (Map preserves insertion order)
      const firstKey = FieldAnalyzer.aiCache.keys().next().value;
      if (firstKey !== undefined) {
        FieldAnalyzer.aiCache.delete(firstKey);
      }
    }
  }

  // Dead code removed: the selector below produced invalid CSS (bare :not() without subject).
  // The correct selector is FILLABLE_INPUT_SELECTOR below.

  private static readonly FILLABLE_INPUT_SELECTOR =
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="image"]):not([type="range"]):not([type="color"]), textarea';

  private static readonly OTP_INPUT_SELECTOR =
    'input[type="text"], input[type="number"], input[type="tel"], input:not([type])';

  private static readonly EXCLUDED_INPUT_TYPES = new Set([
    'hidden', 'submit', 'button', 'reset', 'checkbox', 'radio',
  ]);

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════════════════

  /**
   * Analyze a single input field and return its classification.
   * Now incorporates Ensemble Scoring and Structural Signals.
   */
  analyzeField(element: FormInputElement, allInputs?: FormInputElement[]): DetectedField {
    const isFirstVisible = this.isFirstVisibleInput(element, allInputs);
    const { fieldType, confidence: heuristicConf } = FieldClassifier.classify(element, isFirstVisible);
    
    // Intelligence 2.0: Extract Spatial/Topology signals from Features
    let spatialConfidence = 0;
    try {
      // We can't easily import from extractor here without async, so we use heuristic spatial clues
      const rect = element.getBoundingClientRect();
      const isSquare = Math.abs(rect.width - rect.height) < 10;
      const isCentered = Math.abs(window.innerWidth / 2 - (rect.left + rect.width / 2)) < 200;
      
      if (fieldType === 'otp') {
        if (isSquare) {
          spatialConfidence += 0.3;
        }
        if (isCentered) {
          spatialConfidence += 0.2;
        }
      }
    } catch { /* ignore */ }

    return {
      element,
      selector: getUniqueSelector(element),
      fieldType,
      confidence: clampConfidence(heuristicConf + spatialConfidence),
      label: getElementLabel(element) || undefined,
      placeholder: element.placeholder || undefined,
      name: element.name || undefined,
      id: element.id || undefined,
      autocomplete: element.autocomplete || undefined,
      rect: element.getBoundingClientRect(),
    };
  }

  /**
   * Check if field is likely an OTP input.
   * Delegates to OTPDetector for consistent logic.
   */
  isLikelyOTPField(element: FormInputElement): boolean {
    return OTPDetector.isLikelyOTP(element);
  }

  /**
   * Calculate OTP field confidence score.
   * Delegates to OTPDetector for consistent logic.
   */
  calculateOTPConfidence(element: FormInputElement): number {
    return OTPDetector.calculateConfidence(element);
  }

  /**
   * Find all OTP-related fields on the page, sorted by confidence.
   */
  findOTPFields(): DetectedField[] {
    const inputs = deepQuerySelectorAll<HTMLInputElement>(
      FieldAnalyzer.OTP_INPUT_SELECTOR
    );

    const otpFields: DetectedField[] = [];

    for (const input of inputs) {
      if (!VisibilityCheck.isVisible(input)) {continue;}
      if (OTPDetector.isLikelyOTP(input)) {
        otpFields.push(this.analyzeField(input));
      }
    }

    // Sort by confidence descending
    otpFields.sort((a, b) => b.confidence - a.confidence);

    return otpFields;
  }

  /**
   * Get all fields with heuristics first, augmented by Sentinel Brain (Grandmaster).
   * Combines ensemble ML, Spatial Topology, and Multilingual Heuristics.
   */
  async getAllFieldsWithAI(): Promise<FieldAnalysisResult> {
    if (!this.isContextValid()) {return { fields: [] };}
    
    // 1. Get all fillable fields
    const elements = deepQuerySelectorAll<FormInputElement>(
      FieldAnalyzer.FILLABLE_INPUT_SELECTOR
    ).filter(el => VisibilityCheck.isVisible(el));

    if (elements.length === 0) {
      return { fields: [] };
    }

    // 2. Delegate to Sentinel Brain for Grandmaster Analysis
    try {
      const detections = await SentinelBrain.analyze(elements);
      
      const fields: DetectedField[] = detections.map(d => ({
        element: d.element as FormInputElement,
        selector: getUniqueSelector(d.element as HTMLElement),
        fieldType: d.type as FieldType,
        confidence: d.confidence,
        label: getElementLabel(d.element as FormInputElement) || undefined,
        placeholder: (d.element as HTMLInputElement).placeholder || undefined,
        name: (d.element as HTMLInputElement).name || undefined,
        id: d.element.id || undefined,
        autocomplete: (d.element as HTMLInputElement).autocomplete || undefined,
        rect: d.element.getBoundingClientRect(),
      }));

      return { fields };
    } catch (e) {
      log.debug('Sentinel Brain unavailable, falling back to heuristics', e);
      return { fields: this.getAllFields() };
    }
  }

  /**
   * Find a group of single-digit OTP inputs starting from a given element.
   * Searches siblings in the parent container, sorted by visual position.
   */
  findOTPInputGroup(startElement: HTMLInputElement): HTMLInputElement[] {
    const parent = startElement.parentElement;
    if (!parent) {return [startElement];}

    // Find all sibling single-char inputs that look like OTP digits
    const siblings = Array.from(
      parent.querySelectorAll<HTMLInputElement>('input')
    ).filter(
      (input) =>
        input.maxLength === 1 &&
        VisibilityCheck.isVisible(input) &&
        OTPDetector.isLikelyOTP(input)
    );

    // Ensure startElement is included
    if (!siblings.includes(startElement)) {
      siblings.push(startElement);
    }

    // Sort by horizontal position (left-to-right)
    siblings.sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      // Row-first with 10px tolerance
      if (Math.abs(rectA.top - rectB.top) > 10) {
        return rectA.top - rectB.top;
      }
      return rectA.left - rectB.left;
    });

    return siblings;
  }

  /**
   * Get all fillable fields on the page, classified by type.
   * Pierces shadow DOM boundaries.
   */
  getAllFields(): DetectedField[] {
    const elements = deepQuerySelectorAll<FormInputElement>(
      FieldAnalyzer.FILLABLE_INPUT_SELECTOR
    );

    const fields: DetectedField[] = [];

    for (const element of elements) {
      if (!VisibilityCheck.isVisible(element)) {continue;}
      fields.push(this.analyzeField(element, elements));
    }

    return fields;
  }

  /**
   * Proactive Shadow Scanner: Finds hidden containers (modals, drawers)
   * that are likely to contain auth forms.
   */
  scanHiddenModals(): GhostContainer[] {
    const ghostContainers: GhostContainer[] = [];
    
    // Heuristic selectors for common modal/auth containers
    const potentialSelectors = [
      '[id*="signup"]', '[id*="login"]', '[id*="auth"]', '[id*="register"]',
      '[class*="signup"]', '[class*="login"]', '[class*="auth"]', '[class*="modal"]',
      '[role="dialog"]', '[role="form"]', 'form[style*="display: none"]',
      '[aria-label*="sign up"i]', '[aria-label*="log in"i]'
    ];
    
    const root = document.body;
    const elements = deepQuerySelectorAll<HTMLElement>(potentialSelectors.join(','), root);

    for (const el of elements) {
      // We only care about HIDDEN or VIRTUAL elements
      const style = window.getComputedStyle(el);
      const isActuallyHidden = style.display === 'none' || style.visibility === 'hidden' || el.offsetWidth === 0;
      
      if (isActuallyHidden) {
        const text = (el.id + el.className + el.getAttribute('aria-label') + el.innerText).toLowerCase();
        
        let type: FormType = 'unknown';
        let confidence = 0;
        let reason = '';

        if (/signup|register|create|join/i.test(text)) {
          type = 'signup';
          confidence = 0.8;
          reason = 'ID/Class matches Signup pattern';
        } else if (/login|signin|auth/i.test(text)) {
          type = 'login';
          confidence = 0.8;
          reason = 'ID/Class matches Login pattern';
        }

        if (type !== 'unknown') {
          ghostContainers.push({
            element: el,
            selector: getUniqueSelector(el),
            predictedType: type,
            confidence,
            reason
          });
        }
      }
    }

    return ghostContainers;
  }

  /**
   * Apply an AI-suggested selector override to the field list.
   * If the element exists, either updates its type/confidence or adds it.
   */
  private applyAIOverride(
    fields: DetectedField[],
    selector: string,
    fieldType: FieldType
  ): void {
    const el = safeQuerySelector<HTMLInputElement>(document, selector);
    if (!el) {
      log.warn(`AI suggested selector not found: ${selector}`);
      return;
    }

    const existing = fields.find((f) => f.element === el);
    if (existing) {
      existing.fieldType = fieldType;
      existing.confidence = CONFIDENCE.AI_OVERRIDE;
    } else {
      const newField = this.analyzeField(el);
      newField.fieldType = fieldType;
      newField.confidence = CONFIDENCE.AI_OVERRIDE;
      fields.push(newField);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  SIMPLIFIED DOM EXTRACTION (for AI/LLM consumption)
  // ═══════════════════════════════════════════════════════════

  /**
   * Tree-Shaker Algorithm: Extract compressed DOM representation
   * for small-capacity LLMs. Strips all visual formatting and
   * outputs a minimal dense map with CSS selector annotations.
   *
   * Security: All user-controlled text is escaped before output.
   */
  extractSimplifiedDOM(): string {
    try {
      const forms = deepQuerySelectorAll<HTMLFormElement>('form');
      const root: Document | Element = forms.length > 0 ? forms[0] : document.body;

      const elements = deepQuerySelectorAll<HTMLElement>(
        'input, button, label, [role="button"]',
        root
      );

      const parts: string[] = [];

      for (const el of elements) {
        const line = this.extractElementLine(el);
        if (line) {parts.push(line);}
      }

      const result = parts.join('\n');
      return result.length > DOM_EXTRACTION_CHAR_LIMIT
        ? result.substring(0, DOM_EXTRACTION_CHAR_LIMIT)
        : result;
    } catch (e) {
      log.error('DOM tree-shaking failed', e);
      return '';
    }
  }

  /**
   * Extract a single line representation of an element for the simplified DOM.
   * Returns null if the element should be skipped.
   */
  private extractElementLine(el: HTMLElement): string | null {
    if (el instanceof HTMLInputElement) {
      return this.extractInputLine(el);
    }

    if (el instanceof HTMLLabelElement) {
      return this.extractLabelLine(el);
    }

    if (el instanceof HTMLButtonElement || el.getAttribute('role') === 'button') {
      return this.extractButtonLine(el);
    }

    return null;
  }

  private extractInputLine(el: HTMLInputElement): string | null {
    if (FieldAnalyzer.EXCLUDED_INPUT_TYPES.has(el.type)) {return null;}

    const attrs: string[] = [];
    if (el.type) {attrs.push(`type="${this.sanitizeAttr(el.type)}"`);}
    if (el.id) {attrs.push(`id="${this.sanitizeAttr(el.id)}"`);}
    if (el.name) {attrs.push(`name="${this.sanitizeAttr(el.name)}"`);}
    if (el.placeholder) {attrs.push(`ph="${this.sanitizeAttr(el.placeholder)}"`);}

    // Resolve label text
    const labelText = LabelResolver.resolve(el);
    if (labelText) {
      attrs.push(`label="${this.sanitizeAttr(labelText)}"`);
    }

    // Build selector for AI mapping
    const selector = el.id
      ? `#${escapeCSS(el.id)}`
      : el.name
        ? `input[name="${escapeCSS(el.name)}"]`
        : `input[type="${escapeCSS(el.type || 'text')}"]`;

    return `[sel:${selector}] <input ${attrs.join(' ')}/>`;
  }

  private extractLabelLine(el: HTMLLabelElement): string | null {
    // Skip labels that wrap inputs (they'll be picked up by input extraction)
    if (el.querySelector('input')) {return null;}

    const forAttr = el.getAttribute('for') ?? '';
    const text = (el.textContent ?? '').trim();
    if (!text) {return null;}

    return `<label for="${this.sanitizeAttr(forAttr)}">${this.sanitizeAttr(text)}</label>`;
  }

  private extractButtonLine(el: HTMLElement): string | null {
    const text = (el.textContent?.trim() || el.getAttribute('aria-label') || 'submit');
    const sanitizedText = this.sanitizeAttr(text);

    const selector = el.id
      ? `#${escapeCSS(el.id)}`
      : `button`; // Note: `:contains()` is not standard CSS

    return `[sel:${selector}] <button>${sanitizedText}</button>`;
  }

  /**
   * Sanitize attribute values to prevent injection in the
   * simplified DOM output. Strips quotes and angle brackets.
   */
  private sanitizeAttr(value: string): string {
    return value
      .replace(/"/g, "'")
      .replace(/</g, '')
      .replace(/>/g, '')
      .replace(/\n/g, ' ')
      .trim();
  }

  // ═══════════════════════════════════════════════════════════
  //  PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════

  /**
   * Check if element is the first visible text/email input in its form.
   * First input is typically email/username on login/signup forms.
   */
  private isFirstVisibleInput(element: FormInputElement, precomputedInputs?: FormInputElement[]): boolean {
    const form = element.closest('form') ?? document.body;

    const inputs = precomputedInputs 
      ? precomputedInputs.filter(i => (i.type === 'text' || i.type === 'email' || !i.type) && i.closest('form') === (element.closest('form') || document.body))
      : Array.from(
          form.querySelectorAll<HTMLInputElement>(
            'input[type="text"], input[type="email"], input:not([type])'
          )
        );

    // If using precomputed, we still need to check visibility if we haven't yet
    // but usually getAllFields already filtered visible ones.
    const firstVisible = inputs.find((input) => VisibilityCheck.isVisible(input));

    return firstVisible === element;
  }
}

