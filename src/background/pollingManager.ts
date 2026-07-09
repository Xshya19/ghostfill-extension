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

import { dedupService } from '../services/dedupService';
import { emailService } from '../services/emailServices';
import { linkService } from '../services/linkService';
import { otpService } from '../services/otpService';
import { smartDetectionService } from '../services/otpService';
import { storageService } from '../services/storageService';
import type { DetectionResult } from '../services/types/extraction.types';
import { Email, EmailAccount } from '../types';
import { createLogger, diag } from '../utils/logger';
import { safeSendTabMessage } from '../utils/messaging';

import { updateOTPMenuItem } from './contextMenu';
import { notifyNewEmail } from './notifications';

const log = createLogger('PollingEngine');

// ═══════════════════════════════════════════════════════════════
//  §0  CONSTANTS
// ═══════════════════════════════════════════════════════════════

/** Adaptive polling intervals */
const TIMING = {
  // Fast OTP polling ladder
  FAST_FLOOR_MS: 2_000,
  FAST_AGGRESSIVE_MS: 2_500,
  FAST_NORMAL_MS: 5_000,
  FAST_RELAXED_MS: 10_000,
  FAST_CEILING_MS: 20_000,

  // Fast ladder time boundaries
  FAST_AGGRESSIVE_UNTIL_MS: 60_000,
  FAST_NORMAL_UNTIL_MS: 120_000,
  FAST_RELAXED_UNTIL_MS: 180_000,

  // General polling ladder
  GENERAL_ACTIVE_MS: 7_000,
  GENERAL_DEFAULT_MS: 10_000,

  // Lifecycle
  STALE_TAB_MS: 300_000,
  DEDUP_TTL_MS: 24 * 60 * 60 * 1000, // 24 hours
  HEALTH_TICK_MS: 30_000,
  METRICS_TICK_MS: 60_000,

  // Email age filter
  MAX_EMAIL_AGE_MS: 24 * 60 * 60 * 1000, // 24 hours
} as const;

/** Circuit breaker thresholds */
const CIRCUIT = {
  FAIL_THRESHOLD: 5,
  HALF_OPEN_SUCCESSES: 3,
  BACKOFF_BASE_MS: 5_000,
  BACKOFF_CAP_MS: 120_000,
  MAX_BACKOFF_EXPONENT: 10,
} as const;

// PERMANENT FIX 2026-06-21: time-based decay so a single isolated
// network blip doesn't accumulate forever — after 60s of no failures,
// the streak resets.
const TRANSPORT_DECAY_MS = 60_000;

/** Sliding window rate limiter */
const RATE = {
  MAX_PER_WINDOW: 60,
  WINDOW_MS: 60_000,
} as const;

/** OTP delivery retry schedule (geometric backoff) */
const OTP_DELIVERY_DELAYS_MS: readonly number[] = [0, 500, 1000, 2000];
const OTP_DELIVERY_MESSAGE_TIMEOUT_MS = 5_000;

/** Email-Tab correlation scoring thresholds */
const CORRELATION = {
  /** Score at or above this → strong match, deliver immediately */
  STRONG: 80,
  /** Score in [MODERATE, STRONG) → acceptable match, deliver with logging */
  MODERATE: 50,
  /** Maximum age for contextual temporal proximity bonus */
  TEMPORAL_PROXIMITY_MS: 2 * 60 * 1000, // 2 minutes
  /** Minimum brand token length to avoid spurious matches (e.g. "io", "co") */
  MIN_BRAND_LENGTH: 3,
} as const;

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

// ═══════════════════════════════════════════════════════════════
//  §1  TYPES
// ═══════════════════════════════════════════════════════════════

interface TabRegistration {
  readonly url: string;
  readonly hostname: string;
  readonly fieldSelectors: readonly string[];
  readonly frameId?: number;
  readonly pageConfidence?: number;
  readonly verdict?: string;
  readonly registeredAt: number;
  readonly priority: number;
  deliveryAttempts: number;
}

interface ActivationCodeRegistration {
  readonly code: string;
  retryTimer: ReturnType<typeof setInterval> | null;
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
  /** First ~500 chars of the plain-text email body for content-based matching */
  readonly bodySnippet?: string;
}

interface CorrelationSignal {
  readonly name: string;
  readonly score: number;
}

type CorrelationTier = 'strong' | 'moderate' | 'none';

interface CorrelationResult {
  readonly score: number;
  readonly tier: CorrelationTier;
  readonly signals: CorrelationSignal[];
}

interface SessionState {
  pm_breaker?: CircuitBreakerState;
  pm_requestLog?: number[];
  pm_lastNotificationTime?: number;
}

// ═══════════════════════════════════════════════════════════════
//  §3  CIRCUIT BREAKER
// ═════════════════════════════════════════════════════════════��═

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
    if (this.state.state === 'closed') {
      return true;
    }

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

    // PERMANENT FIX 2026-06-21: a single success while OPEN is enough to
    // flip the breaker back to CLOSED. The old code required 3 in a row
    // (HALF_OPEN_SUCCESSES), which meant the user's first successful
    // fetch after a transport blip was logged as "half-open" and didn't
    // reset the visible "dead inbox" state in the UI.
    if (this.state.state !== 'closed') {
      this.state.state = 'closed';
      log.info('🟢 Circuit → closed (recovered)');
    }
  }

  recordFailure(error: unknown): void {
    this.state.consecutiveSuccesses = 0;
    this.state.lastFailureTime = Date.now();

    // PERMANENT FIX 2026-06-21: distinguish TRANSPORT errors (Failed to fetch,
    // network down, SW wake-up race) from AUTH errors (401/403/419 — token
    // expired). Transport errors used to latch the circuit after 5 failures
    // and leave the user with a permanently dead inbox even though mail.tm
    // itself was healthy. Now we:
    //  - count transport failures toward the breaker, BUT
    //  - decay the failure streak over time (1 failure older than 60s is
    //    forgiven) so a temporary network blip doesn't accumulate, AND
    //  - on auth errors, do NOT trip the breaker (those are re-auth issues,
    //    not transport health — mailTmService has its own auth circuit).
    const msg = error instanceof Error ? error.message : String(error);
    const isAuthError = /\b(401|403|419|token|jwt|unauthor|forbidden)\b/i.test(msg);
    const isTransportError =
      /\b(fetch|network|aborted|timeout|cors|load failed)\b/i.test(msg) ||
      msg.includes('Failed to fetch');

    if (isAuthError) {
      // Don't trip the breaker on auth problems — the per-service auth
      // circuit handles those, and tripping the engine circuit here would
      // hide the real signal from the UI.
      log.debug('Auth error — not tripping engine circuit', { msg });
      return;
    }

    // Decay: a failure older than the decay window is forgiven.
    const now = Date.now();
    if (
      this.state.lastFailureTime > 0 &&
      now - this.state.lastFailureTime > TRANSPORT_DECAY_MS &&
      this.state.consecutiveFailures > 0
    ) {
      // The last failure was a long time ago — reset the streak.
      this.state.consecutiveFailures = 0;
    }
    this.state.consecutiveFailures++;
    this.state.lastFailureTime = now;

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
        transport: isTransportError,
        error: msg,
      });
    } else if (isTransportError) {
      // Don't spam — log at debug for transport-only intermediate failures.
      log.debug('Transport failure (no trip yet)', {
        failures: this.state.consecutiveFailures,
        threshold: CIRCUIT.FAIL_THRESHOLD,
        error: msg,
      });
    }
  }

  /** Reset to closed state — used on email session change */
  reset(): void {
    this.state.state = 'closed';
    this.state.consecutiveFailures = 0;
    this.state.consecutiveSuccesses = 0;
    this.state.lastFailureTime = 0;
    this.state.nextRetryTime = 0;
    log.debug('🟢 Circuit breaker reset to closed');
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

// DedupCache class removed in favor of src/services/dedupService.ts (P2.2)

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

  private static calculateFastInterval(waitingTabs: ReadonlyMap<number, TabRegistration>): number {
    if (waitingTabs.size === 0) {
      return TIMING.FAST_CEILING_MS;
    }

    const now = Date.now();
    let oldestRegistration = now;
    for (const reg of waitingTabs.values()) {
      if (reg.registeredAt < oldestRegistration) {
        oldestRegistration = reg.registeredAt;
      }
    }

    const waited = now - oldestRegistration;

    if (waited < TIMING.FAST_AGGRESSIVE_UNTIL_MS) {
      return TIMING.FAST_AGGRESSIVE_MS;
    }
    if (waited < TIMING.FAST_NORMAL_UNTIL_MS) {
      return TIMING.FAST_NORMAL_MS;
    }
    if (waited < TIMING.FAST_RELAXED_UNTIL_MS) {
      return TIMING.FAST_RELAXED_MS;
    }
    return TIMING.FAST_CEILING_MS;
  }

  private static calculateGeneralInterval(
    waitingTabs: ReadonlyMap<number, TabRegistration>
  ): number {
    return waitingTabs.size > 0 ? TIMING.GENERAL_ACTIVE_MS : TIMING.GENERAL_DEFAULT_MS;
  }
}

