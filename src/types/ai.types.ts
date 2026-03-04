// AI Feature Types

import { FormType, FieldType } from './form.types';

export interface ClassificationResult<T> {
    type: T;
    confidence: number;
    alternatives: Array<{ type: T; confidence: number }>;
}

export interface FormClassification extends ClassificationResult<FormType> {
    features: FormFeatures;
}

export interface FieldClassification extends ClassificationResult<FieldType> {
    features: FieldFeatures;
}

export interface FormFeatures {
    fieldCount: number;
    fieldTypes: FieldType[];
    hasPassword: boolean;
    hasEmail: boolean;
    hasOTP: boolean;
    hasSubmitButton: boolean;
    formAction?: string;
    formMethod?: string;
    buttonText?: string;
    formTitle?: string;
    pageTitle?: string;
    pageUrl?: string;
}

export interface FieldFeatures {
    type: string;
    name?: string;
    id?: string;
    placeholder?: string;
    label?: string;
    autocomplete?: string;
    maxLength?: number;
    minLength?: number;
    pattern?: string;
    required: boolean;
    ariaLabel?: string;
    nearbyText?: string[];
}

export interface Suggestion {
    id: string;
    type: 'email' | 'password' | 'otp' | 'autofill' | 'warning' | 'tip';
    title: string;
    description: string;
    action: SuggestionAction;
    priority: number;
    dismissable: boolean;
    expiresAt?: number;
}

export interface SuggestionAction {
    type: 'generate-email' | 'generate-password' | 'fill-otp' | 'autofill' | 'open-popup' | 'navigate';
    payload?: Record<string, unknown>;
}

export interface UserBehavior {
    preferredPasswordLength: number;
    preferredSymbols: boolean;
    commonSites: string[];
    peakUsageHours: number[];
    averageSessionDuration: number;
    mostUsedFeatures: string[];
}

export interface PatternMatch {
    pattern: string;
    confidence: number;
    extractedValue: string;
    startIndex: number;
    endIndex: number;
}

export interface OTPPattern {
    regex: RegExp;
    name: string;
    length: number;
    format: 'numeric' | 'alphanumeric' | 'mixed';
    contextRequired: boolean;
    contextPatterns?: RegExp[];
    priority: number;
}

export const OTP_PATTERNS: OTPPattern[] = [
    {
        // Highest priority: explicit OTP-related keyword followed by digits
        regex: /(?:code|otp|pin|verification|confirm|token|password|key)[:\s]*(\d{4,10})/i,
        name: 'standard-with-context',
        length: 6,
        format: 'numeric',
        contextRequired: false,
        priority: 1,
    },
    {
        // Natural language: "your code is 123456"
        regex: /(?:your\s+(?:verification\s+|activation\s+|single-use\s+)?(?:code|otp|pin|password|key)\s+is\s*)(\d{4,10})/i,
        name: 'natural-language',
        length: 6,
        format: 'numeric',
        contextRequired: false,
        priority: 2,
    },
    {
        // Code suffix: "123456 is your code"
        regex: /(\d{4,10})\s*(?:is\s+your|code|verification)/i,
        name: 'code-suffix',
        length: 6,
        format: 'numeric',
        contextRequired: false,
        priority: 3,
    },
    {
        // Spaced digits with context: "1 2 3 4 5 6"
        regex: /\b(\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d?)\b/,
        name: 'spaced-digits',
        length: 6,
        format: 'numeric',
        contextRequired: true,
        contextPatterns: [/code/i, /otp/i, /verify/i, /confirm/i, /token/i],
        priority: 4,
    },
    {
        // Alphanumeric codes (must have both letters and numbers) - supports long verification tokens
        regex: /\b([A-Z0-9]{6,20})\b/,
        name: 'alphanumeric',
        length: 15,
        format: 'alphanumeric',
        contextRequired: true,
        contextPatterns: [/code/i, /token/i, /verify/i, /password/i, /key/i],
        priority: 5,
    },
    {
        // Explicit "verification code: 123456"
        regex: /verification\s+code[:\s]*\b(\d{4,10})\b/i,
        name: 'explicit-context-prefix',
        length: 6,
        format: 'numeric',
        contextRequired: false,
        priority: 6,
    },
    {
        // Standalone digits - ONLY 5-8 digits to avoid matching short numbers
        // 4-digit standalone numbers are too common (years, times, counts)
        regex: /\b(\d{5,8})\b/,
        name: 'standalone-digits',
        length: 6,
        format: 'numeric',
        contextRequired: true,
        contextPatterns: [/code/i, /otp/i, /pin/i, /verify/i, /confirm/i, /token/i, /security/i],
        priority: 7,
    },
];

// Patterns that indicate a number is NOT an OTP (false positives)
export const OTP_BLACKLIST_PATTERNS: RegExp[] = [
    /valid\s+for\s+(\d+)/i,           // "valid for 9762 seconds"
    /expires?\s+in\s+(\d+)/i,         // "expires in 300 seconds"
    /(\d+)\s*(?:seconds?|minutes?|hours?|days?)/i,  // "9762 seconds"
    /(?:at|@)\s*(\d{4})\b/i,          // "at 1430" (time)
    /(\d{4})-(\d{2})-(\d{2})/,        // Date pattern 2024-12-25
    /(\d{2})\/(\d{2})\/(\d{4})/,      // Date pattern 12/25/2024
    /\$\s*(\d+)/,                     // Dollar amounts
    /(\d+)\s*\$/,                     // Dollar amounts
    /version\s+(\d+)/i,               // Version numbers
    /v(\d+)/i,                        // Version v123
];

export interface AIConfig {
    formClassificationThreshold: number;
    fieldClassificationThreshold: number;
    otpExtractionThreshold: number;
    suggestionDisplayThreshold: number;
    learningEnabled: boolean;
    maxPatternHistory: number;
}

export const DEFAULT_AI_CONFIG: AIConfig = {
    formClassificationThreshold: 0.7,
    fieldClassificationThreshold: 0.6,
    otpExtractionThreshold: 0.5,
    suggestionDisplayThreshold: 0.7,
    learningEnabled: true,
    maxPatternHistory: 100,
};
