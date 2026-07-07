// Content Script Entry Point

// Safe getComputedStyle override to prevent Chrome/Brave crashing on invalid pattern attributes (Chromium bug)
// Initialize debug console FIRST to capture all errors
import './debugConsole';

import { FieldType } from '../types/form.types';
import { deepQuerySelectorAll } from '../utils/helpers';
import { createLogger } from '../utils/logger';
import { errorTracker, performanceMonitor } from '../utils/monitoring';
import { initRemoteLogger } from '../utils/remoteLogger';
import { AutoFiller } from './autoFiller';
import { FormDetector, FieldAnalyzer, DOMObserver, collectFieldDiagnostics } from './formDetector';
import { FloatingButton } from './floatingButton';
import { OTPPageDetector } from './otpPageDetector';
import { pageStatus } from './pageStatus';
import './styles/content.css';
import './ui/GhostLabel';

// Register web component

const log = createLogger('ContentScript');
initRemoteLogger('Content');

// Handle context invalidation globally
function isContextValid(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
}

function isKnownLifecycleMessage(text: string): boolean {
  return (
    text.includes('extension context invalidated') ||
    text.includes('context invalidated') ||
    text.includes('could not establish connection') ||
    text.includes('receiving end does not exist')
  );
}

function isExtensionOwnedText(text: string): boolean {
  const lower = text.toLowerCase();
  const runtimeOrigin =
    typeof chrome !== 'undefined' && chrome.runtime?.id
      ? `chrome-extension://${chrome.runtime.id}`.toLowerCase()
      : 'chrome-extension://';

  return (
    lower.includes('ghostfill') || lower.includes(runtimeOrigin) || isKnownLifecycleMessage(lower)
  );
}

function isExtensionOwnedRejection(reason: unknown): boolean {
  if (reason instanceof Error) {
    return isExtensionOwnedText(`${reason.message}\n${reason.stack ?? ''}`);
  }

  if (typeof reason === 'string') {
    return isExtensionOwnedText(reason);
  }

  if (reason && typeof reason === 'object') {
    const maybeMessage = 'message' in reason ? String(reason.message ?? '') : '';
    const maybeStack = 'stack' in reason ? String(reason.stack ?? '') : '';
    return isExtensionOwnedText(`${maybeMessage}\n${maybeStack}`);
  }

  return false;
}

function runSafely(taskName: string, task: () => Promise<unknown> | void): void {
  try {
    const result = task();
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      void (result as Promise<unknown>).catch((error) => {
        log.warn(`Content task "${taskName}" failed`, error);
      });
    }
  } catch (error) {
    log.warn(`Content task "${taskName}" failed`, error);
  }
}

