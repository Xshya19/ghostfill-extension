/**
 * Microsoft Mail Service -- OAuth 2.0 (Microsoft Identity Platform) & Graph API
 *
 * Reads Outlook / Hotmail / Live inboxes via Microsoft Graph REST API.
 * Uses chrome.identity.launchWebAuthFlow with the implicit grant flow
 * (access_token returned in the redirect fragment -- no server needed).
 *
 * MS Identity docs: https://docs.microsoft.com/en-us/azure/active-directory/develop/
 * Graph API docs:   https://docs.microsoft.com/en-us/graph/api/message-list
 */

import type { GmailMessage } from '../types/email.types';
import {
  MICROSOFT_OAUTH_BASE,
  MICROSOFT_GRAPH_BASE,
  MICROSOFT_SCOPES,
  MICROSOFT_DOMAINS,
} from '../utils/core';
import { createLogger } from '../utils/logger';
import { getAliasPlusSuffix } from './gmailConnectionService';
import { storageService } from './storageService';

const log = createLogger('MicrosoftMailService');

const TOKEN_EXPIRY_BUFFER_MS = 60_000;
const SILENT_AUTH_BACKOFF_MS = 2 * 60_000;
const MAX_MESSAGES = 50;

// ---------- In-memory token cache ------------------------------------------

let cachedToken: string | null = null;
let tokenExpiresAt: number | null = null;
let silentAuthBlockedUntil = 0;
let lastAuthFailure: string | null = null;

// ---------- Helpers ---------------------------------------------------------

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {return error.message;}
  return String(error ?? '');
}

function normalizeOAuthError(message: string): Error {
  const lower = message.toLowerCase();
  if (lower.includes('did not approve') || lower.includes('cancel') || lower.includes('access_denied')) {
    return new Error('user_cancelled');
  }
  return new Error(message || 'Microsoft OAuth flow failed');
}

function isSilentAuthBackedOff(): boolean {
  return Date.now() < silentAuthBlockedUntil;
}

function recordAuthFailure(error: unknown): void {
  lastAuthFailure = getErrorMessage(error);
  silentAuthBlockedUntil = Date.now() + SILENT_AUTH_BACKOFF_MS;
  log.warn('Microsoft silent auth paused', { reason: lastAuthFailure });
}

function clearAuthBackoff(): void {
  silentAuthBlockedUntil = 0;
  lastAuthFailure = null;
}

function parseTokenFromRedirect(redirectUrl: string): { token: string; expiresIn: number } {
  const hash = new URL(redirectUrl).hash.substring(1);
  const params = new URLSearchParams(hash);
  const token = params.get('access_token');
  const expiresIn = parseInt(params.get('expires_in') ?? '3600', 10);
  if (!token) {throw new Error('No access_token in Microsoft redirect URL');}
  return { token, expiresIn };
}

// ---------- OAuth Flow ------------------------------------------------------

async function buildMicrosoftAuthUrl(interactive: boolean): Promise<string> {
  const redirectUri = chrome.identity.getRedirectURL();
  const clientId = (await storageService.get('microsoftClientId')) as string | null;
  if (!clientId) {
    throw new Error(
      'Microsoft Client ID not configured. Add it in Settings > Email > Microsoft Outlook.'
    );
  }
  // Implicit grant (no server): response_type=token
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope: MICROSOFT_SCOPES.join(' '),
    prompt: interactive ? 'select_account' : 'none',
  });
  return `${MICROSOFT_OAUTH_BASE}/authorize?${params.toString()}`;
}

async function launchMicrosoftOAuth(interactive: boolean): Promise<string> {
  const url = await buildMicrosoftAuthUrl(interactive);
  return new Promise<string>((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive }, (redirectUrl) => {
      if (chrome.runtime.lastError) {
        reject(normalizeOAuthError(chrome.runtime.lastError.message ?? 'Microsoft OAuth failed'));
        return;
      }
      if (!redirectUrl) { reject(new Error('No redirect URL from Microsoft OAuth')); return; }
      try {
        const { token, expiresIn } = parseTokenFromRedirect(redirectUrl);
        cachedToken = token;
        tokenExpiresAt = Date.now() + expiresIn * 1000 - TOKEN_EXPIRY_BUFFER_MS;
        resolve(token);
      } catch (e) { reject(e); }
    });
  });
}

