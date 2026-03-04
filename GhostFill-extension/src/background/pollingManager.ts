// ─────────────────────────────────────────────────────────────────────
// Polling Manager v2 — Intelligent Adaptive Polling Engine
// Replaces MV3 Alarms with Content Script Pacemaker heartbeats
//
// ┌──────────────────────────────────────────────────────────────────┐
// │  Features                                                       │
// │  ─ Adaptive intervals that respond to system state              │
// │  ─ Circuit breaker with exponential backoff                     │
// │  ─ Sliding-window rate limiter                                  │
// │  ─ Email deduplication cache with TTL                           │
// │  ─ Unified email processing pipeline (no duplicate logic)       │
// │  ─ Priority-ordered OTP delivery                                │
// │  ─ Self-healing health monitor                                  │
// │  ─ Observable metrics for debugging                             │
// │  ─ Graceful lifecycle (init → run → destroy)                    │
// └──────────────────────────────────────────────────────────────────┘
// ─────────────────────────────────────────────────────────────────────

import { emailService } from '../services/emailServices';
import { linkService } from '../services/linkService';
import { otpService } from '../services/otpService';
import { smartDetectionService } from '../services/smartDetectionService';
import { storageService } from '../services/storageService';
import { EmailAccount } from '../types';
import { createLogger } from '../utils/logger';
import { safeSendTabMessage } from '../utils/messaging';

import { updateOTPMenuItem } from './contextMenu';

const log = createLogger('PollingEngine');

// Notification rate limiting
let lastNotificationTime = 0;
const NOTIFICATION_RATE_LIMIT_MS = 30000; // 30 seconds between notifications

/**
 * Managed notification with rate limiting and badge only.
 * Prevents notification spam while still showing visual indicator.
 */
async function showManagedNotification(title: string, _message: string): Promise<void> {
    const now = Date.now();

    // Rate limit check - only show badge, skip notification popup
    if (now - lastNotificationTime < NOTIFICATION_RATE_LIMIT_MS) {
        log.debug('Notification rate limited, badge only', {
            title,
            secondsSinceLast: Math.round((now - lastNotificationTime) / 1000)
        });
    } else {
        lastNotificationTime = now;
        log.debug('Notification shown', { title });
    }

    // Always show badge (regardless of rate limit)
    if (chrome?.action) {
        chrome.action.setBadgeText({ text: '!' });
        chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });

        // Clear badge after 5 seconds
        setTimeout(() => {
            if (chrome?.action) {
                chrome.action.setBadgeText({ text: '' });
            }
        }, 5000);
    }

    // Skip chrome.notifications.create to prevent spam
    // Users will see badge and can check popup for details
    return Promise.resolve();
}

// ━━━ Types ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface TabRegistration {
    url: string;
    hostname: string;
    fieldSelectors: string[];
    registeredAt: number;
    priority: number;          // lower = first to receive OTPs
    deliveryAttempts: number;
}



interface ProcessedEmailRecord {
    id: string;
    processedAt: number;
    hadOTP: boolean;
    hadLink: boolean;
    ttlExpiresAt: number;  // When this record should be evicted
}

type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreaker {
    state: CircuitState;
    consecutiveFailures: number;
    consecutiveSuccesses: number;
    lastFailureTime: number;
    nextRetryTime: number;
}

interface PollingMetrics {
    startedAt: number;
    totalChecks: number;
    successfulChecks: number;
    failedChecks: number;
    otpsFound: number;
    otpsDelivered: number;
    linksProcessed: number;
    emailsProcessed: number;
    avgCheckMs: number;         // exponential moving average
    lastSuccessTime: number;
    lastErrorMessage: string | null;
    lastErrorTime: number;
}

type CheckMode = 'fast' | 'general';