// ═══════════════════════════════════════════════════════════════
//  §7  EMAIL-TAB CORRELATION ENGINE
//
//  Multi-signal scoring engine. Evaluates structural, content, and
//  contextual signals to determine how likely an incoming email
//  belongs to a given waiting tab. No hardcoded sender/provider
//  lists — works for ANY email service.
// ═══════════════════════════════════════════════════════════════

class DomainMatcher {
  private static readonly CLUSTERS: Readonly<Record<string, readonly string[]>> = {
    alibaba: ['alibaba.com', 'aliyun.com', 'alibaba-inc.com', 'tmall.com', 'taobao.com'],
    google: ['google.com', 'youtube.com', 'gmail.com', 'firebase.com'],
    microsoft: ['microsoft.com', 'live.com', 'outlook.com', 'hotmail.com', 'azure.com'],
  };

  /** Known OTP-page verdicts considered trustworthy */
  private static readonly TRUSTED_OTP_VERDICTS: ReadonlySet<string> = new Set([
    'otp-page',
    'possible-otp',
  ]);

  // ─── Scoring weights (cumulative, not normalized) ───────────

  private static readonly SCORE = {
    // Structural signals
    ROOT_DOMAIN:      100, // Definitive: sender domain matches tab domain
    CLUSTER:          100, // Definitive: both in same corporate ecosystem
    LINK_DOMAIN:       85, // Very strong: link in email points to tab's service
    PROVIDER_KEYWORD:  75, // Strong: detected provider name found in tab hostname

    // Content signals (no hardcoded lists needed — always evaluated)
    SUBJECT_BRAND:     55, // Email subject mentions tab's brand name
    BODY_BRAND:        45, // Email body text mentions tab's hostname/brand

    // Contextual signals (from tab registration state)
    SINGLE_WAITER:     15, // Only one non-activation tab is waiting (low ambiguity)
    STRONG_VERDICT:    12, // Tab's OTP page detector gave a trusted verdict
    TEMPORAL:          10, // Tab registered recently (< 2 min ago)
    HAS_SELECTORS:      5, // Tab has specific field selectors registered
  } as const;

  // ─── Public API ─────────────────────────────────────────────

  /**
   * Score how strongly an email correlates with a specific tab.
   * Returns a CorrelationResult with cumulative score, tier, and
   * a breakdown of which signals fired.
   *
   * @param email   Email-level context (from, subject, body, provider, link)
   * @param tab     Tab registration to score against
   */
  static correlate(email: EmailContext, tab: TabRegistration): CorrelationResult {
    const signals: CorrelationSignal[] = [];
    let score = 0;

    const senderDomain = (email.from.split('@')[1] ?? '').toLowerCase();
    if (!senderDomain) {
      return { score: 0, tier: 'none', signals };
    }

    const tabRoot = this.getRootDomain(tab.hostname);
    const senderRoot = this.getRootDomain(senderDomain);

    // ─── STRUCTURAL SIGNALS ───────────────────────────────────

    // 1. Root domain overlap
    if (
      tabRoot === senderRoot ||
      tab.hostname.includes(senderRoot) ||
      senderDomain.includes(tabRoot)
    ) {
      signals.push({ name: 'root-domain', score: this.SCORE.ROOT_DOMAIN });
      score += this.SCORE.ROOT_DOMAIN;
    }

    // 2. Cluster matching
    if (score < this.SCORE.CLUSTER) {
      for (const [canonical, domains] of Object.entries(this.CLUSTERS)) {
        const tabInCluster = domains.some((d) => tab.hostname.endsWith(d));
        const senderInCluster = domains.some((d) => senderDomain.endsWith(d));
        const providerMatch = email.provider?.toLowerCase().includes(canonical);

        if ((tabInCluster && senderInCluster) || (tabInCluster && providerMatch)) {
          signals.push({ name: `cluster-${canonical}`, score: this.SCORE.CLUSTER });
          score += this.SCORE.CLUSTER;
          break;
        }
      }
    }

    // 3. Provider keyword match
    if (email.provider && score < this.SCORE.CLUSTER) {
      const normalized = email.provider.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normalized && tab.hostname.includes(normalized)) {
        signals.push({ name: 'provider-keyword', score: this.SCORE.PROVIDER_KEYWORD });
        score += this.SCORE.PROVIDER_KEYWORD;
      }
    }

    // 4. Link domain match
    if (email.linkUrl) {
      try {
        const linkHostname = new URL(email.linkUrl).hostname.toLowerCase();
        const linkRoot = this.getRootDomain(linkHostname);
        if (tab.hostname.includes(linkRoot) || linkHostname.includes(tabRoot)) {
          signals.push({ name: 'link-domain', score: this.SCORE.LINK_DOMAIN });
          score += this.SCORE.LINK_DOMAIN;
        }
      } catch {
        /* invalid URL — skip */
      }
    }

    // ─── CONTENT SIGNALS ──────────────────────────────────────
    //
    // These are always evaluated regardless of who sent the email.
    // This is the key insight: we don't need to know if the sender
    // is a "third-party provider" — we just check if the email
    // CONTENT relates to the tab. Works for Cloudflare, SendGrid,
    // any custom ESP, or even a new service that didn't exist yet.

    const tabBrands = this.extractBrandTokens(tabRoot);

    // 5. Subject mentions tab brand
    if (email.subject && tabBrands.length > 0) {
      if (this.brandMatchesText(tabBrands, email.subject)) {
        signals.push({ name: 'subject-brand', score: this.SCORE.SUBJECT_BRAND });
        score += this.SCORE.SUBJECT_BRAND;
      }
    }

    // 6. Body mentions tab brand (only if subject didn't already match)
    if (
      email.bodySnippet &&
      tabBrands.length > 0 &&
      !signals.some((s) => s.name === 'subject-brand')
    ) {
      if (this.brandMatchesText(tabBrands, email.bodySnippet)) {
        signals.push({ name: 'body-brand', score: this.SCORE.BODY_BRAND });
        score += this.SCORE.BODY_BRAND;
      }
    }

    // ─── CONTEXTUAL SIGNALS ───────────────────────────────────

    // 7. Single waiting tab (low ambiguity)
    const nonActivationCount = Array.from(otpWaitingTabs.keys()).filter(
      (tabId) => !activationTabs.has(tabId)
    ).length;
    if (nonActivationCount === 1) {
      signals.push({ name: 'single-waiter', score: this.SCORE.SINGLE_WAITER });
      score += this.SCORE.SINGLE_WAITER;
    }

