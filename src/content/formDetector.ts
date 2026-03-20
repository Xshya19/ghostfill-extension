// ═══════════════════════════════════════════════════════════════════════════════
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  🔍  G H O S T F I L L   —   F O R M   D E T E C T O R   v 2       ║
// ║  Detect · Classify · Query — Full-page form intelligence engine      ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// Architecture:
// ┌────────────────────────────────────────────────────────────────────────┐
// │  FormClassifier    — Score-based form type classification             │
// │  SubmitFinder      — Multi-strategy submit button discovery           │
// │  DOMTraversal      — Shadow-DOM-piercing query engine                 │
// │  FormDetector      — Public API: detect, query, highlight             │
// └────────────────────────────────────────────────────────────────────────┘
// ═══════════════════════════════════════════════════════════════════════════════

import {
  FormType,
  FieldType,
  DetectedForm,
  DetectedField,
  FormAnalysis,
  FORM_INDICATORS,
} from '../types';
import { getUniqueSelector, deepQuerySelectorAll } from '../utils/helpers';
import { createLogger } from '../utils/logger';
import { FieldAnalyzer } from './fieldAnalyzer';

const log = createLogger('FormDetector');

// ═══════════════════════════════════════════════════════════════
//  §0  C O N S T A N T S
// ═══════════════════════════════════════════════════════════════

/** Maximum characters of form textContent to scan for classification */
const FORM_TEXT_SCAN_LIMIT = 500;

/** Minimum field confidence to include in form analysis */
const MIN_FIELD_CONFIDENCE = 0;

/** Minimum standalone field confidence to include */
const MIN_STANDALONE_CONFIDENCE = 0.3;

/** Highlight duration in milliseconds */
const HIGHLIGHT_DURATION_MS = 2000;

/** Highlight styling */
const HIGHLIGHT_OUTLINE = '2px solid #6366F1';
const HIGHLIGHT_BOX_SHADOW = '0 0 10px rgba(99, 102, 241, 0.5)';

/** Maximum shadow DOM recursion depth */
const MAX_SHADOW_DEPTH = 10;

/** Maximum elements to scan for shadow roots */
const MAX_SHADOW_SCAN_ELEMENTS = 5000;

/** Classification confidence weights */
const CLASSIFICATION_WEIGHTS = {
  REQUIRED_FIELDS: 0.4,
  PATTERN_MATCH: 0.4,
  LOGIN_BONUS: 0.2,
  SIGNUP_BONUS: 0.2,
  TWO_FACTOR_BONUS: 0.3,
} as const;

// ═══════════════════════════════════════════════════════════════
//  §1  T Y P E S
// ═══════════════════════════════════════════════════════════════

type FormInputElement = HTMLInputElement | HTMLTextAreaElement;
type SubmitElement = HTMLButtonElement | HTMLInputElement;

interface ClassificationResult {
  readonly type: FormType;
  readonly confidence: number;
}

// ═══════════════════════════════════════════════════════════════
//  §2  U T I L I T I E S
// ═══════════════════════════════════════════════════════════════

