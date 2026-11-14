/**
 * Tracker-aware value assignment for form controls (2026-11-12).
 *
 * Why this exists: writing `element.value = '…'` directly is NOT enough
 * for controlled inputs (React and friends keep their own copy of the
 * last value they saw). Two failure modes follow:
 *
 * - the framework never learns about the change (its state and the DOM
 *   drift apart), and
 * - when a later write restores the old value, the framework's tracker
 *   still holds the intermediate value, so its next render can snap the
 *   field back to text the extension believes it removed.
 *
 * The fix is the standard one: use the prototype's own `value` setter
 * (so the framework's own descriptor path runs), then reset the
 * framework's value tracker to the pre-write value so the next `input`
 * event is seen as a real change, and dispatch both `input` and
 * `change` so site listeners (including keyboard-driven splitters) are
 * told about the write.
 */
import { EventFactory } from './formFiller';

export type SettableElement = HTMLInputElement | HTMLTextAreaElement;

export interface SetTrackedValueOptions {
  /** Focus the element before writing (defaults to false — avoid stealing focus). */
  focus?: boolean;
  /** Use a custom input event (e.g. the shared EventFactory). */
  inputEvent?: Event;
}

/**
 * Write a value into a form control the way a human would, so the page's
 * own state stays in sync with what the user sees.
 *
 * @returns true when the element actually holds the requested value.
 */
export function setTrackedValue(
  element: SettableElement,
  value: string,
  options: SetTrackedValueOptions = {}
): boolean {
  const { focus = false, inputEvent } = options;

  const proto =
    element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLTextAreaElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  const oldValue = element.value;

  if (focus) {
    try {
      element.focus({ preventScroll: true });
    } catch {
      /* focus is best-effort */
    }
  }

  if (nativeSetter) {
    nativeSetter.call(element, value);
  } else {
    element.value = value;
  }

  // Reset the framework's tracker to the pre-write value: the next input
  // event then registers as a change instead of being swallowed as a
  // no-op (the classic "React reverts my value" bug).
  const tracker = (
    element as unknown as {
      _valueTracker?: { setValue?: (next: string) => void };
    }
  )._valueTracker;
  tracker?.setValue?.(oldValue);

  element.dispatchEvent(inputEvent ?? EventFactory.input(value));
  element.dispatchEvent(new Event('change', { bubbles: true }));

  return element.value === value;
}
