import { FormInputElement, FrameworkType } from '../../types/form.types';
import { createLogger } from '../../utils/logger';
import { getRandomInt } from '../../utils/encryption';
import { OTPFieldGroup } from './types';

const log = createLogger('AutofillFormFiller');

// ─────────────────────────────────────────────────────────────
//  DOM Utilities (inlined for zero-import-overhead)
// ─────────────────────────────────────────────────────────────

export const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function safeQuerySelector<T extends Element>(root: ParentNode, selector: string): T | null {
  try {
    return root.querySelector<T>(selector);
  } catch {
    return null;
  }
}

export class VisibilityEngine {
  static isVisible(element: HTMLElement): boolean {
    if (!element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }
  static isVisibleRelaxed(element: HTMLElement): boolean {
    if (!element.isConnected) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none';
  }
  static isFillable(element: HTMLInputElement | HTMLTextAreaElement): boolean {
    return this.isVisible(element) && !element.disabled && !element.readOnly;
  }
  static isFillableRelaxed(element: HTMLInputElement | HTMLTextAreaElement): boolean {
    return this.isVisibleRelaxed(element) && !element.disabled && !element.readOnly;
  }
}

// ─────────────────────────────────────────────────────────────
//  PhantomTyper - Human-like synthetic keystroke engine
// ─────────────────────────────────────────────────────────────

/** Minimum yield between characters (ms). Allows framework digest cycles. */
const INTER_CHAR_YIELD_MS = 1;
const JITTER_MS = 3; // Max random jitter for "smoothness"
const MAX_INPUT_LENGTH = 1024;

const nativeInputSetter: ((this: HTMLInputElement, value: string) => void) | null = (() => {
  try {
    return Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set ?? null;
  } catch {
    return null;
  }
})();

const nativeTextAreaSetter: ((this: HTMLTextAreaElement, value: string) => void) | null = (() => {
  try {
    return Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set ?? null;
  } catch {
    return null;
  }
})();

class KeyMapper {
  private static readonly SPECIAL_CHARS: Readonly<Record<string, string>> = {
    ' ': 'Space',
    '\t': 'Tab',
    '\n': 'Enter',
    '@': 'Digit2',
    '#': 'Digit3',
    $: 'Digit4',
    '%': 'Digit5',
    '^': 'Digit6',
    '&': 'Digit7',
    '*': 'Digit8',
    '(': 'Digit9',
    ')': 'Digit0',
    '-': 'Minus',
    _: 'Minus',
    '=': 'Equal',
    '+': 'Equal',
    '[': 'BracketLeft',
    '{': 'BracketLeft',
    ']': 'BracketRight',
    '}': 'BracketRight',
    '\\': 'Backslash',
    '|': 'Backslash',
    ';': 'Semicolon',
    ':': 'Semicolon',
    "'": 'Quote',
    '"': 'Quote',
    ',': 'Comma',
    '<': 'Comma',
    '.': 'Period',
    '>': 'Period',
    '/': 'Slash',
    '?': 'Slash',
    '`': 'Backquote',
    '~': 'Backquote',
    '!': 'Digit1',
  };

  static getCode(char: string): string {
    if (/^[a-zA-Z]$/.test(char)) return `Key${char.toUpperCase()}`;
    if (/^[0-9]$/.test(char)) return `Digit${char}`;
    if (this.SPECIAL_CHARS[char]) return this.SPECIAL_CHARS[char];
    if (char.charCodeAt(0) > 127) return 'Unidentified';
    return `Key${char.toUpperCase()}`;
  }

