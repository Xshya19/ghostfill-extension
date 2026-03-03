// Clipboard Service

import { createLogger } from '../utils/logger';

const log = createLogger('ClipboardService');

// SECURITY FIX: Auto-clear timeouts for sensitive data
const CLIPBOARD_CLEAR_TIMEOUTS = {
    PASSWORD: 60000,  // 60 seconds for passwords
    OTP: 120000,      // 2 minutes for OTPs
    EMAIL: 0,         // No auto-clear for emails
} as const;

class ClipboardService {
    private clearTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * Copy text to clipboard with optional auto-clear for sensitive data
     * @param text - Text to copy
     * @param type - Type of data ('password', 'otp', 'email', 'default')
     * @param autoClearMs - Auto-clear timeout in ms (0 = no auto-clear)
     *
     * SECURITY FIX: Added auto-clear for sensitive data to prevent clipboard leakage
     */
    async copy(
        text: string,
        type: 'password' | 'otp' | 'email' | 'default' = 'default',
        autoClearMs?: number
    ): Promise<boolean> {
        try {
            // Clear any existing timer
            if (this.clearTimer) {
                clearTimeout(this.clearTimer);
                this.clearTimer = null;
            }

            // Check if we are in a Service Worker (no document)
            if (typeof document === 'undefined') {
                return this.copyOffscreen(text);
            }

            // Standard context (popup, content script)
            await navigator.clipboard.writeText(text);
            log.debug('Copied to clipboard', { type, length: text.length });

            // SECURITY FIX: Auto-clear sensitive data after timeout
            const clearTime = autoClearMs ?? (
                type === 'password' ? CLIPBOARD_CLEAR_TIMEOUTS.PASSWORD :
                type === 'otp' ? CLIPBOARD_CLEAR_TIMEOUTS.OTP :
                CLIPBOARD_CLEAR_TIMEOUTS.EMAIL
            );

            if (clearTime > 0) {
                this.clearTimer = setTimeout(async () => {
                    await this.clearClipboard();
                    log.info('Clipboard auto-cleared for security', { type });
                }, clearTime);
            }

            return true;
        } catch (error) {
            // Fallback for content scripts or older browsers
            return this.copyFallback(text);
        }
    }

    /**
     * Clear clipboard by overwriting with empty string
     * @security Prevents sensitive data leakage
     */
    async clearClipboard(): Promise<boolean> {
        try {
            if (typeof document === 'undefined') {
                // Can't clear from service worker without offscreen doc
                return false;
            }
            await navigator.clipboard.writeText('');
            log.debug('Clipboard cleared');
            return true;
        } catch (error) {
            log.warn('Clipboard clear failed', error);
            return false;
        }
    }

    /**
     * Copy using Offscreen API (for Service Worker)
     */
    private async copyOffscreen(text: string): Promise<boolean> {
        try {
            await this.setupOffscreenDocument();

            // Send message to offscreen document
            await chrome.runtime.sendMessage({
                target: 'offscreen-doc',
                type: 'COPY_TO_CLIPBOARD',
                data: text
            });

            log.debug('Copied to clipboard (offscreen)');

            return true;
        } catch (error) {
            log.error('Offscreen copy failed', error);
            return false;
        }
    }

    /**
     * Setup offscreen document
     */
    private async setupOffscreenDocument(): Promise<void> {
        try {
            // Check if offscreen API is available
            if (!chrome.offscreen) {
                log.error('Offscreen API not available');
                return;
            }

            // Create offscreen document
            // If it already exists, this will throw an error which we can ignore
            await chrome.offscreen.createDocument({
                url: 'offscreen.html',
                reasons: [chrome.offscreen.Reason.CLIPBOARD],
                justification: 'To copy text to clipboard from background script'
            });
        } catch (error) {
            // Ignore error if document already exists
            const msg = (error as Error).message;
            if (!msg.includes('Only a single offscreen') && !msg.includes('already exists')) {
                log.warn('Failed to create offscreen document (might already exist)', error);
            }
        }
    }

    /**
     * Fallback copy method using execCommand
     */
    private copyFallback(text: string): boolean {
        try {
            if (typeof document === 'undefined') {return false;}

            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
            document.body.appendChild(textArea);
            textArea.select();

            const success = document.execCommand('copy');
            document.body.removeChild(textArea);

            if (success) {
                log.debug('Copied to clipboard (fallback)');
            }

            return success;
        } catch (error) {
            log.error('Clipboard copy failed', error);
            return false;
        }
    }

    /**
     * Read from clipboard
     */
    async read(): Promise<string | null> {
        try {
            const text = await navigator.clipboard.readText();
            return text;
        } catch (error) {
            log.warn('Clipboard read failed', error);
            return null;
        }
    }

    /**
     * Copy email and show notification
     */
    async copyEmail(email: string): Promise<boolean> {
        const success = await this.copy(email, 'email');
        return success;
    }

    /**
     * Copy password with auto-clear after 60 seconds
     * @security Passwords are auto-cleared to prevent clipboard leakage
     */
    async copyPassword(password: string): Promise<boolean> {
        const success = await this.copy(password, 'password', CLIPBOARD_CLEAR_TIMEOUTS.PASSWORD);
        return success;
    }

    /**
     * Copy OTP with auto-clear after 2 minutes
     * @security OTPs are auto-cleared to prevent clipboard leakage
     */
    async copyOTP(otp: string): Promise<boolean> {
        const success = await this.copy(otp, 'otp', CLIPBOARD_CLEAR_TIMEOUTS.OTP);
        return success;
    }

    /**
     * Cancel any pending auto-clear
     */
    cancelAutoClear(): void {
        if (this.clearTimer) {
            clearTimeout(this.clearTimer);
            this.clearTimer = null;
            log.debug('Auto-clear cancelled');
        }
    }
}

// Export singleton instance
export const clipboardService = new ClipboardService();
