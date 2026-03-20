// ─────────────────────────────────────────────────────────────────────
// Polling Manager v2 — Intelligent Adaptive Polling Engine
//
// Architecture:
// ┌────────────────────────────────────────────────────────────────┐
// │  CircuitBreaker     — Exponential backoff fault isolation      │
// │  SlidingRateLimiter — Per-window request throttling            │
// │  DedupCache         — TTL-based email deduplication            │
// │  AdaptiveScheduler  — Context-aware interval calculation       │
// │  OTPDelivery        — Priority-ordered tab delivery            │
// │  EmailProcessor     — Unified detection + routing pipeline     │
// │  PollingEngine      — Lifecycle, alarms, health monitoring     │
// └────────────────────────────────────────────────────────────────┘
// ─────────────────────────────────────────────────────────────────────

import { emailService } from '../services/emailServices';
import { linkService } from '../services/linkService';
import { otpService } from '../services/otpService';
import { smartDetectionService } from '../services/smartDetectionService';
import { storageService } from '../services/storageService';
import { EmailAccount } from '../types';
import { createLogger } from '../utils/logger';

import { updateOTPMenuItem } from './contextMenu';

const log = createLogger('PollingEngine');

// ═══════════════════════════════════════════════════════════════
//  §0  CONSTANTS
// ═══════════════════════════════════════════════════════════════

/** Notification rate limiting */
const NOTIFICATION_RATE_LIMIT_MS = 30_000;
const NOTIFICATION_BADGE_CLEAR_MS = 5_000;

/** Adaptive polling intervals */
const TIMING = {
  // Fast OTP polling ladder
  FAST_FLOOR_MS: 3_000,
  FAST_AGGRESSIVE_MS: 4_000,
  FAST_NORMAL_MS: 6_000,
  FAST_RELAXED_MS: 12_000,
  FAST_CEILING_MS: 20_000,

  // Fast ladder time boundaries
  FAST_AGGRESSIVE_UNTIL_MS: 15_000,
  FAST_NORMAL_UNTIL_MS: 45_000,
  FAST_RELAXED_UNTIL_MS: 90_000,

  // General polling ladder
  GENERAL_ACTIVE_MS: 7_000,
  GENERAL_DEFAULT_MS: 10_000,

  // Lifecycle
  STALE_TAB_MS: 300_000,
  DEDUP_TTL_MS: 600_000,
  HEALTH_TICK_MS: 30_000,
  METRICS_TICK_MS: 60_000,

  // Email age filter
  MAX_EMAIL_AGE_MS: 3_600_000, // 1 hour

  // Parallel processing cap
  EMAIL_BATCH_SIZE: 3,
} as const;

/** Circuit breaker thresholds */
const CIRCUIT = {
  FAIL_THRESHOLD: 5,
  HALF_OPEN_SUCCESSES: 3,
  BACKOFF_BASE_MS: 5_000,
  BACKOFF_CAP_MS: 120_000,
  MAX_BACKOFF_EXPONENT: 10,
} as const;

/** Sliding window rate limiter */
const RATE = {
  MAX_PER_WINDOW: 20,
  WINDOW_MS: 60_000,
} as const;

/** OTP delivery retry schedule (geometric backoff) */
const OTP_DELIVERY_DELAYS_MS: readonly number[] = [0, 500, 1000, 2000];

/** Chrome alarm names */
const ALARM_NAMES = {
  EMAIL_SYNC: 'email-sync',
  HEALTH_SWEEP: 'polling-health-sweep',
  METRICS_REPORT: 'polling-metrics-report',
} as const;

/** Minimum alarm period (Chrome minimum is 1 minute) */
const MIN_ALARM_PERIOD_MINUTES = 1;

/** EMA smoothing factor */
const EMA_ALPHA = 0.2;

/** Storage keys */
const STORAGE_KEY_PROCESSED = 'processedEmails';

// ═══════════════════════════════════════════════════════════════
//  §1  TYPES
// ═══════════════════════════════════════════════════════════════

interface TabRegistration {
  readonly url: string;
  readonly hostname: string;
  readonly fieldSelectors: readonly string[];
  readonly registeredAt: number;
  readonly priority: number;
  deliveryAttempts: number;
}

interface ProcessedEmailRecord {
  readonly id: string;
  readonly processedAt: number;
  readonly hadOTP: boolean;
  readonly hadLink: boolean;
  readonly ttlExpiresAt: number;
}

type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerState {
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
  avgCheckMs: number;
  lastSuccessTime: number;
  lastErrorMessage: string | null;
  lastErrorTime: number;
}

type CheckMode = 'fast' | 'general';

interface EmailContext {
  readonly from: string;
  readonly subject: string;
  readonly provider?: string;
  readonly linkUrl?: string | null;
}

interface SessionState {
  pm_breaker?: CircuitBreakerState;
  pm_requestLog?: number[];
  pm_lastNotificationTime?: number;
}