  static requiresShift(char: string): boolean {
    if (/^[A-Z]$/.test(char)) return true;
    return '~!@#$%^&*()_+{}|:"<>?'.includes(char);
  }
}

class NativeValueWriter {
  static setValue(element: FormInputElement, value: string): void {
    if (element instanceof HTMLInputElement && nativeInputSetter) {
      nativeInputSetter.call(element, value);
    } else if (element instanceof HTMLTextAreaElement && nativeTextAreaSetter) {
      nativeTextAreaSetter.call(element, value);
    } else {
      element.value = value;
    }
  }
}

class EventFactory {
  static keyboard(
    type: 'keydown' | 'keypress' | 'keyup',
    char: string,
    options?: { cancelable?: boolean }
  ): KeyboardEvent {
    const code = KeyMapper.getCode(char);
    let keyCode = char.charCodeAt(0);
    if (/^[a-z]$/.test(char)) {
      keyCode = char.toUpperCase().charCodeAt(0);
    } else if (KeyMapper.requiresShift(char)) {
      const unshiftedMap: Record<string, string> = {
        '~': '`', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
        '_': '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/',
      };
      if (unshiftedMap[char]) {
        keyCode = unshiftedMap[char].charCodeAt(0);
      }
    }

    const shiftKey = KeyMapper.requiresShift(char);
    return new KeyboardEvent(type, {
      key: char,
      code,
      keyCode,
      which: keyCode,
      charCode: type === 'keypress' ? keyCode : 0,
      bubbles: true,
      cancelable: options?.cancelable ?? true,
      composed: true,
      shiftKey,
    });
  }

  static input(char: string): InputEvent {
    return new InputEvent('input', {
      data: char,
      inputType: 'insertText',
      bubbles: true,
      cancelable: false,
      composed: true,
    });
  }

  static beforeInput(char: string): InputEvent {
    return new InputEvent('beforeinput', {
      data: char,
      inputType: 'insertText',
      bubbles: true,
      cancelable: true,
      composed: true,
    });
  }

  static generic(type: string, options?: { bubbles?: boolean; cancelable?: boolean }): Event {
    return new Event(type, {
      bubbles: options?.bubbles ?? true,
      cancelable: options?.cancelable ?? false,
    });
  }

  static focus(type: 'focus' | 'focusin' | 'blur' | 'focusout'): FocusEvent {
    const bubbles = type === 'focusin' || type === 'focusout';
    return new FocusEvent(type, { bubbles, composed: true });
  }

  static pointer(type: string, options?: { buttons?: number }): PointerEvent {
    return new PointerEvent(type, {
      bubbles: true,
      composed: true,
      pointerType: 'mouse',
      buttons: options?.buttons ?? 0,
      isPrimary: true,
    });
  }

  static mouse(type: string, options?: { buttons?: number }): MouseEvent {
    return new MouseEvent(type, {
      bubbles: true,
      composed: true,
      buttons: options?.buttons ?? 0,
    });
  }
}

export class PhantomTyper {
  private static readonly sessionMap = new WeakMap<HTMLElement, number>();
  private static sessionCounter = 0;

  static async typeSimulatedString(element: FormInputElement, text: string): Promise<void> {
    if (!element || !element.isConnected) {
      log.warn('PhantomTyper: element not connected to DOM');
      return;
    }

    if (text.length > MAX_INPUT_LENGTH) {
      log.warn('PhantomTyper: text exceeds maximum length', { length: text.length, max: MAX_INPUT_LENGTH });
      text = text.slice(0, MAX_INPUT_LENGTH);
    }

    const sessionId = ++this.sessionCounter;
    this.sessionMap.set(element, sessionId);

    const isActive = (): boolean => this.sessionMap.get(element) === sessionId && element.isConnected;

    try {
      if (!this.dispatchPointerEngagement(element, isActive)) return;

      if (!isActive()) return;
      element.focus({ preventScroll: true });
      element.dispatchEvent(EventFactory.focus('focus'));
      element.dispatchEvent(EventFactory.focus('focusin'));

      if (!isActive()) return;

      NativeValueWriter.setValue(element, '');
      element.dispatchEvent(EventFactory.generic('input', { bubbles: true }));

      for (let i = 0; i < text.length; i++) {
        if (!isActive()) {
          log.debug('PhantomTyper session interrupted', { at: i, total: text.length });
          return;
        }

        this.typeCharacter(element, text[i]!);

        if (i < text.length - 1) {
          const isSensitive = /pass|pin|otp|code/i.test(element.name || element.id || element.type);
          const baseYield = isSensitive ? 15 : INTER_CHAR_YIELD_MS;
          const jitter = getRandomInt(0, JITTER_MS - 1);
          await delay(baseYield + jitter);
        }
      }

      if (!isActive()) return;

      element.dispatchEvent(EventFactory.generic('change', { bubbles: true }));
      element.dispatchEvent(EventFactory.pointer('pointerout'));
      element.dispatchEvent(EventFactory.pointer('pointerleave'));
    } catch (error) {
      log.warn('PhantomTyper error', {
        error: error instanceof Error ? error.message : String(error),
        length: text.length,
      });
    }
  }

