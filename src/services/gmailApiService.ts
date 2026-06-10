/**
 * Gmail API Service — Google REST API & OAuth integration
 *
 * Uses chrome.identity.launchWebAuthFlow with the BUNDLED developer client_id
 * or a user-configured custom client_id stored in chrome.storage.local.
 *
 * Calls the official Gmail REST API at:
 * https://www.googleapis.com/gmail/v1/users/me
 */
import {
  GMAIL_CLIENT_ID,
  GMAIL_SCOPES,
  GMAIL_API_BASE,
  OAUTH_USERINFO,
} from '../config/gmailConfig';
import { GmailMessage, GmailProfile } from '../types/message.types';
import type { GmailSyncStateEntry } from '../types/storage.types';
import { createLogger } from '../utils/logger';
import { storageService } from './storageService';

const log = createLogger('GmailApiService');

const TOKEN_EXPIRY_BUFFER_MS = 60_000;
const DEFAULT_TOKEN_TTL_MS = 3540 * 1000;
const SILENT_AUTH_BACKOFF_MS = 2 * 60_000;
const CLIENT_CONFIG_BACKOFF_MS = Number.POSITIVE_INFINITY;
const MAX_SYNC_CACHE_ENTRIES = 25;

export interface GmailAuthIssue {
  silentAuthBlocked: boolean;
  reason: string | null;
  retryAt: number | null;
  permanent: boolean;
}

export interface GmailClientIdStatus {
  configured: boolean;
  usingBundledClientId: boolean;
  blocked: boolean;
  reason: string | null;
}

// ─── In-memory token cache ──────────────────────────────────
// Declared before the service-worker restart recovery block below so the async
// restore callback can populate them safely (no use-before-declaration).
let cachedToken: string | null = null;
let tokenExpiresAt: number | null = null; // Unix ms
let cachedProfile: GmailProfile | null = null;
let silentAuthBlockedUntil = 0;
let lastSilentAuthFailure: string | null = null;
let silentAuthFailurePermanent = false;
let authFailureClientId: string | null = null;

// In-memory cache for parsed Gmail message details to prevent duplicate REST requests
const FULL_MESSAGE_CACHE_LIMIT = 100;
const PREVIEW_MESSAGE_CACHE_LIMIT = 250;
const GMAIL_PREVIEW_METADATA_HEADERS = [
  'Subject',
  'From',
  'To',
  'Cc',
  'Bcc',
  'Date',
  'Delivered-To',
  'X-Original-To',
  'X-Forwarded-To',
] as const;

const messageDetailsCache = new Map<string, GmailMessage>();
const messagePreviewCache = new Map<string, GmailMessage>();

function enforceCacheLimit<T>(cache: Map<string, T>, limit: number): void {
  while (cache.size > limit) {
    const firstKey = cache.keys().next().value;
    if (!firstKey) {
      break;
    }
    cache.delete(firstKey);
  }
}

function cacheMessageDetail(id: string, msg: GmailMessage): void {
  messageDetailsCache.set(id, msg);
  // A full message is also a valid preview, so hydrate both caches.
  messagePreviewCache.set(id, msg);
  enforceCacheLimit(messageDetailsCache, FULL_MESSAGE_CACHE_LIMIT);
  enforceCacheLimit(messagePreviewCache, PREVIEW_MESSAGE_CACHE_LIMIT);
}

function cacheMessagePreview(id: string, msg: GmailMessage): void {
  messagePreviewCache.set(id, msg);
  enforceCacheLimit(messagePreviewCache, PREVIEW_MESSAGE_CACHE_LIMIT);
}

// In-flight concurrent request deduplication/coalescing
const activeInboxFetches = new Map<string, Promise<GmailMessage[]>>();
const activeDetailFetches = new Map<string, Promise<GmailMessage | null>>();
const activePreviewFetches = new Map<string, Promise<GmailMessage | null>>();
const activeSyncFetches = new Map<string, Promise<GmailInboxSyncResult>>();

// ─── Client ID Management ────────────────────────────────
let activeClientId = GMAIL_CLIENT_ID;
let clientIdReadyPromise: Promise<void> = Promise.resolve();

function normalizeClientId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error ?? '');
}

function isClientConfigurationError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('bad client id') ||
    lower.includes('client id is invalid') ||
    lower.includes('invalid_client') ||
    lower.includes('unauthorized_client') ||
    lower.includes('oauth client was not found') ||
    lower.includes('client_id not configured') ||
    lower.includes('your_client_id')
  );
}

function describeAuthFailure(error: unknown): string {
  const message = getErrorMessage(error);
  if (isClientConfigurationError(message)) {
    return 'Gmail OAuth client ID is invalid. Update the Gmail client ID before reconnecting.';
  }
  if (message === 'user_cancelled') {
    return 'Google sign-in was cancelled.';
  }
  if (message.includes('No access_token') || message.includes('Not authenticated')) {
    return 'Gmail is not connected.';
  }
  return message || 'Gmail authentication failed.';
}

