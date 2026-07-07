import { motion, AnimatePresence, useReducedMotion, type HTMLMotionProps } from 'framer-motion';
import { Mail, RefreshCw, Copy, Check, LogOut, Shield, Clock, AlertCircle, Inbox, LogIn, ChevronRight, Link2, X, Settings, HelpCircle, Sparkles, Zap, ShieldCheck, Hash, Info, Lock, Eye, EyeOff } from 'lucide-react';
import React, { useEffect, useId, useRef, useState, useCallback, useMemo, Component, ErrorInfo, ReactNode } from 'react';

import gmailLogo from '../../assets/icons/gmail_icon.png';
import { type AliasHistoryItem } from '../../services/gmailConnectionService';
import { Button, IconButton } from '../../shared/ui';
import { springSoft, interactiveSurface, tweenIn, tweenOut, tweenTimerBar, springDigit } from '../../shared/ui/motion';
import { EmailAccount, Email, PasswordOptions, GeneratedPassword, DEFAULT_PASSWORD_OPTIONS } from '../../types';
import { type GmailMessage, type GeneratePasswordResponse } from '../../types/message.types';
import { LastOTP } from '../../types/storage.types';
import { TIMING } from '../../utils/constants';
import { formatRelativeTime } from '../../utils/formatters';
import { copyToClipboard } from '../../utils/helpers';
import { createLogger } from '../../utils/logger';
import { safeSendMessage, safeSendTabMessage } from '../../utils/messaging';
import { useStorageSubscription } from '../hooks/useStorageSubscription';

// i18n helper
const t = (key: string): string => {
  try {
    return chrome.i18n.getMessage(key) || key;
  } catch {
    return key;
  }
};

// --- AccountCard.tsx ---
export interface AccountCardProps {
  readonly preferredEmailType: 'disposable' | 'gmail';
  readonly gmailConnected: boolean;
  readonly gmailSigningIn: boolean;
  readonly gmailBase: string | null;
  readonly activeEmailAddress: string;
  readonly emailAccount: EmailAccount | null;
  readonly emailCopied: boolean;
  readonly isGeneratingEmail: boolean;
  readonly emailCooldown: boolean;
  readonly onCopyEmail: () => void;
  readonly onGenerateEmail: () => void;
  readonly onGmailSignIn: () => void | Promise<void>;
  readonly onSignOut?: () => void;
  readonly gmailProfile?: any;
}

const AccountCardComponent: React.FC<AccountCardProps> = ({
  preferredEmailType,
  gmailConnected,
  gmailSigningIn,
  gmailBase,
  activeEmailAddress,
  emailAccount,
  emailCopied,
  isGeneratingEmail,
  emailCooldown,
  onCopyEmail,
  onGenerateEmail,
  onGmailSignIn,
  onSignOut,
  gmailProfile,
}) => {
  if (preferredEmailType === 'gmail' && !gmailConnected) {
    return (
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
          onClick={() => {
            void onGmailSignIn();
          }}
          className="hub-gmail-connect-btn"
          {...interactiveSurface}
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
    );
  }

  return (
    <div className="identity-row">
      <div className="identity-icon">
        {preferredEmailType === 'gmail' && gmailProfile?.picture ? (
          <img src={gmailProfile.picture} alt="" style={{ width: 20, height: 20, borderRadius: '50%', display: 'block', objectFit: 'cover' }} />
        ) : (
          <Mail size={18} className="icon-premium" />
        )}
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
          title={preferredEmailType === 'gmail' ? activeEmailAddress || 'Connect Gmail' : emailAccount?.fullEmail || ''}
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
            <div className="identity-original-email">
              Original: {gmailBase}
            </div>
          )}
      </div>
      <div className="identity-actions">
        <motion.button
          className={`action-icon ${emailCopied ? 'success' : ''}`}
          onClick={onCopyEmail}
          {...interactiveSurface}
          title="Copy email"
          aria-label="Copy email address to clipboard"
        >
          {emailCopied ? <Check size={14} /> : <Copy size={14} />}
        </motion.button>
        {(preferredEmailType === 'disposable') && (
          <motion.button
            className={`action-icon ${isGeneratingEmail ? 'action-loading' : ''} ${emailCooldown ? 'opacity-50' : ''}`}
            onClick={onGenerateEmail}
            {...interactiveSurface}
            title={'New identity'}
            aria-label={'Generate new disposable email'}
          >
            <RefreshCw size={14} className={isGeneratingEmail ? 'spin' : ''} />
          </motion.button>
        )}
        {preferredEmailType === 'gmail' && gmailConnected && (
          <motion.button
            className="action-icon"
            onClick={onSignOut}
            {...interactiveSurface}
            title="Disconnect Gmail"
            aria-label="Disconnect Gmail"
          >
            <LogOut size={14} />
          </motion.button>
        )}
      </div>
    </div>
  );
};

export const AccountCard = React.memo(AccountCardComponent);
AccountCard.displayName = 'AccountCard';

// --- AliasHistory.tsx ---
const _formatHistoryDate = (ts: number): string => {
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(ts);
  } catch {
    return '';
  }
};

interface HistoryTabProps {
  history: AliasHistoryItem[];
  onClear: () => void;
  onToast: (m: string) => void;
}

const HistoryTab: React.FC<HistoryTabProps> = ({ history, onClear, onToast }) => (
  <div className="inbox-section">
    <div className="inbox-header-row">
      <div className="inbox-title-group">
        <Shield size={14} />
        <span>Alias Tracker</span>
        {history.length > 0 && <span className="inbox-count">{history.length}</span>}
      </div>
      {history.length > 0 && (
        <button
          className="alias-clear-history-btn"
          onClick={onClear}
        >
          Clear All
        </button>
      )}
    </div>

    <div className="hub-inbox-scroll">
      {history.length === 0 ? (
        <div className="hub-empty-state">
          <Shield size={16} strokeWidth={1.5} color="var(--gf-primary)" />
          <span>No aliases tracked yet.</span>
        </div>
      ) : (
        history.map((item) => (
          <div
            key={`${item.website}-${item.alias}-${item.createdAt}`}
            className="inbox-item"
          >
            <EmailAvatar from={item.website || '?'} className="inbox-item-avatar" />
            <div className="inbox-item-content">
              <div className="inbox-item-header">
                <span className="inbox-item-from truncate">
                  {item.website || 'general'}
                  <span className="alias-history-type-badge">
                    {item.type}
                  </span>
                </span>
                <span className="inbox-item-date">
                  <Clock size={10} />
                  {_formatHistoryDate(item.createdAt)}
                </span>
              </div>
              <div className="inbox-item-subject truncate" style={{ userSelect: 'all' }}>
                {item.alias}
              </div>
            </div>
            <motion.button
              className="action-icon"
              aria-label={`Copy ${item.alias}`}
              onClick={() =>
                void copyToClipboard(item.alias).then((ok) => onToast(ok ? 'Copied' : 'Failed'))
              }
              {...interactiveSurface}
              title="Copy alias"
            >
              <Copy size={14} />
            </motion.button>
          </div>
        ))
      )}
    </div>
  </div>
);



export { HistoryTab as AliasHistory };

