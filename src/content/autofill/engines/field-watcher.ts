import { PageContext } from '../../../types/form.types';
import { createLogger } from '../../../utils/logger';
import { OTPFieldDiscovery } from './otp-discovery';
import { OTPFiller } from './otp-filler';

const log = createLogger('FieldWatcher');

const FIELD_WATCHER_DEBOUNCE_MS = 300;
const FIELD_WATCHER_POLL_INTERVAL_MS = 1000;

export class FieldWatcher {
  private observer: MutationObserver | null = null;
  private shadowObservers: MutationObserver[] = [];
  private pendingOTP: string | null = null;
  private pendingContext: PageContext | null = null;
  private pendingResolve: ((result: boolean) => void) | null = null;
  private debounceTimeout: ReturnType<typeof setTimeout> | null = null;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private safetyTimeout: ReturnType<typeof setTimeout> | null = null;
  private knownShadowRoots = new Set<ShadowRoot>();
  private isActive = false;

  /**
   * Watch for dynamically-rendered OTP fields.
   * Resolves `true` if OTP was filled, `false` on timeout.
   */
  async watch(otp: string, context: PageContext, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.isActive) {
        this.stop();
      }

      this.isActive = true;
      this.pendingOTP = otp;
      this.pendingContext = context;

      let resolved = false;

      const resolveOnce = (result: boolean): void => {
        if (resolved) {
          return;
        }
        resolved = true;
        this.pendingResolve = null;
        this.stop();
        resolve(result);
      };
      this.pendingResolve = resolveOnce;

      const checkFields = async (): Promise<void> => {
        if (!this.pendingOTP || !this.pendingContext || resolved) {
          return;
        }

        const group = OTPFieldDiscovery.discover(this.pendingContext);
        if (!group) {
          return;
        }

        const otpToFill = this.pendingOTP;
        const framework = this.pendingContext.framework;

        const result = await OTPFiller.fill(otpToFill, group, framework);
        if (result.success) {
          resolveOnce(true);
        }
      };

      // MutationObserver for DOM changes
      this.observer = new MutationObserver(() => {
        this.onMutation();
      });

      if (document.body) {
        this.observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['style', 'class', 'hidden'],
        });
      }

      // Special observer for shadow root attachments if supported by browser/site
      if (document.body) {
        this.scanAndObserveShadowRoots(document.body);
      }

      // Run one immediate check so already-rendered late DOM does not wait for the
      // first poll or mutation tick.
      void checkFields();

      // Polling fallback (scans both Light and Shadow DOM)
      this.pollingInterval = setInterval(() => {
        void checkFields();
        if (document.body) {
          this.scanAndObserveShadowRoots(document.body);
        }
      }, FIELD_WATCHER_POLL_INTERVAL_MS);

      // Safety timeout
      this.safetyTimeout = setTimeout(() => {
        resolveOnce(false);
      }, timeoutMs);
    });
  }

  private onMutation(): void {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }
    this.debounceTimeout = setTimeout(() => {
      void this.handleMutationTick();
    }, FIELD_WATCHER_DEBOUNCE_MS);
  }

  private async handleMutationTick(): Promise<void> {
    if (!this.pendingContext || !this.pendingOTP) {
      return;
    }

    if (document.body) {
      // Re-scan for new shadow roots on mutation
      this.scanAndObserveShadowRoots(document.body);
    }

    const group = OTPFieldDiscovery.discover(this.pendingContext);
    if (group && this.pendingOTP) {
      const result = await OTPFiller.fill(this.pendingOTP, group, this.pendingContext.framework);
      if (result.success) {
        this.pendingResolve?.(true);
      }
    }
  }

  private scanAndObserveShadowRoots(root: ParentNode): void {
    const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_ELEMENT, null);
    let node = walker.nextNode();
    while (node) {
      const shadow = (node as Element).shadowRoot;
      if (shadow && !this.knownShadowRoots.has(shadow)) {
        this.knownShadowRoots.add(shadow);

        // Attach observer to the new shadow root
        const obs = new MutationObserver(() => this.onMutation());
        obs.observe(shadow, { childList: true, subtree: true, attributes: true });
        this.shadowObservers.push(obs);

        // We don't store individual observers in a map to keep it simple,
        // they'll be cleaned up when the shadow root is detached or we stop()
      }
      node = walker.nextNode();
    }
  }

  stop(): void {
    this.isActive = false;

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.shadowObservers.forEach((observer) => observer.disconnect());
    this.shadowObservers = [];
    this.knownShadowRoots.clear();

    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    if (this.safetyTimeout) {
      clearTimeout(this.safetyTimeout);
      this.safetyTimeout = null;
    }

    this.pendingOTP = null;
    this.pendingContext = null;
    this.pendingResolve = null;
    log.debug('FieldWatcher stopped');
  }
}
