// ─────────────────────────────────────────────────────────────────────
// Offscreen Manager v2 — State-Machine, Health-Checked, Multi-Purpose
//
// ┌──────────────────────────────────────────────────────────────────┐
// │  State Machine                                                  │
// │                                                                 │
// │  ┌────────┐  create()  ┌───────────┐  ready   ┌───────┐        │
// │  │ CLOSED │──────────►│ CREATING  │────────►│ ALIVE │        │
// │  └────────┘           └─────┬─────┘         └───┬───┘        │
// │       ▲                     │ fail               │            │
// │       │                     ▼                    │ ttl/close  │
// │       │              ┌───────────┐               │            │
// │       │              │  ERRORED  │               │            │
// │       │              └─────┬─────┘               │            │
// │       │                    │ retry                ▼            │
// │       │                    │               ┌───────────┐      │
// │       └────────────────────┴──────────────│ CLOSING   │      │
// │                                            └───────────┘      │
// │                                                                │
// │  Features                                                      │
// │  ─ Explicit state machine (CLOSED → CREATING → ALIVE → …)     │
// │  ─ Multi-purpose reasons (BLOBS, DOM_PARSER, AUDIO, etc.)      │
// │  ─ Periodic health-check ping (verifies doc is responsive)     │
// │  ─ Creation retry with exponential backoff                     │
// │  ─ Adaptive TTL (resets on any activity signal)                │
// │  ─ Message relay with response correlation (request/reply)     │
// │  ─ Graceful shutdown with drain                                │
// │  ─ Race-condition-safe creation guard                          │
// │  ─ Chrome 116+ getContexts() with SW clients fallback          │
// │  ─ Full lifecycle metrics and diagnostics                      │
// └──────────────────────────────────────────────────────────────────┘
// ─────────────────────────────────────────────────────────────────────

import { sleep } from '../utils/helpers';
import { createLogger } from '../utils/logger';

const log = createLogger('OffscreenManager');

// ━━━ Types ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type DocState =
    | 'closed'
    | 'creating'
    | 'alive'
    | 'errored'
    | 'closing';

interface PendingRequest {
    id: string;
    action: string;
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    sentAt: number;
    timeoutId: ReturnType<typeof setTimeout>;
}

interface OffscreenMetrics {
    state: DocState;
    createdCount: number;
    closedCount: number;
    errorCount: number;
    retryCount: number;
    healthChecks: number;
    healthFailures: number;
    messagesSent: number;
    messagesReceived: number;
    ttlResets: number;
    lastCreatedAt: number | null;
    lastClosedAt: number | null;
    lastErrorAt: number | null;
    lastError: string | null;
    uptimeMs: number | null;
    avgCreateMs: number;
}

// Chrome 116+ context types
interface RuntimeContext {
    contextType: string;
    documentUrl: string;
}

