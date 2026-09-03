import { motion } from 'framer-motion';
import { Mail, Globe } from 'lucide-react';
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
} from '../../../services/gmailConnectionService';
import { storageService } from '../../../services/storageService';
import {
  EmailAccount,
  Email,
  type ExtractOTPResponse,
  type ReadEmailResponse,
  type PasswordOptions,
  DEFAULT_PASSWORD_OPTIONS,
} from '../../../types';
import { TIMING, copyToClipboard, openSafeUrl } from '../../../utils/core';
import { safeSendMessage } from '../../../utils/messaging';
import { itemRise, springTab, stagger } from '../../ui';
import { useOTPExtractor, useStorageSubscription } from '../hooks';
import { useAppStore } from '../store';
import {
  AccountCard,
  ConfirmModal,
  EmailViewerModal,
  InboxList,
  QuickActions,
  type DisplayedEmail,
} from './SharedComponents';

// i18n helper
const t = (key: string): string => {
  try {
    return chrome.i18n.getMessage(key) || key;
  } catch {
    return key;
  }
};

const toSafeStr = (v: unknown): string => {
  if (typeof v === 'string') {return v;}
  if (!v) {return '';}
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (typeof obj.text === 'string') {return obj.text;}
    if (typeof obj.html === 'string') {return obj.html;}
    if (typeof obj.body === 'string') {return obj.body;}
  }
  return '';
};

// Rate limit constants
const RATE_LIMIT_MS = {
  GENERATE_EMAIL: 3000, // 3 seconds between email generations
  CHECK_INBOX: 5000, // 5 seconds between inbox checks
  GENERATE_PASSWORD: 1000, // 1 second between password generations
};

