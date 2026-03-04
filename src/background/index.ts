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

import './polyfill'; // Keep this as the first import to polyfill setImmediate
import { sleep } from '../utils/helpers';
import { createLogger } from '../utils/logger';
import { safeSendTabMessage } from '../utils/messaging';

import { dumpMenuStats } from './contextMenu';
import { dumpRouterStats } from './messageHandler';
import { initNotifications, dumpNotificationStats } from './notifications';
import { getPollingMetrics, startEmailPolling } from './pollingManager';
import { initServiceWorker, getBootState, dumpBootReport } from './serviceWorker';

const __BACKGROUND_LOAD_START__ = Date.now();
const log = createLogger('Background');

// Log successful module load
const loadDuration = Date.now() - __BACKGROUND_LOAD_START__;
log.info(`✅ Background module loaded successfully in ${loadDuration}ms`);

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
    HEALTH_INTERVAL_MIN: 5,              // 5 minutes (was 1 minute - too aggressive)
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
let listenersInstalled = false;
let healthFailures = 0;

// ISSUE #12 FIX: Initialization lock to prevent race conditions
// This flag is checked BEFORE any async operations to prevent
// simultaneous onInstalled/onStartup initialization
let isInitializing = false;

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
    const t0 = Date.now();

    // ISSUE #12 FIX: Initialization lock - check BEFORE any async operations
    // This prevents race conditions when onInstalled and onStartup fire simultaneously
    if (isInitializing) {
        log.debug('⏳ Initialization already in progress, skipping duplicate call');
        return;
    }

    // Idempotent guard
    if (initialized && getBootState() === 'ready') {
        log.debug('Already initialized');
        return;
    }

    // Set initialization lock
    isInitializing = true;

    metrics.initStartedAt = t0;
    metrics.initTrigger = trigger;

    log.info('⚡ Initializing', { trigger });

    try {
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

        // Phase 3: Install-specific flows
        log.debug(`▶️ Phase 3: Install-specific flows (trigger: ${trigger})`);
        if (trigger === 'install') {
            await onFreshInstall();
        } else if (trigger === 'update') {
            // ISSUE #2 FIX: onUpdate is now async, properly awaited
            await onUpdate();
        }

        // Phase 4: Event listeners (idempotent)
        log.debug('▶️ Phase 4: Event listeners');
        if (!listenersInstalled) {
            registerCommands();
            installListeners();
            listenersInstalled = true;
        }

        // Phase 5: Health monitor
        log.debug('▶️ Phase 5: Health monitor');
        setupHealthAlarm();

        // Phase 6: Dev utilities
        if (CONFIG.DEV_MODE) {
            installDevTools();
        }

        initialized = true;
        metrics.initCompletedAt = Date.now();
        metrics.initDurationMs = Date.now() - t0;

        log.info('✅ Initialization complete', {
            trigger,
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
        // ISSUE #12 FIX: Always release initialization lock
        isInitializing = false;
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  INSTALL-SPECIFIC FLOWS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function onFreshInstall(): Promise<void> {
    log.info('🆕 Fresh install');

    // Clear storage
    if (CONFIG.CLEAR_STORAGE_ON_INSTALL) {
        try {
            await chrome.storage.local.clear();
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
        try {
            // Open popup instead of options page
            await chrome.action.openPopup();
        } catch (e) {
            log.warn('Popup open failed', extractMsg(e));
            // Popup may be blocked by browser - not critical
        }
    }
}

// ISSUE #2 FIX: onUpdate() is now properly async and returns Promise<void>
async function onUpdate(): Promise<void> {
    log.info('🔄 Extension updated');
    // Future: migration logic, changelog, etc.
    // TODO: Add version migration logic when updating major versions
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
            await safeSendTabMessage(tab.id, { action: 'FILL_FORM' });
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
    chrome.commands.onCommand.addListener(async (cmd) => {
        metrics.commandsExecuted++;
        const stats = metrics.byCommand[cmd];
        if (stats) { stats.count++; }

        const def = commands.get(cmd);
        if (!def) {
            log.warn('Unknown command', { cmd });
            return;
        }

        try {
            await def.handler();
        } catch (error) {
            metrics.commandErrors++;
            if (stats) { stats.errors++; }
            log.error('Command failed', { cmd, error: extractMsg(error) });

            const { notifyError } = await import('./notifications');
            await notifyError('Error', 'Command failed');
        }
    });

    // Health alarm
    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === CONFIG.HEALTH_ALARM) {
            runHealthCheck().catch((e) => log.warn('Health check error', extractMsg(e)));
        }
    });

    log.debug('Event listeners installed');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  HEALTH MONITOR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function setupHealthAlarm(): void {
    chrome.alarms.clear(CONFIG.HEALTH_ALARM).catch(() => { });
    chrome.alarms.create(CONFIG.HEALTH_ALARM, {
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
        dumpRouterStats();
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
    if (at <= 2) { return email; }
    return email[0] + '•'.repeat(Math.min(at - 1, 5)) + email.slice(at);
}

function safeCall(fn: () => void): void {
    try { fn(); } catch (e) { log.warn('SafeCall failed', extractMsg(e)); }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  MODULE LOAD (minimal side-effects)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

log.debug('📦 Background module loaded');