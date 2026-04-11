// DOM Observer - Watch for dynamic form changes

import { debounce } from '../utils/debounce';
import { createLogger } from '../utils/logger';
import { AutoFiller } from './autoFiller';
import { FormDetector } from './formDetector';

const log = createLogger('DOMObserver');

interface DebouncedMutationHandler {
  (mutations: MutationRecord[]): void;
  cancel: () => void;
}

export class DOMObserver {
  private observer: MutationObserver | null = null;
  private isObserving: boolean = false;
  private urlCheckInterval: number | null = null;
  private lastUrl: string = '';
  // SECURITY/RELIABILITY FIX: Track the debounced handler so it can be explicitly cancelled on stop()
  private debouncedHandler: DebouncedMutationHandler | null = null;

  constructor(
    private formDetector: FormDetector,
    private autoFiller: AutoFiller
  ) {
    this.handleSpaNavigation = this.handleSpaNavigation.bind(this);
  }

  /**
   * Start observing DOM changes
   */
  start(): void {
    if (this.isObserving) {
      return;
    }

    const debouncedUpdate = debounce(() => {
      if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
        this.stop();
        return;
      }
      log.debug('DOM changed, re-detecting forms and icons');
      this.formDetector.detectForms();
      void this.autoFiller.injectIcons();
    }, 1500);

    this.debouncedHandler = debouncedUpdate as unknown as DebouncedMutationHandler;

    // Create observer
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
              // PERF FIX: Only run deep querySelector on major structural containers
              if (tag === 'DIV' || tag === 'MAIN' || tag === 'SECTION' || tag.includes('-')) {
                if (node.querySelector('form, input, textarea, select')) {
                  shouldRedetect = true;
                  break;
                }
              }
            }
          }
        }
        if (shouldRedetect) {
          break;
        }
      }

      if (shouldRedetect && typeof chrome !== 'undefined' && chrome.runtime?.id) {
        debouncedUpdate();
      }
    });

    // Start observing
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['type', 'name', 'id', 'placeholder', 'class'],
    });

    this.isObserving = true;
    this.lastUrl = location.href;

    // Polling for pushState/replaceState
    this.urlCheckInterval = window.setInterval(() => {
      // CONTEXT INVADED GUARD: If extension reloaded, stop the observer to avoid errors
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
    this.lastUrl = location.href;
    log.debug('SPA navigation detected, restarting observer');
    this.restart();
  };

  /**
   * Stop observing
   */
  stop(): void {
    // Cancel pending debounced mutations to prevent memory leaks
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

  /**
   * Restart observer
   */
  restart(): void {
    this.stop();
    this.start();
  }
}
