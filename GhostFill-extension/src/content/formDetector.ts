// Form Detector v2 - Detect and classify forms on the page

import {
    FormType,
    FieldType,
    DetectedForm,
    DetectedField,
    FormAnalysis,
    FORM_INDICATORS,
} from '../types';
import { getUniqueSelector } from '../utils/helpers';
import { createLogger } from '../utils/logger';
import { FieldAnalyzer } from './fieldAnalyzer';

const log = createLogger('FormDetector');

export class FormDetector {
    private lastAnalysis: FormAnalysis | null = null;

    constructor(private fieldAnalyzer: FieldAnalyzer) { }

    /**
     * Detect all forms on the page
     */
    detectForms(): FormAnalysis {
        const forms: DetectedForm[] = [];
        const standaloneFields: DetectedField[] = [];

        // Find all form elements
        const formElements = document.querySelectorAll('form');

        formElements.forEach((form) => {
            const detectedForm = this.analyzeForm(form);
            if (detectedForm.fields.length > 0) {
                forms.push(detectedForm);
            }
        });

        // Find standalone fields (not in forms)
        const allFields = this.fieldAnalyzer.getAllFields();

        allFields.forEach((field) => {
            const inForm = forms.some((form) =>
                form.fields.some((f) => f.selector === field.selector)
            );

            if (!inForm && field.confidence > 0.3) {
                standaloneFields.push(field);
            }
        });

        this.lastAnalysis = {
            forms,
            standaloneFields,
            timestamp: Date.now(),
        };

        log.debug('Form detection complete', {
            forms: forms.length,
            standaloneFields: standaloneFields.length,
        });

        return this.lastAnalysis;
    }

    /**
     * Analyze a single form
     */
    analyzeForm(form: HTMLFormElement): DetectedForm {
        const inputs = form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
            'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), textarea'
        );

        const fields: DetectedField[] = [];

        inputs.forEach((input) => {
            const field = this.fieldAnalyzer.analyzeField(input);
            if (field.confidence > 0) {
                fields.push(field);
            }
        });

        const formType = this.classifyForm(form, fields);
        const submitButton = this.findSubmitButton(form);

        return {
            element: form,
            selector: getUniqueSelector(form),
            formType: formType.type,
            confidence: formType.confidence,
            fields,
            submitButton: submitButton || undefined,
            actionUrl: form.action || undefined,
        };
    }

    /**
     * Classify form type based on fields and context
     */
    classifyForm(
        form: HTMLFormElement,
        fields: DetectedField[]
    ): { type: FormType; confidence: number } {
        const fieldTypes = new Set(fields.map((f) => f.fieldType));
        let bestMatch: FormType = 'unknown';
        let bestConfidence = 0;

        // Get form context
        const formText = [
            form.className,
            form.id,
            form.action,
            form.textContent?.substring(0, 500),
        ].join(' ').toLowerCase();

        // Check each form type
        for (const [fType, indicators] of Object.entries(FORM_INDICATORS)) {
            if (fType === 'unknown') {continue;}

            let confidence = 0;

            // Check required fields
            const hasRequiredFields = indicators.requiredFields.every((rf) =>
                fieldTypes.has(rf as FieldType)
            );

            if (hasRequiredFields) {
                confidence += 0.4;
            }

            // Check patterns in form context
            const patternMatch = indicators.patterns.some((p) => p.test(formText));
            if (patternMatch) {
                confidence += 0.4;
            }

            // Bonus for specific field combinations
            if (fType === 'login' && fieldTypes.has('password') && !fieldTypes.has('confirm-password')) {
                confidence += 0.2;
            }

            if (fType === 'signup' && fieldTypes.has('confirm-password')) {
                confidence += 0.2;
            }

            if (fType === 'two-factor' && fieldTypes.has('otp')) {
                confidence += 0.3;
            }

            if (confidence > bestConfidence) {
                bestConfidence = confidence;
                bestMatch = fType as FormType;
            }
        }

        return { type: bestMatch, confidence: Math.min(1, bestConfidence) };
    }

    /**
     * Find the submit button in a form
     */
    findSubmitButton(form: HTMLFormElement): HTMLButtonElement | HTMLInputElement | null {
        // Look for explicit submit buttons
        const submitInput = form.querySelector<HTMLInputElement>('input[type="submit"]');
        if (submitInput) {return submitInput;}

        const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]');
        if (submitButton) {return submitButton;}

        // Look for buttons that might be submits
        const buttons = form.querySelectorAll<HTMLButtonElement>('button');
        for (const button of buttons) {
            const text = button.textContent?.toLowerCase() || '';
            if (/submit|login|sign|register|continue|next|verify/i.test(text)) {
                return button;
            }
        }

        // Look for any button
        const firstButton = form.querySelector<HTMLButtonElement>('button');
        return firstButton;
    }

    /**
     * Get the last analysis result
     */
    getLastAnalysis(): FormAnalysis | null {
        return this.lastAnalysis;
    }

    /**
     * Find fields of a specific type
     */
    findFieldsByType(type: FieldType): DetectedField[] {
        if (!this.lastAnalysis) {
            this.detectForms();
        }

        const fields: DetectedField[] = [];

        this.lastAnalysis?.forms.forEach((form) => {
            form.fields.forEach((field) => {
                if (field.fieldType === type) {
                    fields.push(field);
                }
            });
        });

        this.lastAnalysis?.standaloneFields.forEach((field) => {
            if (field.fieldType === type) {
                fields.push(field);
            }
        });

        return fields;
    }

    /**
     * Highlight fields of a specific type
     */
    highlightFields(type: string): void {
        const fields = this.findFieldsByType(type as FieldType);

        fields.forEach((field) => {
            const element = field.element;
            const originalOutline = element.style.outline;
            const originalBoxShadow = element.style.boxShadow;

            element.style.outline = '2px solid #6366F1';
            element.style.boxShadow = '0 0 10px rgba(99, 102, 241, 0.5)';

            setTimeout(() => {
                element.style.outline = originalOutline;
                element.style.boxShadow = originalBoxShadow;
            }, 2000);
        });
    }

    /**
     * Get form containing the currently focused element
     */
    getActiveForm(): DetectedForm | null {
        const activeElement = document.activeElement;
        if (!activeElement || !(activeElement instanceof HTMLElement)) {
            return null;
        }

        const form = activeElement.closest('form');
        if (!form) {return null;}

        return this.lastAnalysis?.forms.find((f) => f.element === form) || null;
    }

    /**
     * Get the field for the currently focused element
     */
    getActiveField(): DetectedField | null {
        const activeElement = document.activeElement;
        if (
            !activeElement ||
            !(activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement)
        ) {
            return null;
        }

        // Check forms
        for (const form of this.lastAnalysis?.forms || []) {
            const field = form.fields.find((f) => f.element === activeElement);
            if (field) {return field;}
        }

        // Check standalone
        return (
            this.lastAnalysis?.standaloneFields.find((f) => f.element === activeElement) || null
        );
    }
}
