import { emailService } from '../services/emailServices';
import * as gmailApiService from '../services/gmailApiService';
import {
  getRandomizedGmailAlias,
  buildGmailAliasSearchQuery,
  clearGmailConnectedAt,
  clearGmailAliasSessions,
  filterGmailMessagesForAliasSession,
  getGmailAliasProcessingBaseline,
  getGmailAliasSession,
  getMostRecentGmailAliasSession,
  rememberGmailAliasSession,
  setGmailConnectedAt,
  messageMatchesGmailAlias,
} from '../services/gmailConnectionService';
import { identityService } from '../services/identityService';
import { extractAll } from '../services/intelligentExtractor';
import { linkService } from '../services/linkService';
import {
  connectMicrosoft,
  disconnectMicrosoft,
  getMicrosoftConnectionStatus,
  getMicrosoftAlias,
  searchMicrosoftInbox,
} from '../services/microsoftMailService';
import { otpService } from '../services/otpService';
import { passwordService } from '../services/passwordService';
import { storageService } from '../services/storageService';
import {
  connectZoho,
  disconnectZoho,
  getZohoConnectionStatus,
  getZohoAlias,
  searchZohoInbox,
} from '../services/zohoMailService';
import {
  ExtensionMessage,
  ExtensionResponse,
  LastOTP,
  PasswordHistoryItem,
  GmailProfile,
  GmailMessage,
  EmailAccount,
} from '../types';
import { DEFAULT_SETTINGS } from '../types/storage.types';
import { createLogger, diag } from '../utils/logger';
import { safeSendTabMessage } from '../utils/messaging';
import { validateMessage } from '../utils/validation';
import {
  isActivationTab,
  onContentScriptReady,
} from './activationRegistry';
import { updateOTPMenuItem } from './contextMenu';
import { ensureInitialized } from './initGuard';
import { notifySuccess, notifyError, resetNotificationSession } from './notifications';
import {
  startEmailPolling,
  startFastOTPPolling,
  stopFastOTPPolling,
  startFastWatchBurst,
  recordEmailReceived,
  getOTPWaitingTabs,
  resetEmailSession,
  suppressNextEmailTypeTransition,
  startGmailAliasFastPolling,
  extractEmailOnce,
  deliverOTP,
  type EmailContext,
} from './pollingManager';
import { getBootState } from './serviceWorker';
import { sseManager } from './sseManager';

const log = createLogger('MessageHandler');
let gmailInboxFetchSeq = 0;

function invalidateGmailInboxFetches(): void {
  gmailInboxFetchSeq += 1;
}

const HANDLED_MESSAGE_ACTIONS = [
  'GET_CURRENT_EMAIL',
  'GENERATE_EMAIL',
  'GENERATE_GMAIL_ALIAS',
  'CHECK_INBOX',
  'READ_EMAIL',
  'GET_EMAIL_HISTORY',
  'GET_PROVIDER_HEALTH',
  'GET_LAST_OTP',
  'MARK_OTP_USED',
  'CHECK_OTP_NOW',
  'CHECK_OTP_FRESHNESS',
  'WAIT_FOR_FRESH_OTP',
  'OTP_PAGE_DETECTED',
  'OTP_PAGE_LEFT',
  'REGISTRATION_FORM_SUBMITTED',
  'EXTRACT_OTP',
  'GENERATE_PASSWORD',
  'GET_PASSWORD_HISTORY',
  'SAVE_PASSWORD',
  'DELETE_PASSWORD',
  'GET_IDENTITY',
  'GENERATE_IDENTITY',
  'REFRESH_IDENTITY',
  'ANALYZE_DOM',
  'SHOW_NOTIFICATION',
  'GET_SETTINGS',
  'UPDATE_SETTINGS',
  'CLEAR_DATA',
  'OPEN_OPTIONS',
  'LINK_ACTIVATED',
  'SHOW_FLOATING_BUTTON',
  'HIDE_FLOATING_BUTTON',
  'PING',
  'FALLBACK_DOMAINS_USED',
  'GET_DIAGNOSTIC_REPORT',
  'GMAIL_GET_STATUS',
  'GMAIL_SIGN_IN',
  'GMAIL_SIGN_OUT',
  'GMAIL_FETCH_INBOX',
  'GMAIL_GET_MESSAGE',
  'GMAIL_SEARCH',
  'GMAIL_LIST_LABELS',
  // Zoho Mail
  'ZOHO_GET_STATUS',
  'ZOHO_CONNECT',
  'ZOHO_DISCONNECT',
  'ZOHO_GENERATE_ALIAS',
  'ZOHO_SEARCH_INBOX',
  // Microsoft Outlook
  'MICROSOFT_GET_STATUS',
  'MICROSOFT_CONNECT',
  'MICROSOFT_DISCONNECT',
  'MICROSOFT_GENERATE_ALIAS',
  'MICROSOFT_SEARCH_INBOX',
  // Polling pipeline state (tab-bound; background never routes it, but the
  // registry must know it so stats/validation don't report it as unknown)
  'POLLING_STATE_CHANGE',
  // Link activation
  'ACTIVATE_LINK',
] as const satisfies readonly ExtensionMessage['action'][];

type ExtractOTPPayloadWithMetadata = Record<string, unknown> & {
  subject?: string;
  source?: string;
  emailFrom?: string;
  emailDate?: number;
  emailId?: string | number;
  saveToLastOTP?: boolean;
};

function getPayloadTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

function normalizeEmailOTP(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const clean = value.replace(/[-\s]/g, '').trim();
  if (clean.length < 4 || clean.length > 10) {
    return null;
  }
  if (!/^[A-Za-z0-9]+$/.test(clean)) {
    return null;
  }

  return clean;
}

function isGmailOAuthSetupError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('client id') ||
    lower.includes('client_id') ||
    lower.includes('invalid_client') ||
    lower.includes('unauthorized_client') ||
    lower.includes('oauth client')
  );
}

function getGmailAuthSetupState(errorMessage = ''): {
  authIssue: gmailApiService.GmailAuthIssue;
  clientIdStatus: gmailApiService.GmailClientIdStatus;
  setupRequired: boolean;
} {
  const authIssue = gmailApiService.getAuthIssue();
  const clientIdStatus = gmailApiService.getClientIdStatus();
  return {
    authIssue,
    clientIdStatus,
    setupRequired:
      clientIdStatus.blocked || authIssue.permanent || isGmailOAuthSetupError(errorMessage),
  };
}

async function ensureGmailAuthenticated(): Promise<boolean> {
  return gmailApiService.ensureAuthenticated(false);
}

function messagePredatesGmailSession(
  messageDate: number,
  session: Awaited<ReturnType<typeof getMostRecentGmailAliasSession>>
): boolean {
  return messageDate < getGmailAliasProcessingBaseline(session);
}