    // 8. Strong OTP page verdict
    if (tab.verdict && this.TRUSTED_OTP_VERDICTS.has(tab.verdict)) {
      signals.push({ name: 'strong-verdict', score: this.SCORE.STRONG_VERDICT });
      score += this.SCORE.STRONG_VERDICT;
    }

    // 9. Temporal proximity (tab registered recently)
    const ageMs = Date.now() - tab.registeredAt;
    if (ageMs <= CORRELATION.TEMPORAL_PROXIMITY_MS) {
      signals.push({ name: 'temporal', score: this.SCORE.TEMPORAL });
      score += this.SCORE.TEMPORAL;
    }

    // 10. Tab has field selectors (basic sanity)
    if (tab.fieldSelectors.length > 0) {
      signals.push({ name: 'has-selectors', score: this.SCORE.HAS_SELECTORS });
      score += this.SCORE.HAS_SELECTORS;
    }

    // ─── Classify tier ────────────────────────────────────────
    const tier: CorrelationTier =
      score >= CORRELATION.STRONG
        ? 'strong'
        : score >= CORRELATION.MODERATE
          ? 'moderate'
          : 'none';

    return { score: Math.min(100, score), tier, signals };
  }

  /**
   * Boolean convenience — returns true for strong or moderate matches.
   * Backward-compatible wrapper around `correlate()`.
   */
  static matches(
    senderEmail: string,
    tabUrl: string,
    providerName?: string,
    linkUrl?: string | null,
    emailSubject?: string
  ): boolean {
    if (!tabUrl || tabUrl.startsWith('chrome://') || tabUrl.startsWith('about:')) {
      return false;
    }

    try {
      let hostname: string;
      try {
        hostname = new URL(tabUrl).hostname.toLowerCase();
      } catch {
        return false;
      }

      // Build a minimal TabRegistration for scoring
      const pseudoTab: TabRegistration = {
        url: tabUrl,
        hostname,
        fieldSelectors: [],
        registeredAt: Date.now(),
        priority: 0,
        deliveryAttempts: 0,
      };

      const email: EmailContext = {
        from: senderEmail,
        subject: emailSubject ?? '',
        ...(providerName !== undefined ? { provider: providerName } : {}),
        linkUrl: linkUrl ?? null,
      };

      const result = this.correlate(email, pseudoTab);
      // Structural-only matches (domain/cluster) score ≥ 75,
      // so MODERATE threshold is appropriate for backward compat.
      return result.tier !== 'none';
    } catch {
      return false;
    }
  }

  // ─── Brand extraction & matching ────────────────────────────

  /**
   * Extract brand tokens from a root domain.
   *
   * Examples:
   *   "huggingface.co"  → ["huggingface"]
   *   "my-app.com"      → ["myapp", "my-app"]
   *   "login.example.org" → ["example"]
   *
   * Returns tokens long enough to be meaningful (>= MIN_BRAND_LENGTH).
   */
  private static extractBrandTokens(rootDomain: string): string[] {
    // Strip TLD portion: "huggingface.co" → "huggingface"
    const brand = rootDomain.split('.')[0];
    if (!brand || brand.length < CORRELATION.MIN_BRAND_LENGTH) {
      return [];
    }

    const tokens: string[] = [];

    // Original form (with hyphens)
    tokens.push(brand.toLowerCase());

    // Collapsed form (no hyphens/underscores) for matching "HuggingFace"
    // against hostname "hugging-face.com"
    const collapsed = brand.replace(/[-_]/g, '').toLowerCase();
    if (collapsed !== brand.toLowerCase() && collapsed.length >= CORRELATION.MIN_BRAND_LENGTH) {
      tokens.push(collapsed);
    }

    return tokens;
  }

  /**
   * Check if any brand token appears in the given text.
   * Handles common formatting variations:
   *  - Case-insensitive:           "HuggingFace" matches "huggingface"
   *  - Space/hyphen normalization: "Hugging Face" matches "huggingface"
   */
  private static brandMatchesText(brandTokens: string[], text: string): boolean {
    // Normalize: lowercase and collapse all separators (spaces, hyphens, etc.)
    const normalizedText = text.toLowerCase().replace(/[-_\s]+/g, '');

    for (const token of brandTokens) {
      // Match the collapsed token against collapsed text
      const collapsedToken = token.replace(/[-_]/g, '');
      if (normalizedText.includes(collapsedToken)) {
        return true;
      }
    }

    return false;
  }

  // ─── Domain utilities ───────────────────────────────────────

  private static getRootDomain(hostname: string): string {
    const parts = hostname.split('.');
    if (parts.length <= 2) {
      return hostname;
    }

    const secondLevel = parts[parts.length - 2]?.toLowerCase();

    // M6: Expanded ccTLD list — covers co.uk, com.au, co.jp, net.au, org.uk, etc.
    // Source: https://publicsuffix.org/list/public_suffix_list.dat (common patterns)
    const compoundSuffixes =
      /^(co|com|org|net|edu|gov|ac|ne|or|gen|ltd|plc|me|firm|info|mod|sch|police|nhs|id|my|on|in|biz|tv|web|name|pro|health|go|mil|asn|conf|oz|act|nsw|qld|sa|tas|vic|wa)$/;
    if (secondLevel && compoundSuffixes.test(secondLevel)) {
      return parts.slice(-3).join('.');
    }

    return parts.slice(-2).join('.');
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
    confidence: number,
    fieldSelectors: readonly string[] = [],
    frameId?: number
  ): Promise<boolean> {
    let isBackgroundTab = false;
    try {
      const tab = await chrome.tabs.get(tabId);
      isBackgroundTab = !tab.active;
    } catch (error) {
      log.debug('Failed to inspect tab state for OTP delivery', { tabId, error });
    }

    for (let attempt = 0; attempt < OTP_DELIVERY_DELAYS_MS.length; attempt++) {
      const delayMs = OTP_DELIVERY_DELAYS_MS[attempt]!;

      if (delayMs > 0) {
        await new Promise<void>((r) => {
          setTimeout(r, delayMs);
        });
        log.info(
          `🔄 Retry OTP delivery to tab ${tabId} (${attempt + 1}/${OTP_DELIVERY_DELAYS_MS.length})`
        );
      }

      try {
        const result = await safeSendTabMessage(
          tabId,
          {
            action: 'AUTO_FILL_OTP',
            payload: {
              otp: code,
              source: 'email',
              confidence,
              fieldSelectors: Array.from(fieldSelectors),
              isBackgroundTab,
            },
          },
          {
            timeout: OTP_DELIVERY_MESSAGE_TIMEOUT_MS,
            retries: 0,
            ...(frameId !== undefined ? { frameId } : {}),
          }
        );

        if (result?.success) {
          log.info('📲 OTP delivered', { tabId, attempt: attempt + 1 });
          return true;
        }
        log.debug('OTP delivery returned no success', {
          tabId,
          attempt: attempt + 1,
          isBackgroundTab,
          result,
        });
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
    // Specific labeled patterns (high confidence)
    /(?:use|enter|type|input)\s+(?:this\s+)?(?:code|otp|pin|passcode|verification\s+code)\s*(?:is|:|=)?\s*\b([A-Z0-9]{4,10})\b/i,
    /(?:code|pin|otp|password|token|passcode)\s*(?:is|:|=)\s*\b([A-Z0-9]{4,10})\b/i,
    /(?:confirmation|verification|security|login|access)\s+code\s*:?\s*\b([A-Z0-9]{4,10})\b/i,
    /your\s+(?:\w+\s+)?(?:code|pin|otp)\s*(?:is|:)\s*\b([A-Z0-9]{4,10})\b/i,
    /\b([A-Z0-9]{4,10})\s+is\s+your\s+(?:\w+\s+)?(?:code|pin|otp)/i,
    // Hyphenated or spaced codes (e.g., 123-456 or 123 456)
    /\b(\d{3}[\s-]\d{3})\b/,
    /\b(\d{4}[\s-]\d{4})\b/,
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
    if (emailText.length < 300) {
      // M7: Tightened regex to reduce false positives:
      // - Excludes years 2000-2099
      // - Excludes 9+ digit sequences (phone numbers, account IDs, ZIP+4)
      // - Requires exactly 6-8 digit sequences bounded by word boundaries
      const standaloneMatch = emailText.match(/\b(?!(?:20[0-9]{2})\b)(?!\d{9,})(\d{6,8})(?!\d)\b/);
      if (standaloneMatch?.[1]) {
        log.info('🚨 OTP from short email');
        return standaloneMatch[1];
      }
    }

    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  §10  MAIN POLLING ENGINE
// ═══════════════════════════���═══════════════════════════════════

// ── Module state ──
const otpWaitingTabs = new Map<number, TabRegistration>();
const circuitBreaker = new CircuitBreaker();
const rateLimiter = new SlidingRateLimiter();
const dedupCache = dedupService;
const activationTabs = new Set<number>(); // Tabs opened for link activation - exclude from OTP delivery
const activationCodesByTab = new Map<number, ActivationCodeRegistration>();

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
let priorityCounter = 0;
let checkInProgress = false;
let pendingCheckMode: CheckMode | null = null;
let pendingCheckTimer: ReturnType<typeof setTimeout> | null = null;
let emailTypeTransitionPromise: Promise<void> | null = null;
let pendingEmailTypeTransition: 'disposable' | 'gmail' | null = null;
const suppressedEmailTypeTransitions = new Map<'disposable' | 'gmail', number>();

// ── Alarm handler (must be stable reference for removeListener) ──
export const onPollingAlarm = (alarm: chrome.alarms.Alarm): void => {
  switch (alarm.name) {
    case ALARM_NAMES.EMAIL_SYNC:
      if (pollingActive) {
        log.debug('⏰ Alarm sync triggered');
        void performCheck('general').then(() => {
          // Restart aggressive polling loop in case SW was completely suspended
          if (generalTimer) {
            clearTimeout(generalTimer);
          }
          void scheduleGeneralPoll();
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

// ── Runtime message handler for link activation (Moved to messageHandler.ts) ──
// onPollingRuntimeMessage removed to prevent multiple listener conflicts

// ── Health sweep ──
function runHealthSweep(): void {
  const now = Date.now();

  for (const [tabId, reg] of otpWaitingTabs) {
    if (now - reg.registeredAt > TIMING.STALE_TAB_MS) {
      log.info('🧹 Expired stale OTP tab', { tabId, hostname: reg.hostname });
      stopFastOTPPolling(tabId);
      continue;
    }

    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          log.info('🧹 Removing non-existent tab from OTP registry', { tabId });
          stopFastOTPPolling(tabId);
        }
      });
    }
  }

  // Heartbeat watchdog
  if (pollingActive && now - lastGlobalCheckTime > 2 * 60 * 1000) {
    log.warn('💔 Heartbeat: Polling is active but no checks run in 2m. Restarting alarms.');
    void performCheck('general').then(() => {
      if (generalTimer) clearTimeout(generalTimer);
      void scheduleGeneralPoll();
    });
  }

  void dedupCache.prune();
  rateLimiter.windowSize; // Rate limiter self-prunes on access
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
    if (gap < TIMING.FAST_FLOOR_MS) {
      return false;
    }
  }
  return true;
}

function queuePendingCheck(mode: CheckMode): void {
  pendingCheckMode = pendingCheckMode === 'fast' || mode === 'fast' ? 'fast' : mode;
}

function flushPendingCheck(): void {
  if (!pendingCheckMode || pendingCheckTimer) {
    return;
  }

  const mode = pendingCheckMode;
  pendingCheckMode = null;
  const delay =
    mode === 'fast' ? Math.max(0, TIMING.FAST_FLOOR_MS - (Date.now() - lastGlobalCheckTime)) : 0;

  pendingCheckTimer = setTimeout(() => {
    pendingCheckTimer = null;
    void performCheck(mode).catch((error) => log.warn('Pending poll error', error));
  }, delay);
}

// ── Session state persistence ──
function persistSessionState(): void {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) {
    return;
  }

  chrome.storage.session
    .set({
      pm_breaker: circuitBreaker.getState(),
      // Array.from converts readonly number[] → mutable number[] to satisfy SessionState
      pm_requestLog: Array.from(rateLimiter.getTimestamps()),
      pm_lastNotificationTime: 0, // Placeholder
    } satisfies SessionState)
    .catch((e) => log.debug('Session state sync failed', e));
}

// ═══════════════════════════════════════════════════════════════
//  §11  CORE: UNIFIED INBOX CHECK
// ═══════════════════════════════════════════════════════════════

async function performCheck(mode: CheckMode): Promise<void> {
  const flowId = diag.startFlow('polling', 'inbox-check', `mode=${mode}`);
  // Coalescing: if already running, skip
  if (checkInProgress) {
    queuePendingCheck(mode);
    log.debug('Check in progress, skipping', { mode });
    diag.step(flowId, 'polling', 'skip', 'Check already in progress');
    diag.endFlow(flowId, 'polling', 'inbox-check', true, 'Queued because check is already running');
    return;
  }

  if (!checkPermitted(mode)) {
    diag.step(flowId, 'polling', 'gate-blocked', 'Circuit breaker or rate limiter blocked check');
    diag.endFlow(flowId, 'polling', 'inbox-check', true, 'Blocked by gate');
    return;
  }

  checkInProgress = true;
  const t0 = Date.now();
  metrics.totalChecks++;
  rateLimiter.stamp();
  let checkSucceeded = false;
  let finalDetail = 'Inbox check complete';

  try {
    const currentEmail = await emailService.getCurrentEmail();
    if (!currentEmail) {
      log.debug('No current email configured');
      diag.step(flowId, 'polling', 'no-current-email', 'No active email account');
      checkSucceeded = true;
      finalDetail = 'No active email account';
      return;
    }
    diag.step(flowId, 'polling', 'current-email', 'Resolved active email', {
      service: currentEmail.service,
      fullEmail: currentEmail.fullEmail,
    });

    const cachedInbox = await emailService.getCachedInbox();
    const freshInbox = await emailService.checkInbox(currentEmail);
    diag.step(flowId, 'polling', 'inbox-fetched', 'Inbox fetched', {
      cachedCount: cachedInbox.length,
      freshCount: freshInbox.length,
    });

    const cachedIds = new Set(cachedInbox.map((e) => e.id));
    const cutoff = Date.now() - TIMING.MAX_EMAIL_AGE_MS;

    const newEmails: Email[] = [];
    for (const e of freshInbox) {
      if (cachedIds.has(e.id)) {
        continue;
      }
      if (await dedupCache.isProcessed(String(e.id), currentEmail.fullEmail)) {
        continue;
      }
      if ((e.date ?? 0) < cutoff) {
        log.debug('Skipping old email', { id: e.id });
        continue;
      }
      newEmails.push(e);
    }

    if (newEmails.length > 0) {
      log.info(`📬 ${newEmails.length} new email(s)`, { mode });
      diag.step(flowId, 'polling', 'new-emails', 'New emails detected', {
        count: newEmails.length,
      });

      // Broadcast to UI that we are actively analyzing a new email
      for (const tabId of otpWaitingTabs.keys()) {
        chrome.tabs
          .sendMessage(tabId, {
            action: 'POLLING_STATE_CHANGE',
            payload: { state: 'ANALYZING_EMAIL' },
          })
          .catch(() => {});
      }

      const batches = chunk(newEmails, 3);
      for (const batch of batches) {
        await Promise.allSettled(
          batch.map((email) => processEmail(String(email.id), currentEmail))
        );
      }
    }

    circuitBreaker.recordSuccess();
    metrics.successfulChecks++;
    metrics.lastSuccessTime = Date.now();
    checkSucceeded = true;
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
    diag.step(flowId, 'polling', 'error', 'Inbox check failed', {
      error: metrics.lastErrorMessage,
      mode,
    });
    finalDetail = 'Inbox check failed';
  } finally {
    checkInProgress = false;

    const elapsed = Date.now() - t0;
    metrics.avgCheckMs =
      metrics.avgCheckMs === 0
        ? elapsed
        : metrics.avgCheckMs * (1 - EMA_ALPHA) + elapsed * EMA_ALPHA;

    lastGlobalCheckTime = Date.now();
    persistSessionState();
    diag.endFlow(flowId, 'polling', 'inbox-check', checkSucceeded, finalDetail, {
      mode,
      totalChecks: metrics.totalChecks,
      emailsProcessed: metrics.emailsProcessed,
      otpsFound: metrics.otpsFound,
      linksProcessed: metrics.linksProcessed,
    });
    flushPendingCheck();
  }
}

// ═══════════════════════════════════════════════════════════════
//  §12  CORE: EMAIL PROCESSING PIPELINE
// ═══════════════════════════════════════════════════════════════

async function processEmail(emailId: string, currentEmail: EmailAccount): Promise<void> {
  const flowId = diag.startFlow('email', 'process-email', emailId);
  try {
    if (await dedupCache.isProcessed(emailId, currentEmail.fullEmail)) {
      diag.endFlow(flowId, 'email', 'process-email', true, 'Already processed');
      return;
    }

    const extractionResult = await extractEmailOnce(emailId, async () => {
      const fullEmail = await emailService.readEmail(emailId, currentEmail);
      metrics.emailsProcessed++;
      const expectedDomains = collectExpectedDomains();
      const detection = await smartDetectionService.detect(
        fullEmail.subject,
        fullEmail.body,
        fullEmail.htmlBody,
        fullEmail.from,
        expectedDomains.length > 0 ? expectedDomains : undefined
      );
      const code = OTPCodeExtractor.extract(detection, fullEmail);
      return {
        code,
        link: detection.link ?? null,
        fullEmail,
        detection,
      };
    });

    const fullEmail = extractionResult.fullEmail as Email;
    const detection = extractionResult.detection as DetectionResult;
    const extractedOTPCode = extractionResult.code as string | null;

    diag.step(flowId, 'email', 'read', 'Email content loaded (cached or fetched)', {
      from: fullEmail.from,
      subject: fullEmail.subject,
    });

    diag.step(flowId, 'email', 'detect', 'Detection completed', {
      type: detection.type,
      hasCode: Boolean(extractedOTPCode),
      hasLink: Boolean(detection.link),
      decision: detection.decision?.action,
      risk: detection.decision?.risk,
      canAutoAct: detection.decision?.canAutoAct,
    });

    log.info('📊 Detection', {
      type: detection.type,
      hasCode: Boolean(detection.code),
      hasLink: Boolean(detection.link),
      decision: detection.decision?.action,
      risk: detection.decision?.risk,
      waitingTabs: otpWaitingTabs.size,
    });

    let otpDelivered = false;

    // ── PRIORITY 1: Inline OTP delivery to waiting tabs ──
    if (otpWaitingTabs.size > 0) {
      const emailCtx: EmailContext = {
        from: fullEmail.from,
        subject: fullEmail.subject,
        ...(detection.provider !== undefined ? { provider: detection.provider } : {}),
        ...(detection.link !== undefined ? { linkUrl: detection.link } : {}),
        bodySnippet: (fullEmail.body || '').substring(0, 500),
      };
      const bestTab = findBestTab(emailCtx);

      if (bestTab !== null) {
        log.info('🎯 Matching tab found — inline OTP delivery');

        if (extractedOTPCode) {
          otpDelivered = await deliverOTP(extractedOTPCode, detection.confidence ?? 0.9, emailCtx);

          if (otpDelivered) {
            await dedupCache.markProcessed(emailId, currentEmail.fullEmail, true, false);
            // Wait to notify at the end
          }
        } else {
          log.warn('⚠️ Matching tab but no OTP extractable — falling through');
        }
      }
    }

    // ── PRIORITY 2: Standard processing ──
    const hasOTP = Boolean(extractedOTPCode);
    const hasLink =
      (detection.type === 'link' || detection.type === 'both') && Boolean(detection.link);
    const linkDecision = detection.decision;
    const shouldDelegateLink =
      hasLink &&
      Boolean(detection.link) &&
      (!linkDecision ||
        (linkDecision.canAutoAct &&
          (linkDecision.action === 'open-link' ||
            linkDecision.action === 'fill-otp-and-open-link')));

    // Mark OTP-only emails as processed immediately
    if (hasOTP && !hasLink && !otpDelivered) {
      await dedupCache.markProcessed(emailId, currentEmail.fullEmail, hasOTP, false);
    }

    // For "both" emails, deliver OTP FIRST if not already done
    if (hasOTP && extractedOTPCode && !otpDelivered) {
      log.info('🔢 OTP detected — delivering to waiting tabs');
      otpDelivered = await deliverOTP(extractedOTPCode, detection.confidence ?? 0.9, {
        from: fullEmail.from,
        subject: fullEmail.subject,
        ...(detection.provider !== undefined ? { provider: detection.provider } : {}),
        ...(detection.link !== undefined ? { linkUrl: detection.link } : {}),
        bodySnippet: (fullEmail.body || '').substring(0, 500),
      });
    }

    // Handle Link Activation
    // NOTE: Links should be activated even when OTP was already delivered.
    // For "both" type emails (OTP + link), we want BOTH actions to fire.
    if (shouldDelegateLink && detection.link) {
      log.info('🔗 Link detected, deferring to linkService');
      metrics.linksProcessed++;

      // Broadcast to UI
      for (const tabId of otpWaitingTabs.keys()) {
        chrome.tabs
          .sendMessage(tabId, {
            action: 'POLLING_STATE_CHANGE',
            payload: { state: 'LINK_ACTIVATION_STARTED' },
          })
          .catch(() => {});
      }

      await linkService
        .handleDetectedLink(fullEmail, detection.link, currentEmail.fullEmail)
        .catch((e) => log.warn('linkService error', e));
      diag.step(flowId, 'email', 'link', 'Link handling delegated', {
        link: detection.link,
      });
    } else if (hasLink && detection.link) {
      log.info('Link detected but held by decision engine', {
        link: detection.link,
        action: linkDecision?.action,
        risk: linkDecision?.risk,
        warnings: linkDecision?.warnings,
      });
      await dedupCache.markProcessed(emailId, currentEmail.fullEmail, hasOTP, true);
      diag.step(flowId, 'email', 'link', 'Link held for review', {
        link: detection.link,
        action: linkDecision?.action,
        risk: linkDecision?.risk,
      });
    }

    // ── FINAL STEP: SINGLE NOTIFICATION ──
    // Consolidate findings and notify exactly once
    if (hasOTP || hasLink) {
      void notifyNewEmail(
        fullEmail.from,
        fullEmail.subject,
        extractedOTPCode || undefined,
        hasLink ? detection.link : undefined
      );
    } else {
      log.info('Ignoring email: no OTP or activation link found', { emailId });
      await dedupCache.markProcessed(emailId, currentEmail.fullEmail, false, false);
    }
    diag.endFlow(flowId, 'email', 'process-email', true, 'Email decision complete', {
      hasOTP: Boolean(extractedOTPCode),
      hasLink,
      otpDelivered,
    });
  } catch (error) {
    diag.endFlow(flowId, 'email', 'process-email', false, 'Email processing failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// ── Find the highest-scoring waiting tab above the MODERATE threshold ──
function findBestTab(email: EmailContext): { tabId: number; result: CorrelationResult } | null {
  let bestTabId: number | null = null;
  let bestResult: CorrelationResult = { score: 0, tier: 'none', signals: [] };

  for (const [tabId, reg] of otpWaitingTabs.entries()) {
    if (activationTabs.has(tabId)) {
      continue;
    }

    const result = DomainMatcher.correlate(email, reg);
    if (result.score > bestResult.score) {
      bestResult = result;
      bestTabId = tabId;
    }
  }

  if (bestTabId === null || bestResult.tier === 'none') {
    return null;
  }

  return { tabId: bestTabId, result: bestResult };
}

async function deliverToRegisteredTab(
  tabId: number,
  reg: TabRegistration,
  code: string,
  confidence: number
): Promise<number | null> {
  const ok = await OTPDeliveryEngine.deliverToTab(
    tabId,
    code,
    confidence,
    reg.fieldSelectors,
    reg.frameId
  );
  if (ok) {
    reg.deliveryAttempts++;
    metrics.otpsDelivered++;
    return tabId;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
//  §13  OTP DELIVERY ORCHESTRATOR
//
//  Uses the multi-signal scoring engine to rank tabs by correlation
//  score and delivers OTP to all tabs above the MODERATE threshold.
//  No separate "fallback" path — scoring is the single decision.
// ═══════════════════════════════════════════════════════════════

/**
 * Deliver OTP code to matching waiting tabs using multi-signal scoring.
 *
 * Scores every non-activation waiting tab against the email context,
 * then delivers concurrently to all tabs above the MODERATE threshold
 * (score ≥ 50). Tabs are prioritized by score descending.
 *
 * @returns true if OTP was successfully delivered to at least one tab
 */
async function deliverOTP(code: string, confidence: number, email: EmailContext): Promise<boolean> {
  await otpService.saveLastOTP(code, 'email', email.from, email.subject, confidence);
  await updateOTPMenuItem();

  const masked =
    code.length > 2 ? code.substring(0, 2) + '•'.repeat(code.length - 2) : '•'.repeat(code.length);

  log.info('🎯 OTP detected', {
    code: masked,
    confidence: `${Math.round(confidence * 100)}%`,
    from: email.from,
    waitingTabs: otpWaitingTabs.size,
    activationTabs: activationTabs.size,
  });

  // Score every non-activation tab using the correlation engine
  const scored: Array<{ tabId: number; reg: TabRegistration; result: CorrelationResult }> = [];

  for (const [tabId, reg] of otpWaitingTabs.entries()) {
    if (activationTabs.has(tabId)) {
      log.debug('Skipping activation tab during generic OTP delivery', { tabId });
      continue;
    }

    const result = DomainMatcher.correlate(email, reg);

    log.info(`📊 Tab ${reg.hostname} correlation: ${result.score}pts (${result.tier})`, {
      tabId,
      signals: result.signals.map((s) => `${s.name}:${s.score}`).join(', '),
    });

    if (result.tier !== 'none') {
      scored.push({ tabId, reg, result });
    }
  }

  // Sort by score descending — highest confidence tab first
  scored.sort((a, b) => b.result.score - a.result.score);

  if (scored.length === 0) {
    log.info('OTP saved, but no tab scored above delivery threshold', {
      waitingTabs: otpWaitingTabs.size,
      activationTabs: activationTabs.size,
      from: email.from,
    });
    return false;
  }

  // Log the winning tab(s)
  const best = scored[0]!;
  if (best.result.tier === 'moderate') {
    log.info('⚠️ Delivering OTP via moderate-confidence content match', {
      tabId: best.tabId,
      hostname: best.reg.hostname,
      score: best.result.score,
      signals: best.result.signals.map((s) => s.name),
    });
  }

  // Deliver concurrently to all tabs above threshold
  const deliveryPromises = scored.map(async ({ tabId, reg, result }) => {
    const deliveredTabId = await deliverToRegisteredTab(tabId, reg, code, confidence);
    if (deliveredTabId === null) {
      log.debug('OTP delivery attempt failed', {
        tabId,
        hostname: reg.hostname,
        score: result.score,
        tier: result.tier,
      });
    }
    return deliveredTabId;
  });

  const results = await Promise.all(deliveryPromises);
  const delivered = results.filter((id): id is number => id !== null);

  if (delivered.length > 0) {
    metrics.otpsFound++;
    await otpService.markAsUsed();
  }

  // Unregister delivered tabs
  for (const tabId of delivered) {
    stopFastOTPPolling(tabId);
  }

  return delivered.length > 0;
}

// ═══════════════════════════════════════════════════════════════
//  §14  PUBLIC API
// ═══════════════════════════════════════════════════════════════

function shouldSuppressEmailTypeTransition(newType: 'disposable' | 'gmail'): boolean {
  const expiresAt = suppressedEmailTypeTransitions.get(newType);
  if (!expiresAt) {
    return false;
  }

  suppressedEmailTypeTransitions.delete(newType);
  return Date.now() <= expiresAt;
}

function enqueueEmailTypeTransition(newType: 'disposable' | 'gmail'): void {
  if (shouldSuppressEmailTypeTransition(newType)) {
    log.debug('Skipping self-managed email type transition', { newType });
    return;
  }

  if (emailTypeTransitionPromise) {
    pendingEmailTypeTransition = newType;
    log.debug('Queued email type transition behind active transition', { newType });
    return;
  }

  emailTypeTransitionPromise = (async () => {
    let nextType: 'disposable' | 'gmail' | null = newType;
    while (nextType) {
      const currentType = nextType;
      pendingEmailTypeTransition = null;
      await handleEmailTypeTransition(currentType);
      nextType = pendingEmailTypeTransition;
    }
  })().finally(() => {
    emailTypeTransitionPromise = null;
  });

  emailTypeTransitionPromise.catch((error) =>
    log.warn('Email type transition failed', { newType, error })
  );
}

export function suppressNextEmailTypeTransition(
  newType: 'disposable' | 'gmail',
  ttlMs = 5000
): void {
  suppressedEmailTypeTransitions.set(newType, Date.now() + ttlMs);
}

async function handleEmailTypeTransition(newType: 'disposable' | 'gmail'): Promise<void> {
  log.info(`🔄 Handling email type transition to: ${newType}`);

  // 1. Clear stale OTP so old codes can't fire on the new email session
  await otpService.clearLastOTP();

  // 2. Clear processed-email dedup cache so new inbox is scanned fresh
  //    Also clears otpWaitingTabs + circuit breaker
  resetEmailSession();

  // 3. Clear linkService activation history/queue so old links don't replay
  linkService.clearHistory();

  // 4. Clear inbox in storage so popup shows empty state immediately
  await storageService.set('inbox', []);
  await storageService.set('gmailInbox', []);
  await storageService.set('gmailSyncState', {});

  // 5. Update currentEmail in storage to align with the new preference
  const nextEmail = await emailService.getCurrentEmail();
  if (nextEmail) {
    await storageService.set('currentEmail', nextEmail);
    log.info(`Sync currentEmail in storage to: ${nextEmail.fullEmail}`);
  } else {
    await storageService.remove('currentEmail');
    log.info('Removed currentEmail from storage as no account was found');
  }

  // 6. Broadcast RESET_STATE to all content scripts so FAB badges clear
  if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { action: 'RESET_STATE' }).catch(() => {
            // Ignore
          });
        }
      }
    });
  }

  // 7. Trigger event-driven polling immediately
  triggerEventDrivenPolling('type_change');
}

export function setupPollingManager(): void {
  if (initialized) {
    log.warn('Already initialized');
    return;
  }
  initialized = true;
  metrics.startedAt = Date.now();

  // Initialize unified dedup service
  void dedupService.initialize().catch((e) => log.warn('Failed to initialize dedup service', e));

  // Restore session state
  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    chrome.storage.session
      .get(['pm_breaker', 'pm_requestLog', 'pm_lastNotificationTime'])
      .then((data: SessionState) => {
        if (data.pm_breaker) {
          circuitBreaker.restoreState(data.pm_breaker);
        }
        if (data.pm_requestLog) {
          rateLimiter.restoreState(data.pm_requestLog);
        }
      })
      .catch((e) => log.warn('Failed to restore session state', e));
  }

  // Listen for changes in preferredEmailType to reset session and restart polling
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.preferredEmailType) {
        const newValue = changes.preferredEmailType.newValue;
        const oldValue = changes.preferredEmailType.oldValue;
        if (newValue === 'disposable' || newValue === 'gmail') {
          if (oldValue === newValue) {
            return;
          }
          log.info(`🔄 preferredEmailType changed to: ${newValue} — performing transition`);
          enqueueEmailTypeTransition(newValue);
        }
      }
    });
  }

  // Chrome alarms for MV3 background
  Promise.resolve(chrome.alarms.create(ALARM_NAMES.EMAIL_SYNC, { periodInMinutes: 1 })).catch((e) =>
    log.debug('Alarm creation failed', e)
  );
  Promise.resolve(
    chrome.alarms.create(ALARM_NAMES.HEALTH_SWEEP, {
      periodInMinutes: getAlarmPeriodMinutes(TIMING.HEALTH_TICK_MS),
    })
  ).catch((e) => log.debug('Alarm creation failed', e));
  Promise.resolve(
    chrome.alarms.create(ALARM_NAMES.METRICS_REPORT, {
      periodInMinutes: getAlarmPeriodMinutes(TIMING.METRICS_TICK_MS),
    })
  ).catch((e) => log.debug('Alarm creation failed', e));

  // Auto-start if email exists
  emailService
    .getCurrentEmail()
    .then((email) => {
      if (email) {
        log.info('Found existing email, starting polling');
        startEmailPolling();
      }
    })
    .catch(() => {
      /* no email configured */
    });

  runHealthSweep();
  logMetricsSnapshot();
  log.info('🚀 Polling engine initialized');
}

