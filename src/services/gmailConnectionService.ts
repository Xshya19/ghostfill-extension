/**
 * Gmail Connection & Alias Service Consolidated Module
 *
 * Consolidates:
 * - aliasService.ts (Gmail alias generation, DOT variation trick)
 * - gmailAliasSessionService.ts (Storage and filtering of active alias sessions)
 * - gmailSessionService.ts (Zero-setup address detection via Chrome API & tab DOM injection)
 * - gmailConnectionService.ts (OAuth persistent connection management and helper utils)
 */

import { type GmailMessage, type GmailProfile } from '../types/message.types';
import { type GmailAliasSession } from '../types/storage.types';
import { createLogger } from '../utils/logger';
import { safeSendMessage } from '../utils/messaging';
import { storageService } from './storageService';

const log = createLogger('GmailConnectionService');

// ═══════════════════════════════════════════════════════════════════════
// ─── Part 1: aliasService.ts (Alias Generation Engine) ─────────────────
// ═══════════════════════════════════════════════════════════════════════

export interface AliasHistoryItem {
  alias: string;
  originalEmail: string;
  type: 'combined';
  website: string;
  createdAt: number;
}

const RESERVED_DOMAIN_LABEL = 'general';
const RANDOM_TAG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const RANDOM_TAG_LENGTH = 5;
const MAX_DOT_SLOTS = 20;

const COMMON_SECOND_LEVEL_TLDS = new Set([
  'ac',
  'co',
  'com',
  'edu',
  'gov',
  'mil',
  'net',
  'nom',
  'org',
]);

/** FNV-1a 32-bit hash — better avalanche than djb2 */
export function stringHash(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function secureRandomInt(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
    return 0;
  }

  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.getRandomValues) {
    // Non-security fallback for test/legacy contexts only.
    return Math.floor(Math.random() * maxExclusive);
  }

  // Rejection sampling avoids modulo bias.
  const maxUint32 = 0xffffffff;
  const limit = maxUint32 - (maxUint32 % maxExclusive);
  const buf = new Uint32Array(1);

  let val = 0;
  do {
    cryptoObj.getRandomValues(buf);
    val = buf[0] ?? 0;
  } while (val >= limit);

  return val % maxExclusive;
}

function secureRandomString(length: number, alphabet = RANDOM_TAG_ALPHABET): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[secureRandomInt(alphabet.length)];
  }
  return out;
}

export function getDotVariation(username: string, index: number): string {
  const clean = canonicalizeGmailUsername(username);
  const slots = clean.length - 1;
  if (slots <= 0 || index === 0) {
    return clean;
  }

  const usableSlots = Math.min(slots, MAX_DOT_SLOTS);
  const maxCombos = 1 << usableSlots; // 2^usableSlots, capped at 2^20
  const pick = Math.trunc(Math.abs(index)) % maxCombos;

  let result = '';
  for (let i = 0; i < clean.length; i++) {
    result += clean[i];
    if (i < usableSlots && (pick & (1 << i)) !== 0) {
      result += '.';
    }
  }
  return result;
}

export function isGmail(email: string): boolean {
  const parts = String(email).trim().split('@');
  if (parts.length !== 2) {
    return false;
  }
  const domain = parts[1]?.toLowerCase().trim();
  return domain === 'gmail.com' || domain === 'googlemail.com';
}

/**
 * Canonicalizes a Gmail username by lowercasing, removing dots, and stripping
 * the plus-suffix. NOTE: This intentionally strips existing plus suffixes
 * because the alias generation system will add its own. If preserving user
 * plus-suffixes is desired, use `preserveGmailUsername` instead.
 */
