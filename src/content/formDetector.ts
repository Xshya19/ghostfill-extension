import {
  FormType,
  FieldType,
  DetectedForm,
  DetectedField,
  FormAnalysis,
  FORM_INDICATORS,
  GhostContainer,
  FormInputElement,
} from '../types';
import { getUniqueSelector, deepQuerySelectorAll, getElementLabel } from '../utils/core';
import { createLogger } from '../utils/logger';
import { safeGetComputedStyle } from './ui/safeStyles';
import { extractFieldRecord, resolveLabelText } from '../intelligence/pageAnalyzer';
import { classifyField, classifyHeuristic, mapFieldClassToFieldType, IntelligenceCore } from '../intelligence/IntelligenceCore';
import { debounce } from '../utils/debounce';
import { harvestPageJsonl } from '../intelligence/eval/harvest';
import { pageStatus } from './ui/pageStatus';

const log = createLogger('FormDetector');

// ─────────────────────────────────────────────────────────────
//  §0  C O N S T A N T S  (Visibility Check & Proximity)
// ─────────────────────────────────────────────────────────────

const DOM_EXTRACTION_CHAR_LIMIT = 2000;
const MAX_LABEL_TEXT_LENGTH = 120;
const OTP_MIN_LENGTH = 4;
const OTP_MAX_LENGTH = 8;
const HIGHLIGHT_DURATION_MS = 2000;
const HIGHLIGHT_OUTLINE = '2px solid #6366F1';
const HIGHLIGHT_BOX_SHADOW = '0 0 10px rgba(99, 102, 241, 0.5)';
const FORM_TEXT_SCAN_LIMIT = 500;
const MIN_FIELD_CONFIDENCE = 0.3;
const MIN_STANDALONE_CONFIDENCE = 0.55;

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

const CLASSIFICATION_WEIGHTS = {
  REQUIRED_FIELDS: 0.4,
  PATTERN_MATCH: 0.4,
  LOGIN_BONUS: 0.2,
  SIGNUP_BONUS: 0.2,
  TWO_FACTOR_BONUS: 0.3,
} as const;

type SubmitElement = HTMLButtonElement | HTMLInputElement;

interface AICacheEntry {
  prediction: { label: string; confidence: number };
  timestamp: number;
}

interface ClassificationResult {
  readonly type: FormType;
  readonly confidence: number;
}

interface DebouncedMutationHandler {
  (mutations: MutationRecord[]): void;
  cancel: () => void;
}

// ─────────────────────────────────────────────────────────────
//  §1  S A F E   U T I L I T I E S
// ─────────────────────────────────────────────────────────────

function escapeCSS(value: string): string {
  try {
    return CSS.escape(value);
  } catch {
    return value.replace(/([^\w-])/g, '\\$1');
  }
}

