// ═══════════════════════════════════════════════════════════════════
// ⌨️  P H A N T O M   T Y P E R
// Human-like synthetic keystroke engine
// React · Vue · Angular · Svelte · Solid · Vanilla
//
// Architecture:
// ┌────────────────────────────────────────────────────────────┐
// │  SessionGuard     — Prevents interleaved typing on same    │
// │                     element via generation counter         │
// │  NativeSetters    — Cached prototype value setters for     │
// │                     bypassing framework proxies            │
// │  KeyMapper        — Physical keyboard code mapping         │
// │  EventSequence    — Full browser event chain simulation    │
// │  PhantomTyper     — Main API: type string into element     │
// └────────────────────────────────────────────────────────────┘
//
// Event sequence per character (matches Chrome physical input):
//   pointerover → pointerenter → pointerdown → mousedown
//   → focus → focusin → pointerup → mouseup → click
//   → [per char: keydown → keypress → beforeinput → (value) → input → keyup]
//   → change → pointerout → pointerleave → blur → focusout
// ═══════════════════════════════════════════════════════════════════

import { getRandomInt } from '../../../utils/encryption';
import { createLogger } from '../../../utils/logger';

const log = createLogger('PhantomTyper');

// ═══════════════════════════════════════════════════════════════
//  §0  CONSTANTS
// ═══════════════════════════════════════════════════════════════

/** Minimum yield between characters (ms). Allows framework digest cycles. */
const INTER_CHAR_YIELD_MS = 1;
const JITTER_MS = 3; // Max random jitter for "smoothness"

/** Maximum characters per typing session (safety limit) */
const MAX_INPUT_LENGTH = 1024;

// ═══════════════════════════════════════════════════════════════
//  §1  TYPES
// ═══════════════════════════════════════════════════════════════

type FormInputElement = HTMLInputElement | HTMLTextAreaElement;

// ═══════════════════════════════════════════════════════════════
//  §2  NATIVE VALUE SETTERS (cached once)
// ═══════════════════════════════════════════════════════════════

/**
 * Cache the native `value` property setter from HTMLInputElement
 * and HTMLTextAreaElement prototypes. These bypass framework
 * property interception (React synthetic events, Vue reactivity,
 * Angular zone tracking) by writing directly to the DOM element.
 *
 * Why: React tracks `value` changes via a custom property descriptor.
 * Setting `element.value = x` triggers React's setter, but only
 * native setter + synthetic input event properly updates React state.
 */
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

// ═══════════════════════════════════════════════════════════════
//  §3  KEY CODE MAPPER
// ═══════════════════════════════════════════════════════════════