export function canonicalizeGmailUsername(username: string): string {
  return String(username)
    .toLowerCase()
    .replace(/\+.*$/, '')
    .replace(/\./g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** @deprecated Use canonicalizeGmailUsername instead */
export const normalizeGmailUsername = canonicalizeGmailUsername;

/** Preserves the plus-suffix for users who have existing Gmail filters */
export function preserveGmailUsername(username: string): { base: string; suffix: string | null } {
  const clean = String(username).toLowerCase().replace(/[^a-z0-9+]/g, '');
  const plusIdx = clean.indexOf('+');
  if (plusIdx >= 0) {
    return { base: clean.slice(0, plusIdx), suffix: clean.slice(plusIdx + 1) };
  }
  return { base: clean, suffix: null };
}

function parseEmail(email: string): { username: string; domain: string } | null {
  const trimmed = String(email).trim();
  // Handle quoted local parts: "user@name"@example.com
  let localPart: string;
  let domainPart: string;

  if (trimmed.startsWith('"')) {
    const endQuote = trimmed.indexOf('"', 1);
    if (endQuote > 0 && trimmed[endQuote + 1] === '@') {
      localPart = trimmed.slice(1, endQuote);
      domainPart = trimmed.slice(endQuote + 2);
    } else {
      return null;
    }
  } else {
    const atIdx = trimmed.lastIndexOf('@');
    if (atIdx <= 0 || atIdx === trimmed.length - 1) {
      return null;
    }
    localPart = trimmed.slice(0, atIdx);
    domainPart = trimmed.slice(atIdx + 1);
  }

  if (!localPart || !domainPart) {
    return null;
  }
  return { username: localPart, domain: domainPart.toLowerCase() };
}

export function normalizeAliasDomain(domain: string): string {
  const trimmed = String(domain || '')
    .trim()
    .toLowerCase();
  if (!trimmed) {
    return RESERVED_DOMAIN_LABEL;
  }

  try {
    if (/^(chrome|chrome-extension|edge|brave|about|file):/i.test(trimmed)) {
      return RESERVED_DOMAIN_LABEL;
    }

    const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return normalizeHostname(parsed.hostname);
  } catch {
    return normalizeHostname(trimmed.split(/[/?#]/)[0] || '');
  }
}

export function getAliasPlusSuffix(domain: string): string {
  const cleanDomain = normalizeAliasDomain(domain);
  const parts = cleanDomain.split('.').filter(Boolean);

  if (parts.length === 0) {
    return RESERVED_DOMAIN_LABEL;
  }

  // For subdomains like login.example.org, prefer "example" over "login"
  let brandName: string;
  if (parts.length === 1) {
    brandName = parts[0]!;
  } else {
    const secondLevel = parts[parts.length - 2];
    const isCompoundTld = secondLevel && COMMON_SECOND_LEVEL_TLDS.has(secondLevel) && secondLevel.length <= 3;
    if (parts.length > 2 && isCompoundTld) {
      brandName = parts[parts.length - 3] || RESERVED_DOMAIN_LABEL;
    } else {
      brandName = secondLevel || RESERVED_DOMAIN_LABEL;
    }
  }

  return brandName.replace(/[^a-z0-9]/g, '').slice(0, 15) || RESERVED_DOMAIN_LABEL;
}

export function getDeterministicCombinedAlias(email: string, domain: string): string {
  const parsed = parseEmail(email);
  if (!parsed || !isGmail(email)) {
    return email;
  }

  const normalizedUsername = canonicalizeGmailUsername(parsed.username);
  if (!normalizedUsername) {
    return email;
  }

  const cleanDomain = normalizeAliasDomain(domain);
  const dotPart = getDotVariation(normalizedUsername, stringHash(cleanDomain));
  const plusSuffix = getAliasPlusSuffix(cleanDomain);

  return `${dotPart}+${plusSuffix}@${parsed.domain}`;
}

export function getRandomizedGmailAlias(email: string, domain: string): string {
  const parsed = parseEmail(email);
  if (!parsed || !isGmail(email)) {
    return email;
  }

  const normalizedUsername = canonicalizeGmailUsername(parsed.username);
  if (!normalizedUsername) {
    return email;
  }

  const maxDotCombinations =
    1 << Math.min(Math.max(normalizedUsername.length - 1, 0), MAX_DOT_SLOTS);
  const randomDotIndex = secureRandomInt(maxDotCombinations);
  const dotVariedUsername = getDotVariation(normalizedUsername, randomDotIndex);

  const brandLabel = getAliasPlusSuffix(domain).slice(0, 12);
  const randomTag = secureRandomString(RANDOM_TAG_LENGTH);

  return `${dotVariedUsername}+${brandLabel}${randomTag}@${parsed.domain}`;
}

function normalizeHostname(hostname: string): string {
  return (
    String(hostname || '')
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/:\d+$/, '')
      .replace(/[^a-z0-9.-]/g, '')
      .replace(/^\.+|\.+$/g, '')
      .replace(/\.+/g, '.') || RESERVED_DOMAIN_LABEL
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ─── Part 2: gmailAliasSessionService.ts (Alias Sessions Manager) ─────
// ═══════════════════════════════════════════════════════════════════════

const ACTIVE_ALIAS_WINDOW_MS = 30 * 60 * 1000;
const MAX_ALIAS_SESSIONS = 500;
const BASELINE_GRACE_MS = 5 * 60 * 1000;
const GMAIL_ALIAS_RE = /^[a-z0-9][a-z0-9._%+-]{0,126}@(gmail\.com|googlemail\.com)$/i;

type AliasSessionMap = Record<string, GmailAliasSession>;
type AliasFactory = (originalEmail: string, normalizedWebsite: string) => string;

let aliasSessionWriteQueue: Promise<unknown> = Promise.resolve();

export function normalizeGmailAliasAddress(alias: string): string {
  return String(alias || '')
    .trim()
    .toLowerCase();
}

function assertValidGmailAliasAddress(alias: string): string {
  const normalized = normalizeGmailAliasAddress(alias);
  if (!GMAIL_ALIAS_RE.test(normalized) || normalized.includes('"') || /\s/.test(normalized)) {
    throw new Error(`Invalid Gmail alias address: ${alias}`);
  }
  return normalized;
}

function isFinitePositiveTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function sanitizeTimestamp(value: unknown, fallback: number): number {
  return isFinitePositiveTimestamp(value) ? value : fallback;
}

function normalizeWebsiteKey(website: string): string {
  return normalizeAliasDomain(website || 'general');
}

function isAliasSession(value: unknown): value is GmailAliasSession {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const session = value as Partial<GmailAliasSession>;
  return (
    typeof session.alias === 'string' &&
    GMAIL_ALIAS_RE.test(normalizeGmailAliasAddress(session.alias)) &&
    typeof session.originalEmail === 'string' &&
    typeof session.website === 'string' &&
    isFinitePositiveTimestamp(session.startedAt) &&
    isFinitePositiveTimestamp(session.lastUsedAt)
  );
}

async function readAliasSessions(): Promise<AliasSessionMap> {
  const raw = await storageService.get('gmailAliasSessions');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const clean: AliasSessionMap = {};
  for (const value of Object.values(raw as Record<string, unknown>)) {
    if (!isAliasSession(value)) {
      continue;
    }
    const alias = assertValidGmailAliasAddress(value.alias);
    clean[alias] = {
      ...value,
      alias,
      originalEmail: normalizeGmailAliasAddress(value.originalEmail),
      website: normalizeWebsiteKey(value.website),
      startedAt: sanitizeTimestamp(value.startedAt, Date.now()),
      lastUsedAt: sanitizeTimestamp(value.lastUsedAt, Date.now()),
      inboxBaselineAt: sanitizeTimestamp(value.inboxBaselineAt, value.startedAt),
    };
  }
  return clean;
}

function pruneAliasSessions(sessions: AliasSessionMap): AliasSessionMap {
  return Object.fromEntries(
    Object.entries(sessions)
      .sort(([, a], [, b]) => b.lastUsedAt - a.lastUsedAt)
      .slice(0, MAX_ALIAS_SESSIONS)
  );
}

async function enqueueAliasSessionWrite<T>(operation: () => Promise<T>): Promise<T> {
  const writePromise = aliasSessionWriteQueue.then(operation, operation);
  aliasSessionWriteQueue = writePromise.catch(() => undefined);
  return writePromise;
}

export async function getGmailConnectedAt(): Promise<number | null> {
  const connectedAt = await storageService.get('gmailConnectedAt');
  return isFinitePositiveTimestamp(connectedAt) ? connectedAt : null;
}

export async function setGmailConnectedAt(now = Date.now()): Promise<number> {
  const current = await getGmailConnectedAt();
  const connectedAt = current ?? now;
  await storageService.set('gmailConnectedAt', connectedAt);
  return connectedAt;
}

export async function clearGmailConnectedAt(): Promise<void> {
  await storageService.set('gmailConnectedAt', null);
}

function quoteGmailSearchValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function buildGmailAliasSearchQuery(alias: string, baselineMs?: number): string {
  const normalizedAlias = assertValidGmailAliasAddress(alias);
  const query = `in:anywhere to:"${quoteGmailSearchValue(normalizedAlias)}"`;

  if (Number.isFinite(baselineMs) && baselineMs! > 0) {
    return `${query} after:${Math.floor(baselineMs! / 1000)}`;
  }
  return `${query} newer_than:7d`;
}

export function getGmailAliasProcessingBaseline(session: GmailAliasSession | null): number {
  if (!session) {
    return Number.POSITIVE_INFINITY;
  }

  const startedAt = sanitizeTimestamp(session.startedAt, Date.now());
  const baseline = sanitizeTimestamp(session.inboxBaselineAt, startedAt);
  return Math.max(0, baseline - BASELINE_GRACE_MS);
}

function extractHeaderValue(headers: unknown, name: string): string {
  if (!Array.isArray(headers)) {
    return '';
  }
  const match = headers.find((header) => {
    if (!header || typeof header !== 'object') {
      return false;
    }
    const h = header as { name?: unknown };
    return typeof h.name === 'string' && h.name.toLowerCase() === name.toLowerCase();
  }) as { value?: unknown } | undefined;
  return typeof match?.value === 'string' ? match.value : '';
}

function extractEmailAddresses(text: string): string[] {
  return [...text.matchAll(/[a-z0-9._%+-]+@(gmail\.com|googlemail\.com)/gi)].map((m) =>
    normalizeGmailAliasAddress(m[0])
  );
}

export function messageMatchesGmailAlias(message: unknown, alias: string): boolean {
  const normalizedAlias = assertValidGmailAliasAddress(alias);
  const aliasAlternates = new Set([
    normalizedAlias,
    normalizedAlias.replace('@googlemail.com', '@gmail.com'),
    normalizedAlias.replace('@gmail.com', '@googlemail.com'),
  ]);

  const m = (message ?? {}) as Record<string, unknown>;
  const recipientText = [
    m.to,
    m.cc,
    m.bcc,
    m.deliveredTo,
    m.xOriginalTo,
    extractHeaderValue(m.headers, 'to'),
    extractHeaderValue(m.headers, 'cc'),
    extractHeaderValue(m.headers, 'bcc'),
    extractHeaderValue(m.headers, 'delivered-to'),
    extractHeaderValue(m.headers, 'x-original-to'),
  ]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join('\n');

  if (!recipientText) {
    return false;
  }

  return extractEmailAddresses(recipientText).some((email) => aliasAlternates.has(email));
}

export function filterMessagesForAliasSession<T extends { date: number }>(
  messages: T[],
  session: GmailAliasSession | null,
  options: { requireRecipientMatch?: boolean } = {}
): T[] {
  if (!session) {
    return [];
  }

  const baseline = getGmailAliasProcessingBaseline(session);
  const requireRecipientMatch = options.requireRecipientMatch ?? true;

  return messages.filter((message) => {
    if (!Number.isFinite(message.date) || message.date < baseline) {
      return false;
    }
    return !requireRecipientMatch || messageMatchesGmailAlias(message, session.alias);
  });
}

export async function rememberGmailAliasSession(
  alias: string,
  originalEmail: string,
  website: string,
  now = Date.now()
): Promise<GmailAliasSession> {
  const key = assertValidGmailAliasAddress(alias);
  const cleanOriginalEmail = normalizeGmailAliasAddress(originalEmail);
  const websiteKey = normalizeWebsiteKey(website);

  return enqueueAliasSessionWrite(async () => {
    const sessions = await readAliasSessions();
    const existing = sessions[key];
    const connectedAt = await getGmailConnectedAt();

    const keepExistingStart =
      !!existing &&
      existing.startedAt > 0 &&
      existing.lastUsedAt > 0 &&
      now - existing.lastUsedAt <= ACTIVE_ALIAS_WINDOW_MS;

    const startedAt = keepExistingStart ? existing!.startedAt : now;
    const inboxBaselineAt = keepExistingStart
      ? sanitizeTimestamp(existing!.inboxBaselineAt, Math.max(connectedAt ?? 0, startedAt))
      : Math.max(connectedAt ?? 0, startedAt);

    const session: GmailAliasSession = {
      alias: key,
      originalEmail: cleanOriginalEmail,
      website: websiteKey,
      startedAt,
      lastUsedAt: now,
      inboxBaselineAt,
    };

    sessions[key] = session;
    await storageService.set('gmailAliasSessions', pruneAliasSessions(sessions));
    return session;
  });
}

export async function getOrCreateGmailAliasSessionByDomain(
  originalEmail: string,
  website: string,
  createAlias: AliasFactory,
  now = Date.now()
): Promise<GmailAliasSession> {
  const cleanOriginalEmail = normalizeGmailAliasAddress(originalEmail);
  const websiteKey = normalizeWebsiteKey(website);

  return enqueueAliasSessionWrite(async () => {
    const sessions = await readAliasSessions();
    const connectedAt = await getGmailConnectedAt();
    const existing = Object.values(sessions)
      .filter((s) => s.website === websiteKey && now - s.lastUsedAt <= ACTIVE_ALIAS_WINDOW_MS)
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0];

    if (existing) {
      const touched: GmailAliasSession = { ...existing, lastUsedAt: now };
      sessions[touched.alias] = touched;
      await storageService.set('gmailAliasSessions', pruneAliasSessions(sessions));
      return touched;
    }

    const alias = assertValidGmailAliasAddress(createAlias(cleanOriginalEmail, websiteKey));
    const session: GmailAliasSession = {
      alias,
      originalEmail: cleanOriginalEmail,
      website: websiteKey,
      startedAt: now,
      lastUsedAt: now,
      inboxBaselineAt: Math.max(connectedAt ?? 0, now),
    };

    sessions[alias] = session;
    await storageService.set('gmailAliasSessions', pruneAliasSessions(sessions));
    return session;
  });
}

export async function getGmailAliasSession(alias: string): Promise<GmailAliasSession | null> {
  const key = normalizeGmailAliasAddress(alias);
  const sessions = await readAliasSessions();
  return sessions[key] ?? null;
}

export async function getGmailAliasSessionByDomain(
  domain: string
): Promise<GmailAliasSession | null> {
  const sessions = await readAliasSessions();
  const cleanDomain = normalizeWebsiteKey(domain);
  const [session] = Object.values(sessions)
    .filter((s) => s.website === cleanDomain)
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  return session ?? null;
}

export async function getMostRecentGmailAliasSession(): Promise<GmailAliasSession | null> {
  const sessions = await readAliasSessions();
  const [session] = Object.values(sessions).sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  return session ?? null;
}

export async function clearGmailAliasSessions(): Promise<void> {
  await enqueueAliasSessionWrite(async () => {
    await storageService.set('gmailAliasSessions', {});
  });
}

export function filterGmailMessagesForAliasSession(
  messages: GmailMessage[],
  session: GmailAliasSession | null
): GmailMessage[] {
  return filterMessagesForAliasSession(messages, session, { requireRecipientMatch: true });
}

// ═══════════════════════════════════════════════════════════════════════
// ─── Part 3: gmailSessionService.ts (Zero-setup account detector) ─────
// ═══════════════════════════════════════════════════════════════════════

export interface GmailSessionProfile {
  email: string;
  name?: string;
  picture?: string;
  source: 'chrome-identity' | 'gmail-tab' | 'manual';
}

export async function detectViaProfileUserInfo(): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.identity?.getProfileUserInfo) {
      resolve(null);
      return;
    }
    try {
      chrome.identity.getProfileUserInfo(
        { accountStatus: 'ANY' as chrome.identity.AccountStatus },
        (info) => {
          if (chrome.runtime.lastError) {
            log.warn('getProfileUserInfo error', chrome.runtime.lastError.message);
            resolve(null);
            return;
          }
          if (info?.email && info.email.includes('@')) {
            log.info('✅ Auto-detected Google account via Chrome identity', { email: info.email });
            resolve(info.email);
          } else {
            log.info('Chrome identity: no signed-in Google account detected');
            resolve(null);
          }
        }
      );
    } catch (e) {
      log.warn('getProfileUserInfo threw', e);
      resolve(null);
    }
  });
}

export async function detectViaGmailTab(): Promise<string | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    return null;
  }
  try {
    const gmailTabs = await chrome.tabs.query({
      url: ['https://mail.google.com/*', 'https://inbox.google.com/*'],
    });
    if (gmailTabs.length === 0) {
      log.info('No Gmail tab open — cannot detect via DOM');
      return null;
    }
    const tab = gmailTabs[0];
    if (!tab || !tab.id) {
      return null;
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const accountBtn = document.querySelector(
          '[aria-label*="@gmail.com"], [aria-label*="@googlemail.com"]'
        );
        if (accountBtn) {
          const label = accountBtn.getAttribute('aria-label') || '';
          const match = label.match(/[\w.+-]+@[\w.-]+\.\w+/);
          if (match) {
            return match[0];
          }
        }
        const metas = document.querySelectorAll('meta[name]');
        for (const meta of metas) {
          const content = meta.getAttribute('content') || '';
          const emailMatch = content.match(/[\w.+-]+@gmail\.com/i);
          if (emailMatch) {
            return emailMatch[0];
          }
        }
        const allWithAria = document.querySelectorAll('[aria-label]');
        for (const el of allWithAria) {
          const label = el.getAttribute('aria-label') || '';
          const emailMatch = label.match(/[\w.+-]+@[\w.-]+\.\w+/);
          if (emailMatch && (emailMatch[0].includes('gmail') || emailMatch[0].includes('google'))) {
            return emailMatch[0];
          }
        }
        const titleMatch = document.title.match(/[\w.+-]+@[\w.-]+\.\w+/);
        if (titleMatch) {
          return titleMatch[0];
        }
        try {
          const scripts = document.querySelectorAll('script');
          for (const s of scripts) {
            const text = s.textContent || '';
            if (text.includes('@gmail.com')) {
              const emailMatch = text.match(/"([\w.+-]+@gmail\.com)"/);
              if (emailMatch) {
                return emailMatch[1];
              }
            }
          }
        } catch {
          /* Intentionally ignored */
        }
        return null;
      },
    });
    const email = results?.[0]?.result;
    if (email && typeof email === 'string' && email.includes('@')) {
      log.info('✅ Auto-detected Gmail via tab DOM injection', { email });
      return email;
    }
    return null;
  } catch (e) {
    log.warn('Gmail tab detection failed', e);
    return null;
  }
}