export function startEmailPolling(): void {
  if (pollingActive) {
    return;
  }
  pollingActive = true;
  log.info('📧 General polling STARTED');
  void scheduleGeneralPoll();
}

export function stopEmailPolling(): void {
  if (!pollingActive) {
    return;
  }
  pollingActive = false;

  if (generalTimer !== undefined && generalTimer !== null) {
    clearTimeout(generalTimer);
    generalTimer = null;
  }

  log.info('📧 General polling STOPPED');
}

async function scheduleGeneralPoll(): Promise<void> {
  if (!pollingActive) {
    return;
  }

  if (generalTimer !== undefined && generalTimer !== null) {
    clearTimeout(generalTimer);
  }

  let interval = AdaptiveScheduler.calculateInterval('general', otpWaitingTabs);

  try {
    const settings = await storageService.getSettings();
    if (!settings.autoCheckInbox) {
      log.info('📧 General polling disabled by autoCheckInbox setting');
      pollingActive = false;
      return;
    }
    if (otpWaitingTabs.size === 0) {
      interval = settings.checkIntervalSeconds * 1000;
    }
  } catch (e) {
    // Fall back to AdaptiveScheduler if settings fail
    log.warn('Failed to fetch user settings for polling interval', e);
  }

  generalTimer = setTimeout(() => {
    if (!pollingActive) {
      return;
    }
    void performCheck('general')
      .then(() => scheduleGeneralPoll())
      .catch((error) => {
        log.warn('General poll failed', error);
        void scheduleGeneralPoll();
      });
  }, interval);
}

