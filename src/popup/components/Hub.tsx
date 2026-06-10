import { motion } from 'framer-motion';
import {
  Mail,
  Lock,
  Copy,
  RefreshCw,
  Check,
  Inbox,
  ChevronRight,
  Eye,
  EyeOff,
  Clock,
  AlertCircle,
} from 'lucide-react';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import gmailLogo from '../../assets/icons/gmail_icon.png';
import { getDeterministicCombinedAlias } from '../../services/aliasService';
import {
  clearGmailAliasSessions,
  rememberGmailAliasSession,
  setGmailConnectedAt,
  getGmailAliasSessionByDomain,
} from '../../services/gmailAliasSessionService';
import { storageService } from '../../services/storageService';
import { EmailAccount, Email } from '../../types';
import { type GmailProfile } from '../../types/message.types';
import { TIMING } from '../../utils/constants';
import { formatRelativeTime } from '../../utils/formatters';
import { copyToClipboard } from '../../utils/helpers';
import { safeSendMessage } from '../../utils/messaging';
import { useOTPExtractor } from '../hooks/useOTPExtractor';
import { useStorageSubscription } from '../hooks/useStorageSubscription';
import { useAppStore } from '../store/useAppStore';
import { ConfirmModal } from './ConfirmModal';
import { CountdownTimer } from './CountdownTimer';
import { EmailAvatar } from './EmailAvatar';

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

interface Props {
  onNavigate: (
    tab: 'email' | 'password' | 'otp' | 'aliases',
    options?: { aliasTab?: 'generator' | 'inbox' | 'history' }
  ) => void;
  emailAccount: EmailAccount | null;
  onGenerate: () => void;
  onToast: (message: string) => void;
}

interface GmailSignInResult {
  success?: boolean;
  profile?: GmailProfile;
  error?: string;
  setupRequired?: boolean;
}

const formatGmailSignInFailure = (res: GmailSignInResult | undefined): string => {
  if (res?.setupRequired) {
    return res.error
      ? `${res.error} Add a valid Gmail OAuth Client ID in Options > Email.`
      : 'Gmail needs a valid OAuth Client ID in Options > Email.';
  }
  return res?.error || 'Sign-in failed';
};

const CONTAINER_VARIANTS = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      // Cap the stagger at 0.03s so even 20 items render in under 0.6s
      staggerChildren: 0.03,
      delayChildren: 0.05,
    },
  },
};

const ITEM_VARIANTS = {
  hidden: { opacity: 0, y: 12, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: 'spring' as const,
      stiffness: 200,
      damping: 28,
      mass: 0.9,
    },
  },
};

