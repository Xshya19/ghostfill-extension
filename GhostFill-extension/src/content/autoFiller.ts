// Auto-Filler - Fill form fields automatically

import { createLogger } from '../utils/logger';
import { GetCurrentEmailResponse, GeneratePasswordResponse, DetectedField } from '../types';
import { safeSendMessage } from '../utils/messaging';

const log = createLogger('AutoFiller');

// Custom element interface for ghost-label
interface GhostLabelElement extends HTMLElement {
    attachToAttribute?: (input: HTMLElement, onClick: () => void) => void;
}

export class AutoFiller {
    /**
     * Fill a specific field by selector
     */
    fillField(selector: string, value: string): boolean {
        try {
            const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
            if (!element) {
                log.warn('Field not found', { selector });
                return false;
            }

            this.setFieldValue(element, value);
            return true;
        } catch (error) {
            log.error('Failed to fill field', error);
            return false;
        }
    }

    /**
     * Fill the currently focused field
     */
    fillCurrentField(value: string, fieldType?: string): boolean {
        const activeElement = document.activeElement;

        if (
            activeElement instanceof HTMLInputElement ||
            activeElement instanceof HTMLTextAreaElement
        ) {
            this.setFieldValue(activeElement, value);
            return true;
        }

        // If no field focused, try to find appropriate field
        if (fieldType) {
            const selector = this.getSelectorForFieldType(fieldType);
            const element = document.querySelector<HTMLInputElement>(selector);
            if (element) {
                this.setFieldValue(element, value);
                return true;
            }
        }

        return false;
    }

    /**
     * Set value on an input element, triggering all necessary events
     */
    private setFieldValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
        // Focus the element
        element.focus();

        // Clear existing value
        element.value = '';