export function startFastOTPPolling(
  tabId: number,
  url: string,
  fieldSelectors: string[],
  frameId?: number,
  pageConfidence?: number,
  verdict?: string
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
    ...(frameId !== undefined ? { frameId } : {}),
    ...(pageConfidence !== undefined ? { pageConfidence } : {}),
    ...(verdict !== undefined ? { verdict } : {}),
    registeredAt: Date.now(),
    priority: priorityCounter++,
    deliveryAttempts: 0,
  });

  log.info('⚡ Fast OTP registered', {
    tabId,
    hostname,
    fieldCount: fieldSelectors.length,
    confidence: pageConfidence,
    verdict,
    totalWaiting: otpWaitingTabs.size,
  });

  // Immediate first check
  if (checkPermitted('fast')) {
    performCheck('fast').catch((e) => log.warn('Initial fast check error', e));
  }

  if (!pollingActive) {
    startEmailPolling();
  }
}

export function stopFastOTPPolling(tabId: number): void {
  if (!otpWaitingTabs.delete(tabId)) {
    return;
  }
  log.info('🛑 Fast OTP unregistered', { tabId, remaining: otpWaitingTabs.size });
}

/**
 * Register a tab as an activation tab (opened by linkService for verification links).
 * Activation tabs are excluded from OTP delivery to prevent wrong fills.
 */
