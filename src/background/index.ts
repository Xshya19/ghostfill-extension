import './polyfill'; // Keep this as the first import to polyfill setImmediate
import { sleep } from '../utils/helpers';
import { createLogger } from '../utils/logger';
import { safeSendTabMessage } from '../utils/messaging';

import { errorTracker, performanceMonitor } from '../utils/monitoring';
import { initRemoteLogger } from '../utils/remoteLogger';
import { dumpMenuStats } from './contextMenu';
import { setupMessageHandler, dumpRouterStats } from './messageHandler';
import { initNotifications, dumpNotificationStats } from './notifications';
import { getPollingMetrics, startEmailPolling } from './pollingManager';
import { initServiceWorker, getBootState, dumpBootReport } from './serviceWorker';

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
//
// ═══════════════════════════════════════════════════════════════════
//  ARCHITECTURE TODOs (Issues #31-38)
// ═══════════════════════════════════════════════════════════════════
//  TODO #31: Consider migrating to TypeScript project references for
//            better build isolation between background/content/popup
//  TODO #32: Extract command handlers to separate module for testing
//  TODO #33: Add structured logging with log levels (debug/info/warn/error)
//  TODO #34: Implement proper error boundary for extension lifecycle
//  TODO #35: Add metrics/telemetry for extension health monitoring
//  TODO #36: Consider using MessageChannel for complex cross-context communication
//  TODO #37: Add retry queue for failed API requests with exponential backoff
//  TODO #38: Implement proper dependency injection for testability
// ═══════════════════════════════════════════════════════════════════
// ─────────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════
//  TOP-LEVEL ERROR BOUNDARY — CATCH ALL MODULE LOAD ERRORS
// ═══════════════════════════════════════════════════════════════════

// Synchronous error listener to catch load-time failures immediately
self.addEventListener('error', (event: ErrorEvent) => {
  const msg = event.error?.message || event.message || '';
  // Suppress ONNX internal image.png error - it's harmless and expected for non-image models
  if (msg.includes('image.png') && msg.includes('does not support image input')) {
    event.preventDefault();
    return;
  }
  // These run before the logger is ready, so we use a minimal fallback
  // that avoids exposing data externally
});

self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  const reason = (event.reason as Error)?.message || String(event.reason) || '';
  // Suppress ONNX internal image.png error
  if (reason.includes('image.png') && reason.includes('does not support image input')) {
    event.preventDefault();
  }
  // Log after the logger is initialized — the log instance below handles this
});

initRemoteLogger('Background');
const __BACKGROUND_LOAD_START__ = Date.now();
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
  OPEN_WELCOME_PAGE: true,

  // Dev mode
  DEV_MODE: process.env.NODE_ENV === 'development',
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
    console.error('[Background] Initialization failed:', errorMsg);
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
    console.error('[Background] Initialization failed:', errorMsg);
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

      // Phase 2.5: ML Inference Engine warm-up (non-fatal, async)
      log.debug('▶️ Phase 2.5: ML Inference Engine (offscreen warm-up)');
      safeCall(() => {
        import('./offscreenManager')
          .then(({ ensureOffscreenDocument }) => {
            ensureOffscreenDocument()
              .then(() =>
                chrome.runtime.sendMessage({ target: 'offscreen-doc', type: 'WARM_UP_ML' })
              )
              .catch(() => {
                /* non-fatal */
              });
          })
          .catch(() => {
            /* non-fatal */
          });
      });

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
      console.error(`[Background] ❌ Initialization failed after ${initDuration}ms:`, errorMsg);
      console.error('[Background] Stack trace:', errorStack);
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

  // Clear storage
  if (CONFIG.CLEAR_STORAGE_ON_INSTALL) {
    try {
      const { storageService } = await import('../services/storageService');
      await storageService.clear();
      log.info('🧹 Storage cleared');
    } catch (e) {
      log.error('Storage clear failed', extractMsg(e));
      // Continue anyway - storage clear is not critical
    }
  }

  // Generate identity
  try {
    const { identityService } = await import('../services/identityService');
    const identity = identityService.generateIdentity();
    await identityService.saveIdentity(identity);
    log.info('👤 Identity generated', { username: identity.username });
  } catch (e) {
    log.warn('Identity gen failed', extractMsg(e));
    // Continue - identity can be generated later
  }

  // Auto-generate email
  if (CONFIG.AUTO_GEN_EMAIL) {
    try {
      const { emailService } = await import('../services/emailServices');
      const email = await emailService.generateEmail();
      log.info('📧 Email generated', { email: maskEmail(email.fullEmail) });

      // START POLLING AFTER GENERATING EMAIL
      startEmailPolling();
    } catch (e) {
      log.warn('Email gen failed', extractMsg(e));
      // Continue - email can be generated by user
    }
  }

  // Open welcome page
  if (CONFIG.OPEN_WELCOME_PAGE) {
    await chrome.tabs
      .create({ url: chrome.runtime.getURL('options.html?onboarding=true') })
      .catch((err) => {
        log.error('Failed to open onboarding options page', extractMsg(err));
      });
  }
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
    await clipboardService.copyEmail(email.fullEmail);
    await notifySuccess('GhostFill: Email Generated', `${maskEmail(email.fullEmail)} copied!`);
  });

  register('generate-password', async () => {
    const { passwordService } = await import('../services/passwordService');
    const { clipboardService } = await import('../services/clipboardService');
    const { notifySuccess } = await import('./notifications');

    const result = await passwordService.generate();
    await clipboardService.copyPassword(result.password);
    await notifySuccess('GhostFill: Password Generated', 'Secure password copied!');
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
      import('./serviceWorker')
        .then((m) => m.onServiceWorkerAlarm && m.onServiceWorkerAlarm(alarm))
        .catch((e) => log.debug('ServiceWorker alarm unhandled:', extractMsg(e)));

      import('./pollingManager')
        .then((m) => m.onPollingAlarm && m.onPollingAlarm(alarm))
        .catch((e) => log.debug('Polling alarm unhandled:', extractMsg(e)));
    }
  });

  // Suspend cleanup (SECURITY FIX C12)
  chrome.runtime.onSuspend.addListener(() => {
    log.info('Extension suspending, cleaning up resources');
    import('./offscreenManager')
      .then(({ closeOffscreenDocument }) => closeOffscreenDocument())
      .catch((e) => log.warn('Suspend cleanup failed', extractMsg(e)));
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

let keepAliveInterval: ReturnType<typeof setInterval> | null = null;

function installKeepAlive(): void {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }

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
    // dumpRouterStats removed — messageHandler.ts is a pre-existing corrupted file
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
