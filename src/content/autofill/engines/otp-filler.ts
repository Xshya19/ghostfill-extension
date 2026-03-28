import { FrameworkType, OTPFillOutcome } from '../../../types/form.types';
import { OTPFieldGroup } from '../types';
import { delay } from '../utils/dom-utils';
import { FieldSetter } from './field-setter';
import { PhantomTyper } from './phantom-typer';

const SPLIT_FIELD_SETTLE_MS = 50;

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
    if (cleanOTP.length === 0) {
      return { success: false, filledCount: 0, strategy: 'none' };
    }

    return group.isSplit
      ? this.fillSplit(cleanOTP, group.fields, framework, isBackgroundTab)
      : this.fillSingle(otp, group.fields[0], framework, isBackgroundTab);
  }

  private static async fillSingle(otp: string, field: HTMLInputElement, framework: FrameworkType, isBackgroundTab: boolean = false): Promise<OTPFillOutcome> {
    if (!field) {
      return { success: false, filledCount: 0, strategy: 'single-field' };
    }
    const success = await FieldSetter.setValue(field, otp, framework, isBackgroundTab);
    return { success, filledCount: success ? 1 : 0, strategy: 'single-field' };
  }

  private static async fillSplit(digits: string, fields: HTMLInputElement[], framework: FrameworkType, isBackgroundTab: boolean = false): Promise<OTPFillOutcome> {
    const total = Math.min(digits.length, fields.length);
    let filledCount = 0;

    if (!isBackgroundTab) {
      const pasted = await this.tryPasteDistributedCode(digits.slice(0, total), fields);
      if (pasted) {
        return { success: true, filledCount: total, strategy: 'split-field-paste' };
      }
    }

    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (i < total) {
        const success = isBackgroundTab
          ? await FieldSetter.setCharDirect(field, digits[i]!, true)
          : await this.typeIntoSplitField(field, digits[i]!);
        if (success) {
          filledCount++;
        }
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

    const finalValue = this.readSplitValue(fields).slice(0, total);
    const success = finalValue === digits.slice(0, total);
    return {
      success,
      filledCount: success ? total : filledCount,
      strategy: 'split-field',
    };
  }

  private static async typeIntoSplitField(
    field: HTMLInputElement,
    char: string
  ): Promise<boolean> {
    field.focus({ preventScroll: true });
    field.click();
    await delay(10);

    await PhantomTyper.typeSimulatedString(field, char);
    await delay(SPLIT_FIELD_SETTLE_MS);

    return field.value === char || (field.value.length > 0 && field.type === 'password');
  }

  private static async tryPasteDistributedCode(
    digits: string,
    fields: HTMLInputElement[]
  ): Promise<boolean> {
    const target = fields.find((field) => document.activeElement === field) ?? fields[0];
    if (!target) {
      return false;
    }

    try {
      target.focus({ preventScroll: true });
      target.click();

      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', digits);

      target.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: dataTransfer,
          bubbles: true,
          cancelable: true,
        })
      );

      target.dispatchEvent(
        new InputEvent('beforeinput', {
          data: digits,
          inputType: 'insertFromPaste',
          bubbles: true,
          cancelable: true,
        })
      );

      target.dispatchEvent(
        new InputEvent('input', {
          data: digits,
          inputType: 'insertFromPaste',
          bubbles: true,
        })
      );

      await delay(80);
      return this.readSplitValue(fields).slice(0, digits.length) === digits;
    } catch {
      return false;
    }
  }

  private static readSplitValue(fields: HTMLInputElement[]): string {
    return fields.map((field) => field.value ?? '').join('');
  }
}
