import { createLogger } from '../../../utils/logger';
import { FrameworkType, OTPFillOutcome } from '../../../types/form.types';
import { OTPFieldGroup } from '../types';
import { FieldSetter } from './field-setter';
import { delay } from '../utils/dom-utils';

const log = createLogger('OTPFiller');

/**
 * OTP FILLER ENGINE
 * Orchestrates the filling of single or split OTP fields.
 */
export class OTPFiller {
  static async fill(
    otp: string,
    group: OTPFieldGroup,
    framework: FrameworkType,
    isBackgroundTab: boolean = false
  ): Promise<OTPFillOutcome> {
    const cleanOTP = otp.replace(/[-\s]/g, '');
    if (cleanOTP.length === 0) return { success: false, filledCount: 0, strategy: 'none' };

    return group.isSplit
      ? this.fillSplit(cleanOTP, group.fields, framework, isBackgroundTab)
      : this.fillSingle(cleanOTP, group.fields[0], framework, isBackgroundTab);
  }

  private static async fillSingle(otp: string, field: HTMLInputElement, framework: FrameworkType, isBackgroundTab: boolean = false): Promise<OTPFillOutcome> {
    if (!field) return { success: false, filledCount: 0, strategy: 'single-field' };
    const success = await FieldSetter.setValue(field, otp, framework, isBackgroundTab);
    return { success, filledCount: success ? 1 : 0, strategy: 'single-field' };
  }

  private static async fillSplit(digits: string, fields: HTMLInputElement[], framework: FrameworkType, isBackgroundTab: boolean = false): Promise<OTPFillOutcome> {
    const total = Math.min(digits.length, fields.length);
    let filledCount = 0;

    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (i < total) {
        const success = await FieldSetter.setCharDirect(field, digits[i]!, isBackgroundTab);
        if (success) filledCount++;
      }
      if (i < fields.length - 1) {
        await delay(35);
        // Only trigger blur and advance focus if the site's own Javascript hasn't already done it
        if (!isBackgroundTab && document.activeElement === field) {
           field.blur();
           const nextField = fields[i + 1];
           if (nextField) {
             nextField.focus({ preventScroll: true });
           }
        }
      }
    }
    return { success: filledCount === total, filledCount, strategy: 'split-field' };
  }
}
