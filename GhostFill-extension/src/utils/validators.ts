// Input Validators

import { PasswordOptions } from '../types';

/**
 * Validate email format
 */
export function validateEmail(email: string): { valid: boolean; error?: string } {
    if (!email) {
        return { valid: false, error: 'Email is required' };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return { valid: false, error: 'Invalid email format' };
    }

    return { valid: true };
}

/**
 * Validate password options
 */
export function validatePasswordOptions(options: PasswordOptions): { valid: boolean; error?: string } {
    if (options.length < 4) {
        return { valid: false, error: 'Password length must be at least 4' };
    }

    if (options.length > 128) {
        return { valid: false, error: 'Password length cannot exceed 128' };
    }

    if (!options.uppercase && !options.lowercase && !options.numbers && !options.symbols) {
        return { valid: false, error: 'At least one character type must be selected' };
    }

    // Check minimum requirements
    const totalMinRequired =
        (options.minUppercase || 0) +
        (options.minLowercase || 0) +
        (options.minNumbers || 0) +
        (options.minSymbols || 0);

    if (totalMinRequired > options.length) {
        return { valid: false, error: 'Minimum character requirements exceed password length' };
    }

    return { valid: true };
}

/**
 * Validate URL format
 */
export function validateUrl(url: string): { valid: boolean; error?: string } {
    if (!url) {
        return { valid: false, error: 'URL is required' };
    }

    try {
        new URL(url);
        return { valid: true };
    } catch {
        return { valid: false, error: 'Invalid URL format' };
    }
}

/**
 * Validate OTP format
 */
export function validateOTP(otp: string): { valid: boolean; error?: string } {
    if (!otp) {
        return { valid: false, error: 'OTP is required' };
    }

    // OTPs are typically 4-8 digits or 6-10 alphanumeric characters
    const numericRegex = /^\d{4,8}$/;
    const alphanumericRegex = /^[A-Z0-9]{4,10}$/i;

    if (!numericRegex.test(otp) && !alphanumericRegex.test(otp)) {
        return { valid: false, error: 'Invalid OTP format' };
    }

    return { valid: true };
}

/**
 * Validate domain
 */
export function validateDomain(domain: string): { valid: boolean; error?: string } {
    if (!domain) {
        return { valid: false, error: 'Domain is required' };
    }

    const domainRegex = /^[a-z0-9]+([-.]{1}[a-z0-9]+)*\.[a-z]{2,}$/i;
    if (!domainRegex.test(domain)) {
        return { valid: false, error: 'Invalid domain format' };
    }

    return { valid: true };
}

/**
 * Sanitize string input
 */
export function sanitizeString(input: string, maxLength: number = 1000): string {
    if (!input) {return '';}

    return input
        .trim()
        .substring(0, maxLength)
        .replace(/[<>]/g, ''); // Basic XSS prevention
}

/**
 * Sanitize HTML content
 */
export function sanitizeHtml(html: string): string {
    const div = document.createElement('div');
    div.innerHTML = html;

    // Remove script tags
    const scripts = div.querySelectorAll('script');
    scripts.forEach((script) => script.remove());

    // Remove event handlers
    const allElements = div.querySelectorAll('*');
    allElements.forEach((el) => {
        const attributes = el.attributes;
        for (let i = attributes.length - 1; i >= 0; i--) {
            const attr = attributes[i];
            if (attr.name.startsWith('on')) {
                el.removeAttribute(attr.name);
            }
        }
    });

    return div.innerHTML;
}

/**
 * Check if string contains only safe characters
 */
export function isSafeString(str: string): boolean {
    // Allow alphanumeric, common punctuation, and whitespace
    const safeRegex = /^[\w\s.,!?@#$%^&*()[\]{}|;:'"-+=<>/\\~`]+$/;
    return safeRegex.test(str);
}
