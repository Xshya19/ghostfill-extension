import { createLogger } from '../../../utils/logger';
import { FormInputElement, FrameworkType } from '../../../types/form.types';
import { PhantomTyper } from './phantom-typer';
import { VisibilityEngine } from '../utils/dom-utils';

const log = createLogger('FieldSetter');

/**
 * FRAMEWORK-AWARE FIELD SETTER
 * Handles setting values in input fields with compatibility for React, Vue, Angular, etc.
 */
export class FieldSetter {
  private static readonly SETTABLE_INPUT_TYPES = new Set([
    'text', 'tel', 'number', 'password', 'email', 'url', 'search', '',
  ]);

  static async setValue(
    element: FormInputElement,
    value: string,
    _framework: FrameworkType = 'unknown',
    isBackgroundTab: boolean = false
  ): Promise<boolean> {
    if (!element.isConnected) return false;

    const strategies = [
      {
        name: 'PhantomTyper',
        fn: async () => {
          if (isBackgroundTab) return false; // PhantomTyper fails in background tabs due to strict focus rules
          await PhantomTyper.typeSimulatedString(element, value);
          return element.value === value;
        },
      },
      {
        name: 'NativeSetter',
        fn: () => this.setViaNativeSetter(element, value),
      },
      {
        name: 'InputEventSequence',
        fn: () => {
          this.setViaInputEvent(element, value);
          return element.value === value;
        },
      },
      {
        name: 'DirectAssignment',
        fn: () => {
          element.value = value;
          this.dispatchFullEventChain(element, value);
          return element.value === value;
        },
      },
      {
        name: 'ClipboardPaste',
        fn: () => this.setViaClipboardPaste(element, value),
      },
    ];

    for (const strategy of strategies) {
      try {
        const success = await strategy.fn();
        if (success) {
          log.debug(`Field set via ${strategy.name}`);
          return true;
        }
      } catch (error) {
        log.debug(`Strategy ${strategy.name} failed`, error);
      }
    }

    log.warn('All field-setting strategies exhausted', {
      id: element.id,
      name: (element as HTMLInputElement).name,
    });
    return false;
  }

  static async setCharDirect(element: HTMLInputElement, char: string, isBackgroundTab: boolean = false): Promise<boolean> {
    if (!element.isConnected) return false;

    if (isBackgroundTab) {
      return this.setViaNativeSetter(element, char);
    }

    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    const writeValue = (v: string) => nativeSetter ? nativeSetter.call(element, v) : (element.value = v);

    try {
      writeValue('');
      element.dispatchEvent(new Event('input', { bubbles: true }));

      const keyCode = char.charCodeAt(0);
      const code = /^[0-9]$/.test(char) ? `Digit${char}` : `Key${char.toUpperCase()}`;
      
      element.dispatchEvent(new KeyboardEvent('keydown', { key: char, code, keyCode, bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keypress', { key: char, code, keyCode, charCode: keyCode, bubbles: true }));

      const beforeInput = new InputEvent('beforeinput', { data: char, inputType: 'insertText', bubbles: true, cancelable: true });
      if (!element.dispatchEvent(beforeInput)) return false;

      writeValue(char);
      element.dispatchEvent(new InputEvent('input', { data: char, inputType: 'insertText', bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keyup', { key: char, code, keyCode, bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));

      return element.value === char || (element.value.length > 0 && element.type === 'password');
    } catch (err) {
      log.warn('setCharDirect failed', err);
      writeValue(char);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      return element.value === char;
    }
  }

  private static setViaNativeSetter(element: FormInputElement, value: string): boolean {
    const proto = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (!nativeSetter) {
      element.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return element.value === value;
    }

    element.focus();
    nativeSetter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return element.value === value;
  }

  private static setViaInputEvent(element: FormInputElement, value: string): void {
    element.focus();
    const proto = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    const writeValue = (v: string) => nativeSetter ? nativeSetter.call(element, v) : (element.value = v);

    writeValue('');
    let accumulated = '';
    for (const char of value) {
      element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: char }));
      accumulated += char;
      writeValue(accumulated);
      element.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: false, inputType: 'insertText', data: char }));
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  private static dispatchFullEventChain(element: FormInputElement, value: string): void {
    element.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
  }

  private static async setViaClipboardPaste(element: FormInputElement, value: string): Promise<boolean> {
    // Ported from autoFiller.ts (setViaClipboardPaste section)
    // Simplified for now, full port includes clipboard restoration
    try {
      if (!navigator.clipboard) return false;
      await navigator.clipboard.writeText(value);
      element.focus();
      return true; // Simplified success detection
    } catch { return false; }
  }
}
