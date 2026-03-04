// ─────────────────────────────────────────────────────────────────────
// Notifications Engine v2 — Categorized, Queued, Action-Routed
//
// ┌──────────────────────────────────────────────────────────────────┐
// │  Pipeline                                                       │
// │                                                                 │
// │  notifyXXX()                                                    │
// │       │                                                         │
// │       ▼                                                         │
// │  ┌────────────┐                                                 │
// │  │  Settings   │──► enabled? category enabled?                  │
// │  │  Guard      │                                                │
// │  └─────┬──────┘                                                 │
// │        ▼                                                        │
// │  ┌────────────┐                                                 │
// │  │  Dedup     │──► TTL-based, content-keyed                     │
// │  │  Check     │                                                 │
// │  └─────┬──────┘                                                 │
// │        ▼                                                        │
// │  ┌────────────┐                                                 │
// │  │  Queue     │──► sequential, with retry & backoff             │
// │  └─────┬──────┘                                                 │
// │        ▼                                                        │
// │  ┌────────────┐                                                 │
// │  │  Send      │──► chrome.notifications.create                  │
// │  └─────┬──────┘                                                 │
// │        ▼                                                        │
// │  ┌────────────┐                                                 │
// │  │  Track     │──► history, metrics, auto-clear timer           │
// │  └────────────┘                                                 │
// │                                                                 │
// │  Event Handlers:                                                │
// │    onClicked  ──► action router (per notification ID prefix)    │
// │    onButtonClicked ──► button action map                        │
// │    onClosed   ──► cleanup & metrics                             │
// │                                                                 │
// │  Features                                                       │
// │  ─ Typed notification categories with independent enable flags  │
// │  ─ Sequential send queue with retry + exponential backoff       │
// │  ─ Content-keyed dedup with configurable TTL per category       │
// │  ─ Action routing system for clicks and button presses          │
// │  ─ Auto-clear timers (non-interactive notifications expire)     │
// │  ─ OTP masking in user-facing notification text                 │
// │  ─ Permission check before first send                           │
// │  ─ Notification history with capped retention                   │
// │  ─ Full metrics: sent, clicked, suppressed, failed              │
// │  ─ Lifecycle: init / destroy with listener cleanup              │
// └──────────────────────────────────────────────────────────────────┘
// ─────────────────────────────────────────────────────────────────────

import { storageService } from '../services/storageService';
import { sleep } from '../utils/helpers';
import { createLogger } from '../utils/logger';

const log = createLogger('Notifications');

// ━━━ Types ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type NotificationCategory =
    | 'otp'
    | 'email'
    | 'link'
    | 'success'
    | 'error'
    | 'system';

type NotificationPriority = 0 | 1 | 2;

interface NotificationSpec {
    category: NotificationCategory;
    title: string;
    message: string;
    contextMessage?: string;
    priority?: NotificationPriority;
    requireInteraction?: boolean;
    silent?: boolean;
    iconPath?: string;
    buttons?: ButtonSpec[];
    autoClearMs?: number | null;     // null = no auto-clear
    data?: Record<string, unknown>;   // arbitrary metadata for action handlers
}

interface ButtonSpec {
    title: string;
    action: string;          // action key routed to handler
    iconUrl?: string;
}

interface ActiveNotification {
    id: string;
    spec: NotificationSpec;
    createdAt: number;
    clearTimer: ReturnType<typeof setTimeout> | null;
    clicked: boolean;
    buttonIndex: number | null;
}

interface NotificationRecord {
    id: string;
    category: NotificationCategory;
    title: string;
    createdAt: number;
    clicked: boolean;
    autoClear: boolean;
}

interface DedupEntry {
    key: string;
    expiresAt: number;
}

interface QueueItem {
    id: string;
    spec: NotificationSpec;
    resolve: (id: string) => void;
    reject: (err: Error) => void;
    attempt: number;
}

/** Per-category notification settings */
interface CategorySettings {
    enabled: boolean;
    dedupTtlMs: number;
    autoClearMs: number | null;
    maxPerMinute: number;
}

type ButtonActionHandler = (
    notificationId: string,
    data: Record<string, unknown>,
) => Promise<void>;