async function saveExtractedOTPFromMessage(
  code: string,
  confidence: number,
  payload: ExtractOTPPayloadWithMetadata
): Promise<void> {
  const emailDate = getPayloadTimestamp(payload.emailDate);
  const existing = (await storageService.get('lastOTP')) as LastOTP | undefined;
  const existingDate = existing?.emailDate ?? existing?.extractedAt;

  if (
    existing?.code === code &&
    ((payload.emailId !== undefined && existing.emailId === payload.emailId) ||
      (emailDate !== undefined && existing.emailDate === emailDate))
  ) {
    log.debug('Skipping duplicate popup-extracted OTP save');
    return;
  }

  if (emailDate && existingDate && existingDate > emailDate) {
    log.debug('Skipping older popup-extracted OTP so it cannot overwrite the latest code', {
      emailDate,
      existingDate,
    });
    return;
  }

  const metadata: { emailId?: string | number; emailDate?: number } = {};
  if (payload.emailId !== undefined) {
    metadata.emailId = payload.emailId;
  }
  if (emailDate !== undefined) {
    metadata.emailDate = emailDate;
  }

  const result = await otpService.saveLastOTP(
    code,
    'email',
    typeof payload.emailFrom === 'string' ? payload.emailFrom : undefined,
    typeof payload.subject === 'string' ? payload.subject : undefined,
    confidence,
    metadata
  );

  if (result.saved) {
    await updateOTPMenuItem().catch((error) => {
      log.debug('OTP context menu update failed after popup extraction', error);
    });
    log.info('✅ Popup-extracted OTP saved for page fill');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// activateDetectedLink
//
// Permanent, typed activation path shared by:
//   - EXTRACT_OTP handler (popup opens email containing a link)
//   - ACTIVATE_LINK handler (popup explicit "Open Link" button)
//
// Mirrors the polling engine flow exactly:
//   1. Read autoConfirmLinks from settings
//   2. Fetch current account for dedup keying
//   3. Build a properly-typed Email object
//   4. Delegate to linkService.handleDetectedLink() with full security gate
// ─────────────────────────────────────────────────────────────────────────────
async function activateDetectedLink(params: {
  emailId: string | number;
  linkUrl: string;
  emailFrom?: string;
  subject?: string;
  emailDate?: number;
  bodySnippet?: string;
}): Promise<void> {
  const rawSettings = await storageService.get('settings');
  const autoConfirm = rawSettings?.autoConfirmLinks ?? DEFAULT_SETTINGS.autoConfirmLinks;
  if (!autoConfirm) {
    log.info('⏭️ autoConfirmLinks disabled — skipping link activation', {
      emailId: params.emailId,
    });
    return;
  }

  const currentAccount = await emailService.getCurrentEmail().catch(() => null);
  const accountId = currentAccount?.fullEmail;

  // Construct a properly-typed Email so linkService can deduplicate,
  // validate, and record the activation cleanly.
  const email: import('../types').Email = {
    id: params.emailId,
    subject: params.subject || '',
    from: params.emailFrom || '',
    body: params.bodySnippet || '',
    htmlBody: '',
    to: accountId || '',
    date: params.emailDate ?? Date.now(),
    attachments: [],
    read: true,
  };

  log.info('🔗 Delegating activation link to linkService (popup path)', {
    emailId: params.emailId,
    url: params.linkUrl.substring(0, 60),
  });

  await linkService.handleDetectedLink(email, params.linkUrl, accountId);
}


/**
 * Main message router for the background script.
 * Handles all core extension actions from popup and content scripts.
 */
let hasRegistered = false;
const lastProcessedMessageHashes = new Map<string, number>();

const HIGH_PRIORITY_ACTIONS = new Set([
  'PING',
  'OTP_PAGE_DETECTED',
  'CHECK_OTP_NOW',
  'GMAIL_GET_STATUS',
  // Connect/disconnect are user mutations — a double-click must never be
  // swallowed as a "duplicate" and answered with a fake success.
  'ZOHO_CONNECT',
  'ZOHO_DISCONNECT',
  'ZOHO_GET_STATUS',
  'MICROSOFT_CONNECT',
  'MICROSOFT_DISCONNECT',
  'MICROSOFT_GET_STATUS',
  // Data-returning reads: a dedup hit answers {success:true} with NO data
  // fields, which callers treat as success and render as errors/empties.
  // Re-fetching is always cheaper than a fake success, so never dedup these.
  'READ_EMAIL',
  'EXTRACT_OTP',
  'GMAIL_FETCH_INBOX',
  'GMAIL_GET_MESSAGE',
  'ZOHO_SEARCH_INBOX',
  'MICROSOFT_SEARCH_INBOX',
  // One-shot signals whose loss changes behavior (missed burst, missed link
  // open, missed analysis result, missed fallback signal).
  'REGISTRATION_FORM_SUBMITTED',
  'ANALYZE_DOM',
  'ACTIVATE_LINK',
  'FALLBACK_DOMAINS_USED',
]);

const MAX_DEDUP_HASH_AGE_MS = 2000;
const _MAX_DEDUP_MAP_SIZE = 100;

function getPayloadFingerprint(payload: any): string {
  if (!payload || typeof payload !== 'object') {return '';}
  // GRANDMASTER FIX: Only hash stable, small identifiers.
  // NEVER stringify HTML, DOM, or Email bodies.
  // Every data-affecting field must be listed: omitting one (e.g. linkUrl,
  // query, sinceMs) collapses DISTINCT requests into one hash and drops real
  // work as "duplicate".
  const keys = [
    'emailId', 'url', 'domain', 'service', 'messageId', 'alias', 'website',
    'linkUrl', 'query', 'sinceMs', 'title', 'message', 'maxResults',
    'timestamp', 'id', 'email', 'state',
  ];
  const parts = [];
  for (const k of keys) {
    if (payload[k] !== undefined) {parts.push(`${k}:${payload[k]}`);}
  }
  return parts.join('|');
}

function isMessageDuplicate(message: ExtensionMessage): boolean {
  // Never deduplicate reads/queries, high priority actions, or explicit user mutation/generation actions
  if (
    HIGH_PRIORITY_ACTIONS.has(message.action) ||
    message.action.startsWith('GET_') ||
    message.action.startsWith('CHECK_') ||
    message.action.startsWith('GENERATE_') ||
    message.action.startsWith('UPDATE_') ||
    message.action.startsWith('SAVE_') ||
    message.action.startsWith('DELETE_') ||
    message.action.startsWith('FILL_') ||
    message.action.startsWith('REFRESH_') ||
    message.action.startsWith('GMAIL_SIGN_')
  ) {
    return false;
  }
  try {
    // GRANDMASTER FIX: O(1) memory allocation. No JSON.stringify.
    const hash = `${message.action}:${getPayloadFingerprint((message as any).payload)}`;
    const now = Date.now();

    // Continuously prune expired entries to maintain minimal memory footprint
    for (const [k, ts] of lastProcessedMessageHashes.entries()) {
      if (now - ts > MAX_DEDUP_HASH_AGE_MS) {
        lastProcessedMessageHashes.delete(k);
      }
    }

    const lastTime = lastProcessedMessageHashes.get(hash);
    if (lastTime && now - lastTime < 500) {
      return true;
    }
    lastProcessedMessageHashes.set(hash, now);
    return false;
  } catch {
    return false;
  }
}

/**
 * Message types used for internal extension-to-extension transport.
 *
 * These are not user-facing "actions" — they are pushed by the offscreen SSE
 * relay (and the offscreen health ping). They are consumed directly by
 * sseManager / offscreenManager, so they must bypass the action router, which
 * would otherwise reject them as invalid actions and log a warning on every
 * single email event.
 */
const INTERNAL_TRANSPORT_TYPES = new Set<string>([
  'SSE_EMAIL_EVENT',
  'SSE_RELAY_OPEN',
  'SSE_RELAY_CLOSED',
  'SSE_RELAY_FAILED',
  'HEALTH_PING',
]);

function isInternalTransportMessage(message: unknown): boolean {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const { type } = message as { type?: unknown };
  return typeof type === 'string' && INTERNAL_TRANSPORT_TYPES.has(type);
}

export function setupMessageHandler(): void {
  // CRITICAL FIX: Prevent double registration which causes multiple response bugs
  if (hasRegistered) {
    return;
  }
  hasRegistered = true;

  chrome.runtime.onMessage.addListener(
    (
      message: ExtensionMessage,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: ExtensionResponse) => void
    ): boolean => {
      // P0.5: Origin validation - ensure messages only come from extension components
      if (sender.id !== chrome.runtime.id) {
        log.warn('Blocked message from unauthorized origin', { id: sender.id, url: sender.url });
        sendResponse({ success: false, error: 'Unauthorized origin' });
        return false;
      }

      // Internal transport traffic is handled by its own listeners.
      if (isInternalTransportMessage(message)) {
        return false;
      }

      if (isMessageDuplicate(message)) {
        log.info(`📩 [MessageHandler] Blocked duplicate message: "${message.action}"`);
        sendResponse({ success: true, duplicated: true } as any);
        return false;
      }

      log.debug(
        `📩 "${message.action}" from tab=${sender.tab?.id ?? 'bg'}`
      );

      const wrappedSendResponse = (response: ExtensionResponse) => {
        log.debug(`📤 "${message.action}" success=${response?.success !== false}`);
        sendResponse(response);
      };

      // Use IIFE for async handling in listener
      void (async () => {
        try {
          // 🚨 CRITICAL FIX: Wait for cold boot process to finish before handling messages
          await ensureInitialized();
          if (getBootState() === 'failed') {
            wrappedSendResponse({ success: false, error: 'Extension initialization failed.' });
            return;
          }

          const validation = validateMessage(message);
          if (!validation.valid) {
            log.warn('Blocked invalid message', {
              error: validation.error,
              origin: sender.url,
            });
            wrappedSendResponse({ success: false, error: validation.error });
            return;
          }

          const response = await handleMessage(message, sender);
          wrappedSendResponse(response);
        } catch (error) {
          // P3.2: Better error serialization
          log.error('Message handling failed', {
            action: message.action,
            error: error instanceof Error ? error.message : String(error),
          });
          wrappedSendResponse({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })();

      return true; // Keep channel open for async response
    }
  );

  log.info('🚀 Main Message Router initialized');
}

/**
 * Route messages to appropriate service handlers
 */
async function handleMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender
): Promise<ExtensionResponse> {
  log.debug('Incoming message', { action: message.action, origin: sender.url });

  switch (message.action) {
    // ── EMAIL ACTIONS ─────────────────────────────────────────────
    case 'GET_CURRENT_EMAIL': {
      const email = await emailService.getCurrentEmail();
      return { success: true, email: email || undefined };
    }

    case 'GENERATE_EMAIL': {
      log.info('🔄 Email change requested — performing full session reset');
      suppressNextEmailTypeTransition('disposable');

      // 1. Clear stale OTP so old codes can't fire on the new email session
      await otpService.clearLastOTP();

      // 2. Clear processed-email dedup cache so new inbox is scanned fresh
      //    Also clears otpWaitingTabs + circuit breaker (see resetEmailSession)
      resetEmailSession();

      // 3. Clear notification dedup cache (separate module-level map)
      resetNotificationSession();

      // 4. Clear linkService activation history/queue so old links don't replay
      linkService.clearHistory();

      // 5. Clear inbox in storage so popup shows empty state immediately
      await storageService.set('inbox', []);
      invalidateGmailInboxFetches();
      await storageService.set('gmailInbox', []);
      await storageService.set('gmailSyncState', {});

      // 6. Broadcast RESET_STATE to all content scripts so FAB badges clear
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { action: 'RESET_STATE' }).catch(() => {
              // Ignore — tab may not have content script (about:, chrome:, etc.)
            });
          }
        }
      });

      // 6. Finally generate the new email address
      // Refresh identity so username, names, and email prefix are all new
      const identity = await identityService.refreshIdentity();
      
      // Generate a new cached password for this new identity to ensure everything changes
      const passwordResult = await passwordService.generate();
      identity.cachedPassword = passwordResult.password;
      await identityService.saveIdentity(identity);

      const emailPayload = message.action === 'GENERATE_EMAIL' ? message.payload || {} : {};
      // Switch to Temp Mail tab BEFORE save so currentEmail is updated for fill
      await storageService.setImmediate('preferredEmailType', 'disposable');
      const email = await emailService.generateEmail({
        ...emailPayload,
        prefix: identity.emailPrefix.substring(0, 30).replace(/[^a-z0-9.]/g, ''),
      });

      // 7. Always start polling immediately when email is generated.
      // SSE is a bonus push layer — polling is the reliable fallback.
      startFastWatchBurst('email_gen');

      if (email?.service === 'mailtm') {
        sseManager.setOnEmailReceived(() => {
          recordEmailReceived();
        });
        sseManager.connect(email).catch((e) => {
          log.debug('SSE connection failed — polling is already running', e);
        });
        log.info('🔌 SSE real-time push enabled for Mail.tm');
      }

      log.info('✅ New email generated — fresh session ready', { email: email?.fullEmail });
      return { success: true, email };
    }

    case 'GENERATE_GMAIL_ALIAS': {
      const payload = message.action === 'GENERATE_GMAIL_ALIAS' ? message.payload : undefined;
      const domain = payload?.domain || 'general';

      const profile = gmailApiService.getCachedProfile();
      let baseEmail: string | null = null;
      if (profile?.email) {
        baseEmail = profile.email;
      } else {
        const [storedProfile, storedBase] = await Promise.all([
          storageService.get('gmailProfile'),
          storageService.get('gmailBase'),
        ]);
        baseEmail = storedProfile?.email || storedBase || null;
      }

      if (!baseEmail) {
        return { success: false, error: 'Gmail not connected' };
      }

      log.info('🔄 Gmail alias change requested — performing full session reset');

      // 1. Clear stale OTP so old codes can't fire on the new email session
      await otpService.clearLastOTP();

      // 2. Clear processed-email dedup cache so new inbox is scanned fresh
      //    Also clears otpWaitingTabs + circuit breaker (see resetEmailSession)
      resetEmailSession();

      // 3. Clear notification dedup cache (separate module-level map)
      resetNotificationSession();

      // 4. Clear linkService activation history/queue so old links don't replay
      linkService.clearHistory();

      // 5. Clear inbox in storage so popup shows empty state immediately
      await storageService.set('inbox', []);
      invalidateGmailInboxFetches();
      await storageService.set('gmailInbox', []);
      await storageService.set('gmailSyncState', {});

      // 6. Broadcast RESET_STATE to all content scripts so FAB badges clear
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { action: 'RESET_STATE' }).catch(() => {
              // Ignore — tab may not have content script (about:, chrome:, etc.)
            });
          }
        }
      });

      const aliasEmail = getRandomizedGmailAlias(baseEmail, domain);
      const aliasSession = await rememberGmailAliasSession(aliasEmail, baseEmail, domain);

      // Save to history
      const history = (await storageService.get('aliasHistory')) ?? [];
      const exists = history.some((h: any) => h.alias === aliasEmail && h.website === domain);
      if (!exists) {
        const newItem = {
          alias: aliasEmail,
          originalEmail: baseEmail,
          type: 'combined' as const,
          website: domain,
          createdAt: Date.now(),
        };
        await storageService.set('aliasHistory', [newItem, ...history].slice(0, 500));
      }

      // Sync active email to storage as well so currentEmail reflects this active alias
      const currentEmailAcct: EmailAccount = {
        id: `gmail_${aliasEmail.replace(/[@.+]/g, '_')}`,
        fullEmail: aliasEmail,
        domain: 'gmail.com',
        service: 'gmail',
        createdAt: aliasSession.startedAt,
        expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
        gmailBaseEmail: baseEmail,
        gmailAliasSessionStartedAt: aliasSession.startedAt,
      };

      // 7. Update preferredEmailType and currentEmail in storage
      sseManager.disconnect();
      suppressNextEmailTypeTransition('gmail');
      await storageService.set('preferredEmailType', 'gmail');
      await storageService.set('currentEmail', currentEmailAcct);

      // 8. Always start polling immediately
      startEmailPolling();
      startFastWatchBurst('gmail_alias_gen');

      log.info('✅ New Gmail alias generated', { alias: aliasEmail });
      return { success: true, email: currentEmailAcct };
    }

    case 'CHECK_INBOX': {
      const payload = message.action === 'CHECK_INBOX' ? message.payload : undefined;
      const current =
        payload?.email && payload?.service
          ? {
              id: payload.email,
              fullEmail: payload.email,
              domain: payload.email.split('@')[1] || '',
              service: payload.service,
              createdAt: Date.now(),
              expiresAt: Date.now() + 60 * 60 * 1000,
            }
          : await emailService.getCurrentEmail();
      if (!current) {
        return { success: false, error: 'No active email account' };
      }
      const emails = await emailService.checkInbox(current);
      return { success: true, emails };
    }

    case 'READ_EMAIL': {
      const payload = (message.payload || {}) as Record<string, unknown>;
      // Schema allows string|number; normalise here instead of rejecting
      // numbers that passed validation.
      const rawId = payload.emailId;
      const emailId =
        typeof rawId === 'string' ? rawId : typeof rawId === 'number' ? String(rawId) : '';
      if (!emailId) {
        return { success: false, error: 'Missing or invalid emailId' };
      }
      const login = typeof payload.login === 'string' ? payload.login : '';
      const domain = typeof payload.domain === 'string' ? payload.domain : '';
      const service = typeof payload.service === 'string' ? payload.service : 'mailtm';
      const email = await emailService.readEmail(emailId, {
        login,
        domain,
        service,
        fullEmail: login && domain ? `${login}@${domain}` : '',
      } as import('../types').EmailAccount);
      return { success: true, email };
    }

    case 'GET_EMAIL_HISTORY': {
      const history = await emailService.getHistory();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { success: true, history: history as any };
    }

    case 'GET_PROVIDER_HEALTH': {
      const health = emailService.getProviderHealth();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { success: true, health: health as any[] };
    }

    // ── OTP ACTIONS ───────────────────────────────────────────────
    case 'GET_LAST_OTP': {
      const senderTabId = sender.tab?.id;
      if (senderTabId) {
        onContentScriptReady(senderTabId);
      }
      const lastOTP = await otpService.getLastOTP();

      if (senderTabId && lastOTP) {
        const reg = getOTPWaitingTabs().get(senderTabId);
        if (reg && reg.registeredAt > lastOTP.extractedAt && !isActivationTab(senderTabId)) {
          log.warn('Refusing to provide stale OTP during active polling session', { senderTabId });
          return { success: false, error: 'Still waiting for new email...' };
        }
      }

      return { success: true, lastOTP: lastOTP || undefined };
    }

    case 'MARK_OTP_USED': {
      await otpService.markAsUsed();
      return { success: true };
    }

    case 'CHECK_OTP_NOW': {
      const current = await emailService.getCurrentEmail();
      if (current) {
        await emailService.checkInbox(current);
        const lastOTP = await otpService.getLastOTP();
        return { success: true, otp: lastOTP?.code };
      }
      return { success: false, error: 'No active email account' };
    }

    case 'CHECK_OTP_FRESHNESS': {
      const isFresh = await otpService.isOTPFresh();
      return { success: true, isFresh };
    }

    case 'WAIT_FOR_FRESH_OTP': {
      // Inside this case the action is always WAIT_FOR_FRESH_OTP; the old
      // ternary's else-branch was unreachable and `payload.maxWaitMs` threw
      // on an undefined payload. Default safely instead.
      const payload = (message.payload ?? {}) as { maxWaitMs?: unknown };
      const maxWaitMs =
        typeof payload.maxWaitMs === 'number' &&
        Number.isFinite(payload.maxWaitMs) &&
        payload.maxWaitMs >= 1000
          ? Math.min(payload.maxWaitMs, 120000)
          : 30000;
      const lastOTP = await otpService.waitForFreshOTP(maxWaitMs);
      return { success: true, lastOTP: lastOTP || undefined };
    }

    // ── OTP PAGE DETECTION (from content script) ─────────────────
    case 'OTP_PAGE_DETECTED': {
      if (message.action === 'OTP_PAGE_DETECTED' && message.payload) {
        const { url, fieldSelectors, confidence, verdict } = message.payload as {
          url: string;
          fieldSelectors?: string[];
          confidence?: number;
          verdict?: string;
        };
        // fieldSelectors is schema-optional; a legal omission used to throw here.
        const selectors = Array.isArray(fieldSelectors) ? fieldSelectors : [];
        log.info('📱 OTP page detected', {
          url,
          fieldCount: selectors.length,
          confidence,
          verdict,
        });

        if (sender.tab?.id) {
          if (isActivationTab(sender.tab.id)) {
            log.info('Activation tab exposed OTP fields; registering it for code delivery', {
              tabId: sender.tab.id,
            });
            onContentScriptReady(sender.tab.id);
          }
          startFastOTPPolling(
            sender.tab.id,
            url,
            selectors,
            sender.frameId,
            confidence,
            verdict
          );
        }
      }
      return { success: true };
    }

    case 'OTP_PAGE_LEFT': {
      log.info('📱 OTP page left');
      if (sender.tab?.id) {
        stopFastOTPPolling(sender.tab.id);
      }
      return { success: true };
    }

    // ── EVENT-DRIVEN POLLING TRIGGERS ─────────────────────────────
    case 'REGISTRATION_FORM_SUBMITTED': {
      log.info('⚡ Registration form submitted — triggering ultra polling');
      startFastWatchBurst('form_submit');

      const currentEmail = await storageService.get('currentEmail');
      if (currentEmail && typeof currentEmail === 'object' && currentEmail.service === 'gmail') {
        startGmailAliasFastPolling('registration_form_submitted', {
          intervalMs: 2_000,
          durationMs: 60_000,
        });
      }
      return { success: true };
    }

    // ── INTELLIGENCE LAYER ─────────────────────────────────────────
    case 'EXTRACT_OTP': {
      const payload = message.payload as ExtractOTPPayloadWithMetadata | undefined;
      const toSafeStr = (v: unknown): string => {
        if (typeof v === 'string') {return v;}
        if (!v) {return '';}
        if (typeof v === 'object') {
          const obj = v as Record<string, unknown>;
          if (typeof obj.text === 'string') {return obj.text;}
          if (typeof obj.html === 'string') {return obj.html;}
          if (typeof obj.body === 'string') {return obj.body;}
          if (typeof obj.content === 'string') {return obj.content;}
          try { return JSON.stringify(v); } catch { return String(v); }
        }
        return String(v);
      };

      const subject = toSafeStr(payload?.subject);
      const source = toSafeStr(payload?.source);

      log.info(`🧠 Requesting off-main-thread OTP/Link extraction for source: ${source}`);

      const extractFn = async () => {
        let textBody = toSafeStr(payload?.textBody) || toSafeStr(payload?.text);
        let htmlBody = toSafeStr(payload?.htmlBody);

        // If the email lacks htmlBody or only contains snippet preview text (typical for list view snippets),
        // fetch the full email body first to allow high-accuracy extraction.
        const isSnippetOnly =
          !htmlBody || htmlBody === textBody || (htmlBody.length < 300 && !htmlBody.includes('<'));
        if (isSnippetOnly && payload?.emailId) {
          try {
            const currentAccount = await emailService.getCurrentEmail();
            if (currentAccount) {
              log.info(`Fetching full email body for inline extraction (ID: ${payload.emailId})`);
              const fullEmail = await emailService.readEmail(
                String(payload.emailId),
                currentAccount
              );
              const fetchedHtml = toSafeStr(fullEmail.htmlBody);
              const fetchedBody = toSafeStr(fullEmail.body || fullEmail.textBody);
              if (fetchedHtml) {
                htmlBody = fetchedHtml;
              }
              if (fetchedBody) {
                textBody = fetchedBody;
              }
            }
          } catch (e) {
            log.warn(`Failed to fetch full email body for inline extraction: ${e}`);
          }
        }

        const senderEmail = toSafeStr(payload?.emailFrom) || 'noreply@ghostfill.ai';
        const result = extractAll(subject, textBody, htmlBody, senderEmail);
        return {
          code: result.otp?.code ?? null,
          link: result.link?.url ?? null,
          otpConfidence: result.otp?.confidence ?? 0.8,
        };
      };

      let extractionResult: {
        code?: string | null | undefined;
        link?: string | null | undefined;
        otpConfidence?: number;
      };
      if (payload?.emailId) {
        extractionResult = await extractEmailOnce(String(payload.emailId), extractFn);
      } else {
        extractionResult = await extractFn();
      }

      const otpCode = normalizeEmailOTP(extractionResult.code);
      const otpConfidence = extractionResult.otpConfidence ?? 0.8;
      const linkUrl = extractionResult.link;

      if (otpCode && payload && payload.saveToLastOTP === true) {
        await saveExtractedOTPFromMessage(otpCode, otpConfidence, {
          ...payload,
          subject,
          source,
        });
      }

      // ── OTP delivery to waiting tabs (popup path) ──────────────────
      // The polling engine calls deliverOTP() when it finds an OTP.
      // Mirror that here so popup-triggered extraction also fills any
      // OTP field that is currently waiting.
      // deliverOTP() returns false immediately when no tabs are waiting,
      // so there is zero cost when the user is just browsing the inbox.
      if (otpCode) {
        const emailCtx: EmailContext = {
          from: toSafeStr(payload?.emailFrom) || '',
          subject: subject || '',
          bodySnippet: (toSafeStr(payload?.textBody) || toSafeStr(payload?.text) || '').substring(0, 500),
        };
        void deliverOTP(otpCode, otpConfidence, emailCtx).catch((e) =>
          log.warn('OTP delivery error (EXTRACT_OTP path)', e)
        );
      }

      return {
        success: true,
        otp: otpCode ?? undefined,
        link: linkUrl ?? undefined,
      };
    }

    // ── ACTIVATE LINK (permanent, typed handler) ─────────────────────
    // Called internally by EXTRACT_OTP and also directly by the popup
    // when the user clicks an "Open Link" button.
    // Routes through linkService with its full security gate + dedup.
    case 'ACTIVATE_LINK': {
      if (message.action === 'ACTIVATE_LINK' && message.payload) {
        const p = message.payload;
        await activateDetectedLink({
          emailId: p.emailId,
          linkUrl: p.linkUrl,
          ...(p.emailFrom ? { emailFrom: p.emailFrom } : {}),
          ...(p.subject ? { subject: p.subject } : {}),
          ...(p.emailDate !== undefined ? { emailDate: p.emailDate } : {}),
          ...(p.bodySnippet ? { bodySnippet: p.bodySnippet } : {}),
        });
      }
      return { success: true };
    }

    // ── PASSWORD ACTIONS ──────────────────────────────────────────
    case 'GENERATE_PASSWORD': {
      const payload = message.action === 'GENERATE_PASSWORD' ? message.payload : undefined;
      const result = await passwordService.generate(payload);
      // Sync with active identity
      try {
        const identity = await identityService.getCurrentIdentity();
        if (identity) {
          identity.cachedPassword = result.password;
          await identityService.saveIdentity(identity);
        }
      } catch (e) {
        log.warn('Failed to sync generated password with active identity', e);
      }
      return { success: true, result };
    }

    case 'GET_PASSWORD_HISTORY': {
      const history = await passwordService.getHistory();
      return { success: true, history: history as PasswordHistoryItem[] };
    }

    case 'SAVE_PASSWORD': {
      const { password, website } = (message.payload || {}) as {
        password: string;
        website: string;
      };
      await passwordService.saveToHistory(password, website);
      return { success: true };
    }

    case 'DELETE_PASSWORD': {
      if (message.action === 'DELETE_PASSWORD' && message.payload?.id) {
        await passwordService.deleteFromHistory(message.payload.id);
      }
      return { success: true };
    }

    // ── IDENTITY ACTIONS ─────────────────────────────────────────
    case 'GET_IDENTITY': {
      // User is filling identity on a tab right now — arm fast-watch burst so
      // incoming verification emails or links are caught within 2-3s without waiting.
      startFastWatchBurst('identity_fill');

      // Popup Temp Mail / Gmail tab is source of truth via preferredEmailType.
      // Never cross-fill: disposable tab → temp mail only; Gmail tab → gmail only.
      // getFresh avoids stale SW cache after popup tab switch.
      const freshPref = await storageService.getFresh('preferredEmailType');
      const preferredEmailType: 'disposable' | 'gmail' =
        freshPref === 'gmail' ? 'gmail' : 'disposable';

      const identity = await identityService.getCompleteIdentity();
      // Trust disk preference over identity snapshot (identity may race)
      identity.preferredEmailType = preferredEmailType;

      if (preferredEmailType === 'gmail') {
        let baseEmail: string | null = null;
        const profile = gmailApiService.getCachedProfile();
        if (profile?.email) {
          baseEmail = profile.email;
        } else {
          try {
            const bag = await storageService.getMany([
              'gmailProfile',
              'gmailBase',
              'gmailIsManual',
              'gmailConnected',
            ]);
            const storedProfile = bag.gmailProfile;
            const storedBase = bag.gmailBase;
            const isManual = bag.gmailIsManual;
            const connected = bag.gmailConnected;
            if (!isManual && connected === false) {
              baseEmail = null;
            } else if (storedProfile?.email) {
              baseEmail = storedProfile.email;
            } else if (storedBase) {
              baseEmail = storedBase;
            }
          } catch (e) {
            log.warn('Failed to retrieve gmail profile/base from storage', e);
          }
        }

        if (baseEmail) {
          // Read existing alias, DO NOT reset session if it mismatches
          const aliasSession = await getMostRecentGmailAliasSession();
          if (aliasSession) {
            identity.email = aliasSession.alias;
            log.info('GET_IDENTITY fill source=gmail', { aliasEmail: aliasSession.alias, preferredEmailType });
          } else {
            identity.email = ''; // Let the popup call GENERATE_GMAIL_ALIAS explicitly
            log.info('GET_IDENTITY: Gmail tab active, no active alias session — email left empty');
          }
        } else {
          // Gmail tab active but not connected — never fall back to temp mail
          identity.email = '';
          log.info('GET_IDENTITY: Gmail tab active, no Gmail base — email left empty');
        }
      } else {
        // ── Temp Mail tab: force disposable only ──
        let disposableEmail = await storageService.get('disposableEmail');
        if (
          !disposableEmail?.fullEmail ||
          disposableEmail.service === 'gmail' ||
          disposableEmail.domain === 'gmail.com'
        ) {
          const currentEmail = await storageService.get('currentEmail');
          if (
            currentEmail?.fullEmail &&
            currentEmail.service !== 'gmail' &&
            currentEmail.domain !== 'gmail.com'
          ) {
            disposableEmail = currentEmail;
          }
        }

        if (
          disposableEmail?.fullEmail &&
          disposableEmail.service !== 'gmail' &&
          disposableEmail.domain !== 'gmail.com'
        ) {
          identity.email = disposableEmail.fullEmail;
          log.info('GET_IDENTITY fill source=disposable', {
            email: disposableEmail.fullEmail,
            preferredEmailType,
          });
        } else {
          // No temp mail yet — do NOT fill a Gmail address on Temp Mail tab
          const looksGmail =
            typeof identity.email === 'string' &&
            /@(gmail|googlemail)\.com$/i.test(identity.email);
          if (looksGmail) {
            identity.email = '';
          }
          log.info('GET_IDENTITY: Temp Mail tab active, no disposable email yet');
        }
      }

      return {
        success: true,
        identity,
        preferredEmailType,
      };
    }

    case 'GENERATE_IDENTITY':
    case 'REFRESH_IDENTITY': {
      const identity = await identityService.refreshIdentity();
      return { success: true, identity };
    }

    // ── Local DOM Heuristic Confidence ───────────────────────────
    case 'ANALYZE_DOM': {
      const simplifiedDOM =
        message.action === 'ANALYZE_DOM' ? (message.payload?.simplifiedDOM ?? '') : '';
      return {
        success: true,
        result: {
          confidence: estimateOTPPageConfidence(simplifiedDOM),
        },
      };
    }

    // ── NOTIFICATION ACTIONS ──────────────────────────────────────
    case 'SHOW_NOTIFICATION': {
      const payload = (message.payload || {}) as {
        title?: string;
        message?: string;
        type?: string;
      };
      const title = typeof payload.title === 'string' ? payload.title : 'GhostFill';
      const text = typeof payload.message === 'string' ? payload.message : '';
      const type = payload.type;

      if (type === 'error') {
        await notifyError(title, text);
      } else {
        await notifySuccess(title, text);
      }
      return { success: true };
    }

    // ── STORAGE/SETTINGS ───────────────────────────��──────────────
    case 'GET_SETTINGS': {
      const settings = await storageService.getSettings();
      return { success: true, settings };
    }

    case 'UPDATE_SETTINGS': {
      // Inside this case, message.action is always 'UPDATE_SETTINGS'
      const updated = await storageService.updateSettings(
        (message.payload as import('../utils/validation').UserSettings | undefined) ?? {}
      );
      return { success: true, settings: updated };
    }

    case 'CLEAR_DATA': {
      await storageService.clear();
      await emailService.clearData();
      await passwordService.clearHistory();
      log.info('All extension data cleared');
      return { success: true };
    }

    case 'OPEN_OPTIONS': {
      chrome.runtime.openOptionsPage();
      return { success: true };
    }

    case 'LINK_ACTIVATED': {
      log.info(
        '🔗 Link activated — allowing background tabs to verify without suspending existing fast polling'
      );
      // Fix: Removed global stopFastOTPPolling loop to prevent breaking OTP on active tabs
      return { success: true };
    }

    // ── FLOATING BUTTON ACTIONS ───────────────────────────────────
    case 'SHOW_FLOATING_BUTTON':
    case 'HIDE_FLOATING_BUTTON': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        const response = await safeSendTabMessage(tab.id, message);
        return response || { success: false, error: 'Tab not responding' };
      }
      return { success: false, error: 'No active tab' };
    }

    // ── PING ──────────────────────────────────────────────────────
    case 'PING': {
      return { success: true };
    }

    // ── SERVICE HEALTH NOTIFICATIONS ─────────────────────────────
    case 'FALLBACK_DOMAINS_USED': {
      const { service, reason } = (message.payload || {}) as { service?: string; reason?: string };
      log.warn(`Provider ${service} is using fallback domains (${reason ?? 'API_UNAVAILABLE'})`);
      // Surface a non-blocking warning notification to the user
      await notifyError(
        'Email Provider Degraded',
        `${service ?? 'TempMail'} is using fallback domains — some features may be limited.`
      ).catch(() => {}); // best-effort
      return { success: true };
    }

    // ── DIAGNOSTIC EXPORT ────────────────────────────────────────
    case 'GET_DIAGNOSTIC_REPORT': {
      const report = diag.exportReport();
      return { success: true, report };
    }

    // ── GMAIL API HANDLERS ────────────────────────────────────────
    case 'GMAIL_GET_STATUS': {
      // Returns current auth status without triggering a sign-in
      const authState = getGmailAuthSetupState();
      const profile = gmailApiService.getCachedProfile();
      if (profile) {
        return {
          success: true,
          connected: true,
          profile,
          authIssue: authState.authIssue,
          clientIdStatus: authState.clientIdStatus,
        };
      }
      if (authState.setupRequired) {
        return {
          success: true,
          connected: false,
          authIssue: authState.authIssue,
          clientIdStatus: authState.clientIdStatus,
        };
      }
      if (gmailApiService.isConfigured()) {
        // Try silent auth restoration (SW restart recovery)
        const silentProfile = await gmailApiService.checkSilentAuth();
        if (silentProfile) {
          await storageService.set('gmailProfile', silentProfile).catch(() => {});
          await storageService.set('gmailBase', silentProfile.email).catch(() => {});
          await storageService.set('gmailConnected', true).catch(() => {});
          await setGmailConnectedAt().catch(() => {});
          const nextAuthState = getGmailAuthSetupState();
          return {
            success: true,
            connected: true,
            profile: silentProfile,
            authIssue: nextAuthState.authIssue,
            clientIdStatus: nextAuthState.clientIdStatus,
          };
        }
      }

      const storedProfile = (await storageService.get('gmailProfile')) as GmailProfile | null;
      const storedConnected = await storageService.get('gmailConnected');
      if (storedProfile?.email && storedConnected) {
        return {
          success: true,
          connected: true,
          profile: storedProfile,
          authIssue: authState.authIssue,
          clientIdStatus: authState.clientIdStatus,
        };
      }

      return {
        success: true,
        connected: false,
        authIssue: authState.authIssue,
        clientIdStatus: authState.clientIdStatus,
      };
    }

    case 'GMAIL_SIGN_IN': {
      try {
        if (!gmailApiService.isConfigured()) {
          throw new Error('GhostFill Gmail client_id is not configured.');
        }
        const profile = await gmailApiService.signIn();
        // Persist profile so other parts of the extension can read it
        await storageService.set('gmailProfile', profile).catch(() => {});
        await storageService.set('gmailBase', profile.email).catch(() => {});
        await storageService.set('gmailConnected', true).catch(() => {});
        await setGmailConnectedAt().catch(() => {});
        sseManager.disconnect();
        await storageService.set('preferredEmailType', 'gmail').catch(() => {});
        await storageService.set('inbox', []).catch(() => {});
        invalidateGmailInboxFetches();
        await storageService.set('gmailInbox', []).catch(() => {});
        await storageService.set('gmailSyncState', {}).catch(() => {});
        await clearGmailAliasSessions().catch(() => {});
        // Seed an initial alias session for the base email so that
        // GMAIL_FETCH_INBOX calls arriving immediately after sign-in
        // can find an active session (fixes race condition).
        await rememberGmailAliasSession(
          profile.email,
          profile.email,
          'global',
        ).catch(() => {});
        log.info('Gmail sign-in completed', { email: profile.email });
        return { success: true, profile };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        const authState = getGmailAuthSetupState(msg);
        if (authState.setupRequired) {
          log.warn('Gmail sign-in needs OAuth client setup', { error: msg });
        } else {
          log.error('Gmail sign-in failed', e);
        }
        return {
          success: false,
          error: msg,
          setupRequired: authState.setupRequired,
          authIssue: authState.authIssue,
          clientIdStatus: authState.clientIdStatus,
        };
      }
    }

    case 'GMAIL_SIGN_OUT': {
      try {
        if (gmailApiService.isConfigured()) {
          await gmailApiService.signOut();
        }
        await storageService.set('gmailProfile', null).catch(() => {});
        await storageService.set('gmailBase', null).catch(() => {});
        await storageService.set('gmailConnected', false).catch(() => {});
        await clearGmailConnectedAt().catch(() => {});
        await storageService.set('gmailIsManual', false).catch(() => {});
        await storageService.set('inbox', []).catch(() => {});
        invalidateGmailInboxFetches();
        await storageService.set('gmailInbox', []).catch(() => {});
        await storageService.set('gmailSyncState', {}).catch(() => {});
        await clearGmailAliasSessions().catch(() => {});
        const disposableEmail = await storageService.get('disposableEmail').catch(() => null);
        await storageService.set('preferredEmailType', 'disposable').catch(() => {});
        if (disposableEmail?.fullEmail && disposableEmail.service !== 'gmail') {
          await storageService.set('currentEmail', disposableEmail).catch(() => {});
        }
        log.info('Gmail signed out');
        return { success: true };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error('Gmail sign-out failed', e);
        return { success: false, error: msg };
      }
    }

    case 'GMAIL_FETCH_INBOX': {
      const inboxPayload = message.action === 'GMAIL_FETCH_INBOX' ? message.payload : undefined;
      const maxResults = inboxPayload?.maxResults ?? 5;
      const inboxRequestSeq = ++gmailInboxFetchSeq;
      try {
        let messages: GmailMessage[] = [];
        let syncSource: 'cache' | 'full' | 'history' = 'cache';
        let syncCached = false;
        const aliasSession = inboxPayload?.alias
          ? await getGmailAliasSession(inboxPayload.alias)
          : await getMostRecentGmailAliasSession();

        if (!aliasSession) {
          return { success: false, error: 'No active Gmail alias session.' };
        }

        const gmailIsManual = !!(await storageService.get('gmailIsManual'));
        if (
          !gmailApiService.isConfigured() ||
          gmailIsManual ||
          !(await ensureGmailAuthenticated())
        ) {
          return {
            success: false,
            error: 'Not authenticated. Connect Gmail with Google OAuth to read messages via API.',
          };
        }

        const query =
          inboxPayload?.query ??
          buildGmailAliasSearchQuery(
            aliasSession.alias,
            getGmailAliasProcessingBaseline(aliasSession)
          );
        const aliasFilter = (msg: GmailMessage) =>
          filterGmailMessagesForAliasSession([msg], aliasSession).length > 0;

        const syncResult = await gmailApiService.syncInbox(query, maxResults, {
          alias: aliasSession.alias,
          forceFull: Boolean(inboxPayload?.forceFull),
          filterMessage: aliasFilter,
        });
        syncSource = syncResult.source;
        syncCached = syncResult.cached;
        messages = filterGmailMessagesForAliasSession(syncResult.messages, aliasSession);

        if (inboxRequestSeq === gmailInboxFetchSeq) {
          // Do not block the popup response on encrypted storage writes.
          // The caller already receives `messages`; storage sync is best-effort UI hydration.
          void (async () => {
            const [preferredType, manual, activeCurrentEmail] = await Promise.all([
              storageService.get('preferredEmailType').catch(() => null),
              storageService.get('gmailIsManual').catch(() => false),
              storageService.get('currentEmail').catch(() => null),
            ]);
            if (
              (preferredType ?? 'disposable') === 'gmail' &&
              !manual &&
              activeCurrentEmail?.fullEmail === aliasSession.alias
            ) {
              await storageService.set('gmailInbox', messages).catch(() => {});
            }
          })();
        }
        return { success: true, messages, source: syncSource, cached: syncCached };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('Not authenticated')) {
          log.info('Gmail fetch inbox failed (not authenticated):', msg);
        } else {
          log.error('Gmail fetch inbox failed', e);
        }
        return { success: false, error: msg };
      }
    }

    case 'GMAIL_GET_MESSAGE': {
      if (message.action !== 'GMAIL_GET_MESSAGE' || !message.payload?.messageId) {
        return { success: false, error: 'Missing messageId' };
      }
      try {
        const requestedAlias =
          typeof message.payload?.alias === 'string' ? message.payload.alias : undefined;
        const aliasSession = requestedAlias
          ? await getGmailAliasSession(requestedAlias)
          : await getMostRecentGmailAliasSession();
        if (!aliasSession) {
          return { success: false, error: 'No active Gmail alias session.' };
        }

        const gmailIsManual = !!(await storageService.get('gmailIsManual'));
        if (
          !gmailApiService.isConfigured() ||
          gmailIsManual ||
          !(await ensureGmailAuthenticated())
        ) {
          return {
            success: false,
            error: 'Not authenticated. Connect Gmail with Google OAuth to read messages via API.',
          };
        }

        const msg = await gmailApiService.fetchMessage(message.payload.messageId);
        if (messagePredatesGmailSession(msg.date, aliasSession)) {
          return { success: false, error: 'Message predates the active Gmail alias session.' };
        }
        if (!messageMatchesGmailAlias(msg, aliasSession.alias)) {
          return { success: false, error: 'Message does not belong to the active Gmail alias.' };
        }
        return { success: true, message: msg };
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        if (errMsg.includes('Not authenticated')) {
          log.info('Gmail get message failed (not authenticated):', errMsg);
        } else {
          log.error('Gmail get message failed', e);
        }
        return { success: false, error: errMsg };
      }
    }

    // ── GMAIL MCP TOOLS (Claude AI / Manus AI style) ──────────────
    case 'GMAIL_SEARCH': {
      const p = message.action === 'GMAIL_SEARCH' ? message.payload : undefined;
      const requestedAlias = typeof (p as any)?.alias === 'string' ? (p as any).alias : undefined;
      const maxResults = (p as any)?.maxResults ?? 15;
      try {
        let messages: GmailMessage[] = [];
        const aliasSession = requestedAlias
          ? await getGmailAliasSession(requestedAlias)
          : await getMostRecentGmailAliasSession();

        const gmailIsManual = !!(await storageService.get('gmailIsManual'));
        if (
          !gmailApiService.isConfigured() ||
          gmailIsManual ||
          !(await ensureGmailAuthenticated())
        ) {
          return {
            success: false,
            error: 'Not authenticated. Connect Gmail with Google OAuth to search messages via API.',
          };
        }

        if (aliasSession) {
          const query =
            (p as any)?.query ??
            buildGmailAliasSearchQuery(
              aliasSession.alias,
              getGmailAliasProcessingBaseline(aliasSession)
            );
          messages = filterGmailMessagesForAliasSession(
            (
              await gmailApiService.syncInbox(query, maxResults, {
                alias: aliasSession.alias,
                filterMessage: (msg) =>
                  filterGmailMessagesForAliasSession([msg], aliasSession).length > 0,
              })
            ).messages,
            aliasSession
          );
        }
        return { success: true, messages };
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    case 'GMAIL_LIST_LABELS': {
      try {
        const gmailIsManual = !!(await storageService.get('gmailIsManual'));
        if (
          !gmailApiService.isConfigured() ||
          gmailIsManual ||
          !(await ensureGmailAuthenticated())
        ) {
          return {
            success: false,
            error: 'Not authenticated. Connect Gmail with Google OAuth to list labels via API.',
          };
        }
        const labels = await gmailApiService.listLabels();
        return { success: true, labels };
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    // ── ZOHO MAIL ACTIONS ──────────────────────────────────────────
    case 'ZOHO_GET_STATUS': {
      try {
        const status = await getZohoConnectionStatus();
        return { success: true, ...status };
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    case 'ZOHO_CONNECT': {
      try {
        const profile = await connectZoho();
        return { success: true, profile };
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    case 'ZOHO_DISCONNECT': {
      try {
        await disconnectZoho();
        return { success: true };
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    case 'ZOHO_GENERATE_ALIAS': {
      try {
        const p = (message as any).payload as { website?: string; baseEmail?: string } | undefined;
        const alias = await getZohoAlias(p?.website ?? 'general', p?.baseEmail);
        return { success: true, alias };
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    case 'ZOHO_SEARCH_INBOX': {
      try {
        const p = (message as any).payload as { alias?: string; sinceMs?: number } | undefined;
        if (!p?.alias) {return { success: false, error: 'alias is required' };}
        const messages = await searchZohoInbox(p.alias, p.sinceMs);
        return { success: true, messages };
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    // ── MICROSOFT OUTLOOK ACTIONS ──────────────────────────────────
    case 'MICROSOFT_GET_STATUS': {
      try {
        const status = await getMicrosoftConnectionStatus();
        return { success: true, ...status };
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    case 'MICROSOFT_CONNECT': {
      try {
        const profile = await connectMicrosoft();
        return { success: true, profile };
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    case 'MICROSOFT_DISCONNECT': {
      try {
        await disconnectMicrosoft();
        return { success: true };
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    case 'MICROSOFT_GENERATE_ALIAS': {
      try {
        const p = (message as any).payload as { website?: string; baseEmail?: string } | undefined;
        const alias = await getMicrosoftAlias(p?.website ?? 'general', p?.baseEmail);
        return { success: true, alias };
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    case 'MICROSOFT_SEARCH_INBOX': {
      try {
        const p = (message as any).payload as { alias?: string; sinceMs?: number } | undefined;
        if (!p?.alias) {return { success: false, error: 'alias is required' };}
        const messages = await searchMicrosoftInbox(p.alias, p.sinceMs);
        return { success: true, messages };
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    default:
      log.warn('Unhandled message action', {
        action: (message as unknown as Record<string, unknown>).action,
      });
      return {
        success: false,
        error: `Unhandled action: ${(message as unknown as Record<string, unknown>).action}`,
      };
  }
}

/**
 * Registry stats adapter retained for backward compatibility.
 */
export function dumpRouterStats(): { handlers: number; status: string } {
  return { handlers: HANDLED_MESSAGE_ACTIONS.length, status: 'functioning' };
}

function estimateOTPPageConfidence(simplifiedDOM: string): number {
  const lower = simplifiedDOM.toLowerCase();
  if (!lower.trim()) {
    return 0;
  }

  let score = 0;

  if (lower.includes('autocomplete="one-time-code"')) {
    score += 0.5;
  }

  const keywordHits = [
    /verification\s*code/g,
    /one[-\s]?time/g,
    /\botp\b/g,
    /\bpasscode\b/g,
    /\b2fa\b/g,
    /\bmfa\b/g,
    /\bpin\b/g,
  ].reduce((count, pattern) => count + (lower.match(pattern)?.length ?? 0), 0);
  score += Math.min(0.3, keywordHits * 0.06);

  const splitDigitCount = lower.match(/maxlength=["']?1["']?/g)?.length ?? 0;
  if (splitDigitCount >= 4) {
    score += splitDigitCount >= 6 ? 0.3 : 0.2;
  }

  const inputCount = lower.match(/<input\b/g)?.length ?? 0;
  if (inputCount > 0) {
    score += Math.min(0.1, inputCount * 0.01);
  }

  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}