        // Use native input value setter for React compatibility
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value'
        )?.set;

        const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            'value'
        )?.set;

        if (element instanceof HTMLInputElement && nativeInputValueSetter) {
            nativeInputValueSetter.call(element, value);
        } else if (element instanceof HTMLTextAreaElement && nativeTextAreaValueSetter) {
            nativeTextAreaValueSetter.call(element, value);
        } else {
            element.value = value;
        }

        // Trigger events for React and other frameworks
        this.triggerInputEvents(element);

        log.debug('Field filled', { value: value.substring(0, 10) + '...' });
    }

    /**
     * Trigger input events to notify frameworks
     */
    private triggerInputEvents(element: HTMLElement): void {
        // Input event
        element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));

        // Change event
        element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

        // Keyboard events for some frameworks
        element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true }));

        // Blur and focus for validation triggers
        element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
        element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    }

    /**
     * Simulate typing a single character with proper keyboard events
     */
    private typeCharacter(element: HTMLInputElement, char: string): void {
        const keyCode = char.charCodeAt(0);

        // Focus and clear
        element.focus();
        element.value = '';

        // Simulate keydown
        element.dispatchEvent(new KeyboardEvent('keydown', {
            key: char,
            code: `Digit${char}`,
            keyCode: keyCode,
            which: keyCode,
            bubbles: true,
            cancelable: true
        }));

        // Simulate keypress
        element.dispatchEvent(new KeyboardEvent('keypress', {
            key: char,
            code: `Digit${char}`,
            keyCode: keyCode,
            which: keyCode,
            charCode: keyCode,
            bubbles: true,
            cancelable: true
        }));

        // Set value using native setter (for React)
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) {
            nativeSetter.call(element, char);
        } else {
            element.value = char;
        }

        // Trigger input event (React listens to this)
        element.dispatchEvent(new InputEvent('input', {
            data: char,
            inputType: 'insertText',
            bubbles: true,
            cancelable: true
        }));

        // Simulate keyup
        element.dispatchEvent(new KeyboardEvent('keyup', {
            key: char,
            code: `Digit${char}`,
            keyCode: keyCode,
            which: keyCode,
            bubbles: true,
            cancelable: true
        }));

        // Trigger change event
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    /**
     * Helper to wait for a specified time
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Fill OTP across multiple fields with proper timing
     */
    /**
     * Fill OTP across multiple fields with proper timing
     * Handling for: Single fields, Split fields (Notion/Stripe), and invisible fields
     */
    fillOTP(otp: string, fieldSelectors?: string[]): boolean {
        // Ensure we work with digits for the filling logic, but keeping string type for leading zeros
        const digits = otp.replace(/\D/g, '');

        if (fieldSelectors && fieldSelectors.length > 0) {
            // Safely query selectors - AI may return invalid CSS
            const validFields: HTMLInputElement[] = [];
            for (const s of fieldSelectors) {
                try {
                    const el = document.querySelector<HTMLInputElement>(s);
                    if (el) validFields.push(el);
                } catch (e) {
                    log.warn('Invalid selector from AI, skipping:', s);
                }
            }
            if (validFields.length > 0) {
                this.fillOTPWithDelay(digits, validFields);
                return true;
            }
            // Fall through to auto-detect if no valid selectors found
        }

        // Auto-detect OTP fields
        let otpFields = this.findOTPFields();

        if (otpFields.length === 0) {
            log.warn('No OTP fields detected (Silently failing as per UX rules)');
            return false;
        }

        // SPLIT FIELD FIX: 
        // If we found EXACTLY ONE field, but it has maxlength=1 (and we have a code > 1 digit),
        // we are likely looking at the first box of a split input.
        // We need to find its siblings!
        if (otpFields.length === 1 && digits.length > 1) {
            const firstField = otpFields[0];
            if (firstField.maxLength === 1) {
                log.info('Detected single 1-char field for multi-digit code. Attempting sibling discovery...');
                const siblings = this.findSiblingInputs(firstField);
                if (siblings.length >= digits.length) {
                    log.info(`Found ${siblings.length} sibling inputs. Switching to split-fill mode.`);
                    otpFields = siblings;
                }
            }
        }

        // Single field OTP - fill directly
        if (otpFields.length === 1) {
            this.setFieldValue(otpFields[0], otp);
            return true;
        }

        // Multi-field OTP - fill with delays to allow site's auto-tab logic
        this.fillOTPWithDelay(digits, otpFields);
        return true;
    }

    /**
     * Find sibling inputs for split OTP fields
     */
    private findSiblingInputs(field: HTMLInputElement): HTMLInputElement[] {
        const parent = field.parentElement;
        if (!parent) return [field];

        // Look in parent first
        let inputs = Array.from(parent.querySelectorAll('input'));

        // If not enough, try grandparent (common in React wrappers)
        if (inputs.length < 2 && parent.parentElement) {
            inputs = Array.from(parent.parentElement.querySelectorAll('input'));
        }

        // Filter for visible, enabled inputs
        return inputs.filter(input =>
            this.isVisibleElement(input) &&
            !input.disabled &&
            !input.readOnly &&
            (input.type === 'text' || input.type === 'tel' || input.type === 'number' || input.type === 'password')
        );
    }

    /**
     * Fill OTP fields one by one with delays for proper event handling
     */
    private async fillOTPWithDelay(digits: string, fields: HTMLInputElement[]): Promise<void> {
        log.debug('Filling OTP with delays', { digits, fieldCount: fields.length });

        for (let i = 0; i < Math.min(digits.length, fields.length); i++) {
            const field = fields[i];
            const digit = digits[i];

            // Blur previous field if exists
            if (i > 0 && fields[i - 1]) {
                fields[i - 1].dispatchEvent(new FocusEvent('blur', { bubbles: true }));
            }

            // Small delay before typing next digit (allows site JS to process)
            if (i > 0) {
                await this.delay(50);
            }

            // Type the character with full event simulation
            this.typeCharacter(field, digit);

            log.debug(`Filled digit ${i + 1}/${digits.length}`, { digit, fieldIndex: i });
        }

        // Blur the last field to trigger any final validation
        if (fields.length > 0) {
            const lastField = fields[Math.min(digits.length - 1, fields.length - 1)];
            await this.delay(50);
            lastField.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
        }

        log.info('OTP fill complete');
    }

    /**
     * Find OTP input fields on the page - enhanced for multi-box layouts
     */
    private findOTPFields(): HTMLInputElement[] {
        log.info('🔍 SEARCHING FOR OTP FIELDS...');

        // STRATEGY 1: Find explicit single-digit inputs (most common for split OTPs)
        const singleDigitInputs = Array.from(
            document.querySelectorAll<HTMLInputElement>('input[maxlength="1"], input[type="tel"][maxlength="1"], input[type="number"][maxlength="1"]')
        ).filter((input) => this.isVisibleElement(input) && !input.readOnly && !input.disabled);

        log.debug('Strategy 1: Single-digit inputs', { count: singleDigitInputs.length });

        // If we found 4+ consecutive single-digit inputs, these are likely OTP boxes
        if (singleDigitInputs.length >= 4) {
            log.info('✅ Found split OTP boxes (Strategy 1)', { count: singleDigitInputs.length });
            return this.sortByPosition(singleDigitInputs);
        }

        // STRATEGY 2: Find inputs inside OTP containers (by common class names)
        const otpContainerSelectors = [
            '[class*="otp"]', '[class*="OTP"]', '[class*="verification-code"]',
            '[class*="verify-code"]', '[class*="pin-input"]', '[class*="code-input"]',
            '[data-testid*="otp"]', '[data-testid*="code"]',
        ];

        log.debug('Strategy 2: Searching OTP containers', { selectors: otpContainerSelectors });

        for (const containerSelector of otpContainerSelectors) {
            const containers = document.querySelectorAll(containerSelector);
            for (const container of containers) {
                const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input'))
                    .filter((input) => this.isVisibleElement(input) && !input.readOnly && !input.disabled);
                if (inputs.length >= 4) {
                    log.info('✅ Found OTP inputs inside container (Strategy 2)', { selector: containerSelector, count: inputs.length });
                    return this.sortByPosition(inputs);
                }
            }
        }

        // STRATEGY 3: Look for inputs with OTP-related names/IDs
        const otpNameSelectors = [
            'input[autocomplete="one-time-code"]',
            'input[name*="otp"]', 'input[name*="OTP"]',
            'input[name*="code"]', 'input[name*="Code"]',
            'input[name*="verify"]', 'input[name*="pin"]',
            'input[id*="otp"]', 'input[id*="OTP"]',
            'input[id*="code"]', 'input[id*="Code"]',
            'input[id*="digit"]', 'input[id*="Digit"]',
            'input[placeholder*="code"]', 'input[placeholder*="OTP"]',
        ];

        const otpFieldsByName: HTMLInputElement[] = [];
        const seen = new Set<HTMLInputElement>();

        for (const selector of otpNameSelectors) {
            document.querySelectorAll<HTMLInputElement>(selector).forEach((input) => {
                if (!seen.has(input) && this.isVisibleElement(input) && !input.readOnly && !input.disabled) {
                    seen.add(input);
                    otpFieldsByName.push(input);
                }
            });
        }

        if (otpFieldsByName.length > 0) {
            log.debug('Found OTP fields by name/ID', { count: otpFieldsByName.length });
            return this.sortByPosition(otpFieldsByName);
        }

        // STRATEGY 4: Fallback to maxlength 4-8 (full OTP in single field)
        const fullOtpInputs = Array.from(
            document.querySelectorAll<HTMLInputElement>('input[maxlength="4"], input[maxlength="5"], input[maxlength="6"], input[maxlength="7"], input[maxlength="8"]')
        ).filter((input) => this.isVisibleElement(input) && !input.readOnly && !input.disabled && input.type !== 'password');

        if (fullOtpInputs.length > 0) {
            log.debug('Found full OTP input field', { count: fullOtpInputs.length });
            return fullOtpInputs;
        }

        log.warn('No OTP fields detected on page');
        return [];
    }

    /**
     * Sort input fields by their visual position (left to right, then top to bottom)
     */
    private sortByPosition(inputs: HTMLInputElement[]): HTMLInputElement[] {
        return inputs.sort((a, b) => {
            const rectA = a.getBoundingClientRect();
            const rectB = b.getBoundingClientRect();
            // First compare by Y (row), then by X (column)
            if (Math.abs(rectA.top - rectB.top) > 10) {
                return rectA.top - rectB.top;
            }
            return rectA.left - rectB.left;
        });
    }


    /**
     * Smart fill - automatically detect and fill form with retry logic
     * Returns result object so caller can show appropriate feedback
     */
    async smartFill(): Promise<{ success: boolean; filledCount: number; message: string }> {
        // Retry up to 3 times with delays for dynamically rendered forms
        for (let attempt = 0; attempt < 3; attempt++) {
            const filled = await this.performSmartFillAttempt();
            if (filled > 0) {
                log.info('Smart fill completed', { filledCount: filled, attempt });
                return { success: true, filledCount: filled, message: `Filled ${filled} field(s)` };
            }
            // Wait for dynamic content to render
            if (attempt < 2) {
                log.debug(`Smart fill attempt ${attempt + 1} found no fields, retrying...`);
                await this.delay(500);
            }
        }

        // No fields filled after all attempts
        log.debug('Smart fill: No fields filled after all attempts');
        return { success: false, filledCount: 0, message: 'No fillable fields found' };
    }

    /**
     * Single attempt at smart fill
     */
    private async performSmartFillAttempt(): Promise<number> {
        try {
            // Get complete identity from background
            const identityResponse = await safeSendMessage({ action: 'GET_IDENTITY' });

            if (!identityResponse || !('success' in identityResponse) || !identityResponse.success || !('identity' in identityResponse) || !identityResponse.identity) {
                log.warn('No identity available - user needs to generate one first');
                // Import pageStatus for user feedback
                const { pageStatus } = await import('./pageStatus');
                pageStatus.error('Open popup first to generate identity', 3000);
                return 0;
            }

            const identity = identityResponse.identity;
            log.debug('Got identity for auto-fill', {
                firstName: identity.firstName,
                email: identity.email
            });

            // Track filled elements to prevent overwrites
            const filledElements = new Set<HTMLElement>();

            // Import FieldAnalyzer
            const { FieldAnalyzer } = await import('./fieldAnalyzer');
            const analyzer = new FieldAnalyzer();

            // Get all fillable fields on the page (with optional AI enhancement)
            let detectedFields: DetectedField[] = [];
            try {
                const result = await analyzer.getAllFieldsWithAI();
                detectedFields = result.fields || [];
            } catch (e) {
                log.debug('Field analyzer failed, using direct fallbacks');
            }

            // Fill fields based on detected type
            for (const field of detectedFields) {
                if (filledElements.has(field.element)) continue;
                if (field.element.disabled || field.element.readOnly) continue;

                let valueToFill: string | undefined;

                switch (field.fieldType) {
                    case 'first-name':
                        valueToFill = identity.firstName;
                        break;
                    case 'last-name':
                        valueToFill = identity.lastName;
                        break;
                    case 'name':
                        valueToFill = identity.fullName;
                        break;
                    case 'username':
                        // CRITICAL FIX: Never put a username in a field that looks like a real name
                        // Check placeholder/label against 'name' keywords
                        const label = (field.element.getAttribute('placeholder') || field.element.getAttribute('aria-label') || '').toLowerCase();
                        if (label.includes('first name') || label.includes('last name') || label.includes('full name')) {
                            valueToFill = label.includes('first') ? identity.firstName : identity.lastName;
                        } else {
                            valueToFill = identity.username;
                        }
                        break;
                    case 'email':
                        valueToFill = identity.email;
                        break;
                    case 'password':
                    case 'confirm-password':
                        valueToFill = identity.password;
                        break;
                    case 'otp':
                        // OTP needs to be fetched separately
                        try {
                            const otpResponse = await safeSendMessage({ action: 'GET_LAST_OTP' });
                            if (otpResponse && 'lastOTP' in otpResponse && otpResponse.lastOTP) {
                                const otp = otpResponse.lastOTP as { code: string };
                                if (otp.code) {
                                    // Use fillOTP method for proper handling
                                    const otpFilled = this.fillOTP(otp.code);
                                    if (otpFilled) {
                                        filledElements.add(field.element);
                                        log.info('Filled OTP field with code', { code: otp.code.substring(0, 2) + '...' });
                                    }
                                }
                            }
                        } catch (e) {
                            log.debug('Could not fetch OTP for fill', e);
                        }
                        break;
                }

                if (valueToFill) {
                    this.setFieldValue(field.element, valueToFill);
                    filledElements.add(field.element);
                    log.debug(`Filled ${field.fieldType} field`, {
                        selector: field.selector,
                        confidence: field.confidence
                    });
                }
            }

            // ALWAYS try broad fallback selectors - these work even if field detection fails
            // EMAIL FALLBACK
            if (identity.email) {
                this.fillWithBroadSelectors(filledElements, identity.email, [
                    'input[type="email"]',
                    'input[name*="email" i]', 'input[id*="email" i]',
                    'input[autocomplete*="email"]',
                    'input[autocomplete="username"]',
                    'input[placeholder*="email" i]', 'input[placeholder*="@" i]'
                ], 'email');
            }

            // PASSWORD FALLBACK
            if (identity.password) {
                this.fillWithBroadSelectors(filledElements, identity.password, [
                    'input[type="password"]',
                    'input[name*="password" i]', 'input[id*="password" i]',
                    'input[autocomplete*="password"]',
                    'input[autocomplete="new-password"]',
                    'input[autocomplete="current-password"]'
                ], 'password');
            }

            // USERNAME FALLBACK (for login forms that use username instead of email)
            if (identity.username) {
                this.fillWithBroadSelectors(filledElements, identity.username, [
                    'input[name*="user" i]:not([type="email"]):not([type="password"])',
                    'input[id*="user" i]:not([type="email"]):not([type="password"])',
                    'input[name*="login" i]:not([type="password"])',
                    'input[autocomplete="username"]:not([type="email"])'
                ], 'username');
            }

            // OTP FALLBACK - Try to fill OTP if we haven't already and there are OTP fields
            const otpFields = this.findOTPFields();
            if (otpFields.length > 0 && !Array.from(filledElements).some(el => otpFields.includes(el as HTMLInputElement))) {
                try {
                    const otpResponse = await safeSendMessage({ action: 'GET_LAST_OTP' });
                    if (otpResponse && 'lastOTP' in otpResponse && otpResponse.lastOTP) {
                        const otp = (otpResponse.lastOTP as { code: string }).code;
                        if (otp) {
                            const filled = this.fillOTP(otp);
                            if (filled) {
                                otpFields.forEach(f => filledElements.add(f));
                                log.info('Filled OTP via fallback');
                            }
                        }
                    }
                } catch (e) {
                    log.debug('OTP fallback failed', e);
                }
            }

            return filledElements.size;
        } catch (error) {
            log.error('Smart fill failed', error);
            return 0;
        }
    }

    /**
     * Fill fields using broad selectors (fallback)
     */
    private fillWithBroadSelectors(
        filledElements: Set<HTMLElement>,
        value: string,
        selectors: string[],
        fieldType: string
    ): void {
        for (const selector of selectors) {
            try {
                const fields = document.querySelectorAll<HTMLInputElement>(selector);
                fields.forEach(field => {
                    if (this.isVisibleElement(field) && !filledElements.has(field) && !field.disabled && !field.readOnly) {
                        this.setFieldValue(field, value);
                        filledElements.add(field);
                        log.info(`Filled ${fieldType} (broad selector)`, { selector: selector.substring(0, 50), id: field.id, name: field.name });
                    }
                });
            } catch (e) {
                // Invalid selector, skip
            }
        }
    }


    /**
     * Fill a complete form with data
     */
    async fillForm(formSelector?: string, data?: Record<string, string>): Promise<boolean> {
        const form = formSelector
            ? document.querySelector<HTMLFormElement>(formSelector)
            : document.querySelector<HTMLFormElement>('form');

        if (!form) {
            log.warn('Form not found');
            return false;
        }

        if (data) {
            // Fill with provided data
            for (const [field, value] of Object.entries(data)) {
                const input = form.querySelector<HTMLInputElement>(
                    `input[name="${field}"], input[id="${field}"], textarea[name="${field}"]`
                );
                if (input) {
                    this.setFieldValue(input, value);
                }
            }
        } else {
            // Use smart fill
            await this.smartFill();
        }

        return true;
    }

    /**
     * Get selector for field type
     */
    private getSelectorForFieldType(fieldType: string): string {
        switch (fieldType) {
            case 'email':
                return 'input[type="email"], input[name*="email"], input[id*="email"], input[autocomplete*="email"], input[placeholder*="email" i]';
            case 'password':
                return 'input[type="password"], input[autocomplete*="password"], input[name*="password"], input[name*="passwd"], input[name*="pwd"], input[id*="password"], input[id*="passwd"], input[id*="pwd"], input[aria-label*="password" i], input[placeholder*="password" i], input[placeholder*="passwd" i]';
            case 'otp':
                return 'input[autocomplete="one-time-code"], input[name*="otp"], input[name*="code"], input[id*="otp"], input[id*="code"], input[class*="otp"]';
            case 'username':
                return 'input[name*="user"], input[name*="login"], input[id*="user"], input[id*="login"], input[autocomplete="username"]';
            default:
                return 'input';
        }
    }

    /**
     * Determines the strict type of an input field.
     * PRIORITIES:
     * 1. HTML Attributes (type="email") -> 100% Accuracy
     * 2. Name/ID Attributes (name="user_email") -> 95% Accuracy
     * 3. Label Text ("Enter your email") -> 90% Accuracy
     * 4. Placeholder Text ("john@doe.com") -> 80% Accuracy
     */
    private getFieldType(input: HTMLInputElement | HTMLTextAreaElement): string {
        const type = input.type.toLowerCase();
        const name = (input.name || '').toLowerCase();
        const id = (input.id || '').toLowerCase();
        const placeholder = (input.placeholder || '').toLowerCase();

        // 1. HARD RULE: If type is email, it IS an email.
        if (type === 'email') return 'EMAIL';

        // 2. KEYWORD SEARCH: Look for 'email' in ID or Name
        if (name.includes('email') || id.includes('email')) return 'EMAIL';

        // 3. CONTEXT SEARCH: Check the nearby label
        const label = this.findLabelForInput(input);
        if (label && label.innerText.toLowerCase().includes('email')) return 'EMAIL';

        // 4. PLACEHOLDER PATTERN: Does it look like an email example?
        if (placeholder.includes('@') || placeholder.includes('example.com')) return 'EMAIL';

        // 5. USERNAME vs NAME check
        if (name.includes('user') || name.includes('login') || placeholder.includes('username')) return 'USERNAME';

        // 6. Fallback to Name only if nothing else matches
        if (name.includes('name') || name.includes('first') || name.includes('full')) return 'NAME';

        return 'TEXT'; // Default fallback
    }

    /**
     * Helper to reliably find the label for an input
     */
    private findLabelForInput(input: HTMLElement): HTMLLabelElement | null {
        // Check explicit 'for' attribute
        if (input.id) {
            const explicitLabel = document.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`);
            if (explicitLabel) return explicitLabel;
        }
        // Check parent wrapping label
        return input.closest('label');
    }

    /**
     * Check if element is visible
     */
    private isVisibleElement(element: HTMLElement): boolean {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0'
        );
    }

    /**
     * CHAMELEON UI: Inject Ghost Icons into fields
     */
    async injectIcons(): Promise<void> {
        // Prevent double injection
        if (document.body.getAttribute('data-ghost-injected') === 'true') {
            // We can re-scan, but let's be careful about duplicates
        }

        const inputs = document.querySelectorAll('input');

        // precise mapping of field to icon type/action
        for (const input of Array.from(inputs)) {
            if (!this.isVisibleElement(input) || input.hasAttribute('data-ghost-attached')) continue;

            // Skip hidden/disabled
            if (input.type === 'hidden' || input.disabled || input.readOnly) continue;

            const type = this.getFieldType(input);
            if (['EMAIL', 'PASSWORD', 'USERNAME', 'NAME'].includes(type) || type === 'TEXT') {
                // Double check 'TEXT' type to avoid spamming icons on search bars etc.
                // Only assume TEXT is relevant if it looks like a name/login field
                if (type === 'TEXT' && !this.isLikelyIdentityField(input)) continue;

                this.attachGhostIcon(input, type);
            }
        }

        document.body.setAttribute('data-ghost-injected', 'true');
    }

    private isLikelyIdentityField(input: HTMLInputElement): boolean {
        const name = (input.name || '').toLowerCase();
        const id = (input.id || '').toLowerCase();
        const placeholder = (input.placeholder || '').toLowerCase();
        const combined = name + id + placeholder;

        return combined.includes('user') || combined.includes('login') || combined.includes('name') ||
            combined.includes('email') || combined.includes('phone') || combined.includes('address');
    }

    private attachGhostIcon(input: HTMLInputElement, type: string) {
        // Dynamic import to avoid circular dependency issues at top level if any
        // But we imported at index.ts so custom element is defined.

        // Create the element
        const ghost = document.createElement('ghost-label') as GhostLabelElement;

        // We append to body to avoid overflow:hidden clipping from input parents
        document.body.appendChild(ghost);

        // Initialize
        if (ghost.attachToAttribute) {
            ghost.attachToAttribute(input, async () => {
                log.info('Ghost Icon Clicked', { type });

                // Fetch identity if we don't have it locally cached (or just fetch fresh)
                const identityResponse = await safeSendMessage({ action: 'GET_IDENTITY' });
                if (identityResponse && 'success' in identityResponse && identityResponse.success && 'identity' in identityResponse && identityResponse.identity) {
                    const identity = identityResponse.identity;

                    // Fill logic based on specifically clicked field type
                    let value = '';
                    if (type === 'EMAIL') value = identity.email || '';
                    else if (type === 'PASSWORD') value = identity.password || '';
                    else if (type === 'USERNAME') value = identity.username || '';
                    else if (type === 'NAME') value = identity.fullName || '';

                    if (value) {
                        this.setFieldValue(input, value);
                        // Trigger smart fill for the rest of the form too!
                        this.smartFill();
                    }
                }
            });
        }

        // Mark input
        input.setAttribute('data-ghost-attached', 'true');
    }

    /**
     * Remove all ghost icons (cleanup)
     */
    removeIcons(): void {
        const icons = document.querySelectorAll('ghost-label');
        icons.forEach(icon => icon.remove());
        document.querySelectorAll('[data-ghost-attached]').forEach(el => el.removeAttribute('data-ghost-attached'));
    }
}