function safeQuerySelector<T extends Element>(root: ParentNode, selector: string): T | null {
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

class VisibilityCheck {
  static isVisible(element: HTMLElement): boolean {
    if (!element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = safeGetComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') > 0.01;
  }
}

// ─────────────────────────────────────────────────────────────
//  §2  L A B E L   R E S O L V E R
// ─────────────────────────────────────────────────────────────

class LabelResolver {
  static resolve(element: HTMLElement): string {
    return resolveLabelText(element as any);
  }
}

// ─────────────────────────────────────────────────────────────
//  §3  O T P   D E T E C T O R
// ─────────────────────────────────────────────────────────────

class OTPDetector {
  private static readonly OTP_TEXT_PATTERN = /otp|code|verify|token|pin|2fa|mfa/i;
  private static readonly DIGIT_PATTERN_REGEX = /^\^?\\?d/;
  private static readonly CAPTCHA_PATTERN =
    /captcha|recaptcha|hcaptcha|turnstile|anti[-_\s]?bot|bot[-_\s]?check|robot/i;

  static isLikelyOTP(element: FormInputElement): boolean {
    const textToCheck = combineTextSignals(
      element.name,
      element.id,
      element.placeholder,
      getElementLabel(element),
      element.getAttribute('aria-label')
    );

    const hasExplicitSignal = this.OTP_TEXT_PATTERN.test(textToCheck);

    if (this.CAPTCHA_PATTERN.test(textToCheck)) return false;

    if (element.maxLength === 1) {
      return (
        this.hasSplitCluster(element) ||
        hasExplicitSignal ||
        element.autocomplete === 'one-time-code' ||
        element.getAttribute('inputmode') === 'numeric'
      );
    }

    if (
      element.maxLength >= OTP_MIN_LENGTH &&
      element.maxLength <= OTP_MAX_LENGTH &&
      element.getAttribute('inputmode') === 'numeric'
    ) {
      return true;
    }

    if (element.autocomplete === 'one-time-code') return true;

    if (
      element instanceof HTMLInputElement &&
      element.pattern &&
      this.DIGIT_PATTERN_REGEX.test(element.pattern)
    ) {
      return true;
    }

    return this.OTP_TEXT_PATTERN.test(textToCheck);
  }

  static calculateConfidence(element: FormInputElement): number {
    let confidence = 0;

    if (element.maxLength === 1) {
      confidence += this.hasSplitCluster(element)
        ? CONFIDENCE.OTP_SINGLE_CHAR
        : CONFIDENCE.OTP_SINGLE_CHAR * 0.25;
    } else if (element.maxLength >= OTP_MIN_LENGTH && element.maxLength <= OTP_MAX_LENGTH) {
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

    const textToCheck = combineTextSignals(
      element.name,
      element.id,
      element.placeholder,
      getElementLabel(element),
      element.getAttribute('aria-label')
    );

    if (this.CAPTCHA_PATTERN.test(textToCheck)) return 0;

    if (/otp/i.test(textToCheck)) confidence += CONFIDENCE.OTP_NAME_OTP;
    if (/code/i.test(textToCheck)) confidence += CONFIDENCE.OTP_NAME_CODE;
    if (/verify/i.test(textToCheck)) confidence += CONFIDENCE.OTP_NAME_VERIFY;

    return clampConfidence(confidence);
  }

  private static hasSplitCluster(element: FormInputElement): boolean {
    const parent = element.parentElement;
    if (!parent) return false;

    const siblings = Array.from(parent.querySelectorAll<HTMLInputElement>('input')).filter(
      (input) => input !== element && input.maxLength === 1 && VisibilityCheck.isVisible(input)
    );

    return siblings.length >= 3;
  }
}

// ─────────────────────────────────────────────────────────────
//  §4  F I E L D   A N A L Y Z E R
// ─────────────────────────────────────────────────────────────

export class FieldAnalyzer {
  private static instance: FieldAnalyzer;

  public static getInstance(): FieldAnalyzer {
    if (!FieldAnalyzer.instance) {
      FieldAnalyzer.instance = new FieldAnalyzer();
    }
    return FieldAnalyzer.instance;
  }

  private static readonly FILLABLE_INPUT_SELECTOR =
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="image"]):not([type="range"]):not([type="color"]), textarea';

  private static readonly OTP_INPUT_SELECTOR =
    'input[type="text"], input[type="number"], input[type="tel"], input:not([type])';

  private static readonly EXCLUDED_INPUT_TYPES = new Set([
    'hidden', 'submit', 'button', 'reset', 'checkbox', 'radio',
  ]);

  private attentiveRegion: { x: number; y: number; radius: number } | null = null;

  public setAttentiveRegion(x: number, y: number, radius: number = 300): void {
    this.attentiveRegion = { x, y, radius };
    setTimeout(() => {
      if (this.attentiveRegion?.x === x && this.attentiveRegion?.y === y) {
        this.attentiveRegion = null;
      }
    }, 10000);
  }

  analyzeField(element: FormInputElement, _allInputs?: FormInputElement[]): DetectedField {
    const record = extractFieldRecord(element);
    const decision = classifyField(record);
    const result = classifyHeuristic(record);

    let fieldType = mapFieldClassToFieldType(result.top);
    let confidence = result.topProb;

    if (decision.action === 'BLOCK') {
      fieldType = 'unknown';
      confidence = 0;
    }

    let spatialConfidence = 0;
    try {
      const rect = element.getBoundingClientRect();
      const isSquare = Math.abs(rect.width - rect.height) < 10;
      const isCentered = Math.abs(window.innerWidth / 2 - (rect.left + rect.width / 2)) < 200;

      if (fieldType === 'otp') {
        if (isSquare) spatialConfidence += 0.3;
        if (isCentered) spatialConfidence += 0.2;
      }
    } catch {
      /* ignore */
    }

    return {
      element,
      selector: getUniqueSelector(element),
      fieldType,
      confidence: clampConfidence(confidence + spatialConfidence),
      label: getElementLabel(element) || undefined,
      placeholder: element.placeholder || undefined,
      name: element.name || undefined,
      id: element.id || undefined,
      autocomplete: element.autocomplete || undefined,
      rect: element.getBoundingClientRect(),
    };
  }

  isLikelyOTPField(element: FormInputElement): boolean {
    return OTPDetector.isLikelyOTP(element);
  }

  calculateOTPConfidence(element: FormInputElement): number {
    return OTPDetector.calculateConfidence(element);
  }

  findOTPFields(): DetectedField[] {
    const inputs = deepQuerySelectorAll<HTMLInputElement>(FieldAnalyzer.OTP_INPUT_SELECTOR);
    const otpFields: DetectedField[] = [];

    for (const input of inputs) {
      if (!VisibilityCheck.isVisible(input)) continue;
      if (OTPDetector.isLikelyOTP(input)) {
        otpFields.push(this.analyzeField(input));
      }
    }

    otpFields.sort((a, b) => b.confidence - a.confidence);
    return otpFields;
  }

  findOTPInputGroup(startElement: HTMLInputElement): HTMLInputElement[] {
    const parent = startElement.parentElement;
    if (!parent) return [startElement];

    const siblings = Array.from(parent.querySelectorAll<HTMLInputElement>('input')).filter(
      (input) =>
        input.maxLength === 1 && VisibilityCheck.isVisible(input) && OTPDetector.isLikelyOTP(input)
    );

    if (!siblings.includes(startElement)) siblings.push(startElement);

    siblings.sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      const tolerance = rectA.height * 0.5;
      if (Math.abs(rectA.top - rectB.top) > tolerance) {
        return rectA.top - rectB.top;
      }
      return rectA.left - rectB.left;
    });

    return siblings;
  }

  getAllFields(): DetectedField[] {
    const elements = deepQuerySelectorAll<FormInputElement>(FieldAnalyzer.FILLABLE_INPUT_SELECTOR);
    
    try {
      const iframes = Array.from(document.querySelectorAll('iframe'));
      for (const iframe of iframes) {
        try {
          if (iframe.contentDocument) {
            const iframeInputs = Array.from(
              iframe.contentDocument.querySelectorAll<FormInputElement>(FieldAnalyzer.FILLABLE_INPUT_SELECTOR)
            );
            elements.push(...iframeInputs);
          }
        } catch {
          // Cross-origin iframe
        }
      }
    } catch {}

    const fields: DetectedField[] = [];

    for (const element of elements) {
      if (!VisibilityCheck.isVisible(element)) continue;
      fields.push(this.analyzeField(element, elements));
    }

    return fields;
  }

  scanHiddenModals(): GhostContainer[] {
    const ghostContainers: GhostContainer[] = [];
    const potentialSelectors = [
      '[id*="signup"]', '[id*="login"]', '[id*="auth"]', '[id*="register"]',
      '[class*="signup"]', '[class*="login"]', '[class*="auth"]', '[class*="modal"]',
      '[role="dialog"]', '[role="form"]', 'form[style*="display: none"]',
      '[aria-label*="sign up"i]', '[aria-label*="log in"i]',
    ];

    const elements = deepQuerySelectorAll<HTMLElement>(potentialSelectors.join(','), document.body);

    for (const el of elements) {
      const style = safeGetComputedStyle(el);
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
            reason,
          });
        }
      }
    }

    return ghostContainers;
  }

  extractSimplifiedDOM(): string {
    try {
      const forms = deepQuerySelectorAll<HTMLFormElement>('form');
      const root: Document | Element = forms.length > 0 ? (forms[0] ?? document.body) : document.body;

      const elements = deepQuerySelectorAll<HTMLElement>(
        'input, button, label, [role="button"]',
        root
      );

      const parts: string[] = [];
      for (const el of elements) {
        const line = this.extractElementLine(el);
        if (line) parts.push(line);
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

  private extractElementLine(el: HTMLElement): string | null {
    if (el instanceof HTMLInputElement) return this.extractInputLine(el);
    if (el instanceof HTMLLabelElement) return this.extractLabelLine(el);
    if (el instanceof HTMLButtonElement || el.getAttribute('role') === 'button') {
      return this.extractButtonLine(el);
    }
    return null;
  }

  private extractInputLine(el: HTMLInputElement): string | null {
    if (FieldAnalyzer.EXCLUDED_INPUT_TYPES.has(el.type)) return null;

    const attrs: string[] = [];
    if (el.type) attrs.push(`type="${this.sanitizeAttr(el.type)}"`);
    if (el.id) attrs.push(`id="${this.sanitizeAttr(el.id)}"`);
    if (el.name) attrs.push(`name="${this.sanitizeAttr(el.name)}"`);
    if (el.placeholder) attrs.push(`ph="${this.sanitizeAttr(el.placeholder)}"`);

    const labelText = LabelResolver.resolve(el);
    if (labelText) attrs.push(`label="${this.sanitizeAttr(labelText)}"`);

    const selector = el.id
      ? `#${escapeCSS(el.id)}`
      : el.name
        ? `input[name="${escapeCSS(el.name)}"]`
        : `input[type="${escapeCSS(el.type || 'text')}"]`;

    return `[sel:${selector}] <input ${attrs.join(' ')}/>`;
  }

  private extractLabelLine(el: HTMLLabelElement): string | null {
    if (el.querySelector('input')) return null;

    const forAttr = el.getAttribute('for') ?? '';
    const text = (el.textContent ?? '').trim();
    if (!text) return null;

    return `<label for="${this.sanitizeAttr(forAttr)}">${this.sanitizeAttr(text)}</label>`;
  }

  private extractButtonLine(el: HTMLElement): string | null {
    const text = el.textContent?.trim() || el.getAttribute('aria-label') || 'submit';
    const sanitizedText = this.sanitizeAttr(text);
    const selector = el.id ? `#${escapeCSS(el.id)}` : `button`;

    return `[sel:${selector}] <button>${sanitizedText}</button>`;
  }

  private sanitizeAttr(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, ' ')
      .trim();
  }
}

// ─────────────────────────────────────────────────────────────
//  §5  F O R M   C L A S S I F I E R
// ─────────────────────────────────────────────────────────────

class FormClassifier {
  private static readonly SUBMIT_TEXT_PATTERN =
    /submit|login|log\s*in|sign\s*in|sign\s*up|register|continue|next|verify|confirm|create|send|go|done/i;
  private static readonly SECONDARY_ACTION_PATTERN =
    /resend|back|cancel|close|skip|later|forgot|show|hide|copy|edit|change|google|github|apple|facebook/i;

  static classify(form: HTMLElement, fields: DetectedField[]): ClassificationResult {
    const fieldTypes = new Set(fields.map((f) => f.fieldType));
    let bestType: FormType = 'unknown';
    let bestConfidence = 0;

    const formText = this.buildFormContext(form);

    for (const [fType, indicators] of Object.entries(FORM_INDICATORS)) {
      if (fType === 'unknown') continue;

      let confidence = 0;

      const hasRequiredFields = indicators.requiredFields.every((rf: string) =>
        fieldTypes.has(rf as FieldType)
      );
      if (hasRequiredFields) {
        confidence += CLASSIFICATION_WEIGHTS.REQUIRED_FIELDS;
      }

      const patternMatch = indicators.patterns.some((p: RegExp) => p.test(formText));
      if (patternMatch) {
        confidence += CLASSIFICATION_WEIGHTS.PATTERN_MATCH;
      }

      confidence += this.calculateFieldBonus(fType, fieldTypes);

      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestType = fType as FormType;
      }
    }

    return {
      type: bestType,
      confidence: clampConfidence(bestConfidence),
    };
  }

  private static buildFormContext(form: HTMLElement): string {
    const parts: string[] = [];

    if (form.className && typeof form.className === 'string') parts.push(form.className);
    if (form.id) parts.push(form.id);
    if (form instanceof HTMLFormElement && form.action) parts.push(form.action);

    const textContent = form.textContent;
    if (textContent) {
      if (form === document.body) {
        parts.push(document.title);
        const walker = document.createTreeWalker(form, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        let charCount = 0;
        const textChunks: string[] = [];
        while ((node = walker.nextNode()) && charCount < 1500) {
          const val = node.nodeValue || '';
          textChunks.push(val);
          charCount += val.length;
        }
        parts.push(textChunks.join('').substring(0, 1500));
      } else {
        parts.push(textContent.substring(0, FORM_TEXT_SCAN_LIMIT));
      }
    }

    return parts.join(' ').toLowerCase();
  }

  private static calculateFieldBonus(formType: string, fieldTypes: Set<FieldType>): number {
    switch (formType) {
      case 'login':
        if (fieldTypes.has('password') && !fieldTypes.has('confirm-password')) {
          return CLASSIFICATION_WEIGHTS.LOGIN_BONUS;
        }
        return 0;

      case 'signup':
        if (fieldTypes.has('confirm-password')) {
          return CLASSIFICATION_WEIGHTS.SIGNUP_BONUS;
        }
        return 0;

      case 'two-factor':
        if (fieldTypes.has('otp')) {
          return CLASSIFICATION_WEIGHTS.TWO_FACTOR_BONUS;
        }
        return 0;
    }
    return 0;
  }

  static findSubmitButton(form: HTMLElement): SubmitElement | null {
    if (form instanceof HTMLFormElement) {
      const explicitSubmit = form.querySelector<SubmitElement>(
        'button[type="submit"], input[type="submit"]'
      );
      if (explicitSubmit && VisibilityCheck.isVisible(explicitSubmit)) {
        return explicitSubmit;
      }
    }

    const candidates: SubmitElement[] = [];

    for (const button of form.querySelectorAll<HTMLButtonElement>('button')) {
      if (VisibilityCheck.isVisible(button) && !button.disabled) candidates.push(button);
    }

    for (const input of form.querySelectorAll<HTMLInputElement>(
      'input[type="submit"], input[type="button"]'
    )) {
      if (VisibilityCheck.isVisible(input) && !input.disabled) candidates.push(input);
    }

    for (const el of form.querySelectorAll<HTMLElement>('[role="button"]')) {
      if (
        (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) &&
        VisibilityCheck.isVisible(el) &&
        !el.disabled
      ) {
        candidates.push(el);
      }
    }

    let best: SubmitElement | null = null;
    let bestScore = -Infinity;

    for (const candidate of candidates) {
      const text =
        (candidate instanceof HTMLInputElement ? candidate.value : candidate.textContent)
          ?.trim()
          .toLowerCase() ?? '';

      let score = 0;
      if (candidate instanceof HTMLButtonElement && candidate.type === 'submit') score += 5;
      if (candidate instanceof HTMLInputElement && candidate.type === 'submit') score += 5;
      if (this.SUBMIT_TEXT_PATTERN.test(text)) score += 4;
      if (this.SECONDARY_ACTION_PATTERN.test(text)) score -= 6;

      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    return bestScore > 0 ? best : null;
  }
}

// ─────────────────────────────────────────────────────────────
//  §6  M A I N   F O R M   D E T E C T O R   C L A S S
// ─────────────────────────────────────────────────────────────

export class FormDetector {
  private lastAnalysis: FormAnalysis | null = null;
  private readonly fieldAnalyzer: FieldAnalyzer;

  private static readonly INPUT_SELECTOR =
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="image"]):not([type="range"]):not([type="color"]), textarea';

  constructor(fieldAnalyzer: FieldAnalyzer) {
    this.fieldAnalyzer = fieldAnalyzer;
  }

  detectForms(): FormAnalysis {
    const forms = this.detectAllForms();
    let standaloneFields = this.detectStandaloneFields(forms);

    const virtualForms = this.detectVirtualForms(standaloneFields);
    for (const vForm of virtualForms) {
      forms.push(vForm);
      const vFormFields = new Set(vForm.fields.map((f) => f.element));
      standaloneFields = standaloneFields.filter((sf) => !vFormFields.has(sf.element));
    }

    this.lastAnalysis = Object.freeze({
      forms,
      standaloneFields,
      timestamp: Date.now(),
    });

    log.debug('Form detection complete', {
      forms: forms.length,
      standaloneFields: standaloneFields.length,
    });

    return this.lastAnalysis;
  }

  analyzeForm(form: HTMLElement): DetectedForm {
    const inputs = form.querySelectorAll<FormInputElement>(FormDetector.INPUT_SELECTOR);
    const fields: DetectedField[] = [];

    for (const input of inputs) {
      if (!VisibilityCheck.isVisible(input)) continue;

      const field = this.fieldAnalyzer.analyzeField(input);
      if (field.confidence > MIN_FIELD_CONFIDENCE) {
        fields.push(field);
      }
    }

    const classification = FormClassifier.classify(form, fields);
    const submitButton = FormClassifier.findSubmitButton(form);

    return {
      element: form,
      selector: getUniqueSelector(form),
      formType: classification.type,
      confidence: classification.confidence,
      fields,
      submitButton: submitButton ?? undefined,
      actionUrl: form instanceof HTMLFormElement && form.action ? form.action : undefined,
    };
  }

  classifyForm(form: HTMLElement, fields: DetectedField[]): ClassificationResult {
    return FormClassifier.classify(form, fields);
  }

  findSubmitButton(form: HTMLElement): SubmitElement | null {
    return FormClassifier.findSubmitButton(form);
  }

  getLastAnalysis(): FormAnalysis | null {
    return this.lastAnalysis;
  }

  findFieldsByType(type: FieldType): DetectedField[] {
    if (!this.lastAnalysis) this.detectForms();

    const analysis = this.lastAnalysis;
    if (!analysis) return [];

    const fields: DetectedField[] = [];

    for (const form of analysis.forms) {
      for (const field of form.fields) {
        if (field.fieldType === type) fields.push(field);
      }
    }

    for (const field of analysis.standaloneFields) {
      if (field.fieldType === type) fields.push(field);
    }

    return fields;
  }

  highlightFields(type: string): void {
    const fields = this.findFieldsByType(type as FieldType);

    for (const field of fields) {
      const element = field.element;
      if (!element.isConnected) continue;

      const originalOutline = element.style.outline;
      const originalBoxShadow = element.style.boxShadow;

      element.style.outline = HIGHLIGHT_OUTLINE;
      element.style.boxShadow = HIGHLIGHT_BOX_SHADOW;

      const el = element;
      const prevOutline = originalOutline;
      const prevShadow = originalBoxShadow;

      setTimeout(() => {
        if (el.isConnected) {
          el.style.outline = prevOutline;
          el.style.boxShadow = prevShadow;
        }
      }, HIGHLIGHT_DURATION_MS);
    }
  }

  getActiveForm(): DetectedForm | null {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) return null;

    const form = activeElement.closest('form');
    if (!form) return null;

    return this.lastAnalysis?.forms.find((f) => f.element === form) ?? null;
  }

  getActiveField(): DetectedField | null {
    const activeElement = document.activeElement;
    if (
      !(activeElement instanceof HTMLInputElement) &&
      !(activeElement instanceof HTMLTextAreaElement)
    ) {
      return null;
    }

    const analysis = this.lastAnalysis;
    if (!analysis) return null;

    for (const form of analysis.forms) {
      const field = form.fields.find((f) => f.element === activeElement);
      if (field) return field;
    }

    return analysis.standaloneFields.find((f) => f.element === activeElement) ?? null;
  }

  invalidateCache(): void {
    this.lastAnalysis = null;
  }

  private detectAllForms(): DetectedForm[] {
    const formElements = deepQuerySelectorAll<HTMLFormElement>('form');
    const forms: DetectedForm[] = [];

    for (const form of formElements) {
      const detectedForm = this.analyzeForm(form);
      if (detectedForm.fields.length > 0) forms.push(detectedForm);
    }

    return forms;
  }

  private detectVirtualForms(standaloneFields: DetectedField[]): DetectedForm[] {
    if (standaloneFields.length === 0) return [];

    const virtualForms: DetectedForm[] = [];
    const ancestorToFields = new Map<HTMLElement, DetectedField[]>();

    for (const field of standaloneFields) {
      let ancestor = field.element.parentElement;
      let depth = 0;
      while (ancestor && ancestor !== document.body && depth < 3) {
        let list = ancestorToFields.get(ancestor);
        if (!list) {
          list = [];
          ancestorToFields.set(ancestor, list);
        }
        list.push(field);
        ancestor = ancestor.parentElement;
        depth++;
      }
    }

    const clusterMap = new Map<HTMLElement, DetectedField[]>();
    for (const field of standaloneFields) {
      let ancestor = field.element.parentElement;
      let depth = 0;
      while (ancestor && ancestor !== document.body && depth < 3) {
        const fieldsInAncestor = ancestorToFields.get(ancestor) || [];
        if (fieldsInAncestor.length >= 2) {
          if (!clusterMap.has(ancestor)) {
            clusterMap.set(ancestor, fieldsInAncestor);
          }
          break;
        }
        ancestor = ancestor.parentElement;
        depth++;
      }
    }

    for (const [container, fields] of clusterMap.entries()) {
      const classification = FormClassifier.classify(container, fields);
      if (classification.type !== 'unknown' && classification.confidence >= 0.4) {
        virtualForms.push({
          element: container,
          selector: getUniqueSelector(container),
          formType: classification.type,
          confidence: classification.confidence,
          fields,
          submitButton: FormClassifier.findSubmitButton(container) ?? undefined,
          actionUrl: undefined,
        });
      }
    }

    return virtualForms;
  }

  private detectStandaloneFields(forms: DetectedForm[]): DetectedField[] {
    const allFields = this.fieldAnalyzer.getAllFields();
    const formFieldElements = new Set<Element>();
    for (const form of forms) {
      for (const field of form.fields) {
        formFieldElements.add(field.element);
      }
    }

    const standaloneFields: DetectedField[] = [];
    for (const field of allFields) {
      if (formFieldElements.has(field.element)) continue;
      if (field.confidence > MIN_STANDALONE_CONFIDENCE) {
        standaloneFields.push(field);
      }
    }

    return standaloneFields;
  }
}

