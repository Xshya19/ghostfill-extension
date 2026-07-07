import { motion, AnimatePresence, Transition } from 'framer-motion';
import {
  Copy,
  Check,
  Globe,
  Sparkles,
  Shield,
  HelpCircle,
  LogIn,
  LogOut,
  RefreshCw,
  Inbox,
  AlertCircle,
  User,
  ChevronLeft,
  Settings,
} from 'lucide-react';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';

import {
  type AliasHistoryItem,
  getDeterministicCombinedAlias,
  normalizeAliasDomain,
  rememberGmailAliasSession,
  persistGmailConnection,
  clearGmailConnection,
  isGmailSetupResponse,
  formatGmailSetupError,
  type GmailSignInResult,
} from '../../services/gmailConnectionService';
import { storageService } from '../../services/storageService';
import { type GmailMessage, type GmailProfile } from '../../types/message.types';
import { copyToClipboard, openSafeUrl } from '../../utils/helpers';
import { safeSendMessage } from '../../utils/messaging';
import { useAppStore } from '../store/useAppStore';

// ─── Types ───────────────────────────────────────────────
type AliasPanelTab = 'generator' | 'inbox' | 'history';


interface StatusResponse {
  connected?: boolean;
  profile?: GmailProfile;
  authIssue?: { permanent?: boolean };
  clientIdStatus?: { blocked?: boolean };
}
interface InboxResponse {
  success?: boolean;
  messages?: GmailMessage[];
  error?: string;
}
interface MessageResponse {
  success?: boolean;
  message?: GmailMessage;
  error?: string;
}
interface ExtractResponse {
  success?: boolean;
  otp?: string;
  link?: string;
  error?: string;
}

interface Props {
  initialTab?: AliasPanelTab;
  onToast: (message: string) => void;
  onBack: () => void;
}

// ─── Constants ───────────────────────────────────────────
const SPRING: Transition = { type: 'spring', stiffness: 260, damping: 25, mass: 0.8 };
const TAB_TRANSITION = { duration: 0.2, ease: [0.16, 1, 0.3, 1] as const };
const TABS: readonly AliasPanelTab[] = ['generator', 'inbox', 'history'] as const;
const COPY_RESET_MS = 2000;
const MAX_MESSAGE_PREVIEW = 18_000;

// ─── Pure helpers ────────────────────────────────────────
function openOptionsPage(): void {
  const hasChrome = typeof chrome !== 'undefined';
  if (hasChrome && chrome.runtime?.openOptionsPage) {
    void chrome.runtime.openOptionsPage();
    return;
  }
  const optionsUrl =
    hasChrome && chrome.runtime?.getURL
      ? chrome.runtime.getURL('options/options.html')
      : 'options/options.html';
  openSafeUrl(optionsUrl);
}

const sanitizeDomain = (input: string): string => (input.trim() ? normalizeAliasDomain(input) : '');

const formatHistoryDate = (ts: number): string => {
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(ts);
  } catch {
    return '';
  }
};

const errorMessage = (e: unknown, fallback = 'Error'): string =>
  e instanceof Error ? e.message : fallback;

const stripHtml = (html: string): string => {
  if (!html) {return '';}
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    
    // Security: Nuke dangerous elements completely
    doc.querySelectorAll('script, style, noscript, iframe, object, embed, link, meta')
       .forEach(el => el.remove());
    
    // UX: Convert block elements to newlines for readability
    const blockTags = new Set(['P', 'DIV', 'BR', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'BLOCKQUOTE']);
    let text = '';
    const walker = document.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node;
    
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (blockTags.has(node.nodeName)) {text += '\n';}
        else if (node.nodeName === 'TD') {text += '\t';}
      }
    }
    
    return text.replace(/&nbsp;/gi, ' ').replace(/\n{3,}/g, '\n\n').trim();
  } catch {
    // Fallback to regex stripping if DOMParser fails or isn't available
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
};