/** Persist a successful Gmail OAuth connection (mirrors AliasPanel logic). */
const persistGmailConnection = (profile: GmailProfile): Promise<unknown> =>
  Promise.all([
    setGmailConnectedAt(),
    storageService.setImmediate('gmailProfile', profile),
    storageService.setImmediate('gmailBase', profile.email),
    storageService.setImmediate('gmailConnected', true),
    storageService.setImmediate('gmailIsManual', false),
    storageService.setImmediate('preferredEmailType', 'gmail'),
    storageService.setImmediate('inbox', []),
    clearGmailAliasSessions(),
  ]);

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

  // Direct Gmail sign-in state
  const [gmailSigningIn, setGmailSigningIn] = useState(false);
  const gmailInboxRequestSeqRef = useRef(0);

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

  const [currentTabDomain, setCurrentTabDomain] = useState<string>('');

  // Query current tab domain
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

  const handleGenerateGmailAlias = useCallback(() => {
    if (!gmailConnected) {
      return;
    }
    void (async () => {
      try {
        setIsGeneratingEmail(true);
        const res = (await safeSendMessage({
          action: 'GENERATE_GMAIL_ALIAS',
          payload: { domain: currentTabDomain || 'general' },
        })) as { success?: boolean; email?: EmailAccount; error?: string };
        if (res?.success && res?.email) {
          setActiveGmailAlias(res.email.fullEmail);
          onToast('New Gmail alias generated!');
        } else {
          onToast(res?.error || 'Failed to generate Gmail alias');
        }
      } catch {
        onToast('Failed to generate Gmail alias');
      } finally {
        setIsGeneratingEmail(false);
      }
    })();
  }, [currentTabDomain, gmailConnected, onToast]);

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
    async (event: React.MouseEvent, url: string) => {
      event.stopPropagation();
      try {
        const safeUrl = new URL(url).href;
        if (!safeUrl.startsWith('http://') && !safeUrl.startsWith('https://')) {
          throw new Error('Invalid URL protocol');
        }
        onToast('Opening activation link...');
        await chrome.tabs.create({ url: safeUrl, active: true });
      } catch {
        onToast('Failed to open link');
      }
    },
    [onToast]
  );

  // formatRelativeTime and extractOTP imported from utils/formatters

  const { otps: emailOTPs, links: emailLinks } = useOTPExtractor(inboxEmails.slice(0, 3));

  const displayedEmails = React.useMemo(() => {
    return inboxEmails.slice(0, 3).map((email: Email) => ({
      ...email,
      otpCode: emailOTPs[email.id] !== undefined ? emailOTPs[email.id] : undefined,
      activationLink: emailLinks[email.id] !== undefined ? emailLinks[email.id] : undefined,
    }));
  }, [inboxEmails, emailOTPs, emailLinks]);

  const canOpenInbox =
    (preferredEmailType === 'gmail' && gmailConnected && !gmailIsManual) ||
    (preferredEmailType !== 'gmail' && inboxEmails.length > 0);

  // ── Tab-switch handlers that immediately sync currentEmail in chrome.storage ──
  const handleSwitchToDisposable = useCallback(() => {
    if (preferredEmailType === 'disposable') {
      return;
    }
    setPreferredEmailType('disposable');
    // Immediately sync currentEmail to disposable email
    void (async () => {
      const disposableEmail = emailAccount || (await storageService.get('disposableEmail'));
      if (disposableEmail?.fullEmail && disposableEmail.service !== 'gmail') {
        await storageService.setImmediate('currentEmail', disposableEmail);
      } else {
        // No disposable email yet — remove currentEmail so Gmail doesn't leak
        await storageService.remove('currentEmail');
      }
    })();
  }, [preferredEmailType, setPreferredEmailType, emailAccount]);

  const handleSwitchToGmail = useCallback(() => {
    if (preferredEmailType === 'gmail') {
      return;
    }
    setPreferredEmailType('gmail');
    // Immediately sync currentEmail to Gmail alias
    if (gmailConnected && !gmailIsManual && activeGmailAlias && gmailBase) {
      void (async () => {
        const session = await rememberGmailAliasSession(
          activeGmailAlias,
          gmailBase,
          currentTabDomain || 'general'
        );
        await storageService.setImmediate('currentEmail', {
          id: `gmail_${activeGmailAlias.replace(/[@.+]/g, '_')}`,
          fullEmail: activeGmailAlias,
          domain: 'gmail.com',
          service: 'gmail',
          createdAt: session.startedAt,
          expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
          gmailBaseEmail: gmailBase,
          gmailAliasSessionStartedAt: session.startedAt,
        });
      })();
    }
  }, [
    preferredEmailType,
    setPreferredEmailType,
    gmailConnected,
    gmailIsManual,
    activeGmailAlias,
    gmailBase,
    currentTabDomain,
  ]);

  return (
    <motion.div
      className="ghost-dashboard"
      variants={CONTAINER_VARIANTS}
      initial="hidden"
      animate="visible"
    >
      {/* ───────────────────────────────────────────────────────────
                 📊 EMAIL TYPE SELECTOR (Disposable vs Gmail)
               ─────────────────────────────────────────────────────────── */}
      <div className="hub-email-selector" role="tablist">
        <button
          role="tab"
          aria-selected={preferredEmailType === 'disposable'}
          className={`hub-email-selector-btn ${preferredEmailType === 'disposable' ? 'hub-email-selector-btn--active' : ''}`}
          onClick={handleSwitchToDisposable}
        >
          {preferredEmailType === 'disposable' && (
            <motion.div
              className="hub-email-selector-bg"
              layoutId="activeEmailTypeTab"
              transition={{ type: 'spring', stiffness: 350, damping: 25 }}
            />
          )}
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
          {preferredEmailType === 'gmail' && (
            <motion.div
              className="hub-email-selector-bg"
              layoutId="activeEmailTypeTab"
              transition={{ type: 'spring', stiffness: 350, damping: 25 }}
            />
          )}
          <span className="hub-email-selector-label">
            <Mail size={13} strokeWidth={2.5} />
            <span>Gmail</span>
          </span>
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════
                 🎴 IDENTITY CARD - Combined Email & Password
               ═══════════════════════════════════════════════════════════ */}
      <motion.div className="memphis-card identity-card" variants={ITEM_VARIANTS}>
        {preferredEmailType === 'gmail' && !gmailConnected ? (
          <div className="hub-gmail-not-connected">
            <div className="hub-gmail-icon-box">
              <img
                src={gmailLogo}
                alt="Gmail Logo"
                className="hub-gmail-logo-img"
                width={36}
                height={36}
              />
            </div>
            <span className="hub-gmail-title">Connect Gmail</span>
            <span className="hub-gmail-desc">
              Create site-specific aliases and sync OTP emails from your Gmail account.
            </span>
            <motion.button
              onClick={async () => {
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
                    await persistGmailConnection(res.profile);
                    onToast(`Connected: ${res.profile.email}`);
                  } else {
                    onToast(formatGmailSignInFailure(res));
                  }
                } catch (e) {
                  onToast(e instanceof Error ? e.message : 'Sign-in failed');
                } finally {
                  setGmailSigningIn(false);
                }
              }}
              className="hub-gmail-connect-btn"
              whileHover={{ x: -1, y: -1 }}
              whileTap={{ x: 1, y: 1 }}
              disabled={gmailSigningIn}
            >
              {gmailSigningIn ? (
                <span>
                  <RefreshCw size={14} className="spin" /> Connecting...
                </span>
              ) : (
                <span>Connect Gmail</span>
              )}
            </motion.button>
          </div>
        ) : (
          <>
            {/* Email Row */}
            <div className="identity-row">
              <div className="identity-icon">
                <Mail size={18} className="icon-premium" />
              </div>
              <div className="identity-content">
                <div className="identity-label-group">
                  <span className="identity-label">
                    {preferredEmailType === 'gmail' ? 'Gmail Alias' : t('emailLabel')}
                  </span>
                  {preferredEmailType === 'disposable' && (
                    <CountdownTimer
                      expiresAt={emailAccount?.expiresAt}
                      expiredLabel={t('expiredLabel') || 'Expired'}
                    />
                  )}
                </div>
                <span
                  className={`identity-value hub-val hub-val-email break-all ${
                    preferredEmailType === 'disposable' && !emailAccount ? 'shimmer' : ''
                  }`}
                >
                  {preferredEmailType === 'gmail'
                    ? activeEmailAddress || 'Connect Gmail'
                    : emailAccount?.fullEmail || t('syncingIdentity')}
                </span>
                {preferredEmailType === 'gmail' &&
                  gmailConnected &&
                  gmailBase &&
                  activeEmailAddress &&
                  activeEmailAddress !== gmailBase && (
                    <div
                      className="identity-original-email"
                      style={{
                        fontSize: '11px',
                        color: 'var(--gf-text-muted)',
                        opacity: 0.8,
                        marginTop: '3px',
                        fontWeight: 500,
                        fontFamily: 'var(--font-sans)',
                      }}
                    >
                      Original: {gmailBase}
                    </div>
                  )}
              </div>
              <div className="identity-actions">
                <motion.button
                  className={`action-icon ${emailCopied ? 'success' : ''}`}
                  onClick={copyEmail}
                  whileHover={{ x: -1, y: -1 }}
                  whileTap={{ x: 1, y: 1 }}
                  title="Copy email"
                  aria-label="Copy email address to clipboard"
                >
                  {emailCopied ? <Check size={14} /> : <Copy size={14} />}
                </motion.button>
                {(preferredEmailType === 'disposable' ||
                  (preferredEmailType === 'gmail' && gmailConnected)) && (
                  <motion.button
                    className={`action-icon ${isGeneratingEmail ? 'action-loading' : ''} ${emailCooldown ? 'opacity-50' : ''}`}
                    onClick={
                      preferredEmailType === 'gmail'
                        ? handleGenerateGmailAlias
                        : handleGenerateEmail
                    }
                    whileHover={{ x: -1, y: -1 }}
                    whileTap={{ x: 1, y: 1 }}
                    title={preferredEmailType === 'gmail' ? 'New Gmail alias' : 'New identity'}
                    aria-label={
                      preferredEmailType === 'gmail'
                        ? 'Generate new Gmail alias'
                        : 'Generate new temporary email'
                    }
                    disabled={isGeneratingEmail || emailCooldown}
                  >
                    <RefreshCw size={14} className={isGeneratingEmail ? 'spin' : ''} />
                  </motion.button>
                )}
              </div>
            </div>

            {/* Password Row */}
            <div className="identity-row">
              <div className="identity-icon password">
                <Lock size={18} className="icon-premium" />
              </div>
              <div className="identity-content">
                <span className="identity-label">{t('passwordLabel')}</span>
                <span
                  className={`identity-value mono hub-val ${!password ? 'shimmer' : ''} ${
                    !showPassword && password ? 'password-bullets' : ''
                  }`}
                >
                  {!password ? t('generatingPassword') : showPassword ? password : '********'}
                </span>
              </div>
              <div className="identity-actions">
                <motion.button
                  className={`action-icon ${passwordCopied ? 'success' : ''}`}
                  onClick={copyPassword}
                  whileHover={{ x: -1, y: -1 }}
                  whileTap={{ x: 1, y: 1 }}
                  title="Copy password"
                  aria-label="Copy password to clipboard"
                >
                  {passwordCopied ? <Check size={14} /> : <Copy size={14} />}
                </motion.button>
                <motion.button
                  className="action-icon"
                  onClick={() => setShowPassword(!showPassword)}
                  whileHover={{ x: -1, y: -1 }}
                  whileTap={{ x: 1, y: 1 }}
                  title={showPassword ? 'Hide' : 'Show'}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </motion.button>
                <div className="action-separator" />
                <motion.button
                  className={`action-icon action-danger ${passwordCooldown ? 'opacity-50' : ''}`}
                  onClick={handleGeneratePassword}
                  whileHover={{ x: -1, y: -1 }}
                  whileTap={{ x: 1, y: 1 }}
                  title="Reset secure password"
                  aria-label="Generate new secure password"
                  disabled={isGeneratingPassword || passwordCooldown}
                >
                  <RefreshCw size={14} className={isGeneratingPassword ? 'spin' : ''} />
                </motion.button>
              </div>
            </div>
          </>
        )}
      </motion.div>

      {/* ═══════════════════════════════════════════════════════════
                 📥 INBOX WITH EMAIL LIST
               ═══════════════════════════════════════════════════════════ */}
      <motion.div className="inbox-section" variants={ITEM_VARIANTS}>
        <div className="inbox-header-row">
          <div className="inbox-title-group">
            <Inbox size={22} />
            <span>Inbox</span>
            {inboxEmails.length > 0 && <span className="inbox-count">{inboxEmails.length}</span>}
          </div>
          {canOpenInbox && (
            <motion.button
              className="view-all-btn"
              onClick={() => {
                if (preferredEmailType === 'gmail') {
                  onNavigate('aliases', { aliasTab: 'inbox' });
                } else {
                  onNavigate('email');
                }
              }}
              whileHover={{ x: 2 }}
              aria-label="View full inbox"
            >
              Open
              <ChevronRight size={15} />
            </motion.button>
          )}
        </div>

        <div className="inbox-list">
          {preferredEmailType === 'gmail' && !gmailConnected ? (
            <div className="hub-empty-state hub-empty-state--action">
              <AlertCircle size={18} strokeWidth={1.7} color="var(--gf-coral)" />
              <span className="hub-empty-text">Connect Gmail above to sync OTP emails.</span>
            </div>
          ) : preferredEmailType === 'gmail' && gmailIsManual ? (
            <div className="hub-empty-state hub-empty-state--action">
              <AlertCircle size={18} strokeWidth={1.7} color="var(--gf-yellow)" />
              <span className="hub-empty-text">
                Use Google sign-in to sync messages automatically.
              </span>
            </div>
          ) : preferredEmailType === 'gmail' && gmailInboxLoading && inboxEmails.length === 0 ? (
            <div className="shimmer hub-empty-state">
              <RefreshCw size={18} strokeWidth={1.5} className="spin" color="var(--gf-cyan)" />
              <span>Syncing Gmail</span>
            </div>
          ) : preferredEmailType === 'gmail' && gmailInboxError ? (
            <button
              className="hub-empty-state hub-empty-state--action"
              onClick={() => void fetchGmailInbox()}
            >
              <AlertCircle size={18} strokeWidth={1.7} color="var(--gf-coral)" />
              <span className="hub-empty-text">{gmailInboxError}</span>
            </button>
          ) : inboxEmails.length === 0 ? (
            <div className="hub-empty-state">
              <Mail size={18} strokeWidth={1.5} color="var(--gf-cyan)" />
              <span>
                {preferredEmailType === 'gmail' ? 'No Gmail messages yet.' : t('listening')}
              </span>
            </div>
          ) : (
            <div className="hub-inbox-scroll">
              {displayedEmails.map((emailItem, index: number) => {
                return (
                  <motion.div
                    key={emailItem.id}
                    className="inbox-item"
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      delay: 0.15 + index * 0.05,
                      type: 'spring',
                      stiffness: 260,
                      damping: 25,
                      mass: 0.8,
                    }}
                    whileHover={{ x: 4 }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') {
                        return;
                      }
                      e.preventDefault();
                      if (preferredEmailType === 'gmail') {
                        onNavigate('aliases', { aliasTab: 'inbox' });
                      } else {
                        onNavigate('email');
                      }
                    }}
                    aria-label={`Open email from ${emailItem.from}: ${emailItem.subject}`}
                  >
                    <EmailAvatar from={emailItem.from} className="inbox-item-avatar" />
                    <div className="inbox-item-content">
                      <div className="inbox-item-header">
                        <span className="inbox-item-from">{emailItem.from}</span>
                        <span className="inbox-item-date">
                          <Clock size={12} />
                          {formatRelativeTime(new Date(emailItem.date).getTime())}
                        </span>
                      </div>
                      <div className="inbox-item-subject">{emailItem.subject}</div>
                      {(emailItem.otpCode || emailItem.activationLink) && (
                        <div className="inbox-item-actions">
                          {emailItem.otpCode && (
                            <motion.button
                              className="otp-badge"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (emailItem.otpCode) {
                                  handleCopyOTP(emailItem.otpCode);
                                }
                              }}
                              whileHover={{ x: -1, y: -1 }}
                              whileTap={{ x: 1, y: 1 }}
                              aria-label={`Copy verification code ${emailItem.otpCode}`}
                            >
                              <span className="otp-badge-code" aria-hidden="true">
                                {emailItem.otpCode}
                              </span>
                              <Copy size={12} />
                            </motion.button>
                          )}
                          {emailItem.activationLink && (
                            <motion.button
                              className="link-badge"
                              onClick={(e) => {
                                if (emailItem.activationLink) {
                                  void handleOpenLink(e, emailItem.activationLink);
                                }
                              }}
                              whileHover={{ x: -1, y: -1 }}
                              whileTap={{ x: 1, y: 1 }}
                              aria-label="Open verification link"
                            >
                              <span className="otp-badge-code" aria-hidden="true">
                                Verify
                              </span>
                              <ChevronRight size={12} />
                            </motion.button>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>

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
    </motion.div>
  );
};

export default Hub;