type ClickActionHandler = (
    notificationId: string,
    data: Record<string, unknown>,
) => Promise<void>;

interface NotificationMetrics {
    sent: number;
    clicked: number;
    buttonClicked: number;
    autoClearedCount: number;
    suppressed: number;
    deduplicated: number;
    rateLimited: number;
    failed: number;
    retries: number;
    avgSendMs: number;          // EMA
    byCategoryCount: Record<NotificationCategory, number>;
}

// ━━━ Configuration ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const DEFAULT_ICON_PATH = 'assets/icons/icon.png';

const DEFAULT_CATEGORY_SETTINGS: Record<NotificationCategory, CategorySettings> = {
    otp: { enabled: true, dedupTtlMs: 10_000, autoClearMs: null, maxPerMinute: 10 },
    email: { enabled: true, dedupTtlMs: 5_000, autoClearMs: 15_000, maxPerMinute: 15 },
    link: { enabled: true, dedupTtlMs: 5_000, autoClearMs: 10_000, maxPerMinute: 10 },
    success: { enabled: true, dedupTtlMs: 3_000, autoClearMs: 5_000, maxPerMinute: 20 },
    error: { enabled: true, dedupTtlMs: 3_000, autoClearMs: 15_000, maxPerMinute: 10 },
    system: { enabled: true, dedupTtlMs: 10_000, autoClearMs: 20_000, maxPerMinute: 5 },
};

const CONFIG = {
    MAX_QUEUE_SIZE: 50,
    MAX_RETRIES: 2,
    RETRY_BACKOFF_MS: 1_000,        // × attempt
    MAX_HISTORY_ENTRIES: 100,
    MAX_DEDUP_ENTRIES: 200,
    DEDUP_PRUNE_INTERVAL: 30_000,

    // OTP masking
    OTP_MASK_CHAR: '●',
    OTP_VISIBLE_SUFFIX: 2,          // show last N digits
} as const;

// ━━━ Module State ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const activeNotifications = new Map<string, ActiveNotification>();
const dedupCache = new Map<string, DedupEntry>();
const sendQueue: QueueItem[] = [];
const history: NotificationRecord[] = [];
const categoryTimestamps = new Map<NotificationCategory, number[]>();

const buttonActions = new Map<string, ButtonActionHandler>();
const clickActions = new Map<string, ClickActionHandler>();

let draining = false;
let initialized = false;
let permissionGranted: boolean | null = null;       // cached
let dedupPruneTimer: ReturnType<typeof setInterval> | null = null;
let sessionStorageAvailable = false;                // chrome.storage.session availability

