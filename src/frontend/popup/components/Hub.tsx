import { Mail } from 'lucide-react';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { IS_GMAIL_ENABLED, isTemporaryMailAccount } from '../../../config/buildProfile';
import {
  getDeterministicCombinedAlias,
  rememberGmailAliasSession,
  getGmailAliasSessionByDomain,
  persistGmailConnection,
  clearGmailConnection,
  isGmailSetupResponse,
  formatGmailSetupError,
  type GmailSignInResult,
} from '../../../services/gmailConnectionService';
import { storageService } from '../../../services/storageService';
import {
  EmailAccount,
  type ExtractOTPResponse,
  type ReadEmailResponse,
  type PasswordOptions,
  DEFAULT_PASSWORD_OPTIONS,
} from '../../../types';
import { TIMING, copyToClipboard, openSafeUrl, isWebUrl } from '../../../utils/core';
import { safeSendMessage } from '../../../utils/messaging';
import { t } from '../../i18n';
import { useStorageSubscription } from '../hooks';
import { useAppStore } from '../store';
import { GmailLogo } from './ProviderLogos';
import {
  AccountCard,
  ConfirmModal,
  EmailViewerModal,
  InboxList,
  QuickActions,
  type DisplayedEmail,
} from './SharedComponents';

const toSafeStr = (v: unknown): string => {
  if (typeof v === 'string') {
    return v;
  }
  if (!v) {
    return '';
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (typeof obj.text === 'string') {
      return obj.text;
    }
    if (typeof obj.html === 'string') {
      return obj.html;
    }
    if (typeof obj.body === 'string') {
      return obj.body;
    }
  }
  return '';
};

// Rate limit constants
const RATE_LIMIT_MS = { GENERATE_EMAIL: 3000 };

const HUB_INBOX_PREVIEW_LIMIT = 1;
// The fixed-height Hub shows one complete recent message. Fetch only a few
// Gmail messages on popup open; the full history remains in the inbox view.
const HUB_GMAIL_FETCH_LIMIT = 5;

interface Props {
  readonly onNavigate: (tab: 'email' | 'password' | 'otp' | 'aliases') => void;
  readonly emailAccount: EmailAccount | null;
  readonly onGenerate: () => void;
  readonly onToast: (msg: string) => void;
}

const formatGmailSignInFailure = (res: GmailSignInResult | undefined): string => {
  if (isGmailSetupResponse(res)) {
    return formatGmailSetupError(res?.error);
  }
  return res?.error || 'Sign-in failed';
};