// --- AliasInbox.tsx ---
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
    <div className="inbox-section">
      <div className="inbox-header-row">
        <div className="inbox-title-group">
          <Inbox size={14} />
          <span>Recent Inbox</span>
          {!isManual && inbox.length > 0 && (
            <span className="inbox-count">{inbox.length}</span>
          )}
        </div>
        {!isManual && (
          <button
            className={`alias-inbox-refresh ${loading ? 'alias-inbox-refresh--loading' : ''}`}
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh inbox"
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
        )}
      </div>

      {isManual && (
        <div className="hub-empty-state" style={{ flexDirection: 'column', textAlign: 'center', marginTop: 8 }}>
          <Inbox size={22} color="var(--gf-primary)" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontWeight: 600, color: 'var(--gf-ink)', fontSize: '12px' }}>Inbox needs Google sign-in</span>
            <span style={{ fontSize: '10px' }}>Manual connection generates aliases only.</span>
          </div>
          <button
            onClick={onSignIn}
            disabled={signingIn}
            className="gf-btn gf-btn--primary"
            style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px', marginTop: 8 }}
          >
            {signingIn ? <RefreshCw size={13} className="spin" /> : <LogIn size={13} />}
            <span>{signingIn ? 'Connecting...' : 'Use Google sign-in'}</span>
          </button>
        </div>
      )}

      {error && (
        <div className="hub-empty-state hub-empty-state--action" role="alert" style={{ marginTop: 8 }}>
          <AlertCircle size={16} strokeWidth={1.7} color="var(--gf-coral)" />
          <span className="hub-empty-text">{error}</span>
        </div>
      )}

      {showLoading && (
        <div className="shimmer hub-empty-state" style={{ marginTop: 8 }}>
          <RefreshCw size={16} strokeWidth={1.5} className="spin" color="var(--gf-primary)" />
          <span>Syncing Gmail...</span>
        </div>
      )}

      {showEmpty && (
        <div className="hub-empty-state" style={{ marginTop: 8 }}>
          <Inbox size={16} strokeWidth={1.5} color="var(--gf-primary)" />
          <span>All caught up. No recent emails.</span>
        </div>
      )}

      {showList && (
        <div className="hub-inbox-scroll">
          {inbox.map((msg) => (
            <div
              key={msg.id}
              className={`inbox-item ${msg.isUnread ? 'alias-inbox-item--unread' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => onOpenMessage(msg)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenMessage(msg);
                }
              }}
              aria-label={`Open email from ${msg.fromName || msg.fromEmail}: ${msg.subject}`}
              aria-busy={openingMessageId === msg.id}
            >
              <EmailAvatar from={msg.fromName || msg.fromEmail || '?'} className="inbox-item-avatar" />
              <div className="inbox-item-content">
                <div className="inbox-item-header">
                  <span className="inbox-item-from truncate">
                    {msg.fromName || msg.fromEmail}
                  </span>
                  <span className="inbox-item-date">
                    <Clock size={10} />
                    {msg.dateFormatted || formatRelativeTime(new Date(msg.date).getTime())}
                  </span>
                </div>
                <div className="inbox-item-subject truncate">
                  {msg.subject || '(No subject)'}
                </div>
              </div>
              {openingMessageId === msg.id ? (
                <RefreshCw size={14} className="inbox-item-open-chevron spin" aria-hidden="true" />
              ) : (
                <ChevronRight size={14} className="inbox-item-open-chevron" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};



export { InboxTab as AliasInbox };

// --- AppSkeleton.tsx ---
const AppSkeleton = React.forwardRef<HTMLDivElement, HTMLMotionProps<'div'>>(({ className, ...props }, ref) => {
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={`app-skeleton app-view-container ${className || ''}`}
      aria-hidden="true"
      {...props}
    >
      <div className="header skeleton-header-gap">
        <div className="header-left">
          <div className="skeleton-pulse app-skeleton-circle" />
          <div className="header-title-container skeleton-title-gap">
            <div className="skeleton-pulse app-skeleton-pill skeleton-w-80" />
            <div className="skeleton-pulse app-skeleton-pill skeleton-w-40" />
          </div>
        </div>
        <div className="header-actions">
          <div className="skeleton-pulse app-skeleton-circle skeleton-icon" />
        </div>
      </div>

      <div className="ghost-dashboard skeleton-dashboard-pad">
        <div className="memphis-card identity-card">
          <div className="identity-row">
            <div className="skeleton-pulse app-skeleton-circle skeleton-icon-lg" />
            <div className="identity-content skeleton-content-gap">
              <div className="skeleton-pulse app-skeleton-pill skeleton-w-60" />
              <div className="skeleton-pulse app-skeleton-pill skeleton-w-150" />
            </div>
            <div className="identity-actions skeleton-actions-gap">
              <div className="skeleton-pulse app-skeleton-circle skeleton-icon-sm" />
              <div className="skeleton-pulse app-skeleton-circle skeleton-icon-sm" />
            </div>
          </div>
          <div className="identity-row">
            <div className="skeleton-pulse app-skeleton-circle skeleton-icon-lg" />
            <div className="identity-content skeleton-content-gap">
              <div className="skeleton-pulse app-skeleton-pill skeleton-w-80" />
              <div className="skeleton-pulse app-skeleton-pill skeleton-w-120" />
            </div>
            <div className="identity-actions skeleton-actions-gap">
              <div className="skeleton-pulse app-skeleton-circle skeleton-icon-sm" />
              <div className="skeleton-pulse app-skeleton-circle skeleton-icon-sm" />
            </div>
          </div>
        </div>

        <div className="inbox-section skeleton-inbox-flex">
          <div className="inbox-header-row">
            <div className="inbox-title-group skeleton-title-gap">
              <div className="skeleton-pulse app-skeleton-circle skeleton-icon-md" />
              <div className="skeleton-pulse app-skeleton-pill skeleton-w-100" />
            </div>
            <div className="skeleton-pulse app-skeleton-pill skeleton-w-60" />
          </div>
          <div className="inbox-list skeleton-mt-10">
            <div className="shimmer hub-empty-state">
              <div className="skeleton-pulse app-skeleton-circle skeleton-icon-md" />
              <div className="skeleton-pulse app-skeleton-pill skeleton-w-80" />
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
});

AppSkeleton.displayName = 'AppSkeleton';



export { AppSkeleton as AppSkeleton };

// --- ConfirmModal.tsx ---
interface ConfirmModalProps {
  readonly isOpen: boolean;
  readonly title: string;
  readonly message: string;
  readonly confirmText?: string;
  readonly cancelText?: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly isDestructive?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  isDestructive = false,
}) => {
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef<boolean>(false);
  const titleId = useId();
  const descId = useId();

  // Track open/close transitions to restore focus ONLY when the modal closes
  // (not on every render where isOpen is false, which would steal focus from
  // anywhere it lands while the modal isn't visible).
  useEffect(() => {
    if (isOpen) {
      previousActiveElementRef.current = document.activeElement as HTMLElement | null;
      // Delay focus slightly to let the entry animation begin.
      const focusTimer = setTimeout(() => cancelBtnRef.current?.focus(), 50);
      wasOpenRef.current = true;
      return () => clearTimeout(focusTimer);
    }
    if (wasOpenRef.current) {
      // Restoring focus synchronously can race the exit animation;
      // a tiny delay lets the modal unmount cleanly.
      const restoreTimer = setTimeout(() => {
        previousActiveElementRef.current?.focus();
      }, 0);
      wasOpenRef.current = false;
      return () => clearTimeout(restoreTimer);
    }
    return undefined;
  }, [isOpen]);

  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  // Trap focus and listen for Escape key
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancelRef.current();
        return;
      }

      if (e.key === 'Tab') {
        if (!modalRef.current) {
          return;
        }
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) {
          return;
        }

        const first = focusableElements[0];
        const last = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first && last) {
            last.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === last && first) {
            first.focus();
            e.preventDefault();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="modal-overlay"
          onClick={onCancel}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: tweenIn }}
          exit={{ opacity: 0, transition: tweenOut }}
        >
          <motion.div
            ref={modalRef}
            className="memphis-card confirmation-modal"
            onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1, transition: tweenIn }}
            exit={{ scale: 0.95, opacity: 0, transition: tweenOut }}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
          >
            <h3 id={titleId}>{title}</h3>
            <p id={descId}>{message}</p>
            <div className="confirm-modal-actions">
              <Button ref={cancelBtnRef} className="confirm-modal-btn" onClick={onCancel}>
                {cancelText}
              </Button>
              <Button
                variant={isDestructive ? 'danger' : 'primary'}
                className="confirm-modal-btn"
                onClick={onConfirm}
              >
                {confirmText}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// --- CountdownTimer.tsx ---
interface CountdownTimerProps {
  readonly expiresAt?: number | undefined;
  readonly expiredLabel?: string | undefined;
}

export const CountdownTimer: React.FC<CountdownTimerProps> = ({
  expiresAt,
  expiredLabel = 'Expired',
}) => {
  const [timeLeft, setTimeLeft] = useState<string>('');

  useEffect(() => {
    if (!expiresAt) {
      setTimeLeft('');
      return;
    }

    let rafId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const updateTimer = () => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        setTimeLeft(expiredLabel);
        return;
      }

      const totalMins = Math.floor(remaining / 60000);
      if (totalMins >= 60) {
        const hours = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        setTimeLeft(`${hours}h ${mins}m`);
      } else {
        const secs = Math.floor((remaining % 60000) / 1000);
        setTimeLeft(`${totalMins}:${secs < 10 ? '0' : ''}${secs}`);
      }

      // Schedule next update in 250ms to preserve battery while maintaining high precision
      timeoutId = setTimeout(() => {
        rafId = requestAnimationFrame(updateTimer);
      }, 250);
    };

    updateTimer();

    return () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [expiresAt, expiredLabel]);

  if (!timeLeft) {
    return null;
  }

  const isExpired = timeLeft === expiredLabel;

  return (
    <span
      className={`expiry-badge ${isExpired ? 'expired' : ''}`}
      role="timer"
      aria-label={`Expires in ${timeLeft}`}
    >
      {timeLeft}
    </span>
  );
};

// --- DebugPanel.tsx ---
/* eslint-disable no-console */


// Allow CSS custom properties (e.g. "--debug-bg") in inline style objects without `any`.
type StyleWithVars = React.CSSProperties & Record<`--${string}`, string>;

interface CapturedError {
  timestamp: Date;
  message: string;
  stack: string;
  source: 'error' | 'warn' | 'info' | 'log';
  context: string;
}

interface GhostFillDebugGlobal {
  __GHOSTFILL_ERRORS__?: CapturedError[];
  ghostfillDebug?: {
    getErrors: () => CapturedError[];
    getStats: () => { total: number; errors: number; warnings: number };
  };
}

let stylesInjected = false;

const DebugPanelStyles: React.FC = () => {
  useEffect(() => {
    if (stylesInjected) {
      return;
    }
    const style = document.createElement('style');
    style.textContent = `
  .gf-debug-trigger {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 99999;
    color: var(--gf-ink);
    background: var(--debug-bg, var(--gf-yellow));
    border: 2px solid var(--gf-ink);
    border-radius: 8px;
    padding: 10px 16px;
    font-size: 12px;
    font-weight: 800;
    font-family: 'IBM Plex Mono', monospace;
    text-transform: uppercase;
    cursor: pointer;
    box-shadow: 3px 3px 0 var(--gf-ink);
    display: flex;
    align-items: center;
    gap: 8px;
    transition: transform 0.1s, box-shadow 0.1s;
  }
  .gf-debug-trigger:hover { transform: translate(-1px, -1px); box-shadow: 4px 4px 0 var(--gf-ink); }
  .gf-debug-trigger:active { transform: translate(2px, 2px); box-shadow: 0 0 0 var(--gf-ink); }
  
  .gf-debug-panel {
    position: fixed;
    bottom: 10px;
    right: 10px;
    z-index: 99999;
    width: 400px;
    max-height: 500px;
    background: var(--gf-bg);
    border: 2px solid var(--gf-ink);
    border-radius: 12px;
    box-shadow: 6px 6px 0 var(--gf-ink);
    overflow: hidden;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    color: var(--gf-cream);
  }
  .gf-debug-header {
    background: var(--gf-magenta);
    color: var(--gf-ink);
    padding: 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 2px solid var(--gf-ink);
  }
  .gf-debug-title { font-weight: 800; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; }
  .gf-debug-close {
    background: var(--gf-ink);
    border: 2px solid var(--gf-ink);
    color: var(--gf-magenta);
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
    font-weight: 800;
  }
  .gf-debug-stats { padding: 12px; border-bottom: 2px solid var(--gf-ink); background: var(--gf-surface); }
  .gf-debug-stats-row { display: flex; gap: 12px; justify-content: center; font-weight: 700; }
  .gf-debug-actions { padding: 8px; border-bottom: 2px solid var(--gf-ink); display: flex; gap: 8px; }
  .gf-debug-btn {
    flex: 1; padding: 8px; border: 2px solid var(--gf-ink); border-radius: 6px;
    cursor: pointer; font-weight: 800; text-transform: uppercase; font-size: 10px;
    box-shadow: 2px 2px 0 var(--gf-ink); transition: transform 0.1s, box-shadow 0.1s;
  }
  .gf-debug-btn:active { transform: translate(2px, 2px); box-shadow: none; }
  .gf-debug-btn-refresh { background: var(--gf-cyan); color: var(--gf-ink); }
  .gf-debug-btn-copy { background: var(--gf-mint); color: var(--gf-ink); }
  .gf-debug-list { max-height: 300px; overflow-y: auto; padding: 8px; }
  .gf-debug-empty { text-align: center; color: var(--gf-text-dim); padding: 20px; }
  .gf-debug-error {
    padding: 8px; margin-bottom: 8px; border-radius: 6px;
    border: 2px solid var(--gf-ink); box-shadow: 2px 2px 0 var(--gf-ink);
    background: var(--err-bg);
    border-left: 4px solid var(--err-border-color);
  }
  .gf-debug-error-title { font-weight: 800; margin-bottom: 4px; text-transform: uppercase; }
  .gf-debug-error-message { word-break: break-word; color: var(--gf-cream); }
  .gf-debug-error-timestamp { font-size: 10px; color: var(--gf-text-dim); margin-top: 4px; }
    `;
    document.head.appendChild(style);
    stylesInjected = true;
  }, []);

  return null;
};

export const DebugPanel: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [errors, setErrors] = useState<CapturedError[]>([]);
  const [stats, setStats] = useState({ total: 0, errors: 0, warnings: 0 });

  const refreshErrors = useCallback(() => {
    const global = window as unknown as GhostFillDebugGlobal;
    if (global.ghostfillDebug) {
      setErrors(global.ghostfillDebug.getErrors());
      setStats(global.ghostfillDebug.getStats());
    }
  }, []);

  useEffect(() => {
    refreshErrors();
    const interval = setInterval(refreshErrors, 2000);
    return () => clearInterval(interval);
  }, [refreshErrors]);

  const copyReport = useCallback(() => {
    const report = `GHOSTFILL ERROR REPORT
${'='.repeat(50)}
Date: ${new Date().toISOString()}
Total Errors: ${errors.length}
Errors: ${stats.errors}
Warnings: ${stats.warnings}

${errors
  .map(
    (err, i) => `
[${i + 1}] ${err.timestamp.toISOString()}
Type: ${err.source.toUpperCase()}
Context: ${err.context || 'N/A'}
Message: ${err.message}
${err.stack ? 'Stack: ' + err.stack.split('\n').slice(0, 3).join('\n') : ''}
${'-'.repeat(30)}
`
  )
  .join('')}`;

    navigator.clipboard
      .writeText(report)
      .then(() => {
        console.log(
          '%c✅ Error report copied! Paste it here to share.',
          'color: var(--gf-mint); font-weight: bold'
        );
      })
      .catch(() => {
        console.log(
          '%c❌ Failed to copy. Check console (F12)',
          'color: var(--gf-coral); font-weight: bold'
        );
        console.log(report);
      });
  }, [errors, stats]);

  if (!isOpen) {
    return (
      <>
        <button
          className="gf-debug-trigger"
          onClick={() => setIsOpen(true)}
          style={
            {
              '--debug-bg': errors.length > 0 ? 'var(--gf-coral)' : 'var(--gf-magenta)',
            } as StyleWithVars
          }
          title="Debug Panel - Click to view errors"
        >
          🐛 Debug {errors.length > 0 && `(${errors.length})`}
        </button>
        <DebugPanelStyles />
      </>
    );
  }

  return (
    <>
      <div className="gf-debug-panel">
        {/* Header */}
        <div className="gf-debug-header">
          <span className="gf-debug-title">🐛 GhostFill Debug</span>
          <button
            className="gf-debug-close"
            onClick={() => setIsOpen(false)}
            aria-label="Close debug panel"
          >
            ✕
          </button>
        </div>

        {/* Stats */}
        <div className="gf-debug-stats">
          <div className="gf-debug-stats-row">
            <span className="neon-text-magenta">
              Total: <b>{stats.total}</b>
            </span>
            <span className="neon-text-coral">
              Errors: <b>{stats.errors}</b>
            </span>
            <span className="neon-text-yellow">
              Warnings: <b>{stats.warnings}</b>
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="gf-debug-actions">
          <button
            className="gf-debug-btn gf-debug-btn-refresh"
            onClick={refreshErrors}
            aria-label="Refresh error list"
          >
            🔄 Refresh
          </button>
          <button
            className="gf-debug-btn gf-debug-btn-copy"
            onClick={copyReport}
            aria-label="Copy debug report"
          >
            📋 Copy Report
          </button>
        </div>

        {/* Error List */}
        <div className="gf-debug-list">
          {errors.length === 0 ? (
            <div className="gf-debug-empty">✅ No errors captured</div>
          ) : (
            errors
              .slice(-10)
              .reverse()
              .map((err, i) => (
                <div
                  key={`${err.timestamp.getTime()}-${i}`}
                  className="gf-debug-error"
                  style={
                    {
                      '--err-bg':
                        err.source === 'error'
                          ? 'rgba(var(--gf-coral-rgb, 255,122,92), 0.08)'
                          : 'rgba(var(--gf-yellow-rgb, 255,229,92), 0.08)',
                      '--err-border-color':
                        err.source === 'error' ? 'var(--gf-coral)' : 'var(--gf-yellow)',
                    } as StyleWithVars
                  }
                >
                  <div className="gf-debug-error-title">
                    {err.source === 'error' ? '🔴' : '🟡'} {err.context || 'Error'}
                  </div>
                  <div className="gf-debug-error-message">{err.message.slice(0, 100)}</div>
                  <div className="gf-debug-error-timestamp">{err.timestamp.toISOString()}</div>
                </div>
              ))
          )}
        </div>
      </div>
      <DebugPanelStyles />
    </>
  );
};

// --- EmailAvatar.tsx ---
interface EmailAvatarProps {
  from: string;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

const extractDomain = (emailStr: string): string | null => {
  if (!emailStr) {
    return null;
  }
  // Match anything inside angle brackets if present, e.g. "Mistral AI <no-reply@emails.mistral.ai>"
  const match = emailStr.match(/<([^>]+)>/);
  const email = match && match[1] ? match[1] : emailStr;
  if (!email) {
    return null;
  }
  const parts = email.split('@');
  if (parts.length < 2) {
    return null;
  }
  const domainPart = parts[1];
  if (!domainPart) {
    return null;
  }

  const cleanDomain = domainPart.trim().toLowerCase();
  const domainParts = cleanDomain.split('.');
  if (domainParts.length <= 2) {
    return cleanDomain;
  }

  const last = domainParts[domainParts.length - 1];
  const secondLast = domainParts[domainParts.length - 2];
  if (!last || !secondLast) {
    return cleanDomain;
  }

  const commonSLDs = ['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'nom', 'mil', 'sch'];

  if (secondLast.length <= 3 && (last.length === 2 || commonSLDs.includes(secondLast))) {
    return domainParts.slice(-3).join('.');
  }

  return domainParts.slice(-2).join('.');
};

export const EmailAvatar: React.FC<EmailAvatarProps> = React.memo(
  ({ from, className = '', style, children }) => {
    const domain = useMemo(() => extractDomain(from), [from]);

    const firstLetter = useMemo(() => {
      // Prefer the display name's first letter; fall back to the email/domain so we
      // never render a meaningless "?" when only an address is available.
      const displayName = from.replace(/<[^>]+>/, '').trim();
      const source = displayName || domain || from.trim();
      const firstChar = source.charAt(0);
      return /[a-z0-9]/i.test(firstChar) ? firstChar.toUpperCase() : '?';
    }, [from, domain]);

    return (
      <div className={className} style={style} title={domain || undefined}>
        <span>{firstLetter}</span>
        {children}
      </div>
    );
  }
);

EmailAvatar.displayName = 'EmailAvatar';

// --- EmailViewerModal.tsx ---
const openUrlInTab = (url: string): void => {
  try {
    const safe = new URL(url);
    if (safe.protocol !== 'http:' && safe.protocol !== 'https:') {
      return;
    }
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url: safe.href, active: true });
    } else if (typeof window !== 'undefined') {
      window.open(safe.href, '_blank', 'noopener,noreferrer');
    }
  } catch {
    // Invalid URL — ignore.
  }
};

/**
 * Universal email viewer modal — reusable for both the Hub inbox
 * (disposable inbox / Gmail messages) and the AliasPanel.
 *
 * PERMANENT FIX 2026-06-21: users reported "can't read the email" because
 * the Hub inbox had no way to open a message — clicking the row jumped
 * to a tab, never to a viewer. This component is a single source of
 * truth for email viewing; both surfaces use it.
 *
 * Props are intentionally provider-agnostic — pass whatever subset of
 * fields you have. Loading + error states are owned by the parent.
 */

export interface EmailViewerMessage {
  /** Required */
  subject?: string | undefined;
  from?: string | undefined;
  fromName?: string | undefined;
  date?: number | string | undefined;
  dateFormatted?: string | undefined;
  /** Optional body sources — first non-empty wins */
  snippet?: string | undefined;
  body?: string | undefined;
  htmlBody?: string | undefined;
  /** Detected actions (computed by parent via EXTRACT_OTP / link extraction) */
  otp?: string | null | undefined;
  link?: string | null | undefined;
}

export interface EmailViewerModalProps {
  /** Pass null to close. */
  message: EmailViewerMessage | null;
  loading?: boolean;
  error?: string | null;
  /** Disable the "Copy OTP" / "Open link" buttons (e.g. while loading). */
  onClose: () => void;
  onToast?: (msg: string) => void;
}

const MAX_BODY_CHARS = 18_000;

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
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
};

const formatDate = (msg: EmailViewerMessage): string => {
  if (msg.dateFormatted) {
    return msg.dateFormatted;
  }
  if (typeof msg.date === 'string') {
    return msg.date;
  }
  if (typeof msg.date === 'number') {
    try {
      return new Date(msg.date).toLocaleString();
    } catch {
      return '';
    }
  }
  return '';
};

export const EmailViewerModal: React.FC<EmailViewerModalProps> = ({
  message,
  loading = false,
  error = null,
  onClose,
  onToast,
}) => {
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // ESC closes; Tab is trapped inside the dialog; focus enters on open and
  // returns to the opener on close (WCAG 2.4.3 / 2.1.2).
  useEffect(() => {
    if (!message) {
      return;
    }
    openerRef.current = document.activeElement as HTMLElement;
    const root = modalRef.current;
    root
      ?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )[0]
      ?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab' && root) {
        const items = root.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (items.length === 0) {
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) {
          return;
        }
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      openerRef.current?.focus?.();
    };
  }, [message]);

  const sender = message?.fromName || message?.from || '';
  const dateText = message ? formatDate(message) : '';
  const rawHtml = message?.htmlBody || message?.body || message?.snippet || '';
  const bodyText = rawHtml ? stripHtml(rawHtml.slice(0, MAX_BODY_CHARS)) : '';
  const isLong = bodyText.length > 1200;

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          className="alias-message-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: tweenIn }}
          exit={{ opacity: 0, transition: tweenOut }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-labelledby="email-viewer-subject"
        >
          <motion.div
            ref={modalRef}
            className="alias-message-modal"
            initial={{ y: 12, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1, transition: tweenIn }}
            exit={{ y: 12, opacity: 0, scale: 0.98, transition: tweenOut }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="alias-message-modal-header">
              <div className="alias-message-modal-title-group">
                <Inbox size={16} />
                <div className="alias-message-modal-titles">
                  <div id="email-viewer-subject" className="alias-message-modal-title truncate">
                    {message.subject || '(No subject)'}
                  </div>
                  <div className="alias-message-modal-meta truncate">
                    {sender && (
                      <>
                        <span className="email-viewer-sender">{sender}</span>
                        {dateText && <span className="email-viewer-sep"> · </span>}
                      </>
                    )}
                    {dateText}
                  </div>
                </div>
              </div>
              <button
                className="alias-message-modal-close"
                onClick={onClose}
                aria-label="Close message"
              >
                <X size={16} />
              </button>
            </div>

            {error && <div className="alias-inbox-error">{error}</div>}

            <div className="alias-message-modal-body">
              {loading ? (
                <div className="alias-inbox-loading">
                  <RefreshCw size={20} className="spin-icon" />
                  <span>Loading message…</span>
                </div>
              ) : (
                <>
                  {message.snippet && message.snippet !== bodyText.slice(0, 200) && (
                    <div className="alias-message-modal-snippet">{message.snippet}</div>
                  )}
                  <pre
                    className={
                      isLong && !bodyExpanded
                        ? 'alias-message-modal-content email-viewer-truncated'
                        : 'alias-message-modal-content'
                    }
                  >
                    {bodyText || 'No content available.'}
                  </pre>
                  {isLong && (
                    <button
                      type="button"
                      className="email-viewer-expand-btn"
                      onClick={() => setBodyExpanded((b) => !b)}
                    >
                      {bodyExpanded ? 'Show less' : `Show full message (${bodyText.length} chars)`}
                    </button>
                  )}
                </>
              )}
            </div>

            {(message.otp || message.link) && (
              <div className="alias-message-modal-actions">
                {message.otp && (
                  <button
                    className="alias-message-action-btn"
                    onClick={() =>
                      void copyToClipboard(message.otp ?? '').then((ok) =>
                        onToast?.(ok ? 'OTP copied' : 'Failed to copy OTP')
                      )
                    }
                  >
                    <Copy size={14} />
                    <span>{message.otp}</span>
                  </button>
                )}
                {message.link && (
                  <button
                    className="alias-message-action-btn"
                    onClick={() => openUrlInTab(message.link ?? '')}
                  >
                    {message.otp ? <Link2 size={14} /> : <Check size={14} />}
                    <span>Open link</span>
                  </button>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// --- ErrorBoundary.tsx ---
interface ErrorBoundaryProps {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error | undefined;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
    this.handleUnhandledRejection = this.handleUnhandledRejection.bind(this);
    this.handleGlobalError = this.handleGlobalError.bind(this);
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public override componentDidMount() {
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection);
    window.addEventListener('error', this.handleGlobalError);
  }

  public override componentWillUnmount() {
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
    window.removeEventListener('error', this.handleGlobalError);
  }

  private handleUnhandledRejection(event: PromiseRejectionEvent) {
    console.error('Unhandled promise rejection:', event.reason);
    this.setState({
      hasError: true,
      error: event.reason instanceof Error ? event.reason : new Error(String(event.reason)),
    });
  }

  private handleGlobalError(event: ErrorEvent) {
    // Resource-loading failures (img/script/link) bubble as ErrorEvents whose
    // target is the element rather than window, and carry no real Error object.
    // These should never replace the whole UI with the crash screen.
    if (event.target && event.target !== window) {
      return;
    }
    // Ignore known-benign browser noise (e.g. the harmless "ResizeObserver loop" warning).
    if (event.message && event.message.includes('ResizeObserver loop')) {
      return;
    }
    if (!event.error) {
      return;
    }
    console.error('Global error:', event.error);
    this.setState({ hasError: true, error: event.error });
  }

  public override render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-container">
          <div className="memphis-card error-card">
            <div className="error-icon-box">
              <span className="error-icon-large">⚠️</span>
            </div>
            <h2 className="error-title">System Error</h2>
            <p className="error-message-box">
              The popup interface failed to render. Reset the interface to reload GhostFill.
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: undefined });
                window.location.reload();
              }}
              className="gf-btn gf-btn--primary error-reset-btn"
            >
              Reset Interface
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}



export { ErrorBoundary as ErrorBoundary };

// --- GhostLogo.tsx ---
interface GhostLogoProps {
  size?: number;
  className?: string;
}

// Subtle drift on hover — one calm bob, not a frantic wobble.
const drift = {
  y: [0, -2, 0],
  transition: { duration: 0.7, ease: 'easeInOut' },
};

const press = { scale: 0.92 };

/**
 * GhostFill brand mark — Spectre v2026-06-28.
 *
 * Refined, minimal ghost glyph in the Spectre system:
 *  - Iris→deep linear gradient body
 *  - Hairline ink outline (token-driven so it adapts in light/dark)
 *  - Single bright catchlight per eye for life
 *  - Inner radial highlight for soft dimension
 *  - Ambient outer halo for "luminous mascot" feel
 *
 * Replaces the older flat oval-eye mascot.
 * Public API (size, className) is unchanged — call sites do not need edits.
 */
const GhostLogo: React.FC<GhostLogoProps> = React.memo(({ size = 24, className = '' }) => {
  // Unique gradient ids so multiple instances on the same page don't collide.
  const gid = React.useId().replace(/:/g, '');
  const bodyGrad = `gflogo-body-${gid}`;
  const innerGrad = `gflogo-inner-${gid}`;
  const glow = `gflogo-glow-${gid}`;

  return (
    <motion.div
      className={`ghost-logo-container ${className}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
      whileHover={drift as never}
      whileTap={press as never}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="ghost-logo-svg"
      >
        <defs>
          {/* Iris body gradient — bright top, deep bottom. */}
          <linearGradient
            id={bodyGrad}
            x1="16"
            y1="2"
            x2="16"
            y2="30"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="var(--gf-primary, #7c83ff)" />
            <stop offset="100%" stopColor="var(--gf-primary-deep, #4f55d6)" />
          </linearGradient>
          {/* Soft inner highlight (gives the ghost a glow center). */}
          <radialGradient id={innerGrad} cx="50%" cy="42%" r="60%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.32)" />
            <stop offset="60%" stopColor="rgba(255,255,255,0.06)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
          {/* Ambient halo behind body. */}
          <radialGradient id={glow} cx="50%" cy="55%" r="55%">
            <stop offset="0%" stopColor="var(--gf-primary, #7c83ff)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--gf-primary, #7c83ff)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Ambient glow halo */}
        <circle cx="16" cy="17" r="14" fill={`url(#${glow})`} />

        {/* Ghost body — smooth brow + three-scallop hem */}
        <path
          d="M16 4
             C 9.8 4 6 8.6 6 14
             V 26.4
             C 6 27.3 7.0 27.7 7.6 27.0
             L 9.7 24.7
             L 12.4 27.0
             C 12.9 27.4 13.6 27.4 14.1 27.0
             L 16 25.0
             L 17.9 27.0
             C 18.4 27.4 19.1 27.4 19.6 27.0
             L 22.3 24.7
             L 24.4 27.0
             C 25.0 27.7 26 27.3 26 26.4
             V 14
             C 26 8.6 22.2 4 16 4 Z"
          fill={`url(#${bodyGrad})`}
          stroke="rgba(var(--gf-ink-rgb, 17, 21, 29), 0.45)"
          strokeWidth="0.9"
          strokeLinejoin="round"
        />

        {/* Inner soft glow — dimensional warmth */}
        <ellipse cx="16" cy="14" rx="7.5" ry="8" fill={`url(#${innerGrad})`} />

        {/* Eyes — calm rounded shapes */}
        <ellipse cx="12.6" cy="13.2" rx="1.55" ry="1.7" fill="rgba(255,255,255,0.95)" />
        <ellipse cx="19.4" cy="13.2" rx="1.55" ry="1.7" fill="rgba(255,255,255,0.95)" />

        {/* Bright catchlight — the signature gleam */}
        <circle cx="13.2" cy="12.6" r="0.55" fill="#ffffff" />
        <circle cx="20.0" cy="12.6" r="0.55" fill="#ffffff" />

        {/* Subtle smile arc */}
        <path
          d="M13.8 17.2 C 14.6 18.2 17.4 18.2 18.2 17.2"
          stroke="rgba(255,255,255,0.85)"
          strokeWidth="1.1"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </motion.div>
  );
});

GhostLogo.displayName = 'GhostLogo';


export { GhostLogo as GhostLogo };

// --- Header.tsx ---
interface HeaderProps {
  onOpenSettings: () => void;
  onOpenHelp: () => void;
}

const Header: React.FC<HeaderProps> = React.memo(({ onOpenSettings, onOpenHelp }) => {
  return (
    <header className="header">
      <div className="header-left">
        <div className="logo-circle">
          <GhostLogo size={32} />
        </div>
        <div className="header-title-container">
          <span className="header-title">GhostFill</span>
        </div>
      </div>
      <div className="header-actions">
        <IconButton label="Open help center" title="Help Center" onClick={onOpenHelp}>
          <HelpCircle size={20} strokeWidth={2} />
        </IconButton>
        <IconButton label="Open settings" title="Settings" onClick={onOpenSettings}>
          <Settings size={19} strokeWidth={2.2} />
        </IconButton>
      </div>
    </header>
  );
});
Header.displayName = 'Header';



export { Header as Header };

// --- HelpModal.tsx ---
interface HelpModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Help dialog with a self-contained focus trap (focus first control on open,
 * cycle Tab within, close on Escape). Returning focus to the trigger is handled
 * by the caller. Extracted from App.
 */
const HelpModal: React.FC<HelpModalProps> = ({ open, onClose }) => {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      return;
    }
    const modal = cardRef.current;
    const getFocusable = (): HTMLElement[] =>
      modal
        ? Array.from(
            modal.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            )
          )
        : [];

    getFocusable()[0]?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab' && modal) {
        const focusable = getFocusable();
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          }
        } else if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-overlay help-modal-overlay"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            ref={cardRef}
            className="gf-card help-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-modal-title"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={springSoft}
          >
            <h2 id="help-modal-title" className="help-title">
              {t('helpTitle')}
            </h2>
            <p className="help-desc">{t('helpDescription')}</p>
            <Button variant="primary" className="help-btn" onClick={onClose}>
              {t('dismiss')}
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};



