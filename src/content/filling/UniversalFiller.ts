import { createLogger } from '../../utils/logger';
import { FieldCandidate } from '../detection/UltraDetector';
import { getRandomInt } from '../../utils/encryption';

const log = createLogger('UniversalFiller');

export interface FillResult {
  success: boolean;
  strategy: string;
}

const nativeInputSetter = (() => {
  try {
    return Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set ?? null;
  } catch {
    return null;
  }
})();

const nativeTextAreaSetter = (() => {
  try {
    return Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set ?? null;
  } catch {
    return null;
  }
})();

export abstract class FillStrategy {
  abstract name: string;
  abstract supports(element: HTMLInputElement | HTMLTextAreaElement): boolean;
  abstract execute(element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<boolean>;
}

export class ReactFiberStrategy extends FillStrategy {
  name = 'react-fiber';

  supports(element: HTMLInputElement | HTMLTextAreaElement): boolean {
    let current: Element | null = element;
    while (current) {
      const keys = Object.keys(current);
      if (keys.some((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$') || k.startsWith('__reactProps$'))) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }

  async execute(element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<boolean> {
    try {
      let reactElement: Element | null = element;
      let fiberKey = Object.keys(reactElement).find(
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
            fiberKey = parentKey;
            break;
          }
          parent = parent.parentElement;
        }
      }

      if (!reactElement || !fiberKey) return false;

      const fiber = (reactElement as any)[fiberKey];
      if (!fiber || !fiber.memoizedProps) return false;

      const onChange = fiber.memoizedProps.onChange;
      if (typeof onChange === 'function') {
        const nativeSetter = element instanceof HTMLInputElement ? nativeInputSetter : nativeTextAreaSetter;
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
      if (stateNode && (stateNode instanceof HTMLInputElement || stateNode instanceof HTMLTextAreaElement)) {
        const nativeSetter = stateNode instanceof HTMLInputElement ? nativeInputSetter : nativeTextAreaSetter;
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
    } catch (e) {
      log.debug('ReactFiberStrategy failed', e);
      return false;
    }
  }
}

export class VueReactivityStrategy extends FillStrategy {
  name = 'vue-reactivity';

  supports(element: HTMLInputElement | HTMLTextAreaElement): boolean {
    return Object.keys(element).some((k) => k.startsWith('__vue__'));
  }

  async execute(element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<boolean> {
    try {
      const keys = Object.keys(element);
      const vueKey = keys.find((k) => k.startsWith('__vue__'));
      if (!vueKey) return false;

      const vueInstance = (element as any)[vueKey];
      if (vueInstance) {
        element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return element.value === value;
      }
      return false;
    } catch {
      return false;
    }
  }
}

export class NativeSetterStrategy extends FillStrategy {
  name = 'native-setter';

  supports(): boolean {
    return true;
  }

  async execute(element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<boolean> {
    try {
      const nativeSetter = element instanceof HTMLInputElement ? nativeInputSetter : nativeTextAreaSetter;
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
    } catch {
      return false;
    }
  }
}

export class InputEventSequenceStrategy extends FillStrategy {
  name = 'input-event-sequence';

  supports(): boolean {
    return true;
  }

  async execute(element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<boolean> {
    try {
      element.focus();
      const nativeSetter = element instanceof HTMLInputElement ? nativeInputSetter : nativeTextAreaSetter;
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
      return element.value === value;
    } catch {
      return false;
    }
  }
}

export class ClipboardPasteStrategy extends FillStrategy {
  name = 'clipboard-paste';

  supports(): boolean {
    return typeof navigator.clipboard !== 'undefined';
  }

  async execute(element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<boolean> {
    try {
      element.focus();
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', value);
      const pasteEvent = new ClipboardEvent('paste', { clipboardData: dataTransfer, bubbles: true, cancelable: true });
      element.dispatchEvent(pasteEvent);

      if (element.value !== value) {
        const nativeSetter = element instanceof HTMLInputElement ? nativeInputSetter : nativeTextAreaSetter;
        if (nativeSetter) {
          nativeSetter.call(element, value);
        } else {
          element.value = value;
        }
      }
      return element.value === value;
    } catch {
      return false;
    }
  }
}

export class ContentEditableStrategy extends FillStrategy {
  name = 'contenteditable';

  supports(element: HTMLInputElement | HTMLTextAreaElement): boolean {
    let current: HTMLElement | null = element;
    while (current) {
      if (current.contentEditable === 'true' || current.contentEditable === 'inherit') {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }

  async execute(element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<boolean> {
    try {
      let current: HTMLElement | null = element;
      let editableEl: HTMLElement | null = null;
      while (current) {
        if (current.contentEditable === 'true' || current.contentEditable === 'inherit') {
          editableEl = current;
          break;
        }
        current = current.parentElement;
      }

      if (!editableEl) return false;

      editableEl.focus();
      editableEl.textContent = '';
      editableEl.textContent = value;

      editableEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      editableEl.dispatchEvent(new Event('change', { bubbles: true }));
      editableEl.dispatchEvent(new FocusEvent('blur', { bubbles: false }));

      return editableEl.textContent === value;
    } catch {
      return false;
    }
  }
}

export class UniversalFiller {
  private strategies: FillStrategy[] = [
    new ReactFiberStrategy(),
    new VueReactivityStrategy(),
    new NativeSetterStrategy(),
    new InputEventSequenceStrategy(),
    new ClipboardPasteStrategy(),
    new ContentEditableStrategy(),
  ];

  constructor(customStrategies?: FillStrategy[]) {
    if (customStrategies) {
      this.strategies = customStrategies;
    }
  }

  async fill(field: FieldCandidate, value: string): Promise<FillResult> {
    const el = field.element;

    for (const strategy of this.strategies) {
      if (!strategy.supports(el)) continue;

      try {
        const success = await strategy.execute(el, value);
        if (success) {
          return { success: true, strategy: strategy.name };
        }
      } catch (e) {
        log.warn(`Strategy ${strategy.name} failed during execution`, e);
      }
    }

    return { success: false, strategy: 'none' };
  }
}
