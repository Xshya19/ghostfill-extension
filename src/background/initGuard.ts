// ─────────────────────────────────────────────────────────────────────
// InitGuard — Shared initialization state for the background SW
// ─────────────────────────────────────────────────────────────────────
// Extracted from index.ts to break the circular dependency:
//   index.ts → messageHandler.ts → index.ts
//
// messageHandler.ts now imports ensureInitialized from HERE instead of
// from index.ts, which eliminates the webpack TDZ crash (status code 15).
// index.ts populates the callbacks below during its own module init.
// ─────────────────────────────────────────────────────────────────────

export type BootState = 'booting' | 'ready' | 'degraded' | 'failed';

// Mutable shared state — index.ts writes these, messageHandler.ts reads them.
let _activeInitPromise: Promise<void> | null = null;
let _initialized = false;
let _manualInitFn: ((trigger: string) => Promise<void>) | null = null;
let _getBootStateFn: (() => BootState) | null = null;

/**
 * Called once by index.ts to wire up the initialization callbacks.
 * Must be called before any message handler can invoke ensureInitialized().
 */
export function registerInitCallbacks(
  manualInitFn: (trigger: string) => Promise<void>,
  getBootStateFn: () => BootState
): void {
  _manualInitFn = manualInitFn;
  _getBootStateFn = getBootStateFn;
}

/**
 * Called by index.ts to update shared initialization state.
 */
export function setInitialized(value: boolean): void {
  _initialized = value;
}

export function setActiveInitPromise(promise: Promise<void> | null): void {
  _activeInitPromise = promise;
}

export function getActiveInitPromise(): Promise<void> | null {
  return _activeInitPromise;
}

/**
 * Ensures the extension is fully initialized.
 * Safe to call from message handlers during cold boots.
 * Imported by messageHandler.ts (avoids circular dep with index.ts).
 */
export function ensureInitialized(): Promise<void> {
  const bootState = _getBootStateFn?.();
  if (_initialized && (bootState === 'ready' || bootState === 'degraded')) {
    return Promise.resolve();
  }
  if (!_activeInitPromise && _manualInitFn) {
    void _manualInitFn('manual').catch(() => {
      /* swallowed — index.ts logs this */
    });
  }
  return _activeInitPromise || Promise.resolve();
}
