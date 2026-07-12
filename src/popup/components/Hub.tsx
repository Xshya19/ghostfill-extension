import { motion } from 'framer-motion';
import { Mail } from 'lucide-react';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  getDeterministicCombinedAlias,
  rememberGmailAliasSession,
  getGmailAliasSessionByDomain,
  persistGmailConnection,
  clearGmailConnection,
  isGmailSetupResponse,
  formatGmailSetupError,
  type GmailSignInResult,
} from '../../services/gmailConnectionService';
import { storageService } from '../../services/storageService';
import { itemRise, springTab, stagger } from '../../shared/ui/motion';
import { EmailAccount, Email, type ExtractOTPResponse } from '../../types';
import { TIMING, copyToClipboard, openSafeUrl } from '../../utils/core';
import { safeSendMessage } from '../../utils/messaging';
import { useOTPExtractor } from '../hooks/useOTPExtractor';
import { useStorageSubscription } from '../hooks/useStorageSubscription';
import { useAppStore } from '../store/useAppStore';
import { AccountCard, ConfirmModal, EmailViewerModal, InboxList, QuickActions, type DisplayedEmail } from './SharedComponents';

// i18n helper
const t = (key: string): string => {
  try {
    return chrome.i18n.getMessage(key) || key;
  } catch {
    return key;
  }
};

// Rate limit constants
const RATE_LIMIT_MS = {
  GENERATE_EMAIL: 3000, // 3 seconds between email generations
  CHECK_INBOX: 5000, // 5 seconds between inbox checks
  GENERATE_PASSWORD: 1000, // 1 second between password generations
};

const HUB_INBOX_PREVIEW_LIMIT = 2;

interface Props {
  onNavigate: (
    tab: 'email' | 'password' | 'otp' | 'aliases',
    options?: { aliasTab?: 'generator' | 'inbox' | 'history' }
  ) => void;
  emailAccount: EmailAccount | null;
  onGenerate: () => void;
  onToast: (message: string) => void;
}

const formatGmailSignInFailure = (res: GmailSignInResult | undefined): string => {
  if (isGmailSetupResponse(res)) {
    return formatGmailSetupError(res?.error);
  }
  return res?.error || 'Sign-in failed';
};

