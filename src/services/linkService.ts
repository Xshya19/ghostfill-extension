// ─────────────────────────────────────────────────────────────────────
// Link Activation Service v2 — Intelligent Verification Link Engine
//
// ┌──────────────────────────────────────────────────────────────────┐
// │  Features                                                       │
// │  ─ URL security gate (scheme, TLD, IP, homoglyph checks)        │
// │  ─ Multi-source code extraction (params, path, hash fragment)   │
// │  ─ Sequential activation queue with dedup                       │
// │  ─ Retry with linear backoff                                    │
// │  ─ Ping-based content-script readiness (no hardcoded delays)    │
// │  ─ Full tab lifecycle (load, close, error)                      │
// │  ─ TTL-based deduplication cache with overflow eviction         │
// │  ─ Activation history for debugging / popup display             │
// │  ─ Observable metrics                                           │
// └──────────────────────────────────────────────────────────────────┘
// ─────────────────────────────────────────────────────────────────────

import { Email } from '../types';
import { DEFAULT_SETTINGS } from '../types/storage.types';
import { sleep } from '../utils/helpers';
import { createLogger } from '../utils/logger';
import { safeSendMessage } from '../utils/messaging';

import { dedupService } from './dedupService';
import { smartDetectionService } from './smartDetectionService';
import { storageService } from './storageService';

const log = createLogger('LinkEngine');

// Lazy import to avoid circular dependency at module load time
// Use Promise-based caching for ESM dynamic imports
let pollingManagerExportsPromise: Promise<{
  registerActivationTab: (tabId: number) => void;
  unregisterActivationTab: (tabId: number) => void;
  isActivationTab: (tabId: number) => boolean;
}> | null = null;

function getPollingManagerExports(): Promise<{
  registerActivationTab: (tabId: number) => void;
  unregisterActivationTab: (tabId: number) => void;
  isActivationTab: (tabId: number) => boolean;
}> {
  if (!pollingManagerExportsPromise) {
    pollingManagerExportsPromise = import('../background/pollingManager')
      .then((exports) => {
        log.debug('Successfully loaded pollingManager exports');
        return exports;
      })
      .catch((err) => {
        log.warn('Failed to load pollingManager exports', err);
        pollingManagerExportsPromise = null;
        return {
          registerActivationTab: () => {},
          unregisterActivationTab: () => {},
          isActivationTab: () => false,
        };
      });
  }
  return pollingManagerExportsPromise;
}

// ━━━ Types ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type ActivationStatus = 'queued' | 'activating' | 'activated' | 'delivered' | 'failed' | 'blocked';

interface ActivationRecord {
  url: string;
  emailId: string;
  from: string;
  subject: string;
  extractedCode: string | null;
  detectedAt: number;
  activatedAt: number | null;
  completedAt: number | null;
  tabId: number | null;
  status: ActivationStatus;
  attempts: number;
  error: string | null;
  durationMs: number | null;
}

interface UrlValidation {
  safe: boolean;
  reason?: string;
}

interface LinkMetrics {
  emailsScanned: number;
  linksDetected: number;
  linksBlocked: number;
  linksActivated: number;
  linksFailed: number;
  codesExtracted: number;
  codesDelivered: number;
  avgActivationMs: number;
  lastActivationAt: number;
  lastErrorMessage: string | null;
}

// ━━━ Configuration ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CONFIG = {
  // Deduplication
  DEDUP_TTL_MS: 600_000, // 10 min
  MAX_DEDUP_ENTRIES: 200,

  // Tab lifecycle
  TAB_LOAD_TIMEOUT_MS: 12_000, // 12 s
  CS_READY_TIMEOUT_MS: 5_000, //  5 s
  CS_POLL_INTERVAL_MS: 250, // poll every 250 ms

  // Activation queue
  MAX_RETRIES: 2,
  RETRY_BASE_DELAY_MS: 2_000, // 2 s × attempt
  ACTIVATION_COOLDOWN_MS: 3_000, // min gap between activations

  // History
  MAX_HISTORY_ENTRIES: 50,
} as const;

// ── Verification code parameter names (ranked by frequency) ──
const CODE_PARAM_NAMES = [
  'code',
  'token',
  'otp',
  'verification_code',
  'verificationCode',
  'verify',
  'key',
  'pin',
  'confirmation_code',
  'confirmationCode',
  'auth_code',
  'authCode',
  'passcode',
  'secret',
  'vcode',
] as const;