// ─────────────────────────────────────────────────────────────
//  §7  D O M   O B S E R V E R
// ─────────────────────────────────────────────────────────────

export class DOMObserver {
  private observer: MutationObserver | null = null;
  private isObserving: boolean = false;
  private urlCheckInterval: number | null = null;
  private lastUrl: string = '';
  private debouncedHandler: DebouncedMutationHandler | null = null;

  constructor(
    private formDetector: FormDetector,
    private onDOMChanged: () => Promise<void>
  ) {
    this.handleSpaNavigation = this.handleSpaNavigation.bind(this);
  }

  start(): void {
    if (this.isObserving) return;

    const debouncedUpdate = debounce(() => {
      if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
        this.stop();
        return;
      }
      log.debug('DOM changed, re-detecting forms and icons');
      this.formDetector.detectForms();
      this.onDOMChanged().catch((error) => {
        log.warn('Icon injection failed during DOM update', error);
      });
    }, 1500);

    this.debouncedHandler = debouncedUpdate as unknown as DebouncedMutationHandler;

    this.observer = new MutationObserver((mutations) => {
      let shouldRedetect = false;

      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (let i = 0; i < mutation.addedNodes.length; i++) {
            const node = mutation.addedNodes[i];
            if (node instanceof HTMLElement) {
              const tag = node.tagName;
              if (tag === 'FORM' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
                shouldRedetect = true;
                break;
              }
              if (tag === 'DIV' || tag === 'MAIN' || tag === 'SECTION' || tag.includes('-')) {
                if (node.querySelector('form, input, textarea, select')) {
                  shouldRedetect = true;
                  break;
                }
              }
            }
          }
        }
        if (shouldRedetect) break;
      }