// ═══════════════════════════════════════════════════════════════
//  §2  NOTIFICATION MANAGER
// ═══════════════════════════════════════════════════════════════

class NotificationManager {
  private lastNotificationTime = 0;

  /** Restore state from session storage */
  restoreState(savedTime: number): void {
    this.lastNotificationTime = savedTime;
  }

  /** Get current state for persistence */
  getLastTime(): number {
    return this.lastNotificationTime;
  }

  /**
   * Show badge notification with rate limiting.
   * Always shows badge; skips popup notification if rate-limited.
   */
  async show(title: string, detail: string): Promise<void> {
    const now = Date.now();

    if (now - this.lastNotificationTime >= NOTIFICATION_RATE_LIMIT_MS) {
      this.lastNotificationTime = now;
      log.debug('Notification shown', { title, detail });
    } else {
      log.debug('Notification rate limited, badge only', { title });
    }

    this.showBadge();
  }

  private showBadge(): void {
    try {
      if (!chrome?.action) {return;}
      void chrome.action.setBadgeText({ text: '!' });
      void chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });

      setTimeout(() => {
        try {
          if (chrome?.action) {
            void chrome.action.setBadgeText({ text: '' });
          }
        } catch {
          /* extension context may be invalidated */
        }
      }, NOTIFICATION_BADGE_CLEAR_MS);
    } catch {
      /* extension context may be invalidated */
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  §3  CIRCUIT BREAKER
// ═══════════════════════════════════════════════════════════════

class CircuitBreaker {
  private readonly state: CircuitBreakerState = {
    state: 'closed',
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    lastFailureTime: 0,
    nextRetryTime: 0,
  };

  /** Restore state from session storage */
  restoreState(saved: CircuitBreakerState): void {
    Object.assign(this.state, saved);
  }

  /** Get current state for persistence */
  getState(): Readonly<CircuitBreakerState> {
    return { ...this.state };
  }

  get currentState(): CircuitState {
    return this.state.state;
  }

  get failures(): number {
    return this.state.consecutiveFailures;
  }

  allowsRequest(): boolean {
    if (this.state.state === 'closed') {return true;}

    if (this.state.state === 'open') {
      if (Date.now() >= this.state.nextRetryTime) {
        this.state.state = 'half-open';
        this.state.consecutiveSuccesses = 0;
        log.info('🟡 Circuit → half-open');
        return true;
      }
      return false;
    }

    // half-open: allow to test recovery
    return true;
  }

  recordSuccess(): void {
    this.state.consecutiveFailures = 0;
    this.state.consecutiveSuccesses++;

    if (
      this.state.state === 'half-open' &&
      this.state.consecutiveSuccesses >= CIRCUIT.HALF_OPEN_SUCCESSES
    ) {
      this.state.state = 'closed';
      log.info('🟢 Circuit → closed (recovered)');
    }
  }

  recordFailure(error: unknown): void {
    this.state.consecutiveSuccesses = 0;
    this.state.consecutiveFailures++;
    this.state.lastFailureTime = Date.now();

    if (this.state.consecutiveFailures >= CIRCUIT.FAIL_THRESHOLD) {
      this.state.state = 'open';
      const exponent = Math.min(
        this.state.consecutiveFailures - CIRCUIT.FAIL_THRESHOLD,
        CIRCUIT.MAX_BACKOFF_EXPONENT
      );
      const backoff = Math.min(
        CIRCUIT.BACKOFF_BASE_MS * Math.pow(2, exponent),
        CIRCUIT.BACKOFF_CAP_MS
      );
      this.state.nextRetryTime = Date.now() + backoff;
      log.warn('🔴 Circuit → open', {
        failures: this.state.consecutiveFailures,
        retryInMs: backoff,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  §4  SLIDING WINDOW RATE LIMITER
// ═══════════════════════════════════════════════════════════════

class SlidingRateLimiter {
  private readonly timestamps: number[] = [];

  /** Restore state from session storage */
  restoreState(saved: number[]): void {
    this.timestamps.length = 0;
    this.timestamps.push(...saved);
  }

  /** Get current state for persistence */
  getTimestamps(): readonly number[] {
    return [...this.timestamps];
  }

  get windowSize(): number {
    this.prune();
    return this.timestamps.length;
  }

  isLimited(): boolean {
    this.prune();
    return this.timestamps.length >= RATE.MAX_PER_WINDOW;
  }

  stamp(): void {
    this.timestamps.push(Date.now());
  }

  reset(): void {
    this.timestamps.length = 0;
  }

  private prune(): void {
    const cutoff = Date.now() - RATE.WINDOW_MS;
    const pruneIndex = this.timestamps.findIndex((ts) => ts >= cutoff);
    if (pruneIndex > 0) {
      this.timestamps.splice(0, pruneIndex);
    } else if (pruneIndex === -1 && this.timestamps.length > 0) {
      this.timestamps.length = 0;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  §5  DEDUPLICATION CACHE WITH TTL
// ═══════════════════════════════════════════════════════════════

class DedupCache {
  private readonly records = new Map<string, ProcessedEmailRecord>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  get size(): number {
    return this.records.size;
  }

  /**
   * Restore persisted records from storage.
   * Does NOT restore timers — those are recreated on next access.
   */
  restoreState(saved: Record<string, ProcessedEmailRecord>): void {
    const now = Date.now();
    for (const [id, record] of Object.entries(saved)) {
      // Only restore records that haven't expired
      if (record.ttlExpiresAt > now) {
        this.records.set(id, record);
        this.scheduleEviction(id, record.ttlExpiresAt - now);
      }
    }
  }

  isProcessed(emailId: string | number, accountId: string): boolean {
    const key = this.makeKey(emailId, accountId);
    const record = this.records.get(key);

    if (!record) {return false;}

    if (Date.now() >= record.ttlExpiresAt) {
      this.evict(key);
      return false;
    }

    return true;
  }

  markProcessed(
    emailId: string | number,
    accountId: string,
    hadOTP: boolean,
    hadLink: boolean
  ): void {
    const key = this.makeKey(emailId, accountId);

    // Clear existing timer
    this.clearTimer(key);

    const record: ProcessedEmailRecord = {
      id: key,
      processedAt: Date.now(),
      hadOTP,
      hadLink,
      ttlExpiresAt: Date.now() + TIMING.DEDUP_TTL_MS,
    };

    this.records.set(key, record);
    this.scheduleEviction(key, TIMING.DEDUP_TTL_MS);
    this.persist();
  }

  /** Remove expired entries */
  prune(): number {
    const now = Date.now();
    let pruned = 0;

    for (const [key, record] of this.records) {
      if (now >= record.ttlExpiresAt) {
        this.evict(key);
        pruned++;
      }
    }

    // Clean orphaned timers
    for (const [key] of this.timers) {
      if (!this.records.has(key)) {
        this.clearTimer(key);
      }
    }

    if (pruned > 0) {
      log.debug('🧹 Pruned dedup cache', { pruned, remaining: this.records.size });
    }

    return pruned;
  }

  /** Clear all entries and timers */
  clear(): void {
    for (const [key] of this.timers) {
      this.clearTimer(key);
    }
    this.records.clear();
    this.timers.clear();
  }

  private makeKey(emailId: string | number, accountId: string): string {
    return `${accountId}:${emailId}`;
  }

  private evict(key: string): void {
    this.records.delete(key);
    this.clearTimer(key);
    this.persist();
  }

  private clearTimer(key: string): void {
    const timer = this.timers.get(key);
    if (timer !== undefined && timer !== null) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  private scheduleEviction(key: string, delayMs: number): void {
    const timer = setTimeout(() => {
      this.records.delete(key);
      this.timers.delete(key);
      this.persist();
      log.debug('Email dedup TTL expired', { key });
    }, delayMs);
    this.timers.set(key, timer);
  }

  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persist(): void {
    if (this.persistTimer) { clearTimeout(this.persistTimer); }
    this.persistTimer = setTimeout(() => {
        const serializable = Object.fromEntries(this.records);
        storageService
          .set(STORAGE_KEY_PROCESSED, serializable)
          .catch((e) => log.warn('Failed to persist dedup cache', e));
    }, 2000);
  }
}

// ═══════════════════════════════════════════════════════════════
//  §6  ADAPTIVE INTERVAL CALCULATOR
// ═══════════════════════════════════════════════════════════════

class AdaptiveScheduler {
  static calculateInterval(
    mode: CheckMode,
    waitingTabs: ReadonlyMap<number, TabRegistration>
  ): number {
    if (mode === 'fast') {
      return this.calculateFastInterval(waitingTabs);
    }
    return this.calculateGeneralInterval(waitingTabs);
  }

  private static calculateFastInterval(
    waitingTabs: ReadonlyMap<number, TabRegistration>
  ): number {
    if (waitingTabs.size === 0) {return TIMING.FAST_CEILING_MS;}

    const now = Date.now();
    let oldestRegistration = now;
    for (const reg of waitingTabs.values()) {
      if (reg.registeredAt < oldestRegistration) {
        oldestRegistration = reg.registeredAt;
      }
    }

    const waited = now - oldestRegistration;

    if (waited < TIMING.FAST_AGGRESSIVE_UNTIL_MS) {return TIMING.FAST_AGGRESSIVE_MS;}
    if (waited < TIMING.FAST_NORMAL_UNTIL_MS) {return TIMING.FAST_NORMAL_MS;}
    if (waited < TIMING.FAST_RELAXED_UNTIL_MS) {return TIMING.FAST_RELAXED_MS;}
    return TIMING.FAST_CEILING_MS;
  }

  private static calculateGeneralInterval(
    waitingTabs: ReadonlyMap<number, TabRegistration>
  ): number {
    return waitingTabs.size > 0
      ? TIMING.GENERAL_ACTIVE_MS
      : TIMING.GENERAL_DEFAULT_MS;
  }
}

// ═══════════════════════════════════════════════════════════════
//  §7  DOMAIN MATCHING ENGINE
// ═══════════════════════════════════════════════════════════════

class DomainMatcher {
  private static readonly CLUSTERS: Readonly<Record<string, readonly string[]>> = {
    alibaba: ['alibaba.com', 'aliyun.com', 'alibaba-inc.com', 'tmall.com', 'taobao.com'],
    google: ['google.com', 'youtube.com', 'gmail.com', 'firebase.com'],
    microsoft: ['microsoft.com', 'live.com', 'outlook.com', 'hotmail.com', 'azure.com'],
  };

  /**
   * Check if an email sender matches a tab's domain context.
   * Uses root domain matching, cluster matching, provider matching,
   * and link domain matching.
   */
  static matches(
    senderEmail: string,
    tabUrl: string,
    providerName?: string,
    linkUrl?: string | null
  ): boolean {
    if (!tabUrl || tabUrl.startsWith('chrome://') || tabUrl.startsWith('about:')) {
      return false;
    }

    try {
      const tabHostname = new URL(tabUrl).hostname.toLowerCase();
      const senderDomain = (senderEmail.split('@')[1] ?? '').toLowerCase();
      if (!senderDomain) {return false;}

      const tabRoot = this.getRootDomain(tabHostname);
      const senderRoot = this.getRootDomain(senderDomain);

      // 1. Root domain overlap
      if (
        tabRoot === senderRoot ||
        tabHostname.includes(senderRoot) ||
        senderDomain.includes(tabRoot)
      ) {
        return true;
      }

      // 2. Cluster matching
      for (const [canonical, domains] of Object.entries(this.CLUSTERS)) {
        const tabInCluster = domains.some((d) => tabHostname.endsWith(d));
        const senderInCluster = domains.some((d) => senderDomain.endsWith(d));
        const providerMatch = providerName?.toLowerCase().includes(canonical);

        if ((tabInCluster && senderInCluster) || (tabInCluster && providerMatch)) {
          return true;
        }
      }

      // 3. Provider keyword match
      if (providerName) {
        const normalized = providerName.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normalized && tabHostname.includes(normalized)) {
          return true;
        }
      }

      // 4. Link domain match
      if (linkUrl) {
        try {
          const linkHostname = new URL(linkUrl).hostname.toLowerCase();
          const linkRoot = this.getRootDomain(linkHostname);
          if (tabHostname.includes(linkRoot) || linkHostname.includes(tabRoot)) {
            return true;
          }
        } catch {
          /* invalid URL */
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  private static getRootDomain(hostname: string): string {
    const parts = hostname.split('.');
    return parts.length <= 2 ? hostname : parts.slice(-2).join('.');
  }
}

// ═══════════════════════════════════════════════════════════════
//  §8  OTP DELIVERY ENGINE
// ═══════════════════════════════════════════════════════════════

class OTPDeliveryEngine {
  /**
   * Deliver OTP to a specific tab with retry.
   * Returns true if delivery succeeded.
   */
  static async deliverToTab(
    tabId: number,
    code: string,
    confidence: number
  ): Promise<boolean> {
    for (let attempt = 0; attempt < OTP_DELIVERY_DELAYS_MS.length; attempt++) {
      const delayMs = OTP_DELIVERY_DELAYS_MS[attempt]!;

      if (delayMs > 0) {
        await new Promise<void>((r) => { setTimeout(r, delayMs); });
        log.info(`🔄 Retry OTP delivery to tab ${tabId} (${attempt + 1}/${OTP_DELIVERY_DELAYS_MS.length})`);
      }

      try {
        const result = await chrome.tabs.sendMessage(tabId, {
          action: 'AUTO_FILL_OTP',
          payload: { otp: code, source: 'email', confidence },
        });

        if (result?.success) {
          log.info('📲 OTP delivered', { tabId, attempt: attempt + 1 });
          return true;
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log.debug(`Delivery attempt ${attempt + 1} failed: ${msg}`);

        // Content script not loaded — no point retrying
        if (msg.includes('Receiving end does not exist')) {
          return false;
        }
      }
    }

    log.warn('OTP delivery failed after all attempts', { tabId });
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
//  §9  OTP CODE EXTRACTOR (multi-source)
// ═══════════════════════════════════════════════════════════════

class OTPCodeExtractor {
  private static readonly EMERGENCY_PATTERNS: readonly RegExp[] = [
    /(?:use|enter|type|input)\s+(\d{4,8})\b/i,
    /(?:code|pin|otp|password|token|passcode)\s*(?:is|:|=)\s*(\d{4,8})\b/i,
    /(?:confirmation|verification|security|login)\s+code\s*:?\s*(\d{4,8})\b/i,
    /your\s+(?:\w+\s+)?code\s*(?:is|:)\s*(\d{4,8})\b/i,
    /\b(\d{4,8})\s+is\s+your\s+(?:\w+\s+)?(?:code|pin|otp)/i,
  ];

  /**
   * Extract OTP code from all available sources:
   * 1. Direct detection result
   * 2. Link URL parameter extraction
   * 3. URLs found in email body
   * 4. Emergency regex patterns
   */
  static extract(
    detection: { type: string; code?: string; link?: string },
    fullEmail: { body?: string; htmlBody?: string; subject?: string }
  ): string | null {
    // Source 1: Direct detection
    if ((detection.type === 'otp' || detection.type === 'both') && detection.code) {
      return detection.code;
    }

    // Source 2: Link URL extraction
    if (detection.link) {
      const code = linkService.extractCodeFromUrl(detection.link);
      if (code) {
        log.info('🔑 OTP from link URL');
        return code;
      }
    }

    // Source 3: URLs in email body
    const rawText = fullEmail.htmlBody ?? fullEmail.body ?? '';
    const urlMatches = rawText.match(/https?:\/\/[^\s"'<>]+/gi);
    if (urlMatches) {
      for (const candidateUrl of urlMatches) {
        const code = linkService.extractCodeFromUrl(candidateUrl);
        if (code) {
          log.info('🔎 OTP from email body URL');
          return code;
        }
      }
    }

    // Source 4: Emergency regex
    const emailText = fullEmail.body ?? fullEmail.subject ?? '';
    for (const rx of this.EMERGENCY_PATTERNS) {
      const match = emailText.match(rx);
      if (match?.[1]) {
        log.info('🚨 OTP via emergency regex');
        return match[1];
      }
    }

    // Source 5: Short email standalone number
    if (emailText.length < 200) {
      const shortMatch = emailText.match(/\b(\d{4,8})\b/);
      if (shortMatch?.[1]) {
        log.info('🚨 OTP from short email');
        return shortMatch[1];
      }
    }

    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  §10  MAIN POLLING ENGINE
// ═══════════════════════════════════════════════════════════════

// ── Module state ──
const otpWaitingTabs = new Map<number, TabRegistration>();
const circuitBreaker = new CircuitBreaker();
const rateLimiter = new SlidingRateLimiter();
const dedupCache = new DedupCache();
const notifications = new NotificationManager();

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

let pollingActive = false;
let generalTimer: ReturnType<typeof setTimeout> | null = null;
let lastGlobalCheckTime = 0;
let initialized = false;
let alarmListenerInstalled = false;
let runtimeListenerInstalled = false;
let priorityCounter = 0;
let checkInProgress = false;

// ── Alarm handler (must be stable reference for removeListener) ──
const onPollingAlarm = (alarm: chrome.alarms.Alarm): void => {
  switch (alarm.name) {
    case ALARM_NAMES.EMAIL_SYNC:
      if (pollingActive) {
        log.debug('⏰ Alarm sync triggered');
        void performCheck('general').then(() => {
          // Restart aggressive polling loop in case SW was completely suspended
          scheduleGeneralPoll();
        });
      }
      break;
    case ALARM_NAMES.HEALTH_SWEEP:
      runHealthSweep();
      break;
    case ALARM_NAMES.METRICS_REPORT:
      logMetricsSnapshot();
      break;
  }
};

// ── Runtime message handler for link activation ──
const onPollingRuntimeMessage = (
  message: { action?: string; payload?: { timestamp?: number; source?: string } },
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
): boolean => {
  if (message?.action === 'LINK_ACTIVATED') {
    log.info('🔗 Link activated — cooling down polling');
    stopEmailPolling();
    sendResponse({ ok: true });
  }
  return false; // Don't keep channel open for unrelated messages
};

// ── Health sweep ──
function runHealthSweep(): void {
  const now = Date.now();

  for (const [tabId, reg] of otpWaitingTabs) {
    if (now - reg.registeredAt > TIMING.STALE_TAB_MS) {
      log.info('🧹 Expired stale OTP tab', { tabId, hostname: reg.hostname });
      stopFastOTPPolling(tabId);
    }
  }

  dedupCache.prune();
  rateLimiter; // Rate limiter self-prunes on access
}

function logMetricsSnapshot(): void {
  const uptimeSec = Math.round((Date.now() - metrics.startedAt) / 1000);
  log.debug('📊 Engine snapshot', {
    uptime: `${uptimeSec}s`,
    checks: `${metrics.successfulChecks}/${metrics.totalChecks} ok`,
    avgMs: Math.round(metrics.avgCheckMs),
    otps: `${metrics.otpsFound} found · ${metrics.otpsDelivered} delivered`,
    emails: metrics.emailsProcessed,
    links: metrics.linksProcessed,
    waitingTabs: otpWaitingTabs.size,
    circuit: circuitBreaker.currentState,
    dedupCache: dedupCache.size,
    rateWindow: rateLimiter.windowSize,
  });
}

function getAlarmPeriodMinutes(intervalMs: number): number {
  return Math.max(MIN_ALARM_PERIOD_MINUTES, intervalMs / 60_000);
}

// ── Gate: should we fire a check right now? ──
function checkPermitted(mode: CheckMode): boolean {
  if (!circuitBreaker.allowsRequest()) {
    log.debug('⛔ Circuit breaker', { state: circuitBreaker.currentState });
    return false;
  }
  if (rateLimiter.isLimited()) {
    log.debug('⛔ Rate limited', { window: rateLimiter.windowSize });
    return false;
  }
  if (mode === 'fast') {
    const gap = Date.now() - lastGlobalCheckTime;
    if (gap < TIMING.FAST_FLOOR_MS) {return false;}
  }
  return true;
}

// ── Session state persistence ──
function persistSessionState(): void {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) {return;}

  chrome.storage.session
    .set({
      pm_breaker: circuitBreaker.getState(),
      // Array.from converts readonly number[] → mutable number[] to satisfy SessionState
      pm_requestLog: Array.from(rateLimiter.getTimestamps()),
      pm_lastNotificationTime: notifications.getLastTime(),
    } satisfies SessionState)
    .catch((e) => log.debug('Session state sync failed', e));
}

// ═══════════════════════════════════════════════════════════════
//  §11  CORE: UNIFIED INBOX CHECK
// ═══════════════════════════════════════════════════════════════

async function performCheck(mode: CheckMode): Promise<void> {
  // Coalescing: if already running, skip
  if (checkInProgress) {
    log.debug('Check in progress, skipping', { mode });
    return;
  }

  if (!checkPermitted(mode)) {return;}

  checkInProgress = true;
  const t0 = Date.now();
  metrics.totalChecks++;
  rateLimiter.stamp();

  try {
    const currentEmail = await emailService.getCurrentEmail();
    if (!currentEmail) {
      log.debug('No current email configured');
      return;
    }

    const cachedInbox = await emailService.getCachedInbox();
    const freshInbox = await emailService.checkInbox(currentEmail);

    const cachedIds = new Set(cachedInbox.map((e) => e.id));
    const cutoff = Date.now() - TIMING.MAX_EMAIL_AGE_MS;

    const newEmails = freshInbox.filter((e) => {
      if (cachedIds.has(e.id)) {return false;}
      if (dedupCache.isProcessed(String(e.id), currentEmail.fullEmail)) {return false;}
      if ((e.date ?? 0) < cutoff) {
        log.debug('Skipping old email', { id: e.id });
        return false;
      }
      return true;
    });

    if (newEmails.length > 0) {
      log.info(`📬 ${newEmails.length} new email(s)`, { mode });

      const batches = chunk(newEmails, TIMING.EMAIL_BATCH_SIZE);
      for (const batch of batches) {
        await Promise.allSettled(
          batch.map((email) =>
            processEmail(String(email.id), currentEmail)
          )
        );
      }
    }

    circuitBreaker.recordSuccess();
    metrics.successfulChecks++;
    metrics.lastSuccessTime = Date.now();
  } catch (error) {
    circuitBreaker.recordFailure(error);
    metrics.failedChecks++;
    metrics.lastErrorMessage = error instanceof Error ? error.message : String(error);
    metrics.lastErrorTime = Date.now();

    log.warn(`Inbox check failed [${mode}]`, {
      error: metrics.lastErrorMessage,
      circuit: circuitBreaker.currentState,
      failures: circuitBreaker.failures,
    });
  } finally {
    checkInProgress = false;

    const elapsed = Date.now() - t0;
    metrics.avgCheckMs =
      metrics.avgCheckMs === 0
        ? elapsed
        : metrics.avgCheckMs * (1 - EMA_ALPHA) + elapsed * EMA_ALPHA;

    lastGlobalCheckTime = Date.now();
    persistSessionState();
  }
}

// ═══════════════════════════════════════════════════════════════
//  §12  CORE: EMAIL PROCESSING PIPELINE
// ═══════════════════════════════════════════════════════════════

async function processEmail(
  emailId: string,
  currentEmail: EmailAccount
): Promise<void> {
  if (dedupCache.isProcessed(emailId, currentEmail.fullEmail)) {return;}

  const fullEmail = await emailService.readEmail(emailId, currentEmail);
  metrics.emailsProcessed++;

  // ── Detection ──
  const expectedDomains = collectExpectedDomains();
  const detection = await smartDetectionService.detect(
    fullEmail.subject,
    fullEmail.body,
    fullEmail.htmlBody,
    fullEmail.from,
    expectedDomains.length > 0 ? expectedDomains : undefined
  );

  log.info('📊 Detection', {
    type: detection.type,
    hasCode: Boolean(detection.code),
    hasLink: Boolean(detection.link),
    waitingTabs: otpWaitingTabs.size,
  });

  // ── PRIORITY 1: Inline OTP delivery to waiting tabs ──
  if (otpWaitingTabs.size > 0) {
    const matchingTabId = findMatchingTab(fullEmail.from, detection.provider, detection.link);

    if (matchingTabId !== null) {
      log.info('🎯 Matching tab found — inline OTP delivery');

      const otpCode = OTPCodeExtractor.extract(detection, fullEmail);

      if (otpCode) {
        dedupCache.markProcessed(emailId, currentEmail.fullEmail, true, false);

        await deliverOTP(otpCode, detection.confidence ?? 0.9, {
          from: fullEmail.from,
          subject: fullEmail.subject,
          provider: detection.provider,
          linkUrl: detection.link,
        });

        void notifications.show(`OTP: ${otpCode}`, `From: ${fullEmail.from}`);
        return;
      }

      log.warn('⚠️ Matching tab but no OTP extractable — falling through');
    }
  }

  // ── PRIORITY 2: Standard processing ──
  const hasOTP = (detection.type === 'otp' || detection.type === 'both') && Boolean(detection.code);
  const hasLink = (detection.type === 'link' || detection.type === 'both') && Boolean(detection.link);

  // Mark before side effects
  dedupCache.markProcessed(emailId, currentEmail.fullEmail, hasOTP, hasLink);

  if (hasLink && detection.link) {
    log.info('🔗 Link detected, deferring to linkService');
    metrics.linksProcessed++;
    await linkService.handleNewEmail(fullEmail).catch((e) => log.warn('linkService error', e));
    void notifications.show('Verification Link Found', `From: ${fullEmail.from}`);
  }

  if (hasOTP && detection.code) {
    log.info('🔢 OTP detected');
    await deliverOTP(detection.code, detection.confidence, {
      from: fullEmail.from,
      subject: fullEmail.subject,
      provider: detection.provider,
      linkUrl: detection.link,
    });
    void notifications.show(`OTP: ${detection.code}`, `From: ${fullEmail.from}`);
  }

  if (!hasOTP && !hasLink) {
    void notifications.show('New Email', `From: ${fullEmail.from}`);
  }
}

// ── Find the highest-priority waiting tab that matches this email ──
function findMatchingTab(
  senderEmail: string,
  provider?: string,
  linkUrl?: string | null
): number | null {
  const sorted = Array.from(otpWaitingTabs.entries()).sort(
    ([, a], [, b]) => a.priority - b.priority
  );

  for (const [tabId, reg] of sorted) {
    if (DomainMatcher.matches(senderEmail, reg.url, provider, linkUrl)) {
      return tabId;
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
//  §13  OTP DELIVERY ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════

async function deliverOTP(
  code: string,
  confidence: number,
  email: EmailContext
): Promise<void> {
  metrics.otpsFound++;

  await otpService.saveLastOTP(code, 'email', email.from, email.subject, confidence);
  await updateOTPMenuItem();

  const masked = code.length > 2
    ? code.substring(0, 2) + '•'.repeat(code.length - 2)
    : '•'.repeat(code.length);

  log.info('🎯 OTP detected', {
    code: masked,
    confidence: `${Math.round(confidence * 100)}%`,
    from: email.from,
    waitingTabs: otpWaitingTabs.size,
  });

  // Priority-sorted delivery
  const sorted = Array.from(otpWaitingTabs.entries()).sort(
    ([, a], [, b]) => a.priority - b.priority
  );

  const delivered: number[] = [];

  for (const [tabId, reg] of sorted) {
    if (!DomainMatcher.matches(email.from, reg.url, email.provider, email.linkUrl)) {
      log.info(`⛔ Domain mismatch: tab ${reg.hostname} ≠ ${email.from}`);
      continue;
    }

    const ok = await OTPDeliveryEngine.deliverToTab(tabId, code, confidence);
    if (ok) {
      reg.deliveryAttempts++;
      metrics.otpsDelivered++;
      delivered.push(tabId);
      await otpService.markAsUsed();
    }
  }

  // Unregister delivered tabs
  for (const tabId of delivered) {
    stopFastOTPPolling(tabId);
  }
}

// ═══════════════════════════════════════════════════════════════
//  §14  PUBLIC API
// ═══════════════════════════════════════════════════════════════

export function setupPollingManager(): void {
  if (initialized) {
    log.warn('Already initialized');
    return;
  }
  initialized = true;
  metrics.startedAt = Date.now();

  // Restore persisted dedup cache
  storageService
    .get(STORAGE_KEY_PROCESSED)
    .then((saved: unknown) => {
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        dedupCache.restoreState(saved as Record<string, ProcessedEmailRecord>);
      }
    })
    .catch((e) => log.warn('Failed to restore dedup cache', e));

  // Restore session state
  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    chrome.storage.session
      .get(['pm_breaker', 'pm_requestLog', 'pm_lastNotificationTime'])
      .then((data: SessionState) => {
        if (data.pm_breaker) {circuitBreaker.restoreState(data.pm_breaker);}
        if (data.pm_requestLog) {rateLimiter.restoreState(data.pm_requestLog);}
        // Adaptive baseline
        if (data.pm_lastNotificationTime !== undefined) { // Changed from typeof data.pm_lastNotificationTime === 'number'
          notifications.restoreState(data.pm_lastNotificationTime);
        }
      })
      .catch((e) => log.warn('Failed to restore session state', e));
  }

  // Chrome alarms for MV3 background
  void chrome.alarms.create(ALARM_NAMES.EMAIL_SYNC, { periodInMinutes: 1 });
  void chrome.alarms.create(ALARM_NAMES.HEALTH_SWEEP, {
    periodInMinutes: getAlarmPeriodMinutes(TIMING.HEALTH_TICK_MS),
  });
  void chrome.alarms.create(ALARM_NAMES.METRICS_REPORT, {
    periodInMinutes: getAlarmPeriodMinutes(TIMING.METRICS_TICK_MS),
  });

  if (!alarmListenerInstalled) {
    chrome.alarms.onAlarm.addListener(onPollingAlarm);
    alarmListenerInstalled = true;
  }

  // Link activation listener
  if (!runtimeListenerInstalled) {
    chrome.runtime.onMessage.addListener(onPollingRuntimeMessage);
    runtimeListenerInstalled = true;
  }

  // Auto-start if email exists
  emailService
    .getCurrentEmail()
    .then((email) => {
      if (email) {
        log.info('Found existing email, starting polling');
        startEmailPolling();
      }
    })
    .catch(() => { /* no email configured */ });

  runHealthSweep();
  logMetricsSnapshot();
  log.info('🚀 Polling engine initialized');
}

export function startEmailPolling(): void {
  if (pollingActive) {return;}
  pollingActive = true;
  log.info('📧 General polling STARTED');
  scheduleGeneralPoll();
}

export function stopEmailPolling(): void {
  if (!pollingActive) {return;}
  pollingActive = false;

  if (generalTimer !== undefined && generalTimer !== null) {
    clearTimeout(generalTimer);
    generalTimer = null;
  }

  dedupCache.clear();
  log.info('📧 General polling STOPPED');
}

function scheduleGeneralPoll(): void {
  if (!pollingActive) {return;}

  if (generalTimer !== undefined && generalTimer !== null) {clearTimeout(generalTimer);}

  const interval = AdaptiveScheduler.calculateInterval('general', otpWaitingTabs);

  generalTimer = setTimeout(() => {
    if (!pollingActive) {return;}
    void performCheck('general')
      .then(() => scheduleGeneralPoll())
      .catch((error) => {
        log.warn('General poll failed', error);
        scheduleGeneralPoll();
      });
  }, interval);
}

export function startFastOTPPolling(
  tabId: number,
  url: string,
  fieldSelectors: string[]
): void {
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = url;
  }

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
    performCheck('fast').catch((e) => log.warn('Initial fast check error', e));
  }

  if (!pollingActive) {startEmailPolling();}
}

export function stopFastOTPPolling(tabId: number): void {
  if (!otpWaitingTabs.delete(tabId)) {return;}
  log.info('🛑 Fast OTP unregistered', { tabId, remaining: otpWaitingTabs.size });
}

export function getOTPWaitingTabs(): ReadonlyMap<number, TabRegistration> {
  return otpWaitingTabs;
}

export function getPollingMetrics(): Readonly<PollingMetrics & {
  uptimeMs: number;
  waitingTabs: number;
  circuitState: CircuitState;
  currentInterval: number;
  processedCached: number;
}> {
  return {
    ...metrics,
    uptimeMs: Date.now() - metrics.startedAt,
    waitingTabs: otpWaitingTabs.size,
    circuitState: circuitBreaker.currentState,
    currentInterval: AdaptiveScheduler.calculateInterval('general', otpWaitingTabs),
    processedCached: dedupCache.size,
  };
}

export function destroyPollingManager(): void {
  stopEmailPolling();

  void chrome.alarms.clear(ALARM_NAMES.EMAIL_SYNC).catch((e) => log.debug('Alarm clear failed', e));
  void chrome.alarms.clear(ALARM_NAMES.HEALTH_SWEEP).catch((e) => log.debug('Alarm clear failed', e));
  void chrome.alarms.clear(ALARM_NAMES.METRICS_REPORT).catch((e) => log.debug('Alarm clear failed', e));

  if (alarmListenerInstalled) {
    chrome.alarms.onAlarm.removeListener(onPollingAlarm);
    alarmListenerInstalled = false;
  }

  if (runtimeListenerInstalled) {
    chrome.runtime.onMessage.removeListener(onPollingRuntimeMessage);
    runtimeListenerInstalled = false;
  }

  otpWaitingTabs.clear();
  dedupCache.clear();
  rateLimiter.reset();
  initialized = false;
  priorityCounter = 0;
  checkInProgress = false;

  log.info('💀 Polling engine destroyed');
}

// ═══════════════════════════════════════════════════════════════
//  §15  UTILITIES
// ═══════════════════════════════════════════════════════════════

function collectExpectedDomains(): string[] {
  const seen = new Set<string>();
  for (const reg of otpWaitingTabs.values()) {
    if (reg.hostname) {seen.add(reg.hostname);}
  }
  return Array.from(seen);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}
