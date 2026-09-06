// YOPmail Service
// Scrapes and interacts with YOPmail (https://yopmail.com/) disposable email platform.
// Handles dynamic session tokens (yp, yj, v), cookie synchronization (ytime), and HTML parsing.
//
// EFFICIENCY DESIGN (MV3 service worker constraints):
// - Generation is fully local (zero network): human-like login + least-blocked
//   alternate domain. No account creation API exists — every inbox pre-exists.
// - Session tokens (yp/yj/version) are single-flighted AND persisted to
//   chrome.storage.session, so an ephemeral SW wake costs 1 inbox GET in the
//   steady state instead of 3 (homepage + webmail.js + inbox).
// - ytime is sent as a plain `Cookie` header (no `cookies` permission needed).
// - Parsing is regex-only (no DOMParser in SW) with adaptive fallbacks in the
//   spirit of Scrapling's multi-strategy selection: a strict fast path first,
//   then per-block field extraction that tolerates attribute reordering.
//   (Scrapling itself is Python-only and cannot run inside an MV3 extension,
//   so only its techniques — fallback selectors, session reuse, backoff via
//   the shared circuit breaker — are ported here in TypeScript.)
//
// ANTI-BLOCK DESIGN:
// - yopmail.com/.fr/.net are among the most blocklisted disposable domains.
//   YOPmail's own guidance is to use alternate domains, and all mail sent to
//   ANY alternate domain lands in the same `<login>@yopmail.com` inbox (login
//   is the only thing polled). Generation therefore defaults to obscure
//   alternate domains (no "yopmail"/"jetable"/"poubelle"/"spam" markers) and
//   randomizes across the pool per account.

import { EmailAccount, Email } from '../../types';
import { fetchWithTimeout, contentToString, safeParseDate } from '../../utils/core';
import { getRandomInt } from '../../utils/encryption';
import { generateHumanLikeUsername } from '../../utils/humanNameGenerator';
import { createLogger } from '../../utils/logger';
import { isRetryableError, throttledWarn, throwIfRetryableStatus } from './isRetryableError';

const log = createLogger('YopmailService');
const BASE_URL = 'https://yopmail.com';

// Least-blocked first: obscure alternates with no disposable giveaways.
// Verified live against https://yopmail.com/en/domain?d=all — every address
// below auto-forwards to the same `<login>@yopmail.com` inbox, so polling is
// login-only regardless of which domain was handed to the signup form.
const LEAST_BLOCKED_DOMAINS = [
  'mynes.com',
  'hunnur.com',
  'binich.com',
  'bin-ich.com',
  'sindwir.com',
  'habenwir.com',
  'ist-hier.com',
  'sind-wir.com',
  'sindhier.com',
  'wir-sind.com',
  'haben-wir.com',
  'sind-hier.com',
  'machen-wir.com',
  'lerch.ovh',
  'blip.ovh',
  'zx81.ovh',
  'toolbox.ovh',
  'six25.biz',
  'rbs1.xyz',
  'ves.ink',
  'cpc.cx',
  '1xp.fr',
  'pepamail.com',
  'assurmail.net',
];

// Full domain list: least-blocked pool first, then the well-known (but heavily
// blocklisted) primary domains, then legacy compat entries.
const PRIMARY_DOMAINS = ['yopmail.com', 'yopmail.fr', 'yopmail.net'];

const LEGACY_COMPAT_DOMAINS = [
  'cool.fr.nf',
  'jetable.fr.nf',
  'courriel.fr.nf',
  'moncourrier.fr.nf',
  'monemail.fr.nf',
  'monmail.fr.nf',
];

// Giveaway substrings that mark a domain as an obvious disposable. Freshly
// published alternate domains containing these stay usable (listed by
// getDomains) but are never auto-generated — same rationale as preferring
// obscure alternates over yopmail.com.
const GIVEAWAY_PATTERNS = [
  'yopmail',
  'jetable',
  'poubelle',
  'spam',
  'trash',
  'tempmail',
  'throwaway',
  'guerrilla',
  'fake',
  'anon',
  '10min',
  'minute',
  'temp',
];