      if (shouldRedetect && typeof chrome !== 'undefined' && chrome.runtime?.id) {
        debouncedUpdate();
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['type', 'name', 'id', 'placeholder', 'class'],
    });

    this.isObserving = true;
    this.lastUrl = location.href;

    this.urlCheckInterval = window.setInterval(() => {
      if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
        this.stop();
        return;
      }
      if (location.href !== this.lastUrl) {
        this.handleSpaNavigation();
      }
    }, 3000);

    window.addEventListener('popstate', this.handleSpaNavigation);
    window.addEventListener('beforeunload', this.handleUnload);

    log.debug('DOM observer started');
  }

  private handleUnload = (): void => {
    this.stop();
  };

  private handleSpaNavigation = (): void => {
    if (location.href === this.lastUrl) return;
    this.lastUrl = location.href;
    log.debug('SPA navigation detected, restarting observer');
    this.restart();
  };

  stop(): void {
    if (this.debouncedHandler) {
      this.debouncedHandler.cancel();
      this.debouncedHandler = null;
    }

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    if (this.urlCheckInterval) {
      clearInterval(this.urlCheckInterval);
      this.urlCheckInterval = null;
    }
    window.removeEventListener('popstate', this.handleSpaNavigation);
    window.removeEventListener('beforeunload', this.handleUnload);

    this.isObserving = false;
    log.info('DOM observer stopped');
  }

  restart(): void {
    this.stop();
    this.start();
  }
}