// Global error boundary for content script
window.addEventListener('error', (event) => {
  const msg = event.message?.toLowerCase() ?? '';
  const filename = event.filename ?? '';

  if (isKnownLifecycleMessage(msg)) {
    log.debug('GhostFill: Content script context invalidated (expected on reload)');
    event.preventDefault();
    return;
  }

  if (!isExtensionOwnedText(`${msg}\n${filename}`)) {
    return;
  }

  log.error('Unhandled content script error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const reasonStr = reason instanceof Error ? reason.message : String(reason);
  const reasonStrLower = reasonStr.toLowerCase();

  if (isKnownLifecycleMessage(reasonStrLower)) {
    log.debug('GhostFill: Extension context invalidated (expected on reload)');
    event.preventDefault();
    return;
  }

  if (!isExtensionOwnedRejection(reason)) {
    return;
  }

  log.error('Unhandled content script promise rejection:', event.reason);
});

log.info('GhostFill content script loaded');

// Safe component factory that ensures all method calls are caught, avoiding crashes
function createSafeComponent<T extends object>(methods: Partial<T>, componentName: string): T {
  return new Proxy({} as T, {
    get(_, prop: string | symbol) {
      // M11: Symbol access (e.g. Symbol.toPrimitive, Symbol.iterator) must return undefined
      // to avoid breaking Promise detection and other internals.
      if (typeof prop !== 'string') {
        return undefined;
      }

      // If the method exists in the fallback, return it directly (no error log)
      const fallbackFn = (methods as Record<string, unknown>)[prop];
      if (typeof fallbackFn === 'function') {
        return fallbackFn;
      }

      // Only log + track when a MISSING method is actually called
      return (..._args: unknown[]) => {
        log.warn(
          `GhostFill: Method '${prop}' called on degraded component '${componentName}' — using no-op fallback`
        );
        errorTracker.trackError({
          type: 'initialization_error',
          message: `Method ${prop} called on uninitialized component ${componentName}`,
          timestamp: Date.now(),
        });
        // Return a generic resolved promise as many methods are async
        return Promise.resolve(null);
      };
    },
  });
}

// Initialize components
let fieldAnalyzer: FieldAnalyzer;
let formDetector: FormDetector;
let autoFiller: AutoFiller;
let floatingButton: FloatingButton;
let domObserver: DOMObserver;
let otpPageDetector: OTPPageDetector;
let passiveActivationHandler: ((event: Event) => void) | null = null;
let passiveRuntimeListener:
  | ((
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void
    ) => boolean)
  | null = null;
let mainRuntimeListener:
  | ((
      message: { action?: string },
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void
    ) => boolean)
  | null = null;
let passiveRuntimeListenerInstalled = false;

const ACTIVATION_MESSAGE_ACTIONS = new Set([
  'DETECT_FORMS',
  'FILL_FIELD',
  'FILL_FORM',
  'FILL_OTP',
  'AUTO_FILL_OTP',
  'SMART_AUTOFILL',
  'HIGHLIGHT_FIELDS',
  'SHOW_FLOATING_BUTTON',
]);

const PAGE_ACTIVATION_PATTERN =
  /login|log[\s_-]?in|sign[\s_-]?in|sign[\s_-]?up|signup|register|create[\s_-]?account|verification|verify|otp|one[\s_-]?time|2fa|mfa|password[\s_-]?reset|email[\s_-]?address/i;

const FIELD_ACTIVATION_PATTERN =
  /email|e-mail|username|user[\s_-]?name|login|password|passcode|otp|one[\s_-]?time|verification|verify|security[\s_-]?code|auth[\s_-]?code|first[\s_-]?name|last[\s_-]?name|full[\s_-]?name|surname/i;

const RELEVANT_FIELD_SELECTOR = [
  'input[type="email"]',
  'input[type="password"]',
  'input[autocomplete="email"]',
  'input[autocomplete="username"]',
  'input[autocomplete="one-time-code"]',
  'input[autocomplete="new-password"]',
  'input[autocomplete="current-password"]',
  'input[name*="email" i]',
  'input[id*="email" i]',
  'input[name*="otp" i]',
  'input[id*="otp" i]',
  'input[name*="code" i]',
  'input[id*="code" i]',
  'input[name*="password" i]',
  'input[id*="password" i]',
  'input[name*="username" i]',
  'input[id*="username" i]',
  'input[name*="first" i]',
  'input[id*="first" i]',
  'input[name*="last" i]',
  'input[id*="last" i]',
].join(',');

function isIgnorableInput(input: HTMLInputElement | HTMLTextAreaElement): boolean {
  if (input.disabled || input.readOnly) {
    return true;
  }
  if (input instanceof HTMLTextAreaElement) {
    return false;
  }
  return [
    'hidden',
    'submit',
    'button',
    'reset',
    'checkbox',
    'radio',
    'file',
    'image',
    'range',
    'color',
    'search',
  ].includes((input.type ?? '').toLowerCase());
}

function isLikelyRelevantInput(input: HTMLInputElement | HTMLTextAreaElement): boolean {
  if (isIgnorableInput(input)) {
    return false;
  }

  const descriptor = [
    input instanceof HTMLInputElement ? input.type : '',
    input.name,
    input.id,
    input.placeholder,
    input.getAttribute('autocomplete'),
    input.getAttribute('aria-label'),
  ]
    .filter(Boolean)
    .join(' ');

  if (input instanceof HTMLInputElement) {
    const type = input.type.toLowerCase();
    if (type === 'email' || type === 'password') {
      return true;
    }
    if (
      input.autocomplete === 'one-time-code' ||
      (input.maxLength >= 4 && input.maxLength <= 10 && input.inputMode === 'numeric')
    ) {
      return true;
    }
  }

  return FIELD_ACTIVATION_PATTERN.test(descriptor);
}

function hasRelevantField(): boolean {
  try {
    if (deepQuerySelectorAll(RELEVANT_FIELD_SELECTOR).length > 0) {
      return true;
    }
  } catch {
    // Ignore selector support issues and fall back to direct inspection.
  }

  const inputs = deepQuerySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'input, textarea'
  ).slice(0, 60);

  return inputs.some((input) => isLikelyRelevantInput(input));
}

function hasPageActivationSignals(): boolean {
  const bodyText = document.body?.textContent?.slice(0, 2000) ?? '';
  return PAGE_ACTIVATION_PATTERN.test(`${location.href} ${document.title} ${bodyText}`);
}