  private static dispatchPointerEngagement(element: FormInputElement, isActive: () => boolean): boolean {
    const pointerEvents: Array<[string, { buttons?: number }?]> = [
      ['pointerover'],
      ['pointerenter'],
      ['pointerdown', { buttons: 1 }],
    ];

    for (const [type, opts] of pointerEvents) {
      if (!isActive()) return false;
      element.dispatchEvent(EventFactory.pointer(type, opts));
    }

    if (!isActive()) return false;
    element.dispatchEvent(EventFactory.mouse('mousedown', { buttons: 1 }));
    return true;
  }

  private static typeCharacter(element: FormInputElement, char: string): void {
    element.dispatchEvent(EventFactory.keyboard('keydown', char));
    element.dispatchEvent(EventFactory.keyboard('keypress', char));

    const beforeInputEvent = EventFactory.beforeInput(char);
    const allowed = element.dispatchEvent(beforeInputEvent);
    if (!allowed) {
      log.debug('PhantomTyper: beforeinput event was cancelled by host framework', { char });
    }

    const newValue = element.value + char;
    NativeValueWriter.setValue(element, newValue);
    element.dispatchEvent(EventFactory.input(char));
    element.dispatchEvent(EventFactory.keyboard('keyup', char));
  }
}

// ─────────────────────────────────────────────────────────────
//  FieldSetter - Framework-aware field setter
// ─────────────────────────────────────────────────────────────

export class FieldSetter {
  static async setValue(
    element: FormInputElement,
    value: string,
    _framework: FrameworkType = 'unknown',
    isBackgroundTab: boolean = false
  ): Promise<boolean> {
    if (!element.isConnected) {
      return false;
    }

    const strategies = [
      {
        name: 'PhantomTyper',
        fn: async () => {
          if (isBackgroundTab) return false;
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
        name: 'ReactFiberSetter',
        fn: () => this.setViaReactFiber(element, value),
      },
      {
        name: 'ClipboardPaste',
        fn: () => this.setViaClipboardPaste(element, value),
      },
      {
        name: 'ContentEditableSetter',
        fn: () => this.setViaContentEditable(element, value),
      },
    ];

    for (const strategy of strategies) {
      try {
        const success = await strategy.fn();
        if (success) {
          log.debug(`Field set via ${strategy.name}`);
          return true;
        }
      } catch (err) {
        log.debug(`Strategy ${strategy.name} failed`, err);
      }
    }

    log.warn('All field-setting strategies exhausted, using brute-force fallback');
    try {
      const proto = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(element, value);
      } else {
        element.value = value;
      }

      element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }));
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
      element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

      if (element.value !== value) {
        element.focus();
        element.select?.();
        document.execCommand('insertText', false, value);
      }