// ─────────────────────────────────────────────────────────────
//  §8  F I E L D   D I A G N O S T I C S   H A R V E S T E R
// ─────────────────────────────────────────────────────────────

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);
      return successful;
    } catch {
      document.body.removeChild(textarea);
      return false;
    }
  }
}

export async function collectFieldDiagnostics(): Promise<void> {
  try {
    const jsonl = harvestPageJsonl();
    if (!jsonl) {
      pageStatus.error('No fillable fields found to harvest.', 2500);
      return;
    }

    const fieldCount = jsonl.split('\n').filter(Boolean).length;
    if (fieldCount === 0) {
      pageStatus.error('No fillable fields found to harvest.', 2500);
      return;
    }

    const copied = await copyToClipboard(jsonl);
    if (copied) {
      pageStatus.success(`Captured ${fieldCount} field diagnostics. Copied to clipboard.`, 3000);
    } else {
      pageStatus.error('Failed to copy field diagnostics.', 3000);
    }
  } catch (err) {
    log.error('Field diagnostic collection failed', err);
    pageStatus.error('Error collecting field diagnostics', 3000);
  }
}

// ─── UltraDetector & ContextEngine ────────────────────────────────────

export interface FieldCandidate {
  element: HTMLInputElement | HTMLTextAreaElement;
  selector: string;
  fieldType: FieldType;
  confidence: number;
  signals: string[];
  decision: 'FILL' | 'ABSTAIN' | 'BLOCK';
  groupId?: string;
  groupIndex?: number;
  groupSize?: number;
}

