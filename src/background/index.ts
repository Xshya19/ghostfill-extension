// ─── Trusted Types default policy (safety-net) ────────────────────
// Chrome enforces `require-trusted-types-for 'script'` from the
// manifest CSP on the service worker too. Webpack creates its own
// named policy for chunk-loading, but any OTHER code that touches a
// Trusted-Types-guarded sink (setTimeout with strings, eval, etc.)
// would still throw. The 'default' policy is the browser's built-in
// fallback — it is invoked automatically whenever an untrusted string
// is assigned to a sink and no named policy was used.
{
  interface GlobalWithTrustedTypes {
    trustedTypes?: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createPolicy: (name: string, rules: any) => void;
    };
    setImmediate?: (callback: (...args: unknown[]) => void, ...args: unknown[]) => void;
    clearImmediate?: (id: ReturnType<typeof setTimeout>) => void;
  }
  const g = globalThis as unknown as GlobalWithTrustedTypes;
  if (typeof g.trustedTypes !== 'undefined') {
    try {
      g.trustedTypes.createPolicy('default', {
        createHTML: (s: string) =>
          s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;'),
        createScriptURL: (s: string) => {
          if (s.startsWith('chrome-extension://') || s.startsWith('/')) {
            return s;
          }
          console.warn('Blocked uncontrolled script URL');
          return '';
        },
        createScript: (_s: string) => {
          throw new Error('createScript is not allowed by GhostFill policy');
        },
      });
    } catch {
      // Policy may already exist
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g2 = globalThis as any;
  g2.setImmediate = (callback: (...args: unknown[]) => void, ...args: unknown[]) => {
    return setTimeout(callback, 0, ...args);
  };

  g2.clearImmediate = (id: ReturnType<typeof setTimeout>) => {
    clearTimeout(id);
  };
}
import { sleep } from '../utils/core';
import { createLogger, initRemoteLogger } from '../utils/logger';
import { safeSendTabMessage } from '../utils/messaging';

import { errorTracker, performanceMonitor } from '../services/performanceService';
import { dumpMenuStats } from './contextMenu';
import { dumpRouterStats, setupMessageHandler } from './messageHandler';
import { initNotifications, dumpNotificationStats } from './notifications';
import { getPollingMetrics, onPollingAlarm } from './pollingManager';
import {
  initServiceWorker,
  getBootState,
  dumpBootReport,
  onServiceWorkerAlarm,
} from './serviceWorker';

// Boot timing — logged via structured logger once it's initialized
const __BACKGROUND_LOAD_START_EARLY__ = Date.now();

// ─────────────────────────────────────────────────────────────────────
// Background Service Worker v2 — Orchestrated Entry Point
//
// ┌──────────────────────────────────────────────────────────────────┐
// │  Boot Flow                                                      │
// │                                                                 │
// │  chrome.runtime.onInstalled / onStartup                         │
// │         │                                                       │
// │         ▼                                                       │
// │  ┌─────────────────┐                                            │
// │  │  initialize()   │──► phased boot via initServiceWorker       │
// │  └────────┬────────┘                                            │
// │           ▼                                                     │
// │  ┌─────────────────┐                                            │
// │  │  reason-flows   │──► install / update / startup              │
// │  └────────┬────────┘                                            │
// │           ▼                                                     │
// │  ┌─────────────────┐                                            │
// │  │  event-handlers │──► commands, alarms                        │
// │  └────────┬────────┘                                            │
// │           ▼                                                     │
// │  ┌─────────────────┐                                            │
// │  │  health-monitor │──► periodic check + auto-restart           │
// │  └─────────────────┘                                            │
// └──────────────────────────────────────────────────────────────────┘
// ─────────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════
//  TOP-LEVEL ERROR BOUNDARY — CATCH ALL MODULE LOAD ERRORS
// ═══════════════════════════════════════════════════════════════════

// Synchronous error listener to catch load-time failures immediately
self.addEventListener('error', (event: ErrorEvent) => {
  const msg = event.error?.message || event.message || '';
  // Suppress known harmless library probes that can happen during extension startup.
  if (msg.includes('image.png') && msg.includes('does not support image input')) {
    event.preventDefault();
    return;
  }
  // These run before the logger is ready, so we use a minimal fallback
  // that avoids exposing data externally
});

self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  const reason = (event.reason as Error)?.message || String(event.reason) || '';
  // Suppress known harmless library probes that can happen during extension startup.
  if (reason.includes('image.png') && reason.includes('does not support image input')) {
    event.preventDefault();
  }
  // Log after the logger is initialized — the log instance below handles this
});