function shouldActivateImmediately(): boolean {
  if (hasRelevantField()) {
    return true;
  }

  const hasAnyFormControl = deepQuerySelectorAll('form, input, textarea, select').length > 0;
  return hasAnyFormControl && hasPageActivationSignals();
}

function removePassiveActivationHooks(): void {
  if (!passiveActivationHandler) {
    return;
  }
  document.removeEventListener('focusin', passiveActivationHandler, true);
  document.removeEventListener('input', passiveActivationHandler, true);
  passiveActivationHandler = null;
}

function installPassiveActivationHooks(): void {
  if (passiveActivationHandler || isInitialized) {
    return;
  }

  passiveActivationHandler = (event: Event) => {
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      const inputRelevant =
        target instanceof HTMLSelectElement
          ? hasPageActivationSignals()
          : isLikelyRelevantInput(target);
      if (inputRelevant || hasPageActivationSignals()) {
        safeInit(true);
      }
    }
  };

  document.addEventListener('focusin', passiveActivationHandler, true);
  document.addEventListener('input', passiveActivationHandler, true);
}

function installPassiveMessageListener(): void {
  if (passiveRuntimeListenerInstalled || !chrome?.runtime?.onMessage) {
    return;
  }

  passiveRuntimeListener = (message, sender, sendResponse) => {
    if (sender && sender.id !== chrome.runtime.id) {
      return false;
    }

    const action =
      typeof message === 'object' && message !== null && 'action' in message
        ? String((message as { action?: unknown }).action ?? '')
        : '';

    if (!action || isInitialized) {
      return false;
    }

    if (action === 'PING') {
      sendResponse({ success: true, alive: true, lazy: true, verdict: 'not-otp' });
      return false;
    }

    if (!ACTIVATION_MESSAGE_ACTIONS.has(action)) {
      return false;
    }

    safeInit(true);
    handleMessage(message as { action: string; payload?: Record<string, unknown> })
      .then(sendResponse)
      .catch((error) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        sendResponse({ success: false, error: errorMessage });
      });

    return true;
  };

  chrome.runtime.onMessage.addListener(passiveRuntimeListener);
  passiveRuntimeListenerInstalled = true;
}

function removePassiveMessageListener(): void {
  if (!passiveRuntimeListener || !chrome?.runtime?.onMessage) {
    return;
  }

  chrome.runtime.onMessage.removeListener(passiveRuntimeListener);
  passiveRuntimeListener = null;
  passiveRuntimeListenerInstalled = false;
}

/**
 * Initialize content script
 */