export interface DetectionResult {
  verdict: 'login' | 'signup' | 'verification' | '2fa' | 'password-reset' | 'default';
  confidence: number;
  candidates: FieldCandidate[];
}

export class UltraDetector {
  private intelligence: IntelligenceCore;

  constructor(intelligence = new IntelligenceCore()) {
    this.intelligence = intelligence;
  }

  private getUniqueSelector(el: HTMLElement): string {
    if (el.id) {
      return '#' + CSS.escape(el.id);
    }
    const nameAttr = el.getAttribute('name');
    if (nameAttr) {
      return `${el.tagName.toLowerCase()}[name="${CSS.escape(nameAttr)}"]`;
    }
    const testid = el.getAttribute('data-testid');
    if (testid) {
      return `[data-testid="${CSS.escape(testid)}"]`;
    }
    const cy = el.getAttribute('data-cy');
    if (cy) {
      return `[data-cy="${CSS.escape(cy)}"]`;
    }

    if (el.className) {
      const classes = el.className.split(/\s+/).filter(c => c && !c.includes(':')).map(c => '.' + CSS.escape(c)).join('');
      if (classes) {
        try {
          if (document.querySelectorAll(classes).length === 1) {
            return classes;
          }
        } catch {}
      }
    }

    try {
      const path: string[] = [];
      let curr: HTMLElement | null = el;
      while (curr && curr !== document.body && curr.parentElement) {
        const index = Array.from(curr.parentElement.children).indexOf(curr) + 1;
        path.unshift(`${curr.tagName.toLowerCase()}:nth-child(${index})`);
        curr = curr.parentElement;
      }
      return path.join(' > ');
    } catch {
      return el.tagName.toLowerCase();
    }
  }