function isSilentAuthBackedOff(): boolean {
  return Date.now() < silentAuthBlockedUntil;
}

function clearSilentAuthBackoff(): void {
  silentAuthBlockedUntil = 0;
  lastSilentAuthFailure = null;
  silentAuthFailurePermanent = false;
  authFailureClientId = null;
}

function recordSilentAuthFailure(error: unknown, forceTemporary = false): void {
  const reason = describeAuthFailure(error);
  const permanent = !forceTemporary && isClientConfigurationError(getErrorMessage(error));
  silentAuthFailurePermanent = permanent;
  lastSilentAuthFailure = reason;
  authFailureClientId = permanent ? activeClientId : null;
  silentAuthBlockedUntil =
    Date.now() + (permanent ? CLIENT_CONFIG_BACKOFF_MS : SILENT_AUTH_BACKOFF_MS);

  if (permanent) {
    log.warn('Gmail OAuth disabled until the client ID is fixed', { reason });
  } else {
    log.debug('Gmail silent auth paused temporarily', {
      reason,
      retryAt: new Date(silentAuthBlockedUntil).toISOString(),
    });
  }
}

function isClientConfigBlocked(): boolean {
  return silentAuthFailurePermanent && authFailureClientId === activeClientId;
}

async function ensureClientIdReady(): Promise<void> {
  await clientIdReadyPromise;
}

// Initial load
if (typeof chrome !== 'undefined' && chrome.storage?.local) {
  clientIdReadyPromise = storageService
    .get('gmailClientId')
    .then((clientId) => {
      const next = normalizeClientId(clientId);
      if (next !== '') {
        activeClientId = next;
      }
    })
    .catch(() => undefined);

  // Listen for changes
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.gmailClientId) {
      storageService
        .get('gmailClientId')
        .then((clientId) => {
          activeClientId = normalizeClientId(clientId) || GMAIL_CLIENT_ID;
          cachedToken = null;
          tokenExpiresAt = null;
          cachedProfile = null;
          messageDetailsCache.clear();
          clearSilentAuthBackoff();
          try {
            void chrome.storage.session?.remove(['gmailAccessToken', 'gmailTokenExpiry']);
          } catch {
            /* Intentionally ignored */
          }
          log.info('Gmail Client ID updated dynamically');
        })
        .catch(() => undefined);
    }
  });
}

// Initial load of token from session storage (SW restart recovery)
if (typeof chrome !== 'undefined' && chrome.storage?.session) {
  chrome.storage.session.get(['gmailAccessToken', 'gmailTokenExpiry'], (res) => {
    if (res?.gmailAccessToken) {
      cachedToken = res.gmailAccessToken as string;
      tokenExpiresAt = (res.gmailTokenExpiry as number) ?? null;
      log.info('Restored Gmail access token from session storage on startup');
    }
  });
}

export function isConfigured(): boolean {
  return activeClientId !== '' && !activeClientId.includes('YOUR_CLIENT_ID');
}

function usesBundledClientId(): boolean {
  return activeClientId === GMAIL_CLIENT_ID;
}

// ─── OAuth2 via launchWebAuthFlow ────────────────────────────
function buildAuthUrl(interactive: boolean): string {
  const redirectUri = chrome.identity.getRedirectURL();
  const params = new URLSearchParams({
    client_id: activeClientId,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope: GMAIL_SCOPES.join(' '),
    // Only show account chooser on interactive; skip UI for silent refresh
    prompt: interactive ? 'select_account' : 'none',
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
}

function parseTokenFromRedirect(redirectUrl: string): { token: string; expiresIn: number } {
  const hash = new URL(redirectUrl).hash.substring(1);
  const params = new URLSearchParams(hash);
  const token = params.get('access_token');
  const expiresIn = parseInt(params.get('expires_in') ?? '3600', 10);
  if (!token) {
    throw new Error('No access_token in redirect URL');
  }
  return { token, expiresIn };
}

function normalizeOAuthError(message: string): Error {
  const lower = message.toLowerCase();
  if (lower.includes('did not approve') || lower.includes('cancel')) {
    return new Error('user_cancelled');
  }
  return new Error(message || 'OAuth flow failed');
}

async function removeCachedIdentityToken(token: string): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.identity?.removeCachedAuthToken) {
    return;
  }
  await new Promise<void>((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => {
      const errorMessage = chrome.runtime.lastError?.message;
      if (errorMessage) {
        log.debug('Failed to remove cached Chrome Identity token', { error: errorMessage });
      }
      resolve();
    });
  });
}