function isObscureDomain(domain: string): boolean {
  const lower = domain.toLowerCase();
  return !GIVEAWAY_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Parse YOPmail's published alternate-domain list
 * (GET https://yopmail.com/en/domain?d=all → `<div>@domain</div>` items).
 * Pure + regex-only so it runs in MV3 service workers and is unit-testable.
 */
export function parseAlternateDomainsHtml(html: string): string[] {
  const found = new Set<string>();
  const re = /<div>\s*@([A-Za-z0-9][A-Za-z0-9.~-]*\.[A-Za-z]{2,})\s*<\/div>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const domain = match[1]!.toLowerCase();
    if (domain.length <= 64 && !domain.includes('..')) {
      found.add(domain);
    }
    if (found.size >= 400) {
      break;
    }
  }
  return [...found];
}

const SESSION_TTL_MS = 15 * 60 * 1000;
const SESSION_STORAGE_KEY = 'yopmail_session';
const FALLBACK_VERSION = '9.3';
const MAX_LOGIN_LENGTH = 64;

interface YopmailSession {
  yp: string;
  yj: string;
  version: string;
  expiresAt: number;
}

/**
 * The `yj` token is bound to the webmail.js `version` (which changes rarely —
 * observed 9.0 → 9.3), while `yp` rotates per homepage visit. Caching `yj`
 * separately means a session refresh usually costs ONE fetch (homepage for a
 * fresh `yp`) instead of two, halving our request rate against YOPmail's
 * aggressive throttling.
 */
interface YopmailYjCache {
  yj: string;
  version: string;
  expiresAt: number;
}

function isValidYjCache(cache: YopmailYjCache | null | undefined): cache is YopmailYjCache {
  return (
    !!cache &&
    typeof cache.yj === 'string' &&
    cache.yj.length > 0 &&
    typeof cache.version === 'string' &&
    cache.expiresAt > Date.now()
  );
}

/** Decode basic HTML entities safely without full DOM requirement */
export function decodeHtmlEntities(encodedString: string): string {
  if (!encodedString) {return '';}
  return encodedString
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        return String.fromCharCode(Number(dec));
      } catch {
        return '';
      }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        return String.fromCharCode(parseInt(hex, 16));
      } catch {
        return '';
      }
    })
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&apos;/g, "'");
}

/** Strip HTML tags for clean textBody representation */
function stripHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/[ \t]+/g, ' ')
      .trim()
  );
}

/** Pick a random least-blocked alternate domain (crypto-backed). */
function pickLeastBlockedDomain(pool?: string[]): string {
  const source = pool && pool.length > 0 ? pool : LEAST_BLOCKED_DOMAINS;
  return source[getRandomInt(0, source.length - 1)]!;
}

/**
 * Sanitize a login to YOPmail's alphabet (`[-a-zA-Z0-9@_.+]`, max 64 chars),
 * keeping GhostFill's human-like style (dots/underscores/dashes). Falls back
 * to a generated username when nothing usable remains.
 */
function sanitizeLogin(prefix?: string): string {
  if (prefix) {
    const cleaned = prefix
      .split('@')[0]!
      .toLowerCase()
      .replace(/[^a-z0-9._+-]/g, '')
      .slice(0, MAX_LOGIN_LENGTH);
    if (cleaned.length > 0) {
      return cleaned;
    }
  }
  return `${generateHumanLikeUsername()}${getRandomInt(100, 9999)}`.slice(0, MAX_LOGIN_LENGTH);
}

function isValidSession(session: YopmailSession | null | undefined): session is YopmailSession {
  return (
    !!session &&
    typeof session.yp === 'string' &&
    typeof session.yj === 'string' &&
    typeof session.version === 'string' &&
    session.yp.length > 0 &&
    session.yj.length > 0 &&
    session.expiresAt > Date.now()
  );
}