function clearActivationRetry(tabId: number): void {
  const registration = activationCodesByTab.get(tabId);
  if (registration?.retryTimer) {
    clearInterval(registration.retryTimer);
    registration.retryTimer = null;
  }
}

function clearAllActivationRegistrations(): void {
  for (const tabId of activationCodesByTab.keys()) {
    clearActivationRetry(tabId);
  }
  activationCodesByTab.clear();
  activationTabs.clear();
}

export function registerActivationTab(tabId: number, code?: string): void {
  activationTabs.add(tabId);
  clearActivationRetry(tabId);
  log.info('🔗 Activation tab registered', {
    tabId,
    code: code ? 'provided' : 'none',
    totalActivationTabs: activationTabs.size,
  });
  if (code) {
    const registration: ActivationCodeRegistration = {
      code,
      retryTimer: null,
    };
    activationCodesByTab.set(tabId, registration);

    // First immediate attempt
    void safeSendTabMessage(tabId, {
      action: 'FILL_OTP',
      payload: { otp: code },
    });

    // Short retry burst for SPAs where input appears after React hydration.
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      const current = activationCodesByTab.get(tabId);
      if (!current) {
        clearInterval(timer);
        return;
      }
      const res = await safeSendTabMessage(tabId, {
        action: 'FILL_OTP',
        payload: { otp: current.code },
      });
      if (res?.success || attempts >= 20) {
        clearInterval(timer);
        current.retryTimer = null;
        if (res?.success) {
          activationCodesByTab.delete(tabId);
        }
      }
    }, 500);
    registration.retryTimer = timer;
  }
}