export { HelpModal as HelpModal };

// --- InboxList.tsx ---
export type DisplayedEmail = Email & {
  otpCode?: string | null | undefined;
  activationLink?: string | null | undefined;
};

export interface InboxListProps {
  readonly preferredEmailType: 'disposable' | 'gmail';
  readonly gmailConnected: boolean;
  readonly gmailIsManual: boolean;
  readonly gmailInboxLoading: boolean;
  readonly gmailInboxError: string | null;
  readonly inboxCount: number;
  readonly displayedEmails: DisplayedEmail[];
  readonly openingEmailId?: string | null;
  readonly onNavigate: (
    tab: 'email' | 'password' | 'otp' | 'aliases',
    options?: { aliasTab?: 'generator' | 'inbox' | 'history' }
  ) => void;
  readonly onCopyOTP: (code: string) => void;
  readonly onOpenLink: (event: React.MouseEvent, url: string) => Promise<void> | void;
  readonly onFetchGmailInbox: () => void | Promise<void>;
  readonly onOpenEmail?: (email: DisplayedEmail) => void;
}

const InboxListComponent: React.FC<InboxListProps> = ({
  preferredEmailType,
  gmailConnected,
  gmailIsManual,
  gmailInboxLoading,
  gmailInboxError,
  inboxCount,
  displayedEmails,
  openingEmailId,
  onNavigate,
  onCopyOTP,
  onOpenLink,
  onOpenEmail,
  onFetchGmailInbox,
}) => {
  const handleEmailInteraction = useCallback((
    e: React.MouseEvent | React.KeyboardEvent,
    emailItem: DisplayedEmail
  ) => {
    const target = e.target as HTMLElement;
    if (e.type === 'click' && target.closest('button')) {
      return;
    }
    if (e.type === 'keydown' && (e as React.KeyboardEvent).key !== 'Enter' && (e as React.KeyboardEvent).key !== ' ') {
      return;
    }
    e.preventDefault();
    if (onOpenEmail) {
      onOpenEmail(emailItem);
    } else if (preferredEmailType === 'gmail') {
      onNavigate('aliases', { aliasTab: 'inbox' });
    } else {
      onNavigate('email');
    }
  }, [onOpenEmail, onNavigate, preferredEmailType]);

  const canOpenInbox =
    (preferredEmailType !== 'gmail' && inboxCount > 0);

  return (
    <motion.div className="inbox-section">
      <div className="inbox-header-row">
        <div className="inbox-title-group">
          <Inbox size={22} />
          <span>Inbox</span>
          {inboxCount > 0 && <span className="inbox-count">{inboxCount}</span>}
        </div>
        {canOpenInbox && (
          <motion.button
            className="view-all-btn"
            onClick={() => onNavigate('email')}
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
        ) : preferredEmailType === 'gmail' && gmailInboxLoading && inboxCount === 0 ? (
          <div className="shimmer hub-empty-state">
            <RefreshCw size={18} strokeWidth={1.5} className="spin" color="var(--gf-cyan)" />
            <span>Syncing Gmail</span>
          </div>
        ) : preferredEmailType === 'gmail' && gmailInboxError ? (
          <button
            className="hub-empty-state hub-empty-state--action"
            onClick={() => void onFetchGmailInbox()}
          >
            <AlertCircle size={18} strokeWidth={1.7} color="var(--gf-coral)" />
            <span className="hub-empty-text">{gmailInboxError}</span>
          </button>
        ) : inboxCount === 0 ? (
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
                    ...springSoft,
                    delay: 0.15 + index * 0.05,
                  }}
                  whileHover={{ x: 4 }}
                  role="button"
                  tabIndex={0}
                  onClick={(e) => handleEmailInteraction(e, emailItem)}
                  onKeyDown={(e) => handleEmailInteraction(e, emailItem)}
                  aria-label={`Open email from ${emailItem.from}: ${emailItem.subject}`}
                  aria-busy={openingEmailId === emailItem.id}
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
                                onCopyOTP(emailItem.otpCode);
                              }
                            }}
                            {...interactiveSurface}
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
                                void onOpenLink(e, emailItem.activationLink);
                              }
                            }}
                            {...interactiveSurface}
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
                  <ChevronRight
                    size={14}
                    className="inbox-item-open-chevron"
                    aria-hidden="true"
                  />
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
  );
};

