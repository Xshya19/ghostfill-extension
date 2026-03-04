import { createLogger } from '../utils/logger';

const log = createLogger('PhantomTyper');

/**
 * PhantomTyper executes synthetic keystrokes mimicking real human data entry 
 * designed specifically to aggressively bypass React Fiber `__reactEventHandlers*`,
 * Vue models, and Svelte proxies.
 */
export class PhantomTyper {
    /**
     * Finds the hidden internal React event handler keys physically attached to a DOM node
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private static getReactProps(element: HTMLElement): any {
        const key = Object.keys(element).find((key) => key.startsWith('__reactProps$') || key.startsWith('__reactEventHandlers$'));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return key ? (element as any)[key] : null;
    }

    /**
     * Completely override the framework bindings and emulate physical keyboard layers.
     */
    static async typeSimulatedString(element: HTMLInputElement | HTMLTextAreaElement, text: string): Promise<void> {
        element.focus();

        // Ensure we bypass any native trackers 
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
        )?.set;

        const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
        )?.set;

        // Strip the field cleanly
        if (element instanceof HTMLInputElement && nativeInputValueSetter) {
            nativeInputValueSetter.call(element, '');
        } else if (element instanceof HTMLTextAreaElement && nativeTextAreaValueSetter) {
            nativeTextAreaValueSetter.call(element, '');
        } else {
            element.value = '';
        }

        element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));

        // Loop over each character and inject exactly as a physical typing buffer does
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const keyCode = char.charCodeAt(0);

            // 1. Key Down
            element.dispatchEvent(new KeyboardEvent('keydown', {
                key: char,
                code: this.getKeyboardCode(char),
                keyCode: keyCode,
                which: keyCode,
                bubbles: true,
                cancelable: true
            }));

            // 2. Key Press (Deprecated in spec but necessary for legacy site detection)
            element.dispatchEvent(new KeyboardEvent('keypress', {
                key: char,
                code: this.getKeyboardCode(char),
                keyCode: keyCode,
                which: keyCode,
                charCode: keyCode,
                bubbles: true,
                cancelable: true
            }));

            // 3. Inject Value
            const currentValue = element.value;
            const newValue = currentValue + char;

            if (element instanceof HTMLInputElement && nativeInputValueSetter) {
                nativeInputValueSetter.call(element, newValue);
            } else if (element instanceof HTMLTextAreaElement && nativeTextAreaValueSetter) {
                nativeTextAreaValueSetter.call(element, newValue);
            } else {
                element.value = newValue;
            }

            // 4. Force React Tracker
            const reactProps = this.getReactProps(element);
            if (reactProps && reactProps.onChange) {
                // We don't call it directly to avoid context loss, just knowing it's there
            }

            // 5. Input Event
            element.dispatchEvent(new InputEvent('input', {
                data: char,
                inputType: 'insertText',
                bubbles: true,
                cancelable: true
            }));

            // 6. Key Up
            element.dispatchEvent(new KeyboardEvent('keyup', {
                key: char,
                code: this.getKeyboardCode(char),
                keyCode: keyCode,
                which: keyCode,
                bubbles: true,
                cancelable: true
            }));

            // Very brief realistic delay to satisfy rapid-fire spam blockers
            await this.delay(3);
        }

        // 7. Full Change & Blur Commitment
        element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

        log.debug('PhantomTyper completed execution', { length: text.length });
    }

    private static getKeyboardCode(char: string): string {
        if (/[a-zA-Z]/.test(char)) { return `Key${char.toUpperCase()}`; }
        if (/[0-9]/.test(char)) { return `Digit${char}`; }
        return 'Unknown';
    }

    private static delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
