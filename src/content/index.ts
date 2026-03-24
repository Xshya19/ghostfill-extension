// Content Script Entry Point

import { createLogger } from '../utils/logger';
import { errorTracker, performanceMonitor } from '../utils/monitoring';
import { initRemoteLogger } from '../utils/remoteLogger';
import { AutoFiller } from './autoFiller';
import { DOMObserver } from './domObserver';
import { extractFeatures } from './extractor';
import { FieldAnalyzer } from './fieldAnalyzer';
import { FloatingButton } from './floatingButton';
import { FormDetector } from './formDetector';
import { OTPPageDetector } from './otpPageDetector';
import { pageStatus } from './pageStatus';
import './styles/content.css';
import './ui/GhostLabel'; // Register web component

const log = createLogger('ContentScript');
initRemoteLogger('Content');

// Handle context invalidation globally
function isContextValid(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
}

// Global error boundary for content script
window.addEventListener('error', (event) => {
  const msg = event.message?.toLowerCase() ?? '';

  // Ignore context invalidation - expected on extension reload
  if (msg.includes('extension context invalidated') || msg.includes('context invalidated')) {
    log.debug('GhostFill: Content script context invalidated (expected on reload)');
    event.preventDefault();
    return;
  }

  // Ignore connection errors from Chrome API
  if (
    msg.includes('could not establish connection') ||
    msg.includes('receiving end does not exist')
  ) {
    log.debug('GhostFill: Connection error (expected if extension unloaded)');
    event.preventDefault();
    return;
  }

  log.error('Unhandled content script error:', event.error);
  event.preventDefault();
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const reasonStr = reason instanceof Error ? reason.message : String(reason);
  const reasonStrLower = reasonStr.toLowerCase();

  // Ignore context invalidation - this is expected on extension reload
  if (
    reasonStrLower.includes('extension context invalidated') ||
    reasonStrLower.includes('context invalidated')
  ) {
    log.debug('GhostFill: Extension context invalidated (expected on reload)');
    event.preventDefault(); // Prevent default browser handling
    return;
  }

  // Ignore connection errors
  if (
    reasonStrLower.includes('could not establish connection') ||
    reasonStrLower.includes('receiving end does not exist')
  ) {
    log.debug('GhostFill: Connection error (expected if extension unloaded)');
    event.preventDefault();
    return;
  }

  log.error('Unhandled content script promise rejection:', event.reason);
  event.preventDefault(); // Prevent default browser error
});

log.info('GhostFill content script loaded');