export const InboxList = React.memo(InboxListComponent);
InboxList.displayName = 'InboxList';

// --- Onboarding.tsx ---
interface OnboardingProps {
  onDismiss: () => void;
  version: string;
}

/** First-run welcome overlay. Extracted from App for clarity. */
const Onboarding: React.FC<OnboardingProps> = ({ onDismiss, version }) => {
  const features = [
    {
      icon: <Mail size={24} color="var(--gf-primary)" />,
      text: t('onboardingFeature1'),
      sub: t('onboardingFeature1Sub'),
    },
    {
      icon: <Zap size={24} color="var(--gf-amber)" />,
      text: t('onboardingFeature2'),
      sub: t('onboardingFeature2Sub'),
    },
    {
      icon: <ShieldCheck size={24} color="var(--gf-mint)" />,
      text: t('onboardingFeature3'),
      sub: t('onboardingFeature3Sub'),
    },
  ];

  return (
    <motion.div
      key="onboarding"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.02 }}
      transition={springSoft}
      className="onboarding-overlay"
    >
      <motion.div
        initial={{ scale: 0.5, opacity: 0, rotate: -20 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20, delay: 0.05 }}
        className="onboarding-logo"
      >
        <Sparkles size={36} color="var(--gf-on-primary)" strokeWidth={2.5} />
      </motion.div>

      <motion.h1
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="onboarding-title"
      >
        {t('onboardingTitle')}
      </motion.h1>

      <motion.p
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="onboarding-subtitle"
      >
        {t('onboardingSubtitle')}
      </motion.p>

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="onboarding-features"
      >
        {features.map((step, i) => (
          <div
            key={i}
            className="onboarding-feature-item"
            style={{ '--feature-i': i } as React.CSSProperties}
          >
            <span className="onboarding-feature-icon">{step.icon}</span>
            <div>
              <div className="onboarding-feature-title">{step.text}</div>
              <div className="onboarding-feature-sub">{step.sub}</div>
            </div>
          </div>
        ))}
      </motion.div>

      <Button variant="primary" block className="onboarding-btn" onClick={onDismiss}>
        {t('onboardingButton')}
      </Button>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="onboarding-footer"
      >
        {t('onboardingFooter')} • v{version}
      </motion.p>
    </motion.div>
  );
};