initRemoteLogger('Background');
const _BACKGROUND_LOAD_START__ = Date.now();
const log = createLogger('Background');

// Initialize global observability early
errorTracker.init();
performanceMonitor.init();

// ─── CRITICAL MV3 FIX ───────────────────────────────────────────────────────
// In MV3, the service worker can wake from idle at ANY time (popup open, alarm,
// incoming tab message, etc.) WITHOUT firing onInstalled or onStartup.
// If setupMessageHandler() is only called inside initialize(), there is a window
// where the service worker is active but has no message listener, causing every
// message (CHECK_INBOX, GET_CURRENT_EMAIL, etc.) to hit Chrome's "no handler"
// fallback and return an error to the popup.
//
// Solution: register the listener synchronously at module load (before any async
// work). The `listenersInstalled` guard prevents double-registration during
// the subsequent initialize() Phase 4 call.
setupMessageHandler();
// Note: listenersInstalled guard (in setupMessageHandler) prevents double-registration

// Log successful module load
const loadDuration = Date.now() - __BACKGROUND_LOAD_START_EARLY__;
log.info(
  `✅ Background module loaded in ${loadDuration}ms (message router registered synchronously)`
);

// ━━━ Types ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type InstallReason = chrome.runtime.OnInstalledReason;
type InitTrigger = InstallReason | 'startup' | 'manual';

interface CommandDef {
  handler: () => Promise<void>;
}

interface BackgroundMetrics {
  initStartedAt: number | null;
  initCompletedAt: number | null;
  initDurationMs: number | null;
  initTrigger: InitTrigger | null;
  commandsExecuted: number;
  commandErrors: number;
  healthChecks: number;
  healthFailures: number;
  restarts: number;
  byCommand: Record<string, { count: number; errors: number }>;
}

// ━━━ Configuration ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CONFIG = {
  // Health check
  HEALTH_ALARM: 'ghostfill-health',
  // FIX Issue #12: Reduced from 1 minute to 5 minutes to comply with MV3 service worker best practices
  // MV3 service workers should minimize wake-ups to preserve battery life
  HEALTH_INTERVAL_MIN: 5, // 5 minutes (was 1 minute - too aggressive)
  MAX_HEALTH_FAILURES: 3,
  RESTART_DELAY_MS: 3_000,

  // Install behavior
  CLEAR_STORAGE_ON_INSTALL: true,
  AUTO_GEN_EMAIL: true,
  OPEN_WELCOME_PAGE: false,

  // Dev mode
  DEV_MODE: false,
} as const;

// ━━━ State ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let initialized = false;
// NOTE: listenersInstalled now tracks only the full listener suite from Phase 4.
// The message handler itself is registered synchronously above at module load.
let listenersInstalled = false;
let healthFailures = 0;

// ISSUE #12 FIX: Initialization lock to prevent race conditions
// This flag is checked BEFORE any async operations to prevent
// simultaneous onInstalled/onStartup initialization
let activeInitPromise: Promise<void> | null = null;
const pendingTriggers = new Set<InitTrigger>();

const metrics: BackgroundMetrics = {
  initStartedAt: null,
  initCompletedAt: null,
  initDurationMs: null,
  initTrigger: null,
  commandsExecuted: 0,
  commandErrors: 0,
  healthChecks: 0,
  healthFailures: 0,
  restarts: 0,
  byCommand: {},
};

const commands = new Map<string, CommandDef>();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  LIFECYCLE — INSTALL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