      const success = element.value === value || (element.value.length > 0 && element.type === 'password');
      if (success) {
        log.debug('Field set via brute-force fallback');
        return true;
      }
    } catch (err) {
      log.warn('Brute-force fallback also failed', err);
    }

    log.warn('All field-setting strategies exhausted (including brute-force fallback)', { id: element.id, name: element.name });
    return false;
  }

  static async setCharDirect(
    element: HTMLInputElement,
    char: string,
    isBackgroundTab: boolean = false
  ): Promise<boolean> {
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
    const oldValue = element.value;

    if (!nativeSetter) {
      element.value = value;
      const tracker = (element as any)._valueTracker;
      if (tracker) tracker.setValue(oldValue);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return element.value === value;
    }

    element.focus();
    nativeSetter.call(element, value);
    const tracker = (element as any)._valueTracker;
    if (tracker) tracker.setValue(oldValue);
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
    try {
      if (!navigator.clipboard) return false;
      element.focus();

      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', value);
      const pasteEvent = new ClipboardEvent('paste', { clipboardData: dataTransfer, bubbles: true, cancelable: true });
      element.dispatchEvent(pasteEvent);

      if (element.value !== value) {
        return this.setViaNativeSetter(element, value);
      }
      return element.value === value || (element.value.length > 0 && element.type === 'password');
    } catch (err) {
      log.debug('ClipboardPaste failed', err);
      return false;
    }
  }

  private static setViaReactFiber(element: FormInputElement, value: string): boolean {
    try {
      let reactElement: Element | null = element;
      const fiberKey = Object.keys(reactElement).find(
        (key) => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$') || key.startsWith('__reactProps$')
      );

      if (!fiberKey) {
        let parent = element.parentElement;
        while (parent) {
          const parentKey = Object.keys(parent).find(
            (key) => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')
          );
          if (parentKey) {
            reactElement = parent;
            break;
          }
          parent = parent.parentElement;
        }
      }

      if (!reactElement) return false;

      const fiberKeyFound = Object.keys(reactElement).find(
        (key) => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')
      );
      if (!fiberKeyFound) return false;

      const fiber = (reactElement as any)[fiberKeyFound];
      if (!fiber || !fiber.memoizedProps) return false;

      const onChange = fiber.memoizedProps.onChange;
      if (typeof onChange === 'function') {
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(element, value);
        } else {
          element.value = value;
        }

        const event = Object.create(Event.prototype);
        Object.defineProperty(event, 'target', { value: element, enumerable: true });
        Object.defineProperty(event, 'currentTarget', { value: element, enumerable: true });
        Object.defineProperty(event, 'bubbles', { value: true, enumerable: true });

        try {
          onChange(event);
        } catch (e) {
          log.debug('React onChange invocation failed', e);
        }

        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return element.value === value;
      }

      const stateNode = fiber.stateNode;
      if (stateNode && stateNode instanceof HTMLInputElement) {
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(stateNode, value);
        } else {
          stateNode.value = value;
        }
        stateNode.dispatchEvent(new Event('input', { bubbles: true }));
        stateNode.dispatchEvent(new Event('change', { bubbles: true }));
        return stateNode.value === value;
      }
      return false;
    } catch {
      return false;
    }
  }

  private static setViaContentEditable(element: FormInputElement, value: string): boolean {
    try {
      const editableEl = this.findEditableAncestor(element);
      if (!editableEl) return false;

      editableEl.focus();
      editableEl.textContent = '';
      editableEl.textContent = value;

      editableEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      editableEl.dispatchEvent(new Event('change', { bubbles: true }));
      editableEl.dispatchEvent(new FocusEvent('blur', { bubbles: false }));

      if (editableEl.textContent !== value) {
        document.execCommand('insertText', false, value);
      }
      return editableEl.textContent === value;
    } catch {
      return false;
    }
  }

  private static findEditableAncestor(el: HTMLElement | null): HTMLElement | null {
    let current: HTMLElement | null = el;
    while (current) {
      if (current.contentEditable === 'true' || current.contentEditable === 'inherit') {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
//  AutoSubmitDetector - Highlights submit buttons after OTP filling
// ─────────────────────────────────────────────────────────────

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
    const delayMs = Math.min(500 + group.fields.length * 100, 1500);
    await delay(delayMs);

    const button = this.findButton(group);
    if (button) {
      log.info('Found submit button — highlighting');
      this.highlight(button);
    }
  }

  private static findButton(group: OTPFieldGroup): HTMLElement | null {
    const field = group.fields[0];
    if (!field) return null;

    const container =
      field.closest('form') ??
      field.closest('[class*="otp"]') ??
      field.closest('[class*="verify"]') ??
      field.parentElement?.parentElement?.parentElement;

    if (!container) return null;

    for (const selector of this.SELECTORS) {
      const button = safeQuerySelector<HTMLElement>(container, selector);
      if (button && VisibilityEngine.isVisible(button)) {
        const text = (button.textContent ?? '').toLowerCase().trim();
        if (this.TEXT_PATTERN.test(text)) {
          return button;
        }
      }
    }
    return null;
  }

  private static highlight(button: HTMLElement): void {
    const original = button.style.outline;
    button.style.outline = '2px solid #4CAF50';
    button.style.outlineOffset = '2px';
    setTimeout(() => {
      button.style.outline = original;
    }, 3000);
  }
}
