import { createLogger } from '../../../utils/logger';
import { OTPFieldGroup } from '../types';
import { delay, safeQuerySelector, VisibilityEngine } from '../utils/dom-utils';

const log = createLogger('AutoSubmitDetector');

/**
 * AUTO-SUBMIT DETECTOR
 * Identifies and highlights possible submit buttons after OTP filling.
 */
export class AutoSubmitDetector {
  private static readonly SELECTORS: readonly string[] = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:not([type="button"]):not([type="reset"])',
    'button[class*="submit" i]',
    'button[class*="verify" i]',
    'button[class*="confirm" i]',
    'button[class*="continue" i]',
    'a[class*="submit" i]',
    'a[class*="verify" i]',
  ];

  private static readonly TEXT_PATTERN = /verify|confirm|submit|continue|next|send|done|log\s*in|sign\s*in/i;

  static async checkAndHighlight(group: OTPFieldGroup): Promise<void> {
    await delay(1000); // Wait for framework stability
    const button = this.findButton(group);
    if (button) {
      log.info('Found submit button — highlighting');
      this.highlight(button);
    }
  }

  private static findButton(group: OTPFieldGroup): HTMLElement | null {
    const field = group.fields[0];
    if (!field) return null;

    const container = field.closest('form') ?? 
                      field.closest('[class*="otp"]') ?? 
                      field.closest('[class*="verify"]') ??
                      field.parentElement?.parentElement?.parentElement;

    if (!container) return null;

    for (const selector of this.SELECTORS) {
      const button = safeQuerySelector<HTMLElement>(container, selector);
      if (button && VisibilityEngine.isVisible(button)) {
        const text = (button.textContent ?? '').toLowerCase().trim();
        if (this.TEXT_PATTERN.test(text)) return button;
      }
    }
    return null;
  }

  private static highlight(button: HTMLElement): void {
    const original = button.style.outline;
    button.style.outline = '2px solid #4CAF50';
    button.style.outlineOffset = '2px';
    setTimeout(() => { button.style.outline = original; }, 3000);
  }
}
