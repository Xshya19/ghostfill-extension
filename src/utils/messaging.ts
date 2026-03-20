/**
 * Safe Messaging Utility
 * Handles "Extension context invalidated" errors gracefully
 *
 * Features:
 * - Automatic retry on transient failures
 * - Timeout handling for long-running operations
 * - Graceful degradation when extension is reloading
 *
 * HIGH FIX: Runtime Validation
 * - All messages are validated with Zod before sending
 * - Invalid messages are rejected with descriptive errors
 * - Message size limits prevent DoS attacks
 */

import { ExtensionMessage, ExtensionResponse } from '../types';
import { sleep } from './helpers';
import { createLogger } from './logger';
import { validateMessage } from './validation';

const log = createLogger('Messaging');

// Configuration
const MESSAGE_TIMEOUT_MS = 30000;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 150;

/**
 * Check if extension context is valid
 */
function isExtensionContextValid(): boolean {
  try {
    return !!chrome?.runtime?.id;
  } catch {
    return false;
  }
}

/**
 * Check if error is recoverable
 */
function isRecoverableError(errorMsg: string): boolean {
  const recoverablePatterns = [
    'Extension context invalidated',
    'Could not establish connection',
    'Receiving end does not exist',
    'The message port closed before a response was received',
  ];
  return recoverablePatterns.some((pattern) => errorMsg.includes(pattern));
}

/**
 * Send message to background script safely with retry logic
 *
 * @param message - The message to send
 * @param options - Optional configuration
 * @returns Response or null if extension context is invalid
 */
export async function safeSendMessage(
  message: ExtensionMessage,
  options: { timeout?: number; retries?: number } = {}
): Promise<ExtensionResponse | null> {
  const { timeout = MESSAGE_TIMEOUT_MS, retries = MAX_RETRY_ATTEMPTS } = options;

  // HIGH FIX: Runtime validation with Zod
  const validation = validateMessage(message);
  if (!validation.valid) {
    log.error('Message validation failed', {
      action: message.action,
      error: JSON.stringify(validation.error),
    });
    throw new Error(JSON.stringify(validation.error));
  }

  // Early exit if extension context is invalid
  if (!isExtensionContextValid()) {
    log.debug('Extension context invalid, skipping message', { action: message.action });
    return null;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Message timeout after ${timeout}ms`)),
          timeout
        );
      });

      // Send message with timeout race
      const response = (await Promise.race([
        chrome.runtime.sendMessage(message),
        timeoutPromise,
      ])) as ExtensionResponse | null;

      return response;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      lastError = error instanceof Error ? error : new Error(errorMsg);

      // Check if error is recoverable
      if (isRecoverableError(errorMsg)) {
        log.debug(`Message attempt ${attempt + 1}/${retries + 1} failed (recoverable)`, {
          action: message.action,
          error: errorMsg,
        });

        // Don't retry on last attempt
        if (attempt < retries) {
          await sleep(RETRY_DELAY_MS * (attempt + 1)); // Exponential backoff
          continue;
        }
      } else {
        // Non-recoverable error - throw immediately
        log.error('Message failed (non-recoverable)', {
          action: message.action,
          error: errorMsg,
        });
        throw error;
      }
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  // All retries exhausted - log and return null
  log.warn('Message failed after all retries', {
    action: message.action,
    error: lastError?.message,
  });
  return null;
}

/**
 * Send message to a tab safely with retry logic
 *
 * @param tabId - The tab ID to send to
 * @param message - The message to send
 * @param options - Optional configuration
 * @returns Response or null if content script is not available
 */
export async function safeSendTabMessage(
  tabId: number,
  message: ExtensionMessage,
  options: { timeout?: number; retries?: number } = {}
): Promise<ExtensionResponse | null> {
  const { timeout = MESSAGE_TIMEOUT_MS, retries = MAX_RETRY_ATTEMPTS } = options;

  const validation = validateMessage(message);
  if (!validation.valid) {
    log.error('Tab message validation failed', {
      action: message.action,
      error: JSON.stringify(validation.error),
    });
    throw new Error(JSON.stringify(validation.error));
  }

  // Early exit if extension context is invalid
  if (!isExtensionContextValid()) {
    log.debug('Extension context invalid, skipping tab message', { action: message.action });
    return null;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Tab message timeout after ${timeout}ms`)),
          timeout
        );
      });

      // Send message with timeout race
      const response = (await Promise.race([
        chrome.tabs.sendMessage(tabId, message),
        timeoutPromise,
      ])) as ExtensionResponse | null;

      return response;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      lastError = error instanceof Error ? error : new Error(errorMsg);

      // Check if error is expected (content script not available)
      if (
        errorMsg.includes('Receiving end does not exist') ||
        errorMsg.includes('Could not establish connection') ||
        errorMsg.includes('Internal error: collectSample') ||
        errorMsg.includes('The message port closed before a response was received')
      ) {
        // Only log debug for expected cases on restricted pages
        log.debug(`Content script not available on tab ${tabId}`, {
          action: message.action,
          attempt: attempt + 1,
        });

        // Don't retry for content script unavailable errors
        return null;
      }

      // Check if error is recoverable
      if (isRecoverableError(errorMsg)) {
        log.debug(`Tab message attempt ${attempt + 1}/${retries + 1} failed (recoverable)`, {
          tabId,
          action: message.action,
          error: errorMsg,
        });

        // Don't retry on last attempt
        if (attempt < retries) {
          await sleep(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
      } else {
        // Non-recoverable error - throw immediately
        log.error('Tab message failed (non-recoverable)', {
          tabId,
          action: message.action,
          error: errorMsg,
        });
        throw error;
      }
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  // All retries exhausted - log and return null
  log.warn('Tab message failed after all retries', {
    tabId,
    action: message.action,
    error: lastError?.message,
  });
  return null;
}