export { Onboarding as Onboarding };

// --- OTPDisplay.tsx ---
interface OTPDisplayProps {
  onToast: (message: string) => void;
}

const OTPTimerBar: React.FC<{ lastOTP: LastOTP | null }> = ({ lastOTP }) => {
  const [timePercentage, setTimePercentage] = useState<number>(100);
  const [timeText, setTimeText] = useState<string>('');

  useEffect(() => {
    if (!lastOTP) {
      setTimePercentage(100);
      setTimeText('');
      return;
    }

    const updateTimer = () => {
      const elapsed = Date.now() - lastOTP.extractedAt;
      const hasExplicitExpiry = !!lastOTP.expiresAt;
      const total = hasExplicitExpiry
        ? Math.max(1, lastOTP.expiresAt! - lastOTP.extractedAt)
        : 10 * 60 * 1000;
      const remaining = total - elapsed;

      if (remaining <= 0) {
        setTimePercentage(0);
        setTimeText(hasExplicitExpiry ? 'Expired' : 'Likely expired');
      } else {
        setTimePercentage((remaining / total) * 100);
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        setTimeText(minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [lastOTP]);

  return (
    <div className="otp-timer-container">
      <div
        className="otp-timer-bg"
        role="progressbar"
        aria-valuenow={timePercentage}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`OTP timer urgency: ${timePercentage < 20 ? 'Critical' : 'Safe'}`}
      >
        <motion.div
          animate={{ width: `${timePercentage}%` }}
          transition={tweenTimerBar}
          className="otp-timer-fill"
          style={{
            '--timer-color': timePercentage < 20 ? 'var(--gf-coral)' : 'var(--gf-primary)',
          }}
        />
      </div>
      <div className="otp-timer-info" aria-live="polite">
        <span className="otp-timer-label">
          {lastOTP?.expiresAt ? 'Expiring in ' : 'Est. expiry in '}
          <span className={timePercentage < 20 ? 'otp-timer-expired' : 'otp-timer-active'}>
            {timeText}
          </span>
        </span>
        <span className="otp-source-label">
          {lastOTP?.source === 'email' ? 'Real-time Sync' : 'Direct'}
        </span>
      </div>
    </div>
  );
};

const OTPDisplay: React.FC<OTPDisplayProps> = ({ onToast }) => {
  // MotionConfig in App.tsx wires reducedMotion="user" globally, but we read the
  // local preference here to gate the looping empty-state pulse.
  const prefersReducedMotion = useReducedMotion();
  const lastOTP = useStorageSubscription('lastOTP', null);
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Immediate sync on mount
    void safeSendMessage({ action: 'CHECK_INBOX' }).catch(() => undefined);
    // Polling removed in favor of Push-State 'lastOTP' value

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const copyOTP = useCallback(async () => {
    if (!lastOTP) {
      return;
    }
    try {
      const copiedToClipboard = await copyToClipboard(lastOTP.code);
      if (!copiedToClipboard) {
        onToast('Copy failed');
        return;
      }
      setCopied(true);
      onToast('OTP copied');

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setCopied(false), 2500); // Longer confirmation
    } catch {
      onToast('Copy failed');
    }
  }, [lastOTP, onToast]);

  const fillOTP = useCallback(async () => {
    if (!lastOTP) {
      return;
    }
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        const res = await safeSendTabMessage(tab.id, {
          action: 'FILL_OTP',
          payload: { otp: lastOTP.code },
        });
        if (res?.success) {
          onToast('OTP filled successfully!');
          // Don't close popup - let user verify
        } else {
          onToast('GhostFill not found on page');
        }
      }
    } catch {
      onToast('Failed to fill');
    }
  }, [lastOTP, onToast]);

  const handleCopyOTP = () => {
    void copyOTP();
  };

  const handleFillOTP = () => {
    void fillOTP();
  };

  return (
    <div className="generator-flow">
      <div className="memphis-card otp-memphis-card-padded">
        <div className="identity-header-row">
          <div className="widget-label widget-label-no-margin">
            <Hash size={16} className="sf-icon" />
            Verification Code
          </div>
          <ShieldCheck size={22} color="var(--gf-mint)" />
        </div>

        {lastOTP ? (
          <div className="otp-focus-area">
            <motion.div
              className="otp-box"
              onClick={handleCopyOTP}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleCopyOTP();
                }
              }}
              whileHover={{ x: -2, y: -2 }}
              whileTap={{ x: 2, y: 2 }}
              role="button"
              tabIndex={0}
              aria-label="Copy OTP code"
            >
              {lastOTP.code.split('').map((char: string, i: number) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 0, scale: 0.8, y: 5 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{
                    ...springDigit,
                    delay: i * 0.04,
                  }}
                  className="otp-digit"
                >
                  {char}
                </motion.span>
              ))}
            </motion.div>

            <OTPTimerBar lastOTP={lastOTP} />

            {lastOTP.confidence && (
              <div className="otp-confidence-row">
                <span className="otp-confidence-label">Confidence</span>
                <div className="otp-confidence-bar">
                  <div
                    className="otp-confidence-fill"
                    style={{
                      '--confidence-width': `${Math.round(lastOTP.confidence * 100)}%`,
                      '--confidence-color':
                        lastOTP.confidence >= 0.9
                          ? 'var(--gf-mint)'
                          : lastOTP.confidence >= 0.7
                            ? 'var(--gf-yellow)'
                            : 'var(--gf-coral)',
                    }}
                  />
                </div>
                <span className="otp-confidence-value">
                  {Math.round(lastOTP.confidence * 100)}%
                </span>
              </div>
            )}

            <div className="otp-actions">
              <Button variant="primary" className="otp-action-primary" onClick={handleFillOTP}>
                <Zap size={18} fill="white" />
                Auto-Fill
              </Button>
              <Button className="otp-action-secondary" onClick={handleCopyOTP}>
                {copied ? <Check size={18} color="var(--gf-success)" /> : <Copy size={18} />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="shimmer otp-empty-state">
            {/* Animated Loading Container */}
            <motion.div
              className="otp-loading-container"
              animate={
                prefersReducedMotion
                  ? { scale: 1, opacity: 0.85 }
                  : { scale: [1, 1.05, 1], opacity: [0.75, 1, 0.75] }
              }
              transition={
                prefersReducedMotion
                  ? { duration: 0 }
                  : { duration: 2, repeat: Infinity, ease: 'easeInOut' }
              }
            >
              <motion.div
                animate={prefersReducedMotion ? { rotate: 0 } : { rotate: 360 }}
                transition={
                  prefersReducedMotion
                    ? { duration: 0 }
                    : { duration: 2, repeat: Infinity, ease: 'linear' }
                }
              >
                <Inbox size={40} color="var(--gf-primary)" strokeWidth={1.5} />
              </motion.div>
            </motion.div>

            <h3 className="otp-empty-title">Listening for codes</h3>
            <p className="otp-empty-desc">
              Verification codes from your ghost inbox will appear here instantly.
            </p>
          </div>
        )}
      </div>

      <div className="memphis-card efficiency-tip-card">
        <div className="widget-label widget-label-no-margin">
          <Info size={16} className="sf-icon" />
          Efficiency Tip
        </div>
        <div className="efficiency-tip-text">
          Press <span className="kbd-key">Ctrl</span>
          <span className="kbd-key">Shift</span>
          <span className="kbd-key">F</span> on any page to fill the latest code instantly.
        </div>
      </div>
    </div>
  );
};