  async detect(): Promise<DetectionResult> {
    const inputs = deepQuerySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
      .filter((el: HTMLInputElement | HTMLTextAreaElement) => !el.disabled && !el.readOnly);

    const candidates: FieldCandidate[] = [];

    // 1. Classify all inputs
    for (const input of inputs) {
      try {
        const record = extractFieldRecord(input);
        const calibrated = this.intelligence.classify(record);
        const selector = this.getUniqueSelector(input);

        candidates.push({
          element: input,
          selector,
          fieldType: calibrated.fieldType,
          confidence: calibrated.confidence,
          signals: calibrated.signals,
          decision: calibrated.decision,
        });
      } catch (e) {
        log.warn('Failed to extract or classify element', e);
      }
    }

    // 2. Detect split-digit OTP groups
    this.detectSplitDigitGroups(candidates);

    // 3. Determine Page Verdict
    const verdict = this.determinePageVerdict(candidates);

    return {
      verdict,
      confidence: this.calculatePageConfidence(candidates, verdict),
      candidates,
    };
  }

  private detectSplitDigitGroups(candidates: FieldCandidate[]): void {
    const singleDigitCandidates = candidates.filter((c) => {
      const el = c.element as HTMLInputElement;
      const rect = el.getBoundingClientRect();
      return (
        el.maxLength === 1 ||
        el.getAttribute('maxlength') === '1' ||
        rect.width <= 85
      );
    });

    if (singleDigitCandidates.length < 4) return;

    // Group single-digit inputs by common ancestor up to 3 levels deep
    const groupsByAncestor = new Map<HTMLElement, FieldCandidate[]>();
    for (const c of singleDigitCandidates) {
      let ancestor: HTMLElement | null = c.element.parentElement;
      let depth = 0;
      while (ancestor && depth < 3 && ancestor !== document.body) {
        let count = 0;
        for (const other of singleDigitCandidates) {
          if (ancestor.contains(other.element)) {
            count++;
          }
        }
        if (count >= 4 && count <= 8) {
          let list = groupsByAncestor.get(ancestor);
          if (!list) {
            list = [];
            groupsByAncestor.set(ancestor, list);
          }
          if (!list.includes(c)) {
            list.push(c);
          }
          break; // Found the lowest ancestor wrapping at least 4 digits
        }
        ancestor = ancestor.parentElement;
        depth++;
      }
    }

    let groupCounter = 1;
    for (const [ancestor, list] of groupsByAncestor.entries()) {
      if (list.length >= 4 && list.length <= 8) {
        // Sort by DOM left coordinate
        const sorted = list.sort((a, b) => {
          const rectA = a.element.getBoundingClientRect();
          const rectB = b.element.getBoundingClientRect();
          return rectA.left - rectB.left;
        });

        const groupId = `otp-group-${groupCounter++}`;
        sorted.forEach((c, idx) => {
          c.fieldType = 'otp';
          c.groupId = groupId;
          c.groupIndex = idx;
          c.groupSize = sorted.length;
          c.decision = 'FILL';
          c.confidence = 0.99; // Highly confident since it is a structured OTP group
        });
      }
    }
  }