export class YopmailService {
  private session: YopmailSession | null = null;
  private sessionPromise: Promise<YopmailSession> | null = null;
  private sessionLoaded = false;
  private yjCache: YopmailYjCache | null = null;
  private static readonly YJ_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  private cookieJar: string = '';

  private altPool: string[] | null = null;
  private altPoolExpiresAt = 0;
  private altRefreshPromise: Promise<void> | null = null;
  private static readonly ALT_POOL_TTL_MS = 24 * 60 * 60 * 1000;
  private static readonly ALT_POOL_URL = `${BASE_URL}/en/domain?d=all`;

  /**
   * Get public domains supported by YOPmail (least-blocked first).
   * The static fallback is always returned immediately; a background refresh
   * of YOPmail's published alternate list keeps the pool current with the
   * daily new domains (freshest = least-blocked) without ever blocking callers.
   */
  async getDomains(signal?: AbortSignal): Promise<string[]> {
    void this.refreshAlternatePool(signal);
    const pool = this.getGenerationPool();
    const rest = [...PRIMARY_DOMAINS, ...LEGACY_COMPAT_DOMAINS].filter(
      (d) => !pool.includes(d)
    );
    const freshRest = (this.altPool ?? []).filter(
      (d) => !pool.includes(d) && !rest.includes(d)
    );
    return [...pool, ...rest, ...freshRest];
  }

  /** Obscure-first generation pool: curated alternates + fresh obscure ones. */
  private getGenerationPool(): string[] {
    const seen = new Set<string>();
    const pool: string[] = [];
    for (const domain of [...LEAST_BLOCKED_DOMAINS, ...(this.altPool ?? [])]) {
      if (!seen.has(domain) && isObscureDomain(domain)) {
        seen.add(domain);
        pool.push(domain);
      }
    }
    return pool.length > 0 ? pool : [...LEAST_BLOCKED_DOMAINS];
  }

  /**
   * Refresh the alternate-domain pool from YOPmail's published list (24h TTL,
   * single-flighted). Never throws — callers always keep the static fallback.
   * Public so UIs/tests can trigger an explicit refresh.
   */
  async refreshAlternatePool(signal?: AbortSignal): Promise<void> {
    if (Date.now() < this.altPoolExpiresAt) {
      return;
    }
    if (this.altRefreshPromise) {
      return this.altRefreshPromise;
    }
    this.altRefreshPromise = this.fetchAlternatePool(signal).finally(() => {
      this.altRefreshPromise = null;
    });
    return this.altRefreshPromise;
  }

  private async fetchAlternatePool(signal?: AbortSignal): Promise<void> {
    try {
      const response = await fetchWithTimeout(YopmailService.ALT_POOL_URL, {
        signal: signal ?? null,
        timeout: 10_000,
        headers: { Accept: 'text/html,*/*' },
      });
      if (!response.ok) {
        return;
      }
      const domains = parseAlternateDomainsHtml(await response.text());
      if (domains.length >= 10) {
        this.altPool = domains;
        this.altPoolExpiresAt = Date.now() + YopmailService.ALT_POOL_TTL_MS;
        log.info(`YOPmail alt-domain pool refreshed (${domains.length} domains)`);
      }
    } catch (error) {
      log.debug('YOPmail alt-domain refresh failed, keeping static pool', error);
    }
  }

  /**
   * Create an instant disposable email account. Fully local: YOPmail inboxes
   * pre-exist, so generation costs zero requests. Defaults to a random
   * least-blocked alternate domain; mail still arrives in the same login inbox.
   */
  async createAccount(prefix?: string, _signal?: AbortSignal): Promise<EmailAccount> {
    const login = sanitizeLogin(prefix);
    const domain = pickLeastBlockedDomain(this.getGenerationPool());
    const now = Date.now();
    const fullEmail = `${login}@${domain}`;

    log.info('yopmail: generated new public inbox', { email: fullEmail });

    return {
      id: `yopmail_${now}_${login}`,
      username: login,
      login,
      domain,
      fullEmail,
      createdAt: now,
      // YOPmail keeps messages up to 8 days
      expiresAt: now + 8 * 24 * 60 * 60 * 1000,
      service: 'yopmail',
    };
  }