async function requestChromeIdentityToken(interactive: boolean): Promise<string> {
  if (!usesBundledClientId() || typeof chrome === 'undefined' || !chrome.identity?.getAuthToken) {
    throw new Error('Chrome Identity token flow is unavailable for this Gmail client.');
  }
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive, scopes: GMAIL_SCOPES }, (token) => {
      const errorMessage = chrome.runtime.lastError?.message;
      if (errorMessage) {
        reject(normalizeOAuthError(errorMessage));
        return;
      }
      if (!token) {
        reject(new Error('No OAuth token returned by Chrome Identity.'));
        return;
      }
      cachedToken = token;
      tokenExpiresAt = Date.now() + DEFAULT_TOKEN_TTL_MS - TOKEN_EXPIRY_BUFFER_MS;
      resolve(token);
    });
  });
}

async function launchOAuth(interactive: boolean): Promise<string> {
  if (activeClientId.includes('YOUR_CLIENT_ID')) {
    throw new Error('GhostFill Gmail client_id not configured. Please configure it in Settings.');
  }
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: buildAuthUrl(interactive), interactive },
      (redirectUrl) => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message ?? 'OAuth flow failed';
          reject(normalizeOAuthError(msg));
          return;
        }
        if (!redirectUrl) {
          reject(new Error('No redirect URL returned from OAuth'));
          return;
        }
        try {
          const { token, expiresIn } = parseTokenFromRedirect(redirectUrl);
          cachedToken = token;
          tokenExpiresAt = Date.now() + expiresIn * 1000 - TOKEN_EXPIRY_BUFFER_MS;
          resolve(token);
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

async function acquireToken(interactive: boolean): Promise<string> {
  if (usesBundledClientId()) {
    try {
      const token = await requestChromeIdentityToken(interactive);
      await persistToken(token);
      return token;
    } catch (error) {
      // If the user actively cancelled the interactive prompt, surface the
      // cancellation instead of immediately popping a second OAuth window.
      if (interactive && error instanceof Error && error.message === 'user_cancelled') {
        throw error;
      }
      log.debug('Chrome Identity token flow unavailable; falling back to web auth flow', error);
    }
  }
  const token = await launchOAuth(interactive);
  await persistToken(token);
  return token;
}

function isTokenExpired(): boolean {
  if (!cachedToken || !tokenExpiresAt) {
    return true;
  }
  return Date.now() >= tokenExpiresAt;
}

async function ensureValidToken(interactive = false): Promise<string> {
  await ensureClientIdReady();

  // Restore from session storage if in-memory cache was cleared (SW restart)
  if (!cachedToken) {
    try {
      const res = await chrome.storage.session.get(['gmailAccessToken', 'gmailTokenExpiry']);
      if (res?.gmailAccessToken) {
        cachedToken = res.gmailAccessToken as string;
        tokenExpiresAt = (res.gmailTokenExpiry as number) ?? null;
      }
    } catch {
      /* Intentionally ignored */
    }
  }

  if (cachedToken && !isTokenExpired()) {
    clearSilentAuthBackoff();
    return cachedToken;
  }

  if (!interactive && isSilentAuthBackedOff()) {
    throw new Error(`Gmail silent auth paused: ${lastSilentAuthFailure ?? 'not authenticated'}`);
  }

  if (!interactive) {
    try {
      if (cachedToken && isTokenExpired()) {
        log.info('Token expired - attempting silent refresh');
      }
      return await acquireToken(false);
    } catch (error) {
      recordSilentAuthFailure(error, true);
      log.debug('Silent Gmail auth failed', error);
      cachedToken = null;
      tokenExpiresAt = null;
      throw new Error('Not authenticated. Call signIn() first.');
    }
  }

  return acquireToken(true);
}

async function persistToken(token: string): Promise<void> {
  cachedToken = token;
  clearSilentAuthBackoff();
  try {
    await chrome.storage.session.set({
      gmailAccessToken: token,
      gmailTokenExpiry: tokenExpiresAt || Date.now() + DEFAULT_TOKEN_TTL_MS,
    });
  } catch {
    /* Intentionally ignored */
  }
}

// ─── REST Fetch Utility ─────────────────────────────────
async function gmailFetch<T>(path: string, options: RequestInit = {}, retried = false): Promise<T> {
  const token = await ensureValidToken(false);
  const url = path.startsWith('http') ? path : `${GMAIL_API_BASE}${path}`;

  const headers: Record<string, string> = {};
  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      headers[key] = String(value);
    }
  }
  if (options.body && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }
  headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (res.status === 401 && !retried) {
    log.warn('401 received - clearing token and retrying once');
    const staleToken = cachedToken;
    cachedToken = null;
    tokenExpiresAt = null;
    if (staleToken) {
      await removeCachedIdentityToken(staleToken).catch(() => {});
    }
    await chrome.storage.session.remove(['gmailAccessToken', 'gmailTokenExpiry']).catch(() => {});
    try {
      await acquireToken(false);
      return gmailFetch<T>(path, options, true);
    } catch {
      throw new Error('Not authenticated. Please connect your Gmail account.');
    }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gmail API ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
}