// ━━━ Tunable Constants ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const TIMING = {
    // Fast OTP polling ladder (widens the longer we wait)
    FAST_FLOOR: 3_000,      //  3 s — absolute minimum
    FAST_AGGRESSIVE: 4_000,      //  4 s — first 15 seconds
    FAST_NORMAL: 6_000,      //  6 s — 15-45 seconds
    FAST_RELAXED: 12_000,      // 12 s — 45-90 seconds
    FAST_CEILING: 20_000,      // 20 s — 90 s+

    // General background polling ladder
    GENERAL_ACTIVE: 7_000,      // 7 s — tabs waiting
    GENERAL_DEFAULT: 10_000,    // 10 s — normal (User complaint: 20s was too slow)
    GENERAL_IDLE: 20_000,       // 20 s — no activity
    GENERAL_DORMANT: 30_000,    // 30 s — no connections at all

    // Lifecycle
    STALE_TAB_MS: 300_000,      //  5 min — expire forgotten registrations
    DEDUP_TTL_MS: 600_000,      // 10 min — processed-email cache
    HEALTH_TICK_MS: 30_000,      // 30 s   — janitor sweep
    METRICS_TICK_MS: 60_000,      // 60 s   — log snapshot
} as const;

const CIRCUIT = {
    FAIL_THRESHOLD: 5,
    HALF_OPEN_SUCCESSES: 3,       // close after N consecutive successes
    BACKOFF_BASE_MS: 5_000,
    BACKOFF_CAP_MS: 120_000,
} as const;

const RATE = {
    MAX_PER_WINDOW: 20,
    WINDOW_MS: 60_000,
} as const;

// ━━━ Module State ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const otpWaitingTabs = new Map<number, TabRegistration>();
const processedEmails = new Map<string, ProcessedEmailRecord>();
const requestLog: number[] = [];                 // timestamps of API calls

let pollingActive = false;
let generalTimer: number | null = null;
let healthTimer: number | null = null;
let metricsTimer: number | null = null;
let lastGlobalCheckTime = 0;
let initialized = false;
let priorityCounter = 0;                    // monotonic counter for tab ordering

// Fixed: Proper locking mechanism for concurrent email processing
let checkInProgress = false;
let pendingCheckRequest = false;  // Request coalescing: track if a check was requested while one was in progress
const checkLock = {
    locked: false,
    queue: Array<() => void>(),

    async acquire(): Promise<void> {
        if (!this.locked) {
            this.locked = true;
            return;
        }
        // Wait for lock to be released
        return new Promise((resolve) => {
            this.queue.push(() => { resolve(); });
        });
    },

    release(): void {
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            if (next) { next(); }
        } else {
            this.locked = false;
        }
    }
};

const breaker: CircuitBreaker = {
    state: 'closed',
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    lastFailureTime: 0,
    nextRetryTime: 0,
};

