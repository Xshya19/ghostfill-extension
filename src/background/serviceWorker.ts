// ─────────────────────────────────────────────────────────────────────
// Service Worker Initializer v2 — Phased Boot Engine
// ─────────────────────────────────────────────────────────────────────
//
// ARCHITECTURE FIX: All imports are now static at the top of the file.
// Dynamic imports don't work in bundled Chrome Extension service workers.
// ─────────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════
//  STATIC IMPORTS — ALL SERVICES IMPORTED AT BUILD TIME
// ═══════════════════════════════════════════════════════════════════

// Core utilities

import { setupContextMenu as contextMenuSetup } from '../background/contextMenu';
import { initNotifications as notificationsInit } from '../background/notifications';
import { setupPollingManager as pollingManagerSetup } from '../background/pollingManager';
import { emailService } from '../services/emailServices/index';
import { otpService } from '../services/otpService';
import { storageService } from '../services/storageService';
import { sleep } from '../utils/helpers';
import { createLogger } from '../utils/logger';
import { registerMLMessageHandler } from './mlMessageHandler';

const log = createLogger('ServiceWorker');

// Log successful module load - all imports resolved at build time
log.info('✅ All modules loaded statically at build time');

// ━━━ Types ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type BootState = 'cold' | 'initializing' | 'ready' | 'degraded' | 'failed';

type ServiceHealth = 'up' | 'degraded' | 'down' | 'deferred';

interface ServiceRecord {
  name: string;
  phase: number;
  health: ServiceHealth;
  critical: boolean; // if true, failure → overall "failed"
  initDurationMs: number | null;
  lastError: string | null;
  retries: number;
}

interface PhaseDefinition {
  name: string;
  order: number;
  critical: boolean; // if ALL tasks in a critical phase fail → boot fails
  deferred: boolean; // run during idle time, not on critical path
  tasks: TaskDefinition[];
}

interface TaskDefinition {
  name: string;
  critical: boolean;
  fn: () => Promise<void>;
}

interface BootMetrics {
  state: BootState;
  bootId: string;
  startedAt: number;
  completedAt: number | null;
  totalDurationMs: number | null;
  phaseDurations: Record<string, number>;
  servicesUp: number;
  servicesDegraded: number;
  servicesDown: number;
  servicesDeferred: number;
  retriesTotal: number;
  errors: ErrorRecord[];
}

interface ErrorRecord {
  service: string;
  phase: number;
  error: string;
  timestamp: number;
  fatal: boolean;
}

// ━━━ Configuration ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CONFIG = {
  // Retry
  MAX_RETRIES_PER_TASK: 2,
  BACKOFF_BASE_MS: 500, // Reduced from 1000ms for faster initial retry
  BACKOFF_CAP_MS: 8_000,

  // Timeouts
  TASK_TIMEOUT_MS: 10_000, // per-task hard timeout
  BOOT_TIMEOUT_MS: 30_000, // entire boot hard timeout

  // Keep-alive — increased from 1min to reduce power consumption while
  // still keeping the service worker alive during active use
  KEEPALIVE_ALARM_NAME: 'ghostfill-keepalive',
  KEEPALIVE_INTERVAL_MIN: 5, // 5 minutes (reduces power drain)

  // Deferred warm-up
  IDLE_DELAY_MS: 2_000, // wait before deferred phase
  IDLE_DETECTION_SEC: 15, // requestIdleCallback timeout

  // Re-init - EXPONENTIAL BACKOFF with shorter initial cooldown
  REINIT_COOLDOWN_MS: 2_000, // Reduced from 10_000ms for faster recovery
  REINIT_MAX_COOLDOWN_MS: 30_000, // Maximum cooldown with exponential backoff
  REINIT_BACKOFF_MULTIPLIER: 2, // Exponential backoff multiplier

  // Storage
  BOOT_STATE_KEY: 'sw_boot_state',
} as const;

// ━━━ Module State ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let bootState: BootState = 'cold';
let bootPromise: Promise<void> | null = null;
let lastInitTime = 0;
let reinitAttemptCount = 0; // Track re-init attempts for exponential backoff

const serviceRegistry = new Map<string, ServiceRecord>();
const MAX_BOOT_ERRORS = 50;
const bootErrors: ErrorRecord[] = [];