class KeyMapper {
  private static readonly SPECIAL_CHARS: Readonly<Record<string, string>> = {
    ' ': 'Space',
    '\t': 'Tab',
    '\n': 'Enter',
    '@': 'Digit2', // Shift+2 on US layout
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

  /**
   * Map a character to its physical keyboard `code` property.
   * Matches the KeyboardEvent.code spec for a US QWERTY layout.
   */
  static getCode(char: string): string {
    // Letters
    if (/^[a-zA-Z]$/.test(char)) {
      return `Key${char.toUpperCase()}`;
    }

    // Digits
    if (/^[0-9]$/.test(char)) {
      return `Digit${char}`;
    }

    // Special characters
    if (this.SPECIAL_CHARS[char]) {
      return this.SPECIAL_CHARS[char];
    }

    // Fallback for international / untested characters
    if (char.charCodeAt(0) > 127) {
      return 'Unidentified';
    }
    return `Key${char.toUpperCase()}`;
  }

  /**
   * Determine if a character requires the Shift key.
   */
  static requiresShift(char: string): boolean {
    if (/^[A-Z]$/.test(char)) {
      return true;
    }
    return '~!@#$%^&*()_+{}|:"<>?'.includes(char);
  }
}

// ═══════════════════════════════════════════════════════════════
//  §4  NATIVE VALUE WRITER
// ═══════════════════════════════════════════════════════════════

class NativeValueWriter {
  /**
   * Set element value using the native prototype setter.
   * This is the ONLY reliable way to update React-controlled inputs
   * because React intercepts the element's own `value` property descriptor.
   *
   * Falls back to direct assignment if native setter is unavailable
   * (e.g., frozen prototypes on banking sites).
   */
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

// ═══════════════════════════════════════════════════════════════
//  §5  EVENT FACTORY
// ═══════════════════════════════════════════════════════════════

class EventFactory {
  /**
   * Create a KeyboardEvent with full property initialization.
   * Includes deprecated `keyCode`, `which`, `charCode` for
   * legacy site compatibility.
   */
  static keyboard(
    type: 'keydown' | 'keypress' | 'keyup',
    char: string,
    options?: { cancelable?: boolean }
  ): KeyboardEvent {
    const code = KeyMapper.getCode(char);

    // Improved keyCode calculation: use upper case ASCII for letters (standard behavior)
    let keyCode = char.charCodeAt(0);
    if (/^[a-z]$/.test(char)) {
      keyCode = char.toUpperCase().charCodeAt(0);
    } else if (KeyMapper.requiresShift(char)) {
      // For shifted special chars, physical keyCode corresponds to the unshifted char
      const unshiftedMap: Record<string, string> = {
        '~': '`',
        '!': '1',
        '@': '2',
        '#': '3',
        $: '4',
        '%': '5',
        '^': '6',
        '&': '7',
        '*': '8',
        '(': '9',
        ')': '0',
        _: '-',
        '+': '=',
        '{': '[',
        '}': ']',
        '|': '\\',
        ':': ';',
        '"': "'",
        '<': ',',
        '>': '.',
        '?': '/',
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

  /**
   * Create an InputEvent for text insertion.
   */
  static input(char: string): InputEvent {
    return new InputEvent('input', {
      data: char,
      inputType: 'insertText',
      bubbles: true,
      cancelable: false, // Per spec: input events are NOT cancelable
      composed: true,
    });
  }

  /**
   * Create a beforeinput event (modern spec).
   */
  static beforeInput(char: string): InputEvent {
    return new InputEvent('beforeinput', {
      data: char,
      inputType: 'insertText',
      bubbles: true,
      cancelable: true,
      composed: true,
    });
  }

  /**
   * Create a generic Event.
   */
  static generic(type: string, options?: { bubbles?: boolean; cancelable?: boolean }): Event {
    return new Event(type, {
      bubbles: options?.bubbles ?? true,
      cancelable: options?.cancelable ?? false,
    });
  }

  /**
   * Create a FocusEvent with correct bubbling behavior.
   * Per spec: `focus` and `blur` do NOT bubble.
   * `focusin` and `focusout` DO bubble.
   */
  static focus(type: 'focus' | 'focusin' | 'blur' | 'focusout'): FocusEvent {
    const bubbles = type === 'focusin' || type === 'focusout';
    return new FocusEvent(type, { bubbles, composed: true });
  }

  /**
   * Create a PointerEvent for mouse simulation.
   */
  static pointer(type: string, options?: { buttons?: number }): PointerEvent {
    return new PointerEvent(type, {
      bubbles: true,
      composed: true,
      pointerType: 'mouse',
      buttons: options?.buttons ?? 0,
      isPrimary: true,
    });
  }

  /**
   * Create a MouseEvent for click simulation.
   */
  static mouse(type: string, options?: { buttons?: number }): MouseEvent {
    return new MouseEvent(type, {
      bubbles: true,
      composed: true,
      buttons: options?.buttons ?? 0,
    });
  }
}

// ═══════════════════════════════════════════════════════════════
//  §6  MAIN PHANTOM TYPER
// ═══════════════════════════════════════════════════════════════

export class PhantomTyper {
  /**
   * Session guard: prevents interleaved typing on the same element.
   * WeakMap ensures no memory leak — entries are GC'd when element is GC'd.
   */
  private static readonly sessionMap = new WeakMap<HTMLElement, number>();

  /** Monotonic session counter (avoids `Date.now()` collision on same-ms calls) */
  private static sessionCounter = 0;

  /**
   * Type a string into an input/textarea element with full browser
   * event simulation. Bypasses React, Vue, Angular, Svelte, and
   * Solid.js reactivity systems.
   *
   * Event sequence matches Chrome's physical keyboard input:
   * 1. Pointer engagement (hover → press → release → click)
   * 2. Focus acquisition (focus + focusin)
   * 3. Field clearing (native setter + input event)
   * 4. Per-character: keydown → keypress → beforeinput → value → input → keyup
   * 5. Commitment (change event)
   * 6. Pointer disengagement (pointerout + pointerleave)
   * 7. Blur (blur + focusout)
   *
   * @param element - Target input or textarea element
   * @param text - String to type
   * @throws Never — all errors are caught and logged
   */
  static async typeSimulatedString(element: FormInputElement, text: string): Promise<void> {
    // ── Validation ──
    if (!element || !element.isConnected) {
      log.warn('PhantomTyper: element not connected to DOM');
      return;
    }

    if (text.length > MAX_INPUT_LENGTH) {
      log.warn('PhantomTyper: text exceeds maximum length', {
        length: text.length,
        max: MAX_INPUT_LENGTH,
      });
      text = text.slice(0, MAX_INPUT_LENGTH);
    }

    // ── Session management ──
    const sessionId = ++this.sessionCounter;
    this.sessionMap.set(element, sessionId);

    const isActive = (): boolean => {
      return this.sessionMap.get(element) === sessionId && element.isConnected;
    };

    try {
      // ── Phase 1: Pointer engagement ──
      if (!this.dispatchPointerEngagement(element, isActive)) {
        return;
      }

      // ── Phase 2: Focus ──
      if (!isActive()) {
        return;
      }
      element.focus({ preventScroll: true });
      element.dispatchEvent(EventFactory.focus('focus'));
      element.dispatchEvent(EventFactory.focus('focusin'));

      if (!isActive()) {
        return;
      }

      // ── Phase 3: Clear existing value ──
      NativeValueWriter.setValue(element, '');
      element.dispatchEvent(EventFactory.generic('input', { bubbles: true }));

      // ── Phase 4: Type each character ──
      for (let i = 0; i < text.length; i++) {
        if (!isActive()) {
          log.debug('PhantomTyper session interrupted', { at: i, total: text.length });
          return;
        }

        this.typeCharacter(element, text[i]!);

        // Smart dynamic yield: faster for emails, more resilient for passwords
        if (i < text.length - 1) {
          const isSensitive = /pass|pin|otp|code/i.test(element.name || element.id || element.type);
          const baseYield = isSensitive ? 15 : INTER_CHAR_YIELD_MS;
          const jitter = getRandomInt(0, JITTER_MS - 1);
          await this.yield(baseYield + jitter);
        }
      }

      if (!isActive()) {
        return;
      }

      // ── Phase 5: Commitment ──
      element.dispatchEvent(EventFactory.generic('change', { bubbles: true }));

      // ── Phase 6: Pointer disengagement ──
      element.dispatchEvent(EventFactory.pointer('pointerout'));
      element.dispatchEvent(EventFactory.pointer('pointerleave'));

      // ── Phase 7: Blur ──
      // NOTE: We intentionally do NOT blur after typing.
      // The caller (AutoFiller) manages blur timing because:
      // - Split OTP fields need focus to advance to next field
      // - Some frameworks validate on blur, which should happen after ALL fields are filled
      // Callers that need blur should dispatch it themselves.

      log.debug('PhantomTyper completed', { length: text.length });
    } catch (error) {
      log.warn('PhantomTyper error', {
        error: error instanceof Error ? error.message : String(error),
        length: text.length,
      });
    }
  }

  // ── Phase 1: Pointer engagement sequence ──

  private static dispatchPointerEngagement(
    element: FormInputElement,
    isActive: () => boolean
  ): boolean {
    const pointerEvents: Array<[string, { buttons?: number }?]> = [
      ['pointerover'],
      ['pointerenter'],
      ['pointerdown', { buttons: 1 }],
    ];

    for (const [type, opts] of pointerEvents) {
      if (!isActive()) {
        return false;
      }
      element.dispatchEvent(EventFactory.pointer(type, opts));
    }

    if (!isActive()) {
      return false;
    }
    element.dispatchEvent(EventFactory.mouse('mousedown', { buttons: 1 }));

    return true;
  }

  // ── Phase 4: Single character typing ──

  private static typeCharacter(element: FormInputElement, char: string): void {
    // 1. keydown
    element.dispatchEvent(EventFactory.keyboard('keydown', char));

    // 2. keypress (deprecated but needed for legacy compatibility)
    element.dispatchEvent(EventFactory.keyboard('keypress', char));

    // 3. beforeinput (modern spec)
    const beforeInputEvent = EventFactory.beforeInput(char);
    const allowed = element.dispatchEvent(beforeInputEvent);

    // If beforeinput was cancelled, log it but continue writing value
    // (some strict frameworks sync validation across canceled events but still expect state)
    if (!allowed) {
      log.debug('PhantomTyper: beforeinput event was cancelled by host framework', { char });
    }

    // 4. Set value via native setter
    const newValue = element.value + char;
    NativeValueWriter.setValue(element, newValue);

    // 5. React synthetic event trigger
    // React intercepts 'input' events dispatched after native setter changes.
    // The native setter bypasses React's property descriptor, so React sees
    // the value change when it processes the subsequent 'input' event.
    element.dispatchEvent(EventFactory.input(char));

    // 6. keyup
    element.dispatchEvent(EventFactory.keyboard('keyup', char));
  }

  // ── Utilities ──

  private static yield(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
