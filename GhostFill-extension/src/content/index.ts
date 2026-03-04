// Content Script Entry Point

import { AutoFiller } from './autoFiller';
import { DOMObserver } from './domObserver';
import { FieldAnalyzer } from './fieldAnalyzer';
import { FloatingButton } from './floatingButton';
import { FormDetector } from './formDetector';
import { OTPPageDetector } from './otpPageDetector';
import { pageStatus } from './pageStatus';
import './ui/GhostLabel'; // Register web component
import { createLogger } from '../utils/logger';
import './styles/content.css';

const log = createLogger('ContentScript');

log.info('GhostFill content script loaded');

// Safe component factory that returns no-op components instead of dummy objects
function createSafeComponent<T extends object>(methods: Partial<T>): T {
    const safeObj: Record<string, unknown> = {};
    for (const key of Object.keys(methods)) {
        safeObj[key] = (..._args: unknown[]) => {
            log.warn(`Component method ${key} called but component was not initialized`);
        };
    }
    return safeObj as T;
}

// Initialize components (wrapped in try-catch for hostile page environments)
let fieldAnalyzer: FieldAnalyzer;
let formDetector: FormDetector;
let autoFiller: AutoFiller;
let floatingButton: FloatingButton;
let domObserver: DOMObserver;
let otpPageDetector: OTPPageDetector;

try {
    fieldAnalyzer = new FieldAnalyzer();
    formDetector = new FormDetector(fieldAnalyzer);
    autoFiller = new AutoFiller();
    floatingButton = new FloatingButton(autoFiller); // Inject autoFiller
    domObserver = new DOMObserver(formDetector, autoFiller);
    otpPageDetector = new OTPPageDetector(autoFiller, formDetector);
    // Note: Initial scan is handled by init() function which is called on DOMContentLoaded
} catch (e) {
    log.error('Failed to initialize content script components', e);
    // Create safe no-op objects to prevent further crashes
    const dummyFieldAnalyzer = { analyze: () => ({}), getFields: () => [], detectForms: () => ({}) };
    const dummyFormDetector = { detectForms: () => ({}), highlightFields: () => { } };
    const dummyAutoFiller = {
        fillOTP: () => Promise.resolve(false),
        injectIcons: () => { },
        fillField: () => { },
        fillCurrentField: () => { },
        fillForm: () => Promise.resolve(),
        smartFill: () => Promise.resolve({ success: false, filledCount: 0 })
    };
    const dummyFloatingButton = { init: () => { }, show: () => { }, hide: () => { } };
    const dummyDomObserver = { start: () => { }, stop: () => { } };
    const dummyOtpPageDetector = { init: () => { }, detect: () => false };

    fieldAnalyzer = createSafeComponent(dummyFieldAnalyzer) as unknown as FieldAnalyzer;
    formDetector = createSafeComponent(dummyFormDetector) as unknown as FormDetector;
    autoFiller = createSafeComponent(dummyAutoFiller) as unknown as AutoFiller;
    floatingButton = createSafeComponent(dummyFloatingButton) as unknown as FloatingButton;
    domObserver = createSafeComponent(dummyDomObserver) as unknown as DOMObserver;
    otpPageDetector = createSafeComponent(dummyOtpPageDetector) as unknown as OTPPageDetector;
}


/**
 * Initialize content script
 */
function init(): void {
    // Skip if not an HTML document
    if (!(document instanceof HTMLDocument)) {return;}

    // Skip tiny frames (likely tracking pixels)
    if (window.innerWidth < 10 && window.innerHeight < 10) {return;}

    log.debug('Content script initializing...');

    try {
        // Detect forms on page load
        formDetector.detectForms();
        autoFiller.injectIcons();

        // Setup floating button
        floatingButton.init();

        // Start observing DOM changes
        domObserver.start();

        // Initialize OTP page detection for auto-fill
        otpPageDetector.init();

        // Listen for messages from background
        if (chrome?.runtime?.onMessage) {
            chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
                log.debug('Message received', { action: message.action });

                handleMessage(message)
                    .then(sendResponse)
                    .catch((error) => {
                        log.error('Message handling failed', error);
                        sendResponse({ success: false, error: error.message });
                    });

                return true;
            });
        } else {
            log.warn('chrome.runtime.onMessage not available, content script limited');
        }

        // Cleanup on page unload to prevent memory leaks
        window.addEventListener('unload', () => {
            domObserver.stop();
            floatingButton?.hide?.();
            otpPageDetector?.destroy?.();
        });

        log.debug('Content script initialized');
    } catch (error) {
        log.error('Failed to initialize content script', error);
    }
}


/**
 * Handle messages from background/popup
 */
async function handleMessage(message: { action: string; payload?: Record<string, unknown> }): Promise<{ success: boolean; error?: string;[key: string]: unknown }> {
    switch (message.action) {
        case 'PING': {
            return { success: true, alive: true, verdict: otpPageDetector.getStatus().verdict };
        }

        case 'DETECT_FORMS': {
            const analysis = formDetector.detectForms();
            return { success: true, ...analysis };
        }

        case 'FILL_FIELD': {
            if (message.payload) {
                const { value, fieldType, selector } = message.payload as { value: string; fieldType?: string; selector?: string };

                if (selector) {
                    await autoFiller.fillField(selector, value);
                } else {
                    await autoFiller.fillCurrentField(value, fieldType);
                }
            }
            return { success: true };
        }

        case 'FILL_FORM': {
            if (message.payload) {
                const { formSelector, data } = message.payload as { formSelector?: string; data?: Record<string, string> };
                await autoFiller.fillForm(formSelector, data);
            }
            return { success: true };
        }

        case 'FILL_OTP': {
            if (message.payload) {
                const { otp, fieldSelectors } = message.payload as { otp: string; fieldSelectors?: string[] };
                await autoFiller.fillOTP(otp, fieldSelectors);
            }
            return { success: true };
        }

        case 'AUTO_FILL_OTP': {
            if (message.payload) {
                const { otp, source = 'unknown', confidence = 1 } = message.payload as { otp: string; source?: string; confidence?: number };
                // Call handles success/failure directly inside the UI, and returns
                await otpPageDetector.handleAutoFill({ otp, source, confidence });
                return { success: true, filled: true };
            }
            return { success: false, error: 'No OTP provided' };
        }

        case 'SMART_AUTOFILL':
            pageStatus.show('Filling form...', 'loading');
            try {
                const result = await autoFiller.smartFill();
                if (result.success && result.filledCount > 0) {
                    pageStatus.success('Form filled!', 2500);
                } else {
                    pageStatus.hide();
                }
                return { success: true };
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (error: any) {
                pageStatus.error(error.message || 'Fill failed', 2500);
                return { success: false, error: error.message };
            }

        case 'HIGHLIGHT_FIELDS': {
            if (message.payload) {
                const { fieldType } = message.payload as { fieldType: string };
                formDetector.highlightFields(fieldType);
            }
            return { success: true };
        }

        case 'SHOW_FLOATING_BUTTON':
            floatingButton.show();
            return { success: true };

        case 'HIDE_FLOATING_BUTTON':
            floatingButton.hide();
            return { success: true };

        default:
            return { success: false, error: 'Unknown action' };
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Export for testing
export { formDetector, fieldAnalyzer, autoFiller, floatingButton, domObserver, otpPageDetector };