function recordBootError(error: ErrorRecord) {
  if (bootErrors.length >= MAX_BOOT_ERRORS) {
    bootErrors.shift(); // Prevent array from growing infinitely
  }
  bootErrors.push(error);
}
// Track timers for deferred phases
const deferredPhaseTimers = new Map<string, ReturnType<typeof setTimeout>>();

const metrics: BootMetrics = {
  state: 'cold',
  bootId: '',
  startedAt: 0,
  completedAt: null,
  totalDurationMs: null,
  phaseDurations: {},
  servicesUp: 0,
  servicesDegraded: 0,
  servicesDown: 0,
  servicesDeferred: 0,
  retriesTotal: 0,
  errors: bootErrors,
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PHASE DEFINITIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildPhases(): PhaseDefinition[] {
  return [
    // ── Phase 0: Core (CRITICAL - Must succeed for extension to work) ──
    {
      name: 'core',
      order: 0,
      critical: true,
      deferred: false,
      tasks: [
        {
          name: 'storage',
          critical: true,
          fn: initStorage,
        },
        // CRITICAL FIX: Message router moved to Phase 0 - must be installed first
        // so popup can always communicate with background, even if other services fail
        {
          name: 'message-router',
          critical: true, // CRITICAL: Extension is useless without message handling
          fn: initMessageRouter,
        },
      ],
    },

    // ── Phase 1: Services ──
    {
      name: 'services',
      order: 1,
      critical: false,
      deferred: false,
      tasks: [
        {
          name: 'email-service',
          critical: false,
          fn: initEmailService,
        },
        {
          name: 'otp-service',
          critical: false,
          fn: initOTPService,
        },
      ],
    },

    // ── Phase 2: Background Systems ──
    {
      name: 'background',
      order: 2,
      critical: false,
      deferred: false,
      tasks: [
        {
          name: 'polling-manager',
          critical: false,
          fn: initPollingManager,
        },
        {
          name: 'notifications',
          critical: false,
          fn: initNotificationsPhase,
        },
        {
          name: 'context-menu',
          critical: false,
          fn: initContextMenu,
        },
      ],
    },

    // ── Phase 3: Listeners ──
    {
      name: 'listeners',
      order: 3,
      critical: false,
      deferred: false,
      tasks: [
        {
          name: 'global-error-handlers',
          critical: false,
          fn: installGlobalErrorHandlers,
        },
        {
          name: 'keep-alive',
          critical: false,
          fn: installKeepAlive,
        },
      ],
    },

    // ── Phase 4: Deferred (non-critical, idle-time) ──
    {
      name: 'deferred',
      order: 4,
      critical: false,
      deferred: true,
      tasks: [
        {
          name: 'smart-detection-warmup',
          critical: false,
          fn: warmupSmartDetection,
        },
        {
          name: 'storage-diagnostics',
          critical: false,
          fn: logStorageDiagnostics,
        },
      ],
    },
  ];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TASK IMPLEMENTATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function initStorage(): Promise<void> {
  try {
    await storageService.init();
    log.debug('✅ Storage initialized');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error('❌ Storage initialization failed', {
      error: errorMsg,
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

async function initEmailService(): Promise<void> {
  try {
    // Email service is already statically imported - verify it can read its state
    await emailService.getCurrentEmail();
    log.debug('✅ Email service ready');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error('❌ Email service initialization failed', {
      error: errorMsg,
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

async function initOTPService(): Promise<void> {
  try {
    // OTP service is already statically imported - trigger any lazy initialization
    await otpService.getLastOTP?.();
    log.debug('✅ OTP service ready');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error('❌ OTP service initialization failed', {
      error: errorMsg,
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

async function initPollingManager(): Promise<void> {
  try {
    // Polling manager setup function is already statically imported
    pollingManagerSetup();
    log.debug('✅ Polling manager ready');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error('❌ Polling manager initialization failed', {
      error: errorMsg,
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

async function initNotificationsPhase(): Promise<void> {
  try {
    // Notifications init function is already statically imported
    notificationsInit();
    log.debug('✅ Notifications ready');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error('❌ Notifications initialization failed', {
      error: errorMsg,
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

async function initContextMenu(): Promise<void> {
  try {
    // Context menu setup function is already statically imported
    await contextMenuSetup();
    log.debug('✅ Context menu ready');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error('❌ Context menu initialization failed', {
      error: errorMsg,
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

async function initMessageRouter(): Promise<void> {
  try {
    log.debug('📡 Initializing message router...');
    // setupMessageHandler() is already called synchronously at module load in index.ts.
    // Only register the ML handler here to avoid double-registration.
    registerMLMessageHandler();
    log.info('✅ Message router ready - extension can now receive messages');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error('❌ Message router initialization failed', {
      error: errorMsg,
      stack: error instanceof Error ? error.stack : undefined,
    });
    // Re-throw to mark this critical task as failed
    throw error;
  }
}

async function installGlobalErrorHandlers(): Promise<void> {
  // Registered below in the module (must be synchronous top-level)
  // This task is a no-op placeholder — the actual listeners are at the bottom
  log.debug('✅ Global error handlers registered');
}

async function installKeepAlive(): Promise<void> {
  // Use chrome.alarms for MV3 keep-alive
  if (!chrome?.alarms) {
    log.warn('chrome.alarms not available — keep-alive skipped');
    return;
  }

  // Clear any stale alarm
  await chrome.alarms
    .clear(CONFIG.KEEPALIVE_ALARM_NAME)
    .catch((e) => log.debug('Keepalive alarm clear failed', e));

  // Create periodic alarm
  await chrome.alarms.create(CONFIG.KEEPALIVE_ALARM_NAME, {
    delayInMinutes: CONFIG.KEEPALIVE_INTERVAL_MIN,
    periodInMinutes: CONFIG.KEEPALIVE_INTERVAL_MIN,
  });

  log.debug('✅ Keep-alive alarm registered', {
    intervalMin: CONFIG.KEEPALIVE_INTERVAL_MIN,
  });
}

async function warmupSmartDetection(): Promise<void> {
  try {
    // Smart detection service is already statically imported - no warmup needed
    log.debug('✅ Smart Detection warmed up');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error('❌ Smart Detection warmup failed', {
      error: errorMsg,
      stack: error instanceof Error ? error.stack : undefined,
    });
    // Non-critical - don't throw
  }
}

async function logStorageDiagnostics(): Promise<void> {
  const usage = await storageService.getUsage();
  log.info('💾 Storage diagnostics', {
    used: `${(usage.used / 1024).toFixed(2)} KB`,
    quota: `${((usage.total ?? 0) / 1024).toFixed(2)} KB`,
    percentage: `${usage.percentage.toFixed(1)}%`,
  });

  // Persist boot state for crash recovery analysis
  await storageService
    .set(CONFIG.BOOT_STATE_KEY, {
      state: bootState,
      bootId: metrics.bootId,
      completedAt: Date.now(),
      servicesUp: metrics.servicesUp,
    })
    .catch((e) => log.debug('Alarm creation failed', e));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  KEEP-ALIVE TICK
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function onServiceWorkerAlarm(alarm: chrome.alarms.Alarm): void {
  if (alarm.name === CONFIG.KEEPALIVE_ALARM_NAME) {
    onKeepAliveTick();
  }
}

function onKeepAliveTick(): void {
  // Light-touch heartbeat: verify state, maybe re-init if we crashed
  if (bootState === 'cold' || bootState === 'failed') {
    log.warn('🔄 Keep-alive detected un-initialized state — attempting re-init');
    initServiceWorker().catch((e) =>
      log.error('Re-init from keep-alive failed', serializeError(e))
    );
    return;
  }

  // Health check: verify storage is still accessible
  storageService.getUsage().catch(() => {
    log.warn('Keep-alive health check: storage unreachable');
    updateServiceHealth('storage', 'degraded', 'Storage unreachable on health check');
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  BOOT ENGINE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function initServiceWorker(): Promise<void> {
  // ── Re-entrancy guard ──
  if (bootState === 'initializing' && bootPromise) {
    log.debug('Boot already in progress — awaiting existing promise');
    return bootPromise;
  }

  // ── Cooldown for re-init with EXPONENTIAL BACKOFF ──
  if (bootState !== 'cold') {
    // Circuit Breaker to prevent infinite looping
    if (reinitAttemptCount >= 5) {
      const timeSinceLastAttempt = Date.now() - lastInitTime;
      const FALLBACK_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

      if (timeSinceLastAttempt > FALLBACK_TIMEOUT_MS) {
        log.info('🔌 Circuit breaker auto-resetting after 15 minutes of cooling down.');
        reinitAttemptCount = 0;
      } else {
        log.error(
          `💥 Circuit breaker active. Halting resets. Auto-recovery in ${Math.ceil((FALLBACK_TIMEOUT_MS - timeSinceLastAttempt) / 60000)}m.`
        );
        bootState = 'failed';
        return;
      }
    }

    const gap = Date.now() - lastInitTime;
    // Calculate dynamic cooldown based on re-init attempts
    const dynamicCooldown = Math.min(
      CONFIG.REINIT_COOLDOWN_MS * Math.pow(CONFIG.REINIT_BACKOFF_MULTIPLIER, reinitAttemptCount),
      CONFIG.REINIT_MAX_COOLDOWN_MS
    );
    if (gap < dynamicCooldown) {
      log.warn('Re-init cooldown active (exponential backoff)', {
        attempt: reinitAttemptCount,
        currentCooldown: dynamicCooldown,
        remainingMs: dynamicCooldown - gap,
      });
      return;
    }
  }

  bootState = 'initializing'; // Set synchronously to prevent race condition
  bootPromise = executeBootSequence();
  return bootPromise;
}

async function executeBootSequence(): Promise<void> {
  const bootId = generateBootId();

  // ── Reset state ──
  bootState = 'initializing';
  metrics.state = 'initializing';
  metrics.bootId = bootId;
  metrics.startedAt = Date.now();
  metrics.completedAt = null;
  metrics.totalDurationMs = null;
  metrics.phaseDurations = {};
  metrics.servicesUp = 0;
  metrics.servicesDegraded = 0;
  metrics.servicesDown = 0;
  metrics.servicesDeferred = 0;
  metrics.retriesTotal = 0;
  bootErrors.length = 0;

  lastInitTime = Date.now();

  log.info('🚀 Service worker boot started', { bootId });

  const phases = buildPhases();
  let criticalFailure = false;

  // ── Boot timeout race ──
  const bootTimeout = createTimeout(CONFIG.BOOT_TIMEOUT_MS);

  try {
    for (const [index, phase] of phases.entries()) {
      if (criticalFailure) {
        log.warn(`⏭️ Skipping phase ${index} "${phase.name}" due to critical failure`);
        break;
      }

      log.debug(`▶️ Starting phase ${index}: ${phase.name}`);

      // Skip deferred phases on the critical path
      if (phase.deferred) {
        log.debug(`⏸️ Deferring phase ${index}: ${phase.name} to idle time`);
        scheduleDeferredPhase(phase);
        continue;
      }

      const phaseStart = Date.now();
      const phaseResult = await Promise.race([executePhase(phase), bootTimeout.promise]);

      if (phaseResult === 'timeout') {
        log.error(`⏱️ Phase "${phase.name}" timed out after ${CONFIG.BOOT_TIMEOUT_MS}ms`);
        if (phase.critical) {
          criticalFailure = true;
          recordBootError({
            service: `phase:${phase.name}`,
            phase: index,
            error: `Phase timed out after ${CONFIG.BOOT_TIMEOUT_MS}ms`,
            timestamp: Date.now(),
            fatal: true,
          });
        }
      } else {
        const phaseDuration = Date.now() - phaseStart;
        log.debug(`✅ Phase ${index}: ${phase.name} completed in ${phaseDuration}ms`);
      }
    }
  } catch (error) {
    const errorDetails = serializeError(error);
    log.error('💥 Boot sequence threw', errorDetails);
    criticalFailure = true;
    recordBootError({
      service: 'boot-sequence',
      phase: -1,
      error: errorDetails instanceof Error ? errorDetails.message : String(error),
      timestamp: Date.now(),
      fatal: true,
    });
  } finally {
    bootTimeout.cancel();
  }

  // ── Determine final state ──
  const downCount = countByHealth('down');
  const degradedCount = countByHealth('degraded');
  const upCount = countByHealth('up');

  metrics.servicesUp = upCount;
  metrics.servicesDegraded = degradedCount;
  metrics.servicesDown = downCount;
  metrics.servicesDeferred = countByHealth('deferred');

  if (criticalFailure || hasCriticalServiceDown()) {
    bootState = 'failed';
    reinitAttemptCount++; // Increment on failure for exponential backoff
    log.warn('Re-init attempt count incremented', { count: reinitAttemptCount });
  } else if (downCount > 0 || degradedCount > 0) {
    bootState = 'degraded';
    reinitAttemptCount = Math.max(0, reinitAttemptCount - 1); // Partial recovery
  } else {
    bootState = 'ready';
    reinitAttemptCount = 0; // Reset on successful boot
  }

  metrics.state = bootState;
  metrics.completedAt = Date.now();
  metrics.totalDurationMs = Date.now() - metrics.startedAt;

  const emoji = bootState === 'ready' ? '✅' : bootState === 'degraded' ? '⚠️' : '❌';

  log.info(`${emoji} Service worker boot complete`, {
    state: bootState,
    bootId,
    duration: `${metrics.totalDurationMs}ms`,
    up: upCount,
    degraded: degradedCount,
    down: downCount,
    deferred: metrics.servicesDeferred,
    retries: metrics.retriesTotal,
    phases: metrics.phaseDurations,
  });

  if (bootErrors.length > 0) {
    log.error('🚨 Boot errors detected:', bootErrors);

    // Log detailed error summary for debugging
    const errorSummary = bootErrors
      .map(
        (e, i) =>
          `[${i + 1}] ${e.service} (phase ${e.phase}): ${e.error}${e.fatal ? ' [FATAL]' : ''}`
      )
      .join('\n');
    log.error('Boot Error Summary', { errors: errorSummary });
  }

  // Final status report
  if (bootState === 'failed') {
    log.error('⚠️ CRITICAL: Service worker failed to initialize!');
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PHASE EXECUTOR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function executePhase(phase: PhaseDefinition): Promise<void> {
  const t0 = performance.now();
  log.debug(`── Phase ${phase.order}: ${phase.name} ──`);

  // Execute tasks in parallel within the same phase
  await Promise.allSettled(phase.tasks.map((task) => executeTask(task, phase.order)));

  const ms = Math.round(performance.now() - t0);
  metrics.phaseDurations[phase.name] = ms;

  // Check if ANY critical task in this phase failed
  const criticalFailed = phase.tasks
    .filter((t) => t.critical)
    .some((t) => {
      const record = serviceRegistry.get(t.name);
      return record?.health === 'down';
    });

  if (criticalFailed && phase.critical) {
    throw new Error(`Critical phase "${phase.name}" failed — all critical tasks down`);
  }

  log.debug(`── Phase ${phase.order} complete (${ms}ms) ──`);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TASK EXECUTOR (with retry & timeout)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function executeTask(task: TaskDefinition, phase: number): Promise<void> {
  const record: ServiceRecord = {
    name: task.name,
    phase,
    health: 'down',
    critical: task.critical,
    initDurationMs: null,
    lastError: null,
    retries: 0,
  };
  serviceRegistry.set(task.name, record);

  for (let attempt = 0; attempt <= CONFIG.MAX_RETRIES_PER_TASK; attempt++) {
    const t0 = performance.now();

    try {
      // Race against per-task timeout
      const timeout = rejectAfter(
        CONFIG.TASK_TIMEOUT_MS,
        `Task "${task.name}" timed out after ${CONFIG.TASK_TIMEOUT_MS}ms`
      );
      await Promise.race([task.fn(), timeout.promise]);
      timeout.cancel();

      record.health = 'up';
      record.initDurationMs = Math.round(performance.now() - t0);
      record.lastError = null;
      return; // success
    } catch (error) {
      record.retries++;
      metrics.retriesTotal++;

      const errMsg = extractErrorMessage(error);
      record.lastError = errMsg;

      const isLastAttempt = attempt === CONFIG.MAX_RETRIES_PER_TASK;

      if (isLastAttempt) {
        record.health = 'down';
        record.initDurationMs = Math.round(performance.now() - t0);

        recordBootError({
          service: task.name,
          phase,
          error: errMsg,
          timestamp: Date.now(),
          fatal: task.critical,
        });

        log.error(`❌ ${task.name} failed after ${attempt + 1} attempts`, {
          error: errMsg,
          critical: task.critical,
        });
      } else {
        const backoff = Math.min(CONFIG.BACKOFF_BASE_MS * 2 ** attempt, CONFIG.BACKOFF_CAP_MS);
        log.warn(`🔄 ${task.name} attempt ${attempt + 1} failed — retrying in ${backoff}ms`, {
          error: errMsg,
        });
        await sleep(backoff);
      }
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DEFERRED PHASE (idle-time execution)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function scheduleDeferredPhase(phase: PhaseDefinition): void {
  // Mark all tasks as deferred
  for (const task of phase.tasks) {
    serviceRegistry.set(task.name, {
      name: task.name,
      phase: phase.order,
      health: 'deferred',
      critical: false,
      initDurationMs: null,
      lastError: null,
      retries: 0,
    });
  }

  // Cancel existing timer if re-scheduled
  if (deferredPhaseTimers.has(phase.name)) {
    clearTimeout(deferredPhaseTimers.get(phase.name)!);
    deferredPhaseTimers.delete(phase.name);
  }

  // Schedule after a brief delay to let the critical path finish
  const timerId = setTimeout(() => {
    deferredPhaseTimers.delete(phase.name);
    executeDeferredPhase(phase).catch((e) =>
      log.warn(`Deferred phase "${phase.name}" error`, serializeError(e))
    );
  }, CONFIG.IDLE_DELAY_MS);

  deferredPhaseTimers.set(phase.name, timerId);
}

/**
 * Clear all deferred phase timers (called on SW suspend to prevent stale state)
 */
export function clearDeferredTimers(): void {
  for (const [name, timerId] of deferredPhaseTimers) {
    clearTimeout(timerId);
    log.debug(`Cleared deferred timer for phase: ${name}`);
  }
  deferredPhaseTimers.clear();
}

async function executeDeferredPhase(phase: PhaseDefinition): Promise<void> {
  log.debug(`── Deferred Phase ${phase.order}: ${phase.name} ──`);
  const t0 = performance.now();

  for (const task of phase.tasks) {
    try {
      await executeTask(task, phase.order);
    } catch {
      // Non-critical — log handled inside executeTask
    }
  }

  const ms = Math.round(performance.now() - t0);
  metrics.phaseDurations[phase.name] = ms;

  // Update deferred count
  metrics.servicesDeferred = countByHealth('deferred');
  metrics.servicesUp = countByHealth('up');

  log.debug(`── Deferred Phase ${phase.order} complete (${ms}ms) ──`);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SERVICE HEALTH REGISTRY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function updateServiceHealth(name: string, health: ServiceHealth, error?: string): void {
  const record = serviceRegistry.get(name);
  if (record) {
    record.health = health;
    record.lastError = error ?? null;
  }

  // Re-evaluate overall boot state
  const downCount = countByHealth('down');
  const degradedCount = countByHealth('degraded');

  if (hasCriticalServiceDown()) {
    bootState = 'failed';
  } else if (downCount > 0 || degradedCount > 0) {
    bootState = 'degraded';
  } else {
    bootState = 'ready';
  }

  metrics.state = bootState;
}

function countByHealth(health: ServiceHealth): number {
  let count = 0;
  for (const record of serviceRegistry.values()) {
    if (record.health === health) {
      count++;
    }
  }
  return count;
}

function hasCriticalServiceDown(): boolean {
  for (const record of serviceRegistry.values()) {
    if (record.critical && record.health === 'down') {
      return true;
    }
  }
  return false;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PUBLIC — OBSERVABILITY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function getBootState(): BootState {
  return bootState;
}

export function getBootMetrics(): Readonly<BootMetrics> {
  return { ...metrics, errors: [...bootErrors] };
}

export function getServiceHealth(): ReadonlyMap<string, Readonly<ServiceRecord>> {
  return new Map(Array.from(serviceRegistry.entries()).map(([k, v]) => [k, { ...v }]));
}

export function getServiceStatus(name: string): ServiceHealth | null {
  return serviceRegistry.get(name)?.health ?? null;
}

/**
 * Check if a specific service is available for use.
 * Returns true for 'up' and 'degraded' (usable with caveats).
 */
export function isServiceAvailable(name: string): boolean {
  const health = serviceRegistry.get(name)?.health;
  return health === 'up' || health === 'degraded';
}

/**
 * Dump boot report to console (for devtools debugging)
 */
export function dumpBootReport(): void {
  log.info('🚀 Service Worker Boot Report');
  log.info('State:', bootState);
  log.info('Boot ID:', metrics.bootId);
  log.info('Duration:', metrics.totalDurationMs ? `${metrics.totalDurationMs}ms` : 'in progress');
  log.info('Phase Durations:', metrics.phaseDurations);

  log.info(
    'Services:',
    Array.from(serviceRegistry.values()).map((r) => ({
      name: r.name,
      phase: r.phase,
      health: r.health,
      critical: r.critical ? '⚠️' : '',
      duration: r.initDurationMs !== null ? `${r.initDurationMs}ms` : '—',
      retries: r.retries,
      error: r.lastError ? truncate(r.lastError, 60) : '—',
    }))
  );

  if (bootErrors.length > 0) {
    log.info('Errors:', bootErrors);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GLOBAL ERROR HANDLERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Track error frequency for circuit breaker
let errorCount = 0;
let lastErrorTime = 0;
const ERROR_THRESHOLD = 5;
const ERROR_WINDOW_MS = 60000; // 1 minute

async function attemptRecovery(reason: string): Promise<void> {
  try {
    await storageService.getUsage();
    log.info('✅ Storage health check passed', { reason });

    if (bootState === 'degraded' || bootState === 'failed') {
      log.info('🔄 Attempting service worker re-initialization', { reason });
      await initServiceWorker();
    }
  } catch (recoveryError) {
    log.error('❌ Recovery failed', {
      reason,
      recoveryError: serializeError(recoveryError),
    });
  }
}

self.addEventListener('error', (event: ErrorEvent) => {
  const now = Date.now();

  // Track error frequency
  if (now - lastErrorTime > ERROR_WINDOW_MS) {
    errorCount = 1;
  } else {
    errorCount++;
  }
  lastErrorTime = now;

  const errorInfo = {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error?.stack?.split('\n').slice(0, 5).join('\n'),
    bootState,
    errorFrequency: errorCount,
  };

  log.error('🔥 Unhandled error', errorInfo);

  recordBootError({
    service: 'global',
    phase: -1,
    error: event.message,
    timestamp: now,
    fatal: false,
  });

  // Fixed: Error recovery - if too many errors in short time, attempt graceful recovery
  if (errorCount >= ERROR_THRESHOLD) {
    log.error('🚨 Error threshold exceeded, initiating recovery');

    // Reset error counter
    errorCount = 0;

    // Attempt to reinitialize critical services
    void attemptRecovery('error-threshold');
  }
});

self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  const now = Date.now();
  const reason = serializeError(event.reason);

  // Track error frequency
  if (now - lastErrorTime > ERROR_WINDOW_MS) {
    errorCount = 1;
  } else {
    errorCount++;
  }
  lastErrorTime = now;

  log.error('🔥 Unhandled promise rejection', {
    ...reason,
    bootState,
    errorFrequency: errorCount,
  });

  recordBootError({
    service: 'global',
    phase: -1,
    error:
      typeof reason === 'string'
        ? reason
        : ((reason as { message?: string }).message ?? String(event.reason)),
    timestamp: now,
    fatal: false,
  });

  // Fixed: Attempt recovery for unhandled rejections too
  if (errorCount >= ERROR_THRESHOLD) {
    log.error('🚨 Rejection threshold exceeded, initiating recovery');
    errorCount = 0;

    void attemptRecovery('rejection-threshold');
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  UTILITIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function rejectAfter(ms: number, message: string): { promise: Promise<never>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

interface CancellableTimeout {
  promise: Promise<'timeout'>;
  cancel: () => void;
}

function createTimeout(ms: number): CancellableTimeout {
  let timer: ReturnType<typeof setTimeout>;

  const promise = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
  });

  return {
    promise,
    cancel: () => clearTimeout(timer),
  };
}

function generateBootId(): string {
  const ts = Date.now().toString(36);
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const rnd = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${ts}-${rnd}`;
}

/**
 * Serialize any error into a structured object.
 * Handles Error, DOMException, string, and unknown.
 */
function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof DOMException) {
    return {
      type: 'DOMException',
      name: error.name,
      message: error.message,
      code: error.code,
    };
  }
  if (error instanceof Error) {
    return {
      type: error.constructor.name,
      name: error.name,
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
    };
  }
  if (typeof error === 'string') {
    return { type: 'string', message: error };
  }
  return { type: typeof error, value: String(error) };
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return String(error);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.substring(0, max) + '…' : s;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DEPRECATED — kept for backward compatibility
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** @deprecated Use chrome.alarms via installKeepAlive() instead */
export function keepAlive(): void {
  log.warn('keepAlive() is deprecated — keep-alive is now managed by chrome.alarms');
}
