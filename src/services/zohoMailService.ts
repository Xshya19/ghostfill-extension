/**
 * Zoho Mail Service -- OAuth 2.0 & REST API integration
 *
 * Supports regional auto-detection (US/EU/IN/AU/JP/CN).
 * Uses chrome.identity.launchWebAuthFlow (implicit grant, access_token in fragment).
 *
 * Zoho API docs: https://www.zoho.com/mail/help/api/
 * OAuth docs:    https://www.zoho.com/accounts/protocol/oauth.html
 */

import type { GmailMessage } from '../types/email.types';
import {
  ZOHO_REGION_DOMAINS,
  ZOHO_SCOPES,
  getZohoOAuthBase,
  getZohoApiBase,
  type ZohoRegionDomain,
} from '../utils/core';
import { createLogger } from '../utils/logger';
import { getAliasPlusSuffix } from './gmailConnectionService';
import { storageService } from './storageService';

const log = createLogger('ZohoMailService');

const TOKEN_EXPIRY_BUFFER_MS = 60_000;
const SILENT_AUTH_BACKOFF_MS = 2 * 60_000;
const MAX_MESSAGES = 50;

// ---------- In-memory token cache ------------------------------------------

let cachedToken: string | null = null;
let tokenExpiresAt: number | null = null;
let detectedRegion: ZohoRegionDomain | null = null;
let cachedAccountId: string | null = null;
let cachedEmail: string | null = null;
let silentAuthBlockedUntil = 0;
let lastAuthFailure: string | null = null;

// ---------- Helpers ---------------------------------------------------------

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {return error.message;}
  return String(error ?? '');
}

function normalizeOAuthError(message: string): Error {
  const lower = message.toLowerCase();
  if (lower.includes('did not approve') || lower.includes('cancel')) {
    return new Error('user_cancelled');
  }
  return new Error(message || 'Zoho OAuth flow failed');
}

function isSilentAuthBackedOff(): boolean {
  return Date.now() < silentAuthBlockedUntil;
}

function recordAuthFailure(error: unknown): void {
  lastAuthFailure = getErrorMessage(error);
  silentAuthBlockedUntil = Date.now() + SILENT_AUTH_BACKOFF_MS;
  log.warn('Zoho silent auth paused temporarily', { reason: lastAuthFailure });
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
  if (!token) {throw new Error('No access_token in Zoho redirect URL');}
  return { token, expiresIn };
}

// ---------- OAuth Flow ------------------------------------------------------

async function buildZohoAuthUrl(region: ZohoRegionDomain, interactive: boolean): Promise<string> {
  const redirectUri = chrome.identity.getRedirectURL();
  const clientId = (await storageService.get('zohoClientId')) as string | null;
  if (!clientId) {
    throw new Error('Zoho Client ID not configured. Add it in Settings > Email > Zoho Mail.');
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope: ZOHO_SCOPES.join(' '),
    access_type: 'online',
    prompt: interactive ? 'consent' : 'none',
  });
  return `${getZohoOAuthBase(region)}/auth?${params.toString()}`;
}

async function launchZohoOAuth(region: ZohoRegionDomain, interactive: boolean): Promise<string> {
  const url = await buildZohoAuthUrl(region, interactive);
  return new Promise<string>((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive }, (redirectUrl) => {
      if (chrome.runtime.lastError) {
        reject(normalizeOAuthError(chrome.runtime.lastError.message ?? 'Zoho OAuth flow failed'));
        return;
      }
      if (!redirectUrl) { reject(new Error('No redirect URL from Zoho OAuth')); return; }
      try {
        const { token, expiresIn } = parseTokenFromRedirect(redirectUrl);
        cachedToken = token;
        tokenExpiresAt = Date.now() + expiresIn * 1000 - TOKEN_EXPIRY_BUFFER_MS;
        resolve(token);
      } catch (e) { reject(e); }
    });
  });
}

// ---------- Region Auto-Detection -------------------------------------------

async function detectZohoRegion(token: string): Promise<ZohoRegionDomain> {
  if (detectedRegion) {return detectedRegion;}
  const saved = await storageService.get('zohoRegion');
  if (typeof saved === 'string' && (ZOHO_REGION_DOMAINS as readonly string[]).includes(saved)) {
    detectedRegion = saved as ZohoRegionDomain;
    return detectedRegion;
  }
  for (const region of ZOHO_REGION_DOMAINS) {
    try {
      const resp = await fetch(`${getZohoApiBase(region)}/accounts`, {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      });
      if (resp.ok) {
        detectedRegion = region;
        await storageService.set('zohoRegion', region);
        log.info('Zoho region detected', { region });
        return region;
      }
    } catch { /* try next */ }
  }
  throw new Error('Could not detect your Zoho Mail region. Check your account.');
}