function clampConfidence(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// ═══════════════════════════════════════════════════════════════
//  §3  D O M   T R A V E R S A L
// ═══════════════════════════════════════════════════════════════

// (Removed duplicate DOMTraversal class)
// ═══════════════════════════════════════════════════════════════

class FormClassifier {
  private static readonly SUBMIT_TEXT_PATTERN =
    /submit|login|log\s*in|sign\s*in|sign\s*up|register|continue|next|verify|confirm|create|send|go|done/i;

  static classify(
    form: HTMLElement,
    fields: DetectedField[]
  ): ClassificationResult {
    const fieldTypes = new Set(fields.map((f) => f.fieldType));
    let bestType: FormType = 'unknown';
    let bestConfidence = 0;

    const formText = this.buildFormContext(form);

    for (const [fType, indicators] of Object.entries(FORM_INDICATORS)) {
      if (fType === 'unknown') {continue;}

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

    if (form.className && typeof form.className === 'string') {parts.push(form.className);}
    if (form.id) {parts.push(form.id);}
    if (form instanceof HTMLFormElement && form.action) {parts.push(form.action);}

    const textContent = form.textContent;
    if (textContent) {
      if (form === document.body) {
        parts.push(document.title);
        // Virtual form bodies are huge, capture more context to find the 'Sign up' headers
        parts.push(textContent.substring(0, 5000));
      } else {
        parts.push(textContent.substring(0, FORM_TEXT_SCAN_LIMIT));
      }
    }

    return parts.join(' ').toLowerCase();
  }

  private static calculateFieldBonus(
    formType: string,
    fieldTypes: Set<FieldType>
  ): number {
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

  /**
   * Attempt to find the submit button for a given form element (virtual or real).
   */
  static findSubmitButton(form: HTMLElement): SubmitElement | null {
    // 1. Explicit form submit buttons if it's a real form
    if (form instanceof HTMLFormElement) {
      const explicitSubmit = form.querySelector<SubmitElement>(
        'button[type="submit"], input[type="submit"]'
      );
      if (explicitSubmit && VisibilityCheck.isVisible(explicitSubmit)) {
        return explicitSubmit;
      }
    }

    // 2. Generic buttons that look like submit buttons by text
    const buttons = form.querySelectorAll<HTMLButtonElement>('button');
    for (const button of buttons) {
      const text = (button.textContent ?? '').trim();
      if (text.length > 0 && this.SUBMIT_TEXT_PATTERN.test(text)) {
        return button;
      }
    }

    const roleButtons = form.querySelectorAll<HTMLElement>('[role="button"]');
    for (const el of roleButtons) {
      if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) {
        const text = (el.textContent ?? '').trim();
        if (text.length > 0 && this.SUBMIT_TEXT_PATTERN.test(text)) {
          return el;
        }
      }
    }

    return form.querySelector<HTMLButtonElement>('button') ?? null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  §5  V I S I B I L I T Y   C H E C K
// ═══════════════════════════════════════════════════════════════

class VisibilityCheck {
  static isVisible(element: HTMLElement): boolean {
    if (!element.isConnected) {return false;}

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {return false;}

    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }
}

// ═══════════════════════════════════════════════════════════════
//  §6  M A I N   F O R M   D E T E C T O R
// ═══════════════════════════════════════════════════════════════

export class FormDetector {
  private lastAnalysis: FormAnalysis | null = null;
  private readonly fieldAnalyzer: FieldAnalyzer;

  private static readonly INPUT_SELECTOR =
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="image"]):not([type="range"]):not([type="color"]), textarea';

  constructor(fieldAnalyzer: FieldAnalyzer) {
    this.fieldAnalyzer = fieldAnalyzer;
  }

  /**
   * Detect and classify all forms and standalone fields on the page.
   * Pierces shadow DOMs to find forms in web components.
   */
  detectForms(): FormAnalysis {
    const forms = this.detectAllForms();
    let standaloneFields = this.detectStandaloneFields(forms);

    // VIRTUAL FORMS: Group remaining standalone fields that share a parent container
    const virtualForms = this.detectVirtualForms(standaloneFields);
    for (const vForm of virtualForms) {
      forms.push(vForm);
      const vFormFields = new Set(vForm.fields.map(f => f.element));
      standaloneFields = standaloneFields.filter(sf => !vFormFields.has(sf.element));
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

  /**
   * Analyze a single form element (or virtual form container) and return its classification.
   */
  analyzeForm(form: HTMLElement): DetectedForm {
    const inputs = form.querySelectorAll<FormInputElement>(
      FormDetector.INPUT_SELECTOR
    );

    const fields: DetectedField[] = [];

    for (const input of inputs) {
      if (!VisibilityCheck.isVisible(input)) {continue;}

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

  /**
   * Classify a form based on its fields and contextual signals.
   */
  classifyForm(
    form: HTMLElement,
    fields: DetectedField[]
  ): ClassificationResult {
    return FormClassifier.classify(form, fields);
  }

  /**
   * Find the submit button within a form/container.
   */
  findSubmitButton(form: HTMLElement): SubmitElement | null {
    return FormClassifier.findSubmitButton(form);
  }

  /**
   * Get the cached analysis result. Returns null if detectForms()
   * has not been called yet.
   */
  getLastAnalysis(): FormAnalysis | null {
    return this.lastAnalysis;
  }

  /**
   * Find fields of a specific type.
   */
  findFieldsByType(type: FieldType): DetectedField[] {
    if (!this.lastAnalysis) {
      this.detectForms();
    }

    const analysis = this.lastAnalysis;
    if (!analysis) {return [];}

    const fields: DetectedField[] = [];

    for (const form of analysis.forms) {
      for (const field of form.fields) {
        if (field.fieldType === type) {
          fields.push(field);
        }
      }
    }

    for (const field of analysis.standaloneFields) {
      if (field.fieldType === type) {
        fields.push(field);
      }
    }

    return fields;
  }

  /**
   * Highlight fields for debugging/visual feedback.
   */
  highlightFields(type: string): void {
    const fields = this.findFieldsByType(type as FieldType);

    for (const field of fields) {
      const element = field.element;
      if (!element.isConnected) {continue;}

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

  /**
   * Get form containing focused element.
   */
  getActiveForm(): DetectedForm | null {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) {return null;}

    const form = activeElement.closest('form');
    if (!form) {return null;}

    return this.lastAnalysis?.forms.find((f) => f.element === form) ?? null;
  }

  /**
   * Get field for focused element.
   */
  getActiveField(): DetectedField | null {
    const activeElement = document.activeElement;
    if (
      !(activeElement instanceof HTMLInputElement) &&
      !(activeElement instanceof HTMLTextAreaElement)
    ) {
      return null;
    }

    const analysis = this.lastAnalysis;
    if (!analysis) {return null;}

    for (const form of analysis.forms) {
      const field = form.fields.find((f) => f.element === activeElement);
      if (field) {return field;}
    }

    return analysis.standaloneFields.find((f) => f.element === activeElement) ?? null;
  }

  invalidateCache(): void {
    this.lastAnalysis = null;
  }

  /**
   * Detect and analyze all <form> elements on the page, piercing shadow DOMs.
   */
  private detectAllForms(): DetectedForm[] {
    const formElements = deepQuerySelectorAll<HTMLFormElement>('form');
    const forms: DetectedForm[] = [];

    for (const form of formElements) {
      const detectedForm = this.analyzeForm(form);
      if (detectedForm.fields.length > 0) {
        forms.push(detectedForm);
      }
    }

    return forms;
  }

  /**
   * Group standalone fields into virtual forms if they belong together logically (e.g. SPAs without <form> tags).
   */
  private detectVirtualForms(standaloneFields: DetectedField[]): DetectedForm[] {
    if (standaloneFields.length === 0) return [];
    
    const virtualForms: DetectedForm[] = [];
    
    // Group fields by their closest common ancestor up to 5 levels deep
    // For simplicity, we can also just treat all standalone fields under a common 'div' or 'section' as a form
    
    // Let's create a map to cluster fields. 
    // An easy heuristic is to group fields if they look like a login or signup together.
    // If they share a common ancestor that is not the document body (e.g., a specific container div).
    
    const maxDepth = 6;
    const containers = new Map<HTMLElement, DetectedField[]>();
    
    for (const field of standaloneFields) {
      let current = field.element.parentElement;
      let container: HTMLElement | null = null;
      let depth = 0;
      
      while (current && current !== document.body && depth < maxDepth) {
        // If it looks like a form container or has a bounding rect covering the fields
        if (current.tagName === 'DIV' || current.tagName === 'SECTION' || current.tagName === 'MAIN') {
           // We might just use the deepest container that holds multiple fields
        }
        current = current.parentElement;
        depth++;
      }
    }

    // ACTUALLY, an easier approach for Virtual Forms is to just lump all standalone fields pointing to a 'signup' or 'login' form into one huge virtual form, or cluster them by their bounding client rects.
    
    // Let's group all standalone fields that are within the same general area, or simply fall back to grouping ALL of them into one body-level virtual form if we detect login/signup signals.
    
    if (standaloneFields.length > 0) {
      // Create a virtual container (document.body works as a fallback)
      const container = document.body;
      const classification = FormClassifier.classify(container, standaloneFields);
      
      // Only create a virtual form if we are fairly confident it is a recognizable form type
      // It prevents us from grouping unrelated random search bars and newsletters together
      if (classification.type !== 'unknown' && classification.confidence >= 0.4) {
         const submitButton = FormClassifier.findSubmitButton(container);
         virtualForms.push({
           element: container,
           selector: 'body', // representing the virtual nature
           formType: classification.type,
           confidence: classification.confidence,
           fields: standaloneFields,
           submitButton: submitButton ?? undefined,
           actionUrl: undefined,
         });
      }
    }
    
    return virtualForms;
  }

  /**
   * Find standalone fields (fields NOT inside any discovered form).
   */
  private detectStandaloneFields(forms: DetectedForm[]): DetectedField[] {
    // This correctly invokes FieldAnalyzer's shadow-piercing extraction!
    const allFields = this.fieldAnalyzer.getAllFields();
    
    const formFieldElements = new Set<Element>();
    for (const form of forms) {
      for (const field of form.fields) {
        formFieldElements.add(field.element);
      }
    }

    const standaloneFields: DetectedField[] = [];

    for (const field of allFields) {
      if (formFieldElements.has(field.element)) {continue;}

      if (field.confidence > MIN_STANDALONE_CONFIDENCE) {
        standaloneFields.push(field);
      }
    }

    return standaloneFields;
  }
}