const metrics: PollingMetrics = {
    startedAt: 0,
    totalChecks: 0,
    successfulChecks: 0,
    failedChecks: 0,
    otpsFound: 0,
    otpsDelivered: 0,
    linksProcessed: 0,
    emailsProcessed: 0,
    avgCheckMs: 0,
    lastSuccessTime: 0,
    lastErrorMessage: null,
    lastErrorTime: 0,
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CIRCUIT BREAKER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function breakerAllowsRequest(): boolean {
    if (breaker.state === 'closed') { return true; }

    if (breaker.state === 'open') {
        if (Date.now() >= breaker.nextRetryTime) {
            breaker.state = 'half-open';
            breaker.consecutiveSuccesses = 0;
            log.info('🟡 Circuit → half-open (probe request allowed)');
            return true;
        }
        return false;
    }

    // half-open: allow requests so we can gauge recovery
    return true;
}

function breakerRecordSuccess(): void {
    breaker.consecutiveFailures = 0;
    breaker.consecutiveSuccesses++;

    if (
        breaker.state === 'half-open' &&
        breaker.consecutiveSuccesses >= CIRCUIT.HALF_OPEN_SUCCESSES
    ) {
        breaker.state = 'closed';
        log.info('🟢 Circuit → closed (recovered)');
    }
}

function breakerRecordFailure(error: unknown): void {
    breaker.consecutiveSuccesses = 0;
    breaker.consecutiveFailures++;
    breaker.lastFailureTime = Date.now();

    metrics.lastErrorMessage =
        error instanceof Error ? error.message : String(error);
    metrics.lastErrorTime = Date.now();

    if (breaker.consecutiveFailures >= CIRCUIT.FAIL_THRESHOLD) {
        breaker.state = 'open';
        const backoff = Math.min(
            CIRCUIT.BACKOFF_BASE_MS *
            2 ** (breaker.consecutiveFailures - CIRCUIT.FAIL_THRESHOLD),
            CIRCUIT.BACKOFF_CAP_MS,
        );
        breaker.nextRetryTime = Date.now() + backoff;
        log.warn('🔴 Circuit → open', {
            failures: breaker.consecutiveFailures,
            retryInMs: backoff,
        });
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SLIDING-WINDOW RATE LIMITER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function pruneRequestLog(): void {
    const cutoff = Date.now() - RATE.WINDOW_MS;
    while (requestLog.length > 0 && requestLog[0]! < cutoff) {
        requestLog.shift();
    }
}

function rateLimited(): boolean {
    pruneRequestLog();
    return requestLog.length >= RATE.MAX_PER_WINDOW;
}

function stampRequest(): void {
    requestLog.push(Date.now());
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DEDUPLICATION CACHE WITH TTL-BASED EVICTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Note: ProcessedEmailRecord interface removed - using the one declared earlier (line 88)
// Note: CheckMode type removed - already declared at line 113

// Fixed: TTL-based Map with automatic eviction tracking
// processedEmails already declared at line 153
const processedEmailsTTL = new Map<string, number>(); // emailId -> timeoutId for eviction

/**
 * Check if email was already processed (respects TTL)
 */
function alreadyProcessed(emailId: string | number): boolean {
    const id = String(emailId);
    const record = processedEmails.get(id);

    if (!record) { return false; }

    // Check if TTL has expired
    if (Date.now() >= record.ttlExpiresAt) {
        processedEmails.delete(id);
        processedEmailsTTL.delete(id);
        return false;
    }

    return true;
}

/**
 * Mark email as processed with TTL-based auto-eviction
 */
function markProcessed(
    emailId: string | number,
    hadOTP: boolean,
    hadLink: boolean,
): void {
    const id = String(emailId);
    const now = Date.now();
    const expiresAt = now + TIMING.DEDUP_TTL_MS;

    // Clear any existing TTL timer for this email
    const existingTimer = processedEmailsTTL.get(id);
    if (existingTimer) {
        clearTimeout(existingTimer);
    }

    const record: ProcessedEmailRecord = {
        id,
        processedAt: now,
        hadOTP,
        hadLink,
        ttlExpiresAt: expiresAt,
    };

    processedEmails.set(id, record);

    // Schedule automatic eviction when TTL expires
    const evictionTimer = setTimeout(() => {
        processedEmails.delete(id);
        processedEmailsTTL.delete(id);
        storageService.set('processedEmails', Object.fromEntries(processedEmails)).catch((e: Error) => log.warn('Failed to save processed emails state on eviction', e));
        log.debug('Email dedup TTL expired, evicted from cache', { id });
    }, TIMING.DEDUP_TTL_MS) as unknown as number;

    processedEmailsTTL.set(id, evictionTimer);

    // Persist to storage to survive Service Worker unloads
    storageService.set('processedEmails', Object.fromEntries(processedEmails)).catch((e: Error) => log.warn('Failed to save processed emails state', e));

    log.debug('Email marked as processed', { id, hadOTP, hadLink, ttlMs: TIMING.DEDUP_TTL_MS });
}

/**
 * Prune processed cache (cleanup for edge cases)
 * Now less critical due to TTL-based auto-eviction
 */
function pruneProcessedCache(): void {
    const now = Date.now();
    let pruned = 0;

    for (const [id, rec] of processedEmails) {
        if (now >= rec.ttlExpiresAt) {
            processedEmails.delete(id);
            const timer = processedEmailsTTL.get(id);
            if (timer) {
                clearTimeout(timer);
                processedEmailsTTL.delete(id);
            }
            pruned++;
        }
    }

    if (pruned) {
        log.debug('🧹 Pruned dedup cache', { pruned, remaining: processedEmails.size });
    }

    // Also clean up any orphaned timers (safety check)
    for (const [id, timer] of processedEmailsTTL) {
        if (!processedEmails.has(id)) {
            clearTimeout(timer);
            processedEmailsTTL.delete(id);
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ADAPTIVE INTERVAL CALCULATOR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function adaptiveInterval(mode: CheckMode): number {
    const now = Date.now();

    if (mode === 'fast') {
        if (otpWaitingTabs.size === 0) { return TIMING.FAST_CEILING; }

        // How long has the *oldest* tab been waiting?
        const oldestReg = Math.min(
            ...Array.from(otpWaitingTabs.values()).map((t) => t.registeredAt),
        );
        const waited = now - oldestReg;

        if (waited < 15_000) { return TIMING.FAST_AGGRESSIVE; }
        if (waited < 45_000) { return TIMING.FAST_NORMAL; }
        if (waited < 90_000) { return TIMING.FAST_RELAXED; }
        return TIMING.FAST_CEILING;
    }

    // General mode — scale with activity level
    if (otpWaitingTabs.size > 0) { return TIMING.GENERAL_ACTIVE; }
    return TIMING.GENERAL_DEFAULT;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GUARD — single gate for "should we fire a check right now?"
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function checkPermitted(mode: CheckMode): boolean {
    if (!breakerAllowsRequest()) {
        log.debug('⛔ Blocked by circuit breaker', { state: breaker.state });
        return false;
    }
    if (rateLimited()) {
        log.debug('⛔ Rate-limited', { requestsInWindow: requestLog.length });
        return false;
    }
    if (mode === 'fast') {
        const gap = Date.now() - lastGlobalCheckTime;
        if (gap < TIMING.FAST_FLOOR) { return false; }
    }
    return true;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PACEMAKER CONNECTION MANAGEMENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function setupPollingManager(): void {
    if (initialized) {
        log.warn('Already initialized — skipping');
        return;
    }
    initialized = true;
    metrics.startedAt = Date.now();

    // Load persisted state to survive Service Worker unloads
    storageService.get('processedEmails').then((saved: any) => {
        if (saved && typeof saved === 'object') {
            for (const [id, record] of Object.entries(saved)) {
                processedEmails.set(id, record as ProcessedEmailRecord);
            }
        }
    }).catch((e: Error) => log.warn('Failed to load processed emails state', e));

    // Use chrome.alarms for background email sync
    chrome.alarms.create('email-sync', { periodInMinutes: 1 });
    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === 'email-sync') {
            performCheck('general').catch(e => log.warn('Alarm check failed', e));
        }
    });

    // Listen for link activation events from linkService
    // This avoids circular dependency - linkService sends message instead of importing
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.action === 'LINK_ACTIVATED') {
            log.info('🔗 Link activated - cooling down polling', {
                timestamp: message.payload?.timestamp,
                source: message.payload?.source,
            });
            stopEmailPolling();
            sendResponse({ ok: true });
        }
        return true; // Keep channel open for async response
    });

    // Auto-start polling if there's an existing email
    emailService.getCurrentEmail().then(email => {
        if (email) {
            log.info('Found existing email, starting background polling');
            startEmailPolling();
        }
    }).catch(() => { });

    startHealthMonitor();
    startMetricsReporter();

    log.info('🚀 Polling engine initialized with Alarms');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PUBLIC — GENERAL EMAIL POLLING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function startEmailPolling(): void {
    if (pollingActive) { return; }
    pollingActive = true;
    log.info('📧 General polling STARTED');
    scheduleGeneralPoll();
}

export function stopEmailPolling(): void {
    if (!pollingActive) { return; }
    pollingActive = false;
    if (generalTimer) {
        clearTimeout(generalTimer);
        generalTimer = null;
    }

    // Clean up all TTL timers to prevent memory leaks
    for (const [, timer] of processedEmailsTTL) {
        clearTimeout(timer);
    }
    processedEmailsTTL.clear();
    processedEmails.clear();

    log.info('📧 General polling STOPPED, dedup cache cleared');
}

function scheduleGeneralPoll(): void {
    if (!pollingActive) { return; }
    if (generalTimer) { clearTimeout(generalTimer); }

    const interval = adaptiveInterval('general');

    generalTimer = setTimeout(async () => {
        if (!pollingActive) { return; }
        await performCheck('general');
        scheduleGeneralPoll();
    }, interval) as unknown as number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PUBLIC — FAST OTP POLLING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function startFastOTPPolling(
    tabId: number,
    url: string,
    fieldSelectors: string[],
): void {
    let hostname = '';
    try { hostname = new URL(url).hostname; } catch { hostname = url; }

    otpWaitingTabs.set(tabId, {
        url,
        hostname,
        fieldSelectors,
        registeredAt: Date.now(),
        priority: priorityCounter++,
        deliveryAttempts: 0,
    });

    log.info('⚡ Fast OTP registered', {
        tabId,
        hostname,
        totalWaiting: otpWaitingTabs.size,
    });

    // Immediate first check
    if (checkPermitted('fast')) {
        lastGlobalCheckTime = Date.now();
        performCheck('fast').catch((e) =>
            log.warn('Initial fast-check error', e),
        );
    }

    // Ensure background polling is running
    if (!pollingActive) { startEmailPolling(); }
}

export function stopFastOTPPolling(tabId: number): void {
    if (!otpWaitingTabs.delete(tabId)) { return; }
    log.info('🛑 Fast OTP unregistered', { tabId, remaining: otpWaitingTabs.size });
}

export function getOTPWaitingTabs(): ReadonlyMap<number, TabRegistration> {
    return otpWaitingTabs;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CORE — UNIFIED INBOX CHECK
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function performCheck(mode: CheckMode): Promise<void> {
    // Fixed: Request coalescing - if a check is in progress, mark that we need another check
    if (checkInProgress) {
        pendingCheckRequest = true;
        log.debug('Check already in progress, coalescing request', { mode });
        return;
    }

    if (!checkPermitted(mode)) { return; }

    // Fixed: Use proper locking mechanism
    await checkLock.acquire();

    try {
        checkInProgress = true;
        pendingCheckRequest = false;  // Clear pending request since we're now processing
        const t0 = Date.now();
        metrics.totalChecks++;
        stampRequest();

        try {
            const currentEmail = await emailService.getCurrentEmail();
            if (!currentEmail) {
                log.debug('No current email configured');
                return;
            }

            log.debug(`Checking inbox for: ${currentEmail.fullEmail}`);

            const cachedInbox = await emailService.getCachedInbox();
            const freshInbox = await emailService.checkInbox(currentEmail);

            log.debug(`Found ${freshInbox.length} emails`);

            const cachedIds = new Set(cachedInbox.map((e) => e.id));

            // Filter to only process:
            // 1. Emails not in cache (new)
            // 2. Emails not already processed in this session
            // 3. Emails from the last hour (prevent mass reprocessing on cache loss)
            const oneHourAgo = Date.now() - (60 * 60 * 1000);
            const newEmails = freshInbox.filter((e) => {
                // Skip if already in cache
                if (cachedIds.has(e.id)) { return false; }
                // Skip if already processed this session
                if (alreadyProcessed(String(e.id))) { return false; }
                // Skip old emails (older than 1 hour) to prevent mass reprocessing on cache loss
                const emailTime = e.date || 0;
                if (emailTime < oneHourAgo) {
                    log.debug('Skipping old email', { id: e.id, age: Date.now() - emailTime });
                    return false;
                }
                return true;
            });

            if (newEmails.length > 0) {
                log.info(`📬 ${newEmails.length} new email(s)`, { mode });

                // Process in parallel with a concurrency cap of 3
                const batches = chunk(newEmails, 3);
                for (const batch of batches) {
                    await Promise.allSettled(
                        batch.map((email) =>
                            processEmail(String(email.id), currentEmail, mode)
                        )
                    );
                }
            }

            breakerRecordSuccess();
            metrics.successfulChecks++;
            metrics.lastSuccessTime = Date.now();
        } catch (error) {
            breakerRecordFailure(error);
            metrics.failedChecks++;
            log.warn(`Inbox check failed [${mode}]`, {
                error: error instanceof Error ? error.message : String(error),
                circuit: breaker.state,
                failures: breaker.consecutiveFailures,
            });
        } finally {
            const elapsed = Date.now() - t0;
            // Exponential moving average (α = 0.2)
            metrics.avgCheckMs =
                metrics.avgCheckMs === 0
                    ? elapsed
                    : metrics.avgCheckMs * 0.8 + elapsed * 0.2;
        }
    } finally {
        // Fixed: Always release lock and reset flags
        checkInProgress = false;

        // Fixed: If a request was coalesced, trigger another check
        if (pendingCheckRequest) {
            log.debug('Processing coalesced check request');
            pendingCheckRequest = false;
            // Use setTimeout(0) to avoid stack overflow (setImmediate is not available in service workers)
            setTimeout(() => performCheck(mode).catch(e => log.warn('Coalesced check failed', e)), 0);
        }

        checkLock.release();
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CORE — UNIFIED EMAIL PROCESSING PIPELINE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function processEmail(
    emailId: string | number,
    currentEmail: EmailAccount,
    _mode: CheckMode,
): Promise<void> {
    void _mode; // Prevent unused variable warning while keeping API signature
    if (alreadyProcessed(String(emailId))) { return; }

    const fullEmail = await emailService.readEmail(emailId, currentEmail);
    metrics.emailsProcessed++;

    // ── Detection ──
    const expectedDomains = collectExpectedDomains();

    const detection = await smartDetectionService.detect(
        fullEmail.subject,
        fullEmail.body,
        fullEmail.htmlBody,
        fullEmail.from,
        expectedDomains.length > 0 ? expectedDomains : undefined,
    );

    const hasOTP = (detection.type === 'otp' || detection.type === 'both') && Boolean(detection.code);
    const hasLink = (detection.type === 'link' || detection.type === 'both') && Boolean(detection.link);

    // Mark processed *before* side-effects so a crash doesn't re-process
    markProcessed(emailId, hasOTP, hasLink);

    // ── Link path (PRIORITIZED - activation emails) - AUTO-OPEN ──
    if (hasLink && detection.link) {
        log.info('🔗 Link detected, deferring to linkService:', detection.link);
        // Use the dedicated link service for proper queueing, auto-confirm logic, and robust tab loading
        await linkService.handleNewEmail(fullEmail).catch((e: Error) => log.warn('linkService error', e));
        showManagedNotification('Verification Link Found', `From: ${fullEmail.from}`);
    }

    // ── OTP path (only if no link, or if type is 'both') ──
    if (hasOTP && detection.code) {
        log.info('🔢 OTP detected:', detection.code);

        // Use the priority-sorted delivery engine (otpWaitingTabs first, then fallback)
        await deliverOTP(
            detection.code,
            detection.confidence,
            { from: fullEmail.from, subject: fullEmail.subject, provider: detection.provider },
        );

        // Notification
        showManagedNotification(`OTP: ${detection.code}`, `From: ${fullEmail.from}`);
    }

    if (!hasOTP && !hasLink) {
        // ── Regular email: notify ──
        log.info('New email', { subject: fullEmail.subject });
        showManagedNotification('New Email', `From: ${fullEmail.from}`);
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  OTP DELIVERY ENGINE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function deliverOTP(
    code: string,
    confidence: number,
    email: { from: string; subject: string; provider?: string },
): Promise<void> {
    metrics.otpsFound++;

    await otpService.saveLastOTP(code, 'email', email.from, email.subject, confidence);
    await updateOTPMenuItem();

    const masked = code.substring(0, 2) + '•'.repeat(Math.max(0, code.length - 2));
    log.info('🎯 OTP detected', {
        code: masked,
        confidence: `${Math.round(confidence * 100)}%`,
        from: email.from,
        waitingTabs: otpWaitingTabs.size,
    });


    // 1) Priority-sorted delivery to explicitly waiting tabs
    const sorted = Array.from(otpWaitingTabs.entries()).sort(
        ([, a], [, b]) => a.priority - b.priority,
    );

    const fulfilled: number[] = [];

    for (const [tabId, reg] of sorted) {
        if (!isDomainMatch(email.from, reg.url, email.provider)) {
            log.info(`⛔ OTP Domain Mismatch: Tab ${reg.hostname} != Email ${email.from}`);
            continue;
        }

        const ok = await tryDeliverToTab(tabId, code, confidence);
        if (ok) {
            reg.deliveryAttempts++;
            fulfilled.push(tabId);
        }
        // Note: We no longer automatically stop polling on delivery failure
        // The tab might still be waiting for the next OTP
    }

    // Only stop polling for tabs where delivery succeeded
    fulfilled.forEach((id) => stopFastOTPPolling(id));


    // No fallback notification needed here, as it's now handled in processEmail
}

async function tryDeliverToTab(
    tabId: number,
    code: string,
    confidence: number,
): Promise<boolean> {
    try {
        const result = await safeSendTabMessage(tabId, {
            action: 'AUTO_FILL_OTP',
            payload: { otp: code, source: 'email', confidence },
        });

        if (!result || result.success === false) {
            return false;
        }

        metrics.otpsDelivered++;
        log.info('📲 OTP delivered', { tabId });
        return true;
    } catch {
        return false;
    }
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  HEALTH MONITOR — self-healing janitor
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function startHealthMonitor(): void {
    if (healthTimer) { return; }

    healthTimer = setInterval(() => {
        const now = Date.now();

        // ── Stale OTP registrations ──
        for (const [tabId, reg] of otpWaitingTabs) {
            if (now - reg.registeredAt > TIMING.STALE_TAB_MS) {
                log.info('🧹 Expired stale OTP tab', { tabId, hostname: reg.hostname });
                stopFastOTPPolling(tabId);
            }
        }



        // ── Dedup cache ──
        pruneProcessedCache();

        // ── Rate-limiter log ──
        pruneRequestLog();

        // Note: We no longer auto-stop polling when no OTP pages are open
        // Email polling should always run to detect new emails
    }, TIMING.HEALTH_TICK_MS) as unknown as number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  METRICS REPORTER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function startMetricsReporter(): void {
    if (metricsTimer) { return; }

    metricsTimer = setInterval(() => {
        const uptimeSec = Math.round((Date.now() - metrics.startedAt) / 1000);
        log.debug('📊 Engine snapshot', {
            uptime: `${uptimeSec}s`,
            checks: `${metrics.successfulChecks}/${metrics.totalChecks} ok`,
            avgMs: Math.round(metrics.avgCheckMs),
            otps: `${metrics.otpsFound} found · ${metrics.otpsDelivered} delivered`,
            emails: metrics.emailsProcessed,
            links: metrics.linksProcessed,
            waitingTabs: otpWaitingTabs.size,
            circuit: breaker.state,
            dedupCache: processedEmails.size,
            rateWindow: requestLog.length,
        });
    }, TIMING.METRICS_TICK_MS) as unknown as number;
}

export function getPollingMetrics() {
    return {
        ...metrics,
        uptimeMs: Date.now() - metrics.startedAt,
        waitingTabs: otpWaitingTabs.size,
        circuitState: breaker.state,
        currentInterval: adaptiveInterval('general'),
        processedCached: processedEmails.size,
    } as const;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  LIFECYCLE — graceful teardown
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function destroyPollingManager(): void {
    stopEmailPolling();

    if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
    if (metricsTimer) { clearInterval(metricsTimer); metricsTimer = null; }

    otpWaitingTabs.clear();
    processedEmails.clear();
    requestLog.length = 0;
    initialized = false;
    priorityCounter = 0;

    log.info('💀 Polling engine destroyed');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  UTILITIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function isDomainMatch(senderEmail: string, tabUrl: string, providerName?: string): boolean {
    if (!tabUrl || tabUrl.startsWith('chrome://') || tabUrl.startsWith('about:')) { return false; }
    try {
        const tabHostname = new URL(tabUrl).hostname.toLowerCase();
        const senderDomain = senderEmail.split('@')[1]?.toLowerCase() || '';

        // 1. Direct domain overlap (e.g. mail.instagram.com inside instagram.com)
        const cleanTabHostname = tabHostname.replace(/^(www\.|app\.|auth\.|login\.|secure\.)/, '');
        const cleanSenderDomain = senderDomain.replace(/^(mail\.|notify\.|info\.|secure\.|auth\.|reply\.|accounts\.|accounts-)/, '');

        if (cleanTabHostname.includes(cleanSenderDomain) || cleanSenderDomain.includes(cleanTabHostname)) {
            return true;
        }

        // 2. Exact Provider Keyword match
        if (providerName) {
            const normalizedProvider = providerName.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (normalizedProvider.length > 2 && cleanTabHostname.includes(normalizedProvider)) {
                return true;
            }
        }

        return false;
    } catch {
        return false;
    }
}

function collectExpectedDomains(): string[] {
    const seen = new Set<string>();
    for (const reg of otpWaitingTabs.values()) {
        if (reg.hostname) { seen.add(reg.hostname); }
    }
    return [...seen];
}

function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        out.push(arr.slice(i, i + size));
    }
    return out;
}