  /**
   * Ensure session tokens (yp, yj, version) are initialized and not expired.
   * Single-flighted: concurrent polls share one refresh. Persisted to
   * chrome.storage.session so MV3 SW restarts reuse tokens instead of paying
   * 2 extra fetches per wake.
   */
  async ensureSession(forceRefresh = false, signal?: AbortSignal): Promise<YopmailSession> {
    if (!forceRefresh && isValidSession(this.session)) {
      this.syncTimeCookie();
      return this.session;
    }

    if (!forceRefresh && this.sessionPromise) {
      return this.sessionPromise;
    }

    // Claim the refresh slot SYNCHRONOUSLY (before any await) so concurrent
    // polls coalesce onto one homepage + webmail.js fetch pair.
    this.sessionPromise = this.doEnsure(forceRefresh, signal).finally(() => {
      this.sessionPromise = null;
    });
    return this.sessionPromise;
  }

  private async doEnsure(forceRefresh: boolean, signal?: AbortSignal): Promise<YopmailSession> {
    if (!forceRefresh && !this.sessionLoaded) {
      this.sessionLoaded = true;
      await this.loadPersistedSession();
      if (isValidSession(this.session)) {
        this.syncTimeCookie();
        return this.session;
      }
    }
    return this.refreshSession(signal);
  }

