import { FormInputElement, FrameworkType } from '../../../types/form.types';
import { createLogger } from '../../../utils/logger';
import { PhantomTyper } from './phantom-typer';

const log = createLogger('FieldSetter');

/**
 * FRAMEWORK-AWARE FIELD SETTER
 * Handles setting values in input fields with compatibility for React, Vue, Angular, etc.
 */
export class FieldSetter {
  private static readonly SETTABLE_INPUT_TYPES = new Set([
    'text',
    'tel',
    'number',
    'password',
    'email',
    'url',
    'search',
    '',
  ]);

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
          if (isBackgroundTab) {
            return false;
          }
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

    // ── FINAL FALLBACK: Brute-force value assignment ──
    // If all strategies fail, try the most aggressive approach possible:
    // direct value assignment + full event chain + execCommand fallback
    log.warn('All field-setting strategies exhausted, using brute-force fallback');
    try {
      // Try native setter first
      const proto =
        element instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : HTMLTextAreaElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(element, value);
      } else {
        element.value = value;
      }

      // Dispatch every possible event that frameworks might listen to
      element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      element.dispatchEvent(new Event('mousedown', { bubbles: true }));
      element.dispatchEvent(new Event('mouseup', { bubbles: true }));
      element.dispatchEvent(new Event('click', { bubbles: true }));
      element.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: value,
        })
      );
      element.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value })
      );
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
      element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

      // Last resort: execCommand
      if (element.value !== value) {
        element.focus();
        element.select?.();
        document.execCommand('insertText', false, value);
      }

      const success =
        element.value === value || (element.value.length > 0 && element.type === 'password');
      if (success) {
        log.debug('Field set via brute-force fallback');
        return true;
      }
    } catch (err) {
      log.warn('Brute-force fallback also failed', err);
    }

    log.warn('All field-setting strategies exhausted (including brute-force fallback)', {
      id: element.id,
      name: element.name,
    });
    return false;
  }

  static async setCharDirect(
    element: HTMLInputElement,
    char: string,
    isBackgroundTab: boolean = false
  ): Promise<boolean> {
    if (!element.isConnected) {
      return false;
    }

    if (isBackgroundTab) {
      return this.setViaNativeSetter(element, char);
    }

    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    const writeValue = (v: string) =>
      nativeSetter ? nativeSetter.call(element, v) : (element.value = v);

    try {
      writeValue('');
      element.dispatchEvent(new Event('input', { bubbles: true }));

      const keyCode = char.charCodeAt(0);
      const code = /^[0-9]$/.test(char) ? `Digit${char}` : `Key${char.toUpperCase()}`;

      element.dispatchEvent(
        new KeyboardEvent('keydown', { key: char, code, keyCode, bubbles: true })
      );
      element.dispatchEvent(
        new KeyboardEvent('keypress', {
          key: char,
          code,
          keyCode,
          charCode: keyCode,
          bubbles: true,
        })
      );

      const beforeInput = new InputEvent('beforeinput', {
        data: char,
        inputType: 'insertText',
        bubbles: true,
        cancelable: true,
      });
      if (!element.dispatchEvent(beforeInput)) {
        return false;
      }

      writeValue(char);
      element.dispatchEvent(
        new InputEvent('input', { data: char, inputType: 'insertText', bubbles: true })
      );
      element.dispatchEvent(
        new KeyboardEvent('keyup', { key: char, code, keyCode, bubbles: true })
      );
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
    const proto =
      element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
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
    const proto =
      element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    const writeValue = (v: string) =>
      nativeSetter ? nativeSetter.call(element, v) : (element.value = v);

    writeValue('');
    let accumulated = '';
    for (const char of value) {
      element.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: char,
        })
      );
      accumulated += char;
      writeValue(accumulated);
      element.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: false,
          inputType: 'insertText',
          data: char,
        })
      );
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  private static dispatchFullEventChain(element: FormInputElement, value: string): void {
    element.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
    element.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value })
    );
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
  }

  private static async setViaClipboardPaste(
    element: FormInputElement,
    value: string
  ): Promise<boolean> {
    try {
      if (!navigator.clipboard) {
        return false;
      }

      // SECURITY: Do NOT read or overwrite the user's clipboard without consent.
      // Instead, use a DataTransfer-based paste event which simulates a paste
      // without touching the real clipboard.
      element.focus();

      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', value);
      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(pasteEvent);

      if (element.value !== value) {
        // Fallback: try native setter + events
        return this.setViaNativeSetter(element, value);
      }

      return element.value === value || (element.value.length > 0 && element.type === 'password');
    } catch (err) {
      log.debug('ClipboardPaste failed', err);
      return false;
    }
  }

  /**
   * React Fiber Internal Setter
   * Accesses React's internal fiber node to directly set the value
   * property on React-controlled inputs. Works even when prototypes
   * are frozen or when React's synthetic event system intercepts
   * normal dispatches.
   */
  private static setViaReactFiber(element: FormInputElement, value: string): boolean {
    try {
      // Walk up the DOM to find the React fiber node
      let reactElement: Element | null = element;
      const fiberKey = Object.keys(reactElement).find(
        (key) =>
          key.startsWith('__reactFiber$') ||
          key.startsWith('__reactInternalInstance$') ||
          key.startsWith('__reactProps$')
      );

      if (!fiberKey) {
        // Try parent elements
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

      if (!reactElement) {
        return false;
      }

      const fiberKeyFound = Object.keys(reactElement).find(
        (key) => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')
      );

      if (!fiberKeyFound) {
        return false;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fiber = (reactElement as any)[fiberKeyFound];
      if (!fiber || !fiber.memoizedProps) {
        return false;
      }

      // Find the onChange handler and invoke it
      const onChange = fiber.memoizedProps.onChange;
      if (typeof onChange === 'function') {
        // Set the native value first
        const nativeSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value'
        )?.set;
        if (nativeSetter) {
          nativeSetter.call(element, value);
        } else {
          element.value = value;
        }

        // Create a synthetic-looking event for React
        const event = Object.create(Event.prototype);
        Object.defineProperty(event, 'target', { value: element, enumerable: true });
        Object.defineProperty(event, 'currentTarget', { value: element, enumerable: true });
        Object.defineProperty(event, 'bubbles', { value: true, enumerable: true });

        // Also dispatch native events for frameworks that listen to both
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));

        return element.value === value;
      }

      // If no onChange, try to set the value via the fiber's state node
      const stateNode = fiber.stateNode;
      if (stateNode && stateNode instanceof HTMLInputElement) {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value'
        )?.set;
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

  /**
   * ContentEditable Setter
   * Handles fields that use contenteditable divs/spans instead of
   * native <input> elements. Common in rich text editors and some
   * modern frameworks (e.g., some Vue/Angular OTP inputs).
   */
  private static setViaContentEditable(element: FormInputElement, value: string): boolean {
    try {
      // Check if the element or its parent is contenteditable
      const editableEl = this.findEditableAncestor(element);
      if (!editableEl) {
        return false;
      }

      editableEl.focus();

      // Clear existing content
      editableEl.textContent = '';

      // Set the text content
      editableEl.textContent = value;

      // Dispatch events that contenteditable-aware frameworks listen for
      editableEl.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value })
      );
      editableEl.dispatchEvent(new Event('change', { bubbles: true }));
      editableEl.dispatchEvent(new FocusEvent('blur', { bubbles: false }));

      // Also try setting via execCommand for older browsers
      if (editableEl.textContent !== value) {
        document.execCommand('insertText', false, value);
      }

      return editableEl.textContent === value;
    } catch {
      return false;
    }
  }

  /**
   * Walk up the DOM tree to find the nearest contenteditable ancestor.
   */
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