function init(): void {
  // Skip if not an HTML document
  if (!(document instanceof HTMLDocument)) {
    return;
  }

  // Skip tiny frames (likely tracking pixels)
  if (window.innerWidth < 10 && window.innerHeight < 10) {
    return;
  }

  log.debug('Content script initializing...');

  try {
    removePassiveActivationHooks();

    // Initialize Observability Plugins First
    errorTracker.init();
    performanceMonitor.init();

    // Initialize DOM-dependent components
    try {
      fieldAnalyzer = FieldAnalyzer.getInstance();
      formDetector = new FormDetector(fieldAnalyzer);
      autoFiller = new AutoFiller();
      floatingButton = new FloatingButton(autoFiller); // Inject autoFiller
      domObserver = new DOMObserver(formDetector, async () => {
        await autoFiller.injectIcons();
      });
      otpPageDetector = new OTPPageDetector(autoFiller, formDetector);
    } catch (e) {
      log.error('Failed to initialize content script components', e);
      // Create safe no-op objects to prevent further crashes
      const dummyFieldAnalyzer = {
        analyze: () => ({}),
        getFields: () => [],
        detectForms: () => ({}),
      };
      const dummyFormDetector = { detectForms: () => ({}), highlightFields: () => {} };
      const dummyAutoFiller = {
        fillOTP: () => Promise.resolve(false),
        injectIcons: () => {},
        fillField: () => {},
        fillCurrentField: () => {},
        fillForm: () => Promise.resolve(),
        smartFill: () => Promise.resolve({ success: false, filledCount: 0 }),
      };
      const dummyFloatingButton = { init: () => {}, show: () => {}, hide: () => {} };
      const dummyDomObserver = { start: () => {}, stop: () => {} };
      const dummyOtpPageDetector = {
        init: () => {},
        detect: () => false,
        handleAutoFill: () => Promise.resolve(false),
        getStatus: () => ({ verdict: 'not-otp' }),
      };

      fieldAnalyzer = createSafeComponent(
        dummyFieldAnalyzer,
        'FieldAnalyzer'
      ) as unknown as FieldAnalyzer;
      formDetector = createSafeComponent(
        dummyFormDetector,
        'FormDetector'
      ) as unknown as FormDetector;
      autoFiller = createSafeComponent(dummyAutoFiller, 'AutoFiller') as unknown as AutoFiller;
      floatingButton = createSafeComponent(
        dummyFloatingButton,
        'FloatingButton'
      ) as unknown as FloatingButton;
      domObserver = createSafeComponent(dummyDomObserver, 'DOMObserver') as unknown as DOMObserver;
      otpPageDetector = createSafeComponent(
        dummyOtpPageDetector,
        'OTPPageDetector'
      ) as unknown as OTPPageDetector;
    }

    // Keep install/startup light when Chrome injects the content script into
    // many existing tabs. Field enhancement can wait for browser idle time.
    if (deepQuerySelectorAll('input, textarea, select').length > 0) {
      const enhanceFields = () => {
        runSafely('detectForms:init-idle', () => {
          formDetector.detectForms();
        });
        runSafely('injectIcons:init-idle', () => autoFiller.injectIcons());
      };

      if ('requestIdleCallback' in window) {
        (
          window as Window & {
            requestIdleCallback?: (
              callback: IdleRequestCallback,
              options?: IdleRequestOptions
            ) => number;
          }
        ).requestIdleCallback?.(enhanceFields, { timeout: 2500 });
      } else {
        setTimeout(enhanceFields, 800);
      }
    }

    // Setup floating button
    runSafely('floatingButton.init', () => floatingButton.init());

    // Start observing DOM changes
    runSafely('domObserver.start', () => domObserver.start());

    // Initialize OTP page detection for auto-fill
    runSafely('otpPageDetector.init', () => otpPageDetector.init());

    // Listen for messages from background
    if (chrome?.runtime?.onMessage) {
      if (!mainRuntimeListener) {
        mainRuntimeListener = (message, sender, sendResponse) => {
          if (sender && sender.id !== chrome.runtime.id) {
            return false;
          }
          log.debug('Message received', { action: message.action });

          handleMessage(message as { action: string; payload?: Record<string, unknown> })
            .then((result) => {
              try {
                sendResponse(result);
              } catch (e) {
                const err = e instanceof Error ? e.message : String(e);
                log.warn('Failed to send response, context likely invalidated', err);
              }
            })
            .catch((error) => {
              log.error('Message handling failed', error);
              try {
                const err = error instanceof Error ? error.message : String(error);
                sendResponse({ success: false, error: err });
              } catch (e) {
                const sendErr = e instanceof Error ? e.message : String(e);
                log.warn('Failed to send error response, context likely invalidated', sendErr);
              }
            });

          return true;
        };
        chrome.runtime.onMessage.addListener(mainRuntimeListener);
      }
    } else {
      log.debug('chrome.runtime.onMessage not available in this frame; messaging features limited');
    }

    // Cleanup on page unload to prevent memory leaks
    const cleanupHandler = () => {
      domObserver.stop();
      floatingButton?.hide?.();
      void otpPageDetector?.destroy?.();
      if (mainRuntimeListener && chrome?.runtime?.onMessage) {
        chrome.runtime.onMessage.removeListener(mainRuntimeListener);
        mainRuntimeListener = null;
      }
      window.removeEventListener('beforeunload', cleanupHandler);
    };
    window.addEventListener('beforeunload', cleanupHandler);

    log.debug('Content script initialized');
  } catch (error) {
    log.error('Failed to initialize content script', error);
  }
}

/**
 * Handle messages from background/popup
 */