  private determinePageVerdict(candidates: FieldCandidate[]): DetectionResult['verdict'] {
    let emailCount = 0;
    let passwordCount = 0;
    let confirmPasswordCount = 0;
    let otpCount = 0;

    for (const c of candidates) {
      if (c.decision === 'BLOCK' || c.decision === 'ABSTAIN') continue;
      if (c.fieldType === 'email') emailCount++;
      if (c.fieldType === 'password') passwordCount++;
      if (c.fieldType === 'confirm-password') confirmPasswordCount++;
      if (c.fieldType === 'otp') otpCount++;
    }

    if (otpCount > 0) {
      return otpCount > 1 || candidates.some((c) => c.groupId) ? '2fa' : 'verification';
    }
    if (confirmPasswordCount > 0) {
      return 'signup';
    }
    if (passwordCount > 0) {
      return emailCount > 0 ? 'login' : 'password-reset';
    }
    return 'default';
  }

  private calculatePageConfidence(candidates: FieldCandidate[], verdict: DetectionResult['verdict']): number {
    if (verdict === 'default') return 0.5;
    const relevant = candidates.filter((c) => {
      if (verdict === '2fa' || verdict === 'verification') return c.fieldType === 'otp';
      if (verdict === 'signup') return c.fieldType === 'confirm-password' || c.fieldType === 'password' || c.fieldType === 'email';
      if (verdict === 'login') return c.fieldType === 'password' || c.fieldType === 'email';
      return false;
    });

    if (relevant.length === 0) return 0.5;
    const sum = relevant.reduce((acc, c) => acc + c.confidence, 0);
    return sum / relevant.length;
  }
}

export class ContextEngine {
  private detector: UltraDetector;
  private candidates: FieldCandidate[] = [];
  private lastChecked = 0;
  private observer: MutationObserver | null = null;
  private callbacks: Array<(candidates: FieldCandidate[]) => void> = [];
  private debounceTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(detector = new UltraDetector()) {
    this.detector = detector;
  }

  private lastScanFingerprint = '';

  async init(): Promise<void> {
    await this.scan();

    // Start MutationObserver for incremental DOM updates including attributes
    this.observer = new MutationObserver((mutations) => {
      let shouldRescan = false;
      for (const m of mutations) {
        if (m.addedNodes.length > 0 || m.removedNodes.length > 0 || m.type === 'attributes') {
          shouldRescan = true;
          break;
        }
      }

      if (shouldRescan) {
        this.triggerDebouncedScan();
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['type', 'style', 'class', 'hidden', 'disabled', 'readonly'],
    });

    window.addEventListener('popstate', this.handleNavigation);
  }

  private handleNavigation = (): void => {
    this.triggerDebouncedScan();
  };

  getCandidates(): FieldCandidate[] {
    return this.candidates;
  }

  subscribe(callback: (candidates: FieldCandidate[]) => void): () => void {
    this.callbacks.push(callback);
    return () => {
      this.callbacks = this.callbacks.filter((cb) => cb !== callback);
    };
  }

  private getDOMFingerprint(): string {
    try {
      const inputs = Array.from(document.querySelectorAll('input, textarea'));
      return inputs.map(i => `${i.tagName}:${i.id}:${i.className}:${(i as any).disabled}:${(i as any).readOnly}:${(i as any).type}`).join(';');
    } catch {
      return '';
    }
  }

  async scan(): Promise<void> {
    try {
      const currentFingerprint = this.getDOMFingerprint();
      if (currentFingerprint === this.lastScanFingerprint) {
        return;
      }
      this.lastScanFingerprint = currentFingerprint;

      const result = await this.detector.detect();
      this.candidates = result.candidates;
      this.lastChecked = Date.now();
      this.notifySubscribers();
    } catch (e) {
      log.warn('Incremental scan failed', e);
    }
  }

  destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
    }
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }
    window.removeEventListener('popstate', this.handleNavigation);
  }

  private triggerDebouncedScan(): void {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }
    this.debounceTimeout = setTimeout(async () => {
      await this.scan();
    }, 250); // 250ms debounce
  }

  private notifySubscribers(): void {
    for (const callback of this.callbacks) {
      try {
        callback(this.candidates);
      } catch (e) {
        log.warn('Subscriber callback failed', e);
      }
    }
  }
}