const Hub: React.FC<Props> = ({ onNavigate, emailAccount, onGenerate, onToast }) => {
  const preferredEmailType = useAppStore((s) => s.preferredEmailType);
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

  // Direct Gmail sign-in state
  const [gmailSigningIn, setGmailSigningIn] = useState(false);
  const gmailInboxRequestSeqRef = useRef(0);
  const lastOpenedEmailIdRef = useRef<string | null>(null);

  // State
  const [emailCopied, setEmailCopied] = useState(false);
  const [passwordCopied, setPasswordCopied] = useState(false);
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState(false);
  const [isGeneratingPassword, setIsGeneratingPassword] = useState(false);
  const [isGeneratingEmail, setIsGeneratingEmail] = useState(false);
  const [emailCooldown, setEmailCooldown] = useState(false);
  const [passwordCooldown, setPasswordCooldown] = useState(false);
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
        if (tab?.url) {
          try {
            let hostname = new URL(tab.url).hostname;
            if (hostname.startsWith('www.')) {
              hostname = hostname.slice(4);
            }
            if (hostname && !hostname.includes('newtab') && !hostname.includes('extensions')) {
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

  useEffect(() => {
    if (preferredEmailType !== 'disposable') {
      return;
    }
    void (async () => {
      const disposableEmail = emailAccount || (await storageService.get('disposableEmail'));
      if (disposableEmail?.fullEmail && disposableEmail.service !== 'gmail') {
        await storageService.set('currentEmail', disposableEmail);
      }
    })();
  }, [emailAccount, preferredEmailType]);

  const activeEmailAddress =
    preferredEmailType === 'gmail'
      ? activeGmailAlias || gmailBase || ''
      : emailAccount?.fullEmail || '';

  // Switch to Push-State UI instead of polling
  const rawInbox = useStorageSubscription('inbox', []);

  const inboxEmails = React.useMemo(() => {
    if (preferredEmailType === 'gmail') {
      return (gmailInbox || []).map((msg) => ({
        id: msg.id,
        from: msg.fromName || msg.from,
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

  const fetchGmailInbox = useCallback(async () => {
    const requestSeq = ++gmailInboxRequestSeqRef.current;
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
          maxResults: 10,
        },
      })) as any;
      if (res?.success && Array.isArray(res.messages)) {
        if (requestSeq === gmailInboxRequestSeqRef.current) {
          setGmailInbox(res.messages);
        }
      } else {
        if (requestSeq === gmailInboxRequestSeqRef.current) {
          setGmailInboxError(res?.error || 'Failed to fetch Gmail inbox');
        }
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
  }, [
    activeGmailAlias,
    gmailConnected,
    gmailIsManual,
    setGmailInbox,
    setGmailInboxError,
    setGmailInboxLoading,
  ]);

  useEffect(() => {
    if (preferredEmailType === 'gmail' && gmailConnected && !gmailIsManual) {
      void fetchGmailInbox();
    }
  }, [fetchGmailInbox, activeGmailAlias, gmailConnected, gmailIsManual, preferredEmailType]);

  // Generate strong 16-char password with rate limiting
  const generatePassword = useCallback(async () => {
    setIsGeneratingPassword(true);
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const { lastGeneratePasswordTime } = await chrome.storage.local.get(
          'lastGeneratePasswordTime'
        );
        const lastTime = parseInt(lastGeneratePasswordTime || '0', 10);
        const now = Date.now();
        if (now - lastTime < RATE_LIMIT_MS.GENERATE_PASSWORD) {
          setPasswordCooldown(true);
          if (passwordCooldownTimeoutRef.current) {
            clearTimeout(passwordCooldownTimeoutRef.current);
          }
          passwordCooldownTimeoutRef.current = setTimeout(
            () => setPasswordCooldown(false),
            RATE_LIMIT_MS.GENERATE_PASSWORD - (now - lastTime)
          );
          onToast('Rate limit hit. Please wait a moment.');
          return; // Rate limited
        }
        await chrome.storage.local.set({ lastGeneratePasswordTime: now.toString() });
      }

      const response = await safeSendMessage({
        action: 'GENERATE_PASSWORD',
        payload: { length: 16, uppercase: true, lowercase: true, numbers: true, symbols: true },
      });
      if (response && 'result' in response && response.result && 'password' in response.result) {
        setPassword(response.result.password);
      }
    } catch {
      onToast('Failed to generate password');
    } finally {
      setIsGeneratingPassword(false);
    }
  }, [onToast]);

  // Check inbox with rate limiting
  const checkInbox = useCallback(async () => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const { lastCheckInboxTime } = await chrome.storage.local.get('lastCheckInboxTime');
        const lastTime = parseInt(lastCheckInboxTime || '0', 10);
        const now = Date.now();
        if (now - lastTime < RATE_LIMIT_MS.CHECK_INBOX) {
          return; // Rate limited
        }
        await chrome.storage.local.set({ lastCheckInboxTime: now.toString() });
      }

      await safeSendMessage({ action: 'CHECK_INBOX' });
    } catch {
      onToast('Failed to sync inbox');
    }
  }, [onToast]);

  const hasGeneratedPassword = useRef(false);
  useEffect(() => {
    if (!password && !hasGeneratedPassword.current) {
      hasGeneratedPassword.current = true;
      void generatePassword();
    }
  }, [password, generatePassword]);

  const prevEmailAccountId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const currentId = emailAccount?.fullEmail;
    if (currentId && currentId !== prevEmailAccountId.current) {
      prevEmailAccountId.current = currentId;
      void checkInbox();
    }
  }, [emailAccount?.fullEmail, checkInbox]);

  // Refs for timeout clearing
  const emailTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const passwordTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generatingEmailTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emailCooldownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const passwordCooldownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (emailTimeoutRef.current) {
        clearTimeout(emailTimeoutRef.current);
      }
      if (passwordTimeoutRef.current) {
        clearTimeout(passwordTimeoutRef.current);
      }
      if (generatingEmailTimeoutRef.current) {
        clearTimeout(generatingEmailTimeoutRef.current);
      }
      if (emailCooldownTimeoutRef.current) {
        clearTimeout(emailCooldownTimeoutRef.current);
      }
      if (passwordCooldownTimeoutRef.current) {
        clearTimeout(passwordCooldownTimeoutRef.current);
      }
    };
  }, []);

  // Handlers
  const copyEmail = useCallback(async () => {
    if (!activeEmailAddress) {
      return;
    }

    try {
      const copied = await copyToClipboard(activeEmailAddress);
      if (!copied) {
        onToast(t('copyFailed'));
        return;
      }
      setEmailCopied(true);
      onToast(t('emailCopied'));
    } catch {
      onToast(t('copyFailed'));
      return;
    }

    if (emailTimeoutRef.current) {
      clearTimeout(emailTimeoutRef.current);
    }
    emailTimeoutRef.current = setTimeout(() => setEmailCopied(false), TIMING.COPY_CONFIRMATION_MS);
  }, [activeEmailAddress, onToast]);

  const copyPassword = useCallback(async () => {
    if (!password) {
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

  const handleGenerateEmail = useCallback(() => {
    setShowConfirmEmail(true);
  }, []);

  const executeGenerateEmail = useCallback(() => {
    setShowConfirmEmail(false);
    void (async () => {
      try {
        const now = Date.now();
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          const { lastGenerateEmailTime } = await chrome.storage.local.get('lastGenerateEmailTime');
          const lastTime = parseInt(lastGenerateEmailTime || '0', 10);
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

        setIsGeneratingEmail(true);
        onGenerate();

        if (generatingEmailTimeoutRef.current) {
          clearTimeout(generatingEmailTimeoutRef.current);
        }
        generatingEmailTimeoutRef.current = setTimeout(() => setIsGeneratingEmail(false), 5000);
      } catch {
        onToast('Failed to generate email. Please try again.');
      }
    })();
  }, [onGenerate, onToast]);



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
      onToast('Opening activation link...');
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
      lastOpenedEmailIdRef.current = currentId;

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

          if (lastOpenedEmailIdRef.current !== currentId) {
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
              if (lastOpenedEmailIdRef.current !== currentId) {
                return prev;
              }
              return {
                ...prev,
                ...(fullMsg.dateFormatted ? { dateFormatted: fullMsg.dateFormatted } : {}),
                ...(fullMsg.from ? { fromName: fullMsg.from } : {}),
              };
            });

            const extract = (await safeSendMessage({
              action: 'EXTRACT_OTP',
              payload: {
                subject: fullMsg.subject ?? emailItem.subject,
                text: fullMsg.body ?? emailItem.body ?? '',
                textBody: fullMsg.body ?? emailItem.body ?? '',
                htmlBody: fullMsg.htmlBody ?? '',
                emailId: emailItem.id,
                emailFrom: fullMsg.from ?? emailItem.from,
              },
            })) as ExtractOTPResponse | null;

            if (lastOpenedEmailIdRef.current !== currentId) {
              return;
            }

            if (extract?.success) {
              if (typeof extract.otp === 'string' && extract.otp) {
                setViewerOtp(extract.otp);
              }
              if (typeof extract.link === 'string' && extract.link) {
                setViewerLink(extract.link);
              }
            }
          } else if (res?.error) {
            setViewerError(typeof res.error === 'string' ? res.error : 'Could not load message');
          }
        }
      } catch (err) {
        if (lastOpenedEmailIdRef.current === currentId) {
          setViewerError(err instanceof Error ? err.message : 'Failed to load message');
        }
      } finally {
        if (lastOpenedEmailIdRef.current === currentId) {
          setViewerLoading(false);
        }
      }
    },
    [preferredEmailType]
  );

  const handleCloseViewer = useCallback(() => {
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
  const { otps: emailOTPs, links: emailLinks } = useOTPExtractor(previewEmails);

  const displayedEmails: DisplayedEmail[] = React.useMemo(() => {
    return previewEmails.map((email: Email) => ({
      ...email,
      otpCode: emailOTPs[email.id] !== undefined ? emailOTPs[email.id] : undefined,
      activationLink: emailLinks[email.id] !== undefined ? emailLinks[email.id] : undefined,
    }));
  }, [previewEmails, emailOTPs, emailLinks]);

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
  // Temp Mail tab → fill disposable only; Gmail tab → fill gmail only.
  // Await storage writes so fill never races a stale preferredEmailType.
  const handleSwitchToDisposable = useCallback(() => {
    void (async () => {
      await storageService.setImmediate('preferredEmailType', 'disposable');
      setPreferredEmailType('disposable');
      const disposableEmail = emailAccount || (await storageService.get('disposableEmail'));
      if (disposableEmail?.fullEmail && disposableEmail.service !== 'gmail') {
        await storageService.setImmediate('currentEmail', disposableEmail);
        onToast(`Temp Mail active: ${disposableEmail.fullEmail}`);
      } else {
        await storageService.remove('currentEmail');
        onToast('Temp Mail tab active — generate a temp address to fill');
      }
    })();
  }, [setPreferredEmailType, emailAccount, onToast]);

  const handleSwitchToGmail = useCallback(() => {
    void (async () => {
      await storageService.setImmediate('preferredEmailType', 'gmail');
      setPreferredEmailType('gmail');
      const alias = activeGmailAlias || gmailBase;
      if (gmailConnected && alias && gmailBase) {
        const session = await rememberGmailAliasSession(
          alias,
          gmailBase,
          currentTabDomain || 'general'
        );
        await storageService.setImmediate('currentEmail', {
          id: `gmail_${alias.replace(/[@.+]/g, '_')}`,
          fullEmail: alias,
          domain: 'gmail.com',
          service: 'gmail',
          createdAt: session.startedAt,
          expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
          gmailBaseEmail: gmailBase,
          gmailAliasSessionStartedAt: session.startedAt,
        });
        onToast(`Gmail active: ${alias}`);
      } else if (gmailConnected && gmailBase) {
        await storageService.setImmediate('currentEmail', {
          id: `gmail_${gmailBase.replace(/[@.+]/g, '_')}`,
          fullEmail: gmailBase,
          domain: 'gmail.com',
          service: 'gmail',
          createdAt: Date.now(),
          expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
          gmailBaseEmail: gmailBase,
        });
        onToast(`Gmail active: ${gmailBase}`);
      } else {
        onToast('Gmail tab active — connect Gmail in popup to fill');
      }
    })();
  }, [
    setPreferredEmailType,
    gmailConnected,
    activeGmailAlias,
    gmailBase,
    currentTabDomain,
    onToast,
  ]);

  return (
    <motion.div className="ghost-dashboard" variants={stagger} initial="initial" animate="animate">
      {/* ───────────────────────────────────────────────────────────
                 📊 EMAIL TYPE SELECTOR (Disposable vs Gmail)
               ─────────────────────────────────────────────────────────── */}
      <div className="hub-email-selector" role="tablist">
        <motion.div
          className="hub-email-selector-bg"
          initial={false}
          animate={{ x: preferredEmailType === 'disposable' ? '0%' : '100%' }}
          transition={springTab}
          style={{
            position: 'absolute',
            top: 3,
            bottom: 3,
            left: 3,
            width: 'calc(50% - 3px)',
            margin: 0,
          }}
        />
        <button
          role="tab"
          aria-selected={preferredEmailType === 'disposable'}
          className={`hub-email-selector-btn ${preferredEmailType === 'disposable' ? 'hub-email-selector-btn--active' : ''}`}
          onClick={handleSwitchToDisposable}
        >
          <span className="hub-email-selector-label">
            <Mail size={13} strokeWidth={2.5} />
            <span>Temp Mail</span>
          </span>
        </button>
        <button
          role="tab"
          aria-selected={preferredEmailType === 'gmail'}
          className={`hub-email-selector-btn ${preferredEmailType === 'gmail' ? 'hub-email-selector-btn--active' : ''}`}
          onClick={handleSwitchToGmail}
        >
          <span className="hub-email-selector-label">
            <Mail size={13} strokeWidth={2.5} />
            <span>Gmail</span>
          </span>
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════
                 🎴 IDENTITY CARD - Combined Email & Password
               ═══════════════════════════════════════════════════════════ */}
      <motion.div className="memphis-card identity-card" variants={itemRise}>
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
          gmailProfile={gmailProfile}
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
              setPreferredEmailType('disposable');
              onToast('Gmail disconnected');
            } catch {
              onToast('Failed to disconnect Gmail');
            }
          }}
        />
        {!(preferredEmailType === 'gmail' && !gmailConnected) && (
          <QuickActions
            password={password}
            passwordCopied={passwordCopied}
            isGeneratingPassword={isGeneratingPassword}
            passwordCooldown={passwordCooldown}
            showPassword={showPassword}
            onCopyPassword={copyPassword}
            onToggleShowPassword={() => setShowPassword((s) => !s)}
            onGeneratePassword={handleGeneratePassword}
          />
        )}
      </motion.div>

      {(preferredEmailType === 'disposable' || (preferredEmailType === 'gmail' && gmailConnected)) && (
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
          onFetchGmailInbox={fetchGmailInbox}
          onOpenEmail={handleOpenEmail}
        />
      )}

      <ConfirmModal
        isOpen={showConfirmEmail}
        title="Generate New Email?"
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
    </motion.div>
  );
};

export default Hub;