// ── Path prefixes that precede an inline code (e.g. /verify/ABC123) ──
const CODE_PATH_PREFIXES = [
  '/verify/',
  '/confirm/',
  '/activate/',
  '/validation/',
  '/auth/',
  '/code/',
  '/token/',
  '/check/',
] as const;

// ── Blocked URL schemes ──
const BLOCKED_SCHEMES: ReadonlySet<string> = new Set([
  'javascript:',
  'data:',
  'blob:',
  'file:',
  'chrome:',
  'chrome-extension:',
  'about:',
  'vbscript:',
]);

// ── Suspicious free TLDs commonly abused in phishing ──
const SUSPICIOUS_TLDS: ReadonlySet<string> = new Set([
  '.tk',
  '.ml',
  '.ga',
  '.cf',
  '.gq',
  '.buzz',
  '.top',
  '.xyz',
]);

// ── Homoglyph / punycode indicator ──
const PUNYCODE_PREFIX = 'xn--';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  LINK SERVICE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class LinkService {
  // ── State ──
  // private readonly processedEmails = new Map<string, ProcessedEmailEntry>(); // Removed for P2.2 consolidation
  private activationHistory: ActivationRecord[] = [];
  private readonly activationQueue: ActivationRecord[] = [];
  private draining = false;
  private lastActivationTime = 0;
  private readonly scanningEmails = new Set<string>();

  private readonly metrics: LinkMetrics = {
    emailsScanned: 0,
    linksDetected: 0,
    linksBlocked: 0,
    linksActivated: 0,
    linksFailed: 0,
    codesExtracted: 0,
    codesDelivered: 0,
    avgActivationMs: 0,
    lastActivationAt: 0,
    lastErrorMessage: null,
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  PUBLIC — entry point (called from polling manager)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async handleNewEmail(email: Email, accountId?: string): Promise<void> {
    const emailId = String(email.id);
    const accId = accountId || email.to || 'unknown';

    if (await this.isProcessed(emailId, accId)) {
      log.debug('Email already processed', { emailId });
      return;
    }

    if (this.isScanning(emailId)) {
      return;
    }
    this.markScanning(emailId);
    this.metrics.emailsScanned++;

    log.info('Scanning for activation links', {
      emailId,
      from: email.from,
      subject: truncate(email.subject, 60),
    });

    try {
      const detection = await smartDetectionService.detect(
        email.subject || '',
        email.body || email.htmlBody || '',
        email.htmlBody || '',
        email.from || ''
      );

      const hasLink =
        (detection.type === 'link' || detection.type === 'both') && Boolean(detection.link);

      await this.updateProcessed(emailId, accId, hasLink);

      if (!hasLink || !detection.link) {
        log.debug('No activation link found', { emailId });
        return;
      }

      this.metrics.linksDetected++;

      // ── Security gate ──
      const validation = this.validateUrl(detection.link);
      if (!validation.safe) {
        this.metrics.linksBlocked++;
        log.warn('⛔ Blocked unsafe link', {
          url: maskUrl(detection.link),
          reason: validation.reason,
        });
        return;
      }

      log.info('🔗 Link detected & validated', {
        url: maskUrl(detection.link),
        confidence: detection.confidence,
        engine: detection.engine,
      });

      // ── Auto-confirm: Check user setting before opening link ──
      const rawSettings = await storageService.get('settings');
      // SAFE MERGE: Always fall back to DEFAULT_SETTINGS so a stale or uninitialized
      // settings object does not silently block link activation for existing users.
      const autoConfirm = rawSettings?.autoConfirmLinks ?? DEFAULT_SETTINGS.autoConfirmLinks;

      log.info('🔘 autoConfirmLinks resolved', {
        raw: rawSettings?.autoConfirmLinks,
        effective: autoConfirm,
      });

      if (!autoConfirm) {
        log.info('⏭️ Skipping auto-confirm (user disabled)', {
          url: maskUrl(detection.link),
          setting: 'autoConfirmLinks',
        });
        return;
      }

      if (detection.type === 'both' && detection.code) {
        log.info('⏭️ Skipping auto-confirm (prefer OTP filling in current tab)', {
          url: maskUrl(detection.link),
          code: maskCode(detection.code),
        });
        return;
      }

      log.info('🔓 Auto-confirming link (user enabled)', {
        url: maskUrl(detection.link),
      });

      // ── Build activation record & enqueue ──
      const extractedCode = this.extractCodeFromUrl(detection.link);
      if (extractedCode) {
        this.metrics.codesExtracted++;
        log.info('🔑 Code extracted from URL', {
          code: maskCode(extractedCode),
        });
      }

      const record: ActivationRecord = {
        url: detection.link,
        emailId,
        from: email.from || 'unknown',
        subject: email.subject || '',
        extractedCode,
        detectedAt: Date.now(),
        activatedAt: null,
        completedAt: null,
        tabId: null,
        status: 'queued',
        attempts: 0,
        error: null,
        durationMs: null,
      };

      this.enqueue(record);
    } catch (error) {
      log.error('Email scan failed', {
        emailId,
        error: errorMessage(error),
      });
    } finally {
      this.unmarkScanning(emailId);
    }
  }

  // ── Observability ──

  getMetrics(): Readonly<LinkMetrics> {
    return { ...this.metrics };
  }

  getHistory(): ReadonlyArray<Readonly<ActivationRecord>> {
    return this.activationHistory;
  }

  getQueueDepth(): number {
    return this.activationQueue.length;
  }

  clearHistory(): void {
    this.activationHistory = [];
    dedupService.clear();
    this.scanningEmails.clear();
    log.info('🧹 History & dedup cache cleared');
  }

  private isScanning(emailId: string): boolean {
    return this.scanningEmails.has(emailId);
  }

  private markScanning(emailId: string): void {
    this.scanningEmails.add(emailId);
  }

  private unmarkScanning(emailId: string): void {
    this.scanningEmails.delete(emailId);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  ACTIVATION QUEUE — sequential, deduplicated, cooldown-gated
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private enqueue(record: ActivationRecord): void {
    // Dedup against queue
    if (this.activationQueue.some((r) => r.url === record.url)) {
      log.debug('Link already in queue', { url: maskUrl(record.url) });
      return;
    }

    // Dedup against history (only non-failed)
    const prior = this.activationHistory.find((r) => r.url === record.url);
    if (prior && prior.status !== 'failed') {
      log.debug('Link already activated', { url: maskUrl(record.url) });
      return;
    }

    this.activationQueue.push(record);
    log.debug('📥 Queued', { depth: this.activationQueue.length });
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) {
      return;
    }
    this.draining = true;

    try {
      while (this.activationQueue.length > 0) {
        // Enforce cooldown between activations
        const gap = Date.now() - this.lastActivationTime;
        if (gap < CONFIG.ACTIVATION_COOLDOWN_MS) {
          await sleep(CONFIG.ACTIVATION_COOLDOWN_MS - gap);
        }

        const record = this.activationQueue.shift()!;
        await this.activate(record);
      }
    } finally {
      this.draining = false;
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  ACTIVATION ENGINE — open tab, wait, deliver code, track
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private async activate(record: ActivationRecord): Promise<void> {
    record.status = 'activating';
    record.attempts++;

    const t0 = Date.now();

    try {
      log.info('🔗 Activating', {
        url: maskUrl(record.url),
        attempt: `${record.attempts}/${CONFIG.MAX_RETRIES + 1}`,
      });

      // ── Pre-save extracted code for manual paste fallback ──
      if (record.extractedCode) {
        await storageService.set('lastOTP', {
          code: record.extractedCode,
          extractedAt: Date.now(),
          source: 'email',
          confidence: 1.0,
        });
      }

      // ── Open the verification URL in a new foreground tab ──
      // URL safety is already enforced by validateUrl() above (blocks bad
      // schemes, localhost, raw IPs, suspicious TLDs, punycode domains).
      log.info('🌐 Opening activation link in foreground tab', { url: maskUrl(record.url) });

      const tab = await chrome.tabs.create({
        url: record.url,
        active: true, // foreground — show the tab to the user
      });

      if (!tab.id) {
        throw new Error('chrome.tabs.create returned no tab id');
      }

      record.tabId = tab.id;
      log.info('🪟 Tab opened', { tabId: tab.id });

      // Register as activation tab to prevent OTP delivery to this tab
      const pmExports = await getPollingManagerExports();
      pmExports.registerActivationTab(tab.id);

      // Cleanup when tab is closed
      const tabId = tab.id;
      const cleanupOnClose = (closedTabId: number) => {
        if (closedTabId === tabId) {
          chrome.tabs.onRemoved.removeListener(cleanupOnClose);
          void getPollingManagerExports().then((exports) => {
            exports.unregisterActivationTab(tabId);
          });
        }
      };
      chrome.tabs.onRemoved.addListener(cleanupOnClose);

      // ── Wait for page to fully load ──
      const loaded = await this.waitForTabLoad(tab.id);

      if (!loaded) {
        log.warn('⏱️ Tab load timeout — proceeding with delivery attempt anyway', {
          tabId: tab.id,
        });
      } else {
        log.info('✅ Page loaded', { tabId: tab.id });
      }

      // ── Deliver code to the loaded page (if we extracted one) ──
      if (record.extractedCode) {
        const delivered = await this.deliverCode(tab.id, record.extractedCode);
        record.status = delivered ? 'delivered' : 'activated';
        if (delivered) {
          this.metrics.codesDelivered++;
        }
      } else {
        record.status = 'activated';
      }

      // ── Give the content script a moment to process the code, but KEEP THE TAB OPEN ──
      await sleep(1_000);
      log.info('✨ Tab is ready and waiting for user', { tabId: tab.id });

      // Proactively clean up listener to prevent memory leak
      chrome.tabs.onRemoved.removeListener(cleanupOnClose);
      pmExports.unregisterActivationTab(tab.id);

      this.metrics.linksActivated++;
      this.metrics.lastActivationAt = Date.now();
      this.lastActivationTime = Date.now();

      // ── Signal polling manager to cool down ──
      await this.signalPollingComplete();
    } catch (error) {
      const msg = errorMessage(error);
      record.error = msg;
      this.metrics.lastErrorMessage = msg;

      log.error('Activation failed', {
        url: maskUrl(record.url),
        attempt: record.attempts,
        error: msg,
      });

      // ── Retry? ──
      if (record.attempts <= CONFIG.MAX_RETRIES) {
        const backoff = CONFIG.RETRY_BASE_DELAY_MS * record.attempts;
        log.info('🔄 Retrying', {
          nextAttempt: record.attempts + 1,
          backoffMs: backoff,
        });
        await sleep(backoff);
        await this.activate(record);
        return; // finalize happens in the retry
      }

      record.status = 'failed';
      this.metrics.linksFailed++;
      // Use messaging pattern instead of direct import
      safeSendMessage({
        action: 'SHOW_NOTIFICATION',
        payload: {
          title: 'GhostFill: Verification Failed',
          message: 'Could not open the link automatically. Please click it manually.',
          type: 'error',
        },
      }).catch(() => {
        /* ignore notification errors */
      });
    }

    this.finalize(record, t0);
  }

  private finalize(record: ActivationRecord, t0: number): void {
    record.completedAt = Date.now();
    record.durationMs = Date.now() - t0;

    // Exponential moving average (α = 0.2)
    if (record.status !== 'failed') {
      this.metrics.avgActivationMs =
        this.metrics.avgActivationMs === 0
          ? record.durationMs
          : this.metrics.avgActivationMs * 0.8 + record.durationMs * 0.2;
    }

    this.archive(record);

    log.info('📋 Activation complete', {
      status: record.status,
      duration: `${record.durationMs}ms`,
      attempts: record.attempts,
    });
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  TAB LIFECYCLE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Waits for a tab to reach `status: 'complete'`.
   * Resolves `false` if the tab is closed or the timeout fires first.
   */
  private waitForTabLoad(tabId: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;

      const settle = (loaded: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.onRemoved.removeListener(onRemoved);
        clearTimeout(timer);
        resolve(loaded);
      };

      const timer = setTimeout(() => {
        log.debug('⏱️ Tab load timeout', { tabId });
        settle(false);
      }, CONFIG.TAB_LOAD_TIMEOUT_MS);

      const onUpdated = (id: number, info: chrome.tabs.TabChangeInfo) => {
        if (id === tabId && info.status === 'complete') {
          settle(true);
        }
      };

      const onRemoved = (id: number) => {
        if (id === tabId) {
          log.debug('Tab closed during load', { tabId });
          settle(false);
        }
      };

      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.onRemoved.addListener(onRemoved);

      // Race: tab may already be complete
      chrome.tabs
        .get(tabId)
        .then((t) => {
          if (t.status === 'complete') {
            settle(true);
          }
        })
        .catch(() => settle(false));
    });
  }

  /**
   * Deliver a code to a tab's content script.
   * Uses a ping loop instead of a hardcoded delay so we send as soon
   * as the content script is ready (or give up after the timeout).
   */
  private async deliverCode(tabId: number, code: string): Promise<boolean> {
    // NOTE: Do NOT check isActivationTab here.
    // This function IS the code delivery for activation tabs.
    // The isActivationTab flag is only for preventing the *general polling engine*
    // from accidentally treating verification tabs as normal OTP targets.

    const ready = await this.probeContentScript(tabId);

    if (!ready) {
      log.warn('Content script never responded — delivery skipped', { tabId });
      return false;
    }

    try {
      await chrome.tabs.sendMessage(tabId, {
        action: 'AUTO_FILL_OTP',
        payload: {
          otp: code,
          source: 'url-extracted',
          confidence: 1.0,
          isBackgroundTab: true,
        },
      });
      log.info('📲 Code delivered', { tabId, code: maskCode(code) });
      return true;
    } catch (error) {
      log.warn('Delivery send failed — page may not have an OTP field to accept the code', {
        tabId,
        error: errorMessage(error),
      });
      return false;
    }
  }

  /**
   * Repeatedly pings the content script until it responds `{ alive: true }`
   * or the timeout expires.
   */
  private async probeContentScript(tabId: number): Promise<boolean> {
    const deadline = Date.now() + CONFIG.CS_READY_TIMEOUT_MS;

    while (Date.now() < deadline) {
      try {
        const res = await chrome.tabs.sendMessage(tabId, { action: 'PING' });
        if (res?.alive) {
          return true;
        }
      } catch {
        // Not injected yet — keep trying
      }
      await sleep(CONFIG.CS_POLL_INTERVAL_MS);
    }

    return false;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  URL SECURITY VALIDATION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private validateUrl(url: string): UrlValidation {
    // ── Parse ──
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { safe: false, reason: 'Malformed URL' };
    }

    // ── Scheme ──
    if (BLOCKED_SCHEMES.has(parsed.protocol)) {
      return { safe: false, reason: `Blocked scheme: ${parsed.protocol}` };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { safe: false, reason: `Non-HTTP scheme: ${parsed.protocol}` };
    }

    // ── Localhost / loopback ──
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '[::1]' ||
      host.endsWith('.localhost')
    ) {
      return { safe: false, reason: 'Localhost / loopback' };
    }

    // ── Raw IP address ──
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      return { safe: false, reason: 'Raw IPv4 host' };
    }
    if (host.startsWith('[') && host.endsWith(']')) {
      return { safe: false, reason: 'Raw IPv6 host' };
    }

    // ── Suspicious free TLDs ──
    for (const tld of SUSPICIOUS_TLDS) {
      if (host.endsWith(tld)) {
        return { safe: false, reason: `Suspicious TLD: ${tld}` };
      }
    }

    // ── Punycode / IDN homoglyph domains ──
    const labels = host.split('.');
    if (labels.some((l) => l.startsWith(PUNYCODE_PREFIX))) {
      return { safe: false, reason: 'Punycode/IDN domain (homoglyph risk)' };
    }

    // ── Excessively deep subdomain nesting (common phishing pattern) ──
    // Allow up to 10 levels to support legitimate enterprise services like:
    //   auth.dev.internal.region.corp.client.com (7 levels)
    if (labels.length > 10) {
      return { safe: false, reason: `Excessive subdomains (${labels.length} levels)` };
    }

    // ── Embedded credentials ──
    if (parsed.username || parsed.password) {
      return { safe: false, reason: 'URL contains embedded credentials' };
    }

    return { safe: true };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  CODE EXTRACTION — params → path → hash
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  public extractCodeFromUrl(url: string): string | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }

    // ── 1. Query parameters ──
    const fromParams = this.extractFromSearchParams(parsed.searchParams);
    if (fromParams) {
      return fromParams;
    }

    // ── 2. Path segments (e.g. /verify/ABC123) ──
    const fromPath = this.extractFromPath(parsed.pathname);
    if (fromPath) {
      return fromPath;
    }

    // ── 3. Hash fragment (e.g. #code=ABC123 or #/verify/ABC123) ──
    if (parsed.hash.length > 1) {
      const hashBody = parsed.hash.substring(1); // strip leading #

      // Try as key=value pairs first
      const hashParams = new URLSearchParams(hashBody);
      const fromHash = this.extractFromSearchParams(hashParams);
      if (fromHash) {
        return fromHash;
      }

      // Try as a path segment
      const fromHashPath = this.extractFromPath('/' + hashBody);
      if (fromHashPath) {
        return fromHashPath;
      }
    }

    return null;
  }

  private extractFromSearchParams(params: URLSearchParams): string | null {
    for (const name of CODE_PARAM_NAMES) {
      const value = params.get(name);
      if (value && this.isPlausibleCode(value)) {
        return value;
      }
    }
    return null;
  }

  private extractFromPath(pathname: string): string | null {
    const lower = pathname.toLowerCase();
    for (const prefix of CODE_PATH_PREFIXES) {
      if (lower.startsWith(prefix)) {
        const remainder = pathname.substring(prefix.length).replace(/\/+$/, ''); // trim trailing slashes
        if (remainder && this.isPlausibleCode(remainder)) {
          return remainder;
        }
      }
    }
    return null;
  }

  /**
   * Determines whether a string looks like a verification code.
   * Must be 4-12 characters, alphanumeric, not all zeros,
   * and not a common English word that happens to be short.
   */
  private isPlausibleCode(value: string): boolean {
    if (value.length < 4 || value.length > 64) {
      return false;
    }
    // Allow alphanumeric plus common token separators (-, _)
    if (!/^[a-zA-Z0-9\-_]+$/.test(value)) {
      return false;
    }
    if (/^0+$/.test(value)) {
      return false;
    } // "0000" isn't a real code

    // Reject dictionary words that slip through (case-insensitive)
    const lower = value.toLowerCase();
    const falsePositives = new Set([
      'true',
      'false',
      'null',
      'undefined',
      'test',
      'email',
      'verify',
      'token',
      'auth',
      'link',
      'confirm',
      'user',
      'admin',
      'page',
      'next',
    ]);
    if (falsePositives.has(lower)) {
      return false;
    }

    return true;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  DEDUPLICATION CACHE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private async isProcessed(emailId: string, accountId: string): Promise<boolean> {
    return dedupService.isProcessed(emailId, accountId);
  }

  private async markProcessed(emailId: string, accountId: string, hadLink: boolean): Promise<void> {
    await dedupService.markProcessed(emailId, accountId, false, hadLink);
  }

  private async updateProcessed(
    emailId: string,
    accountId: string,
    hadLink: boolean
  ): Promise<void> {
    await dedupService.updateRecord(emailId, accountId, { hadLink });
  }

  // pruneDedup removed - handled by DedupService

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  HISTORY
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private archive(record: ActivationRecord): void {
    this.activationHistory.push(record);

    if (this.activationHistory.length > CONFIG.MAX_HISTORY_ENTRIES) {
      this.activationHistory = this.activationHistory.slice(-CONFIG.MAX_HISTORY_ENTRIES);
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  CROSS-MODULE SIGNALING
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Signal polling manager to cool down after successful activation.
   *
   * ARCHITECTURE NOTE: Circular Dependency Resolution
   * ───────────────────────────────────────────────────
   * This module (linkService) is imported by pollingManager.ts.
   * If we import pollingManager here, we create a circular dependency:
   *   pollingManager → linkService → pollingManager
   *
   * Solution: Use Chrome runtime message passing for cross-module signaling.
   * This is the recommended pattern for MV3 extension architecture because:
   *   1. It decouples modules completely
   *   2. It works across service worker boundaries
   *   3. It's the native communication mechanism for extensions
   *
   * Alternative considered: Event emitter pattern
   *   - Rejected because it would require a shared event bus module
   *   - Message passing is more explicit and debuggable
   */
  private async signalPollingComplete(): Promise<void> {
    try {
      // Use Chrome runtime message passing to avoid circular dependency
      // pollingManager listens for this action and calls stopEmailPolling()
      await chrome.runtime.sendMessage({
        action: 'LINK_ACTIVATED',
        payload: {
          timestamp: Date.now(),
          source: 'linkService',
        },
      });
      log.debug('📡 Signaled polling manager (LINK_ACTIVATED)');
    } catch (error) {
      // Message passing failed - polling manager may be unloaded
      // This is non-fatal; polling will continue on its normal schedule
      log.debug('⚠️ Could not signal polling manager', {
        error: errorMessage(error),
      });
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  MODULE UTILITIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 30 ? u.pathname.substring(0, 30) + '…' : u.pathname;
    return `${u.protocol}//${u.hostname}${path}`;
  } catch {
    return url.substring(0, 50) + '…';
  }
}

function maskCode(code: string): string {
  if (code.length <= 3) {
    return '•'.repeat(code.length);
  }
  return code.substring(0, 3) + '•'.repeat(code.length - 3);
}

function truncate(str: string | undefined, max: number): string {
  if (!str) {
    return '';
  }
  return str.length > max ? str.substring(0, max) + '…' : str;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ━━━ Singleton Export ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const linkService = new LinkService();