// ---------- Profile ---------------------------------------------------------

export interface ZohoProfile {
  accountId: string;
  email: string;
  displayName: string;
}

async function fetchZohoProfile(token: string, region: ZohoRegionDomain): Promise<ZohoProfile> {
  const resp = await fetch(`${getZohoApiBase(region)}/accounts`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  if (!resp.ok) {throw new Error(`Zoho accounts API error: ${resp.status}`);}
  const data = (await resp.json()) as {
    data?: Array<{
      accountId: string;
      emailAddress: Array<{ mailId: string; isDefault: boolean }>;
      displayName?: string;
    }>;
  };
  const account = data.data?.[0];
  if (!account) {throw new Error('No Zoho Mail account returned by API');}
  const defaultAddr = account.emailAddress.find((e) => e.isDefault) ?? account.emailAddress[0];
  if (!defaultAddr) {throw new Error('No email address in Zoho account');}
  return {
    accountId: account.accountId,
    email: defaultAddr.mailId.toLowerCase(),
    displayName: account.displayName ?? defaultAddr.mailId,
  };
}

// ---------- Token Acquisition -----------------------------------------------

export async function ensureZohoToken(interactive = false): Promise<string> {
  // tokenExpiresAt already includes the expiry buffer (set at acquisition).
  if (cachedToken && tokenExpiresAt && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }
  if (!interactive && isSilentAuthBackedOff()) {
    throw new Error(
      `Zoho silent auth paused. Reason: ${lastAuthFailure}`
    );
  }
  let token: string | null = null;
  for (const region of ZOHO_REGION_DOMAINS) {
    try {
      token = await launchZohoOAuth(region, interactive);
      detectedRegion = region;
      break;
    } catch (err) {
      if (getErrorMessage(err) === 'user_cancelled') {throw err;}
    }
  }
  if (!token) {
    if (!interactive) {recordAuthFailure(new Error('Silent Zoho OAuth failed on all regions'));}
    throw new Error('Zoho authentication failed. Connect your Zoho Mail in Settings.');
  }
  try { await chrome.storage.session.set({ zohoAccessToken: token, zohoTokenExpiry: tokenExpiresAt }); }
  catch { /* ignore */ }
  clearAuthBackoff();
  return token;
}

// ---------- Public Connect / Disconnect -------------------------------------

export async function connectZoho(): Promise<ZohoProfile> {
  const token = await ensureZohoToken(true);
  const region = await detectZohoRegion(token);
  const profile = await fetchZohoProfile(token, region);
  cachedAccountId = profile.accountId;
  cachedEmail = profile.email;
  await storageService.set('zohoConnected', true);
  await storageService.set('zohoConnectedAt', Date.now());
  await storageService.set('zohoProfile', profile);
  log.info('Zoho Mail connected', { email: profile.email, region });
  return profile;
}

export async function disconnectZoho(): Promise<void> {
  cachedToken = null; tokenExpiresAt = null; cachedAccountId = null;
  cachedEmail = null; detectedRegion = null; clearAuthBackoff();
  try { await chrome.storage.session.remove(['zohoAccessToken', 'zohoTokenExpiry']); } catch { /* ignore */ }
  await storageService.set('zohoConnected', false);
  await storageService.set('zohoConnectedAt', null);
  await storageService.set('zohoProfile', null);
  await storageService.set('zohoAliasSessions', {});
  log.info('Zoho Mail disconnected');
}

export async function getZohoConnectionStatus(): Promise<{
  connected: boolean; email: string | null; region: ZohoRegionDomain | null;
}> {
  const connected = (await storageService.get('zohoConnected')) === true;
  const profile = (await storageService.get('zohoProfile')) as ZohoProfile | null;
  const region = (await storageService.get('zohoRegion')) as ZohoRegionDomain | null;
  return { connected, email: profile?.email ?? null, region };
}

// ---------- Alias Generation ------------------------------------------------

export async function getZohoAlias(website: string, baseEmail?: string): Promise<string> {
  const base =
    baseEmail ??
    cachedEmail ??
    ((await storageService.get('zohoProfile')) as ZohoProfile | null)?.email;
  if (!base) {throw new Error('Zoho base email not available. Connect Zoho Mail first.');}
  const [localPart, domainPart] = base.split('@');
  if (!localPart || !domainPart) {throw new Error(`Invalid Zoho base email: ${base}`);}
  const tag = getAliasPlusSuffix(website);
  return `${localPart}+ghostfill-${tag}@${domainPart}`;
}

export function isZohoEmail(email: string): boolean {
  const domain = String(email).trim().toLowerCase().split('@')[1] ?? '';
  return domain.startsWith('zoho.') || domain === 'zmail.com';
}

// ---------- Inbox Search ----------------------------------------------------

export async function searchZohoInbox(alias: string, sinceMs?: number): Promise<GmailMessage[]> {
  const token = await ensureZohoToken(false);
  const region = detectedRegion ?? (await detectZohoRegion(token));
  const accountId =
    cachedAccountId ??
    ((await storageService.get('zohoProfile')) as ZohoProfile | null)?.accountId;
  if (!accountId) { log.warn('searchZohoInbox: accountId not available'); return []; }

  // Zoho search syntax (zoho.com/mail/help/search-syntax.html) uses `to:`
  // for the To field — `toAddress:` is NOT a valid search parameter and
  // silently returns nothing. `receivedTime` takes unix-ms and means
  // "received BEFORE", so recency filtering is done client-side below.
  // `includeto=true` is required — without it toAddress comes back empty
  // and alias matching is impossible.
  const searchParams = new URLSearchParams({
    searchKey: `to:${alias}`,
    start: '1',
    limit: String(MAX_MESSAGES),
    includeto: 'true',
  });

  const url = `${getZohoApiBase(region)}/accounts/${accountId}/messages/search?${searchParams.toString()}`;
  const resp = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
  if (resp.status === 401) {
    // Token dead or region wrong (e.g. user moved data centers): drop all
    // cached auth + region state so the next call re-authenticates and
    // re-detects instead of serving [] until the token "expiry".
    cachedToken = null;
    tokenExpiresAt = null;
    detectedRegion = null;
    try {
      await storageService.remove('zohoRegion');
    } catch {
      // ignore — memory state already cleared
    }
    log.warn('Zoho search 401 — cleared token/region, will re-auth next poll');
    return [];
  }
  if (!resp.ok) { log.warn('Zoho search API error', { status: resp.status }); return []; }

  const data = (await resp.json()) as {
    status?: { code?: number; description?: string };
    data?: Array<{
      messageId: string;
      fromAddress: string;
      toAddress?: string;
      subject: string;
      receivedTime: string;
      summary?: string;
      content?: string;
    }>;
  };
  if (data.status && data.status.code !== 200) {
    log.warn('Zoho search API returned non-200 status', { status: data.status });
    return [];
  }

  const parseZohoTime = (raw: unknown): number => {
    // API returns unix-ms as a STRING ("1709887053409") — new Date(str)
    // yields Invalid Date, so coerce numerically first.
    if (typeof raw === 'number' && Number.isFinite(raw)) {return raw;}
    if (typeof raw === 'string' && raw.trim().length > 0) {
      const asNum = Number(raw);
      if (Number.isFinite(asNum)) {return asNum;}
      const asDate = new Date(raw).getTime();
      if (Number.isFinite(asDate)) {return asDate;}
    }
    return Date.now();
  };

  return (data.data ?? [])
    .filter((m) => (sinceMs ? parseZohoTime(m.receivedTime) >= sinceMs : true))
    .map((m): GmailMessage => {
      const at = parseZohoTime(m.receivedTime);
      const toAddr = m.toAddress ?? alias;
      const msg: GmailMessage = {
        id: m.messageId,
        threadId: m.messageId,
        from: m.fromAddress,
        fromEmail: m.fromAddress,
        fromName: m.fromAddress,
        to: toAddr,
        subject: m.subject,
        date: at,
        dateFormatted: new Date(at).toLocaleString(),
        snippet: m.summary ?? '',
        body: m.content ?? m.summary ?? '',
        isUnread: true,
        labelIds: [],
      };
      if (m.content) {
        msg.htmlBody = m.content;
      }
      return msg;
    });
}

// ---------- Session storage restore on SW restart ---------------------------

if (typeof chrome !== 'undefined' && chrome.storage?.session) {
  chrome.storage.session.get(['zohoAccessToken', 'zohoTokenExpiry'], (res) => {
    if (res?.zohoAccessToken) {
      cachedToken = res.zohoAccessToken as string;
      tokenExpiresAt = (res.zohoTokenExpiry as number) ?? null;
      log.info('Restored Zoho access token from session storage');
    }
  });
}
