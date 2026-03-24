import { createLogger } from '../../../utils/logger';
import { PageContext } from '../../../types/form.types';
import { OTPFieldDiscovery } from './otp-discovery';
import { OTPFiller } from './otp-filler';

const log = createLogger('FieldWatcher');

const FIELD_WATCHER_DEBOUNCE_MS = 300;
const FIELD_WATCHER_POLL_INTERVAL_MS = 1000;

export class FieldWatcher {
  private observer: MutationObserver | null = null;
  private pendingOTP: string | null = null;
  private pendingContext: PageContext | null = null;
  private debounceTimeout: ReturnType<typeof setTimeout> | null = null;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private safetyTimeout: ReturnType<typeof setTimeout> | null = null;
  private isActive = false;

  /**
   * Watch for dynamically-rendered OTP fields.
   * Resolves `true` if OTP was filled, `false` on timeout.
   */
  async watch(
    otp: string,
    context: PageContext,
    timeoutMs: number
  ): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.isActive) {
        this.stop();
      }

      this.isActive = true;
      this.pendingOTP = otp;
      this.pendingContext = context;

      let resolved = false;

      const resolveOnce = (result: boolean): void => {
        if (resolved) return;
        resolved = true;
        this.stop();
        resolve(result);
      };

      const checkFields = async (): Promise<void> => {
        if (!this.pendingOTP || !this.pendingContext || resolved) return;

        const group = OTPFieldDiscovery.discover(this.pendingContext);
        if (!group) return;

        const otpToFill = this.pendingOTP;
        const framework = this.pendingContext.framework;

        const result = await OTPFiller.fill(otpToFill, group, framework);
        if (result.success) {
          resolveOnce(true);
        }
      };

      // MutationObserver for DOM changes
      this.observer = new MutationObserver(() => {
        if (this.debounceTimeout) clearTimeout(this.debounceTimeout);
        this.debounceTimeout = setTimeout(() => {
          void checkFields();
        }, FIELD_WATCHER_DEBOUNCE_MS);
      });

      if (document.body) {
        this.observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['style', 'class', 'hidden'],
        });
      }

      // Polling fallback
      this.pollingInterval = setInterval(() => {
        void checkFields();
      }, FIELD_WATCHER_POLL_INTERVAL_MS);

      // Safety timeout
      this.safetyTimeout = setTimeout(() => {
        resolveOnce(false);
      }, timeoutMs);
    });
  }

  stop(): void {
    this.isActive = false;

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
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
    log.debug('FieldWatcher stopped');
  }
}