OTPDisplay.displayName = 'OTPDisplay';



export { OTPDisplay as OTPDisplay };

// --- PasswordGenerator.tsx ---
const log = createLogger('PasswordGenerator');

// Strength score (0-4) -> fill percentage shown in the meter.
const STRENGTH_PERCENTS = [8, 20, 45, 75, 100] as const;
const strengthPercent = (score: number): number => STRENGTH_PERCENTS[score] ?? 8;

// Map score 0-4 to a semantic level name (drives CSS color via [data-level]).
const STRENGTH_LEVELS = ['weak', 'fair', 'fair', 'good', 'strong'] as const;
const strengthLevel = (score: number): (typeof STRENGTH_LEVELS)[number] =>
  STRENGTH_LEVELS[score] ?? 'weak';

// Map raw Shannon entropy (bits) to a 0-4 strength score.
const entropyToScore = (entropy: number): number => {
  if (entropy >= 100) {
    return 4;
  }
  if (entropy >= 60) {
    return 3;
  }
  if (entropy >= 36) {
    return 2;
  }
  if (entropy >= 28) {
    return 1;
  }
  return 0;
};

// Estimate the strength of a pre-existing password from its character set.
const describeExistingPassword = (pw: string): GeneratedPassword => {
  let pool = 0;
  if (/[a-z]/.test(pw)) {
    pool += 26;
  }
  if (/[A-Z]/.test(pw)) {
    pool += 26;
  }
  if (/\d/.test(pw)) {
    pool += 10;
  }
  if (/[^a-zA-Z0-9]/.test(pw)) {
    pool += 32;
  }

  const entropy = pool === 0 ? 0 : Math.floor(pw.length * Math.log2(pool));
  const score = entropyToScore(entropy);

  return {
    password: pw,
    strength: {
      score,
      level: score >= 3 ? 'good' : 'weak',
      crackTime: score >= 3 ? 'Secure' : 'Vulnerable',
      entropy,
      suggestions: [],
    },
    options: DEFAULT_PASSWORD_OPTIONS,
    generatedAt: Date.now(),
  };
};