chrome.runtime.onInstalled.addListener((details) => {
  log.info('🔧 Extension installed', {
    reason: details.reason,
    version: chrome.runtime.getManifest().version,
    previousVer: details.previousVersion,
  });

  initialize(details.reason).catch((e) => {
    const errorMsg = extractMsg(e);
    const errorStack = e instanceof Error ? e.stack : 'No stack trace';
    log.error('❌ Init failed (onInstalled)', {
      error: errorMsg,
      stack: errorStack ? errorStack.substring(0, 500) : 'No stack trace',
    });
    log.error('❌ Init failed (onInstalled) [console-redacted]', { error: errorMsg });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  LIFECYCLE — STARTUP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

chrome.runtime.onStartup.addListener(() => {
  log.info('🚀 Extension startup');
  initialize('startup').catch((e) => {
    const errorMsg = extractMsg(e);
    const errorStack = e instanceof Error ? e.stack : 'No stack trace';
    log.error('❌ Init failed (onStartup)', {
      error: errorMsg,
      stack: errorStack ? errorStack.substring(0, 500) : 'No stack trace',
    });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CORE — INITIALIZE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function initialize(trigger: InitTrigger): Promise<void> {
  pendingTriggers.add(trigger);

  if (activeInitPromise) {
    log.debug(`⏳ Initialization already in progress, awaiting combination with ${trigger}`);
    await activeInitPromise;
    return;
  }

  const t0 = Date.now();

  activeInitPromise = (async () => {
    try {
      // Determine highest priority trigger from all pending
      let mainTrigger: InitTrigger = 'manual';
      if (pendingTriggers.has(chrome.runtime.OnInstalledReason.INSTALL)) {
        mainTrigger = chrome.runtime.OnInstalledReason.INSTALL;
      } else if (pendingTriggers.has(chrome.runtime.OnInstalledReason.UPDATE)) {
        mainTrigger = chrome.runtime.OnInstalledReason.UPDATE;
      } else if (pendingTriggers.has('startup')) {
        mainTrigger = 'startup';
      }
      pendingTriggers.clear();

      // Idempotent guard
      if (initialized && getBootState() === 'ready') {
        log.debug('Already initialized');
        // We might have been initialized by 'startup', but now got an 'install'/'update' event
        if (mainTrigger === 'install') {
          await onFreshInstall();
        } else if (mainTrigger === 'update') {
          await onUpdate();
        }
        return;
      }

      metrics.initStartedAt = t0;
      metrics.initTrigger = mainTrigger;

      log.info('⚡ Initializing', { trigger: mainTrigger });

      // Phase 1: Core systems
      log.debug('▶️ Phase 1: Core systems (initServiceWorker)');
      await initServiceWorker();

      // Check if service worker initialized successfully
      const bootState = getBootState();
      if (bootState === 'failed') {
        throw new Error(`Service worker boot failed. State: ${bootState}`);
      }
      if (bootState === 'degraded') {
        log.warn('⚠️ Service worker booted in degraded mode');
      }

      // Phase 2: Notifications (non-fatal)
      log.debug('▶️ Phase 2: Notifications');
      safeCall(() => initNotifications());

      // The heuristic classifier has no heavyweight runtime warm-up step.
      log.debug('▶️ Phase 2.5: Classifier warm-up skipped; heuristics are ready on demand');

      // Phase 3: Install-specific flows
      log.debug(`▶️ Phase 3: Install-specific flows (trigger: ${mainTrigger})`);
      if (mainTrigger === 'install') {
        await onFreshInstall();
      } else if (mainTrigger === 'update') {
        await onUpdate();
      }

      // Phase 4: Event listeners (idempotent)
      // NOTE: setupMessageHandler() was already called synchronously at module load.
      // Here we only register the remaining listeners (commands, alarms, keepalive).
      log.debug('▶️ Phase 4: Event listeners');
      if (!listenersInstalled) {
        registerCommands();
        installListeners();
        installKeepAlive();
        // setupMessageHandler() is intentionally NOT called here — it was registered
        // synchronously at module load to handle early wakeup messages.
        listenersInstalled = true;
      }

      // Phase 5: Health monitor
      log.debug('▶️ Phase 5: Health monitor');
      await setupHealthAlarm();

      // Phase 6: Dev utilities
      if (CONFIG.DEV_MODE) {
        installDevTools();
      }

      initialized = true;
      metrics.initCompletedAt = Date.now();
      metrics.initDurationMs = Date.now() - t0;

      log.info('✅ Initialization complete', {
        trigger: mainTrigger,
        durationMs: metrics.initDurationMs,
        bootState: getBootState(),
      });
    } catch (error) {
      const errorMsg = extractMsg(error);
      const errorStack = error instanceof Error ? error.stack : 'No stack trace';
      const initDuration = Date.now() - t0;

      log.error('❌ Initialization failed', {
        trigger,
        error: errorMsg,
        stack: errorStack ? errorStack.substring(0, 500) : 'No stack trace',
        durationMs: initDuration,
      });
      log.error(`❌ Initialization failed after ${initDuration}ms`, {
        error: errorMsg,
        stack: errorStack,
      });
      throw error;
    } finally {
      activeInitPromise = null;
    }
  })();

  await activeInitPromise;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  INSTALL-SPECIFIC FLOWS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function onFreshInstall(): Promise<void> {
  log.info('🆕 Fresh install');

  // Open welcome page FIRST — let the user decide provider settings there
  // rather than auto-generating identity + email without consent.
  if (CONFIG.OPEN_WELCOME_PAGE) {
    try {
      const windows = await chrome.windows.getAll();
      if (windows.length === 0) {
        log.debug('No window available for onboarding tab, will show on first popup open');
        log.info('Waiting for user-initiated setup via onboarding flow');
        return;
      }
      await chrome.tabs.create({ url: chrome.runtime.getURL('options.html?onboarding=true') });
    } catch (err) {
      log.debug('Could not open onboarding tab:', extractMsg(err));
    }
  }

  log.info('Waiting for user-initiated setup via onboarding flow');
}

// ISSUE #2 FIX: onUpdate() is now properly async and returns Promise<void>
async function onUpdate(): Promise<void> {
  log.info('🔄 Extension updated');

  try {
    const { storageService } = await import('../services/storageService');
    const previousVersion = (await storageService.get('extensionVersion')) || 'unknown';
    const currentVersion = chrome.runtime.getManifest().version;

    if (previousVersion !== currentVersion) {
      log.info(`Migrating storage from ${previousVersion} to ${currentVersion}`);

      // Future: Add specific version migration branches here if state schemas change
      // e.g. if (previousVersion === 'unknown' && currentVersion === '1.1.0') { ... }

      await storageService.set('extensionVersion', currentVersion);
      log.info('Migration complete');
    }
  } catch (error) {
    log.error('Migration failed during update', extractMsg(error));
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  COMMAND REGISTRY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function registerCommands(): void {
  register('generate-email', async () => {
    const { emailService } = await import('../services/emailServices');
    const { clipboardService } = await import('../services/clipboardService');
    const { notifySuccess } = await import('./notifications');

    const email = await emailService.generateEmail();
    const copied = await clipboardService.copyEmail(email.fullEmail);
    await notifySuccess(
      'GhostFill: Email Generated',
      copied ? `${maskEmail(email.fullEmail)} copied!` : `${maskEmail(email.fullEmail)} generated`
    );
  });

  register('generate-password', async () => {
    const { passwordService } = await import('../services/passwordService');
    const { clipboardService } = await import('../services/clipboardService');
    const { notifySuccess } = await import('./notifications');

    const result = await passwordService.generate();
    const copied = await clipboardService.copyPassword(result.password);
    await notifySuccess(
      'GhostFill: Password Generated',
      copied ? 'Secure password copied!' : 'Secure password generated'
    );
  });

  register('auto-fill', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await safeSendTabMessage(tab.id, { action: 'SMART_AUTOFILL' });
    }
  });

  register('check-inbox', async () => {
    const { emailService } = await import('../services/emailServices');
    const { notifySuccess, notifyError } = await import('./notifications');

    const current = await emailService.getCurrentEmail();
    if (!current) {
      await notifyError('No Email', 'Generate an email first');
      return;
    }
    const emails = await emailService.checkInbox(current);
    await notifySuccess('Inbox Checked', `${emails.length} email(s)`);
  });
}

function register(name: string, handler: () => Promise<void>): void {
  commands.set(name, { handler });
  metrics.byCommand[name] = { count: 0, errors: 0 };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  EVENT LISTENERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function installListeners(): void {
  // Commands
  chrome.commands.onCommand.addListener((cmd) => {
    void handleCommand(cmd);
  });

  // Centralized alarm router (SECURITY FIX C13)
  chrome.alarms.onAlarm.addListener((alarm) => {
    // Health alarm
    if (alarm.name === CONFIG.HEALTH_ALARM) {
      void runHealthCheck().catch((e) => log.warn('Health check error', extractMsg(e)));
    }
    // Key rotation
    else if (alarm.name === 'encryption-key-rotation') {
      import('../utils/encryption')
        .then((m) => m.onRotationAlarm && m.onRotationAlarm(alarm))
        .catch((e) => log.warn('Rotation alarm route failed', extractMsg(e)));
    }
    // Other system alarms
    else {
      onServiceWorkerAlarm(alarm);
      onPollingAlarm(alarm);
    }
  });

  // Suspend cleanup (SECURITY FIX C12)
  chrome.runtime.onSuspend.addListener(() => {
    log.info('Extension suspending, cleaning up resources');
    import('./serviceWorker')
      .then(({ closeOffscreenDocument, clearDeferredTimers }) => {
        void closeOffscreenDocument();
        clearDeferredTimers();
      })
      .catch((e) => log.warn('Suspend cleanup failed', extractMsg(e)));
    import('./pollingManager').then(({ stopEmailPolling }) => stopEmailPolling()).catch(() => {});
  });

  log.debug('Event listeners installed');
}

async function handleCommand(cmd: string): Promise<void> {
  metrics.commandsExecuted++;
  const stats = metrics.byCommand[cmd];
  if (stats) {
    stats.count++;
  }

  const def = commands.get(cmd);
  if (!def) {
    log.warn('Unknown command', { cmd });
    return;
  }

  try {
    await def.handler();
  } catch (error) {
    metrics.commandErrors++;
    if (stats) {
      stats.errors++;
    }
    log.error('Command failed', { cmd, error: extractMsg(error) });

    const { notifyError } = await import('./notifications');
    await notifyError('Error', 'Command failed');
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  HEALTH MONITOR & KEEP ALIVE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function installKeepAlive(): void {
  // Keep-alive is handled centrally by serviceWorker.ts via chrome.alarms.
  // Avoid a second heartbeat loop here because overlapping keepalive strategies
  // make MV3 lifecycle behavior harder to reason about and waste wakeups.
  log.debug('Background heartbeat disabled; relying on service worker keep-alive alarm');
}

async function setupHealthAlarm(): Promise<void> {
  await chrome.alarms.clear(CONFIG.HEALTH_ALARM).catch(() => undefined);
  await chrome.alarms.create(CONFIG.HEALTH_ALARM, {
    delayInMinutes: CONFIG.HEALTH_INTERVAL_MIN,
    periodInMinutes: CONFIG.HEALTH_INTERVAL_MIN,
  });
}

async function runHealthCheck(): Promise<void> {
  metrics.healthChecks++;
  const state = getBootState();

  if (state === 'ready') {
    healthFailures = 0;
    return;
  }

  healthFailures++;
  metrics.healthFailures++;
  log.warn('Health check failed', { state, consecutive: healthFailures });

  if (healthFailures >= CONFIG.MAX_HEALTH_FAILURES) {
    log.error('Max failures — restarting');
    await restart();
  }
}

async function restart(): Promise<void> {
  metrics.restarts++;
  healthFailures = 0;
  initialized = false;

  await sleep(CONFIG.RESTART_DELAY_MS);
  await initialize('manual');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DEV TOOLS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function installDevTools(): void {
  const g = globalThis as typeof globalThis & Record<string, unknown>;

  g.dumpAllStats = () => {
    log.info('📊 GhostFill Stats');
    dumpBootReport();
    log.info('Router:', dumpRouterStats());
    dumpMenuStats();
    dumpNotificationStats();
    log.info('Polling:', getPollingMetrics());
    log.info('Background:', getMetrics());
  };

  g.getBackgroundMetrics = getMetrics;
  g.restartBackground = restart;

  log.info('🛠️ Dev tools: dumpAllStats(), getBackgroundMetrics(), restartBackground()');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  OBSERVABILITY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function getMetrics(): Readonly<BackgroundMetrics> {
  return { ...metrics };
}

export function isInitialized(): boolean {
  return initialized;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  UTILITIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function extractMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 2) {
    return email;
  }
  return email[0] + '•'.repeat(Math.min(at - 1, 5)) + email.slice(at);
}

function safeCall(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    log.warn('SafeCall failed', extractMsg(e));
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  MODULE LOAD (minimal side-effects)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

log.debug('📦 Background module loaded');