// ─── Public API ─────────────────────────────────────
export async function signIn(): Promise<GmailProfile> {
  await ensureClientIdReady();

  if (!isConfigured()) {
    throw new Error(
      'GhostFill Gmail client_id is not configured. Please configure it in Settings.'
    );
  }
  if (isClientConfigBlocked()) {
    throw new Error(
      lastSilentAuthFailure ??
        'Gmail OAuth client ID is invalid. Update the Gmail client ID before reconnecting.'
    );
  }
  log.info('Starting Gmail OAuth2 sign-in');
  clearSilentAuthBackoff();
  try {
    await acquireToken(true);
  } catch (error) {
    if (isClientConfigurationError(getErrorMessage(error))) {
      recordSilentAuthFailure(error);
    }
    throw new Error(describeAuthFailure(error));
  }
  const profile = await fetchProfile();
  cachedProfile = profile;
  log.info('Gmail sign-in successful', { email: profile.email });
  return profile;
}

export async function signOut(): Promise<void> {
  log.info('Signing out of Gmail…');
  const tokenToRevoke = cachedToken;
  if (tokenToRevoke) {
    await removeCachedIdentityToken(tokenToRevoke).catch(() => {});
    fetch('https://oauth2.googleapis.com/revoke?token=' + tokenToRevoke, { method: 'POST' }).catch(
      (e) => log.debug('Token revocation request failed (non-critical)', e)
    );
  }
  cachedToken = null;
  tokenExpiresAt = null;
  cachedProfile = null;
  clearSilentAuthBackoff();
  messageDetailsCache.clear();
  try {
    await chrome.storage.session.remove(['gmailAccessToken', 'gmailTokenExpiry']);
  } catch {
    /* Intentionally ignored */
  }
}

export function isConnected(): boolean {
  return cachedToken !== null && !isTokenExpired();
}

export function getAuthIssue(): GmailAuthIssue {
  return {
    silentAuthBlocked: isSilentAuthBackedOff(),
    reason: lastSilentAuthFailure,
    retryAt: Number.isFinite(silentAuthBlockedUntil) ? silentAuthBlockedUntil : null,
    permanent: silentAuthFailurePermanent,
  };
}

export function getClientIdStatus(): GmailClientIdStatus {
  const blocked = isClientConfigBlocked();
  return {
    configured: isConfigured(),
    usingBundledClientId: usesBundledClientId(),
    blocked,
    reason: blocked ? lastSilentAuthFailure : null,
  };
}

export function getCachedProfile(): GmailProfile | null {
  return cachedProfile;
}

export async function ensureAuthenticated(interactive = false): Promise<boolean> {
  try {
    await ensureValidToken(interactive);
    return true;
  } catch {
    return false;
  }
}

export async function checkSilentAuth(): Promise<GmailProfile | null> {
  try {
    await ensureValidToken(false);
    const profile = await fetchProfile();
    cachedProfile = profile;
    return profile;
  } catch {
    cachedToken = null;
    tokenExpiresAt = null;
    cachedProfile = null;
    return null;
  }
}

// ─── Profile ───────────────────────────────────────
export async function fetchProfile(): Promise<GmailProfile> {
  const info = await gmailFetch<{
    email: string;
    name?: string;
    picture?: string;
  }>(OAUTH_USERINFO);

  let messagesTotal: number | undefined;
  let historyId: string | undefined;
  try {
    const gp = await fetchMailboxProfile();
    messagesTotal = gp.messagesTotal;
    historyId = gp.historyId;
  } catch {
    /* Intentionally ignored */
  }

  return {
    email: info.email,
    ...(info.name ? { name: info.name } : {}),
    ...(info.picture ? { picture: info.picture } : {}),
    ...(messagesTotal !== undefined ? { messagesTotal } : {}),
    ...(historyId ? { historyId } : {}),
  };
}

// ─── Gmail REST response shapes ─────────────────────────────
interface GmailHeader {
  name: string;
  value: string;
}

interface GmailMessagePart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
}

interface GmailMessagePayload extends GmailMessagePart {
  headers?: GmailHeader[];
}

interface GmailMessageDetail {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailMessagePayload;
}

interface RESTMessageSummary {
  id: string;
  threadId: string;
}