// ━━━ Configuration ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CONFIG = {
    DOCUMENT_PATH: 'offscreen.html',

    // TTL
    TTL_MS: 300_000,       // 5 min default
    TTL_MIN_MS: 60_000,       // 1 min minimum (for rapid activity)
    TTL_MAX_MS: 600_000,       // 10 min maximum

    // Health check
    HEALTH_INTERVAL_MS: 30_000,       // 30 s
    HEALTH_TIMEOUT_MS: 5_000,       //  5 s — ping must reply within this
    HEALTH_FAILURES_MAX: 3,       // close doc after N consecutive failures

    // Creation retry
    MAX_CREATE_RETRIES: 3,
    RETRY_BASE_MS: 1_000,
    RETRY_CAP_MS: 8_000,

    // Message relay
    MESSAGE_TIMEOUT_MS: 15_000,       // per-message response timeout
    MAX_PENDING: 20,       // max in-flight messages

    // Reasons
    DEFAULT_REASON: 'BLOBS' as keyof typeof chrome.offscreen.Reason,
    DEFAULT_JUSTIFICATION: 'Offscreen processing (Transformers.js, DOM parsing)',
} as const;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  OFFSCREEN MANAGER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class OffscreenManager {

    // ── State ──
    private state: DocState = 'closed';
    private creationPromise: Promise<void> | null = null;
    private ttlTimer: ReturnType<typeof setTimeout> | null = null;
    private healthTimer: ReturnType<typeof setInterval> | null = null;
    private healthFailures = 0;
    private stateChangedAt = Date.now();

    // ── Message correlation ──
    private readonly pending = new Map<string, PendingRequest>();
    private messageCounter = 0;
    private messageListenerInstalled = false;

    // ── Metrics ──
    private readonly metrics: OffscreenMetrics = {
        state: 'closed',
        createdCount: 0,
        closedCount: 0,
        errorCount: 0,
        retryCount: 0,
        healthChecks: 0,
        healthFailures: 0,
        messagesSent: 0,
        messagesReceived: 0,
        ttlResets: 0,
        lastCreatedAt: null,
        lastClosedAt: null,
        lastErrorAt: null,
        lastError: null,
        uptimeMs: null,
        avgCreateMs: 0,
    };

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  STATE MACHINE
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private transition(to: DocState): void {
        const from = this.state;
        if (from === to) { return; }

        this.state = to;
        this.stateChangedAt = Date.now();
        this.metrics.state = to;

        log.debug('State transition', { from, to });

        // Side-effects on enter
        switch (to) {
            case 'alive':
                this.metrics.createdCount++;
                this.metrics.lastCreatedAt = Date.now();
                this.startHealthCheck();
                this.resetTTL();
                this.installMessageListener();
                break;

            case 'closed':
                this.metrics.closedCount++;
                this.metrics.lastClosedAt = Date.now();
                if (this.metrics.lastCreatedAt) {
                    this.metrics.uptimeMs = Date.now() - this.metrics.lastCreatedAt;
                }
                this.stopHealthCheck();
                this.clearTTL();
                this.rejectAllPending('Offscreen document closed');
                break;

            case 'errored':
                this.metrics.errorCount++;
                this.metrics.lastErrorAt = Date.now();
                this.stopHealthCheck();
                this.clearTTL();
                break;

            case 'closing':
                this.stopHealthCheck();
                this.clearTTL();
                break;
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  PUBLIC — ENSURE DOCUMENT EXISTS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async ensureDocument(
        reason?: chrome.offscreen.Reason,
        justification?: string,
    ): Promise<void> {
        // Already alive — just refresh TTL
        if (this.state === 'alive') {
            this.resetTTL();
            return;
        }

        // Already creating — wait for it
        if (this.state === 'creating' && this.creationPromise) {
            await this.creationPromise;
            return;
        }

        // If closing, wait for close to finish
        if (this.state === 'closing') {
            await this.waitForState('closed', 5_000);
        }

        // Create
        await this.createWithRetry(
            reason ?? chrome.offscreen.Reason[CONFIG.DEFAULT_REASON],
            justification ?? CONFIG.DEFAULT_JUSTIFICATION,
        );
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  PUBLIC — MESSAGE RELAY (request / reply)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /**
     * Send a message to the offscreen document and wait for a correlated reply.
     * Auto-creates the document if needed.
     */
    async sendMessage<T = unknown>(
        action: string,
        payload?: Record<string, unknown>,
    ): Promise<T> {
        await this.ensureDocument();

        if (this.pending.size >= CONFIG.MAX_PENDING) {
            throw new Error('Too many pending offscreen messages');
        }

        const id = this.nextMessageId();
        this.metrics.messagesSent++;
        this.resetTTL();

        return new Promise<T>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Offscreen message "${action}" timed out after ${CONFIG.MESSAGE_TIMEOUT_MS}ms`));
            }, CONFIG.MESSAGE_TIMEOUT_MS);

            this.pending.set(id, {
                id,
                action,
                resolve: resolve as (v: unknown) => void,
                reject,
                sentAt: Date.now(),
                timeoutId,
            });

            chrome.runtime.sendMessage({
                target: 'offscreen',
                id,
                action,
                payload: payload ?? {},
            }).catch((err) => {
                clearTimeout(timeoutId);
                this.pending.delete(id);
                reject(err instanceof Error ? err : new Error(String(err)));
            });
        });
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  PUBLIC — KEEP ALIVE / CLOSE
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    keepAlive(): void {
        if (this.state === 'alive') {
            this.resetTTL();
        }
    }

    async close(): Promise<void> {
        if (this.state === 'closed' || this.state === 'closing') { return; }

        this.transition('closing');

        try {
            await chrome.offscreen.closeDocument();
        } catch {
            // Already closed or never existed
        }

        this.transition('closed');
        log.info('Offscreen document closed');
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  CREATION WITH RETRY
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private async createWithRetry(
        reason: chrome.offscreen.Reason,
        justification: string,
    ): Promise<void> {
        this.transition('creating');

        const t0 = performance.now();

        for (let attempt = 0; attempt <= CONFIG.MAX_CREATE_RETRIES; attempt++) {
            try {
                // Check if document already exists (race condition guard)
                if (await this.documentExists()) {
                    this.transition('alive');
                    return;
                }

                this.creationPromise = chrome.offscreen.createDocument({
                    url: CONFIG.DOCUMENT_PATH,
                    reasons: [reason],
                    justification,
                });

                await this.creationPromise;

                const ms = Math.round(performance.now() - t0);
                this.metrics.avgCreateMs =
                    this.metrics.avgCreateMs === 0
                        ? ms
                        : this.metrics.avgCreateMs * 0.8 + ms * 0.2;

                this.transition('alive');
                log.info('Offscreen document created', { ms, attempt });
                return;

            } catch (error) {
                const msg = extractMsg(error);

                // "Only a single offscreen" / "already exists" = success
                if (msg.includes('single offscreen') || msg.includes('already exists')) {
                    this.transition('alive');
                    return;
                }

                this.metrics.retryCount++;
                this.metrics.lastError = msg;

                if (attempt === CONFIG.MAX_CREATE_RETRIES) {
                    this.transition('errored');
                    log.error('Offscreen creation failed permanently', {
                        attempts: attempt + 1,
                        error: msg,
                    });
                    throw error;
                }

                const backoff = Math.min(
                    CONFIG.RETRY_BASE_MS * 2 ** attempt,
                    CONFIG.RETRY_CAP_MS,
                );
                log.warn('Offscreen creation failed — retrying', {
                    attempt: attempt + 1,
                    backoff,
                    error: msg,
                });
                await sleep(backoff);

            } finally {
                this.creationPromise = null;
            }
        }
    }

    /**
     * Check if offscreen document exists
     * BUG FIX: Now properly reports when all detection methods fail
     */
    private async documentExists(): Promise<boolean> {
        const docUrl = chrome.runtime.getURL(CONFIG.DOCUMENT_PATH);
        const results: Array<{ method: string; success: boolean; error?: string }> = [];

        // ── Method 1: chrome.runtime.getContexts (Chrome 116+) ──
        try {
            if ('getContexts' in chrome.runtime) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const contexts = await (chrome.runtime as any).getContexts({
                    contextTypes: ['OFFSCREEN_DOCUMENT'],
                    documentUrls: [docUrl],
                }) as RuntimeContext[];

                const exists = contexts.length > 0;
                results.push({ method: 'getContexts', success: true });
                log.debug('documentExists check via getContexts', { exists, contextCount: contexts.length });
                return exists;
            } else {
                results.push({ method: 'getContexts', success: false, error: 'API not available' });
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            results.push({ method: 'getContexts', success: false, error: errorMsg });
            log.warn('documentExists: getContexts API failed', { error: errorMsg });
            // Fall through to Method 2
        }

        // ── Method 2: Service Worker clients API ──
        try {
            if (typeof self !== 'undefined' && 'clients' in self) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const sw = self as any;
                const clients = await sw.clients.matchAll({ type: 'all' });
                const exists = clients.some((c: { url?: string }) => c.url === docUrl);
                results.push({ method: 'clients.matchAll', success: true });
                log.debug('documentExists check via clients API', { exists });
                return exists;
            } else {
                results.push({ method: 'clients.matchAll', success: false, error: 'Not in SW context' });
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            results.push({ method: 'clients.matchAll', success: false, error: errorMsg });
            log.warn('documentExists: clients API failed', { error: errorMsg });
        }

        // BUG FIX: Log when all methods fail - this indicates a potential issue
        log.error('documentExists: all detection methods failed', { results });
        // Assume document doesn't exist if we can't detect it
        return false;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  HEALTH CHECK (periodic ping/pong)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private startHealthCheck(): void {
        this.stopHealthCheck();
        this.healthFailures = 0;

        this.healthTimer = setInterval(() => {
            this.runHealthCheck().catch((err) =>
                log.debug('Health check error', extractMsg(err)),
            );
        }, CONFIG.HEALTH_INTERVAL_MS);
    }

    private stopHealthCheck(): void {
        if (this.healthTimer) {
            clearInterval(this.healthTimer);
            this.healthTimer = null;
        }
    }

    private async runHealthCheck(): Promise<void> {
        if (this.state !== 'alive') { return; }

        this.metrics.healthChecks++;

        try {
            const response = await Promise.race([
                this.sendPing(),
                rejectAfter(CONFIG.HEALTH_TIMEOUT_MS, 'Health check timeout'),
            ]);

            if (response === 'pong') {
                this.healthFailures = 0;
            } else {
                this.onHealthFailure('Unexpected ping response');
            }
        } catch (error) {
            this.onHealthFailure(extractMsg(error));
        }
    }

    private async sendPing(): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            try {
                chrome.runtime.sendMessage(
                    { target: 'offscreen', action: 'HEALTH_PING' },
                    (response) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message ?? 'Ping failed'));
                        } else {
                            resolve(response?.status ?? 'unknown');
                        }
                    },
                );
            } catch (err) {
                reject(err);
            }
        });
    }

    private onHealthFailure(reason: string): void {
        this.healthFailures++;
        this.metrics.healthFailures++;

        log.warn('Health check failed', {
            consecutive: this.healthFailures,
            max: CONFIG.HEALTH_FAILURES_MAX,
            reason,
        });

        if (this.healthFailures >= CONFIG.HEALTH_FAILURES_MAX) {
            log.error('Offscreen document unresponsive — closing');
            this.close().catch(() => { });
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  TTL MANAGEMENT
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private resetTTL(): void {
        this.clearTTL();
        this.metrics.ttlResets++;

        this.ttlTimer = setTimeout(() => {
            log.info('TTL expired — closing offscreen document');
            this.close().catch(() => { });
        }, CONFIG.TTL_MS);
    }

    private clearTTL(): void {
        if (this.ttlTimer) {
            clearTimeout(this.ttlTimer);
            this.ttlTimer = null;
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  MESSAGE LISTENER (for correlated responses)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private installMessageListener(): void {
        if (this.messageListenerInstalled) { return; }
        this.messageListenerInstalled = true;

        chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
            // Only handle messages from offscreen document
            if (msg?.source !== 'offscreen' || !msg?.id) { return false; }

            this.metrics.messagesReceived++;
            this.resetTTL();

            const request = this.pending.get(msg.id);
            if (!request) { return false; }

            clearTimeout(request.timeoutId);
            this.pending.delete(msg.id);

            if (msg.error) {
                request.reject(new Error(msg.error));
            } else {
                request.resolve(msg.result);
            }

            return false;
        });
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  PENDING MESSAGE MANAGEMENT
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private nextMessageId(): string {
        return `os-${++this.messageCounter}-${Date.now().toString(36)}`;
    }

    private rejectAllPending(reason: string): void {
        for (const [, req] of this.pending) {
            clearTimeout(req.timeoutId);
            req.reject(new Error(reason));
        }
        this.pending.clear();
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  WAIT HELPER
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private waitForState(target: DocState, timeoutMs: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.state === target) { resolve(); return; }

            const interval = setInterval(() => {
                if (this.state === target) {
                    clearInterval(interval);
                    clearTimeout(timer);
                    resolve();
                }
            }, 100);

            const timer = setTimeout(() => {
                clearInterval(interval);
                reject(new Error(`Timeout waiting for state "${target}" (stuck in "${this.state}")`));
            }, timeoutMs);
        });
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  PUBLIC — OBSERVABILITY
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    getState(): DocState {
        return this.state;
    }

    isAlive(): boolean {
        return this.state === 'alive';
    }

    getMetrics(): Readonly<OffscreenMetrics> {
        return {
            ...this.metrics,
            uptimeMs:
                this.state === 'alive' && this.metrics.lastCreatedAt
                    ? Date.now() - this.metrics.lastCreatedAt
                    : this.metrics.uptimeMs,
        };
    }

    getPendingCount(): number {
        return this.pending.size;
    }

    dumpStats(): void {
        const m = this.getMetrics();
        log.info('📦 Offscreen Manager', {
            state: m.state,
            created: m.createdCount,
            closed: m.closedCount,
            errors: m.errorCount,
            retries: m.retryCount,
            healthChecks: m.healthChecks,
            healthFails: m.healthFailures,
            msgSent: m.messagesSent,
            msgReceived: m.messagesReceived,
            ttlResets: m.ttlResets,
            pending: this.pending.size,
            avgCreateMs: Math.round(m.avgCreateMs),
            uptime: m.uptimeMs ? `${Math.round(m.uptimeMs / 1000)}s` : '—',
            lastError: m.lastError ?? '—',
        });
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  UTILITIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// function sleep removed in favor of import

function rejectAfter(ms: number, message: string): Promise<never> {
    return new Promise((_, reject) => {
        setTimeout(() => reject(new Error(message)), ms);
    });
}

function extractMsg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

// ━━━ Singleton Export ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const offscreenManager = new OffscreenManager();