const Hub: React.FC<Props> = ({ onNavigate, emailAccount, onGenerate, onToast }) => {
  const preferredEmailType = useAppStore((s) => s.preferredEmailType);
  const isGeneratingEmail = useAppStore((s) => s.loading);
  const setPreferredEmailType = useAppStore((s) => s.setPreferredEmailType);
  const gmailConnected = useAppStore((s) => s.gmailConnected);
  const setGmailConnected = useAppStore((s) => s.setGmailConnected);
  const gmailBase = useAppStore((s) => s.gmailBase);
  const setGmailBase = useAppStore((s) => s.setGmailBase);
  const gmailInbox = useAppStore((state) => state.gmailInbox);
  const setGmailInbox = useAppStore((state) => state.setGmailInbox);
  const gmailInboxLoading = useAppStore((state) => state.gmailInboxLoading);
  const setGmailInboxLoading = useAppStore((state) => state.setGmailInboxLoading);
  const gmailInboxError = useAppStore((state) => state.gmailInboxError);
  const setGmailInboxError = useAppStore((state) => state.setGmailInboxError);
  const gmailIsManual = useAppStore((state) => state.gmailIsManual);
  const setGmailIsManual = useAppStore((state) => state.setGmailIsManual);
  const setGmailProfile = useAppStore((state) => state.setGmailProfile);
  const gmailProfile = useAppStore((state) => state.gmailProfile);
  const setCurrentTabHostname = useAppStore((state) => state.setCurrentTabHostname);

  // Direct Provider sign-in states
  const [gmailSigningIn, setGmailSigningIn] = useState(false);
  const gmailInboxRequestSeqRef = useRef(0);
  const viewerRequestSeqRef = useRef(0);

  // State
  const [emailCopied, setEmailCopied] = useState(false);
  const [passwordCopied, setPasswordCopied] = useState(false);
  const [password, setPassword] = useState<string>('');
  // Reuse the identity's cached password across popup remounts. New passwords
  // generated below are synced to this same value by the background handler.
  const [passwordDefaults, setPasswordDefaults] = useState<PasswordOptions | null>(null);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      storageService.getSettings().catch(() => null),
      storageService.get('currentIdentity').catch(() => null),
    ]).then(([settings, identity]) => {
      if (cancelled) {
        return;
      }
      if (settings?.passwordDefaults) {
        setPasswordDefaults({ ...settings.passwordDefaults });
      }
      if (identity?.cachedPassword) {
        setPassword(identity.cachedPassword);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const [showPassword, setShowPassword] = useState(false);
  const [isGeneratingPassword, setIsGeneratingPassword] = useState(false);
  const [emailCooldown, setEmailCooldown] = useState(false);
  const [showConfirmEmail, setShowConfirmEmail] = useState(false);

  // PERMANENT FIX 2026-06-21: email viewer state. Previously the Hub inbox
  // had no way to open an email — clicking the row jumped to a tab. Now
  // Hub owns the same EmailViewerModal that AliasPanel uses.
  const [viewerEmail, setViewerEmail] = useState<DisplayedEmail | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [viewerOtp, setViewerOtp] = useState<string | null>(null);
  const [viewerLink, setViewerLink] = useState<string | null>(null);
  const [viewerMeta, setViewerMeta] = useState<{ fromName?: string; dateFormatted?: string }>({});
  const openingEmailId = viewerEmail ? String(viewerEmail.id) : null;

  const [currentTabDomain, setCurrentTabDomain] = useState<string>('');

  // Query current tab domain (single owner of chrome.tabs.query for the popup)
  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        const url = tab?.url;
        if (url && isWebUrl(url)) {
          try {
            let hostname = new URL(url).hostname;
            if (hostname.startsWith('www.')) {
              hostname = hostname.slice(4);
            }
            if (hostname) {
              setCurrentTabDomain(hostname);
              setCurrentTabHostname(hostname);
            }
          } catch {
            /* ignore */
          }
        }
      });
    }
  }, []);

  const [activeGmailAlias, setActiveGmailAlias] = useState<string>('');

  const loadActiveGmailAlias = useCallback(async () => {
    if (!gmailBase) {
      setActiveGmailAlias('');
      return;
    }
    const domain = currentTabDomain || 'general';
    try {
      const session = await getGmailAliasSessionByDomain(domain);
      if (session) {
        setActiveGmailAlias(session.alias);
      } else {
        setActiveGmailAlias(getDeterministicCombinedAlias(gmailBase, domain));
      }
    } catch {
      setActiveGmailAlias(getDeterministicCombinedAlias(gmailBase, domain));
    }
  }, [gmailBase, currentTabDomain]);

  useEffect(() => {
    void loadActiveGmailAlias();
  }, [loadActiveGmailAlias]);

  useEffect(() => {
    if (preferredEmailType !== 'gmail' || !gmailConnected || gmailIsManual || !activeGmailAlias) {
      return;
    }
    void (async () => {
      const existingEmail = await storageService.get('currentEmail').catch(() => null);
      if (
        existingEmail?.service === 'gmail' &&
        existingEmail.fullEmail === activeGmailAlias &&
        existingEmail.gmailBaseEmail === (gmailBase || '')
      ) {
        return;
      }

      const session = await rememberGmailAliasSession(
        activeGmailAlias,
        gmailBase || '',
        currentTabDomain || 'general'
      );
      await storageService.set('currentEmail', {
        id: `gmail_${activeGmailAlias.replace(/[@.+]/g, '_')}`,
        fullEmail: activeGmailAlias,
        domain: 'gmail.com',
        service: 'gmail',
        createdAt: session.startedAt,
        expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
        gmailBaseEmail: gmailBase || '',
        gmailAliasSessionStartedAt: session.startedAt,
      });
    })();
  }, [
    activeGmailAlias,
    currentTabDomain,
    gmailBase,
    gmailConnected,
    gmailIsManual,
    preferredEmailType,
  ]);

  const activeEmailAddress =
    preferredEmailType === 'gmail'
      ? activeGmailAlias || gmailBase || ''
      : emailAccount?.fullEmail || '';

  // Switch to Push-State UI instead of polling
  const rawInbox = useStorageSubscription('inbox', []);

  const inboxEmails = React.useMemo(() => {
    if (preferredEmailType !== 'disposable') {
      return (gmailInbox || []).map((msg) => ({
        id: msg.id,
        from: msg.fromName || msg.fromEmail || msg.from,
        senderEmail: msg.fromEmail || msg.from,
        subject: msg.subject,
        date: msg.date,
        body: msg.body || msg.snippet || '',
        htmlBody: msg.body || msg.snippet || '',
        attachments: [],
        read: !msg.isUnread,
      }));
    }
    return Array.isArray(rawInbox) ? rawInbox : [];
  }, [preferredEmailType, gmailInbox, rawInbox]);

  const fetchProviderInbox = useCallback(async () => {
    const requestSeq = ++gmailInboxRequestSeqRef.current;
    if (preferredEmailType === 'disposable') {
      return;
    }

    if (preferredEmailType === 'gmail') {
      if (!gmailConnected || gmailIsManual) {
        setGmailInboxLoading(false);
        return;
      }

      setGmailInboxLoading(true);
      setGmailInboxError(null);
      try {
        const res = (await safeSendMessage({
          action: 'GMAIL_FETCH_INBOX',
          payload: {
            ...(activeGmailAlias ? { alias: activeGmailAlias } : {}),
            maxResults: HUB_GMAIL_FETCH_LIMIT,
          },
        })) as any;
        if (res?.success && Array.isArray(res.messages)) {
          if (requestSeq === gmailInboxRequestSeqRef.current) {
            setGmailInbox(res.messages);
          }
        } else if (requestSeq === gmailInboxRequestSeqRef.current) {
          setGmailInboxError(res?.error || 'Failed to fetch Gmail inbox');
        }
      } catch (e: unknown) {
        if (requestSeq === gmailInboxRequestSeqRef.current) {
          setGmailInboxError(e instanceof Error ? e.message : 'Failed to fetch Gmail inbox');
        }
      } finally {
        if (requestSeq === gmailInboxRequestSeqRef.current) {
          setGmailInboxLoading(false);
        }
      }
    } else {
      // Legacy Zoho/Outlook stored preference: providers were removed from
      // the UI (Gmail-only). Nothing to fetch — clear the spinner so the
      // empty state renders instead of hanging.
      setGmailInboxLoading(false);
      return;
    }
  }, [
    activeGmailAlias,
    gmailConnected,
    gmailIsManual,
    preferredEmailType,
    setGmailInbox,
    setGmailInboxError,
    setGmailInboxLoading,
  ]);

  // Generate password with the Options > Passwords recipe when loaded,
  // otherwise the service defaults (length 20).
  const generatePassword = useCallback(async () => {
    setIsGeneratingPassword(true);
    const recipe: PasswordOptions = passwordDefaults ?? DEFAULT_PASSWORD_OPTIONS;
    try {
      const response = await safeSendMessage({
        action: 'GENERATE_PASSWORD',
        payload: {
          length: recipe.length,
          uppercase: recipe.uppercase,
          lowercase: recipe.lowercase,
          numbers: recipe.numbers,
          symbols: recipe.symbols,
          excludeAmbiguous: recipe.excludeAmbiguous,
        },
      });
      if (response && 'result' in response && response.result && 'password' in response.result) {
        setPassword(response.result.password);
      }
    } catch {
      onToast('Failed to generate password');
    } finally {
      setIsGeneratingPassword(false);
    }
  }, [onToast, passwordDefaults]);

  // Refs for timeout clearing
  const emailTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const passwordTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emailCooldownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (emailTimeoutRef.current) {
        clearTimeout(emailTimeoutRef.current);
      }
      if (passwordTimeoutRef.current) {
        clearTimeout(passwordTimeoutRef.current);
      }
      if (emailCooldownTimeoutRef.current) {
        clearTimeout(emailCooldownTimeoutRef.current);
      }
    };
  }, []);

  // Handlers
  const copyEmail = useCallback(async () => {
    if (!activeEmailAddress) {
      onToast('No email address yet — generate one first');
      return;
    }

    try {
      const copied = await copyToClipboard(activeEmailAddress);
      if (!copied) {
        onToast(t('copyFailed'));
        return;
      }
      setEmailCopied(true);
      const isExpired =
        preferredEmailType === 'disposable' &&
        typeof emailAccount?.expiresAt === 'number' &&
        Date.now() >= emailAccount.expiresAt;
      onToast(isExpired ? t('expiredAddressCopied') : t('emailCopied'));
    } catch {
      onToast(t('copyFailed'));
      return;
    }

    if (emailTimeoutRef.current) {
      clearTimeout(emailTimeoutRef.current);
    }
    emailTimeoutRef.current = setTimeout(() => setEmailCopied(false), TIMING.COPY_CONFIRMATION_MS);
  }, [activeEmailAddress, emailAccount?.expiresAt, onToast, preferredEmailType]);

  const copyPassword = useCallback(async () => {
    if (!password) {
      onToast(t('generatingPassword'));
      void generatePassword();
      return;
    }

    try {
      const copied = await copyToClipboard(password);
      if (!copied) {
        onToast(t('copyFailed'));
        return;
      }
      setPasswordCopied(true);
      onToast(t('passwordCopied'));
    } catch {
      onToast(t('copyFailed'));
      return;
    }

    if (passwordTimeoutRef.current) {
      clearTimeout(passwordTimeoutRef.current);
    }
    passwordTimeoutRef.current = setTimeout(
      () => setPasswordCopied(false),
      TIMING.COPY_CONFIRMATION_MS
    );
  }, [onToast, password]);

  const copyOTP = useCallback(
    async (code: string) => {
      try {
        const copied = await copyToClipboard(code);
        if (!copied) {
          onToast(t('copyFailed'));
          return;
        }
        onToast(t('codeCopied'));
      } catch {
        onToast(t('copyFailed'));
      }
    },
    [onToast]
  );

  const executeGenerateEmail = useCallback(() => {
    setShowConfirmEmail(false);
    void (async () => {
      try {
        const now = Date.now();
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          const { lastGenerateEmailTime } = await chrome.storage.local.get('lastGenerateEmailTime');
          const lastTime =
            typeof lastGenerateEmailTime === 'string'
              ? Number.parseInt(lastGenerateEmailTime, 10)
              : typeof lastGenerateEmailTime === 'number'
                ? lastGenerateEmailTime
                : 0;
          if (now - lastTime < RATE_LIMIT_MS.GENERATE_EMAIL) {
            setEmailCooldown(true);
            if (emailCooldownTimeoutRef.current) {
              clearTimeout(emailCooldownTimeoutRef.current);
            }
            emailCooldownTimeoutRef.current = setTimeout(
              () => setEmailCooldown(false),
              RATE_LIMIT_MS.GENERATE_EMAIL - (now - lastTime)
            );
            onToast('Please wait before generating a new email');
            return;
          }
          await chrome.storage.local.set({ lastGenerateEmailTime: now.toString() });
        }

        onGenerate();
      } catch {
        onToast('Failed to generate email. Please try again.');
      }
    })();
  }, [onGenerate, onToast]);

  const handleGenerateEmail = useCallback(() => {
    if (emailAccount?.fullEmail) {
      setShowConfirmEmail(true);
      return;
    }
    executeGenerateEmail();
  }, [emailAccount?.fullEmail, executeGenerateEmail]);

  const handleGeneratePassword = useCallback(() => {
    void generatePassword();
  }, [generatePassword]);

  const handleCopyOTP = useCallback(
    (code: string) => {
      void copyOTP(code);
    },
    [copyOTP]
  );

  const handleOpenLink = useCallback(
    (event: React.MouseEvent, url: string) => {
      event.stopPropagation();
      if (!isWebUrl(url)) {
        onToast('This message has no web link to open.');
        return;
      }
      onToast('Opening activation link…');
      openSafeUrl(url);
    },
    [onToast]
  );

  // PERMANENT FIX 2026-06-21: open an email in the viewer. Fetches the
  // full body via the appropriate message channel (Gmail uses
  // GMAIL_GET_MESSAGE; disposable inbox uses READ_EMAIL), then runs
  // EXTRACT_OTP against the body so the modal's OTP/link buttons work.
  const handleOpenEmail = useCallback(
    async (emailItem: DisplayedEmail) => {
      const currentId = String(emailItem.id);
      const requestSeq = ++viewerRequestSeqRef.current;

      setViewerEmail(emailItem);
      setViewerError(null);
      setViewerOtp(emailItem.otpCode ?? null);
      setViewerLink(emailItem.activationLink ?? null);
      setViewerMeta({}); // Reset metadata to prevent bleed-through
      setViewerLoading(true);
      try {
        if (preferredEmailType === 'gmail') {
          const res = (await safeSendMessage({
            action: 'GMAIL_GET_MESSAGE',
            payload: { messageId: String(emailItem.id) },
          })) as unknown as {
            success?: boolean;
            message?: {
              body?: string;
              htmlBody?: string;
              snippet?: string;
              dateFormatted?: string;
              subject?: string;
              from?: string;
            };
            error?: string;
          } | null;

          if (viewerRequestSeqRef.current !== requestSeq) {
            return;
          }

          if (res?.success && res.message) {
            const fullMsg = res.message;
            setViewerEmail((prev) => {
              if (!prev || String(prev.id) !== currentId) {
                return prev;
              }
              const next: DisplayedEmail = {
                ...prev,
                body: fullMsg.body ?? prev.body,
              };
              if (fullMsg.htmlBody !== undefined) {
                next.htmlBody = fullMsg.htmlBody;
              }
              if (fullMsg.snippet !== undefined) {
                next.snippet = fullMsg.snippet;
              }
              return next;
            });

            setViewerMeta((prev) => {
              if (viewerRequestSeqRef.current !== requestSeq) {
                return prev;
              }
              return {
                ...prev,
                ...(fullMsg.dateFormatted ? { dateFormatted: fullMsg.dateFormatted } : {}),
                ...(fullMsg.from ? { fromName: fullMsg.from } : {}),
              };
            });

            const bodyStr = toSafeStr(fullMsg.body ?? emailItem.body);
            const htmlStr = toSafeStr(fullMsg.htmlBody);

            const extract = (await safeSendMessage({
              action: 'EXTRACT_OTP',
              payload: {
                subject: toSafeStr(fullMsg.subject ?? emailItem.subject),
                text: bodyStr,
                textBody: bodyStr,
                htmlBody: htmlStr,
                source: 'popup-viewer',
                emailId: emailItem.id,
                emailFrom: toSafeStr(fullMsg.from ?? emailItem.from),
              },
            })) as ExtractOTPResponse | null;

            if (viewerRequestSeqRef.current !== requestSeq) {
              return;
            }

            if (extract?.success) {
              setViewerOtp(typeof extract.otp === 'string' && extract.otp ? extract.otp : null);
              setViewerLink(typeof extract.link === 'string' && extract.link ? extract.link : null);
            }
          } else if (res?.error) {
            setViewerError(typeof res.error === 'string' ? res.error : 'Could not load message');
          }
        } else {
          const account = emailAccount;
          if (!account?.fullEmail) {
            setViewerError('No active email account');
            return;
          }
          const atIndex = account.fullEmail.indexOf('@');
          const login = atIndex === -1 ? account.fullEmail : account.fullEmail.slice(0, atIndex);
          const domain = atIndex === -1 ? '' : account.fullEmail.slice(atIndex + 1);

          const res = (await safeSendMessage({
            action: 'READ_EMAIL',
            payload: { emailId: String(emailItem.id), login, domain, service: account.service },
          })) as ReadEmailResponse | null;

          if (viewerRequestSeqRef.current !== requestSeq) {
            return;
          }

          if (res?.success && res.email) {
            const fullMsg = res.email;
            setViewerEmail((prev) => {
              if (!prev || String(prev.id) !== currentId) {
                return prev;
              }
              const next: DisplayedEmail = { ...prev, body: fullMsg.body ?? prev.body };
              if (fullMsg.htmlBody !== undefined) {
                next.htmlBody = fullMsg.htmlBody;
              }
              if (fullMsg.snippet !== undefined) {
                next.snippet = fullMsg.snippet;
              }
              return next;
            });

            setViewerMeta((prev) => ({
              ...prev,
              ...(fullMsg.from ? { fromName: fullMsg.from } : {}),
            }));

            const bodyStr2 = toSafeStr(fullMsg.body ?? emailItem.body);
            const htmlStr2 = toSafeStr(fullMsg.htmlBody);

            const extract = (await safeSendMessage({
              action: 'EXTRACT_OTP',
              payload: {
                subject: toSafeStr(fullMsg.subject ?? emailItem.subject),
                text: bodyStr2,
                textBody: bodyStr2,
                htmlBody: htmlStr2,
                source: 'popup-viewer',
                emailId: emailItem.id,
                emailFrom: toSafeStr(fullMsg.from ?? emailItem.from),
              },
            })) as ExtractOTPResponse | null;

            if (viewerRequestSeqRef.current !== requestSeq) {
              return;
            }

            if (extract?.success) {
              setViewerOtp(typeof extract.otp === 'string' && extract.otp ? extract.otp : null);
              setViewerLink(typeof extract.link === 'string' && extract.link ? extract.link : null);
            }
          } else if (res?.error) {
            setViewerError(typeof res.error === 'string' ? res.error : 'Could not load message');
          }
        }
      } catch (err) {
        if (viewerRequestSeqRef.current === requestSeq) {
          setViewerError(err instanceof Error ? err.message : 'Failed to load message');
        }
      } finally {
        if (viewerRequestSeqRef.current === requestSeq) {
          setViewerLoading(false);
        }
      }
    },
    [emailAccount, preferredEmailType]
  );

  const handleCloseViewer = useCallback(() => {
    viewerRequestSeqRef.current += 1;
    setViewerEmail(null);
    setViewerError(null);
    setViewerOtp(null);
    setViewerLink(null);
    setViewerLoading(false);
    setViewerMeta({});
  }, []);

  // formatRelativeTime and extractOTP imported from utils/formatters

  const previewEmails = React.useMemo(
    () => inboxEmails.slice(0, HUB_INBOX_PREVIEW_LIMIT),
    [inboxEmails]
  );
  const displayedEmails: DisplayedEmail[] = previewEmails;

  const handleGmailSignIn = useCallback(async () => {
    setGmailSigningIn(true);
    try {
      const res = (await safeSendMessage({
        action: 'GMAIL_SIGN_IN',
      })) as GmailSignInResult;
      if (res?.success && res?.profile) {
        setGmailConnected(true);
        setGmailProfile(res.profile);
        setGmailBase(res.profile.email);
        setGmailIsManual(false);
        setPreferredEmailType('gmail');
        await persistGmailConnection(res.profile, false);
        onToast(`Connected: ${res.profile.email}`);
      } else {
        onToast(formatGmailSignInFailure(res));
      }
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Sign-in failed');
    } finally {
      setGmailSigningIn(false);
    }
  }, [
    onToast,
    setGmailConnected,
    setGmailProfile,
    setGmailBase,
    setGmailIsManual,
    setPreferredEmailType,
  ]);

  // ── Tab-switch: popup tab IS the fill source of truth ──
  const handleSwitchToDisposable = useCallback(() => {
    void (async () => {
      // Invalidate any in-flight Gmail request so a late response cannot
      // surface a Gmail error after the user has switched back to Temp mail.
      gmailInboxRequestSeqRef.current += 1;
      setGmailInboxError(null);
      setGmailInboxLoading(false);
      await storageService.setImmediate('preferredEmailType', 'disposable');
      setPreferredEmailType('disposable');
      const disposableEmail = emailAccount || (await storageService.get('disposableEmail'));
      if (isTemporaryMailAccount(disposableEmail)) {
        await storageService.setImmediate('currentEmail', disposableEmail);
        onToast(`Temp Mail active: ${disposableEmail.fullEmail}`);
      } else {
        await storageService.remove('currentEmail');
        onToast('Temp Mail tab active — generate a temp address to fill');
      }
    })();
  }, [setPreferredEmailType, emailAccount, onToast]);

  const handleSwitchToRealProvider = useCallback(() => {
    // Gmail is the only real-mail provider. Legacy stored zoho/microsoft
    // preferences fall through to Gmail (reconnect once) — see note below.
    void (async () => {
      await storageService.setImmediate('selectedRealProvider', 'gmail');
      await storageService.setImmediate('preferredEmailType', 'gmail');
      setPreferredEmailType('gmail');
      if (activeEmailAddress) {
        onToast(`Gmail active: ${activeEmailAddress}`);
      } else {
        onToast('Gmail active — connect your account');
      }
    })();
  }, [setPreferredEmailType, activeEmailAddress, onToast]);

  // Legacy Zoho/Outlook stored preference maps onto the Gmail flow.
  const isRealNotConnected = preferredEmailType !== 'disposable' && !gmailConnected;

  return (
    <div className="ghost-dashboard">
      {/* ───────────────────────────────────────────────────────────
                 📊 EMAIL TYPE SELECTOR (Temp Mail vs Mail Provider)
               ─────────────────────────────────────────────────────────── */}
      {IS_GMAIL_ENABLED && (
        <div
          className="hub-email-selector"
          role="tablist"
          aria-label={t('emailTypeSelector')}
          aria-orientation="horizontal"
        >
          {/* PERF: CSS transform slide (180ms expo-out, compositor-only).
            Old framer-motion spring overshot + ran on JS thread. */}
          <div
            className="hub-email-selector-bg"
            aria-hidden
            style={{
              position: 'absolute',
              top: 3,
              bottom: 3,
              left: 3,
              width: 'calc(50% - 3px)',
              margin: 0,
              transform:
                preferredEmailType === 'disposable' ? 'translateX(0%)' : 'translateX(100%)',
            }}
          />
          <button
            type="button"
            id="hub-tab-disposable"
            role="tab"
            aria-selected={preferredEmailType === 'disposable'}
            aria-controls="hub-email-panel"
            tabIndex={preferredEmailType === 'disposable' ? 0 : -1}
            className={`hub-email-selector-btn ${preferredEmailType === 'disposable' ? 'hub-email-selector-btn--active' : ''}`}
            onClick={handleSwitchToDisposable}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault();
                const next = document.getElementById('hub-tab-gmail');
                next?.focus();
                next?.click();
              }
            }}
          >
            <span className="hub-email-selector-label">
              <Mail size={13} strokeWidth={2.5} aria-hidden="true" />
              <span>{t('tempMailTab')}</span>
            </span>
          </button>
          <button
            type="button"
            id="hub-tab-gmail"
            role="tab"
            aria-selected={preferredEmailType !== 'disposable'}
            aria-controls="hub-email-panel"
            tabIndex={preferredEmailType !== 'disposable' ? 0 : -1}
            className={`hub-email-selector-btn ${preferredEmailType !== 'disposable' ? 'hub-email-selector-btn--active' : ''}`}
            onClick={handleSwitchToRealProvider}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault();
                const next = document.getElementById('hub-tab-disposable');
                next?.focus();
                next?.click();
              }
            }}
          >
            <span className="hub-email-selector-label">
              <span aria-hidden="true">
                <GmailLogo size={14} />
              </span>
              <span>{t('gmailTab')}</span>
            </span>
          </button>
        </div>
      )}

      <div
        className="hub-email-panel"
        id="hub-email-panel"
        role={IS_GMAIL_ENABLED ? 'tabpanel' : undefined}
        aria-labelledby={
          IS_GMAIL_ENABLED
            ? preferredEmailType === 'disposable'
              ? 'hub-tab-disposable'
              : 'hub-tab-gmail'
            : undefined
        }
        tabIndex={IS_GMAIL_ENABLED ? 0 : undefined}
      >
        {/* ═══════════════════════════════════════════════════════════
                 🎴 IDENTITY CARD - Combined Email & Password
               ═══════════════════════════════════════════════════════════ */}
        <div className="memphis-card identity-card">
          <AccountCard
            preferredEmailType={preferredEmailType}
            gmailConnected={gmailConnected}
            gmailSigningIn={gmailSigningIn}
            gmailBase={gmailBase}
            activeEmailAddress={activeEmailAddress}
            emailAccount={emailAccount}
            emailCopied={emailCopied}
            isGeneratingEmail={isGeneratingEmail}
            emailCooldown={emailCooldown}
            onCopyEmail={copyEmail}
            onGenerateEmail={handleGenerateEmail}
            onGmailSignIn={handleGmailSignIn}
            onSignOut={async () => {
              try {
                if (typeof chrome !== 'undefined' && chrome.identity) {
                  chrome.identity.clearAllCachedAuthTokens(() => {});
                }
                await clearGmailConnection(gmailIsManual);
                setGmailConnected(false);
                setGmailProfile(null);
                setGmailBase(null);
                setGmailIsManual(false);
                onToast('Gmail disconnected');
              } catch {
                onToast('Failed to disconnect Gmail');
              }
            }}
            gmailProfile={gmailProfile}
          />
          {!isRealNotConnected && (
            <QuickActions
              password={password}
              passwordCopied={passwordCopied}
              isGeneratingPassword={isGeneratingPassword}
              showPassword={showPassword}
              onCopyPassword={copyPassword}
              onToggleShowPassword={() => setShowPassword((s) => !s)}
              onGeneratePassword={handleGeneratePassword}
            />
          )}
        </div>

        {(preferredEmailType === 'disposable' ||
          (preferredEmailType === 'gmail' && gmailConnected)) && (
          <InboxList
            preferredEmailType={preferredEmailType}
            gmailConnected={gmailConnected}
            gmailIsManual={gmailIsManual}
            gmailInboxLoading={gmailInboxLoading}
            gmailInboxError={gmailInboxError}
            inboxCount={inboxEmails.length}
            displayedEmails={displayedEmails}
            openingEmailId={openingEmailId}
            onNavigate={onNavigate}
            onCopyOTP={handleCopyOTP}
            onOpenLink={handleOpenLink}
            onFetchGmailInbox={fetchProviderInbox}
            onOpenEmail={handleOpenEmail}
          />
        )}
      </div>

      <ConfirmModal
        isOpen={showConfirmEmail}
        title="Generate a new email?"
        message="Your current temporary email and its inbox will be permanently lost. This action cannot be undone."
        confirmText="Generate"
        cancelText="Cancel"
        onConfirm={executeGenerateEmail}
        onCancel={() => setShowConfirmEmail(false)}
        isDestructive={true}
      />

      {/* PERMANENT FIX 2026-06-21: email viewer so users can actually
          READ the email — previously the Hub inbox jumped to a tab. */}
      <EmailViewerModal
        messageKey={viewerEmail ? String(viewerEmail.id) : null}
        message={
          viewerEmail
            ? {
                subject: viewerEmail.subject,
                from: viewerEmail.from,
                fromName: viewerMeta.fromName,
                date: viewerEmail.date,
                dateFormatted: viewerMeta.dateFormatted,
                snippet: viewerEmail.snippet,
                body: viewerEmail.body,
                textBody: viewerEmail.textBody,
                htmlBody: viewerEmail.htmlBody,
                otp: viewerOtp,
                link: viewerLink,
              }
            : null
        }
        loading={viewerLoading}
        error={viewerError}
        onClose={handleCloseViewer}
        onToast={onToast}
      />
    </div>
  );
};

export default Hub;