  private async refreshSession(signal?: AbortSignal): Promise<YopmailSession> {
    const now = Date.now();
    log.debug('Initializing or refreshing YOPmail session tokens');

    // 1. Fetch homepage to extract `yp` token and client script version.
    // yp appears as id="yp" OR name="yp" depending on page variant (adaptive).
    const homeResponse = await fetchWithTimeout(`${BASE_URL}/en/`, {
      signal: signal ?? null,
      credentials: 'include',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    throwIfRetryableStatus(homeResponse, 'YOPmail home session');
    const homeHtml = await homeResponse.text();

    // Capture cookies for non-extension runtimes (tests/Node).
    const setCookieHeaders = homeResponse.headers.get('set-cookie');
    if (setCookieHeaders) {
      this.cookieJar = setCookieHeaders
        .split(',')
        .map((c) => c.split(';')[0]!.trim())
        .filter(Boolean)
        .join('; ');
    }

    const ypMatch =
      homeHtml.match(/id=["']yp["'][^>]*value=["']([^"']+)["']/i) ||
      homeHtml.match(/name=["']yp["'][^>]*value=["']([^"']+)["']/i) ||
      homeHtml.match(/value=["']([^"']+)["'][^>]*id=["']yp["']/i);
    const yp = ypMatch?.[1] || '';

    const versionMatch = homeHtml.match(/\/ver\/([0-9.]+)\/webmail\.js/i);
    const version = versionMatch?.[1] || FALLBACK_VERSION;

    // 2. Resolve the `yj` token: version-bound and long-lived, so reuse the
    // 24h cache when it matches the homepage's version and skip webmail.js.
    // This halves refresh traffic against YOPmail's aggressive throttling.
    let yj = '';
    if (isValidYjCache(this.yjCache) && this.yjCache.version === version) {
      yj = this.yjCache.yj;
      log.debug('Reusing cached YOPmail yj token, skipped webmail.js fetch');
    } else {
      const jsResponse = await fetchWithTimeout(`${BASE_URL}/ver/${version}/webmail.js`, {
        signal: signal ?? null,
        credentials: 'include',
      });

      throwIfRetryableStatus(jsResponse, 'YOPmail webmail script');
      const jsText = await jsResponse.text();

      const yjMatch = jsText.match(/[?&]yj=([^\s&"'<>]+)/);
      yj = yjMatch?.[1] || '';
      if (yj) {
        this.yjCache = { yj, version, expiresAt: now + YopmailService.YJ_CACHE_TTL_MS };
      }
    }

    // If parsing came up empty but an older cache exists, prefer stale tokens
    // over guaranteed-400 fresh ones — the inbox call will 400/refresh if dead.
    if (!yj && this.yjCache && this.yjCache.yj) {
      yj = this.yjCache.yj;
      log.debug('YOPmail yj parse empty, reusing previous yj token');
    }

    this.session = { yp, yj, version, expiresAt: now + SESSION_TTL_MS };
    this.syncTimeCookie();
    void this.persistSession();
    return this.session;
  }

  private async loadPersistedSession(): Promise<void> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.session) {
        const data = await chrome.storage.session.get(SESSION_STORAGE_KEY);
        const stored = data?.[SESSION_STORAGE_KEY] as
          | YopmailSession
          | { session?: YopmailSession; yjCache?: YopmailYjCache }
          | undefined;
        // Back-compat: older builds stored the session object directly.
        const session =
          stored && 'session' in stored ? stored.session : (stored as YopmailSession | undefined);
        if (isValidSession(session)) {
          this.session = session;
          log.debug('YOPmail session restored from storage');
        }
        const yjCache =
          stored && typeof stored === 'object' && 'yjCache' in stored
            ? (stored as { yjCache?: YopmailYjCache }).yjCache
            : undefined;
        if (isValidYjCache(yjCache)) {
          this.yjCache = yjCache;
        }
      }
    } catch (err) {
      log.debug('Unable to restore YOPmail session', err);
    }
  }

  private async persistSession(): Promise<void> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.session && this.session) {
        await chrome.storage.session.set({
          [SESSION_STORAGE_KEY]: { session: this.session, yjCache: this.yjCache },
        });
      }
    } catch (err) {
      log.debug('Unable to persist YOPmail session', err);
    }
  }

  private lastFetchTime = 0;
  private lastFetchLogin = '';
  private cachedInbox: Email[] = [];
  private lastTokenRefreshTime = 0;
  public static readonly MIN_FETCH_INTERVAL_MS = 6000; // Throttle scraping floor

  /**
   * Keep `ytime` and `compte` in sync.
   * In Chrome Extension (MV3), fetch() cannot set forbidden Cookie headers.
   * We use chrome.cookies.set() so the browser network stack automatically attaches
   * ytime (time) and compte (login) cookies to requests with credentials: 'include'.
   * Also maintains the in-memory cookie jar for Node/vitest runtimes.
   */
  private async syncCookies(login?: string): Promise<void> {
    const d = new Date();
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    const ytime = `${hours}:${mins}`;

    // 1. Maintain in-memory jar for node / test environments
    if (this.cookieJar.includes('ytime=')) {
      this.cookieJar = this.cookieJar.replace(/ytime=[^;]*/, `ytime=${ytime}`);
    } else {
      this.cookieJar = this.cookieJar ? `${this.cookieJar}; ytime=${ytime}` : `ytime=${ytime}`;
    }

    if (login) {
      if (this.cookieJar.includes('compte=')) {
        this.cookieJar = this.cookieJar.replace(/compte=[^;]*/, `compte=${login}`);
      } else {
        this.cookieJar = `${this.cookieJar}; compte=${login}`;
      }
    }

    // 2. MV3 Chrome Extension: Use chrome.cookies API to set real browser cookies
    if (typeof chrome !== 'undefined' && chrome.cookies?.set) {
      try {
        await chrome.cookies.set({
          url: 'https://yopmail.com/',
          name: 'ytime',
          value: ytime,
          path: '/',
        });
        if (login) {
          await chrome.cookies.set({
            url: 'https://yopmail.com/',
            name: 'compte',
            value: login,
            path: '/',
          });
        }
      } catch (err) {
        log.debug('Unable to set cookie via chrome.cookies', err);
      }
    }
  }

  private syncTimeCookie(): void {
    void this.syncCookies();
  }

  private cookieHeader(): Record<string, string> {
    this.syncTimeCookie();
    return { Cookie: this.cookieJar };
  }

  /**
   * Fetch messages list for a YOPmail inbox. Polling is login-only: any
   * alternate domain maps to the same inbox, so the domain in fullEmail is
   * informational and never sent.
   *
   * Rate-throttled to a minimum 6-second interval per account to protect against
   * rapid burst ticks tripping YOPmail's anti-bot rate limits.
   */
  async getMessages(fullEmail: string, signal?: AbortSignal): Promise<Email[]> {
    const [login] = fullEmail.split('@');
    if (!login) {
      return [];
    }

    const now = Date.now();
    if (
      now - this.lastFetchTime < YopmailService.MIN_FETCH_INTERVAL_MS &&
      this.lastFetchLogin === login
    ) {
      log.debug('YOPmail poll throttled, returning cached messages');
      return this.cachedInbox;
    }

    try {
      const emails = await this.fetchInboxInternal(login, fullEmail, false, signal);
      this.lastFetchTime = Date.now();
      this.lastFetchLogin = login;
      this.cachedInbox = emails;
      return emails;
    } catch (error) {
      if (isRetryableError(error)) {
        throttledWarn(log, 'yopmail-getMessages', 'Failed to fetch YOPmail messages', error);
        throw error;
      }
      if (error instanceof Error && /\bhttp\s*error\b/i.test(error.message)) {
        throttledWarn(log, 'yopmail-getMessages', 'Failed to fetch YOPmail messages', error);
        throw error;
      }
      log.debug('YOPmail getMessages non-retryable error, returning []', error);
      return [];
    }
  }

  /**
   * Internal inbox fetcher with single retry on token expiry.
   */
  private async fetchInboxInternal(
    login: string,
    fullEmail: string,
    isRetry = false,
    signal?: AbortSignal
  ): Promise<Email[]> {
    const session = await this.ensureSession(isRetry, signal);
    await this.syncCookies(login);

    const inboxUrl = `${BASE_URL}/en/inbox?login=${encodeURIComponent(
      login
    )}&p=1&d=all&ctrl=&yp=${encodeURIComponent(session.yp)}&yj=${encodeURIComponent(
      session.yj
    )}&v=${encodeURIComponent(session.version)}&r_c=&id=&ad=0`;

    const response = await fetchWithTimeout(inboxUrl, {
      signal: signal ?? null,
      credentials: 'include',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: `${BASE_URL}/en/`,
        ...this.cookieHeader(),
      },
    });

    // If session expired / rejected and not retried yet, refresh tokens and retry once.
    // Prevent runaway refresh loops: at most 1 token refresh per 60s window on 400/403.
    if ((response.status === 400 || response.status === 403) && !isRetry) {
      const now = Date.now();
      if (now - this.lastTokenRefreshTime < 60_000) {
        log.warn('YOPmail 400/403 received, tokens refreshed within last 60s. Refusing runaway refresh loop.');
        throw new Error(`YOPmail getMessages: HTTP error ${response.status}`);
      }
      this.lastTokenRefreshTime = now;
      log.debug('YOPmail returned 400/403, refreshing session tokens and retrying');
      return this.fetchInboxInternal(login, fullEmail, true, signal);
    }

    if (response.status === 404) {
      return [];
    }

    throwIfRetryableStatus(response, 'YOPmail getMessages');
    const html = await response.text();

    return this.parseInboxHtml(html, fullEmail);
  }

  /**
   * Parse messages list from inbox HTML (adaptive: strict fast path, then
   * per-block fallback that tolerates attribute reordering/quote changes).
   */
  parseInboxHtml(html: string, fullEmail: string): Email[] {
    // Fast path — exact known layout:
    // <div class="m" id="[ID]">…<span class="lmh">[TIME]</span>…<span class="lmf">[FROM]</span>…<div class="lms">[SUBJECT]</div>
    const strictRe =
      /<div\s+[^>]*class="m"[^>]*id="([^"]+)"[\s\S]*?<span\s+class="lmh">([^<]*)<\/span>[\s\S]*?<span\s+class="lmf">([^<]*)<\/span>[\s\S]*?<div\s+class="lms">([^<]*)<\/div>/g;

    const items: Email[] = [];
    let match: RegExpExecArray | null;
    strictRe.lastIndex = 0;
    while ((match = strictRe.exec(html)) !== null) {
      items.push(this.toListEmail(match[1]!, match[3], match[4], match[2], fullEmail));
    }
    if (items.length > 0) {
      return items;
    }

    // Fallback — split on message blocks, extract fields independently.
    // Order-independent: class="m" and id="..." may appear in either order.
    const blockRe = /<div\s(?=[^>]*\bclass=["']m["'])[^>]*\bid=["']([^"']+)["'][^>]*>/gi;
    const blocks: Array<{ id: string; start: number }> = [];
    let block: RegExpExecArray | null;
    while ((block = blockRe.exec(html)) !== null) {
      blocks.push({ id: block[1]!, start: block.index });
    }

    for (let i = 0; i < blocks.length; i++) {
      const current = blocks[i]!;
      const end = i + 1 < blocks.length ? blocks[i + 1]!.start : html.length;
      const segment = html.slice(current.start, end);
      const time = segment.match(/<span\s+[^>]*class=["']lmh["'][^>]*>([^<]*)<\/span>/i)?.[1];
      const from = segment.match(/<span\s+[^>]*class=["']lmf["'][^>]*>([^<]*)<\/span>/i)?.[1];
      const subject = segment.match(
        /<(?:div|span)\s+[^>]*class=["']lms["'][^>]*>([^<]*)<\/(?:div|span)>/i
      )?.[1];
      items.push(this.toListEmail(current.id, from, subject, time, fullEmail));
    }

    return items;
  }

  private toListEmail(
    id: string,
    from: string | undefined,
    subject: string | undefined,
    timeStr: string | undefined,
    fullEmail: string
  ): Email {
    const cleanFrom = decodeHtmlEntities((from ?? '').trim() || 'Unknown Sender');
    const cleanSubject = decodeHtmlEntities((subject ?? '').trim() || '(No Subject)');
    return {
      id: String(id),
      from: contentToString(cleanFrom, 'Unknown Sender'),
      to: fullEmail,
      subject: contentToString(cleanSubject, '(No Subject)'),
      date: safeParseDate((timeStr ?? '').trim() || undefined),
      body: cleanSubject,
      htmlBody: cleanSubject,
      textBody: cleanSubject,
      read: true,
      attachments: [],
    };
  }

  /**
   * Fetch full email message content by ID.
   */
  async getMessage(fullEmail: string, emailId: string, signal?: AbortSignal): Promise<Email> {
    const [login] = fullEmail.split('@');
    if (!login) {
      throw new Error('Invalid email address');
    }

    try {
      return await this.fetchMessageInternal(login, fullEmail, emailId, false, signal);
    } catch (error) {
      log.debug('Direct YOPmail message fetch failed, checking inbox list', error);
      const messages = await this.getMessages(fullEmail, signal);
      const found = messages.find((m) => String(m.id) === String(emailId));
      if (!found) {
        throw new Error(`Message ${emailId} not found in YOPmail inbox`);
      }
      return found;
    }
  }

  /**
   * Internal message fetcher with single retry on token expiry.
   */
  private async fetchMessageInternal(
    login: string,
    fullEmail: string,
    emailId: string,
    isRetry = false,
    signal?: AbortSignal
  ): Promise<Email> {
    const session = await this.ensureSession(isRetry, signal);
    await this.syncCookies(login);

    // In YOPmail, mail viewer expects id formatted as 'm' + rawId if not already prefixed.
    // Tokens ride along like the Go client does (harmless if the viewer ignores them,
    // required when the session is fresh).
    const idParam = emailId.startsWith('m') ? emailId : `m${emailId}`;
    const mailUrl = `${BASE_URL}/en/mail?b=${encodeURIComponent(
      login
    )}&id=${encodeURIComponent(idParam)}&yp=${encodeURIComponent(
      session.yp
    )}&yj=${encodeURIComponent(session.yj)}&v=${encodeURIComponent(session.version)}`;

    const response = await fetchWithTimeout(mailUrl, {
      signal: signal ?? null,
      credentials: 'include',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: `${BASE_URL}/en/inbox`,
        ...this.cookieHeader(),
      },
    });

    if ((response.status === 400 || response.status === 403) && !isRetry) {
      const now = Date.now();
      if (now - this.lastTokenRefreshTime < 60_000) {
        log.warn('YOPmail mail fetch 400/403 received, tokens refreshed within last 60s. Refusing runaway refresh loop.');
        throw new Error(`YOPmail getMessage: HTTP error ${response.status}`);
      }
      this.lastTokenRefreshTime = now;
      log.debug('YOPmail mail fetch returned 400/403, refreshing session and retrying');
      return this.fetchMessageInternal(login, fullEmail, emailId, true, signal);
    }

    throwIfRetryableStatus(response, 'YOPmail getMessage');
    const html = await response.text();

    return this.parseMessageHtml(html, emailId, fullEmail);
  }

  /**
   * Parse detailed email body, subject, date, and sender from mail HTML
   * (adaptive field matchers with title/text fallbacks).
   */
  parseMessageHtml(html: string, emailId: string, fullEmail: string): Email {
    const subjectMatch =
      html.match(/<div[^>]*class="ellipsis nw b f18"[^>]*>([\s\S]*?)<\/div>/i) ||
      html.match(/<div[^>]*class=["'][^"']*\bf18\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
      html.match(/<title>([\s\S]*?)<\/title>/i);
    const fromMatch =
      html.match(/<span[^>]*class="ellipsis b"[^>]*>([\s\S]*?)<\/span>/i) ||
      html.match(/<span[^>]*class=["'][^"']*\bb\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
      html.match(/class="ellipsis">([^<]+)<\/span>/i);
    const dateMatch =
      html.match(/&#xe192;<\/i><span[^>]*class="ellipsis"[^>]*>([\s\S]*?)<\/span>/i) ||
      html.match(/<div[^>]*class="md text zoom nw f24"[^>]*>([\s\S]*?)<\/div>/i);
    const bodyMatch =
      html.match(/<div id="mail">([\s\S]*?)<\/div>\s*<\/div>\s*<\/main>/i) ||
      html.match(/<div[^>]*id=["']mail["'][^>]*>([\s\S]*?)<\/div>/i);

    const subject = decodeHtmlEntities(subjectMatch?.[1]?.trim() || '(No Subject)');
    const from = decodeHtmlEntities(fromMatch?.[1]?.trim() || 'Unknown Sender');
    const rawDate = dateMatch?.[1]?.trim();
    const date = rawDate ? safeParseDate(stripHtml(rawDate)) : Date.now();

    const rawBody = bodyMatch?.[1]?.trim() || '';
    const htmlBody = rawBody || subject;
    const textBody = stripHtml(rawBody) || subject;

    return {
      id: String(emailId),
      from: contentToString(from, 'Unknown Sender'),
      to: fullEmail,
      subject: contentToString(subject, '(No Subject)'),
      date,
      body: textBody,
      htmlBody,
      textBody,
      read: true,
      attachments: [],
    };
  }
}

export const yopmailService = new YopmailService();
