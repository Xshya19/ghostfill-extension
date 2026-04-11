import { FrameworkType, OTPFillOutcome } from '../../../types/form.types';
import { OTPFieldGroup } from '../types';
import { delay } from '../utils/dom-utils';
import { FieldSetter } from './field-setter';
import { PhantomTyper } from './phantom-typer';

const SPLIT_FIELD_SETTLE_MS = 50;
const AUTO_ADVANCE_DETECT_DELAY = 15;

/**
 * OTP FILLER ENGINE
 * Orchestrates the filling of single or split OTP fields.
 * Handles: single inputs, split digit boxes, contenteditable, shadow DOM,
 * auto-advancing fields, paste-distribution, and framework-controlled inputs.
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

    // Check if this is a contenteditable group
    const isEditableGroup = group.signals?.includes('contenteditable');
    if (isEditableGroup) {
      return this.fillContentEditable(
        cleanOTP,
        group.fields as unknown as HTMLElement[],
        framework
      );
    }

    return group.isSplit
      ? this.fillSplit(cleanOTP, group.fields, framework, isBackgroundTab)
      : this.fillSingle(otp, group.fields[0]!, framework, isBackgroundTab);
  }

  private static async fillSingle(
    otp: string,
    field: HTMLInputElement,
    framework: FrameworkType,
    isBackgroundTab: boolean = false
  ): Promise<OTPFillOutcome> {
    if (!field) {
      return { success: false, filledCount: 0, strategy: 'single-field' };
    }

    // For single-input split OTP (letter-spacing styled), use clean OTP
    const cleanOTP = otp.replace(/[-\s]/g, '');
    const valueToSet = field.type === 'number' ? cleanOTP : otp;

    const success = await FieldSetter.setValue(field, valueToSet, framework, isBackgroundTab);
    return { success, filledCount: success ? 1 : 0, strategy: 'single-field' };
  }

  private static async fillSplit(
    digits: string,
    fields: HTMLInputElement[],
    framework: FrameworkType,
    isBackgroundTab: boolean = false
  ): Promise<OTPFillOutcome> {
    const total = Math.min(digits.length, fields.length);
    let filledCount = 0;

    // Strategy 1: Try paste distribution first (fastest if it works)
    if (!isBackgroundTab) {
      const pasted = await this.tryPasteDistributedCode(digits.slice(0, total), fields);
      if (pasted) {
        return { success: true, filledCount: total, strategy: 'split-field-paste' };
      }
    }

    // Strategy 2: Detect if site auto-advances focus
    const autoAdvances = await this.detectAutoAdvance(fields[0]);

    // Strategy 3: Character-by-character filling
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (!field) continue;

      if (i < total) {
        const success = isBackgroundTab
          ? await FieldSetter.setCharDirect(field, digits[i]!, true)
          : await this.typeIntoSplitField(field, digits[i]!);
        if (success) {
          filledCount++;
        }
      }

      // Focus management: only advance if site doesn't auto-advance
      if (i < fields.length - 1) {
        await delay(autoAdvances ? 10 : 35);

        if (!isBackgroundTab && !autoAdvances && document.activeElement === field) {
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

  /**
   * Fill contenteditable OTP fields (divs/spans with contenteditable="true")
   */
  private static async fillContentEditable(
    digits: string,
    fields: HTMLElement[],
    _framework: FrameworkType
  ): Promise<OTPFillOutcome> {
    const total = Math.min(digits.length, fields.length);
    let filledCount = 0;

    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (!field) continue;

      if (i < total) {
        const char = digits[i]!;
        field.focus({ preventScroll: true });
        field.textContent = char;

        field.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: char,
          })
        );
        field.dispatchEvent(new Event('change', { bubbles: true }));

        if (field.textContent === char) {
          filledCount++;
        }
      }

      if (i < fields.length - 1) {
        await delay(30);
        if (document.activeElement === field) {
          field.blur();
          const nextField = fields[i + 1];
          if (nextField) {
            nextField.focus({ preventScroll: true });
          }
        }
      }
    }

    const finalValue = fields
      .map((f) => f.textContent ?? '')
      .join('')
      .slice(0, total);
    const success = finalValue === digits.slice(0, total);
    return {
      success,
      filledCount: success ? total : filledCount,
      strategy: 'contenteditable-split',
    };
  }

  /**
   * Detect if a site auto-advances focus after typing a character.
   * Some sites (like Google, Microsoft) automatically move focus to the next field.
   */
  private static async detectAutoAdvance(field: HTMLInputElement | undefined): Promise<boolean> {
    if (!field) return false;

    try {
      field.focus({ preventScroll: true });
      const initialActive = document.activeElement;

      // Simulate a single character input
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(field, '1');
      } else {
        field.value = '1';
      }
      field.dispatchEvent(new InputEvent('input', { bubbles: true, data: '1' }));

      // Wait briefly for any auto-advance to occur
      await delay(AUTO_ADVANCE_DETECT_DELAY);

      // If focus moved away from our field, the site auto-advances
      const autoAdvances = document.activeElement !== field;

      // Clean up the test character
      field.value = '';
      field.dispatchEvent(new InputEvent('input', { bubbles: true }));

      return autoAdvances;
    } catch {
      return false;
    }
  }

  private static async typeIntoSplitField(field: HTMLInputElement, char: string): Promise<boolean> {
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

      // Dispatch paste event
      target.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: dataTransfer,
          bubbles: true,
          cancelable: true,
        })
      );

      // Also dispatch beforeinput and input events for frameworks that listen to these
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