/**
 * Unregister an activation tab. Call when the activation tab is closed.
 */
export function unregisterActivationTab(tabId: number): void {
  const wasActivationTab = activationTabs.delete(tabId);
  const hadActivationCode = activationCodesByTab.has(tabId);
  clearActivationRetry(tabId);
  activationCodesByTab.delete(tabId);

  if (wasActivationTab || hadActivationCode) {
    log.info('🔗 Activation tab unregistered', {
      tabId,
      remainingActivationTabs: activationTabs.size,
    });
  }
}

/**
 * Check if a tab is an activation tab.
 */
export function isActivationTab(tabId: number): boolean {
  return activationTabs.has(tabId);
}

/**
 * Triggered when content script signals it is ready (via PING or OTP detection).
 * Immediately attempts to fill the activation code if the tab is an activation tab.
 */
export function onContentScriptReady(tabId: number): void {
  const registration = activationCodesByTab.get(tabId);
  if (!registration) {
    return;
  }
  log.info('🚀 Content script ready in activation tab — immediately sending FILL_OTP', { tabId });
  void safeSendTabMessage(tabId, {
    action: 'FILL_OTP',
    payload: { otp: registration.code },
  });
}

/**
 * Public wrapper to trigger fast Gmail polling.
 */
export function startGmailAliasFastPolling(
  reason: TriggerReason,
  options?: { intervalMs?: number; durationMs?: number }
): void {
  startGmailFastWatch(triggerEventDrivenPolling, reason, options);
}