interface RESTListMessagesResponse {
  messages?: RESTMessageSummary[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface RESTMailboxProfile {
  emailAddress?: string;
  messagesTotal?: number;
  threadsTotal?: number;
  historyId?: string;
}

interface RESTHistoryMessageRef {
  message?: RESTMessageSummary;
}

interface RESTHistoryItem {
  id?: string;
  messages?: RESTMessageSummary[];
  messagesAdded?: RESTHistoryMessageRef[];
  messagesDeleted?: RESTHistoryMessageRef[];
  labelsAdded?: RESTHistoryMessageRef[];
  labelsRemoved?: RESTHistoryMessageRef[];
}

interface RESTHistoryListResponse {
  history?: RESTHistoryItem[];
  historyId?: string;
  nextPageToken?: string;
}

export interface GmailInboxSyncResult {
  messages: GmailMessage[];
  source: 'cache' | 'full' | 'history';
  historyId?: string;
  cached: boolean;
}

type GmailSyncStateMap = Record<string, GmailSyncStateEntry>;
let syncStateWriteQueue: Promise<void> = Promise.resolve();

function normalizeSyncKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@._:-]+/g, '_')
    .slice(0, 180);
}

function makeSyncKey(query: string, alias?: string): string {
  return normalizeSyncKey(alias ? `alias:${alias}:${query}` : `query:${query}`);
}

async function readSyncState(): Promise<GmailSyncStateMap> {
  return ((await storageService.get('gmailSyncState')) as GmailSyncStateMap | null) ?? {};
}

async function writeSyncEntry(syncKey: string, entry: GmailSyncStateEntry): Promise<void> {
  const writePromise = syncStateWriteQueue.then(async () => {
    const state = await readSyncState();
    state[syncKey] = entry;

    const pruned = Object.fromEntries(
      Object.entries(state)
        .sort(([, a], [, b]) => b.syncedAt - a.syncedAt)
        .slice(0, MAX_SYNC_CACHE_ENTRIES)
    );

    await storageService.set('gmailSyncState', pruned);
  });

  syncStateWriteQueue = writePromise.catch((error) => {
    log.warn('Gmail sync-state write queue recovered after failure', error);
  });

  return writePromise;
}

function sortAndLimitMessages(messages: GmailMessage[], maxResults: number): GmailMessage[] {
  const unique = new Map<string, GmailMessage>();
  for (const message of messages) {
    unique.set(message.id, message);
  }
  return [...unique.values()].sort((a, b) => b.date - a.date).slice(0, maxResults);
}

function mergeHistoryMessages(
  cached: GmailMessage[],
  changed: GmailMessage[],
  deletedIds: Set<string>,
  maxResults: number
): GmailMessage[] {
  const byId = new Map<string, GmailMessage>();
  for (const message of cached) {
    if (!deletedIds.has(message.id)) {
      byId.set(message.id, message);
    }
  }
  for (const message of changed) {
    if (!deletedIds.has(message.id)) {
      byId.set(message.id, message);
    }
  }
  return sortAndLimitMessages([...byId.values()], maxResults);
}

function collectHistoryIds(history: RESTHistoryItem[] | undefined): {
  changedIds: Set<string>;
  deletedIds: Set<string>;
} {
  const changedIds = new Set<string>();
  const deletedIds = new Set<string>();
  const addMessage = (message?: RESTMessageSummary): void => {
    if (message?.id) {
      changedIds.add(message.id);
    }
  };
  const deleteMessage = (message?: RESTMessageSummary): void => {
    if (message?.id) {
      deletedIds.add(message.id);
      changedIds.delete(message.id);
    }
  };

  for (const item of history ?? []) {
    item.messages?.forEach(addMessage);
    item.messagesAdded?.forEach((entry) => addMessage(entry.message));
    item.labelsAdded?.forEach((entry) => addMessage(entry.message));
    item.labelsRemoved?.forEach((entry) => addMessage(entry.message));
    item.messagesDeleted?.forEach((entry) => deleteMessage(entry.message));
  }

  return { changedIds, deletedIds };
}

async function fetchMailboxProfile(): Promise<RESTMailboxProfile> {
  return gmailFetch<RESTMailboxProfile>('/profile');
}

async function fetchMailboxHistoryId(): Promise<string | undefined> {
  return (await fetchMailboxProfile()).historyId;
}

async function fetchHistoryDelta(startHistoryId: string): Promise<{
  changedIds: Set<string>;
  deletedIds: Set<string>;
  historyId?: string;
}> {
  const changedIds = new Set<string>();
  const deletedIds = new Set<string>();
  let pageToken: string | undefined;
  let latestHistoryId: string | undefined;

  do {
    const params = new URLSearchParams({
      startHistoryId,
    });
    params.append('historyTypes', 'messageAdded');
    params.append('historyTypes', 'messageDeleted');
    params.append('historyTypes', 'labelAdded');
    params.append('historyTypes', 'labelRemoved');
    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const response = await gmailFetch<RESTHistoryListResponse>(`/history?${params.toString()}`);
    const ids = collectHistoryIds(response.history);
    ids.changedIds.forEach((id) => changedIds.add(id));
    ids.deletedIds.forEach((id) => deletedIds.add(id));
    latestHistoryId = response.historyId ?? latestHistoryId;
    pageToken = response.nextPageToken;
  } while (pageToken);

  return {
    changedIds,
    deletedIds,
    ...(latestHistoryId ? { historyId: latestHistoryId } : {}),
  };
}