async function handleMessage(message: {
  action: string;
  payload?: Record<string, unknown>;
}): Promise<{ success: boolean; error?: string; [key: string]: unknown }> {
  if (!isContextValid()) {
    log.debug('Context invalidated, ignoring message', { action: message.action });
    return { success: false, error: 'Extension context invalidated' };
  }

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
        const { value, fieldType, selector } = message.payload as {
          value: string;
          fieldType?: FieldType;
          selector?: string;
        };

        if (selector) {
          return { success: await autoFiller.fillField(selector, value) };
        }
        return { success: await autoFiller.fillCurrentField(value, fieldType) };
      }
      return { success: false, error: 'No field payload provided' };
    }

    case 'FILL_FORM': {
      if (message.payload) {
        const { formSelector, data } = message.payload as {
          formSelector?: string;
          data?: Record<string, string>;
        };
        return { success: await autoFiller.fillForm(formSelector, data) };
      }
      return { success: false, error: 'No form payload provided' };
    }

    case 'FILL_OTP': {
      if (message.payload) {
        const { otp, fieldSelectors } = message.payload as {
          otp: string;
          fieldSelectors?: string[];
        };
        return {
          success: await otpPageDetector.handleAutoFill({
            otp,
            source: 'manual',
            confidence: 1,
            ...(fieldSelectors !== undefined && { fieldSelectors }),
          }),
        };
      }
      return { success: false, error: 'No OTP provided' };
    }

    case 'AUTO_FILL_OTP': {
      const rawPayload = message.payload as Record<string, unknown> | undefined;
      if (rawPayload && typeof rawPayload.otp === 'string') {
        return {
          success: await otpPageDetector.handleAutoFill({
            otp: rawPayload.otp,
            source: typeof rawPayload.source === 'string' ? rawPayload.source : 'email',
            confidence: typeof rawPayload.confidence === 'number' ? rawPayload.confidence : 1,
            ...(Array.isArray(rawPayload.fieldSelectors) && {
              fieldSelectors: rawPayload.fieldSelectors as string[],
            }),
            ...(typeof rawPayload.isBackgroundTab === 'boolean' && {
              isBackgroundTab: rawPayload.isBackgroundTab,
            }),
          }),
        };
      }
      return { success: false, error: 'No OTP provided' };
    }

    case 'POLLING_STATE_CHANGE': {
      if (message.payload && message.payload.state) {
        otpPageDetector.handlePollingStateChange(
          message.payload.state as 'ANALYZING_EMAIL' | 'LINK_ACTIVATION_STARTED'
        );
        return { success: true };
      }
      return { success: false, error: 'No state provided' };
    }

    case 'SMART_AUTOFILL':
      pageStatus.show('Filling form...', 'loading');
      try {
        const result = await autoFiller.smartFill();
        if (result.success && result.filledCount > 0) {
          pageStatus.success('Form filled!', 2500);
        } else if (result.message?.includes('disabled on login pages')) {
          pageStatus.error(
            'Smart Fill blocked on login pages.\nTry the OTP button if you have a verification code.',
            4000
          );
        } else {
          pageStatus.hide();
        }
        return { success: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        pageStatus.error(errorMessage || 'Fill failed', 2500);
        return { success: false, error: errorMessage };
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

let isInitialized = false;

function scheduleInit(immediate: boolean = false): void {
  if (immediate) {
    init();
    return;
  }

  const start = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        init();
      });
    });
  };

  if ('requestIdleCallback' in window) {
    (
      window as Window & {
        requestIdleCallback?: (
          callback: IdleRequestCallback,
          options?: IdleRequestOptions
        ) => number;
      }
    ).requestIdleCallback?.(() => start(), { timeout: 1200 });
    return;
  }

  setTimeout(start, 50);
}

function safeInit(force: boolean = false) {
  if (isInitialized) {
    return;
  }

  // Cleanup event listeners to prevent memory leaking
  document.removeEventListener('DOMContentLoaded', safeInitFromEvent);
  window.removeEventListener('load', safeInitFromEvent);

  if (!document.body) {
    // Wait for body to be available
    const observer = new MutationObserver(() => {
      if (document.body) {
        observer.disconnect();
        safeInit();
      }
    });
    observer.observe(document.documentElement, { childList: true });
    return;
  }

  if (!force && !shouldActivateImmediately()) {
    installPassiveActivationHooks();
    log.debug('GhostFill content script parked in lazy mode');
    return;
  }

  isInitialized = true;
  removePassiveActivationHooks();
  removePassiveMessageListener();
  scheduleInit(force);
}

function safeInitFromEvent(): void {
  safeInit(false);
}

installPassiveMessageListener();

// Listen for developer keyboard shortcut (Alt+Shift+H) to collect field diagnostics.
document.addEventListener(
  'keydown',
  (event: KeyboardEvent) => {
    if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'h') {
      event.preventDefault();
      event.stopPropagation();
      log.info('Dev shortcut Alt+Shift+H triggered: collecting field diagnostics');
      void collectFieldDiagnostics();
    }
  },
  true
);

// Initialize safely preventing DOM node load hazards
if (document.readyState === 'complete') {
  safeInit();
} else {
  document.addEventListener('DOMContentLoaded', safeInitFromEvent);
  window.addEventListener('load', safeInitFromEvent);
}

// Export for testing
export { formDetector, fieldAnalyzer, autoFiller, floatingButton, domObserver, otpPageDetector };
