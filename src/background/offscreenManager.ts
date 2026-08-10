import { createLogger } from '../utils/logger';

const log = createLogger('OffscreenManager');

let makingOffscreen: Promise<void> | null = null;

/**
 * Ensures the offscreen document is created and ready for use.
 * Handles race conditions and "already exists" errors gracefully.
 */
export async function ensureOffscreenDocument(): Promise<void> {
  if (makingOffscreen) {
    return makingOffscreen;
  }

  makingOffscreen = (async () => {
    try {
      const exists = await hasOffscreenDocument();
      if (exists) {
        await verifyOffscreenReady();
        return;
      }

      if (!chrome.offscreen) {
        throw new Error('Offscreen API not available in this browser');
      }

      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.CLIPBOARD, chrome.offscreen.Reason.DOM_PARSER],
        justification:
          'To handle clipboard and DOM parsing helpers without Service Worker restrictions',
      });

      log.debug('Offscreen document created successfully');
      await verifyOffscreenReady();
    } catch (error) {
      const msg = (error as Error).message;
      if (msg.includes('Only a single offscreen') || msg.includes('already exists')) {
        log.debug('Offscreen document already exists (ignoring error)');
      } else {
        log.error('Failed to create offscreen document', error);
        throw error;
      }
    } finally {
      makingOffscreen = null;
    }
  })();

  return makingOffscreen;
}

/**
 * Checks if the offscreen document is currently active.
 */
async function hasOffscreenDocument(): Promise<boolean> {
  if (typeof chrome.offscreen?.hasDocument === 'function') {
    return chrome.offscreen.hasDocument();
  }

  interface RuntimeContext {
    contextType: string;
  }
  interface RuntimeWithContexts {
    getContexts(opts: { contextTypes: string[] }): Promise<RuntimeContext[]>;
    ContextType: { OFFSCREEN_DOCUMENT: string };
  }
  const rt = chrome.runtime as unknown as RuntimeWithContexts;
  const contexts = await rt.getContexts({
    contextTypes: [rt.ContextType.OFFSCREEN_DOCUMENT],
  });
  return contexts.length > 0;
}

/**
 * Pings the offscreen document to ensure it's responsive.
 */
async function verifyOffscreenReady(retries = 5): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await chrome.runtime.sendMessage({
        target: 'offscreen-doc',
        type: 'HEALTH_PING',
      });
      if (response?.status === 'pong') {
        return;
      }
    } catch {
      // Ignore and retry
    }
    await new Promise((r) => {
      setTimeout(r, 100 * (i + 1));
    });
  }
  throw new Error('Offscreen document created but not responding to pings');
}

/**
 * Closes the offscreen document if it exists.
 */
export async function closeOffscreenDocument(): Promise<void> {
  try {
    if (await hasOffscreenDocument()) {
      await chrome.offscreen.closeDocument();
      log.debug('Offscreen document closed');
    }
  } catch (error) {
    log.warn('Failed to close offscreen document', error);
  }
}