interface PasswordGeneratorProps {
  onToast: (message: string) => void;
  currentPassword?: string;
}

const PasswordGenerator: React.FC<PasswordGeneratorProps> = ({ onToast, currentPassword }) => {
  const [password, setPassword] = useState<GeneratedPassword | null>(null);
  const [options, setOptions] = useState<PasswordOptions>(DEFAULT_PASSWORD_OPTIONS);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  const [localLength, setLocalLength] = useState(options.length);

  const generatePassword = useCallback(async () => {
    setLoading(true);
    try {
      if (!chrome?.runtime?.id) {
        return;
      }
      const response = await safeSendMessage({
        action: 'GENERATE_PASSWORD',
        payload: options,
      });
      const typedResponse = response as GeneratePasswordResponse;
      if (typedResponse.result) {
        setPassword(typedResponse.result);
      }
    } catch (error) {
      log.error('Failed to generate password', error);
      onToast('Failed to generate password');
    } finally {
      setLoading(false);
    }
  }, [options, onToast]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setOptions((prev) => ({ ...prev, length: localLength }));
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [localLength]);

  const passwordRef = useRef<GeneratedPassword | null>(null);
  useEffect(() => {
    passwordRef.current = password;
  }, [password]);

  const prevOptionsRef = useRef(options);

  useEffect(() => {
    if (currentPassword) {
      setPassword(describeExistingPassword(currentPassword));
    } else {
      const optionsChanged = JSON.stringify(prevOptionsRef.current) !== JSON.stringify(options);
      if (!passwordRef.current || optionsChanged) {
        void generatePassword();
        prevOptionsRef.current = options;
      }
    }
  }, [currentPassword, generatePassword, options]);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const copyPassword = async () => {
    if (!password) {
      return;
    }
    try {
      const ok = await copyToClipboard(password.password);
      if (!ok) {
        onToast('Copy failed');
        return;
      }
      setCopied(true);
      onToast('Password copied');

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setCopied(false), TIMING.COPY_CONFIRMATION_MS); // Longer confirmation
    } catch {
      onToast('Copy failed');
    }
  };

  const handleGeneratePassword = () => {
    void generatePassword();
  };

  const handleCopyPassword = () => {
    void copyPassword();
  };

  const handleOptionChange = (key: keyof PasswordOptions, value: boolean | number) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="generator-flow">
      {/* Main Display Card */}
      <div className="memphis-card memphis-card-default">
        <div className="generator-card-header generator-card-header-center">
          <div className="widget-label widget-label-no-margin">
            <Lock size={16} className="sf-icon" />
            {currentPassword ? 'Current Secret' : 'Secured Generator'}
          </div>
          <button
            className="back-button eye-button"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <Eye size={18} /> : <EyeOff size={18} />}
          </button>
        </div>
        {/* Terminal-style Password Display */}
        <motion.div
          className={`password-terminal ${loading ? 'shimmer' : ''}`}
          whileTap={{ x: 2, y: 2 }}
          onClick={handleCopyPassword}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleCopyPassword();
            }
          }}
        >
          <div
            className={`password-display-text ${showPassword ? 'password-display-visible' : 'password-display-hidden'}`}
          >
            {password
              ? showPassword
                ? password.password
                : '•'.repeat(Math.min(password.password.length, 16))
              : '•'.repeat(Math.min(options.length, 16))}
          </div>
        </motion.div>

        {password && (
          <div className="strength-meter-container" aria-live="polite">
            <div className="strength-meter-header">
              <span
                className="strength-level-label"
                data-level={strengthLevel(password.strength.score)}
              >
                {password.strength.level}
              </span>
              <span
                className="strength-level-percent"
                data-level={strengthLevel(password.strength.score)}
              >
                {strengthPercent(password.strength.score)}%
              </span>
            </div>
            {/* Gradient Strength Bar */}
            <div className="strength-bar-bg">
              <div
                className="strength-bar-fill"
                data-level={strengthLevel(password.strength.score)}
                style={{
                  width: `${strengthPercent(password.strength.score)}%`,
                }}
              />
            </div>
          </div>
        )}

        <div className="generator-actions">
          <Button
            variant="primary"
            className={loading ? 'shimmer' : ''}
            onClick={handleGeneratePassword}
            disabled={loading}
          >
            {loading ? <span className="spinner-small" /> : <Zap size={18} fill="white" />}
            {loading ? 'Securing...' : 'Regenerate'}
          </Button>
          <Button onClick={handleCopyPassword}>
            {copied ? <Check size={18} color="var(--gf-success)" /> : <Copy size={18} />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>

      {/* Configuration Card */}
      <div className="memphis-card memphis-card-default memphis-card-mt16">
        <div className="widget-label config-label config-label-spaced">
          <Shield size={16} className="sf-icon" />
          Complexity Settings
        </div>

        {/* Length Slider */}
        <div className="slider-container">
          <div className="slider-header">
            <span>Length</span>
            <span className="slider-value">{options.length}</span>
          </div>
          <input
            type="range"
            className="strength-range-input"
            min="8"
            max="64"
            value={localLength}
            onChange={(e) => setLocalLength(Number(e.target.value))}
            aria-label="Password length"
          />
        </div>

        {/* Toggle Pills Grid */}
        <div className="toggle-pills-grid">
          {[
            { id: 'uppercase', label: 'Upper', icon: 'ABC' },
            { id: 'lowercase', label: 'Lower', icon: 'abc' },
            { id: 'numbers', label: 'Numbers', icon: '123' },
            { id: 'symbols', label: 'Symbols', icon: '#@!' },
          ].map((opt) => {
            const isActive = Boolean(options[opt.id as keyof PasswordOptions]);
            return (
              <button
                key={opt.id}
                type="button"
                className={`toggle-pill ${isActive ? 'active' : ''}`}
                onClick={() => handleOptionChange(opt.id as keyof PasswordOptions, !isActive)}
                aria-pressed={isActive}
                aria-label={`${opt.label}: ${isActive ? 'enabled' : 'disabled'}`}
              >
                <span className="pill-icon">{opt.icon}</span>
                <span className="pill-label">{opt.label}</span>
                <span className="pill-check">
                  <Check size={10} strokeWidth={3} color="var(--gf-ink)" />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};



export { PasswordGenerator as PasswordGenerator };

// --- QuickActions.tsx ---
export interface QuickActionsProps {
  readonly password: string;
  readonly passwordCopied: boolean;
  readonly isGeneratingPassword: boolean;
  readonly passwordCooldown: boolean;
  readonly showPassword: boolean;
  readonly onCopyPassword: () => void;
  readonly onToggleShowPassword: () => void;
  readonly onGeneratePassword: () => void;
}

const QuickActionsComponent: React.FC<QuickActionsProps> = ({
  password,
  passwordCopied,
  isGeneratingPassword,
  passwordCooldown,
  showPassword,
  onCopyPassword,
  onToggleShowPassword,
  onGeneratePassword,
}) => {
  return (
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
          onClick={onCopyPassword}
          {...interactiveSurface}
          title="Copy password"
          aria-label="Copy password to clipboard"
        >
          {passwordCopied ? <Check size={14} /> : <Copy size={14} />}
        </motion.button>
        <motion.button
          className="action-icon"
          onClick={onToggleShowPassword}
          {...interactiveSurface}
          title={showPassword ? 'Hide' : 'Show'}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
        >
          {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
        </motion.button>
        <div className="action-separator" />
        <motion.button
          className={`action-icon action-danger ${passwordCooldown ? 'opacity-50' : ''}`}
          onClick={onGeneratePassword}
          {...interactiveSurface}
          title="Reset secure password"
          aria-label="Generate new secure password"
          disabled={isGeneratingPassword || passwordCooldown}
        >
          <RefreshCw size={14} className={isGeneratingPassword ? 'spin' : ''} />
        </motion.button>
      </div>
    </div>
  );
};

export const QuickActions = React.memo(QuickActionsComponent);
QuickActions.displayName = 'QuickActions';