const HUB_INBOX_PREVIEW_LIMIT = 2;

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
  const setPreferredEmailType = useAppStore((s) => s.setPreferredEmailType);
  const selectedRealProvider = useAppStore((s) => s.selectedRealProvider);
  const setSelectedRealProvider = useAppStore((s) => s.setSelectedRealProvider);
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
  const zohoConnected = useAppStore((s) => s.zohoConnected);
  const setZohoConnected = useAppStore((s) => s.setZohoConnected);
  const zohoProfile = useAppStore((s) => s.zohoProfile);
  const setZohoProfile = useAppStore((s) => s.setZohoProfile);
  const microsoftConnected = useAppStore((s) => s.microsoftConnected);
  const setMicrosoftConnected = useAppStore((s) => s.setMicrosoftConnected);
  const microsoftProfile = useAppStore((s) => s.microsoftProfile);
  const setMicrosoftProfile = useAppStore((s) => s.setMicrosoftProfile);
  const setCurrentTabHostname = useAppStore((state) => state.setCurrentTabHostname);

  // Direct Provider sign-in states
  const [gmailSigningIn, setGmailSigningIn] = useState(false);
  const [zohoSigningIn, setZohoSigningIn] = useState(false);
  const [microsoftSigningIn, setMicrosoftSigningIn] = useState(false);
  const gmailInboxRequestSeqRef = useRef(0);
  const lastOpenedEmailIdRef = useRef<string | null>(null);

  // State
  const [emailCopied, setEmailCopied] = useState(false);
  const [passwordCopied, setPasswordCopied] = useState(false);
  const [password, setPassword] = useState<string>('');
  // Password recipe from Options > Passwords. Loaded once per popup open;
  // falls back to service defaults when settings are unreachable.
  const [passwordDefaults, setPasswordDefaults] = useState<PasswordOptions | null>(null);
  useEffect(() => {
    let cancelled = false;
    storageService
      .getSettings()
      .then((s) => {
        if (!cancelled && s?.passwordDefaults) {
          setPasswordDefaults({ ...s.passwordDefaults });
        }
      })
      .catch(() => {
        // defaults stay null → service-side defaults apply
      });
    return () => {
      cancelled = true;
    };
  }, []);
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
    if (preferredEmailType !== 'disposable') {
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
            maxResults: 20,
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
    } else if (preferredEmailType === 'zoho') {
      if (!zohoConnected) {
        setGmailInboxLoading(false);
        return;
      }

      setGmailInboxLoading(true);
      setGmailInboxError(null);
      try {
        const res = (await safeSendMessage({
          action: 'ZOHO_SEARCH_INBOX',
          payload: {
            alias: activeEmailAddress || zohoProfile?.email || '',
          },
        })) as any;
        if (res?.success && Array.isArray(res.messages)) {
          if (requestSeq === gmailInboxRequestSeqRef.current) {
            setGmailInbox(res.messages);
          }
        } else if (requestSeq === gmailInboxRequestSeqRef.current) {
          setGmailInboxError(res?.error || 'Failed to fetch Zoho Mail inbox');
        }
      } catch (e: unknown) {
        if (requestSeq === gmailInboxRequestSeqRef.current) {
          setGmailInboxError(e instanceof Error ? e.message : 'Failed to fetch Zoho Mail inbox');
        }
      } finally {
        if (requestSeq === gmailInboxRequestSeqRef.current) {
          setGmailInboxLoading(false);
        }
      }
    } else if (preferredEmailType === 'microsoft') {
      if (!microsoftConnected) {
        setGmailInboxLoading(false);
        return;
      }

      setGmailInboxLoading(true);
      setGmailInboxError(null);
      try {
        const res = (await safeSendMessage({
          action: 'MICROSOFT_SEARCH_INBOX',
          payload: {
            alias: activeEmailAddress || microsoftProfile?.email || '',
          },
        })) as any;
        if (res?.success && Array.isArray(res.messages)) {
          if (requestSeq === gmailInboxRequestSeqRef.current) {
            setGmailInbox(res.messages);
          }
        } else if (requestSeq === gmailInboxRequestSeqRef.current) {
          setGmailInboxError(res?.error || 'Failed to fetch Outlook inbox');
        }
      } catch (e: unknown) {
        if (requestSeq === gmailInboxRequestSeqRef.current) {
          setGmailInboxError(e instanceof Error ? e.message : 'Failed to fetch Outlook inbox');
        }
      } finally {
        if (requestSeq === gmailInboxRequestSeqRef.current) {
          setGmailInboxLoading(false);
        }
      }
    }
  }, [
    activeEmailAddress,
    activeGmailAlias,
    gmailConnected,
    gmailIsManual,
    microsoftConnected,
    microsoftProfile?.email,
    preferredEmailType,
    setGmailInbox,
    setGmailInboxError,
    setGmailInboxLoading,
    zohoConnected,
    zohoProfile?.email,
  ]);

  useEffect(() => {
    if (
      (preferredEmailType === 'gmail' && gmailConnected && !gmailIsManual) ||
      (preferredEmailType === 'zoho' && zohoConnected) ||
      (preferredEmailType === 'microsoft' && microsoftConnected)
    ) {
      void fetchProviderInbox();
    }
  }, [
    fetchProviderInbox,
    activeGmailAlias,
    gmailConnected,
    gmailIsManual,
    zohoConnected,
    microsoftConnected,
    preferredEmailType,
  ]);

  // Generate password with the Options > Passwords recipe when loaded,
  // otherwise the service defaults (length 20).
  const generatePassword = useCallback(async () => {
    setIsGeneratingPassword(true);
    const recipe: PasswordOptions = passwordDefaults ?? DEFAULT_PASSWORD_OPTIONS;
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

  // Check inbox with rate limiting
  const checkInbox = useCallback(async () => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const { lastCheckInboxTime } = await chrome.storage.local.get('lastCheckInboxTime');
        const lastTime = parseInt(lastCheckInboxTime || '0', 10);
        const now = Date.now();
        if (now - lastTime < RATE_LIMIT_MS.CHECK_INBOX) {
          const waitS = Math.max(
            1,
            Math.ceil((RATE_LIMIT_MS.CHECK_INBOX - (now - lastTime)) / 1000)
          );
          onToast(`Sync cooling down — retry in ${waitS}s`);
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
      onToast('No password yet — generating one…');
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

            const bodyStr = toSafeStr(fullMsg.body ?? emailItem.body);
            const htmlStr = toSafeStr(fullMsg.htmlBody);

            const extract = (await safeSendMessage({
              action: 'EXTRACT_OTP',
              payload: {
                subject: toSafeStr(fullMsg.subject ?? emailItem.subject),
                text: bodyStr,
                textBody: bodyStr,
                htmlBody: htmlStr,
                emailId: emailItem.id,
                emailFrom: toSafeStr(fullMsg.from ?? emailItem.from),
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

          if (lastOpenedEmailIdRef.current !== currentId) {
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
                emailId: emailItem.id,
                emailFrom: toSafeStr(fullMsg.from ?? emailItem.from),
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

  const handleZohoSignIn = useCallback(async () => {
    setZohoSigningIn(true);
    try {
      const res = (await safeSendMessage({ action: 'ZOHO_CONNECT' })) as any;
      if (res?.success && res?.profile) {
        setZohoConnected(true);
        setZohoProfile(res.profile);
        onToast(`Zoho Mail connected: ${res.profile.email}`);
      } else {
        onToast(res?.error || 'Zoho sign-in failed');
      }
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Zoho sign-in failed');
    } finally {
      setZohoSigningIn(false);
    }
  }, [onToast, setZohoConnected, setZohoProfile]);

  const handleZohoSignOut = useCallback(async () => {
    try {
      await safeSendMessage({ action: 'ZOHO_DISCONNECT' });
      setZohoConnected(false);
      setZohoProfile(null);
      onToast('Zoho Mail disconnected');
    } catch {
      onToast('Failed to disconnect Zoho Mail');
    }
  }, [onToast, setZohoConnected, setZohoProfile]);

  const handleMicrosoftSignIn = useCallback(async () => {
    setMicrosoftSigningIn(true);
    try {
      const res = (await safeSendMessage({ action: 'MICROSOFT_CONNECT' })) as any;
      if (res?.success && res?.profile) {
        setMicrosoftConnected(true);
        setMicrosoftProfile(res.profile);
        onToast(`Outlook connected: ${res.profile.email}`);
      } else {
        onToast(res?.error || 'Microsoft sign-in failed');
      }
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Microsoft sign-in failed');
    } finally {
      setMicrosoftSigningIn(false);
    }
  }, [onToast, setMicrosoftConnected, setMicrosoftProfile]);

  const handleMicrosoftSignOut = useCallback(async () => {
    try {
      await safeSendMessage({ action: 'MICROSOFT_DISCONNECT' });
      setMicrosoftConnected(false);
      setMicrosoftProfile(null);
      onToast('Microsoft Outlook disconnected');
    } catch {
      onToast('Failed to disconnect Microsoft Outlook');
    }
  }, [onToast, setMicrosoftConnected, setMicrosoftProfile]);

  const handleSelectProvider = useCallback(
    (provider: 'gmail' | 'zoho' | 'microsoft') => {
      setSelectedRealProvider(provider);
      void (async () => {
        await storageService.setImmediate('selectedRealProvider', provider);
        // Always propagate: the two keys mean the same thing and a split
        // pair (selector says zoho, fill still uses gmail) mis-fills forms.
        // Switching back to Temp Mail is explicit via handleSwitchToDisposable.
        await storageService.setImmediate('preferredEmailType', provider);
        setPreferredEmailType(provider);
      })();
    },
    [setSelectedRealProvider, setPreferredEmailType]
  );

  // ── Tab-switch: popup tab IS the fill source of truth ──
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

  const handleSwitchToRealProvider = useCallback(() => {
    void (async () => {
      await storageService.setImmediate('preferredEmailType', selectedRealProvider);
      setPreferredEmailType(selectedRealProvider);
      if (activeEmailAddress) {
        onToast(`${selectedRealProvider.toUpperCase()} active: ${activeEmailAddress}`);
      } else {
        onToast('Mail Provider active — select or connect your account');
      }
    })();
  }, [setPreferredEmailType, selectedRealProvider, activeEmailAddress, onToast]);

  const isRealNotConnected =
    preferredEmailType !== 'disposable' &&
    ((selectedRealProvider === 'gmail' && !gmailConnected) ||
      (selectedRealProvider === 'zoho' && !zohoConnected) ||
      (selectedRealProvider === 'microsoft' && !microsoftConnected));

  return (
    <motion.div className="ghost-dashboard" variants={stagger} initial="initial" animate="animate">
      {/* ───────────────────────────────────────────────────────────
                 📊 EMAIL TYPE SELECTOR (Temp Mail vs Mail Provider)
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
            <span>Temp mail</span>
          </span>
        </button>
        <button
          role="tab"
          aria-selected={preferredEmailType !== 'disposable'}
          className={`hub-email-selector-btn ${preferredEmailType !== 'disposable' ? 'hub-email-selector-btn--active' : ''}`}
          onClick={handleSwitchToRealProvider}
        >
          <span className="hub-email-selector-label">
            <Globe size={13} strokeWidth={2.5} />
            <span>Mail Provider</span>
          </span>
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════
                 🎴 IDENTITY CARD - Combined Email & Password
               ═══════════════════════════════════════════════════════════ */}
      <motion.div className="memphis-card identity-card" variants={itemRise}>
        <AccountCard
          preferredEmailType={preferredEmailType}
          selectedRealProvider={selectedRealProvider}
          onSelectRealProvider={handleSelectProvider}
          gmailConnected={gmailConnected}
          gmailSigningIn={gmailSigningIn}
          gmailBase={gmailBase}
          zohoConnected={zohoConnected}
          zohoSigningIn={zohoSigningIn}
          zohoBase={zohoProfile?.email || null}
          microsoftConnected={microsoftConnected}
          microsoftSigningIn={microsoftSigningIn}
          microsoftBase={microsoftProfile?.email || null}
          activeEmailAddress={activeEmailAddress}
          emailAccount={emailAccount}
          emailCopied={emailCopied}
          isGeneratingEmail={isGeneratingEmail}
          emailCooldown={emailCooldown}
          onCopyEmail={copyEmail}
          onGenerateEmail={handleGenerateEmail}
          onGmailSignIn={handleGmailSignIn}
          onZohoSignIn={handleZohoSignIn}
          onMicrosoftSignIn={handleMicrosoftSignIn}
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
          onZohoSignOut={handleZohoSignOut}
          onMicrosoftSignOut={handleMicrosoftSignOut}
          gmailProfile={gmailProfile}
          zohoProfile={zohoProfile}
          microsoftProfile={microsoftProfile}
        />
        {!isRealNotConnected && (
          <QuickActions
            password={password}
            passwordCopied={passwordCopied}
            isGeneratingPassword={isGeneratingPassword}
            passwordCooldown={passwordCooldown}
            showPassword={showPassword}
            onCopyPassword={copyPassword}
            onToggleShowPassword={() => setShowPassword((s) => !s)}
            onGeneratePassword={handleGeneratePassword}
            onOpenVault={() => onNavigate('password')}
          />
        )}
      </motion.div>

      {(preferredEmailType === 'disposable' ||
        (preferredEmailType === 'gmail' && gmailConnected) ||
        (preferredEmailType === 'zoho' && zohoConnected) ||
        (preferredEmailType === 'microsoft' && microsoftConnected)) && (
        <InboxList
          preferredEmailType={preferredEmailType}
          gmailConnected={gmailConnected}
          gmailIsManual={gmailIsManual}
          gmailInboxLoading={gmailInboxLoading}
          gmailInboxError={gmailInboxError}
          zohoConnected={zohoConnected}
          microsoftConnected={microsoftConnected}
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
