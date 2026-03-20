/**
 * messageHandler.ts — STUB
 * ────────────────────────────────────────────────────────────────────────────
 * The original file was corrupted (binary/null-byte content).
 * All message routing is now handled by mlMessageHandler.ts which listens for
 * CLASSIFY_FIELD, and by the existing chrome.runtime.onMessage handlers in the
 * serviceWorker boot phases.
 *
 * This stub is retained to satisfy legacy imports and allow the build to pass.
 */

import { createLogger } from '../utils/logger';

const log = createLogger('MessageHandler');

/**
 * No-op stub for backward-compatibility.
 * Real routing is handled in background/index.ts via registerMLMessageHandler().
 */
export function setupMessageHandler(): void {
  log.debug('[MessageHandler] Stub registered — routing handled by mlMessageHandler.ts');
}

/**
 * No-op stub — was previously used in dev-tools.
 */
export function dumpRouterStats(): void {
  log.debug('[MessageHandler] dumpRouterStats: no-op stub');
}