export async function autoDetectGmailAccount(): Promise<GmailSessionProfile | null> {
  const chromeEmail = await detectViaProfileUserInfo();
  if (chromeEmail) {
    return { email: chromeEmail, source: 'chrome-identity' };
  }

  if (typeof chrome !== 'undefined' && chrome.tabs) {
    try {
      const gmailTabs = await chrome.tabs.query({
        url: ['https://mail.google.com/*', 'https://inbox.google.com/*'],
      });
      const tabId = gmailTabs[0]?.id;
      if (tabId) {
        const tabEmail = await detectViaGmailTab();
        if (tabEmail) {
          return { email: tabEmail, source: 'gmail-tab' };
        }
      }
    } catch (e) {
      log.warn('Tab-based session detection failed', e);
    }
  }

  log.info('All auto-detect strategies exhausted — no active Gmail session');
  return null;
}

export function openGmailCompose(opts?: { to?: string; subject?: string; body?: string }): void {
  const params = new URLSearchParams();
  if (opts?.to) {
    params.set('to', opts.to);
  }
  if (opts?.subject) {
    params.set('su', opts.subject);
  }
  if (opts?.body) {
    params.set('body', opts.body);
  }
  const url = 'https://mail.google.com/mail/?view=cm&fs=1&' + params.toString();
  chrome.tabs.create({ url }).catch(() => {
    if (typeof window !== 'undefined') {
      window.open(url, '_blank');
    } else {
      log.warn('Cannot open Gmail compose: no tabs API and no window context');
    }
  });
}