// ─── Parsing & Base64 Helpers ─────────────────────────────
function parseFrom(from: string): { fromName: string; fromEmail: string } {
  const match = from.match(/^(.+?)\s*<([^>]+)>$/);
  if (match?.[1] && match?.[2]) {
    return { fromName: match[1].replace(/"/g, '').trim(), fromEmail: match[2].trim() };
  }
  return { fromName: from, fromEmail: from };
}

function buildHeaderMap(headers: GmailHeader[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const header of headers) {
    const key = header.name.toLowerCase();
    const current = map.get(key);
    map.set(key, current ? `${current}, ${header.value}` : header.value);
  }
  return map;
}

function getHeaderValue(headerMap: Map<string, string>, name: string): string {
  return headerMap.get(name.toLowerCase()) ?? '';
}

function buildMetadataQueryString(headers: readonly string[]): string {
  const params = new URLSearchParams({ format: 'metadata' });
  for (const header of headers) {
    params.append('metadataHeaders', header);
  }
  return params.toString();
}

function relativeDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const diff = Date.now() - date.getTime();
    const h = diff / 3_600_000;
    if (h < 1) {
      return 'Just now';
    }
    if (h < 24) {
      return `${Math.floor(h)}h ago`;
    }
    const d = h / 24;
    if (d < 7) {
      return `${Math.floor(d)}d ago`;
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function decodeBase64Url(str: string): string {
  if (!str) {
    return '';
  }
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch (e) {
    log.warn('Failed to decode base64 body', e);
    return '';
  }
}

function getMessageBody(payload?: GmailMessagePart): string {
  if (!payload) {
    return '';
  }
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts && Array.isArray(payload.parts)) {
    const plainPart = payload.parts.find((p) => p.mimeType === 'text/plain');
    if (plainPart?.body?.data) {
      return decodeBase64Url(plainPart.body.data);
    }
    const htmlPart = payload.parts.find((p) => p.mimeType === 'text/html');
    if (htmlPart?.body?.data) {
      return decodeBase64Url(htmlPart.body.data);
    }
    for (const part of payload.parts) {
      const body = getMessageBody(part);
      if (body) {
        return body;
      }
    }
  }
  return '';
}

/**
 * Extract the HTML body specifically from MIME parts.
 * Activation links are embedded in <a href="..."> tags which only exist
 * in the text/html part. getMessageBody() prefers text/plain, so this
 * dedicated extractor ensures the link detection pipeline receives real HTML.
 */
function getMessageHtmlBody(payload?: GmailMessagePart): string {
  if (!payload) {
    return '';
  }
  // If the top-level payload IS text/html, return it directly
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts && Array.isArray(payload.parts)) {
    // Prefer the explicit text/html part
    const htmlPart = payload.parts.find((p) => p.mimeType === 'text/html');
    if (htmlPart?.body?.data) {
      return decodeBase64Url(htmlPart.body.data);
    }
    // Recurse into nested multipart structures (e.g. multipart/alternative inside multipart/mixed)
    for (const part of payload.parts) {
      const html = getMessageHtmlBody(part);
      if (html) {
        return html;
      }
    }
  }
  return '';
}

/** Map a raw Gmail REST message detail into the app's GmailMessage shape. */
function mapMessageDetail(msgDetail: GmailMessageDetail): GmailMessage {
  const headers = msgDetail.payload?.headers ?? [];
  const headerMap = buildHeaderMap(headers);

  const subject = getHeaderValue(headerMap, 'subject') || '(No Subject)';
  const fromStr = getHeaderValue(headerMap, 'from');
  const { fromName, fromEmail } = parseFrom(fromStr);
  const toStr = getHeaderValue(headerMap, 'to');
  const ccStr = getHeaderValue(headerMap, 'cc');
  const bccStr = getHeaderValue(headerMap, 'bcc');
  const deliveredTo = getHeaderValue(headerMap, 'delivered-to');
  const xOriginalTo = getHeaderValue(headerMap, 'x-original-to');
  const xForwardedTo = getHeaderValue(headerMap, 'x-forwarded-to');
  const dateHeader = getHeaderValue(headerMap, 'date');

  const internalDateMs = msgDetail.internalDate ? parseInt(msgDetail.internalDate, 10) : null;
  const dateMs =
    internalDateMs !== null && Number.isFinite(internalDateMs) && internalDateMs > 0
      ? internalDateMs
      : dateHeader
        ? new Date(dateHeader).getTime()
        : Date.now();
  const isUnread = Array.isArray(msgDetail.labelIds) && msgDetail.labelIds.includes('UNREAD');
  const body = getMessageBody(msgDetail.payload) || msgDetail.snippet || '';
  const htmlBody = getMessageHtmlBody(msgDetail.payload) || body;

  return {
    id: msgDetail.id,
    threadId: msgDetail.threadId,
    snippet: msgDetail.snippet || '',
    subject,
    from: fromStr,
    fromName,
    fromEmail,
    to: toStr,
    cc: ccStr,
    bcc: bccStr,
    deliveredTo,
    xOriginalTo,
    xForwardedTo,
    allRecipients: [toStr, ccStr, bccStr, deliveredTo, xOriginalTo, xForwardedTo]
      .filter(Boolean)
      .join(', '),
    headers: headers,
    date: dateMs,
    dateFormatted: relativeDate(dateHeader || new Date(dateMs).toISOString()),
    body,
    htmlBody,
    isUnread,
    labelIds: msgDetail.labelIds || [],
  } as GmailMessage;
}

// ─── Standard Gmail REST API Implementations ─────────────────────
async function fetchMessageDetailById(messageId: string): Promise<GmailMessage | null> {
  if (messageDetailsCache.has(messageId)) {
    return messageDetailsCache.get(messageId)!;
  }
  if (activeDetailFetches.has(messageId)) {
    return activeDetailFetches.get(messageId)!;
  }

  const detailPromise = (async () => {
    try {
      const msgDetail = await gmailFetch<GmailMessageDetail>(`/messages/${messageId}?format=full`);
      const mapped = mapMessageDetail(msgDetail);
      cacheMessageDetail(messageId, mapped);
      return mapped;
    } catch (e) {
      log.warn(`Failed to fetch message details for ${messageId}`, e);
      return null;
    } finally {
      activeDetailFetches.delete(messageId);
    }
  })();

  activeDetailFetches.set(messageId, detailPromise);
  return detailPromise;
}

async function fetchMessagePreviewById(messageId: string): Promise<GmailMessage | null> {
  // Prefer full cache if present; it already contains everything metadata needs.
  if (messageDetailsCache.has(messageId)) {
    return messageDetailsCache.get(messageId)!;
  }
  if (messagePreviewCache.has(messageId)) {
    return messagePreviewCache.get(messageId)!;
  }
  if (activePreviewFetches.has(messageId)) {
    return activePreviewFetches.get(messageId)!;
  }

  const previewPromise = (async () => {
    try {
      const qs = buildMetadataQueryString(GMAIL_PREVIEW_METADATA_HEADERS);
      const msgDetail = await gmailFetch<GmailMessageDetail>(`/messages/${messageId}?${qs}`);
      const mapped = mapMessageDetail(msgDetail);
      cacheMessagePreview(messageId, mapped);
      return mapped;
    } catch (e) {
      log.warn(`Failed to fetch message preview for ${messageId}`, e);
      return null;
    } finally {
      activePreviewFetches.delete(messageId);
    }
  })();

  activePreviewFetches.set(messageId, previewPromise);
  return previewPromise;
}

async function fetchMessagesByIds(
  messageIds: Iterable<string>,
  options: { full?: boolean } = {}
): Promise<GmailMessage[]> {
  const uniqueIds = [...new Set([...messageIds].filter(Boolean))];
  const fetcher = options.full ? fetchMessageDetailById : fetchMessagePreviewById;
  const messages = await Promise.all(uniqueIds.map(fetcher));
  return messages.filter((m): m is GmailMessage => m !== null);
}

export async function fetchInbox(
  query = 'in:inbox newer_than:3d',
  maxResults = 5,
  options: { full?: boolean } = {}
): Promise<GmailMessage[]> {
  const cacheKey = `${query}::${maxResults}::${options.full ? 'full' : 'preview'}`;
  if (activeInboxFetches.has(cacheKey)) {
    log.debug('Coalescing concurrent fetchInbox call', { query, maxResults, full: options.full });
    return activeInboxFetches.get(cacheKey)!;
  }

  const promise = (async () => {
    log.info('Fetching Gmail inbox via REST list messages', {
      query,
      maxResults,
      mode: options.full ? 'full' : 'preview',
    });
    const params = new URLSearchParams({
      q: query,
      maxResults: maxResults.toString(),
    });

    let listRes: RESTListMessagesResponse;
    try {
      listRes = await gmailFetch<RESTListMessagesResponse>(`/messages?${params.toString()}`);
    } catch (e) {
      log.error('Failed to list Gmail messages', e);
      throw e;
    }

    if (!listRes.messages?.length) {
      return [];
    }

    const messages = await fetchMessagesByIds(
      listRes.messages.map((summary) => summary.id),
      { full: Boolean(options.full) }
    );
    return messages.sort((a, b) => b.date - a.date);
  })();

  activeInboxFetches.set(cacheKey, promise);

  promise
    .finally(() => {
      activeInboxFetches.delete(cacheKey);
    })
    .catch(() => {});

  return promise;
}

export async function syncInbox(
  query = 'in:inbox newer_than:3d',
  maxResults = 5,
  options: {
    alias?: string;
    forceFull?: boolean;
    syncKey?: string;
    filterMessage?: (message: GmailMessage) => boolean;
  } = {}
): Promise<GmailInboxSyncResult> {
  const syncKey = options.syncKey ?? makeSyncKey(query, options.alias);
  const coalesceKey = `${syncKey}::${maxResults}::${options.forceFull ? 'full' : 'delta'}`;
  if (activeSyncFetches.has(coalesceKey)) {
    log.debug('Coalescing concurrent Gmail sync', { syncKey, maxResults });
    return activeSyncFetches.get(coalesceKey)!;
  }

  const syncPromise = (async (): Promise<GmailInboxSyncResult> => {
    const state = await readSyncState();
    const cachedEntry = state[syncKey];
    const cachedMessages = sortAndLimitMessages(cachedEntry?.messages ?? [], maxResults);

    const doFullSync = async (): Promise<GmailInboxSyncResult> => {
      const fetchedMessages = await fetchInbox(query, maxResults, { full: false });
      const messages = sortAndLimitMessages(
        options.filterMessage ? fetchedMessages.filter(options.filterMessage) : fetchedMessages,
        maxResults
      );
      const historyId = await fetchMailboxHistoryId().catch(() => cachedEntry?.historyId);
      await writeSyncEntry(syncKey, {
        query,
        ...(options.alias ? { alias: options.alias } : {}),
        ...(historyId ? { historyId } : {}),
        messages,
        syncedAt: Date.now(),
      });
      return {
        messages,
        source: 'full',
        ...(historyId ? { historyId } : {}),
        cached: false,
      };
    };

    if (options.forceFull || !cachedEntry?.historyId) {
      return doFullSync();
    }

    try {
      const delta = await fetchHistoryDelta(cachedEntry.historyId);
      const changedMessages = options.filterMessage
        ? (await fetchMessagesByIds(delta.changedIds, { full: false })).filter(
            options.filterMessage
          )
        : await fetchMessagesByIds(delta.changedIds, { full: false });
      const messages = mergeHistoryMessages(
        cachedMessages,
        changedMessages,
        delta.deletedIds,
        maxResults
      );
      const historyId = delta.historyId ?? cachedEntry.historyId;

      await writeSyncEntry(syncKey, {
        query,
        ...(options.alias ? { alias: options.alias } : {}),
        historyId,
        messages,
        syncedAt: Date.now(),
      });

      return {
        messages,
        source: delta.changedIds.size > 0 || delta.deletedIds.size > 0 ? 'history' : 'cache',
        historyId,
        cached: delta.changedIds.size === 0 && delta.deletedIds.size === 0,
      };
    } catch (error) {
      const message = getErrorMessage(error);
      if (message.includes('404') || message.toLowerCase().includes('history')) {
        log.info('Gmail history cursor expired; falling back to full sync', { syncKey });
        return doFullSync();
      }
      if (cachedMessages.length > 0) {
        log.warn('Gmail incremental sync failed; serving cached inbox', {
          syncKey,
          error: message,
        });
        return {
          messages: cachedMessages,
          source: 'cache',
          historyId: cachedEntry.historyId,
          cached: true,
        };
      }
      throw error;
    }
  })();

  activeSyncFetches.set(coalesceKey, syncPromise);
  syncPromise
    .finally(() => {
      activeSyncFetches.delete(coalesceKey);
    })
    .catch(() => {});

  return syncPromise;
}

export async function fetchMessage(messageId: string): Promise<GmailMessage & { body: string }> {
  log.info('Fetching message via REST get message', { messageId });
  const mapped = await fetchMessageDetailById(messageId);
  if (!mapped) {
    throw new Error('Gmail message could not be fetched');
  }
  return mapped as GmailMessage & { body: string };
}

export async function searchInbox(query: string, maxResults = 15): Promise<GmailMessage[]> {
  return (await syncInbox(query, maxResults, { forceFull: false })).messages;
}

/**
 * sendEmail / createDraft / modifyEmail are intentionally omitted: GhostFill runs
 * under the gmail.readonly scope, so write operations would return 403.
 */
export async function listLabels(): Promise<Array<{ id: string; name: string; type: string }>> {
  log.info('Listing labels via REST labels API');
  const res = await gmailFetch<{
    labels?: Array<{ id: string; name: string; type?: string }>;
  }>('/labels');
  return (res.labels ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    type: l.type || 'user',
  }));
}