// ---------- Profile ---------------------------------------------------------

export interface MicrosoftProfile {
  email: string;
  displayName: string;
  userId: string;
}

async function fetchMicrosoftProfile(token: string): Promise<MicrosoftProfile> {
  const resp = await fetch(`${MICROSOFT_GRAPH_BASE}/me?$select=id,displayName,mail,userPrincipalName`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {throw new Error(`Microsoft Graph /me error: ${resp.status}`);}
  const data = (await resp.json()) as {
    id: string;
    displayName?: string;
    mail?: string;
    userPrincipalName?: string;
  };
  const email = (data.mail ?? data.userPrincipalName ?? '').toLowerCase();
  if (!email) {throw new Error('No email returned from Microsoft Graph /me');}
  return { userId: data.id, email, displayName: data.displayName ?? email };
}

// ---------- Token Acquisition -----------------------------------------------

export async function ensureMicrosoftToken(interactive = false): Promise<string> {
  // tokenExpiresAt already includes the expiry buffer (set at acquisition).
  if (cachedToken && tokenExpiresAt && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }
  if (!interactive && isSilentAuthBackedOff()) {
    throw new Error(`Microsoft silent auth paused. Reason: ${lastAuthFailure}`);
  }
  let token: string;
  try {
    token = await launchMicrosoftOAuth(interactive);
  } catch (err) {
    if (!interactive) {recordAuthFailure(err);}
    throw err;
  }
  try { await chrome.storage.session.set({ msAccessToken: token, msTokenExpiry: tokenExpiresAt }); }
  catch { /* ignore */ }
  clearAuthBackoff();
  return token;
}

// ---------- Public Connect / Disconnect -------------------------------------

export async function connectMicrosoft(): Promise<MicrosoftProfile> {
  const token = await ensureMicrosoftToken(true);
  const profile = await fetchMicrosoftProfile(token);
  await storageService.set('microsoftConnected', true);
  await storageService.set('microsoftConnectedAt', Date.now());
  await storageService.set('microsoftProfile', profile);
  log.info('Microsoft Mail connected', { email: profile.email });
  return profile;
}

export async function disconnectMicrosoft(): Promise<void> {
  cachedToken = null; tokenExpiresAt = null; clearAuthBackoff();
  try { await chrome.storage.session.remove(['msAccessToken', 'msTokenExpiry']); } catch { /* ignore */ }
  await storageService.set('microsoftConnected', false);
  await storageService.set('microsoftConnectedAt', null);
  await storageService.set('microsoftProfile', null);
  await storageService.set('microsoftAliasSessions', {});
  log.info('Microsoft Mail disconnected');
}

export async function getMicrosoftConnectionStatus(): Promise<{
  connected: boolean; email: string | null;
}> {
  const connected = (await storageService.get('microsoftConnected')) === true;
  const profile = (await storageService.get('microsoftProfile')) as MicrosoftProfile | null;
  return { connected, email: profile?.email ?? null };
}

// ---------- Alias Generation ------------------------------------------------

export async function getMicrosoftAlias(website: string, baseEmail?: string): Promise<string> {
  const base =
    baseEmail ??
    ((await storageService.get('microsoftProfile')) as MicrosoftProfile | null)?.email;
  if (!base) {throw new Error('Microsoft base email not available. Connect Outlook first.');}
  const [localPart, domainPart] = base.split('@');
  if (!localPart || !domainPart) {throw new Error(`Invalid Microsoft base email: ${base}`);}
  const tag = getAliasPlusSuffix(website);
  return `${localPart}+ghostfill-${tag}@${domainPart}`;
}

export function isMicrosoftEmail(email: string): boolean {
  const domain = String(email).trim().toLowerCase().split('@')[1] ?? '';
  return MICROSOFT_DOMAINS.has(domain);
}

// ---------- Inbox Search ----------------------------------------------------

/**
 * Searches the Outlook inbox for messages delivered to the given alias address
 * since `sinceMs`. Uses OData $filter on toRecipients.
 * Returns messages in the GmailMessage shape for downstream OTP extraction.
 */
export async function searchMicrosoftInbox(
  alias: string,
  sinceMs?: number
): Promise<GmailMessage[]> {
  const token = await ensureMicrosoftToken(false);

  // OData string escaping: a single quote in the alias must be doubled,
  // otherwise Graph 400s and the poller serves silent [].
  const safeAlias = alias.replace(/'/g, "''");
  const aliasFilter = `toRecipients/any(r:r/emailAddress/address eq '${safeAlias}')`;
  const sinceFilter = sinceMs
    ? ` and receivedDateTime gt ${new Date(sinceMs).toISOString()}`
    : '';
  const filter = encodeURIComponent(`${aliasFilter}${sinceFilter}`);

  const select = 'id,conversationId,from,toRecipients,subject,receivedDateTime,bodyPreview,body,isRead';
  const url = `${MICROSOFT_GRAPH_BASE}/me/messages?$filter=${filter}&$select=${select}&$top=${MAX_MESSAGES}&$orderby=receivedDateTime desc`;

  // ConsistencyLevel: eventual is required by Graph for $filter over
  // collection-valued address properties (toRecipients/any). Harmless
  // where not needed; without it Graph can 400 the query.
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: 'eventual' },
  });
  if (resp.status === 401) {
    // Revoked/expired token: drop the cache now instead of serving [] until
    // the nominal expiry. Next poll re-authenticates (or backs off loudly).
    cachedToken = null;
    tokenExpiresAt = null;
    log.warn('Microsoft Graph 401 — cleared token cache');
    return [];
  }
  if (!resp.ok) {
    log.warn('Microsoft Graph messages error', { status: resp.status });
    return [];
  }

  const data = (await resp.json()) as {
    value?: Array<{
      id: string;
      conversationId: string;
      from: { emailAddress: { address: string } };
      toRecipients: Array<{ emailAddress: { address: string } }>;
      subject: string;
      receivedDateTime: string;
      bodyPreview: string;
      body: { content: string; contentType: string };
      isRead: boolean;
    }>;
  };

  return (data.value ?? []).map((m): GmailMessage => {
    const fromAddr = m.from?.emailAddress?.address ?? '';
    const at = Number.isFinite(new Date(m.receivedDateTime).getTime())
      ? new Date(m.receivedDateTime).getTime()
      : Date.now();
    const msg: GmailMessage = {
      id: m.id,
      threadId: m.conversationId,
      from: fromAddr,
      fromEmail: fromAddr,
      fromName: fromAddr,
      to: m.toRecipients?.map((r) => r.emailAddress.address).join(', ') ?? '',
      subject: m.subject ?? '',
      date: at,
      dateFormatted: m.receivedDateTime,
      snippet: m.bodyPreview ?? '',
      body: m.body?.content ?? m.bodyPreview ?? '',
      isUnread: !m.isRead,
      labelIds: [],
    };
    if (m.body?.contentType === 'html' && m.body.content) {
      msg.htmlBody = m.body.content;
    }
    return msg;
  });
}

// ---------- Session storage restore on SW restart ---------------------------

if (typeof chrome !== 'undefined' && chrome.storage?.session) {
  chrome.storage.session.get(['msAccessToken', 'msTokenExpiry'], (res) => {
    if (res?.msAccessToken) {
      cachedToken = res.msAccessToken as string;
      tokenExpiresAt = (res.msTokenExpiry as number) ?? null;
      log.info('Restored Microsoft access token from session storage');
    }
  });
}