// ─── Brand ───────────────────────────────────────────────
const GmailLogo: React.FC<{ size?: number }> = ({ size = 48 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2z"
      fill="#F2F2F2"
    />
    <path d="M22 6v12c0 1.1-.9 2-2 2h-3V8l5-2z" fill="#34A853" />
    <path
      d="M20 4H17L12 8L7 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h3V8l5 4l5-4v12h3c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2z"
      fill="#EA4335"
    />
    <path d="M2 6v12c0 1.1.9 2 2 2h3V8l-5-2z" fill="#4285F4" />
    <path d="M7 8v12h10V8L12 12L7 8z" fill="#FBBC05" />
  </svg>
);

// ═════════════════════════════════════════════════════════
// Sub-components
// ═════════════════════════════════════════════════════════

interface GeneratorTabProps {
  domainInput: string;
  setDomainInput: (v: string) => void;
  inputRef: React.RefObject<HTMLInputElement>;
  cleanDomain: string;
  activeAlias: string;
  copiedAlias: string | null;
  copyCelebrating: boolean;
  onCopy: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  gmailBase: string | null;
}

const GeneratorTab: React.FC<GeneratorTabProps> = ({
  domainInput,
  setDomainInput,
  inputRef,
  cleanDomain,
  activeAlias,
  copiedAlias,
  copyCelebrating,
  onCopy,
  onKeyDown,
  gmailBase,
}) => {
  const isCopied = copiedAlias === activeAlias;

  return (
    <div className="alias-gen-card">
      <div className="alias-gen-input-group">
        <label htmlFor="alias-domain-input" className="alias-gen-label">
          <Globe size={13} className="alias-gen-label-icon" /> Website Domain
        </label>
        <div className="setup-input-wrapper generator-input-wrapper">
          <Globe size={15} className="input-icon-left" />
          <input
            id="alias-domain-input"
            ref={inputRef}
            type="text"
            inputMode="url"
            spellCheck={false}
            placeholder="netflix.com"
            value={domainInput}
            onChange={(e) => setDomainInput(e.target.value)}
            onKeyDown={onKeyDown}
            className="ios-input generator-input alias-generator-input"
            autoComplete="off"
          />
        </div>
      </div>

      <AnimatePresence>
        {cleanDomain && (
          <motion.div
            className="alias-pipeline-connector"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 14, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="alias-pipeline-flow" />
          </motion.div>
        )}
      </AnimatePresence>

      {cleanDomain ? (
        <motion.div
          className={`alias-result-card ${copyCelebrating && isCopied ? 'alias-result-card--celebrate' : ''}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="alias-result-top">
            <motion.span
              key={activeAlias}
              initial={{ opacity: 0, filter: 'blur(6px)', y: 4 }}
              animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="alias-result-alias truncate"
              title={activeAlias}
            >
              {activeAlias}
            </motion.span>
            <button
              onClick={onCopy}
              disabled={!activeAlias}
              className={`alias-copy-btn ${isCopied ? 'alias-copy-btn--copied' : ''}`}
            >
              {isCopied ? <Check size={12} /> : <Copy size={12} />}
              <span>{isCopied ? 'Copied!' : 'Copy'}</span>
            </button>
          </div>
          <div
            className="alias-result-meta"
            style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}
          >
            <span className="alias-result-type">
              <span className="alias-result-type-dot" />
              Combined dot + plus
            </span>
            <span className="alias-result-domain truncate">{cleanDomain}</span>
            {gmailBase && (
              <span
                className="alias-result-original truncate"
                style={{ fontSize: '11px', color: 'var(--gf-text-muted)', opacity: 0.8 }}
              >
                Original: {gmailBase}
              </span>
            )}
          </div>
        </motion.div>
      ) : (
        <div className="alias-gen-empty">
          <div className="alias-gen-empty-icon">
            <HelpCircle size={22} />
          </div>
          <div className="alias-gen-empty-text">
            <span className="alias-gen-empty-title">Enter a domain above</span>
            <span className="alias-gen-empty-sub">Your alias will appear here instantly</span>
          </div>
        </div>
      )}

      {cleanDomain && (
        <motion.div
          className="alias-gen-tip"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          <Sparkles size={11} />{' '}
          <span>
            Same domain always generates the same alias.
            <kbd className="alias-kbd">Enter</kbd> to copy.
          </span>
        </motion.div>
      )}
    </div>
  );
};

interface InboxTabProps {
  isManual: boolean;
  inbox: GmailMessage[];
  loading: boolean;
  error: string | null;
  signingIn: boolean;
  onRefresh: () => void;
  onSignIn: () => void;
  onOpenMessage: (message: GmailMessage) => void;
  openingMessageId: string | null;
}

const InboxTab: React.FC<InboxTabProps> = ({
  isManual,
  inbox,
  loading,
  error,
  signingIn,
  onRefresh,
  onSignIn,
  onOpenMessage,
  openingMessageId,
}) => {
  const showLoading = !isManual && loading && inbox.length === 0;
  const showEmpty = !isManual && !loading && !error && inbox.length === 0;
  const showList = !isManual && inbox.length > 0;

  return (
    <div className="alias-inbox-card">
      <div className="alias-inbox-header">
        <div className="alias-inbox-title-row">
          <Inbox size={15} className="alias-inbox-title-icon" />
          <span className="alias-inbox-title">Recent Inbox</span>
          {!isManual && inbox.length > 0 && (
            <span className="alias-inbox-count">{inbox.length}</span>
          )}
        </div>
        {!isManual && (
          <button
            className={`alias-inbox-refresh ${loading ? 'alias-inbox-refresh--loading' : ''}`}
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh inbox"
          >
            <RefreshCw size={14} className={loading ? 'spin-icon' : ''} />
          </button>
        )}
      </div>

      {isManual && (
        <div className="alias-inbox-manual">
          <div className="alias-inbox-manual-icon">
            <Inbox size={24} />
          </div>
          <span className="alias-inbox-manual-title">Inbox needs Google sign-in</span>
          <span className="alias-inbox-manual-desc">Manual connection generates aliases only.</span>
          <button onClick={onSignIn} disabled={signingIn} className="alias-oauth-connect-btn">
            {signingIn ? <RefreshCw size={13} className="spin" /> : <LogIn size={13} />}
            <span>{signingIn ? 'Connecting...' : 'Use Google sign-in'}</span>
          </button>
        </div>
      )}

      {error && (
        <div className="alias-inbox-error" role="alert">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {showLoading && (
        <div className="alias-inbox-loading">
          <div className="alias-inbox-spinner">
            <RefreshCw size={20} className="spin-icon" />
          </div>
          <span>Loading inbox\u2026</span>
        </div>
      )}

      {showEmpty && (
        <div className="alias-inbox-empty">
          <div className="alias-inbox-empty-icon">
            <Inbox size={26} />
          </div>
          <span className="alias-inbox-empty-title">All caught up</span>
          <span className="alias-inbox-empty-sub">No recent emails in the last 3 days</span>
        </div>
      )}

      {showList && (
        <div className="alias-inbox-list">
          {inbox.map((msg) => (
            <div
              key={msg.id}
              className={`alias-inbox-item ${msg.isUnread ? 'alias-inbox-item--unread' : ''}`}
            >
              <div className="alias-inbox-item-left">
                <div className="alias-inbox-avatar" aria-hidden="true">
                  {(msg.fromName || msg.fromEmail || '?').charAt(0).toUpperCase()}
                </div>
                <div className="alias-inbox-item-body">
                  <div className="alias-inbox-item-top">
                    <span className="alias-inbox-from truncate">
                      {msg.fromName || msg.fromEmail}
                    </span>
                    <span className="alias-inbox-date">{msg.dateFormatted}</span>
                  </div>
                  <span className="alias-inbox-subject truncate">
                    {msg.subject || '(No subject)'}
                  </span>
                </div>
              </div>
              <button
                className="alias-inbox-open-btn"
                onClick={() => onOpenMessage(msg)}
                aria-label="Open message"
                disabled={openingMessageId === msg.id}
              >
                {openingMessageId === msg.id ? (
                  <RefreshCw size={13} className="spin" />
                ) : (
                  <Inbox size={13} />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

interface HistoryTabProps {
  history: AliasHistoryItem[];
  onClear: () => void;
  onToast: (m: string) => void;
}

const HistoryTab: React.FC<HistoryTabProps> = ({ history, onClear, onToast }) => (
  <div className="alias-history-card">
    <div className="alias-history-header">
      <div className="alias-history-title-group">
        <Shield size={15} />
        <span>Alias Tracker</span>
        {history.length > 0 && <span className="alias-history-count">{history.length}</span>}
      </div>
      {history.length > 0 && (
        <button className="alias-clear-history-btn" onClick={onClear}>
          Clear All
        </button>
      )}
    </div>

    <div className="alias-history-list">
      {history.length === 0 ? (
        <div className="alias-history-empty">
          <div className="alias-history-empty-icon">
            <Shield size={24} />
          </div>
          <span className="alias-history-empty-title">No aliases tracked yet</span>
          <span className="alias-history-empty-sub">Copy an alias from the generator</span>
        </div>
      ) : (
        history.map((item) => (
          <div
            key={`${item.website}-${item.alias}-${item.createdAt}`}
            className={`alias-history-item alias-history-item--${item.type}`}
          >
            <div className="alias-history-item-left truncate">
              <div className="alias-history-item-top">
                <span className="alias-history-site truncate">{item.website}</span>
                <span className="alias-history-badge">{item.type}</span>
              </div>
              <span className="alias-history-email truncate">{item.alias}</span>
            </div>
            <span className="alias-history-date">{formatHistoryDate(item.createdAt)}</span>
            <button
              className="alias-history-copy-btn"
              aria-label={`Copy ${item.alias}`}
              onClick={() =>
                void copyToClipboard(item.alias).then((ok) => onToast(ok ? 'Copied' : 'Failed'))
              }
            >
              <Copy size={12} />
            </button>
          </div>
        ))
      )}
    </div>
  </div>
);

const TabPanel = React.forwardRef<
  HTMLDivElement,
  { tab: AliasPanelTab; children: React.ReactNode }
>(({ tab, children }, ref) => (
  <motion.div
    ref={ref}
    key={tab}
    id={`tabpanel-${tab}`}
    role="tabpanel"
    initial={{ opacity: 0, x: -8 }}
    animate={{ opacity: 1, x: 0 }}
    exit={{ opacity: 0, x: 8 }}
    transition={TAB_TRANSITION}
    className="alias-tab-content-area"
  >
    {children}
  </motion.div>
));
TabPanel.displayName = 'TabPanel';

// ═════════════════════════════════════════════════════════
// Main component
// ═════════════════════════════════════════════════════════
const AliasPanel: React.FC<Props> = ({ initialTab = 'generator', onToast, onBack }) => {
  // One selector instead of ~30. useShallow prevents re-renders unless a used slice changes.
  const {
    gmailBase,
    setGmailBase,
    aliasHistory,
    setAliasHistory,
    addAliasToHistory,
    clearAliasHistory,
    gmailConnected,
    setGmailConnected,
    gmailProfile,
    setGmailProfile,
    gmailInbox,
    setGmailInbox,
    gmailInboxLoading,
    setGmailInboxLoading,
    gmailInboxError,
    setGmailInboxError,
    gmailIsManual,
    setGmailIsManual,
    setPreferredEmailType,
  } = useAppStore(
    useShallow((s) => ({
      gmailBase: s.gmailBase,
      setGmailBase: s.setGmailBase,
      aliasHistory: s.aliasHistory,
      setAliasHistory: s.setAliasHistory,
      addAliasToHistory: s.addAliasToHistory,
      clearAliasHistory: s.clearAliasHistory,
      gmailConnected: s.gmailConnected,
      setGmailConnected: s.setGmailConnected,
      gmailProfile: s.gmailProfile,
      setGmailProfile: s.setGmailProfile,
      gmailInbox: s.gmailInbox,
      setGmailInbox: s.setGmailInbox,
      gmailInboxLoading: s.gmailInboxLoading,
      setGmailInboxLoading: s.setGmailInboxLoading,
      gmailInboxError: s.gmailInboxError,
      setGmailInboxError: s.setGmailInboxError,
      gmailIsManual: s.gmailIsManual,
      setGmailIsManual: s.setGmailIsManual,
      setPreferredEmailType: s.setPreferredEmailType,
    }))
  );

  const [domainInput, setDomainInput] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [copiedAlias, setCopiedAlias] = useState<string | null>(null);
  const [copyCelebrating, setCopyCelebrating] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [activeTab, setActiveTab] = useState<AliasPanelTab>(initialTab);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [gmailSetupRequired, setGmailSetupRequired] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<GmailMessage | null>(null);
  const [openingMessageId, setOpeningMessageId] = useState<string | null>(null);
  const [messageLoading, setMessageLoading] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [messageAction, setMessageAction] = useState<{ otp?: string; link?: string } | null>(null);

  const domainInputRef = useRef<HTMLInputElement>(null);
  const aliasTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inboxRequestSeqRef = useRef(0);

  const cleanDomain = useMemo(() => sanitizeDomain(domainInput), [domainInput]);
  const activeAlias = useMemo(
    () => (gmailBase && cleanDomain ? getDeterministicCombinedAlias(gmailBase, cleanDomain) : ''),
    [gmailBase, cleanDomain]
  );

  // Apply a successful connection to the store (in-memory side).
  const applyConnection = useCallback(
    (profile: GmailProfile, isManual: boolean) => {
      setGmailConnected(true);
      setGmailProfile(profile);
      setGmailBase(profile.email);
      setGmailIsManual(isManual);
      setPreferredEmailType('gmail');
    },
    [setGmailConnected, setGmailProfile, setGmailBase, setGmailIsManual, setPreferredEmailType]
  );

  useEffect(() => setActiveTab(initialTab), [initialTab]);

  // Clear pending copy timers on unmount.
  useEffect(
    () => () => {
      if (aliasTimeoutRef.current) {
        clearTimeout(aliasTimeoutRef.current);
      }
    },
    []
  );

  // Prefill domain from the active tab's hostname.
  useEffect(() => {
    const hasChrome = typeof chrome !== 'undefined';
    if (!hasChrome || !chrome.tabs?.query) {
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url;
      if (!url) {
        return;
      }
      try {
        const hostname = new URL(url).hostname.replace(/^www\./, '');
        if (hostname && !hostname.includes('newtab') && !hostname.includes('extensions')) {
          setDomainInput(hostname);
        }
      } catch {
        /* ignore non-URL tabs */
      }
    });
  }, []);

  // Hydrate from storage + verify OAuth status.
  useEffect(() => {
    const hasChrome = typeof chrome !== 'undefined';
    if (!hasChrome || !chrome.storage?.local) {
      setHydrated(true);
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const [storedHistory, storedProfile, storedIsManual] = await Promise.all([
          storageService.get('aliasHistory'),
          storageService.get('gmailProfile'),
          storageService.get('gmailIsManual'),
        ]);
        if (cancelled) {
          return;
        }

        if (Array.isArray(storedHistory)) {
          setAliasHistory(storedHistory);
        }

        const isManual = !!storedIsManual;
        setGmailIsManual(isManual);

        if (storedProfile?.email) {
          applyConnection(storedProfile, isManual);
        }

        if (!isManual) {
          try {
            const res = (await safeSendMessage({ action: 'GMAIL_GET_STATUS' })) as StatusResponse;
            if (cancelled) {
              return;
            }
            if (res?.connected && res?.profile) {
              applyConnection(res.profile, false);
            } else {
              setGmailConnected(false);
              setGmailProfile(null);
              setGmailBase(null);
            }
          } catch {
            /* keep stored/optimistic state */
          }
        }
      } finally {
        if (!cancelled) {
          setHydrated(true);
        }
      }
    })().catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [
    applyConnection,
    setAliasHistory,
    setGmailConnected,
    setGmailProfile,
    setGmailBase,
    setGmailIsManual,
  ]);

  // Autofocus the domain field on the generator tab.
  useEffect(() => {
    if (activeTab !== 'generator' || !gmailConnected) {
      return;
    }
    const id = requestAnimationFrame(() => domainInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [activeTab, gmailConnected]);

  const fetchInbox = useCallback(async () => {
    const requestSeq = ++inboxRequestSeqRef.current;
    if (gmailIsManual) {
      if (requestSeq === inboxRequestSeqRef.current) {
        setGmailInbox([]);
        setGmailInboxError(null);
      }
      return;
    }
    setGmailInboxLoading(true);
    setGmailInboxError(null);
    try {
      const res = (await safeSendMessage({
        action: 'GMAIL_FETCH_INBOX',
        payload: { ...(activeAlias ? { alias: activeAlias } : {}), maxResults: 20 },
      })) as InboxResponse;

      if (res?.success && Array.isArray(res?.messages)) {
        if (requestSeq === inboxRequestSeqRef.current) {
          setGmailInbox(res.messages);
        }
      } else {
        if (requestSeq === inboxRequestSeqRef.current) {
          setGmailInboxError(res?.error || 'Failed to fetch');
        }
      }
    } catch (e) {
      if (requestSeq === inboxRequestSeqRef.current) {
        setGmailInboxError(errorMessage(e, 'Network error'));
      }
    } finally {
      if (requestSeq === inboxRequestSeqRef.current) {
        setGmailInboxLoading(false);
      }
    }
  }, [activeAlias, gmailIsManual, setGmailInbox, setGmailInboxLoading, setGmailInboxError]);

  const openMessage = useCallback(
    async (message: GmailMessage) => {
      if (!message?.id) {
        return;
      }
      setOpeningMessageId(String(message.id));
      setMessageLoading(true);
      setMessageError(null);
      setMessageAction(null);
      try {
        const res = (await safeSendMessage({
          action: 'GMAIL_GET_MESSAGE',
          payload: { messageId: message.id },
        })) as MessageResponse;

        if (res?.success && res.message) {
          setSelectedMessage(res.message);
          const extraction = (await safeSendMessage({
            action: 'EXTRACT_OTP',
            payload: {
              textBody: res.message.body || res.message.snippet || '',
              htmlBody: res.message.htmlBody || '',
              subject: res.message.subject,
              source: 'popup-inbox',
              emailId: res.message.id,
              emailFrom: res.message.fromEmail || res.message.from,
              emailDate: res.message.date,
              saveToLastOTP: true,
            },
          })) as ExtractResponse;

          if (extraction?.success) {
            setMessageAction({
              ...(extraction.otp ? { otp: extraction.otp } : {}),
              ...(extraction.link ? { link: extraction.link } : {}),
            });
          }
        } else {
          setMessageError(res?.error || 'Failed to load message');
          onToast(res?.error || 'Failed to load message');
        }
      } catch (e) {
        const msg = errorMessage(e, 'Failed to load message');
        setMessageError(msg);
        onToast(msg);
      } finally {
        setOpeningMessageId(null);
        setMessageLoading(false);
      }
    },
    [onToast]
  );

  useEffect(() => {
    if (gmailConnected && !gmailIsManual) {
      void fetchInbox();
    }
  }, [gmailConnected, gmailIsManual, fetchInbox]);

  const handleCopy = useCallback(
    (alias: string, type: AliasHistoryItem['type'], website: string) => {
      if (!alias) {
        onToast('Enter a domain first');
        return;
      }
      void copyToClipboard(alias)
        .then((ok) => {
          if (!ok) {
            onToast('Failed to copy');
            return;
          }
          setCopiedAlias(alias);
          setCopyCelebrating(true);
          onToast('Alias copied');

          if (gmailBase) {
            const site = website || 'general';
            void rememberGmailAliasSession(alias, gmailBase, site);
            addAliasToHistory({
              alias,
              originalEmail: gmailBase,
              type,
              website: site,
              createdAt: Date.now(),
            });
          }

          if (aliasTimeoutRef.current) {
            clearTimeout(aliasTimeoutRef.current);
          }
          aliasTimeoutRef.current = setTimeout(() => {
            setCopiedAlias(null);
            setCopyCelebrating(false);
          }, COPY_RESET_MS);
        })
        .catch(() => onToast('Failed to copy'));
    },
    [gmailBase, addAliasToHistory, onToast]
  );

  const copyActiveAlias = useCallback(
    () => handleCopy(activeAlias, 'combined', cleanDomain),
    [handleCopy, activeAlias, cleanDomain]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && activeAlias) {
        e.preventDefault();
        copyActiveAlias();
      }
    },
    [activeAlias, copyActiveAlias]
  );

  // Unified OAuth connect — replaces the two near-identical handlers.
  const connectWithGoogle = useCallback(async () => {
    setSigningIn(true);
    setSignInError(null);
    setGmailSetupRequired(false);
    try {
      const res = (await safeSendMessage({ action: 'GMAIL_SIGN_IN' })) as GmailSignInResult;
      if (res?.success && res?.profile) {
        applyConnection(res.profile, false);
        await persistGmailConnection(res.profile, false);
        setGmailSetupRequired(false);
        onToast(`Connected: ${res.profile.email}`);
      } else {
        const setupRequired = isGmailSetupResponse(res);
        const err = setupRequired
          ? formatGmailSetupError(res?.error)
          : res?.error || 'Sign-in failed';
        setGmailSetupRequired(setupRequired);
        setSignInError(err);
        onToast(err);
      }
    } catch (e) {
      const msg = errorMessage(e);
      setGmailSetupRequired(false);
      setSignInError(msg);
      onToast(msg);
    } finally {
      setSigningIn(false);
    }
  }, [applyConnection, onToast]);

  const handleSignOut = useCallback(async () => {
    try {
      await clearGmailConnection(gmailIsManual);
      setGmailConnected(false);
      setGmailProfile(null);
      setGmailBase(null);
      setGmailInbox([]);
      setGmailIsManual(false);
      setPreferredEmailType('disposable');
      onToast('Disconnected');
    } catch (e) {
      onToast(errorMessage(e));
    }
  }, [
    gmailIsManual,
    setGmailConnected,
    setGmailProfile,
    setGmailBase,
    setGmailInbox,
    setGmailIsManual,
    setPreferredEmailType,
    onToast,
  ]);

  // ── Disconnected: auto-trigger sign-in, no intermediate page ──
  useEffect(() => {
    if (hydrated && !gmailConnected && !gmailProfile && !signingIn) {
      void connectWithGoogle();
    }
  }, [hydrated, gmailConnected, gmailProfile, signingIn, connectWithGoogle]);

  if (!gmailConnected || !gmailProfile) {
    return (
      <div className="alias-panel">
        <motion.div
          className="alias-setup-card"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={SPRING}
        >
          {signInError ? (
            <>
              <div className="alias-setup-logo">
                <GmailLogo size={44} />
              </div>
              <div className="alias-signin-error">
                <div className="alias-signin-error-title">
                  <AlertCircle size={12} /> Sign-in failed
                </div>
                <div className="alias-signin-error-text">{signInError}</div>
              </div>
              <button
                onClick={() => void connectWithGoogle()}
                disabled={signingIn}
                className="alias-connect-btn"
              >
                {signingIn ? <RefreshCw size={14} className="spin" /> : <LogIn size={14} />}
                <span>{signingIn ? 'Connecting...' : 'Try Again'}</span>
              </button>
              {gmailSetupRequired && (
                <button
                  onClick={openOptionsPage}
                  disabled={signingIn}
                  className="alias-connect-btn secondary-btn"
                >
                  <Settings size={14} />
                  <span>Gmail Settings</span>
                </button>
              )}
            </>
          ) : (
            <>
              <div className="alias-setup-logo">
                <GmailLogo size={44} />
              </div>
              <div
                className="alias-signin-error-title"
                style={{ justifyContent: 'center', marginTop: 8 }}
              >
                <RefreshCw size={14} className="spin" /> Connecting to Google...
              </div>
            </>
          )}
        </motion.div>
      </div>
    );
  }

  // ── Connected ──
  return (
    <div className="alias-panel">
      <motion.div
        className="alias-profile-bar"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <button
          className="back-button alias-back-btn"
          onClick={onBack}
          aria-label="Go back to hub"
          title="Back"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="alias-profile-bar-left">
          {gmailProfile.picture ? (
            <img src={gmailProfile.picture} alt="" className="alias-profile-avatar" />
          ) : (
            <div className="alias-profile-avatar-placeholder">
              <User size={16} />
            </div>
          )}
          <div className="alias-profile-info">
            <span className="alias-profile-email truncate">{gmailProfile.email}</span>
          </div>
          <div
            className={`alias-status-dot ${gmailIsManual ? 'alias-status-dot--manual' : 'alias-status-dot--oauth'}`}
            title={gmailIsManual ? 'Manual' : 'OAuth'}
          />
        </div>
        <button
          className="alias-signout-btn"
          onClick={() => void handleSignOut()}
          aria-label="Disconnect"
          title="Disconnect"
        >
          <LogOut size={14} />
        </button>
      </motion.div>

      <div className="alias-tabs" role="tablist">
        <motion.div
          className="alias-tab-bg"
          initial={false}
          animate={{
            x: activeTab === 'generator' ? '0%' : activeTab === 'inbox' ? '100%' : '200%',
          }}
          transition={{ type: 'spring', stiffness: 350, damping: 25 }}
          style={{
            position: 'absolute',
            top: 3,
            bottom: 3,
            left: 3,
            width: 'calc(33.3333% - 2px)',
            margin: 0,
          }}
        />
        {TABS.map((tab) => {
          const isActive = activeTab === tab;
          const count =
            tab === 'inbox' ? gmailInbox.length : tab === 'history' ? aliasHistory.length : 0;
          const Icon = tab === 'generator' ? Sparkles : tab === 'inbox' ? Inbox : Shield;
          const label = tab === 'generator' ? 'Aliases' : tab === 'inbox' ? 'Inbox' : 'History';
          return (
            <button
              key={tab}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab}`}
              className={`alias-tab-btn ${isActive ? 'alias-tab-btn--active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              <span className="alias-tab-label">
                <Icon size={13} /> {label}
                {tab !== 'generator' && count > 0 && (
                  <span className="alias-tab-badge">{count}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="popLayout">
        {activeTab === 'generator' && (
          <TabPanel tab="generator">
            <GeneratorTab
              domainInput={domainInput}
              setDomainInput={setDomainInput}
              inputRef={domainInputRef}
              cleanDomain={cleanDomain}
              activeAlias={activeAlias}
              copiedAlias={copiedAlias}
              copyCelebrating={copyCelebrating}
              onCopy={copyActiveAlias}
              onKeyDown={handleKeyDown}
              gmailBase={gmailBase}
            />
          </TabPanel>
        )}

        {activeTab === 'inbox' && (
          <TabPanel tab="inbox">
            <InboxTab
              isManual={gmailIsManual}
              inbox={gmailInbox}
              loading={gmailInboxLoading}
              error={gmailInboxError}
              signingIn={signingIn}
              onRefresh={() => void fetchInbox()}
              onSignIn={() => void connectWithGoogle()}
              onOpenMessage={openMessage}
              openingMessageId={openingMessageId}
            />
          </TabPanel>
        )}

        {activeTab === 'history' && (
          <TabPanel tab="history">
            <HistoryTab history={aliasHistory} onClear={clearAliasHistory} onToast={onToast} />
          </TabPanel>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedMessage && (
          <motion.div
            className="alias-message-modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedMessage(null)}
          >
            <motion.div
              className="alias-message-modal"
              initial={{ y: 12, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 12, opacity: 0, scale: 0.98 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="alias-message-modal-header">
                <div className="alias-message-modal-title-group">
                  <Inbox size={16} />
                  <div className="alias-message-modal-titles">
                    <div className="alias-message-modal-title truncate">
                      {selectedMessage.subject || '(No subject)'}
                    </div>
                    <div className="alias-message-modal-meta truncate">
                      {selectedMessage.fromName || selectedMessage.from}
                      {' - '}
                      {selectedMessage.dateFormatted ||
                        new Date(selectedMessage.date).toLocaleString()}
                    </div>
                  </div>
                </div>
                <button
                  className="alias-message-modal-close"
                  onClick={() => setSelectedMessage(null)}
                  aria-label="Close message"
                >
                  <ChevronLeft size={16} />
                </button>
              </div>

              {messageError && <div className="alias-inbox-error">{messageError}</div>}

              <div className="alias-message-modal-body">
                {messageLoading ? (
                  <div className="alias-inbox-loading">
                    <RefreshCw size={20} className="spin-icon" />
                    <span>Loading message...</span>
                  </div>
                ) : (
                  <>
                    <div className="alias-message-modal-snippet">
                      {selectedMessage.snippet || selectedMessage.body || 'No content available.'}
                    </div>
                    <pre className="alias-message-modal-content">
                      {stripHtml(
                        (
                          selectedMessage.htmlBody ||
                          selectedMessage.body ||
                          selectedMessage.snippet ||
                          ''
                        ).slice(0, MAX_MESSAGE_PREVIEW)
                      )}
                    </pre>
                  </>
                )}
              </div>

              {(messageAction?.otp || messageAction?.link) && (
                <div className="alias-message-modal-actions">
                  {messageAction.otp && (
                    <button
                      className="alias-message-action-btn"
                      onClick={() =>
                        void copyToClipboard(messageAction.otp ?? '').then((ok) =>
                          onToast(ok ? 'OTP copied' : 'Failed to copy OTP')
                        )
                      }
                    >
                      <Copy size={14} />
                      <span>{messageAction.otp}</span>
                    </button>
                  )}
                  {messageAction.link && (
                    <button
                      className="alias-message-action-btn"
                      onClick={() => openSafeUrl(messageAction.link ?? '')}
                    >
                      <Check size={14} />
                      <span>Open link</span>
                    </button>
                  )}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AliasPanel;