// ───────────────────────────────────────────────────────────────────
// H6: Cleanup activationTabs on tab close
// ───────────────────────────────────────────────────────────────────
if (typeof chrome !== 'undefined' && chrome.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (activationTabs.has(tabId) || activationCodesByTab.has(tabId)) {
      unregisterActivationTab(tabId);
      log.debug('Cleaned up closed activation tab', { tabId, remaining: activationTabs.size });
    }
  });
}

export function getOTPWaitingTabs(): ReadonlyMap<number, TabRegistration> {
  return otpWaitingTabs;
}

export function getPollingMetrics(): Readonly<
  PollingMetrics & {
    uptimeMs: number;
    waitingTabs: number;
    circuitState: CircuitState;
    currentInterval: number;
    processedCached: number;
  }
> {
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
  void chrome.alarms
    .clear(ALARM_NAMES.HEALTH_SWEEP)
    .catch((e) => log.debug('Alarm clear failed', e));
  void chrome.alarms
    .clear(ALARM_NAMES.METRICS_REPORT)
    .catch((e) => log.debug('Alarm clear failed', e));

  if (pendingCheckTimer) {
    clearTimeout(pendingCheckTimer);
    pendingCheckTimer = null;
  }

  otpWaitingTabs.clear();
  clearAllActivationRegistrations();
  dedupCache.clear();
  rateLimiter.reset();
  initialized = false;
  priorityCounter = 0;
  checkInProgress = false;
  pendingCheckMode = null;

  log.info('💣 Polling engine destroyed');
}

/**
 * Full session reset triggered by email change.
 * Clears processed-email dedup cache so new emails on the fresh address
 * are processed immediately. Does NOT stop polling or unregister tabs.
 */
export function resetEmailSession(): void {
  // 1. Clear processed-email dedup so new inbox is scanned fresh
  dedupCache.clear();

  // 2. Clear tab OTP-wait registrations — tabs registered for the old email
  //    must not receive OTPs from the new email's inbox.
  otpWaitingTabs.clear();
  clearAllActivationRegistrations();

  // 3. Reset circuit breaker so any previous failure streak doesn't block
  //    new-session polling from starting cleanly.
  circuitBreaker.reset();

  log.info(
    '🔄 Email session reset — dedup cache, OTP waiting tabs, activation tabs, and circuit breaker cleared'
  );
}

// ═══════════════════════════════════════════════════════════════
//  §15  UTILITIES
// ═══════════════════════════════════════════════════════════════

function collectExpectedDomains(): string[] {
  const seen = new Set<string>();
  for (const reg of otpWaitingTabs.values()) {
    if (reg.hostname) {
      seen.add(reg.hostname);
    }
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

export function triggerEventDrivenPolling(reason: string): void {
  log.info(`⚡ Triggering event-driven poll: ${reason}`);
  if (checkPermitted('fast')) {
    performCheck('fast').catch((e) => log.warn('Event-driven poll error', e));
  } else {
    // maybe try general or just force it
    performCheck('general').catch((e) => log.warn('Event-driven poll error', e));
  }
}

export function recordEmailReceived(): void {
  log.info('🔔 SSE received email event — forcing immediate inbox check');
  performCheck('fast').catch((e) => log.warn('SSE-driven poll error', e));
}

// ═══════════════════════════════════════════════════════════════
//  GMAIL FAST WATCH (Consolidated from gmailFastWatch.ts)
// ═══════════════════════════════════════════════════════════════

export type TriggerReason =
  | 'gmail_alias_resolved'
  | 'gmail_alias_generated'
  | 'registration_form_submitted'
  | 'otp_page_detected';

const GMAIL_FAST_WATCH_INTERVAL_MS = 2_000;
const GMAIL_FAST_WATCH_DURATION_MS = 60_000;

let gmailFastWatchTimer: ReturnType<typeof setInterval> | null = null;
let gmailFastWatchStopTimer: ReturnType<typeof setTimeout> | null = null;
let gmailFastWatchUntil = 0;
let gmailFastWatchRunning = false;

/**
 * Starts fast-watch polling for Gmail events.
 */
export function startGmailFastWatch(
  triggerEventDrivenPolling: (reason: string) => void,
  reason: TriggerReason,
  options?: { intervalMs?: number; durationMs?: number }
): void {
  const intervalMs = options?.intervalMs ?? GMAIL_FAST_WATCH_INTERVAL_MS;
  const durationMs = options?.durationMs ?? GMAIL_FAST_WATCH_DURATION_MS;
  const now = Date.now();
  const nextUntil = now + durationMs;

  gmailFastWatchUntil = Math.max(gmailFastWatchUntil, nextUntil);

  if (gmailFastWatchRunning) {
    log.debug('[GmailFastWatch] extended', {
      reason,
      intervalMs,
      until: new Date(gmailFastWatchUntil).toISOString(),
    });
    triggerEventDrivenPolling(`gmail_fast_extend:${reason}`);
    return;
  }

  gmailFastWatchRunning = true;
  log.info('[GmailFastWatch] started', {
    reason,
    intervalMs,
    durationMs,
    until: new Date(gmailFastWatchUntil).toISOString(),
  });

  triggerEventDrivenPolling(`gmail_fast_start:${reason}`);

  gmailFastWatchTimer = setInterval(() => {
    if (Date.now() >= gmailFastWatchUntil) {
      stopGmailFastWatch('duration_expired');
      return;
    }
    triggerEventDrivenPolling('gmail_fast_tick');
  }, intervalMs);

  gmailFastWatchStopTimer = setTimeout(() => {
    stopGmailFastWatch('stop_timer');
  }, durationMs + 1_000);
}

export function stopGmailFastWatch(reason = 'manual'): void {
  if (gmailFastWatchTimer) {
    clearInterval(gmailFastWatchTimer);
    gmailFastWatchTimer = null;
  }
  if (gmailFastWatchStopTimer) {
    clearTimeout(gmailFastWatchStopTimer);
    gmailFastWatchStopTimer = null;
  }
  if (gmailFastWatchRunning) {
    log.info('[GmailFastWatch] stopped', { reason });
  }
  gmailFastWatchRunning = false;
  gmailFastWatchUntil = 0;
}

// ═══════════════════════════════════════════════════════════════
//  SINGLE EXTRACTION GUARD (Consolidated from singleExtractionGuard.ts)
// ═══════════════════════════════════════════════════════════════

export type ExtractionPayload = {
  code?: string | null | undefined;
  link?: string | null | undefined;
  intent?: string | undefined;
  [key: string]: unknown;
};

const activeExtractionsByEmailId = new Map<string, Promise<ExtractionPayload>>();
const extractionCacheByEmailId = new Map<string, { result: ExtractionPayload; savedAt: number }>();

const EXTRACTION_CACHE_TTL_MS = 30_000;

export async function extractEmailOnce(
  emailId: string,
  run: () => Promise<ExtractionPayload>
): Promise<ExtractionPayload> {
  const cached = extractionCacheByEmailId.get(emailId);
  if (cached && Date.now() - cached.savedAt < EXTRACTION_CACHE_TTL_MS) {
    return cached.result;
  }

  const active = activeExtractionsByEmailId.get(emailId);
  if (active) {
    return active;
  }

  const promise = run()
    .then((result) => {
      extractionCacheByEmailId.set(emailId, { result, savedAt: Date.now() });

      if (extractionCacheByEmailId.size > 100) {
        const first = extractionCacheByEmailId.keys().next().value;
        if (first) {
          extractionCacheByEmailId.delete(first);
        }
      }

      return result;
    })
    .finally(() => {
      activeExtractionsByEmailId.delete(emailId);
    });

  activeExtractionsByEmailId.set(emailId, promise);
  return promise;
}