const metrics: NotificationMetrics = {
    sent: 0,
    clicked: 0,
    buttonClicked: 0,
    autoClearedCount: 0,
    suppressed: 0,
    deduplicated: 0,
    rateLimited: 0,
    failed: 0,
    retries: 0,
    avgSendMs: 0,
    byCategoryCount: {
        otp: 0, email: 0, link: 0, success: 0, error: 0, system: 0,
    },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  LIFECYCLE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function initNotifications(): void {
    if (initialized) { return; }
    initialized = true;

    // Check if chrome.storage.session is available (MV3)
    sessionStorageAvailable = Boolean(chrome?.storage?.session);

    // Restore dedup cache from session storage
    if (sessionStorageAvailable) {
        void restoreDedupCache();
    }

    registerDefaultActions();
    installEventListeners();

    dedupPruneTimer = setInterval(pruneDedup, CONFIG.DEDUP_PRUNE_INTERVAL);

    log.info('🔔 Notification engine initialized');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DEDUP CACHE PERSISTENCE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function restoreDedupCache(): Promise<void> {
    try {
        const data = await chrome.storage.session.get('notif_dedup');
        if (data.notif_dedup && typeof data.notif_dedup === 'object') {
            const entries = data.notif_dedup as Record<string, DedupEntry>;
            const now = Date.now();
            for (const [key, entry] of Object.entries(entries)) {
                if (entry.expiresAt > now) {
                    dedupCache.set(key, entry);
                }
            }
            log.debug('Restored dedup cache from session', { entries: dedupCache.size });
        }
    } catch {
        log.debug('Session storage restore failed (non-critical)');
    }
}

async function persistDedupCache(): Promise<void> {
    if (!sessionStorageAvailable) { return; }
    try {
        const obj: Record<string, DedupEntry> = {};
        for (const [key, entry] of dedupCache) {
            obj[key] = entry;
        }
        await chrome.storage.session.set({ notif_dedup: obj });
    } catch {
        // Non-critical, best-effort persistence
    }
}

export function destroyNotifications(): void {
    if (!initialized) { return; }
    initialized = false;

    // Clear all active notification timers
    for (const [, active] of activeNotifications) {
        if (active.clearTimer) { clearTimeout(active.clearTimer); }
    }
    activeNotifications.clear();
    dedupCache.clear();
    sendQueue.length = 0;

    if (dedupPruneTimer) {
        clearInterval(dedupPruneTimer);
        dedupPruneTimer = null;
    }

    log.info('🔔 Notification engine destroyed');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  EVENT LISTENERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function installEventListeners(): void {
    if (!chrome?.notifications) {
        log.warn('chrome.notifications API not available');
        return;
    }

    chrome.notifications.onClicked.addListener((id) => { void onNotificationClicked(id); });
    chrome.notifications.onButtonClicked.addListener((id, index) => { void onButtonClicked(id, index); });
    chrome.notifications.onClosed.addListener(onNotificationClosed);
}

async function onNotificationClicked(notificationId: string): Promise<void> {
    log.debug('Notification clicked', { notificationId });
    metrics.clicked++;

    const active = activeNotifications.get(notificationId);
    if (active) {
        active.clicked = true;

        // Route to category-specific click handler
        const handler = clickActions.get(active.spec.category);
        if (handler) {
            try {
                await handler(notificationId, active.spec.data ?? {});
            } catch (error) {
                log.warn('Click action handler error', { notificationId, error: extractMessage(error) });
            }
        } else {
            // Default: open popup
            chrome.action.openPopup().catch(() => { /* SW context may not support */ });
        }
    }

    await clearNotification(notificationId);
}

async function onButtonClicked(notificationId: string, buttonIndex: number): Promise<void> {
    log.debug('Button clicked', { notificationId, buttonIndex });
    metrics.buttonClicked++;

    const active = activeNotifications.get(notificationId);
    if (!active) {
        await clearNotification(notificationId);
        return;
    }

    active.buttonIndex = buttonIndex;

    const button = active.spec.buttons?.[buttonIndex];
    if (button?.action) {
        const handler = buttonActions.get(button.action);
        if (handler) {
            try {
                await handler(notificationId, active.spec.data ?? {});
            } catch (error) {
                log.warn('Button action handler error', {
                    notificationId,
                    action: button.action,
                    error: extractMessage(error),
                });
            }
        } else {
            log.warn('No handler for button action', { action: button.action });
        }
    }

    await clearNotification(notificationId);
}

function onNotificationClosed(notificationId: string, byUser: boolean): void {
    const active = activeNotifications.get(notificationId);
    if (active?.clearTimer) { clearTimeout(active.clearTimer); }
    activeNotifications.delete(notificationId);

    log.debug('Notification closed', { notificationId, byUser });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ACTION REGISTRATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function registerButtonAction(action: string, handler: ButtonActionHandler): void {
    buttonActions.set(action, handler);
}

export function registerClickAction(category: NotificationCategory, handler: ClickActionHandler): void {
    clickActions.set(category, handler);
}

function registerDefaultActions(): void {
    // ── Copy OTP button ──
    registerButtonAction('copy-otp', async (_notifId, data) => {
        const otp = data.otp as string | undefined;
        if (!otp) {
            // Fallback: get last OTP from service
            const { otpService } = await import('../services/otpService');
            const lastOTP = await otpService.getLastOTP();
            if (lastOTP) {
                await copyToClipboard(lastOTP.code);
                await notify({
                    category: 'success',
                    title: 'Copied',
                    message: `OTP ${maskOTP(lastOTP.code)} copied to clipboard`,
                });
            }
            return;
        }
        await copyToClipboard(otp);
        await notify({
            category: 'success',
            title: 'Copied',
            message: `OTP ${maskOTP(otp)} copied to clipboard`,
        });
    });

    // ── Dismiss button (no-op, just close) ──
    registerButtonAction('dismiss', async () => { });

    // ── Open inbox button ──
    registerButtonAction('open-inbox', async () => {
        chrome.action.openPopup().catch(() => { /* SW context may not support */ });
    });

    // ── Open link button ──
    registerButtonAction('open-link', async (_notifId, data) => {
        const link = data.link as string | undefined;
        if (link) {
            try {
                await chrome.tabs.create({ url: link, active: true });
            } catch (err) {
                // Fallback: copy link to clipboard
                await copyToClipboard(link);
                await notify({
                    category: 'success',
                    title: 'Link Copied',
                    message: 'Activation link copied to clipboard',
                });
            }
        }
    });

    // ── OTP notification click → open popup ──
    registerClickAction('otp', async () => {
        chrome.action.openPopup().catch(() => { /* SW context may not support */ });
    });

    // ── Email notification click → open popup ──
    registerClickAction('email', async () => {
        chrome.action.openPopup().catch(() => { /* SW context may not support */ });
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PUBLIC — HIGH-LEVEL NOTIFICATION FUNCTIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function notifyNewEmail(
    from: string,
    subject: string,
    otp?: string,
    link?: string,
): Promise<string> {
    if (otp) {
        return notify({
            category: 'otp',
            title: `OTP Received: ${maskOTP(otp)}`,
            message: `From: ${from}\n${truncate(subject, 80)}`,
            priority: 2,
            requireInteraction: true,
            buttons: [
                { title: '📋 Copy OTP', action: 'copy-otp' },
                { title: 'Dismiss', action: 'dismiss' },
            ],
            data: { otp, from, subject },
        });
    }

    // Link-only notification
    if (link) {
        return notify({
            category: 'link',
            title: 'Verification Link Found',
            message: `From: ${from}\n${truncate(subject, 80)}`,
            priority: 1,
            requireInteraction: true,
            buttons: [
                { title: '🔗 Open Link', action: 'open-link' },
                { title: '📥 Open Inbox', action: 'open-inbox' },
            ],
            data: { link, from, subject },
        });
    }

    return notify({
        category: 'email',
        title: 'New Email',
        message: `From: ${from}\n${truncate(subject, 80)}`,
        priority: 1,
        buttons: [
            { title: '📥 Open Inbox', action: 'open-inbox' },
        ],
        data: { from, subject },
    });
}

// Note: showDirectNotification is reserved for future use

export async function notifyLinkActivated(url: string, code?: string): Promise<string> {
    return notify({
        category: 'link',
        title: 'Verification Link Opened',
        message: code
            ? `Code ${maskOTP(code)} auto-filled!`
            : `Activation link opened in new tab.`,
        priority: 1,
        data: { url, code },
    });
}

export async function notifySuccess(title: string, message: string): Promise<string> {
    return notify({
        category: 'success',
        title,
        message,
        priority: 0,
    });
}

export async function notifyError(title: string, message: string): Promise<string> {
    return notify({
        category: 'error',
        title,
        message,
        priority: 2,
    });
}

export async function notifySystem(title: string, message: string): Promise<string> {
    return notify({
        category: 'system',
        title,
        message,
        priority: 1,
        requireInteraction: true,
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CORE — UNIFIED NOTIFY ENTRY POINT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function notify(spec: NotificationSpec): Promise<string> {
    log.debug(`Notification requested: ${spec.category} - ${spec.title}`);

    // ── Gate 1: Global notifications enabled? ──
    const globalEnabled = await areNotificationsEnabled();
    log.debug('Global enabled', globalEnabled);
    if (!globalEnabled) {
        metrics.suppressed++;
        return '';
    }

    // ── Gate 2: Category enabled? ──
    const catSettings = await getCategorySettings(spec.category);
    log.debug('Category settings', catSettings);
    if (!catSettings.enabled) {
        metrics.suppressed++;
        log.debug('Category disabled', { category: spec.category });
        return '';
    }

    // ── Gate 3: Dedup ──
    const dedupKey = buildDedupKey(spec);
    if (isDuplicate(dedupKey, catSettings.dedupTtlMs)) {
        metrics.deduplicated++;
        log.debug('Duplicate suppressed', { category: spec.category, title: spec.title });
        return '';
    }

    // ── Gate 4: Rate limit ──
    if (isCategoryRateLimited(spec.category, catSettings.maxPerMinute)) {
        metrics.rateLimited++;
        log.debug('Rate limited', { category: spec.category });
        return '';
    }

    // ── Gate 5: Permission ──
    const permitted = await checkPermission();
    log.debug('Permission', permitted);
    if (!permitted) {
        metrics.suppressed++;
        log.warn('Notification permission not granted');
        return '';
    }

    // ── Enqueue ──
    const id = generateId(spec.category);

    return new Promise<string>((resolve, reject) => {
        if (sendQueue.length >= CONFIG.MAX_QUEUE_SIZE) {
            metrics.suppressed++;
            log.warn('Queue full — notification dropped', { category: spec.category });
            resolve('');
            return;
        }

        sendQueue.push({ id, spec, resolve, reject, attempt: 0 });
        void drain();
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SEND QUEUE (sequential, retry-capable)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function drain(): Promise<void> {
    if (draining) { return; }
    draining = true;

    try {
        while (sendQueue.length > 0) {
            const item = sendQueue.shift()!;
            await processQueueItem(item);
        }
    } finally {
        draining = false;
    }
}

async function processQueueItem(item: QueueItem): Promise<void> {
    const { id, spec } = item;
    const t0 = performance.now();

    try {
        await sendNotification(id, spec);

        const ms = Math.round(performance.now() - t0);
        metrics.avgSendMs = metrics.avgSendMs === 0 ? ms : metrics.avgSendMs * 0.8 + ms * 0.2;

        metrics.sent++;
        metrics.byCategoryCount[spec.category]++;

        recordHistory(id, spec);
        item.resolve(id);

    } catch (error) {
        item.attempt++;

        if (item.attempt <= CONFIG.MAX_RETRIES) {
            metrics.retries++;
            const backoff = CONFIG.RETRY_BACKOFF_MS * item.attempt;
            log.warn('Notification send failed — retrying', {
                id,
                attempt: item.attempt,
                backoff,
                error: extractMessage(error),
            });
            await sleep(backoff);
            await processQueueItem(item);
        } else {
            metrics.failed++;
            log.error('Notification send failed permanently', {
                id,
                attempts: item.attempt,
                error: extractMessage(error),
            });
            item.resolve('');          // resolve empty rather than reject (non-fatal)
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  LOW-LEVEL — chrome.notifications.create WRAPPER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function sendNotification(id: string, spec: NotificationSpec): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const iconUrl = chrome.runtime.getURL(spec.iconPath ?? DEFAULT_ICON_PATH);

        const options: chrome.notifications.NotificationOptions<true> = {
            type: 'basic',
            iconUrl,
            title: spec.title,
            message: spec.message,
            priority: spec.priority ?? 1,
            requireInteraction: spec.requireInteraction ?? false,
            silent: spec.silent ?? false,
        };

        if (spec.contextMessage) {
            options.contextMessage = spec.contextMessage;
        }

        if (spec.buttons && spec.buttons.length > 0) {
            options.buttons = spec.buttons.map((b) => ({
                title: b.title,
                ...(b.iconUrl ? { iconUrl: chrome.runtime.getURL(b.iconUrl) } : {}),
            }));
        }

        try {
            chrome.notifications.create(id, options, (notifId) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message ?? 'Unknown notification error'));
                    return;
                }

                // Track active notification
                const catSettings = DEFAULT_CATEGORY_SETTINGS[spec.category];
                const autoClearMs = spec.autoClearMs !== undefined
                    ? spec.autoClearMs
                    : catSettings.autoClearMs;

                const active: ActiveNotification = {
                    id: notifId,
                    spec,
                    createdAt: Date.now(),
                    clearTimer: null,
                    clicked: false,
                    buttonIndex: null,
                };

                // Auto-clear timer (non-interactive notifications)
                if (autoClearMs && !spec.requireInteraction) {
                    active.clearTimer = setTimeout(() => {
                        void clearNotification(notifId);
                        metrics.autoClearedCount++;
                    }, autoClearMs);
                }

                activeNotifications.set(notifId, active);
                resolve();
            });
        } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
        }
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  NOTIFICATION MANAGEMENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function clearNotification(id: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        const active = activeNotifications.get(id);
        if (active?.clearTimer) { clearTimeout(active.clearTimer); }
        activeNotifications.delete(id);

        try {
            chrome.notifications.clear(id, (cleared) => resolve(cleared));
        } catch {
            resolve(false);
        }
    });
}

export async function clearAllNotifications(): Promise<void> {
    const ids = Array.from(activeNotifications.keys());
    await Promise.all(ids.map((id) => clearNotification(id)));
    log.debug('All notifications cleared', { count: ids.length });
}

export function getActiveCount(): number {
    return activeNotifications.size;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GUARDS — Settings, Permission, Dedup, Rate Limit
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function areNotificationsEnabled(): Promise<boolean> {
    try {
        const settings = await storageService.getSettings();
        return settings?.notifications !== false;     // default true (fail-open)
    } catch {
        return true;                                  // fail-open: OTP notifs are critical
    }
}

async function getCategorySettings(
    category: NotificationCategory,
): Promise<CategorySettings> {
    try {
        const settings = await storageService.getSettings();
        const overrides = (settings as { notificationCategories?: Record<string, Partial<CategorySettings>> })?.notificationCategories;

        if (overrides?.[category]) {
            return { ...DEFAULT_CATEGORY_SETTINGS[category], ...overrides[category] };
        }
    } catch {
        // Use defaults
    }
    return DEFAULT_CATEGORY_SETTINGS[category];
}

async function checkPermission(): Promise<boolean> {
    if (permissionGranted !== null) { return permissionGranted; }

    // In MV3 extensions, chrome.notifications is always available if declared
    // But we check for the API existence as a guard
    if (!chrome?.notifications) {
        permissionGranted = false;
        return false;
    }

    try {
        // Try to get permission level
        const level = await new Promise<string>((resolve) => {
            chrome.notifications.getPermissionLevel((l) => resolve(l));
        });
        permissionGranted = level === 'granted';
    } catch {
        permissionGranted = true;     // assume granted if API exists but getPermissionLevel fails
    }

    return permissionGranted;
}

export async function requestNotificationPermission(): Promise<boolean> {
    if (!chrome?.notifications) {
        log.warn('Notifications API not available');
        return false;
    }

    try {
        // Check current permission level
        const level = await new Promise<string>((resolve) => {
            chrome.notifications.getPermissionLevel((l) => resolve(l));
        });

        if (level === 'granted') {
            permissionGranted = true;
            return true;
        }

        // In MV3, we cannot programmatically request notification permission
        // The user must grant it through browser UI
        // Log a warning to help debug
        log.warn('Notification permission not granted. User needs to grant permission manually.');

        // Try to open the extension popup or options to prompt user
        // This is a limitation of MV3 - we can't directly request permission
        permissionGranted = level === 'granted';
        return permissionGranted;
    } catch (error) {
        log.error('Error checking notification permission', error);
        return false;
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DEDUP ENGINE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildDedupKey(spec: NotificationSpec): string {
    return `${spec.category}:${spec.title}:${spec.message}`;
}

function isDuplicate(key: string, ttlMs: number): boolean {
    const now = Date.now();
    const entry = dedupCache.get(key);

    if (entry && entry.expiresAt > now) {
        return true;
    }

    dedupCache.set(key, { key, expiresAt: now + ttlMs });

    // Persist asynchronously (non-blocking)
    void persistDedupCache();

    return false;
}

function pruneDedup(): void {
    const now = Date.now();
    let pruned = 0;

    for (const [key, entry] of dedupCache) {
        if (entry.expiresAt <= now) {
            dedupCache.delete(key);
            pruned++;
        }
    }

    // Overflow protection
    if (dedupCache.size > CONFIG.MAX_DEDUP_ENTRIES) {
        const sorted = Array.from(dedupCache.entries())
            .sort(([, a], [, b]) => a.expiresAt - b.expiresAt);

        const excess = sorted.length - CONFIG.MAX_DEDUP_ENTRIES;
        for (let i = 0; i < excess; i++) {
            dedupCache.delete(sorted[i]![0]);
            pruned++;
        }
    }

    if (pruned > 0) {
        log.debug('Dedup cache pruned', { pruned, remaining: dedupCache.size });
        // Persist after changes
        void persistDedupCache();
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CATEGORY RATE LIMITER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function isCategoryRateLimited(
    category: NotificationCategory,
    maxPerMinute: number,
): boolean {
    const now = Date.now();
    const cutoff = now - 60_000;
    let timestamps = categoryTimestamps.get(category) ?? [];

    // Prune old
    timestamps = timestamps.filter((t) => t > cutoff);

    if (timestamps.length >= maxPerMinute) {
        categoryTimestamps.set(category, timestamps);
        return true;
    }

    timestamps.push(now);
    categoryTimestamps.set(category, timestamps);
    return false;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  HISTORY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function recordHistory(id: string, spec: NotificationSpec): void {
    history.push({
        id,
        category: spec.category,
        title: spec.title,
        createdAt: Date.now(),
        clicked: false,
        autoClear: !spec.requireInteraction && spec.autoClearMs !== null,
    });

    if (history.length > CONFIG.MAX_HISTORY_ENTRIES) {
        history.splice(0, history.length - CONFIG.MAX_HISTORY_ENTRIES);
    }
}

export function getNotificationHistory(): ReadonlyArray<Readonly<NotificationRecord>> {
    return history;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  OBSERVABILITY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function getNotificationMetrics(): Readonly<NotificationMetrics> {
    return { ...metrics };
}

export function dumpNotificationStats(): void {
    log.info('🔔 Notification Stats:');
    log.info('Sent:', metrics.sent);
    log.info('Clicked:', metrics.clicked);
    log.info('Button clicks:', metrics.buttonClicked);
    log.info('Auto-cleared:', metrics.autoClearedCount);
    log.info('Suppressed:', metrics.suppressed);
    log.info('Deduplicated:', metrics.deduplicated);
    log.info('Rate-limited:', metrics.rateLimited);
    log.info('Failed:', metrics.failed);
    log.info('Retries:', metrics.retries);
    log.info('Avg send time:', `${Math.round(metrics.avgSendMs)}ms`);
    log.info('By category:', metrics.byCategoryCount);
    log.info('Active:', activeNotifications.size);
    log.info('Queue:', sendQueue.length);
    log.info('History:', history.length);
    log.info('Dedup cache:', dedupCache.size);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  UTILITIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function maskOTP(otp: string): string {
    if (otp.length <= CONFIG.OTP_VISIBLE_SUFFIX) {
        return CONFIG.OTP_MASK_CHAR.repeat(otp.length);
    }
    const masked = CONFIG.OTP_MASK_CHAR.repeat(otp.length - CONFIG.OTP_VISIBLE_SUFFIX);
    const visible = otp.slice(-CONFIG.OTP_VISIBLE_SUFFIX);
    return masked + visible;
}

function generateId(category: NotificationCategory): string {
    return `gf-${category}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function truncate(s: string | undefined, max: number): string {
    if (!s) { return ''; }
    return s.length > max ? s.substring(0, max) + '…' : s;
}

function extractMessage(error: unknown): string {
    if (error instanceof Error) { return error.message; }
    if (typeof error === 'string') { return error; }
    return String(error);
}

// function sleep removed in favor of import

async function copyToClipboard(text: string): Promise<void> {
    try {
        const { clipboardService } = await import('../services/clipboardService');
        await clipboardService.copyOTP(text);
    } catch (error) {
        log.warn('Clipboard copy failed', extractMessage(error));
        // Fallback: try offscreen document or navigator.clipboard
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            log.error('All clipboard methods failed');
        }
    }
}