export function openGmailSearch(query: string): void {
  const url = 'https://mail.google.com/mail/u/0/#search/' + encodeURIComponent(query);
  chrome.tabs.create({ url }).catch(() => {
    if (typeof window !== 'undefined') {
      window.open(url, '_blank');
    } else {
      log.warn('Cannot open Gmail search: no tabs API and no window context');
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════
// ─── Part 4: gmailConnectionService.ts (Oauth Connection Helpers) ─────
// ═══════════════════════════════════════════════════════════════════════

export interface GmailSignInResult {
  success?: boolean;
  profile?: GmailProfile;
  error?: string;
  setupRequired?: boolean;
  authIssue?: { permanent?: boolean };
  clientIdStatus?: { blocked?: boolean };
}

export function isGmailSetupResponse(res: GmailSignInResult | undefined): boolean {
  return !!res?.setupRequired || !!res?.clientIdStatus?.blocked || !!res?.authIssue?.permanent;
}

export function formatGmailSetupError(errorText?: string): string {
  if (errorText) {
    return `${errorText} Add a valid Gmail OAuth Client ID in Options > Email.`;
  }
  return 'Gmail needs a valid OAuth Client ID in Options > Email.';
}

export async function persistGmailConnection(profile: GmailProfile, isManual: boolean): Promise<void> {
  await Promise.all([
    setGmailConnectedAt(),
    storageService.setImmediate('gmailProfile', profile),
    storageService.setImmediate('gmailBase', profile.email),
    storageService.setImmediate('gmailConnected', true),
    storageService.setImmediate('gmailIsManual', isManual),
    storageService.setImmediate('preferredEmailType', 'gmail'),
    storageService.setImmediate('inbox', []),
    clearGmailAliasSessions(),
  ]);
}

export async function clearGmailConnection(isManual: boolean): Promise<void> {
  if (!isManual) {
    try {
      await safeSendMessage({ action: 'GMAIL_SIGN_OUT' });
    } catch {
      // Ignore background communication errors on sign out
    }
  }
  await Promise.all([
    storageService.remove('gmailConnectedAt'),
    storageService.remove('gmailProfile'),
    storageService.remove('gmailBase'),
    storageService.remove('gmailConnected'),
    storageService.remove('gmailIsManual'),
    storageService.remove('inbox'),
    clearGmailAliasSessions(),
  ]);
}