// Safe component factory that ensures all method calls are caught, avoiding crashes
function createSafeComponent<T extends object>(methods: Partial<T>, componentName: string): T {
  return new Proxy({} as T, {
    get(_, prop: string | symbol) {
      if (typeof prop !== 'string') {
        return undefined;
      }

      return (...args: unknown[]) => {
        log.error(
          `GhostFill Error: Method ${prop} called on uninitialized component ${componentName}`
        );
        errorTracker.trackError({
          type: 'initialization_error',
          message: `Method ${prop} called on uninitialized component ${componentName}`,
          timestamp: Date.now(),
        });

        const fallbackFn = (methods as any)[prop];
        if (typeof fallbackFn === 'function') {
          return fallbackFn(...args);
        }

        // Return a generic resolved promise by default as many methods are async
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
let lastRightClickedElement: HTMLElement | null = null;

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
    // Initialize Observability Plugins First
    errorTracker.init();
    performanceMonitor.init();

    // Initialize DOM-dependent components
    try {
      fieldAnalyzer = FieldAnalyzer.getInstance();
      formDetector = new FormDetector(fieldAnalyzer);
      autoFiller = new AutoFiller();
      floatingButton = new FloatingButton(autoFiller); // Inject autoFiller
      domObserver = new DOMObserver(formDetector, autoFiller);
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
      const dummyOtpPageDetector = { init: () => {}, detect: () => false };

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

    // Detect forms on page load
    formDetector.detectForms();
    void autoFiller.injectIcons();

    // Setup floating button
    void floatingButton.init();

    // Start observing DOM changes
    void domObserver.start();

    // Initialize OTP page detection for auto-fill
    void otpPageDetector.init();

    // Listen for messages from background
    if (chrome?.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        log.debug('Message received', { action: message.action });

        handleMessage(message)
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
      });
    } else {
      log.warn('chrome.runtime.onMessage not available, content script limited');
    }

    // Cleanup on page unload to prevent memory leaks
    window.addEventListener('pagehide', () => {
      domObserver.stop();
      floatingButton?.hide?.();
      void otpPageDetector?.destroy?.();
    });

    // Track the last right-clicked element for Continuous Learning
    document.addEventListener(
      'contextmenu',
      (e) => {
        lastRightClickedElement = e.target as HTMLElement;
      },
      true
    );

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
    case 'REPORT_MISCLASSIFICATION': {
      if (message.payload && lastRightClickedElement) {
        const { correctType } = message.payload as { correctType: string };
        // Extract raw UI features of the field the user right-clicked
        const isInput =
          lastRightClickedElement.tagName === 'INPUT' ||
          lastRightClickedElement.tagName === 'TEXTAREA';
        if (isInput) {
          const rawFeatures = extractFeatures(
            lastRightClickedElement as HTMLInputElement | HTMLTextAreaElement
          );
          if (rawFeatures) {
            if (!isContextValid()) {
              log.debug('[Continuous Learning] Context invalidated, cannot save training data');
              return { success: false, error: 'Context invalidated' };
            }

            chrome.storage.local.get(['ghostfill_training_data'], (res) => {
              // Re-check inside callback because storage calls are async
              if (!isContextValid()) {
                return;
              }

              const data = Array.isArray(res.ghostfill_training_data)
                ? res.ghostfill_training_data
                : [];
              // We omit the DOM element itself and keep the text/structural numbers
              const { element, ...savableFeatures } = rawFeatures;
              data.push({ features: savableFeatures, label: correctType, timestamp: Date.now() });

              chrome.storage.local.set({ ghostfill_training_data: data }, () => {
                if (isContextValid()) {
                  log.info(
                    `[Continuous Learning] Saved ${correctType} field to local training pool. Total items: ${data.length}`
                  );
                }
              });
            });
          }
        } else {
          log.warn(
            '[Continuous Learning] Right-clicked element is not an input or textarea. Cannot extract features.'
          );
        }
      }
      return { success: true };
    }

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
          fieldType?: string;
          selector?: string;
        };

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
        const { formSelector, data } = message.payload as {
          formSelector?: string;
          data?: Record<string, string>;
        };
        await autoFiller.fillForm(formSelector, data);
      }
      return { success: true };
    }

    case 'FILL_OTP': {
      if (message.payload) {
        const { otp, fieldSelectors } = message.payload as {
          otp: string;
          fieldSelectors?: string[];
        };
        await autoFiller.fillOTP(otp, fieldSelectors);
      }
      return { success: true };
    }

    case 'AUTO_FILL_OTP': {
      if (message.payload) {
        const {
          otp,
          source = 'unknown',
          confidence = 1,
          isBackgroundTab = false,
        } = message.payload as { otp: string; source?: string; confidence?: number; isBackgroundTab?: boolean };
        const filled = await otpPageDetector.handleAutoFill({ otp, source, confidence, isBackgroundTab });
        return { success: filled, filled };
      }
      return { success: false, error: 'No OTP provided' };
    }

    case 'POLLING_STATE_CHANGE': {
      if (message.payload && message.payload.state) {
        otpPageDetector.handlePollingStateChange(message.payload.state as 'ANALYZING_EMAIL' | 'LINK_ACTIVATION_STARTED');
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

function safeInit() {
  if (isInitialized) {
    return;
  }

  // Cleanup event listeners to prevent memory leaking
  document.removeEventListener('DOMContentLoaded', safeInit);
  window.removeEventListener('load', safeInit);

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

  isInitialized = true;

  // Double requestAnimationFrame ensures initial CSS has been applied
  // and the page has been painted at least once, preventing FOUC and
  // ensuring correct dimension reads for UI injection.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      init();
    });
  });
}

// Initialize safely preventing DOM node load hazards
if (document.readyState === 'complete') {
  safeInit();
} else {
  document.addEventListener('DOMContentLoaded', safeInit);
  window.addEventListener('load', safeInit);
}

// Export for testing
export { formDetector, fieldAnalyzer, autoFiller, floatingButton, domObserver, otpPageDetector };
