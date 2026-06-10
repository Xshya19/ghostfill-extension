import { GmailMessage } from '../types/message.types';
import { GmailAliasSession } from '../types/storage.types';
import { normalizeAliasDomain } from './aliasService';
import { storageService } from './storageService';

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

/** Read the alias-session map from storage, dropping malformed/stale entries safely. */
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

/**
 * Atomically reuse the active alias for a domain, or create a new one inside
 * the write queue. Use this for GET_IDENTITY to avoid two concurrent content
 * scripts creating two different aliases for the same website.
 */
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
